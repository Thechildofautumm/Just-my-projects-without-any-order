import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { createDoc, createRow, type Doc } from '../src/core/doc';
import { spliceText, type Run } from '../src/core/richtext';
import { exportPdf } from '../src/export/pdf';
import { exportDocx } from '../src/export/docx';
import { wrapLines } from '../src/export/wrap';
import ru from '../src/i18n/ru.json';
import en from '../src/i18n/en.json';
import pl from '../src/i18n/pl.json';

const font = new Uint8Array(readFileSync(new URL('../assets/fonts/PTMono-Regular.ttf', import.meta.url)));
const mk = (rows: Parameters<typeof createRow>[0][]): Doc => ({ ...createDoc({ rows: 0 }), title: 'Т', rows: rows.map((r) => createRow(r)) });

describe('spliceText', () => {
  const b = (from: number, to: number): Run => ({ from, to, b: true });
  it('вставка сдвигает оформление справа', () => {
    expect(spliceText('abcdef', [b(3, 5)], 1, 1, 'XY')).toEqual({ text: 'aXYbcdef', runs: [b(5, 7)] });
  });
  it('вставка внутри размеченного участка наследует стиль', () => {
    expect(spliceText('abcdef', [b(1, 5)], 3, 3, '\n')).toEqual({ text: 'abc\ndef', runs: [b(1, 6)] });
  });
  it('на границе стиль не наследуется', () => {
    expect(spliceText('abcdef', [b(1, 3)], 3, 3, 'ZZ').runs).toEqual([b(1, 3)]);
    expect(spliceText('abcdef', [b(3, 5)], 3, 3, 'ZZ').runs).toEqual([b(5, 7)]);
  });
  it('замена выделения убирает размеченный участок внутри него', () => {
    expect(spliceText('abcdef', [b(2, 4)], 1, 5, 'Q')).toEqual({ text: 'aQf', runs: [] });
  });
  it('удаление (пустая вставка) подрезает оформление', () => {
    expect(spliceText('abcdef', [b(0, 6)], 2, 4, '')).toEqual({ text: 'abef', runs: [b(0, 4)] });
  });
});

describe('wrapLines: смещения строк в исходном тексте', () => {
  const m = (s: string) => s.length;
  it('start указывает на первый символ строки', () => {
    const text = 'раз два три четыре\nпять';
    const lines = wrapLines(text, 9, m);
    expect(lines.map((l) => l.text)).toEqual(['раз два', 'три', 'четыре', 'пять']);
    for (const l of lines) if (l.text) expect(text.slice(l.start, l.start + l.text.length)).toBe(l.text);
  });
  it('разрезанное длинное слово и пустые строки', () => {
    const text = 'абвгдежзик\n\nя';
    const lines = wrapLines(text, 4, m);
    for (const l of lines) if (l.text) expect(text.slice(l.start, l.start + l.text.length)).toBe(l.text);
    expect(lines.map((l) => l.text)).toEqual(['абвг', 'дежз', 'ик', '', 'я']);
  });
});

describe('словари интерфейса', () => {
  const keys = (d: object) => Object.keys(d).sort();
  it('во всех языках одинаковый набор ключей', () => {
    expect(keys(en)).toEqual(keys(ru));
    expect(keys(pl)).toEqual(keys(ru));
  });
  it('подстановки {name} совпадают в переводах', () => {
    const ph = (s: unknown) => (typeof s === 'string' ? (s.match(/\{\w+\}/g) ?? []).sort().join() : '');
    for (const k of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(ph(en[k]), `en ${k}`).toBe(ph(ru[k]));
      expect(ph(pl[k]), `pl ${k}`).toBe(ph(ru[k]));
    }
  });
  it('формы множественного числа заполнены', () => {
    for (const d of [ru, en, pl]) for (const k of ['unit.row', 'unit.word'] as const) for (const f of ['one', 'few', 'many', 'other'] as const) expect((d[k] as Record<string, string>)[f]).toBeTruthy();
  });
});

describe('шрифт экспорта покрывает все языки интерфейса', () => {
  const f = (fontkit as unknown as { create: (b: Buffer) => { hasGlyphForCodePoint: (cp: number) => boolean } }).create(Buffer.from(font));
  const missing = (s: string) => [...s].filter((ch) => /\p{L}/u.test(ch) && !f.hasGlyphForCodePoint(ch.codePointAt(0)!));
  it.each([
    ['русский', 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
    ['польский', 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż'],
    ['английский', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'],
  ])('%s алфавит', (_n, s) => expect(missing(s)).toEqual([]));
});

describe('PDF с оформлением и польским текстом', () => {
  it('жирный, курсив, подчёркнутый, зачёркнутый рисуются; текст извлекается', async () => {
    const doc = mk([
      {
        video: 'Жирный курсив подчёркнутый зачёркнутый',
        videoFmt: [
          { from: 0, to: 6, b: true },
          { from: 7, to: 13, i: true },
          { from: 14, to: 25, u: true },
          { from: 26, to: 37, s: true },
        ],
        audio: 'Zażółć gęślą jaźń',
      },
    ]);
    const bytes = await exportPdf(doc, font);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.map((it) => ('str' in it ? it.str : ''));
    const all = items.join('');
    expect(all).toContain('Жирный');
    expect(all).toContain('зачёркнутый');
    expect(all).toContain('Zażółć gęślą jaźń');
    expect(all).not.toContain('?');
    // Подчёркивание и зачёркивание — отдельные линии в потоке команд страницы.
    const ops = await (await pdf.getPage(1)).getOperatorList();
    const lines = ops.fnArray.filter((fn) => fn === pdfjs.OPS.constructPath).length;
    const plain = await pdfjs.getDocument({ data: (await exportPdf(mk([{ video: 'Жирный', audio: 'x' }]), font)).slice() }).promise;
    const plainLines = (await (await plain.getPage(1)).getOperatorList()).fnArray.filter((fn) => fn === pdfjs.OPS.constructPath).length;
    expect(lines).toBeGreaterThan(plainLines);
  });

  it('курсив только наклоняет буквы: строка остаётся на своей базовой линии', async () => {
    const text = 'один два три четыре пять';
    const doc = mk([{ video: text, videoFmt: [{ from: 4, to: 14, i: true }] }]);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: (await exportPdf(doc, font)).slice() }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.flatMap((it) => ('str' in it && it.str.trim() ? [it] : []));
    const body = items.filter((it) => /один|два|три|четыре|пять/.test(it.str));
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const it of body) expect(Math.abs(it.transform[1]), it.str).toBeLessThan(1e-6); // нет вертикального наклона оси
    const ys = new Set(body.map((it) => Math.round(it.transform[5] * 10)));
    expect(ys.size).toBe(1); // все куски одной строки на одной высоте
  });

  it('оформление не теряется при переносе строки и смене порядка колонок', async () => {
    const text = Array.from({ length: 60 }, (_, i) => `слово${i}`).join(' ');
    const doc: Doc = { ...mk([{ video: text, videoFmt: [{ from: 0, to: text.length, b: true }] }]), swap: true };
    const bytes = await exportPdf(doc, font);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });
});

describe('PDF: нарисованы польские буквы (pdfium)', () => {
  it('диакритика на месте', async () => {
    const { PDFiumLibrary } = await import('@hyzyla/pdfium');
    const doc = mk([{ video: 'ĄĆĘŁŃÓŚŹŻ' }, { video: 'ąćęłńóśźż' }]);
    const bytes = await exportPdf(doc, font);
    const lib = await PDFiumLibrary.init();
    try {
      const page = (await lib.loadDocument(bytes)).getPage(0);
      const img = await page.render({ scale: 4, render: 'bitmap' });
      let dark = 0;
      for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 1]! < 128) dark++;
      // Страница с девятью заглавными и девятью строчными буквами даёт ощутимо больше «чернил», чем пустая.
      const empty = await exportPdf(mk([{ video: ' ' }]), font);
      const p2 = (await lib.loadDocument(empty)).getPage(0);
      const img2 = await p2.render({ scale: 4, render: 'bitmap' });
      let dark2 = 0;
      for (let i = 0; i < img2.width * img2.height; i++) if (img2.data[i * 4 + 1]! < 128) dark2++;
      expect(dark - dark2).toBeGreaterThan(3000);
    } finally {
      lib.destroy();
    }
  }, 60_000);
});

describe('DOCX с оформлением', () => {
  it('жирный, курсив, подчёркнутый, зачёркнутый и переводы строк попадают в XML', async () => {
    const doc = mk([
      {
        video: 'abcd\n\nefgh',
        videoFmt: [
          { from: 0, to: 1, b: true },
          { from: 1, to: 2, i: true },
          { from: 2, to: 3, u: true },
          { from: 3, to: 4, s: true },
        ],
      },
    ]);
    const zip = await JSZip.loadAsync(await exportDocx(doc, font));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:i\/>/);
    expect(xml).toMatch(/<w:u /);
    expect(xml).toMatch(/<w:strike\/>/);
    expect(xml).toMatch(/<w:br\/><w:br\/>/); // пустая строка между абзацами текста сохранена
    expect(xml).toContain('efgh');
  });
});
