import { useCallback, useEffect, useMemo, useState } from 'react';
import { ContextMenu, DismissibleNotice, Icon, useConfirmDialog, type ContextMenuItem } from '@/components/shared';
import { cn } from '@/lib/cn';
import { formatFlowAsCurl, formatRawRequest, formatRawResponse } from '@/lib/trafficExport';
import { useChatStore, useSessionStore, useTabStore } from '@/stores';
import { openReplayTab, openSettingsTab, openTrafficFlowTab } from '@/stores/useTabStore';
import {
  DEFAULT_PROXY_PROFILE,
  TRAFFIC_IPC,
  type InterceptDecision,
  type ProxyProfile,
  type ReplaySession,
  type TrafficChangedEvent,
  type TrafficClearResult,
  type TrafficDeleteResult,
  type TrafficFlow,
  type TrafficFlowState,
  type TrafficListResult,
  type TrafficProfileState,
  type TrafficScopeState,
  type TrafficSummary,
} from '@electron/contracts/traffic';
import { useI18n } from '@/i18n';

const PAGE_SIZE = 50;
const EMPTY_LIST: TrafficListResult = { items: [], total: 0, offset: 0, limit: PAGE_SIZE };
type StatusFilter = 'all' | 'paused' | 'completed' | 'failed';
type ScopeFilter = 'all' | TrafficScopeState;
type SourceFilter = 'all' | TrafficSummary['source'];

export function TrafficSidebar() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const projectId = useSessionStore((state) => state.currentSession?.id ?? null);
  const activeFlowId = useTabStore((state) => {
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    return active?.type === 'traffic' && typeof active.data?.flowId === 'string' ? active.data.flowId : null;
  });
  const [profileState, setProfileState] = useState<TrafficProfileState | null>(null);
  const [flows, setFlows] = useState(EMPTY_LIST);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [host, setHost] = useState('');
  const [parentFlowId, setParentFlowId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedPersistentNotices, setDismissedPersistentNotices] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ flow: TrafficSummary; x: number; y: number; target: HTMLElement } | null>(null);

  const loadProfile = useCallback(async () => {
    if (!projectId) return;
    setProfileState(await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, projectId));
  }, [projectId]);

  const listQuery = useMemo(() => ({
    query,
    ...(status === 'paused' ? { states: ['request_paused', 'response_paused'] as TrafficFlowState[] } : status === 'all' ? {} : { state: status }),
    ...(scope === 'all' ? {} : { scopeState: scope }),
    ...(source === 'all' ? {} : { source }),
    ...(host ? { host } : {}),
    ...(parentFlowId ? { parentFlowId } : {}),
  }), [host, parentFlowId, query, scope, source, status]);

  const loadFlows = useCallback(async (append = false) => {
    if (!projectId) return;
    const offset = append ? flows.items.length : 0;
    const next = await window.hexestra.invoke<TrafficListResult>(TRAFFIC_IPC.LIST, projectId, {
      ...listQuery,
      offset,
      limit: PAGE_SIZE,
    });
    setFlows(append ? { ...next, items: [...flows.items, ...next.items], offset: 0 } : next);
  }, [flows.items, listQuery, projectId]);

  useEffect(() => {
    setProfileState(null);
    setFlows(EMPTY_LIST);
    setError(null);
    setNotice(null);
    setDismissedPersistentNotices([]);
    if (!projectId) return;
    void loadProfile().catch((loadError) => setError(errorMessage(loadError)));
  }, [loadProfile, projectId]);

  useEffect(() => {
    if (!projectId) return;
    const timer = window.setTimeout(() => {
      void loadFlows(false).catch((loadError) => setError(errorMessage(loadError)));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [listQuery, projectId]); // loadFlows changes with pagination state

  useEffect(() => window.hexestra.on(TRAFFIC_IPC.CHANGED, (value) => {
    const event = value as TrafficChangedEvent;
    if (event.projectId !== projectId) return;
    if (event.profile) void loadProfile();
    void loadFlows(false);
  }), [loadFlows, loadProfile, projectId]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await Promise.all([loadProfile(), loadFlows(false)]);
    } catch (actionError) {
      setError(errorMessage(actionError));
      await loadFlows(false).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = (patch: Partial<ProxyProfile>) => {
    if (!projectId) return;
    const current = profileState?.profile ?? DEFAULT_PROXY_PROFILE;
    void run(() => window.hexestra.invoke(TRAFFIC_IPC.UPDATE_PROFILE, projectId, { ...current, ...patch, burp: patch.burp ?? current.burp }));
  };

  const readFlow = async (flow: TrafficSummary) => {
    if (!projectId) throw new Error('Open a project first');
    return window.hexestra.invoke<TrafficFlow>(TRAFFIC_IPC.READ, projectId, flow.id);
  };

  const writeClipboard = (value: string) => window.hexestra.invoke('clipboard:write-text', value);

  const openRepeater = async (flow: TrafficSummary) => {
    if (!projectId) return;
    const session = await window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_OPEN, projectId, flow.id);
    openReplayTab(session, `Repeater · ${flow.method} ${flow.host}`);
  };

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu || !projectId) return [];
    const flow = menu.flow;
    const paused = flow.state === 'request_paused' || flow.state === 'response_paused';
    const terminal = flow.state === 'completed' || flow.state === 'failed' || flow.state === 'dropped';
    const deletable = terminal || paused;
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Open details', onSelect: () => openTrafficFlowTab(flow) },
      { id: 'repeater', label: 'Open in Hexestra Repeater', onSelect: () => run(() => openRepeater(flow)) },
      { id: 'copy-url', label: 'Copy URL', separatorBefore: true, onSelect: () => writeClipboard(flow.url) },
      { id: 'copy-request', label: 'Copy raw request', onSelect: async () => writeClipboard(formatRawRequest((await readFlow(flow)).request)) },
      { id: 'copy-response', label: 'Copy raw response', onSelect: async () => writeClipboard(formatRawResponse((await readFlow(flow)).response)) },
      { id: 'copy-curl', label: 'Copy as cURL', onSelect: async () => writeClipboard(formatFlowAsCurl(await readFlow(flow))) },
      {
        id: 'ask-agent',
        label: 'Ask Agent',
        separatorBefore: true,
        onSelect: () => useChatStore.getState().queueAgentContext({
          kind: 'traffic-flow',
          projectId,
          flowId: flow.id,
          method: flow.method,
          url: flow.url,
          host: flow.host,
          state: flow.state,
          scopeState: flow.scopeState,
          statusCode: flow.statusCode,
          preview: `${flow.method} ${flow.url} · ${flow.statusCode ?? flow.state}`.slice(0, 2_000),
        }, 'Analyze this captured traffic flow.'),
      },
      { id: 'evidence', label: 'Save as Evidence', onSelect: () => run(() => window.hexestra.invoke(TRAFFIC_IPC.SAVE_EVIDENCE, projectId, flow.id)) },
      { id: 'filter-host', label: `Filter host: ${flow.host}`, onSelect: () => { setHost(flow.host); setParentFlowId(''); } },
      { id: 'related', label: 'View related Replays', disabled: flow.source === 'replay', onSelect: () => { setParentFlowId(flow.id); setHost(''); } },
    ];
    if (profileState?.burpStatus.tools.some((tool) => tool.startsWith('create_repeater_tab') || tool === 'repeater_send')) {
      items.push({ id: 'burp-repeater', label: 'Send to Burp Repeater', separatorBefore: true, onSelect: () => run(() => window.hexestra.invoke(TRAFFIC_IPC.BURP_CALL, projectId, { operation: 'open_repeater', flowId: flow.id })) });
    }
    if (profileState?.burpStatus.tools.some((tool) => tool === 'send_to_intruder' || tool === 'intruder_send')) {
      items.push({ id: 'burp-intruder', label: 'Send to Burp Intruder', onSelect: () => run(() => window.hexestra.invoke(TRAFFIC_IPC.BURP_CALL, projectId, { operation: 'send_intruder', flowId: flow.id })) });
    }
    if (paused) {
      items.push(
        { id: 'forward', label: 'Forward intercepted message', separatorBefore: true, onSelect: () => run(() => window.hexestra.invoke(TRAFFIC_IPC.DECIDE, projectId, { flowId: flow.id, expectedRevision: flow.revision, action: 'forward' } satisfies InterceptDecision)) },
        { id: 'drop', label: 'Drop intercepted message', danger: true, onSelect: () => run(() => window.hexestra.invoke(TRAFFIC_IPC.DECIDE, projectId, { flowId: flow.id, expectedRevision: flow.revision, action: 'drop' } satisfies InterceptDecision)) },
      );
    }
    items.push({
      id: 'delete',
      label: paused ? 'Drop and delete intercepted Flow' : terminal ? 'Delete local Flow record' : 'Wait for Flow before deleting',
      separatorBefore: true,
      danger: true,
      disabled: !deletable,
      onSelect: async () => {
        const approved = await confirm({
          title: paused ? 'Drop and delete intercepted Flow?' : 'Delete Traffic Flow?',
          description: paused
            ? 'Hexestra will drop or settle the intercepted message before removing its local Traffic record.'
            : 'Hexestra will remove this local Traffic record.',
          details: `${flow.method} ${flow.url}\n\nIf this Flow owns a Hexestra Repeater session, that session will also be removed. Burp history, saved Evidence, and replay attempt records remain.`,
          confirmLabel: paused ? 'Drop & Delete' : 'Delete Flow',
          tone: 'danger',
        });
        if (!approved) return;
        await run(async () => {
          const result = await window.hexestra.invoke<TrafficDeleteResult>(TRAFFIC_IPC.DELETE, projectId, flow.id);
          const tabStore = useTabStore.getState();
          for (const tab of tabStore.tabs) {
            if (tab.type === 'traffic' && tab.data?.flowId === flow.id) tabStore.closeTab(tab.id);
            if (tab.type === 'replay' && typeof tab.data?.replaySessionId === 'string' && result.clearedReplaySessionIds.includes(tab.data.replaySessionId)) tabStore.closeTab(tab.id);
          }
        });
      },
    });
    return items;
  }, [confirm, menu, profileState, projectId]);

  const clearHistory = () => {
    if (!projectId) return;
    void confirm({
      title: 'Clear removable Traffic history?',
      description: 'Intercepted Flows will be dropped and deleted. Other active Flows and retained Repeater sources will remain.',
      details: 'Burp history and saved Evidence are not removed.',
      confirmLabel: 'Clear History',
      tone: 'danger',
    }).then(async (approved) => {
      if (!approved) return;
      await run(async () => {
      const result = await window.hexestra.invoke<TrafficClearResult>(TRAFFIC_IPC.CLEAR, projectId);
      const tabStore = useTabStore.getState();
      for (const tab of tabStore.tabs) {
        if (tab.type !== 'traffic' || typeof tab.data?.flowId !== 'string') continue;
        try {
          await window.hexestra.invoke(TRAFFIC_IPC.READ, projectId, tab.data.flowId);
        } catch {
          tabStore.closeTab(tab.id);
        }
      }
      setNotice(`Cleared ${result.deleted}${result.droppedIntercepted ? `, including ${result.droppedIntercepted} intercepted` : ''}. Kept ${result.retainedActive} active and ${result.retainedRepeaterSources} Repeater source${result.retainedRepeaterSources === 1 ? '' : 's'}.`);
      });
    });
  };

  if (!projectId) return <EmptyState message={t('traffic.openProject')} />;

  const runtime = profileState?.runtime ?? 'stopped';
  const proxyEnabled = profileState?.profile.enabled ?? false;
  const burpEnabled = profileState?.profile.burp.enabled ?? false;
  const profileError = profileState?.error;
  const burpMcpWarning = runtime === 'ready' && burpEnabled && profileState?.burpStatus.error
    ? `Burp MCP tools are unavailable: ${profileState.burpStatus.error}`
    : null;
  const mirrorOfflineWarning = burpEnabled && profileState?.mirrorStatus.state === 'offline'
    ? `Traffic capture is still active, but the Burp Bridge is offline${profileState.mirrorStatus.error ? `: ${profileState.mirrorStatus.error}` : '.'}`
    : null;
  const persistentNoticeVisible = (message: string | null | undefined) => Boolean(message && !dismissedPersistentNotices.includes(message));
  const dismissPersistentNotice = (message: string) => setDismissedPersistentNotices((current) => current.includes(message) ? current : [...current, message]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-secondary/45">
      <header className="shrink-0 border-b border-surface/80 p-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{t('nav.traffic')}</span>
          <button type="button" className="ui-icon-button ml-auto text-text-muted hover:text-severity-high" disabled={busy} aria-label={t('traffic.clearHistory')} title={t('traffic.clearHistory')} onClick={clearHistory}>
            <Icon name="trash" size={12} />
          </button>
          <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[8px]', runtime === 'ready' ? 'border-accent-teal/35 text-accent-teal' : runtime === 'blocked' || runtime === 'error' ? 'border-severity-high/35 text-severity-high' : 'border-surface text-text-muted')}>{runtime.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={cn('ui-control flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-[9px]', proxyEnabled ? 'text-accent-teal' : 'text-text-muted')}
            disabled={busy}
            title={proxyEnabled ? t('traffic.stopCapture') : t('traffic.startCapture')}
            onClick={() => void run(() => window.hexestra.invoke(proxyEnabled ? TRAFFIC_IPC.STOP : TRAFFIC_IPC.START, projectId))}
          >
            <Icon name={proxyEnabled ? 'activity' : 'pause'} size={11} />{proxyEnabled ? t('traffic.captureOn') : t('traffic.captureOff')}
          </button>
          <button type="button" className={cn('ui-control px-2 py-1.5 text-[9px]', burpEnabled && 'text-accent-blue')} disabled={busy} onClick={() => void run(() => window.hexestra.invoke(burpEnabled ? TRAFFIC_IPC.BURP_DISCONNECT : TRAFFIC_IPC.BURP_CONNECT, projectId))}>
            {burpEnabled ? t('traffic.burpSync') : t('traffic.burpOff')}
          </button>
          <button type="button" className="ui-icon-button" disabled={busy} aria-label={t('traffic.openBurpSettings')} title={t('traffic.openBurpSettings')} onClick={() => openSettingsTab('burp')}>
            <Icon name="settings" size={12} />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <InterceptToggle label={t('traffic.requestBreak')} checked={profileState?.profile.interceptRequests ?? false} disabled={busy || !proxyEnabled} onChange={(checked) => updateProfile({ interceptRequests: checked })} />
          <InterceptToggle label={t('traffic.responseBreak')} checked={profileState?.profile.interceptResponses ?? false} disabled={busy || !proxyEnabled} onChange={(checked) => updateProfile({ interceptResponses: checked })} />
        </div>
      </header>

      {(error || persistentNoticeVisible(profileError)) && <DismissibleNotice tone="error" variant="banner" className="px-2 text-[9px]" onDismiss={() => { setError(null); if (profileError) dismissPersistentNotice(profileError); }}>{error ?? profileError}</DismissibleNotice>}
      {notice && <DismissibleNotice tone="success" variant="banner" className="px-2 text-[9px]" onDismiss={() => setNotice(null)}>{notice}</DismissibleNotice>}
      {persistentNoticeVisible(mirrorOfflineWarning) && <DismissibleNotice tone="warning" variant="banner" className="px-2 text-[9px]" onDismiss={() => dismissPersistentNotice(mirrorOfflineWarning!)}>{mirrorOfflineWarning}</DismissibleNotice>}
      {persistentNoticeVisible(burpMcpWarning) && <DismissibleNotice tone="warning" variant="banner" className="px-2 text-[9px]" onDismiss={() => dismissPersistentNotice(burpMcpWarning!)}>{burpMcpWarning}</DismissibleNotice>}

      <div className="shrink-0 space-y-1.5 border-b border-surface/70 p-2">
        <div className="flex items-center gap-1.5">
          <Icon name="search" size={11} className="shrink-0 text-text-muted" />
          <input aria-label={t('traffic.search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('traffic.searchPlaceholder')} className="ui-control min-w-0 flex-1 px-2 py-1 text-[10px]" />
          <span className="shrink-0 font-mono text-[8px] text-text-muted">{flows.total}</span>
        </div>
        <FilterRow label={t('traffic.status')} values={[{ id: 'all', label: t('traffic.all') }, { id: 'paused', label: t('traffic.paused') }, { id: 'completed', label: t('traffic.completed') }, { id: 'failed', label: t('traffic.failed') }]} active={status} onChange={(value) => setStatus(value as StatusFilter)} />
        <div className="grid grid-cols-2 gap-1.5">
          <select aria-label="Traffic scope filter" className="ui-control min-w-0 px-1 py-1 text-[9px]" value={scope} onChange={(event) => setScope(event.target.value as ScopeFilter)}>
            <option value="all">{t('traffic.allScope')}</option><option value="in_scope">{t('traffic.inScope')}</option><option value="out_of_scope">{t('traffic.outOfScope')}</option>
          </select>
          <select aria-label="Traffic source filter" className="ui-control min-w-0 px-1 py-1 text-[9px]" value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}>
            <option value="all">{t('traffic.allSources')}</option><option value="browser">{t('traffic.browser')}</option><option value="replay">{t('traffic.replay')}</option>
          </select>
        </div>
        {(host || parentFlowId) && <button className="flex w-full items-center justify-between rounded bg-accent-blue/8 px-2 py-1 text-[9px] text-accent-blue" onClick={() => { setHost(''); setParentFlowId(''); }}><span className="truncate">{host ? `Host: ${host}` : `Replays of ${parentFlowId}`}</span><Icon name="close" size={10} /></button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {flows.items.map((flow) => <TrafficListItem key={flow.id} flow={flow} active={flow.id === activeFlowId} onOpen={() => openTrafficFlowTab(flow)} onContextMenu={(event) => { event.preventDefault(); setMenu({ flow, x: event.clientX, y: event.clientY, target: event.currentTarget }); }} />)}
        {flows.items.length === 0 && <EmptyState message={t('traffic.empty')} compact />}
        {flows.items.length < flows.total && <button className="ui-control mt-1 w-full py-1.5 text-[9px]" disabled={busy} onClick={() => void loadFlows(true)}>{t('traffic.loadMore')} · {flows.total - flows.items.length}</button>}
      </div>

      <footer className="shrink-0 border-t border-surface/70 px-2 py-1.5 text-[8px] leading-3 text-text-muted">{t('traffic.storageWarning')}</footer>
      <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} items={menuItems} returnFocus={menu?.target} onClose={() => setMenu(null)} />
    </div>
  );
}

function FilterRow({ label, values, active, onChange }: { label: string; values: Array<{ id: string; label: string }>; active: string; onChange: (value: string) => void }) {
  return <div className="flex items-center gap-1"><span className="mr-0.5 text-[7px] text-text-muted">{label}</span>{values.map((value) => <button key={value.id} className={cn('rounded px-1.5 py-0.5 text-[8px] uppercase', active === value.id ? 'bg-accent-blue/12 text-accent-blue' : 'text-text-muted hover:bg-surface/40')} onClick={() => onChange(value.id)}>{value.label}</button>)}</div>;
}

function InterceptToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={cn('ui-control flex items-center gap-1.5 px-2 py-1 text-[9px] text-text-muted', disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer')}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="truncate">{label}</span></label>;
}

function TrafficListItem({ flow, active, onOpen, onContextMenu }: { flow: TrafficSummary; active: boolean; onOpen: () => void; onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" aria-label={`Open ${flow.method} ${flow.url}`} onClick={onOpen} onContextMenu={onContextMenu} className={cn('mb-1 flex w-full flex-col gap-1 rounded-md border px-2 py-1.5 text-left transition-colors', active ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-transparent hover:border-surface/70 hover:bg-surface/25')}>
    <span className="flex w-full min-w-0 items-center gap-1.5"><span className="shrink-0 font-mono text-[9px] font-semibold text-accent-blue">{flow.method}</span><span className="min-w-0 flex-1 truncate font-mono text-[9px] text-text-secondary" title={flow.url}>{flow.host}{safePath(flow.url)}</span><span className="shrink-0 font-mono text-[8px] text-text-muted">{flow.statusCode ?? '—'}</span></span>
    <span className="flex w-full items-center gap-1.5 font-mono text-[8px]"><span className={cn('truncate', flow.state.includes('paused') ? 'text-accent-yellow' : flow.state === 'failed' ? 'text-severity-high' : 'text-text-muted')}>{flow.state}</span>{flow.source === 'replay' && <span className="text-accent-blue">REPLAY</span>}{flow.burpMirrorState === 'synced' && <span className="text-accent-teal">BURP SYNC</span>}{flow.burpMirrorState === 'pending' && <span className="text-accent-yellow">SYNC PENDING</span>}{flow.burpMirrorState === 'failed' && <span className="text-severity-high">SYNC FAILED</span>}<span className="ml-auto text-text-muted">{formatBytes((flow.requestBytes ?? 0) + (flow.responseBytes ?? 0))} · {flow.durationMs === undefined ? '—' : `${flow.durationMs}ms`}</span><span className={flow.scopeState === 'in_scope' ? 'text-accent-teal' : 'text-text-muted'}>{flow.scopeState === 'in_scope' ? 'IN' : 'OUT'}</span></span>
  </button>;
}

function EmptyState({ message, compact = false }: { message: string; compact?: boolean }) { return <div className={cn('flex items-center justify-center text-center text-[10px] text-text-muted', compact ? 'px-3 py-8' : 'h-full px-5')}>{message}</div>; }
function safePath(value: string) { try { const url = new URL(value); return `${url.pathname}${url.search}`; } catch { return value; } }
function formatBytes(value: number) { return value < 1024 ? `${value}B` : `${(value / 1024).toFixed(value < 10_240 ? 1 : 0)}K`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
