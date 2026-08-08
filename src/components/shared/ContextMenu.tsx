import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void | Promise<void>;
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  returnFocus,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const enabledItems = useMemo(() => items.filter((item) => !item.disabled), [items]);

  useEffect(() => {
    if (!open) return;
    const previous = returnFocus ?? document.activeElement as HTMLElement | null;
    const close = () => {
      onClose();
      window.setTimeout(() => previous?.focus(), 0);
    };
    const handlePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const handleKey = (event: KeyboardEvent) => {
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + delta + buttons.length) % buttons.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    window.setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(), 0);
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [enabledItems.length, onClose, open, returnFocus]);

  if (!open) return null;
  const left = Math.min(x, Math.max(8, window.innerWidth - 252));
  const top = Math.min(y, Math.max(8, window.innerHeight - Math.min(480, items.length * 31 + 16)));
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className="ui-popover fixed z-[200] w-60 overflow-y-auto p-1.5 shadow-2xl"
      style={{ left, top, maxHeight: 'min(30rem, calc(100vh - 16px))' }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="my-1 border-t border-border-subtle" />}
          <button
            role="menuitem"
            disabled={item.disabled}
            className={cn(
              'flex min-h-7 w-full rounded-md px-2.5 py-1.5 text-left text-[11px] outline-none hover:bg-raised/55 focus:bg-raised/70 disabled:cursor-not-allowed disabled:opacity-35',
              item.danger ? 'text-severity-high' : 'text-text-secondary',
            )}
            onClick={() => {
              onClose();
              window.setTimeout(() => returnFocus?.focus(), 0);
              void item.onSelect();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
