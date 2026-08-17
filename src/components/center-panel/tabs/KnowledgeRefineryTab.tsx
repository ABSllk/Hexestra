import { useEffect, useMemo, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Icon } from '@/components/shared';
import { cn } from '@/lib/cn';
import { detectEditorLanguage } from '@/lib/editorLanguage';
import { prepareMonaco } from '@/lib/monaco';
import { MONACO_THEME_NAMES } from '@/lib/theme';
import { APP_CODE_FONT_SIZE_PX, getMonoFontFamily } from '@/lib/typography';
import { useKnowledgeRefineryStore, useSessionStore, useTabStore } from '@/stores';
import type { KnowledgeSource, RefineryCandidate, RefineryCandidatePayload, RefineryCandidateSummary, RefineryDebugLog, RefineryJob, RefineryOutputKind, SourceAnchor } from '@/types';
import { useAppPreferences, useI18n } from '@/i18n';

type CandidateFilter = 'all' | RefineryOutputKind | 'pending' | 'conflicts';
type CandidatePage = { items: RefineryCandidateSummary[]; beforeCursor: string | null; hasEarlier: boolean };
type SourcePreviewPage = { items: Array<{ anchor: SourceAnchor; text: string }>; beforeCursor: string | null; hasEarlier: boolean };

export function KnowledgeRefineryTab({ tabId }: { tabId: string }) {
  const { t } = useI18n();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const tab = useTabStore((state) => state.tabs.find((item) => item.id === tabId));
  const sources = useKnowledgeRefineryStore((state) => state.sources);
  const jobs = useKnowledgeRefineryStore((state) => state.jobs);
  const selectedJobId = useKnowledgeRefineryStore((state) => state.selectedJobId);
  const selectJob = useKnowledgeRefineryStore((state) => state.selectJob);
  const loadLibrary = useKnowledgeRefineryStore((state) => state.load);
  const [job, setJob] = useState<RefineryJob | null>(null);
  const [candidates, setCandidates] = useState<RefineryCandidateSummary[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [hasEarlierCandidates, setHasEarlierCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<RefineryCandidate | null>(null);
  const [applySelection, setApplySelection] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [sourcePreview, setSourcePreview] = useState<Array<{ anchor: SourceAnchor; text: string }>>([]);
  const [sourcePreviewLoaded, setSourcePreviewLoaded] = useState(false);
  const [debugLog, setDebugLog] = useState<RefineryDebugLog | null>(null);
  const [debugVisible, setDebugVisible] = useState(false);
  const [detailView, setDetailView] = useState<'candidate' | 'source'>('candidate');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestedSourceId = typeof tab?.data?.sourceId === 'string' ? tab.data.sourceId : null;
  const requestedJobId = requestedSourceId ? null : typeof tab?.data?.jobId === 'string' ? tab.data.jobId : selectedJobId;
  const previewSourceId = requestedSourceId ?? (job?.source.kind === 'document' ? job.source.id : null);
  const previewSource = sources.find((source) => source.id === previewSourceId) ?? (job?.source.kind === 'document' ? job.source : undefined);
  const outputKind = filter === 'restriction' || filter === 'skill' || filter === 'workflow' ? filter : undefined;
  const isCandidateVisible = (candidate: RefineryCandidateSummary) => (
    filter === 'pending'
      ? candidate.decision === 'pending' || candidate.decision === 'accepted'
      : filter === 'conflicts'
        ? Boolean(candidate.diagnostic) || candidate.dedupe.action !== 'create'
        : true
  );

  const refresh = async () => {
    if (!window.hexestra || !sessionId || !requestedJobId) {
      setJob(null);
      setCandidates([]);
      setSelectedCandidateId(null);
      setDebugLog(null);
      return;
    }
    try {
      const [nextJob, page, debug] = await Promise.all([
        window.hexestra.invoke<RefineryJob | null>('refinery:jobs:read', sessionId, requestedJobId),
        window.hexestra.invoke<CandidatePage>('refinery:candidates:page', sessionId, requestedJobId, undefined, outputKind),
        window.hexestra.invoke<RefineryDebugLog>('refinery:jobs:debug', sessionId, requestedJobId),
      ]);
      if (!nextJob) { setJob(null); setDebugLog(null); return; }
      const visible = page.items.filter(isCandidateVisible);
      setJob(nextJob);
      setDebugLog(debug);
      setCandidates(visible);
      setCandidateCursor(page.beforeCursor);
      setHasEarlierCandidates(page.hasEarlier);
      setApplySelection((current) => new Set([...current].filter((id) => visible.some((candidate) => candidate.id === id))));
      setSelectedCandidateId((current) => visible.some((candidate) => candidate.id === current) ? current : visible[0]?.id ?? null);
      await loadLibrary(sessionId);
    } catch (reason) {
      setError(String(reason));
    }
  };

  useEffect(() => {
    if (requestedJobId) selectJob(requestedJobId);
    setDetailView('candidate');
    setDebugVisible(false);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, requestedJobId, sessionId]);

  useEffect(() => {
    if (!window.hexestra || !sessionId) return;
    return window.hexestra.on('refinery:changed', (value: unknown) => {
      const event = value as { sessionId?: string; jobId?: string };
      if (event.sessionId === sessionId && (!event.jobId || event.jobId === requestedJobId)) void refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedJobId, sessionId]);

  useEffect(() => {
    if (job?.status === 'failed') setDebugVisible(true);
  }, [job?.status]);

  useEffect(() => {
    if (!window.hexestra || !sessionId || !requestedJobId || !selectedCandidateId) {
      setSelectedCandidate(null);
      return;
    }
    let active = true;
    void window.hexestra.invoke<RefineryCandidate | null>('refinery:candidates:read', sessionId, requestedJobId, selectedCandidateId)
      .then((candidate) => { if (active) setSelectedCandidate(candidate); })
      .catch((reason) => active && setError(String(reason)));
    return () => { active = false; };
  }, [requestedJobId, selectedCandidateId, sessionId]);

  useEffect(() => {
    if (!window.hexestra || !previewSourceId) {
      setSourcePreview([]);
      setSourcePreviewLoaded(false);
      return;
    }
    let active = true;
    setSourcePreviewLoaded(false);
    void (async () => {
      try {
        let page = await window.hexestra!.invoke<SourcePreviewPage>('refinery:sources:preview', previewSourceId);
        let items = page.items;
        const seenCursors = new Set<string>();
        while (page.hasEarlier && page.beforeCursor && !seenCursors.has(page.beforeCursor)) {
          seenCursors.add(page.beforeCursor);
          page = await window.hexestra!.invoke<SourcePreviewPage>('refinery:sources:preview', previewSourceId, page.beforeCursor);
          items = [...page.items, ...items];
        }
        if (!active) return;
        setSourcePreview(items);
        setSourcePreviewLoaded(true);
      } catch (reason) {
        if (!active) return;
        setSourcePreviewLoaded(true);
        setError(String(reason));
      }
    })();
    return () => { active = false; };
  }, [previewSourceId]);

  const loadEarlierCandidates = async () => {
    if (!window.hexestra || !sessionId || !requestedJobId || !candidateCursor) return;
    setBusy(true);
    try {
      const page = await window.hexestra.invoke<CandidatePage>('refinery:candidates:page', sessionId, requestedJobId, candidateCursor, outputKind);
      const visible = page.items.filter(isCandidateVisible);
      setCandidates((current) => [...visible, ...current]);
      setCandidateCursor(page.beforeCursor);
      setHasEarlierCandidates(page.hasEarlier);
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  const updateCandidate = async (candidate: RefineryCandidate, patch: {
    title?: string;
    rationale?: string;
    decision?: 'accepted' | 'rejected' | 'pending';
    suggestedScope?: 'global' | 'project';
    payload?: RefineryCandidatePayload;
  }) => {
    if (!window.hexestra || !sessionId || !job) return;
    setBusy(true);
    try {
      const updated = await window.hexestra.invoke<RefineryCandidate>('refinery:candidates:update', sessionId, job.id, candidate.id, patch);
      setSelectedCandidate(updated);
      await refresh();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  const applyCandidates = async (ids: string[]) => {
    if (!window.hexestra || !sessionId || !job || ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const fullCandidates = await Promise.all(ids.map((id) => window.hexestra.invoke<RefineryCandidate | null>('refinery:candidates:read', sessionId, job.id, id)));
      const pending = fullCandidates.filter((candidate): candidate is RefineryCandidate => Boolean(candidate && candidate.decision === 'pending'));
      await Promise.all(pending.map((candidate) => window.hexestra.invoke('refinery:candidates:update', sessionId, job.id, candidate.id, { decision: 'accepted' })));
      const result = await window.hexestra.invoke<{ failed: Array<{ message: string }> }>('refinery:candidates:apply', sessionId, job.id, ids);
      if (result.failed.length) setError(result.failed.map((failure) => failure.message).join('\n'));
      setApplySelection(new Set());
      await refresh();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  const toggleApplySelection = (candidateId: string) => setApplySelection((current) => {
    const next = new Set(current);
    if (next.has(candidateId)) next.delete(candidateId);
    else next.add(candidateId);
    return next;
  });

  if (!sessionId) return <EmptyRefinery message={t('refinery.openProject')} />;
  if (requestedSourceId) return <SourceViewerPage source={previewSource} sourcePreview={sourcePreview} loaded={sourcePreviewLoaded} error={error} />;
  if (!requestedJobId && jobs.length === 0) return <EmptyRefinery message={t('refinery.importOrDistill')} />;
  if (!job) return <EmptyRefinery message={t('refinery.selectRun')} />;

  return <div className="flex h-full min-h-0 flex-col bg-canvas text-text-primary">
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle bg-panel/60 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><Icon name="sparkles" size={16} className="text-accent-blue" /><span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-blue">{t('refinery.title')}</span><StatusPill status={job.status} /></div>
        <h1 className="mt-1 truncate text-lg font-semibold">{job.source.name}</h1>
        <p className="mt-1 text-xs text-text-muted">{job.progress.phase} · {job.progress.completed}/{job.progress.total || 1} · {job.modelSnapshot}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setDebugVisible((value) => !value)} aria-expanded={debugVisible} className={cn('h-8 rounded border px-2 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', debugVisible ? 'border-accent-blue/45 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle text-text-muted hover:border-accent-blue/40 hover:text-accent-blue')}><Icon name="eye" size={12} className="mr-1 inline-block" />{t('refinery.debugOutput')} {debugLog?.total ? `(${debugLog.total})` : ''}</button>
        <button type="button" onClick={() => void jobAction('refinery:jobs:retry')} disabled={busy || job.status === 'analyzing'} className="ui-icon-button h-8 w-8" aria-label={t('refinery.retry')} title={t('refinery.retry')}><Icon name="play" size={13} /></button>
        <button type="button" onClick={() => void jobAction('refinery:jobs:cancel')} disabled={busy || !['queued', 'extracting', 'analyzing'].includes(job.status)} className="ui-icon-button h-8 w-8" aria-label={t('refinery.cancel')} title={t('refinery.cancel')}><Icon name="pause" size={13} /></button>
      </div>
    </header>
    {error && <div role="alert" aria-live="assertive" className="mx-5 mt-3 flex items-center justify-between gap-3 rounded border border-severity-critical/35 bg-severity-critical/8 px-3 py-2 text-xs text-severity-critical"><span className="whitespace-pre-wrap">{error}</span><button type="button" onClick={() => setError(null)} aria-label={t('common.close')}><Icon name="close" size={12} /></button></div>}
    {job.diagnostics.length > 0 && <div role="status" aria-live="polite" className="mx-5 mt-3 rounded border border-severity-medium/35 bg-severity-medium/8 px-3 py-2 text-xs text-severity-medium">{job.diagnostics[0]}</div>}
    {debugVisible && <RefineryDebugOutput log={debugLog} />}
    <div className="min-h-0 flex-1 overflow-hidden p-5">
      <div className="grid h-full min-h-0 grid-cols-[minmax(17rem,0.78fr)_minmax(0,1.7fr)] overflow-hidden rounded-lg border border-border-subtle bg-panel/35">
        <aside className="flex min-h-0 flex-col border-r border-border-subtle">
          <div className="border-b border-border-subtle p-3">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('refinery.candidates')}>
              {(['all', 'restriction', 'skill', 'workflow', 'pending', 'conflicts'] as CandidateFilter[]).map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)} className={cn('rounded px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', filter === item ? 'bg-accent-blue/12 text-accent-blue' : 'text-text-muted hover:bg-raised hover:text-text-secondary')}>{filterLabel(item, t)}</button>)}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {hasEarlierCandidates && <button type="button" onClick={() => void loadEarlierCandidates()} disabled={busy} className="mb-2 w-full rounded border border-border-subtle px-2 py-1.5 text-[10px] text-text-muted hover:border-accent-blue/40 hover:text-accent-blue disabled:opacity-50">{busy ? t('refinery.loadingMore') : t('refinery.loadMore')}</button>}
            {candidates.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-text-muted">{t('refinery.noCandidates')}</p>}
            {candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} active={candidate.id === selectedCandidateId} checked={applySelection.has(candidate.id)} onSelect={() => setSelectedCandidateId(candidate.id)} onToggle={() => toggleApplySelection(candidate.id)} />)}
          </div>
        </aside>
        <section className="flex min-h-0 flex-col overflow-hidden">
          {job.source.kind === 'document' && <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-4 py-2" role="tablist" aria-label={t('refinery.sourcePreview')}>
            <button type="button" role="tab" aria-selected={detailView === 'candidate'} onClick={() => setDetailView('candidate')} className={cn('rounded px-2.5 py-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', detailView === 'candidate' ? 'bg-accent-blue/12 text-accent-blue' : 'text-text-muted hover:bg-raised hover:text-text-secondary')}>{t('refinery.candidateDetails')}</button>
            <button type="button" role="tab" aria-selected={detailView === 'source'} onClick={() => setDetailView('source')} className={cn('rounded px-2.5 py-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', detailView === 'source' ? 'bg-accent-blue/12 text-accent-blue' : 'text-text-muted hover:bg-raised hover:text-text-secondary')}>{t('refinery.sourceText')}</button>
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {detailView === 'source' && job.source.kind === 'document'
              ? <SourceTextViewer source={previewSource} sourcePreview={sourcePreview} loaded={sourcePreviewLoaded} />
              : selectedCandidate
                ? <CandidateEditor candidate={selectedCandidate} busy={busy} onChange={updateCandidate} onApply={() => void applyCandidates([selectedCandidate.id])} />
                : job.source.kind === 'document'
                  ? <SourceTextViewer source={previewSource} sourcePreview={sourcePreview} loaded={sourcePreviewLoaded} />
                  : <SourcePreview sourceKind={job.source.kind} sourcePreview={sourcePreview} />}
          </div>
        </section>
      </div>
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-panel/70 px-5 py-2.5 text-[11px] text-text-muted">
      <span>{job.candidateCounts.restriction} {t('refinery.restrictions').toLowerCase()} · {job.candidateCounts.skill} {t('refinery.skills').toLowerCase()} · {job.candidateCounts.workflow} {t('refinery.workflows').toLowerCase()}</span>
      <div className="flex items-center gap-3"><span>{job.candidateCounts.pending} {t('refinery.awaitingReview')} · {job.candidateCounts.applied} {t('common.saved')}</span>{applySelection.size > 0 && <button type="button" onClick={() => void applyCandidates([...applySelection])} disabled={busy} className="rounded border border-accent-blue/35 px-2 py-1 text-[10px] text-accent-blue hover:bg-accent-blue/10 disabled:opacity-50">{t('refinery.apply')} ({applySelection.size})</button>}</div>
    </footer>
  </div>;

  async function jobAction(channel: 'refinery:jobs:retry' | 'refinery:jobs:cancel') {
    if (!window.hexestra || !sessionId || !job) return;
    setBusy(true);
    try { await window.hexestra.invoke(channel, sessionId, job.id); await refresh(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
}

function CandidateRow({ candidate, active, checked, onSelect, onToggle }: { candidate: RefineryCandidateSummary; active: boolean; checked: boolean; onSelect: () => void; onToggle: () => void }) {
  const { t } = useI18n();
  const selectable = candidate.decision !== 'rejected' && candidate.decision !== 'applied' && !candidate.diagnostic && candidate.dedupe.action !== 'skip' && candidate.dedupe.action !== 'merge';
  return <div className={cn('mb-1 rounded border p-2.5 transition-colors', active ? 'border-accent-blue/45 bg-accent-blue/8' : 'border-transparent hover:border-border-subtle hover:bg-raised/50')}>
    <div className="flex items-start gap-2">
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={!selectable} aria-label={t('refinery.selectForApply', { title: candidate.title })} className="mt-0.5 accent-blue disabled:opacity-35" />
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <div className="flex items-start gap-2"><Icon name={candidateIcon(candidate.kind)} size={13} className={candidate.diagnostic ? 'mt-0.5 text-severity-medium' : 'mt-0.5 text-accent-blue'} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-1"><span className="truncate text-[11px] font-medium text-text-primary">{candidate.title}</span><span className="font-mono text-[9px] text-text-muted">{Math.round(candidate.confidence * 100)}%</span></div><p className="mt-1 text-[10px] text-text-muted">{t(candidateKindKey(candidate.kind))} · {t(candidateDecisionKey(candidate.decision))} · {t(dedupeActionKey(candidate.dedupe.action))}</p>{candidate.diagnostic && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-severity-medium">{candidate.diagnostic}</p>}</div></div>
      </button>
    </div>
  </div>;
}

function CandidateEditor({ candidate, busy, onChange, onApply }: {
  candidate: RefineryCandidate;
  busy: boolean;
  onChange: (candidate: RefineryCandidate, patch: { title?: string; rationale?: string; decision?: 'accepted' | 'rejected' | 'pending'; suggestedScope?: 'global' | 'project'; payload?: RefineryCandidatePayload }) => Promise<void>;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(candidate.title);
  const [rationale, setRationale] = useState(candidate.rationale);
  const [draft, setDraft] = useState(() => JSON.stringify(candidate.payload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  useEffect(() => { setTitle(candidate.title); setRationale(candidate.rationale); setDraft(JSON.stringify(candidate.payload, null, 2)); setParseError(null); }, [candidate.id, candidate.payload, candidate.rationale, candidate.title]);
  const savePayload = async () => {
    try {
      const payload = JSON.parse(draft) as RefineryCandidatePayload;
      setParseError(null);
      await onChange(candidate, { title, rationale, payload });
    } catch (error) { setParseError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="mx-auto max-w-4xl">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded bg-accent-blue/10 px-2 py-1 font-mono text-[10px] uppercase text-accent-blue">{t(candidateKindKey(candidate.kind))}</span><span className="font-mono text-[10px] text-text-muted">{t(dedupeActionKey(candidate.dedupe.action))}</span></div><input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void onChange(candidate, { title, rationale })} disabled={candidate.decision === 'applied'} className="mt-2 w-full bg-transparent text-base font-semibold text-text-primary outline-none focus:text-accent-blue disabled:opacity-70" aria-label={t('common.edit')} /><textarea value={rationale} onChange={(event) => setRationale(event.target.value)} onBlur={() => void onChange(candidate, { rationale })} disabled={candidate.decision === 'applied'} className="mt-1 min-h-14 w-full resize-y bg-transparent text-xs leading-5 text-text-secondary outline-none focus:text-text-primary disabled:opacity-70" aria-label={t('refinery.candidateRationale')} /></div><div className="flex gap-1.5"><button type="button" onClick={() => void onChange(candidate, { decision: 'rejected' })} disabled={busy || candidate.decision === 'applied'} className="rounded border border-border-subtle px-2.5 py-1.5 text-[11px] text-text-muted hover:bg-raised disabled:opacity-40">{t('refinery.reject')}</button><button type="button" onClick={() => void onChange(candidate, { decision: 'accepted' })} disabled={busy || candidate.decision === 'applied'} className="rounded border border-accent-blue/35 px-2.5 py-1.5 text-[11px] text-accent-blue hover:bg-accent-blue/10 disabled:opacity-40">{t('refinery.accept')}</button><button type="button" onClick={onApply} disabled={busy || candidate.decision === 'applied' || Boolean(candidate.diagnostic)} className="rounded bg-accent-blue px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-blue/85 disabled:opacity-40">{t('refinery.apply')}</button></div></div>
    {candidate.diagnostic && <div role="alert" className="mt-4 rounded border border-severity-medium/35 bg-severity-medium/8 px-3 py-2 text-xs leading-5 text-severity-medium">{candidate.diagnostic}</div>}
    <div className="mt-4 rounded border border-border-subtle bg-canvas/55 px-3 py-2 text-xs text-text-muted"><span className="font-medium text-text-secondary">{candidate.dedupe.action}</span>{candidate.dedupe.targetId ? ' · ' + candidate.dedupe.targetId : ''}{candidate.dedupe.reason ? ' · ' + candidate.dedupe.reason : ''}</div>
    {candidate.kind !== 'workflow' && <div className="mt-4"><label className="text-xs font-medium text-text-secondary">{t('refinery.suggestedScope')}</label><div className="mt-1.5 flex gap-1.5"><button type="button" onClick={() => void onChange(candidate, { suggestedScope: 'global' })} className={cn('rounded border px-2.5 py-1.5 text-[11px]', candidate.suggestedScope !== 'project' ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle text-text-muted')}>{t('refinery.global')}</button><button type="button" onClick={() => void onChange(candidate, { suggestedScope: 'project' })} className={cn('rounded border px-2.5 py-1.5 text-[11px]', candidate.suggestedScope === 'project' ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border-subtle text-text-muted')}>{t('refinery.project')}</button></div></div>}
    <div className="mt-5"><div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-medium text-text-secondary">{t('refinery.proposedArtifact')}</label><button type="button" onClick={() => void savePayload()} disabled={busy || candidate.decision === 'applied'} className="rounded border border-border-subtle px-2 py-1 text-[10px] text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue disabled:opacity-40">{t('refinery.saveEdits')}</button></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} disabled={candidate.decision === 'applied'} className="min-h-[24rem] w-full resize-y rounded-lg border border-border-subtle bg-canvas p-3 font-mono text-xs leading-5 text-text-primary outline-none focus:border-accent-blue/60 disabled:opacity-60" />{parseError && <p role="alert" className="mt-2 text-xs text-severity-critical">{parseError}</p>}</div>
    <div className="mt-5 border-t border-border-subtle pt-4"><h3 className="text-xs font-medium text-text-secondary">{t('refinery.sourceAnchors')}</h3><div className="mt-2 space-y-2">{candidate.anchors.map((anchor, index) => <div key={anchor.label + '-' + index} className="rounded border border-border-subtle bg-canvas/55 px-3 py-2"><p className="font-mono text-[10px] text-accent-teal">{anchor.label}</p>{anchor.excerpt && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-text-muted">{anchor.excerpt}</p>}</div>)}</div></div>
  </div>;
}

function SourcePreview({ sourceKind, sourcePreview }: { sourceKind: 'document' | 'conversation'; sourcePreview: Array<{ anchor: SourceAnchor; text: string }> }) {
  const { t } = useI18n();
  return <div className="mx-auto max-w-3xl"><div className="flex items-center gap-2 text-accent-blue"><Icon name="eye" size={15} /><span className="font-mono text-[11px] uppercase tracking-[0.14em]">{t('refinery.sourcePreview')}</span></div>{sourceKind === 'conversation' ? <p className="mt-4 rounded border border-border-subtle bg-canvas/55 p-4 text-sm leading-6 text-text-secondary">{t('refinery.conversationPreview')}</p> : <div className="mt-4 space-y-2">{sourcePreview.map((chunk, index) => <article key={chunk.anchor.label + '-' + index} className="rounded border border-border-subtle bg-canvas/55 p-3"><p className="font-mono text-[10px] text-accent-teal">{chunk.anchor.label}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{chunk.text}</p></article>)}{sourcePreview.length === 0 && <p className="text-sm text-text-muted">{t('refinery.noExtractable')}</p>}</div>}</div>;
}

function SourceViewerPage({ source, sourcePreview, loaded, error }: { source?: KnowledgeSource; sourcePreview: Array<{ anchor: SourceAnchor; text: string }>; loaded: boolean; error: string | null }) {
  const { t } = useI18n();
  return <div className="flex h-full min-h-0 flex-col bg-canvas text-text-primary">
    <header className="flex shrink-0 items-start gap-3 border-b border-border-subtle bg-panel/60 px-5 py-4">
      <Icon name="file" size={16} className="mt-0.5 text-accent-teal" />
      <div className="min-w-0"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-blue">{t('refinery.sourceText')}</p><h1 className="mt-1 truncate text-lg font-semibold">{source?.name ?? t('common.loading')}</h1><p className="mt-1 text-xs text-text-muted">{source?.format?.toUpperCase() ?? 'TEXT'} · {source?.sourceAvailable ? t('refinery.retained') : t('refinery.missing')}</p></div>
    </header>
    {error && <div role="alert" className="mx-5 mt-3 rounded border border-severity-critical/35 bg-severity-critical/8 px-3 py-2 text-xs text-severity-critical">{error}</div>}
    <div className="min-h-0 flex-1 p-5"><SourceTextViewer source={source} sourcePreview={sourcePreview} loaded={loaded} /></div>
  </div>;
}

function SourceTextViewer({ source, sourcePreview, loaded }: { source?: KnowledgeSource; sourcePreview: Array<{ anchor: SourceAnchor; text: string }>; loaded: boolean }) {
  const { t } = useI18n();
  const { resolvedTheme } = useAppPreferences();
  const content = useMemo(() => sourcePreview.map((chunk) => chunk.text).join('\n\n'), [sourcePreview]);
  const handleMount: OnMount = (_editor, editorApi) => prepareMonaco(editorApi, resolvedTheme);

  return <div className="flex h-full min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-canvas/55">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-panel/45 px-3 py-2">
      <div className="min-w-0"><p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-accent-blue">{t('refinery.sourceText')}</p><p className="mt-0.5 truncate text-[10px] text-text-muted">{source?.name ?? t('common.loading')}</p></div>
    </div>
    <div className="min-h-0 flex-1" aria-label={t('refinery.sourceText')}>
      {sourcePreview.length > 0 ? <Editor
        height="100%"
        language={detectEditorLanguage(source?.name)}
        value={content}
        theme={MONACO_THEME_NAMES[resolvedTheme]}
        onMount={handleMount}
        options={{
          readOnly: true,
          domReadOnly: true,
          fontFamily: getMonoFontFamily(),
          fontSize: APP_CODE_FONT_SIZE_PX,
          minimap: { enabled: false },
          wordWrap: 'off',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: 'on',
          folding: false,
          renderLineHighlight: 'none',
          padding: { top: 8, bottom: 8 },
        }}
      /> : <p className="p-5 text-sm text-text-muted">{loaded ? t('refinery.noExtractable') : t('common.loading')}</p>}
    </div>
  </div>;
}

function RefineryDebugOutput({ log }: { log: RefineryDebugLog | null }) {
  const { t } = useI18n();
  return <section className="mx-5 mt-3 overflow-hidden rounded-lg border border-border-subtle bg-canvas/65" aria-label={t('refinery.debugOutput')}>
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-panel/50 px-3 py-2"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-blue">{t('refinery.debugOutput')}</span>{log?.truncated && <span className="text-[10px] text-severity-medium">{t('refinery.debugTruncated')}</span>}</div>
    <div className="max-h-56 overflow-auto" role="log" aria-live="polite">
      {!log?.items.length && <p className="px-3 py-4 text-xs text-text-muted">{t('refinery.debugNoOutput')}</p>}
      {log?.items.map((entry, index) => <article key={`${entry.at}-${index}`} className="border-b border-border-subtle/70 px-3 py-2 last:border-b-0"><p className="font-mono text-[10px] text-text-muted">#{entry.attempt} · {entry.anchor.label} · {entry.kind} · {entry.at}</p><pre className="m-0 mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary">{entry.text}</pre></article>)}
    </div>
  </section>;
}

function EmptyRefinery({ message }: { message: string }) {
  const { t } = useI18n();
  return <div className="flex h-full items-center justify-center bg-canvas"><div className="max-w-md text-center"><Icon name="sparkles" size={26} className="mx-auto text-accent-blue" /><h1 className="mt-3 text-lg font-semibold text-text-primary">{t('refinery.title')}</h1><p className="mt-2 text-sm leading-6 text-text-muted">{message}</p></div></div>;
}

function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = status === 'failed' ? 'text-severity-critical border-severity-critical/35 bg-severity-critical/8' : status === 'review_required' || status === 'applied' ? 'text-accent-teal border-accent-teal/30 bg-accent-teal/8' : 'text-accent-blue border-accent-blue/30 bg-accent-blue/8';
  return <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase', tone)}>{t(jobStatusKey(status))}</span>;
}

function candidateIcon(kind: RefineryOutputKind): 'shield' | 'sparkles' | 'send' { return kind === 'restriction' ? 'shield' : kind === 'skill' ? 'sparkles' : 'send'; }
function filterLabel(filter: CandidateFilter, t: (key: 'refinery.all' | 'refinery.restrictions' | 'refinery.skills' | 'refinery.workflows' | 'refinery.review' | 'refinery.conflicts') => string) { return filter === 'all' ? t('refinery.all') : filter === 'restriction' ? t('refinery.restrictions') : filter === 'skill' ? t('refinery.skills') : filter === 'workflow' ? t('refinery.workflows') : filter === 'pending' ? t('refinery.review') : t('refinery.conflicts'); }
function candidateKindKey(kind: RefineryOutputKind) { return kind === 'restriction' ? 'refinery.kindRestriction' : kind === 'skill' ? 'refinery.kindSkill' : 'refinery.kindWorkflow'; }
function candidateDecisionKey(decision: RefineryCandidateSummary['decision']) { return decision === 'accepted' ? 'refinery.decisionAccepted' : decision === 'rejected' ? 'refinery.decisionRejected' : decision === 'applied' ? 'refinery.decisionApplied' : decision === 'failed' ? 'refinery.decisionFailed' : 'refinery.decisionPending'; }
function dedupeActionKey(action: RefineryCandidateSummary['dedupe']['action']) { return action === 'update' ? 'refinery.dedupeUpdate' : action === 'merge' ? 'refinery.dedupeMerge' : action === 'skip' ? 'refinery.dedupeSkip' : 'refinery.dedupeCreate'; }
function jobStatusKey(status: string) { return status === 'extracting' ? 'refinery.statusExtracting' : status === 'analyzing' ? 'refinery.statusAnalyzing' : status === 'review_required' ? 'refinery.statusReviewRequired' : status === 'partially_applied' ? 'refinery.statusPartiallyApplied' : status === 'applied' ? 'refinery.statusApplied' : status === 'failed' ? 'refinery.statusFailed' : status === 'canceled' ? 'refinery.statusCanceled' : 'refinery.statusQueued'; }
