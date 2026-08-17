import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/shared';
import { MarkdownContent } from '@/components/right-panel/AgentTimelineMessage';
import { useChatStore, useTabStore, useWorkflowStore } from '@/stores';
import type { WorkflowDocument } from '@electron/contracts/workflows';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';

const NEW_WORKFLOW_ID = 'new-workflow';

export function WorkflowTab({ tabId }: { tabId: string }) {
  const { t } = useI18n();
  const tab = useTabStore((state) => state.tabs.find((item) => item.id === tabId));
  const updateTabData = useTabStore((state) => state.updateTabData);
  const closeTab = useTabStore((state) => state.closeTab);
  const read = useWorkflowStore((state) => state.read);
  const save = useWorkflowStore((state) => state.save);
  const prepareRun = useWorkflowStore((state) => state.prepareRun);
  const storeError = useWorkflowStore((state) => state.error);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const isProcessing = useChatStore((state) => state.isProcessing);
  const workflowId = typeof tab?.data?.workflowId === 'string' ? tab.data.workflowId : '';
  const mode = tab?.data?.mode === 'edit' ? 'edit' : 'preview';
  const isNew = workflowId === NEW_WORKFLOW_ID;
  const [document, setDocument] = useState<WorkflowDocument | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [leavePrompt, setLeavePrompt] = useState(false);

  useEffect(() => {
    let active = true;
    if (!workflowId) return undefined;
    if (isNew) {
      setDocument(null);
      setName(t('workflow.newDefault'));
      setDescription('');
      setVersion('1.0.0');
      setTags('');
      setBody('# 工作流目标\n\n请在这里写给 Agent 的可复用操作流程。');
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    void read(workflowId).then((next) => {
      if (!active) return;
      setDocument(next);
      if (next) {
        setName(next.name);
        setDescription(next.description);
        setVersion(next.version);
        setTags(next.tags.join(', '));
        setBody(next.body);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [isNew, read, workflowId]);

  const dirty = useMemo(() => {
    if (isNew) return true;
    if (!document) return false;
    return name !== document.name
      || description !== document.description
      || version !== document.version
      || tags !== document.tags.join(', ')
      || body !== document.body;
  }, [body, description, document, isNew, name, tags, version]);

  if (!tab) return null;
  const setMode = (next: 'preview' | 'edit') => updateTabData(tabId, { mode: next });
  const requestClose = () => {
    if (dirty && mode === 'edit') {
      setLeavePrompt(true);
      return;
    }
    closeTab(tabId);
  };
  const saveDraft = async () => {
    setLocalError(null);
    if (!name.trim() || !body.trim()) {
      setLocalError(t('workflow.required'));
      return;
    }
    setSaving(true);
    const saved = await save({
      ...(isNew ? {} : { id: workflowId }),
      name,
      description,
      version,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      body,
      ...(document ? { expectedFingerprint: document.fingerprint } : {}),
    });
    setSaving(false);
    if (!saved) {
      setLocalError(useWorkflowStore.getState().error ?? 'Unable to save workflow.');
      return;
    }
    setDocument(saved);
    updateTabData(tabId, { workflowId: saved.id, mode: 'preview' });
    setMode('preview');
  };

  const runWorkflow = async () => {
    if (!document || isProcessing || running) return;
    setRunning(true);
    setLocalError(null);
    try {
      const prepared = await prepareRun(document.id, note);
      await sendMessage(prepared.content, [], prepared.invocation);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-text-primary">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-panel/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="sparkles" size={16} className="text-accent-blue" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{name || '工作流'}</h1>
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{t('workflow.global')} · {document?.version ?? version}</p>
          </div>
          {dirty && <span className="rounded bg-severity-medium/10 px-1.5 py-0.5 text-[10px] text-severity-medium">{t('workflow.unsaved')}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => setMode('preview')} className={cn('rounded border px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', mode === 'preview' ? 'border-accent-blue/40 bg-accent-blue/12 text-accent-blue' : 'border-border-subtle text-text-muted hover:text-text-primary')}>{t('workflow.preview')}</button>
          <button type="button" onClick={() => setMode('edit')} className={cn('rounded border px-2.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', mode === 'edit' ? 'border-accent-blue/40 bg-accent-blue/12 text-accent-blue' : 'border-border-subtle text-text-muted hover:text-text-primary')}>{t('workflow.edit')}</button>
          {mode === 'preview' && <button type="button" onClick={() => void runWorkflow()} disabled={!document || isProcessing || running} className="inline-flex min-h-8 items-center gap-1.5 rounded bg-accent-blue/85 px-3 text-[11px] font-medium text-white hover:bg-accent-blue disabled:cursor-wait disabled:opacity-45"><Icon name="send" size={12} />{running || isProcessing ? t('workflow.processing') : t('workflow.run')}</button>}
          <button type="button" aria-label={t('common.close')} onClick={requestClose} className="ui-icon-button h-7 w-7"><Icon name="close" size={13} /></button>
        </div>
      </header>

      {leavePrompt && <div role="alertdialog" aria-label={t('workflow.unsaved')} className="flex shrink-0 items-center justify-between gap-3 border-b border-severity-medium/35 bg-severity-medium/8 px-4 py-2 text-[11px] text-severity-medium"><span>{t('workflow.unsavedPrompt')}</span><div className="flex shrink-0 gap-1.5"><button type="button" onClick={() => setLeavePrompt(false)} className="rounded border border-border-subtle px-2 py-1 text-text-muted hover:text-text-primary">{t('workflow.stay')}</button><button type="button" onClick={() => closeTab(tabId)} className="rounded border border-severity-medium/40 px-2 py-1 hover:bg-severity-medium/10">{t('workflow.discardClose')}</button></div></div>}

      {loading ? <div className="flex flex-1 items-center justify-center text-xs text-text-muted">{t('workflow.loading')}</div> : mode === 'edit' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-border-subtle bg-panel/50 px-4 py-3">
            <label className="text-[11px] text-text-muted">{t('workflow.name')}<input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => setName((value) => value.trim())} className="mt-1 h-9 w-full rounded border border-border-subtle bg-canvas px-2.5 text-xs text-text-primary outline-none focus:border-accent-blue/60" /></label>
            <label className="text-[11px] text-text-muted">{t('workflow.versionLabel')}<input value={version} onChange={(event) => setVersion(event.target.value)} onBlur={() => setVersion((value) => value.trim())} className="mt-1 h-9 w-full rounded border border-border-subtle bg-canvas px-2.5 font-mono text-xs text-text-primary outline-none focus:border-accent-blue/60" /></label>
            <label className="col-span-2 text-[11px] text-text-muted">{t('workflow.description')}<input value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => setDescription((value) => value.trim())} className="mt-1 h-9 w-full rounded border border-border-subtle bg-canvas px-2.5 text-xs text-text-primary outline-none focus:border-accent-blue/60" /></label>
            <label className="col-span-2 text-[11px] text-text-muted">{t('workflow.tags')}<span className="ml-1 text-[10px]">{t('workflow.tagsHint')}</span><input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={() => setTags((value) => value.trim())} className="mt-1 h-9 w-full rounded border border-border-subtle bg-canvas px-2.5 text-xs text-text-primary outline-none focus:border-accent-blue/60" /></label>
          </div>
          <label className="flex min-h-0 flex-1 flex-col px-4 py-3 text-[11px] text-text-muted">{t('workflow.body')}<textarea value={body} onChange={(event) => setBody(event.target.value)} className="mt-1 min-h-0 flex-1 resize-none rounded border border-border-subtle bg-canvas p-3 font-mono text-xs leading-5 text-text-primary outline-none focus:border-accent-blue/60" spellCheck={false} /></label>
          {(localError || storeError) && <div role="alert" className="mx-4 mb-2 rounded border border-severity-critical/35 bg-severity-critical/8 px-3 py-2 text-xs text-severity-critical">{localError || storeError}</div>}
          <footer className="flex shrink-0 items-center justify-between border-t border-border-subtle px-4 py-3"><span className="text-[11px] text-text-muted">{t('workflow.saveHint')}</span><button type="button" onClick={() => void saveDraft()} disabled={saving || !dirty} className="rounded bg-accent-blue/85 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-blue disabled:opacity-45">{saving ? t('workflow.saving') : t('workflow.save')}</button></footer>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><div className="mx-auto max-w-4xl"><div className="mb-5 rounded border border-border-subtle bg-canvas/45 px-4 py-3"><div className="text-xs text-text-secondary">{description || t('workflow.emptyDescription')}</div><div className="mt-2 flex flex-wrap gap-1.5">{(document?.tags ?? []).map((tag) => <span key={tag} className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-blue">{tag}</span>)}</div></div><div className="prose prose-invert max-w-none text-sm leading-6"><MarkdownContent content={document?.body ?? body} /></div></div></div>
          <div className="shrink-0 border-t border-border-subtle bg-panel/70 px-6 py-3"><div className="mx-auto flex max-w-4xl items-end gap-3"><label className="min-w-0 flex-1 text-[11px] text-text-muted">{t('workflow.supplement')}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={t('workflow.supplementPlaceholder')} className="mt-1 w-full resize-y rounded border border-border-subtle bg-canvas px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent-blue/60" /></label><button type="button" onClick={() => void runWorkflow()} disabled={!document || isProcessing || running} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded bg-accent-blue/85 px-4 text-[11px] font-medium text-white hover:bg-accent-blue disabled:cursor-wait disabled:opacity-45"><Icon name="send" size={12} />{running || isProcessing ? t('workflow.processing') : t('workflow.send')}</button></div>{(localError || storeError) && <div role="alert" className="mx-auto mt-2 max-w-4xl rounded border border-severity-critical/35 bg-severity-critical/8 px-3 py-2 text-xs text-severity-critical">{localError || storeError}</div>}</div>
        </div>
      )}
    </div>
  );
}
