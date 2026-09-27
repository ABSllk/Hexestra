export type AgentExecutionMode = 'native' | 'wsl';
export type ClaudeSettingSource = 'user' | 'project' | 'local';
export type ClaudeRuntimeSource = 'explicit' | 'login-shell' | 'process-path' | 'standard-location' | 'wsl' | 'none';
import type { AgentReasoningEffort } from './agent-runtime';

/** Claude-specific connection settings retained for the Claude settings UI. */
export interface AgentConnectionSettings {
  version: 1;
  executionMode: AgentExecutionMode;
  wslDistribution: string;
  claudeExecutable: string;
  model: string | null;
  reasoningEffort?: AgentReasoningEffort | null;
  settingSources: ClaudeSettingSource[];
}

export interface CodexConnectionSettings {
  version: 1;
  executionMode: AgentExecutionMode;
  wslDistribution: string;
  codexExecutable: string;
  model: string | null;
  reasoningEffort?: AgentReasoningEffort | null;
}

export type AgentConnectionSettingsInput = Partial<Omit<AgentConnectionSettings, 'version'>>;

export interface AgentSettingsContainer {
  version: 2;
  defaultBackendId: 'claude' | 'codex';
  backends: {
    claude: AgentConnectionSettings;
    codex: CodexConnectionSettings;
  };
}

export type AgentSettingsContainerInput = {
  defaultBackendId?: 'claude' | 'codex';
  backends?: {
    claude?: AgentConnectionSettingsInput | AgentConnectionSettings;
    codex?: Partial<CodexConnectionSettings>;
  };
} & AgentConnectionSettingsInput;

export interface AgentDiagnosticCheck {
  id: 'runtime' | 'claude' | 'authentication' | 'network';
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'skipped';
  detail: string;
}

export interface AgentConnectionDiagnostic {
  ok: boolean;
  checkedAt: string;
  executionMode: AgentExecutionMode;
  claudeVersion: string | null;
  executablePath: string | null;
  executableSource: ClaudeRuntimeSource;
  installGuidance: string | null;
  authenticated: boolean | null;
  authMethod: string | null;
  checks: AgentDiagnosticCheck[];
}
