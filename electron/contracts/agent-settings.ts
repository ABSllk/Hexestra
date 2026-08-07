export type AgentExecutionMode = 'native' | 'wsl';
export type ClaudeSettingSource = 'user' | 'project' | 'local';

/** Claude-specific connection settings retained for the Claude settings UI. */
export interface AgentConnectionSettings {
  version: 1;
  executionMode: AgentExecutionMode;
  wslDistribution: string;
  claudeExecutable: string;
  model: string | null;
  settingSources: ClaudeSettingSource[];
}

export type AgentConnectionSettingsInput = Partial<Omit<AgentConnectionSettings, 'version'>>;

export interface AgentSettingsContainer {
  version: 2;
  defaultBackendId: 'claude';
  backends: {
    claude: AgentConnectionSettings;
  };
}

export type AgentSettingsContainerInput = {
  defaultBackendId?: 'claude';
  backends?: {
    claude?: AgentConnectionSettingsInput | AgentConnectionSettings;
  };
} & AgentConnectionSettingsInput;

export interface AgentDiagnosticCheck {
  id: 'runtime' | 'claude' | 'authentication' | 'network';
  label: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
}

export interface AgentConnectionDiagnostic {
  ok: boolean;
  checkedAt: string;
  executionMode: AgentExecutionMode;
  claudeVersion: string | null;
  authenticated: boolean | null;
  authMethod: string | null;
  checks: AgentDiagnosticCheck[];
}
