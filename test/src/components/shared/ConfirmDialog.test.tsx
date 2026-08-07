import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_IPC } from '@electron/contracts/dialog';
import { ConfirmDialogProvider, useConfirmDialog } from '@/components/shared/ConfirmDialog';

function Harness() {
  const confirm = useConfirmDialog();
  const [result, setResult] = useState('none');
  return (
    <>
      <button type="button" onClick={() => void confirm({
        title: 'Delete Traffic Flow?',
        description: 'Remove the local Flow record.',
        details: 'Burp history remains.',
        confirmLabel: 'Delete Flow',
        tone: 'danger',
      }).then((approved) => setResult(approved ? 'approved' : 'cancelled'))}>Open confirmation</button>
      <span>{result}</span>
    </>
  );
}

describe('ConfirmDialog', () => {
  const invoke = vi.fn(async () => true);

  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
    });
  });

  it('delegates the confirmation to the native overlay and returns its decision', async () => {
    render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(DIALOG_IPC.CONFIRM, {
      eyebrow: 'Hexestra confirmation',
      cancelLabel: 'Cancel',
      confirmLabel: 'Delete Flow',
      title: 'Delete Traffic Flow?',
      description: 'Remove the local Flow record.',
      details: 'Burp history remains.',
      tone: 'danger',
    }));
    expect(await screen.findByText('approved')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
