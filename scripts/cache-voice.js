// Downloads the audio for both sides of every card, reserve included, into data/audio/, so
// cards are read aloud straight from disk. Maths and images are not read, and decks set not
// to save their audio are left out. Clips already saved are skipped, so it can be
// stopped at any time and run again to carry on. Run it with: npm run cache-voice
// Options: --delay=<ms> sets the pause after each new clip (default 700), to go easy on the
// voice service.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { speechText } from '../js/content.js';
import { DECK_DEFAULTS } from '../js/store.js';
import { createTts } from '../tts.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = resolve(process.env.RECALL_DATA || join(ROOT, 'data'));
// Stop after this many clips in a row could not come from the first-choice voice.
const MAX_MISSES = 3;

/**
 * Every distinct `{ text, lang }` the app can ask to hear, in the language it reads each side
 * in: cards being studied first, then the reserve in the order it is pulled in.
 */
export function speechRequests({ decks = [], cards = [] }) {
  const byId = new Map(decks.map((d) => [d.id, { ...DECK_DEFAULTS, ...d }]));
  const reserve = cards.filter((c) => c.reserved).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.created - b.created);
  const seen = new Set();
  const requests = [];
  for (const card of [...cards.filter((c) => !c.reserved), ...reserve]) {
    const deck = byId.get(card.deckId);
    if (!deck?.saveAudio) continue;
    for (const side of ['front', 'back']) {
      const text = speechText(card[side]);
      // A reversed card reads each side in the language of the deck's other side.
      const lang = deck[`${card.reversed ? (side === 'front' ? 'back' : 'front') : side}Lang`];
      const key = `${lang}\n${text}`;
      if (!text || seen.has(key)) continue;
      seen.add(key);
      requests.push({ text, lang });
    }
  }
  return requests;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const delay = Number(process.argv.find((a) => a.startsWith('--delay='))?.slice(8) ?? 700);
  const file = join(DATA_DIR, 'recall.json');
  const state = await readFile(file, 'utf8').then(JSON.parse, () => null);
  if (!state) {
    console.error(`No cards found: ${file} does not exist yet.`);
    process.exit(1);
  }
  const requests = speechRequests(state);
  const tts = createTts({ root: ROOT, dataDir: DATA_DIR });
  console.log(`${requests.length.toLocaleString()} card sides to check, from ${state.cards.length.toLocaleString()} cards.`);

  const tally = { downloaded: 0, saved: 0, failed: 0 };
  let misses = 0;
  const progress = (i) => {
    // Without a terminal, such as in a log, a line every hundred clips.
    if (!process.stdout.isTTY && i % 100 && i !== requests.length) return;
    process.stdout.write(`${process.stdout.isTTY ? '\r' : ''}${i.toLocaleString()}/${requests.length.toLocaleString()}: ${tally.downloaded} downloaded, ${tally.saved} already saved, ${tally.failed} failed${process.stdout.isTTY ? '' : '\n'}`);
  };
  for (const [i, { text, lang }] of requests.entries()) {
    let clip;
    try {
      clip = await tts.prepare(text, lang);
    } catch (error) {
      clip = { error };
    }
    if (clip.preferred) {
      misses = 0;
      tally[clip.fresh ? 'downloaded' : 'saved']++;
    } else {
      // Failed, or made by a fallback voice: the first choice did not answer.
      misses++;
      tally.failed++;
      if (misses >= MAX_MISSES) {
        progress(i + 1);
        const reason = clip.error ? clip.error.message : `the audio came from ${clip.engine} instead`;
        console.error(`\nStopped: the voice service is not answering (${reason}). It may be limiting requests; run this again later to carry on.`);
        process.exit(1);
      }
    }
    progress(i + 1);
    if (clip.fresh || clip.error) await wait(delay);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  console.log(`Done: ${tally.downloaded} downloaded, ${tally.saved} already saved${tally.failed ? `, ${tally.failed} failed (run again to retry them)` : ''}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
