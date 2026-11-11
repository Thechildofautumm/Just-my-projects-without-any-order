import ru from './ru.json';
import en from './en.json';
import pl from './pl.json';
import { pluralCategory, type PluralCategory } from '../core/text';

type Entry = string | Record<PluralCategory, string>;
type Dict = Record<string, Entry>;

export type Lang = 'ru' | 'en' | 'pl';

/** Новый язык: добавить <код>.json с теми же ключами и записать его сюда. */
const DICTS: Record<Lang, Dict> = { ru: ru as Dict, en: en as Dict, pl: pl as Dict };

/** Названия языков пишутся на самих языках — их нужно понимать и тому, кто не читает текущий. */
export const LANGUAGES: { code: Lang; name: string; locale: string }[] = [
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL' },
];

let lang: Lang = 'ru';

export const isLang = (v: unknown): v is Lang => v === 'ru' || v === 'en' || v === 'pl';
export const getLanguage = (): Lang => lang;
export const getLocale = (): string => LANGUAGES.find((l) => l.code === lang)!.locale;

export function setLanguage(code: Lang): void {
  lang = code;
  document.documentElement.lang = code;
}

/** Строка по ключу; `{name}` заменяется значением из params. Нет перевода — берётся русский, потом ключ. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const v = DICTS[lang][key] ?? DICTS.ru[key];
  if (typeof v !== 'string') return key;
  return v.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

/** Слово в нужной форме числа: `tp('unit.row', 3)` → «строки» / "rows" / „wiersze”. */
export function tp(key: string, n: number): string {
  const v = DICTS[lang][key] ?? DICTS.ru[key];
  if (!v || typeof v === 'string') return key;
  return v[pluralCategory(lang, n)] ?? v.other ?? key;
}

/** Проставить подписи в статической разметке (data-i18n*). */
export function applyStaticTexts(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
}

/** Подписи для PDF и Word на текущем языке. */
export function exportLabels() {
  return {
    untitled: t('app.untitled'),
    author: t('export.author'),
    date: t('export.date'),
    duration: t('export.duration'),
    num: t('export.num'),
    video: t('export.video'),
    audio: t('export.audio'),
    time: t('export.time'),
  };
}
