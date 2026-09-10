import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  APP_SETTINGS_IPC,
  type AppLanguage,
  type AppSettings,
  type AppThemePreference,
} from '@electron/contracts/app-settings';
import {
  normalizeShortcutOverrides,
  type ShortcutCommandId,
  type ShortcutOverrides,
} from '@electron/contracts/shortcuts';
import type { PlatformCapabilities } from '@electron/contracts/platform';

export type ResolvedTheme = 'dark' | 'light';

const DEFAULT_SETTINGS: AppSettings = {
  version: 5,
  language: 'en',
  theme: 'system',
  mitmdumpPath: null,
  mihomoPath: null,
  shortcutOverrides: {},
};

interface AppPreferencesValue {
  settings: AppSettings;
  language: AppLanguage;
  themePreference: AppThemePreference;
  resolvedTheme: ResolvedTheme;
  platform: NodeJS.Platform;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setTheme: (theme: AppThemePreference) => Promise<void>;
  setShortcutOverride: (id: ShortcutCommandId, binding: string | null | undefined) => Promise<void>;
  resetShortcutOverrides: () => Promise<void>;
}

const AppPreferencesContext = createContext<AppPreferencesValue>({
  settings: DEFAULT_SETTINGS,
  language: DEFAULT_SETTINGS.language,
  themePreference: DEFAULT_SETTINGS.theme,
  resolvedTheme: 'dark',
  platform: 'win32',
  setLanguage: async () => undefined,
  setTheme: async () => undefined,
  setShortcutOverride: async () => undefined,
  resetShortcutOverrides: async () => undefined,
});

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [systemIsDark, setSystemIsDark] = useState(readSystemIsDark);
  const [platform, setPlatform] = useState<NodeJS.Platform>('win32');

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
    if (!window.hexestra) return;
    void window.hexestra.invoke<PlatformCapabilities>('app:getCapabilities')
      .then((value) => setPlatform(value.platform))
      .catch(() => undefined);
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

  const persistShortcutOverrides = useCallback(async (shortcutOverrides: ShortcutOverrides) => {
    const saved = await window.hexestra.invoke<unknown>(APP_SETTINGS_IPC.UPDATE, { shortcutOverrides });
    setSettings(normalizeRendererSettings(saved));
  }, []);

  const setShortcutOverride = useCallback(async (
    id: ShortcutCommandId,
    binding: string | null | undefined,
  ) => {
    const next = { ...settings.shortcutOverrides };
    if (binding === undefined) delete next[id];
    else next[id] = binding;
    await persistShortcutOverrides(next);
  }, [persistShortcutOverrides, settings.shortcutOverrides]);

  const resetShortcutOverrides = useCallback(async () => {
    await persistShortcutOverrides({});
  }, [persistShortcutOverrides]);

  const value = useMemo<AppPreferencesValue>(() => ({
    settings,
    language: settings.language,
    themePreference: settings.theme,
    resolvedTheme,
    platform,
    setLanguage,
    setTheme,
    setShortcutOverride,
    resetShortcutOverrides,
  }), [platform, resetShortcutOverrides, resolvedTheme, setLanguage, setShortcutOverride, setTheme, settings]);

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  return useContext(AppPreferencesContext);
}

export function normalizeRendererSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    version: 5,
    language: record.language === 'zh-CN' ? 'zh-CN' : 'en',
    theme: isThemePreference(record.theme) ? record.theme : 'system',
    mitmdumpPath: typeof record.mitmdumpPath === 'string' && record.mitmdumpPath.trim()
      ? record.mitmdumpPath.trim()
      : null,
    mihomoPath: typeof record.mihomoPath === 'string' && record.mihomoPath.trim()
      ? record.mihomoPath.trim()
      : null,
    shortcutOverrides: normalizeShortcutOverrides(record.shortcutOverrides),
  };
}

function isThemePreference(value: unknown): value is AppThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

function readSystemIsDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}
