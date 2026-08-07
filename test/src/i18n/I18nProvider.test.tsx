import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_IPC } from '@electron/contracts/app-settings';
import { I18nProvider, useAppPreferences, useI18n } from '@/i18n/I18nProvider';

function Harness() {
  const { language, setLanguage, t } = useI18n();
  return <div><span>{language}</span><strong>{t('common.settings')}</strong><button onClick={() => void setLanguage('zh-CN')}>Switch</button></div>;
}

function ThemeHarness() {
  const { themePreference, resolvedTheme, setTheme } = useAppPreferences();
  return <div><span>{themePreference}:{resolvedTheme}</span><button onClick={() => void setTheme('dark')}>Dark</button></div>;
}

describe('I18nProvider', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (channel: string, patch?: { language?: string; theme?: 'system' | 'dark' | 'light' }) => {
      if (channel === APP_SETTINGS_IPC.GET) return { version: 3, language: 'en', theme: 'system', mitmdumpPath: null };
      if (channel === APP_SETTINGS_IPC.UPDATE) return { version: 3, language: patch?.language ?? 'en', theme: patch?.theme ?? 'system', mitmdumpPath: null };
      return undefined;
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

  it('changes the interface immediately and persists the language', async () => {
    render(<I18nProvider><Harness /></I18nProvider>);
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(await screen.findByText('设置')).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, { language: 'zh-CN' }));
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('resolves system theme and persists an explicit theme preference', async () => {
    render(<I18nProvider><ThemeHarness /></I18nProvider>);
    expect(await screen.findByText('system:light')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(await screen.findByText('dark:dark')).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(APP_SETTINGS_IPC.UPDATE, { theme: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
