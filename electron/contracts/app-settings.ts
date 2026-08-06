export const APP_SETTINGS_IPC = {
  GET: 'app:settings:get',
  UPDATE: 'app:settings:update',
  CHANGED: 'app:settings:changed',
} as const;

export type AppLanguage = 'en' | 'zh-CN';
export type AppThemePreference = 'system' | 'dark' | 'light';

export interface AppSettings {
  version: 3;
  language: AppLanguage;
  theme: AppThemePreference;
  mitmdumpPath: string | null;
}

export interface AppSettingsPatch {
  language?: AppLanguage;
  theme?: AppThemePreference;
  mitmdumpPath?: string | null;
}
