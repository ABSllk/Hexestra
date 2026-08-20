import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore, useKnowledgeRefineryStore, useSessionStore } from '@/stores';
import { openKnowledgeRefineryTab } from '@/stores/useTabStore';
import { useI18n } from '@/i18n';

export function KnowledgeRefineryLibraryView() {
  const { t } = useI18n();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const sources = useKnowledgeRefineryStore((state) => state.sources);
  const jobs = useKnowledgeRefineryStore((state) => state.jobs);
  const loading = useKnowledgeRefineryStore((state) => state.loading);
  const error = useKnowledgeRefineryStore((state) => state.error);
  const selectedSourceId = useKnowledgeRefineryStore((state) => state.selectedSourceId);
  const selectedJobId = useKnowledgeRefineryStore((state) => state.selectedJobId);
  const selectSource = useKnowledgeRefineryStore((state) => state.selectSource);
  const selectJob = useKnowledgeRefineryStore((state) => state.selectJob);
  const load = useKnowledgeRefineryStore((state) => state.load);
  const importSources = useKnowledgeRefineryStore((state) => state.importSources);
  const newConversation = useChatStore((state) => state.newConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const isAgentProcessing = useChatStore((state) => state.isProcessing);
  const [view, setView] = useState<'sources' | 'jobs'>('sources');
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<{ kind: 'source' | 'job'; id: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingSourceId, setStartingSourceId] = useState<string | null>(null);

  useEffect(() => { if (sessionId) void load(sessionId); }, [load, sessionId]);
  useEffect(() => {
    if (!window.hexestra || !sessionId) return;
    return window.hexestra.on('refinery:changed', (value: unknown) => {
      const event = value as { sessionId?: string };
      if (event.sessionId === sessionId) void load(sessionId);
    });
  }, [load, sessionId]);

  const filteredSources = useMemo(() => filterItems(sources, query, (source) => `${source.name} ${source.format ?? ''}`), [sources, query]);
  const filteredJobs = useMemo(() => filterItems(jobs, query, (job) => `${job.source.name} ${job.status} ${job.id}`), [jobs, query]);
  const openJob = (jobId: string) => { selectJob(jobId); openKnowledgeRefineryTab(jobId); };
  const importAndOpen = async () => {
    const imported = await importSources();
    const first = imported[0];
    if (first) {
      selectSource(first.id);
      openKnowledgeRefineryTab(undefined, first.id);
    }
  };
  const distillInNewConversation = async (sourceId: string) => {
    setActionError(null);
    setStartingSourceId(sourceId);
    try {
      const created = await newConversation();
      if (!created) {
        setActionError(useChatStore.getState().error ?? 'Unable to create a new Agent conversation.');
        return;
      }
      await sendMessage(`/distill source:${sourceId}`);
      const sendError = useChatStore.getState().error;
      if (sendError) setActionError(sendError);
    } finally {
      setStartingSourceId(null);
    }
  };
  const confirmDelete = async () => {
    if (!window.hexestra || !sessionId || !confirming) return;
    try {
      setActionError(null);
      if (confirming.kind === 'source') await window.hexestra.invoke('refinery:sources:delete', confirming.id, true);
      else await window.hexestra.invoke('refinery:jobs:delete', sessionId, confirming.id);
      setConfirming(null);
      await load(sessionId);
    } catch (reason) { setActionError(String(reason)); }
  };

  return <div className="flex min-h-0 flex-1 flex-col bg-canvas">
    <div className="shrink-0 border-b border-border-subtle bg-panel/50 p-2.5">
      <div className="ui-segmented grid grid-cols-2" role="tablist" aria-label={t('refinery.title')}>
        <button type="button" role="tab" aria-selected={view === 'sources'} onClick={() => setView('sources')} className={cn('ui-segmented-item min-h-8 text-[11px]', view === 'sources' && 'ui-segmented-item-active')}>{t('refinery.sources')} <span className="ml-1 font-mono opacity-60">{sources.length}</span></button>
        <button type="button" role="tab" aria-selected={view === 'jobs'} onClick={() => setView('jobs')} className={cn('ui-segmented-item min-h-8 text-[11px]', view === 'jobs' && 'ui-segmented-item-active')}>{t('refinery.runs')} <span className="ml-1 font-mono opacity-60">{jobs.length}</span></button>
      </div>
      <div className="mt-2 flex gap-1.5">
        <label className="relative min-w-0 flex-1"><Icon name="search" size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" /><input aria-label={t('refinery.title')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'sources' ? t('refinery.searchSources') : t('refinery.searchRuns')} className="h-8 w-full rounded border border-border-subtle bg-panel px-7 text-[11px] text-text-primary outline-none focus:border-accent-blue/60" /></label>
        {view === 'sources' && <button type="button" onClick={() => void importAndOpen()} className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-accent-blue/35 px-2 text-[11px] text-accent-blue hover:bg-accent-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><Icon name="plus" size={12} />{t('refinery.import')}</button>}
      </div>
    </div>
    {(error || actionError) && <div role="alert" className="m-2 rounded border border-severity-critical/30 bg-severity-critical/8 p-2 text-[10px] text-severity-critical">{actionError ?? error}</div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {loading && <p className="px-2 py-4 text-center text-[11px] text-text-muted">{t('refinery.loading')}</p>}
      {!loading && view === 'sources' && filteredSources.map((source) => <article key={source.id} className={cn('group mb-1 rounded-md border p-1 transition-colors duration-150', selectedSourceId === source.id ? 'border-accent-blue/35 bg-accent-blue/8' : 'border-transparent hover:border-border-subtle hover:bg-raised/35')}>
        <button type="button" onClick={() => { selectSource(source.id); openKnowledgeRefineryTab(undefined, source.id); }} className="w-full rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"><div className="flex min-w-0 items-start gap-2"><Icon name="file" size={13} className="mt-0.5 text-accent-teal" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-text-primary">{source.name}</p><p className="mt-0.5 text-[10px] text-text-muted">{source.format?.toUpperCase() ?? 'TEXT'} · {source.sourceAvailable ? t('refinery.retained') : t('refinery.missing')}</p></div></div></button>
        <div className="flex justify-end gap-1 px-2 pb-1"><button type="button" disabled={!source.sourceAvailable || isAgentProcessing || startingSourceId !== null} onClick={() => void distillInNewConversation(source.id)} className="inline-flex h-6 items-center gap-1 rounded border border-accent-blue/30 px-1.5 text-[10px] text-accent-blue hover:bg-accent-blue/10 disabled:opacity-40"><Icon name="play" size={10} />{t('refinery.refine')}</button><button type="button" onClick={() => setConfirming({ kind: 'source', id: source.id })} className="ui-icon-button h-6 w-6" aria-label={`${t('refinery.deleteSource')}: ${source.name}`} title={t('refinery.deleteSource')}><Icon name="trash" size={11} /></button></div>
        {confirming?.kind === 'source' && confirming.id === source.id && <InlineConfirm label={t('refinery.deleteSourceConfirm')} onConfirm={() => void confirmDelete()} onCancel={() => setConfirming(null)} />}
      </article>)}
      {!loading && view === 'jobs' && filteredJobs.map((job) => <article key={job.id} className={cn('group mb-1 rounded-md border p-1 transition-colors duration-150', selectedJobId === job.id ? 'border-accent-blue/35 bg-accent-blue/8' : 'border-transparent hover:border-border-subtle hover:bg-raised/35')}>
        <button type="button" onClick={() => openJob(job.id)} className="w-full rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"><div className="flex items-start gap-2"><Icon name={job.status === 'failed' ? 'alert' : job.status === 'review_required' ? 'check' : 'sparkles'} size={13} className={cn('mt-0.5', job.status === 'failed' ? 'text-severity-critical' : job.status === 'review_required' ? 'text-accent-teal' : 'text-accent-blue')} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-text-primary">{job.source.name}</p><p className="mt-0.5 text-[10px] text-text-muted">{t(jobStatusKey(job.status))} · {job.candidateCounts.restriction + job.candidateCounts.skill + job.candidateCounts.workflow} {t('refinery.candidates')}</p></div></div></button>
        <div className="flex justify-end px-2 pb-1"><button type="button" onClick={() => setConfirming({ kind: 'job', id: job.id })} className="ui-icon-button h-6 w-6" aria-label={`${t('refinery.deleteRun')}: ${job.source.name}`} title={t('refinery.deleteRun')}><Icon name="trash" size={11} /></button></div>
        {confirming?.kind === 'job' && confirming.id === job.id && <InlineConfirm label={t('refinery.deleteRunConfirm')} onConfirm={() => void confirmDelete()} onCancel={() => setConfirming(null)} />}
      </article>)}
      {!loading && (view === 'sources' ? filteredSources.length === 0 : filteredJobs.length === 0) && <p className="px-3 py-8 text-center text-[11px] leading-5 text-text-muted">{view === 'sources' ? t('refinery.emptySources') : t('refinery.emptyRuns')}</p>}
    </div>
  </div>;
}

function InlineConfirm({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return <div className="mt-2 rounded border border-severity-medium/35 bg-severity-medium/8 p-2" role="alert"><p className="text-[10px] leading-4 text-severity-medium">{label}</p><div className="mt-1.5 flex justify-end gap-1"><button type="button" onClick={onCancel} className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-raised">{t('common.cancel')}</button><button type="button" onClick={onConfirm} className="rounded border border-severity-medium/45 px-1.5 py-0.5 text-[10px] text-severity-medium hover:bg-severity-medium/10">{t('common.delete')}</button></div></div>;
}

function filterItems<T>(items: T[], query: string, text: (item: T) => string) {
  const needle = query.trim().toLowerCase();
  return needle ? items.filter((item) => text(item).toLowerCase().includes(needle)) : items;
}

function jobStatusKey(status: string) { return status === 'extracting' ? 'refinery.statusExtracting' : status === 'analyzing' ? 'refinery.statusAnalyzing' : status === 'review_required' ? 'refinery.statusReviewRequired' : status === 'partially_applied' ? 'refinery.statusPartiallyApplied' : status === 'applied' ? 'refinery.statusApplied' : status === 'failed' ? 'refinery.statusFailed' : status === 'canceled' ? 'refinery.statusCanceled' : 'refinery.statusQueued'; }
