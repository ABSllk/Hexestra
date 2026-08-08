import { useCallback, useEffect, useMemo, useState } from 'react';
import { DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { cn } from '@/lib/cn';
import { formatRawRequest, formatRawResponse } from '@/lib/trafficExport';
import { parseTrafficMessage } from '@/lib/trafficEditor';
import { useSessionStore, useTabStore } from '@/stores';
import {
  TRAFFIC_IPC,
  type HttpMessagePatch,
  type ReplaySession,
  type TrafficChangedEvent,
  type TrafficFlow,
  type TrafficProfileState,
  type TrafficReplayResult,
  type TrafficRequest,
} from '@electron/contracts/traffic';
import { useI18n } from '@/i18n';

export function TrafficReplayTab({ tabId }: { tabId: string }) {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const projectId = useSessionStore((state) => state.currentSession?.id ?? null);
  const sessionId = useTabStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    return typeof tab?.data?.replaySessionId === 'string' ? tab.data.replaySessionId : null;
  });
  const closeTab = useTabStore((state) => state.closeTab);
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [source, setSource] = useState<TrafficFlow | null>(null);
  const [attempts, setAttempts] = useState<TrafficFlow[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ignoredWaits, setIgnoredWaits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (replaceDraft = false) => {
    if (!window.hexestra || !projectId || !sessionId) return;
    const next = await window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_READ, projectId, sessionId);
    const [sourceFlow, ...attemptFlows] = await Promise.all([
      window.hexestra.invoke<TrafficFlow>(TRAFFIC_IPC.READ, projectId, next.sourceFlowId),
      ...next.attemptFlowIds.map((flowId) => window.hexestra.invoke<TrafficFlow>(TRAFFIC_IPC.READ, projectId, flowId).catch(() => null)),
    ]);
    setSession(next);
    setSource(sourceFlow);
    setAttempts(attemptFlows.filter((flow): flow is TrafficFlow => flow !== null));
    setDraft((current) => replaceDraft || !current ? next.draftText ?? formatRawRequest(next.draft) : current);
  }, [projectId, sessionId]);

  useEffect(() => {
    setSession(null);
    setSource(null);
    setAttempts([]);
    setDraft('');
    setError(null);
    if (!projectId || !sessionId) return;
    void load(true).catch((loadError) => setError(errorMessage(loadError)));
  }, [projectId, sessionId]); // load intentionally excluded to avoid replacing an edited draft

  useEffect(() => {
    if (!window.hexestra) return;
    return window.hexestra.on(TRAFFIC_IPC.CHANGED, (value: unknown) => {
      const event = value as TrafficChangedEvent;
      if (event.projectId !== projectId) return;
      if (!event.flowId || session?.attemptFlowIds.includes(event.flowId) || event.flowId === session?.sourceFlowId) {
        void load(false).catch((loadError) => setError(errorMessage(loadError)));
      }
    });
  }, [load, projectId, session]);

  useEffect(() => {
    if (!window.hexestra || !projectId || !sessionId || !session || !draft) return;
    if (draft === session.draftText) return;
    const timer = window.setTimeout(() => {
      void window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_UPDATE, projectId, sessionId, { draftText: draft })
        .then((next) => setSession(next))
        .catch((saveError) => setError(errorMessage(saveError)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, projectId, session, sessionId]);

  const parseDraft = (): HttpMessagePatch => {
    if (!session) throw new Error('Replay session is not loaded');
    return parseTrafficMessage(draft, 'request', session.draft.body.encoding);
  };

  const saveDraft = async () => {
    if (!window.hexestra || !projectId || !sessionId || !session) throw new Error('Replay session is not available');
    const patch = parseDraft();
    const nextDraft: TrafficRequest = {
      ...session.draft,
      method: patch.method ?? session.draft.method,
      url: patch.url ?? session.draft.url,
      headers: patch.headers ?? session.draft.headers,
      body: patch.body ? { ...session.draft.body, ...patch.body } : session.draft.body,
    };
    const next = await window.hexestra.invoke<ReplaySession>(
      TRAFFIC_IPC.REPLAY_SESSION_UPDATE,
      projectId,
      sessionId,
      { draft: nextDraft, draftText: draft },
    );
    setSession(next);
    setDraft(next.draftText ?? formatRawRequest(next.draft));
    return { next, patch };
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const send = () => void run(async () => {
    if (!window.hexestra || !projectId || !sessionId) return;
    const profile = await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, projectId);
    if (profile.runtime !== 'ready') throw new Error('Traffic proxy is not ready. Start capture before sending.');
    const { next, patch } = await saveDraft();
    const result = await window.hexestra.invoke<TrafficReplayResult>(TRAFFIC_IPC.REPLAY, projectId, {
      parentFlowId: next.sourceFlowId,
      replaySessionId: next.id,
      message: patch,
    });
    setNotice(`Replay ${result.flowId} was accepted.`);
    await load(false);
  });

  const selectAttempt = (flowId: string) => void run(async () => {
    if (!window.hexestra || !projectId || !sessionId) return;
    const next = await window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_UPDATE, projectId, sessionId, {
      selectedAttemptFlowId: flowId,
    });
    setSession(next);
  });

  const resetDraft = () => void run(async () => {
    if (!window.hexestra || !projectId || !sessionId || !source) return;
    const next = await window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_UPDATE, projectId, sessionId, {
      draft: source.request,
      draftText: formatRawRequest(source.request),
    });
    setSession(next);
    setDraft(next.draftText ?? formatRawRequest(next.draft));
    setNotice('Draft reset to the source request.');
  });

  const clear = () => void run(async () => {
    if (!window.hexestra || !projectId || !sessionId) return;
    if (!await confirm({
      title: 'Clear Hexestra Repeater session?',
      description: 'The saved draft and this Repeater session will be removed.',
      details: 'Captured replay Flow records remain available in Traffic.',
      confirmLabel: 'Clear Session',
      tone: 'danger',
    })) return;
    await window.hexestra.invoke(TRAFFIC_IPC.REPLAY_SESSION_CLEAR, projectId, sessionId);
    closeTab(tabId);
  });

  const selected = attempts.find((flow) => flow.id === session?.selectedAttemptFlowId) ?? attempts.at(-1) ?? null;
  const selectedIndex = selected ? attempts.findIndex((flow) => flow.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? attempts[selectedIndex - 1] : null;
  const waiting = selected && !ignoredWaits.includes(selected.id) && !['completed', 'failed', 'dropped'].includes(selected.state);
  const comparison = useMemo(() => responseComparison(previous, selected), [previous, selected]);

  if (!projectId) return <ReplayEmpty message="Open a project to use Hexestra Repeater." />;
  if (!sessionId) return <ReplayEmpty message="This Repeater tab has no saved session." />;
  if (!session && !error) return <ReplayEmpty message="Loading Repeater session…" />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
        <button className="ui-control flex items-center gap-1.5 px-3 py-1 text-[11px] text-accent-teal" disabled={busy || !session} onClick={send}>
          <Icon name="send" size={11} /> {t('traffic.send')}
        </button>
        {waiting && (
          <button title="Stops UI waiting only; the request remains captured if it later completes." className="ui-control px-2 py-1 text-[11px] text-accent-yellow" onClick={() => setIgnoredWaits((ids) => [...ids, selected.id])}>{t('traffic.cancelWait')}</button>
        )}
        <button className="ui-control px-2 py-1 text-[11px]" disabled={busy || !source} onClick={resetDraft}>{t('traffic.resetRequest')}</button>
        <button className="ui-control px-2 py-1 text-[11px]" disabled={!draft} onClick={() => void window.hexestra?.invoke('clipboard:write-text', draft)}>{t('traffic.copyRequest')}</button>
        <button className="ui-control px-2 py-1 text-[11px]" disabled={!selected?.response} onClick={() => void window.hexestra?.invoke('clipboard:write-text', formatRawResponse(selected?.response))}>{t('traffic.copyResponse')}</button>
        <button className="ui-control ml-auto px-2 py-1 text-[11px] text-severity-high" disabled={busy} onClick={clear}>{t('traffic.clearSession')}</button>
      </header>

      {error && <DismissibleNotice tone="error" variant="banner" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
      {notice && <DismissibleNotice tone="success" variant="banner" onDismiss={() => setNotice(null)}>{notice}</DismissibleNotice>}

      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-surface">
        <section className="flex min-h-0 flex-col">
          <div className="flex h-8 shrink-0 items-center border-b border-border-subtle px-3 text-[11px] font-semibold tracking-wider text-text-muted">{t('traffic.requestDraft')}</div>
          <textarea aria-label="Repeater request editor" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-0 flex-1 resize-none bg-panel p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:bg-canvas/20" />
        </section>
        <section className="flex min-h-0 flex-col">
          <div className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle p-1.5">
            {attempts.map((attempt, index) => (
              <button key={attempt.id} title={attempt.id} onClick={() => selectAttempt(attempt.id)} className={cn('shrink-0 rounded border px-2 py-1 font-mono text-[11px]', selected?.id === attempt.id ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle text-text-muted hover:bg-raised/30')}>
                #{index + 1} · {attempt.response?.statusCode ?? attempt.state}
              </button>
            ))}
            {attempts.length === 0 && <span className="px-2 text-[11px] text-text-muted">{t('traffic.noSends')}</span>}
          </div>
          {selected ? (
            <>
              <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 font-mono text-[11px] text-text-muted">
                <span>{selected.state}</span>
                <span>{selected.timing.durationMs === undefined ? 'waiting' : `${selected.timing.durationMs} ms`}</span>
                <span>{selected.response?.body.byteLength ?? 0} bytes</span>
                <span>{selected.route.burpRouted ? 'via Burp chain' : selected.route.burpMirrorState === 'synced' ? 'mirrored to Burp' : selected.route.burpMirrorState === 'pending' ? 'Burp mirror pending' : selected.route.burpMirrorState === 'failed' ? 'Burp mirror failed' : 'direct'}</span>
                {comparison && <span className="text-accent-yellow">vs previous: {comparison}</span>}
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-text-secondary">{selected.error || formatRawResponse(selected.response)}</pre>
            </>
          ) : <ReplayEmpty message={t('traffic.replayEmpty')} />}
        </section>
      </div>
    </div>
  );
}

function responseComparison(previous: TrafficFlow | null, current: TrafficFlow | null) {
  if (!previous || !current) return null;
  const parts: string[] = [];
  if (previous.response?.statusCode !== current.response?.statusCode) parts.push(`${previous.response?.statusCode ?? '—'}→${current.response?.statusCode ?? '—'}`);
  const bytes = (current.response?.body.byteLength ?? 0) - (previous.response?.body.byteLength ?? 0);
  if (bytes !== 0) parts.push(`${bytes > 0 ? '+' : ''}${bytes} B`);
  const duration = (current.timing.durationMs ?? 0) - (previous.timing.durationMs ?? 0);
  if (duration !== 0) parts.push(`${duration > 0 ? '+' : ''}${duration} ms`);
  return parts.join(', ') || 'no summary change';
}

function ReplayEmpty({ message }: { message: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">{message}</div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
