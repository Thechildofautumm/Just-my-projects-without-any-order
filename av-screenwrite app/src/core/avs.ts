/**
 * Формат файла .avs — UTF-8 JSON.
 * Меняется только через миграции. Неизвестные поля сохраняются и пишутся обратно.
 *
 * Версии:
 *  1 — только текст (прототип и первые сборки);
 *  2 — добавлены videoFmt / audioFmt: оформление текста (жирный, курсив, подчёркнутый, зачёркнутый).
 *      Файлы версии 1 читаются без изменений; приложение всегда пишет версию 2.
 */
import { createRow, DEFAULT_WPM, validWpm, type Doc, type Extra, type Row } from './doc';
import { normalizeRuns, type Run } from './richtext';

export const AVS_FORMAT = 'av-scenariy';
/** Самая новая версия формата, которую понимает это приложение. */
export const AVS_VERSION = 2;

export type ParseResult =
  | { ok: true; doc: Doc; readOnly: boolean; fileVersion: number; fromPrototype: boolean }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ROW_KNOWN = new Set(['id', 'video', 'audio', 'time', 'videoFmt', 'audioFmt']);
const DOC_KNOWN = new Set(['format', 'version', 'title', 'author', 'date', 'wpm', 'swap', 'rows']);

/** Оформление из файла: мусорные записи молча отбрасываются, остальное приводится к каноническому виду. */
function parseRuns(v: unknown, length: number): Run[] {
  if (!Array.isArray(v)) return [];
  const runs: Run[] = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.from !== 'number' || typeof e.to !== 'number') continue;
    runs.push({ from: e.from, to: e.to, ...(e.b === true ? { b: true as const } : {}), ...(e.i === true ? { i: true as const } : {}), ...(e.u === true ? { u: true as const } : {}), ...(e.s === true ? { s: true as const } : {}) });
  }
  return normalizeRuns(runs, length);
}

function pickExtra(o: Record<string, unknown>, known: Set<string>): Extra {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!known.has(k)) out[k] = o[k];
  return out;
}

/** Разобрать текст файла. Ошибка — с понятным описанием, что именно не так. */
export function parseAvs(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, error: `Файл не является корректным JSON: ${(e as Error).message}` };
  }
  if (!isObj(raw)) return { ok: false, error: 'Ожидался объект JSON, а в файле другой тип данных.' };

  const hasFormat = 'format' in raw;
  const hasVersion = 'version' in raw;
  const fromPrototype = !hasFormat && !hasVersion;

  if (hasFormat && raw.format !== AVS_FORMAT) {
    return { ok: false, error: `Это не файл сценария: поле format равно ${JSON.stringify(raw.format)}, а нужно «${AVS_FORMAT}».` };
  }
  let fileVersion = 1;
  if (hasVersion) {
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
      return { ok: false, error: `Некорректное поле version: ${JSON.stringify(raw.version)}.` };
    }
    fileVersion = raw.version;
  }

  if (!Array.isArray(raw.rows)) return { ok: false, error: 'В файле нет списка строк (поле rows).' };

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (let i = 0; i < raw.rows.length; i++) {
    const r = raw.rows[i];
    const n = i + 1;
    if (!isObj(r)) return { ok: false, error: `Строка ${n}: ожидался объект.` };
    for (const f of ['video', 'audio'] as const) {
      if (r[f] !== undefined && typeof r[f] !== 'string') {
        return { ok: false, error: `Строка ${n}: поле ${f} должно быть текстом.` };
      }
    }
    let time: number | null = null;
    if (r.time !== undefined && r.time !== null) {
      if (typeof r.time !== 'number' || !Number.isFinite(r.time) || r.time < 0) {
        return { ok: false, error: `Строка ${n}: поле time должно быть числом секунд (≥ 0) или null.` };
      }
      time = Math.round(r.time);
    }
    let id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : '';
    if (!id) id = createRow().id;
    seen.add(id);
    const video = (r.video as string | undefined) ?? '';
    const audio = (r.audio as string | undefined) ?? '';
    rows.push({
      id,
      video,
      audio,
      time,
      videoFmt: parseRuns(r.videoFmt, video.length),
      audioFmt: parseRuns(r.audioFmt, audio.length),
      extra: pickExtra(r, ROW_KNOWN),
    });
  }
  if (!rows.length) rows.push(createRow());

  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const doc: Doc = {
    title: str('title'),
    author: str('author'),
    date: str('date'),
    wpm: validWpm(raw.wpm) ? raw.wpm : DEFAULT_WPM,
    swap: raw.swap === true,
    rows,
    extra: pickExtra(raw, DOC_KNOWN),
  };
  return { ok: true, doc, readOnly: fileVersion > AVS_VERSION, fileVersion, fromPrototype };
}

/** Сериализация. Неизвестные поля идут первыми, известные их не перекрывают. */
export function serializeAvs(doc: Doc): string {
  const out = {
    ...doc.extra,
    format: AVS_FORMAT,
    version: AVS_VERSION,
    title: doc.title,
    author: doc.author,
    date: doc.date,
    wpm: doc.wpm,
    swap: doc.swap,
    rows: doc.rows.map((r) => ({
      ...r.extra,
      id: r.id,
      video: r.video,
      audio: r.audio,
      time: r.time,
      ...(r.videoFmt.length ? { videoFmt: r.videoFmt } : {}),
      ...(r.audioFmt.length ? { audioFmt: r.audioFmt } : {}),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}
