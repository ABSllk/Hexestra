import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { useChatStore, useTabStore } from '@/stores';
import { openBrowserTab } from '@/stores/useTabStore';
import {
  BROWSER_IPC,
  type BrowserIdentity,
  type BrowserState,
  type BrowserStateChangedEvent,
} from '@electron/contracts/browser';
import { TRAFFIC_IPC, type TrafficProfileState } from '@electron/contracts/traffic';
import { useI18n } from '@/i18n';

const DEFAULT_BROWSER_URL = 'https://example.com/';

const DEFAULT_BROWSER_STATE: BrowserState = {
  url: DEFAULT_BROWSER_URL,
  title: 'Browser',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  visible: false,
  scopeState: 'out_of_scope',
  error: null,
};

export function BrowserTab({ tabId }: { tabId: string }) {
  const { t } = useI18n();
  const projectId = useTabStore((state) => state.projectId);
  const tab = useTabStore((state) => state.tabs.find((candidate) => candidate.id === tabId));
  const updateTabData = useTabStore((state) => state.updateTabData);
  const updateTabTitle = useTabStore((state) => state.updateTabTitle);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const readyRef = useRef(false);
  const nextInitialNavigation = {
    projectId,
    tabId,
    url: (tab?.data?.url as string | undefined) ?? DEFAULT_BROWSER_URL,
    postBody: tab?.data?.postBody,
  };
  const initialNavigationRef = useRef(nextInitialNavigation);
  if (initialNavigationRef.current.projectId !== projectId || initialNavigationRef.current.tabId !== tabId) {
    initialNavigationRef.current = nextInitialNavigation;
  }
  const [address, setAddress] = useState(initialNavigationRef.current.url);
  const [browserState, setBrowserState] = useState(DEFAULT_BROWSER_STATE);

  const identity = useMemo<BrowserIdentity | null>(
    () => projectId ? { projectId, tabId } : null,
    [projectId, tabId],
  );

  const applyState = useCallback((state: BrowserState) => {
    setBrowserState(state);
    if (state.url) {
      setAddress(state.url);
      updateTabData(tabId, { url: state.url });
    }
    updateTabTitle(tabId, state.title || 'Browser');
  }, [tabId, updateTabData, updateTabTitle]);

  const sendLayout = useCallback((visible: boolean) => {
    if (!identity || !window.hexestra || !readyRef.current) return;
    const rect = placeholderRef.current?.getBoundingClientRect();
    if (rect) {
      lastBoundsRef.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    void window.hexestra.invoke(BROWSER_IPC.SET_LAYOUT, {
      ...identity,
      visible,
      bounds: lastBoundsRef.current,
    }).catch((error) => console.error('[Browser] Failed to update layout:', error));
  }, [identity]);

  useEffect(() => {
    if (!identity || !window.hexestra) return;
    return window.hexestra.on(BROWSER_IPC.STATE_CHANGED, (value: unknown) => {
      if (!isBrowserStateEvent(value)) return;
      if (value.projectId !== identity.projectId || value.tabId !== identity.tabId) return;
      applyState(value.state);
    });
  }, [applyState, identity]);

  useEffect(() => {
    if (!identity || !window.hexestra) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    const initialize = async () => {
      const initialNavigation = initialNavigationRef.current;
      setAddress(initialNavigation.url);
      setBrowserState({ ...DEFAULT_BROWSER_STATE, url: initialNavigation.url });
      try {
        // Respect the project-level capture preference. An enabled profile is
        // restored before navigation; an explicitly disabled profile keeps the
        // isolated Browser Session in direct mode.
        const traffic = await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, identity.projectId);
        if (traffic.profile.enabled) {
          await window.hexestra.invoke(TRAFFIC_IPC.START, identity.projectId);
        }
        const state = await window.hexestra.invoke<BrowserState>(BROWSER_IPC.ENSURE, {
          ...identity,
          url: initialNavigation.url,
          ...(initialNavigation.postBody ? { postBody: initialNavigation.postBody } : {}),
        });
        readyRef.current = true;
        if (disposed) {
          const rect = placeholderRef.current?.getBoundingClientRect() ?? new DOMRect();
          await window.hexestra.invoke(BROWSER_IPC.SET_LAYOUT, {
            ...identity,
            visible: false,
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
          return;
        }
        applyState(state);
        sendLayout(true);
        if (placeholderRef.current) {
          observer = new ResizeObserver(() => sendLayout(true));
          observer.observe(placeholderRef.current);
        }
      } catch (error) {
        if (!disposed) {
          setBrowserState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
        }
      }
    };

    const onWindowResize = () => sendLayout(true);
    window.addEventListener('resize', onWindowResize);
    void initialize();

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      sendLayout(false);
      readyRef.current = false;
    };
  }, [applyState, identity, sendLayout]);

  const invoke = async (channel: string, request: Record<string, unknown> = {}) => {
    if (!identity || !window.hexestra) return;
    try {
      const state = await window.hexestra.invoke<BrowserState>(channel, { ...identity, ...request });
      if (state && typeof state === 'object') applyState(state);
    } catch (error) {
      setBrowserState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    }
  };

  const navigate = () => {
    setBrowserState((current) => ({ ...current, loading: true, error: null }));
    void invoke(BROWSER_IPC.NAVIGATE, { url: address });
  };

  const copyAddress = () => {
    if (window.hexestra) void window.hexestra.invoke('clipboard:write-text', browserState.url);
  };

  const askAgent = () => {
    if (!identity) return;
    useChatStore.getState().queueAgentContext({
      kind: 'browser-page',
      projectId: identity.projectId,
      tabId: identity.tabId,
      url: browserState.url,
      title: browserState.title,
    }, 'Analyze the current browser page.');
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary text-xs text-text-muted">
        {t('browser.openProject')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-surface bg-bg-tertiary/80 px-2">
        <BrowserButton label={t('browser.back')} disabled={!browserState.canGoBack} onClick={() => void invoke(BROWSER_IPC.BACK)}>
          <Icon name="chevron-right" size={13} className="rotate-180" />
        </BrowserButton>
        <BrowserButton label={t('browser.forward')} disabled={!browserState.canGoForward} onClick={() => void invoke(BROWSER_IPC.FORWARD)}>
          <Icon name="chevron-right" size={13} />
        </BrowserButton>
        <BrowserButton label={t('browser.reload')} onClick={() => void invoke(BROWSER_IPC.RELOAD)}>
          <Icon name="activity" size={13} />
        </BrowserButton>
        <BrowserButton label={t('browser.newTab')} onClick={() => openBrowserTab()}>
          <Icon name="plus" size={13} />
        </BrowserButton>
        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
          <input
            aria-label={t('browser.address')}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="ui-control h-6 w-full px-2 font-mono text-2xs"
          />
        </form>
        <BrowserButton label={t('browser.copyAddress')} onClick={copyAddress}>
          <Icon name="copy" size={13} />
        </BrowserButton>
        <BrowserButton label={t('browser.askAgent')} onClick={askAgent}>
          <Icon name="message" size={13} />
        </BrowserButton>
        <span
          className={`w-12 text-center text-[9px] ${browserState.error ? 'text-severity-high' : 'text-text-muted'}`}
          title={browserState.error ?? (browserState.scopeState === 'out_of_scope'
            ? t('browser.outOfScopeHint')
            : undefined)}
        >
          {browserState.error ? t('browser.error') : browserState.loading ? t('browser.loading') : browserState.scopeState === 'out_of_scope' ? t('browser.outOfScope') : t('browser.ready')}
        </span>
      </div>
      <div
        ref={placeholderRef}
        aria-label={t('browser.viewport')}
        className="min-h-0 flex-1 bg-white"
      />
    </div>
  );
}

function BrowserButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="ui-icon-button p-1 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function isBrowserStateEvent(value: unknown): value is BrowserStateChangedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<BrowserStateChangedEvent>;
  return typeof event.projectId === 'string'
    && typeof event.tabId === 'string'
    && !!event.state
    && typeof event.state.url === 'string';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
