import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export type ButtonTone = 'neutral' | 'primary' | 'danger' | 'trust';
export type ButtonSize = 'compact' | 'default';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  leadingIcon?: IconName;
}

export function Button({ tone = 'neutral', size = 'default', leadingIcon, className, children, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'ui-button',
        size === 'compact' ? 'min-h-7 px-2 text-[11px]' : 'min-h-8 px-3 text-xs',
        tone === 'primary' && 'ui-button-primary',
        tone === 'danger' && 'ui-button-danger',
        tone === 'trust' && 'border-accent-teal/35 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/18',
        tone === 'neutral' && 'ui-button-neutral',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      {leadingIcon && <Icon name={leadingIcon} size={size === 'compact' ? 13 : 14} />}
      {children}
    </button>
  );
}

export function IconButton({ name, label, size = 16, className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { name: IconName; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('ui-icon-button disabled:cursor-not-allowed disabled:opacity-40', className)}
      {...props}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

export function PanelHeader({ title, description, count, actions, className }: { title: ReactNode; description?: ReactNode; count?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('ui-panel-header', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-primary">
          <span className="truncate">{title}</span>
          {count && <span className="shrink-0 font-mono text-[11px] font-normal text-text-muted">{count}</span>}
        </div>
        {description && <div className="mt-0.5 truncate text-[11px] text-text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('ui-toolbar', className)}>{children}</div>;
}

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex min-h-9 shrink-0 items-end gap-0.5 border-b border-border-subtle px-2', className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              'flex min-h-8 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[11px] transition-colors',
              active ? 'border-border-subtle bg-panel text-text-primary' : 'border-transparent text-text-muted hover:bg-raised/70 hover:text-text-secondary',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {item.icon && <Icon name={item.icon} size={13} />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn('ui-segmented flex items-center gap-0.5', className)} role="group">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn('ui-segmented-item min-h-7 px-2.5 text-[11px] transition-colors', active && 'ui-segmented-item-active', 'disabled:cursor-not-allowed disabled:opacity-40')}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function FormField({ label, htmlFor, hint, error, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="ui-field-label block">{label}</label>
      {hint && <p className="ui-field-help">{hint}</p>}
      {children}
      {error && <p role="alert" className="text-[11px] leading-4 text-severity-critical">{error}</p>}
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('ui-card', className)}>{children}</div>;
}

export function EmptyState({ icon = 'target', title, description, action, className }: { icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('ui-empty-state', className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-raised text-text-muted">
        <Icon name={icon} size={18} />
      </div>
      <p className="text-xs font-medium text-text-secondary">{title}</p>
      {description && <p className="max-w-xs text-[11px] leading-4 text-text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('ui-control h-8 w-full px-2.5 text-xs text-text-primary placeholder:text-text-muted', className)} {...props} />;
}
