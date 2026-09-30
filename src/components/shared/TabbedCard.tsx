import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export interface CardTab<T extends string> { id: T; label: ReactNode; count?: number; icon?: IconName }

/** Attached tabs share their selected page's surface, without an intervening border. */
export function TabbedCard<T extends string>({ items, value, onChange, children, label, className, surface = 'panel', scrollable = false, outlined = true }: { items: CardTab<T>[]; value: T; onChange: (value: T) => void; children: ReactNode; label?: string; className?: string; surface?: 'panel' | 'canvas'; scrollable?: boolean; outlined?: boolean }) {
  const id = useId();
  const panelId = `${id}-page`;
  const tabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tabList = tabListRef.current;
    if (!scrollable || !tabList) return;
    const onWheel = (event: WheelEvent) => {
      const limit = tabList.scrollWidth - tabList.clientWidth;
      if (limit <= 0 || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? tabList.clientWidth : 1;
      const next = Math.max(0, Math.min(limit, tabList.scrollLeft + event.deltaY * unit));
      if (next === tabList.scrollLeft) return;
      event.preventDefault();
      tabList.scrollLeft = next;
    };
    tabList.addEventListener('wheel', onWheel, { passive: false });
    return () => tabList.removeEventListener('wheel', onWheel);
  }, [scrollable]);

  return <div data-surface={surface} data-outlined={outlined} className={cn('ui-tab-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden', className)}>
    <div ref={tabListRef} role="tablist" aria-label={label} data-scrollable={scrollable} className={cn('ui-attached-tabs flex shrink-0 items-stretch gap-1', scrollable && 'overflow-x-auto')}>
      {items.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="tab" aria-label={typeof item.label === 'string' && item.count !== undefined ? `${item.label} ${item.count}` : undefined} aria-selected={value === item.id} aria-controls={panelId} tabIndex={value === item.id ? 0 : -1} title={typeof item.label === 'string' ? item.label : undefined}
        onClick={() => onChange(item.id)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
          onChange(items[next].id);
          document.getElementById(`${id}-${items[next].id}`)?.focus();
        }}
        className={cn('ui-attached-tab flex min-h-9 min-w-0 items-center justify-center py-1.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', scrollable ? 'shrink-0 gap-2 px-3' : 'flex-1 flex-col gap-0.5 px-1')}>
        {item.icon && <Icon name={item.icon} size={14} />}
        <span className="max-w-full truncate">{item.label}</span>
        {item.count !== undefined && <span className="font-mono text-[10px] opacity-65">{item.count}</span>}
      </button>)}
    </div>
    <div id={panelId} role="tabpanel" aria-labelledby={`${id}-${value}`} className="ui-tab-page flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
  </div>;
}
