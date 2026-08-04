import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsTab } from './SettingsTab';
import { I18nProvider } from '@/i18n';
import { APP_SETTINGS_IPC } from '@electron/contracts/app-settings';

const settings = {
  version: 1 as const,
  executionMode: 'wsl' as const,
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '/usr/bin/claude',
  model: null,
  settingSources: ['user', 'project', 'local'] as const,
};

describe('SettingsTab', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((channel: string, patch?: { language?: string }) => {
      if (channel === APP_SETTINGS_IPC.GET) return Promise.resolve({ version: 2, language: 'en', mitmdumpPath: null });
      if (channel === APP_SETTINGS_IPC.UPDATE) return Promise.resolve({ version: 2, language: patch?.language, mitmdumpPath: null });
      if (channel === 'app:getCapabilities') return Promise.resolve({ platform: 'win32', arch: 'x64', supportsWsl: true, defaultShell: 'powershell.exe', usesNativeTitleBar: false });
      if (channel === 'agent:settings:get') return Promise.resolve(settings);
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
      return Promise.resolve(settings);
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
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
    expect(invoke).toHaveBeenCalledWith('agent:settings:test', expect.objectContaining({ executionMode: 'wsl' }));
  });

  it('switches to native mode without retaining the Linux executable', async () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    await screen.findByDisplayValue('Ubuntu-24.04');
    fireEvent.click(screen.getByRole('button', { name: 'Native' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Claude executable')).toHaveValue('');
    });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('changes the global interface language from General settings', async () => {
    render(<I18nProvider><SettingsTab /></I18nProvider>);
    const language = await screen.findByRole('combobox', { name: 'Language' });
    fireEvent.change(language, { target: { value: 'zh-CN' } });
    expect(await screen.findByRole('combobox', { name: '语言' })).toHaveValue('zh-CN');
    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, { language: 'zh-CN' });
  });
});
