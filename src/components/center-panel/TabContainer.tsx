import { lazy, Suspense } from 'react';
import { EmptyState } from '@/components/shared';
import { useI18n } from '@/i18n';
import { useTabStore } from '@/stores';
import { TabBar } from './TabBar';
import { TerminalTab } from './tabs/TerminalTab';
import { WelcomeTab } from './tabs/WelcomeTab';
import { BrowserTab } from './tabs/BrowserTab';
import { ReportTab } from './tabs/ReportTab';
import { SettingsTab } from './tabs/SettingsTab';
import { RecordDetailTab } from './tabs/RecordDetailTab';
import { TrafficDetailTab } from './tabs/TrafficDetailTab';
import { TrafficReplayTab } from './tabs/TrafficReplayTab';

const EditorTab = lazy(() =>
  import('./tabs/EditorTab').then((module) => ({ default: module.EditorTab })),
);

export function TabContainer() {
  const { t } = useI18n();
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {activeTab === null && (
          <EmptyState
            icon="layers"
            title={t('tabs.emptyTitle')}
            description={t('tabs.emptyHint')}
            action={<kbd className="rounded-md border border-border-subtle bg-raised px-2 py-1 font-mono text-[11px] text-text-secondary">Ctrl+T</kbd>}
          />
        )}

        {activeTab?.type === 'welcome' && <WelcomeTab />}
        {activeTab?.type === 'terminal' && <TerminalTab tabId={activeTab.id} />}
        {activeTab?.type === 'editor' && (
          <Suspense fallback={<EmptyState icon="code" title={t('tabs.loadingEditor')} />}>
            <EditorTab tabId={activeTab.id} />
          </Suspense>
        )}
        {activeTab?.type === 'browser' && <BrowserTab tabId={activeTab.id} />}
        {activeTab?.type === 'traffic' && <TrafficDetailTab tabId={activeTab.id} />}
        {activeTab?.type === 'replay' && <TrafficReplayTab tabId={activeTab.id} />}
        {activeTab?.type === 'report' && <ReportTab tabId={activeTab.id} />}
        {activeTab?.type === 'record' && <RecordDetailTab tabId={activeTab.id} />}
        {activeTab?.type === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
