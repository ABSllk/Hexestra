import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import type { AgentActivity, ChatMessage, SubagentRun } from '@/types';
import { useI18n } from '@/i18n';

export const AgentTimelineMessage = memo(function AgentTimelineMessage({
  message,
  onOpenSubagent,
  subagentRuns,
}: {
  message: ChatMessage;
  onOpenSubagent?: (runId: string) => void;
  subagentRuns?: SubagentRun[];
}) {
  return (
    <article className="w-full text-[13px]" aria-label="AI activity timeline">
      <span className="mb-1 block px-1 text-2xs text-text-muted">AI</span>
      <div className="relative ml-1.5 border-l border-border-subtle/80 pl-4">
        {message.activities?.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} onOpenSubagent={onOpenSubagent} subagentRuns={subagentRuns} />
        ))}
      </div>
      {message.status === 'error' && (
        <span className="mt-1 block px-1 text-2xs text-severity-critical">Request failed</span>
      )}
    </article>
  );
});

export function AgentActivityList({
  activities,
  onOpenSubagent,
  subagentRuns,
  compact = false,
}: {
  activities: AgentActivity[];
  onOpenSubagent?: (runId: string) => void;
  subagentRuns?: SubagentRun[];
  compact?: boolean;
}) {
  return (
    <div className="relative ml-1.5 border-l border-border-subtle/80 pl-4">
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} onOpenSubagent={onOpenSubagent} subagentRuns={subagentRuns} compact={compact} />
      ))}
    </div>
  );
}

const ActivityItem = memo(function ActivityItem({
  activity,
  onOpenSubagent,
  subagentRuns,
  compact = false,
}: {
  activity: AgentActivity;
  onOpenSubagent?: (runId: string) => void;
  subagentRuns?: SubagentRun[];
  compact?: boolean;
}) {
  const dotClass = activity.status === 'error'
    ? 'bg-severity-critical'
    : activity.kind === 'tool' && activity.status === 'complete'
      ? 'bg-accent-green'
      : activity.status === 'running' || activity.status === 'streaming'
        ? 'bg-accent-blue animate-pulse'
        : 'bg-text-muted';

  return (
    <div className="relative pb-3.5 last:pb-0">
      <span
        className={cn(
          'absolute -left-[1.22rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-canvas',
          dotClass,
        )}
      />
      {activity.kind === 'thinking' ? (
        <ThinkingActivity activity={activity} compact={compact} />
      ) : activity.kind === 'tool' ? (
        <ToolActivity activity={activity} onOpenSubagent={onOpenSubagent} subagentRuns={subagentRuns} compact={compact} />
      ) : (
        <TextActivity activity={activity} compact={compact} />
      )}
    </div>
  );
});

function TextActivity({ activity, compact = false }: { activity: AgentActivity; compact?: boolean }) {
  return (
    <div className={cn(
      'min-h-5 whitespace-pre-wrap break-words pr-1 text-text-primary',
      compact ? 'text-[11px] leading-[1.1rem]' : 'leading-5',
    )}>
      {activity.content
        ? activity.status === 'streaming'
          ? activity.content
          : <MarkdownContent content={activity.content} compact={compact} />
        : null}
      {activity.status === 'streaming' && <StreamingCursor />}
    </div>
  );
}

function ThinkingActivity({ activity, compact = false }: { activity: AgentActivity; compact?: boolean }) {
  return (
    <details className={cn('group text-text-muted', compact && 'text-[11px]')}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 outline-none hover:text-text-secondary">
        <Icon name="sparkles" size={13} />
        <span>Thinking</span>
        <Icon name="chevron-right" size={12} className="transition-transform group-open:rotate-90" />
        {activity.status === 'streaming' && (
          <span className="text-[11px] uppercase tracking-wider text-accent-blue">live</span>
        )}
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap rounded border border-border-subtle/60 bg-panel/50 px-2.5 py-2 text-2xs leading-4 text-text-muted">
        {activity.content
          ? activity.status === 'streaming'
            ? activity.content
            : <MarkdownContent content={activity.content} compact={compact} />
          : <span>Internal reasoning in progress</span>}
      </div>
    </details>
  );
}

function ToolActivity({
  activity,
  onOpenSubagent,
  subagentRuns,
  compact = false,
}: {
  activity: AgentActivity;
  onOpenSubagent?: (runId: string) => void;
  subagentRuns?: SubagentRun[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (activity.subagentRunId && onOpenSubagent) {
    const run = subagentRuns?.find((candidate) => candidate.id === activity.subagentRunId);
    const status = run?.status ?? (activity.status === 'running' ? 'running' : activity.status === 'error' ? 'failed' : 'completed');
    const toolCount = run?.usage?.toolUses ?? run?.activities.filter((candidate) => candidate.kind === 'tool').length;
    const tokens = run?.usage?.totalTokens;
    return (
      <button
        type="button"
        className={cn(
          'ui-card w-full cursor-pointer text-left transition-colors hover:border-accent-blue/50 hover:bg-accent-blue/5',
          compact && 'text-[11px]',
        )}
        onClick={() => onOpenSubagent(activity.subagentRunId!)}
        aria-label={`Open ${activity.agentType || 'subagent'} output`}
      >
        <div className="flex items-start gap-2">
          <Icon name="bot" size={14} className="mt-0.5 text-accent-blue" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-text-primary">
                {activity.agentType || t('agent.subagent')}
              </span>
              <span className="text-[11px] uppercase tracking-[0.12em] text-accent-blue">{t('agent.subagentDelegated')}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-text-secondary">
              {activity.subagentDescription || activity.summary || t('agent.subagentWaiting')}
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              {formatSubagentStatus(status, t)}
              {run && ` · ${formatDuration(run)}`}
              {toolCount !== undefined && ` · ${toolCount} tools`}
              {tokens !== undefined && ` · ${tokens.toLocaleString()} tokens`}
            </p>
            {(run?.summary || run?.lastToolName) && (
              <p className="mt-1 truncate text-[11px] text-accent-blue">
                {run.summary || run.lastToolName}
              </p>
            )}
          </div>
          <Icon name="chevron-right" size={12} className="mt-1 text-text-muted" />
        </div>
      </button>
    );
  }
  const hasDetails = Boolean(activity.output || (activity.input && Object.keys(activity.input).length > 0));
  const statusText = activity.status === 'running'
    ? activity.elapsedSeconds
      ? `Running · ${activity.elapsedSeconds}s`
      : 'Running'
    : activity.status === 'error'
      ? activity.outputSummary || 'Failed'
      : activity.outputSummary || 'Completed';

  const summary = (
    <div className={cn('min-w-0 flex-1', compact && 'text-[11px]')}>
      <div className="flex min-w-0 items-start gap-1.5 leading-5">
        <Icon
          name={toolIcon(activity.toolName)}
          size={14}
          className={activity.status === 'error' ? 'mt-0.5 text-severity-critical' : 'mt-0.5 text-accent-green'}
        />
        <span className="shrink-0 font-semibold text-text-primary">
          {activity.label || activity.toolName || 'Tool'}
        </span>
        {activity.summary && (
          <code className="min-w-0 break-all font-mono text-[11px] font-normal text-text-secondary">
            {activity.summary}
          </code>
        )}
      </div>
      <p
        className={cn(
          'ml-[1.375rem] mt-0.5 text-[11px]',
          activity.status === 'error' ? 'text-severity-critical' : 'text-text-muted',
        )}
      >
        {statusText}
      </p>
    </div>
  );

  if (!hasDetails) return summary;

  return (
    <details className="group/tool">
      <summary className="flex cursor-pointer list-none items-start gap-1 outline-none">
        {summary}
        <Icon
          name="chevron-right"
          size={12}
          className="mt-1 text-text-muted transition-transform group-open/tool:rotate-90"
        />
      </summary>
      <div className="ml-[1.375rem] mt-2 space-y-2 rounded border border-border-subtle/60 bg-panel/60 p-2">
        {activity.input && Object.keys(activity.input).length > 0 && (
          <ActivityDetails label="Input" value={JSON.stringify(activity.input, null, 2)} />
        )}
        {activity.output && <ActivityDetails label="Output" value={activity.output} />}
      </div>
    </details>
  );
}

function ActivityDetails({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-text-secondary">
        {value}
      </pre>
    </div>
  );
}

export function MarkdownContent({ content, compact = false }: { content: string; compact?: boolean }) {
  const markdown = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
  return compact
    ? <div className="text-[11px] [&_h1]:text-[13px] [&_h2]:text-[12px] [&_h3]:text-[11px] [&_pre]:text-[11px] [&_table]:text-[11px]">{markdown}</div>
    : markdown;
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-sm font-semibold text-text-primary first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[13px] font-semibold text-text-primary first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-xs font-semibold text-text-primary first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 font-medium text-text-primary first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-text-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-text-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent-blue/60 bg-panel/40 py-1 pl-2.5 pr-1 text-text-secondary">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-accent-blue underline decoration-accent-blue/40 underline-offset-2 hover:text-accent-teal"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic text-text-secondary">{children}</em>,
  del: ({ children }) => <del className="text-text-muted decoration-text-muted">{children}</del>,
  code: ({ children, className }) => (
    <code className={cn('rounded bg-raised/70 px-1 py-0.5 font-mono text-[0.92em] text-accent-teal', className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 max-h-64 overflow-auto whitespace-pre rounded border border-border-subtle bg-panel/80 p-2 font-mono text-[11px] leading-4 text-text-secondary [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-text-secondary">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-auto rounded border border-border-subtle">
      <table className="w-full min-w-max border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-panel text-text-primary">{children}</thead>,
  th: ({ children }) => <th className="border-b border-r border-border-subtle px-2 py-1.5 text-left font-semibold last:border-r-0">{children}</th>,
  td: ({ children }) => <td className="border-b border-r border-border-subtle/70 px-2 py-1.5 text-text-secondary last:border-r-0">{children}</td>,
  hr: () => <hr className="my-3 border-border-subtle" />,
  input: (props) => (
    <input
      {...props}
      disabled
      className="mr-1.5 align-[-1px] accent-accent-blue"
    />
  ),
  img: ({ alt, src }) => (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-2 max-h-64 max-w-full rounded border border-border-subtle object-contain"
    />
  ),
};

function StreamingCursor() {
  return <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent-blue" />;
}

function toolIcon(toolName?: string) {
  if (/bash|terminal/i.test(toolName ?? '')) return 'terminal' as const;
  if (/read|write|edit|file/i.test(toolName ?? '')) return 'file' as const;
  if (/grep|glob|search/i.test(toolName ?? '')) return 'search' as const;
  if (/browser|web/i.test(toolName ?? '')) return 'browser' as const;
  return 'tool' as const;
}

function formatSubagentStatus(status: SubagentRun['status'], t: ReturnType<typeof useI18n>['t']) {
  if (status === 'pending') return t('agent.subagentQueued');
  if (status === 'running') return t('agent.subagentRunning');
  if (status === 'failed') return t('agent.subagentFailed');
  if (status === 'interrupted') return t('agent.subagentInterrupted');
  if (status === 'stopped' || status === 'killed') return t('agent.subagentStopped');
  return t('agent.subagentCompleted');
}

function formatDuration(run: SubagentRun) {
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  const start = Date.parse(run.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
