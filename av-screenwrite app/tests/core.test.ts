import { describe, expect, it } from 'vitest';
import { countWords, pluralCategory } from '../src/core/text';
import { formatTime, parseTime } from '../src/core/time';
import { autoSeconds, createDoc, createRow, rowSeconds, timeline, type Doc } from '../src/core/doc';
import * as ops from '../src/core/ops';
import { Store } from '../src/core/store';
import { AVS_VERSION, parseAvs, serializeAvs } from '../src/core/avs';

describe('countWords', () => {
  it('считает обычные слова', () => expect(countWords('Каждый день здесь кипит работа')).toBe(5));
  it('пустой текст и пробелы', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n\t ')).toBe(0);
  });
  it('игнорирует (круглые) и [квадратные] скобки', () => {
    expect(countWords('(МУЗЫКА) Привет [шум улицы] мир')).toBe(2);
    expect(countWords('(музыка играет\nдолго) слово')).toBe(1);
  });
  it('дефис и апостроф склеивают слово', () => {
    expect(countWords('кто-то где-нибудь')).toBe(2);
    expect(countWords("don't stop")).toBe(2);
  });
  it('числа — слова', () => expect(countWords('в 2026 году 15 человек')).toBe(5));
  it('буква ё', () => expect(countWords('Ёж идёт через лёд')).toBe(4));
  it('знаки препинания не слова', () => expect(countWords('— … ! ?')).toBe(0));
  it('незакрытая скобка не съедает текст', () => expect(countWords('привет (мир')).toBe(2));
});

describe('pluralCategory', () => {
  it.each([
    ['ru', 0, 'many'], ['ru', 1, 'one'], ['ru', 2, 'few'], ['ru', 5, 'many'], ['ru', 11, 'many'], ['ru', 21, 'one'], ['ru', 24, 'few'], ['ru', 111, 'many'],
    ['pl', 1, 'one'], ['pl', 2, 'few'], ['pl', 4, 'few'], ['pl', 5, 'many'], ['pl', 12, 'many'], ['pl', 22, 'few'], ['pl', 0, 'many'],
    ['en', 1, 'one'], ['en', 2, 'other'], ['en', 0, 'other'], ['en', 11, 'other'],
  ] as const)('%s %i → %s', (lang, n, cat) => expect(pluralCategory(lang, n)).toBe(cat));
});

describe('parseTime', () => {
  it('секунды', () => expect(parseTime('7')).toEqual({ ok: true, value: 7 }));
  it('м:сс', () => expect(parseTime('0:07')).toEqual({ ok: true, value: 7 }));
  it('ч:мм:сс', () => expect(parseTime('1:05:00')).toEqual({ ok: true, value: 3900 }));
  it('минуты без ведущего нуля', () => expect(parseTime('2:30')).toEqual({ ok: true, value: 150 }));
  it('дробное округляется, запятая допустима', () => {
    expect(parseTime('7,4')).toEqual({ ok: true, value: 7 });
    expect(parseTime('7.6')).toEqual({ ok: true, value: 8 });
  });
  it('пусто → автоподсчёт', () => {
    expect(parseTime('')).toEqual({ ok: true, value: null });
    expect(parseTime('   ')).toEqual({ ok: true, value: null });
  });
  it.each(['abc', '1:2:3:4', '-5', ':', '1:', '1::2', '7с'])('мусор %j', (s) =>
    expect(parseTime(s)).toEqual({ ok: false }),
  );
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [7, '0:07'],
    [65, '1:05'],
    [599, '9:59'],
    [3600, '1:00:00'],
    [3905, '1:05:05'],
    [-3, '0:00'],
  ])('%i → %s', (s, out) => expect(formatTime(s)).toBe(out));
  it('разбор и форматирование согласованы', () => {
    for (const s of [0, 9, 59, 60, 61, 3599, 3600, 7322]) {
      expect(parseTime(formatTime(s))).toEqual({ ok: true, value: s });
    }
  });
});

describe('хронометраж', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'слово').join(' ');
  it('ceil(слова × 60 / темп)', () => {
    expect(autoSeconds(createRow({ audio: words(130) }), 130)).toBe(60);
    expect(autoSeconds(createRow({ audio: words(1) }), 130)).toBe(1);
    expect(autoSeconds(createRow({ audio: words(131) }), 130)).toBe(61);
    expect(autoSeconds(createRow({ audio: '(музыка)' }), 130)).toBe(0);
  });
  it('темп влияет на время', () => expect(autoSeconds(createRow({ audio: words(60) }), 60)).toBe(60));
  it('ручное время перекрывает автоподсчёт, null возвращает', () => {
    const r = createRow({ audio: words(130), time: 5 });
    expect(rowSeconds(r, 130)).toBe(5);
    expect(rowSeconds({ ...r, time: null }, 130)).toBe(60);
    expect(rowSeconds({ ...r, time: 0 }, 130)).toBe(0);
  });
  it('накопительные таймкоды, общее время и слова', () => {
    const doc: Doc = {
      ...createDoc({ rows: 0 }),
      rows: [
        createRow({ audio: words(130) }), // 60 с
        createRow({ time: 7 }), // вручную
        createRow({ audio: '(музыка)' }), // 0
        createRow({ audio: words(65) }), // 30 с
      ],
    };
    const t = timeline(doc);
    expect(t.starts).toEqual([0, 60, 67, 67]);
    expect(t.total).toBe(97);
    expect(t.words).toBe(195);
  });
});

/* ---------- Отмена / повтор ---------- */

const mk = (): { s: Store; ids: string[] } => {
  const doc: Doc = {
    ...createDoc({ rows: 0 }),
    rows: [createRow({ video: 'a', audio: 'раз два' }), createRow({ video: 'b' }), createRow({ video: 'c' })],
  };
  return { s: new Store(doc), ids: doc.rows.map((r) => r.id) };
};
const vids = (s: Store) => s.doc.rows.map((r) => r.video).join('');

/** Проверка: команда применяется, отменяется до исходного снимка и повторяется до результата. */
function roundTrip(s: Store, op: (d: Doc) => Doc) {
  const before = s.doc;
  expect(s.apply(op)).toBe(true);
  const after = s.doc;
  expect(after).not.toBe(before);
  expect(s.undo()).toBe(true);
  expect(s.doc).toBe(before);
  expect(s.redo()).toBe(true);
  expect(s.doc).toBe(after);
}

describe('отмена и повтор каждой команды', () => {
  it('правка метаданных', () => {
    const { s } = mk();
    roundTrip(s, (d) => ops.setMeta(d, 'title', 'Ролик'));
  });
  it('смена темпа', () => {
    const { s } = mk();
    roundTrip(s, (d) => ops.setWpm(d, 150));
    expect(s.doc.wpm).toBe(150);
  });
  it('смена колонок', () => {
    const { s } = mk();
    roundTrip(s, ops.toggleSwap);
    expect(s.doc.swap).toBe(true);
  });
  it('ввод текста', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.setRowText(d, ids[1]!, 'video', 'новый'));
  });
  it('ручное время', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.setRowTime(d, ids[0]!, 7));
    expect(s.doc.rows[0]!.time).toBe(7);
  });
  it('добавление строки', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.addRowAfter(d, ids[0]!));
    expect(s.doc.rows).toHaveLength(4);
  });
  it('дублирование строки', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.duplicateRow(d, ids[0]!));
    expect(vids(s)).toBe('aabc');
    expect(new Set(s.doc.rows.map((r) => r.id)).size).toBe(4);
  });
  it('удаление строки', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.deleteRow(d, ids[1]!));
    expect(vids(s)).toBe('ac');
  });
  it('перемещение строки', () => {
    const { s, ids } = mk();
    roundTrip(s, (d) => ops.moveRowBy(d, ids[0]!, 1));
    expect(vids(s)).toBe('bac');
  });
});

describe('команды', () => {
  it('удаление последней строки оставляет одну пустую', () => {
    const doc: Doc = { ...createDoc({ rows: 0 }), rows: [createRow({ video: 'x' })] };
    const next = ops.deleteRow(doc, doc.rows[0]!.id);
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]!.video).toBe('');
  });
  it('перемещение на границах не меняет документ', () => {
    const { s, ids } = mk();
    expect(ops.moveRowBy(s.doc, ids[0]!, -1)).toBe(s.doc);
    expect(ops.moveRowBy(s.doc, ids[2]!, 1)).toBe(s.doc);
  });
  it('команда без изменений не попадает в историю', () => {
    const { s, ids } = mk();
    expect(s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'a'))).toBe(false);
    expect(s.canUndo).toBe(false);
  });
  it('недопустимый темп игнорируется', () => {
    const { s } = mk();
    expect(ops.setWpm(s.doc, 10)).toBe(s.doc);
    expect(ops.setWpm(s.doc, 500)).toBe(s.doc);
  });
  it('исходные документы не мутируют', () => {
    const { s, ids } = mk();
    const before = s.doc;
    const snapshot = JSON.stringify(before);
    ops.moveRowBy(before, ids[0]!, 2);
    ops.deleteRow(before, ids[0]!);
    ops.setRowText(before, ids[0]!, 'audio', 'zzz');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('слияние ввода в стек отмены', () => {
  it('подряд идущий ввод в одной ячейке — один шаг', () => {
    let t = 0;
    const doc: Doc = { ...createDoc({ rows: 0 }), rows: [createRow()] };
    const s = new Store(doc, () => t, 1500);
    const id = doc.rows[0]!.id;
    for (const v of ['п', 'пр', 'при', 'прив']) {
      t += 100;
      s.apply((d) => ops.setRowText(d, id, 'video', v), { key: `${id}:video`, inPlace: true });
    }
    expect(s.doc.rows[0]!.video).toBe('прив');
    s.undo();
    expect(s.doc).toBe(doc);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.doc.rows[0]!.video).toBe('прив');
  });
  it('другая ячейка или другая команда разрывают слияние', () => {
    const { s, ids } = mk();
    s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'a1'), { key: 'x' });
    s.apply((d) => ops.setRowText(d, ids[1]!, 'video', 'b1'), { key: 'y' });
    s.apply((d) => ops.setRowText(d, ids[1]!, 'video', 'b2'), { key: 'y' });
    s.apply(ops.toggleSwap);
    s.apply((d) => ops.setRowText(d, ids[1]!, 'video', 'b3'), { key: 'y' });
    let steps = 0;
    while (s.undo()) steps++;
    expect(steps).toBe(4);
  });
  it('пауза в наборе начинает новый шаг', () => {
    let t = 0;
    const { ids } = mk();
    const s = new Store({ ...createDoc({ rows: 0 }), rows: [createRow({ id: ids[0]! })] }, () => t, 1000);
    s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'a'), { key: 'k' });
    t += 5000;
    s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'ab'), { key: 'k' });
    s.undo();
    expect(s.doc.rows[0]!.video).toBe('a');
  });
  it('breakCoalescing разрывает слияние', () => {
    const { s, ids } = mk();
    s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'a1'), { key: 'k' });
    s.breakCoalescing();
    s.apply((d) => ops.setRowText(d, ids[0]!, 'video', 'a2'), { key: 'k' });
    s.undo();
    expect(s.doc.rows[0]!.video).toBe('a1');
  });
  it('новая правка после отмены очищает «повтор»', () => {
    const { s, ids } = mk();
    s.apply((d) => ops.deleteRow(d, ids[0]!));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.apply(ops.toggleSwap);
    expect(s.canRedo).toBe(false);
  });
});

describe('несохранённые изменения', () => {
  it('отмена до сохранённого состояния делает документ чистым', () => {
    const { s, ids } = mk();
    expect(s.dirty).toBe(false);
    s.apply((d) => ops.deleteRow(d, ids[0]!));
    expect(s.dirty).toBe(true);
    s.undo();
    expect(s.dirty).toBe(false);
    s.redo();
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.dirty).toBe(true);
  });
  it('load очищает историю', () => {
    const { s, ids } = mk();
    s.apply((d) => ops.deleteRow(d, ids[0]!));
    s.load(createDoc());
    expect(s.canUndo || s.canRedo || s.dirty).toBe(false);
  });
  it('в режиме «только чтение» правки блокируются', () => {
    const { s } = mk();
    s.load(s.doc, { readOnly: true });
    expect(s.apply(ops.toggleSwap)).toBe(false);
  });
});

/* ---------- Формат .avs ---------- */

describe('формат .avs', () => {
  it('сохранение и чтение без потерь', () => {
    const { s } = mk();
    const doc: Doc = { ...s.doc, title: 'Ролик', author: 'Я', date: '11.11.2026', wpm: 120, swap: true };
    const res = parseAvs(serializeAvs(doc));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc).toEqual(doc);
    expect(res.readOnly).toBe(false);
    expect(res.fromPrototype).toBe(false);
  });
  it('файл прототипа (без format и version) открывается как версия 1', () => {
    const proto = JSON.stringify({
      title: 'Старый',
      author: '',
      date: '01.01.2025',
      wpm: 130,
      swap: false,
      rows: [{ id: 'k3f9a2c1', video: 'Общий план', audio: '(МУЗЫКА) Каждый день', time: null }],
    });
    const res = parseAvs(proto);
    expect(res.ok && res.fromPrototype && !res.readOnly).toBe(true);
    if (res.ok) {
      expect(res.doc.rows[0]!.audio).toBe('(МУЗЫКА) Каждый день');
      expect(res.doc.rows[0]!.id).toBe('k3f9a2c1');
    }
  });
  it('неизвестные поля сохраняются и пишутся обратно', () => {
    const src = JSON.stringify({
      format: 'av-scenariy',
      version: 1,
      future: { a: 1 },
      rows: [{ id: 'x', video: 'v', audio: '', time: 3, comment: 'привет' }],
    });
    const res = parseAvs(src);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const back = JSON.parse(serializeAvs(res.doc));
    expect(back.future).toEqual({ a: 1 });
    expect(back.rows[0].comment).toBe('привет');
    expect(back.rows[0].time).toBe(3);
  });
  it('более новая версия открывается только для чтения', () => {
    const res = parseAvs(JSON.stringify({ format: 'av-scenariy', version: AVS_VERSION + 1, rows: [{}] }));
    expect(res.ok && res.readOnly).toBe(true);
  });
  it('битые файлы дают понятную ошибку', () => {
    const bad = (s: string) => {
      const r = parseAvs(s);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.error;
    };
    expect(bad('{ not json')).toMatch(/JSON/);
    expect(bad('[]')).toMatch(/объект/);
    expect(bad('{"rows":5}')).toMatch(/rows/);
    expect(bad('{"format":"other","rows":[]}')).toMatch(/format/);
    expect(bad('{"version":"x","rows":[]}')).toMatch(/version/);
    expect(bad('{"rows":[{"video":5}]}')).toMatch(/Строка 1.*video/);
    expect(bad('{"rows":[{},{"time":-1}]}')).toMatch(/Строка 2.*time/);
  });
  it('повторяющиеся id заменяются, пустой список строк даёт одну строку', () => {
    const res = parseAvs(JSON.stringify({ rows: [{ id: 'a' }, { id: 'a' }] }));
    expect(res.ok && new Set(res.doc.rows.map((r) => r.id)).size).toBe(2);
    const empty = parseAvs('{"rows":[]}');
    expect(empty.ok && empty.doc.rows.length).toBe(1);
  });
  it('некорректный темп заменяется значением по умолчанию', () => {
    const res = parseAvs('{"wpm":9999,"rows":[{}]}');
    expect(res.ok && res.doc.wpm).toBe(130);
  });
  it('BOM в начале файла допустим', () => {
    expect(parseAvs('﻿{"rows":[{}]}').ok).toBe(true);
  });
});
