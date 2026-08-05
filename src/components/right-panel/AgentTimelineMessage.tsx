import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import type { AgentActivity, ChatMessage } from '@/types';

export const AgentTimelineMessage = memo(function AgentTimelineMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="w-full text-xs" aria-label="AI activity timeline">
      <span className="mb-1 block px-1 text-2xs text-text-muted">AI</span>
      <div className="relative ml-1.5 border-l border-surface/80 pl-4">
        {message.activities?.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>
      {message.status === 'error' && (
        <span className="mt-1 block px-1 text-2xs text-severity-critical">Request failed</span>
      )}
    </article>
  );
});

const ActivityItem = memo(function ActivityItem({ activity }: { activity: AgentActivity }) {
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
          'absolute -left-[1.22rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg-secondary',
          dotClass,
        )}
      />
      {activity.kind === 'thinking' ? (
        <ThinkingActivity activity={activity} />
      ) : activity.kind === 'tool' ? (
        <ToolActivity activity={activity} />
      ) : (
        <TextActivity activity={activity} />
      )}
    </div>
  );
});

function TextActivity({ activity }: { activity: AgentActivity }) {
  return (
    <div className="min-h-5 whitespace-pre-wrap break-words pr-1 leading-5 text-text-primary">
      {activity.content
        ? activity.status === 'streaming'
          ? activity.content
          : <MarkdownContent content={activity.content} />
        : null}
      {activity.status === 'streaming' && <StreamingCursor />}
    </div>
  );
}

function ThinkingActivity({ activity }: { activity: AgentActivity }) {
  return (
    <details className="group text-text-muted">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 outline-none hover:text-text-secondary">
        <Icon name="sparkles" size={13} />
        <span>Thinking</span>
        <Icon name="chevron-right" size={12} className="transition-transform group-open:rotate-90" />
        {activity.status === 'streaming' && (
          <span className="text-[9px] uppercase tracking-wider text-accent-blue">live</span>
        )}
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap rounded border border-surface/60 bg-bg-tertiary/50 px-2.5 py-2 text-2xs leading-4 text-text-muted">
        {activity.content
          ? activity.status === 'streaming'
            ? activity.content
            : <MarkdownContent content={activity.content} />
          : <span>Internal reasoning in progress</span>}
      </div>
    </details>
  );
}

function ToolActivity({ activity }: { activity: AgentActivity }) {
  const hasDetails = Boolean(activity.output || (activity.input && Object.keys(activity.input).length > 0));
  const statusText = activity.status === 'running'
    ? activity.elapsedSeconds
      ? `Running · ${activity.elapsedSeconds}s`
      : 'Running'
    : activity.status === 'error'
      ? activity.outputSummary || 'Failed'
      : activity.outputSummary || 'Completed';

  const summary = (
    <div className="min-w-0 flex-1">
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
          <code className="min-w-0 break-all font-mono text-[10px] font-normal text-text-secondary">
            {activity.summary}
          </code>
        )}
      </div>
      <p
        className={cn(
          'ml-[1.375rem] mt-0.5 text-[9px]',
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
      <div className="ml-[1.375rem] mt-2 space-y-2 rounded border border-surface/60 bg-bg-tertiary/60 p-2">
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
      <p className="mb-1 text-[8px] uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-text-secondary">
        {value}
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
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
    <blockquote className="my-2 border-l-2 border-accent-blue/60 bg-bg-tertiary/40 py-1 pl-2.5 pr-1 text-text-secondary">
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
    <code className={cn('rounded bg-surface/70 px-1 py-0.5 font-mono text-[0.92em] text-accent-teal', className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 max-h-64 overflow-auto whitespace-pre rounded border border-surface bg-bg-tertiary/80 p-2 font-mono text-[10px] leading-4 text-text-secondary [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-text-secondary">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-auto rounded border border-surface">
      <table className="w-full min-w-max border-collapse text-[10px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-tertiary text-text-primary">{children}</thead>,
  th: ({ children }) => <th className="border-b border-r border-surface px-2 py-1.5 text-left font-semibold last:border-r-0">{children}</th>,
  td: ({ children }) => <td className="border-b border-r border-surface/70 px-2 py-1.5 text-text-secondary last:border-r-0">{children}</td>,
  hr: () => <hr className="my-3 border-surface" />,
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
      className="my-2 max-h-64 max-w-full rounded border border-surface object-contain"
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
