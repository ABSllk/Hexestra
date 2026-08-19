import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AgentConnectionSettings } from '../contracts/agent-settings';
import type {
  ClaudeCapabilitySourceError,
  ClaudeMcpDescriptor,
  ClaudeMcpListResult,
  ClaudeMcpReference,
  ClaudeMcpSaveInput,
  ClaudeMcpScope,
  ClaudeSkillDescriptor,
  ClaudeSkillDocument,
  ClaudeSkillImportApplyInput,
  ClaudeSkillImportPreview,
  ClaudeSkillImportPickResult,
  ClaudeSkillImportResult,
  ClaudeSkillImportSourceKind,
  ClaudeSkillListResult,
  ClaudeSkillReference,
  ClaudeSkillSaveInput,
  ClaudeSkillScope,
} from '../contracts/claude-capabilities';
import { CLAUDE_CAPABILITY_NAME_PATTERN } from '../contracts/claude-capabilities';
import { agentSettingsService } from './agent-settings.service';
import { sessionService } from './session.service';
import { windowsPathToWsl } from './wsl-agent-runtime';
import { globalUserSkillRoot, HEXESTRA_CORE_SKILL_NAMES, projectUserSkillRoot, syncProjectUserSkills } from './pentest-skill';
import YAML from 'yaml';

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_SKILL_IMPORT_FILES = 1_000;
const MAX_SKILL_IMPORT_BYTES = 20 * 1024 * 1024;
const SKILL_IMPORT_TTL_MS = 10 * 60 * 1000;
const MAX_MCP_DEFINITION_BYTES = 512 * 1024;
const MAX_CLAUDE_CONFIG_BYTES = 4 * 1024 * 1024;
const CAPABILITY_NAME = CLAUDE_CAPABILITY_NAME_PATTERN;
const MCP_SCOPE_PRIORITY: Record<ClaudeMcpScope, number> = { user: 1, project: 2, local: 3 };

interface RuntimeContext {
  settings: AgentConnectionSettings;
  runtimeHome: string;
  runtimeLabel: string;
  projectPath: string | null;
  projectKey: string | null;
  globalUserPath: string;
}

interface ClaudeCapabilitiesDependencies {
  getSettings: () => AgentConnectionSettings;
  getSessionPath: (sessionId: string) => string;
  resolveRuntimeHome: (settings: AgentConnectionSettings) => Promise<string>;
  getGlobalUserPath: () => string;
}

interface SkillImportFile {
  relativePath: string;
  sourcePath: string;
  size: number;
  digest: string;
}

interface SkillImportSelection {
  id: string;
  kind: ClaudeSkillImportSourceKind;
  sourcePath: string;
  sourceLabel: string;
  sessionId: string | null;
  projectPath: string | null;
  files: SkillImportFile[];
  fingerprint: string;
  expiresAt: number;
}

interface SkillImportScan {
  sourcePath: string;
  sourceLabel: string;
  files: SkillImportFile[];
  fingerprint: string;
  content: string;
  suggestedName: string;
  description: string;
  diagnostics: Array<{ code: string; message: string }>;
}

export class ClaudeCapabilitiesService {
  private readonly dependencies: ClaudeCapabilitiesDependencies;
  private readonly runtimeHomeCache = new Map<string, string>();
  private readonly skillImportSelections = new Map<string, SkillImportSelection>();

  constructor(
    dependencies: Partial<ClaudeCapabilitiesDependencies> = {},
    registerIpc = true,
  ) {
    this.dependencies = {
      getSettings: dependencies.getSettings ?? (() => agentSettingsService.getClaudeSettings()),
      getSessionPath: dependencies.getSessionPath ?? ((sessionId) => sessionService.getSessionPath(sessionId)),
      resolveRuntimeHome: dependencies.resolveRuntimeHome ?? resolveClaudeRuntimeHome,
      getGlobalUserPath: dependencies.getGlobalUserPath ?? (() => sessionService.getGlobalUserPath()),
    };
    if (registerIpc) this.registerHandlers();
  }

  async listSkills(sessionId?: string | null): Promise<ClaudeSkillListResult> {
    const context = await this.context(sessionId);
    const errors: ClaudeCapabilitySourceError[] = [];
    const items: ClaudeSkillDescriptor[] = [];
    for (const enabled of [true, false]) {
      try {
        items.push(...this.readSkillDirectory(this.skillRoot(context, 'global', enabled), 'global', enabled));
      } catch (error) {
        errors.push({ source: 'global user skills', detail: errorMessage(error) });
      }
    }
    if (context.projectPath) {
      for (const enabled of [true, false]) {
        try {
          items.push(...this.readSkillDirectory(this.skillRoot(context, 'project', enabled), 'project', enabled));
        } catch (error) {
          errors.push({ source: 'project user skills', detail: errorMessage(error) });
        }
      }
      try {
        items.push(...this.readSkillDirectory(this.skillRoot(context, 'core', true), 'core', true)
          .filter((item) => HEXESTRA_CORE_SKILL_NAMES.includes(item.name as typeof HEXESTRA_CORE_SKILL_NAMES[number])));
      } catch (error) {
        errors.push({ source: 'Hexestra core skills', detail: errorMessage(error) });
      }
    }
    items.sort((left, right) =>
      Number(right.enabled) - Number(left.enabled)
      || left.scope.localeCompare(right.scope)
      || left.name.localeCompare(right.name),
    );
    return {
      runtimeLabel: context.runtimeLabel,
      projectAvailable: Boolean(context.projectPath),
      items,
      errors,
    };
  }

  async pickSkillImport(
    ownerContents: Electron.WebContents,
    rawKind: unknown,
    sessionId?: string | null,
  ): Promise<ClaudeSkillImportPickResult | null> {
    const kind = assertSkillImportSourceKind(rawKind);
    const owner = BrowserWindow.fromWebContents(ownerContents);
    const options: Electron.OpenDialogOptions = kind === 'directory'
      ? { title: 'Import Skill folder', properties: ['openDirectory', 'multiSelections'] }
      : {
        title: 'Import SKILL.md',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Skill file', extensions: ['md'] }],
      };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const previews: ClaudeSkillImportPreview[] = [];
    try {
      for (const sourcePath of result.filePaths) previews.push(await this.inspectSkillImport(sourcePath, kind, sessionId));
      return previews.length === 1 ? previews[0] : previews;
    } catch (error) {
      for (const preview of previews) this.skillImportSelections.delete(preview.selectionId);
      throw error;
    }
  }

  async inspectSkillImport(
    sourcePath: string,
    kind: ClaudeSkillImportSourceKind,
    sessionId?: string | null,
  ): Promise<ClaudeSkillImportPreview> {
    const normalizedSessionId = nullableSessionId(sessionId);
    const context = await this.context(normalizedSessionId);
    const source = path.resolve(assertNonEmptyPath(sourcePath));
    assertSourceOutsideSkillRoots(source, [
      this.skillRoot(context, 'global', true),
      this.skillRoot(context, 'global', false),
      ...(context.projectPath ? [
        this.skillRoot(context, 'project', true),
        this.skillRoot(context, 'project', false),
      ] : []),
    ]);
    const scan = scanSkillImportSource(source, kind);
    if (scan.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-frontmatter')) {
      throw new Error('The source Skill contains invalid YAML frontmatter.');
    }
    const selectionId = crypto.randomUUID();
    this.pruneSkillImportSelections();
    this.skillImportSelections.set(selectionId, {
      id: selectionId,
      kind,
      sourcePath: source,
      sourceLabel: scan.sourceLabel,
      sessionId: normalizedSessionId,
      projectPath: context.projectPath,
      files: scan.files,
      fingerprint: scan.fingerprint,
      expiresAt: Date.now() + SKILL_IMPORT_TTL_MS,
    });
    return {
      selectionId,
      sourceKind: kind,
      sourceLabel: scan.sourceLabel,
      suggestedName: scan.suggestedName,
      description: scan.description,
      content: scan.content,
      fileCount: scan.files.length,
      totalBytes: scan.files.reduce((total, file) => total + file.size, 0),
      diagnostics: scan.diagnostics,
      existing: this.listSkillImportCollisions(context),
    };
  }

  async applySkillImport(raw: ClaudeSkillImportApplyInput): Promise<ClaudeSkillImportResult> {
    const input = normalizeSkillImportApplyInput(raw);
    this.pruneSkillImportSelections();
    const selection = this.skillImportSelections.get(input.selectionId);
    if (!selection) throw new Error('Skill import preview expired. Choose the source again.');
    this.skillImportSelections.delete(selection.id);
    const context = await this.context(input.sessionId);
    if (selection.sessionId !== input.sessionId || selection.projectPath !== context.projectPath) {
      throw new Error('The active project changed. Choose the Skill source again.');
    }
    const refreshed = scanSkillImportSource(selection.sourcePath, selection.kind);
    if (refreshed.fingerprint !== selection.fingerprint) {
      throw new Error('The source Skill changed after review. Choose it again.');
    }
    if (refreshed.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-frontmatter')) {
      throw new Error('The source Skill contains invalid YAML frontmatter.');
    }
    const name = assertCapabilityName(input.name);
    const description = input.description.trim();
    if (!description) throw new Error('Skill description is required');
    if (input.scope === 'project') requireProjectPath(context);
    const content = normalizeImportedSkillContent(refreshed.content, name, description);
    const collisions = this.listSkillImportCollisions(context)
      .filter((item) => item.scope === input.scope && item.name === name);
    if (collisions.length > 1) {
      throw new Error(`Skill ${name} has both enabled and disabled copies; resolve the duplicate first.`);
    }
    const existing = collisions[0];
    if (existing && input.collision === 'reject') {
      throw new Error(`Skill ${name} already exists in the ${input.scope} scope.`);
    }
    if (input.collision === 'replace') {
      if (!existing) throw new Error(`Skill ${name} is no longer present to replace.`);
      if (input.expectedTargetId !== existing.id) {
        throw new Error('The target Skill changed after review. Inspect the source again.');
      }
    }

    const enabledRoot = this.skillRoot(context, input.scope, true);
    const target = path.join(enabledRoot, name);
    assertSourceOutsideSkillRoots(selection.sourcePath, [enabledRoot, this.skillRoot(context, input.scope, false)]);
    fs.mkdirSync(enabledRoot, { recursive: true });
    const staging = path.join(enabledRoot, `.${name}.import-${crypto.randomUUID()}`);
    let backup: string | null = null;
    let installed = false;
    try {
      copySkillImportFiles(refreshed.files, content, staging);
      const verified = scanSkillImportSource(selection.sourcePath, selection.kind);
      if (verified.fingerprint !== selection.fingerprint) {
        throw new Error('The source Skill changed during import. Choose it again.');
      }
      if (existing) {
        const existingPath = path.join(this.skillRoot(context, input.scope, existing.enabled), name);
        backup = path.join(path.dirname(existingPath), `.${name}.backup-${crypto.randomUUID()}`);
        fs.renameSync(existingPath, backup);
      }
      fs.renameSync(staging, target);
      installed = true;
      this.syncRuntime(context);
      if (backup) {
        fs.rmSync(backup, { recursive: true, force: false });
        backup = null;
      }
      const file = path.join(target, 'SKILL.md');
      return {
        document: {
          ...skillDescriptor(file, input.scope, name, true, content),
          content,
        },
      };
    } catch (error) {
      try {
        if (installed && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (backup && fs.existsSync(backup)) {
          const restoreTarget = path.join(this.skillRoot(context, input.scope, existing?.enabled ?? false), name);
          fs.renameSync(backup, restoreTarget);
        }
        if (context.projectPath) this.syncRuntime(context);
      } catch {
        // Preserve the original failure; the filesystem recovery is best effort.
      }
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async readSkill(reference: ClaudeSkillReference): Promise<ClaudeSkillDocument> {
    const input = normalizeSkillReference(reference);
    const context = await this.context(input.sessionId);
    const file = this.skillFile(context, input.scope, input.name, input.enabled);
    const content = readBoundedText(file, MAX_SKILL_BYTES, 'Skill exceeds the 512 KB editor limit');
    return { ...skillDescriptor(file, input.scope, input.name, input.enabled, content), content };
  }

  async saveSkill(raw: ClaudeSkillSaveInput): Promise<ClaudeSkillDocument> {
    const input = normalizeSkillSaveInput(raw);
    const context = await this.context(input.sessionId);
    if (input.scope === 'core') throw new Error('Hexestra core Skills are read-only');
    const enabled = input.enabled !== false;
    const root = this.skillRoot(context, input.scope, enabled);
    fs.mkdirSync(root, { recursive: true });
    let directory = path.join(root, input.name);
    if (input.originalName && input.originalName !== input.name) {
      const original = path.join(root, input.originalName);
      if (!fs.existsSync(original)) throw new Error(`Skill ${input.originalName} was not found`);
      if (fs.existsSync(directory)) throw new Error(`Skill ${input.name} already exists`);
      fs.renameSync(original, directory);
    }
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'SKILL.md');
    atomicWriteText(file, input.content);
    this.syncRuntime(context);
    return { ...skillDescriptor(file, input.scope, input.name, enabled, input.content), content: input.content };
  }

  async toggleSkill(raw: ClaudeSkillReference): Promise<ClaudeSkillDocument> {
    const input = normalizeSkillReference(raw);
    const context = await this.context(input.sessionId);
    if (input.scope === 'core') throw new Error('Hexestra core Skills cannot be disabled');
    const source = path.dirname(this.skillFile(context, input.scope, input.name, input.enabled));
    const targetRoot = this.skillRoot(context, input.scope, !input.enabled);
    const target = path.join(targetRoot, input.name);
    if (!fs.existsSync(source)) throw new Error(`Skill ${input.name} was not found`);
    if (fs.existsSync(target)) throw new Error(`A ${input.enabled ? 'disabled' : 'enabled'} copy of ${input.name} already exists`);
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.renameSync(source, target);
    this.syncRuntime(context);
    const file = path.join(target, 'SKILL.md');
    const content = readBoundedText(file, MAX_SKILL_BYTES, 'Skill exceeds the 512 KB editor limit');
    return { ...skillDescriptor(file, input.scope, input.name, !input.enabled, content), content };
  }

  async deleteSkill(raw: ClaudeSkillReference): Promise<void> {
    const input = normalizeSkillReference(raw);
    const context = await this.context(input.sessionId);
    if (input.scope === 'core') throw new Error('Hexestra core Skills cannot be deleted');
    const directory = path.dirname(this.skillFile(context, input.scope, input.name, input.enabled));
    if (!fs.existsSync(directory)) throw new Error(`Skill ${input.name} was not found`);
    fs.rmSync(directory, { recursive: true, force: false });
    this.syncRuntime(context);
  }

  async listMcpServers(sessionId?: string | null): Promise<ClaudeMcpListResult> {
    const context = await this.context(sessionId);
    const errors: ClaudeCapabilitySourceError[] = [];
    const items: ClaudeMcpDescriptor[] = [];
    const userFile = path.join(context.runtimeHome, '.claude.json');
    const userConfig = readJsonRecordSafe(userFile, errors, 'user/local MCP');
    if (userConfig) {
      items.push(...mcpDescriptors('user', userFile, childRecord(userConfig, 'mcpServers')));
      if (context.projectKey) {
        const projectConfig = childRecord(childRecord(userConfig, 'projects'), context.projectKey);
        items.push(...mcpDescriptors('local', userFile, childRecord(projectConfig, 'mcpServers')));
      }
    }
    if (context.projectPath) {
      const projectFile = path.join(context.projectPath, '.mcp.json');
      const projectConfig = readJsonRecordSafe(projectFile, errors, 'project MCP');
      if (projectConfig) items.push(...mcpDescriptors('project', projectFile, childRecord(projectConfig, 'mcpServers')));
    }
    markEffectiveMcpServers(items);
    items.sort((left, right) =>
      left.name.localeCompare(right.name)
      || MCP_SCOPE_PRIORITY[right.scope] - MCP_SCOPE_PRIORITY[left.scope],
    );
    return {
      runtimeLabel: context.runtimeLabel,
      projectAvailable: Boolean(context.projectPath),
      items,
      errors,
    };
  }

  async saveMcpServer(raw: ClaudeMcpSaveInput): Promise<ClaudeMcpDescriptor> {
    const input = normalizeMcpSaveInput(raw);
    const context = await this.context(input.sessionId);
    const target = this.mcpTarget(context, input.scope);
    const config = readJsonRecordStrict(target.file);
    const servers = ensureMcpContainer(config, target.projectKey);
    if (input.originalName && input.originalName !== input.name) delete servers[input.originalName];
    servers[input.name] = cloneRecord(input.definition);
    atomicWriteJson(target.file, config);
    return {
      id: `${input.scope}:${input.name}`,
      name: input.name,
      scope: input.scope,
      definition: cloneRecord(input.definition),
      effective: true,
      shadowedBy: null,
      sourcePath: target.file,
    };
  }

  async deleteMcpServer(raw: ClaudeMcpReference): Promise<void> {
    const input = normalizeMcpReference(raw);
    const context = await this.context(input.sessionId);
    const target = this.mcpTarget(context, input.scope);
    const config = readJsonRecordStrict(target.file);
    const servers = ensureMcpContainer(config, target.projectKey);
    if (!(input.name in servers)) throw new Error(`MCP server ${input.name} was not found`);
    delete servers[input.name];
    atomicWriteJson(target.file, config);
  }

  private registerHandlers() {
    ipcMain.handle('claude:skills:list', (_event, sessionId?: string | null) => this.listSkills(sessionId));
    ipcMain.handle('claude:skills:read', (_event, input: ClaudeSkillReference) => this.readSkill(input));
    ipcMain.handle('claude:skills:save', (_event, input: ClaudeSkillSaveInput) => this.saveSkill(input));
    ipcMain.handle('claude:skills:toggle', (_event, input: ClaudeSkillReference) => this.toggleSkill(input));
    ipcMain.handle('claude:skills:delete', (_event, input: ClaudeSkillReference) => this.deleteSkill(input));
    ipcMain.handle('claude:skills:import-pick', (event, kind: unknown, sessionId?: string | null) => this.pickSkillImport(event.sender, kind, sessionId));
    ipcMain.handle('claude:skills:import-apply', (_event, input: ClaudeSkillImportApplyInput) => this.applySkillImport(input));
    ipcMain.handle('claude:mcp:list', (_event, sessionId?: string | null) => this.listMcpServers(sessionId));
    ipcMain.handle('claude:mcp:save', (_event, input: ClaudeMcpSaveInput) => this.saveMcpServer(input));
    ipcMain.handle('claude:mcp:delete', (_event, input: ClaudeMcpReference) => this.deleteMcpServer(input));
  }

  private async context(sessionId?: string | null): Promise<RuntimeContext> {
    const settings = this.dependencies.getSettings();
    const runtimeKey = settings.executionMode === 'wsl'
      ? `wsl:${settings.wslDistribution}:${settings.claudeExecutable}`
      : `native:${settings.claudeExecutable}`;
    let runtimeHome = this.runtimeHomeCache.get(runtimeKey);
    if (!runtimeHome) {
      runtimeHome = await this.dependencies.resolveRuntimeHome(settings);
      this.runtimeHomeCache.set(runtimeKey, runtimeHome);
    }
    const projectPath = sessionId ? this.dependencies.getSessionPath(assertSessionId(sessionId)) : null;
    const projectKey = projectPath
      ? settings.executionMode === 'wsl'
        ? windowsPathToWsl(projectPath, settings.wslDistribution)
        : projectPath
      : null;
    return {
      settings,
      runtimeHome,
      runtimeLabel: settings.executionMode === 'wsl' ? `WSL · ${settings.wslDistribution}` : 'Native',
      projectPath,
      projectKey,
      globalUserPath: this.dependencies.getGlobalUserPath(),
    };
  }

  private skillRoot(context: RuntimeContext, scope: ClaudeSkillScope, enabled: boolean) {
    if (scope === 'global') return globalUserSkillRoot(context.globalUserPath, enabled);
    const projectPath = requireProjectPath(context);
    if (scope === 'project') return projectUserSkillRoot(projectPath, enabled);
    return path.join(projectPath, '.claude', 'skills');
  }

  private syncRuntime(context: RuntimeContext) {
    if (context.projectPath) syncProjectUserSkills(context.projectPath, context.globalUserPath);
  }

  private listSkillImportCollisions(context: RuntimeContext) {
    const collisions: ClaudeSkillImportPreview['existing'] = [];
    const scopes: Array<{ scope: 'global' | 'project'; projectPath: string | null }> = [
      { scope: 'global', projectPath: null },
      ...(context.projectPath ? [{ scope: 'project' as const, projectPath: context.projectPath }] : []),
    ];
    for (const { scope, projectPath } of scopes) {
      for (const enabled of [true, false]) {
        const root = scope === 'global'
          ? this.skillRoot(context, 'global', enabled)
          : projectUserSkillRoot(projectPath!, enabled);
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !CAPABILITY_NAME.test(entry.name)) continue;
          collisions.push({
            scope,
            name: entry.name,
            enabled,
            id: `${scope}:${enabled ? 'enabled' : 'disabled'}:${entry.name}`,
          });
        }
      }
    }
    return collisions.sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name) || Number(right.enabled) - Number(left.enabled));
  }

  private pruneSkillImportSelections() {
    const now = Date.now();
    for (const [id, selection] of this.skillImportSelections) {
      if (selection.expiresAt <= now) this.skillImportSelections.delete(id);
    }
  }

  private skillFile(context: RuntimeContext, scope: ClaudeSkillScope, name: string, enabled: boolean) {
    return path.join(this.skillRoot(context, scope, enabled), assertCapabilityName(name), 'SKILL.md');
  }

  private readSkillDirectory(root: string, scope: ClaudeSkillScope, enabled: boolean) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && CAPABILITY_NAME.test(entry.name))
      .flatMap((entry) => {
        const file = path.join(root, entry.name, 'SKILL.md');
        if (!fs.existsSync(file)) return [];
        try {
          const content = readBoundedText(file, MAX_SKILL_BYTES, 'Skill exceeds the 512 KB editor limit');
          return [skillDescriptor(file, scope, entry.name, enabled, content)];
        } catch {
          return [];
        }
      });
  }

  private mcpTarget(context: RuntimeContext, scope: ClaudeMcpScope) {
    if (scope === 'project') {
      return { file: path.join(requireProjectPath(context), '.mcp.json'), projectKey: null };
    }
    if (scope === 'local' && !context.projectKey) throw new Error('Open a project folder to manage local MCP servers');
    return {
      file: path.join(context.runtimeHome, '.claude.json'),
      projectKey: scope === 'local' ? context.projectKey : null,
    };
  }
}

export function wslPathToUnc(distribution: string, linuxPath: string) {
  if (!linuxPath.startsWith('/')) throw new Error(`WSL home is not an absolute path: ${linuxPath}`);
  const suffix = linuxPath === '/' ? '' : linuxPath.replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distribution}${suffix}`;
}

export async function resolveClaudeRuntimeHome(settings: AgentConnectionSettings) {
  if (settings.executionMode === 'native') return app.getPath('home');
  if (process.platform !== 'win32') throw new Error('WSL Agent runtime is only supported on Windows');
  const result = await execFileText('wsl.exe', [
    '--distribution', settings.wslDistribution,
    '--cd', '~',
    '--exec', '/bin/pwd',
  ]);
  const home = result.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('/'));
  if (!home) throw new Error(`Could not resolve the home directory in ${settings.wslDistribution}`);
  return wslPathToUnc(settings.wslDistribution, home);
}

function assertSkillImportSourceKind(value: unknown): ClaudeSkillImportSourceKind {
  if (value !== 'directory' && value !== 'skill-file') throw new Error('Invalid Skill import source');
  return value;
}

function normalizeSkillImportApplyInput(value: ClaudeSkillImportApplyInput) {
  if (!isRecord(value)) throw new Error('Invalid Skill import payload');
  const scope = value.scope;
  if (scope !== 'global' && scope !== 'project') throw new Error('Skill imports cannot target core Skills');
  const collision = value.collision;
  if (collision !== 'reject' && collision !== 'replace') throw new Error('Invalid Skill import collision policy');
  if (typeof value.selectionId !== 'string' || !value.selectionId.trim()) throw new Error('Skill import selection is required');
  return {
    sessionId: nullableSessionId(value.sessionId),
    selectionId: value.selectionId,
    scope,
    name: assertCapabilityName(value.name),
    description: typeof value.description === 'string' ? value.description : '',
    collision,
    expectedTargetId: typeof value.expectedTargetId === 'string' ? value.expectedTargetId : null,
  };
}

function assertNonEmptyPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Skill import source is required');
  return value;
}

function scanSkillImportSource(sourcePath: string, kind: ClaudeSkillImportSourceKind): SkillImportScan {
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error('Skill import sources cannot be symbolic links');
  if (kind === 'directory' && !sourceStat.isDirectory()) throw new Error('Choose a Skill directory');
  if (kind === 'skill-file' && (!sourceStat.isFile() || path.basename(sourcePath).toLowerCase() !== 'skill.md')) {
    throw new Error('Choose a file named SKILL.md');
  }
  const files = kind === 'directory'
    ? collectSkillImportFiles(sourcePath, sourcePath)
    : collectStandaloneSkillFile(sourcePath);
  if (files.length === 0) throw new Error('The Skill package is empty');
  const skillFile = files.find((file) => file.relativePath.toLowerCase() === 'skill.md');
  if (!skillFile) throw new Error('The selected directory must contain SKILL.md at its root');
  if (files.length > MAX_SKILL_IMPORT_FILES) throw new Error(`Skill package exceeds the ${MAX_SKILL_IMPORT_FILES} file limit`);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_SKILL_IMPORT_BYTES) throw new Error('Skill package exceeds the 20 MiB size limit');
  const content = fs.readFileSync(skillFile.sourcePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('Skill exceeds the 512 KiB editor limit');
  const metadata = parseSkillImportMetadata(content);
  const sourceLabel = kind === 'directory' ? path.basename(sourcePath) : path.basename(path.dirname(sourcePath));
  const fallbackName = kind === 'directory' ? path.basename(sourcePath) : path.basename(path.dirname(sourcePath));
  const diagnostics = [...metadata.diagnostics];
  if (metadata.name && !CAPABILITY_NAME.test(metadata.name)) {
    diagnostics.push({ code: 'invalid-name', message: 'Skill name must use 1–64 letters, numbers, dots, underscores, or hyphens.' });
  }
  const suggestedName = importSuggestedName(metadata.name || fallbackName);
  const serializedManifest = JSON.stringify(files.map((file) => ({ path: file.relativePath, size: file.size, digest: file.digest })));
  const fingerprint = crypto.createHash('sha256').update(serializedManifest, 'utf8').digest('hex');
  return {
    sourcePath,
    sourceLabel,
    files,
    fingerprint,
    content,
    suggestedName,
    description: metadata.description,
    diagnostics,
  };
}

function collectStandaloneSkillFile(sourcePath: string): SkillImportFile[] {
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Choose a regular SKILL.md file');
  if (stat.size > MAX_SKILL_IMPORT_BYTES) throw new Error('Skill package exceeds the 20 MiB size limit');
  return [{
    relativePath: 'SKILL.md',
    sourcePath,
    size: stat.size,
    digest: digestFile(sourcePath),
  }];
}

function collectSkillImportFiles(
  root: string,
  current: string,
  output: SkillImportFile[] = [],
  totalBytes = { value: 0 },
): SkillImportFile[] {
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) throw new Error(`Skill package contains a symbolic link: ${path.basename(current)}`);
  if (!stat.isDirectory()) throw new Error('Choose a Skill directory');
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill package contains a symbolic link: ${entry.name}`);
    if (entry.isDirectory()) {
      collectSkillImportFiles(root, filePath, output, totalBytes);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Skill package contains an unsupported filesystem entry: ${entry.name}`);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Skill package entry is not a regular file: ${entry.name}`);
    if (stat.size > MAX_SKILL_IMPORT_BYTES || totalBytes.value + stat.size > MAX_SKILL_IMPORT_BYTES) {
      throw new Error('Skill package exceeds the 20 MiB size limit');
    }
    totalBytes.value += stat.size;
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    if (output.some((item) => item.relativePath.toLowerCase() === relativePath.toLowerCase())) {
      throw new Error(`Skill package contains duplicate paths: ${relativePath}`);
    }
    output.push({
      relativePath,
      sourcePath: filePath,
      size: stat.size,
      digest: digestFile(filePath),
    });
    if (output.length > MAX_SKILL_IMPORT_FILES) throw new Error(`Skill package exceeds the ${MAX_SKILL_IMPORT_FILES} file limit`);
  }
  return output;
}

function digestFile(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseSkillImportMetadata(content: string) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    if (/^---\s*(?:\r?\n|$)/.test(content)) {
      return {
        name: '',
        description: '',
        diagnostics: [{ code: 'invalid-frontmatter', message: 'Skill frontmatter is not valid YAML.' }],
      };
    }
    return {
      name: '',
      description: '',
      diagnostics: [
        { code: 'missing-name', message: 'Add a Skill name before importing.' },
        { code: 'missing-description', message: 'Add a Skill description before importing.' },
      ],
    };
  }
  let values: Record<string, unknown>;
  try {
    const parsed = YAML.parse(match[1]);
    if (!isRecord(parsed)) throw new Error('Skill frontmatter must be a YAML object');
    values = parsed;
  } catch {
    return {
      name: '',
      description: '',
      diagnostics: [{ code: 'invalid-frontmatter', message: 'Skill frontmatter is not valid YAML.' }],
    };
  }
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const description = typeof values.description === 'string' ? values.description.trim() : '';
  return {
    name,
    description,
    diagnostics: [
      ...(name ? [] : [{ code: 'missing-name', message: 'Add a Skill name before importing.' }]),
      ...(description ? [] : [{ code: 'missing-description', message: 'Add a Skill description before importing.' }]),
    ],
  };
}

function importSuggestedName(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return CAPABILITY_NAME.test(normalized) ? normalized : 'imported-skill';
}

function normalizeImportedSkillContent(content: string, name: string, description: string) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  let values: Record<string, unknown> = {};
  if (match) {
    const parsed = YAML.parse(match[1]);
    if (!isRecord(parsed)) throw new Error('Skill frontmatter must be a YAML object');
    values = parsed;
  }
  values.name = name;
  values.description = description;
  const frontmatter = `---\n${YAML.stringify(values).trimEnd()}\n---`;
  return match ? `${frontmatter}${content.slice(match[0].length)}` : `${frontmatter}\n\n${content}`;
}

function copySkillImportFiles(files: SkillImportFile[], normalizedContent: string, targetRoot: string) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of files) {
    const sourceStat = fs.lstatSync(file.sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Skill package entry is not a regular file: ${file.relativePath}`);
    }
    const relative = file.relativePath.split('/').join(path.sep);
    const target = path.join(targetRoot, relative);
    if (!isSafeRelativePath(relative)) throw new Error(`Unsafe Skill package path: ${file.relativePath}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (file.relativePath.toLowerCase() === 'skill.md') fs.writeFileSync(target, normalizedContent, 'utf8');
    else fs.copyFileSync(file.sourcePath, target);
  }
}

function isSafeRelativePath(value: string) {
  const normalized = path.normalize(value);
  return !path.isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function assertSourceOutsideSkillRoots(sourcePath: string, roots: string[]) {
  const source = path.resolve(sourcePath);
  if (roots.some((root) => isPathWithin(root, source))) {
    throw new Error('Choose a Skill source outside the managed Skill directories.');
  }
}

function isPathWithin(parent: string, candidate: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeSkillSaveInput(value: ClaudeSkillSaveInput) {
  if (!isRecord(value)) throw new Error('Invalid Skill payload');
  const content = typeof value.content === 'string' ? value.content : '';
  if (!content.trim()) throw new Error('SKILL.md content is required');
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('Skill exceeds the 512 KB editor limit');
  return {
    sessionId: nullableSessionId(value.sessionId),
    scope: assertSkillScope(value.scope),
    name: assertCapabilityName(value.name),
    content,
    enabled: value.enabled !== false,
    originalName: value.originalName ? assertCapabilityName(value.originalName) : null,
  };
}

function normalizeSkillReference(value: ClaudeSkillReference) {
  if (!isRecord(value)) throw new Error('Invalid Skill reference');
  return {
    sessionId: nullableSessionId(value.sessionId),
    scope: assertSkillScope(value.scope),
    name: assertCapabilityName(value.name),
    enabled: value.enabled === true,
  };
}

function normalizeMcpSaveInput(value: ClaudeMcpSaveInput) {
  if (!isRecord(value)) throw new Error('Invalid MCP payload');
  const definition = validateMcpDefinition(value.definition);
  return {
    sessionId: nullableSessionId(value.sessionId),
    scope: assertMcpScope(value.scope),
    name: assertCapabilityName(value.name),
    definition,
    originalName: value.originalName ? assertCapabilityName(value.originalName) : null,
  };
}

function normalizeMcpReference(value: ClaudeMcpReference) {
  if (!isRecord(value)) throw new Error('Invalid MCP reference');
  return {
    sessionId: nullableSessionId(value.sessionId),
    scope: assertMcpScope(value.scope),
    name: assertCapabilityName(value.name),
  };
}

function validateMcpDefinition(value: unknown) {
  if (!isRecord(value)) throw new Error('MCP definition must be a JSON object');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MCP_DEFINITION_BYTES) throw new Error('MCP definition exceeds 512 KB');
  const type = typeof value.type === 'string' ? value.type : value.url ? 'http' : 'stdio';
  if (type === 'stdio' && (typeof value.command !== 'string' || !value.command.trim())) {
    throw new Error('A stdio MCP server requires a command');
  }
  if ((type === 'http' || type === 'sse') && (typeof value.url !== 'string' || !/^https?:\/\//i.test(value.url))) {
    throw new Error(`${type.toUpperCase()} MCP server requires an HTTP(S) URL`);
  }
  return cloneRecord(value);
}

function assertCapabilityName(value: unknown) {
  if (typeof value !== 'string' || !CAPABILITY_NAME.test(value)) {
    throw new Error('Name must be 1-64 letters, numbers, dots, underscores, or hyphens');
  }
  return value;
}

function assertSkillScope(value: unknown): ClaudeSkillScope {
  if (value !== 'global' && value !== 'project' && value !== 'core') throw new Error('Invalid Skill scope');
  return value;
}

function assertMcpScope(value: unknown): ClaudeMcpScope {
  if (value !== 'user' && value !== 'project' && value !== 'local') throw new Error('Invalid MCP scope');
  return value;
}

function nullableSessionId(value: unknown) {
  return value === null || value === undefined || value === '' ? null : assertSessionId(value);
}

function assertSessionId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]+$/.test(value)) throw new Error('Invalid session identifier');
  return value;
}

function requireProjectPath(context: RuntimeContext) {
  if (!context.projectPath) throw new Error('Open a project folder to manage project capabilities');
  return context.projectPath;
}

function skillDescriptor(
  file: string,
  scope: ClaudeSkillScope,
  fallbackName: string,
  enabled: boolean,
  content: string,
): ClaudeSkillDescriptor {
  const metadata = parseSkillMetadata(content);
  const name = metadata.name || fallbackName;
  return {
    id: `${scope}:${enabled ? 'enabled' : 'disabled'}:${fallbackName}`,
    name: fallbackName,
    description: metadata.description || `/${name}`,
    scope,
    enabled,
    sourcePath: file,
    metadata: metadata.metadata,
  };
}

function parseSkillMetadata(content: string) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: '', description: '', metadata: {} };
  try {
    const values = YAML.parse(match[1]) as Record<string, unknown> | null;
    const metadata = isRecord(values?.metadata) ? Object.fromEntries(Object.entries(values.metadata).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, value as string])) : {};
    return {
      name: typeof values?.name === 'string' ? values.name : '',
      description: typeof values?.description === 'string' ? values.description : '',
      metadata,
    };
  } catch {
    return { name: '', description: '', metadata: {} };
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function mcpDescriptors(scope: ClaudeMcpScope, file: string, servers: Record<string, unknown>) {
  return Object.entries(servers).flatMap(([name, definition]) =>
    CAPABILITY_NAME.test(name) && isRecord(definition)
      ? [{
          id: `${scope}:${name}`,
          name,
          scope,
          definition: cloneRecord(definition),
          effective: false,
          shadowedBy: null,
          sourcePath: file,
        } satisfies ClaudeMcpDescriptor]
      : [],
  );
}

function markEffectiveMcpServers(items: ClaudeMcpDescriptor[]) {
  const winners = new Map<string, ClaudeMcpDescriptor>();
  for (const item of items) {
    const current = winners.get(item.name);
    if (!current || MCP_SCOPE_PRIORITY[item.scope] > MCP_SCOPE_PRIORITY[current.scope]) winners.set(item.name, item);
  }
  for (const item of items) {
    const winner = winners.get(item.name)!;
    item.effective = item === winner;
    item.shadowedBy = item.effective ? null : winner.scope;
  }
}

function ensureMcpContainer(config: Record<string, unknown>, projectKey: string | null): Record<string, unknown> {
  if (!projectKey) return ensureChildRecord(config, 'mcpServers');
  return ensureChildRecord(ensureChildRecord(ensureChildRecord(config, 'projects'), projectKey), 'mcpServers');
}

function childRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}

function ensureChildRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (isRecord(value)) return value;
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function readJsonRecordSafe(file: string, errors: ClaudeCapabilitySourceError[], source: string) {
  try {
    return readJsonRecordStrict(file);
  } catch (error) {
    errors.push({ source, detail: errorMessage(error) });
    return null;
  }
}

function readJsonRecordStrict(file: string) {
  if (!fs.existsSync(file)) return {};
  const content = readBoundedText(file, MAX_CLAUDE_CONFIG_BYTES, 'Claude configuration exceeds 4 MB');
  const value = JSON.parse(content) as unknown;
  if (!isRecord(value)) throw new Error(`${file} must contain a JSON object`);
  return value;
}

function readBoundedText(file: string, maxBytes: number, message: string) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Requested capability path is not a file');
  if (stat.size > maxBytes) throw new Error(message);
  return fs.readFileSync(file, 'utf8');
}

function atomicWriteText(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, file);
}

function atomicWriteJson(file: string, value: Record<string, unknown>) {
  atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cloneRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function execFileText(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stripNulls(stderr) || error.message));
      else resolve(stripNulls(stdout));
    });
  });
}

function stripNulls(value: string) {
  return value.replace(/\0/g, '').trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const claudeCapabilitiesService = new ClaudeCapabilitiesService();
