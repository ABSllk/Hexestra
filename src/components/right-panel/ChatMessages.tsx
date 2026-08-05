import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { agentContextRefKey, type AgentContextRef } from '@/types';
import { AgentTimelineMessage } from './AgentTimelineMessage';

export function ChatMessages() {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !followOutputRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (followOutputRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  return (
    <div
      className="h-full overflow-y-auto"
      onScroll={(event) => {
        const scroller = event.currentTarget;
        followOutputRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64;
      }}
      ref={scrollRef}
    >
      <div className="space-y-3 px-3 py-2">
      {messages.map((message) => (
        <Fragment key={message.id}>
          {message.role === 'assistant' && message.activities?.length ? (
            <AgentTimelineMessage message={message} />
          ) : (
        <div
          className={cn(
            'group flex max-w-[90%] flex-col text-xs',
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
            {message.role === 'user' && message.status === 'complete' && (
              <button
                aria-label="Edit message and create branch"
                className="rounded p-0.5 text-text-muted opacity-0 transition hover:bg-surface hover:text-accent-blue group-hover:opacity-100 focus:opacity-100"
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
              'break-words whitespace-pre-wrap rounded-lg px-3 py-2',
              message.role === 'user'
                ? 'bg-accent-blue/20 text-text-primary'
                : message.role === 'system'
                  ? 'bg-surface/50 text-2xs italic text-text-muted'
                  : 'bg-surface text-text-primary',
            )}
          >
            {message.content}
            {message.status === 'streaming' && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent-blue" />
            )}
          </div>

          {message.attachments?.length ? (
            <div className="mt-1.5 flex max-w-full flex-wrap justify-end gap-1">
              {message.attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex max-w-full items-center gap-1 rounded border border-surface bg-bg-tertiary px-2 py-1 text-[9px] text-text-secondary"
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
                <span key={agentContextRefKey(ref)} className="flex max-w-full items-center gap-1 rounded border border-accent-blue/20 bg-accent-blue/8 px-2 py-1 text-[9px] text-text-secondary" title={messageContextTitle(ref)}>
                  <Icon name={ref.kind === 'browser-page' ? 'browser' : ref.kind === 'shell-command' ? 'terminal' : 'activity'} size={11} className="text-accent-blue" />
                  <span className="max-w-40 truncate">{messageContextLabel(ref)}</span>
                </span>
              ))}
            </div>
          ) : null}

          {message.hasToolRequest && message.toolRequest && (
            <div className="mt-1 flex items-start gap-1.5 rounded border border-severity-medium/30 bg-severity-medium/20 px-2 py-1 text-2xs text-severity-medium">
              <Icon name="tool" size={12} className="mt-0.5" />
              <span>
                {message.toolRequest.kind === 'ask_user_question'
                  ? `Question: ${message.toolRequest.questions.map(({ question }) => question).join(' · ')}`
                  : `Tool: ${message.toolRequest.toolName} · ${message.toolRequest.description}`}
              </span>
            </div>
          )}

          {message.status === 'error' && (
            <span className="mt-0.5 text-2xs text-severity-critical">Failed to send</span>
          )}
          {editingMessageId === message.id && (
            <div className="mt-2 w-full min-w-[280px] rounded-lg border border-accent-blue/25 bg-bg-tertiary p-2 shadow-xl">
              <textarea
                aria-label="Edited message"
                autoFocus
                className="min-h-20 w-full resize-y rounded border border-surface bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue/50"
                onChange={(event) => setDraft(event.target.value)}
                value={draft}
              />
              <p className="mt-1 text-[9px] leading-relaxed text-text-muted">
                Hexestra will create a new Claude branch from this turn. Project assets,
                Scope, tasks, Findings, Evidence, Reports, and files remain shared.
              </p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  className="rounded px-2 py-1 text-2xs text-text-muted hover:bg-surface"
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
