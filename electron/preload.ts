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
  'tasks:list', 'tasks:update', 'tasks:upsert', 'tasks:plan', 'tasks:delete', 'tasks:focus', 'tasks:context', 'tasks:criterion',
  'tasks:document-status', 'tasks:rebuild', 'tasks:steps-plan', 'tasks:step-upsert', 'tasks:step-delete', 'tasks:step-reorder', 'tasks:trace',
  'restrictions:list', 'restrictions:upsert', 'restrictions:delete', 'restrictions:classify', 'restrictions:import-preview', 'restrictions:import-apply', 'restrictions:export', 'tools:catalog:list', 'tools:catalog:create', 'tools:catalog:update', 'tools:catalog:delete',
  'asm:scan-runs', 'asm:changes', 'findings:list', 'findings:upsert',
  'vulnerabilities:list', 'vulnerabilities:upsert',
  'evidence:list', 'evidence:upsert', 'reports:list', 'reports:upsert', 'scope:update',
  'records:delete', 'records:export',
  'files:list', 'files:read', 'files:write',
  'terminal:create', 'terminal:write', 'terminal:resize', 'terminal:close', 'terminal:list', 'terminal:info', 'terminal:set-context',
  'shell:profile:list', 'shell:profile:save', 'shell:profile:delete', 'shell:profile:health', 'shell:profile:verify',
  'shell:credential:save', 'shell:credential:delete', 'shell:credential:status', 'shell:interfaces',
  'shell:session:connect', 'shell:session:attach', 'shell:session:list', 'shell:session:read',
  'shell:session:write', 'shell:session:resize', 'shell:session:interrupt', 'shell:session:takeover', 'shell:session:disconnect',
  'shell:listener:list', 'shell:listener:save', 'shell:listener:delete', 'shell:listener:start', 'shell:listener:stop',
  'shell:connect-template:list', 'shell:connect-command:build', 'shell:public-ip:detect',
  'shell:reverse:bind', 'shell:reverse:reject',
  'shell:audit:list', 'shell:audit:read', 'shell:audit:delete', 'shell:save-evidence',
  'shell:file:home', 'shell:file:list', 'shell:file:read', 'shell:file:write',
  'shell:file:mkdir', 'shell:file:rename', 'shell:file:delete-preview', 'shell:file:delete',
  'shell:file:upload-pick', 'shell:file:upload-start', 'shell:file:download', 'shell:file:transfer-cancel',
  'netmap:get', 'netmap:layout:get', 'netmap:layout:update',
  'agent:activate', 'agent:send', 'agent:branch', 'agent:branch:activate', 'agent:conversation:new',
  'agent:attachments:pick',
  'agent:approve-tool', 'agent:reject-tool', 'agent:answer-question', 'agent:cancel', 'agent:clear', 'agent:status',
  'agent:history:page', 'agent:history:activities', 'agent:subagent:detail', 'agent:attention:list', 'agent:attention:read', 'agent:attention:clear',
  'agent:commands:list',
  'agent:settings:get', 'agent:settings:update', 'agent:settings:reset', 'agent:settings:test',
  'claude:skills:list', 'claude:skills:read', 'claude:skills:save', 'claude:skills:toggle', 'claude:skills:delete', 'claude:skills:import-pick', 'claude:skills:import-apply',
  'workflows:list', 'workflows:read', 'workflows:save', 'workflows:delete', 'workflows:import', 'workflows:export', 'workflows:prepare-run',
  'refinery:sources:list', 'refinery:sources:read', 'refinery:sources:preview', 'refinery:sources:import', 'refinery:sources:delete',
  'refinery:jobs:list', 'refinery:jobs:read', 'refinery:jobs:create-from-source', 'refinery:jobs:create-from-conversation', 'refinery:jobs:cancel', 'refinery:jobs:retry', 'refinery:jobs:delete',
  'refinery:jobs:debug',
  'refinery:candidates:page', 'refinery:candidates:read', 'refinery:candidates:update', 'refinery:candidates:apply',
  'claude:mcp:list', 'claude:mcp:status', 'claude:mcp:save', 'claude:mcp:delete',
  'browser:ensure', 'browser:set-layout', 'browser:reconcile', 'browser:destroy',
  'browser:navigate', 'browser:back', 'browser:forward', 'browser:reload',
  'browser:focus', 'browser:get-state', 'browser:read',
  'traffic:profile:get', 'traffic:profile:update', 'traffic:list', 'traffic:read', 'traffic:delete', 'traffic:clear',
  'traffic:runtime:get', 'traffic:runtime:detect', 'traffic:runtime:update', 'traffic:runtime:choose',
  'traffic:decide', 'traffic:replay', 'traffic:save-evidence', 'traffic:start', 'traffic:stop',
  'traffic:replay-session:open', 'traffic:replay-session:read', 'traffic:replay-session:update', 'traffic:replay-session:clear',
  'traffic:burp:connect', 'traffic:burp:disconnect', 'traffic:burp:call',
  'egress-proxy:runtime:diagnose', 'egress-proxy:runtime:choose', 'egress-proxy:runtime:start', 'egress-proxy:runtime:stop',
  'egress-proxy:status', 'egress-proxy:exit:refresh', 'egress-proxy:enforcement:set',
  'egress-proxy:nodes:list', 'egress-proxy:nodes:import', 'egress-proxy:nodes:import-batch', 'egress-proxy:nodes:update', 'egress-proxy:nodes:delete', 'egress-proxy:nodes:test',
  'egress-proxy:chains:list', 'egress-proxy:chains:save', 'egress-proxy:chains:delete', 'egress-proxy:chains:activate', 'egress-proxy:chains:test',
  'clipboard:read-text', 'clipboard:write-text',
]);

const EVENT_CHANNELS = new Set([
  'app:windowId', 'app:window:maximized', 'terminal:output', 'terminal:exit',
  'agent:message', 'agent:tool-request', 'agent:status', 'agent:subagent-update', 'agent:attention', 'agent:attention:resolved',
  'session:data-changed',
  'browser:state-changed',
  'browser:context-action', 'browser:open-tab',
  'traffic:changed',
  'agent:commands-changed',
  'refinery:changed',
  'egress-proxy:changed',
  'shell:output', 'shell:changed',
  'shell:file:changed', 'shell:file:transfer',
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
