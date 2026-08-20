import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type SettingsListStatus = 'success' | 'muted' | 'warning' | 'error';

const STATUS_DOT_CLASSES: Record<SettingsListStatus, string> = {
  success: 'bg-status-success',
  muted: 'bg-text-muted',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};

export function SettingsListRow({
  selected = false,
  onSelect,
  ariaLabel,
  title,
  meta,
  badge,
  description,
  status = 'muted',
  statusLabel,
  actions,
}: {
  selected?: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  status?: SettingsListStatus;
  statusLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cn(
      'group flex items-start gap-1 rounded-md border p-1 transition-colors duration-150',
      selected
        ? 'border-accent-blue/35 bg-accent-blue/8'
        : 'border-transparent hover:border-border-subtle hover:bg-raised/35',
    )}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onSelect}
        className="min-w-0 flex-1 rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASSES[status])}
          />
          {statusLabel && <span className="sr-only">{statusLabel}</span>}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{title}</span>
          {meta && <span className="shrink-0 font-mono text-[10px] text-text-muted">{meta}</span>}
          {badge && <span className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-accent-blue">{badge}</span>}
        </div>
        {description && <div className="mt-1.5 line-clamp-2 break-words text-[11px] leading-4 text-text-muted">{description}</div>}
      </button>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
