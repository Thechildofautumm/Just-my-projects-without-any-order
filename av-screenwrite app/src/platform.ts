/**
 * Слой платформы: в Tauri — системные диалоги и Rust-команды, в обычном браузере —
 * запасной вариант (нужен для разработки интерфейса и тестов без Rust).
 */
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from './i18n';

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

export interface FileRef {
  path: string | null;
  name: string;
}
export interface OpenedFile extends FileRef {
  text: string;
}

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const filters = () => [{ name: t('file.filter'), extensions: ['avs', 'json'] }];

/** Выбрать и прочитать файл. null — пользователь отказался. */
export async function openFile(): Promise<OpenedFile | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, directory: false, filters: filters() });
    if (!path || Array.isArray(path)) return null;
    return readPath(path);
  }
  return pickInBrowser();
}

export async function readPath(path: string): Promise<OpenedFile> {
  const text = await invoke<string>('read_text_file', { path });
  return { path, name: baseName(path), text };
}

/**
 * Записать файл. path === null — спросить имя (в браузере — скачать).
 * Возвращает куда записано или null, если пользователь отказался.
 */
export async function writeFile(path: string | null, suggestedName: string, text: string): Promise<FileRef | null> {
  if (isTauri()) {
    let target = path;
    if (!target) {
      target = await save({ defaultPath: suggestedName, filters: [{ name: t('file.filter'), extensions: ['avs'] }] });
      if (!target) return null;
    }
    await invoke('write_text_file_atomic', { path: target, contents: text });
    return { path: target, name: baseName(target) };
  }
  download(text, suggestedName);
  return { path: null, name: suggestedName };
}

const EXPORT_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
} as const;
export type ExportKind = keyof typeof EXPORT_TYPES;

/** Сохранить готовый экспорт. null — пользователь отказался. */
export async function writeExport(kind: ExportKind, suggestedName: string, bytes: Uint8Array): Promise<FileRef | null> {
  if (isTauri()) {
    const target = await save({ defaultPath: suggestedName, filters: [{ name: EXPORT_TYPES[kind].label, extensions: [kind] }] });
    if (!target) return null;
    await invoke('write_export_file', { path: target, contents: Array.from(bytes) });
    return { path: target, name: baseName(target) };
  }
  download(bytes, suggestedName, EXPORT_TYPES[kind].mime);
  return { path: null, name: suggestedName };
}

function download(data: string | Uint8Array, name: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function pickInBrowser(): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.getElementById('file') as HTMLInputElement;
    input.value = '';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const rd = new FileReader();
      rd.onload = () => resolve({ path: null, name: f.name, text: String(rd.result) });
      rd.onerror = () => reject(rd.error ?? new Error('read error'));
      rd.readAsText(f, 'utf-8');
    };
    input.click();
  });
}

/* ---------- Окно ---------- */

export function setWindowTitle(title: string): void {
  document.title = title;
  if (isTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined);
}

/**
 * Перехват закрытия окна. handler вернёт true, если закрывать можно.
 * В браузере — стандартное предупреждение, пока есть несохранённые изменения.
 */
export function onCloseRequest(handler: () => Promise<boolean>, isDirty: () => boolean): void {
  if (isTauri()) {
    const w = getCurrentWindow();
    void w.onCloseRequested(async (e) => {
      e.preventDefault();
      if (await handler()) await w.destroy();
    });
  } else {
    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) e.preventDefault();
    });
  }
}
