import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY,
  DEFAULT_W,
  MINUTE,
  Rating,
  State,
  newSchedule,
  nextInterval,
  preview,
  retrievability,
  schedule,
} from '../js/fsrs.js';

const T0 = new Date(2026, 0, 1, 9, 0, 0).getTime();

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

/** Review a fresh card with the given ratings, each exactly when it is due. */
function run(ratings, options) {
  let card = newSchedule(T0);
  let now = T0;
  for (const r of ratings) {
    card = schedule(card, r, now, options);
    now = card.due;
  }
  return card;
}

test('retrievability is 90% when elapsed time equals stability', () => {
  for (const s of [0.5, 1, 10, 250]) close(retrievability(s, s), 0.9);
  close(retrievability(0, 5), 1);
});

test('retrievability decays over time', () => {
  assert.ok(retrievability(1, 10) > retrievability(5, 10));
  assert.ok(retrievability(5, 10) > retrievability(50, 10));
});

test('interval equals stability at 90% retention and shrinks as retention rises', () => {
  assert.equal(nextInterval(10, 0.9), 10);
  assert.equal(nextInterval(100, 0.9), 100);
  assert.ok(nextInterval(100, 0.95) < 100);
  assert.ok(nextInterval(100, 0.8) > 100);
  assert.equal(nextInterval(0.01, 0.9), 1);
  assert.equal(nextInterval(1e9, 0.9), 36500);
});

test('first rating sets initial stability and difficulty', () => {
  const p = preview(newSchedule(T0), T0);
  for (const g of [1, 2, 3, 4]) close(p[g].stability, DEFAULT_W[g - 1]);
  assert.ok(p[1].difficulty > p[2].difficulty);
  assert.ok(p[2].difficulty > p[3].difficulty);
  assert.ok(p[3].difficulty > p[4].difficulty);
  for (const g of [1, 2, 3, 4]) assert.ok(p[g].difficulty >= 1 && p[g].difficulty <= 10);
});

test('new card: again/hard/good stay in learning, easy graduates', () => {
  const p = preview(newSchedule(T0), T0);
  assert.equal(p[1].state, State.Learning);
  assert.equal(p[1].due, T0 + 1 * MINUTE);
  assert.equal(p[2].due, T0 + 5 * MINUTE);
  assert.equal(p[3].due, T0 + 10 * MINUTE);
  assert.equal(p[4].state, State.Review);
  assert.equal(p[4].scheduledDays, 8);
  assert.equal(p[4].due, T0 + 8 * DAY);
});

test('learning card graduates on good', () => {
  const card = run([Rating.Good, Rating.Good]);
  assert.equal(card.state, State.Review);
  assert.equal(card.reps, 2);
  assert.ok(card.scheduledDays >= 1);
});

test('review intervals are strictly ordered hard < good < easy', () => {
  const card = run([Rating.Good, Rating.Good, Rating.Good]);
  const p = preview(card, card.due);
  assert.ok(p[2].scheduledDays < p[3].scheduledDays);
  assert.ok(p[3].scheduledDays < p[4].scheduledDays);
  assert.equal(p[1].state, State.Relearning);
});

test('successful reviews grow stability', () => {
  let prev = 0;
  for (let n = 2; n <= 7; n++) {
    const card = run(Array(n).fill(Rating.Good));
    assert.ok(card.stability > prev, `stability should grow at rep ${n}`);
    prev = card.stability;
  }
});

test('a lapse cuts stability, raises difficulty and counts the lapse', () => {
  const card = run([Rating.Good, Rating.Good, Rating.Good, Rating.Good]);
  const lapsed = schedule(card, Rating.Again, card.due);
  assert.equal(lapsed.state, State.Relearning);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, card.due + 5 * MINUTE);
  assert.ok(lapsed.stability < card.stability);
  assert.ok(lapsed.difficulty > card.difficulty);

  const relearned = schedule(lapsed, Rating.Good, lapsed.due);
  assert.equal(relearned.state, State.Review);
  assert.ok(relearned.scheduledDays < card.scheduledDays);
});

test('difficulty stays within 1..10 under repeated extremes', () => {
  const hard = run(Array(30).fill(Rating.Again));
  assert.ok(hard.difficulty <= 10 && hard.difficulty >= 1);
  const easy = run(Array(30).fill(Rating.Easy));
  assert.ok(easy.difficulty <= 10 && easy.difficulty >= 1);
  assert.ok(Number.isFinite(easy.stability) && easy.stability <= 36500);
});

test('higher desired retention gives shorter intervals', () => {
  const ratings = [Rating.Good, Rating.Good, Rating.Good];
  assert.ok(
    run(ratings, { retention: 0.95 }).scheduledDays < run(ratings, { retention: 0.8 }).scheduledDays,
  );
});

test('schedule does not mutate the card', () => {
  const card = newSchedule(T0);
  const copy = { ...card };
  schedule(card, Rating.Good, T0);
  assert.deepEqual(card, copy);
});
