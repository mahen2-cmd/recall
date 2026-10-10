// Reads an Anki collection (the database inside an .apkg file) into Recall decks and cards,
// keeping every card where it was in Anki's schedule.
// Both of Anki's file layouts are read: the older one, which keeps decks and note types as
// JSON, and the current one, which keeps them in their own tables as protobuf.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DAY, LEARN_STEPS, MAX_INTERVAL, RELEARN_STEPS, State, dayStart, newSchedule, nextMemory } from './js/fsrs.js';

// ---- Protobuf ---------------------------------------------------------------

/** The fields of a protobuf message: field number to the list of its values. */
function protobuf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = new Map();
  let at = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    let byte;
    do {
      byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return value;
  };
  while (at < bytes.length) {
    const key = varint();
    const wire = key % 8;
    let value;
    if (wire === 0) value = varint();
    else if (wire === 1) value = view.getFloat64((at += 8) - 8, true);
    else if (wire === 2) {
      const length = varint();
      value = bytes.subarray(at, (at += length));
    } else if (wire === 5) value = view.getFloat32((at += 4) - 4, true);
    else throw new Error('This Anki file has settings Recall cannot read.');
    const number = Math.floor(key / 8);
    fields.set(number, [...(fields.get(number) ?? []), value]);
  }
  return fields;
}

const utf8 = new TextDecoder();
const tidy = (x) => +x.toFixed(4); // floats are stored in single precision

const pbNumber = (message, field, fallback = 0) => message.get(field)?.[0] ?? fallback;
const pbText = (message, field) => utf8.decode(message.get(field)?.[0] ?? new Uint8Array());

function pbFloats(message, field) {
  return (message.get(field) ?? []).flatMap((value) => {
    if (typeof value === 'number') return [tidy(value)];
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return Array.from({ length: value.length / 4 }, (_, i) => tidy(view.getFloat32(i * 4, true)));
  });
}

// ---- Deck options -----------------------------------------------------------

const OPTION_DEFAULTS = {
  learnSteps: LEARN_STEPS,
  relearnSteps: RELEARN_STEPS,
  newPerDay: 20,
  initialEase: 2.5,
  easyBonus: 1.3,
  hardFactor: 1.2,
  intervalModifier: 1,
  maxInterval: MAX_INTERVAL,
  minLapseInterval: 1,
  lapseMultiplier: 0,
  graduatingGood: 1,
  graduatingEasy: 4,
  retention: 0.9,
  fsrsParams: [],
};

function optionsFromJson(conf) {
  const params = [conf.fsrsParams6, conf.fsrsParams5, conf.fsrsWeights].find((p) => p?.length);
  return {
    learnSteps: conf.new?.delays,
    relearnSteps: conf.lapse?.delays,
    newPerDay: conf.new?.perDay,
    initialEase: conf.new?.initialFactor / 1000 || undefined,
    easyBonus: conf.rev?.ease4,
    hardFactor: conf.rev?.hardFactor,
    intervalModifier: conf.rev?.ivlFct,
    maxInterval: conf.rev?.maxIvl,
    minLapseInterval: conf.lapse?.minInt,
    lapseMultiplier: conf.lapse?.mult,
    graduatingGood: conf.new?.ints?.[0],
    graduatingEasy: conf.new?.ints?.[1],
    retention: conf.desiredRetention,
    fsrsParams: params,
  };
}

// Field numbers are from Anki's deck_config.proto.
function optionsFromProtobuf(bytes) {
  const m = protobuf(bytes);
  const params = [6, 5, 3].map((field) => pbFloats(m, field)).find((p) => p.length);
  return {
    learnSteps: pbFloats(m, 1),
    relearnSteps: pbFloats(m, 2),
    newPerDay: pbNumber(m, 9),
    initialEase: tidy(pbNumber(m, 11)),
    easyBonus: tidy(pbNumber(m, 12)),
    hardFactor: tidy(pbNumber(m, 13)),
    lapseMultiplier: tidy(pbNumber(m, 14)),
    intervalModifier: tidy(pbNumber(m, 15)),
    maxInterval: pbNumber(m, 16),
    minLapseInterval: pbNumber(m, 17),
    graduatingGood: pbNumber(m, 18),
    graduatingEasy: pbNumber(m, 19),
    retention: tidy(pbNumber(m, 37, 0.9)),
    fsrsParams: params,
  };
}

const withDefaults = (options) => {
  const set = Object.fromEntries(Object.entries(options).filter(([, value]) => value != null));
  return { ...OPTION_DEFAULTS, ...set };
};

// Options Recall keeps fixed at Anki's defaults. The last four only matter without FSRS.
const FIXED = [
  ['learnSteps', 'learning steps'],
  ['relearnSteps', 'relearning steps'],
  ['maxInterval', 'maximum interval'],
  ['graduatingGood', 'graduating interval', 'sm2'],
  ['initialEase', 'starting ease', 'sm2'],
  ['easyBonus', 'easy bonus', 'sm2'],
  ['hardFactor', 'hard interval', 'sm2'],
  ['intervalModifier', 'interval modifier', 'sm2'],
  ['minLapseInterval', 'minimum interval after a lapse', 'sm2'],
  ['lapseMultiplier', 'new interval after a lapse', 'sm2'],
];

/** Recall deck settings for an Anki deck, and the names of the options that have no equivalent. */
function deckSettings(options, fsrs) {
  const custom = FIXED.filter(
    ([key, , only]) => (!only || !fsrs) && JSON.stringify(options[key]) !== JSON.stringify(OPTION_DEFAULTS[key]),
  ).map(([, label]) => label);

  const settings = {
    scheduler: fsrs ? 'fsrs' : 'sm2',
    newPerDay: options.newPerDay,
    retention: options.retention,
    // With FSRS on, Anki ignores the easy interval and lets FSRS choose.
    easyInterval: fsrs ? 0 : options.graduatingEasy,
  };
  if (fsrs && options.fsrsParams.length) {
    const w = options.fsrsParams;
    // FSRS-5 parameters are FSRS-6 ones with a fixed forgetting curve.
    if (w.length === 21) settings.fsrsParams = w;
    else if (w.length === 19) settings.fsrsParams = [...w, 0, 0.5];
    else custom.push('FSRS parameters');
  }
  return { settings, custom };
}

// ---- Reading the database ---------------------------------------------------

function readLegacy(all) {
  const col = all('select crt, conf, models, decks, dconf from col')[0];
  const config = JSON.parse(col.conf || '{}');
  const dconf = JSON.parse(col.dconf || '{}');
  return {
    crt: col.crt,
    config,
    decks: Object.values(JSON.parse(col.decks || '{}')).map((d) => ({
      id: d.id,
      name: d.name,
      options: optionsFromJson(dconf[d.conf] ?? dconf[1] ?? {}),
    })),
    notetypes: Object.values(JSON.parse(col.models || '{}')).map((m) => ({
      id: m.id,
      cloze: m.type === 1,
      fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ front: t.qfmt, back: t.afmt })),
    })),
  };
}

function readCurrent(all) {
  const config = Object.fromEntries(
    all("select KEY as k, val as v from config where KEY in ('creationOffset', 'fsrs')").map((row) => [
      row.k,
      JSON.parse(typeof row.v === 'string' ? row.v : utf8.decode(row.v)),
    ]),
  );
  const options = new Map(all('select id, config from deck_config').map((row) => [row.id, optionsFromProtobuf(row.config)]));
  const fields = all('select ntid, name from fields order by ntid, ord');
  const templates = all('select ntid, config from templates order by ntid, ord');
  return {
    crt: all('select crt from col')[0].crt,
    config,
    decks: all('select id, name, kind from decks').map((row) => {
      // A normal deck names its options group; a filtered deck has none of its own.
      const normal = protobuf(row.kind).get(1)?.[0];
      const group = normal ? pbNumber(protobuf(normal), 1, 1) : 1;
      return { id: row.id, name: row.name.replaceAll('\x1f', '::'), options: options.get(group) ?? options.get(1) ?? {} };
    }),
    notetypes: all('select id, config from notetypes').map((row) => ({
      id: row.id,
      cloze: pbNumber(protobuf(row.config), 1) === 1,
      fields: fields.filter((f) => f.ntid === row.id).map((f) => f.name),
      templates: templates
        .filter((t) => t.ntid === row.id)
        .map((t) => protobuf(t.config))
        .map((m) => ({ front: pbText(m, 1), back: pbText(m, 2) })),
    })),
  };
}

// ---- Card text --------------------------------------------------------------
// Anki builds each side from a template and the note's fields, as HTML. Recall cards are
// plain text, so the template is filled in and the markup taken out.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => {
    if (code[0] !== '#') return ENTITIES[code] ?? match;
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });

export function htmlToText(html) {
  const text = html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/<br\b[^>]*>|<hr\b[^>]*>|<\/(div|p|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Show or hide the deletions in cloze text. `ord` is the deletion this card asks for. */
function cloze(text, ord, answer) {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, n, hidden, hint) =>
    answer || Number(n) !== ord + 1 ? hidden : `[${hint || '...'}]`,
  );
}

function fillTemplate(template, fields, { ord, answer }) {
  const filled = (name) => {
    const clozeNumber = /^c(\d+)$/.exec(name);
    if (clozeNumber) return Number(clozeNumber[1]) === ord + 1;
    return htmlToText(fields.get(name) ?? '') !== '';
  };
  // Sections shown only when a field is filled in ({{#Field}}) or empty ({{^Field}}).
  const section = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
  let previous;
  do {
    previous = template;
    template = template.replace(section, (_, kind, name, body) => (filled(name) === (kind === '#') ? body : ''));
  } while (template !== previous);

  return template.replace(/\{\{([^{}]*)\}\}/g, (_, reference) => {
    const parts = reference.split(':').map((part) => part.trim());
    const name = parts.pop();
    const filters = parts.map((part) => part.split(' ')[0]);
    // Typed answers and Anki's own text-to-speech have no place on a plain card.
    if (filters.includes('type') || filters.includes('tts') || filters.includes('tts-voices')) return '';
    const value = fields.get(name) ?? ''; // {{FrontSide}}, {{Tags}} and the like are left out
    return filters.includes('cloze') ? cloze(value, ord, answer) : value;
  });
}

/** The plain-text front and back of the card made from `values` by template `ord`. */
export function renderCard(notetype, values, ord) {
  const fields = new Map(notetype.fields.map((name, i) => [name, values[i] ?? '']));
  const template = notetype.templates[notetype.cloze ? 0 : ord] ?? notetype.templates[0];
  if (!template) return { front: '', back: '' };
  // The back usually repeats the front above a divider; keep only what comes after it.
  const back = fillTemplate(template.back, fields, { ord, answer: true });
  const divider = /<hr\b[^>]*\bid\s*=\s*["']?answer\b[^>]*>/i.exec(back);
  return {
    front: htmlToText(fillTemplate(template.front, fields, { ord, answer: false })),
    back: htmlToText(divider ? back.slice(divider.index + divider[0].length) : back),
  };
}

// ---- Schedule ---------------------------------------------------------------

/**
 * Anki's number for the day `now` falls in. Review cards are due on a numbered day,
 * counted from the date the collection was made.
 */
function ankiToday(crt, minutesWest, now) {
  const made = new Date(crt * 1000);
  const start =
    minutesWest == null
      ? Date.UTC(made.getFullYear(), made.getMonth(), made.getDate())
      : Math.floor((crt - minutesWest * 60) / 86_400) * DAY;
  const today = new Date(dayStart(now));
  return Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - start) / DAY);
}

const parseJson = (text) => {
  try {
    return JSON.parse(text || '{}') ?? {};
  } catch {
    return {};
  }
};

/** FSRS stability and difficulty worked out from a card's past answers, as Anki does. */
function memoryFromHistory(history, w) {
  let memory = null;
  let last = null;
  for (const { id, ease } of history) {
    const elapsed = last == null ? 0 : Math.round((dayStart(id) - dayStart(last)) / DAY);
    memory = nextMemory(memory, ease, elapsed, w);
    last = id;
  }
  return memory;
}

/**
 * Recall's scheduling fields for a row of Anki's `cards` table.
 *   history  the card's past answers, oldest first, as `{ id, ease }`
 *   dayAt    turns one of Anki's day numbers into a time
 */
function cardSchedule(row, history, { fsrs, w, dayAt }) {
  const fresh = newSchedule(row.mod * 1000);
  if (row.type === 0) return fresh;

  const data = parseJson(row.data);
  const memory = data.s > 0 && data.d > 0 ? { stability: data.s, difficulty: data.d } : memoryFromHistory(history, w);
  const lastAnswer = data.lrt ? data.lrt * 1000 : (history.at(-1)?.id ?? null);
  const common = {
    ...fresh,
    ...memory,
    ease: row.factor ? row.factor / 1000 : fresh.ease,
    reps: row.reps,
    lapses: row.lapses,
    introduced: history[0]?.id,
  };
  // A card in a filtered deck keeps its real due date to one side.
  const due = row.odid && row.odue ? row.odue : row.due;

  if (row.type === 2) {
    const interval = Math.max(row.ivl, 1);
    return {
      ...common,
      state: State.Review,
      due: dayAt(due),
      scheduledDays: interval,
      // Without FSRS, Anki counts how late a card is from its due day, so place the last
      // review exactly one interval before it.
      lastReview: fsrs && lastAnswer ? lastAnswer : dayAt(due - interval),
    };
  }
  return {
    ...common,
    state: row.type === 3 ? State.Relearning : State.Learning,
    // Steps of a day or more are due on a numbered day; shorter ones at a time in seconds.
    due: due < 1e9 ? dayAt(due) : due * 1000,
    scheduledDays: Math.max(row.ivl, 0),
    left: row.left,
    lastReview: lastAnswer,
  };
}

// ---- Entry point ------------------------------------------------------------

const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
};

function convert(all, now) {
  const tables = new Set(all("select name from sqlite_master where type = 'table'").map((row) => row.name));
  if (!tables.has('cards') || !tables.has('notes')) throw new Error('This is not an Anki collection.');
  const source = tables.has('notetypes') ? readCurrent(all) : readLegacy(all);

  const fsrs = source.config.fsrs === true;
  const today = ankiToday(source.crt, source.config.creationOffset, now);
  const dayAt = (day) => {
    const date = new Date(dayStart(now));
    date.setDate(date.getDate() + day - today);
    return date.getTime() + DAY / 2; // mid-day, clear of the rollover and of clock changes
  };

  const notetypes = new Map(source.notetypes.map((n) => [n.id, n]));
  const history = groupBy(all('select id, cid, ease from revlog where ease between 1 and 4 and type < 3 order by id'), 'cid');
  const rows = all(
    `select c.id, c.did, c.ord, c.mod, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses,
            c.left, c.odue, c.odid, c.data, n.mid, n.flds
       from cards c join notes n on n.id = c.nid order by c.id`,
  );

  const result = { decks: [], suspended: 0, blank: 0, media: false };
  const byDeck = groupBy(rows.map((row) => ({ ...row, deck: row.odid || row.did })), 'deck');
  for (const deck of source.decks) {
    const options = withDefaults(deck.options);
    const { settings, custom } = deckSettings(options, fsrs);
    const cards = [];
    for (const row of byDeck.get(deck.id) ?? []) {
      if (row.queue === -1) {
        result.suspended++;
        continue;
      }
      const notetype = notetypes.get(row.mid);
      const { front, back } = notetype ? renderCard(notetype, row.flds.split('\x1f'), row.ord) : { front: '', back: '' };
      if (!front) {
        result.blank++;
        continue;
      }
      if (/<img\b|\[sound:/i.test(row.flds)) result.media = true;
      cards.push({
        ankiId: row.id,
        front,
        back,
        // Anki numbers a card by the time it was made.
        created: row.id > 1e11 ? row.id : row.mod * 1000,
        updated: row.mod * 1000,
        position: row.due,
        ...cardSchedule(row, history.get(row.id) ?? [], { fsrs, w: settings.fsrsParams, dayAt }),
      });
    }
    if (!cards.length) continue;

    // Recall shows new cards oldest first. Anki has its own order for them, so hand the
    // new cards' creation times out again in that order.
    const fresh = cards.filter((card) => card.state === State.New).sort((a, b) => a.position - b.position);
    const times = fresh.map((card) => card.created).sort((a, b) => a - b);
    fresh.forEach((card, i) => (card.created = times[i]));
    for (const card of cards) delete card.position;

    result.decks.push({ ankiId: deck.id, name: deck.name, settings, custom, cards });
  }
  return result;
}

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];

/**
 * Decks and cards from the bytes of an Anki collection database:
 * `{ decks: [{ ankiId, name, settings, custom, cards }], suspended, blank, media }`.
 */
export async function readAnkiCollection(bytes, now = Date.now()) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error('Importing from Anki needs Node.js 22.5 or newer.');
  }
  // Current Anki compresses the database inside the package.
  if (ZSTD.every((byte, i) => bytes[i] === byte)) {
    const { zstdDecompressSync } = await import('node:zlib');
    if (!zstdDecompressSync) throw new Error('This Anki file needs Node.js 22.15 or newer to open.');
    bytes = zstdDecompressSync(bytes);
  }
  if (utf8.decode(bytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('This is not an Anki collection.');

  // SQLite reads from a file, so the database spends a moment in a temporary folder.
  const folder = await mkdtemp(join(tmpdir(), 'recall-anki-'));
  let db;
  try {
    const file = join(folder, 'collection.db');
    await writeFile(file, bytes);
    db = new DatabaseSync(file, { readOnly: true });
    return convert((sql) => db.prepare(sql).all(), now);
  } finally {
    db?.close();
    await rm(folder, { recursive: true, force: true });
  }
}
