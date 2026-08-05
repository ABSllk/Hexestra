const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'LS',
  'mcp__hexestra__browser_read',
  'mcp__hexestra__browser_tabs',
  'mcp__hexestra__browser_screenshot',
  'mcp__hexestra__browser_cookies',
  'mcp__hexestra__browser_storage',
  'mcp__hexestra__target_list',
  'mcp__hexestra__finding_list',
  'mcp__hexestra__vulnerability_list',
  'mcp__hexestra__evidence_list',
  'mcp__hexestra__report_list',
  'mcp__hexestra__task_list',
  'mcp__hexestra__traffic_list',
  'mcp__hexestra__traffic_search',
  'mcp__hexestra__traffic_read',
  'mcp__hexestra__traffic_capture_status',
  'mcp__hexestra__burp_capabilities',
  'mcp__hexestra__burp_scanner_issues',
  'mcp__hexestra__shell_profiles',
  'mcp__hexestra__shell_sessions',
  'mcp__hexestra__shell_read',
  'mcp__hexestra__shell_audit_list',
]);

export function isReadOnlyAgentTool(toolName: string) {
  return READ_ONLY_TOOLS.has(toolName);
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
