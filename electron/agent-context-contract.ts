export const MAX_AGENT_CONTEXT_REFS = 8;
export const MAX_BROWSER_CONTEXT_TEXT = 12_000;

export interface BrowserPageAgentContextRef {
  kind: 'browser-page';
  projectId: string;
  tabId: string;
  url: string;
  title: string;
  selectionText?: string;
  linkUrl?: string;
  linkText?: string;
}

export interface TrafficFlowAgentContextRef {
  kind: 'traffic-flow';
  projectId: string;
  flowId: string;
  method: string;
  url: string;
  host?: string;
  preview?: string;
  statusCode?: number;
  state: string;
  scopeState: 'in_scope' | 'out_of_scope';
}

export interface ShellCommandAgentContextRef {
  kind: 'shell-command';
  projectId: string;
  listenerId: string;
  templateId: string;
  templateLabel: string;
  callbackAddress: string;
  callbackPort: number;
  command: string;
  localOnly: boolean;
  obfuscation?: string;
}

export type AgentContextRef = BrowserPageAgentContextRef | TrafficFlowAgentContextRef | ShellCommandAgentContextRef;

export function agentContextRefKey(ref: AgentContextRef) {
  if (ref.kind === 'traffic-flow') return `traffic:${ref.projectId}:${ref.flowId}`;
  if (ref.kind === 'shell-command') {
    return `shell-command:${ref.projectId}:${ref.listenerId}:${ref.templateId}:${ref.callbackAddress}:${ref.callbackPort}`;
  }
  const detail = ref.selectionText ? 'selection' : ref.linkUrl ? `link:${ref.linkUrl}` : 'page';
  return `browser:${ref.projectId}:${ref.tabId}:${detail}`;
}

export function normalizeAgentContextRefs(value: unknown, expectedProjectId?: string): AgentContextRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AgentContextRef[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const ref = normalizeAgentContextRef(candidate, expectedProjectId);
    if (!ref) continue;
    const key = agentContextRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length >= MAX_AGENT_CONTEXT_REFS) break;
  }
  return refs;
}

function normalizeAgentContextRef(value: unknown, expectedProjectId?: string): AgentContextRef | null {
  if (!isRecord(value) || !isIdentifier(value.projectId)) return null;
  if (expectedProjectId && value.projectId !== expectedProjectId) return null;
  if (value.kind === 'shell-command') {
    if (!isIdentifier(value.listenerId) || typeof value.templateId !== 'string'
      || typeof value.templateLabel !== 'string' || typeof value.callbackAddress !== 'string'
      || typeof value.command !== 'string' || typeof value.localOnly !== 'boolean'
      || typeof value.callbackPort !== 'number' || !Number.isInteger(value.callbackPort)
      || value.callbackPort < 1 || value.callbackPort > 65_535) return null;
    if (!value.callbackAddress.includes('.') || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.callbackAddress)) return null;
    return {
      kind: 'shell-command', projectId: value.projectId, listenerId: value.listenerId,
      templateId: value.templateId.slice(0, 100), templateLabel: value.templateLabel.slice(0, 200),
      callbackAddress: value.callbackAddress.slice(0, 100), callbackPort: value.callbackPort,
      command: value.command.slice(0, 8_192), localOnly: Boolean(value.localOnly),
      obfuscation: typeof value.obfuscation === 'string' ? value.obfuscation.slice(0, 32) : undefined,
    };
  }
  if (value.kind === 'traffic-flow') {
    if (!isIdentifier(value.flowId) || typeof value.method !== 'string' || typeof value.url !== 'string') return null;
    if (value.scopeState !== 'in_scope' && value.scopeState !== 'out_of_scope') return null;
    return {
      kind: 'traffic-flow', projectId: value.projectId, flowId: value.flowId,
      method: value.method.slice(0, 32), url: value.url.slice(0, 8_192),
      host: optionalString(value.host)?.slice(0, 500),
      preview: optionalString(value.preview)?.slice(0, 2_000),
      statusCode: typeof value.statusCode === 'number' && Number.isInteger(value.statusCode) ? value.statusCode : undefined,
      state: typeof value.state === 'string' ? value.state.slice(0, 64) : 'unknown',
      scopeState: value.scopeState,
    };
  }
  if (value.kind === 'browser-page' && isIdentifier(value.tabId)
    && typeof value.url === 'string' && typeof value.title === 'string') {
    return {
      kind: 'browser-page', projectId: value.projectId, tabId: value.tabId,
      url: value.url.slice(0, 8_192), title: value.title.slice(0, 500),
      selectionText: optionalString(value.selectionText)?.slice(0, MAX_BROWSER_CONTEXT_TEXT),
      linkUrl: optionalString(value.linkUrl)?.slice(0, 8_192),
      linkText: optionalString(value.linkText)?.slice(0, 2_000),
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
