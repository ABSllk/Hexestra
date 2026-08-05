import { Icon, type IconName } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useAppStore } from '@/stores';
import type { LeftPanelView } from '@/stores/useAppStore';
import { AssetWorkspaceTab } from './AssetWorkspaceTab';
import { TaskTreeTab } from './TaskTreeTab';
import { SessionFilesTab } from './SessionFilesTab';
import { RecordsTab } from './RecordsTab';
import { ShellsTab } from './ShellsTab';
import { TrafficSidebar } from './TrafficSidebar';
import { useI18n } from '@/i18n';

const TABS: { id: LeftPanelView; labelKey: 'nav.assets' | 'nav.tasks' | 'nav.records' | 'nav.files' | 'nav.traffic' | 'nav.shells'; icon: IconName }[] = [
  { id: 'targets', labelKey: 'nav.assets', icon: 'target' },
  { id: 'tasktree', labelKey: 'nav.tasks', icon: 'layers' },
  { id: 'records', labelKey: 'nav.records', icon: 'vulnerability' },
  { id: 'files', labelKey: 'nav.files', icon: 'folder' },
  { id: 'traffic', labelKey: 'nav.traffic', icon: 'activity' },
  { id: 'shells', labelKey: 'nav.shells', icon: 'terminal' },
];

export function LeftPanelContainer() {
  const { t } = useI18n();
  const view = useAppStore((s) => s.leftPanelView);
  const setView = useAppStore((s) => s.setLeftPanelView);

  return (
    <div className="isolate flex h-full min-h-0 overflow-hidden">
      <nav
        aria-label="Primary sidebar"
        className="relative z-20 flex w-11 shrink-0 flex-col items-center gap-1 border-r border-surface bg-bg-tertiary py-1.5"
      >
        {TABS.map((tab) => (
          <div key={tab.id} className="group relative">
            <button
              type="button"
              aria-label={t(tab.labelKey)}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
              className={cn(
                'peer relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue',
                view === tab.id
                  ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue'
                  : 'border-transparent text-text-muted hover:border-surface/70 hover:bg-surface/35 hover:text-text-primary',
              )}
            >
              {view === tab.id && <span className="absolute -left-1 h-5 w-0.5 rounded-r bg-accent-blue" />}
              <Icon name={tab.icon} size={16} />
            </button>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-[calc(100%+6px)] top-1/2 z-30 -translate-x-1.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-surface/90 bg-bg-secondary/95 px-2.5 py-1.5 text-[10px] font-medium text-text-primary opacity-0 shadow-lg shadow-black/25 backdrop-blur-sm transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:opacity-100"
            >
              {t(tab.labelKey)}
            </span>
          </div>
        ))}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {view === 'targets' && <AssetWorkspaceTab />}
        {view === 'tasktree' && <TaskTreeTab />}
        {view === 'records' && <RecordsTab />}
        {view === 'files' && <SessionFilesTab />}
        {view === 'traffic' && <TrafficSidebar />}
        {view === 'shells' && <ShellsTab />}
      </div>
    </div>
  );
}
