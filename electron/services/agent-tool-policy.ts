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
]);

const SUBAGENT_SPAWN_TOOLS = new Set(['Agent', 'Task']);

export function isSubagentSpawnTool(toolName: string) {
  return SUBAGENT_SPAWN_TOOLS.has(toolName);
}

export function isReadOnlyHexestraTool(toolName: string) {
  return READ_ONLY_HEXESTRA_TOOLS.has(toolName);
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
