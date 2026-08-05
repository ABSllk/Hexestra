import { useCallback, useEffect, useState } from 'react';
import { DismissibleNotice } from '@/components/shared';
import { cn } from '@/lib/cn';
import { formatTrafficMessage, parseTrafficMessage, type TrafficEditorSide } from '@/lib/trafficEditor';
import { useChatStore, useSessionStore, useTabStore } from '@/stores';
import { openReplayTab } from '@/stores/useTabStore';
import {
  TRAFFIC_IPC,
  type HttpMessagePatch,
  type InterceptDecision,
  type TrafficChangedEvent,
  type TrafficFlow,
  type TrafficProfileState,
  type ReplaySession,
} from '@electron/contracts/traffic';
import { useI18n } from '@/i18n';

export function TrafficDetailTab({ tabId }: { tabId: string }) {
  const { t } = useI18n();
  const projectId = useSessionStore((state) => state.currentSession?.id ?? null);
  const flowId = useTabStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    return typeof tab?.data?.flowId === 'string' ? tab.data.flowId : null;
  });
  const [profileState, setProfileState] = useState<TrafficProfileState | null>(null);
  const [flow, setFlow] = useState<TrafficFlow | null>(null);
  const [side, setSide] = useState<TrafficEditorSide>('request');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!projectId) return;
    setProfileState(await window.hexestra.invoke<TrafficProfileState>(TRAFFIC_IPC.GET_PROFILE, projectId));
  }, [projectId]);

  const loadFlow = useCallback(async () => {
    if (!projectId || !flowId) {
      setFlow(null);
      return;
    }
    setFlow(await window.hexestra.invoke<TrafficFlow>(TRAFFIC_IPC.READ, projectId, flowId));
  }, [flowId, projectId]);

  useEffect(() => {
    setFlow(null);
    setError(null);
    setNotice(null);
    if (!projectId || !flowId) return;
    void Promise.all([loadProfile(), loadFlow()]).catch((loadError) => setError(errorMessage(loadError)));
  }, [flowId, loadFlow, loadProfile, projectId]);

  useEffect(() => window.hexestra.on(TRAFFIC_IPC.CHANGED, (value) => {
    const event = value as TrafficChangedEvent;
    if (event.projectId !== projectId) return;
    if (event.profile) void loadProfile();
    if (event.flowId === flowId) {
      void loadFlow().catch((loadError) => {
        setFlow(null);
        setError(errorMessage(loadError));
      });
    }
  }), [flowId, loadFlow, loadProfile, projectId]);

  useEffect(() => {
    if (!flow) {
      setDraft('');
      return;
    }
    const availableSide = side === 'response' && !flow.response ? 'request' : side;
    if (availableSide !== side) setSide(availableSide);
    setDraft(formatTrafficMessage(flow, availableSide));
  }, [flow, side]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await Promise.all([loadProfile(), loadFlow()]);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const decide = (action: InterceptDecision['action']) => {
    if (!projectId || !flow) return;
    const pausedSide = flow.state === 'response_paused' ? 'response' : 'request';
    let message: HttpMessagePatch | undefined;
    if (action === 'forward') {
      try {
        message = parseTrafficMessage(
          draft,
          pausedSide,
          pausedSide === 'request' ? flow.request.body.encoding : flow.response?.body.encoding ?? 'utf8',
        );
      } catch (parseError) {
        setError(errorMessage(parseError));
        return;
      }
    }
    void run(() => window.hexestra.invoke(TRAFFIC_IPC.DECIDE, projectId, {
      flowId: flow.id,
      expectedRevision: flow.revision,
      action,
      ...(message ? { message } : {}),
    } satisfies InterceptDecision));
  };

  const callBurp = (operation: 'open_repeater' | 'send_intruder') => {
    if (!projectId || !flow) return;
    void run(async () => {
      const result = await window.hexestra.invoke<string>(TRAFFIC_IPC.BURP_CALL, projectId, { operation, flowId: flow.id });
      setNotice(result || (operation === 'open_repeater' ? 'Opened in Burp Repeater.' : 'Sent to Burp Intruder.'));
    });
  };

  const openInRepeater = () => {
    if (!projectId || !flow) return;
    void run(async () => {
      const session = await window.hexestra.invoke<ReplaySession>(TRAFFIC_IPC.REPLAY_SESSION_OPEN, projectId, flow.id);
      openReplayTab(session, `Repeater · ${flow.request.method} ${new URL(flow.request.url).host}`);
    });
  };

  const askAgent = () => {
    if (!projectId || !flow) return;
    useChatStore.getState().queueAgentContext({
      kind: 'traffic-flow',
      projectId,
      flowId: flow.id,
      method: flow.request.method,
      url: flow.request.url,
      host: safeHost(flow.request.url),
      state: flow.state,
      scopeState: flow.scopeState,
      statusCode: flow.response?.statusCode,
      preview: `${flow.request.method} ${flow.request.url} · ${flow.response?.statusCode ?? flow.state}`,
    }, 'Analyze this captured traffic flow.');
  };

  if (!projectId) return <EmptyDetail message="Open a project to inspect traffic." />;
  if (!flowId) return <EmptyDetail message="Select a captured flow from the Traffic sidebar." />;
  if (!flow && !error) return <EmptyDetail message="Loading traffic flow…" />;

  const paused = flow?.state === 'request_paused' || flow?.state === 'response_paused';

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      {error && <DismissibleNotice tone="error" variant="banner" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
      {notice && <DismissibleNotice tone="success" variant="banner" onDismiss={() => setNotice(null)}>{notice}</DismissibleNotice>}

      {flow && (
        <>
          <header className="shrink-0 border-b border-surface px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-blue">{flow.request.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={flow.request.url}>{flow.request.url}</span>
              <span className={cn(
                'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px]',
                flow.scopeState === 'in_scope'
                  ? 'border-accent-teal/30 text-accent-teal'
                  : 'border-accent-yellow/30 text-accent-yellow',
              )}>
                {flow.scopeState === 'in_scope' ? 'IN SCOPE' : 'OUT OF SCOPE'}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 font-mono text-[9px] text-text-muted">
              <span>{flow.state}</span>
              <span>HTTP {flow.request.httpVersion.replace(/^http\//i, '')}</span>
              <span>{flow.response?.statusCode ?? t('traffic.noResponse')}</span>
              <span className={flow.route.burpMirrorState === 'failed' ? 'text-severity-high' : flow.route.burpMirrorState === 'pending' ? 'text-accent-yellow' : flow.route.burpMirrorState === 'synced' ? 'text-accent-teal' : undefined}>
                {flow.route.burpMirrorState === 'synced'
                    ? 'BURP SYNC'
                    : flow.route.burpMirrorState === 'pending'
                      ? 'SYNC PENDING'
                      : flow.route.burpMirrorState === 'failed'
                        ? 'SYNC FAILED'
                        : 'DIRECT'}
              </span>
              <span className="ml-auto">rev {flow.revision}</span>
            </div>
          </header>

          <div className="flex shrink-0 items-center gap-1 border-b border-surface px-2 py-1.5">
            <button className={cn('ui-segmented-item px-2 py-1 text-[10px]', side === 'request' && 'bg-surface text-text-primary')} onClick={() => setSide('request')}>{t('traffic.request')}</button>
            <button disabled={!flow.response} className={cn('ui-segmented-item px-2 py-1 text-[10px]', side === 'response' && 'bg-surface text-text-primary')} onClick={() => setSide('response')}>{t('traffic.response')}</button>
            {paused && <span className="ml-2 text-[9px] text-accent-yellow">Paused · editing {flow.state === 'response_paused' ? 'response' : 'request'}</span>}
          </div>

          <textarea
            aria-label="Traffic message editor"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={!paused}
            className="min-h-0 flex-1 resize-none bg-bg-primary p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none"
          />

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-surface p-2">
            {paused && (
              <>
                <button className="ui-control px-2 py-1 text-[10px] text-accent-teal" disabled={busy} onClick={() => decide('forward')}>{t('traffic.forward')}</button>
                <button className="ui-control px-2 py-1 text-[10px] text-severity-high" disabled={busy} onClick={() => decide('drop')}>{t('traffic.drop')}</button>
              </>
            )}
            <button className="ui-control px-2 py-1 text-[10px]" disabled={busy || flow.request.httpVersion === 'websocket'} onClick={openInRepeater}>{t('traffic.repeater')}</button>
            <button className="ui-control px-2 py-1 text-[10px]" disabled={busy} onClick={askAgent}>{t('traffic.askAgent')}</button>
            <button className="ui-control px-2 py-1 text-[10px]" disabled={busy} onClick={() => void run(() => window.hexestra.invoke(TRAFFIC_IPC.SAVE_EVIDENCE, projectId, flow.id))}>{t('traffic.saveEvidence')}</button>
            <button className="ui-control px-2 py-1 text-[10px]" disabled={busy || !profileState?.burpStatus.tools.some((tool) => tool.startsWith('create_repeater_tab') || tool === 'repeater_send')} onClick={() => callBurp('open_repeater')}>{t('traffic.burpRepeater')}</button>
            <button className="ui-control px-2 py-1 text-[10px]" disabled={busy || !profileState?.burpStatus.tools.some((tool) => tool === 'send_to_intruder' || tool === 'intruder_send')} onClick={() => callBurp('send_intruder')}>{t('traffic.burpIntruder')}</button>
          </footer>
        </>
      )}
    </div>
  );
}

function EmptyDetail({ message }: { message: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">{message}</div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeHost(value: string) {
  try { return new URL(value).host; } catch { return '<invalid>'; }
}
