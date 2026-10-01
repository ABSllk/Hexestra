import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import type { AgentActivity, AgentAdapter, AgentBackendCapabilities, AgentBackendStatus, AgentCommandDiscoveryInput, AgentConversationHandle, AgentConversationOpenInput, AgentInteractionHandler, AgentModelOption, AgentQueuedInput, AgentRunEvent, AgentRunInput } from '../../contracts/agent-runtime';
import { AgentBackendError } from '../../contracts/agent-runtime';
import type { AskUserQuestion } from '../../agent-interaction-contract';
import { agentSettingsService } from '../agent-settings.service';
import { windowsPathToWsl } from '../wsl-agent-runtime';
import { CodexAppServer } from './codex-app-server';
import { CodexToolBridge } from './codex-tool-bridge';
import type { SubagentRun } from '../../agent-subagent-contract';
import type { AgentSkillDescriptor } from '../../agent-command-contract';
import type { CodexSkillItem, CodexSkillListResult, CodexSkillSaveInput, CodexSkillCopyInput, CodexMcpItem, CodexMcpListResult, CodexMcpSaveInput } from '../../contracts/codex-capabilities';
import YAML from 'yaml';
import { projectUserDataPath } from '../project-registry';
import { HEXESTRA_CORE_SKILL_NAMES } from '../pentest-skill';

const CAPABILITY_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const MAX_SKILL_BYTES = 512 * 1024;

const execFileAsync = promisify(execFile);
const CONTEXT_VERSION = 'hexestra-codex-v1';
type RecordValue = Record<string, unknown>;
type RpcMessage = { id?: number | string; method?: string; params?: unknown };
type Runtime = { server: CodexAppServer; bridge: CodexToolBridge; threadId: string | null; cwd: string;
  fingerprint: string; settings: ReturnType<typeof agentSettingsService.getCodexSettings> };

const codexUserInputSchema = z.object({
  itemId: z.string().min(1),
  questions: z.array(z.object({
    id: z.string().min(1),
    header: z.string(),
    question: z.string().min(1),
    isOther: z.boolean().default(true),
    isSecret: z.boolean().default(false),
    options: z.array(z.object({ label: z.string(), description: z.string() })).nullish(),
  })).min(1).superRefine((questions, context) => {
    const ids = new Set<string>();
    questions.forEach(({ id }, index) => {
      if (ids.has(id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Question IDs must be unique' });
      ids.add(id);
    });
  }),
});

export class CodexAgentAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly capabilities: AgentBackendCapabilities = { branching: 'session', subagents: true, attachments: ['text', 'image', 'pdf', 'file'],
    tools: true, interactiveQuestions: true, slashCommands: false, queuedInput: true, scheduledWakeups: true };
  private available = false;
  private authenticated: boolean | null = null;
  private lastError: string | null = null;
  private runtimes = new Map<string, Runtime>();
  private handles = new Map<string, CodexConversationHandle>();
  private activeTurnKeys = new Set<string>();
  private diagnosticServer: CodexAppServer | null = null;
  private diagnosticFingerprint: string | null = null;
  private modelCatalog = new WeakMap<CodexAppServer, AgentModelOption[]>();
  private readonly skillsChangedListeners = new Set<() => void>();

  onSkillsChanged(listener: () => void) {
    this.skillsChangedListeners.add(listener);
    return () => this.skillsChangedListeners.delete(listener);
  }

  private notifySkillsChanged() {
    for (const listener of this.skillsChangedListeners) listener();
  }

  async initialize() {
    const settings = agentSettingsService.getCodexSettings();
    try {
      const command = settings.executionMode === 'wsl' ? 'wsl.exe' : settings.codexExecutable;
      const args = settings.executionMode === 'wsl'
        ? ['--distribution', settings.wslDistribution, '--exec', settings.codexExecutable, '--version'] : ['--version'];
      const { stdout } = await execFileAsync(command, args, { timeout: 10_000, windowsHide: true });
      if (!/codex/i.test(stdout)) throw new Error('Codex executable returned an unexpected version');
      this.available = true;
      this.lastError = null;
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = codexLaunchError(error, settings).message;
      return false;
    }
  }

  fingerprint() {
    const settings = agentSettingsService.getCodexSettings();
    return JSON.stringify([CONTEXT_VERSION, settings.executionMode, settings.wslDistribution, settings.codexExecutable]);
  }

  status(): AgentBackendStatus {
    const settings = agentSettingsService.getCodexSettings();
    return { available: this.available, authenticated: this.authenticated, model: settings.model,
      lastError: this.lastError, runtimeMode: settings.executionMode,
      runtimeLabel: settings.executionMode === 'wsl' ? `WSL · ${settings.wslDistribution}` : 'Native' };
  }

  async authStatus() {
    const server = await this.getDiagnosticServer();
    const result = await server.request<{ account?: { type?: string } | null }>('account/read', { refreshToken: false });
    this.authenticated = Boolean(result.account);
    return { authenticated: this.authenticated, method: result.account?.type ?? null };
  }

  async listModels(_input: AgentCommandDiscoveryInput): Promise<AgentModelOption[]> {
    const server = await this.getDiagnosticServer();
    return this.readModels(server, true);
  }

  async listSkills(input: AgentCommandDiscoveryInput): Promise<AgentSkillDescriptor[]> {
    const server = await this.getDiagnosticServer();
    const settings = agentSettingsService.getCodexSettings();
    const cwd = settings.executionMode === 'wsl'
      ? windowsPathToWsl(input.cwd, settings.wslDistribution) : input.cwd;
    const result = await server.request<{ data?: Array<{ skills?: Array<{
      name?: unknown; description?: unknown; enabled?: unknown;
      interface?: { shortDescription?: unknown };
    }> }> }>('skills/list', { cwds: [cwd], forceReload: true });
    const skills = new Map<string, AgentSkillDescriptor>();
    for (const skill of result.data?.[0]?.skills ?? []) {
      if (skill.enabled === false || typeof skill.name !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(skill.name)) continue;
      const description = typeof skill.interface?.shortDescription === 'string'
        ? skill.interface.shortDescription : typeof skill.description === 'string' ? skill.description : '';
      skills.set(skill.name, { name: skill.name, description });
    }
    return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private runtimePath(windowsPath: string) {
    const settings = agentSettingsService.getCodexSettings();
    return settings.executionMode === 'wsl' ? windowsPathToWsl(windowsPath, settings.wslDistribution) : windowsPath;
  }

  private async skillRoots(cwd: string) {
    const settings = agentSettingsService.getCodexSettings();
    let home = os.homedir();
    if (settings.executionMode === 'wsl') {
      const { stdout } = await execFileAsync('wsl.exe', ['--distribution', settings.wslDistribution, '--exec', '/usr/bin/env'],
        { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 });
      home = stdout.split(/\r?\n/).find((line) => line.startsWith('HOME='))?.slice(5) ?? '';
      if (!home.startsWith('/')) throw new Error('Cannot locate the Codex WSL home directory');
    }
    const join = settings.executionMode === 'wsl' ? path.posix.join : path.join;
    return { user: join(home, '.agents', 'skills'), repo: join(this.runtimePath(cwd), '.agents', 'skills') };
  }

  private async skillContext(input: AgentCommandDiscoveryInput) {
    const settings = agentSettingsService.getCodexSettings();
    const roots = await this.skillRoots(input.cwd);
    const manifestPath = path.join(projectUserDataPath(input.cwd), 'released-skills.json');
    let mirrored = new Set<string>();
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { names?: unknown };
      if (Array.isArray(manifest.names)) mirrored = new Set(manifest.names.filter((name): name is string => typeof name === 'string'));
    } catch { /* A project without Claude Skills has no release manifest. */ }
    return { roots, mirrored, runtimeLabel: settings.executionMode === 'wsl' ? `Codex · WSL ${settings.wslDistribution}` : 'Codex · Native' };
  }

  private ownedSkillPath(skillPath: string, root: string) {
    const api = agentSettingsService.getCodexSettings().executionMode === 'wsl' ? path.posix : path;
    const normalizedRoot = api.normalize(root);
    const normalized = api.normalize(skillPath);
    const expected = api.join(normalizedRoot, api.basename(api.dirname(normalized)), 'SKILL.md');
    const same = process.platform === 'win32' && api === path
      ? normalized.toLowerCase() === expected.toLowerCase() : normalized === expected;
    const inside = process.platform === 'win32' && api === path
      ? api.dirname(api.dirname(normalized)).toLowerCase() === normalizedRoot.toLowerCase()
      : api.dirname(api.dirname(normalized)) === normalizedRoot;
    return same && inside;
  }

  async listSkillsDetailed(input: AgentCommandDiscoveryInput): Promise<CodexSkillListResult> {
    const server = await this.getDiagnosticServer();
    const { roots, mirrored, runtimeLabel } = await this.skillContext(input);
    const result = await server.request<{ data?: Array<{ skills?: Array<{
      name?: unknown; description?: unknown; path?: unknown; scope?: unknown; enabled?: unknown;
      interface?: { shortDescription?: unknown };
    }>; errors?: Array<{ path?: string; message?: string }> }> }>('skills/list',
      { cwds: [this.runtimePath(input.cwd)], forceReload: true });
    const entry = result.data?.[0];
    const items: CodexSkillItem[] = (entry?.skills ?? []).flatMap((skill) => {
      if (typeof skill.name !== 'string' || typeof skill.path !== 'string') return [];
      const scope = skill.scope === 'user' || skill.scope === 'repo' || skill.scope === 'system' || skill.scope === 'admin'
        ? skill.scope : 'system';
      return [{ name: skill.name, path: skill.path, scope, enabled: skill.enabled !== false,
        description: typeof skill.interface?.shortDescription === 'string' ? skill.interface.shortDescription
          : typeof skill.description === 'string' ? skill.description : '',
        editable: (scope === 'user' || scope === 'repo')
          && this.ownedSkillPath(skill.path, scope === 'user' ? roots.user : roots.repo)
          && !(scope === 'repo' && (mirrored.has(skill.name)
            || HEXESTRA_CORE_SKILL_NAMES.includes(skill.name as typeof HEXESTRA_CORE_SKILL_NAMES[number]))),
      }];
    });
    items.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
    return { runtimeLabel, projectAvailable: true, items,
      errors: (entry?.errors ?? []).map((error) => ({ source: error.path ?? 'Codex Skills', detail: error.message ?? 'Unknown error' })) };
  }

  async readSkill(input: AgentCommandDiscoveryInput, skillPath: string) {
    const listed = await this.listSkillsDetailed(input);
    const item = listed.items.find((entry) => entry.path === skillPath);
    if (!item) throw new Error('Skill is no longer available');
    const server = await this.getDiagnosticServer();
    const result = await server.request<{ dataBase64: string }>('fs/readFile', { path: skillPath });
    const content = Buffer.from(result.dataBase64, 'base64').toString('utf8');
    if (Buffer.byteLength(content) > MAX_SKILL_BYTES) throw new Error('Skill file is too large to edit');
    return { ...item, content };
  }

  async saveSkill(input: AgentCommandDiscoveryInput, change: CodexSkillSaveInput) {
    if (!CAPABILITY_NAME.test(change.name)) throw new Error('Invalid skill name');
    if (typeof change.content !== 'string' || Buffer.byteLength(change.content) > MAX_SKILL_BYTES)
      throw new Error('Skill content exceeds the 512 KB limit');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(change.content);
    if (!frontmatter) throw new Error('SKILL.md needs YAML frontmatter');
    const metadata = YAML.parse(frontmatter[1]) as unknown;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || (metadata as Record<string, unknown>).name !== change.name
      || typeof (metadata as Record<string, unknown>).description !== 'string'
      || !(metadata as Record<string, string>).description.trim())
      throw new Error('Skill name and description must match the SKILL.md frontmatter');
    const { roots } = await this.skillContext(input);
    const api = agentSettingsService.getCodexSettings().executionMode === 'wsl' ? path.posix : path;
    const root = roots[change.scope];
    const target = api.join(root, change.name, 'SKILL.md');
    if (change.originalPath && change.originalPath !== target) throw new Error('Rename or scope change is not supported for an existing Skill');
    if (change.originalPath && !this.ownedSkillPath(change.originalPath, root)) throw new Error('This Skill is managed outside the editable user/project folders');
    const server = await this.getDiagnosticServer();
    if (!change.originalPath) {
      await server.request('fs/createDirectory', { path: root, recursive: true });
      await server.request('fs/createDirectory', { path: api.dirname(target), recursive: false });
    } else {
      const existing = await this.listSkillsDetailed(input);
      if (!existing.items.some((item) => item.path === change.originalPath && item.editable))
        throw new Error('Skill is no longer available for editing');
      const directory = await server.request<{ isSymlink: boolean }>('fs/getMetadata', { path: api.dirname(target) });
      const file = await server.request<{ isSymlink: boolean }>('fs/getMetadata', { path: target });
      if (directory.isSymlink || file.isSymlink) throw new Error('Symlinked Skills are read-only in this editor');
    }
    await server.request('fs/writeFile', { path: target, dataBase64: Buffer.from(change.content).toString('base64') });
    this.notifySkillsChanged();
    return target;
  }

  async copySkill(input: AgentCommandDiscoveryInput, change: CodexSkillCopyInput) {
    if (!CAPABILITY_NAME.test(change.name)) throw new Error('Invalid skill name');
    const listed = await this.listSkillsDetailed(input);
    const source = listed.items.find((item) => item.path === change.sourcePath);
    if (!source) throw new Error('Skill is no longer available');
    const document = await this.readSkill(input, source.path);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document.content);
    if (!frontmatter) throw new Error('The source Skill has no YAML frontmatter');
    const metadata = YAML.parse(frontmatter[1]) as Record<string, unknown> | null;
    if (!metadata || typeof metadata.description !== 'string' || !metadata.description.trim())
      throw new Error('The source Skill needs a description before it can be copied');
    const copiedContent = `---\n${YAML.stringify({ ...metadata, name: change.name }).trimEnd()}\n---\n`
      + document.content.slice(frontmatter[0].length);
    if (Buffer.byteLength(copiedContent) > MAX_SKILL_BYTES) throw new Error('Skill file is too large to edit');

    const { roots } = await this.skillContext(input);
    const settings = agentSettingsService.getCodexSettings();
    const api = settings.executionMode === 'wsl' ? path.posix : path;
    const root = roots[change.scope];
    const targetDirectory = api.join(root, change.name);
    const sourceDirectory = api.dirname(source.path);
    if (api.dirname(api.resolve(targetDirectory)) !== api.resolve(root)) throw new Error('Invalid Skill destination');
    if (targetDirectory === sourceDirectory) throw new Error('Choose another name for the copy');
    const server = await this.getDiagnosticServer();
    const sourceMetadata = await server.request<{ isSymlink: boolean }>('fs/getMetadata', { path: sourceDirectory });
    if (sourceMetadata.isSymlink) throw new Error('Symlinked Skills cannot be copied');

    if (settings.executionMode === 'wsl') {
      const wsl = (...args: string[]) => execFileAsync('wsl.exe', ['--distribution', settings.wslDistribution, '--exec', ...args],
        { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
      await wsl('/usr/bin/mkdir', '-p', '--', root);
      await wsl('/usr/bin/mkdir', '--', targetDirectory);
      try {
        await wsl('/usr/bin/cp', '-a', '--', `${sourceDirectory}/.`, targetDirectory);
        await server.request('fs/writeFile', { path: api.join(targetDirectory, 'SKILL.md'), dataBase64: Buffer.from(copiedContent).toString('base64') });
      } catch (error) {
        await wsl('/usr/bin/rm', '-rf', '--', targetDirectory);
        throw error;
      }
    } else {
      await fs.promises.mkdir(root, { recursive: true });
      const stagingDirectory = api.join(root, `.hexestra-skill-copy-${randomUUID()}`);
      if (api.dirname(api.resolve(stagingDirectory)) !== api.resolve(root)) throw new Error('Invalid temporary Skill destination');
      try {
        await fs.promises.cp(sourceDirectory, stagingDirectory, { recursive: true, force: false, errorOnExist: true });
        await server.request('fs/writeFile', { path: api.join(stagingDirectory, 'SKILL.md'), dataBase64: Buffer.from(copiedContent).toString('base64') });
        await fs.promises.rename(stagingDirectory, targetDirectory);
      } catch (error) {
        await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
        throw error;
      }
    }
    this.notifySkillsChanged();
    return api.join(targetDirectory, 'SKILL.md');
  }

  async toggleSkill(input: AgentCommandDiscoveryInput, skillPath: string, enabled: boolean) {
    const listed = await this.listSkillsDetailed(input);
    if (!listed.items.some((item) => item.path === skillPath)) throw new Error('Skill is no longer available');
    const server = await this.getDiagnosticServer();
    await server.request('skills/config/write', { path: skillPath, enabled });
    this.notifySkillsChanged();
  }

  async deleteSkill(input: AgentCommandDiscoveryInput, skillPath: string) {
    const listed = await this.listSkillsDetailed(input);
    const item = listed.items.find((entry) => entry.path === skillPath);
    if (!item?.editable) throw new Error('Only user and project Skills in their own folders can be deleted');
    const server = await this.getDiagnosticServer();
    const api = agentSettingsService.getCodexSettings().executionMode === 'wsl' ? path.posix : path;
    const directory = await server.request<{ isSymlink: boolean }>('fs/getMetadata', { path: api.dirname(skillPath) });
    if (directory.isSymlink) throw new Error('Symlinked Skills cannot be deleted in this editor');
    await server.request('fs/remove', { path: api.dirname(skillPath), recursive: true, force: false });
    this.notifySkillsChanged();
  }

  async listMcpServers(input?: AgentCommandDiscoveryInput): Promise<CodexMcpListResult> {
    const server = await this.getDiagnosticServer();
    const settings = agentSettingsService.getCodexSettings();
    const config = await server.request<{ config?: { mcp_servers?: Record<string, unknown> };
      origins?: Record<string, { name?: { type?: string; file?: string; dotCodexFolder?: string } }> }>('config/read',
      { includeLayers: true, cwd: input ? this.runtimePath(input.cwd) : undefined });
    type McpRuntimeState = { name: string; runtimeStatus?: string | null; pluginId?: string | null;
      tools?: Record<string, unknown>; toolsError?: string | null };
    const statusByName = new Map<string, McpRuntimeState>();
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const page: { data?: McpRuntimeState[]; nextCursor?: string | null } = await server.request('mcpServerStatus/list',
        { cursor, limit: 100, detail: 'toolsAndAuthOnly' });
      for (const state of page.data ?? []) statusByName.set(state.name, state);
      cursor = page.nextCursor ?? null;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    const displayStatus = (runtime?: string | null): CodexMcpItem['status'] => runtime === 'connected' ? 'connected'
      : runtime === 'failed' ? 'failed' : runtime === 'authenticationRequired' ? 'needs-auth'
        : runtime === 'disabled' ? 'disabled' : runtime === 'starting' || runtime === 'notStarted' ? 'pending' : 'unknown';
    const items: CodexMcpItem[] = Object.entries(config.config?.mcp_servers ?? {}).flatMap(([name, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const state = statusByName.get(name);
      const runtime = state?.runtimeStatus;
      const origin = config.origins?.[`mcp_servers.${name}`]?.name ?? config.origins?.mcp_servers?.name;
      const scope = state?.pluginId ? 'plugin' : origin?.type === 'project' ? 'project'
        : origin?.type === 'user' || !origin ? 'user' : 'managed';
      const api = settings.executionMode === 'wsl' ? path.posix : path;
      const configFile = origin?.type === 'project' && origin.dotCodexFolder
        ? api.join(origin.dotCodexFolder, 'config.toml') : origin?.type === 'user' ? origin.file ?? null : null;
      return [{ name, definition: raw as Record<string, unknown>, scope, configFile, pluginId: state?.pluginId ?? null,
        enabled: (raw as Record<string, unknown>).enabled !== false && runtime !== 'disabled', status: displayStatus(runtime),
        toolCount: Object.keys(state?.tools ?? {}).length, error: state?.toolsError ?? null }];
    });
    const configuredNames = new Set(items.map((item) => item.name));
    for (const state of statusByName.values()) {
      if (configuredNames.has(state.name)) continue;
      items.push({ name: state.name, definition: {}, scope: state.pluginId ? 'plugin' : 'managed',
        pluginId: state.pluginId ?? null, enabled: state.runtimeStatus !== 'disabled', status: displayStatus(state.runtimeStatus),
        toolCount: Object.keys(state.tools ?? {}).length, error: state.toolsError ?? null });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { runtimeLabel: settings.executionMode === 'wsl' ? `Codex · WSL ${settings.wslDistribution}` : 'Codex · Native', items };
  }

  async saveMcpServer(change: CodexMcpSaveInput, input?: AgentCommandDiscoveryInput) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(change.name)) throw new Error('MCP server name must use letters, numbers, _ or -');
    if (change.name === 'hexestra') throw new Error('The hexestra MCP server name is reserved for project tools');
    if (change.originalName && change.originalName !== change.name) throw new Error('Rename is not supported; create a new server instead');
    if (!change.definition || typeof change.definition !== 'object' || Array.isArray(change.definition)) throw new Error('Invalid MCP server definition');
    if (!(typeof change.definition.command === 'string' && change.definition.command.trim())
      && !(typeof change.definition.url === 'string' && change.definition.url.trim()))
      throw new Error('An MCP server needs a command or URL');
    if (change.scope === 'project') throw new Error('Open the project .codex/config.toml in the file editor to change project MCP servers');
    const listed = change.originalName ? await this.listMcpServers(input) : null;
    const existing = listed?.items.find((item) => item.name === change.originalName);
    if (existing?.scope === 'plugin') throw new Error('Plugin MCP transport is managed by its plugin; use the enable control instead');
    if (existing?.scope === 'project') throw new Error('Open the project .codex/config.toml in the file editor to change project MCP servers');
    const server = await this.getDiagnosticServer();
    await server.request('config/value/write', { keyPath: `mcp_servers.${change.name}`,
      value: omitNullConfigValues(change.definition), mergeStrategy: 'replace' });
    await server.request('config/mcpServer/reload', undefined);
  }

  async deleteMcpServer(name: string, input?: AgentCommandDiscoveryInput) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('This MCP server name cannot be removed from the user config editor');
    const existing = (await this.listMcpServers(input)).items.find((item) => item.name === name);
    if (!existing) throw new Error('MCP server is no longer available');
    if (existing.scope !== 'user') throw new Error('Only user MCP servers can be removed here; edit project configuration in the file editor');
    const server = await this.getDiagnosticServer();
    await server.request('config/value/write', { keyPath: `mcp_servers.${name}`, value: null, mergeStrategy: 'replace' });
    await server.request('config/mcpServer/reload', undefined);
  }

  async toggleMcpServer(name: string, enabled: boolean, input?: AgentCommandDiscoveryInput) {
    if (name === 'hexestra') throw new Error('This MCP server cannot be changed here');
    const existing = (await this.listMcpServers(input)).items.find((item) => item.name === name);
    if (!existing) throw new Error('MCP server is no longer available');
    if (existing.scope !== 'plugin' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))
      throw new Error('This MCP server name cannot be changed here');
    if (existing.scope === 'project') throw new Error('Open the project .codex/config.toml in the file editor to change this server');
    const server = await this.getDiagnosticServer();
    const quoted = (segment: string) => `"${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const pluginKey = existing.pluginId
      ? `plugins.${quoted(existing.pluginId)}.mcp_servers.${quoted(name)}.enabled` : null;
    await server.request('config/value/write', { keyPath: pluginKey ?? `mcp_servers.${name}.enabled`, value: enabled,
      mergeStrategy: 'replace' });
    await server.request('config/mcpServer/reload', undefined);
  }

  private async readModels(server: CodexAppServer, refresh = false): Promise<AgentModelOption[]> {
    const cached = this.modelCatalog.get(server);
    if (cached && !refresh) return cached;
    const models: AgentModelOption[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const page: { data?: Array<{ id?: string; model?: string; displayName?: string; hidden?: boolean; isDefault?: boolean; defaultReasoningEffort?: AgentModelOption['defaultReasoningEffort']; supportedReasoningEfforts?: Array<{ reasoningEffort: NonNullable<AgentModelOption['supportedReasoningEfforts']>[number]; description?: string }> }>; nextCursor?: string | null } =
        await server.request('model/list', { cursor, limit: 100, includeHidden: false });
      for (const item of page.data ?? []) {
        const id = item.model || item.id;
        if (id && !item.hidden && !models.some((model) => model.id === id)) {
          models.push({ id, displayName: item.displayName || id, isDefault: item.isDefault,
            defaultReasoningEffort: item.defaultReasoningEffort,
            supportedReasoningEfforts: item.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort),
            reasoningEffortDescriptions: item.supportedReasoningEfforts?.some((entry) => entry.description)
              ? item.supportedReasoningEfforts.reduce<NonNullable<AgentModelOption['reasoningEffortDescriptions']>>((all, entry) => {
              if (entry.description) all[entry.reasoningEffort] = entry.description;
              return all;
            }, {}) : undefined });
        }
      }
      cursor = page.nextCursor ?? null;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    this.modelCatalog.set(server, models);
    return models;
  }

  private async defaultEffort(server: CodexAppServer, modelId: string | null) {
    try {
      const models = await this.readModels(server);
      return (models.find((model) => modelId && model.id === modelId)
        ?? models.find((model) => model.isDefault)
        ?? models[0])?.defaultReasoningEffort;
    } catch {
      // Older App Servers may omit model capabilities. Keep their native default.
      return undefined;
    }
  }

  async diagnose(cwd?: string) {
    // A login performed in another Codex process may not update a running app-server's account cache.
    this.diagnosticServer?.close();
    this.diagnosticServer = null;
    await this.authStatus();
    const server = await this.getDiagnosticServer();
    const settings = agentSettingsService.getCodexSettings();
    const runtimeCwd = cwd && settings.executionMode === 'wsl'
      ? windowsPathToWsl(cwd, settings.wslDistribution) : cwd;
    const [skills, mcp] = await Promise.allSettled([
      runtimeCwd ? server.request<{ data?: Array<{ skills?: unknown[]; errors?: unknown[] }> }>('skills/list', { cwds: [runtimeCwd], forceReload: true }) : Promise.resolve(null),
      server.request<{ data?: unknown[] }>('mcpServerStatus/list', { cursor: null, limit: 100, detail: 'toolsAndAuthOnly' }),
    ]);
    const bridge = await this.probeBridge(cwd ?? process.cwd()).then(() => ({ ready: true, error: null }),
      (error: unknown) => ({ ready: false, error: error instanceof Error ? error.message : String(error) }));
    return { ...this.status(),
      skills: skills.status === 'fulfilled' ? (skills.value?.data?.[0]?.skills?.length ?? null) : null,
      skillError: skills.status === 'rejected' ? String(skills.reason) : null,
      mcpServers: mcp.status === 'fulfilled' ? (mcp.value.data?.length ?? 0) : null,
      mcpError: mcp.status === 'rejected' ? String(mcp.reason) : null,
      bridgeReady: bridge.ready, bridgeError: bridge.error,
    };
  }

  private async probeBridge(cwd: string) {
    const settings = agentSettingsService.getCodexSettings();
    const bridge = new CodexToolBridge(settings.executionMode === 'wsl');
    await bridge.start([]);
    let server: CodexAppServer | null = null;
    let threadId: string | null = null;
    try {
      const host = settings.executionMode === 'wsl' ? await wslHost(settings.wslDistribution) : '127.0.0.1';
      server = new CodexAppServer(settings, cwd, {
        'mcp_servers.hexestra.url': bridge.url(host),
        'mcp_servers.hexestra.bearer_token_env_var': 'HEXESTRA_MCP_TOKEN',
        'mcp_servers.hexestra.required': true,
        'mcp_servers.hexestra.default_tools_approval_mode': 'approve',
      }, { HEXESTRA_MCP_TOKEN: bridge.bearerToken });
      await server.start();
      const runtimeCwd = settings.executionMode === 'wsl' ? windowsPathToWsl(cwd, settings.wslDistribution) : cwd;
      const result = await server.request<{ thread: { id: string } }>('thread/start', {
        cwd: runtimeCwd, approvalPolicy: 'never', sandbox: 'read-only',
      });
      threadId = result.thread.id;
    } finally {
      if (threadId && server) await server.request('thread/delete', { threadId }).catch(() => {});
      server?.close();
      await bridge.close();
    }
  }

  private async getDiagnosticServer() {
    const fingerprint = this.fingerprint();
    if (this.diagnosticServer && this.diagnosticFingerprint === fingerprint) return this.diagnosticServer;
    this.diagnosticServer?.close();
    this.diagnosticServer = null;
    const settings = agentSettingsService.getCodexSettings();
    const server = new CodexAppServer(settings);
    server.on('message', (message: RpcMessage) => {
      if (message.method !== 'skills/changed' || this.diagnosticServer !== server) return;
      this.notifySkillsChanged();
    });
    try {
      await server.start();
    } catch (error) {
      server.close();
      throw codexLaunchError(error, settings);
    }
    this.diagnosticServer = server;
    this.diagnosticFingerprint = fingerprint;
    return server;
  }

  async openConversation(input: AgentConversationOpenInput, interactions: AgentInteractionHandler): Promise<AgentConversationHandle> {
    const key = this.runtimeKey(input.projectId, input.conversationId);
    const existing = this.handles.get(key);
    if (existing) return existing;
    const handle = new CodexConversationHandle(this, input as AgentRunInput, interactions);
    this.handles.set(key, handle);
    return handle;
  }

  hasPinnedRuntimeForProject(projectId: string) {
    return [...this.handles.entries()].some(([key, handle]) => key.startsWith(`${projectId}\0`) && handle.snapshot().pendingCrons > 0);
  }

  hasPinnedRuntimeForConversation(projectId: string, conversationId: string) {
    return (this.handles.get(this.runtimeKey(projectId, conversationId))?.snapshot().pendingCrons ?? 0) > 0;
  }

  private runtimeKey(projectId: string | undefined, conversationId: string) {
    return `${projectId ?? ''}\0${conversationId}`;
  }

  isBusy(projectId: string | undefined, conversationId: string) {
    return this.activeTurnKeys.has(this.runtimeKey(projectId, conversationId));
  }

  removeHandle(projectId: string | undefined, conversationId: string, handle: CodexConversationHandle) {
    const key = this.runtimeKey(projectId, conversationId);
    if (this.handles.get(key) === handle) this.handles.delete(key);
  }

  async disposeConversation(projectId: string | undefined, conversationId: string) {
    const key = this.runtimeKey(projectId, conversationId);
    await this.handles.get(key)?.dispose();
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    this.runtimes.delete(key);
    runtime.server.close();
    await runtime.bridge.close();
  }

  async *runTurn(input: AgentRunInput, interactions: AgentInteractionHandler): AsyncIterable<AgentRunEvent> {
    const key = this.runtimeKey(input.projectId, input.conversationId);
    let runtime = this.runtimes.get(key);
    if (runtime && runtime.fingerprint !== this.fingerprint()
      && !this.hasPinnedRuntimeForConversation(input.projectId ?? '', input.conversationId)) {
      this.runtimes.delete(key);
      runtime.server.close();
      await runtime.bridge.close();
      runtime = undefined;
    }
    if (!runtime) {
      runtime = await this.createRuntime(input);
      this.runtimes.set(key, runtime);
    }
    this.activeTurnKeys.add(key);
    const { server, bridge } = runtime;
    bridge.bind(input.tools, interactions, input.signal,
      (delayMs, prompt) => {
        const handle = this.handles.get(key);
        if (!handle) throw new Error('Codex conversation is unavailable for scheduling');
        return handle.scheduleWakeup(delayMs, prompt);
      });
    const queue = new EventQueue<AgentRunEvent>();
    let turnId: string | null = null;
    let turnError: string | null = null;
    const activities = new Map<string, AgentActivity>();
    const subagents = new Map<string, SubagentRun>();
    const pendingUserInputs = new Set<Promise<void>>();
    let turnCompleted = false;
    const closeCompletedTurn = () => {
      if (turnCompleted && pendingUserInputs.size === 0) queue.close();
    };
    let activeTextId: string | null = null;
    let textSequence = 0;
    const combinedText = () => [...activities.values()]
      .filter((activity) => activity.kind === 'text')
      .map((activity) => activity.content?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n');
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      queue.push({ type: 'turn_snapshot', content: combinedText(), activities: [...activities.values()].map((item) => ({ ...item })),
        projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId });
    };
    const scheduleFlush = () => { if (!flushTimer) flushTimer = setTimeout(flush, 50); };
    const onMessage = (message: RpcMessage) => {
      const params = asRecord(message.params);
      if (params.threadId && params.threadId !== runtime!.threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId) return;
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        if (message.method === 'item/tool/requestUserInput' || message.method === 'tool/requestUserInput') {
          const parsed = codexUserInputSchema.safeParse(message.params);
          if (!parsed.success) {
            server.respond(message.id, { answers: {} });
            return;
          }
          const requestId = message.id;
          const questions: AskUserQuestion[] = parsed.data.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            options: question.options ?? [],
            multiSelect: false,
            isOther: question.isOther,
            isSecret: question.isSecret,
          }));
          const pending = interactions.requestAnswers({
            toolName: 'AskUserQuestion', input: params, toolUseId: parsed.data.itemId,
            signal: input.signal, questions,
          }).then((answers) => {
            server.respond(requestId, { answers: Object.fromEntries(parsed.data.questions.map(({ id }) => [
              id, { answers: [answers[id]] },
            ])) });
          }).catch(() => server.respond(requestId, { answers: {} })).finally(() => {
            pendingUserInputs.delete(pending);
            closeCompletedTurn();
          });
          pendingUserInputs.add(pending);
          return;
        }
        const response = message.method?.includes('requestApproval') ? { decision: 'decline' }
          : message.method === 'item/permissions/requestApproval' ? { permissions: [] }
          : { action: 'decline', content: null };
        server.respond(message.id, response);
        return;
      }
      const item = asRecord(params.item);
      const id = String(item.id ?? params.itemId ?? '');
      if (message.method === 'error') {
        turnError = String(asRecord(params.error).message ?? 'Codex turn failed');
      }
      if ((message.method === 'item/started' || message.method === 'item/completed') && item.type === 'collabToolCall' && id) {
        const now = new Date().toISOString();
        const prior = subagents.get(id);
        const status = message.method === 'item/started' || item.agentStatus === 'running'
          ? 'running' : item.status === 'failed' ? 'failed' : 'completed';
        const run: SubagentRun = {
          id: prior?.id ?? `codex-${id}`, taskId: String(item.newThreadId ?? item.receiverThreadId ?? id),
          agentId: String(item.newThreadId ?? item.receiverThreadId ?? id), agentType: 'codex',
          description: String(item.prompt ?? prior?.description ?? item.tool ?? 'Codex subagent'),
          prompt: String(item.prompt ?? prior?.prompt ?? ''), status,
          startedAt: prior?.startedAt ?? now, updatedAt: now,
          ...(status === 'completed' || status === 'failed' ? { endedAt: now } : {}),
          activities: prior?.activities ?? [],
        };
        subagents.set(id, run);
        queue.push({ type: 'subagent_snapshot', projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, run });
      }
      if (message.method === 'item/started' && item.type === 'agentMessage' && id) {
        activeTextId = id;
      } else if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
        const textId = id || activeTextId || `codex-text-${++textSequence}`;
        activeTextId = textId;
        const previous = activities.get(textId);
        activities.set(textId, { id: textId, kind: 'text', status: 'streaming',
          content: `${previous?.content ?? ''}${params.delta}` });
        scheduleFlush();
      } else if (message.method === 'item/reasoning/summaryTextDelta' && id && typeof params.delta === 'string') {
        const previous = activities.get(id);
        activities.set(id, { id, kind: 'thinking', status: 'streaming', content: `${previous?.content ?? ''}${params.delta}` });
        scheduleFlush();
      } else if (message.method === 'item/completed' && item.type === 'reasoning' && id) {
        const previous = activities.get(id);
        activities.set(id, { id, kind: 'thinking', status: 'complete', content: previous?.content ?? '' });
        scheduleFlush();
      } else if (message.method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') {
        const textId = activities.has(id) ? id : activeTextId && activities.has(activeTextId)
          ? activeTextId : id || `codex-text-${++textSequence}`;
        activities.set(textId, { id: textId, kind: 'text', status: 'complete', content: item.text });
        activeTextId = null;
        scheduleFlush();
      } else if ((message.method === 'item/started' || message.method === 'item/completed') && id) {
        if (item.type === 'mcpToolCall' || item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'collabToolCall') {
          activities.set(id, { id, kind: 'tool', toolName: String(item.tool ?? item.type),
            status: message.method === 'item/started' ? 'running' : item.status === 'failed' || item.status === 'declined' ? 'error' : 'complete',
            input: asRecord(item.arguments), outputSummary: codexToolSummary(item.error) || String(item.aggregatedOutput
              ?? asRecord(Array.isArray(item.result) ? item.result[0] : item.result).text ?? ''),
          });
          scheduleFlush();
        }
      } else if (message.method === 'turn/completed') {
        const turn = asRecord(params.turn);
        if (turnId && turn.id !== turnId) return;
        if (!turnId && typeof turn.id === 'string') turnId = turn.id;
        if (turn.status === 'completed') {
          for (const activity of activities.values()) {
            if (activity.status === 'streaming') activity.status = 'complete';
          }
        }
        flush();
        if (turn.status === 'completed') {
          queue.push({ type: 'turn_completed', content: combinedText(), activities: [...activities.values()], backendMessageId: turnId ?? undefined,
            projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, source: input.source });
          turnCompleted = true;
          closeCompletedTurn();
        } else {
          queue.fail(new AgentBackendError(String(asRecord(turn.error).message ?? turnError ?? `Codex turn ${turn.status}`), this.id,
            turn.status === 'interrupted' ? 'cancelled' : 'runtime'));
        }
      }
    };
    const onFailure = (error: Error) => queue.fail(new AgentBackendError(error.message, this.id, 'runtime'));
    server.on('message', onMessage);
    server.on('failure', onFailure);
    const onAbort = () => {
      if (turnId) void server.request('turn/interrupt', { threadId: runtime!.threadId, turnId }).catch(() => {});
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (!runtime.threadId) {
        const cwd = runtime.settings.executionMode === 'wsl'
          ? windowsPathToWsl(input.cwd, runtime.settings.wslDistribution) : input.cwd;
        const response = input.fork && input.runtime?.sessionId && input.resumeAt
          ? await server.request<{ thread: { id: string } }>('thread/fork', { threadId: input.runtime.sessionId, lastTurnId: input.resumeAt })
          : input.runtime?.sessionId
            ? await server.request<{ thread: { id: string } }>('thread/resume', { threadId: input.runtime.sessionId, cwd })
            : await server.request<{ thread: { id: string } }>('thread/start', {
              cwd, model: input.model ?? undefined, approvalPolicy: 'never', sandbox: 'read-only',
            });
        runtime.threadId = response.thread.id;
      }
      queue.push({ type: 'session', sessionId: runtime.threadId, model: input.model,
        projectId: input.projectId, branchId: input.conversationId });
      if (input.command === '/compact') {
        await server.request('thread/compact/start', { threadId: runtime.threadId });
        queue.push({ type: 'turn_completed', content: 'Codex context compaction started.', activities: [],
          projectId: input.projectId, branchId: input.conversationId, inputId: input.inputId, source: input.source });
        queue.close();
        for await (const event of queue) yield event;
        return;
      }
      const prompt = [input.prompt, input.dynamicSystemContext ? `\n<hexestra_dynamic_context>\n${input.dynamicSystemContext}\n</hexestra_dynamic_context>` : ''].join('');
      const items: Array<RecordValue> = [{ type: 'text', text: prompt }];
      const settings = runtime.settings;
      for (const attachment of input.attachments) {
        const runtimePath = settings.executionMode === 'wsl'
          ? windowsPathToWsl(attachment.path, settings.wslDistribution) : attachment.path;
        if (attachment.kind === 'image') {
          items.push({ type: 'localImage', path: runtimePath });
        } else if (attachment.kind === 'text' && attachment.content) {
          items.push({ type: 'text', text: `\nAttached ${attachment.name}:\n${attachment.content}` });
        } else if (attachment.kind === 'pdf') {
          items.push({ type: 'text', text: `\nAttached PDF ${attachment.name}:\n${await extractPdfText(attachment.path)}` });
        } else {
          items.push({ type: 'text', text: `\nAttached file: ${runtimePath}` });
        }
      }
      const response = await server.request<{ turn: { id: string } }>('turn/start', {
        threadId: runtime.threadId, input: items, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        model: input.model ?? undefined,
        effort: input.reasoningEffort ?? await this.defaultEffort(server, input.model),
      });
      turnId = response.turn.id;
      if (input.signal.aborted) onAbort();
      for await (const event of queue) yield event;
    } finally {
      input.signal.removeEventListener('abort', onAbort);
      server.off('message', onMessage);
      server.off('failure', onFailure);
      if (flushTimer) clearTimeout(flushTimer);
      bridge.unbind();
      this.activeTurnKeys.delete(key);
    }
  }

  private async createRuntime(input: AgentRunInput): Promise<Runtime> {
    const settings = agentSettingsService.getCodexSettings();
    const bridge = new CodexToolBridge(settings.executionMode === 'wsl');
    await bridge.start(input.tools);
    let server: CodexAppServer | null = null;
    try {
      const host = settings.executionMode === 'wsl' ? await wslHost(settings.wslDistribution) : '127.0.0.1';
      server = new CodexAppServer(settings, input.cwd, {
        'mcp_servers.hexestra.url': bridge.url(host),
        'mcp_servers.hexestra.bearer_token_env_var': 'HEXESTRA_MCP_TOKEN',
        'mcp_servers.hexestra.required': true,
        'mcp_servers.hexestra.default_tools_approval_mode': 'approve',
        developer_instructions: input.systemInstructions,
      }, { HEXESTRA_MCP_TOKEN: bridge.bearerToken });
      await server.start();
      const account = await server.request<{ account: unknown }>('account/read', { refreshToken: false });
      this.authenticated = Boolean(account.account);
      if (!this.authenticated) throw new AgentBackendError('Sign in to Codex before using this backend', this.id, 'authentication');
      return { server, bridge, threadId: null, cwd: input.cwd, fingerprint: this.fingerprint(), settings };
    } catch (error) {
      server?.close();
      await bridge.close();
      throw codexLaunchError(error, settings);
    }
  }
}

function codexToolSummary(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  const message = asRecord(error).message;
  return typeof message === 'string' ? message : JSON.stringify(error);
}

function omitNullConfigValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (item == null) return [];
    if (Array.isArray(item)) return [[key, item.filter((entry) => entry != null)]];
    if (typeof item === 'object') return [[key, omitNullConfigValues(item as Record<string, unknown>)]];
    return [[key, item]];
  }));
}

function codexLaunchError(error: unknown, settings: ReturnType<typeof agentSettingsService.getCodexSettings>): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!/\bENOENT\b/i.test(message)) return error instanceof Error ? error : new Error(message);
  if (settings.executionMode === 'wsl' && /wsl\.exe/i.test(message)) {
    return new AgentBackendError('WSL is unavailable. Install WSL or select Native under Settings → Connection → Codex.', 'codex', 'unavailable');
  }
  const location = settings.executionMode === 'wsl' ? `WSL distribution ${settings.wslDistribution}` : 'this computer';
  return new AgentBackendError(
    `Codex CLI executable "${settings.codexExecutable}" was not found in ${location}. Check the executable path under Settings → Connection → Codex, or install Codex CLI there and restart Hexestra. Run codex --version in the selected environment to verify the installation.`,
    'codex', 'unavailable',
  );
}

async function wslHost(distribution: string) {
  const { stdout } = await execFileAsync('wsl.exe', ['--distribution', distribution, '--exec', 'sh', '-lc',
    "ip route show default | awk '{print $3; exit}'"], { timeout: 10_000, windowsHide: true });
  const host = stdout.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) throw new Error('Could not resolve Windows host from WSL');
  return host;
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

async function extractPdfText(filePath: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)), disableWorker: true, useWorkerFetch: false } as never);
  const document = await task.promise;
  const parts: string[] = [];
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      parts.push(`Page ${index}: ${content.items.map((item) => 'str' in item ? item.str : '').join(' ')}`);
      if (Buffer.byteLength(parts.join('\n'), 'utf8') > 2 * 1024 * 1024) {
        throw new Error('Codex PDF attachment exceeds the 2 MB extracted text limit');
      }
    }
  } finally { await document.destroy(); }
  return parts.join('\n');
}

class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  private error: Error | null = null;
  push(item: T) { if (this.done) return; this.items.push(item); this.wake?.(); }
  close() { this.done = true; this.wake?.(); }
  fail(error: Error) { this.error = error; this.close(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.items.length) { yield this.items.shift()!; continue; }
      if (this.done) { if (this.error) throw this.error; return; }
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

class CodexConversationHandle implements AgentConversationHandle {
  private readonly eventQueue = new EventQueue<AgentRunEvent>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingInputs = 0;
  private active = false;
  private disposed = false;
  private currentController: AbortController | null = null;
  private chain = Promise.resolve();

  constructor(private readonly adapter: CodexAgentAdapter, private readonly base: AgentRunInput,
    private readonly interactions: AgentInteractionHandler) {}

  events() { return this.eventQueue; }

  snapshot() {
    return { projectId: this.base.projectId, branchId: this.base.conversationId,
      active: this.active, pendingInputs: this.pendingInputs, pendingCrons: this.timers.size, interactionPending: false };
  }

  private emitState() {
    this.eventQueue.push({ type: 'runtime_state', projectId: this.base.projectId,
      branchId: this.base.conversationId, snapshot: this.snapshot() });
  }

  scheduleWakeup(delayMs: number, prompt: string) {
    if (this.disposed) throw new Error('Codex conversation was closed');
    const id = `codex-wakeup-${randomUUID()}`;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.enqueue({ id, source: 'scheduled', prompt, queuedAt: new Date().toISOString(),
        input: { ...this.base, prompt, inputId: id, source: 'scheduled', fork: false, resumeAt: undefined } });
    }, delayMs);
    this.timers.set(id, timer);
    this.emitState();
    return id;
  }

  async enqueue(queued: AgentQueuedInput) {
    if (this.disposed) throw new Error('Codex conversation was closed');
    this.pendingInputs += 1;
    this.emitState();
    this.chain = this.chain.catch(() => {}).then(async () => {
      while (!this.disposed && this.adapter.isBusy(this.base.projectId, this.base.conversationId)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (this.disposed) return;
      this.pendingInputs -= 1;
      this.active = true;
      this.currentController = new AbortController();
      this.emitState();
      const startedAt = new Date().toISOString();
      this.eventQueue.push({ type: 'input_started', projectId: this.base.projectId, branchId: this.base.conversationId,
        inputId: queued.id, source: queued.source, prompt: queued.prompt, queuedAt: queued.queuedAt, startedAt });
      this.eventQueue.push({ type: 'turn_started', projectId: this.base.projectId, branchId: this.base.conversationId,
        inputId: queued.id, source: queued.source, startedAt });
      try {
        const dynamicSystemContext = queued.source === 'scheduled'
          ? await queued.input.dynamicSystemContextProvider?.() : queued.input.dynamicSystemContext;
        for await (const event of this.adapter.runTurn({ ...queued.input, prompt: queued.prompt,
          inputId: queued.id, source: queued.source, signal: this.currentController.signal,
          dynamicSystemContext }, queued.interactions ?? this.interactions)) this.eventQueue.push(event);
      } catch (error) {
        this.eventQueue.push({ type: 'turn_completed', projectId: this.base.projectId, branchId: this.base.conversationId,
          inputId: queued.id, source: queued.source, content: `Codex turn failed: ${error instanceof Error ? error.message : String(error)}`,
          status: this.currentController.signal.aborted ? 'interrupted' : 'error', activities: [] });
      } finally {
        this.active = false;
        this.currentController = null;
        this.emitState();
      }
    });
  }

  async interrupt() {
    this.currentController?.abort();
    return { stillQueued: [] };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.currentController?.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.eventQueue.close();
    this.adapter.removeHandle(this.base.projectId, this.base.conversationId, this);
  }
}
