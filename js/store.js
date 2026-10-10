// App state: decks, cards, persistence and the study queue.

import { State, DAY, newSchedule, preview, schedule } from './fsrs.js';

const KEY = 'recall.v1';

export const DECK_DEFAULTS = { newPerDay: 20, retention: 0.9 };

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

export function load() {
  try {
    const raw = storage.getItem(KEY);
    state = raw ? normalize(JSON.parse(raw)) : emptyState();
  } catch {
    state = emptyState();
  }
}

function save() {
  storage.setItem(KEY, JSON.stringify(state));
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
  return { ...emptyState(), daily: data.daily ?? {}, settings: data.settings ?? {}, decks, cards };
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);

function dayKey(t) {
  const d = new Date(t);
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

export function createDeck({ name, newPerDay, retention }) {
  const d = {
    id: uid(),
    name,
    newPerDay: newPerDay ?? DECK_DEFAULTS.newPerDay,
    retention: retention ?? DECK_DEFAULTS.retention,
    created: Date.now(),
  };
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
  const today = startOfDay(now);
  const all = cardsIn(deckId);
  const introduced = all.filter((c) => c.introduced >= today).length;
  const allowance = Math.max(0, d.newPerDay - introduced);
  return {
    learning: all.filter(isLearning).sort((a, b) => a.due - b.due),
    // Review cards are scheduled in whole days, so anything due today counts.
    review: all
      .filter((c) => c.state === State.Review && c.due < today + DAY)
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

export function previewCard(id, now = Date.now()) {
  const c = card(id);
  return preview(c, now, { retention: deck(c.deckId).retention });
}

export function answerCard(id, rating, now = Date.now()) {
  const c = card(id);
  const next = schedule(c, rating, now, { retention: deck(c.deckId).retention });
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
  const day = new Date(startOfDay(now));
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
