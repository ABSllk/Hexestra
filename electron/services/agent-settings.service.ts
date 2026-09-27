import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
  AgentConnectionSettings,
  AgentConnectionSettingsInput,
  AgentSettingsContainer,
  AgentSettingsContainerInput,
  ClaudeSettingSource,
  CodexConnectionSettings,
} from '../contracts/agent-settings';
import { diagnoseAgentConnection } from './wsl-agent-runtime';

const SETTING_SOURCES: ClaudeSettingSource[] = ['user', 'project', 'local'];
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

function reasoningEffort(value: unknown) {
  return typeof value === 'string' && REASONING_EFFORTS.some((effort) => effort === value)
    ? value as typeof REASONING_EFFORTS[number] : null;
}

export function createDefaultAgentSettings(platform = process.platform): AgentConnectionSettings {
  return {
    version: 1,
    executionMode: platform === 'win32' ? 'wsl' : 'native',
    wslDistribution: 'Ubuntu-24.04',
    claudeExecutable: platform === 'win32' ? '/usr/bin/claude' : '',
    model: null,
    reasoningEffort: null,
    settingSources: [...SETTING_SOURCES],
  };
}

export function createDefaultAgentSettingsContainer(platform = process.platform): AgentSettingsContainer {
  return {
    version: 2,
    defaultBackendId: 'claude',
    backends: { claude: createDefaultAgentSettings(platform), codex: createDefaultCodexSettings(platform) },
  };
}

export function createDefaultCodexSettings(platform = process.platform): CodexConnectionSettings {
  return { version: 1, executionMode: 'native',
    wslDistribution: 'Ubuntu-24.04', codexExecutable: 'codex', model: null, reasoningEffort: null };
}

export function normalizeCodexSettings(value: unknown, platform = process.platform): CodexConnectionSettings {
  const defaults = createDefaultCodexSettings(platform);
  if (!isRecord(value)) return defaults;
  return {
    version: 1,
    executionMode: value.executionMode === 'native' || (platform === 'win32' && value.executionMode === 'wsl')
      ? value.executionMode : defaults.executionMode,
    wslDistribution: boundedString(value.wslDistribution, 100) ?? defaults.wslDistribution,
    codexExecutable: boundedString(value.codexExecutable, 1_000) ?? defaults.codexExecutable,
    model: boundedString(value.model, 200),
    reasoningEffort: reasoningEffort(value.reasoningEffort),
  };
}

export function normalizeAgentSettings(
  value: unknown,
  platform = process.platform,
): AgentConnectionSettings {
  const defaults = createDefaultAgentSettings(platform);
  if (!isRecord(value)) return defaults;
  const executionMode = value.executionMode === 'native' || (platform === 'win32' && value.executionMode === 'wsl')
    ? value.executionMode
    : defaults.executionMode;
  const rawSources = Array.isArray(value.settingSources) ? value.settingSources : null;
  const settingSources = rawSources
    ? SETTING_SOURCES.filter((source) => rawSources.includes(source))
    : defaults.settingSources;
  const executable = boundedString(value.claudeExecutable, 1_000)
    ?? (executionMode === 'wsl' ? '/usr/bin/claude' : '');
  return {
    version: 1,
    executionMode,
    wslDistribution: boundedString(value.wslDistribution, 100) ?? defaults.wslDistribution,
    claudeExecutable: executionMode === 'wsl' && !executable ? '/usr/bin/claude' : executable,
    model: boundedString(value.model, 200),
    reasoningEffort: ['none', 'minimal', 'ultra'].includes(value.reasoningEffort as string)
      ? null : reasoningEffort(value.reasoningEffort),
    settingSources: settingSources.length ? settingSources : [...defaults.settingSources],
  };
}

export function normalizeAgentSettingsContainer(
  value: unknown,
  platform = process.platform,
): AgentSettingsContainer {
  const defaults = createDefaultAgentSettingsContainer(platform);
  if (!isRecord(value)) return defaults;
  const rawClaude = isRecord(value.backends) && isRecord(value.backends.claude)
    ? value.backends.claude
    : value;
  return {
    version: 2,
    defaultBackendId: value.defaultBackendId === 'codex' ? 'codex' : 'claude',
    backends: {
      claude: normalizeAgentSettings(rawClaude, platform),
      codex: normalizeCodexSettings(isRecord(value.backends) ? value.backends.codex : undefined, platform),
    },
  };
}

export function agentConnectionFingerprint(settings: AgentConnectionSettings) {
  return settings.executionMode === 'wsl'
    ? `wsl:${settings.wslDistribution}:${settings.claudeExecutable}`
    : `native:${settings.claudeExecutable || 'auto'}`;
}

export class AgentSettingsService {
  private settings: AgentSettingsContainer | null = null;
  private runtimeGuard: () => boolean = () => false;

  constructor(private readonly explicitFilePath?: string, registerIpc = true) {
    if (registerIpc) this.registerHandlers();
  }

  setRuntimeGuard(guard: () => boolean) {
    this.runtimeGuard = guard;
  }

  getSettings() {
    if (this.settings) return cloneSettings(this.settings);
    try {
      const file = this.filePath();
      this.settings = fs.existsSync(file)
        ? normalizeAgentSettingsContainer(JSON.parse(fs.readFileSync(file, 'utf8')))
        : createDefaultAgentSettingsContainer();
    } catch (error) {
      console.warn('[Agent Settings] Falling back to defaults:', error);
      this.settings = createDefaultAgentSettingsContainer();
    }
    return cloneSettings(this.settings);
  }

  getClaudeSettings() {
    return cloneClaudeSettings(this.getSettings().backends.claude);
  }

  getCodexSettings() {
    return { ...this.getSettings().backends.codex };
  }

  updateSettings(input: AgentSettingsContainerInput | unknown) {
    if (this.runtimeGuard()) throw new Error('Stop the active Agent request before changing Agent settings');
    const settings = normalizeAgentSettingsContainer(input);
    this.persist(settings);
    this.settings = settings;
    return cloneSettings(settings);
  }

  resetSettings() {
    return this.updateSettings(createDefaultAgentSettingsContainer());
  }

  private registerHandlers() {
    ipcMain.handle('agent:settings:get', () => this.getSettings());
    ipcMain.handle('agent:settings:update', (_event, input: unknown) => this.updateSettings(input));
    ipcMain.handle('agent:settings:reset', () => this.resetSettings());
    ipcMain.handle('agent:settings:test', (_event, input?: unknown) => {
      const settings = input === undefined
        ? this.getClaudeSettings()
        : normalizeAgentSettingsContainer(input).backends.claude;
      return diagnoseAgentConnection(settings);
    });
  }

  private persist(settings: AgentSettingsContainer) {
    const file = this.filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  }

  private filePath() {
    const userDataPath = process.env.HEXESTRA_USER_DATA || app.getPath('userData');
    return this.explicitFilePath ?? path.join(userDataPath, 'agent-settings.json');
  }
}

function cloneSettings(settings: AgentSettingsContainer): AgentSettingsContainer {
  return {
    ...settings,
    backends: { claude: cloneClaudeSettings(settings.backends.claude), codex: { ...settings.backends.codex } },
  };
}

function cloneClaudeSettings(settings: AgentConnectionSettings): AgentConnectionSettings {
  return { ...settings, settingSources: [...settings.settingSources] };
}

function boundedString(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, max);
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const agentSettingsService = new AgentSettingsService();
