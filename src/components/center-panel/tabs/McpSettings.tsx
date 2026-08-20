import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClaudeMcpDescriptor,
  ClaudeMcpListResult,
  ClaudeMcpRuntimeStatus,
  ClaudeMcpRuntimeStatusResult,
  ClaudeMcpScope,
} from '@electron/contracts/claude-capabilities';
import { normalizeClaudeMcpRuntimeStatusResult } from '@electron/contracts/claude-capabilities';
import { Button, DismissibleNotice, Icon, SettingsListRow, useConfirmDialog } from '@/components/shared';
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
  const [runtimeStatus, setRuntimeStatus] = useState<ClaudeMcpRuntimeStatusResult | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const healthRequestRef = useRef(0);

  const refreshHealth = useCallback(async () => {
    const requestId = ++healthRequestRef.current;
    setHealthBusy(true);
    setHealthError(null);
    try {
      const raw = await window.hexestra.invoke<unknown>('claude:mcp:status', sessionId);
      const next = normalizeClaudeMcpRuntimeStatusResult(raw);
      if (!next) throw new Error('Claude returned an invalid MCP status response');
      if (requestId === healthRequestRef.current) setRuntimeStatus(next);
    } catch (reason) {
      if (requestId === healthRequestRef.current) setHealthError(String(reason));
    } finally {
      if (requestId === healthRequestRef.current) setHealthBusy(false);
    }
  }, [sessionId]);

  const load = useCallback(async (preferredId?: string) => {
    setBusy('load');
    setError(null);
    try {
      const next = await window.hexestra.invoke<ClaudeMcpListResult>('claude:mcp:list', sessionId);
      setResult(next);
      if (next.items.some((item) => item.effective)) {
        void refreshHealth();
      } else {
        healthRequestRef.current += 1;
        setRuntimeStatus({ checkedAt: new Date().toISOString(), items: [] });
        setHealthBusy(false);
        setHealthError(null);
      }
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
  }, [refreshHealth, sessionId]);

  useEffect(() => {
    healthRequestRef.current += 1;
    setSelected(null);
    setName('');
    setJson('');
    setRuntimeStatus(null);
    setHealthBusy(false);
    setHealthError(null);
    void load();
  }, [load]);

  const runtimeStatusByName = useMemo(
    () => new Map(runtimeStatus?.items.map((item) => [item.name, item]) ?? []),
    [runtimeStatus],
  );

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
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-text-primary">{t('mcp.title')}</h1>
            {result && <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-muted">{result.runtimeLabel}</span>}
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">{t('mcp.description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="compact"
            leadingIcon="activity"
            onClick={() => void refreshHealth()}
            disabled={healthBusy || !result}
            className={healthBusy ? 'animate-pulse motion-reduce:animate-none' : undefined}
          >
            {healthBusy ? t('mcp.checking') : t('mcp.checkConnections')}
          </Button>
          <Button tone="primary" leadingIcon="plus" onClick={create}>
            Add Server
          </Button>
        </div>
      </header>

      {healthError && (
        <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setHealthError(null)}>
          {t('mcp.healthUnavailable', { error: healthError })}
        </DismissibleNotice>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[270px_1fr]">
        <aside aria-live="polite" className="min-h-0 overflow-y-auto border-r border-border-subtle bg-panel/25 p-2">
          {!result && <p className="p-3 text-xs text-text-muted">{t('mcp.loading')}</p>}
          {result?.items.length === 0 && <p className="rounded border border-dashed border-border-subtle p-3 text-center text-[11px] leading-4 text-text-muted">{t('mcp.empty')}</p>}
          <div className="space-y-1">
            {result?.items.map((item) => (
              <SettingsListRow
                key={item.id}
                selected={selected?.id === item.id}
                onSelect={() => select(item)}
                ariaLabel={item.name}
                title={<span className="font-mono text-[11px] text-text-secondary">{item.name}</span>}
                badge={<span className="uppercase tracking-wide text-text-muted">{item.scope}</span>}
                status={item.effective
                  ? mcpListStatus(runtimeStatusByName.get(item.name) ?? null, healthBusy, Boolean(healthError))
                  : 'warning'}
                description={(
                  <>
                    <span className="block truncate font-mono">{mcpSummary(item.definition)}</span>
                    {!item.effective && <span className="mt-1 block text-severity-medium">Overridden by {item.shadowedBy}</span>}
                    {item.effective && (
                      <McpConnectionStatus
                        status={runtimeStatusByName.get(item.name) ?? null}
                        checking={healthBusy}
                        probeFailed={Boolean(healthError)}
                        showDot={false}
                      />
                    )}
                  </>
                )}
              />
            ))}
          </div>
          {result?.errors.map((item) => (
            <div key={`${item.source}:${item.detail}`} className="mt-2 rounded border border-severity-critical/25 bg-severity-critical/5 p-2 text-[11px] text-severity-critical"><strong>{item.source}:</strong> {item.detail}</div>
          ))}
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <Icon name="server" size={26} className="mx-auto mb-3 text-text-muted" />
                <p className="text-xs text-text-secondary">{t('mcp.select')}</p>
                {!result?.projectAvailable && <p className="mt-1 text-[11px] text-text-muted">{t('mcp.projectRequired')}</p>}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl rounded-lg border border-border-subtle bg-panel/55 p-4">
              <div className="mb-4 grid grid-cols-[1fr_150px] gap-3">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-text-secondary">Server name</span>
                  <input aria-label="MCP server name" value={name} onChange={(event) => setName(event.target.value)} className="settings-input font-mono" />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-text-secondary">Scope</span>
                  <select aria-label="MCP scope" value={scope} disabled={selected.id !== 'new'} onChange={(event) => setScope(event.target.value as ClaudeMcpScope)} className="settings-input">
                    <option value="user">User</option>
                    <option value="project" disabled={!result?.projectAvailable}>Project</option>
                    <option value="local" disabled={!result?.projectAvailable}>Local</option>
                  </select>
                </label>
              </div>
              <div className="mb-2 rounded border border-severity-medium/20 bg-severity-medium/5 px-3 py-2 text-[11px] leading-4 text-severity-medium">
                MCP definitions can contain credentials in <span className="font-mono">env</span> or <span className="font-mono">headers</span>. They are shown because this is a local configuration editor.
              </div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-text-secondary">Server definition</span>
                <span className="font-mono text-[11px] text-text-muted">JSON</span>
              </div>
              <textarea
                aria-label="MCP JSON definition"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                spellCheck={false}
                className="h-[380px] w-full resize-y rounded border border-border-subtle bg-panel/50 p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent-blue/50"
              />
              {selected.sourcePath && <p className="mt-1 truncate font-mono text-[11px] text-text-muted">{selected.sourcePath}</p>}
              {error && <DismissibleNotice tone="error" className="mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
              <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
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

function McpConnectionStatus({
  status,
  checking,
  probeFailed,
  showDot = true,
}: {
  status: ClaudeMcpRuntimeStatus | null;
  checking: boolean;
  probeFailed: boolean;
  showDot?: boolean;
}) {
  const { t } = useI18n();
  const state = checking ? 'pending' : status?.status ?? (probeFailed ? 'unavailable' : 'not-loaded');
  const label = state === 'connected'
    ? t('mcp.connected')
    : state === 'failed'
      ? t('mcp.failed')
      : state === 'needs-auth'
        ? t('mcp.needsAuth')
        : state === 'pending'
          ? t('mcp.pending')
          : state === 'disabled'
            ? t('mcp.disabled')
            : state === 'unavailable'
              ? t('mcp.unavailable')
              : t('mcp.notLoaded');
  const tone = state === 'connected'
    ? 'text-status-success'
    : state === 'pending' || state === 'needs-auth'
      ? 'text-status-warning'
      : state === 'disabled' || state === 'unavailable'
        ? 'text-text-muted'
        : 'text-status-error';
  const dot = state === 'connected'
    ? 'bg-status-success'
    : state === 'pending' || state === 'needs-auth'
      ? 'bg-status-warning'
      : state === 'disabled' || state === 'unavailable'
        ? 'bg-text-muted'
        : 'bg-status-error';
  const detail = status?.status === 'connected'
    ? t('mcp.toolsAvailable', { count: status.toolCount })
    : status?.error;

  return (
    <div className={cn('mt-1.5 min-w-0 text-[11px] leading-4', tone)} title={detail ?? label}>
      <div className="flex items-center gap-1.5 font-medium uppercase tracking-wide">
        {showDot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot, state === 'pending' && 'animate-pulse motion-reduce:animate-none')} />}
        <span>{label}</span>
        {status?.scope && <span className="font-normal normal-case tracking-normal opacity-70">· {status.scope}</span>}
      </div>
      {detail && <p className="mt-0.5 line-clamp-2 break-all text-left font-normal normal-case tracking-normal opacity-85">{detail}</p>}
    </div>
  );
}

function mcpListStatus(status: ClaudeMcpRuntimeStatus | null, checking: boolean, probeFailed: boolean): 'success' | 'muted' | 'warning' | 'error' {
  const state = checking ? 'pending' : status?.status ?? (probeFailed ? 'unavailable' : 'not-loaded');
  if (state === 'connected') return 'success';
  if (state === 'pending' || state === 'needs-auth') return 'warning';
  if (state === 'disabled' || state === 'unavailable' || state === 'not-loaded') return 'muted';
  return 'error';
}
