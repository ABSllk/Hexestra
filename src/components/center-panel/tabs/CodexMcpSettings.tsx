import { useCallback, useEffect, useState } from 'react';
import type { CodexMcpItem, CodexMcpListResult } from '@electron/contracts/codex-capabilities';
import { Button, DismissibleNotice, Icon, SettingsListRow, useConfirmDialog } from '@/components/shared';
import { useI18n } from '@/i18n';
import { useSessionStore, useTabStore } from '@/stores';

const template = { command: 'npx', args: ['-y', 'your-mcp-server'] };

export function CodexMcpSettings() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const openTab = useTabStore((state) => state.openTab);
  const tabs = useTabStore((state) => state.tabs);
  const setActiveTab = useTabStore((state) => state.setActiveTab);
  const [result, setResult] = useState<CodexMcpListResult | null>(null);
  const [selected, setSelected] = useState<CodexMcpItem | null>(null);
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferredName?: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.hexestra.invoke<CodexMcpListResult>('codex:mcp:list', sessionId);
      setResult(next);
      if (preferredName) {
        const item = next.items.find((candidate) => candidate.name === preferredName) ?? null;
        setSelected(item);
        if (item) { setName(item.name); setJson(JSON.stringify(item.definition, null, 2)); }
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const create = () => {
    const names = new Set(result?.items.map((item) => item.name));
    let candidate = 'new-server';
    let suffix = 2;
    while (names.has(candidate)) candidate = `new-server-${suffix++}`;
    setSelected({ name: candidate, definition: template, scope: 'user', enabled: true, status: 'unknown', toolCount: 0, error: null });
    setName(candidate);
    setJson(JSON.stringify(template, null, 2));
    setError(null);
  };

  const save = async () => {
    if (!selected) return;
    let definition: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('mcp.invalidObject'));
      definition = parsed as Record<string, unknown>;
    } catch (reason) { setError(t('mcp.invalidJson', { error: String(reason) })); return; }
    setBusy(true);
    setError(null);
    try {
      await window.hexestra.invoke('codex:mcp:save', { sessionId, scope: 'user', name: name.trim(), definition,
        originalName: result?.items.some((item) => item.name === selected.name) ? selected.name : null });
      await load(name.trim());
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const remove = async () => {
    if (!selected || selected.scope === 'managed' || selected.scope === 'plugin' || !result?.items.some((item) => item.name === selected.name)) return;
    if (!await confirm({ title: t('mcp.deleteTitle'), description: t('mcp.codexDeleteDescription', { name: selected.name }),
      confirmLabel: t('mcp.deleteConfirm'), tone: 'danger' })) return;
    setBusy(true);
    setError(null);
    try {
      await window.hexestra.invoke('codex:mcp:delete', selected.name, sessionId);
      setSelected(null);
      setName('');
      setJson('');
      await load();
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const toggle = async () => {
    if (!selected || !result?.items.some((item) => item.name === selected.name)) return;
    setBusy(true);
    setError(null);
    try {
      await window.hexestra.invoke('codex:mcp:toggle', selected.name, !selected.enabled, sessionId);
      await load(selected.name);
    } catch (reason) { setError(String(reason)); setBusy(false); }
  };

  const openProjectConfig = () => {
    if (!sessionId) return;
    const filePath = '.codex/config.toml';
    const existing = tabs.find((tab) => tab.type === 'editor' && tab.data?.sessionId === sessionId && tab.data?.filePath === filePath);
    if (existing) setActiveTab(existing.id);
    else openTab({ type: 'editor', title: 'config.toml', icon: 'file', closable: true, data: { sessionId, filePath, allowMissing: true } });
  };

  return <div className="flex h-full min-h-0 flex-col bg-canvas">
    <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
      <div><div className="flex items-center gap-2"><h1 className="text-lg font-semibold text-text-primary">{t('mcp.codexTitle')}</h1>
        {result && <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-muted">{result.runtimeLabel.replace('Native', t('settings.native'))}</span>}</div>
        <p className="mt-1 text-xs text-text-muted">{t('mcp.codexDescription')}</p></div>
      <div className="flex gap-2"><Button onClick={() => void load()}>{t('common.refresh')}</Button>
        {sessionId && <Button onClick={openProjectConfig}>{t('mcp.openProjectConfig')}</Button>}
        <Button tone="primary" leadingIcon="plus" onClick={create}>{t('mcp.add')}</Button></div>
    </header>
    {error && <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
    <div className="grid min-h-0 flex-1 grid-cols-[270px_1fr]">
      <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-panel/25 p-2">
        {!result && <p className="p-3 text-xs text-text-muted">{t('mcp.codexLoading')}</p>}
        {result?.items.length === 0 && <p className="p-3 text-xs text-text-muted">{t('mcp.codexEmpty')}</p>}
        <div className="space-y-1">{result?.items.map((item) => <SettingsListRow key={item.name}
          selected={selected?.name === item.name} onSelect={() => { setSelected(item); setName(item.name); setJson(JSON.stringify(item.definition, null, 2)); setError(null); }}
          ariaLabel={item.name} title={item.name} badge={item.status === 'connected' ? t('mcp.connected') : item.status === 'failed' ? t('mcp.failed')
            : item.status === 'pending' ? t('mcp.pending') : item.status === 'needs-auth' ? t('mcp.needsAuth')
              : item.status === 'disabled' ? t('mcp.disabled') : t('mcp.statusUnknown')}
          description={`${item.scope === 'project' ? t('skills.scopeRepo') : item.scope === 'plugin' ? t('mcp.pluginSource') : item.scope === 'managed' ? t('mcp.managedSource') : t('skills.scopeUser')} · ${typeof item.definition.url === 'string' ? item.definition.url : String(item.definition.command ?? item.pluginId ?? t('mcp.title'))}`}
          status={item.status === 'connected' ? 'success' : item.status === 'failed' ? 'error' : 'muted'}
          statusLabel={t('mcp.toolsCount', { count: item.toolCount })} />)}</div>
      </aside>
      <main className="min-h-0 overflow-y-auto p-5">
        {!selected ? <div className="flex h-full items-center justify-center text-center text-xs text-text-muted">
          <div><Icon name="server" size={26} className="mx-auto mb-3" />{t('mcp.codexSelect')}</div></div> :
          <div className="mx-auto max-w-4xl rounded-lg border border-border-subtle bg-panel/55 p-4">
            <label><span className="mb-1 block text-[11px] text-text-secondary">{t('mcp.name')}</span>
              <input aria-label={t('mcp.name')} value={name} disabled={result?.items.some((item) => item.name === selected.name)}
                onChange={(event) => setName(event.target.value)} className="settings-input mb-3 font-mono" /></label>
            {selected.scope === 'project' && <p className="mb-3 text-xs leading-5 text-text-muted">{t('mcp.projectEditHint')}</p>}
            {selected.scope === 'plugin' || (selected.scope === 'managed' && Object.keys(selected.definition).length === 0)
              ? <p className="mb-3 text-xs leading-5 text-text-muted">{t('mcp.managedHint')}</p>
              : <><p className="mb-2 text-[11px] leading-4 text-text-muted">{t('mcp.codexHint')}</p>
                  <div className="mb-1 flex justify-between text-[11px] text-text-secondary"><span>{t('mcp.definition')}</span><span>JSON</span></div>
                  <textarea aria-label={t('mcp.definition')} value={json} readOnly={selected.scope === 'project'} onChange={(event) => setJson(event.target.value)}
                    spellCheck={false} className="h-[380px] w-full resize-y rounded-lg border border-border-subtle bg-panel/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50" /></>}
            {selected.error && <p className="mt-2 text-[11px] text-severity-critical">{selected.error}</p>}
            <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
              <div className="flex items-center gap-2">{selected.scope !== 'project' && result?.items.some((item) => item.name === selected.name) && selected.name !== 'hexestra'
                && <Button onClick={() => void toggle()} disabled={busy}>{selected.enabled ? t('mcp.disableServer') : t('mcp.enableServer')}</Button>}
                {selected.scope === 'project' && sessionId && <Button onClick={openProjectConfig}>{t('mcp.openProjectConfig')}</Button>}
                {selected.scope === 'user' && result?.items.some((item) => item.name === selected.name) && <button onClick={() => void remove()} disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-40">{t('mcp.delete')}</button>}</div>
              {selected.scope !== 'plugin' && selected.scope !== 'project' && !(selected.scope === 'managed' && Object.keys(selected.definition).length === 0)
                && <Button tone="primary" onClick={() => void save()} disabled={busy}>{busy ? t('mcp.saving') : t('mcp.save')}</Button>}
            </div>
          </div>}
      </main>
    </div>
  </div>;
}
