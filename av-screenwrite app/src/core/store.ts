/**
 * Хранилище документа с единым стеком отмены/повтора.
 * История — снимки неизменяемых документов (структурное разделение делает их дешёвыми).
 * «Грязность» документа = текущий снимок отличается от сохранённого, поэтому
 * отмена до сохранённого состояния снова делает документ чистым.
 */
import type { Doc } from './doc';

export type FocusField = 'video' | 'audio' | 'time';
export interface Focus {
  id: string;
  f: FocusField;
}

export interface ApplyOptions {
  /** Подряд идущие правки с одним ключом сливаются в один шаг отмены. */
  key?: string;
  /** Куда вернуть курсор при отмене/повторе этого шага. */
  focus?: Focus;
  /** DOM уже отражает правку (ввод текста) — перерисовка не нужна. */
  inPlace?: boolean;
}

export type ChangeKind = 'edit' | 'undo' | 'redo' | 'load';
export interface Change {
  kind: ChangeKind;
  /** true — интерфейс нужно перерисовать целиком. */
  structural: boolean;
  focus?: Focus;
}

interface Entry {
  doc: Doc;
  focus?: Focus;
}

const HISTORY_LIMIT = 500;

export class Store {
  doc: Doc;
  readOnly = false;
  private saved: Doc;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private listeners = new Set<(c: Change) => void>();

  constructor(
    doc: Doc,
    private readonly now: () => number = () => Date.now(),
    /** Пауза в наборе, после которой новый ввод в той же ячейке начинает новый шаг. */
    private readonly coalesceMs = 1500,
  ) {
    this.doc = doc;
    this.saved = doc;
  }

  subscribe(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change) {
    for (const fn of this.listeners) fn(c);
  }

  get dirty(): boolean {
    return this.doc !== this.saved;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Применить команду. Возвращает true, если документ изменился. */
  apply(op: (d: Doc) => Doc, opts: ApplyOptions = {}): boolean {
    if (this.readOnly) return false;
    const next = op(this.doc);
    if (next === this.doc) return false;

    const t = this.now();
    const merge =
      opts.key !== undefined &&
      opts.key === this.lastKey &&
      t - this.lastAt <= this.coalesceMs &&
      this.past.length > 0;
    if (!merge) {
      this.past.push({ doc: this.doc, focus: opts.focus });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastKey = opts.key ?? null;
    this.lastAt = t;
    this.future = [];
    this.doc = next;
    this.emit({ kind: 'edit', structural: !opts.inPlace, focus: opts.focus });
    return true;
  }

  /** Разорвать слияние ввода (например, при уходе из ячейки). */
  breakCoalescing(): void {
    this.lastKey = null;
  }

  undo(): boolean {
    const e = this.past.pop();
    if (!e || this.readOnly) {
      if (e) this.past.push(e);
      return false;
    }
    this.future.push({ doc: this.doc, focus: e.focus });
    this.doc = e.doc;
    this.lastKey = null;
    this.emit({ kind: 'undo', structural: true, focus: e.focus });
    return true;
  }

  redo(): boolean {
    const e = this.future.pop();
    if (!e || this.readOnly) {
      if (e) this.future.push(e);
      return false;
    }
    this.past.push({ doc: this.doc, focus: e.focus });
    this.doc = e.doc;
    this.lastKey = null;
    this.emit({ kind: 'redo', structural: true, focus: e.focus });
    return true;
  }

  /** Заменить документ целиком (новый/открытый файл). История очищается. */
  load(doc: Doc, opts: { readOnly?: boolean; dirty?: boolean; focus?: Focus } = {}): void {
    this.doc = doc;
    this.saved = opts.dirty ? createSentinel(doc) : doc;
    this.readOnly = !!opts.readOnly;
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.emit({ kind: 'load', structural: true, focus: opts.focus });
  }

  /** На диск записан снимок `doc` (по умолчанию — текущий; при асинхронной записи передавать тот, что писали). */
  markSaved(doc: Doc = this.doc): void {
    this.saved = doc;
    this.lastKey = null;
    this.emit({ kind: 'edit', structural: false });
  }
}

/** Заведомо отличающийся снимок: документ, восстановленный из черновика, считается несохранённым. */
function createSentinel(doc: Doc): Doc {
  return { ...doc };
}
