import { useEffect, useState, type ReactNode } from 'react';
import type {
  AgentConnectionDiagnostic,
  AgentConnectionSettings,
  AgentSettingsContainer,
  CodexConnectionSettings,
  AgentExecutionMode,
  ClaudeSettingSource,
} from '@electron/contracts/agent-settings';
import type { PlatformCapabilities } from '@electron/contracts/platform';
import type { MitmproxyRuntimeDiagnostic } from '@electron/services/mitmproxy-runtime';
import { TRAFFIC_IPC } from '@electron/contracts/traffic';
import { DismissibleNotice, Icon, ReasoningEffortSlider, Surface } from '@/components/shared';
import { cn } from '@/lib/cn';
import { useChatStore } from '@/stores';
import { useTabStore, type SettingsPage } from '@/stores/useTabStore';
import { BurpSettings } from './BurpSettings';
import { SkillsSettings } from './SkillsSettings';
import { McpSettings } from './McpSettings';
import { ProxySettings } from './ProxySettings';
import { AgentInstructionsSettings } from './AgentInstructionsSettings';
import { ToolCatalogSettings } from './ToolCatalogSettings';
import { ShortcutsSettings } from './ShortcutsSettings';
import { useAppPreferences, useI18n } from '@/i18n';
import { useAgentModels } from '@/hooks/useAgentModels';

const SOURCES: Array<{ id: ClaudeSettingSource; label: string; detail: string }> = [
  { id: 'user', label: 'User', detail: '~/.claude/settings.json' },
  { id: 'project', label: 'Project', detail: '.claude/settings.json' },
  { id: 'local', label: 'Local', detail: '.claude/settings.local.json' },
];

type AgentBackendSelection = 'claude' | 'codex';
type CodexDiagnostic = { available: boolean; authenticated: boolean | null; lastError: string | null; runtimeLabel: string;
  skills?: number | null; mcpServers?: number | null; skillError?: string | null; mcpError?: string | null;
  bridgeReady?: boolean; bridgeError?: string | null };

export function SettingsTab() {
  const requestedPage = useTabStore((state) => {
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    const value = active?.type === 'settings' ? active.data?.settingsPage : undefined;
    return isSettingsPage(value) ? value : 'general';
  });
  const [page, setPage] = useState<SettingsPage>(requestedPage);
  const { t } = useI18n();

  useEffect(() => setPage(requestedPage), [requestedPage]);

  const selectPage = (value: SettingsPage) => {
    setPage(value);
    const store = useTabStore.getState();
    if (store.activeTabId) store.updateTabData(store.activeTabId, { settingsPage: value });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <nav aria-label={t('common.settings')} className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border-subtle bg-canvas/40 px-5">
        <SettingsPageButton active={page === 'general'} icon="settings" label={t('settings.general')} onClick={() => selectPage('general')} />
        <SettingsPageButton active={page === 'shortcuts'} icon="code" label={t('settings.shortcuts')} onClick={() => selectPage('shortcuts')} />
        <SettingsPageButton active={page === 'connection'} icon="terminal" label={t('settings.connection')} onClick={() => selectPage('connection')} />
        <SettingsPageButton active={page === 'traffic'} icon="activity" label={t('settings.trafficRuntime')} onClick={() => selectPage('traffic')} />
        <SettingsPageButton active={page === 'proxy'} icon="network" label={t('settings.proxy')} onClick={() => selectPage('proxy')} />
        <SettingsPageButton active={page === 'burp'} icon="activity" label={t('settings.burp')} onClick={() => selectPage('burp')} />
        <SettingsPageButton active={page === 'skills'} icon="sparkles" label={t('settings.skills')} onClick={() => selectPage('skills')} />
        <SettingsPageButton active={page === 'instructions'} icon="shield" label={t('settings.restrictions')} onClick={() => selectPage('instructions')} />
        <SettingsPageButton active={page === 'tools'} icon="terminal" label={t('settings.tools')} onClick={() => selectPage('tools')} />
        <SettingsPageButton active={page === 'mcp'} icon="server" label={t('settings.mcp')} onClick={() => selectPage('mcp')} />
      </nav>
      <div className="min-h-0 flex-1">
        {page === 'general' && <GeneralSettings />}
        {page === 'shortcuts' && <ShortcutsSettings />}
        {page === 'connection' && <ConnectionSettings />}
        {page === 'traffic' && <TrafficRuntimeSettings />}
        {page === 'proxy' && <ProxySettings />}
        {page === 'burp' && <BurpSettings />}
        {page === 'skills' && <SkillsSettings />}
        {page === 'instructions' && <AgentInstructionsSettings />}
        {page === 'tools' && <ToolCatalogSettings />}
        {page === 'mcp' && <McpSettings />}
      </div>
    </div>
  );
}

function ConnectionSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AgentSettingsContainer | null>(null);
  const [saved, setSaved] = useState<AgentSettingsContainer | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<AgentBackendSelection>('claude');
  const [diagnostic, setDiagnostic] = useState<AgentConnectionDiagnostic | null>(null);
  const [codexDiagnostic, setCodexDiagnostic] = useState<CodexDiagnostic | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const [modelRefreshKey, setModelRefreshKey] = useState(0);
  const activeProjectId = useChatStore((state) => state.activeProjectId);
  const agentStatus = useChatStore((state) => state.agentStatus);
  const modelRuntimeChanged = Boolean(settings && saved &&
    modelRuntimeKey(settings.backends[selectedBackend]) !== modelRuntimeKey(saved.backends[selectedBackend]));
  const modelCatalog = useAgentModels(selectedBackend, settings !== null && !modelRuntimeChanged, activeProjectId, modelRefreshKey);

  useEffect(() => {
    let active = true;
    void window.hexestra.invoke<AgentSettingsContainer>('agent:settings:get')
      .then((raw) => {
        if (!active) return;
        const value = normalizeSettingsPayload(raw);
        setSettings(value);
        setSaved(value);
        setSelectedBackend(value.defaultBackendId);
      })
      .catch((reason) => active && setError(String(reason)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void window.hexestra.invoke<PlatformCapabilities>('app:getCapabilities').then(setCapabilities).catch(() => setCapabilities(null));
  }, []);

  const claude = settings?.backends.claude;
  const updateClaude = (patch: Partial<NonNullable<typeof claude>>) => {
    setDiagnostic(null);
    setSettings((current) => current ? {
    ...current,
    backends: { ...current.backends, claude: { ...current.backends.claude, ...patch } },
    } : current);
  };
  const updateCodex = (patch: Partial<CodexConnectionSettings>) => {
    setCodexDiagnostic(null);
    setSettings((current) => current ? {
    ...current,
    backends: { ...current.backends, codex: { ...current.backends.codex, ...patch } },
    } : current);
  };
  const diagnoseCodex = async () => {
    setError(null);
    try { setCodexDiagnostic(await window.hexestra.invoke('codex:diagnose', activeProjectId)); }
    catch (reason) { setError(String(reason)); }
  };
  const updateMode = (executionMode: AgentExecutionMode) => {
    if (!settings) return;
    if (selectedBackend === 'codex') {
      const codex = settings.backends.codex;
      updateCodex({ executionMode, codexExecutable: codex.executionMode === executionMode ? codex.codexExecutable : 'codex' });
      return;
    }
    updateClaude({ executionMode, claudeExecutable: executionMode === 'wsl'
      ? (claude?.executionMode === 'wsl' ? claude.claudeExecutable : '/usr/bin/claude')
      : (claude?.executionMode === 'native' ? claude.claudeExecutable : '') });
  };

  const persistSettings = async (value: AgentSettingsContainer) => {
    const updated = await window.hexestra.invoke<AgentSettingsContainer>('agent:settings:update', value);
    setSettings(updated);
    setSaved(updated);
    setModelRefreshKey((current) => current + 1);
    await useChatStore.getState().refreshStatus();
  };

  const save = async () => {
    if (!settings) return;
    setBusy('save');
    setError(null);
    try {
      await persistSettings(settings);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!settings) return;
    setBusy('test');
    setError(null);
    try {
      if (selectedBackend === 'codex') {
        if (JSON.stringify(settings) !== JSON.stringify(saved)) await persistSettings(settings);
        await diagnoseCodex();
      } else {
        setDiagnostic(await window.hexestra.invoke<AgentConnectionDiagnostic>('agent:settings:test', settings));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    setError(null);
    try {
      const value = await window.hexestra.invoke<AgentSettingsContainer>('agent:settings:reset');
      setSettings(value);
      setSaved(value);
      setSelectedBackend(value.defaultBackendId);
      setDiagnostic(null);
      setCodexDiagnostic(null);
      setModelRefreshKey((current) => current + 1);
      await useChatStore.getState().refreshStatus();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  if (!settings) {
    return <div className="flex h-full items-center justify-center text-xs text-text-muted">{t('settings.loadingAgent')}</div>;
  }

  const claudeSettings = settings.backends.claude;
  const codexSettings = settings.backends.codex;
  const selectedSettings = selectedBackend === 'codex' ? codexSettings : claudeSettings;
  const selectedModelOption = modelCatalog.models.find((model) => model.id === selectedSettings.model
    || model.resolvedModel === selectedSettings.model);
  const effortModelOption = selectedModelOption ?? (!selectedSettings.model
    ? modelCatalog.models.find((model) => selectedBackend === agentStatus.backendId
      && (model.id === agentStatus.model || model.resolvedModel === agentStatus.model))
      ?? modelCatalog.models.find((model) => model.isDefault || model.id === 'default')
      ?? modelCatalog.models[0]
    : undefined);
  const availableEfforts = effortModelOption?.supportedReasoningEfforts ?? [];
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-border-subtle pb-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{t('settings.agentConnection')}</h1>
            <p className="max-w-xl text-xs leading-5 text-text-muted">
              {t('settings.agentConnectionDescription')}
            </p>
          </div>
          <span className="rounded border border-border-subtle bg-panel px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted">
            {t('settings.global')}
          </span>
        </header>

        <SettingsSection title={t('settings.agentBackend')} description={t('settings.agentBackendHint')}>
          <div className="ui-segmented grid grid-cols-2" role="group" aria-label={t('settings.agentBackend')}>
            {(['claude', 'codex'] as const).map((backendId) => (
              <button key={backendId} type="button" aria-pressed={selectedBackend === backendId}
                className={cn('ui-segmented-item px-3 py-1.5 text-xs', selectedBackend === backendId && 'ui-segmented-item-active')}
                onClick={() => setSelectedBackend(backendId)}>{backendId === 'claude' ? 'Claude Code' : 'Codex'}</button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3 text-xs text-text-muted">
            <span>{settings.defaultBackendId === selectedBackend ? t('settings.defaultAgent') : t('settings.defaultAgentHint')}</span>
            {settings.defaultBackendId !== selectedBackend && <button type="button" className="ui-button ui-button-neutral"
              onClick={() => setSettings({ ...settings, defaultBackendId: selectedBackend })}>{t('settings.makeDefaultAgent')}</button>}
          </div>
        </SettingsSection>

        <SettingsSection title={t('settings.executionEnvironment')} description={t('settings.executionEnvironmentDescription')}>
          <div className={`grid gap-3 ${capabilities?.supportsWsl ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {capabilities?.supportsWsl && <RuntimeCard
                active={selectedSettings.executionMode === 'wsl'}
                icon="terminal"
                title="WSL"
                detail={t('settings.wslDetail')}
                onClick={() => updateMode('wsl')}
              />}
            <RuntimeCard
              active={selectedSettings.executionMode === 'native'}
              icon="code"
              title={t('settings.native')}
              detail={t('settings.nativeDetail')}
              onClick={() => updateMode('native')}
            />
          </div>
        </SettingsSection>

        {capabilities?.supportsWsl && selectedSettings.executionMode === 'wsl' && (
          <SettingsSection title={t('settings.wslRuntime')} description={t('settings.wslRuntimeHint')}>
            <Field label={t('settings.distribution')} hint={t('settings.distributionHint')}>
              <input
                aria-label={t('settings.wslDistribution')}
                value={selectedSettings.wslDistribution}
                onChange={(event) => selectedBackend === 'codex'
                  ? updateCodex({ wslDistribution: event.target.value }) : updateClaude({ wslDistribution: event.target.value })}
                className="settings-input"
                placeholder="Ubuntu-24.04"
              />
            </Field>
            <Field label={selectedBackend === 'codex' ? t('settings.codexExecutable') : t('settings.claudeExecutable')} hint={selectedBackend === 'codex'
              ? t('settings.codexWslExecutableHint') : t('settings.claudeWslExecutableHint')}>
              <input
                aria-label={selectedBackend === 'codex' ? t('settings.codexExecutable') : t('settings.claudeExecutable')}
                value={selectedBackend === 'codex' ? codexSettings.codexExecutable : claudeSettings.claudeExecutable}
                onChange={(event) => selectedBackend === 'codex'
                  ? updateCodex({ codexExecutable: event.target.value }) : updateClaude({ claudeExecutable: event.target.value })}
                className="settings-input font-mono"
                placeholder={selectedBackend === 'codex' ? 'codex' : '/usr/bin/claude'}
              />
            </Field>
          </SettingsSection>
        )}

        {selectedSettings.executionMode === 'native' && (
          <SettingsSection title={t('settings.nativeRuntime')} description={selectedBackend === 'codex'
            ? t('settings.codexNativeRuntimeHint') : t('settings.claudeNativeRuntimeHint')}>
            <Field label={selectedBackend === 'codex' ? t('settings.codexExecutable') : t('settings.claudeExecutable')} hint={selectedBackend === 'codex'
              ? t('settings.codexNativeExecutableHint') : t('settings.claudeNativeExecutableHint')}>
              <input
                aria-label={selectedBackend === 'codex' ? t('settings.codexExecutable') : t('settings.claudeExecutable')}
                value={selectedBackend === 'codex' ? codexSettings.codexExecutable : claudeSettings.claudeExecutable}
                onChange={(event) => selectedBackend === 'codex'
                  ? updateCodex({ codexExecutable: event.target.value }) : updateClaude({ claudeExecutable: event.target.value })}
                className="settings-input font-mono"
                placeholder={selectedBackend === 'codex' ? 'codex' : t('settings.autoDiscoverClaude')}
              />
            </Field>
          </SettingsSection>
        )}

        <SettingsSection title={t('settings.agentOptions')} description={t('settings.agentOptionsHint')}>
          <Field label={t('settings.model')} hint={selectedBackend === 'codex' ? t('settings.codexModelHint') : t('settings.claudeModelHint')}>
            <select
              aria-label={selectedBackend === 'codex' ? t('settings.codexModel') : t('settings.claudeModel')}
              value={selectedModelOption?.id ?? selectedSettings.model ?? ''}
              disabled={modelRuntimeChanged}
              onChange={(event) => {
                const model = event.target.value || null;
                const option = modelCatalog.models.find((item) => item.id === model)
                  ?? (!model ? effortModelOption : undefined);
                const reasoningEffort = option?.supportedReasoningEfforts?.includes(selectedSettings.reasoningEffort!)
                  ? selectedSettings.reasoningEffort : null;
                if (selectedBackend === 'codex') updateCodex({ model, reasoningEffort });
                else updateClaude({ model, reasoningEffort });
              }}
              className="settings-input"
            >
              <option value="">{t('settings.defaultModel')}</option>
              {selectedSettings.model && !selectedModelOption &&
                <option value={selectedSettings.model} disabled>{selectedSettings.model} · {t('agent.modelUnavailable')}</option>}
              {modelCatalog.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select>
            {modelCatalog.loading && <p className="mt-1 text-[11px] text-text-muted">{t('agent.loadingModels')}</p>}
            {modelRuntimeChanged && <p className="mt-1 text-[11px] text-text-muted">{t('settings.saveRuntimeForModels')}</p>}
            {modelCatalog.error && <p className="mt-1 text-[11px] text-status-error">{t('agent.modelsError')}: {modelCatalog.error}</p>}
            {!modelRuntimeChanged && !modelCatalog.loading && !modelCatalog.error && modelCatalog.models.length === 0 &&
              <p className="mt-1 text-[11px] text-text-muted">{t('agent.noModels')}</p>}
          </Field>
          <Field label={t('agent.effort')} hint={t('agent.effortHint')}>
            <ReasoningEffortSlider value={selectedSettings.reasoningEffort ?? null} efforts={availableEfforts}
              defaultEffort={effortModelOption?.defaultReasoningEffort}
              descriptions={effortModelOption?.reasoningEffortDescriptions}
              disabled={modelRuntimeChanged || !effortModelOption}
              onCommit={(reasoningEffort) => {
                if (selectedBackend === 'codex') updateCodex({ reasoningEffort });
                else updateClaude({ reasoningEffort });
              }} />
            {!effortModelOption && <p className="mt-1 text-[11px] text-text-muted">{t('agent.chooseModelForEffort')}</p>}
          </Field>
          {selectedBackend === 'claude' && <div>
            <p className="mb-2 text-xs font-medium text-text-secondary">{t('settings.settingSources')}</p>
            <div className="grid grid-cols-3 gap-2">
              {SOURCES.map((source) => {
                const checked = claudeSettings.settingSources.includes(source.id);
                return (
                  <label key={source.id} className="flex cursor-pointer items-start gap-2 rounded border border-border-subtle bg-panel/50 p-2.5 hover:border-border-strong">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? claudeSettings.settingSources.filter((item) => item !== source.id)
                          : [...claudeSettings.settingSources, source.id];
                        if (next.length) updateClaude({ settingSources: next });
                      }}
                      className="mt-0.5 accent-[rgb(var(--app-color-accent-blue))]"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs text-text-secondary">{source.label}</span>
                      <span className="block truncate font-mono text-[11px] text-text-muted">{source.detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>}
        </SettingsSection>

        {selectedBackend === 'claude' && diagnostic && <DiagnosticCard diagnostic={diagnostic} />}
        {selectedBackend === 'codex' && codexDiagnostic && <CodexDiagnosticCard diagnostic={codexDiagnostic} />}
        {error && <DismissibleNotice tone="error" className="mb-4 text-xs" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}

        <footer className="flex items-center justify-between border-t border-border-subtle pt-4">
          <button onClick={() => void reset()} disabled={busy !== null} className="ui-button ui-button-neutral border-transparent bg-transparent text-text-muted hover:bg-raised hover:text-text-secondary">
            {t('settings.resetDefaults')}
          </button>
          <div className="flex gap-2">
            <button onClick={() => void test()} disabled={busy !== null} className="ui-button ui-button-neutral hover:border-accent-blue/40 hover:text-accent-blue">
              {busy === 'test' ? t('settings.testing') : selectedBackend === 'codex' && dirty ? t('settings.saveAndTest') : t('settings.testConnection')}
            </button>
            <button onClick={() => void save()} disabled={busy !== null || !dirty} className="ui-button ui-button-primary">
              {busy === 'save' ? t('settings.saving') : dirty ? t('settings.saveChanges') : t('common.saved')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function TrafficRuntimeSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<MitmproxyRuntimeDiagnostic | null>(null);
  const [busy, setBusy] = useState<'detect' | 'choose' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (channel: typeof TRAFFIC_IPC.RUNTIME_GET | typeof TRAFFIC_IPC.RUNTIME_DETECT = TRAFFIC_IPC.RUNTIME_GET) => {
    setBusy('detect');
    setError(null);
    try {
      setStatus(await window.hexestra.invoke<MitmproxyRuntimeDiagnostic>(channel));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const choose = async () => {
    setBusy('choose');
    setError(null);
    try {
      setStatus(await window.hexestra.invoke<MitmproxyRuntimeDiagnostic>(TRAFFIC_IPC.RUNTIME_CHOOSE));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    setError(null);
    try {
      setStatus(await window.hexestra.invoke<MitmproxyRuntimeDiagnostic>(TRAFFIC_IPC.RUNTIME_UPDATE, null));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const tone = status?.status === 'ready' ? 'text-accent-green' : 'text-severity-critical';
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-border-subtle pb-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{t('settings.trafficRuntime')}</h1>
            <p className="max-w-xl text-xs leading-5 text-text-muted">{t('settings.trafficRuntimeDescription')}</p>
          </div>
          <span className="rounded border border-border-subtle bg-panel px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted">{t('settings.global')}</span>
        </header>
        <SettingsSection title={t('settings.trafficRuntimeStatus')} description={t('settings.trafficRuntimeStatusDescription')}>
          <div className="rounded border border-border-subtle bg-panel/50 p-3">
            <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${status?.status === 'ready' ? 'bg-accent-green' : 'bg-severity-critical'}`} /><span className={`text-xs font-semibold uppercase ${tone}`}>{status?.status ?? t('common.loading')}</span></div>
            <dl className="mt-3 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 text-[11px]"><dt className="text-text-muted">{t('settings.trafficRuntimePath')}</dt><dd className="break-all font-mono text-text-secondary">{status?.executablePath ?? '???'}</dd><dt className="text-text-muted">{t('settings.trafficRuntimeVersion')}</dt><dd className="font-mono text-text-secondary">{status?.version ?? '???'}</dd><dt className="text-text-muted">{t('settings.trafficRuntimeSource')}</dt><dd className="text-text-secondary">{status?.source ?? '???'}</dd></dl>
            {status?.error && <p className="mt-3 text-[11px] leading-4 text-severity-critical">{status.error}</p>}
          </div>
        </SettingsSection>
        <SettingsSection title={t('settings.trafficRuntimeActions')} description={t('settings.trafficRuntimeActionsDescription')}>
          <div className="flex flex-wrap gap-2"><button onClick={() => void refresh(TRAFFIC_IPC.RUNTIME_DETECT)} disabled={busy !== null} className="ui-button ui-button-neutral hover:border-accent-blue/40 hover:text-accent-blue">{t('settings.trafficRuntimeRedetect')}</button><button onClick={() => void choose()} disabled={busy !== null} className="ui-button ui-button-primary">{t('settings.trafficRuntimeChoose')}</button><button onClick={() => void reset()} disabled={busy !== null} className="ui-button ui-button-neutral border-transparent bg-transparent text-text-muted hover:bg-raised hover:text-text-secondary">{t('settings.trafficRuntimeAutomatic')}</button></div>
          <p className="text-[11px] leading-4 text-text-muted">{t('settings.trafficRuntimeInstallHint')} <a className="text-accent-blue hover:underline" href="https://docs.mitmproxy.org/stable/overview/installation/" target="_blank" rel="noreferrer">mitmproxy installation guide</a></p>
        </SettingsSection>
        {error && <DismissibleNotice tone="error" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
      </div>
    </div>
  );
}

function GeneralSettings() {
  const { language, setLanguage, t } = useI18n();
  const { themePreference, setTheme } = useAppPreferences();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-border-subtle pb-5">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{t('settings.interface')}</h1>
            <p className="max-w-xl text-xs leading-5 text-text-muted">{t('settings.interfaceDescription')}</p>
          </div>
          <span className="rounded border border-border-subtle bg-panel px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted">{t('settings.global')}</span>
        </header>
        <SettingsSection title={t('settings.language')} description={t('settings.languageHint')}>
          <select
            aria-label={t('settings.language')}
            className="settings-input"
            value={language}
            onChange={(event) => {
              setError(null);
              void setLanguage(event.target.value as 'en' | 'zh-CN').catch((reason) => setError(String(reason)));
            }}
          >
            <option value="en">{t('settings.languageEnglish')}</option>
            <option value="zh-CN">{t('settings.languageChinese')}</option>
          </select>
        </SettingsSection>
        <SettingsSection title={t('settings.theme')} description={t('settings.themeHint')}>
          <div className="ui-segmented grid grid-cols-3" role="group" aria-label={t('settings.theme')}>
            {([
              ['system', t('settings.themeSystem')],
              ['dark', t('settings.themeDark')],
              ['light', t('settings.themeLight')],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={themePreference === value}
                className={cn('ui-segmented-item px-3 py-1.5 text-xs', themePreference === value && 'ui-segmented-item-active')}
                onClick={() => {
                  setError(null);
                  void setTheme(value).catch((reason) => setError(String(reason)));
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </SettingsSection>
        {error && <DismissibleNotice tone="error" onDismiss={() => setError(null)}>{error}</DismissibleNotice>}
      </div>
    </div>
  );
}

function SettingsPageButton({ active, icon, label, onClick }: { active: boolean; icon: 'settings' | 'terminal' | 'activity' | 'network' | 'sparkles' | 'server' | 'file' | 'shield' | 'code'; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn('flex min-h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus', active ? 'border-accent-blue text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}

function isSettingsPage(value: unknown): value is SettingsPage {
  return value === 'general' || value === 'shortcuts' || value === 'connection' || value === 'traffic' || value === 'proxy' || value === 'burp' || value === 'skills' || value === 'mcp' || value === 'instructions' || value === 'tools';
}

function normalizeSettingsPayload(value: AgentSettingsContainer | AgentConnectionSettings): AgentSettingsContainer {
  const codex = { version: 1 as const, executionMode: 'native' as const, wslDistribution: 'Ubuntu-24.04', codexExecutable: 'codex', model: null, reasoningEffort: null };
  if ('backends' in value) return { ...value, backends: { ...value.backends, codex: value.backends.codex ?? codex } };
  return {
    version: 2,
    defaultBackendId: 'claude',
    backends: { claude: value, codex },
  };
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-[11px] leading-4 text-text-muted">{description}</p>
      </div>
      <Surface className="p-4">
        <div className="space-y-4">{children}</div>
      </Surface>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-secondary">{label}</span>
      <span className="mb-1.5 mt-0.5 block text-[11px] leading-4 text-text-muted">{hint}</span>
      {children}
    </label>
  );
}

function modelRuntimeKey(settings: AgentConnectionSettings | CodexConnectionSettings) {
  return JSON.stringify([settings.executionMode, settings.wslDistribution,
    'codexExecutable' in settings ? settings.codexExecutable : settings.claudeExecutable,
    'settingSources' in settings ? settings.settingSources : null]);
}

function RuntimeCard({ active, icon, title, detail, onClick }: { active: boolean; icon: 'terminal' | 'code'; title: string; detail: string; onClick: () => void }) {
  return (
    <button aria-label={title} aria-pressed={active} onClick={onClick} className={cn('flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-focus', active ? 'border-accent-blue/50 bg-accent-blue/10' : 'border-border-subtle bg-panel/50 hover:border-border-strong')}>
      <Icon name={icon} size={16} className={active ? 'text-accent-blue' : 'text-text-muted'} />
      <span>
        <span className="block text-xs font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{detail}</span>
      </span>
    </button>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: AgentConnectionDiagnostic }) {
  return (
    <section className={cn('mb-5 rounded-lg border p-3', diagnostic.ok ? 'border-accent-green/25 bg-accent-green/5' : 'border-severity-critical/30 bg-severity-critical/5')} aria-label="Connection diagnostic">
      <div className="mb-2 flex items-center gap-2">
        <Icon name={diagnostic.ok ? 'check' : 'alert'} size={14} className={diagnostic.ok ? 'text-accent-green' : 'text-severity-critical'} />
        <span className="text-xs font-semibold text-text-secondary">{diagnostic.ok ? 'Connection ready' : 'Connection needs attention'}</span>
        {diagnostic.claudeVersion && <span className="ml-auto font-mono text-[11px] text-text-muted">{diagnostic.claudeVersion}</span>}
      </div>
      <div className="mb-2 grid gap-1 text-[11px] text-text-muted sm:grid-cols-3">
        <span>Path: <span className="font-mono text-text-secondary">{diagnostic.executablePath ?? 'not found'}</span></span>
        <span>Source: <span className="font-mono text-text-secondary">{diagnostic.executableSource}</span></span>
        {!diagnostic.ok && diagnostic.installGuidance && <span>{diagnostic.installGuidance}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {diagnostic.checks.map((check) => (
          <div key={check.id} className="rounded border border-border-subtle/70 bg-panel/50 p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', check.status === 'pass' ? 'bg-accent-green' : check.status === 'warning' ? 'bg-severity-medium' : check.status === 'skipped' ? 'bg-text-muted' : 'bg-severity-critical')} />
              <span className="text-[11px] font-medium text-text-secondary">{check.label}</span>
            </div>
            <p className="break-words font-mono text-[11px] leading-4 text-text-muted">{check.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CodexDiagnosticCard({ diagnostic }: { diagnostic: CodexDiagnostic }) {
  const { t } = useI18n();
  const ready = diagnostic.available && diagnostic.authenticated && diagnostic.bridgeReady;
  const checks = [
    { label: t('settings.codexRuntime'), detail: diagnostic.lastError ?? diagnostic.runtimeLabel, ok: diagnostic.available },
    { label: t('settings.codexAccount'), detail: diagnostic.authenticated ? t('settings.signedIn') : t('settings.signInRequired'), ok: Boolean(diagnostic.authenticated) },
    { label: t('settings.projectToolBridge'), detail: diagnostic.bridgeError ?? (diagnostic.bridgeReady ? t('settings.connected') : t('settings.unavailable')), ok: Boolean(diagnostic.bridgeReady) },
    { label: t('settings.skillsAndMcp'), detail: diagnostic.skillError ?? diagnostic.mcpError
      ?? `${diagnostic.skills == null ? t('settings.unavailable') : t('settings.skillsCount', { count: diagnostic.skills })} · ${diagnostic.mcpServers == null ? t('settings.unavailable') : t('settings.mcpCount', { count: diagnostic.mcpServers })}`,
    ok: !diagnostic.skillError && !diagnostic.mcpError && diagnostic.skills != null && diagnostic.mcpServers != null },
  ];
  return (
    <section className={cn('mb-5 rounded-lg border p-3', ready ? 'border-accent-green/25 bg-accent-green/5' : 'border-severity-critical/30 bg-severity-critical/5')} aria-label={t('settings.connectionDiagnostic')}>
      <div className="mb-3 flex items-center gap-2">
        <Icon name={ready ? 'check' : 'alert'} size={14} className={ready ? 'text-accent-green' : 'text-severity-critical'} />
        <span className="text-xs font-semibold text-text-secondary">{ready ? t('settings.connectionReady') : t('settings.connectionNeedsAttention')}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map((check) => <div key={check.label} className="rounded border border-border-subtle/70 bg-panel/50 p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', check.ok ? 'bg-accent-green' : 'bg-severity-critical')} />
            <span className="text-[11px] font-medium text-text-secondary">{check.label}</span>
          </div>
          <p className="break-words font-mono text-[11px] leading-4 text-text-muted">{check.detail}</p>
        </div>)}
      </div>
    </section>
  );
}
