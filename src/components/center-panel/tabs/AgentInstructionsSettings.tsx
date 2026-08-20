import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ATTACK_TACTICS, ATTACK_TECHNIQUES } from '@electron/contracts/tasks';
import type { RestrictionDocumentResult, RestrictionRule, RestrictionSelector } from '@electron/services/restriction.service';
import type { RestrictionClassificationSuggestion } from '@electron/contracts/restriction-classification';
import { Button, DismissibleNotice, Icon, IconButton, SettingsListRow, useConfirmDialog } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/stores';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/translations';

type Scope = 'global' | 'project';
type RestrictionFilter = 'all' | 'enabled' | 'disabled' | 'general' | 'attack';

type RestrictionsResponse = {
  version: 1;
  global: RestrictionDocumentResult;
  project: RestrictionDocumentResult;
  diagnostics: string[];
};

function selectorLabel(selector: RestrictionSelector): string {
  if (selector.kind === 'general') return 'General';
  const count = selector.tacticIds.length + selector.techniqueIds.length;
  return count ? `${count} ATT&CK ${count === 1 ? 'binding' : 'bindings'}` : 'ATT&CK';
}

function selectorKey(selector: RestrictionSelector): 'general' | 'attack' {
  return selector.kind === 'general' ? 'general' : 'attack';
}

function toggleId(values: string[], id: string): string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span className={cn(
      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
      selected ? 'border-accent-blue/60 bg-accent-blue/15 text-accent-blue' : 'border-border-strong text-transparent',
    )}>
      <Icon name="check" size={11} />
    </span>
  );
}

function RestrictionEditorPane({
  editor,
  scope,
  onChange,
  onClose,
  onSave,
  onClassify,
}: {
  editor: RestrictionRule;
  scope: Scope;
  onChange: (next: RestrictionRule) => void;
  onClose: () => void;
  onSave: () => void;
  onClassify: (text: string) => Promise<RestrictionClassificationSuggestion>;
}) {
  const { t, language } = useI18n();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [techniqueQuery, setTechniqueQuery] = useState('');
  const [tacticFilter, setTacticFilter] = useState('all');
  const [selectorView, setSelectorView] = useState<'tactics' | 'techniques'>('tactics');
  const [editorView, setEditorView] = useState<'details' | 'catalog'>('details');
  const [classifying, setClassifying] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<RestrictionClassificationSuggestion | null>(null);
  const classificationInFlight = useRef(false);
  const lastClassifiedText = useRef('');

  useEffect(() => {
    window.setTimeout(() => textRef.current?.focus(), 0);
  }, []);

  const attackSelector = editor.selector.kind === 'attack' ? editor.selector : null;
  const selectedTactics = attackSelector
    ? ATTACK_TACTICS.filter((tactic) => attackSelector.tacticIds.includes(tactic.id))
    : [];
  const selectedTechniques = attackSelector
    ? ATTACK_TECHNIQUES.filter((technique) => attackSelector.techniqueIds.includes(technique.id))
    : [];
  const visibleTechniques = useMemo(() => {
    if (!attackSelector) return [];
    const query = techniqueQuery.trim().toLowerCase();
    const selected = new Set(attackSelector.techniqueIds);
    return ATTACK_TECHNIQUES.filter((technique) => selected.has(technique.id) || (
      (tacticFilter === 'all' || technique.tacticIds.includes(tacticFilter))
      && (!query || `${technique.id} ${technique.name}`.toLowerCase().includes(query))
    ));
  }, [attackSelector, tacticFilter, techniqueQuery]);

  const classify = async (force = false) => {
    const text = editor.text.trim();
    if (text.length < 4 || classificationInFlight.current || (!force && lastClassifiedText.current === text)) return;
    classificationInFlight.current = true;
    setClassificationError(null);
    setClassifying(true);
    try {
      const result = await onClassify(text);
      lastClassifiedText.current = text;
      if (textRef.current?.value.trim() === text) setSuggestion(result);
    } catch (reason) {
      setClassificationError(String(reason));
    } finally {
      classificationInFlight.current = false;
      setClassifying(false);
    }
  };

  const confidenceLabel = suggestion
    ? t(`restrictions.confidence${suggestion.confidence[0].toUpperCase()}${suggestion.confidence.slice(1)}` as 'restrictions.confidenceHigh' | 'restrictions.confidenceMedium' | 'restrictions.confidenceLow')
    : '';

  return (
    <section data-testid="restriction-editor-pane" aria-labelledby="restriction-editor-title" className="flex h-full min-h-0 flex-col bg-canvas">
      {editorView === 'catalog' && attackSelector ? (
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
          <button type="button" onClick={() => setEditorView('details')} className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs text-text-secondary hover:bg-raised/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Icon name="chevron-left" size={14} />
            {t('restrictions.ruleDetails')}
          </button>
          <div className="min-w-0 text-center">
            <h2 id="restriction-editor-title" className="truncate text-sm font-semibold text-text-primary">{t('restrictions.catalog')}</h2>
            <p className="text-[11px] text-text-muted">{t('restrictions.selectedSummary', { tactics: attackSelector.tacticIds.length, techniques: attackSelector.techniqueIds.length })}</p>
          </div>
          <Button size="compact" tone="primary" onClick={() => setEditorView('details')}>{t('restrictions.done')}</Button>
        </header>
      ) : (
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-blue">{scope}</span>
              <span className="h-1 w-1 rounded-full bg-border-strong" />
              <span className="text-[11px] text-text-muted">{t('restrictions.agentInstruction')}</span>
            </div>
            <h2 id="restriction-editor-title" className="text-sm font-semibold text-text-primary">
              {editor.id ? t('restrictions.edit') : t('restrictions.new')}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={editor.enabled}
                onChange={(event) => onChange({ ...editor, enabled: event.target.checked })}
              />
              {t('restrictions.enabled')}
            </label>
            <IconButton name="close" label={t('restrictions.closeEditor')} onClick={onClose} />
          </div>
        </header>
      )}

      <div className={cn('min-h-0 flex-1 overflow-hidden', editorView === 'catalog' ? 'p-3' : 'p-4')}>
        {editorView === 'details' ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(16rem,1fr)_minmax(14rem,0.72fr)] gap-4">
            <div className="min-h-0 overflow-y-auto pr-1">
            <label className="block text-xs font-medium text-text-secondary">
              {t('restrictions.rule')}
              <textarea
                ref={textRef}
                value={editor.text}
                onChange={(event) => {
                  onChange({ ...editor, text: event.target.value });
                  setSuggestion(null);
                  setClassificationError(null);
                }}
                onBlur={() => void classify()}
                rows={7}
                placeholder={t('restrictions.rulePlaceholder')}
                className="settings-input settings-textarea-large mt-1.5 w-full resize-y text-xs leading-5"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-text-muted">{t('restrictions.analyzeHint')}</p>
              <Button size="compact" leadingIcon="sparkles" disabled={editor.text.trim().length < 4 || classifying} onClick={() => void classify(true)}>
                {classifying ? t('restrictions.classifying') : t('restrictions.classify')}
              </Button>
            </div>
            {classificationError && <DismissibleNotice tone="error" className="mt-3" onDismiss={() => setClassificationError(null)}>{classificationError}</DismissibleNotice>}

            <div className="mt-4">
              <div className="text-xs font-medium text-text-secondary">{t('restrictions.appliesTo')}</div>
              <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{t('restrictions.appliesHint')}</p>
              <div className="ui-segmented mt-2 grid grid-cols-2" role="group" aria-label="Restriction binding type">
                <button
                  type="button"
                  aria-pressed={editor.selector.kind === 'general'}
                  onClick={() => {
                    onChange({ ...editor, selector: { kind: 'general' } });
                    setEditorView('details');
                  }}
                  className={cn('ui-segmented-item min-h-8 px-2 text-xs', editor.selector.kind === 'general' && 'ui-segmented-item-active')}
                >
                  {t('restrictions.general')}
                </button>
                <button
                  type="button"
                  aria-pressed={editor.selector.kind === 'attack'}
                  onClick={() => {
                    onChange({ ...editor, selector: attackSelector ?? { kind: 'attack', tacticIds: [], techniqueIds: [] } });
                    setEditorView('catalog');
                  }}
                  className={cn('ui-segmented-item min-h-8 px-2 text-xs', editor.selector.kind === 'attack' && 'ui-segmented-item-active')}
                >
                  ATT&amp;CK
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border-subtle bg-panel/25 p-3">
              <div className="flex items-start gap-2.5">
                <Icon name="shield" size={16} className={cn('mt-0.5', attackSelector ? 'text-accent-blue' : 'text-accent-teal')} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-secondary">{attackSelector ? t('restrictions.taskBoundary') : t('restrictions.universalBoundary')}</p>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    {attackSelector
                      ? t('restrictions.selectedSummary', { tactics: attackSelector.tacticIds.length, techniques: attackSelector.techniqueIds.length })
                      : t('restrictions.appliedEverywhere')}
                  </p>

                  {attackSelector && (
                    <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
                      <AttackBindingGroup
                        label={t('restrictions.tactics')}
                        emptyLabel={t('restrictions.noTacticsSelected')}
                        items={selectedTactics.map((tactic) => ({
                          id: tactic.id,
                          name: t(`attack.tactic.${tactic.id}` as TranslationKey),
                        }))}
                      />
                      <AttackBindingGroup
                        label={t('restrictions.techniques')}
                        emptyLabel={t('restrictions.noTechniquesSelected')}
                        items={selectedTechniques.map((technique) => ({ id: technique.id, name: technique.name }))}
                      />
                      <Button size="compact" leadingIcon="target" onClick={() => setEditorView('catalog')}>
                        {t('restrictions.editAttackBindings')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>

            <div className={cn('flex h-full min-h-0 items-center justify-center rounded-lg border bg-panel/20 p-6', suggestion ? 'border-accent-blue/30' : 'border-dashed border-border-subtle')}>
              <div className="max-w-xs">
                <Icon name={suggestion ? 'sparkles' : attackSelector ? 'target' : 'shield'} size={24} className={cn('mx-auto mb-3', suggestion || attackSelector ? 'text-accent-blue' : 'text-accent-teal')} />
                <p className="text-xs font-medium text-text-secondary">{suggestion ? t('restrictions.suggestion') : attackSelector ? t('restrictions.attackAware') : t('restrictions.noAttackFiltering')}</p>
                {suggestion ? (
                  <>
                    <p className="mt-1 text-[11px] text-accent-blue">{suggestion.selector.kind === 'general' ? t('restrictions.suggestGeneral') : selectorLabel(suggestion.selector)}</p>
                    <p className="mt-2 text-[11px] leading-5 text-text-muted">{suggestion.reason}</p>
                    {suggestion.selector.kind === 'attack' && (
                      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                        {[...suggestion.matchedTactics, ...suggestion.matchedTechniques].map((item) => (
                          <span key={item.id} className="rounded border border-accent-blue/25 bg-accent-blue/8 px-2 py-1 font-mono text-[11px] text-text-secondary" title={item.name}>
                            {item.id} · {item.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-text-muted">{t('restrictions.confidence', { level: confidenceLabel })}</p>
                    <div className="mt-3 flex justify-center gap-2">
                      <Button size="compact" onClick={() => setSuggestion(null)}>{t('restrictions.keepManual')}</Button>
                      <Button size="compact" tone="primary" onClick={() => {
                        onChange({ ...editor, selector: suggestion.selector });
                        setSuggestion(null);
                      }}>{t('restrictions.applySuggestion')}</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[11px] leading-5 text-text-muted">
                      {attackSelector
                        ? t('restrictions.selectedSummary', { tactics: attackSelector.tacticIds.length, techniques: attackSelector.techniqueIds.length })
                        : t('restrictions.appliedEverywhere')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : attackSelector ? (
          <section aria-label={t('restrictions.selector')} className="ui-card flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle p-2">
                <div className="ui-segmented flex" role="tablist" aria-label={t('restrictions.selectorView')}>
                  <button role="tab" aria-selected={selectorView === 'tactics'} onClick={() => setSelectorView('tactics')} className={cn('ui-segmented-item min-h-7 px-3 text-xs', selectorView === 'tactics' && 'ui-segmented-item-active')}>{t('restrictions.tactics')} <span className="ml-1 font-mono text-[11px] text-text-muted">{attackSelector.tacticIds.length}</span></button>
                  <button role="tab" aria-selected={selectorView === 'techniques'} onClick={() => setSelectorView('techniques')} className={cn('ui-segmented-item min-h-7 px-3 text-xs', selectorView === 'techniques' && 'ui-segmented-item-active')}>{t('restrictions.techniques')} <span className="ml-1 font-mono text-[11px] text-text-muted">{attackSelector.techniqueIds.length}</span></button>
                </div>
                <span className="text-[11px] text-text-muted">Enterprise v19.1</span>
              </div>

              {selectorView === 'techniques' && (
                <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_9rem] gap-2 border-b border-border-subtle p-2">
                  <label className="relative">
                    <span className="sr-only">{t('restrictions.searchTechniques')}</span>
                    <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-muted" />
                    <input value={techniqueQuery} onChange={(event) => setTechniqueQuery(event.target.value)} aria-label={t('restrictions.searchTechniques')} placeholder={t('restrictions.searchTechniquePlaceholder')} className="settings-input w-full pl-8 text-xs" />
                  </label>
                  <select value={tacticFilter} onChange={(event) => setTacticFilter(event.target.value)} aria-label={t('restrictions.filterTactic')} className="settings-input text-xs">
                    <option value="all">{t('restrictions.allTactics')}</option>
                    {ATTACK_TACTICS.map((tactic) => <option key={tactic.id} value={tactic.id}>{tactic.name}</option>)}
                  </select>
                </div>
              )}

              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-1.5">
                <span className="text-[11px] text-text-muted">
                  {selectorView === 'tactics' ? t('restrictions.tacticCount', { count: ATTACK_TACTICS.length }) : t('restrictions.techniqueCount', { visible: visibleTechniques.length, total: ATTACK_TECHNIQUES.length })}
                </span>
                {(selectorView === 'tactics' ? attackSelector.tacticIds.length : attackSelector.techniqueIds.length) > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-accent-blue hover:text-text-primary"
                    onClick={() => onChange({ ...editor, selector: selectorView === 'tactics' ? { ...attackSelector, tacticIds: [] } : { ...attackSelector, techniqueIds: [] } })}
                  >
                    {t('restrictions.clearSelected')}
                  </button>
                )}
              </div>

              <div role="group" aria-label={selectorView === 'tactics' ? 'ATT&CK tactics' : 'ATT&CK techniques'} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                {selectorView === 'tactics' ? ATTACK_TACTICS.map((tactic) => {
                  const selected = attackSelector.tacticIds.includes(tactic.id);
                  return (
                    <button key={tactic.id} type="button" aria-pressed={selected} onClick={() => onChange({ ...editor, selector: { ...attackSelector, tacticIds: toggleId(attackSelector.tacticIds, tactic.id) } })} className={cn('ui-hover-row flex min-h-9 w-full items-center gap-2 px-2 text-left', selected && 'border-accent-blue/30 bg-accent-blue/8')}>
                      <SelectionMark selected={selected} />
                      <span className="w-14 shrink-0 font-mono text-[11px] text-text-muted">{tactic.id}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                        {t(`attack.tactic.${tactic.id}` as TranslationKey)}
                        {language === 'zh-CN' && <span className="ml-2 text-[11px] text-text-muted">{tactic.name}</span>}
                      </span>
                    </button>
                  );
                }) : visibleTechniques.map((technique) => {
                  const selected = attackSelector.techniqueIds.includes(technique.id);
                  return (
                    <button key={technique.id} type="button" aria-pressed={selected} onClick={() => onChange({ ...editor, selector: { ...attackSelector, techniqueIds: toggleId(attackSelector.techniqueIds, technique.id) } })} className={cn('ui-hover-row flex min-h-9 w-full items-center gap-2 px-2 text-left', selected && 'border-accent-blue/30 bg-accent-blue/8')}>
                      <SelectionMark selected={selected} />
                      <span className="w-[4.75rem] shrink-0 font-mono text-[11px] text-text-muted">{technique.id}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={technique.name}>{technique.name}</span>
                      {technique.isSubTechnique && <span className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-text-muted">sub</span>}
                    </button>
                  );
                })}
                {selectorView === 'techniques' && visibleTechniques.length === 0 && <p className="p-6 text-center text-xs text-text-muted">{t('restrictions.noTechniques')}</p>}
              </div>
          </section>
        ) : null}
      </div>

      {editorView === 'details' && (
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border-subtle bg-panel/35 px-5 py-3">
          <span className="text-[11px] text-text-muted">{t('restrictions.validationHint')}</span>
          <div className="flex shrink-0 gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button tone="primary" disabled={!editor.text.trim()} onClick={onSave}>{t('restrictions.save')}</Button>
          </div>
        </footer>
      )}
    </section>
  );
}

function AttackBindingGroup({ label, emptyLabel, items }: {
  label: string;
  emptyLabel: string;
  items: Array<{ id: string; name: string }>;
}) {
  return (
    <section aria-label={label}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-text-secondary">{label}</span>
        <span className="font-mono text-[10px] text-text-muted">{items.length}</span>
      </div>
      {items.length ? (
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <span key={item.id} title={`${item.id} · ${item.name}`} className="flex max-w-full items-center gap-1.5 rounded-md border border-accent-blue/25 bg-accent-blue/8 px-2 py-1 text-[11px]">
              <span className="shrink-0 font-mono text-accent-blue">{item.id}</span>
              <span className="min-w-0 truncate text-text-secondary">{item.name}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">{emptyLabel}</p>
      )}
    </section>
  );
}

export function AgentInstructionsSettings() {
  const confirm = useConfirmDialog();
  const { t } = useI18n();
  const sessionId = useSessionStore((state) => state.currentSession?.id ?? null);
  const [scope, setScope] = useState<Scope>('global');
  const [data, setData] = useState<RestrictionsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<RestrictionRule | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RestrictionFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    if (!sessionId) return;
    void window.hexestra.invoke<RestrictionsResponse>('restrictions:list', sessionId).then(setData).catch((reason) => setError(String(reason)));
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);

  const restrictionDocument = data?.[scope];
  const rules = useMemo(() => (restrictionDocument?.document.rules ?? []).filter((rule) => {
    const query = search.trim().toLowerCase();
    const searchable = `${rule.id} ${rule.text} ${selectorLabel(rule.selector)}`.toLowerCase();
    return (!query || searchable.includes(query)) && (
      filter === 'all'
      || filter === 'enabled' && rule.enabled
      || filter === 'disabled' && !rule.enabled
      || filter === selectorKey(rule.selector)
    );
  }), [filter, restrictionDocument, search]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, []);

  const openEditor = (rule: RestrictionRule, trigger?: HTMLElement | null) => {
    returnFocusRef.current = trigger ?? globalThis.document.activeElement as HTMLElement | null;
    setSelectedId(rule.id || null);
    setEditor(rule);
  };

  const newRule = (trigger?: HTMLElement | null) => {
    const now = new Date().toISOString();
    openEditor({ id: '', text: '', enabled: true, selector: { kind: 'general' }, createdAt: now, updatedAt: now }, trigger);
  };

  const changeScope = (next: Scope) => {
    setScope(next);
    setSelectedId(null);
    setEditor(null);
  };

  const save = async () => {
    if (!sessionId || !editor) return;
    setError(null);
    try {
      await window.hexestra.invoke('restrictions:upsert', sessionId, scope, { ...editor, id: editor.id || undefined });
      setEditor(null);
      setSelectedId(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      refresh();
    } catch (reason) { setError(String(reason)); }
  };

  const remove = async (rule: RestrictionRule) => {
    if (!sessionId) return;
    const approved = await confirm({
      title: t('restrictions.deleteTitle'),
      description: t('restrictions.deleteDescription', { id: rule.id, scope: scope === 'global' ? t('restrictions.global') : t('restrictions.project') }),
      details: rule.text,
      confirmLabel: t('restrictions.deleteConfirm'),
      tone: 'danger',
    });
    if (!approved) return;
    try {
      await window.hexestra.invoke('restrictions:delete', sessionId, scope, rule.id);
      if (selectedId === rule.id) {
        setSelectedId(null);
        setEditor(null);
      }
      refresh();
    } catch (reason) { setError(String(reason)); }
  };

  const exportYaml = async () => {
    if (!sessionId) return;
    try { await window.hexestra.invoke('restrictions:export', sessionId, scope); } catch (reason) { setError(String(reason)); }
  };

  const importYaml = async (file: File) => {
    if (!sessionId) return;
    try {
      const text = await file.text();
      const preview = await window.hexestra.invoke<{
        added: RestrictionRule[];
        updated: RestrictionRule[];
        unchanged: RestrictionRule[];
        diagnostics: string[];
        document: { version: 1; rules: RestrictionRule[] };
        baseFingerprint: string;
        scope: Scope;
      }>('restrictions:import-preview', sessionId, scope, text);
      if (preview.diagnostics.length) throw new Error(preview.diagnostics.join('; '));
      const accepted = await confirm({
        title: t('restrictions.importTitle'),
        description: t('restrictions.importDescription', { added: preview.added.length, updated: preview.updated.length, scope: scope === 'global' ? t('restrictions.global') : t('restrictions.project') }),
        details: t('restrictions.importReplace'),
        confirmLabel: t('restrictions.importConfirm'),
        tone: 'trust',
      });
      if (!accepted) return;
      await window.hexestra.invoke('restrictions:import-apply', sessionId, scope, preview);
      refresh();
    } catch (reason) { setError(String(reason)); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-6 py-3.5">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{t('restrictions.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">{t('restrictions.description')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {saved && <span role="status" className="self-center pr-1 text-xs text-status-success">{t('restrictions.saved')}</span>}
          <Button size="compact" leadingIcon="file" onClick={() => void exportYaml()}>{t('restrictions.export')}</Button>
          <Button size="compact" leadingIcon="folder" onClick={() => fileInput.current?.click()}>{t('restrictions.import')}</Button>
          <Button tone="primary" size="compact" leadingIcon="plus" onClick={(event) => newRule(event.currentTarget)}>{t('restrictions.add')}</Button>
          <input ref={fileInput} type="file" accept=".yaml,.yml" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importYaml(file); event.target.value = ''; }} />
        </div>
      </header>

      {data?.diagnostics.length ? <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setError(null)}>{data.diagnostics.join(' · ')}</DismissibleNotice> : null}
      {error && <DismissibleNotice tone="error" className="mx-6 mt-3" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,30%)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-border-subtle bg-panel/25">
          <div className="shrink-0 border-b border-border-subtle p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="ui-segmented flex" role="tablist" aria-label="Restriction scope">
                <button role="tab" aria-selected={scope === 'global'} onClick={() => changeScope('global')} className={cn('ui-segmented-item min-h-7 px-3 text-xs', scope === 'global' && 'ui-segmented-item-active')}>{t('restrictions.global')}</button>
                <button role="tab" aria-selected={scope === 'project'} onClick={() => changeScope('project')} className={cn('ui-segmented-item min-h-7 px-3 text-xs', scope === 'project' && 'ui-segmented-item-active')}>{t('restrictions.project')}</button>
              </div>
              <span className="truncate text-[11px] text-text-muted">{scope === 'global' ? t('restrictions.everyProject') : t('restrictions.thisProject')}</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
              <label className="relative">
                <span className="sr-only">{t('restrictions.search')}</span>
                <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-text-muted" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t('restrictions.search')} placeholder={t('restrictions.searchPlaceholder')} className="settings-input w-full pl-8 text-xs" />
              </label>
              <select value={filter} onChange={(event) => setFilter(event.target.value as RestrictionFilter)} aria-label={t('restrictions.filter')} className="settings-input text-xs">
                <option value="all">{t('restrictions.allRules')}</option>
                <option value="enabled">{t('restrictions.enabled')}</option>
                <option value="disabled">{t('restrictions.disabled')}</option>
                <option value="general">{t('restrictions.general')}</option>
                <option value="attack">ATT&amp;CK</option>
              </select>
            </div>
            <p className="mt-2 text-[11px] text-text-muted">{t('restrictions.rulesInScope', { count: rules.length, scope: scope === 'global' ? t('restrictions.global') : t('restrictions.project') })}</p>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {rules.map((rule) => (
              <SettingsListRow
                key={rule.id}
                selected={selectedId === rule.id}
                onSelect={(event) => openEditor(rule, event.currentTarget)}
                ariaLabel={rule.id || t('restrictions.new')}
                title={<span className="font-mono text-[11px] text-text-secondary">{rule.id || t('restrictions.new')}</span>}
                badge={rule.selector.kind === 'general'
                  ? t('restrictions.general')
                  : t('restrictions.attackBindingCount', { count: rule.selector.tacticIds.length + rule.selector.techniqueIds.length })}
                description={<span className="text-xs leading-5">{rule.text}</span>}
                status={rule.enabled ? 'success' : 'muted'}
                statusLabel={rule.enabled ? t('restrictions.enabled') : t('restrictions.disabled')}
                actions={<IconButton name="trash" label={`${t('common.delete')} ${rule.id}`} size={13} className="mt-1 opacity-70 group-hover:opacity-100" onClick={() => void remove(rule)} />}
              />
            ))}
            {!rules.length && (
              <div className="flex h-full min-h-48 items-center justify-center p-4 text-center">
                <div>
                  <Icon name="shield" size={22} className="mx-auto mb-2 text-text-muted" />
                  <p className="text-xs text-text-secondary">{t('restrictions.noMatch')}</p>
                  <button type="button" className="mt-2 text-xs text-accent-blue hover:text-text-primary" onClick={(event) => newRule(event.currentTarget)}>{t('restrictions.addFirst')}</button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden">
          {editor ? (
            <RestrictionEditorPane
              editor={editor}
              scope={scope}
              onChange={setEditor}
              onClose={closeEditor}
              onSave={() => void save()}
              onClassify={(text) => window.hexestra.invoke<RestrictionClassificationSuggestion>('restrictions:classify', sessionId, text)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div className="max-w-xs">
                <Icon name="shield" size={28} className="mx-auto mb-3 text-text-muted" />
                <p className="text-sm font-medium text-text-secondary">{t('restrictions.selectTitle')}</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">{t('restrictions.selectHint')}</p>
                <Button size="compact" leadingIcon="plus" className="mt-4" onClick={(event) => newRule(event.currentTarget)}>{t('restrictions.add')}</Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
