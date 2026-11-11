/**
 * Форматирование текста ячеек. Текст хранится обычной строкой, а оформление — отдельным списком
 * «прогонов» (runs): диапазоны [from, to) в единицах UTF-16 с флагами жирный / курсив / подчёркнутый /
 * зачёркнутый. Подсчёт слов и хронометраж от оформления не зависят.
 */

export interface Run {
  readonly from: number;
  readonly to: number;
  readonly b?: true;
  readonly i?: true;
  readonly u?: true;
  readonly s?: true;
}

export type StyleKey = 'b' | 'i' | 'u' | 's';
export const STYLE_KEYS: readonly StyleKey[] = ['b', 'i', 'u', 's'];

/** Фрагмент текста с одним набором стилей. */
export interface Segment {
  readonly text: string;
  readonly b: boolean;
  readonly i: boolean;
  readonly u: boolean;
  readonly s: boolean;
}

const mask = (r: { b?: boolean; i?: boolean; u?: boolean; s?: boolean }) =>
  (r.b ? 1 : 0) | (r.i ? 2 : 0) | (r.u ? 4 : 0) | (r.s ? 8 : 0);

function runOf(from: number, to: number, m: number): Run {
  return { from, to, ...(m & 1 ? { b: true as const } : {}), ...(m & 2 ? { i: true as const } : {}), ...(m & 4 ? { u: true as const } : {}), ...(m & 8 ? { s: true as const } : {}) };
}

/**
 * Привести прогоны к каноническому виду: в пределах длины текста, без пересечений и пустых,
 * соседние с одинаковым стилем склеены. Пересекающиеся прогоны объединяют стили.
 */
export function normalizeRuns(runs: readonly Run[] | undefined, length: number): Run[] {
  if (!runs || !runs.length || length <= 0) return [];
  const cuts = new Set<number>([0, length]);
  const valid: { from: number; to: number; m: number }[] = [];
  for (const r of runs) {
    const from = Math.max(0, Math.min(length, Math.trunc(Number(r.from))));
    const to = Math.max(0, Math.min(length, Math.trunc(Number(r.to))));
    const m = mask(r);
    if (!(to > from) || !m) continue;
    valid.push({ from, to, m });
    cuts.add(from);
    cuts.add(to);
  }
  if (!valid.length) return [];
  const points = [...cuts].sort((a, b) => a - b);
  const out: Run[] = [];
  let prevMask = 0;
  let start = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    let m = 0;
    for (const v of valid) if (v.from <= a && v.to >= b) m |= v.m;
    if (m !== prevMask) {
      if (prevMask) out.push(runOf(start, a, prevMask));
      start = a;
      prevMask = m;
    }
  }
  if (prevMask) out.push(runOf(start, points[points.length - 1]!, prevMask));
  return out;
}

export function runsEqual(a: readonly Run[], b: readonly Run[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((r, k) => r.from === b[k]!.from && r.to === b[k]!.to && mask(r) === mask(b[k]!));
}

/** Разбить текст на фрагменты по стилям (покрывает весь текст). */
export function segments(text: string, runs: readonly Run[]): Segment[] {
  return segmentsIn(text, runs, 0, text.length);
}

/** То же для диапазона [a, b) исходного текста. */
export function segmentsIn(text: string, runs: readonly Run[], a: number, b: number): Segment[] {
  const out: Segment[] = [];
  const push = (from: number, to: number, m: number) => {
    if (to > from) out.push({ text: text.slice(from, to), b: !!(m & 1), i: !!(m & 2), u: !!(m & 4), s: !!(m & 8) });
  };
  let pos = a;
  for (const r of runs) {
    if (r.to <= a) continue;
    if (r.from >= b) break;
    const from = Math.max(r.from, a);
    const to = Math.min(r.to, b);
    push(pos, from, 0);
    push(from, to, mask(r));
    pos = to;
  }
  push(pos, b, 0);
  return out;
}

/** Есть ли у диапазона [a, b) стиль во всём диапазоне (для состояния кнопок). */
export function hasStyle(runs: readonly Run[], a: number, b: number, key: StyleKey): boolean {
  if (b <= a) return false;
  let covered = a;
  for (const r of runs) {
    if (r.to <= covered) continue;
    if (r.from > covered) return false;
    if (!r[key]) return false;
    covered = r.to;
    if (covered >= b) return true;
  }
  return covered >= b;
}

/** Включить/выключить стиль на диапазоне. Если стиль уже есть на всём диапазоне — снять, иначе поставить. */
export function toggleStyle(runs: readonly Run[], length: number, a: number, b: number, key: StyleKey): Run[] {
  const from = Math.max(0, Math.min(a, b));
  const to = Math.min(length, Math.max(a, b));
  if (to <= from) return normalizeRuns(runs, length);
  const on = !hasStyle(runs, from, to, key);
  const cuts = [0, ...runs.flatMap((r) => [r.from, r.to]), from, to, length].filter((x) => x >= 0 && x <= length);
  const pts = [...new Set(cuts)].sort((x, y) => x - y);
  const out: Run[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const x = pts[k]!;
    const y = pts[k + 1]!;
    let m = 0;
    for (const r of runs) if (r.from <= x && r.to >= y) m |= mask(r);
    const bit = key === 'b' ? 1 : key === 'i' ? 2 : key === 'u' ? 4 : 8;
    if (x >= from && y <= to) m = on ? m | bit : m & ~bit;
    if (m) out.push(runOf(x, y, m));
  }
  return normalizeRuns(out, length);
}

/**
 * Преобразовать текст посимвольно (по кодовым точкам) и пересчитать прогоны под новые смещения.
 * Нужен экспорту: замена табуляции, символов, которых нет в шрифте, и т. п.
 */
export function mapText(
  text: string,
  runs: readonly Run[],
  fn: (ch: string) => string,
): { text: string; runs: Run[] } {
  const starts: number[] = []; // новое смещение для каждого старого UTF-16 смещения
  let out = '';
  let i = 0;
  for (const ch of text) {
    for (let k = 0; k < ch.length; k++) starts[i + k] = out.length;
    out += fn(ch);
    i += ch.length;
  }
  starts[text.length] = out.length;
  const remapped = runs.map((r) => runOf(starts[r.from] ?? out.length, starts[r.to] ?? out.length, mask(r)));
  return { text: out, runs: normalizeRuns(remapped, out.length) };
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * Каноническая HTML-разметка ячейки редактора: <b><i><u><s> и <br> для переводов строк.
 * Завершающий перевод строки дополняется <br>-заглушкой, без неё браузер не покажет пустую строку.
 */
export function toEditorHtml(text: string, runs: readonly Run[]): string {
  let html = '';
  for (const seg of segments(text, runs)) {
    let part = seg.text.replace(/[&<>]/g, (c) => ESC[c]!).replace(/\n/g, '<br>');
    if (seg.s) part = `<s>${part}</s>`;
    if (seg.u) part = `<u>${part}</u>`;
    if (seg.i) part = `<i>${part}</i>`;
    if (seg.b) part = `<b>${part}</b>`;
    html += part;
  }
  if (text.endsWith('\n')) html += '<br>';
  return html;
}

/**
 * Заменить в тексте диапазон [start, end) строкой ins и пересчитать оформление.
 * Вставка внутри размеченного участка наследует его стиль; на границе — нет.
 */
export function spliceText(
  text: string,
  runs: readonly Run[],
  start: number,
  end: number,
  ins: string,
): { text: string; runs: Run[] } {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.min(text.length, Math.max(start, end));
  const next = text.slice(0, a) + ins + text.slice(b);
  const shift = ins.length - (b - a);
  const from = (p: number) => (p < a ? p : p >= b ? p + shift : a + ins.length);
  const to = (p: number) => (p <= a ? p : p >= b ? p + shift : a);
  const moved = runs.map((r) => runOf(from(r.from), to(r.to), mask(r)));
  // Участок, который целиком был внутри заменённого диапазона, схлопнется в пустой и будет отброшен.
  return { text: next, runs: normalizeRuns(moved, next.length) };
}
