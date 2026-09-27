import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsTab } from '@/components/center-panel/tabs/SettingsTab';
import { I18nProvider } from '@/i18n';
import { APP_SETTINGS_IPC } from '@electron/contracts/app-settings';
import type { ShortcutOverrides } from '@electron/contracts/shortcuts';

const settings = {
  version: 2 as const,
  defaultBackendId: 'claude' as const,
  backends: { claude: {
    version: 1 as const,
    executionMode: 'wsl' as const,
    wslDistribution: 'Ubuntu-24.04',
    claudeExecutable: '/usr/bin/claude',
    model: null,
    settingSources: ['user', 'project', 'local'] as const,
  } },
};

describe('SettingsTab', () => {
  const invoke = vi.fn();
  let appSettings: { version: number; language: string; theme: 'system' | 'dark' | 'light'; mitmdumpPath: string | null; mihomoPath: string | null; shortcutOverrides: ShortcutOverrides } = { version: 5, language: 'en', theme: 'system', mitmdumpPath: null, mihomoPath: null, shortcutOverrides: {} };
  let rejectThemeUpdate = false;
  let claudeModel: string | null = null;

  beforeEach(() => {
    invoke.mockReset();
    appSettings = { version: 5, language: 'en', theme: 'system', mitmdumpPath: null, mihomoPath: null, shortcutOverrides: {} };
    rejectThemeUpdate = false;
    claudeModel = null;
    invoke.mockImplementation((channel: string, patch?: { language?: string; theme?: 'system' | 'dark' | 'light'; shortcutOverrides?: ShortcutOverrides }) => {
      if (channel === APP_SETTINGS_IPC.GET) return Promise.resolve({ ...appSettings });
      if (channel === APP_SETTINGS_IPC.UPDATE) {
        if (patch?.theme && rejectThemeUpdate) return Promise.reject(new Error('Unable to save theme'));
        appSettings = { ...appSettings, ...patch };
        return Promise.resolve({ ...appSettings });
      }
      if (channel === 'app:getCapabilities') return Promise.resolve({ platform: 'win32', arch: 'x64', supportsWsl: true, defaultShell: 'powershell.exe', usesNativeTitleBar: false });
      if (channel === 'agent:settings:get') return Promise.resolve({ ...settings, backends: {
        ...settings.backends, claude: { ...settings.backends.claude, model: claudeModel },
      } });
      if (channel === 'agent:models:list') return Promise.resolve(String(patch) === 'codex'
        ? [{ id: 'gpt-5.1-codex', displayName: 'GPT-5.1 Codex', isDefault: true,
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high'] }]
        : [{ id: 'sonnet', displayName: 'Claude Sonnet', resolvedModel: 'claude-sonnet-current', supportedReasoningEfforts: ['low', 'medium', 'high'] }]);
      if (channel === 'agent:settings:update') return Promise.resolve(patch);
      if (channel === 'agent:settings:test') return Promise.resolve({
        ok: true,
        checkedAt: '2026-07-20T00:00:00.000Z',
        executionMode: 'wsl',
        claudeVersion: '2.1.140 (Claude Code)',
        authenticated: true,
        authMethod: 'oauth_token',
        checks: [
          { id: 'runtime', label: 'WSL runtime', status: 'pass', detail: 'Ubuntu-24.04' },
          { id: 'claude', label: 'Claude Code', status: 'pass', detail: '2.1.140' },
          { id: 'authentication', label: 'Authentication', status: 'pass', detail: 'oauth_token' },
          { id: 'network', label: 'Provider network', status: 'pass', detail: 'api.anthropic.com is reachable from WSL' },
        ],
      });
      if (channel === 'codex:diagnose') return Promise.resolve({ available: true, authenticated: true,
        lastError: null, runtimeLabel: 'Native', skills: 3, mcpServers: 1, bridgeReady: true, bridgeError: null });
      return Promise.resolve(settings);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, media: '(prefers-color-scheme: dark)', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  it('loads WSL settings and renders successful connection diagnostics', async () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    expect(await screen.findByDisplayValue('Ubuntu-24.04')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/usr/bin/claude')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection ready')).toBeInTheDocument();
    expect(screen.getByText('2.1.140 (Claude Code)')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('agent:settings:test', expect.objectContaining({
      backends: expect.objectContaining({ claude: expect.objectContaining({ executionMode: 'wsl' }) }),
    }));
  });

  it('shows an existing Claude model ID through its runtime alias', async () => {
    claudeModel = 'claude-sonnet-current';
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    expect(await screen.findByRole('option', { name: 'Claude Sonnet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Claude model')).toHaveValue('sonnet');
    expect(screen.queryByText(/claude-sonnet-current ·/)).not.toBeInTheDocument();
  });

  it('switches to native mode without retaining the Linux executable', async () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    await screen.findByDisplayValue('Ubuntu-24.04');
    fireEvent.click(screen.getByRole('button', { name: 'Native' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Claude executable')).toHaveValue('');
    });
    expect(screen.getByLabelText('Claude model')).toBeDisabled();
    expect(screen.getByText('Save runtime settings to load its models')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('shows one backend at a time and saves the Codex draft before testing it', async () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    await screen.findByDisplayValue('/usr/bin/claude');

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.queryByLabelText('Claude executable')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Codex executable')).toHaveValue('codex');
    expect(screen.queryByRole('button', { name: 'Sign in with ChatGPT' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make default' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'GPT-5.1 Codex' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Codex model'), { target: { value: 'gpt-5.1-codex' } });
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.pointerUp(slider);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByText('3 Skills · 1 MCP servers')).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent:settings:update', expect.objectContaining({
      defaultBackendId: 'codex', backends: expect.objectContaining({ codex: expect.objectContaining({ model: 'gpt-5.1-codex', reasoningEffort: 'high' }) }),
    })));
    expect(invoke).toHaveBeenCalledWith('codex:diagnose', null);
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }));
    expect(screen.getByLabelText('Claude executable')).toHaveValue('/usr/bin/claude');
    expect(screen.queryByLabelText('Codex executable')).not.toBeInTheDocument();
  });

  it('localizes the shared backend settings in Chinese', async () => {
    render(<I18nProvider><SettingsTab /></I18nProvider>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Language' }), { target: { value: 'zh-CN' } });
    fireEvent.click(await screen.findByRole('button', { name: '连接' }));
    expect(await screen.findByRole('group', { name: '后端' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByLabelText('Codex 可执行文件')).toHaveValue('codex');
    expect(screen.getByRole('button', { name: '设为默认' })).toBeInTheDocument();
  });

  it('changes the global interface language from General settings', async () => {
    render(<I18nProvider><SettingsTab /></I18nProvider>);
    const language = await screen.findByRole('combobox', { name: 'Language' });
    fireEvent.change(language, { target: { value: 'zh-CN' } });
    expect(await screen.findByRole('combobox', { name: '语言' })).toHaveValue('zh-CN');
    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, { language: 'zh-CN' });
  });

  it('switches the global theme from General settings and persists the choice', async () => {
    render(<I18nProvider><SettingsTab /></I18nProvider>);

    const group = await screen.findByRole('group', { name: 'Theme' });
    const light = screen.getByRole('button', { name: 'Light' });
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(light);

    await waitFor(() => expect(light).toHaveAttribute('aria-pressed', 'true'));
    expect(group).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, { theme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('rolls the theme choice back and shows a dismissible error when persistence fails', async () => {
    rejectThemeUpdate = true;
    render(<I18nProvider><SettingsTab /></I18nProvider>);

    await screen.findByRole('group', { name: 'Theme' });
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));

    expect(await screen.findByText(/Unable to save theme/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('records, rejects conflicting, clears, and resets shortcut overrides', async () => {
    render(<I18nProvider><SettingsTab /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Shortcuts' }));

    const presentation = await screen.findByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+H/ });
    fireEvent.click(presentation);
    fireEvent.keyDown(presentation, { key: 'p', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, {
      shortcutOverrides: { 'presentation.toggle': 'Mod+Shift+P' },
    }));
    expect(await screen.findByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+P/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(appSettings.shortcutOverrides).toEqual({}));
    const defaultPresentation = await screen.findByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+H/ });
    fireEvent.click(defaultPresentation);
    fireEvent.keyDown(defaultPresentation, { key: 'p', ctrlKey: true, shiftKey: true });
    await screen.findByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+P/ });

    const remapped = screen.getByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+P/ });
    fireEvent.click(remapped);
    fireEvent.keyDown(remapped, { key: 't', ctrlKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Already assigned to New terminal.');

    fireEvent.keyDown(remapped, { key: 'Backspace' });
    await waitFor(() => expect(appSettings.shortcutOverrides['presentation.toggle']).toBeNull());
    expect(await screen.findByRole('button', { name: /Toggle presentation mode: Unassigned/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    await waitFor(() => expect(appSettings.shortcutOverrides).toEqual({}));
    expect(await screen.findByRole('button', { name: /Toggle presentation mode: Ctrl\+Shift\+H/ })).toBeInTheDocument();
  });
});
