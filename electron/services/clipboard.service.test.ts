import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: {
    readText: electronMocks.readText,
    writeText: electronMocks.writeText,
  },
  ipcMain: { handle: electronMocks.handle },
}));

import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips terminal text through the native clipboard', () => {
    electronMocks.readText.mockReturnValue('copied output');
    const service = new ClipboardService(false);

    expect(service.readText()).toBe('copied output');
    service.writeText('paste input');

    expect(electronMocks.readText).toHaveBeenCalledWith('clipboard');
    expect(electronMocks.writeText).toHaveBeenCalledWith('paste input', 'clipboard');
  });

  it('rejects non-text and oversized clipboard payloads', () => {
    const service = new ClipboardService(false);
    expect(() => service.writeText({ text: 'unsafe' })).toThrow('must be a string');
    expect(() => service.writeText('x'.repeat(4 * 1024 * 1024 + 1))).toThrow('4 MB');
  });
});
