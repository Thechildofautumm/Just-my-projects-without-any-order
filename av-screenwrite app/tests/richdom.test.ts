// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { toEditorHtml, type Run } from '../src/core/richtext';
import { isCanonical, parseRich, setOffsets, getOffsets } from '../src/ui/richdom';

const cell = (html: string): HTMLElement => {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.innerHTML = html;
  document.body.append(el);
  return el;
};
const b = (from: number, to: number): Run => ({ from, to, b: true });

describe('parseRich', () => {
  it('простой текст', () => expect(parseRich(cell('привет')).text).toBe('привет'));
  it('теги стилей превращаются в прогоны', () => {
    const p = parseRich(cell('a<b>bc</b>d<i><u>ef</u></i>'));
    expect(p.text).toBe('abcdef');
    expect(p.runs).toEqual([b(1, 3), { from: 4, to: 6, i: true, u: true }]);
  });
  it('strong, em, strike, del — синонимы', () => {
    const p = parseRich(cell('<strong>a</strong><em>b</em><strike>c</strike><del>d</del>'));
    expect(p.runs).toEqual([{ from: 0, to: 1, b: true }, { from: 1, to: 2, i: true }, { from: 2, to: 4, s: true }]);
  });
  it('<br> — перевод строки, единственная <br> в конце — заглушка', () => {
    expect(parseRich(cell('a<br>b')).text).toBe('a\nb');
    expect(parseRich(cell('a<br><br>')).text).toBe('a\n');
    expect(parseRich(cell('<br>')).text).toBe('');
    expect(parseRich(cell('a<br><br><br>')).text).toBe('a\n\n');
  });
  it('div и p (после вставки браузером) дают переводы строк', () => {
    expect(parseRich(cell('a<div>b</div><div>c</div>')).text).toBe('a\nb\nc');
    expect(parseRich(cell('<div>a</div>b')).text).toBe('a\nb');
    expect(parseRich(cell('a<div><br></div><div>b</div>')).text).toBe('a\n\nb');
  });
  it('неразрывные пробелы и невидимые символы нормализуются', () => expect(parseRich(cell('a b​c')).text).toBe('a bc'));
  it('inline-стили (font-weight, text-decoration) учитываются', () => {
    const p = parseRich(cell('<span style="font-weight: 700">a</span><span style="text-decoration: underline">b</span>'));
    expect(p.runs).toEqual([b(0, 1), { from: 1, to: 2, u: true }]);
  });
  it('круговой обход: модель → HTML → модель', () => {
    const text = 'Первая\nвторая <строка> & ещё\n';
    const runs: Run[] = [b(0, 6), { from: 7, to: 13, i: true, u: true }];
    const p = parseRich(cell(toEditorHtml(text, runs)));
    expect(p.text).toBe(text);
    expect(p.runs).toEqual(runs);
  });
});

describe('isCanonical', () => {
  it('канонический вид', () => {
    expect(isCanonical(cell('a<b>b</b><br>c<br>'))).toBe(true);
    expect(isCanonical(cell(''))).toBe(true);
  });
  it('div, span, font, «\\n» в тексте, nbsp — нет', () => {
    for (const h of ['<div>a</div>', '<span>a</span>', '<font>a</font>', 'a\nb', 'a b', '<b style="x:y">a</b>']) expect(isCanonical(cell(h)), h).toBe(false);
  });
});

describe('смещения выделения', () => {
  it('setOffsets → getOffsets возвращает то же', () => {
    const el = cell(toEditorHtml('abc\ndef', [b(1, 2)]));
    for (const [s, e] of [[0, 0], [2, 2], [3, 3], [4, 4], [1, 6], [7, 7]] as const) {
      setOffsets(el, s, e);
      const got = getOffsets(el)!;
      expect([got.start, got.end], `${s}-${e}`).toEqual([s, e]);
    }
  });
  it('курсор в конец текста с завершающим переводом строки ставится перед заглушкой', () => {
    const el = cell(toEditorHtml('abc\n', []));
    setOffsets(el, 4);
    const sel = window.getSelection()!;
    expect(sel.anchorNode).toBe(el);
    expect(sel.anchorOffset).toBe(el.childNodes.length - 1); // перед последней <br>
    expect(getOffsets(el)!.start).toBe(4);
  });
});
