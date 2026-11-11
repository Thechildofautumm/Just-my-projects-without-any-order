import { describe, expect, it } from 'vitest';
import { createDoc, createRow, type Doc } from '../src/core/doc';
import * as ops from '../src/core/ops';
import { Store } from '../src/core/store';
import { AVS_VERSION, parseAvs, serializeAvs } from '../src/core/avs';
import { hasStyle, mapText, normalizeRuns, segments, segmentsIn, toEditorHtml, toggleStyle, type Run } from '../src/core/richtext';

const b = (from: number, to: number): Run => ({ from, to, b: true });
const i = (from: number, to: number): Run => ({ from, to, i: true });

describe('normalizeRuns', () => {
  it('подрезает, выбрасывает пустые и склеивает соседние', () => {
    expect(normalizeRuns([b(0, 2), b(2, 5), b(7, 7), b(-3, 1)], 4)).toEqual([b(0, 4)]);
  });
  it('пересечения объединяют стили', () => {
    expect(normalizeRuns([b(0, 4), i(2, 6)], 6)).toEqual([b(0, 2), { from: 2, to: 4, b: true, i: true }, i(4, 6)]);
  });
  it('мусор и пустой текст', () => {
    expect(normalizeRuns(undefined, 5)).toEqual([]);
    expect(normalizeRuns([b(0, 3)], 0)).toEqual([]);
    expect(normalizeRuns([{ from: 0, to: 3 }], 5)).toEqual([]); // без стилей
    expect(normalizeRuns([b(Number.NaN, 3)], 5)).toEqual([]);
  });
});

describe('segments', () => {
  it('покрывают весь текст', () => {
    const segs = segments('abcdef', [b(1, 3), i(4, 5)]);
    expect(segs.map((s) => s.text).join('')).toBe('abcdef');
    expect(segs.map((s) => [s.text, s.b, s.i])).toEqual([
      ['a', false, false], ['bc', true, false], ['d', false, false], ['e', false, true], ['f', false, false],
    ]);
  });
  it('диапазон внутри текста', () => {
    expect(segmentsIn('abcdef', [b(1, 5)], 3, 6).map((s) => [s.text, s.b])).toEqual([['de', true], ['f', false]]);
  });
  it('пустой текст — нет фрагментов', () => expect(segments('', [])).toEqual([]));
});

describe('toggleStyle / hasStyle', () => {
  it('ставит и снимает стиль', () => {
    const on = toggleStyle([], 6, 1, 4, 'b');
    expect(on).toEqual([b(1, 4)]);
    expect(hasStyle(on, 1, 4, 'b')).toBe(true);
    expect(hasStyle(on, 0, 4, 'b')).toBe(false);
    expect(toggleStyle(on, 6, 1, 4, 'b')).toEqual([]);
  });
  it('если стиль есть не на всём диапазоне — сначала ставится везде', () => {
    expect(toggleStyle([b(0, 2)], 6, 0, 5, 'b')).toEqual([b(0, 5)]);
  });
  it('другие стили не затрагиваются', () => {
    const r = toggleStyle([i(0, 6)], 6, 2, 4, 'b');
    expect(r).toEqual([i(0, 2), { from: 2, to: 4, i: true, b: true }, i(4, 6)]);
    expect(toggleStyle(r, 6, 2, 4, 'b')).toEqual([i(0, 6)]);
  });
  it('пустое выделение ничего не меняет', () => expect(toggleStyle([b(0, 2)], 5, 3, 3, 'i')).toEqual([b(0, 2)]));
});

describe('mapText', () => {
  it('пересчитывает смещения при замене символов', () => {
    // «a\tb\tc»: табы → 4 пробела; жирным был «b» (1..2 после таба)
    const { text, runs } = mapText('a\tb\tc', [b(2, 3)], (ch) => (ch === '\t' ? '    ' : ch));
    expect(text).toBe('a    b    c');
    expect(runs).toEqual([b(5, 6)]);
  });
  it('суррогатные пары считаются одним символом', () => {
    const { text, runs } = mapText('x😀y', [b(1, 3)], (ch) => (ch.length > 1 ? '?' : ch));
    expect(text).toBe('x?y');
    expect(runs).toEqual([b(1, 2)]);
  });
});

describe('toEditorHtml', () => {
  it('экранирует и расставляет теги', () => {
    expect(toEditorHtml('a<b>&c', [b(1, 4)])).toBe('a<b>&lt;b&gt;</b>&amp;c');
  });
  it('переводы строк — <br>, завершающий — с заглушкой', () => {
    expect(toEditorHtml('a\nb', [])).toBe('a<br>b');
    expect(toEditorHtml('a\n', [])).toBe('a<br><br>');
    expect(toEditorHtml('', [])).toBe('');
  });
  it('вложенные стили', () => {
    expect(toEditorHtml('ab', [{ from: 0, to: 2, b: true, i: true, u: true, s: true }])).toBe('<b><i><u><s>ab</s></u></i></b>');
  });
});

describe('команды оформления и отмена', () => {
  const mk = () => {
    const doc: Doc = { ...createDoc({ rows: 0 }), rows: [createRow({ video: 'кадр', audio: 'раз два три' })] };
    return { s: new Store(doc), id: doc.rows[0]!.id };
  };
  it('setRowRich применяется, отменяется и повторяется', () => {
    const { s, id } = mk();
    const before = s.doc;
    expect(s.apply((d) => ops.setRowRich(d, id, 'audio', 'раз два три', [b(0, 3)]))).toBe(true);
    expect(s.doc.rows[0]!.audioFmt).toEqual([b(0, 3)]);
    expect(s.undo()).toBe(true);
    expect(s.doc).toBe(before);
    s.redo();
    expect(s.doc.rows[0]!.audioFmt).toEqual([b(0, 3)]);
  });
  it('то же оформление — не шаг истории', () => {
    const { s, id } = mk();
    expect(s.apply((d) => ops.setRowRich(d, id, 'video', 'кадр', []))).toBe(false);
  });
  it('оформление подрезается, когда текст стал короче', () => {
    const { s, id } = mk();
    s.apply((d) => ops.setRowRich(d, id, 'audio', 'раз два три', [b(4, 11)]));
    s.apply((d) => ops.setRowText(d, id, 'audio', 'раз два'));
    expect(s.doc.rows[0]!.audioFmt).toEqual([b(4, 7)]);
    s.apply((d) => ops.setRowText(d, id, 'audio', 'раз'));
    expect(s.doc.rows[0]!.audioFmt).toEqual([]);
  });
  it('оформление не влияет на подсчёт слов и время', async () => {
    const { rowWords } = await import('../src/core/doc');
    const { s, id } = mk();
    const w = rowWords(s.doc.rows[0]!);
    s.apply((d) => ops.setRowRich(d, id, 'audio', 'раз два три', [b(0, 11)]));
    expect(rowWords(s.doc.rows[0]!)).toBe(w);
  });
});

describe('формат .avs версии 2', () => {
  it('оформление сохраняется и читается', () => {
    const doc: Doc = {
      ...createDoc({ rows: 0 }),
      title: 'Т',
      rows: [createRow({ video: 'кадр', audio: 'Привет, мир', audioFmt: [b(0, 6), i(7, 11)] })],
    };
    const text = serializeAvs(doc);
    const json = JSON.parse(text);
    expect(json.version).toBe(AVS_VERSION);
    expect(json.rows[0].audioFmt).toEqual([b(0, 6), i(7, 11)]);
    expect(json.rows[0].videoFmt).toBeUndefined(); // пустое оформление не пишется
    const res = parseAvs(text);
    expect(res.ok && res.doc).toEqual(doc);
  });
  it('файлы версии 1 открываются без оформления и без ошибок', () => {
    const res = parseAvs(JSON.stringify({ format: 'av-scenariy', version: 1, rows: [{ id: 'a', video: 'v', audio: 'a', time: null }] }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.readOnly).toBe(false);
      expect(res.doc.rows[0]!.audioFmt).toEqual([]);
    }
  });
  it('битое оформление отбрасывается, а не ломает файл', () => {
    const res = parseAvs(JSON.stringify({ rows: [{ audio: 'abc', audioFmt: [{ from: 'x' }, 5, { from: 1, to: 99, b: true }, { from: 2, to: 1, i: true }] }] }));
    expect(res.ok && res.doc.rows[0]!.audioFmt).toEqual([b(1, 3)]);
    const notArr = parseAvs(JSON.stringify({ rows: [{ audio: 'abc', audioFmt: 'oops' }] }));
    expect(notArr.ok && notArr.doc.rows[0]!.audioFmt).toEqual([]);
  });
  it('версия новее текущей — только чтение', () => {
    const res = parseAvs(JSON.stringify({ format: 'av-scenariy', version: AVS_VERSION + 1, rows: [{}] }));
    expect(res.ok && res.readOnly).toBe(true);
  });
});
