import { useEffect } from 'react';
import { Icon } from '@/components/shared';
import type { AgentActivity, SubagentRun } from '@/types';
import { useI18n } from '@/i18n';
import { AgentActivityList } from './AgentTimelineMessage';

export function SubagentDetailView({
  run,
  onBack,
}: {
  run: SubagentRun;
  onBack: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const status = statusPresentation(run.status, t);
  const duration = formatDuration(run);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-secondary">
      <header className="flex shrink-0 items-center gap-2 border-b border-surface bg-bg-tertiary px-3 py-2">
        <button
          type="button"
          className="ui-icon-button p-1"
          aria-label={t('agent.subagentBack')}
          title={t('agent.subagentBack')}
          onClick={onBack}
        >
          <Icon name="chevron-right" size={15} className="rotate-180" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon name="bot" size={14} className="text-accent-blue" />
            <h2 className="truncate text-sm font-semibold text-text-primary">
              {run.agentType || t('agent.subagent')}
            </h2>
          </div>
          <p className="truncate text-[9px] text-text-muted">{run.description}</p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] ${status.className}`}>
          {status.label}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 grid grid-cols-3 gap-1.5 text-[9px]">
          <Metric label={t('agent.subagentDuration')} value={duration} />
          <Metric label={t('agent.subagentTools')} value={String(run.usage?.toolUses ?? countTools(run.activities))} />
          <Metric label={t('agent.subagentTokens')} value={run.usage?.totalTokens ? formatCount(run.usage.totalTokens) : '—'} />
        </div>

        {run.parentRunId && (
          <div className="mb-3 rounded border border-accent-blue/20 bg-accent-blue/5 px-2 py-1.5 text-[9px] text-text-secondary">
            Nested under another subagent
          </div>
        )}

        {run.activities.length > 0 ? (
          <AgentActivityList activities={run.activities as AgentActivity[]} compact />
        ) : (
          <div className="rounded border border-surface bg-bg-tertiary px-3 py-5 text-center text-2xs text-text-muted">
            {t('agent.subagentWaiting')}
          </div>
        )}

        {run.output && (
          <section className="mt-4 rounded border border-accent-green/20 bg-accent-green/5 p-2.5">
            <p className="mb-1 text-[8px] uppercase tracking-[0.14em] text-accent-green">{t('agent.subagentFinalOutput')}</p>
            <p className="whitespace-pre-wrap break-words text-2xs leading-4 text-text-secondary">{run.output}</p>
          </section>
        )}
        {run.error && (
          <section className="mt-4 rounded border border-severity-critical/30 bg-severity-critical/10 p-2.5 text-2xs text-severity-critical">
            {run.error}
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-surface bg-bg-tertiary px-2 py-1.5">
      <p className="text-[8px] uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-text-secondary">{value}</p>
    </div>
  );
}

function statusPresentation(status: SubagentRun['status'], t: ReturnType<typeof useI18n>['t']) {
  if (status === 'running' || status === 'pending') {
    return { label: status === 'pending' ? t('agent.subagentQueued') : t('agent.subagentRunning'), className: 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue' };
  }
  if (status === 'failed') return { label: t('agent.subagentFailed'), className: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical' };
  if (status === 'interrupted') {
    return { label: t('agent.subagentInterrupted'), className: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium' };
  }
  if (status === 'stopped' || status === 'killed') {
    return { label: t('agent.subagentStopped'), className: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium' };
  }
  return { label: t('agent.subagentCompleted'), className: 'border-accent-green/30 bg-accent-green/10 text-accent-green' };
}

function countTools(activities: SubagentRun['activities']) {
  return activities.filter((activity) => activity.kind === 'tool').length;
}

function formatCount(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function formatDuration(run: SubagentRun) {
  const started = Date.parse(run.startedAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return '—';
  const seconds = Math.max(0, Math.round((ended - started) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
