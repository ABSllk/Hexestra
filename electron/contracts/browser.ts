export const BROWSER_IPC = {
  ENSURE: 'browser:ensure',
  SET_LAYOUT: 'browser:set-layout',
  RECONCILE: 'browser:reconcile',
  DESTROY: 'browser:destroy',
  NAVIGATE: 'browser:navigate',
  BACK: 'browser:back',
  FORWARD: 'browser:forward',
  RELOAD: 'browser:reload',
  FOCUS: 'browser:focus',
  GET_STATE: 'browser:get-state',
  READ: 'browser:read',
  STATE_CHANGED: 'browser:state-changed',
  CONTEXT_ACTION: 'browser:context-action',
  OPEN_TAB: 'browser:open-tab',
} as const;

export interface BrowserIdentity {
  projectId: string;
  tabId: string;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserEnsureRequest extends BrowserIdentity {
  url: string;
  postBody?: BrowserPostBody;
}

export interface BrowserLayoutRequest extends BrowserIdentity {
  bounds: BrowserBounds;
  visible: boolean;
}

export interface BrowserReconcileRequest {
  projectId: string | null;
  tabIds: string[];
}

export interface BrowserNavigateRequest extends BrowserIdentity {
  url: string;
}

export type BrowserScopeState = 'in_scope' | 'out_of_scope';

export interface BrowserLocationState {
  url: string;
  title: string;
  scopeState: BrowserScopeState;
}

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  visible: boolean;
  scopeState: BrowserScopeState;
  error: string | null;
}

export interface BrowserStateChangedEvent extends BrowserIdentity {
  state: BrowserState;
}

export interface BrowserTabDescriptor extends BrowserIdentity {
  state: BrowserState;
}

export interface BrowserPageSnapshot {
  url: string;
  title: string;
  scopeState: BrowserScopeState;
  text: string;
  elements: Array<{ ref: string; tag: string; text: string; type?: string }>;
}

export interface BrowserStorageSnapshot {
  url: string;
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface BrowserEvaluationResult {
  url: string;
  result: unknown;
}

export interface BrowserContextActionEvent extends BrowserIdentity {
  action: 'ask-page' | 'ask-selection' | 'ask-link';
  url: string;
  title: string;
  selectionText?: string;
  linkUrl?: string;
  linkText?: string;
}

export interface BrowserOpenTabEvent {
  projectId: string;
  openerTabId: string;
  url: string;
  disposition: 'default' | 'foreground-tab' | 'background-tab' | 'new-window' | 'other';
  postBody?: BrowserPostBody;
}

export interface BrowserPostBody {
  contentType: string;
  boundary?: string;
  data: Array<
    | { type: 'rawData'; base64: string }
    | { type: 'file'; filePath: string; offset?: number; length?: number; modificationTime?: number }
  >;
}
