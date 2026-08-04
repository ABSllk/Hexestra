import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_IPC } from '@electron/contracts/app-settings';
import { I18nProvider, useI18n } from './I18nProvider';

function Harness() {
  const { language, setLanguage, t } = useI18n();
  return <div><span>{language}</span><strong>{t('common.settings')}</strong><button onClick={() => void setLanguage('zh-CN')}>Switch</button></div>;
}

describe('I18nProvider', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (channel: string, patch?: { language?: string }) => {
      if (channel === APP_SETTINGS_IPC.GET) return { version: 1, language: 'en' };
      if (channel === APP_SETTINGS_IPC.UPDATE) return { version: 1, language: patch?.language };
      return undefined;
    });
    Object.defineProperty(window, 'hexestra', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined), once: vi.fn(), send: vi.fn() },
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
});
