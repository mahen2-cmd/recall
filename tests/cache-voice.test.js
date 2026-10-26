import test from 'node:test';
import assert from 'node:assert/strict';

import { speechRequests } from '../scripts/cache-voice.js';

test('every side of every card is asked for once, in its language, reserve last', () => {
  const decks = [{ id: 'pt', frontLang: 'en-GB', backLang: 'pt-PT' }, { id: 'plain' }];
  const card = (id, deckId, front, back, extra) => ({ id, deckId, front, back, created: 0, ...extra });
  const cards = [
    card('r2', 'pt', 'later', 'depois', { reserved: true, order: 1 }),
    card('r1', 'pt', 'soon', 'logo', { reserved: true, order: 0 }),
    card('a', 'pt', 'hello', ' olá ', {}),
    card('b', 'pt', 'olá', 'hello', { reversed: true }),
    card('c', 'plain', 'two  words', '', {}),
    card('d', 'gone', 'orphan', 'órfão', {}),
  ];
  assert.deepEqual(speechRequests({ decks, cards }), [
    { text: 'hello', lang: 'en-GB' },
    { text: 'olá', lang: 'pt-PT' },
    { text: 'two words', lang: 'en-US' },
    { text: 'soon', lang: 'en-GB' },
    { text: 'logo', lang: 'pt-PT' },
    { text: 'later', lang: 'en-GB' },
    { text: 'depois', lang: 'pt-PT' },
  ]);
});
