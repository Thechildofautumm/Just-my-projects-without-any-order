/** PDF через pdf-lib со вшитым шрифтом (кириллица) — без окна печати. */
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Doc } from '../core/doc';
import { mapText, segmentsIn, type Run } from '../core/richtext';
import { buildModel, COLUMN_SHARES, RU_LABELS, type ExportCell, type ExportLabels, type ExportRow } from './model';
import { wrapLines, wrapText } from './wrap';

export type Paper = 'a4' | 'letter';

const PAPER_PT: Record<Paper, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MM = 72 / 25.4;
const MARGIN = 14 * MM;

const BODY = 10;
const LEADING = 14;
const PAD_X = 5;
const PAD_Y = 4;
const TC_SIZE = 8;

const INK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const RULE = rgb(0.6, 0.6, 0.6);

export interface PdfOptions {
  paper?: Paper;
  labels?: ExportLabels;
}

/**
 * Посимвольная замена: символы, которых нет в шрифте, становятся «?» (иначе pdf-lib падает на неизвестном глифе),
 * управляющие удаляются, табуляция — четыре пробела.
 */
function charMapper(font: PDFFont): (ch: string) => string {
  const have = new Set(font.getCharacterSet());
  return (ch) => {
    if (ch === '\n') return ch;
    if (ch === '\t') return '    ';
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return '';
    return have.has(cp) ? ch : '?';
  };
}

const FAKE_BOLD = 0.35; // сдвиг второго прохода: у PT Mono есть только обычное начертание
const ITALIC_DEG = 12;

/** Нарисовать фрагменты строки с оформлением: жирный (двойной проход), курсив (наклон), подчёркивание, зачёркивание. */
function drawSegments(
  page: PDFPage,
  font: PDFFont,
  segs: ReturnType<typeof segmentsIn>,
  x0: number,
  baseline: number,
  size: number,
  color = INK,
): void {
  let x = x0;
  for (const seg of segs) {
    const w = font.widthOfTextAtSize(seg.text, size);
    if (seg.text.trim()) {
      const opts = { y: baseline, size, font, color, ...(seg.i ? { ySkew: degrees(ITALIC_DEG) } : {}) }; // ySkew — сдвиг по горизонтали (наклон букв); xSkew поднимал бы текст
      page.drawText(seg.text, { ...opts, x });
      if (seg.b) page.drawText(seg.text, { ...opts, x: x + FAKE_BOLD });
    }
    if (seg.u) page.drawLine({ start: { x, y: baseline - size * 0.14 }, end: { x: x + w, y: baseline - size * 0.14 }, thickness: size * 0.06, color });
    if (seg.s) page.drawLine({ start: { x, y: baseline + size * 0.28 }, end: { x: x + w, y: baseline + size * 0.28 }, thickness: size * 0.06, color });
    x += w;
  }
}

export async function exportPdf(doc: Doc, fontBytes: Uint8Array, opts: PdfOptions = {}): Promise<Uint8Array> {
  const model = buildModel(doc, opts.labels ?? RU_LABELS);
  const [pw, ph] = PAPER_PT[opts.paper ?? 'a4'];

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Шрифт вшиваем целиком (subset: false, ~100 КБ в файле). Подмножество, которое строит fontkit,
  // у этого шрифта теряет контуры большинства букв: pdfium (Chrome, Edge) рисует вместо них пустоту.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const mapper = charMapper(font);
  const clean = (s: string) => mapText(s.replace(/\r\n?/g, '\n'), [], mapper).text;
  const width = (s: string, size = BODY) => font.widthOfTextAtSize(s, size);

  pdf.setTitle(model.title);
  pdf.setProducer('AV-сценарий');
  pdf.setCreator('AV-сценарий');
  pdf.setLanguage('ru-RU');

  const contentW = pw - 2 * MARGIN;
  const colW = COLUMN_SHARES.map((s) => s * contentW);
  const colX = [MARGIN];
  for (let i = 0; i < 3; i++) colX.push(colX[i]! + colW[i]!);
  const textW = (i: number) => colW[i]! - 2 * PAD_X;

  const bottomLimit = MARGIN + 6; // выше — номер страницы
  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const drawHeader = () => {
    const h = LEADING + 2 * PAD_Y;
    model.headers.forEach((t, i) => {
      const text = clean(t);
      const x = i === 3 ? colX[i]! + colW[i]! - PAD_X - width(text, 9) : colX[i]! + PAD_X;
      page.drawText(text, { x, y: y - PAD_Y - 9, size: 9, font, color: INK });
    });
    page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: MARGIN + contentW, y: y - h }, thickness: 1.4, color: INK });
    y -= h;
  };

  const newPage = (first: boolean) => {
    page = pdf.addPage([pw, ph]);
    pages.push(page);
    y = ph - MARGIN;
    if (first) {
      const title = clean(model.title);
      const tl = wrapText(title, contentW, (s) => width(s, 16));
      for (const line of tl) {
        page.drawText(line, { x: MARGIN, y: y - 16, size: 16, font, color: INK });
        y -= 21;
      }
      y -= 2;
      for (const line of wrapText(clean(model.metaLine), contentW, (s) => width(s, 10))) {
        page.drawText(line, { x: MARGIN, y: y - 10, size: 10, font, color: INK });
        y -= 14;
      }
      y -= 8;
    }
    drawHeader();
  };

  newPage(true);
  const fullPageRoom = () => y - bottomLimit; // место до нижнего поля на текущей странице
  // Сколько строк текста помещается на пустой странице под шапкой таблицы.
  const emptyPageLines = Math.floor((ph - MARGIN - (LEADING + 2 * PAD_Y) - bottomLimit - 2 * PAD_Y) / LEADING);

  interface PreparedCell {
    text: string;
    runs: Run[];
    lines: ReturnType<typeof wrapLines>;
  }
  /** Очистить текст ячейки (с пересчётом оформления) и разбить на строки по ширине колонки. */
  const prepareCell = (cell: ExportCell, maxWidth: number): PreparedCell => {
    const m = mapText(cell.text.replace(/\r\n?/g, '\n'), cell.runs, mapper);
    return { text: m.text, runs: m.runs, lines: wrapLines(m.text, maxWidth, (s) => width(s)) };
  };

  const drawRow = (row: ExportRow) => {
    const prepared = row.cells.map((c, ci) => prepareCell(c, textW(ci + 1)));
    const [left, right] = prepared as [PreparedCell, PreparedCell];
    const bodyLines = Math.max(left.lines.length, right.lines.length, 2); // в колонке № две строки: номер и таймкод
    let from = 0;
    let first = true;
    while (from < bodyLines) {
      let room = fullPageRoom() - 2 * PAD_Y;
      let canFit = Math.floor(room / LEADING);
      const remaining = bodyLines - from;
      // Строка помещается на целую страницу — не разрываем её, а переносим целиком.
      if (first && canFit < remaining && remaining <= emptyPageLines) canFit = 0;
      if (canFit < 1) {
        newPage(false);
        room = fullPageRoom() - 2 * PAD_Y;
        canFit = Math.max(1, Math.floor(room / LEADING));
      }
      const take = Math.min(canFit, remaining);
      const top = y - PAD_Y;
      if (first) {
        page.drawText(String(row.n), { x: colX[0]! + PAD_X, y: top - BODY, size: BODY, font, color: INK });
        page.drawText(clean(row.tc), { x: colX[0]! + PAD_X, y: top - LEADING - TC_SIZE, size: TC_SIZE, font, color: GREY });
        const t = clean(row.time);
        page.drawText(t, { x: colX[3]! + colW[3]! - PAD_X - width(t), y: top - BODY, size: BODY, font, color: INK });
      }
      [left, right].forEach((cell, ci) => {
        cell.lines.slice(from, from + take).forEach((ln, k) => {
          if (!ln.text) return;
          const segs = segmentsIn(cell.text, cell.runs, ln.start, ln.start + ln.text.length);
          drawSegments(page, font, segs, colX[ci + 1]! + PAD_X, top - BODY - k * LEADING, BODY);
        });
      });
      const h = take * LEADING + 2 * PAD_Y;
      // Вертикальные разделители колонок и линия под строкой.
      for (const cx of [colX[1]!, colX[2]!, colX[3]!]) {
        page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y - h }, thickness: 0.4, color: RULE });
      }
      page.drawLine({ start: { x: MARGIN, y: y - h }, end: { x: MARGIN + contentW, y: y - h }, thickness: 0.5, color: RULE });
      y -= h;
      from += take;
      first = false;
    }
  };

  for (const row of model.rows) drawRow(row);

  // Номера страниц — когда число страниц уже известно.
  pages.forEach((p, i) => {
    const t = `${i + 1} / ${pages.length}`;
    p.drawText(t, { x: pw / 2 - width(t, 9) / 2, y: MARGIN * 0.5, size: 9, font, color: GREY });
  });

  return pdf.save();
}




