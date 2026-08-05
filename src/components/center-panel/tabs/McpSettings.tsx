import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClaudeMcpDescriptor,
  ClaudeMcpListResult,
  ClaudeMcpScope,
} from '@electron/contracts/claude-capabilities';
import { DismissibleNotice, Icon, useConfirmDialog } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/stores';
import { useI18n } from '@/i18n';

const NEW_MCP = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'your-mcp-server'],
};

export function McpSettings() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const [result, setResult] = useState<ClaudeMcpListResult | null>(null);
  const [selected, setSelected] = useState<ClaudeMcpDescriptor | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ClaudeMcpScope>('user');
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferredId?: string) => {
    setBusy('load');
    setError(null);
    try {
      const next = await window.hexestra.invoke<ClaudeMcpListResult>('claude:mcp:list', sessionId);
      setResult(next);
      if (preferredId) {
        const preferred = next.items.find((item) => item.id === preferredId) ?? null;
        setSelected(preferred);
        if (preferred) {
          setName(preferred.name);
          setScope(preferred.scope);
          setJson(JSON.stringify(preferred.definition, null, 2));
        }
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  useEffect(() => {
    setSelected(null);
    setName('');
    setJson('');
    void load();
  }, [load]);

  const select = (item: ClaudeMcpDescriptor) => {
    setSelected(item);
    setName(item.name);
    setScope(item.scope);
    setJson(JSON.stringify(item.definition, null, 2));
    setError(null);
  };

  const create = () => {
    const names = new Set(result?.items.map((item) => item.name));
    let candidate = 'new-server';
    let suffix = 2;
    while (names.has(candidate)) candidate = `new-server-${suffix++}`;
    setSelected({
      id: 'new',
      name: candidate,
      scope: result?.projectAvailable ? 'local' : 'user',
      definition: NEW_MCP,
      effective: true,
      shadowedBy: null,
      sourcePath: '',
    });
    setName(candidate);
    setScope(result?.projectAvailable ? 'local' : 'user');
    setJson(JSON.stringify(NEW_MCP, null, 2));
    setError(null);
  };

  const save = async () => {
    if (!selected) return;
    let definition: Record<string, unknown>;
    try {
      const value = JSON.parse(json) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Definition must be a JSON object');
      definition = value as Record<string, unknown>;
    } catch (reason) {
      setError(`Invalid JSON: ${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    setBusy('save');
    setError(null);
    try {
      const saved = await window.hexestra.invoke<ClaudeMcpDescriptor>('claude:mcp:save', {
        sessionId,
        scope,
        name,
        definition,
        originalName: selected.id === 'new' ? null : selected.name,
      });
      await load(saved.id);
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!selected || selected.id === 'new') return;
    if (!await confirm({
      title: 'Delete MCP server?',
      description: `Remove “${selected.name}” from ${selected.scope} scope.`,
      details: 'This removes the saved MCP definition from Hexestra.',
      confirmLabel: 'Delete Server',
      tone: 'danger',
    })) return;
    setBusy('delete');
    setError(null);
    try {
      await window.hexestra.invoke('claude:mcp:delete', {
        sessionId,
        scope: selected.scope,
        name: selected.name,
      });
      setSelected(null);
      setName('');
      setJson('');
      await load();
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
    }
  };

  const originalJson = selected ? JSON.stringify(selected.definition, null, 2) : '';
  const dirty = useMemo(() => selected
    ? selected.name !== name || selected.scope !== scope || originalJson !== json
    : false, [json, name, originalJson, scope, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <header className="flex items-center justify-between border-b border-surface px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="server" size={17} className="text-accent-blue" />
            <h1 className="text-sm font-semibold text-text-primary">{t('mcp.title')}</h1>
            {result && <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[9px] text-text-muted">{result.runtimeLabel}</span>}
          </div>
          <p className="mt-1 text-[10px] text-text-muted">{t('mcp.description')}</p>
        </div>
        <button onClick={create} className="rounded border border-accent-blue/30 bg-accent-blue/10 px-3 py-1.5 text-xs text-accent-blue hover:bg-accent-blue/20">
          Add Server
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[270px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-surface bg-bg-secondary/30 p-3">
          {!result && <p className="p-3 text-xs text-text-muted">{t('mcp.loading')}</p>}
          {result?.items.length === 0 && <p className="rounded border border-dashed border-surface p-3 text-center text-[10px] leading-4 text-text-muted">{t('mcp.empty')}</p>}
          <div className="space-y-1">
            {result?.items.map((item) => (
              <button
                key={item.id}
                onClick={() => select(item)}
                className={cn(
                  'w-full rounded border px-3 py-2 text-left transition-colors',
                  selected?.id === item.id ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-transparent hover:border-surface hover:bg-bg-tertiary/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 rounded-full', item.effective ? 'bg-accent-green' : 'bg-text-muted')} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">{item.name}</span>
                  <span className="rounded border border-surface px-1 py-0.5 text-[8px] uppercase tracking-wide text-text-muted">{item.scope}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[9px] text-text-muted">{mcpSummary(item.definition)}</p>
                {!item.effective && <p className="mt-1 text-[9px] text-severity-medium">Overridden by {item.shadowedBy}</p>}
              </button>
            ))}
          </div>
          {result?.errors.map((item) => (
            <div key={`${item.source}:${item.detail}`} className="mt-2 rounded border border-severity-critical/25 bg-severity-critical/5 p-2 text-[9px] text-severity-critical"><strong>{item.source}:</strong> {item.detail}</div>
          ))}
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Icon name="server" size={26} className="mx-auto mb-3 text-text-muted" />
                <p className="text-xs text-text-secondary">{t('mcp.select')}</p>
                {!result?.projectAvailable && <p className="mt-1 text-[10px] text-text-muted">{t('mcp.projectRequired')}</p>}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="mb-4 grid grid-cols-[1fr_150px] gap-3">
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-text-secondary">Server name</span>
                  <input aria-label="MCP server name" value={name} onChange={(event) => setName(event.target.value)} className="settings-input font-mono" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-text-secondary">Scope</span>
                  <select aria-label="MCP scope" value={scope} disabled={selected.id !== 'new'} onChange={(event) => setScope(event.target.value as ClaudeMcpScope)} className="settings-input">
                    <option value="user">User</option>
                    <option value="project" disabled={!result?.projectAvailable}>Project</option>
                    <option value="local" disabled={!result?.projectAvailable}>Local</option>
                  </select>
                </label>
              </div>
              <div className="mb-2 rounded border border-severity-medium/20 bg-severity-medium/5 px-3 py-2 text-[9px] leading-4 text-severity-medium">
                MCP definitions can contain credentials in <span className="font-mono">env</span> or <span className="font-mono">headers</span>. They are shown because this is a local configuration editor.
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium text-text-secondary">Server definition</span>
                <span className="font-mono text-[9px] text-text-muted">JSON</span>
              </div>
              <textarea
                aria-label="MCP JSON definition"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                spellCheck={false}
                className="h-[380px] w-full resize-y rounded border border-surface bg-bg-tertiary/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50"
              />
              {selected.sourcePath && <p className="mt-1 truncate font-mono text-[9px] text-text-muted">{selected.sourcePath}</p>}
              {error && <DismissibleNotice tone="error" className="mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
              <div className="mt-4 flex items-center justify-between border-t border-surface pt-4">
                <div>
                  {selected.id !== 'new' && <button onClick={() => void remove()} disabled={Boolean(busy)} className="rounded px-3 py-1.5 text-xs text-severity-critical hover:bg-severity-critical/10 disabled:opacity-40">Delete</button>}
                </div>
                <button onClick={() => void save()} disabled={Boolean(busy) || (!dirty && selected.id !== 'new')} className="rounded border border-accent-blue/30 bg-accent-blue/15 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/20 disabled:opacity-40">
                  {busy === 'save' ? 'Saving...' : 'Save Server'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function mcpSummary(definition: Record<string, unknown>) {
  if (typeof definition.url === 'string') return definition.url;
  if (typeof definition.command === 'string') {
    const args = Array.isArray(definition.args) ? definition.args.filter((item) => typeof item === 'string').join(' ') : '';
    return `${definition.command}${args ? ` ${args}` : ''}`;
  }
  return 'Custom MCP configuration';
}
