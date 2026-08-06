import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { AppPreferencesProvider, useAppPreferences } from '@/preferences/AppPreferencesProvider';
import { en, zhCN, type TranslationKey } from './translations';

interface I18nValue {
  language: 'en' | 'zh-CN';
  setLanguage: (language: 'en' | 'zh-CN') => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: async () => undefined,
  t: (key) => en[key],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  return <AppPreferencesProvider><I18nMessagesProvider>{children}</I18nMessagesProvider></AppPreferencesProvider>;
}

function I18nMessagesProvider({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useAppPreferences();

  useEffect(() => {
    document.documentElement.lang = language;
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

export { useAppPreferences } from '@/preferences/AppPreferencesProvider';

function interpolate(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? `{${key}}`));
}
