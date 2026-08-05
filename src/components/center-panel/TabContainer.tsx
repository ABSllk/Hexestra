import { lazy, Suspense } from 'react';
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
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {activeTab === null && (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            No tabs open. Press
            <kbd className="mx-1 rounded bg-surface px-1.5 py-0.5 text-2xs">Ctrl+T</kbd>
            to open a new terminal.
          </div>
        )}

        {activeTab?.type === 'welcome' && <WelcomeTab />}
        {activeTab?.type === 'terminal' && <TerminalTab tabId={activeTab.id} />}
        {activeTab?.type === 'editor' && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-text-muted">Loading editor…</div>}>
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
