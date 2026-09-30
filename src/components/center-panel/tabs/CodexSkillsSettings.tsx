import { useCallback, useEffect, useState } from 'react';
import type { CodexSkillItem, CodexSkillListResult } from '@electron/contracts/codex-capabilities';
import { Button, DismissibleNotice, Icon, SettingsListRow, useConfirmDialog } from '@/components/shared';
import { Select } from '@/components/shared/Select';
import { useSessionStore } from '@/stores';
import { useI18n } from '@/i18n';

export function CodexSkillsSettings() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const [result, setResult] = useState<CodexSkillListResult | null>(null);
  const [selected, setSelected] = useState<CodexSkillItem | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'user' | 'repo'>('repo');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferredPath?: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.hexestra.invoke<CodexSkillListResult>('codex:skills:detailed', sessionId);
      setResult(next);
      if (preferredPath) {
        const item = next.items.find((candidate) => candidate.path === preferredPath);
        if (item) {
          const document = await window.hexestra.invoke<CodexSkillItem & { content: string }>('codex:skills:read', sessionId, item.path);
          setSelected(item);
          setName(item.name);
          setScope(item.scope === 'repo' ? 'repo' : 'user');
          setContent(document.content);
        }
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }, [sessionId]);

  useEffect(() => {
    setSelected(null);
    setName('');
    setContent('');
    void load();
  }, [load]);

  const select = async (item: CodexSkillItem) => {
    setBusy(true);
    setError(null);
    try {
      const document = await window.hexestra.invoke<CodexSkillItem & { content: string }>('codex:skills:read', sessionId, item.path);
      setSelected(item);
      setName(item.name);
      setScope(item.scope === 'repo' ? 'repo' : 'user');
      setContent(document.content);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const create = () => {
    const names = new Set(result?.items.map((item) => item.name));
    let candidate = 'new-skill';
    let suffix = 2;
    while (names.has(candidate)) candidate = `new-skill-${suffix++}`;
    setSelected({ name: candidate, description: '', path: '', scope: 'repo', enabled: true, editable: true });
    setName(candidate);
    setScope(sessionId ? 'repo' : 'user');
    setContent(`---\nname: ${candidate}\ndescription: ${t('skills.codexTemplateDescription')}\n---\n\n# ${candidate}\n\n${t('skills.codexTemplateBody')}\n`);
    setError(null);
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const skillPath = await window.hexestra.invoke<string>('codex:skills:save', {
        sessionId, scope, name: name.trim(), content, originalPath: selected.path || null,
      });
      await load(skillPath);
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const toggle = async () => {
    if (!selected?.path) return;
    setBusy(true);
    setError(null);
    try {
      await window.hexestra.invoke('codex:skills:toggle', sessionId, selected.path, !selected.enabled);
      await load(selected.path);
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const copy = async (targetScope: 'user' | 'repo') => {
    if (!selected?.path || selected.editable) return;
    const existing = new Set(result?.items.filter((item) => item.scope === targetScope).map((item) => item.name));
    const base = `${selected.name.slice(0, 58)}-copy`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${base.slice(0, 63 - String(suffix).length - 1)}-${suffix++}`;
    setBusy(true);
    setError(null);
    try {
      const skillPath = await window.hexestra.invoke<string>('codex:skills:copy', {
        sessionId, sourcePath: selected.path, scope: targetScope, name: candidate,
      });
      await load(skillPath);
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const remove = async () => {
    if (!selected?.path || !selected.editable) return;
    if (!await confirm({ title: t('skills.deleteTitle'), description: t('skills.deleteDescription', { name: selected.name }),
      details: selected.path, confirmLabel: t('skills.deleteConfirm'), tone: 'danger' })) return;
    setBusy(true);
    setError(null);
    try {
      await window.hexestra.invoke('codex:skills:delete', sessionId, selected.path);
      setSelected(null);
      setContent('');
      await load();
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  return <div className="flex h-full min-h-0 flex-col bg-canvas">
    <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-lg font-semibold text-text-primary">{t('skills.codexTitle')}</h1>
          {result && <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-muted">{result.runtimeLabel.replace('Native', t('settings.native'))}</span>}</div>
        <p className="mt-1 text-xs text-text-muted">{t('skills.codexDescription')}</p>
      </div>
      <div className="flex gap-2"><Button onClick={() => void load()}>{t('common.refresh')}</Button><Button tone="primary" leadingIcon="plus" onClick={create}>{t('skills.new')}</Button></div>
    </header>
    {error && <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
    <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr]">
      <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-panel/25 p-2">
        {!result && <p className="p-3 text-xs text-text-muted">{t('skills.codexLoading')}</p>}
        {result?.items.length === 0 && <p className="p-3 text-xs text-text-muted">{t('skills.codexEmpty')}</p>}
        <div className="space-y-1">{result?.items.map((item) => <SettingsListRow key={item.path}
          selected={selected?.path === item.path} onSelect={() => void select(item)} ariaLabel={item.name}
          title={item.name} badge={item.scope === 'user' ? t('skills.scopeUser') : item.scope === 'repo' ? t('skills.scopeRepo') : item.scope === 'admin' ? t('skills.scopeAdmin') : t('skills.scopeSystem')}
          description={item.description}
          status={item.enabled ? 'success' : 'muted'} statusLabel={item.enabled ? t('skills.enabled') : t('skills.disabled')} />)}</div>
        {result?.errors.map((item) => <p key={`${item.source}:${item.detail}`} className="p-2 text-[11px] text-severity-critical">{item.source}: {item.detail}</p>)}
      </aside>
      <main className="min-h-0 overflow-y-auto p-5">
        {!selected ? <div className="flex h-full items-center justify-center text-center text-xs text-text-muted">
          <div><Icon name="sparkles" size={26} className="mx-auto mb-3" />{t('skills.codexSelect')}</div></div> :
          <div className="mx-auto max-w-4xl rounded-lg border border-border-subtle bg-panel/55 p-4">
            <div className="mb-4 grid grid-cols-[1fr_150px] gap-3">
              <label><span className="mb-1 block text-[11px] text-text-secondary">{t('skills.name')}</span>
                <input aria-label={t('skills.name')} value={name} disabled={Boolean(selected.path) || !selected.editable}
                  onChange={(event) => { const value = event.target.value; setName(value); if (!selected.path) setContent((current) => current.replace(/^name: .*$/m, `name: ${value}`)); }}
                  className="settings-input font-mono" /></label>
              <label><span className="mb-1 block text-[11px] text-text-secondary">{t('skills.scope')}</span>
                <Select aria-label={t('skills.scope')} value={selected.path && (selected.scope === 'system' || selected.scope === 'admin') ? 'system' : scope} disabled={Boolean(selected.path)}
                  onChange={(event) => setScope(event.target.value as 'user' | 'repo')} className="settings-input">
                  <option value="user">{t('skills.scopeUser')}</option><option value="repo" disabled={!sessionId}>{t('skills.scopeRepo')}</option>
                  <option value="system" disabled>{t('skills.scopeSystem')}</option>
                </Select></label>
            </div>
            <div className="mb-1 flex justify-between text-[11px] text-text-secondary"><span>SKILL.md</span><span>{t('skills.chars', { count: content.length })}</span></div>
            <textarea aria-label={t('skills.markdown')} value={content} disabled={!selected.editable} onChange={(event) => setContent(event.target.value)}
              spellCheck={false} className="h-[420px] w-full resize-y rounded-lg border border-border-subtle bg-panel/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50" />
            {selected.path && <p className="mt-1 truncate font-mono text-[11px] text-text-muted" title={selected.path}>{selected.path}</p>}
            {!selected.editable && <p className="mt-2 text-[11px] text-text-muted">{t('skills.codexReadOnly')}</p>}
            <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
              <div className="flex gap-2">{selected.path && <Button onClick={() => void toggle()} disabled={busy}>{selected.enabled ? t('skills.disable') : t('skills.enable')}</Button>}
                {selected.path && !selected.editable && <Button onClick={() => void copy('user')} disabled={busy}>{t('skills.copyToUser')}</Button>}
                {selected.path && !selected.editable && sessionId && <Button onClick={() => void copy('repo')} disabled={busy}>{t('skills.copyToProject')}</Button>}
                {selected.path && selected.editable && <button onClick={() => void remove()} disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-40">{t('skills.delete')}</button>}</div>
              {selected.editable && <Button tone="primary" onClick={() => void save()} disabled={busy}>{busy ? t('skills.saving') : t('skills.save')}</Button>}
            </div>
          </div>}
      </main>
    </div>
  </div>;
}
