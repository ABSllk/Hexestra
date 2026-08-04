import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClaudeSkillDocument,
  ClaudeSkillListResult,
  ClaudeSkillScope,
} from '@electron/contracts/claude-capabilities';
import { DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/stores';
import { useI18n } from '@/i18n';

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
  const [scope, setScope] = useState<ClaudeSkillScope>('personal');
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);

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
    void load();
  }, [load]);

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
      scope: result?.projectAvailable ? 'project' : 'personal',
      enabled: true,
      sourcePath: '',
      content: nextContent,
    });
    setName(candidate);
    setContent(nextContent);
    setScope(result?.projectAvailable ? 'project' : 'personal');
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
        content,
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
    ? document.name !== name || document.content !== content || document.scope !== scope
    : false, [content, document, name, scope]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <header className="flex items-center justify-between border-b border-surface px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="sparkles" size={17} className="text-accent-blue" />
            <h1 className="text-sm font-semibold text-text-primary">{t('skills.title')}</h1>
            {result && <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[9px] text-text-muted">{result.runtimeLabel}</span>}
          </div>
          <p className="mt-1 text-[10px] text-text-muted">{t('skills.description')}</p>
        </div>
        <button onClick={create} className="rounded border border-accent-blue/30 bg-accent-blue/10 px-3 py-1.5 text-xs text-accent-blue hover:bg-accent-blue/20">
          New Skill
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-surface bg-bg-secondary/30 p-3">
          {!result && <p className="p-3 text-xs text-text-muted">{t('skills.loading')}</p>}
          {result?.items.length === 0 && <EmptyList text="No personal or project Skills found." />}
          <div className="space-y-1">
            {result?.items.map((item) => (
              <button
                key={item.id}
                onClick={() => void select(item)}
                className={cn(
                  'w-full rounded border px-3 py-2 text-left transition-colors',
                  document?.id === item.id ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-transparent hover:border-surface hover:bg-bg-tertiary/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 rounded-full', item.enabled ? 'bg-accent-green' : 'bg-text-muted')} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">{item.name}</span>
                  <ScopeBadge scope={item.scope} />
                </div>
                <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-text-muted">{item.description}</p>
              </button>
            ))}
          </div>
          {result?.errors.map((item) => <SourceError key={`${item.source}:${item.detail}`} source={item.source} detail={item.detail} />)}
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!document ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Icon name="sparkles" size={26} className="mx-auto mb-3 text-text-muted" />
                <p className="text-xs text-text-secondary">{t('skills.select')}</p>
                {!result?.projectAvailable && <p className="mt-1 text-[10px] text-text-muted">{t('skills.projectRequired')}</p>}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="mb-4 grid grid-cols-[1fr_150px] gap-3">
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-text-secondary">Skill name</span>
                  <input aria-label="Skill name" value={name} onChange={(event) => setName(event.target.value)} className="settings-input font-mono" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-text-secondary">Scope</span>
                  <select aria-label="Skill scope" value={scope} disabled={document.id !== 'new'} onChange={(event) => setScope(event.target.value as ClaudeSkillScope)} className="settings-input">
                    <option value="personal">Personal</option>
                    <option value="project" disabled={!result?.projectAvailable}>Project</option>
                  </select>
                </label>
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium text-text-secondary">SKILL.md</span>
                <span className="font-mono text-[9px] text-text-muted">{content.length.toLocaleString()} chars</span>
              </div>
              <textarea
                aria-label="Skill markdown"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
                className="h-[420px] w-full resize-y rounded border border-surface bg-bg-tertiary/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50"
              />
              {document.sourcePath && <p className="mt-1 truncate font-mono text-[9px] text-text-muted">{document.sourcePath}</p>}
              {error && <DismissibleNotice tone="error" className="mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
              <div className="mt-4 flex items-center justify-between border-t border-surface pt-4">
                <div className="flex gap-2">
                  {document.id !== 'new' && (
                    <>
                      <button onClick={() => void toggle()} disabled={Boolean(busy)} className="rounded border border-surface px-3 py-1.5 text-xs text-text-secondary hover:border-accent-blue/30 disabled:opacity-40">
                        {document.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => void remove()} disabled={Boolean(busy)} className="rounded px-3 py-1.5 text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-40">Delete</button>
                    </>
                  )}
                </div>
                <button onClick={() => void save()} disabled={Boolean(busy) || (!dirty && document.id !== 'new')} className="rounded border border-accent-blue/30 bg-accent-blue/15 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/20 disabled:opacity-40">
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
  return <span className="rounded border border-surface px-1 py-0.5 text-[8px] uppercase tracking-wide text-text-muted">{scope}</span>;
}

function EmptyList({ text }: { text: string }) {
  return <p className="rounded border border-dashed border-surface p-3 text-center text-[10px] leading-4 text-text-muted">{text}</p>;
}

function SourceError({ source, detail }: { source: string; detail: string }) {
  return <div className="mt-2 rounded border border-severity-critical/25 bg-severity-critical/5 p-2 text-[9px] text-severity-critical"><strong>{source}:</strong> {detail}</div>;
}
