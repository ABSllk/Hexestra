const READ_ONLY_HEXESTRA_TOOLS = new Set([
  'browser_read',
  'browser_tabs',
  'browser_screenshot',
  'browser_cookies',
  'browser_storage',
  'target_list',
  'finding_list',
  'vulnerability_list',
  'evidence_list',
  'report_list',
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
  'shell_profile_status',
  'proxy_status',
  'proxy_nodes_list',
  'proxy_chains_list',
]);

const SUBAGENT_SPAWN_TOOLS = new Set(['Agent', 'Task']);

export function isSubagentSpawnTool(toolName: string) {
  return SUBAGENT_SPAWN_TOOLS.has(toolName);
}

export function isReadOnlyHexestraTool(toolName: string) {
  return READ_ONLY_HEXESTRA_TOOLS.has(toolName);
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
  const localName = toolName.replace(/^mcp__[^_]+__/, '');
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
