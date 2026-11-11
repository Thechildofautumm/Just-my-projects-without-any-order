import '@fontsource/pt-mono/cyrillic-400.css';
import '@fontsource/pt-mono/latin-400.css';
import '@fontsource/pt-mono/latin-ext-400.css';
import '@fontsource/pt-serif/cyrillic-400.css';
import '@fontsource/pt-serif/cyrillic-700.css';
import '@fontsource/pt-serif/latin-400.css';
import '@fontsource/pt-serif/latin-700.css';
import '@fontsource/pt-serif/latin-ext-400.css';
import '@fontsource/pt-serif/latin-ext-700.css';
import './style.css';

import { parseAvs, serializeAvs, AVS_VERSION } from './core/avs';
import { createDoc, validWpm } from './core/doc';
import * as ops from './core/ops';
import { Store } from './core/store';
import { formatTime } from './core/time';
import { applyStaticTexts, exportLabels, getLanguage, getLocale, isLang, LANGUAGES, setLanguage, t, tp } from './i18n';
import { createProject, deleteProject, listProjects, loadProject, readRaw, restoreProject, saveProject } from './library';
import { onCloseRequest, openFile, setWindowTitle, writeExport, writeFile, type ExportKind } from './platform';
import { clampFont, DEFAULT_FONT_SIZE, loadSettings, saveSettings } from './settings';
import { choose, showError, toast } from './ui/dialogs';
import { Editor } from './ui/editor';
import { Home } from './ui/home';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- Язык и настройки ---------- */
let settings = loadSettings();
setLanguage(settings.language);

const today = () => {
  try {
    return new Date().toLocaleDateString(getLocale());
  } catch {
    return '';
  }
};

/* ---------- Состояние ---------- */
const store = new Store(createDoc());
const editor = new Editor(store, $('rows'));
let view: 'home' | 'editor' = 'home';
let currentId: string | null = null;
let saveState: 'saved' | 'saving' | 'error' = 'saved';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
let busy = false; // открытие/создание проекта в процессе

const home = new Home($('projects'), $('homeEmpty'), $<HTMLInputElement>('search'), {
  open: (id) => void openProject(id),
  duplicate: (id) => void duplicateProject(id),
  exportFile: (id) => void exportProjectFile(id),
  remove: (id) => void removeProject(id),
});

/* ---------- Подписи, язык ---------- */
function fillLanguageSelects(): void {
  document.querySelectorAll<HTMLSelectElement>('select.lang').forEach((sel) => {
    sel.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.name}</option>`).join('');
    sel.value = getLanguage();
  });
}

function refreshTexts(): void {
  applyStaticTexts();
  fillLanguageSelects();
  if (view === 'home') {
    home.render();
    updateChrome();
  } else {
    editor.render(editor.active() ?? undefined);
    updateChrome();
  }
}

function changeLanguage(code: string): void {
  if (!isLang(code)) return;
  setLanguage(code);
  settings = saveSettings({ language: code });
  refreshTexts();
}
document.querySelectorAll<HTMLSelectElement>('select.lang').forEach((sel) => sel.addEventListener('change', () => changeLanguage(sel.value)));

/* ---------- Масштаб текста ---------- */
function setFontSize(px: number): void {
  const v = clampFont(px);
  settings = saveSettings({ fontSize: v });
  document.documentElement.style.setProperty('--fs', v + 'px');
}
document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');

/* ---------- Панель и заголовок ---------- */
editor.onStats = ({ total, rows, words }) => {
  $('total').textContent = formatTime(total);
  $('totalSub').textContent = `${rows} ${tp('unit.row', rows)}, ${words} ${tp('unit.word', words)}`;
};

function docName(): string {
  return store.doc.title.trim() || t('app.untitled');
}

function syncMeta(): void {
  const d = store.doc;
  const set = (id: string, v: string) => {
    const el = $<HTMLInputElement>(id);
    if (el.value !== v) el.value = v;
  };
  set('title', d.title);
  set('author', d.author);
  set('date', d.date);
  set('wpm', String(d.wpm));
}

function updateFormatButtons(): void {
  const st = editor.formatState();
  const map: [string, 'b' | 'i' | 'u' | 's'][] = [['fBold', 'b'], ['fItalic', 'i'], ['fUnderline', 'u'], ['fStrike', 's']];
  for (const [id, k] of map) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !st;
    b.setAttribute('aria-pressed', st && st[k] ? 'true' : 'false');
  }
  $<HTMLButtonElement>('fClear').disabled = !st;
}

function renderSaveState(): void {
  const el = $('saveState');
  el.textContent = saveState === 'saved' ? t('bar.saved') : saveState === 'saving' ? t('bar.saving') : t('bar.saveError');
  el.classList.toggle('error', saveState === 'error');
  el.dataset.state = saveState;
}

function updateChrome(): void {
  if (view === 'home') {
    setWindowTitle(t('app.name'));
    return;
  }
  setWindowTitle(`${docName()} — ${t('app.name')}`);
  $<HTMLButtonElement>('bUndo').disabled = !store.canUndo;
  $<HTMLButtonElement>('bRedo').disabled = !store.canRedo;
  renderSaveState();
  updateFormatButtons();
}

/* ---------- Автосохранение ---------- */
function setSaveState(s: typeof saveState): void {
  saveState = s;
  if (view === 'editor') renderSaveState();
}

/** Записать проект на диск. Вызовы выстраиваются в очередь, чтобы записи не перекрывались. */
function flush(): Promise<void> {
  clearTimeout(saveTimer);
  saveChain = saveChain.then(async () => {
    const id = currentId;
    if (!id || !store.dirty) return;
    const snapshot = store.doc;
    setSaveState('saving');
    try {
      await saveProject(id, snapshot);
      if (currentId === id) store.markSaved(snapshot);
      setSaveState(store.dirty ? 'saving' : 'saved');
    } catch (e) {
      setSaveState('error');
      toast(t('file.saveFailed', { err: String(e) }));
    }
  });
  return saveChain;
}

function scheduleSave(): void {
  if (!currentId || !store.dirty) return;
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 700);
}

store.subscribe((c) => {
  if (c.structural) {
    syncMeta();
    editor.render(c.focus);
  } else {
    editor.updateTimes();
  }
  updateChrome();
  scheduleSave();
});

/* ---------- Переходы между экранами ---------- */
function show(v: 'home' | 'editor'): void {
  view = v;
  $('viewHome').hidden = v !== 'home';
  $('viewEditor').hidden = v !== 'editor';
  document.body.dataset.view = v;
  if (v === 'home') document.body.classList.remove('swap', 'readonly');
  updateChrome();
  window.scrollTo(0, 0);
}

async function refreshHome(): Promise<void> {
  try {
    home.setProjects(await listProjects());
  } catch (e) {
    toast(t('home.loadFailed', { err: String(e) }));
    home.setProjects([]);
  }
}

async function openProject(id: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const doc = await loadProject(id);
    currentId = id;
    store.load(doc);
    setSaveState('saved');
    show('editor');
    syncMeta();
    editor.render();
    updateChrome();
    const first = store.doc.rows[0];
    if (first && !store.doc.title && !first.video && !first.audio) $<HTMLInputElement>('title').focus();
  } catch (e) {
    await showError(t('app.name'), t('project.openFailed', { err: String((e as Error)?.message ?? e) }));
  } finally {
    busy = false;
  }
}

async function newProject(): Promise<void> {
  if (busy) return;
  try {
    if (view === 'editor') await leaveEditor(true);
    const id = await createProject(createDoc({ date: today() }));
    await openProject(id);
  } catch (e) {
    await showError(t('app.name'), t('project.createFailed', { err: String(e) }));
  }
}

/** Вернуться к списку, предварительно сохранив проект. silent — не обновлять список (дальше откроется другой экран). */
async function leaveEditor(silent = false): Promise<boolean> {
  await flush();
  if (store.dirty) {
    const r = await choose(t('dlg.unsaved.title'), t('dlg.unsaved.text'), [
      { id: 'close' as const, label: t('dlg.unsaved.close'), danger: true },
      { id: 'stay' as const, label: t('dlg.cancel'), primary: true },
    ]);
    if (r !== 'close') return false;
  }
  currentId = null;
  clearTimeout(saveTimer);
  if (!silent) {
    show('home');
    await refreshHome();
  }
  return true;
}

/* ---------- Действия над проектами на главном экране ---------- */
async function duplicateProject(id: string): Promise<void> {
  try {
    const doc = await loadProject(id);
    const copy = { ...doc, title: (doc.title.trim() || t('app.untitled')) + t('project.copySuffix') };
    await createProject(copy);
    await refreshHome();
    toast(t('project.duplicated', { name: copy.title }));
  } catch (e) {
    await showError(t('app.name'), t('project.createFailed', { err: String((e as Error)?.message ?? e) }));
  }
}

async function exportProjectFile(id: string): Promise<void> {
  try {
    const text = await readRaw(id);
    const res = parseAvs(text);
    const base = res.ok && res.doc.title.trim() ? res.doc.title.trim() : t('app.untitled');
    const ref = await writeFile(null, `${base.replace(/[\\/:*?"<>|]+/g, '_')}.avs`, text);
    if (ref) toast(t('file.exported', { name: ref.name }));
  } catch (e) {
    await showError(t('app.name'), t('file.saveFailed', { err: String(e) }));
  }
}

async function removeProject(id: string): Promise<void> {
  const meta = (await listProjects().catch(() => [])).find((p) => p.id === id);
  const name = meta?.title.trim() || t('app.untitled');
  const r = await choose(t('dlg.delete.title'), t('dlg.delete.text', { name }), [
    { id: 'delete' as const, label: t('dlg.delete.confirm'), danger: true },
    { id: 'cancel' as const, label: t('dlg.cancel'), primary: true },
  ]);
  if (r !== 'delete') return;
  try {
    const text = await deleteProject(id);
    await refreshHome();
    toast(t('project.deleted', { name }), {
      action: {
        label: t('project.undo'),
        run: () => void restoreProject(id, text).then(refreshHome),
      },
    });
  } catch (e) {
    await showError(t('app.name'), t('project.deleteFailed', { err: String(e) }));
  }
}

/** Добавить в библиотеку файл .avs (в том числе старый, из HTML-прототипа). */
async function importFile(): Promise<void> {
  try {
    const f = await openFile();
    if (!f) return;
    const res = parseAvs(f.text);
    if (!res.ok) {
      await showError(t('dlg.error.title'), `${f.name}\n\n${res.error}`);
      return;
    }
    if (res.readOnly) {
      await showError(t('dlg.error.title'), `${f.name}\n\n${t('file.tooNew', { v: res.fileVersion })}`);
      return;
    }
    const doc = res.doc.title.trim() ? res.doc : { ...res.doc, title: f.name.replace(/\.(avs|json)$/i, '') };
    await createProject(doc);
    await refreshHome();
    toast(res.fromPrototype ? t('file.fromPrototype', { v: AVS_VERSION }) : t('project.imported', { name: doc.title }));
  } catch (e) {
    await showError(t('dlg.error.title'), t('file.readFailed', { err: String(e) }));
  }
}

/** Сохранить копию открытого проекта в файл .avs. */
async function exportAvs(): Promise<void> {
  try {
    const ref = await writeFile(null, `${docName().replace(/[\\/:*?"<>|]+/g, '_')}.avs`, serializeAvs(store.doc));
    if (ref) toast(t('file.exported', { name: ref.name }));
  } catch (e) {
    await showError(t('app.name'), t('file.saveFailed', { err: String(e) }));
  }
}

/* ---------- Экспорт PDF / Word ---------- */
let exporting = false;
async function runExport(kind: ExportKind): Promise<void> {
  if (exporting) {
    toast(t('export.busy'));
    return;
  }
  exporting = true;
  const snapshot = store.doc; // экспортируем то, что было на экране в момент нажатия
  try {
    // Библиотеки и шрифт грузятся только при первом экспорте — запуск приложения от них не зависит.
    const [{ exportFontBytes }, { exportFileName }] = await Promise.all([import('./export/font'), import('./export/model')]);
    const font = exportFontBytes();
    const opts = { paper: loadSettings().paper, labels: exportLabels() };
    const bytes =
      kind === 'pdf'
        ? await (await import('./export/pdf')).exportPdf(snapshot, font, opts)
        : await (await import('./export/docx')).exportDocx(snapshot, font, opts);
    const ref = await writeExport(kind, exportFileName(snapshot, kind, t('app.untitled')), bytes);
    if (ref) toast(t('export.done', { name: ref.name }));
  } catch (e) {
    await showError(t('app.name'), t('export.failed', { err: String(e) }));
  } finally {
    exporting = false;
  }
}

/* ---------- Поля шапки ---------- */
for (const k of ['title', 'author', 'date'] as const) {
  $<HTMLInputElement>(k).addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value;
    store.apply((d) => ops.setMeta(d, k, v), { key: `meta:${k}`, inPlace: true });
  });
  $<HTMLInputElement>(k).addEventListener('blur', () => store.breakCoalescing());
}
const wpmEl = $<HTMLInputElement>('wpm');
wpmEl.addEventListener('input', () => {
  const v = parseInt(wpmEl.value, 10);
  if (validWpm(v)) store.apply((d) => ops.setWpm(d, v), { key: 'meta:wpm', inPlace: true });
});
wpmEl.addEventListener('change', () => {
  wpmEl.value = String(store.doc.wpm);
  store.breakCoalescing();
});

/* ---------- Кнопки ---------- */
$('hNew').addEventListener('click', () => void newProject());
$('hImport').addEventListener('click', () => void importFile());
$('bBack').addEventListener('click', () => void leaveEditor());
$('bUndo').addEventListener('click', () => store.undo());
$('bRedo').addEventListener('click', () => store.redo());
$('bSwap').addEventListener('click', () => store.apply(ops.toggleSwap));
$('bAvs').addEventListener('click', () => void exportAvs());
$('bPdf').addEventListener('click', () => void runExport('pdf'));
$('bWord').addEventListener('click', () => void runExport('docx'));
$('bAdd').addEventListener('click', () => editor.addRowAtEnd());

// Кнопки форматирования не должны забирать фокус у ячейки: иначе выделение пропадёт.
const fmtbar = $('fmtbar');
fmtbar.addEventListener('mousedown', (e) => e.preventDefault());
fmtbar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
  if (!b) return;
  if (!editor.format(b.dataset.cmd as 'bold')) toast(t('fmt.noFocus'));
  updateFormatButtons();
});
document.addEventListener('selectionchange', () => view === 'editor' && updateFormatButtons());

/* ---------- Горячие клавиши (по физической клавише — работают в любой раскладке) ---------- */
document.addEventListener(
  'keydown',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (($('dlg') as HTMLDialogElement).open) return;
    const shift = e.shiftKey;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (e.code === 'KeyN') return run(() => void newProject());
    if (view === 'home') {
      if (e.code === 'KeyO') return run(() => void importFile());
      return;
    }
    const row = () => editor.active();
    switch (e.code) {
      case 'KeyZ':
        return run(() => (shift ? store.redo() : store.undo()));
      case 'KeyY':
        return run(() => store.redo());
      case 'KeyS':
        return run(() => (shift ? void exportAvs() : void flush().then(() => toast(t('bar.saved'), { ms: 1500 }))));
      case 'KeyO':
        return run(() => void leaveEditor());
      case 'KeyP':
        return run(() => void runExport('pdf'));
      case 'KeyE':
        if (shift) return run(() => void runExport('docx'));
        return;
      case 'KeyD': {
        const a = row();
        return run(() => a && editor.act('dup', a.id, a.f));
      }
      case 'Backspace': {
        const a = row();
        if (shift) return run(() => a && editor.act('del', a.id, a.f));
        return;
      }
      case 'KeyK':
        if (shift) return run(() => void store.apply(ops.toggleSwap));
        return;
      case 'Equal':
      case 'NumpadAdd':
        return run(() => setFontSize(settings.fontSize + 1));
      case 'Minus':
      case 'NumpadSubtract':
        return run(() => setFontSize(settings.fontSize - 1));
      case 'Digit0':
      case 'Numpad0':
        return run(() => setFontSize(DEFAULT_FONT_SIZE));
    }
  },
  true,
);

/* ---------- Сохранение при уходе и закрытии ---------- */
window.addEventListener('blur', () => void flush());
document.addEventListener('visibilitychange', () => document.hidden && void flush());

onCloseRequest(async () => {
  await flush();
  if (!store.dirty || !currentId) return true;
  const r = await choose(t('dlg.unsaved.title'), t('dlg.unsaved.text'), [
    { id: 'close' as const, label: t('dlg.unsaved.close'), danger: true },
    { id: 'stay' as const, label: t('dlg.cancel'), primary: true },
  ]);
  return r === 'close';
}, () => store.dirty);

/* ---------- Запуск ---------- */

/** Работа, которую прошлая версия хранила как черновик в localStorage, превращается в проект. */
async function migrateLegacyDraft(): Promise<void> {
  const KEY = 'av-scenariy-draft-v1';
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = parseAvs((JSON.parse(raw) as { avs: string }).avs);
    if (parsed.ok) {
      const name = parsed.doc.title.trim() || t('app.untitled');
      await createProject(parsed.doc);
      localStorage.removeItem(KEY);
      toast(t('project.migrated', { name }), { ms: 7000 });
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    /* повредённый черновик не должен мешать запуску */
  }
}

async function start(): Promise<void> {
  refreshTexts();
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  show('home');
  await migrateLegacyDraft();
  await refreshHome();
}
void start();

// Только для отладки в dev-режиме: доступ к хранилищу из консоли.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__store = store;
