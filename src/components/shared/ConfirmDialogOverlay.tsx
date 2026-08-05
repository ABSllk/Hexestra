import { useEffect, useRef, useState } from 'react';
import { DIALOG_IPC, type ConfirmDialogRequest } from '@electron/contracts/dialog';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export function ConfirmDialogOverlay() {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => window.hexestra.on(DIALOG_IPC.REQUESTED, (value: unknown) => {
    setRequest(value as ConfirmDialogRequest);
  }), []);

  useEffect(() => {
    if (!request) return;
    (request.tone === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, [request]);

  if (!request) return null;
  const finish = (confirmed: boolean) => {
    const completed = request;
    setRequest(null);
    void window.hexestra.invoke(DIALOG_IPC.RESPOND, { id: completed.id, confirmed });
  };
  const tone = request.tone ?? 'default';
  const accent = tone === 'danger' ? 'text-severity-high' : tone === 'trust' ? 'text-accent-teal' : 'text-accent-blue';
  const border = tone === 'danger' ? 'border-severity-high/35' : tone === 'trust' ? 'border-accent-teal/35' : 'border-accent-blue/35';

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-bg-primary/75 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && finish(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        } else if (event.key === 'Tab') {
          const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
          if (!buttons.length) return;
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.shiftKey ? (index - 1 + buttons.length) % buttons.length : (index + 1) % buttons.length;
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" className={cn('ui-popover w-full max-w-[28rem] overflow-hidden border shadow-[0_24px_80px_rgba(0,0,0,0.55)]', border)}>
        <div className="flex items-start gap-3 border-b border-surface/80 px-4 py-3.5">
          <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-bg-primary/60', border, accent)}>
            <Icon name={tone === 'trust' ? 'shield' : 'alert'} size={15} />
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-text-muted">{request.eyebrow ?? 'Hexestra confirmation'}</div>
            <h2 id="confirm-title" className="text-[13px] font-semibold text-text-primary">{request.title}</h2>
          </div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p id="confirm-description" className="whitespace-pre-line text-[11px] leading-5 text-text-secondary">{request.description}</p>
          {request.details && <div className="max-h-36 overflow-auto rounded-md border border-surface/75 bg-bg-primary/55 px-3 py-2 font-mono text-[9px] leading-4 text-text-muted">{request.details}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-surface/80 bg-bg-primary/25 px-4 py-3">
          <button ref={cancelRef} type="button" className="ui-control min-w-20 px-3 py-1.5 text-[10px] text-text-secondary" onClick={() => finish(false)}>{request.cancelLabel ?? 'Cancel'}</button>
          <button ref={confirmRef} type="button" className={cn('ui-control min-w-24 px-3 py-1.5 text-[10px] font-semibold', accent, tone === 'danger' && 'border-severity-high/35 bg-severity-high/5 hover:bg-severity-high/10')} onClick={() => finish(true)}>{request.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
