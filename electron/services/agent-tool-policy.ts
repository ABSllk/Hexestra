import crypto from 'crypto';

const READ_ONLY_HEXESTRA_TOOLS = new Set([
  'browser_read',
  'browser_tabs',
  'browser_screenshot',
  'browser_cookies',
  'browser_storage',
  'target_list',
  'asset_get',
  'finding_list',
  'vulnerability_list',
  'evidence_list',
  'report_list',
  'attack_catalog_list',
  'attack_catalog_search',
  'task_list',
  'traffic_list',
  'traffic_search',
  'traffic_read',
  'traffic_capture_status',
  'burp_capabilities',
  'burp_scanner_issues',
  'shell_profiles',
  'shell_sessions',
  'shell_read',
  'shell_audit_list',
  'shell_file_list',
  'shell_file_read',
  'shell_file_delete_preview',
  'shell_profile_status',
  'proxy_status',
  'proxy_nodes_list',
  'proxy_chains_list',
]);

const SUBAGENT_SPAWN_TOOLS = new Set(['Agent', 'Task']);
const NATIVE_TASK_PLANNING_TOOLS = new Set([
  'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TodoWrite',
  'EnterPlanMode', 'ExitPlanMode', 'ProposeSkills',
]);
const NATIVE_READ_ONLY_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead',
  'CronList', 'TaskOutput', 'ListMcpResources', 'ReadMcpResourceDir',
  'ReadMcpResource',
]);
const NATIVE_TASK_GATE_CONTROL_TOOLS = new Set(['TaskStop', 'CronDelete', 'RefreshMcpTools']);
const HEXESTRA_MCP_PREFIX = 'mcp__hexestra__';

export function isSubagentSpawnTool(toolName: string) {
  return SUBAGENT_SPAWN_TOOLS.has(toolName);
}

export function normalizeAgentToolName(toolName: string) {
  return toolName.replace(/^mcp__.+?__/, '');
}

export function normalizeHexestraToolName(toolName: string) {
  return toolName.startsWith(HEXESTRA_MCP_PREFIX)
    ? toolName.slice(HEXESTRA_MCP_PREFIX.length)
    : toolName;
}

export function isReadOnlyHexestraTool(toolName: string) {
  const localName = normalizeHexestraToolName(toolName);
  if (localName === toolName && toolName.startsWith('mcp__')) return false;
  return READ_ONLY_HEXESTRA_TOOLS.has(localName);
}

export function isNativeReadOnlyTool(toolName: string) {
  return NATIVE_READ_ONLY_TOOLS.has(toolName);
}

export function isTaskGuardedTool(toolName: string, riskLevel?: string) {
  const localName = normalizeHexestraToolName(toolName);
  // A third-party MCP server cannot inherit Hexestra exemptions by choosing a
  // colliding local tool name. Its provenance is part of the trust boundary.
  if (localName === toolName && toolName.startsWith('mcp__')) return true;
  // Read-only tools (recon, catalog lookup, and reading pages/scrollback) do
  // not mutate state, so they must not require a focused Task.
  if (isReadOnlyHexestraTool(localName)) return false;
  // Planning and managed-record tools have their own validation contracts.
  if (isNativeReadOnlyTool(localName)) return false;
  if (NATIVE_TASK_PLANNING_TOOLS.has(localName)) return false;
  if (NATIVE_TASK_GATE_CONTROL_TOOLS.has(localName)) return false;
  if (/^(task_|restriction_|tool_catalog_|attack_catalog_)/.test(localName)) return false;
  if (/^(target_|asset_|finding_|vulnerability_|evidence_|report_|scope_)/.test(localName)) return false;
  if (/^(Bash|browser|shell|traffic|egress-proxy|subagent|Task$|Agent)/.test(localName)) return true;
  // Unknown MCP tools must remain behind the execution gate. This keeps the
  // policy fail-closed while still allowing the explicit planning/read-only
  // exceptions above.
  if (localName !== toolName) return true;
  return riskLevel === 'write';
}

const WRITE_ONLY_PROXY_NODE_TOOLS = new Set([
  'proxy_node_import',
  'proxy_nodes_import',
  'proxy_node_update',
]);

const PROXY_NODE_INPUT_SOURCES = new Set(['uri', 'form', 'yaml']);

export function sanitizeAgentToolInputForDisplay(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const localName = normalizeAgentToolName(toolName);
  if (localName === 'shell_file_write' && typeof input.content === 'string') {
    const encoding = input.encoding === 'base64' ? 'base64' : 'utf8';
    const content = Buffer.from(input.content, encoding);
    return {
      ...input,
      content: `[${content.byteLength} bytes; sha256:${crypto.createHash('sha256').update(content).digest('hex')}]`,
    };
  }
  const looksLikeProxyNodeInput = PROXY_NODE_INPUT_SOURCES.has(String(input.source))
    && Object.prototype.hasOwnProperty.call(input, 'value');
  if (!WRITE_ONLY_PROXY_NODE_TOOLS.has(localName) && !looksLikeProxyNodeInput) return input;

  return {
    ...(typeof input.nodeId === 'string' ? { nodeId: input.nodeId } : {}),
    ...(typeof input.source === 'string' ? { source: input.source } : {}),
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'value') ? { value: '[REDACTED]' } : {}),
  };
}

export function sanitizeAgentToolOutputForDisplay(toolName: string, output: string) {
  const localName = normalizeAgentToolName(toolName);
  if (localName !== 'shell_file_read' && localName !== 'shell_file_write') return output;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (typeof parsed.content !== 'string') return output;
    const encoding = parsed.encoding === 'base64' ? 'base64' : 'utf8';
    const content = Buffer.from(parsed.content, encoding);
    return JSON.stringify({
      ...parsed,
      content: `[${content.byteLength} bytes; sha256:${crypto.createHash('sha256').update(content).digest('hex')}]`,
    });
  } catch {
    return output;
  }
}

const DIRECT_FILE_MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MANAGED_RECORD_DIRECTORIES = new Set(['findings', 'vulnerabilities', 'evidence', 'reports']);

export function isManagedRecordFileMutation(toolName: string, input: Record<string, unknown>) {
  if (!DIRECT_FILE_MUTATION_TOOLS.has(toolName)) return false;
  const candidate = [input.file_path, input.path, input.notebook_path]
    .find((value): value is string => typeof value === 'string');
  if (!candidate) return false;
  const segments = candidate.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  return segments.some((segment) => MANAGED_RECORD_DIRECTORIES.has(segment));
}
