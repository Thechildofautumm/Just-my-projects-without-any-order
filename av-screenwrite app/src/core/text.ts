/** Подсчёт слов и склонения. Поведение перенесено из HTML-прототипа. */

let WORD_RE: RegExp;
try {
  // Слово = буквы/цифры (любой язык), внутри допускаются дефис и апостроф: «кто-то», «don't».
  WORD_RE = new RegExp("[\\p{L}\\p{N}]+(?:[-'’][\\p{L}\\p{N}]+)*", 'gu');
} catch {
  WORD_RE = /[A-Za-zА-яЁё0-9]+(?:[-'’][A-Za-zА-яЁё0-9]+)*/g;
}

/** Слова в тексте диктора. Всё в (круглых) и [квадратных] скобках не считается. */
export function countWords(text: string): number {
  const clean = text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const m = clean.match(WORD_RE);
  return m ? m.length : 0;
}

export type PluralCategory = 'one' | 'few' | 'many' | 'other';

/**
 * Категория множественного числа по правилам языка (ru, pl, en…): 1 строка, 2 строки, 5 строк.
 * Использует встроенный Intl.PluralRules — словари не нужны.
 */
export function pluralCategory(lang: string, n: number): PluralCategory {
  try {
    return new Intl.PluralRules(lang).select(Math.abs(n)) as PluralCategory;
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}
