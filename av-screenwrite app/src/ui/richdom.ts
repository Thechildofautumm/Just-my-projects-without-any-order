/**
 * Мост между DOM ячейки (contenteditable) и моделью «текст + прогоны оформления».
 * Источник правды — модель: DOM всегда можно перестроить из неё (toEditorHtml),
 * а после ввода браузером — снова разобрать обратно (parseRich).
 */
import { normalizeRuns, type Run } from '../core/richtext';

export interface Parsed {
  text: string;
  runs: Run[];
  /** Смещения в тексте для переданных позиций выделения (в том же порядке). */
  offsets: number[];
}

export interface Pos {
  node: Node | null;
  offset: number;
}

const BLOCKS = new Set(['div', 'p', 'li', 'ul', 'ol', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table']);

function styleMask(el: HTMLElement, tag: string): number {
  let m = 0;
  if (tag === 'b' || tag === 'strong') m |= 1;
  if (tag === 'i' || tag === 'em') m |= 2;
  if (tag === 'u') m |= 4;
  if (tag === 's' || tag === 'strike' || tag === 'del') m |= 8;
  const st = el.style;
  if (st) {
    const w = st.fontWeight;
    if (w === 'bold' || w === 'bolder' || (w && Number(w) >= 600)) m |= 1;
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') m |= 2;
    const d = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`;
    if (d.includes('underline')) m |= 4;
    if (d.includes('line-through')) m |= 8;
  }
  return m;
}

/** Разобрать содержимое ячейки в текст и оформление. */
export function parseRich(root: HTMLElement, positions: Pos[] = []): Parsed {
  let text = '';
  const raw: Run[] = [];
  const offsets: number[] = positions.map(() => -1);
  let pendingBreak = false;

  const mark = (node: Node, index: number) => {
    positions.forEach((p, k) => {
      if (offsets[k]! < 0 && p.node === node && p.offset === index) offsets[k] = text.length;
    });
  };

  const emit = (s: string, m: number) => {
    if (!s) return;
    if (pendingBreak && text && !text.endsWith('\n')) text += '\n';
    pendingBreak = false;
    const from = text.length;
    text += s;
    if (m) raw.push({ from, to: text.length, ...(m & 1 ? { b: true as const } : {}), ...(m & 2 ? { i: true as const } : {}), ...(m & 4 ? { u: true as const } : {}), ...(m & 8 ? { s: true as const } : {}) });
  };

  const walk = (node: Node, m: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data.replace(/ /g, ' ').replace(/​/g, '');
      positions.forEach((p, k) => {
        if (offsets[k]! < 0 && p.node === node) {
          const before = (node as Text).data.slice(0, p.offset).replace(/​/g, '').length;
          offsets[k] = text.length + (pendingBreak && text && !text.endsWith('\n') ? 1 : 0) + before;
        }
      });
      emit(data, m);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      // Единственный <br> в самом конце ячейки — заглушка браузера, а не перевод строки.
      if (el.parentNode === root && el === root.lastChild) return;
      pendingBreak = false;
      text += '\n';
      return;
    }
    const block = BLOCKS.has(tag);
    if (block && text && !text.endsWith('\n')) text += '\n';
    const nm = m | styleMask(el, tag);
    const kids = el.childNodes;
    for (let k = 0; k < kids.length; k++) {
      mark(el, k);
      walk(kids[k]!, nm);
    }
    mark(el, kids.length);
    if (block) pendingBreak = true;
  };

  const kids = root.childNodes;
  for (let k = 0; k < kids.length; k++) {
    mark(root, k);
    walk(kids[k]!, 0);
  }
  mark(root, kids.length);
  return { text, runs: normalizeRuns(raw, text.length), offsets: offsets.map((o) => (o < 0 ? text.length : o)) };
}

/**
 * Канонический ли вид DOM: только текст без переводов строк внутри, <b><i><u><s> и <br>.
 * Всё остальное (div, span, font, «\n» в тексте) после ввода пересобирается из модели.
 */
export function isCanonical(root: HTMLElement): boolean {
  const ok = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const d = (node as Text).data;
      return !d.includes('\n') && !d.includes(' ') && !d.includes('​');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return !el.hasChildNodes();
    if (tag !== 'b' && tag !== 'i' && tag !== 'u' && tag !== 's') return false;
    if (el.getAttribute('style')) return false;
    return Array.from(el.childNodes).every(ok);
  };
  return Array.from(root.childNodes).every(ok);
}

/** Текущее выделение внутри ячейки в смещениях текста; null — выделение вне ячейки. */
export function getOffsets(root: HTMLElement): { start: number; end: number; parsed: Parsed } | null {
  const sel = root.ownerDocument.defaultView?.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
  const parsed = parseRich(root, [
    { node: sel.anchorNode, offset: sel.anchorOffset },
    { node: sel.focusNode, offset: sel.focusOffset },
  ]);
  const [a, f] = parsed.offsets as [number, number];
  return { start: Math.min(a, f), end: Math.max(a, f), parsed };
}

/** Поставить выделение по смещениям текста в каноническом DOM ячейки. */
export function setOffsets(root: HTMLElement, start: number, end: number = start): void {
  const doc = root.ownerDocument;
  const sel = doc.defaultView?.getSelection();
  if (!sel) return;
  const find = (target: number): { node: Node; offset: number } => {
    let pos = 0;
    let found: { node: Node; offset: number } | null = null;
    const visit = (node: Node) => {
      if (found) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node as Text).data.length;
        if (target <= pos + len) found = { node, offset: target - pos };
        pos += len;
        return;
      }
      const el = node as HTMLElement;
      if (el.tagName === 'BR') {
        if (el.parentNode === root && el === root.lastChild) return; // заглушка
        const idx = Array.prototype.indexOf.call(el.parentNode!.childNodes, el) as number;
        if (target <= pos) found = { node: el.parentNode!, offset: idx };
        pos += 1;
        return;
      }
      el.childNodes.forEach(visit);
    };
    root.childNodes.forEach(visit);
    if (found) return found;
    // Конец текста: курсор ставится ПЕРЕД <br>-заглушкой, иначе набранный текст окажется после неё.
    const last = root.lastChild;
    const idx = last && last.nodeName === 'BR' ? root.childNodes.length - 1 : root.childNodes.length;
    return { node: root, offset: idx };
  };
  const a = find(start);
  const b = end === start ? a : find(end);
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}
