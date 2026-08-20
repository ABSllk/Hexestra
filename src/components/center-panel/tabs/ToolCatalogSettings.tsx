import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ATTACK_TACTICS, ATTACK_TECHNIQUES } from '@electron/contracts/tasks';
import {
  TOOL_CATALOG_IPC,
  TOOL_CHANNELS,
  TOOL_RISKS,
  type ToolCatalogDocumentResult,
  type ToolCatalogRecord,
} from '@electron/contracts/tool-catalog';
import { Button, DismissibleNotice, Icon, IconButton, SettingsListRow, useConfirmDialog } from '@/components/shared';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';

type ToolFilter = 'all' | 'enabled' | 'disabled';

const EMPTY_TOOL: ToolCatalogRecord = {
  id: '',
  name: '',
  description: '',
  enabled: true,
  capabilities: [],
  tacticIds: [],
  techniqueIds: [],
  risk: 'active',
  channel: 'agent-runtime',
};

function cloneTool(tool: ToolCatalogRecord): ToolCatalogRecord {
  return {
    ...tool,
    capabilities: [...tool.capabilities],
    tacticIds: [...tool.tacticIds],
    techniqueIds: [...tool.techniqueIds],
  };
}

export function ToolCatalogSettings() {
  const { t } = useI18n();
  const confirm = useConfirmDialog();
  const [result, setResult] = useState<ToolCatalogDocumentResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ToolCatalogRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = async () => {
    try {
      const loaded = await window.hexestra.invoke<ToolCatalogDocumentResult>(TOOL_CATALOG_IPC.LIST);
      setResult(loaded);
      setError(null);
      if (selectedId && !loaded.document.tools.some((tool) => tool.id === selectedId)) {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (reason) {
      setError(String(reason));
    }
  };

  useEffect(() => { void refresh(); }, []);

  const visibleTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (result?.document.tools ?? []).filter((tool) => {
      if (filter === 'enabled' && !tool.enabled) return false;
      if (filter === 'disabled' && tool.enabled) return false;
      return !needle || [tool.id, tool.name, tool.description, ...tool.capabilities]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [filter, query, result]);

  const selectTool = (tool: ToolCatalogRecord) => {
    setSelectedId(tool.id);
    setDraft(cloneTool(tool));
    setCreating(false);
    setError(null);
  };

  const addTool = () => {
    setSelectedId(null);
    setDraft(cloneTool(EMPTY_TOOL));
    setCreating(true);
    setError(null);
  };

  const cancel = () => {
    if (creating) {
      setDraft(null);
      setCreating(false);
      return;
    }
    const current = result?.document.tools.find((tool) => tool.id === selectedId);
    setDraft(current ? cloneTool(current) : null);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = creating
        ? await window.hexestra.invoke<ToolCatalogDocumentResult>(TOOL_CATALOG_IPC.CREATE, draft)
        : await window.hexestra.invoke<ToolCatalogDocumentResult>(TOOL_CATALOG_IPC.UPDATE, draft.id, {
            name: draft.name,
            description: draft.description,
            enabled: draft.enabled,
            capabilities: draft.capabilities,
            tacticIds: draft.tacticIds,
            techniqueIds: draft.techniqueIds,
            risk: draft.risk,
            channel: draft.channel,
            command: draft.command,
            usage: draft.usage,
          });
      setResult(loaded);
      setSelectedId(draft.id);
      setDraft(cloneTool(loaded.document.tools.find((tool) => tool.id === draft.id) ?? draft));
      setCreating(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tool = draft) => {
    if (!tool || creating) return;
    const approved = await confirm({
      title: t('tools.deleteTitle'),
      description: t('tools.deleteDescription'),
      details: `${tool.name} (${tool.id})`,
      confirmLabel: t('tools.deleteConfirm'),
      tone: 'danger',
    });
    if (!approved) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await window.hexestra.invoke<ToolCatalogDocumentResult>(TOOL_CATALOG_IPC.DELETE, tool.id);
      setResult(loaded);
      if (selectedId === tool.id) {
        setSelectedId(null);
        setDraft(null);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = <K extends keyof ToolCatalogRecord>(key: K, value: ToolCatalogRecord[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-6 py-3.5">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t('tools.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">{t('tools.description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saved && <span role="status" className="text-xs text-status-success">{t('tools.saved')}</span>}
          <Button tone="primary" size="compact" leadingIcon="plus" onClick={addTool}>{t('tools.add')}</Button>
        </div>
      </header>

      {result?.diagnostics.length ? (
        <div role="alert" className="mx-6 mt-3 border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          {result.diagnostics.join(' · ')}
        </div>
      ) : null}
      {error && <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,30%)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-border-subtle bg-panel/25">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border-subtle p-3">
            <label className="relative block">
              <span className="sr-only">{t('tools.search')}</span>
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="ui-control min-h-8 w-full pl-8 text-xs" placeholder={t('tools.searchPlaceholder')} />
            </label>
            <label>
              <span className="sr-only">{t('tools.filter')}</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as ToolFilter)} className="ui-control min-h-8 w-full text-xs">
                <option value="all">{t('tools.all')}</option>
                <option value="enabled">{t('tools.enabled')}</option>
                <option value="disabled">{t('tools.disabled')}</option>
              </select>
            </label>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {visibleTools.map((tool) => (
              <SettingsListRow
                key={tool.id}
                selected={!creating && selectedId === tool.id}
                onSelect={() => selectTool(tool)}
                ariaLabel={tool.name}
                title={tool.name}
                badge={tool.enabled ? t('tools.enabled') : t('tools.disabled')}
                description={tool.description}
                status={tool.enabled ? 'success' : 'muted'}
                statusLabel={tool.enabled ? t('tools.enabled') : t('tools.disabled')}
                actions={(
                  <IconButton
                    name="trash"
                    label={`${t('common.delete')} ${tool.name}`}
                    size={13}
                    disabled={busy || creating}
                    className="mt-1 opacity-70 group-hover:opacity-100"
                    onClick={() => void remove(tool)}
                  />
                )}
              />
            ))}
            {!visibleTools.length && <p className="p-4 text-center text-xs text-text-muted">{t('tools.noMatch')}</p>}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          {!draft ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Icon name="tool" size={28} className="text-text-muted" />
              <h2 className="mt-3 text-sm font-medium text-text-primary">{t('tools.select')}</h2>
              <p className="mt-1 max-w-md text-xs text-text-muted">{t('tools.selectHint')}</p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-text-primary">{creating ? t('tools.new') : t('tools.edit')}</h2>
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft('enabled', event.target.checked)} />
                  {t('tools.enabled')}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label={t('tools.id')} hint={t('tools.idHint')}>
                  <input aria-label={t('tools.id')} value={draft.id} disabled={!creating} onChange={(event) => updateDraft('id', event.target.value.toLowerCase())} className="ui-control min-h-8 w-full font-mono text-xs disabled:opacity-60 px-2.5 py-2" />
                </Field>
                <Field label={t('tools.name')}>
                  <input aria-label={t('tools.name')} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} className="ui-control min-h-8 w-full text-xs px-2.5 py-2" />
                </Field>
                <Field label={t('tools.descriptionField')} className="col-span-2">
                  <textarea aria-label={t('tools.descriptionField')} value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} rows={3} className="ui-control w-full resize-y px-2.5 py-2 text-xs" />
                </Field>
                <Field label={t('tools.risk')}>
                  <select aria-label={t('tools.risk')} value={draft.risk} onChange={(event) => updateDraft('risk', event.target.value as ToolCatalogRecord['risk'])} className="ui-control min-h-8 w-full text-xs">
                    {TOOL_RISKS.map((risk) => <option key={risk} value={risk}>{risk === 'passive' ? t('tools.riskPassive') : risk === 'active' ? t('tools.riskActive') : t('tools.riskDestructive')}</option>)}
                  </select>
                </Field>
                <Field label={t('tools.channel')}>
                  <select aria-label={t('tools.channel')} value={draft.channel} onChange={(event) => updateDraft('channel', event.target.value as ToolCatalogRecord['channel'])} className="ui-control min-h-8 w-full text-xs">
                    {TOOL_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel === 'agent-runtime' ? t('tools.channelAgentRuntime') : channel === 'electron' ? t('tools.channelElectron') : channel === 'mcp' ? t('tools.channelMcp') : t('tools.channelDocker')}</option>)}
                  </select>
                </Field>
                <Field label={t('tools.capabilities')} className="col-span-2">
                  <TagEditor label={t('tools.capabilities')} values={draft.capabilities} onChange={(values) => updateDraft('capabilities', values)} placeholder={t('tools.capabilityPlaceholder')} removeLabel={t('tools.removeTag')} />
                </Field>
                <Field label={t('tools.tactics')}>
                  <MultiSelect label={t('tools.tactics')} values={draft.tacticIds} onChange={(values) => updateDraft('tacticIds', values)} options={ATTACK_TACTICS.map((entry) => ({ value: entry.id, label: `${entry.id} · ${entry.name}` }))} />
                </Field>
                <Field label={t('tools.techniques')}>
                  <MultiSelect label={t('tools.techniques')} values={draft.techniqueIds} onChange={(values) => updateDraft('techniqueIds', values)} options={ATTACK_TECHNIQUES.map((entry) => ({ value: entry.id, label: `${entry.id} · ${entry.name}` }))} />
                </Field>
                <Field label={t('tools.command')}>
                  <input aria-label={t('tools.command')} value={draft.command ?? ''} onChange={(event) => updateDraft('command', event.target.value || undefined)} className="ui-control min-h-8 w-full font-mono text-xs px-2.5 py-2" placeholder={t('tools.commandPlaceholder')} />
                </Field>
                <Field label={t('tools.usage')}>
                  <textarea aria-label={t('tools.usage')} value={draft.usage ?? ''} onChange={(event) => updateDraft('usage', event.target.value || undefined)} rows={3} className="ui-control w-full resize-y px-2.5 py-2 text-xs" placeholder={t('tools.usagePlaceholder')} />
                </Field>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border-subtle pt-4">
                <div>{!creating && <Button tone="danger" size="compact" leadingIcon="trash" disabled={busy} onClick={() => void remove()}>{t('tools.delete')}</Button>}</div>
                <div className="flex gap-2">
                  <Button size="compact" disabled={busy} onClick={cancel}>{t('tools.cancel')}</Button>
                  <Button tone="primary" size="compact" disabled={busy} onClick={() => void save()}>{t('tools.save')}</Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('block min-w-0', className)}>
      <span className="mb-1 block text-[11px] font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-4 text-text-muted">{hint}</span>}
    </div>
  );
}

function MultiSelect({ label, values, options, onChange }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; onChange: (values: string[]) => void }) {
  return (
    <select
      aria-label={label}
      multiple
      size={8}
      value={values}
      onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
      className="ui-control min-h-40 w-full py-1 font-mono text-[11px]"
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function TagEditor({ label, values, onChange, placeholder, removeLabel }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string; removeLabel: string }) {
  const [input, setInput] = useState('');
  const commit = () => {
    const additions = input.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (additions.length) onChange([...new Set([...values, ...additions])]);
    setInput('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    }
  };
  return (
    <div className="rounded border border-border-subtle bg-panel px-2 py-1.5 focus-within:ring-2 focus-within:ring-focus">
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span key={value} className="flex items-center gap-1 rounded bg-accent-teal/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-teal">
            {value}
            <button type="button" aria-label={`${removeLabel} ${value}`} onClick={() => onChange(values.filter((entry) => entry !== value))} className="hover:text-text-primary">×</button>
          </span>
        ))}
        <input aria-label={label} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} onBlur={commit} className="min-h-6 min-w-52 flex-1 bg-transparent text-xs text-text-primary outline-none" placeholder={placeholder} />
      </div>
    </div>
  );
}
