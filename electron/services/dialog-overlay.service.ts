import { BrowserWindow, ipcMain, WebContentsView, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import {
  DIALOG_IPC,
  type ConfirmDialogOptions,
  type ConfirmDialogRequest,
  type ConfirmDialogResponse,
} from '../contracts/dialog';

interface PendingDialog extends ConfirmDialogRequest {
  resolve: (value: boolean) => void;
}

interface DialogRuntime {
  owner: BrowserWindow;
  view: WebContentsView;
  ready: boolean;
  active: PendingDialog | null;
  queue: PendingDialog[];
  resizeHandler: () => void;
}

export class DialogOverlayService {
  private readonly runtimes = new Map<number, DialogRuntime>();
  private sequence = 0;

  constructor() {
    ipcMain.handle(DIALOG_IPC.CONFIRM, (event, value: unknown) => this.confirm(event, value));
    ipcMain.handle(DIALOG_IPC.RESPOND, (event, value: unknown) => this.respond(event, value));
  }

  private confirm(event: IpcMainInvokeEvent, value: unknown): Promise<boolean> {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed()) throw new Error('Confirmation owner window was not found');
    const options = parseOptions(value);
    const runtime = this.ensureRuntime(owner);
    return new Promise<boolean>((resolve) => {
      const pending: PendingDialog = {
        ...options,
        id: `${owner.id}-${++this.sequence}`,
        resolve,
      };
      if (runtime.active) runtime.queue.push(pending);
      else {
        runtime.active = pending;
        this.show(runtime);
      }
    });
  }

  private respond(event: IpcMainInvokeEvent, value: unknown): boolean {
    const response = parseResponse(value);
    const runtime = [...this.runtimes.values()].find((item) => item.view.webContents.id === event.sender.id);
    if (!runtime || runtime.active?.id !== response.id) throw new Error('Confirmation request is no longer active');
    const completed = runtime.active;
    runtime.active = runtime.queue.shift() ?? null;
    completed.resolve(response.confirmed);
    if (runtime.active) this.show(runtime);
    else {
      runtime.view.setVisible(false);
      if (!runtime.owner.isDestroyed() && !runtime.owner.webContents.isDestroyed()) runtime.owner.webContents.focus();
    }
    return true;
  }

  private ensureRuntime(owner: BrowserWindow): DialogRuntime {
    const existing = this.runtimes.get(owner.id);
    if (existing && !existing.view.webContents.isDestroyed()) return existing;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    owner.contentView.addChildView(view);
    const runtime: DialogRuntime = { owner, view, ready: false, active: null, queue: [], resizeHandler: () => undefined };
    this.runtimes.set(owner.id, runtime);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.on('did-finish-load', () => {
      runtime.ready = true;
      if (runtime.active) this.dispatch(runtime);
    });
    view.webContents.on('render-process-gone', () => this.destroyRuntime(runtime));
    runtime.resizeHandler = () => this.layout(runtime);
    owner.on('resize', runtime.resizeHandler);
    owner.once('closed', () => this.destroyRuntime(runtime));
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      void view.webContents.loadURL(`${devUrl.replace(/\/$/, '')}/#/dialog-overlay`).catch(() => this.destroyRuntime(runtime));
    } else {
      void view.webContents.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/dialog-overlay' }).catch(() => this.destroyRuntime(runtime));
    }
    return runtime;
  }

  private show(runtime: DialogRuntime) {
    if (runtime.owner.isDestroyed()) return this.destroyRuntime(runtime);
    this.layout(runtime);
    runtime.owner.contentView.addChildView(runtime.view);
    runtime.view.setVisible(true);
    if (runtime.ready) this.dispatch(runtime);
  }

  private dispatch(runtime: DialogRuntime) {
    if (!runtime.active || runtime.view.webContents.isDestroyed()) return;
    const { resolve: _resolve, ...request } = runtime.active;
    runtime.view.webContents.send(DIALOG_IPC.REQUESTED, request);
    runtime.view.webContents.focus();
  }

  private layout(runtime: DialogRuntime) {
    if (runtime.owner.isDestroyed()) return;
    const [width, height] = runtime.owner.getContentSize();
    runtime.view.setBounds({ x: 0, y: 0, width, height });
  }

  private destroyRuntime(runtime: DialogRuntime) {
    if (this.runtimes.get(runtime.owner.id) !== runtime) return;
    this.runtimes.delete(runtime.owner.id);
    runtime.owner.removeListener('resize', runtime.resizeHandler);
    runtime.active?.resolve(false);
    for (const pending of runtime.queue.splice(0)) pending.resolve(false);
    if (!runtime.owner.isDestroyed()) runtime.owner.contentView.removeChildView(runtime.view);
    if (!runtime.view.webContents.isDestroyed()) runtime.view.webContents.close();
  }
}

function parseOptions(value: unknown): ConfirmDialogOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid confirmation request');
  const source = value as Record<string, unknown>;
  const title = boundedString(source.title, 'title', 160, false);
  const description = boundedString(source.description, 'description', 4_000, false);
  const details = boundedString(source.details, 'details', 12_000, true);
  const eyebrow = boundedString(source.eyebrow, 'eyebrow', 100, true);
  const confirmLabel = boundedString(source.confirmLabel, 'confirmLabel', 80, true);
  const cancelLabel = boundedString(source.cancelLabel, 'cancelLabel', 80, true);
  const tone = source.tone === 'danger' || source.tone === 'trust' || source.tone === 'default'
    ? source.tone
    : 'default';
  return { title, description, tone, ...(details ? { details } : {}), ...(eyebrow ? { eyebrow } : {}), ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}) };
}

function parseResponse(value: unknown): ConfirmDialogResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid confirmation response');
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || !source.id) throw new Error('Invalid confirmation response ID');
  if (typeof source.confirmed !== 'boolean') throw new Error('Invalid confirmation decision');
  return { id: source.id, confirmed: source.confirmed };
}

function boundedString(value: unknown, name: string, maximum: number, optional: boolean): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value.trim())) throw new Error(`Invalid confirmation ${name}`);
  return value.slice(0, maximum);
}

export const dialogOverlayService = new DialogOverlayService();
