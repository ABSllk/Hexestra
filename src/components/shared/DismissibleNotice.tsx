import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export type DismissibleNoticeTone = 'error' | 'warning' | 'success' | 'info';
export type DismissibleNoticeVariant = 'banner' | 'card';

const TONE_CLASSES: Record<DismissibleNoticeTone, string> = {
  error: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
  warning: 'border-accent-yellow/25 bg-accent-yellow/5 text-accent-yellow',
  success: 'border-accent-teal/25 bg-accent-teal/5 text-accent-teal',
  info: 'border-accent-blue/25 bg-accent-blue/5 text-accent-blue',
};

export function DismissibleNotice({
  children,
  tone = 'info',
  variant = 'card',
  className,
  onDismiss,
}: {
  children: ReactNode;
  tone?: DismissibleNoticeTone;
  variant?: DismissibleNoticeVariant;
  className?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex min-w-0 items-start gap-2 text-[10px]',
        variant === 'banner'
          ? 'shrink-0 border-b px-3 py-1.5'
          : 'rounded border px-3 py-2',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1 break-words">{children}</div>
      <button
        type="button"
        aria-label="Dismiss notice"
        title="Dismiss notice"
        className="ui-icon-button -mr-1 -mt-0.5 h-5 w-5 shrink-0 border-transparent bg-transparent text-current opacity-70 hover:bg-current/10 hover:text-current hover:opacity-100"
        onClick={onDismiss}
      >
        <Icon name="close" size={10} />
      </button>
    </div>
  );
}
