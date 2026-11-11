/** Разбор и форматирование времени. */

export type ParsedTime = { ok: true; value: number | null } | { ok: false };

/**
 * Ручной ввод времени: `7`, `7.5`, `0:07`, `1:05:00`.
 * Пустая строка → value: null (вернуть автоподсчёт). Мусор → ok: false.
 */
export function parseTime(input: string): ParsedTime {
  const s = input.trim().replace(',', '.');
  if (!s) return { ok: true, value: null };
  if (/^\d+(\.\d+)?$/.test(s)) return { ok: true, value: Math.round(parseFloat(s)) };
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return { ok: false };
  return { ok: true, value: parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0) };
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** `м:сс`, а от часа — `ч:мм:сс`. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return (h ? `${h}:${pad(m)}` : `${m}`) + `:${pad(x)}`;
}
