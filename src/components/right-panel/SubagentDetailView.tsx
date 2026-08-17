import { useEffect, useRef } from 'react';
import { Icon } from '@/components/shared';
import type { AgentActivity, SubagentRun } from '@/types';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores';
import { AgentActivityList } from './AgentTimelineMessage';
import { subagentStatusText, subagentTitle, useSubagentClock } from './subagent-presentation';

export function SubagentDetailView({
  run,
  onBack,
}: {
  run: SubagentRun;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const loadSubagentDetail = useChatStore((state) => state.loadSubagentDetail);
  const loadingSubagentDetail = useChatStore((state) => state.loadingSubagentDetail === run.id);
  const initialLoadRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialLoadRef.current === run.id) return;
    initialLoadRef.current = run.id;
    void loadSubagentDetail(run.id);
  }, [loadSubagentDetail, run.id]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const status = statusPresentation(run.status, t);
  const duration = useSubagentClock(run);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-panel px-3 py-2">
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
              {subagentTitle(run)}
            </h2>
          </div>
          {run.agentType && <p className="truncate text-[11px] uppercase tracking-wide text-accent-blue">{run.agentType}</p>}
          <p className="truncate text-[11px] text-text-muted">{subagentStatusText(run, t('agent.subagentWaiting'))}</p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-[0.1em] ${status.className}`}>
          {status.label}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 grid grid-cols-3 gap-1.5 text-[11px]">
          <Metric label={t('agent.subagentDuration')} value={duration} />
          <Metric label={t('agent.subagentTools')} value={String(run.usage?.toolUses ?? countTools(run.activities))} />
          <Metric label={t('agent.subagentTokens')} value={run.usage?.totalTokens ? formatCount(run.usage.totalTokens) : '—'} />
        </div>

        {run.parentRunId && (
          <div className="mb-3 rounded border border-accent-blue/20 bg-accent-blue/5 px-2 py-1.5 text-[11px] text-text-secondary">
            Nested under another subagent
          </div>
        )}

        {run.activities.length > 0 || run.hiddenActivityCount ? (
          <AgentActivityList
            activities={run.activities as AgentActivity[]}
            compact
            hiddenActivityCount={run.hiddenActivityCount}
            loadingEarlierActivities={loadingSubagentDetail}
            onLoadEarlierActivities={() => void loadSubagentDetail(run.id)}
          />
        ) : (
          <div className="rounded border border-border-subtle bg-panel px-3 py-5 text-center text-2xs text-text-muted">
            {loadingSubagentDetail ? t('common.loading') : t('agent.subagentWaiting')}
          </div>
        )}

        {run.output && (
          <section className="mt-4 rounded border border-accent-green/20 bg-accent-green/5 p-2.5">
            <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-accent-green">{t('agent.subagentFinalOutput')}</p>
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
    <div className="rounded border border-border-subtle bg-panel px-2 py-1.5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">{value}</p>
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
