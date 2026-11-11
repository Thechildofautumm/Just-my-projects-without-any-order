/** Настоящий .docx через библиотеку docx: редактируемая таблица Word со вшитым шрифтом. */
import {
  AlignmentType,
  BorderStyle,
  CharacterSet,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Doc } from '../core/doc';
import { segments } from '../core/richtext';
import { buildModel, COLUMN_SHARES, RU_LABELS, type ExportCell, type ExportLabels } from './model';
import type { Paper } from './pdf';

export const DOCX_FONT = 'PT Mono';
const MM_TO_TWIP = 56.6929;
/** Размеры страницы в twips (1/20 pt). */
const PAPER_TWIP: Record<Paper, { width: number; height: number }> = {
  a4: { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
};
const MARGIN_TWIP = Math.round(14 * MM_TO_TWIP);

export interface DocxOptions {
  paper?: Paper;
  labels?: ExportLabels;
}

const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const noBorders = { top: none, bottom: none, left: none, right: none } as const;

/**
 * Текст ячейки с оформлением: по TextRun на каждый фрагмент одного стиля,
 * переводы строк — разрывы строки внутри абзаца.
 */
function cellRuns(cell: ExportCell, size: number): TextRun[] {
  const text = cell.text.replace(/\r\n?/g, '\n');
  const out: TextRun[] = [];
  let pendingBreaks = 0;
  for (const seg of segments(text, cell.runs)) {
    seg.text.split('\n').forEach((part, k) => {
      if (k > 0) pendingBreaks++;
      if (!part && k > 0) return;
      out.push(
        new TextRun({
          text: part,
          size,
          bold: seg.b || undefined,
          italics: seg.i || undefined,
          underline: seg.u ? {} : undefined,
          strike: seg.s || undefined,
          break: pendingBreaks || undefined,
        }),
      );
      pendingBreaks = 0;
    });
  }
  // Завершающие и подряд идущие переводы строк: каждый — отдельный разрыв.
  return out.length ? out : [new TextRun({ text: '', size })];
}

export async function exportDocx(doc: Doc, fontBytes: Uint8Array, opts: DocxOptions = {}): Promise<Uint8Array> {
  const model = buildModel(doc, opts.labels ?? RU_LABELS);
  const paper = PAPER_TWIP[opts.paper ?? 'a4'];
  const contentW = paper.width - 2 * MARGIN_TWIP;
  const widths = COLUMN_SHARES.map((s) => Math.round(s * contentW));
  widths[3] = contentW - widths[0]! - widths[1]! - widths[2]!; // чтобы сумма была точной

  const rule = (size: number, color: string) => ({ style: BorderStyle.SINGLE, size, color });
  const cell = (i: number, children: Paragraph[], extra: { bottom?: ReturnType<typeof rule> } = {}) =>
    new TableCell({
      width: { size: widths[i]!, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      borders: { ...noBorders, bottom: extra.bottom ?? none },
      children,
    });

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: model.headers.map((h, i) =>
      cell(i, [new Paragraph({ alignment: i === 3 ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: h, size: 18, bold: true })] })], {
        bottom: rule(12, '000000'),
      }),
    ),
  });

  const bodyRows = model.rows.map(
    (r) =>
      new TableRow({
        cantSplit: false,
        children: [
          cell(
            0,
            [
              new Paragraph({ children: [new TextRun({ text: String(r.n), size: 20 })] }),
              new Paragraph({ children: [new TextRun({ text: r.tc, size: 16, color: '595959' })] }),
            ],
            { bottom: rule(4, '999999') },
          ),
          cell(1, [new Paragraph({ children: cellRuns(r.cells[0], 20) })], { bottom: rule(4, '999999') }),
          cell(2, [new Paragraph({ children: cellRuns(r.cells[1], 20) })], { bottom: rule(4, '999999') }),
          cell(3, [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: r.time, size: 20 })] })], {
            bottom: rule(4, '999999'),
          }),
        ],
      }),
  );

  const table = new Table({
    width: { size: contentW, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [headerRow, ...bodyRows],
  });

  const document = new Document({
    title: model.title,
    creator: 'AV-сценарий',
    // Шрифт вшивается в файл: таблица выглядит так же и там, где PT Mono не установлен.
    fonts: [{ name: DOCX_FONT, data: fontBytes as unknown as Buffer, characterSet: CharacterSet.RUSSIAN }],
    styles: { default: { document: { run: { font: DOCX_FONT, size: 20 }, paragraph: { spacing: { line: 276 } } } } },
    sections: [
      {
        properties: { page: { size: { width: paper.width, height: paper.height }, margin: { top: MARGIN_TWIP, bottom: MARGIN_TWIP, left: MARGIN_TWIP, right: MARGIN_TWIP } } },
        children: [
          new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: model.title, size: 32, bold: true })] }),
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: model.metaLine, size: 20 })] }),
          table,
        ],
      },
    ],
  });

  return new Uint8Array(await Packer.toArrayBuffer(document));
}
