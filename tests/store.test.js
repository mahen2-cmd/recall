import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, MINUTE, Rating, State } from '../js/fsrs.js';
import * as store from '../js/store.js';

const T0 = new Date(2026, 0, 1, 9, 0, 0).getTime();

function setup(deckOptions = {}) {
  store.reset();
  return store.createDeck({ name: 'Test', ...deckOptions });
}

test('add, edit and delete a card', () => {
  const deck = setup();
  const card = store.addCard(deck.id, 'front', 'back', T0);
  assert.equal(store.cardsIn(deck.id).length, 1);
  assert.equal(card.state, State.New);

  store.updateCard(card.id, { front: 'changed' });
  assert.equal(store.card(card.id).front, 'changed');
  assert.equal(store.card(card.id).state, State.New);

  store.deleteCard(card.id);
  assert.equal(store.cardsIn(deck.id).length, 0);
});

test('deleting a deck removes only its cards', () => {
  const a = setup();
  const b = store.createDeck({ name: 'Other' });
  store.addCard(a.id, 'a', 'a', T0);
  store.addCard(b.id, 'b', 'b', T0);
  store.deleteDeck(a.id);
  assert.equal(store.decks().length, 1);
  assert.equal(store.cardsIn(a.id).length, 0);
  assert.equal(store.cardsIn(b.id).length, 1);
});

test('new cards per day limit is enforced', () => {
  const deck = setup({ newPerDay: 2 });
  for (let i = 0; i < 5; i++) store.addCard(deck.id, `q${i}`, `a${i}`, T0 + i);
  assert.equal(store.counts(deck.id, T0).new, 2);

  store.answerCard(store.nextCard(deck.id, T0).id, Rating.Easy, T0);
  assert.equal(store.counts(deck.id, T0).new, 1);
  store.answerCard(store.nextCard(deck.id, T0).id, Rating.Easy, T0);
  assert.equal(store.counts(deck.id, T0).total, 0);
  assert.equal(store.nextCard(deck.id, T0), undefined);

  // The allowance resets the next day.
  assert.equal(store.counts(deck.id, T0 + DAY).new, 2);
});

test('queue order: due learning, then reviews, then new, then waiting learning', () => {
  const deck = setup();
  const learning = store.addCard(deck.id, 'learning', '-', T0);
  const review = store.addCard(deck.id, 'review', '-', T0 + 1);
  const fresh = store.addCard(deck.id, 'fresh', '-', T0 + 2);

  store.answerCard(review.id, Rating.Easy, T0);
  const reviewDay = store.card(review.id).due;
  store.answerCard(learning.id, Rating.Again, reviewDay);

  // Learning card is not due for another minute, so the review comes first.
  assert.equal(store.nextCard(deck.id, reviewDay).id, review.id);
  assert.equal(store.nextCard(deck.id, reviewDay + 2 * MINUTE).id, learning.id);

  store.answerCard(review.id, Rating.Good, reviewDay);
  assert.equal(store.nextCard(deck.id, reviewDay).id, fresh.id);

  store.answerCard(fresh.id, Rating.Easy, reviewDay);
  assert.equal(store.nextCard(deck.id, reviewDay).id, learning.id);
});

test('review cards become due on their day, not before', () => {
  const deck = setup();
  const card = store.addCard(deck.id, 'q', 'a', T0);
  store.answerCard(card.id, Rating.Easy, T0);
  const days = store.card(card.id).scheduledDays;
  assert.equal(store.counts(deck.id, T0 + (days - 1) * DAY).review, 0);
  // Earlier in the day than the original review still counts as due.
  assert.equal(store.counts(deck.id, T0 + days * DAY - 3 * 60 * MINUTE).review, 1);
});

test('stats track reviews today and the streak', () => {
  const deck = setup();
  const a = store.addCard(deck.id, 'a', 'a', T0);
  const b = store.addCard(deck.id, 'b', 'b', T0);
  assert.deepEqual(store.stats(T0), { reviewedToday: 0, streak: 0 });
  store.answerCard(a.id, Rating.Good, T0);
  store.answerCard(b.id, Rating.Good, T0 + DAY);
  assert.deepEqual(store.stats(T0 + DAY), { reviewedToday: 1, streak: 2 });
  assert.deepEqual(store.stats(T0 + 2 * DAY), { reviewedToday: 0, streak: 2 });
  assert.deepEqual(store.stats(T0 + 3 * DAY), { reviewedToday: 0, streak: 0 });
});

test('statistics count cards, the forecast and answers by kind', () => {
  const deck = setup();
  const other = store.createDeck({ name: 'Other' });
  const a = store.addCard(deck.id, 'a', 'a', T0);
  const b = store.addCard(deck.id, 'b', 'b', T0 + 1);
  store.addCard(deck.id, 'c', 'c', T0 + 2);
  const d = store.addCard(other.id, 'd', 'd', T0 + 3);

  store.answerCard(a.id, Rating.Easy, T0); // graduates, due in 4 days
  store.answerCard(b.id, Rating.Again, T0); // stays in learning
  store.answerCard(d.id, Rating.Easy, T0);

  const s = store.statistics(deck.id, 30, T0);
  assert.deepEqual(s.cards, { new: 1, learning: 1, young: 1, mature: 0 });
  assert.equal(s.forecast[0], 1);
  assert.equal(s.forecast[store.card(a.id).scheduledDays], 1);
  assert.equal(s.forecast.reduce((sum, n) => sum + n, 0), 2);
  assert.deepEqual(s.answers, [[1, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.equal(s.reviewedToday, 2);
  assert.equal(s.loggedFrom, store.dayKey(T0));
  assert.equal(s.partial, false);
  assert.equal(store.statistics(null, 30, T0).reviewedToday, 3);

  // On its due day the card is answered as a young review; overdue cards count as due today.
  const due = store.card(a.id).due;
  assert.equal(store.statistics(deck.id, 30, due + 3 * DAY).forecast[0], 2);
  store.answerCard(a.id, Rating.Hard, due);
  assert.deepEqual(store.statistics(deck.id, 30, due).answers[1], [0, 1, 0, 0]);
  // The first day's answers have fallen out of a two-day window.
  assert.deepEqual(store.statistics(deck.id, 2, due).answers[0], [0, 0, 0, 0]);
});

test('statistics say when earlier reviews have no breakdown', () => {
  const deck = setup();
  const card = store.addCard(deck.id, 'q', 'a', T0);
  store.answerCard(card.id, Rating.Good, T0);
  const old = JSON.parse(store.exportData());
  delete old.log;
  store.importData(JSON.stringify(old));
  const s = store.statistics(null, 30, T0);
  assert.equal(s.reviewedToday, 1);
  assert.equal(s.loggedFrom, null);
  assert.equal(s.partial, true);
});

test('reserve cards stay out of study until they are pulled', () => {
  const deck = setup();
  store.addCard(deck.id, 'now', '-', T0);
  store.addCards(deck.id, [['r1', '-'], ['r2', '-'], ['r3', '-']], T0 + 1, { reserved: true });
  store.addCard(deck.id, 'r4', '-', T0 + 10, { reserved: true });

  assert.deepEqual(store.reserveIn(deck.id).map((c) => c.front), ['r1', 'r2', 'r3', 'r4']);
  let c = store.counts(deck.id, T0);
  assert.deepEqual([c.new, c.cards, c.reserve], [1, 5, 4]);
  assert.equal(store.statistics(deck.id, 30, T0).cards.new, 1);

  assert.equal(store.pullFromReserve(deck.id, 2), 2);
  c = store.counts(deck.id, T0);
  assert.deepEqual([c.new, c.reserve], [3, 2]);
  assert.deepEqual(store.reserveIn(deck.id).map((c) => c.front), ['r3', 'r4']);

  // Asking for more than there is pulls what is left.
  assert.equal(store.pullFromReserve(deck.id, 10), 2);
  assert.equal(store.pullFromReserve(deck.id), 0);
  assert.equal(store.counts(deck.id, T0).new, 5);

  // The reserve survives a backup.
  store.updateCard(store.cardsIn(deck.id)[0].id, { reserved: true });
  store.importData(store.exportData());
  assert.equal(store.counts(deck.id, T0).reserve, 1);
});

test('findCards filters by group, text, dates and lapses, and sorts', () => {
  const deck = setup();
  const fresh = store.addCard(deck.id, 'Banana', 'yellow', T0);
  const learning = store.addCard(deck.id, 'apple', 'red', T0 + 1);
  const review = store.addCard(deck.id, 'Cherry', 'red too', T0 + 2);
  const held = store.addCard(deck.id, 'date', 'brown', T0 + 3, { reserved: true });
  store.answerCard(learning.id, Rating.Again, T0);
  store.answerCard(review.id, Rating.Easy, T0);
  const dueDay = store.card(review.id).due;
  const ids = (filters, now = T0) => store.findCards(deck.id, filters, now).map((c) => c.id);

  assert.deepEqual(ids(), [held.id, review.id, learning.id, fresh.id]);
  assert.deepEqual(ids({ groups: ['new'] }), [fresh.id]);
  assert.deepEqual(ids({ groups: ['reserve', 'learning'] }), [held.id, learning.id]);
  assert.deepEqual(ids({ groups: ['later'] }), [review.id]);
  assert.deepEqual(ids({ groups: ['due'] }), []);
  assert.deepEqual(ids({ groups: ['due'] }, dueDay), [review.id]);
  assert.equal(store.cardGroup(store.card(review.id), dueDay), 'due');

  assert.deepEqual(ids({ text: ' RED ' }), [review.id, learning.id]);
  assert.deepEqual(ids({ text: 'red', groups: ['learning'] }), [learning.id]);

  // Only cards with a review coming have a due date.
  assert.deepEqual(ids({ due: 'today' }), [learning.id]);
  assert.deepEqual(ids({ due: 'week' }), [review.id, learning.id]);
  assert.deepEqual(ids({ due: 'overdue' }, dueDay), []);
  assert.deepEqual(ids({ due: 'overdue' }, dueDay + DAY), [review.id]);

  assert.deepEqual(ids({ added: 'today' }, T0 + DAY), []);
  assert.equal(ids({ added: 'week' }, T0 + DAY).length, 4);

  store.answerCard(review.id, Rating.Again, dueDay);
  assert.deepEqual(ids({ lapses: 'some' }, dueDay), [review.id]);
  assert.deepEqual(ids({ lapses: 'many' }, dueDay), []);

  assert.deepEqual(ids({ sort: 'oldest' }), [fresh.id, learning.id, review.id, held.id]);
  assert.deepEqual(ids({ sort: 'front' }), [learning.id, fresh.id, review.id, held.id]);
  assert.deepEqual(ids({ sort: 'due' }, dueDay).slice(2), [held.id, fresh.id]);
  assert.equal(ids({ sort: 'lapses' }, dueDay)[0], review.id);
});

test('export and import round-trip', () => {
  const deck = setup();
  store.addCard(deck.id, 'q', 'a', T0);
  const backup = store.exportData();
  store.reset();
  assert.equal(store.decks().length, 0);
  store.importData(backup);
  assert.equal(store.decks()[0].name, 'Test');
  assert.equal(store.cardsIn(deck.id)[0].front, 'q');
  assert.throws(() => store.importData('{"nope":true}'));
});

test('addCards adds many cards in file order as new cards', () => {
  const deck = setup();
  const added = store.addCards(deck.id, [['um', 'one'], ['dois', 'two'], ['três', 'three']], T0);
  assert.equal(added, 3);
  assert.equal(store.counts(deck.id, T0).new, 3);
  assert.equal(store.nextCard(deck.id, T0).front, 'um');
  assert.deepEqual(store.cardsIn(deck.id).map((c) => c.back), ['one', 'two', 'three']);
});
