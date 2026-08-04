export const APP_SETTINGS_IPC = {
  GET: 'app:settings:get',
  UPDATE: 'app:settings:update',
  CHANGED: 'app:settings:changed',
} as const;

export type AppLanguage = 'en' | 'zh-CN';

export interface AppSettings {
  version: 2;
  language: AppLanguage;
  mitmdumpPath: string | null;
}

export interface AppSettingsPatch {
  language?: AppLanguage;
  mitmdumpPath?: string | null;
}
