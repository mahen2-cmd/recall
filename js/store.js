// App state: decks, cards, persistence and the study queue.

import { DAY, State, dayStart, newSchedule, nextDayAt, preview, schedule } from './fsrs.js';

const KEY = 'recall.v1';

// Per-deck settings.
//   scheduler     'sm2' (Anki's default algorithm) or 'fsrs' (Anki with FSRS switched on)
//   retention     desired retention, used by FSRS
//   easyInterval  days until the next review when Easy is pressed on a card still being
//                 learned for the first time, like Anki's "Easy interval"
//   speak         side read aloud automatically: 'none', 'front', 'back' or 'both'
//   frontLang     language the front is read in, such as 'en-US'
//   backLang      language the back is read in
//   speechRate    playback speed of that audio, where 1 is the voice's natural pace
//   saveAudio     whether the server keeps the audio it makes for the deck's cards; off, it
//                 is made each time it is played, and `npm run cache-voice` leaves the deck out
// A deck imported from Anki may also carry `fsrsParams`, its own FSRS parameters.
export const DECK_DEFAULTS = {
  scheduler: 'sm2',
  newPerDay: 20,
  retention: 0.9,
  easyInterval: 4,
  speak: 'none',
  frontLang: 'en-US',
  backLang: 'pt-PT',
  speechRate: 0.8,
  saveAudio: true,
};

// `daily` counts the answers given on each day. `log` breaks the same answers down:
// log[day][deckId] holds twelve counts, Again to Easy for each kind in ANSWER_KINDS.
const emptyState = () => ({ version: 1, decks: [], cards: [], daily: {}, log: {}, settings: {} });

const memory = new Map();
const storage = (() => {
  try {
    const ls = globalThis.localStorage;
    if (ls) return ls;
  } catch {
    // Storage blocked or unavailable; fall through to memory.
  }
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
  };
})();

let state = emptyState();

// ---- Persistence ------------------------------------------------------------
// When the app is served by server.js, everything is saved to a file on disk through
// `api/state`. The browser's localStorage always holds a second copy, and is the only
// store when there is no server (for example on a static host).

const API = 'api/state';
const disk = { available: false, ok: true, file: null, voice: null };
let writing = false;
let dirty = false;
let retry = null;
let notify = () => {};

/** Where data is being kept, and the server's voice if any: `{ available, ok, file, voice }`. */
export const storageInfo = () => ({ ...disk });

/** Call `listener` whenever saving to disk starts failing or recovers. */
export function onStorageChange(listener) {
  notify = listener;
}

function readLocal() {
  try {
    const raw = storage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function readDisk() {
  try {
    const res = await fetch(API, { cache: 'no-store' });
    const file = res.headers.get('X-Data-File');
    if (!file || (res.status !== 200 && res.status !== 204)) return null;
    disk.available = true;
    disk.file = decodeURIComponent(file);
    disk.voice = decodeURIComponent(res.headers.get('X-Tts-Engine') ?? '') || null;
    return res.status === 200 ? normalize(await res.json()) : null;
  } catch {
    return null;
  }
}

export async function load() {
  const local = readLocal();
  const saved = await readDisk();
  // The newer copy wins, so reviews done while the server was down are not lost.
  const useLocal = local && (!saved || local.savedAt > saved.savedAt);
  state = (useLocal ? local : saved) ?? emptyState();
  if (disk.available && useLocal) flush();
}

function setDiskOk(ok) {
  if (disk.ok === ok) return;
  disk.ok = ok;
  notify();
}

async function flush() {
  if (writing) {
    dirty = true;
    return;
  }
  writing = true;
  clearTimeout(retry);
  do {
    dirty = false;
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setDiskOk(true);
    } catch {
      setDiskOk(false);
      retry = setTimeout(flush, 5000);
    }
  } while (dirty);
  writing = false;
}

function save() {
  state.savedAt = Date.now();
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Browser storage full or blocked; the disk copy is what matters.
  }
  if (disk.available) flush();
}

function normalize(data) {
  if (!data || !Array.isArray(data.decks) || !Array.isArray(data.cards)) {
    throw new Error('Not a valid backup file');
  }
  const decks = data.decks
    .filter((d) => d && d.id && typeof d.name === 'string')
    .map((d) => ({ ...DECK_DEFAULTS, created: Date.now(), ...d }));
  const ids = new Set(decks.map((d) => d.id));
  const cards = data.cards
    .filter((c) => c && c.id && ids.has(c.deckId))
    .map((c) => ({ ...newSchedule(c.created ?? Date.now()), front: '', back: '', ...c }));
  return {
    ...emptyState(),
    savedAt: data.savedAt ?? 0,
    daily: data.daily ?? {},
    log: data.log ?? {},
    settings: data.settings ?? {},
    decks,
    cards,
  };
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Days roll over at 4am, as in Anki.
export function dayKey(t) {
  const d = new Date(dayStart(t));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---- Settings -------------------------------------------------------------

export const setting = (name) => state.settings[name];

export function setSetting(name, value) {
  state.settings[name] = value;
  save();
}

// ---- Decks ----------------------------------------------------------------

export const decks = () => state.decks;
export const deck = (id) => state.decks.find((d) => d.id === id);

export function createDeck({ name, ...options }) {
  const d = { ...DECK_DEFAULTS, ...options, id: uid(), name, created: Date.now() };
  state.decks.push(d);
  save();
  return d;
}

export function updateDeck(id, patch) {
  Object.assign(deck(id), patch);
  save();
}

export function deleteDeck(id) {
  state.decks = state.decks.filter((d) => d.id !== id);
  state.cards = state.cards.filter((c) => c.deckId !== id);
  save();
}

// ---- Cards ----------------------------------------------------------------

export const card = (id) => state.cards.find((c) => c.id === id);
export const cardsIn = (deckId) => state.cards.filter((c) => c.deckId === deckId);

// A card on reserve (`reserved: true`) is kept out of study until it is pulled in.
const reserveFlag = (reserved) => (reserved ? { reserved: true } : {});

export function addCard(deckId, front, back, now = Date.now(), { reserved = false } = {}) {
  const c = { id: uid(), deckId, front, back, created: now, updated: now, ...newSchedule(now), ...reserveFlag(reserved) };
  state.cards.push(c);
  save();
  return c;
}

/** Add many cards at once from `[front, back]` pairs. Returns how many were added. */
export function addCards(deckId, pairs, now = Date.now(), { reserved = false } = {}) {
  pairs.forEach(([front, back], i) => {
    // Stagger creation times so the cards keep the order they had in the file.
    const created = now + i;
    state.cards.push({ id: uid(), deckId, front, back, created, updated: created, ...newSchedule(now), ...reserveFlag(reserved) });
  });
  save();
  return pairs.length;
}

/**
 * Add decks read from an Anki file by the server, with every card's schedule as it was.
 * Importing the same file again adds only the cards that are not here yet. With `reserved`,
 * the new cards go on their deck's reserve, in Anki's order; cards already being studied keep
 * their schedule. Returns how many cards were added.
 */
export function importAnkiDecks(imported, now = Date.now(), { reserved = false } = {}) {
  const known = ankiCardIds();
  let added = 0;
  for (const { ankiId, name, settings, cards } of imported) {
    const fresh = cards.filter((c) => !known.has(c.ankiId));
    if (!fresh.length) continue;
    let d = state.decks.find((x) => x.ankiId === ankiId);
    if (!d) {
      d = { ...DECK_DEFAULTS, ...settings, id: uid(), name, ankiId, created: now };
      state.decks.push(d);
    }
    for (const c of fresh) {
      state.cards.push({ ...newSchedule(now), ...c, id: uid(), deckId: d.id, ...reserveFlag(reserved && c.state === State.New) });
    }
    added += fresh.length;
  }
  if (added) save();
  return added;
}

/** Anki's ids of the cards already imported. */
export const ankiCardIds = () => new Set(state.cards.map((c) => c.ankiId).filter(Boolean));

export function updateCard(id, patch) {
  const c = card(id);
  const moved = patch.deckId && patch.deckId !== c.deckId;
  Object.assign(c, patch, { updated: Date.now() });
  // A place in the reserve does not outlast leaving it, or changing deck.
  if (!c.reserved || moved) delete c.order;
  save();
}

// Once a reserve has been rearranged its cards carry their place in `order`. Cards added
// after that have none, and wait behind the rest, oldest first.
const byReserveOrder = (a, b) => {
  const placed = (a.order ?? Infinity) - (b.order ?? Infinity);
  return placed || a.created - b.created;
};

/** A deck's reserve in the order its cards are pulled in: as arranged, otherwise oldest first. */
export const reserveIn = (deckId) => cardsIn(deckId).filter((c) => c.reserved).sort(byReserveOrder);

/**
 * Move cards of a deck's reserve together to a new place in it, keeping their own order:
 * just `before` or `after` the card with that id, or to the end when neither is given.
 * Returns how many moved.
 */
export function moveInReserve(deckId, ids, { before, after } = {}) {
  const moving = new Set(ids);
  const all = reserveIn(deckId);
  const moved = all.filter((c) => moving.has(c.id));
  if (!moved.length) return 0;
  const rest = all.filter((c) => !moving.has(c.id));
  const anchor = rest.findIndex((c) => c.id === (before ?? after));
  rest.splice(anchor < 0 ? rest.length : anchor + (before ? 0 : 1), 0, ...moved);
  rest.forEach((c, i) => {
    c.order = i;
  });
  save();
  return moved.length;
}

/**
 * Move up to `n` cards from the front of a deck's reserve in with its new cards, where
 * they wait behind the new cards already there, in the order they had. Returns how many moved.
 */
export function pullFromReserve(deckId, n = Infinity, now = Date.now()) {
  const pulled = reserveIn(deckId).slice(0, Math.max(0, n));
  pulled.forEach((c, i) => {
    delete c.reserved;
    delete c.order;
    c.pulled = now + i;
  });
  if (pulled.length) save();
  return pulled.length;
}

/**
 * Put the cards named back on their deck's reserve, at the end of it in the order given.
 * A card already studied starts over as a new card, since the reserve holds only those.
 * Cards already on reserve are skipped. Returns how many went back.
 */
export function returnToReserve(ids, now = Date.now()) {
  const back = ids.map(card).filter((c) => c && !c.reserved);
  for (const c of back) {
    if (c.state !== State.New) Object.assign(c, newSchedule(now));
    delete c.pulled;
    c.reserved = true;
    c.updated = now;
  }
  // Number them behind the rest of each reserve, so they wait at the end, whatever their age.
  for (const deckId of new Set(back.map((c) => c.deckId))) {
    const all = reserveIn(deckId).filter((c) => !back.includes(c));
    all.push(...back.filter((c) => c.deckId === deckId));
    all.forEach((c, i) => {
      c.order = i;
    });
  }
  if (back.length) save();
  return back.length;
}

/**
 * Add a reversed copy of each card named, its back as the front, to the end of its deck's
 * reserve. A copy is marked `reversed`, so each side is still read in its own language.
 * Cards whose reverse is already in their deck are skipped. Returns the cards added.
 */
export function addReversed(ids, now = Date.now()) {
  const key = (deckId, front, back) => [deckId, front, back].map((text) => text.trim().toLowerCase()).join('\n');
  const known = new Set(state.cards.map((c) => key(c.deckId, c.front, c.back)));
  const added = [];
  for (const c of ids.map(card).filter(Boolean)) {
    const copy = key(c.deckId, c.back, c.front);
    if (known.has(copy)) continue;
    known.add(copy);
    // Stagger creation times so the copies keep the order of their originals.
    const created = now + added.length;
    added.push({ id: uid(), deckId: c.deckId, front: c.back, back: c.front, created, updated: created, ...newSchedule(now), reserved: true, ...(!c.reversed && { reversed: true }) });
  }
  state.cards.push(...added);
  if (added.length) save();
  return added;
}

/** Delete several cards at once. Returns how many were deleted. */
export function deleteCards(ids) {
  const doomed = new Set(ids);
  const before = state.cards.length;
  state.cards = state.cards.filter((c) => !doomed.has(c.id));
  if (state.cards.length !== before) save();
  return before - state.cards.length;
}

/** The group a card is listed under: 'reserve', 'new', 'learning', 'due' or 'later'. */
export function cardGroup(c, now = Date.now()) {
  if (c.reserved) return 'reserve';
  if (c.state === State.New) return 'new';
  if (isLearning(c)) return 'learning';
  return c.due < nextDayAt(now) ? 'due' : 'later';
}

const SORTS = {
  newest: (a, b) => b.created - a.created,
  oldest: (a, b) => a.created - b.created,
  front: (a, b) => a.front.localeCompare(b.front, undefined, { sensitivity: 'base' }),
  lapses: (a, b) => b.lapses - a.lapses || b.created - a.created,
  reserve: (a, b) => Boolean(b.reserved) - Boolean(a.reserved) || (a.reserved ? byReserveOrder(a, b) : b.created - a.created),
};

/**
 * The cards of a deck that pass every filter given, sorted.
 *   text    words to find on either side
 *   groups  card groups to keep (see `cardGroup`); none means all of them
 *   due     'overdue', 'today' (or earlier), 'week' or 'month': when the next review falls.
 *           New and reserve cards have no review coming, so any of these leaves them out.
 *   added   'today', 'week' or 'month': how recently the card was created
 *   lapses  'some' (forgotten at least once) or 'many' (three times or more)
 *   sort    'newest', 'oldest', 'due' (soonest first), 'front' (A to Z), 'lapses' or
 *           'reserve' (the reserve first, in the order it is pulled in)
 */
export function findCards(deckId, { text = '', groups = [], due = 'any', added = 'any', lapses = 'any', sort = 'newest' } = {}, now = Date.now()) {
  const q = text.trim().toLowerCase();
  const today = dayStart(now);
  const tomorrow = nextDayAt(now);
  const wanted = new Set(groups);
  const scheduled = (c) => !c.reserved && c.state !== State.New;
  const dueBefore = { today: tomorrow, week: tomorrow + 6 * DAY, month: tomorrow + 29 * DAY }[due];
  const addedSince = { today, week: today - 6 * DAY, month: today - 29 * DAY }[added];
  const minLapses = { some: 1, many: 3 }[lapses] ?? 0;
  const dueAt = (c) => (scheduled(c) ? c.due : Infinity);

  return cardsIn(deckId)
    .filter(
      (c) =>
        (!q || `${c.front}\n${c.back}`.toLowerCase().includes(q)) &&
        (!wanted.size || wanted.has(cardGroup(c, now))) &&
        (due !== 'overdue' || (c.state === State.Review && !c.reserved && c.due < today)) &&
        (!dueBefore || (scheduled(c) && c.due < dueBefore)) &&
        (!addedSince || c.created >= addedSince) &&
        c.lapses >= minLapses,
    )
    .sort(sort === 'due' ? (a, b) => dueAt(a) - dueAt(b) || b.created - a.created : (SORTS[sort] ?? SORTS.newest));
}

export function deleteCard(id) {
  state.cards = state.cards.filter((c) => c.id !== id);
  save();
}

// ---- Study queue ----------------------------------------------------------

const isLearning = (c) => c.state === State.Learning || c.state === State.Relearning;

function queue(deckId, now) {
  const d = deck(deckId);
  const today = dayStart(now);
  const all = cardsIn(deckId).filter((c) => !c.reserved);
  const introduced = all.filter((c) => c.introduced >= today).length;
  const allowance = Math.max(0, d.newPerDay - introduced);
  return {
    learning: all.filter(isLearning).sort((a, b) => a.due - b.due),
    // Review cards are scheduled in whole days, so anything due today counts.
    review: all
      .filter((c) => c.state === State.Review && c.due < nextDayAt(now))
      .sort((a, b) => a.due - b.due),
    fresh: all
      .filter((c) => c.state === State.New)
      .sort((a, b) => (a.pulled ?? a.created) - (b.pulled ?? b.created))
      .slice(0, allowance),
  };
}

/**
 * How many cards are waiting in a deck today, by kind, and how many it holds in all and on reserve.
 * `tomorrow` counts the same kinds for tomorrow, supposing today's cards are all studied: the
 * learning and review cards already scheduled for then, and the new cards left after today's, up
 * to the daily limit. The reserve is left out, as its cards only come in when pulled.
 */
export function counts(deckId, now = Date.now()) {
  const q = queue(deckId, now);
  const n = { new: q.fresh.length, learning: q.learning.length, review: q.review.length };
  const all = cardsIn(deckId);
  const studied = all.filter((c) => !c.reserved);
  const start = nextDayAt(now);
  const end = nextDayAt(start);
  const scheduled = studied.filter((c) => c.state !== State.New && c.due >= start && c.due < end);
  const next = {
    new: Math.min(deck(deckId).newPerDay, studied.filter((c) => c.state === State.New).length - n.new),
    learning: scheduled.filter(isLearning).length,
    review: scheduled.filter((c) => c.state === State.Review).length,
  };
  return {
    ...n,
    total: n.new + n.learning + n.review,
    tomorrow: { ...next, total: next.new + next.learning + next.review },
    cards: all.length,
    reserve: all.filter((c) => c.reserved).length,
  };
}

/** The next card to study, or `undefined` when the deck is done for today. */
export function nextCard(deckId, now = Date.now()) {
  const q = queue(deckId, now);
  if (q.learning[0]?.due <= now) return q.learning[0];
  // Otherwise show waiting learning cards early rather than making the user wait.
  return q.review[0] ?? q.fresh[0] ?? q.learning[0];
}

// Deterministic per card and review, so the intervals shown are the ones applied.
function fuzzFactor(c) {
  let h = 2166136261;
  for (const ch of `${c.id}:${c.reps}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

function schedulingOptions(c) {
  const { scheduler, retention, easyInterval, fsrsParams } = deck(c.deckId);
  return { scheduler, retention, easyInterval, w: fsrsParams, fuzz: fuzzFactor(c) };
}

export function previewCard(id, now = Date.now()) {
  const c = card(id);
  return preview(c, now, schedulingOptions(c));
}

export function answerCard(id, rating, now = Date.now()) {
  const c = card(id);
  const next = schedule(c, rating, now, schedulingOptions(c));
  if (c.state === State.New) c.introduced = now;
  const kind = c.state !== State.Review ? 0 : c.scheduledDays < MATURE_DAYS ? 1 : 2;
  Object.assign(c, next);
  const key = dayKey(now);
  state.daily[key] = (state.daily[key] ?? 0) + 1;
  const answers = ((state.log[key] ??= {})[c.deckId] ??= Array(12).fill(0));
  answers[kind * 4 + rating - 1]++;
  save();
}

// ---- Stats and backup -----------------------------------------------------

// A review card is mature once its interval reaches three weeks, as in Anki.
const MATURE_DAYS = 21;

/** The kinds of card an answer is logged under, in the order `statistics` reports them. */
export const ANSWER_KINDS = ['Learning', 'Young', 'Mature'];

function streakOf(perDay, now) {
  const reviewedToday = perDay[dayKey(now)] ?? 0;
  let streak = 0;
  const day = new Date(dayStart(now));
  if (!reviewedToday) day.setDate(day.getDate() - 1);
  while (perDay[dayKey(day)] > 0) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return { reviewedToday, streak };
}

export const stats = (now = Date.now()) => streakOf(state.daily, now);

/**
 * Figures for the statistics page, for one deck or, without `deckId`, for all of them.
 *   cards      how many cards are new, learning, young and mature, leaving out the reserve
 *   perDay     answers given on each day, keyed like '2026-01-31'
 *   forecast   cards coming due on each of the next `days` days; today includes overdue ones
 *   answers    Again, Hard, Good and Easy counts over the last `days` days, per ANSWER_KINDS
 *   loggedFrom the first day `answers` has data for, or null
 *   partial    whether answers were given before `loggedFrom`, which `answers` (and a
 *              single deck's `perDay`) cannot include
 */
export function statistics(deckId, days = 30, now = Date.now()) {
  const today = dayStart(now);
  const mine = (deckId ? cardsIn(deckId) : state.cards).filter((c) => !c.reserved);

  const cards = { new: 0, learning: 0, young: 0, mature: 0 };
  const forecast = Array(days).fill(0);
  for (const c of mine) {
    if (c.state === State.New) {
      cards.new++;
      continue;
    }
    if (isLearning(c)) cards.learning++;
    else if (c.scheduledDays < MATURE_DAYS) cards.young++;
    else cards.mature++;
    const offset = Math.max(0, Math.round((dayStart(c.due) - today) / DAY));
    if (offset < days) forecast[offset]++;
  }

  const first = new Date(today);
  first.setDate(first.getDate() - (days - 1));
  const from = dayKey(first);
  const answers = ANSWER_KINDS.map(() => [0, 0, 0, 0]);
  const logged = {};
  for (const [key, byDeck] of Object.entries(state.log)) {
    for (const [id, row] of Object.entries(byDeck)) {
      if (deckId && id !== deckId) continue;
      logged[key] = (logged[key] ?? 0) + row.reduce((sum, n) => sum + n, 0);
      if (key >= from) row.forEach((n, i) => (answers[Math.floor(i / 4)][i % 4] += n));
    }
  }
  const loggedFrom = Object.keys(logged).sort()[0] ?? null;
  const perDay = deckId ? logged : state.daily;

  return {
    cards,
    perDay,
    ...streakOf(perDay, now),
    forecast,
    answers,
    loggedFrom,
    partial: Object.keys(state.daily).some((key) => !loggedFrom || key < loggedFrom),
  };
}

export const exportData = () => JSON.stringify(state, null, 2);

export function importData(json) {
  state = normalize(JSON.parse(json));
  save();
}

export function reset() {
  state = emptyState();
  save();
}
