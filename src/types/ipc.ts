/**
 * IPC channel names — single source of truth for main-renderer communication.
 * All channels are prefixed to avoid collisions.
 */

export const IPC = {
  // Application
  APP_GET_CAPABILITIES: 'app:getCapabilities',
  // Folder projects
  PROJECT_OPEN_FOLDER: 'project:open-folder',
  PROJECT_CREATE_FOLDER: 'project:create-folder',
  PROJECT_LIST_RECENT: 'project:list-recent',
  PROJECT_OPEN_RECENT: 'project:open-recent',
  PROJECT_REMOVE_RECENT: 'project:remove-recent',
  PROJECT_STATE: 'project:state',
  PROJECT_UPDATE: 'project:update',
  SCOPE_UPDATE: 'scope:update',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_SET_CONTEXT: 'terminal:set-context',
  CLIPBOARD_READ_TEXT: 'clipboard:read-text',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  // AI Agent
  AGENT_SEND: 'agent:send',
  AGENT_ACTIVATE: 'agent:activate',
  AGENT_NEW_CONVERSATION: 'agent:conversation:new',
  AGENT_MESSAGE: 'agent:message',
  AGENT_STATUS: 'agent:status',
  AGENT_TOOL_REQUEST: 'agent:tool-request',
  AGENT_APPROVE_TOOL: 'agent:approve-tool',
  AGENT_REJECT_TOOL: 'agent:reject-tool',
  AGENT_SET_AUTONOMY: 'agent:set-autonomy',
  AGENT_SETTINGS_GET: 'agent:settings:get',
  AGENT_SETTINGS_UPDATE: 'agent:settings:update',
  AGENT_SETTINGS_RESET: 'agent:settings:reset',
  AGENT_SETTINGS_TEST: 'agent:settings:test',
  CLAUDE_SKILLS_LIST: 'claude:skills:list',
  CLAUDE_SKILLS_READ: 'claude:skills:read',
  CLAUDE_SKILLS_SAVE: 'claude:skills:save',
  CLAUDE_SKILLS_TOGGLE: 'claude:skills:toggle',
  CLAUDE_SKILLS_DELETE: 'claude:skills:delete',
  CLAUDE_MCP_LIST: 'claude:mcp:list',
  CLAUDE_MCP_SAVE: 'claude:mcp:save',
  CLAUDE_MCP_DELETE: 'claude:mcp:delete',

  // Tools
  TOOL_RUN: 'tool:run',
  TOOL_OUTPUT: 'tool:output',
  TOOL_COMPLETE: 'tool:complete',
  TOOL_ERROR: 'tool:error',
  TOOL_CANCEL: 'tool:cancel',

  // NetMap
  NETMAP_GET: 'netmap:get',
  NETMAP_LAYOUT_GET: 'netmap:layout:get',
  NETMAP_LAYOUT_UPDATE: 'netmap:layout:update',
  NETMAP_SELECT_NODE: 'netmap:select-node',

  // Targets
  TARGET_GET: 'target:get',
  TARGET_LIST: 'target:list',
  TARGET_UPDATE: 'target:update',

  // Findings
  FINDINGS_LIST: 'findings:list',
  FINDINGS_UPSERT: 'findings:upsert',
  VULNERABILITIES_LIST: 'vulnerabilities:list',
  VULNERABILITIES_UPSERT: 'vulnerabilities:upsert',
  EVIDENCE_LIST: 'evidence:list',
  EVIDENCE_UPSERT: 'evidence:upsert',
  REPORTS_LIST: 'reports:list',
  REPORTS_UPSERT: 'reports:upsert',
  ASM_SCAN_RUNS: 'asm:scan-runs',
  ASM_CHANGES: 'asm:changes',

  // Browser
  BROWSER_ENSURE: 'browser:ensure',
  BROWSER_SET_LAYOUT: 'browser:set-layout',
  BROWSER_RECONCILE: 'browser:reconcile',
  BROWSER_DESTROY: 'browser:destroy',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_FOCUS: 'browser:focus',
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_READ: 'browser:read',
  BROWSER_STATE_CHANGED: 'browser:state-changed',
  BROWSER_CONTEXT_ACTION: 'browser:context-action',
  BROWSER_OPEN_TAB: 'browser:open-tab',
  BROWSER_SCREENSHOT: 'browser:screenshot',

  // Traffic proxy
  TRAFFIC_PROFILE_GET: 'traffic:profile:get',
  TRAFFIC_PROFILE_UPDATE: 'traffic:profile:update',
  TRAFFIC_LIST: 'traffic:list',
  TRAFFIC_READ: 'traffic:read',
  TRAFFIC_DELETE: 'traffic:delete',
  TRAFFIC_CLEAR: 'traffic:clear',
  TRAFFIC_DECIDE: 'traffic:decide',
  TRAFFIC_REPLAY: 'traffic:replay',
  TRAFFIC_REPLAY_SESSION_OPEN: 'traffic:replay-session:open',
  TRAFFIC_REPLAY_SESSION_READ: 'traffic:replay-session:read',
  TRAFFIC_REPLAY_SESSION_UPDATE: 'traffic:replay-session:update',
  TRAFFIC_REPLAY_SESSION_CLEAR: 'traffic:replay-session:clear',
  TRAFFIC_SAVE_EVIDENCE: 'traffic:save-evidence',
  TRAFFIC_START: 'traffic:start',
  TRAFFIC_STOP: 'traffic:stop',
  TRAFFIC_BURP_CONNECT: 'traffic:burp:connect',
  TRAFFIC_BURP_DISCONNECT: 'traffic:burp:disconnect',
  TRAFFIC_BURP_CALL: 'traffic:burp:call',
  TRAFFIC_RUNTIME_GET: 'traffic:runtime:get',
  TRAFFIC_RUNTIME_DETECT: 'traffic:runtime:detect',
  TRAFFIC_RUNTIME_UPDATE: 'traffic:runtime:update',
  TRAFFIC_RUNTIME_CHOOSE: 'traffic:runtime:choose',
  TRAFFIC_CHANGED: 'traffic:changed',

  // Files
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST: 'file:list',
} as const;
