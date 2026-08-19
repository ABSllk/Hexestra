import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClaudeSkillDocument,
  ClaudeSkillImportApplyInput,
  ClaudeSkillImportPickResult,
  ClaudeSkillImportPreview,
  ClaudeSkillImportResult,
  ClaudeSkillImportSourceKind,
  ClaudeSkillListResult,
  ClaudeSkillScope,
} from '@electron/contracts/claude-capabilities';
import { Button, DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/stores';
import { useI18n, type TranslationKey } from '@/i18n';
import { isClaudeCapabilityName } from '@electron/contracts/claude-capabilities';
import YAML from 'yaml';

const NEW_SKILL = `---
name: new-skill
description: Describe when Claude should use this skill
---

# New Skill

Add the workflow and constraints Claude should follow.
`;

export function SkillsSettings() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const [result, setResult] = useState<ClaudeSkillListResult | null>(null);
  const [document, setDocument] = useState<ClaudeSkillDocument | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<ClaudeSkillScope>('global');
  const [metadata, setMetadata] = useState({ tactics: '', techniques: '', capabilities: '', risk: '' });
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importBatch, setImportBatch] = useState<ClaudeSkillImportPreview[]>([]);
  const [importBatchIndex, setImportBatchIndex] = useState(0);
  const [importBatchNames, setImportBatchNames] = useState<string[]>([]);
  const [importScope, setImportScope] = useState<'global' | 'project'>(sessionId ? 'project' : 'global');
  const [importName, setImportName] = useState('');
  const [importDescription, setImportDescription] = useState('');

  const importPreview = importBatch[importBatchIndex] ?? null;

  const importCollision = useMemo(
    () => importPreview?.existing.find((item) => item.scope === importScope && item.name === importName) ?? null,
    [importName, importPreview, importScope],
  );

  const load = useCallback(async (preferredId?: string) => {
    setBusy('load');
    setError(null);
    try {
      const next = await window.hexestra.invoke<ClaudeSkillListResult>('claude:skills:list', sessionId);
      setResult(next);
      if (preferredId) {
        const preferred = next.items.find((item) => item.id === preferredId);
        if (preferred) {
          const loaded = await window.hexestra.invoke<ClaudeSkillDocument>('claude:skills:read', {
            sessionId,
            scope: preferred.scope,
            name: preferred.name,
            enabled: preferred.enabled,
          });
          setDocument(loaded);
          setName(loaded.name);
          setContent(loaded.content);
          setScope(loaded.scope);
          setMetadata(readSkillMetadata(loaded.metadata));
        }
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  useEffect(() => {
    setDocument(null);
    setName('');
    setContent('');
    setImportBatch([]);
    setImportBatchIndex(0);
    setImportBatchNames([]);
    setImportMenuOpen(false);
    setImportScope(sessionId ? 'project' : 'global');
    void load();
  }, [load]);

  const beginImport = async (kind: ClaudeSkillImportSourceKind) => {
    setImportMenuOpen(false);
    setBusy('import');
    setError(null);
    try {
      const picked = await window.hexestra.invoke<ClaudeSkillImportPickResult | null>('claude:skills:import-pick', kind, sessionId);
      const next = picked ? (Array.isArray(picked) ? picked : [picked]) : [];
      if (!next.length) return;
      const nextScope = sessionId ? 'project' : 'global';
      setImportBatch(next);
      setImportBatchIndex(0);
      setImportScope(nextScope);
      const reserved = new Set<string>();
      const names = next.map((preview) => {
        const scopedName = uniqueImportName(preview.suggestedName, preview, nextScope, reserved);
        reserved.add(scopedName);
        return scopedName;
      });
      setImportBatchNames(names);
      setImportName(names[0]);
      setImportDescription(next[0].description);
      setDocument(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const cancelImport = () => {
    setImportBatch([]);
    setImportBatchIndex(0);
    setImportBatchNames([]);
    setError(null);
  };

  const applyImport = async (replace = false) => {
    if (!importPreview) return;
    if (!isClaudeCapabilityName(importName.trim())) {
      setError(t('skills.importInvalidName'));
      return;
    }
    if (!importDescription.trim()) {
      setError(t('skills.importMissingDescription'));
      return;
    }
    if (importPreview.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-frontmatter')) {
      setError(t('skills.importDiagnostics'));
      return;
    }
    if (importCollision && !replace) {
      setError(t('skills.importDiagnostics'));
      return;
    }
    if (replace) {
      const confirmed = await confirm({
        title: t('skills.importReplaceTitle'),
        description: t('skills.importReplaceDescription', { name: importName, scope: importScope }),
        details: importPreview.sourceLabel,
        confirmLabel: t('skills.importReplaceConfirm'),
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    setBusy('import');
    setError(null);
    try {
      const saved = await window.hexestra.invoke<ClaudeSkillImportResult>('claude:skills:import-apply', {
        sessionId,
        selectionId: importPreview.selectionId,
        scope: importScope,
        name: importName.trim(),
        description: importDescription.trim(),
        collision: replace ? 'replace' : 'reject',
        expectedTargetId: importCollision?.id ?? null,
      } satisfies ClaudeSkillImportApplyInput);
      await load(saved.document.id);
      if (importBatchIndex < importBatch.length - 1) {
        const nextIndex = importBatchIndex + 1;
        const nextPreview = importBatch[nextIndex];
        setImportBatchIndex(nextIndex);
        setImportScope(importScope);
        setImportName(importBatchNames[nextIndex] ?? uniqueImportName(nextPreview.suggestedName, nextPreview, importScope));
        setImportDescription(nextPreview.description);
      } else {
        setImportBatch([]);
        setImportBatchIndex(0);
        setImportBatchNames([]);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const select = async (item: ClaudeSkillListResult['items'][number]) => {
    setBusy(`read:${item.id}`);
    setError(null);
    try {
      const loaded = await window.hexestra.invoke<ClaudeSkillDocument>('claude:skills:read', {
        sessionId,
        scope: item.scope,
        name: item.name,
        enabled: item.enabled,
      });
      setDocument(loaded);
      setName(loaded.name);
      setContent(loaded.content);
      setScope(loaded.scope);
      setMetadata(readSkillMetadata(loaded.metadata));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    const names = new Set(result?.items.map((item) => item.name));
    let candidate = 'new-skill';
    let suffix = 2;
    while (names.has(candidate)) candidate = `new-skill-${suffix++}`;
    const nextContent = NEW_SKILL.replaceAll('new-skill', candidate);
    setDocument({
      id: 'new',
      name: candidate,
      description: 'New Skill',
      scope: sessionId ? 'project' : 'global',
      enabled: true,
      sourcePath: '',
      content: nextContent,
    });
    setName(candidate);
    setContent(nextContent);
    setScope(sessionId ? 'project' : 'global');
    setMetadata({ tactics: '', techniques: '', capabilities: '', risk: '' });
    setError(null);
  };

  const save = async () => {
    if (!document) return;
    setBusy('save');
    setError(null);
    try {
      const saved = await window.hexestra.invoke<ClaudeSkillDocument>('claude:skills:save', {
        sessionId,
        scope,
        name,
        content: writeSkillMetadata(content, name, metadata),
        enabled: document.enabled,
        originalName: document.id === 'new' ? null : document.name,
      });
      await load(saved.id);
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
    }
  };

  const toggle = async () => {
    if (!document || document.id === 'new') return;
    setBusy('toggle');
    setError(null);
    try {
      const updated = await window.hexestra.invoke<ClaudeSkillDocument>('claude:skills:toggle', {
        sessionId,
        scope: document.scope,
        name: document.name,
        enabled: document.enabled,
      });
      await load(updated.id);
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!document || document.id === 'new') return;
    if (!await confirm({
      title: 'Delete Skill?',
      description: `Remove “${document.name}” and every file in its Skill directory.`,
      details: `Scope: ${document.scope}`,
      confirmLabel: 'Delete Skill',
      tone: 'danger',
    })) return;
    setBusy('delete');
    setError(null);
    try {
      await window.hexestra.invoke('claude:skills:delete', {
        sessionId,
        scope: document.scope,
        name: document.name,
        enabled: document.enabled,
      });
      setDocument(null);
      setName('');
      setContent('');
      await load();
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
    }
  };

  const dirty = useMemo(() => document
    ? document.name !== name || document.content !== writeSkillMetadata(content, name, metadata) || document.scope !== scope
    : false, [content, document, metadata, name, scope]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-text-primary">{t('skills.title')}</h1>
            {result && <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-muted">{result.runtimeLabel}</span>}
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">{t('skills.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              tone="neutral"
              leadingIcon="folder"
              aria-expanded={importMenuOpen}
              onClick={() => setImportMenuOpen((open) => !open)}
            >
              {t('skills.import')}
            </Button>
            {importMenuOpen && (
              <div className="ui-popover absolute right-0 top-[calc(100%+0.375rem)] z-20 w-48 p-1.5">
                <button
                  type="button"
                  onClick={() => void beginImport('directory')}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] text-text-secondary hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Icon name="folder" size={13} />
                  {t('skills.importFolder')}
                </button>
                <button
                  type="button"
                  onClick={() => void beginImport('skill-file')}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[11px] text-text-secondary hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Icon name="file" size={13} />
                  {t('skills.importFile')}
                </button>
              </div>
            )}
          </div>
          <Button tone="primary" leadingIcon="plus" onClick={create}>
            New Skill
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-panel/35 p-3">
          {!result && <p className="p-3 text-xs text-text-muted">{t('skills.loading')}</p>}
          {result?.items.length === 0 && <EmptyList text="No global or project user Skills found." />}
          <div className="space-y-1">
            {result?.items.map((item) => (
              <button
                key={item.id}
                onClick={() => void select(item)}
                className={cn(
                  'w-full rounded border px-3 py-2 text-left transition-colors',
                  document?.id === item.id ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-transparent hover:border-border-subtle hover:bg-panel/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 rounded-full', item.enabled ? 'bg-accent-green' : 'bg-text-muted')} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">{item.name}</span>
                  <ScopeBadge scope={item.scope} />
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-muted">{item.description}</p>
              </button>
            ))}
          </div>
          {result?.errors.map((item) => <SourceError key={`${item.source}:${item.detail}`} source={item.source} detail={item.detail} />)}
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {importPreview ? (
            <SkillImportReview
              preview={importPreview}
              sessionId={sessionId}
              scope={importScope}
              name={importName}
              description={importDescription}
              collision={importCollision}
              busy={busy}
              error={error}
              onClearError={() => setError(null)}
              batchIndex={importBatchIndex}
              batchTotal={importBatch.length}
              t={t}
              onScopeChange={(nextScope) => {
                setImportScope(nextScope);
                setImportName(uniqueImportName(importPreview.suggestedName, importPreview, nextScope));
              }}
              onNameChange={setImportName}
              onDescriptionChange={setImportDescription}
              onCancel={cancelImport}
              onImport={() => void applyImport(false)}
              onReplace={() => void applyImport(true)}
            />
          ) : !document ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Icon name="sparkles" size={26} className="mx-auto mb-3 text-text-muted" />
                <p className="text-xs text-text-secondary">{t('skills.select')}</p>
                {!result?.projectAvailable && <p className="mt-1 text-[11px] text-text-muted">{t('skills.projectRequired')}</p>}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl rounded-lg border border-border-subtle bg-panel/55 p-4">
              <div className="mb-4 grid grid-cols-[1fr_150px] gap-3">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-text-secondary">Skill name</span>
                  <input aria-label="Skill name" value={name} onChange={(event) => setName(event.target.value)} className="settings-input font-mono" />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-text-secondary">Scope</span>
                  <select aria-label="Skill scope" value={scope} disabled={document.id !== 'new'} onChange={(event) => setScope(event.target.value as ClaudeSkillScope)} className="settings-input">
                    <option value="global">Global user</option>
                    <option value="project" disabled={!sessionId}>Project user</option>
                    <option value="core">Hexestra core</option>
                  </select>
                </label>
              </div>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <MetadataField label="ATT&CK tactics" value={metadata.tactics} onChange={(value) => setMetadata((current) => ({ ...current, tactics: value }))} placeholder="TA0043" />
                <MetadataField label="ATT&CK techniques" value={metadata.techniques} onChange={(value) => setMetadata((current) => ({ ...current, techniques: value }))} placeholder="T1595.001,T1595.002" />
                <MetadataField label="Capabilities" value={metadata.capabilities} onChange={(value) => setMetadata((current) => ({ ...current, capabilities: value }))} placeholder="port-scanning,service-fingerprinting" />
                <MetadataField label="Risk" value={metadata.risk} onChange={(value) => setMetadata((current) => ({ ...current, risk: value }))} placeholder="active" />
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-text-secondary">SKILL.md</span>
                <span className="font-mono text-[11px] text-text-muted">{content.length.toLocaleString()} chars</span>
              </div>
              <textarea
                aria-label="Skill markdown"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
                className="h-[420px] w-full resize-y rounded border border-border-subtle bg-panel/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50"
              />
              {document.sourcePath && <p className="mt-1 truncate font-mono text-[11px] text-text-muted">{document.sourcePath}</p>}
              {error && <DismissibleNotice tone="error" className="mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
              <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
                <div className="flex gap-2">
                  {document.id !== 'new' && (
                    <>
                      <button onClick={() => void toggle()} disabled={Boolean(busy) || document.scope === 'core'} className="rounded border border-border-subtle px-3 py-1.5 text-xs text-text-secondary hover:border-accent-blue/30 disabled:opacity-40">
                        {document.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => void remove()} disabled={Boolean(busy) || document.scope === 'core'} className="rounded px-3 py-1.5 text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-40">Delete</button>
                    </>
                  )}
                </div>
                <button onClick={() => void save()} disabled={Boolean(busy) || document.scope === 'core' || (!dirty && document.id !== 'new')} className="rounded border border-accent-blue/30 bg-accent-blue/15 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/20 disabled:opacity-40">
                  {busy === 'save' ? 'Saving...' : 'Save Skill'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ScopeBadge({ scope }: { scope: ClaudeSkillScope }) {
  return <span className="rounded border border-border-subtle px-1 py-0.5 text-[11px] uppercase tracking-wide text-text-muted">{scope}</span>;
}

function SkillImportReview({
  preview,
  sessionId,
  scope,
  name,
  description,
  collision,
  busy,
  error,
  onClearError,
  batchIndex,
  batchTotal,
  t,
  onScopeChange,
  onNameChange,
  onDescriptionChange,
  onCancel,
  onImport,
  onReplace,
}: {
  preview: ClaudeSkillImportPreview;
  sessionId: string | null;
  scope: 'global' | 'project';
  name: string;
  description: string;
  collision: ClaudeSkillImportPreview['existing'][number] | null;
  busy: string | null;
  error: string | null;
  onClearError: () => void;
  batchIndex: number;
  batchTotal: number;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  onScopeChange: (scope: 'global' | 'project') => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onImport: () => void;
  onReplace: () => void;
}) {
  const invalidName = !isClaudeCapabilityName(name.trim());
  const invalidDescription = !description.trim();
  const invalidFrontmatter = preview.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-frontmatter');
  const ready = !busy && !invalidName && !invalidDescription && !invalidFrontmatter;
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-3">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{t('skills.importReview')}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-text-muted" title={preview.sourceLabel}>
            {t('skills.importSource')}: {preview.sourceLabel}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] text-text-muted">
          {batchTotal > 1 && <div>{t('skills.importProgress', { current: batchIndex + 1, total: batchTotal })}</div>}
          <div>{t('skills.importFiles', { count: preview.fileCount })}</div>
          <div>{t('skills.importSize', { size: formatImportBytes(preview.totalBytes) })}</div>
        </div>
      </div>

      {error && <DismissibleNotice tone="error" onDismiss={onClearError}>{error}</DismissibleNotice>}
      {invalidFrontmatter && <div role="alert" className="rounded border border-status-warning/30 bg-status-warning/8 px-3 py-2 text-[11px] text-status-warning">{t('skills.importDiagnostics')}</div>}

      <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
        <label>
          <span className="mb-1 block text-[11px] font-medium text-text-secondary">{t('skills.importName')}</span>
          <input
            aria-label={t('skills.importName')}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className={cn('settings-input font-mono', invalidName && 'border-status-error/60')}
          />
          {invalidName && <span className="mt-1 block text-[10px] text-status-error">{t('skills.importInvalidName')}</span>}
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-medium text-text-secondary">{t('skills.importScope')}</span>
          <select
            aria-label={t('skills.importScope')}
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as 'global' | 'project')}
            className="settings-input"
          >
            <option value="global">{t('skills.scopeGlobal')}</option>
            <option value="project" disabled={!sessionId}>{t('skills.scopeProject')}</option>
          </select>
        </label>
      </div>

      <label>
        <span className="mb-1 block text-[11px] font-medium text-text-secondary">{t('skills.importDescription')}</span>
        <input
          aria-label={t('skills.importDescription')}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className={cn('settings-input', invalidDescription && 'border-status-error/60')}
        />
        {invalidDescription && <span className="mt-1 block text-[10px] text-status-error">{t('skills.importMissingDescription')}</span>}
      </label>

      {collision && (
        <div role="alert" className="border-l-2 border-status-warning bg-status-warning/8 px-3 py-2 text-[11px] text-status-warning">
          {t('skills.importReplaceDescription', { name: collision.name, scope: collision.scope })}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-text-secondary">{t('skills.importPreview')}</span>
          <span className="font-mono text-[10px] text-text-muted">{preview.content.length.toLocaleString()} chars</span>
        </div>
        <textarea
          aria-label={t('skills.importPreview')}
          value={preview.content}
          readOnly
          spellCheck={false}
          className="h-[min(48vh,28rem)] w-full resize-y rounded border border-border-subtle bg-panel/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <Button size="compact" onClick={onCancel} disabled={busy === 'import'}>
          {t('skills.importCancel')}
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          {collision && (
            <Button size="compact" tone="danger" onClick={onReplace} disabled={!ready}>
              {t('skills.importReplace')}
            </Button>
          )}
          <Button size="compact" tone="primary" leadingIcon="download" onClick={onImport} disabled={!ready || Boolean(collision)}>
            {t('skills.importConfirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function uniqueImportName(
  suggestedName: string,
  preview: ClaudeSkillImportPreview,
  scope: 'global' | 'project',
  reserved: Set<string> = new Set(),
) {
  const existing = new Set(preview.existing.filter((item) => item.scope === scope).map((item) => item.name));
  const occupied = new Set([...existing, ...reserved]);
  if (!occupied.has(suggestedName)) return suggestedName;
  let suffix = 2;
  const base = suggestedName.slice(0, 60);
  let candidate = `${base}-${suffix}`;
  while (occupied.has(candidate)) candidate = `${base.slice(0, 63 - String(++suffix).length)}-${suffix}`;
  return candidate;
}

function formatImportBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function EmptyList({ text }: { text: string }) {
  return <p className="rounded border border-dashed border-border-subtle p-3 text-center text-[11px] leading-4 text-text-muted">{text}</p>;
}

function SourceError({ source, detail }: { source: string; detail: string }) {
  return <div className="mt-2 rounded border border-severity-critical/25 bg-severity-critical/5 p-2 text-[11px] text-severity-critical"><strong>{source}:</strong> {detail}</div>;
}

function MetadataField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label><span className="mb-1 block text-[11px] font-medium text-text-secondary">{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="settings-input font-mono text-[11px]" /></label>;
}

function readSkillMetadata(metadata?: Record<string, string>) {
  return { tactics: metadata?.['hexestra-tactics'] ?? '', techniques: metadata?.['hexestra-techniques'] ?? '', capabilities: metadata?.['hexestra-capabilities'] ?? '', risk: metadata?.['hexestra-risk'] ?? '' };
}

function writeSkillMetadata(content: string, name: string, metadata: { tactics: string; techniques: string; capabilities: string; risk: string }) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;
  let values: Record<string, unknown> = {};
  try { values = (YAML.parse(match[1]) as Record<string, unknown>) ?? {}; } catch { values = {}; }
  values.name = name;
  const existing = values.metadata && typeof values.metadata === 'object' && !Array.isArray(values.metadata) ? values.metadata as Record<string, unknown> : {};
  const next = { ...existing };
  if (metadata.tactics.trim()) next['hexestra-tactics'] = metadata.tactics.trim(); else delete next['hexestra-tactics'];
  if (metadata.techniques.trim()) next['hexestra-techniques'] = metadata.techniques.trim(); else delete next['hexestra-techniques'];
  if (metadata.capabilities.trim()) next['hexestra-capabilities'] = metadata.capabilities.trim(); else delete next['hexestra-capabilities'];
  if (metadata.risk.trim()) next['hexestra-risk'] = metadata.risk.trim(); else delete next['hexestra-risk'];
  if (Object.keys(next).length) values.metadata = next; else delete values.metadata;
  return `---\n${YAML.stringify(values).trimEnd()}\n---${content.slice(match[0].length)}`;
}
