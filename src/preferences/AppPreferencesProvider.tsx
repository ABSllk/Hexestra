import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  APP_SETTINGS_IPC,
  type AppLanguage,
  type AppSettings,
  type AppThemePreference,
} from '@electron/contracts/app-settings';

export type ResolvedTheme = 'dark' | 'light';

const DEFAULT_SETTINGS: AppSettings = {
  version: 3,
  language: 'en',
  theme: 'system',
  mitmdumpPath: null,
};

interface AppPreferencesValue {
  settings: AppSettings;
  language: AppLanguage;
  themePreference: AppThemePreference;
  resolvedTheme: ResolvedTheme;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setTheme: (theme: AppThemePreference) => Promise<void>;
}

const AppPreferencesContext = createContext<AppPreferencesValue>({
  settings: DEFAULT_SETTINGS,
  language: DEFAULT_SETTINGS.language,
  themePreference: DEFAULT_SETTINGS.theme,
  resolvedTheme: 'dark',
  setLanguage: async () => undefined,
  setTheme: async () => undefined,
});

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [systemIsDark, setSystemIsDark] = useState(readSystemIsDark);

  useEffect(() => {
    if (!window.hexestra) return;
    let active = true;
    void window.hexestra.invoke<unknown>(APP_SETTINGS_IPC.GET)
      .then((value) => active && setSettings(normalizeRendererSettings(value)))
      .catch(() => undefined);
    const remove = window.hexestra.on(APP_SETTINGS_IPC.CHANGED, (value: unknown) => {
      if (active) setSettings(normalizeRendererSettings(value));
    });
    return () => {
      active = false;
      remove?.();
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemIsDark(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);

  const resolvedTheme: ResolvedTheme = settings.theme === 'system'
    ? (systemIsDark ? 'dark' : 'light')
    : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setLanguage = useCallback(async (language: AppLanguage) => {
    const previous = settings;
    setSettings((current) => ({ ...current, language }));
    try {
      const saved = await window.hexestra.invoke<unknown>(APP_SETTINGS_IPC.UPDATE, { language });
      setSettings(normalizeRendererSettings(saved));
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  }, [settings]);

  const setTheme = useCallback(async (theme: AppThemePreference) => {
    const previous = settings;
    setSettings((current) => ({ ...current, theme }));
    try {
      const saved = await window.hexestra.invoke<unknown>(APP_SETTINGS_IPC.UPDATE, { theme });
      setSettings(normalizeRendererSettings(saved));
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  }, [settings]);

  const value = useMemo<AppPreferencesValue>(() => ({
    settings,
    language: settings.language,
    themePreference: settings.theme,
    resolvedTheme,
    setLanguage,
    setTheme,
  }), [resolvedTheme, setLanguage, setTheme, settings]);

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  return useContext(AppPreferencesContext);
}

export function normalizeRendererSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    version: 3,
    language: record.language === 'zh-CN' ? 'zh-CN' : 'en',
    theme: isThemePreference(record.theme) ? record.theme : 'system',
    mitmdumpPath: typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
      ? record.mitmdumpPath.trim()
      : null,
  };
}

function isThemePreference(value: unknown): value is AppThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

function readSystemIsDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}
