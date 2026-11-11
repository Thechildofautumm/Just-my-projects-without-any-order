/** Редактор строк: отрисовка, ввод, действия над строками, перетаскивание. */
import { autoSeconds, createRow, newId, timeline, type Row } from '../core/doc';
import * as ops from '../core/ops';
import { parseTime, formatTime } from '../core/time';
import type { Focus, FocusField, Store } from '../core/store';
import { t } from '../i18n';
import { spliceText, toEditorHtml } from '../core/richtext';
import { getOffsets, isCanonical, parseRich, setOffsets } from './richdom';

type RowAction = 'add' | 'dup' | 'up' | 'down' | 'del';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function rowHTML(r: Row, i: number, readOnly = false): string {
  const n = i + 1;
  const edit = (f: 'video' | 'audio', ph: string, label: string, html: string) =>
    `<div class="edit" data-f="${f}" contenteditable="${readOnly ? 'false' : 'true'}" role="textbox" aria-multiline="true" spellcheck="true" data-placeholder="${esc(ph)}" aria-label="${esc(label)}">${html}</div>`;
  const ico = (name: string) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const btn = (act: RowAction, glyph: string, hintKey: string, cls = '') =>
    `<button type="button" data-act="${act}" ${cls ? `class="${cls}" ` : ''}title="${esc(t(hintKey))}" aria-label="${esc(t(hintKey))}">${glyph}</button>`;
  return (
    `<div class="row" data-id="${r.id}">` +
    `<div class="handle" title="${esc(t('row.drag'))}"><svg class="ic" aria-hidden="true"><use href="#i-grip"/></svg></div>` +
    `<div class="num"><span class="n">${n}</span><span class="tc"></span></div>` +
    `<div class="cell c-video">${edit('video', t('row.videoPh'), t('row.videoLabel', { n }), toEditorHtml(r.video, r.videoFmt))}</div>` +
    `<div class="cell c-audio">${edit('audio', t('row.audioPh'), t('row.audioLabel', { n }), toEditorHtml(r.audio, r.audioFmt))}</div>` +
    `<div class="time"><input data-f="time" inputmode="decimal" autocomplete="off" aria-label="${esc(t('row.timeLabel', { n }))}" title="${esc(t('row.timeHint'))}"></div>` +
    `<div class="acts">` +
    btn('add', ico('plus'), 'row.add') +
    btn('dup', ico('copy'), 'row.dup') +
    btn('up', ico('up'), 'row.up') +
    btn('down', ico('down'), 'row.down') +
    btn('del', ico('trash'), 'row.del', 'del') +
    `</div></div>`
  );
}

export class Editor {
  /** Вызывается после любого изменения документа, чтобы обновить панель. */
  onStats: (s: { total: number; rows: number; words: number }) => void = () => undefined;

  /** Ссылки на узлы строк (по индексу) и последние записанные тексты. */
  private refs: { tc: HTMLElement; time: HTMLInputElement; tcText: string; phText: string }[] = [];

  constructor(
    private readonly store: Store,
    private readonly rowsEl: HTMLElement,
  ) {
    this.bindInput();
    this.bindDrag();
  }

  /* ---------- Отрисовка ---------- */

  render(focus?: Focus): void {
    const { doc } = this.store;
    const ro = this.store.readOnly;
    this.rowsEl.innerHTML = doc.rows.map((r, i) => rowHTML(r, i, ro)).join('');
    const els = this.rowsEl.children;
    this.refs = [];
    doc.rows.forEach((r, i) => {
      const el = els[i] as HTMLElement;
      this.refs.push({
        tc: el.querySelector('.tc') as HTMLElement,
        time: el.querySelector('[data-f=time]') as HTMLInputElement,
        tcText: '',
        phText: '',
      });
      const ti = el.querySelector('[data-f=time]') as HTMLInputElement;
      ti.value = r.time !== null ? formatTime(r.time) : '';
      ti.classList.toggle('manual', r.time !== null);
      if (ro) ti.readOnly = true;
    });
    document.body.classList.toggle('swap', doc.swap);
    document.body.classList.toggle('readonly', ro);
    this.updateTimes();
    if (focus) this.focusCell(focus);
  }

  focusCell(focus: Focus): void {
    const el = this.rowsEl.querySelector<HTMLElement>(`[data-id="${focus.id}"] [data-f="${focus.f}"]`);
    if (!el) return;
    el.focus({ preventScroll: false });
    if (el.classList.contains('edit')) {
      // Курсор — в конец текста ячейки.
      const sel = window.getSelection();
      if (sel) {
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      }
    }
  }

  /* ---------- Форматирование ---------- */

  /** Состояние стилей в текущей ячейке (для кнопок панели); null — курсор не в ячейке текста. */
  formatState(): { b: boolean; i: boolean; u: boolean; s: boolean } | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.classList.contains('edit') || !this.rowsEl.contains(a)) return null;
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    return { b: q('bold'), i: q('italic'), u: q('underline'), s: q('strikeThrough') };
  }

  /** Применить стиль к выделению или к тексту, который будет набран дальше. Возвращает false, если курсора в ячейке нет. */
  format(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'removeFormat'): boolean {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.classList.contains('edit') || !this.rowsEl.contains(a) || this.store.readOnly) return false;
    document.execCommand(cmd); // вызывает событие input — дальше всё делает общий обработчик
    return true;
  }

  /** Таймкоды строк, подсказки автовремени и итоги. Строки в DOM не пересоздаются. */
  updateTimes(): void {
    const { doc } = this.store;
    const tl = timeline(doc);
    doc.rows.forEach((r, i) => {
      const ref = this.refs[i];
      if (!ref) return;
      // Пишем в DOM только изменившееся: лишние записи сбрасывают раскладку 1000 строк.
      const tc = formatTime(tl.starts[i]!);
      if (ref.tcText !== tc) {
        ref.tcText = tc;
        ref.tc.textContent = tc;
      }
      const ph = formatTime(autoSeconds(r, doc.wpm));
      if (ref.phText !== ph) {
        ref.phText = ph;
        ref.time.placeholder = ph;
      }
    });
    this.onStats({ total: tl.total, rows: doc.rows.length, words: tl.words });
  }

  /* ---------- Текущая ячейка ---------- */

  active(): Focus | null {
    const el = document.activeElement as HTMLElement | null;
    const row = el?.closest<HTMLElement>('.row');
    const f = el?.dataset?.f as FocusField | undefined;
    return row && f ? { id: row.dataset.id!, f } : null;
  }

  /* ---------- Действия над строками ---------- */

  act(a: RowAction, id: string, f: FocusField = 'video'): void {
    const s = this.store;
    const i = ops.indexOfRow(s.doc, id);
    if (i < 0) return;
    if (a === 'add') {
      const row = createRow();
      s.apply((d) => ops.addRowAfter(d, id, row), { focus: { id: row.id, f: 'video' } });
    } else if (a === 'dup') {
      const newRowId = newId();
      s.apply((d) => ops.duplicateRow(d, id, newRowId), { focus: { id: newRowId, f: 'video' } });
    } else if (a === 'up' || a === 'down') {
      s.apply((d) => ops.moveRowBy(d, id, a === 'up' ? -1 : 1), { focus: { id, f } });
    } else if (a === 'del') {
      const wasLast = s.doc.rows.length === 1;
      if (!s.apply((d) => ops.deleteRow(d, id), { focus: { id, f: 'video' } })) return;
      const next = s.doc.rows[wasLast ? 0 : Math.min(i, s.doc.rows.length - 1)];
      if (next) this.focusCell({ id: next.id, f: 'video' });
    }
  }

  addRowAtEnd(): void {
    const row = createRow();
    this.store.apply((d) => ops.insertRow(d, d.rows.length, row), { focus: { id: row.id, f: 'video' } });
  }

  /** Заменить выделение в ячейке строкой (Enter, вставка): модель обновляется, DOM пересобирается, курсор — после вставки. */
  private replaceSelection(el: HTMLElement, ins: string): void {
    const row = el.closest<HTMLElement>('.row');
    const f = el.dataset.f as 'video' | 'audio' | undefined;
    if (!row || !f || this.store.readOnly) return;
    const id = row.dataset.id!;
    const sel = getOffsets(el);
    const cur = sel ? sel.parsed : parseRich(el);
    const start = sel ? sel.start : cur.text.length;
    const end = sel ? sel.end : cur.text.length;
    const next = spliceText(cur.text, cur.runs, start, end, ins);
    this.store.apply((d) => ops.setRowRich(d, id, f, next.text, next.runs), { key: `${id}:${f}`, focus: { id, f }, inPlace: true });
    el.innerHTML = toEditorHtml(next.text, next.runs);
    setOffsets(el, start + ins.length);
  }

  /* ---------- Ввод ---------- */

  private bindInput(): void {
    const root = this.rowsEl;
    const s = this.store;

    root.addEventListener('input', (e) => {
      const el = e.target as HTMLElement;
      const row = el.closest<HTMLElement>('.row');
      const f = el.dataset.f as FocusField | undefined;
      if (!row || !f) return;
      const id = row.dataset.id!;
      const focus: Focus = { id, f };
      if (f === 'video' || f === 'audio') {
        const sel = getOffsets(el);
        const parsed = sel ? sel.parsed : parseRich(el);
        // После ввода браузер мог оставить div, span, символ перевода строки в тексте и т. п. — пересобираем ячейку из модели и возвращаем курсор.
        if (!isCanonical(el) || (parsed.text === '' && el.firstChild)) {
          el.innerHTML = toEditorHtml(parsed.text, parsed.runs);
          if (sel && document.activeElement === el) setOffsets(el, sel.start, sel.end);
        }
        const isFormat = (e as InputEvent).inputType?.startsWith('format') || (e as InputEvent).inputType === 'insertReplacementText';
        if (isFormat) s.breakCoalescing();
        s.apply((d) => ops.setRowRich(d, id, f, parsed.text, parsed.runs), { key: isFormat ? undefined : `${id}:${f}`, focus, inPlace: true });
        if (isFormat) s.breakCoalescing();
      } else {
        const inp = el as HTMLInputElement;
        const p = parseTime(inp.value);
        if (!p.ok) {
          inp.classList.add('bad');
          return;
        }
        inp.classList.remove('bad');
        s.apply((d) => ops.setRowTime(d, id, p.value), { key: `${id}:time`, focus, inPlace: true });
        inp.classList.toggle('manual', p.value !== null);
      }
    });

    // Enter, вставка и перетаскивание текста обрабатываем сами: так в ячейке всегда канонический DOM
    // (текст, <b><i><u><s>, <br>), а не div'ы и переводы строк, которые браузер расставляет по-своему.
    root.addEventListener('beforeinput', (e) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains('edit')) return;
      const type = e.inputType;
      if (type === 'historyUndo') {
        e.preventDefault();
        s.undo();
      } else if (type === 'historyRedo') {
        e.preventDefault();
        s.redo();
      } else if (type === 'insertParagraph' || type === 'insertLineBreak') {
        e.preventDefault();
        this.replaceSelection(el, '\n');
      } else if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'insertFromYank') {
        e.preventDefault();
        const text = (e.dataTransfer?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
        if (text) this.replaceSelection(el, text);
      }
    });

    // Уход из ячейки разрывает слияние ввода в один шаг отмены.
    root.addEventListener('focusout', (e) => {
      s.breakCoalescing();
      const el = e.target as HTMLInputElement;
      if (el.dataset?.f !== 'time') return;
      const row = el.closest<HTMLElement>('.row');
      const r = s.doc.rows.find((x) => x.id === row?.dataset.id);
      if (!r) return;
      el.classList.remove('bad');
      el.value = r.time !== null ? formatTime(r.time) : '';
    });

    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b) return;
      this.act(b.dataset.act as RowAction, b.closest<HTMLElement>('.row')!.dataset.id!);
    });

    root.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement;
      const row = el.closest<HTMLElement>('.row');
      if (!row) return;
      const id = row.dataset.id!;
      const f = (el.dataset.f as FocusField | undefined) ?? 'video';
      if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.act('add', id);
      } else if (e.altKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
        e.preventDefault();
        this.act(e.code === 'ArrowUp' ? 'up' : 'down', id, f);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyX' && f !== 'time') {
        e.preventDefault();
        this.format('strikeThrough');
      } else if (e.code === 'Enter' && f === 'time') {
        e.preventDefault();
        el.blur();
      }
    });
  }

  /* ---------- Перетаскивание (pointer events: одинаково во всех webview) ---------- */

  private bindDrag(): void {
    const root = this.rowsEl;
    let dragRow: HTMLElement | null = null;
    let target: { el: HTMLElement; before: boolean } | null = null;
    let pointerY = 0;
    let raf = 0;

    const clearMarks = () =>
      root.querySelectorAll('.drop-before,.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));

    const locate = () => {
      clearMarks();
      target = null;
      for (const el of Array.from(root.children) as HTMLElement[]) {
        if (el === dragRow) continue;
        const b = el.getBoundingClientRect();
        if (pointerY < b.top + b.height / 2) {
          target = { el, before: true };
          break;
        }
        target = { el, before: false };
      }
      if (target) target.el.classList.add(target.before ? 'drop-before' : 'drop-after');
    };

    // Автопрокрутка у края окна.
    const autoscroll = () => {
      if (!dragRow) return;
      const edge = 60;
      if (pointerY < edge) window.scrollBy(0, -Math.ceil((edge - pointerY) / 4));
      else if (pointerY > window.innerHeight - edge) window.scrollBy(0, Math.ceil((pointerY - (window.innerHeight - edge)) / 4));
      locate();
      raf = requestAnimationFrame(autoscroll);
    };

    const finish = (commit: boolean) => {
      cancelAnimationFrame(raf);
      const moved = dragRow;
      const tg = target;
      clearMarks();
      dragRow?.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      dragRow = null;
      target = null;
      if (!commit || !moved || !tg) return;
      const id = moved.dataset.id!;
      const rows = this.store.doc.rows;
      const from = rows.findIndex((r) => r.id === id);
      let to = rows.findIndex((r) => r.id === tg.el.dataset.id);
      if (from < 0 || to < 0) return;
      if (!tg.before) to++;
      if (from < to) to--;
      this.store.apply((d) => ops.moveRow(d, id, to), { focus: { id, f: 'video' } });
    };

    root.addEventListener('pointerdown', (e) => {
      const h = (e.target as HTMLElement).closest<HTMLElement>('.handle');
      if (!h || this.store.readOnly || e.button !== 0) return;
      e.preventDefault();
      dragRow = h.parentElement as HTMLElement;
      dragRow.classList.add('dragging');
      document.body.classList.add('is-dragging');
      h.setPointerCapture(e.pointerId);
      pointerY = e.clientY;
      locate();
      raf = requestAnimationFrame(autoscroll);
    });
    root.addEventListener('pointermove', (e) => {
      if (dragRow) pointerY = e.clientY;
    });
    root.addEventListener('pointerup', () => finish(true));
    root.addEventListener('pointercancel', () => finish(false));
    window.addEventListener('keydown', (e) => {
      if (dragRow && e.code === 'Escape') finish(false);
    });
  }
}
