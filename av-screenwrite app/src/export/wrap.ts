/** Перенос текста по ширине. measure(s) — ширина строки в тех же единицах, что и maxWidth. */

export interface Line {
  /** Текст строки без пробелов в конце. */
  text: string;
  /** Смещение первого символа строки в исходном тексте (нужно, чтобы наложить оформление). */
  start: number;
}

/**
 * Разбить текст на строки. Исходный текст не должен содержать \r и табуляции
 * (их заменяют заранее, чтобы смещения совпадали с оформлением).
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): Line[] {
  const out: Line[] = [];
  let base = 0;
  for (const para of text.split('\n')) {
    wrapParagraph(para, base, maxWidth, measure, out);
    base += para.length + 1;
  }
  return out;
}

function wrapParagraph(para: string, base: number, maxWidth: number, measure: (s: string) => number, out: Line[]): void {
  if (!para.trim()) {
    out.push({ text: '', start: base });
    return;
  }
  let line = '';
  let lineStart = base;
  for (const m of para.matchAll(/\s+|\S+/g)) {
    const token = m[0];
    const tokStart = base + m.index!;
    if (/^\s/.test(token)) {
      // Пробел в конце строки на следующую строку не переносим.
      if (line && measure(line + token) <= maxWidth) line += token;
      else if (!line) {
        line = token;
        lineStart = tokStart;
      } else {
        out.push({ text: line.trimEnd(), start: lineStart });
        line = '';
        lineStart = tokStart + token.length;
      }
      continue;
    }
    if (measure(line + token) <= maxWidth) {
      if (!line) lineStart = tokStart;
      line += token;
      continue;
    }
    if (line.trim()) out.push({ text: line.trimEnd(), start: lineStart });
    line = '';
    // Слово длиннее строки — режем по символам.
    let rest = token;
    let restStart = tokStart;
    while (measure(rest) > maxWidth) {
      let k = 1;
      while (k < rest.length && measure(rest.slice(0, k + 1)) <= maxWidth) k++;
      // Не разрываем суррогатную пару.
      const c = rest.charCodeAt(k - 1);
      if (c >= 0xd800 && c <= 0xdbff && k < rest.length) k++;
      out.push({ text: rest.slice(0, k), start: restStart });
      rest = rest.slice(k);
      restStart += k;
    }
    line = rest;
    lineStart = restStart;
  }
  out.push({ text: line.trimEnd(), start: lineStart });
}

/** То же, но только тексты строк. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  return wrapLines(clean, maxWidth, measure).map((l) => l.text);
}
