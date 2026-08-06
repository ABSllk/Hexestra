import { useEffect, useState } from 'react';
import { DismissibleNotice, Icon, type IconName } from '@/components/shared';
import { useAppStore, useSessionStore, useTabStore } from '@/stores';
import { useAppPreferences, useI18n } from '@/i18n';

const hexestraLightLogo = new URL('../../../assets/branding/hexestra-logo-light.svg', import.meta.url).href;
const hexestraDarkLogo = new URL('../../../assets/branding/hexestra-logo-dark.svg', import.meta.url).href;

export function WelcomeTab() {
  const { t } = useI18n();
  const { resolvedTheme } = useAppPreferences();
  const openTab = useTabStore((state) => state.openTab);
  const setLeftPanelView = useAppStore((state) => state.setLeftPanelView);
  const openProjectFolder = useSessionStore((state) => state.openProjectFolder);
  const createProjectFolder = useSessionStore((state) => state.createProjectFolder);
  const loadSession = useSessionStore((state) => state.loadSession);
  const removeRecentProject = useSessionStore((state) => state.deleteSession);
  const loadSessionList = useSessionStore((state) => state.loadSessionList);
  const sessions = useSessionStore((state) => state.sessions);
  const currentSession = useSessionStore((state) => state.currentSession);
  const error = useSessionStore((state) => state.error);
  const [opening, setOpening] = useState<'open' | 'create' | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => {
    void loadSessionList();
  }, [loadSessionList]);

  useEffect(() => {
    if (!error) setDismissedError(null);
  }, [error]);

  const openTerminal = () => {
    openTab({ type: 'terminal', title: 'Terminal', closable: true });
  };

  const handleProjectFolder = async (mode: 'open' | 'create') => {
    setOpening(mode);
    try {
      if (mode === 'open') await openProjectFolder();
      else await createProjectFolder();
    } catch (openError) {
      console.error('Failed to open project folder:', openError);
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex h-full select-none flex-col items-center justify-start overflow-y-auto py-8">
      <img
        src={resolvedTheme === 'dark' ? hexestraDarkLogo : hexestraLightLogo}
        alt="Hexestra"
        className="mb-8 h-auto w-[22rem] max-w-[calc(100%-2rem)]"
      />

      <div className="flex w-72 flex-col gap-3">
        <QuickAction
          onClick={openTerminal}
          icon="terminal"
          title={t('welcome.newTerminal')}
          description={t('welcome.newTerminalDetail')}
        />
        <QuickAction
          onClick={() => void handleProjectFolder('open')}
          icon="folder"
          title={opening === 'open' ? t('welcome.opening') : t('welcome.openFolder')}
          description={t('welcome.openFolderDetail')}
        />
        <QuickAction
          onClick={() => void handleProjectFolder('create')}
          icon="target"
          title={opening === 'create' ? t('welcome.creating') : t('welcome.newProject')}
          description={t('welcome.newProjectDetail')}
        />
        <QuickAction
          onClick={() => openTab({ type: 'browser', title: 'Browser', closable: true })}
          icon="browser"
          title={t('welcome.openBrowser')}
          description={t('welcome.openBrowserDetail')}
        />
        <QuickAction
          onClick={() => setLeftPanelView('traffic')}
          icon="activity"
          title={t('welcome.openTraffic')}
          description={t('welcome.openTrafficDetail')}
        />
      </div>

      {error && error !== dismissedError && <DismissibleNotice tone="error" className="mt-4 w-72 text-2xs" onDismiss={() => setDismissedError(error)}>{error}</DismissibleNotice>}

      {sessions.length > 0 && (
        <div className="mt-6 w-72">
          <p className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-muted">
            {t('welcome.recentProjects')}
          </p>
          <div className="space-y-1">
            {sessions.slice(0, 5).map((session) => (
              <div
                key={session.id}
                className="group flex items-center rounded-md border border-transparent hover:border-surface hover:bg-bg-tertiary"
              >
                <button
                  onClick={() => void loadSession(session.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Icon name="folder" size={12} className="shrink-0 text-accent-teal" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text-secondary">{session.name}</span>
                    <span className="block truncate font-mono text-[9px] text-text-muted">
                      {session.basePath}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9px] text-text-muted">
                    {session.targetCount} targets
                  </span>
                </button>
                <button
                  type="button"
                  title="Remove from recent projects"
                  aria-label={`Remove ${session.name} from recent projects`}
                  onClick={() => void removeRecentProject(session.id)}
                  className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted opacity-0 hover:bg-surface hover:text-text-primary group-hover:opacity-100"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentSession && (
        <div className="mt-8 w-72 text-center text-2xs text-text-muted">
          <span className="block font-mono text-accent-teal">{currentSession.name}</span>
          <span
            className="mt-1 block truncate font-mono text-[9px]"
            title={currentSession.basePath}
          >
            {currentSession.basePath}
          </span>
        </div>
      )}

      <div className="mt-4 text-2xs text-text-muted/60">
        Press <kbd className="rounded bg-surface px-1 py-0.5 text-2xs">Ctrl+T</kbd> for a new terminal
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg border border-surface/40 bg-surface/65 px-4 py-3 text-left shadow-sm shadow-black/5 hover:-translate-y-px hover:border-accent-blue/25 hover:bg-surface-hover hover:shadow-md hover:shadow-black/15"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-surface-active/50 bg-bg-tertiary text-text-muted transition-colors group-hover:text-accent-blue">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="block text-2xs text-text-muted">{description}</span>
      </span>
    </button>
  );
}
