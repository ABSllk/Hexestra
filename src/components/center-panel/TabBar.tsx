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
  settings: 'settings',
  welcome: 'home',
};

export function TabBar() {
  const { t } = useI18n();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar shrink-0 gap-0.5 px-1.5 pt-1">
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
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            'group flex min-w-0 max-w-[180px] cursor-pointer select-none items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs',
            activeTabId === tab.id
              ? 'border-surface/80 bg-bg-primary text-text-primary shadow-sm shadow-black/10'
              : 'border-transparent bg-transparent text-text-muted hover:border-surface/35 hover:bg-surface/25 hover:text-text-secondary',
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
              className="shrink-0 rounded-sm p-0.5 text-text-muted opacity-0 transition-all hover:bg-surface hover:text-text-primary group-hover:opacity-100"
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
