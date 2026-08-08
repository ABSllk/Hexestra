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
    <div className="flex h-full select-none flex-col items-center justify-start overflow-y-auto bg-panel py-8">
      <img
        src={resolvedTheme === 'dark' ? hexestraDarkLogo : hexestraLightLogo}
        alt="Hexestra"
        className="mb-7 h-auto w-[19rem] max-w-[calc(100%-2rem)]"
      />

      <div className="flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2.5">
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

      {error && error !== dismissedError && <DismissibleNotice tone="error" className="mt-4 w-[min(24rem,calc(100%-2rem))]" onDismiss={() => setDismissedError(error)}>{error}</DismissibleNotice>}

      {sessions.length > 0 && (
        <div className="mt-6 w-[min(24rem,calc(100%-2rem))]">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
            {t('welcome.recentProjects')}
          </p>
          <div className="space-y-1">
            {sessions.slice(0, 5).map((session) => (
              <div
                key={session.id}
                className="group flex items-center rounded-lg border border-transparent hover:border-border-subtle hover:bg-raised"
              >
                <button
                  onClick={() => void loadSession(session.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <Icon name="folder" size={12} className="shrink-0 text-accent-teal" />
                  <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text-secondary">{session.name}</span>
                    <span className="block truncate font-mono text-[11px] text-text-muted">
                      {session.basePath}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {session.targetCount} targets
                  </span>
                </button>
                <button
                  type="button"
                  title="Remove from recent projects"
                  aria-label={`Remove ${session.name} from recent projects`}
                  onClick={() => void removeRecentProject(session.id)}
                  className="ui-icon-button mr-1 h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentSession && (
        <div className="mt-8 w-[min(24rem,calc(100%-2rem))] text-center text-[11px] text-text-muted">
          <span className="block font-mono text-accent-teal">{currentSession.name}</span>
          <span
            className="mt-1 block truncate font-mono text-[11px]"
            title={currentSession.basePath}
          >
            {currentSession.basePath}
          </span>
        </div>
      )}

      <div className="mt-4 text-[11px] text-text-muted/70">
        Press <kbd className="rounded-md border border-border-subtle bg-raised px-1.5 py-0.5 text-[11px]">Ctrl+T</kbd> for a new terminal
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
      className="group flex min-h-[68px] items-center gap-3 rounded-lg border border-border-subtle/80 bg-raised/75 px-4 py-3 text-left shadow-sm shadow-black/5 transition-colors hover:border-accent-blue/35 hover:bg-raised hover:shadow-md hover:shadow-black/10"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border-strong/60 bg-canvas text-text-muted transition-colors group-hover:border-accent-blue/35 group-hover:text-accent-blue">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-text-primary">{title}</span>
        <span className="block text-[11px] text-text-muted">{description}</span>
      </span>
    </button>
  );
}
