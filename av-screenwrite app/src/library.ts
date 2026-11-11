/**
 * Библиотека проектов. В Tauri каждый проект — файл `<id>.avs` в папке данных приложения (Rust-команды),
 * в обычном браузере (разработка и тесты) — запись в localStorage.
 */
import { invoke } from '@tauri-apps/api/core';
import { parseAvs, serializeAvs } from './core/avs';
import { createDoc, newId, timeline, type Doc } from './core/doc';
import { isTauri } from './platform';

export interface ProjectMeta {
  id: string;
  title: string;
  author: string;
  date: string;
  rows: number;
  words: number;
  seconds: number;
  /** Время последнего изменения, мс. */
  modified: number;
  /** Файл не удалось разобрать. */
  error?: string;
  /** Файл создан более новой версией приложения. */
  tooNew?: boolean;
}

const LS_PREFIX = 'av-scenariy-project/';

interface Raw {
  id: string;
  modified: number;
  text: string;
}

function metaOf(raw: Raw): ProjectMeta {
  const base = { id: raw.id, modified: raw.modified };
  const res = parseAvs(raw.text);
  if (!res.ok) return { ...base, title: '', author: '', date: '', rows: 0, words: 0, seconds: 0, error: res.error };
  const tl = timeline(res.doc);
  return {
    ...base,
    title: res.doc.title,
    author: res.doc.author,
    date: res.doc.date,
    rows: res.doc.rows.length,
    words: tl.words,
    seconds: tl.total,
    tooNew: res.readOnly || undefined,
  };
}

/* ---------- Хранилища ---------- */

async function rawList(): Promise<Raw[]> {
  if (isTauri()) {
    const list = await invoke<[string, number, string][]>('library_list');
    return list.map(([id, modified, text]) => ({ id, modified, text }));
  }
  const out: Raw[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(LS_PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k)!) as { text: string; modified: number };
      out.push({ id: k.slice(LS_PREFIX.length), modified: v.modified, text: v.text });
    } catch {
      /* битая запись пропускается */
    }
  }
  return out;
}

export async function readRaw(id: string): Promise<string> {
  if (isTauri()) return invoke<string>('library_read', { id });
  const v = localStorage.getItem(LS_PREFIX + id);
  if (v === null) throw new Error('not found');
  return (JSON.parse(v) as { text: string }).text;
}

export async function writeRaw(id: string, text: string): Promise<void> {
  if (isTauri()) return invoke('library_write', { id, contents: text });
  localStorage.setItem(LS_PREFIX + id, JSON.stringify({ text, modified: Date.now() }));
}

/* ---------- Операции над проектами ---------- */

/** Все проекты, свежие сверху. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const metas = (await rawList()).map(metaOf);
  return metas.sort((a, b) => b.modified - a.modified);
}

/** Прочитать проект. Бросает понятную ошибку, если файл повреждён или создан более новой версией. */
export async function loadProject(id: string): Promise<Doc> {
  const res = parseAvs(await readRaw(id));
  if (!res.ok) throw new Error(res.error);
  if (res.readOnly) throw new Error(`format version ${res.fileVersion}`);
  return res.doc;
}

export const saveProject = (id: string, doc: Doc): Promise<void> => writeRaw(id, serializeAvs(doc));

/** Создать проект и сразу записать его, чтобы он появился в списке. */
export async function createProject(doc: Doc = createDoc()): Promise<string> {
  const id = newId();
  await saveProject(id, doc);
  return id;
}

/** Удалить проект. Возвращает его текст, чтобы удаление можно было отменить. */
export async function deleteProject(id: string): Promise<string> {
  const text = await readRaw(id).catch(() => '');
  if (isTauri()) await invoke('library_delete', { id });
  else localStorage.removeItem(LS_PREFIX + id);
  return text;
}

/** Вернуть удалённый проект. */
export async function restoreProject(id: string, text: string): Promise<void> {
  if (text) await writeRaw(id, text);
}
