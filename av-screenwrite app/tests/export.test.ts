import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createDoc, createRow, type Doc } from '../src/core/doc';
import { buildModel, exportFileName } from '../src/export/model';
import { wrapText } from '../src/export/wrap';
import { exportPdf } from '../src/export/pdf';
import { exportDocx } from '../src/export/docx';

const font = new Uint8Array(readFileSync(new URL('../assets/fonts/PTMono-Regular.ttf', import.meta.url)));

const mkDoc = (rows: Partial<{ video: string; audio: string; time: number | null }>[], extra: Partial<Doc> = {}): Doc => ({
  ...createDoc({ rows: 0 }),
  title: 'Ролик для выставки',
  author: 'Анна Ёжикова',
  date: '11.11.2026',
  rows: rows.map((r) => createRow(r)),
  ...extra,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i % 7}`).join(' ');

describe('модель экспорта', () => {
  it('пропускает полностью пустые строки и нумерует остальные подряд', () => {
    const m = buildModel(mkDoc([{ video: 'a' }, {}, { audio: 'б' }, { video: '  ', audio: '\n' }, { time: 5 }]));
    expect(m.rows.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(m.rows[2]!.time).toBe('0:05');
  });
  it('учитывает порядок колонок', () => {
    const d = mkDoc([{ video: 'кадр', audio: 'звук' }]);
    expect(buildModel(d).rows[0]!.cells.map((c) => c.text)).toEqual(['кадр', 'звук']);
    expect(buildModel(d).headers).toEqual(['№', 'ВИДЕО', 'ЗВУК', 'Время']);
    const s = buildModel({ ...d, swap: true });
    expect(s.rows[0]!.cells.map((c) => c.text)).toEqual(['звук', 'кадр']);
    expect(s.headers).toEqual(['№', 'ЗВУК', 'ВИДЕО', 'Время']);
  });
  it('таймкоды и общий хронометраж', () => {
    const m = buildModel(mkDoc([{ audio: words(130) }, { video: 'x', time: 7 }, { audio: words(65) }]));
    expect(m.rows.map((r) => r.tc)).toEqual(['0:00', '1:00', '1:07']);
    expect(m.total).toBe('1:37');
    expect(m.metaLine).toBe('Автор: Анна Ёжикова    Дата: 11.11.2026    Хронометраж: 1:37');
  });
  it('без названия, автора и даты', () => {
    const m = buildModel(mkDoc([{ video: 'a' }], { title: ' ', author: '', date: '' }));
    expect(m.title).toBe('Без названия');
    expect(m.metaLine).toBe('Хронометраж: 0:00');
  });
  it('имя файла без запрещённых символов', () => {
    expect(exportFileName(mkDoc([]), 'pdf')).toBe('Ролик для выставки.pdf');
    expect(exportFileName(mkDoc([], { title: 'a/b:c*?"<>|.' }), 'docx')).toBe('a_b_c_.docx');
    expect(exportFileName(mkDoc([], { title: '' }), 'pdf')).toBe('scenariy.pdf');
  });
});

describe('перенос текста', () => {
  const m = (s: string) => s.length; // моноширинный: 1 символ = 1 единица
  it('по словам', () => expect(wrapText('раз два три четыре', 9, m)).toEqual(['раз два', 'три', 'четыре']));
  it('сохраняет переводы строк и пустые строки', () => expect(wrapText('а\n\nб', 10, m)).toEqual(['а', '', 'б']));
  it('режет слишком длинное слово', () => expect(wrapText('абвгдежзик', 4, m)).toEqual(['абвг', 'дежз', 'ик']));
  it('пустой текст — одна пустая строка', () => expect(wrapText('', 10, m)).toEqual(['']));
  it('ни одна строка не длиннее лимита', () => {
    const lines = wrapText(words(80) + ' ' + 'я'.repeat(50), 17, m);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(17);
    expect(lines.join(' ').replace(/\s+/g, '')).toBe((words(80) + 'я'.repeat(50)).replace(/\s+/g, ''));
  });
});

/** Текст каждой страницы PDF по строкам (pdf.js — только в тестах). */
async function pdfPages(bytes: Uint8Array): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise;
  const out: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).filter(Boolean));
  }
  return out;
}

describe('PDF', () => {
  const long = mkDoc(
    Array.from({ length: 60 }, (_, i) => ({ video: `Кадр ${i + 1}: общий план цеха, станки и люди`, audio: `Диктор читает текст номер ${i + 1}. ${words(25)}` })),
  );

  it('кириллица читается из файла, шапка и номера страниц на каждой странице', async () => {
    const bytes = await exportPdf(long, font);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const pages = await pdfPages(bytes);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const [i, p] of pages.entries()) {
      expect(p).toContain('ВИДЕО');
      expect(p).toContain('ЗВУК');
      expect(p).toContain('Время');
      expect(p).toContain(`${i + 1} / ${pages.length}`);
    }
    expect(pages[0]).toContain('Ролик для выставки');
    expect(pages[0]!.join(' ')).toContain('Автор: Анна Ёжикова');
    const all = pages.flat().join(' ');
    expect(all).toContain('Кадр 1: общий план цеха');
    expect(all).toContain('Кадр 60');
    expect(all).not.toContain('?');
  });

  it('геометрия: текст в границах полей, колонки не налезают друг на друга', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: (await exportPdf(long, font)).slice() }).promise;
    const MARGIN = (14 * 72) / 25.4;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const [, , pw, ph] = page.view;
      const items = (await page.getTextContent()).items.flatMap((it) =>
        'str' in it && it.str.trim() ? [{ s: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height }] : [],
      );
      for (const it of items) {
        expect(it.x, it.s).toBeGreaterThanOrEqual(MARGIN - 0.5);
        expect(it.x + it.w, it.s).toBeLessThanOrEqual(pw! - MARGIN + 0.5);
        expect(it.y, it.s).toBeGreaterThan(MARGIN * 0.4);
        expect(it.y, it.s).toBeLessThan(ph! - MARGIN + 1);
      }
      // Нет пересечений: два фрагмента на одной высоте не должны перекрываться по горизонтали.
      for (let a = 0; a < items.length; a++) {
        for (let b = a + 1; b < items.length; b++) {
          const p = items[a]!;
          const q = items[b]!;
          if (Math.abs(p.y - q.y) < 2) {
            const overlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
            expect(overlap, `${p.s} / ${q.s}`).toBeLessThanOrEqual(0.5);
          }
        }
      }
    }
  });

  it('A4 и Letter различаются размером страницы', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const a4 = await PDFDocument.load(await exportPdf(long, font, { paper: 'a4' }));
    const lt = await PDFDocument.load(await exportPdf(long, font, { paper: 'letter' }));
    expect(Math.round(a4.getPage(0).getWidth())).toBe(595);
    expect(Math.round(lt.getPage(0).getWidth())).toBe(612);
  });

  it('порядок колонок: при swap «ЗВУК» левее «ВИДЕО»', async () => {
    const pages = await pdfPages(await exportPdf({ ...long, swap: true }, font));
    const p = pages[0]!;
    expect(p.indexOf('ЗВУК')).toBeLessThan(p.indexOf('ВИДЕО'));
  });

  it('строка выше страницы разбивается и ничего не теряется', async () => {
    const huge = mkDoc([{ video: 'начало', audio: Array.from({ length: 400 }, (_, i) => `строка${i}`).join('\n') }, { video: 'следом' }]);
    const pages = await pdfPages(await exportPdf(huge, font));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const all = pages.flat().join(' ');
    expect(all).toContain('строка0');
    expect(all).toContain('строка399');
    expect(all).toContain('следом');
  });

  it('пустой документ и неизвестные символы не ломают экспорт', async () => {
    const empty = await pdfPages(await exportPdf(mkDoc([{}, {}]), font));
    expect(empty).toHaveLength(1);
    const odd = await pdfPages(await exportPdf(mkDoc([{ video: 'смайл 😀 и иероглиф 漢 и \u0007 управляющий' }]), font));
    expect(odd.flat().join(' ')).toContain('смайл');
  });
});

describe('PDF: буквы реально нарисованы (pdfium — движок Chrome и Edge)', () => {
  it('каждая буква кириллицы даёт чернила в своей ячейке', async () => {
    const { PDFiumLibrary } = await import('@hyzyla/pdfium');
    const fk = (await import('@pdf-lib/fontkit')).default as unknown as { create: (b: Buffer) => { unitsPerEm: number; layout: (s: string) => { glyphs: { advanceWidth: number }[] } } };
    const f = fk.create(Buffer.from(font));
    const adv = (f.layout('Ш').glyphs[0]!.advanceWidth / f.unitsPerEm) * 10; // шаг символа при 10 pt

    const lines = ['АБВГДЕЁЖЗИЙКЛМНО', 'ПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмно', 'прстуфхцчшщъыьэюя'];
    const bytes = await exportPdf(mkDoc(lines.map((video) => ({ video }))), font);

    const lib = await PDFiumLibrary.init();
    try {
      const SCALE = 4;
      const page = (await lib.loadDocument(bytes)).getPage(0);
      const img = await page.render({ scale: SCALE, render: 'bitmap' });
      const { width, height, data } = img;
      const ink = (x: number, y: number) => data[(y * width + x) * 4 + 1]! < 128; // зелёный канал: тёмный пиксель

      // Колонка «Видео»: от 9 % до 50 % ширины контента.
      const mm = SCALE * (72 / 25.4);
      const contentW = width - 2 * 14 * mm;
      const x0 = Math.round(14 * mm + 0.09 * contentW) + 2;
      const x1 = Math.round(14 * mm + 0.5 * contentW) - 2;

      // Полосы текста по вертикали; длинные линии таблицы (почти вся ширина) — не текст.
      const bands: [number, number][] = [];
      let start = -1;
      for (let y = 0; y < height; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) if (ink(x, y)) n++;
        const text = n > 0 && n < (x1 - x0) * 0.8;
        if (text && start < 0) start = y;
        if (!text && start >= 0) {
          bands.push([start, y]);
          start = -1;
        }
      }
      // Строки таблицы — последние 4 полосы выше нижнего поля (дальше только номер страницы, выше — название и шапка).
      const rows = bands.filter(([ya]) => ya < height - 14 * mm).slice(-lines.length);
      expect(rows).toHaveLength(lines.length);

      rows.forEach(([ya, yb], r) => {
        const cols: number[] = [];
        for (let x = x0; x < x1; x++) {
          let n = 0;
          for (let y = ya; y < yb; y++) if (ink(x, y)) n++;
          cols.push(n);
        }
        const first = cols.findIndex((n) => n > 0);
        for (let i = 0; i < lines[r]!.length; i++) {
          const from = Math.round(first + i * adv * SCALE);
          const to = Math.round(first + (i + 1) * adv * SCALE);
          const sum = cols.slice(from, to).reduce((a, b) => a + b, 0);
          expect(sum, `буква «${lines[r]![i]}» (строка ${r + 1}) не нарисована`).toBeGreaterThan(40); // у нарисованной буквы в ячейке 100+ тёмных пикселей
        }
      });
    } finally {
      lib.destroy();
    }
  }, 60_000);
});

describe('DOCX', () => {
  const doc = mkDoc([{ video: 'Общий план цеха', audio: '(МУЗЫКА) Каждый день\nздесь кипит работа' }, {}, { video: 'Второй <кадр> & "всё"', time: 7 }]);

  it('настоящая таблица Word с повторяющейся шапкой и нужными колонками', async () => {
    const zip = await JSZip.loadAsync(await exportDocx(doc, font));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader');
    expect(xml.match(/<w:tr[ >]/g)).toHaveLength(3); // шапка + 2 непустые строки
    const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(grid).toHaveLength(4);
    const sum = grid.reduce((a, b) => a + b, 0);
    expect(grid.map((g) => Math.round((g / sum) * 100))).toEqual([9, 41, 41, 9]);
    expect(xml).toContain('Общий план цеха');
    expect(xml).toContain('(МУЗЫКА) Каждый день');
    expect(xml).toContain('Второй &lt;кадр&gt; &amp;');
    expect(xml).toContain('Ролик для выставки');
    expect(xml).toContain('Автор: Анна Ёжикова');
    expect(xml).toContain('ВИДЕО');
  });

  it('шрифт PT Mono вшит в файл', async () => {
    const zip = await JSZip.loadAsync(await exportDocx(doc, font));
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.startsWith('word/fonts/'))).toBe(true);
    const fontTable = await zip.file('word/fontTable.xml')!.async('string');
    expect(fontTable).toContain('PT Mono');
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('PT Mono');
  });

  it('при swap «ЗВУК» идёт первой колонкой', async () => {
    const zip = await JSZip.loadAsync(await exportDocx({ ...doc, swap: true }, font));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.indexOf('ЗВУК')).toBeLessThan(xml.indexOf('ВИДЕО'));
  });
});

