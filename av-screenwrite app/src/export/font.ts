/**
 * Шрифт для экспорта (PT Mono, OFL 1.1). Вшит в сборку как data: URL и разбирается локально —
 * через fetch нельзя: CSP запрещает сетевые запросы, и это правильно.
 * Модуль подключается динамически (import()), чтобы не замедлять запуск.
 */
import fontDataUrl from '../../assets/fonts/PTMono-Regular.ttf?inline';

let cached: Uint8Array | null = null;

export function exportFontBytes(): Uint8Array {
  if (cached) return cached;
  const b64 = fontDataUrl.slice(fontDataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  cached = out;
  return out;
}
