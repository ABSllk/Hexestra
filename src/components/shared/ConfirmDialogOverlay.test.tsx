import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_IPC, type ConfirmDialogRequest } from '@electron/contracts/dialog';
import { ConfirmDialogOverlay } from './ConfirmDialogOverlay';

describe('ConfirmDialogOverlay', () => {
  const invoke = vi.fn(async () => true);
  let listener: ((value: unknown) => void) | undefined;

  beforeEach(() => {
    invoke.mockClear();
    listener = undefined;
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: (value: unknown) => void) => {
          if (channel === DIALOG_IPC.REQUESTED) listener = callback;
          return () => undefined;
        }),
        once: vi.fn(),
        send: vi.fn(),
      },
    });
  });

  it('renders above native browser views and reports the decision', async () => {
    render(<ConfirmDialogOverlay />);
    const request: ConfirmDialogRequest = {
      id: '1-1',
      title: 'Clear traffic?',
      description: 'This removes local history.',
      tone: 'danger',
      cancelLabel: 'Cancel',
      confirmLabel: 'Clear',
    };
    act(() => listener?.(request));
    expect(screen.getByRole('alertdialog', { name: 'Clear traffic?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(invoke).toHaveBeenCalledWith(DIALOG_IPC.RESPOND, { id: '1-1', confirmed: true });
  });
});
