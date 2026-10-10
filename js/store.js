// App state: decks, cards, persistence and the study queue.

import { State, dayStart, newSchedule, nextDayAt, preview, schedule } from './fsrs.js';

const KEY = 'recall.v1';

// `easyInterval` is the fixed interval (days) for Easy on a card still being learned for
// the first time, like Anki's "Easy interval". 0 lets FSRS pick it instead.
// `speak` is which side is read aloud automatically: 'none', 'front', 'back' or 'both'.
// `speechRate` is the playback speed of that audio, where 1 is the voice's natural pace.
export const DECK_DEFAULTS = {
  newPerDay: 20,
  retention: 0.9,
  easyInterval: 4,
  speak: 'none',
  speechRate: 0.8,
};

const emptyState = () => ({ version: 1, decks: [], cards: [], daily: {}, settings: {} });

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
    settings: data.settings ?? {},
    decks,
    cards,
  };
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Days roll over at 4am, as in Anki.
function dayKey(t) {
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

export function addCard(deckId, front, back, now = Date.now()) {
  const c = { id: uid(), deckId, front, back, created: now, updated: now, ...newSchedule(now) };
  state.cards.push(c);
  save();
  return c;
}

export function updateCard(id, patch) {
  Object.assign(card(id), patch, { updated: Date.now() });
  save();
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
  const all = cardsIn(deckId);
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
      .sort((a, b) => a.created - b.created)
      .slice(0, allowance),
  };
}

/** How many cards are waiting in a deck today, by kind. */
export function counts(deckId, now = Date.now()) {
  const q = queue(deckId, now);
  const n = { new: q.fresh.length, learning: q.learning.length, review: q.review.length };
  return { ...n, total: n.new + n.learning + n.review, cards: cardsIn(deckId).length };
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
  const { retention, easyInterval } = deck(c.deckId);
  return { retention, easyInterval, fuzz: fuzzFactor(c) };
}

export function previewCard(id, now = Date.now()) {
  const c = card(id);
  return preview(c, now, schedulingOptions(c));
}

export function answerCard(id, rating, now = Date.now()) {
  const c = card(id);
  const next = schedule(c, rating, now, schedulingOptions(c));
  if (c.state === State.New) c.introduced = now;
  Object.assign(c, next);
  const key = dayKey(now);
  state.daily[key] = (state.daily[key] ?? 0) + 1;
  save();
}

// ---- Stats and backup -----------------------------------------------------

export function stats(now = Date.now()) {
  const reviewedToday = state.daily[dayKey(now)] ?? 0;
  let streak = 0;
  const day = new Date(dayStart(now));
  if (!reviewedToday) day.setDate(day.getDate() - 1);
  while (state.daily[dayKey(day)] > 0) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return { reviewedToday, streak };
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
