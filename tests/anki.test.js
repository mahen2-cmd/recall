import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';

import { htmlToText, readAnkiCollection, readAnkiPackage, renderCard } from '../anki.js';
import { DAY, Rating, State, dayStart, daysElapsed, preview } from '../js/fsrs.js';
import * as store from '../js/store.js';
import { PNG, zip } from './zip.js';

const NOW = new Date(2026, 9, 10, 13, 0, 0).getTime();
const MADE = new Date(2025, 11, 5, 4, 0, 0); // when the Anki collection was created
const CRT = MADE.getTime() / 1000;
const TODAY = Math.round((Date.UTC(2026, 9, 10) - Date.UTC(2025, 11, 5)) / DAY); // Anki's day number
const DECK = 1700000000001;
const FILTERED = 1700000000002;
const BASIC = 1700000000010;
const CLOZE = 1700000000011;

const dayOf = (time) => Math.round((dayStart(time) - dayStart(NOW)) / DAY);

/** Build a database with `fill`, and return its bytes. */
function database(fill) {
  const folder = mkdtempSync(join(tmpdir(), 'recall-test-'));
  try {
    const db = new DatabaseSync(join(folder, 'c.db'));
    db.exec(`
      create table notes (id integer primary key, mid integer, flds text);
      create table cards (id integer primary key, nid integer, did integer, ord integer, mod integer,
        type integer, queue integer, due integer, ivl integer, factor integer, reps integer,
        lapses integer, left integer, odue integer, odid integer, data text);
      create table revlog (id integer primary key, cid integer, ease integer, type integer);
    `);
    fill(db);
    db.close();
    return readFileSync(join(folder, 'c.db'));
  } finally {
    rmSync(folder, { recursive: true });
  }
}

const CARD = { did: DECK, ord: 0, mod: 1791000000, type: 0, queue: 0, due: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, odue: 0, odid: 0, data: '{}' };

function addCards(db, cards) {
  const note = db.prepare('insert or ignore into notes values (?, ?, ?)');
  const card = db.prepare('insert into cards values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const { mid = BASIC, flds, nid, ...rest } of cards) {
    const c = { ...CARD, ...rest };
    note.run(nid ?? c.id, mid, flds);
    card.run(c.id, nid ?? c.id, c.did, c.ord, c.mod, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.odue, c.odid, c.data);
  }
}

const CARDS = [
  { id: 1790000000001, flds: 'Hello\x1fOlá', type: 2, queue: 2, due: TODAY + 3, ivl: 16, factor: 2650, reps: 2 },
  { id: 1790000000002, flds: 'Late\x1f<b>Atrasado</b>', type: 2, queue: 2, due: TODAY - 2, ivl: 10, factor: 2500, reps: 4 },
  { id: 1790000000003, flds: 'Learning\x1fA aprender', type: 1, queue: 1, due: NOW / 1000 + 300, left: 1001, reps: 1 },
  { id: 1790000000004, flds: 'Lapsed\x1fEsquecido', type: 3, queue: 1, due: NOW / 1000 + 60, ivl: 1, factor: 2300, left: 1001, reps: 8, lapses: 1 },
  { id: 1790000000005, flds: 'Second new\x1fSegundo', due: 2 },
  { id: 1790000000006, flds: 'First new\x1fPrimeiro', due: 1 },
  { id: 1790000000007, flds: 'Suspended\x1fSuspenso', type: 2, queue: -1, due: TODAY, ivl: 5, factor: 2500 },
  { id: 1790000000008, mid: CLOZE, flds: '{{c1::Lisboa}} fica em {{c2::Portugal::país}}\x1fExtra', ord: 1, due: 3 },
  { id: 1790000000009, flds: 'Borrowed\x1fEmprestado', did: FILTERED, odid: DECK, type: 2, queue: 2, due: -99, odue: TODAY + 5, ivl: 7, factor: 2500 },
];

const REVLOG = [
  [NOW - 20 * DAY, 1790000000001, 3, 0],
  [NOW - 19 * DAY, 1790000000001, 3, 2],
  [NOW - 3000, 1790000000003, 1, 0],
];

function addHistory(db) {
  const row = db.prepare('insert into revlog values (?, ?, ?, ?)');
  for (const entry of REVLOG) row.run(...entry);
}

const BASIC_BACK = '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}\n{{tts pt_PT:Back}}';

function legacy(dconf = {}) {
  return database((db) => {
    db.exec('create table col (crt integer, conf text, models text, decks text, dconf text)');
    const models = {
      [BASIC]: { id: BASIC, type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{Front}}', afmt: BASIC_BACK }] },
      [CLOZE]: { id: CLOZE, type: 1, flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }] },
    };
    const decks = {
      1: { id: 1, name: 'Default', conf: 1, dyn: 0 },
      [DECK]: { id: DECK, name: 'Languages::Portuguese', conf: 1, dyn: 0 },
      [FILTERED]: { id: FILTERED, name: 'Cram', dyn: 1 },
    };
    const options = {
      new: { delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], perDay: 15 },
      rev: { ease4: 1.3, ivlFct: 1, maxIvl: 36500, hardFactor: 1.2 },
      lapse: { delays: [10], minInt: 1, mult: 0 },
      desiredRetention: 0.9,
      ...dconf,
    };
    db.prepare('insert into col values (?, ?, ?, ?, ?)').run(
      CRT,
      JSON.stringify({ creationOffset: MADE.getTimezoneOffset() }),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify({ 1: options }),
    );
    addCards(db, CARDS);
    addHistory(db);
  });
}

// Protobuf, enough to write the blobs Anki keeps in its current layout.
const tag = (field, wire) => {
  const key = field * 8 + wire;
  return key < 128 ? [key] : [(key % 128) + 128, Math.floor(key / 128)];
};
const float = (x) => [...new Uint8Array(new Float32Array([x]).buffer)];
const pbFloat = (field, x) => [...tag(field, 5), ...float(x)];
const pbFloats = (field, xs) => [...tag(field, 2), xs.length * 4, ...xs.flatMap(float)];
const pbVarint = (field, n) => [...tag(field, 0), n];
const pbString = (field, s) => [...tag(field, 2), Buffer.byteLength(s), ...Buffer.from(s)];
const blob = (...parts) => Uint8Array.from(parts.flat());

const FSRS_PARAMS = Array.from({ length: 21 }, (_, i) => +(0.25 + i / 8).toFixed(4));

function current({ fsrs = false, cards = CARDS, config } = {}) {
  return database((db) => {
    db.exec(`
      create table col (crt integer);
      create table config (KEY text primary key, val blob);
      create table deck_config (id integer primary key, config blob);
      create table decks (id integer primary key, name text, kind blob);
      create table notetypes (id integer primary key, config blob);
      create table fields (ntid integer, ord integer, name text);
      create table templates (ntid integer, ord integer, config blob);
    `);
    db.prepare('insert into col values (?)').run(CRT);
    const setting = db.prepare('insert into config values (?, ?)');
    setting.run('creationOffset', Buffer.from(String(MADE.getTimezoneOffset())));
    setting.run('fsrs', Buffer.from(String(fsrs)));
    db.prepare('insert into deck_config values (1, ?)').run(
      config ??
        blob(pbFloats(1, [1, 10]), pbFloats(2, [10]), pbVarint(9, 15), pbFloat(11, 2.5), pbFloat(12, 1.3), pbFloat(13, 1.2), pbFloat(15, 1), [...tag(16, 0), 0x94, 0x9d, 0x02], pbVarint(17, 1), pbVarint(18, 1), pbVarint(19, 4), pbFloat(37, 0.9)),
    );
    const deck = db.prepare('insert into decks values (?, ?, ?)');
    deck.run(1, 'Default', blob([0x0a, 0x02, 0x08, 0x01]));
    deck.run(DECK, 'Languages\x1fPortuguese', blob([0x0a, 0x02, 0x08, 0x01]));
    deck.run(FILTERED, 'Cram', blob([0x12, 0x00]));
    const notetype = db.prepare('insert into notetypes values (?, ?)');
    notetype.run(BASIC, blob(pbString(3, '.card {}')));
    notetype.run(CLOZE, blob(pbVarint(1, 1)));
    const field = db.prepare('insert into fields values (?, ?, ?)');
    [[BASIC, 0, 'Front'], [BASIC, 1, 'Back'], [CLOZE, 0, 'Text'], [CLOZE, 1, 'Extra']].forEach((f) => field.run(...f));
    const template = db.prepare('insert into templates values (?, ?, ?)');
    template.run(BASIC, 0, blob(pbString(1, '{{Front}}'), pbString(2, BASIC_BACK)));
    template.run(CLOZE, 0, blob(pbString(1, '{{cloze:Text}}'), pbString(2, '{{cloze:Text}}<br>{{Extra}}')));
    addCards(db, cards);
    addHistory(db);
  });
}

const cardNamed = (deck, front) => deck.cards.find((card) => card.front.startsWith(front));

function checkDeck({ decks, suspended, blank }) {
  assert.equal(decks.length, 1);
  assert.equal(suspended, 1);
  assert.equal(blank, 0);
  const [deck] = decks;
  assert.equal(deck.name, 'Languages::Portuguese');
  assert.deepEqual(deck.settings, { scheduler: 'sm2', newPerDay: 15, retention: 0.9, easyInterval: 4 });
  assert.deepEqual(deck.custom, []);
  assert.equal(deck.cards.length, 8);

  const hello = cardNamed(deck, 'Hello');
  assert.equal(hello.back, 'Olá');
  assert.equal(hello.state, State.Review);
  assert.equal(dayOf(hello.due), 3);
  assert.equal(hello.scheduledDays, 16);
  assert.equal(hello.ease, 2.65);
  assert.equal(hello.created, 1790000000001);
  assert.equal(hello.introduced, NOW - 20 * DAY);
  assert.ok(hello.stability > 1, 'FSRS memory is rebuilt from the review history');

  // On the day it is due, a review card is exactly one interval old.
  assert.equal(daysElapsed(hello.lastReview, hello.due), 16);
  const late = cardNamed(deck, 'Late');
  assert.equal(late.back, 'Atrasado');
  assert.equal(dayOf(late.due), -2);
  assert.equal(daysElapsed(late.lastReview, NOW), 12);

  const learning = cardNamed(deck, 'Learning');
  assert.equal(learning.state, State.Learning);
  assert.equal(learning.due, NOW + 300_000);
  assert.equal(learning.left, 1001);
  assert.equal(learning.ease, 2.5);

  const lapsed = cardNamed(deck, 'Lapsed');
  assert.equal(lapsed.state, State.Relearning);
  assert.equal(lapsed.due, NOW + 60_000);
  assert.equal(lapsed.scheduledDays, 1);
  assert.equal(lapsed.lapses, 1);

  const fresh = deck.cards.filter((card) => card.state === State.New).sort((a, b) => a.created - b.created);
  assert.deepEqual(fresh.map((card) => card.front), ['First new', 'Second new', 'Lisboa fica em [país]']);
  assert.equal(fresh[2].back, 'Lisboa fica em Portugal\nExtra');

  // A card borrowed by a filtered deck goes back to its own deck and due date.
  assert.equal(dayOf(cardNamed(deck, 'Borrowed').due), 5);
}

test('reads the older Anki layout with every card in its place', async () => {
  checkDeck(await readAnkiCollection(legacy(), NOW));
});

test('reads the current Anki layout, compressed or not', async () => {
  const bytes = current();
  checkDeck(await readAnkiCollection(bytes, NOW));
  checkDeck(await readAnkiCollection(zstdCompressSync(bytes), NOW));
});

test('an imported review card gets the intervals Anki would give it', async () => {
  const { decks } = await readAnkiCollection(legacy(), NOW);
  const hello = cardNamed(decks[0], 'Hello');
  // Answered on its due day: 16 days at 265% ease.
  const next = preview(hello, hello.due, { scheduler: 'sm2' });
  assert.equal(next[Rating.Hard].scheduledDays, 19);
  assert.equal(next[Rating.Good].scheduledDays, 42);
  assert.equal(next[Rating.Easy].scheduledDays, 55);
  // Two days late: Good counts half the delay, Easy all of it.
  const late = preview(cardNamed(decks[0], 'Late'), NOW, { scheduler: 'sm2' });
  assert.equal(late[Rating.Good].scheduledDays, 28);
  assert.equal(late[Rating.Easy].scheduledDays, 39);
});

test('keeps FSRS, its parameters and each card’s memory state', async () => {
  const lrt = Math.floor((NOW - 6 * DAY) / 1000);
  const cards = [{ ...CARDS[0], data: JSON.stringify({ s: 12.5, d: 5.25, lrt }) }];
  const config = blob(pbFloats(1, [1, 10]), pbFloats(2, [10]), pbFloats(6, FSRS_PARAMS), pbVarint(9, 20), pbFloat(11, 2.1), [...tag(16, 0), 0x94, 0x9d, 0x02], pbFloat(37, 0.85));
  const { decks } = await readAnkiCollection(current({ fsrs: true, cards, config }), NOW);
  assert.deepEqual(decks[0].settings, { scheduler: 'fsrs', newPerDay: 20, retention: 0.85, easyInterval: 0, fsrsParams: FSRS_PARAMS });
  assert.deepEqual(decks[0].custom, [], 'ease settings do not matter with FSRS');
  const [card] = decks[0].cards;
  assert.equal(card.stability, 12.5);
  assert.equal(card.difficulty, 5.25);
  assert.equal(card.lastReview, lrt * 1000);
});

test('names the Anki options Recall does not have', async () => {
  const bytes = legacy({ new: { delays: [1, 10, 1440], initialFactor: 2300, ints: [3, 7, 0], perDay: 5 } });
  const { decks } = await readAnkiCollection(bytes, NOW);
  assert.deepEqual(decks[0].custom, ['learning steps', 'graduating interval', 'starting ease']);
  assert.equal(decks[0].settings.newPerDay, 5);
  assert.equal(decks[0].settings.easyInterval, 7);
});

test('rejects files that are not Anki collections', async () => {
  await assert.rejects(readAnkiCollection(Buffer.from('not a database at all'), NOW), /not an Anki collection/);
});

test('turns card HTML into plain text', () => {
  assert.equal(htmlToText('<div>Sou <strong>casado</strong> &mdash; male</div><div>Sou&nbsp;casada</div>'), 'Sou casado — male\nSou casada');
  assert.equal(htmlToText('<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>'), 'a b\nc');
  assert.equal(htmlToText('<style>.x { color: red }</style>caf&eacute; &#233; [sound:a.mp3]'), 'caf&eacute; é');
});

test('keeps images as tokens naming the file, and maths as MathJax writes it', () => {
  assert.equal(htmlToText('<div>Arm</div><div><img src="arm &amp; joint.png" alt=""></div>'), 'Arm\n[image:arm%20%26%20joint.png]');
  assert.equal(htmlToText("<img class=x src='a.png'>"), '[image:a.png]');
  assert.equal(htmlToText('\\(x &lt; y\\) and \\[\\theta\\]'), '\\(x < y\\) and \\[\\theta\\]');
  assert.equal(htmlToText('[$]a^2[/$] then [$$]b[/$$]'), '\\(a^2\\) then \\[b\\]');
});

/** An Anki package holding the older layout, two cards with images and the images named. */
function packageWithImages(mediaFile, files) {
  const bytes = database((db) => {
    db.exec('create table col (crt integer, conf text, models text, decks text, dconf text)');
    const models = { [BASIC]: { id: BASIC, type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ ord: 0, qfmt: '{{Front}}', afmt: BASIC_BACK }] } };
    const decks = { [DECK]: { id: DECK, name: 'Robotics', conf: 1, dyn: 0 } };
    db.prepare('insert into col values (?, ?, ?, ?, ?)').run(CRT, '{}', JSON.stringify(models), JSON.stringify(decks), '{}');
    addCards(db, [
      { id: 1790000000001, flds: 'Which joint?<br><img src="arm one.png">\x1fRevolute: \\(\\theta\\)' },
      { id: 1790000000002, flds: '<img src="gone.png">\x1fNothing left on the front' },
      { id: 1790000000003, flds: 'Same picture\x1f<img src="arm%20one.png">' },
    ]);
  });
  return zip({ 'collection.anki2': bytes, media: mediaFile, ...files });
}

async function checkPackage(file) {
  const saved = [];
  const result = await readAnkiPackage(file, {
    now: NOW,
    saveImage: async (bytes) => {
      saved.push(Buffer.from(bytes));
      return 'stored.png';
    },
  });
  assert.deepEqual(saved, [PNG]);
  const cards = result.decks[0].cards.map(({ front, back }) => ({ front, back }));
  assert.deepEqual(cards, [
    { front: 'Which joint?\n[image:stored.png]', back: 'Revolute: \\(\\theta\\)' },
    { front: 'Same picture', back: '[image:stored.png]' },
  ]);
  assert.equal(result.missingImages, 1);
  assert.equal(result.blank, 1, 'a card whose front was only a missing image is left out');
}

test('stores the images of an older Anki package and points the cards at them', async () => {
  await checkPackage(packageWithImages(JSON.stringify({ 0: 'arm one.png' }), { 0: PNG }));
});

test('reads the compressed list of images in a current Anki package', async () => {
  const entries = blob([...tag(1, 2), 13, ...pbString(1, 'arm one.png')]);
  await checkPackage(packageWithImages(zstdCompressSync(entries), { 0: zstdCompressSync(PNG) }));
});

test('fills in templates: conditional sections, hints and reversed cards', () => {
  const notetype = {
    cloze: false,
    fields: ['Front', 'Back', 'Note'],
    templates: [
      { front: '{{Front}}{{#Note}}<br>({{Note}}){{/Note}}', back: '{{FrontSide}}<hr id="answer">{{Back}}{{^Note}} (no note){{/Note}}{{type:Back}}' },
      { front: '{{Back}}', back: '{{FrontSide}}<hr id=answer>{{text:Front}} {{Tags}}' },
    ],
  };
  assert.deepEqual(renderCard(notetype, ['cão', 'dog', 'animal'], 0), { front: 'cão\n(animal)', back: 'dog' });
  assert.deepEqual(renderCard(notetype, ['cão', 'dog', ''], 0), { front: 'cão', back: 'dog (no note)' });
  assert.deepEqual(renderCard(notetype, ['cão', 'dog', ''], 1), { front: 'dog', back: 'cão' });
});

test('importing into Recall adds decks once and makes the cards due as in Anki', async () => {
  store.reset();
  const { decks } = await readAnkiCollection(legacy(), NOW);
  assert.equal(store.importAnkiDecks(decks, NOW), 8);
  const [deck] = store.decks();
  assert.equal(deck.name, 'Languages::Portuguese');
  assert.equal(deck.newPerDay, 15);
  // One overdue review, two cards in learning steps and three new cards.
  assert.deepEqual(store.counts(deck.id, NOW), { new: 3, learning: 2, review: 1, total: 6, tomorrow: { new: 0, learning: 0, review: 0, total: 0 }, cards: 8, reserve: 0 });
  assert.equal(store.counts(deck.id, NOW + 3 * DAY).review, 2);
  assert.equal(store.nextCard(deck.id, NOW).front, 'Late');

  // The same file again adds nothing; a card deleted here comes back.
  assert.equal(store.importAnkiDecks(decks, NOW), 0);
  store.deleteCard(store.cardsIn(deck.id).find((card) => card.front === 'Hello').id);
  assert.equal(store.importAnkiDecks(decks, NOW), 1);
  assert.equal(store.decks().length, 1);
  assert.equal(store.cardsIn(deck.id).length, 8);
});

test('an Anki import can put its new cards on reserve, in Anki’s order, leaving studied ones alone', async () => {
  store.reset();
  const { decks } = await readAnkiCollection(legacy(), NOW);
  assert.equal(store.importAnkiDecks(decks, NOW, { reserved: true }), 8);
  const [deck] = store.decks();
  assert.deepEqual(store.reserveIn(deck.id).map((card) => card.front), ['First new', 'Second new', 'Lisboa fica em [país]']);
  // Nothing new is left to study; the review and learning cards keep their schedule.
  assert.deepEqual(store.counts(deck.id, NOW), { new: 0, learning: 2, review: 1, total: 3, tomorrow: { new: 0, learning: 0, review: 0, total: 0 }, cards: 8, reserve: 3 });
  assert.equal(store.pullFromReserve(deck.id, 1, NOW), 1);
  assert.equal(store.counts(deck.id, NOW).new, 1);
});
