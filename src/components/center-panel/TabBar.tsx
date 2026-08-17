import { useEffect, useRef, type WheelEvent } from 'react';
import { Icon, type IconName } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useTabStore } from '@/stores';
import { useI18n } from '@/i18n';

const TAB_ICONS: Record<string, IconName> = {
  terminal: 'terminal',
  editor: 'code',
  browser: 'browser',
  traffic: 'activity',
  replay: 'send',
  report: 'report',
  workflow: 'sparkles',
  refinery: 'sparkles',
  settings: 'settings',
  welcome: 'home',
};

export function TabBar() {
  const tabListRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const tabList = event.currentTarget;
    const isVerticalGesture = Math.abs(event.deltaY) > Math.abs(event.deltaX);
    if (!isVerticalGesture || tabList.scrollWidth <= tabList.clientWidth) return;

    tabList.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  if (tabs.length === 0) return null;

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label={t('tabs.workspace')}
      className="tab-bar shrink-0 gap-0.5 border-border-subtle bg-panel px-2 pt-1"
      onWheel={handleWheel}
    >
      {tabs.map((tab) => {
        const title = tab.type === 'settings' && tab.title === 'Settings'
          ? t('common.settings')
          : tab.type === 'welcome' && tab.title === 'Welcome'
            ? t('nav.welcome')
            : tab.type === 'browser' && tab.title === 'Browser'
              ? t('nav.browser')
              : tab.title;
        return (
        <div
          key={tab.id}
          role="tab"
          tabIndex={activeTabId === tab.id ? 0 : -1}
          aria-selected={activeTabId === tab.id}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setActiveTab(tab.id);
              return;
            }
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const direction = event.key === 'ArrowLeft' ? -1 : 1;
              const currentIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
              const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (currentIndex + direction + tabs.length) % tabs.length;
              const nextTab = tabs[nextIndex];
              if (nextTab) {
                setActiveTab(nextTab.id);
                (event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex] as HTMLElement | undefined)?.focus();
              }
            }
          }}
          className={cn(
            'group flex min-h-8 w-40 flex-none cursor-pointer select-none items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
            activeTabId === tab.id
              ? 'border-border-subtle bg-panel text-text-primary shadow-sm shadow-black/10'
              : 'border-transparent bg-transparent text-text-muted hover:border-border-subtle/60 hover:bg-raised/60 hover:text-text-secondary',
          )}
        >
          <Icon name={TAB_ICONS[tab.type] ?? 'file'} size={14} />
          <span className="flex-1 truncate">{title}</span>
          {tab.closable && (
            <button
              aria-label={`${t('common.close')} ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              className="ui-icon-button h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}
