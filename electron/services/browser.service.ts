import {
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  session,
  WebContentsView,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import fs from 'fs';
import {
  BROWSER_IPC,
  type BrowserBounds,
  type BrowserEnsureRequest,
  type BrowserContextActionEvent,
  type BrowserOpenTabEvent,
  type BrowserPostBody,
  type BrowserIdentity,
  type BrowserLayoutRequest,
  type BrowserLocationState,
  type BrowserNavigateRequest,
  type BrowserPageSnapshot,
  type BrowserReconcileRequest,
  type BrowserState,
  type BrowserStateChangedEvent,
  type BrowserScopeState,
  type BrowserTabDescriptor,
} from '../contracts/browser';
import { BrowserAutomationSession } from './browser-automation.service';
import { sessionService } from './session.service';
import {
  isCertificateTrustedByAuthority,
  loadPinnedCertificateAuthority,
  type PinnedCertificateAuthority,
} from './browser-certificate';
import {
  browserProjectPartition,
  browserRuntimeKey,
  normalizeBrowserUrl,
  sanitizeBrowserBounds,
  shouldDestroyBrowserRuntime,
} from './browser-policy';
import { buildBrowserContextMenuModel, type BrowserContextMenuCommand } from './browser-context-menu';

const DEFAULT_BROWSER_URL = 'https://example.com/';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

interface BrowserRuntime {
  key: string;
  owner: BrowserWindow;
  projectId: string;
  tabId: string;
  view: WebContentsView;
  state: BrowserState;
  automation?: BrowserAutomationSession;
}

class BrowserService {
  private readonly runtimes = new Map<string, BrowserRuntime>();
  private readonly observedOwnerIds = new Set<number>();
  private readonly configuredPartitions = new Set<string>();
  private readonly projectProxyPorts = new Map<string, number>();
  private readonly projectCertificateAuthorities = new Map<string, PinnedCertificateAuthority>();

  constructor() {
    ipcMain.handle(BROWSER_IPC.ENSURE, (event, request: unknown) => this.ensure(event, request));
    ipcMain.handle(BROWSER_IPC.SET_LAYOUT, (event, request: unknown) => this.setLayout(event, request));
    ipcMain.handle(BROWSER_IPC.RECONCILE, (event, request: unknown) => this.reconcile(event, request));
    ipcMain.handle(BROWSER_IPC.DESTROY, (event, request: unknown) => this.destroy(event, request));
    ipcMain.handle(BROWSER_IPC.NAVIGATE, (event, request: unknown) => this.navigateFromRenderer(event, request));
    ipcMain.handle(BROWSER_IPC.BACK, (event, request: unknown) => this.goBack(event, request));
    ipcMain.handle(BROWSER_IPC.FORWARD, (event, request: unknown) => this.goForward(event, request));
    ipcMain.handle(BROWSER_IPC.RELOAD, (event, request: unknown) => this.reload(event, request));
    ipcMain.handle(BROWSER_IPC.FOCUS, (event, request: unknown) => this.focus(event, request));
    ipcMain.handle(BROWSER_IPC.GET_STATE, (event, request: unknown) => this.getState(event, request));
    ipcMain.handle(BROWSER_IPC.READ, (event, request: unknown) => this.read(event, request));
  }

  private async ensure(event: IpcMainInvokeEvent, value: unknown): Promise<BrowserState> {
    const request = parseEnsureRequest(value);
    const owner = requireOwnerWindow(event);
    const key = browserRuntimeKey(owner.id, request);
    const existing = this.runtimes.get(key);
    if (existing) return { ...existing.state };

    const partition = browserProjectPartition(request.projectId);
    const browserSession = session.fromPartition(partition, { cache: true });
    this.configureSession(partition, browserSession);
    await this.applyProjectProxy(request.projectId, browserSession);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    view.setVisible(false);
    owner.contentView.addChildView(view);

    const initialUrl = normalizeBrowserUrl(request.url || DEFAULT_BROWSER_URL);
    const runtime: BrowserRuntime = {
      key,
      owner,
      projectId: request.projectId,
      tabId: request.tabId,
      view,
      state: {
        url: initialUrl,
        title: 'Browser',
        loading: true,
        canGoBack: false,
        canGoForward: false,
        visible: false,
        scopeState: this.scopeState(request.projectId, initialUrl),
        error: null,
      },
    };
    this.runtimes.set(key, runtime);
    this.observeOwner(owner);
    this.observeRuntime(runtime);
    this.emitState(runtime);

    try {
      await view.webContents.loadURL(initialUrl, loadUrlOptions(request.postBody));
    } catch (error) {
      runtime.state.error = errorMessage(error);
      runtime.state.loading = false;
      this.refreshState(runtime);
    }
    return { ...runtime.state };
  }

  async setProjectProxy(
    projectId: string,
    proxyPort: number | null,
    caFingerprint?: string,
    caCertificatePath?: string,
  ) {
    parseId(projectId, 'project');
    if (proxyPort !== null && (!Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65_535)) {
      throw new Error('Invalid traffic proxy port');
    }
    if (proxyPort === null) {
      this.projectProxyPorts.delete(projectId);
      this.projectCertificateAuthorities.delete(projectId);
    } else {
      if (!caFingerprint || !caCertificatePath) throw new Error('Traffic proxy CA certificate is required');
      const authority = loadPinnedCertificateAuthority(fs.readFileSync(caCertificatePath), caFingerprint);
      this.projectProxyPorts.set(projectId, proxyPort);
      this.projectCertificateAuthorities.set(projectId, authority);
    }
    const partition = browserProjectPartition(projectId);
    const browserSession = session.fromPartition(partition, { cache: true });
    this.configureSession(partition, browserSession);
    await this.applyProjectProxy(projectId, browserSession);
  }

  private setLayout(event: IpcMainInvokeEvent, value: unknown): BrowserState {
    const request = parseLayoutRequest(value);
    const runtime = this.requireRuntime(event, request);
    const bounds = sanitizeBrowserBounds(request.bounds);
    const visible = request.visible && bounds.width > 0 && bounds.height > 0;
    if (visible) runtime.view.setBounds(bounds);
    runtime.view.setVisible(visible);
    runtime.state.visible = visible;
    this.emitState(runtime);
    return { ...runtime.state };
  }

  private reconcile(event: IpcMainInvokeEvent, value: unknown): boolean {
    const request = parseReconcileRequest(value);
    const owner = requireOwnerWindow(event);
    const retainedTabIds = new Set(request.tabIds);
    for (const runtime of [...this.runtimes.values()]) {
      if (shouldDestroyBrowserRuntime(
        { ownerId: runtime.owner.id, projectId: runtime.projectId, tabId: runtime.tabId },
        owner.id,
        request.projectId,
        retainedTabIds,
      )) {
        this.destroyRuntime(runtime);
      }
    }
    return true;
  }

  private destroy(event: IpcMainInvokeEvent, value: unknown): boolean {
    const identity = parseIdentity(value);
    const runtime = this.requireRuntime(event, identity);
    this.destroyRuntime(runtime);
    return true;
  }

  private async navigateFromRenderer(event: IpcMainInvokeEvent, value: unknown): Promise<BrowserState> {
    const request = parseNavigateRequest(value);
    const runtime = this.requireRuntime(event, request);
    const url = normalizeBrowserUrl(request.url);
    runtime.state.error = null;
    await runtime.view.webContents.loadURL(url);
    this.refreshState(runtime);
    return { ...runtime.state };
  }

  private goBack(event: IpcMainInvokeEvent, value: unknown): BrowserState {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    if (runtime.view.webContents.navigationHistory.canGoBack()) {
      runtime.view.webContents.navigationHistory.goBack();
    }
    this.refreshState(runtime);
    return { ...runtime.state };
  }

  private goForward(event: IpcMainInvokeEvent, value: unknown): BrowserState {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    if (runtime.view.webContents.navigationHistory.canGoForward()) {
      runtime.view.webContents.navigationHistory.goForward();
    }
    this.refreshState(runtime);
    return { ...runtime.state };
  }

  private reload(event: IpcMainInvokeEvent, value: unknown): BrowserState {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    runtime.view.webContents.reload();
    this.refreshState(runtime);
    return { ...runtime.state };
  }

  private focus(event: IpcMainInvokeEvent, value: unknown): boolean {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    runtime.view.webContents.focus();
    return true;
  }

  private getState(event: IpcMainInvokeEvent, value: unknown): BrowserState {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    this.refreshState(runtime);
    return { ...runtime.state };
  }

  private async read(event: IpcMainInvokeEvent, value: unknown): Promise<BrowserPageSnapshot> {
    const runtime = this.requireRuntime(event, parseIdentity(value));
    return this.readRuntime(runtime);
  }

  async readPage(ownerId: number, projectId?: string, tabId?: string): Promise<BrowserPageSnapshot> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    return this.readRuntime(runtime);
  }

  listTabs(ownerId: number, projectId?: string): BrowserTabDescriptor[] {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.owner.webContents.id === ownerId && (!projectId || runtime.projectId === projectId))
      .map((runtime) => ({ projectId: runtime.projectId, tabId: runtime.tabId, state: { ...runtime.state } }));
  }

  async navigate(ownerId: number, url: string, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    const normalized = normalizeBrowserUrl(url);
    await this.runAgentAction(runtime, () => this.automation(runtime).navigate(normalized));
    return this.locationState(runtime);
  }

  async navigateOrOpen(sender: WebContents, url: string, projectId: string, tabId?: string): Promise<BrowserLocationState> {
    const normalized = normalizeBrowserUrl(url);
    const runtime = this.findAgentRuntime(sender.id, projectId, tabId);
    if (runtime) {
      await this.runAgentAction(runtime, () => this.automation(runtime).navigate(normalized));
      return this.locationState(runtime);
    }
    if (tabId) throw new Error('Browser tab is not available');
    return this.openAgentTab(sender, projectId, normalized);
  }

  async agentGoBack(ownerId: number, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).goBack());
    return this.locationState(runtime);
  }

  async agentGoForward(ownerId: number, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).goForward());
    return this.locationState(runtime);
  }

  async agentReload(ownerId: number, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).reload());
    return this.locationState(runtime);
  }

  async click(ownerId: number, ref: string, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).click(ref));
    return this.locationState(runtime);
  }

  async type(ownerId: number, ref: string, text: string, submit = false, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).fill(ref, text, submit));
    return this.locationState(runtime);
  }

  async press(ownerId: number, key: string, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).press(key));
    return this.locationState(runtime);
  }

  async hover(ownerId: number, ref: string, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).hover(ref));
    return this.locationState(runtime);
  }

  async wait(ownerId: number, milliseconds: number, projectId?: string, tabId?: string): Promise<BrowserLocationState> {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    await this.runAgentAction(runtime, () => this.automation(runtime).wait(milliseconds));
    return this.locationState(runtime);
  }

  async screenshot(ownerId: number, projectId?: string, tabId?: string) {
    const runtime = this.getAgentRuntime(ownerId, projectId, tabId);
    const screenshot = await this.automation(runtime).screenshot();
    return { ...screenshot, ...this.locationState(runtime) };
  }

  private async readRuntime(runtime: BrowserRuntime): Promise<BrowserPageSnapshot> {
    const snapshot = await this.automation(runtime).snapshot();
    return { ...snapshot, scopeState: this.scopeState(runtime.projectId, snapshot.url) };
  }

  private getAgentRuntime(ownerId: number, projectId?: string, tabId?: string): BrowserRuntime {
    const runtime = this.findAgentRuntime(ownerId, projectId, tabId);
    if (!runtime) throw new Error('No active embedded browser tab');
    return runtime;
  }

  private findAgentRuntime(ownerId: number, projectId?: string, tabId?: string): BrowserRuntime | undefined {
    const candidates = [...this.runtimes.values()].filter((runtime) => (
      runtime.owner.webContents.id === ownerId
      && (!projectId || runtime.projectId === projectId)
      && (!tabId || runtime.tabId === tabId)
      && !runtime.view.webContents.isDestroyed()
    ));
    return candidates.find((candidate) => candidate.state.visible) ?? candidates[0];
  }

  private async openAgentTab(sender: WebContents, projectId: string, url: string): Promise<BrowserLocationState> {
    const owner = BrowserWindow.fromWebContents(sender);
    if (!owner || owner.webContents !== sender) throw new Error('Browser owner window is not available');
    const existingKeys = new Set([...this.runtimes.values()].map((runtime) => runtime.key));
    sender.send(BROWSER_IPC.OPEN_TAB, {
      projectId,
      openerTabId: 'agent',
      url,
      disposition: 'foreground-tab',
    } satisfies BrowserOpenTabEvent);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const runtime = [...this.runtimes.values()].find((candidate) => (
        candidate.owner === owner
        && candidate.projectId === projectId
        && !existingKeys.has(candidate.key)
        && !candidate.view.webContents.isDestroyed()
      ));
      if (runtime && !runtime.state.loading) {
        if (runtime.state.error) throw new Error(runtime.state.error);
        return this.locationState(runtime);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out while opening an integrated browser tab');
  }

  private automation(runtime: BrowserRuntime) {
    runtime.automation ??= new BrowserAutomationSession(
      runtime.view.webContents,
      runtime.projectId,
      () => runtime.view.getBounds(),
    );
    return runtime.automation;
  }

  private scopeState(projectId: string, url: string): BrowserScopeState {
    return sessionService.valueIsInScope(projectId, url) ? 'in_scope' : 'out_of_scope';
  }

  private locationState(runtime: BrowserRuntime): BrowserLocationState {
    return { url: runtime.state.url, title: runtime.state.title, scopeState: runtime.state.scopeState };
  }

  private async runAgentAction<T>(runtime: BrowserRuntime, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } finally {
      this.refreshState(runtime);
    }
  }

  private requireRuntime(event: IpcMainInvokeEvent, identity: BrowserIdentity): BrowserRuntime {
    const owner = requireOwnerWindow(event);
    const runtime = this.runtimes.get(browserRuntimeKey(owner.id, identity));
    if (!runtime || runtime.owner !== owner || runtime.view.webContents.isDestroyed()) {
      throw new Error('Browser tab is not available');
    }
    return runtime;
  }

  private observeOwner(owner: BrowserWindow) {
    if (this.observedOwnerIds.has(owner.id)) return;
    this.observedOwnerIds.add(owner.id);
    owner.once('closed', () => {
      this.destroyOwner(owner.id);
      this.observedOwnerIds.delete(owner.id);
    });
  }

  private observeRuntime(runtime: BrowserRuntime) {
    const contents = runtime.view.webContents;
    contents.setWindowOpenHandler((details) => {
      if (isHttpUrl(details.url)) {
        const payload: BrowserOpenTabEvent = {
          projectId: runtime.projectId,
          openerTabId: runtime.tabId,
          url: details.url,
          disposition: details.disposition,
          ...(details.postBody ? { postBody: serializePostBody(details.postBody) } : {}),
        };
        runtime.owner.webContents.send(BROWSER_IPC.OPEN_TAB, payload);
      }
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => {
      const model = buildBrowserContextMenuModel({
        isEditable: params.isEditable,
        selectionText: params.selectionText,
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        hasImageContents: params.hasImageContents,
        editFlags: params.editFlags,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      });
      const template: Electron.MenuItemConstructorOptions[] = [];
      for (const item of model) {
        if (item.separatorBefore) template.push({ type: 'separator' });
        template.push({ label: item.label, enabled: item.enabled, click: () => this.runContextMenuCommand(runtime, params, item.command) });
      }
      Menu.buildFromTemplate(template).popup({ window: runtime.owner });
    });
    contents.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) {
        event.preventDefault();
      }
    });
    contents.on('did-start-loading', () => {
      runtime.state.loading = true;
      runtime.state.error = null;
      this.refreshState(runtime);
    });
    contents.on('did-stop-loading', () => {
      runtime.state.loading = false;
      this.refreshState(runtime);
    });
    contents.on('did-navigate', () => this.refreshState(runtime));
    contents.on('did-navigate-in-page', () => this.refreshState(runtime));
    contents.on('page-title-updated', () => this.refreshState(runtime));
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      runtime.state.loading = false;
      runtime.state.error = description || `Navigation failed (${code})`;
      this.refreshState(runtime);
    });
  }

  private runContextMenuCommand(runtime: BrowserRuntime, params: Electron.ContextMenuParams, command: BrowserContextMenuCommand) {
    const contents = runtime.view.webContents;
    const commands: Record<BrowserContextMenuCommand, () => void> = {
      undo: () => contents.undo(), redo: () => contents.redo(), cut: () => contents.cut(), copy: () => contents.copy(),
      paste: () => contents.paste(), 'paste-plain': () => contents.pasteAndMatchStyle(), delete: () => contents.delete(), 'select-all': () => contents.selectAll(),
      'ask-selection': () => this.emitContextAction(runtime, 'ask-selection', params),
      'open-link': () => this.emitOpenTab(runtime, params.linkURL, 'foreground-tab'),
      'copy-link': () => clipboard.writeText(params.linkURL),
      'ask-link': () => this.emitContextAction(runtime, 'ask-link', params),
      'copy-image': () => contents.copyImageAt(params.x, params.y),
      'copy-image-url': () => clipboard.writeText(params.srcURL),
      back: () => contents.navigationHistory.goBack(), forward: () => contents.navigationHistory.goForward(), reload: () => contents.reload(),
      'copy-page-url': () => clipboard.writeText(contents.getURL()),
      'ask-page': () => this.emitContextAction(runtime, 'ask-page', params),
    };
    commands[command]();
  }

  private emitOpenTab(runtime: BrowserRuntime, url: string, disposition: BrowserOpenTabEvent['disposition']) {
    if (!isHttpUrl(url)) return;
    runtime.owner.webContents.send(BROWSER_IPC.OPEN_TAB, {
      projectId: runtime.projectId,
      openerTabId: runtime.tabId,
      url,
      disposition,
    } satisfies BrowserOpenTabEvent);
  }

  private emitContextAction(
    runtime: BrowserRuntime,
    action: BrowserContextActionEvent['action'],
    params: Electron.ContextMenuParams,
  ) {
    runtime.owner.webContents.send(BROWSER_IPC.CONTEXT_ACTION, {
      projectId: runtime.projectId,
      tabId: runtime.tabId,
      action,
      url: runtime.view.webContents.getURL() || runtime.state.url,
      title: runtime.view.webContents.getTitle() || runtime.state.title,
      ...(action === 'ask-selection' ? { selectionText: params.selectionText.slice(0, 12_000) } : {}),
      ...(action === 'ask-link' ? { linkUrl: params.linkURL, linkText: params.linkText.slice(0, 2_000) } : {}),
    } satisfies BrowserContextActionEvent);
  }

  private configureSession(partition: string, browserSession: Electron.Session) {
    if (this.configuredPartitions.has(partition)) return;
    this.configuredPartitions.add(partition);
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.on('will-download', (event) => event.preventDefault());
    browserSession.setCertificateVerifyProc((request, callback) => {
      const projectId = projectIdFromPartition(partition);
      const trusted = projectId ? this.projectCertificateAuthorities.get(projectId) : undefined;
      callback(trusted && isCertificateTrustedByAuthority(request.certificate, request.hostname, trusted) ? 0 : -3);
    });
  }

  private async applyProjectProxy(projectId: string, browserSession: Session) {
    const port = this.projectProxyPorts.get(projectId);
    if (port) {
      await browserSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
        proxyBypassRules: '<-loopback>',
      });
    } else {
      await browserSession.setProxy({ mode: 'direct' });
    }
    await browserSession.closeAllConnections();
  }

  private refreshState(runtime: BrowserRuntime) {
    const contents = runtime.view.webContents;
    if (contents.isDestroyed()) return;
    runtime.state = {
      ...runtime.state,
      url: contents.getURL() || runtime.state.url,
      title: contents.getTitle() || 'Browser',
      loading: contents.isLoadingMainFrame(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      scopeState: this.scopeState(runtime.projectId, contents.getURL() || runtime.state.url),
    };
    this.emitState(runtime);
  }

  private emitState(runtime: BrowserRuntime) {
    if (runtime.owner.isDestroyed() || runtime.owner.webContents.isDestroyed()) return;
    const payload: BrowserStateChangedEvent = {
      projectId: runtime.projectId,
      tabId: runtime.tabId,
      state: { ...runtime.state },
    };
    runtime.owner.webContents.send(BROWSER_IPC.STATE_CHANGED, payload);
  }

  private destroyOwner(ownerId: number) {
    for (const runtime of [...this.runtimes.values()]) {
      if (runtime.owner.id === ownerId) this.destroyRuntime(runtime);
    }
  }

  private destroyRuntime(runtime: BrowserRuntime) {
    this.runtimes.delete(runtime.key);
    runtime.automation?.dispose();
    if (!runtime.owner.isDestroyed()) runtime.owner.contentView.removeChildView(runtime.view);
    if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close();
  }
}

function requireOwnerWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed()) throw new Error('Browser owner window is not available');
  return owner;
}

function parseIdentity(value: unknown): BrowserIdentity {
  if (!isRecord(value)) throw new Error('Invalid browser identity');
  return {
    projectId: parseId(value.projectId, 'project'),
    tabId: parseId(value.tabId, 'tab'),
  };
}

function parseEnsureRequest(value: unknown): BrowserEnsureRequest {
  const identity = parseIdentity(value);
  if (!isRecord(value) || typeof value.url !== 'string') throw new Error('Browser URL is required');
  return {
    ...identity,
    url: value.url,
    ...(value.postBody === undefined ? {} : { postBody: parsePostBody(value.postBody) }),
  };
}

function parseNavigateRequest(value: unknown): BrowserNavigateRequest {
  return parseEnsureRequest(value);
}

function parseLayoutRequest(value: unknown): BrowserLayoutRequest {
  const identity = parseIdentity(value);
  if (!isRecord(value) || !isRecord(value.bounds) || typeof value.visible !== 'boolean') {
    throw new Error('Invalid browser layout');
  }
  const bounds = value.bounds;
  return {
    ...identity,
    visible: value.visible,
    bounds: {
      x: requireFiniteNumber(bounds.x),
      y: requireFiniteNumber(bounds.y),
      width: requireFiniteNumber(bounds.width),
      height: requireFiniteNumber(bounds.height),
    },
  };
}

function parseReconcileRequest(value: unknown): BrowserReconcileRequest {
  if (!isRecord(value)) throw new Error('Invalid browser reconciliation request');
  const projectId = value.projectId === null ? null : parseId(value.projectId, 'project');
  if (!Array.isArray(value.tabIds) || value.tabIds.length > 50) {
    throw new Error('Invalid browser tab list');
  }
  return { projectId, tabIds: value.tabIds.map((tabId) => parseId(tabId, 'tab')) };
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`Invalid browser ${label} identifier`);
  return value;
}

function projectIdFromPartition(partition: string) {
  const prefix = 'persist:hexestra-browser-';
  return partition.startsWith(prefix) ? partition.slice(prefix.length) : null;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid browser bounds');
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePostBody(value: unknown): BrowserPostBody {
  if (!isRecord(value) || typeof value.contentType !== 'string' || !Array.isArray(value.data) || value.data.length > 128) {
    throw new Error('Invalid browser POST body');
  }
  const data: BrowserPostBody['data'] = value.data.map((entry) => {
    if (!isRecord(entry)) throw new Error('Invalid browser POST data');
    if (entry.type === 'rawData' && typeof entry.base64 === 'string') {
      if (Buffer.byteLength(entry.base64, 'base64') > 25 * 1024 * 1024) throw new Error('Browser POST body is too large');
      return { type: 'rawData', base64: entry.base64 };
    }
    if (entry.type === 'file' && typeof entry.filePath === 'string') {
      return {
        type: 'file',
        filePath: entry.filePath,
        ...(typeof entry.offset === 'number' ? { offset: entry.offset } : {}),
        ...(typeof entry.length === 'number' ? { length: entry.length } : {}),
        ...(typeof entry.modificationTime === 'number' ? { modificationTime: entry.modificationTime } : {}),
      };
    }
    throw new Error('Invalid browser POST data');
  });
  return {
    contentType: value.contentType,
    ...(typeof value.boundary === 'string' ? { boundary: value.boundary } : {}),
    data,
  };
}

function serializePostBody(value: Electron.PostBody): BrowserPostBody {
  return {
    contentType: value.contentType,
    ...(value.boundary ? { boundary: value.boundary } : {}),
    data: value.data.map((entry) => entry.type === 'rawData'
      ? { type: 'rawData' as const, base64: entry.bytes.toString('base64') }
      : {
          type: 'file' as const,
          filePath: entry.filePath,
          ...(entry.offset === undefined ? {} : { offset: entry.offset }),
          ...(entry.length === undefined ? {} : { length: entry.length }),
          ...(entry.modificationTime === undefined ? {} : { modificationTime: entry.modificationTime }),
        }),
  };
}

function loadUrlOptions(value?: BrowserPostBody): Electron.LoadURLOptions | undefined {
  if (!value) return undefined;
  const contentType = value.boundary
    ? `${value.contentType}; boundary=${value.boundary}`
    : value.contentType;
  return {
    extraHeaders: `Content-Type: ${contentType}`,
    postData: value.data.map((entry) => entry.type === 'rawData'
      ? { type: 'rawData' as const, bytes: Buffer.from(entry.base64, 'base64') }
      : { ...entry, type: 'file' as const }),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const browserService = new BrowserService();
