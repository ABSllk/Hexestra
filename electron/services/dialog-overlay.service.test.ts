import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_IPC } from '../contracts/dialog';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: { id: number } }, value: unknown) => unknown>(),
  owner: null as unknown as ReturnType<typeof makeOwner>,
  latestView: null as unknown as MockView,
}));

class MockView {
  listeners = new Map<string, (...args: unknown[]) => void>();
  setVisible = vi.fn();
  setBounds = vi.fn();
  setBackgroundColor = vi.fn();
  webContents = {
    id: 777,
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    focus: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => this.listeners.set(name, callback)),
    loadURL: vi.fn(async () => { this.listeners.get('did-finish-load')?.(); }),
    loadFile: vi.fn(async () => { this.listeners.get('did-finish-load')?.(); }),
  };
  constructor() { mocks.latestView = this; }
}

function makeOwner() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    id: 3,
    isDestroyed: vi.fn(() => false),
    getContentSize: vi.fn(() => [1200, 800]),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { isDestroyed: vi.fn(() => false), focus: vi.fn() },
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => listeners.set(name, callback)),
    once: vi.fn((name: string, callback: (...args: unknown[]) => void) => listeners.set(name, callback)),
    removeListener: vi.fn(),
  };
}

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn((sender: { id: number }) => sender.id === 1 ? mocks.owner : null),
  },
  ipcMain: { handle: vi.fn((channel: string, handler: (event: { sender: { id: number } }, value: unknown) => unknown) => mocks.handlers.set(channel, handler)) },
  WebContentsView: MockView,
}));

describe('DialogOverlayService', () => {
  beforeEach(async () => {
    mocks.handlers.clear();
    mocks.owner = makeOwner();
    vi.resetModules();
    await import('./dialog-overlay.service');
  });

  it('reorders one overlay above child browser views without hiding them', async () => {
    const confirm = mocks.handlers.get(DIALOG_IPC.CONFIRM)!;
    const response = mocks.handlers.get(DIALOG_IPC.RESPOND)!;
    const decision = confirm({ sender: { id: 1 } }, { title: 'Delete?', description: 'Confirm removal.', tone: 'danger' }) as Promise<boolean>;
    await Promise.resolve();

    expect(mocks.owner.contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(mocks.owner.contentView.addChildView).toHaveBeenLastCalledWith(mocks.latestView);
    expect(mocks.latestView.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1200, height: 800 });
    expect(mocks.latestView.setVisible).toHaveBeenLastCalledWith(true);
    expect(mocks.latestView.webContents.send).toHaveBeenCalledWith(DIALOG_IPC.REQUESTED, expect.objectContaining({ title: 'Delete?' }));

    const request = mocks.latestView.webContents.send.mock.calls.at(-1)?.[1] as { id: string };
    response({ sender: { id: 777 } }, { id: request.id, confirmed: true });
    await expect(decision).resolves.toBe(true);
    expect(mocks.latestView.setVisible).toHaveBeenLastCalledWith(false);
    expect(mocks.owner.webContents.focus).toHaveBeenCalled();
  });
});
