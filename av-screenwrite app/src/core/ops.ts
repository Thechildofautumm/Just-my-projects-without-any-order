/**
 * Команды правки: чистые функции Doc → Doc.
 * Если команда ничего не меняет, она возвращает тот же объект — хранилище это пропускает.
 */
import { createRow, newId, validWpm, type Doc, type Row } from './doc';
import { normalizeRuns, runsEqual, type Run } from './richtext';

export type MetaField = 'title' | 'author' | 'date';
export type RowTextField = 'video' | 'audio';

const mapRow = (doc: Doc, id: string, fn: (r: Row) => Row): Doc => {
  const i = doc.rows.findIndex((r) => r.id === id);
  if (i < 0) return doc;
  const next = fn(doc.rows[i]!);
  if (next === doc.rows[i]) return doc;
  const rows = doc.rows.slice();
  rows[i] = next;
  return { ...doc, rows };
};

export const indexOfRow = (doc: Doc, id: string): number => doc.rows.findIndex((r) => r.id === id);

export function setMeta(doc: Doc, field: MetaField, value: string): Doc {
  return doc[field] === value ? doc : { ...doc, [field]: value };
}

export function setWpm(doc: Doc, wpm: number): Doc {
  return !validWpm(wpm) || wpm === doc.wpm ? doc : { ...doc, wpm };
}

export function toggleSwap(doc: Doc): Doc {
  return { ...doc, swap: !doc.swap };
}

const fmtKey = (field: RowTextField) => (field === 'video' ? 'videoFmt' : 'audioFmt') as 'videoFmt' | 'audioFmt';

/** Заменить текст ячейки; оформление подрезается под новую длину. */
export function setRowText(doc: Doc, id: string, field: RowTextField, value: string): Doc {
  return mapRow(doc, id, (r) => {
    if (r[field] === value) return r;
    const k = fmtKey(field);
    return { ...r, [field]: value, [k]: normalizeRuns(r[k], value.length) };
  });
}

/** Заменить текст и оформление ячейки разом (ввод в редакторе). */
export function setRowRich(doc: Doc, id: string, field: RowTextField, value: string, runs: readonly Run[]): Doc {
  const k = fmtKey(field);
  const next = normalizeRuns(runs, value.length);
  return mapRow(doc, id, (r) => (r[field] === value && runsEqual(r[k], next) ? r : { ...r, [field]: value, [k]: next }));
}

/** seconds: целые секунды или null (вернуть автоподсчёт). */
export function setRowTime(doc: Doc, id: string, seconds: number | null): Doc {
  return mapRow(doc, id, (r) => (r.time === seconds ? r : { ...r, time: seconds }));
}

export function insertRow(doc: Doc, index: number, row: Row = createRow()): Doc {
  const i = Math.max(0, Math.min(index, doc.rows.length));
  const rows = doc.rows.slice();
  rows.splice(i, 0, row);
  return { ...doc, rows };
}

export function addRowAfter(doc: Doc, id: string, row: Row = createRow()): Doc {
  const i = indexOfRow(doc, id);
  return insertRow(doc, i < 0 ? doc.rows.length : i + 1, row);
}

export function duplicateRow(doc: Doc, id: string, newRowId: string = newId()): Doc {
  const i = indexOfRow(doc, id);
  if (i < 0) return doc;
  const src = doc.rows[i]!;
  return insertRow(doc, i + 1, { ...src, id: newRowId });
}

/** Удаление. Последняя строка не пропадает совсем — на её месте появляется пустая. */
export function deleteRow(doc: Doc, id: string): Doc {
  const i = indexOfRow(doc, id);
  if (i < 0) return doc;
  const rows = doc.rows.slice();
  rows.splice(i, 1);
  if (!rows.length) rows.push(createRow());
  return { ...doc, rows };
}

/** Переместить строку так, чтобы она оказалась на позиции toIndex в итоговом списке. */
export function moveRow(doc: Doc, id: string, toIndex: number): Doc {
  const from = indexOfRow(doc, id);
  const to = Math.max(0, Math.min(toIndex, doc.rows.length - 1));
  if (from < 0 || from === to) return doc;
  const rows = doc.rows.slice();
  const [r] = rows.splice(from, 1);
  rows.splice(to, 0, r!);
  return { ...doc, rows };
}

export function moveRowBy(doc: Doc, id: string, delta: number): Doc {
  const i = indexOfRow(doc, id);
  return i < 0 ? doc : moveRow(doc, id, i + delta);
}
