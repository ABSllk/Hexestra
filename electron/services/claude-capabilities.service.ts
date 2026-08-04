import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
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
  ClaudeSkillListResult,
  ClaudeSkillReference,
  ClaudeSkillSaveInput,
  ClaudeSkillScope,
} from '../contracts/claude-capabilities';
import { agentSettingsService } from './agent-settings.service';
import { sessionService } from './session.service';
import { windowsPathToWsl } from './wsl-agent-runtime';

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_MCP_DEFINITION_BYTES = 512 * 1024;
const MAX_CLAUDE_CONFIG_BYTES = 4 * 1024 * 1024;
const CAPABILITY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const MCP_SCOPE_PRIORITY: Record<ClaudeMcpScope, number> = { user: 1, project: 2, local: 3 };

interface RuntimeContext {
  settings: AgentConnectionSettings;
  runtimeHome: string;
  runtimeLabel: string;
  projectPath: string | null;
  projectKey: string | null;
}

interface ClaudeCapabilitiesDependencies {
  getSettings: () => AgentConnectionSettings;
  getSessionPath: (sessionId: string) => string;
  resolveRuntimeHome: (settings: AgentConnectionSettings) => Promise<string>;
}

export class ClaudeCapabilitiesService {
  private readonly dependencies: ClaudeCapabilitiesDependencies;
  private readonly runtimeHomeCache = new Map<string, string>();

  constructor(
    dependencies: Partial<ClaudeCapabilitiesDependencies> = {},
    registerIpc = true,
  ) {
    this.dependencies = {
      getSettings: dependencies.getSettings ?? (() => agentSettingsService.getSettings()),
      getSessionPath: dependencies.getSessionPath ?? ((sessionId) => sessionService.getSessionPath(sessionId)),
      resolveRuntimeHome: dependencies.resolveRuntimeHome ?? resolveClaudeRuntimeHome,
    };
    if (registerIpc) this.registerHandlers();
  }

  async listSkills(sessionId?: string | null): Promise<ClaudeSkillListResult> {
    const context = await this.context(sessionId);
    const errors: ClaudeCapabilitySourceError[] = [];
    const items: ClaudeSkillDescriptor[] = [];
    for (const scope of ['personal', 'project'] as const) {
      if (scope === 'project' && !context.projectPath) continue;
      for (const enabled of [true, false]) {
        try {
          items.push(...this.readSkillDirectory(this.skillRoot(context, scope, enabled), scope, enabled));
        } catch (error) {
          errors.push({ source: `${scope} skills`, detail: errorMessage(error) });
        }
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
    return { ...skillDescriptor(file, input.scope, input.name, enabled, input.content), content: input.content };
  }

  async toggleSkill(raw: ClaudeSkillReference): Promise<ClaudeSkillDocument> {
    const input = normalizeSkillReference(raw);
    const context = await this.context(input.sessionId);
    const source = path.dirname(this.skillFile(context, input.scope, input.name, input.enabled));
    const targetRoot = this.skillRoot(context, input.scope, !input.enabled);
    const target = path.join(targetRoot, input.name);
    if (!fs.existsSync(source)) throw new Error(`Skill ${input.name} was not found`);
    if (fs.existsSync(target)) throw new Error(`A ${input.enabled ? 'disabled' : 'enabled'} copy of ${input.name} already exists`);
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.renameSync(source, target);
    const file = path.join(target, 'SKILL.md');
    const content = readBoundedText(file, MAX_SKILL_BYTES, 'Skill exceeds the 512 KB editor limit');
    return { ...skillDescriptor(file, input.scope, input.name, !input.enabled, content), content };
  }

  async deleteSkill(raw: ClaudeSkillReference): Promise<void> {
    const input = normalizeSkillReference(raw);
    const context = await this.context(input.sessionId);
    const directory = path.dirname(this.skillFile(context, input.scope, input.name, input.enabled));
    if (!fs.existsSync(directory)) throw new Error(`Skill ${input.name} was not found`);
    fs.rmSync(directory, { recursive: true, force: false });
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
    };
  }

  private skillRoot(context: RuntimeContext, scope: ClaudeSkillScope, enabled: boolean) {
    const base = scope === 'personal' ? context.runtimeHome : requireProjectPath(context);
    return path.join(base, '.claude', enabled ? 'skills' : 'skills-disabled');
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
  if (value !== 'personal' && value !== 'project') throw new Error('Invalid Skill scope');
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
  };
}

function parseSkillMetadata(content: string) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: '', description: '' };
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) values[pair[1]] = unquote(pair[2].trim());
  }
  return { name: values.name ?? '', description: values.description ?? '' };
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
