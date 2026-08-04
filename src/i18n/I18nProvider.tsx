import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { APP_SETTINGS_IPC, type AppLanguage, type AppSettings } from '@electron/contracts/app-settings';
import { en, zhCN, type TranslationKey } from './translations';

interface I18nValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: async () => undefined,
  t: (key) => en[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<AppSettings>(APP_SETTINGS_IPC.GET)
      .then((settings) => active && setLanguageState(settings.language))
      .catch(() => undefined);
    const remove = window.hexestra.on(APP_SETTINGS_IPC.CHANGED, (value: unknown) => {
      const settings = value as AppSettings;
      if (settings?.language === 'en' || settings?.language === 'zh-CN') setLanguageState(settings.language);
    });
    return () => {
      active = false;
      remove();
    };
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    const previous = language;
    setLanguageState(next);
    try {
      const saved = await window.hexestra.invoke<AppSettings>(APP_SETTINGS_IPC.UPDATE, { language: next });
      setLanguageState(saved.language);
    } catch (error) {
      setLanguageState(previous);
      throw error;
    }
  }, [language]);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, values) => interpolate((language === 'zh-CN' ? zhCN : en)[key], values),
  }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

function interpolate(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? `{${key}}`));
}
