import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { agentContextRefKey, type AgentContextRef, type ChatMessage } from '@/types';
import { useI18n } from '@/i18n';
import { AgentTimelineMessage } from './AgentTimelineMessage';
import { openKnowledgeRefineryTab } from '@/stores/useTabStore';
import type { RefineryJob } from '@/types';

const LIVE_FOLLOW_THRESHOLD_PX = 64;

export function ChatMessages() {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  const openSubagent = useChatStore((s) => s.openSubagent);
  const subagentRuns = useChatStore((s) => s.subagentRuns);
  const history = useChatStore((s) => s.history);
  const loadingEarlierHistory = useChatStore((s) => s.loadingEarlierHistory);
  const loadingHistoryActivities = useChatStore((s) => s.loadingHistoryActivities);
  const loadEarlierHistory = useChatStore((s) => s.loadEarlierHistory);
  const loadEarlierActivities = useChatStore((s) => s.loadEarlierActivities);
  const chatScrollTop = useChatStore((s) => s.chatScrollTop);
  const setChatScrollTop = useChatStore((s) => s.setChatScrollTop);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const initialScrollTopRef = useRef(chatScrollTop);
  const followOutputRef = useRef(true);
  const restoredScrollRef = useRef(false);
  const followFrameRef = useRef<number | null>(null);
  const { t } = useI18n();

  const loadOlder = useCallback(async () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const previousHeight = scroller.scrollHeight;
    followOutputRef.current = false;
    const loaded = await loadEarlierHistory();
    if (!loaded) return;
    window.requestAnimationFrame(() => {
      scroller.scrollTop += scroller.scrollHeight - previousHeight;
    });
  }, [loadEarlierHistory]);

  const loadOlderActivities = useCallback(async (messageId: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const previousHeight = scroller.scrollHeight;
    followOutputRef.current = false;
    const loaded = await loadEarlierActivities(messageId);
    if (!loaded) return;
    window.requestAnimationFrame(() => {
      scroller.scrollTop += scroller.scrollHeight - previousHeight;
    });
  }, [loadEarlierActivities]);

  const scheduleLiveFollow = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
    }
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (!restoredScrollRef.current) {
        scroller.scrollTop = initialScrollTopRef.current > 0
          ? initialScrollTopRef.current
          : scroller.scrollHeight;
        restoredScrollRef.current = true;
        followOutputRef.current = distanceFromBottom(scroller) <= LIVE_FOLLOW_THRESHOLD_PX;
      } else if (followOutputRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scheduleLiveFollow();
  }, [messages, scheduleLiveFollow]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(scheduleLiveFollow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleLiveFollow]);

  useEffect(() => () => {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
    }
  }, []);

  return (
    <div
      className="h-full overflow-x-hidden overflow-y-auto"
      onWheel={(event) => {
        if (event.deltaY < 0) followOutputRef.current = false;
      }}
      onScroll={(event) => {
        const scroller = event.currentTarget;
        followOutputRef.current = distanceFromBottom(scroller) <= LIVE_FOLLOW_THRESHOLD_PX;
        setChatScrollTop(scroller.scrollTop);
      }}
      ref={scrollRef}
    >
      <div className="space-y-3 px-3 py-2" ref={contentRef}>
      {history.hasEarlier && (
        <div className="flex justify-center pb-1">
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-2 rounded border border-border-subtle bg-panel/70 px-3 text-[11px] text-text-secondary transition-colors hover:border-accent-blue/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue disabled:cursor-wait disabled:opacity-60"
            onClick={() => void loadOlder()}
            disabled={loadingEarlierHistory}
            aria-label={t(loadingEarlierHistory ? 'agent.loadingEarlierHistory' : 'agent.loadEarlierHistory')}
          >
            <Icon name="chevron-right" size={12} className="-rotate-90" />
            <span>{loadingEarlierHistory ? t('agent.loadingEarlierHistory') : t('agent.loadEarlierHistory')}</span>
            {!loadingEarlierHistory && <span className="text-text-muted">({Math.max(0, history.total - messages.length)} hidden)</span>}
          </button>
        </div>
      )}
      {messages.map((message) => (
        <Fragment key={message.id}>
          {message.role === 'assistant' && (message.activities?.length || message.hiddenActivityCount) ? (
            <AgentTimelineMessage
              message={message}
              onOpenSubagent={openSubagent}
              subagentRuns={subagentRuns}
              onLoadEarlierActivities={(messageId) => void loadOlderActivities(messageId)}
              loadingEarlierActivities={loadingHistoryActivities === message.id}
            />
          ) : (
        <div
          className={cn(
            'group flex min-w-0 max-w-[90%] flex-col text-[13px]',
            message.role === 'user'
              ? 'ml-auto items-end'
              : message.role === 'system'
                ? 'mx-auto items-center'
                : 'mr-auto items-start',
          )}
        >
          <span className="mb-0.5 flex items-center gap-1 px-1 text-2xs text-text-muted">
            {message.role === 'user'
              ? 'You'
              : message.role === 'assistant'
                ? 'AI'
                : message.role === 'system'
                  ? 'System'
                  : 'Tool'}
            {message.source === 'scheduled' && <span className="text-accent-teal">{t('agent.scheduled')}</span>}
            {message.role === 'user' && message.status === 'complete' && (
              <button
                aria-label="Edit message and create branch"
                className="rounded p-0.5 text-text-muted opacity-0 transition hover:bg-raised hover:text-accent-blue group-hover:opacity-100 focus:opacity-100"
                disabled={isProcessing}
                onClick={() => {
                  setEditingMessageId(message.id);
                  setDraft(message.content);
                }}
                title="Edit from this turn"
              >
                <Icon name="edit" size={11} />
              </button>
            )}
          </span>

          <div
            className={cn(
              'min-w-0 max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 [overflow-wrap:anywhere]',
              message.role === 'user'
                ? 'bg-accent-blue/20 text-text-primary'
                : message.role === 'system'
                  ? 'bg-raised/50 text-2xs italic text-text-muted'
                  : 'bg-raised text-text-primary',
            )}
          >
            {message.workflowInvocation ? (
              <WorkflowInvocationCard
                message={message}
                expanded={expandedWorkflowIds.has(message.id)}
                onToggle={() => setExpandedWorkflowIds((current) => {
                  const next = new Set(current);
                  if (next.has(message.id)) next.delete(message.id);
                  else next.add(message.id);
                  return next;
                })}
              />
            ) : message.refineryInvocation ? (
              <RefineryInvocationCard invocation={message.refineryInvocation} />
            ) : message.content}
            {message.status === 'streaming' && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent-blue" />
            )}
          </div>

          {message.attachments?.length ? (
            <div className="mt-1.5 flex max-w-full flex-wrap justify-end gap-1">
              {message.attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex max-w-full items-center gap-1 rounded border border-border-subtle bg-panel px-2 py-1 text-[11px] text-text-secondary"
                  title={attachment.path}
                >
                  <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={11} className="text-accent-teal" />
                  <span className="max-w-40 truncate">{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}

          {message.contextRefs?.length ? (
            <div className="mt-1.5 flex max-w-full flex-wrap justify-end gap-1">
              {message.contextRefs.map((ref) => (
                <span key={agentContextRefKey(ref)} className="flex max-w-full items-center gap-1 rounded border border-accent-blue/20 bg-accent-blue/8 px-2 py-1 text-[11px] text-text-secondary" title={messageContextTitle(ref)}>
                  <Icon name={ref.kind === 'browser-page' ? 'browser' : ref.kind === 'shell-command' ? 'terminal' : 'activity'} size={11} className="text-accent-blue" />
                  <span className="max-w-40 truncate">{messageContextLabel(ref)}</span>
                </span>
              ))}
            </div>
          ) : null}

          {message.hasToolRequest && message.toolRequest && (
            <div className="mt-1 flex min-w-0 max-w-full items-start gap-1.5 rounded border border-severity-medium/30 bg-severity-medium/20 px-2 py-1 text-2xs text-severity-medium">
              <Icon name="tool" size={12} className="mt-0.5" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {message.toolRequest.kind === 'ask_user_question'
                  ? `Question: ${message.toolRequest.questions.map(({ question }) => question).join(' · ')}`
                  : `Tool: ${message.toolRequest.toolName} · ${message.toolRequest.description}`}
              </span>
            </div>
          )}

          {(message.status === 'error' || message.status === 'interrupted') && (
            <span className="mt-0.5 text-2xs text-severity-critical">
              {message.status === 'interrupted' ? 'Interrupted after restart' : 'Failed to send'}
            </span>
          )}
          {editingMessageId === message.id && (
            <div className="mt-2 w-full min-w-0 max-w-full rounded-lg border border-accent-blue/25 bg-panel p-2 shadow-xl">
              <textarea
                aria-label="Edited message"
                autoFocus
                className="min-h-20 w-full resize-y rounded border border-border-subtle bg-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue/50"
                onChange={(event) => setDraft(event.target.value)}
                value={draft}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                Hexestra will create a new Claude branch from this turn. Project assets,
                Scope, tasks, Findings, Evidence, Reports, and files remain shared.
              </p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  className="rounded px-2 py-1 text-2xs text-text-muted hover:bg-raised"
                  onClick={() => setEditingMessageId(null)}
                >
                  Cancel
                </button>
                <button
                  className="rounded bg-accent-blue/20 px-2 py-1 text-2xs font-medium text-accent-blue hover:bg-accent-blue/30 disabled:opacity-40"
                  disabled={!draft.trim() || draft.trim() === message.content.trim()}
                  onClick={() => {
                    const content = draft.trim();
                    setEditingMessageId(null);
                    void branchFromMessage(message.id, content);
                  }}
                >
                  Branch &amp; retry
                </button>
              </div>
            </div>
          )}
        </div>
          )}
        </Fragment>
      ))}
      </div>
    </div>
  );
}

function RefineryInvocationCard({ invocation }: { invocation: NonNullable<ChatMessage['refineryInvocation']> }) {
  const { t } = useI18n();
  const projectId = useChatStore((state) => state.activeProjectId);
  const [job, setJob] = useState<RefineryJob | null>(null);
  useEffect(() => {
    if (!window.hexestra || !projectId) return;
    let active = true;
    const load = () => void window.hexestra.invoke<RefineryJob | null>('refinery:jobs:read', projectId, invocation.jobId).then((value) => active && setJob(value)).catch(() => active && setJob(null));
    load();
    const unsubscribe = window.hexestra.on('refinery:changed', (value: unknown) => {
      const event = value as { sessionId?: string; jobId?: string };
      if (event.sessionId === projectId && (!event.jobId || event.jobId === invocation.jobId)) load();
    });
    return () => { active = false; unsubscribe(); };
  }, [invocation.jobId, projectId]);
  return <button type="button" onClick={() => openKnowledgeRefineryTab(invocation.jobId)} className="flex min-w-[15rem] items-start gap-2 rounded-md border border-accent-blue/25 bg-accent-blue/6 px-2.5 py-2 text-left hover:border-accent-blue/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue" aria-label={t('agent.refineryOpen')}><Icon name="sparkles" size={13} className="mt-0.5 text-accent-blue" /><span className="min-w-0"><span className="block text-[11px] font-semibold text-text-primary">{t('agent.refineryRequest')}</span><span className="mt-0.5 block truncate text-[10px] text-text-secondary">{invocation.sourceName}</span><span className="mt-1 block font-mono text-[9px] uppercase text-text-muted">{job?.status?.replaceAll('_', ' ') ?? t('common.saved')}</span></span></button>;
}

function WorkflowInvocationCard({
  message,
  expanded,
  onToggle,
}: {
  message: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const invocation = message.workflowInvocation;
  if (!invocation) return null;
  return (
    <div className="min-w-56 max-w-full">
      <div className="flex items-start gap-2">
        <Icon name="sparkles" size={14} className="mt-0.5 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text-primary">{invocation.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
            <span>{t('agent.workflowRequest')}</span>
            <span>·</span>
            <span className="font-mono">{invocation.workflowId}</span>
            <span>·</span>
            <span>{t('agent.workflowVersion', { version: invocation.version })}</span>
          </div>
          {invocation.note && <p className="mt-1 text-[11px] leading-4 text-text-secondary">{invocation.note}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="mt-2 inline-flex min-h-7 items-center gap-1 rounded border border-border-subtle px-2 text-[10px] text-text-muted transition hover:border-accent-blue/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue"
        aria-expanded={expanded}
      >
        <Icon name="chevron-right" size={10} className={cn('transition-transform', expanded && 'rotate-90')} />
        {expanded ? t('agent.workflowHideRequest') : t('agent.workflowShowRequest')}
      </button>
      {expanded && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border-subtle/70 bg-panel/70 p-2 font-mono text-[10px] leading-4 text-text-secondary">
          {message.content}
        </pre>
      )}
    </div>
  );
}

function distanceFromBottom(scroller: HTMLDivElement) {
  return Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
}

function messageContextLabel(ref: AgentContextRef) {
  if (ref.kind === 'shell-command') return `Command: ${ref.templateLabel} ${ref.callbackAddress}:${ref.callbackPort}`;
  if (ref.kind === 'browser-page') return ref.selectionText ? `Selection · ${ref.title || ref.url}` : ref.linkUrl ? `Link · ${ref.linkText || ref.linkUrl}` : `Page · ${ref.title || ref.url}`;
  return `Flow · ${ref.method} ${ref.host || ref.url}`;
}

function messageContextTitle(ref: AgentContextRef) {
  if (ref.kind === 'browser-page') return ref.url;
  if (ref.kind === 'shell-command') return `${ref.templateLabel}\n${ref.callbackAddress}:${ref.callbackPort}`;
  return `Flow ${ref.flowId}`;
}
