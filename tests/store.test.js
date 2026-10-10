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
