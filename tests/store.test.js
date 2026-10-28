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

test('tomorrow counts the new cards left after today, up to the daily limit', () => {
  const deck = setup({ newPerDay: 2 });
  for (let i = 0; i < 3; i++) store.addCard(deck.id, `q${i}`, `a${i}`, T0 + i);
  store.addCard(deck.id, 'kept', 'back', T0, { reserved: true });
  assert.equal(store.counts(deck.id, T0).tomorrow.new, 1);

  store.addCard(deck.id, 'q3', 'a3', T0 + 3);
  store.addCard(deck.id, 'q4', 'a4', T0 + 4);
  assert.equal(store.counts(deck.id, T0).tomorrow.new, 2);

  // Studying today's new cards does not change tomorrow's.
  store.answerCard(store.nextCard(deck.id, T0).id, Rating.Easy, T0);
  assert.equal(store.counts(deck.id, T0).tomorrow.new, 2);

  store.deleteCards(store.cardsIn(deck.id).filter((c) => c.state === State.New && !c.reserved).map((c) => c.id));
  assert.equal(store.counts(deck.id, T0).tomorrow.new, 0);
});

test('tomorrow counts the learning and review cards scheduled for that day', () => {
  const deck = setup({ newPerDay: 0 });
  const [learning, dueTomorrow, dueLater, dueToday] = ['l', 't', 'x', 'd'].map((f) => store.addCard(deck.id, f, f, T0));
  const tomorrow = T0 + DAY;
  store.updateCard(learning.id, { state: State.Relearning, due: tomorrow });
  store.updateCard(dueTomorrow.id, { state: State.Review, due: tomorrow });
  store.updateCard(dueLater.id, { state: State.Review, due: T0 + 2 * DAY });
  store.updateCard(dueToday.id, { state: State.Review, due: T0 });

  assert.deepEqual(store.counts(deck.id, T0).tomorrow, { new: 0, learning: 1, review: 1, total: 2 });
});

test('upcoming lists each day: overdue cards today, then the reviews and new cards to come', () => {
  const deck = setup({ newPerDay: 2 });
  for (let i = 0; i < 5; i++) store.addCard(deck.id, `n${i}`, `n${i}`, T0 + i);
  store.addCard(deck.id, 'kept', 'kept', T0, { reserved: true });
  const [overdue, inThree, tooFar] = ['o', 't', 'f'].map((f) => store.addCard(deck.id, f, f, T0));
  store.updateCard(overdue.id, { state: State.Review, due: T0 - 5 * DAY });
  store.updateCard(inThree.id, { state: State.Review, due: T0 + 3 * DAY });
  store.updateCard(tooFar.id, { state: State.Review, due: T0 + 9 * DAY });

  const days = store.upcoming(deck.id, 7, T0);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.new), [2, 2, 1, 0, 0, 0, 0]);
  assert.deepEqual(days.map((d) => d.review), [1, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(days.map((d) => d.total), [3, 2, 1, 1, 0, 0, 0]);
  assert.equal(days[1].start - days[0].start, DAY);
  assert.deepEqual(store.upcoming(deck.id, 7, T0)[1], { start: days[1].start, ...store.counts(deck.id, T0).tomorrow });
});

test('upcoming for all decks adds up each deck, with its own daily limit', () => {
  const a = setup({ newPerDay: 1 });
  const b = store.createDeck({ name: 'Other', newPerDay: 3 });
  for (let i = 0; i < 3; i++) store.addCard(a.id, `a${i}`, 'a', T0 + i);
  for (let i = 0; i < 4; i++) store.addCard(b.id, `b${i}`, 'b', T0 + i);
  assert.deepEqual(store.upcoming(undefined, 4, T0).map((d) => d.new), [4, 2, 1, 0]);
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

test('the reserve can be rearranged, and is pulled and studied in that order', () => {
  const deck = setup();
  store.addCards(deck.id, [['a', '-'], ['b', '-'], ['c', '-'], ['d', '-'], ['e', '-']], T0, { reserved: true });
  const id = Object.fromEntries(store.cardsIn(deck.id).map((c) => [c.front, c.id]));
  const order = () => store.reserveIn(deck.id).map((c) => c.front).join('');

  // Cards moved together keep their own order.
  assert.equal(store.moveInReserve(deck.id, [id.d, id.b], { before: id.a }), 2);
  assert.equal(order(), 'bdace');
  store.moveInReserve(deck.id, [id.b], { after: id.c });
  assert.equal(order(), 'dacbe');
  store.moveInReserve(deck.id, [id.d, id.c]);
  assert.equal(order(), 'abedc');
  assert.equal(store.moveInReserve(deck.id, ['no-such-card'], { before: id.a }), 0);

  // Cards added later wait at the end, and the order survives a backup.
  store.addCard(deck.id, 'f', '-', T0 + 100, { reserved: true });
  store.importData(store.exportData());
  assert.equal(order(), 'abedcf');
  assert.deepEqual(store.findCards(deck.id, { sort: 'reserve' }, T0).map((c) => c.front).join(''), 'abedcf');

  // Pulled cards come up after the new cards already waiting, in the order they had.
  store.moveInReserve(deck.id, [id.e], { before: id.a });
  store.addCard(deck.id, 'new', '-', T0 + 200);
  assert.equal(store.pullFromReserve(deck.id, 2, T0 + 300), 2);
  assert.equal(order(), 'bdcf');
  const studied = [];
  for (let card; (card = store.nextCard(deck.id, T0 + 400)); ) {
    studied.push(card.front);
    store.deleteCard(card.id);
  }
  assert.deepEqual(studied, ['new', 'e', 'a']);

  // A card taken off the reserve and put back goes to the end.
  store.updateCard(id.b, { reserved: undefined });
  store.updateCard(id.b, { reserved: true });
  assert.equal(order(), 'dcfb');
});

test('new, learning and due cards can go back on the reserve, starting over', () => {
  const deck = setup();
  store.addCards(deck.id, [['r1', '-'], ['r2', '-']], T0, { reserved: true });
  const fresh = store.addCard(deck.id, 'fresh', '-', T0 + 1);
  const learning = store.addCard(deck.id, 'learning', '-', T0 + 2);
  const due = store.addCard(deck.id, 'due', '-', T0 + 3);
  store.answerCard(learning.id, Rating.Good, T0 + 10);
  store.answerCard(due.id, Rating.Easy, T0 + 10);
  assert.notEqual(store.card(learning.id).state, State.New);
  assert.equal(store.card(due.id).state, State.Review);
  store.moveInReserve(deck.id, [store.reserveIn(deck.id)[1].id], { before: store.reserveIn(deck.id)[0].id });

  const [r1] = store.reserveIn(deck.id).slice(-1);
  assert.equal(store.returnToReserve([due.id, fresh.id, learning.id, r1.id, 'no-such-card'], T0 + DAY), 3);
  // They join the end of the reserve in the order given, as new cards.
  assert.deepEqual(store.reserveIn(deck.id).map((c) => c.front), ['r2', 'r1', 'due', 'fresh', 'learning']);
  for (const id of [due.id, learning.id]) {
    const c = store.card(id);
    assert.deepEqual([c.state, c.reps, c.lapses, c.lastReview], [State.New, 0, 0, null]);
  }
  assert.equal(store.nextCard(deck.id, T0 + DAY), undefined);
  assert.equal(store.counts(deck.id, T0 + DAY).reserve, 5);
});

test('reversed copies of cards go on the reserve, once', () => {
  const deck = setup();
  const hello = store.addCard(deck.id, 'hello', 'olá', T0);
  const thanks = store.addCard(deck.id, 'thanks', 'obrigado', T0 + 1, { reserved: true });
  const same = store.addCard(deck.id, 'taxi', 'Taxi ', T0 + 2);

  const added = store.addReversed([thanks.id, hello.id, same.id, 'no-such-card'], T0 + 10);
  assert.deepEqual(added.map((c) => [c.front, c.back, c.reserved, c.reversed, c.state]), [
    ['obrigado', 'thanks', true, true, State.New],
    ['olá', 'hello', true, true, State.New],
  ]);
  // They join the end of the reserve in the order given, and the originals are untouched.
  assert.deepEqual(store.reserveIn(deck.id).map((c) => c.front), ['thanks', 'obrigado', 'olá']);
  assert.equal(store.card(hello.id).reserved, undefined);

  // Neither a card nor its copy gets a second one.
  assert.deepEqual(store.addReversed([hello.id, added[1].id, thanks.id]), []);
  // Reversing a copy whose original is gone gives an ordinary card back.
  store.deleteCard(hello.id);
  const [again] = store.addReversed([added[1].id]);
  assert.deepEqual([again.front, again.back, again.reversed], ['hello', 'olá', undefined]);
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

test('deleteCards removes only the cards named', () => {
  const deck = setup();
  const [a, b, c] = ['a', 'b', 'c'].map((text, i) => store.addCard(deck.id, text, text, T0 + i));
  assert.equal(store.deleteCards([a.id, c.id, 'no-such-card']), 2);
  assert.deepEqual(store.cardsIn(deck.id).map((card) => card.id), [b.id]);
  assert.equal(store.deleteCards([]), 0);
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
