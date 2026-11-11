/** Общая модель экспорта: что именно попадёт в PDF и Word. Без DOM и без библиотек. */
import { isRowEmpty, rowSeconds, type Doc } from '../core/doc';
import { formatTime } from '../core/time';
import type { Run } from '../core/richtext';

/** Текст ячейки с оформлением. */
export interface ExportCell {
  text: string;
  runs: readonly Run[];
}

export interface ExportRow {
  /** Номер среди выведенных строк (пустые пропускаются и не нумеруются). */
  n: number;
  /** Таймкод начала строки. */
  tc: string;
  /** Ячейки в порядке колонок: [левая, правая]. */
  cells: [ExportCell, ExportCell];
  time: string;
}

export interface ExportModel {
  title: string;
  /** Автор, дата и общий хронометраж одной строкой. */
  metaLine: string;
  /** Заголовки колонок: № / левая / правая / Время. */
  headers: [string, string, string, string];
  rows: ExportRow[];
  total: string;
}

export interface ExportLabels {
  untitled: string;
  author: string;
  date: string;
  duration: string;
  num: string;
  video: string;
  audio: string;
  time: string;
}

export const RU_LABELS: ExportLabels = {
  untitled: 'Без названия',
  author: 'Автор',
  date: 'Дата',
  duration: 'Хронометраж',
  num: '№',
  video: 'ВИДЕО',
  audio: 'ЗВУК',
  time: 'Время',
};

/** Доли ширины колонок: №, левая, правая, время. */
export const COLUMN_SHARES = [0.09, 0.41, 0.41, 0.09] as const;

export function buildModel(doc: Doc, labels: ExportLabels = RU_LABELS): ExportModel {
  // Таймкоды считаются по ВСЕМ строкам: пустая строка с ручным временем сдвигает последующие,
  // а полностью пустая (без времени) занимает 0 секунд и ничего не сдвигает.
  let acc = 0;
  const rows: ExportRow[] = [];
  for (const r of doc.rows) {
    const secs = rowSeconds(r, doc.wpm);
    const start = acc;
    acc += secs;
    if (isRowEmpty(r)) continue;
    const video: ExportCell = { text: r.video, runs: r.videoFmt };
    const audio: ExportCell = { text: r.audio, runs: r.audioFmt };
    const [left, right] = doc.swap ? [audio, video] : [video, audio];
    rows.push({ n: rows.length + 1, tc: formatTime(start), cells: [left, right], time: formatTime(secs) });
  }
  const total = formatTime(acc);
  const meta: string[] = [];
  if (doc.author.trim()) meta.push(`${labels.author}: ${doc.author.trim()}`);
  if (doc.date.trim()) meta.push(`${labels.date}: ${doc.date.trim()}`);
  meta.push(`${labels.duration}: ${total}`);
  const [l, r] = doc.swap ? [labels.audio, labels.video] : [labels.video, labels.audio];
  return {
    title: doc.title.trim() || labels.untitled,
    metaLine: meta.join('    '),
    headers: [labels.num, l, r, labels.time],
    rows,
    total,
  };
}

/** Имя файла по названию документа: без символов, запрещённых в Windows. */
export function exportFileName(doc: Doc, ext: string, fallback = 'scenariy'): string {
  const base = (doc.title.trim() || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '').slice(0, 80);
  return `${base || fallback}.${ext}`;
}
