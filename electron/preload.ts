import { contextBridge, ipcRenderer } from 'electron';

export interface HexestraAPI {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  once: (channel: string, callback: (...args: unknown[]) => void) => void;
  send: (channel: string, ...args: unknown[]) => void;
}

const INVOKE_CHANNELS = new Set([
  'app:ping', 'app:getVersion', 'app:getPlatform', 'app:getCapabilities',
  'app:window:minimize', 'app:window:toggle-maximize', 'app:window:is-maximized', 'app:window:close',
  'app:settings:get', 'app:settings:update', 'dialog:confirm', 'dialog:respond',
  'project:open-folder', 'project:create-folder', 'project:list-recent',
  'project:open-recent', 'project:remove-recent',
  'project:state', 'project:update',
  'targets:list', 'targets:get', 'targets:add', 'targets:update',
  'tasks:list', 'tasks:update', 'tasks:upsert',
  'asm:scan-runs', 'asm:changes', 'findings:list', 'findings:upsert',
  'vulnerabilities:list', 'vulnerabilities:upsert',
  'evidence:list', 'evidence:upsert', 'reports:list', 'reports:upsert', 'scope:update',
  'records:delete', 'records:export',
  'files:list', 'files:read', 'files:write',
  'terminal:create', 'terminal:write', 'terminal:resize', 'terminal:close', 'terminal:list', 'terminal:info', 'terminal:set-context',
  'shell:profile:list', 'shell:profile:save', 'shell:profile:delete',
  'shell:credential:save', 'shell:credential:delete', 'shell:credential:status', 'shell:interfaces',
  'shell:session:connect', 'shell:session:attach', 'shell:session:list', 'shell:session:read',
  'shell:session:write', 'shell:session:resize', 'shell:session:interrupt', 'shell:session:takeover', 'shell:session:disconnect',
  'shell:listener:list', 'shell:listener:save', 'shell:listener:delete', 'shell:listener:start', 'shell:listener:stop',
  'shell:connect-template:list', 'shell:connect-command:build', 'shell:public-ip:detect',
  'shell:reverse:bind', 'shell:reverse:reject',
  'shell:audit:list', 'shell:audit:read', 'shell:audit:delete', 'shell:save-evidence',
  'netmap:get', 'netmap:layout:get', 'netmap:layout:update',
  'tools:inventory', 'tools:run', 'tools:kill', 'tools:status', 'tools:runs',
  'agent:activate', 'agent:send', 'agent:branch', 'agent:branch:activate', 'agent:conversation:new',
  'agent:attachments:pick',
  'agent:approve-tool', 'agent:reject-tool', 'agent:answer-question', 'agent:cancel', 'agent:clear', 'agent:history', 'agent:status',
  'agent:settings:get', 'agent:settings:update', 'agent:settings:reset', 'agent:settings:test',
  'claude:skills:list', 'claude:skills:read', 'claude:skills:save', 'claude:skills:toggle', 'claude:skills:delete',
  'claude:mcp:list', 'claude:mcp:save', 'claude:mcp:delete',
  'browser:ensure', 'browser:set-layout', 'browser:reconcile', 'browser:destroy',
  'browser:navigate', 'browser:back', 'browser:forward', 'browser:reload',
  'browser:focus', 'browser:get-state', 'browser:read',
  'traffic:profile:get', 'traffic:profile:update', 'traffic:list', 'traffic:read', 'traffic:delete', 'traffic:clear',
  'traffic:runtime:get', 'traffic:runtime:detect', 'traffic:runtime:update', 'traffic:runtime:choose',
  'traffic:decide', 'traffic:replay', 'traffic:save-evidence', 'traffic:start', 'traffic:stop',
  'traffic:replay-session:open', 'traffic:replay-session:read', 'traffic:replay-session:update', 'traffic:replay-session:clear',
  'traffic:burp:connect', 'traffic:burp:disconnect', 'traffic:burp:call',
  'clipboard:read-text', 'clipboard:write-text',
]);

const EVENT_CHANNELS = new Set([
  'app:windowId', 'app:window:maximized', 'terminal:output', 'terminal:exit',
  'tools:output', 'tools:complete',
  'agent:message', 'agent:tool-request', 'agent:status',
  'session:data-changed',
  'browser:state-changed',
  'browser:context-action', 'browser:open-tab',
  'traffic:changed',
  'shell:output', 'shell:changed',
  'menu:open-folder', 'menu:create-project-folder',
  'app:settings:changed', 'dialog:requested',
]);

function assertChannel(channel: string, allowed: Set<string>) {
  if (!allowed.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
}

const api: HexestraAPI = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    (assertChannel(channel, INVOKE_CHANNELS), ipcRenderer.invoke(channel, ...args)),

  on: (channel: string, callback: (...args: unknown[]) => void) => {
    assertChannel(channel, EVENT_CHANNELS);
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  once: (channel: string, callback: (...args: unknown[]) => void) => {
    assertChannel(channel, EVENT_CHANNELS);
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  send: (channel: string, ...args: unknown[]) => {
    assertChannel(channel, EVENT_CHANNELS);
    ipcRenderer.send(channel, ...args);
  },
};

contextBridge.exposeInMainWorld('hexestra', api);
