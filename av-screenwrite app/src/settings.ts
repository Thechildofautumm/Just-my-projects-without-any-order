/** Настройки приложения. Хранятся в localStorage webview — в Tauri это папка данных приложения. */
import { isLang, type Lang } from './i18n';

const KEY = 'av-scenariy-settings-v1';

export type Paper = 'a4' | 'letter';

export interface Settings {
  language: Lang;
  fontSize: number;
  paper: Paper;
}

export const DEFAULT_FONT_SIZE = 15;
export const clampFont = (n: number) => Math.min(32, Math.max(10, Math.round(n)));

const defaults = (): Settings => ({ language: 'ru', fontSize: DEFAULT_FONT_SIZE, paper: 'a4' });

export function loadSettings(): Settings {
  const s = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    if (isLang(raw.language)) s.language = raw.language;
    if (typeof raw.fontSize === 'number') s.fontSize = clampFont(raw.fontSize);
    if (raw.paper === 'letter') s.paper = 'letter';
  } catch {
    /* настройки по умолчанию */
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ничего: настройки просто не сохранятся */
  }
  return next;
}
