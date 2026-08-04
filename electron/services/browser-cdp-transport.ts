/*
 * The logical-browser transport follows the architecture of VS Code's
 * integrated browser (MIT licensed):
 * https://github.com/microsoft/vscode/tree/main/src/vs/platform/browserView
 *
 * Hexestra keeps a deliberately smaller one-view proxy. It implements only the
 * Browser/Target protocol surface Playwright needs to discover and attach to an
 * existing Electron WebContentsView, then routes page-session traffic through
 * Electron's in-process debugger API.
 */
import type { ConnectOverCDPTransport } from 'playwright-core';
import type { Rectangle, WebContents } from 'electron';

interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: boolean;
  browserContextId?: string;
}

export class IntegratedBrowserCdpTransport implements ConnectOverCDPTransport {
  onmessage?: (message: object) => void;
  onclose?: (reason?: string) => void;

  private readonly targetId: string;
  private readonly browserSessionId: string;
  private readonly pageSessionIds = new Set<string>();
  private attachedToBrowserTarget = false;
  private autoAttach = false;
  private discoverTargets = false;
  private attachingTarget: Promise<string> | null = null;
  private closed = false;

  private readonly handleDebuggerMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
    sessionId?: string,
  ) => {
    if (this.closed) return;
    if (method === 'Target.attachedToTarget') {
      const attached = params as { sessionId?: string; targetInfo?: { targetId?: string } };
      if (attached.sessionId) this.pageSessionIds.add(attached.sessionId);
    } else if (method === 'Target.detachedFromTarget') {
      const detached = params as { sessionId?: string };
      if (detached.sessionId) this.pageSessionIds.delete(detached.sessionId);
    }

    const routedSessionId = sessionId
      ?? (method.startsWith('Target.') && this.attachedToBrowserTarget ? this.browserSessionId : undefined);
    this.emit({ method, params, sessionId: routedSessionId });
  };

  constructor(
    private readonly contents: WebContents,
    private readonly browserContextId: string,
    private readonly getBounds: () => Rectangle,
  ) {
    this.targetId = contents.getOrCreateDevToolsTargetId();
    this.browserSessionId = `hexestra-browser-${contents.id}`;
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    contents.debugger.on('message', this.handleDebuggerMessage);
  }

  open() {}

  send(rawMessage: object): void {
    if (!isCdpRequest(rawMessage)) throw new Error('Unexpected Playwright CDP transport payload');
    debugCdp('request', rawMessage);
    void this.handleRequest(rawMessage).catch((error) => {
      this.emit({
        id: rawMessage.id,
        sessionId: rawMessage.sessionId,
        error: { code: -32000, message: errorMessage(error) },
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.contents.debugger.removeListener('message', this.handleDebuggerMessage);
    try {
      if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
    } catch {
      // The view may be closing concurrently with Playwright.
    }
    this.pageSessionIds.clear();
    this.onclose?.();
  }

  private async handleRequest(request: CdpRequest) {
    const { method, params = {}, sessionId } = request;
    if (sessionId && this.pageSessionIds.has(sessionId)) {
      const result = method === 'Emulation.setDeviceMetricsOverride'
        ? {}
        : await this.contents.debugger.sendCommand(method, params, sessionId);
      this.respond(request, result ?? {});
      return;
    }

    let result: unknown;
    switch (method) {
      case 'Browser.getVersion':
        result = {
          protocolVersion: '1.3',
          product: `Hexestra/${process.versions.electron}`,
          revision: process.versions.chrome,
          userAgent: this.contents.getUserAgent(),
          jsVersion: process.versions.v8,
        };
        break;
      case 'Browser.getWindowForTarget': {
        const bounds = this.getBounds();
        result = {
          windowId: this.contents.id,
          bounds: {
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            windowState: 'normal',
          },
        };
        break;
      }
      case 'Browser.addPrivacySandboxCoordinatorKeyConfig':
      case 'Browser.addPrivacySandboxEnrollmentOverride':
      case 'Browser.resetPermissions':
      case 'Browser.setDownloadBehavior':
      case 'Browser.setWindowBounds':
      case 'Browser.close':
        result = {};
        break;
      case 'Target.attachToBrowserTarget':
        this.attachedToBrowserTarget = true;
        result = { sessionId: this.browserSessionId };
        break;
      case 'Target.getBrowserContexts':
        result = { browserContextIds: [this.browserContextId] };
        break;
      case 'Target.getTargets':
        result = { targetInfos: [this.targetInfo()] };
        break;
      case 'Target.getTargetInfo':
        result = {
          targetInfo: typeof params.targetId === 'string' ? this.targetInfo() : this.browserTargetInfo(),
        };
        break;
      case 'Target.setDiscoverTargets':
        this.discoverTargets = params.discover === true;
        result = {};
        break;
      case 'Target.setAutoAttach':
        if (sessionId && sessionId !== this.browserSessionId) {
          throw new Error(`Unknown CDP session: ${sessionId}`);
        }
        if (params.flatten === false) throw new Error('Hexestra requires flattened CDP sessions');
        this.autoAttach = params.autoAttach === true;
        result = {};
        break;
      case 'Target.attachToTarget':
        if (params.targetId !== this.targetId) throw new Error('Unknown browser target');
        result = { sessionId: await this.attachToPageTarget() };
        break;
      case 'Target.detachFromTarget':
        if (typeof params.sessionId === 'string' && this.pageSessionIds.has(params.sessionId)) {
          await this.contents.debugger.sendCommand('Target.detachFromTarget', { sessionId: params.sessionId });
          this.pageSessionIds.delete(params.sessionId);
        }
        result = {};
        break;
      case 'Target.activateTarget':
        this.contents.focus();
        result = {};
        break;
      case 'Target.closeTarget':
        result = { success: false };
        break;
      case 'Target.createBrowserContext':
      case 'Target.createTarget':
      case 'Target.disposeBrowserContext':
        throw new Error(`${method} is unavailable for an existing integrated browser tab`);
      default:
        throw new Error(`Unsupported browser-level CDP method: ${method}`);
    }

    this.respond(request, result ?? {});

    if (method === 'Target.attachToBrowserTarget') {
      this.emit({
        method: 'Target.attachedToTarget',
        params: {
          sessionId: this.browserSessionId,
          targetInfo: this.browserTargetInfo(),
          waitingForDebugger: false,
        },
      });
    }
    if (method === 'Target.setDiscoverTargets' && this.discoverTargets) {
      this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.targetInfo() }, sessionId: this.browserSession() });
    }
    if (method === 'Target.setAutoAttach' && this.autoAttach) {
      await this.attachToPageTarget();
    }
  }

  private async attachToPageTarget(): Promise<string> {
    const existing = this.pageSessionIds.values().next().value as string | undefined;
    if (existing) return existing;
    if (!this.attachingTarget) {
      this.attachingTarget = this.contents.debugger
        .sendCommand('Target.attachToTarget', { targetId: this.targetId, flatten: true })
        .then((result) => {
          const sessionId = (result as { sessionId?: string }).sessionId;
          if (!sessionId) throw new Error('Electron did not create a page CDP session');
          this.pageSessionIds.add(sessionId);
          return sessionId;
        })
        .finally(() => { this.attachingTarget = null; });
    }
    return this.attachingTarget;
  }

  private targetInfo(): CdpTargetInfo {
    return {
      targetId: this.targetId,
      type: 'page',
      title: this.contents.getTitle(),
      url: this.contents.getURL(),
      attached: this.pageSessionIds.size > 0,
      canAccessOpener: false,
      browserContextId: this.browserContextId,
    };
  }

  private browserTargetInfo(): CdpTargetInfo {
    return {
      targetId: `hexestra-context-${this.browserContextId}`,
      type: 'browser',
      title: 'Hexestra',
      url: '',
      attached: true,
      canAccessOpener: false,
    };
  }

  private browserSession() {
    return this.attachedToBrowserTarget ? this.browserSessionId : undefined;
  }

  private respond(request: CdpRequest, result: unknown) {
    this.emit({ id: request.id, result, sessionId: request.sessionId });
  }

  private emit(message: object) {
    if (this.closed) return;
    debugCdp('response', message);
    queueMicrotask(() => this.onmessage?.(message));
  }
}

function isCdpRequest(value: object): value is CdpRequest {
  const request = value as Partial<CdpRequest>;
  return typeof request.id === 'number'
    && typeof request.method === 'string'
    && (request.sessionId === undefined || typeof request.sessionId === 'string');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function debugCdp(direction: 'request' | 'response', message: object) {
  if (process.env.HEXESTRA_BROWSER_CDP_DEBUG !== '1') return;
  process.stderr.write(`[BrowserCDP:${direction}] ${JSON.stringify(message)}\n`);
}
