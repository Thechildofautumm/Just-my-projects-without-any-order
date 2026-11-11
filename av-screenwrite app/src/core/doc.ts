/** Модель документа. Все структуры неизменяемы: правка создаёт новый объект. */
import { countWords } from './text';
import type { Run } from './richtext';

export const DEFAULT_WPM = 130;
export const MIN_WPM = 40;
export const MAX_WPM = 400;

export type Extra = Readonly<Record<string, unknown>>;

export interface Row {
  readonly id: string;
  readonly video: string;
  readonly audio: string;
  /** Секунды, заданные вручную; null — считать по тексту. */
  readonly time: number | null;
  /** Оформление текста (жирный, курсив, …) для колонок «Видео» и «Звук». */
  readonly videoFmt: readonly Run[];
  readonly audioFmt: readonly Run[];
  /** Неизвестные поля из файла — сохраняются и записываются обратно. */
  readonly extra: Extra;
}

export interface Doc {
  readonly title: string;
  readonly author: string;
  readonly date: string;
  readonly wpm: number;
  /** true — колонка «Звук» слева от «Видео». */
  readonly swap: boolean;
  readonly rows: readonly Row[];
  readonly extra: Extra;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

export function createRow(init: Partial<Omit<Row, 'extra'>> = {}): Row {
  return { id: newId(), video: '', audio: '', time: null, videoFmt: [], audioFmt: [], extra: {}, ...init };
}

export function validWpm(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_WPM && v <= MAX_WPM;
}

export function createDoc(opts: { date?: string; wpm?: number; rows?: number } = {}): Doc {
  const n = opts.rows ?? 3;
  return {
    title: '',
    author: '',
    date: opts.date ?? '',
    wpm: validWpm(opts.wpm) ? opts.wpm : DEFAULT_WPM,
    swap: false,
    rows: Array.from({ length: n }, () => createRow()),
    extra: {},
  };
}

/* ---------- Хронометраж ---------- */

// Строки неизменяемы, поэтому число слов можно кэшировать по объекту строки.
const wordCache = new WeakMap<Row, number>();

export function rowWords(row: Row): number {
  let w = wordCache.get(row);
  if (w === undefined) {
    w = countWords(row.audio);
    wordCache.set(row, w);
  }
  return w;
}

/** Время по тексту: ceil(слова × 60 / темп). Без слов — 0. */
export function autoSeconds(row: Row, wpm: number): number {
  const w = rowWords(row);
  return w ? Math.ceil((w * 60) / wpm) : 0;
}

/** Итоговое время строки: ручное, если задано, иначе автоматическое. */
export function rowSeconds(row: Row, wpm: number): number {
  return row.time ?? autoSeconds(row, wpm);
}

export interface Timeline {
  /** Таймкод начала каждой строки, секунды. */
  readonly starts: number[];
  readonly total: number;
  readonly words: number;
}

export function timeline(doc: Doc): Timeline {
  const starts: number[] = [];
  let acc = 0;
  let words = 0;
  for (const r of doc.rows) {
    starts.push(acc);
    acc += rowSeconds(r, doc.wpm);
    words += rowWords(r);
  }
  return { starts, total: acc, words };
}

/** Строка пуста целиком — такие пропускаются при экспорте. */
export function isRowEmpty(r: Row): boolean {
  return !r.video.trim() && !r.audio.trim() && r.time === null;
}
