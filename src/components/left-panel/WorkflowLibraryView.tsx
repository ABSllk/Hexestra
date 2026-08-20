import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/shared';
import { useI18n, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { openWorkflowTab } from '@/stores/useTabStore';
import { useWorkflowStore } from '@/stores/useWorkflowStore';
import type { WorkflowSummary } from '@electron/contracts/workflows';

export function WorkflowLibraryView() {
  const { t } = useI18n();
  const workflows = useWorkflowStore((state) => state.workflows);
  const loading = useWorkflowStore((state) => state.loading);
  const error = useWorkflowStore((state) => state.error);
  const load = useWorkflowStore((state) => state.load);
  const read = useWorkflowStore((state) => state.read);
  const save = useWorkflowStore((state) => state.save);
  const remove = useWorkflowStore((state) => state.remove);
  const importWorkflow = useWorkflowStore((state) => state.importWorkflow);
  const exportWorkflow = useWorkflowStore((state) => state.exportWorkflow);
  const [query, setQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importConflict, setImportConflict] = useState<{ sourcePath: string; existing: WorkflowSummary } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workflows;
    return workflows.filter((workflow) => `${workflow.name} ${workflow.id} ${workflow.description} ${workflow.tags.join(' ')}`.toLowerCase().includes(needle));
  }, [query, workflows]);

  const handleImport = async (overwrite = false) => {
    const result = await importWorkflow(importConflict?.sourcePath, overwrite);
    if (result.conflict && result.sourcePath && result.existing) {
      setImportConflict({ sourcePath: result.sourcePath, existing: result.existing });
      return;
    }
    if (result.workflow) {
      setImportConflict(null);
      openWorkflowTab(result.workflow.id, result.workflow.name, 'preview');
      setNotice(t('workflow.imported'));
    }
  };

  const handleCopy = async (workflow: WorkflowSummary) => {
    const document = await read(workflow.id);
    if (!document) return;
    const copyId = `${workflow.id}-copy`;
    const copied = await save({ id: copyId, name: `${workflow.name} Copy`, description: workflow.description, version: workflow.version, tags: workflow.tags, body: document.body });
    if (copied) openWorkflowTab(copied.id, copied.name, 'edit');
  };

  const handleDelete = async (workflow: WorkflowSummary) => {
    if (confirmDeleteId !== workflow.id) {
      setConfirmDeleteId(workflow.id);
      return;
    }
    await remove(workflow.id, workflow.fingerprint || undefined);
    setConfirmDeleteId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="shrink-0 border-b border-border-subtle bg-panel/50 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <label className="relative min-w-0 flex-1"><Icon name="search" size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" /><input aria-label={t('workflow.search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('workflow.search')} className="h-8 w-full rounded border border-border-subtle bg-panel px-7 text-[11px] text-text-primary outline-none focus:border-accent-blue/60" /></label>
          <button type="button" onClick={() => void handleImport()} className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-border-subtle px-2 text-[11px] text-text-secondary hover:border-accent-blue/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><Icon name="folder" size={12} />{t('workflow.import')}</button>
          <button type="button" onClick={() => openWorkflowTab('new-workflow', t('workflow.new'), 'edit')} className="ui-icon-button h-8 w-8" aria-label={t('workflow.new')} title={t('workflow.new')}><Icon name="plus" size={13} /></button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted"><span>{t('workflow.global')}</span><span className="font-mono">{workflows.length}</span></div>
      </div>

      {importConflict && <div className="m-2 rounded border border-severity-medium/35 bg-severity-medium/8 p-2 text-[11px] text-severity-medium"><p>{t('workflow.importConflict')}</p><div className="mt-2 flex gap-1.5"><button type="button" onClick={() => void handleImport(true)} className="rounded border border-severity-medium/40 px-2 py-1 text-2xs hover:bg-severity-medium/10">{t('workflow.overwrite')}</button><button type="button" onClick={() => setImportConflict(null)} className="rounded border border-border-subtle px-2 py-1 text-2xs text-text-muted">{t('common.cancel')}</button></div></div>}
      {notice && <div className="mx-2 mt-2 flex items-center justify-between rounded border border-accent-teal/25 bg-accent-teal/8 px-2 py-1.5 text-[10px] text-accent-teal"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t('workflow.closeNotice')}><Icon name="close" size={11} /></button></div>}
      {error && <div role="alert" className="m-2 rounded border border-severity-critical/30 bg-severity-critical/8 px-2 py-1.5 text-[10px] text-severity-critical">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && <div className="px-3 py-5 text-center text-[11px] text-text-muted">{t('workflow.loading')}</div>}
        {!loading && filtered.length === 0 && <div className="px-3 py-8 text-center text-[11px] leading-5 text-text-muted">{query ? t('workflow.noMatch') : t('workflow.empty')}</div>}
        {!loading && filtered.map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} confirming={confirmDeleteId === workflow.id} onOpen={(mode) => openWorkflowTab(workflow.id, workflow.name, mode)} onRun={() => openWorkflowTab(workflow.id, workflow.name, 'preview')} onCopy={() => void handleCopy(workflow)} onExport={() => void exportWorkflow(workflow.id)} onDelete={() => void handleDelete(workflow)} t={t} />)}
      </div>
    </div>
  );
}

function WorkflowRow({ workflow, confirming, onOpen, onRun, onCopy, onExport, onDelete, t }: { workflow: WorkflowSummary; confirming: boolean; onOpen: (mode: 'preview' | 'edit') => void; onRun: () => void; onCopy: () => void; onExport: () => void; onDelete: () => void; t: (key: TranslationKey, values?: Record<string, string | number>) => string }) {
  return <article className={cn('group mb-1 rounded-md border p-1 transition-colors duration-150', workflow.valid ? 'border-transparent hover:border-border-subtle hover:bg-raised/35' : 'border-severity-medium/35 bg-severity-medium/5 hover:border-severity-medium/55 hover:bg-severity-medium/8')}>
    <button type="button" onClick={onRun} className="w-full rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"><div className="flex items-start gap-2"><Icon name="sparkles" size={13} className={workflow.valid ? 'mt-0.5 text-accent-blue' : 'mt-0.5 text-severity-medium'} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-xs font-medium text-text-primary">{workflow.name}</span><span className="shrink-0 font-mono text-[9px] text-text-muted">{workflow.version || t('workflow.invalid')}</span></div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">{workflow.description || workflow.diagnostics[0] || t('workflow.objectiveHint')}</p></div></div></button>
    <div className="flex items-center justify-between gap-1.5 px-2 pb-1"><div className="flex min-w-0 flex-wrap gap-1">{workflow.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-accent-blue/8 px-1.5 py-0.5 font-mono text-[9px] text-accent-blue">{tag}</span>)}</div><div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={onRun} className="rounded border border-accent-blue/30 px-1.5 py-1 text-[10px] text-accent-blue hover:bg-accent-blue/10" title={t('workflow.run')}><Icon name="send" size={11} /></button><button type="button" onClick={() => onOpen('edit')} className="ui-icon-button h-6 w-6" title={t('workflow.edit')} aria-label={t('workflow.edit')}><Icon name="edit" size={11} /></button><button type="button" onClick={onCopy} className="ui-icon-button h-6 w-6" title={t('workflow.copy')} aria-label={t('workflow.copy')}><Icon name="copy" size={11} /></button><button type="button" onClick={onExport} className="ui-icon-button h-6 w-6" title={t('workflow.export')} aria-label={t('workflow.export')}><Icon name="file" size={11} /></button><button type="button" onClick={onDelete} className="ui-icon-button h-6 w-6 text-severity-medium" title={t('workflow.delete')} aria-label={t('workflow.delete')}><Icon name={confirming ? 'check' : 'trash'} size={11} /></button></div></div>
    {confirming && <p className="mt-2 rounded bg-severity-medium/8 px-2 py-1.5 text-[10px] text-severity-medium">{t('workflow.deleteConfirm')}</p>}
  </article>;
}
