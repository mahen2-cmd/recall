import { DAY, MINUTE, Rating, State } from './fsrs.js';
import { ankiCollection, parseSpreadsheet } from './importer.js';
import * as store from './store.js';

const app = document.getElementById('app');
const toasts = document.getElementById('toasts');

// The card currently on screen in study mode.
const session = { deckId: null, cardId: null, revealed: false, done: 0, spoken: null };
let query = '';

// ---- DOM helpers ----------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  disk: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  browser: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  speaker: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  play: '<path d="M7 5l12 7-12 7V5z"/>',
};

function icon(name) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return span;
}

const iconButton = (name, label, onclick, extra = '') =>
  h('button', { class: `icon-btn ${extra}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function toast(message) {
  const el = h('div', { class: 'toast' }, message);
  toasts.append(el);
  setTimeout(() => el.remove(), 2600);
}

function formatInterval(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const days = Math.round(ms / DAY);
  if (days < 1) return `${Math.round(minutes / 60)}h`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${+(days / 30).toFixed(1)}mo`;
  return `${+(days / 365).toFixed(1)}y`;
}

function cardStatus(card, now) {
  if (card.state === State.New) return { kind: 'new', label: 'New' };
  if (card.state !== State.Review) return { kind: 'learning', label: 'Learning' };
  const days = Math.round((new Date(card.due).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return { kind: 'review', label: 'Due today' };
  return { kind: 'zero', label: `Due in ${formatInterval(days * DAY)}` };
}

function countPills(c) {
  const pill = (kind, n, label) =>
    h('span', { class: `pill ${n ? kind : 'zero'}`, title: `${n} ${label.toLowerCase()}` }, h('b', null, String(n)), h('span', null, label));
  return h('div', { class: 'counts' }, pill('new', c.new, 'New'), pill('learning', c.learning, 'Learning'), pill('review', c.review, 'Due'));
}

// ---- Speech ---------------------------------------------------------------
// Uses the server's voice when there is one, otherwise the browser's own.

const LANGUAGES = [
  ['pt-PT', 'Portuguese (Portugal)'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
];
let player = null;
let speechToken = 0;

const ttsUrl = (text, lang) => `api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`;
const serverVoice = () => store.storageInfo().voice;
const canSpeak = () => Boolean(serverVoice()) || 'speechSynthesis' in window;

function stopSpeaking() {
  speechToken++;
  player?.pause();
  player = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

async function speak(text, lang, rate = 1) {
  stopSpeaking();
  if (!text.trim()) return;
  if (!serverVoice()) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-') === lang) ?? null;
    speechSynthesis.speak(utterance);
    return;
  }
  const token = speechToken;
  try {
    const res = await fetch(ttsUrl(text, lang));
    if (!res.ok) throw new Error(await res.text());
    const url = URL.createObjectURL(await res.blob());
    if (token !== speechToken) return; // moved on while the audio was loading
    player = new Audio(url);
    player.playbackRate = rate; // the browser keeps the pitch natural
    player.addEventListener('ended', () => URL.revokeObjectURL(url));
    await player.play();
  } catch (error) {
    // The browser refuses sound before the first click or key press; that is not an error.
    const blocked = error.name === 'NotAllowedError' || error.name === 'AbortError';
    if (token === speechToken && !blocked) toast(error.message || 'Could not play audio');
  }
}

/** Generate audio ahead of time so it plays instantly later. */
function prepareSpeech(text, lang) {
  if (serverVoice() && text.trim()) fetch(ttsUrl(text, lang)).catch(() => {});
}

/** Read one side of a card aloud, in that side's language. */
const speakSideOf = (card, deck, side) => speak(card[side], deck[`${side}Lang`], deck.speechRate);

const speaksSide = (deck, side) => deck.speak === side || deck.speak === 'both';

function prepareCardSpeech(card) {
  const deck = store.deck(card.deckId);
  if (speaksSide(deck, 'front')) prepareSpeech(card.front, deck.frontLang);
  if (speaksSide(deck, 'back')) prepareSpeech(card.back, deck.backLang);
}

const speakButton = (card, deck, side) =>
  canSpeak() &&
  h('button', { class: 'speak', type: 'button', title: `Listen to the ${side} (R)`, 'aria-label': `Listen to the ${side}`, onclick: () => speakSideOf(card, deck, side) }, icon('speaker'));

// ---- Theme ----------------------------------------------------------------

function applyTheme() {
  const saved = store.setting('theme');
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = saved ?? system;
}

function toggleTheme() {
  store.setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
  render();
}

// ---- Dialogs --------------------------------------------------------------

function modal(title, content, { narrow = false, onclose } = {}) {
  const dialog = h(
    'dialog',
    { class: `modal ${narrow ? 'narrow' : ''}` },
    h(
      'div',
      { class: 'modal-body' },
      h('div', { class: 'modal-head' }, h('h2', null, title), iconButton('close', 'Close', () => close())),
      content,
    ),
  );
  // Clean up synchronously; the native `close` event (fired late, e.g. on Esc) is a fallback.
  const finish = () => {
    if (!dialog.isConnected) return;
    dialog.remove();
    onclose?.();
  };
  const close = () => {
    dialog.close();
    finish();
  };
  // Close on a backdrop click, but not when a drag merely ends outside the box.
  let pressedBackdrop = false;
  dialog.addEventListener('mousedown', (e) => (pressedBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => pressedBackdrop && e.target === dialog && close());
  dialog.addEventListener('close', finish);
  document.body.append(dialog);
  dialog.showModal();
  return { close };
}

function confirmDialog({ title, message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = modal(
      title,
      [
        h('p', { class: 'message' }, message),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
          h(
            'button',
            {
              class: 'btn danger',
              type: 'button',
              onclick: () => {
                confirmed = true;
                dialog.close();
              },
            },
            confirmLabel,
          ),
        ),
      ],
      { narrow: true, onclose: () => resolve(confirmed) },
    );
  });
}

function openDeckDialog(deck) {
  const defaults = deck ?? store.DECK_DEFAULTS;
  const name = h('input', { type: 'text', required: true, maxLength: 80, value: deck?.name ?? '', placeholder: 'e.g. Spanish vocabulary' });
  const newPerDay = h('input', { type: 'number', required: true, min: 0, max: 9999, step: 1, value: defaults.newPerDay });
  const retention = h('input', { type: 'number', required: true, min: 70, max: 97, step: 1, value: Math.round(defaults.retention * 100) });
  const easyInterval = h('input', { type: 'number', required: true, min: 0, max: 365, step: 1, value: defaults.easyInterval });
  const scheduler = h(
    'select',
    null,
    [['sm2', 'Anki default'], ['fsrs', 'FSRS']].map(([value, label]) =>
      h('option', { value, selected: value === defaults.scheduler }, label),
    ),
  );
  const speakSide = h(
    'select',
    null,
    [['none', 'Off'], ['front', 'Front'], ['back', 'Back'], ['both', 'Both sides']].map(([value, label]) =>
      h('option', { value, selected: value === defaults.speak }, label),
    ),
  );
  const languageSelect = (selected) =>
    h('select', null, LANGUAGES.map(([value, label]) => h('option', { value, selected: value === selected }, label)));
  const frontLang = languageSelect(defaults.frontLang);
  const backLang = languageSelect(defaults.backLang);

  const speechRate = h(
    'select',
    null,
    [[1, 'Normal'], [0.9, 'Slightly slower'], [0.8, 'Slower'], [0.7, 'Slow'], [0.6, 'Very slow']].map(([value, label]) =>
      h('option', { value, selected: value === defaults.speechRate }, label),
    ),
  );

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const values = {
          name: name.value.trim(),
          scheduler: scheduler.value,
          newPerDay: Number(newPerDay.value),
          retention: Number(retention.value) / 100,
          easyInterval: Number(easyInterval.value),
          speak: speakSide.value,
          frontLang: frontLang.value,
          backLang: backLang.value,
          speechRate: Number(speechRate.value),
        };
        if (!values.name) return name.focus();
        if (deck) store.updateDeck(deck.id, values);
        else store.createDeck(values);
        dialog.close();
      },
    },
    h('label', { class: 'field' }, h('span', null, 'Name'), name),
    h(
      'div',
      { class: 'field-row' },
      h('label', { class: 'field' }, h('span', null, 'New cards per day'), newPerDay),
      h('label', { class: 'field' }, h('span', null, 'Easy interval (days)'), easyInterval),
    ),
    h(
      'div',
      { class: 'field-row' },
      h('label', { class: 'field' }, h('span', null, 'Scheduling'), scheduler),
      h('label', { class: 'field' }, h('span', null, 'FSRS retention (%)'), retention),
    ),
    h('small', { class: 'field-note' }, 'Anki default grows each interval by the card\u2019s ease, as Anki does out of the box. FSRS matches Anki with FSRS switched on. You can switch at any time.'),
    canSpeak() && [
      h(
        'div',
        { class: 'field-row', style: 'margin-top: 16px' },
        h('label', { class: 'field' }, h('span', null, 'Auto-play audio'), speakSide),
        h('label', { class: 'field' }, h('span', null, 'Speaking speed'), speechRate),
      ),
      h(
        'div',
        { class: 'field-row' },
        h('label', { class: 'field' }, h('span', null, 'Front language'), frontLang),
        h('label', { class: 'field' }, h('span', null, 'Back language'), backLang),
      ),
      h('small', { class: 'field-note' }, 'Auto-play reads a side aloud when it appears, in that side’s language. You can always play either side with its speaker button.'),
    ],
    h(
      'div',
      { class: 'modal-foot' },
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, deck ? 'Save' : 'Create deck'),
    ),
  );
  const dialog = modal(deck ? 'Deck settings' : 'New deck', form, { narrow: true, onclose: render });
  name.focus();
}

function openCardDialog({ card, deckId }) {
  const front = h('textarea', { required: true, value: card?.front ?? '', placeholder: 'Question or prompt' });
  const back = h('textarea', { required: true, value: card?.back ?? '', placeholder: 'Answer' });
  const deckSelect = h(
    'select',
    null,
    store.decks().map((d) => h('option', { value: d.id, selected: d.id === (card?.deckId ?? deckId) }, d.name)),
  );
  const note = h('span', { class: 'note' }, 'Ctrl + Enter to save');

  const submitOnCtrlEnter = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  front.addEventListener('keydown', submitOnCtrlEnter);
  back.addEventListener('keydown', submitOnCtrlEnter);

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const values = { front: front.value.trim(), back: back.value.trim() };
        if (!values.front) return front.focus();
        if (!values.back) return back.focus();
        if (card) {
          store.updateCard(card.id, { ...values, deckId: deckSelect.value });
          prepareCardSpeech(store.card(card.id));
          dialog.close();
          return;
        }
        // Stay open so several cards can be added in a row.
        prepareCardSpeech(store.addCard(deckSelect.value, values.front, values.back));
        front.value = back.value = '';
        note.textContent = 'Card added';
        note.className = 'note ok';
        front.focus();
        render();
      },
    },
    h('label', { class: 'field' }, h('span', null, 'Front'), front),
    h('label', { class: 'field' }, h('span', null, 'Back'), back),
    h('label', { class: 'field' }, h('span', null, 'Deck'), deckSelect),
    h(
      'div',
      { class: 'modal-foot' },
      note,
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, card ? 'Cancel' : 'Done'),
      h('button', { class: 'btn primary', type: 'submit' }, card ? 'Save' : 'Add card'),
    ),
  );
  const dialog = modal(card ? 'Edit card' : 'Add card', form, { onclose: render });
  front.focus();
}

async function removeDeck(deck) {
  const n = store.cardsIn(deck.id).length;
  const ok = await confirmDialog({
    title: `Delete “${deck.name}”?`,
    message: n ? `This deck and its ${plural(n, 'card')} will be permanently deleted.` : 'This deck will be permanently deleted.',
    confirmLabel: 'Delete deck',
  });
  if (!ok) return;
  store.deleteDeck(deck.id);
  if (location.hash !== '#/') location.hash = '#/';
  else render();
}

async function removeCard(card) {
  const ok = await confirmDialog({
    title: 'Delete this card?',
    message: 'The card and its review history will be permanently deleted.',
    confirmLabel: 'Delete card',
  });
  if (!ok) return;
  store.deleteCard(card.id);
  render();
}

// ---- Import cards from a spreadsheet ------------------------------------------

const columnName = (i) => (i >= 26 ? columnName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const cardKey = (text) => text.trim().toLowerCase();

/** Work out which rows become cards, and why the others are left out. */
function planImport(rows, { front, back, header, skipExisting, existing }) {
  const seen = new Set(skipExisting ? existing : []);
  const plan = { cards: [], incomplete: 0, duplicates: 0 };
  for (const row of header ? rows.slice(1) : rows) {
    const pair = [row[front] ?? '', row[back] ?? ''];
    if (!pair[0] || !pair[1]) plan.incomplete++;
    else if (skipExisting && seen.has(cardKey(pair[0]))) plan.duplicates++;
    else {
      seen.add(cardKey(pair[0]));
      plan.cards.push(pair);
    }
  }
  return plan;
}

function pickImportFile(deck) {
  const input = h('input', {
    type: 'file',
    accept: '.xlsx,.csv,.tsv,.txt',
    onchange: async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const rows = await parseSpreadsheet(await file.arrayBuffer(), file.name);
        if (!rows.length) throw new Error('That file has no rows to import.');
        openImportDialog(deck, file.name, rows);
      } catch (error) {
        toast(error.message || 'Could not read that file.');
      }
    },
  });
  input.click();
}

function openImportDialog(deck, fileName, rows) {
  const width = Math.max(...rows.map((row) => row.length));
  const existing = store.cardsIn(deck.id).map((card) => cardKey(card.front));
  const columnSelect = (selected) =>
    h(
      'select',
      { onchange: () => update() },
      Array.from({ length: width }, (_, i) => {
        const sample = rows.find((row) => row[i])?.[i] ?? 'empty';
        const label = `${columnName(i)}: ${sample.length > 28 ? `${sample.slice(0, 28)}…` : sample}`;
        return h('option', { value: i, selected: i === selected }, label);
      }),
    );
  const front = columnSelect(0);
  const back = columnSelect(Math.min(1, width - 1));
  const header = h('input', { type: 'checkbox', onchange: () => update() });
  const skipExisting = h('input', { type: 'checkbox', checked: true, onchange: () => update() });
  const preview = h('div', { class: 'import-preview' });
  const summary = h('p', { class: 'import-summary' });
  const submit = h('button', { class: 'btn primary', type: 'submit' });

  const plan = () =>
    planImport(rows, {
      front: Number(front.value),
      back: Number(back.value),
      header: header.checked,
      skipExisting: skipExisting.checked,
      existing,
    });

  function update() {
    const { cards, incomplete, duplicates } = plan();
    const sameColumn = front.value === back.value;
    const table = h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Front'), h('th', null, 'Back'))),
      h('tbody', null, cards.slice(0, 5).map(([f, b]) => h('tr', null, h('td', null, f), h('td', null, b)))),
    );
    const more = cards.length > 5 ? [h('div', { class: 'import-more' }, `and ${cards.length - 5} more`)] : [];
    preview.replaceChildren(table, ...more);
    preview.hidden = !cards.length;
    const skipped = [
      incomplete && `${plural(incomplete, 'row')} missing a front or back`,
      duplicates && `${plural(duplicates, 'duplicate')}`,
    ].filter(Boolean);
    summary.textContent = sameColumn
      ? 'Front and back are set to the same column. Choose two different columns.'
      : (cards.length ? '' : 'Nothing to import. ') + (skipped.length ? `Skipping ${skipped.join(' and ')}.` : '');
    summary.hidden = !summary.textContent;
    submit.textContent = cards.length ? `Import ${plural(cards.length, 'card')}` : 'Import';
    submit.disabled = !cards.length || sameColumn;
  }

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const { cards } = plan();
        if (!cards.length) return;
        store.addCards(deck.id, cards);
        dialog.close();
        toast(`Imported ${plural(cards.length, 'card')} into ${deck.name}`);
      },
    },
    h('p', { class: 'message', style: 'margin-bottom: 16px' }, `${fileName}: ${plural(rows.length, 'row')}${width > 26 ? '' : `, ${plural(width, 'column')}`}`),
    h(
      'div',
      { class: 'field-row' },
      h('label', { class: 'field' }, h('span', null, 'Front'), front),
      h('label', { class: 'field' }, h('span', null, 'Back'), back),
    ),
    h('label', { class: 'check' }, header, 'The first row is a header, skip it'),
    h('label', { class: 'check' }, skipExisting, 'Skip cards already in this deck'),
    preview,
    summary,
    h(
      'div',
      { class: 'modal-foot' },
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      submit,
    ),
  );
  update();
  const dialog = modal(`Import into ${deck.name}`, form, { onclose: render });
  submit.focus();
}

// ---- Import decks from Anki ---------------------------------------------------

function pickAnkiFile() {
  if (!store.storageInfo().available) {
    toast('Importing from Anki needs the Recall server. Start it with "npm start".');
    return;
  }
  const input = h('input', {
    type: 'file',
    accept: '.apkg,.colpkg',
    onchange: async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const res = await fetch('api/anki', { method: 'POST', body: await ankiCollection(await file.arrayBuffer()) });
        if (!res.ok) throw new Error(await res.text());
        openAnkiDialog(file.name, await res.json());
      } catch (error) {
        toast(error.message || 'Could not read that file.');
      }
    },
  });
  input.click();
}

function openAnkiDialog(fileName, { decks, suspended, blank, media }) {
  const known = store.ankiCardIds();
  const incoming = decks
    .map((deck) => ({ ...deck, cards: deck.cards.filter((card) => !known.has(card.ankiId)) }))
    .filter((deck) => deck.cards.length);
  const total = incoming.reduce((sum, deck) => sum + deck.cards.length, 0);
  const existing = decks.reduce((sum, deck) => sum + deck.cards.length, 0) - total;

  const breakdown = (cards) => {
    const count = (...states) => cards.filter((card) => states.includes(card.state)).length;
    return [
      [count(State.New), 'new'],
      [count(State.Learning, State.Relearning), 'learning'],
      [count(State.Review), 'in review'],
    ]
      .filter(([n]) => n)
      .map(([n, label]) => `${n} ${label}`)
      .join(', ');
  };
  const notes = [
    existing && `${plural(existing, 'card')} already in Recall will be skipped.`,
    suspended && `${plural(suspended, 'suspended card')} will be left out.`,
    blank && `${plural(blank, 'card')} with no text on the front will be left out.`,
    media && 'Images and audio are not imported. Cards are plain text.',
    ...incoming
      .filter((deck) => deck.custom.length)
      .map((deck) => `“${deck.name}” has its own ${deck.custom.join(', ')} in Anki. Recall uses Anki’s defaults for these, so some intervals will differ.`),
  ].filter(Boolean);

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const added = store.importAnkiDecks(incoming);
        dialog.close();
        toast(`Imported ${plural(added, 'card')} from Anki`);
      },
    },
    h(
      'p',
      { class: 'message' },
      total ? `${fileName}: every card keeps its due date, interval and ease from Anki.` : `${fileName}: nothing new to import.`,
    ),
    total > 0 &&
      h(
        'div',
        { class: 'import-preview' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Deck'), h('th', null, 'Cards'))),
          h('tbody', null, incoming.map((deck) => h('tr', null, h('td', null, deck.name), h('td', null, breakdown(deck.cards))))),
        ),
      ),
    notes.map((note) => h('p', { class: 'import-summary' }, note)),
    h(
      'div',
      { class: 'modal-foot' },
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit', disabled: !total }, total ? `Import ${plural(total, 'card')}` : 'Import'),
    ),
  );
  const dialog = modal('Import from Anki', form, { onclose: render });
}

// ---- Backup ---------------------------------------------------------------

function exportBackup() {
  const url = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
  h('a', { href: url, download: `recall-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackup() {
  const input = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      if (store.decks().length) {
        const ok = await confirmDialog({
          title: 'Replace all data?',
          message: 'Importing a backup replaces every deck and card currently in Recall.',
          confirmLabel: 'Replace',
        });
        if (!ok) return;
      }
      try {
        store.importData(text);
        applyTheme();
        toast('Backup imported');
      } catch {
        toast('That file is not a valid Recall backup');
      }
      render();
    },
  });
  input.click();
}

function loadSampleDeck() {
  const deck = store.createDeck({ name: 'How memory works' });
  const cards = [
    ['What is spaced repetition?', 'Reviewing material at increasing intervals, just before you would forget it.'],
    ['What does FSRS stand for?', 'Free Spaced Repetition Scheduler'],
    ['In FSRS, what is “stability”?', 'The number of days it takes for your chance of recalling a card to fall to 90%.'],
    ['In FSRS, what is “retrievability”?', 'The probability that you can recall a card right now.'],
    ['In FSRS, what is “difficulty”?', 'A value from 1 to 10 describing how hard a card is to remember. Harder cards gain stability more slowly.'],
    ['What is the testing effect?', 'Actively recalling information strengthens memory more than re-reading it.'],
  ];
  cards.forEach(([front, back], i) => store.addCard(deck.id, front, back, Date.now() + i));
  render();
}

// ---- Views ----------------------------------------------------------------

function storageChip() {
  const { available, ok, file } = store.storageInfo();
  if (!available) {
    return h('span', { class: 'save-chip', title: 'Saved in this browser only. Start the app with "npm start" to save to a file on your computer.' }, icon('browser'), h('span', null, 'Browser only'));
  }
  if (!ok) {
    return h('span', { class: 'save-chip error', title: `Cannot reach the Recall server, so changes are not reaching ${file}. They are kept in this browser and will be saved once the server is running again.` }, icon('alert'), h('span', null, 'Not saved to disk'));
  }
  return h('span', { class: 'save-chip', title: `Saved to ${file}` }, icon('disk'), h('span', null, 'Saved on this computer'));
}

function topbar() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }), 'Recall'),
    storageChip(),
    iconButton('upload', 'Import backup', importBackup),
    iconButton('download', 'Export backup', exportBackup),
    iconButton(dark ? 'sun' : 'moon', dark ? 'Light theme' : 'Dark theme', toggleTheme),
  );
}

function renderHome() {
  const now = Date.now();
  const decks = store.decks();
  const { reviewedToday, streak } = store.stats(now);
  const all = decks.map((deck) => ({ deck, c: store.counts(deck.id, now) }));
  const due = all.reduce((sum, { c }) => sum + c.total, 0);

  const tile = ({ deck, c }) =>
    h(
      'article',
      { class: 'deck' },
      h(
        'a',
        { class: 'deck-main', href: `#/deck/${deck.id}` },
        h('div', { class: 'deck-name' }, deck.name),
        h('div', { class: 'deck-meta' }, plural(c.cards, 'card')),
        countPills(c),
      ),
      h(
        'div',
        { class: 'deck-foot' },
        c.total
          ? h('a', { class: 'btn primary', href: `#/study/${deck.id}` }, icon('play'), `Study ${c.total}`)
          : c.cards
            ? h('span', { class: 'caught-up' }, icon('check'), 'All caught up')
            : h('button', { class: 'btn', type: 'button', onclick: () => openCardDialog({ deckId: deck.id }) }, icon('plus'), 'Add cards'),
        h('span', { class: 'spacer' }),
        iconButton('edit', 'Deck settings', () => openDeckDialog(deck)),
        iconButton('trash', 'Delete deck', () => removeDeck(deck), 'danger'),
      ),
    );

  const body = decks.length
    ? [
        h(
          'div',
          { class: 'summary' },
          h('div', { class: 'stat' }, h('b', null, String(due)), 'due today'),
          h('div', { class: 'stat' }, h('b', null, String(reviewedToday)), 'reviewed today'),
          h('div', { class: 'stat' }, h('b', null, String(streak)), `day streak`),
        ),
        h(
          'div',
          { class: 'deck-grid' },
          all.map(tile),
          h('button', { class: 'deck add', type: 'button', onclick: () => openDeckDialog() }, icon('plus'), 'New deck'),
        ),
      ]
    : h(
        'div',
        { class: 'empty' },
        h('h2', null, 'Create your first deck'),
        h('p', null, 'Decks group related cards. Add a few cards, then study a little every day. Recall schedules each review for you.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openDeckDialog() }, icon('plus'), 'New deck'),
          h('button', { class: 'btn', type: 'button', onclick: pickAnkiFile }, icon('upload'), 'Import from Anki'),
          h('button', { class: 'btn', type: 'button', onclick: loadSampleDeck }, 'Try a sample deck'),
        ),
      );

  app.replaceChildren(
    h(
      'div',
      { class: 'page' },
      topbar(),
      h(
        'div',
        { class: 'page-head' },
        h('div', null, h('h1', null, 'Decks'), h('p', { class: 'sub' }, decks.length ? plural(decks.length, 'deck') : 'Nothing here yet')),
        decks.length > 0 &&
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn', type: 'button', title: 'Import decks from an Anki .apkg file', onclick: pickAnkiFile }, icon('upload'), 'Import from Anki'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => openDeckDialog() }, icon('plus'), 'New deck'),
          ),
      ),
      body,
    ),
  );
}

function renderDeck(deck) {
  const now = Date.now();
  const c = store.counts(deck.id, now);
  const cards = store.cardsIn(deck.id).sort((a, b) => b.created - a.created);

  const list = h('div');
  const shown = h('span', { class: 'count' });

  const drawList = () => {
    const q = query.trim().toLowerCase();
    const matches = q ? cards.filter((card) => `${card.front}\n${card.back}`.toLowerCase().includes(q)) : cards;
    shown.textContent = q ? `${matches.length} of ${plural(cards.length, 'card')}` : plural(cards.length, 'card');
    if (!matches.length) {
      list.replaceChildren(h('div', { class: 'card-list' }, h('div', { class: 'list-empty' }, `No cards match “${query.trim()}”.`)));
      return;
    }
    list.replaceChildren(
      h(
        'div',
        { class: 'card-list' },
        matches.map((card) => {
          const status = cardStatus(card, now);
          return h(
            'div',
            { class: 'card-row', onclick: () => openCardDialog({ card }) },
            h('div', { class: 'text' }, card.front),
            h('div', { class: 'text back-text' }, card.back),
            h('span', { class: `pill ${status.kind} due`, style: 'justify-self: start' }, status.label),
            h(
              'div',
              { class: 'row-actions', onclick: (e) => e.stopPropagation() },
              iconButton('edit', 'Edit card', () => openCardDialog({ card })),
              iconButton('trash', 'Delete card', () => removeCard(card), 'danger'),
            ),
          );
        }),
      ),
    );
  };

  const search = h('input', {
    type: 'search',
    placeholder: 'Search cards',
    value: query,
    'aria-label': 'Search cards',
    oninput: () => {
      query = search.value;
      drawList();
    },
  });

  const content = cards.length
    ? [h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), shown), list]
    : h(
        'div',
        { class: 'empty' },
        h('h2', null, 'No cards yet'),
        h('p', null, 'Add a question on the front and its answer on the back, or import a list from an Excel file.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openCardDialog({ deckId: deck.id }) }, icon('plus'), 'Add card'),
          h('button', { class: 'btn', type: 'button', onclick: () => pickImportFile(deck) }, icon('upload'), 'Import from Excel'),
        ),
      );
  if (cards.length) drawList();

  app.replaceChildren(
    h(
      'div',
      { class: 'page' },
      topbar(),
      h('a', { class: 'back', href: '#/' }, icon('back'), 'All decks'),
      h(
        'div',
        { class: 'page-head', style: 'margin-top: 14px' },
        h('div', null, h('h1', null, deck.name), countPills(c)),
        h(
          'div',
          { class: 'actions' },
          iconButton('edit', 'Deck settings', () => openDeckDialog(deck)),
          iconButton('trash', 'Delete deck', () => removeDeck(deck), 'danger'),
          h('button', { class: 'btn', type: 'button', title: 'Import cards from an Excel or CSV file', onclick: () => pickImportFile(deck) }, icon('upload'), 'Import'),
          h('button', { class: 'btn', type: 'button', onclick: () => openCardDialog({ deckId: deck.id }) }, icon('plus'), 'Add card'),
          c.total > 0 && h('a', { class: 'btn primary', href: `#/study/${deck.id}` }, icon('play'), `Study ${c.total}`),
        ),
      ),
      content,
    ),
  );
}

const RATINGS = [
  { rating: Rating.Again, label: 'Again', kind: 'again' },
  { rating: Rating.Hard, label: 'Hard', kind: 'hard' },
  { rating: Rating.Good, label: 'Good', kind: 'good' },
  { rating: Rating.Easy, label: 'Easy', kind: 'easy' },
];

function currentStudyCard(deckId, now) {
  let card = session.cardId && store.card(session.cardId);
  if (!card || card.deckId !== deckId) {
    card = store.nextCard(deckId, now);
    session.cardId = card?.id ?? null;
    session.revealed = false;
  }
  return card;
}

function reveal() {
  session.revealed = true;
  render();
}

function rate(rating) {
  if (!session.cardId || !session.revealed) return;
  store.answerCard(session.cardId, rating);
  session.cardId = null;
  session.done++;
  render();
}

function renderStudy(deck) {
  const now = Date.now();
  if (session.deckId !== deck.id) Object.assign(session, { deckId: deck.id, cardId: null, revealed: false, done: 0, spoken: null });
  const card = currentStudyCard(deck.id, now);
  const c = store.counts(deck.id, now);
  const progress = session.done + c.total ? (session.done / (session.done + c.total)) * 100 : 100;

  const top = [
    h(
      'div',
      { class: 'study-top' },
      h('a', { class: 'icon-btn', href: `#/deck/${deck.id}`, title: 'Stop studying', 'aria-label': 'Stop studying' }, icon('close')),
      h('div', { class: 'study-title' }, deck.name),
      countPills(c),
    ),
    h('div', { class: 'progress' }, h('div', { style: `width: ${progress}%` })),
  ];

  if (!card) {
    const empty = c.cards === 0;
    app.replaceChildren(
      h(
        'div',
        { class: 'study' },
        top,
        h(
          'div',
          { class: 'done' },
          h('div', { class: 'badge' }, icon('check')),
          h('h1', null, empty ? 'This deck is empty' : 'All caught up'),
          h(
            'p',
            null,
            empty
              ? 'Add some cards to start studying.'
              : session.done
                ? `You reviewed ${plural(session.done, 'card')} this session. Come back tomorrow for more.`
                : 'Nothing is due in this deck right now.',
          ),
          h('a', { class: 'btn primary', href: empty ? `#/deck/${deck.id}` : '#/' }, empty ? 'Go to deck' : 'Back to decks'),
        ),
      ),
    );
    return;
  }

  const status = cardStatus(card, now);
  const options = session.revealed ? store.previewCard(card.id, now) : null;

  // Read the side that has just appeared, once.
  const shown = `${card.id}:${session.revealed}`;
  if (session.spoken !== shown) {
    session.spoken = shown;
    const side = session.revealed ? 'back' : 'front';
    if (speaksSide(deck, side)) speakSideOf(card, deck, side);
    else stopSpeaking();
    if (!session.revealed && speaksSide(deck, 'back')) prepareSpeech(card.back, deck.backLang);
  }

  app.replaceChildren(
    h(
      'div',
      { class: 'study' },
      top,
      h(
        'div',
        { class: 'flashcard' },
        h('span', { class: `pill ${status.kind} state` }, card.state === State.Review ? 'Review' : status.label),
        h(
          'div',
          { class: 'tools' },
          iconButton('edit', 'Edit card (E)', () => openCardDialog({ card })),
          iconButton('trash', 'Delete card', () => removeCard(card), 'danger'),
        ),
        h('div', { class: 'face question' }, card.front),
        speakButton(card, deck, 'front'),
        session.revealed && [h('hr'), h('div', { class: 'face answer' }, card.back), speakButton(card, deck, 'back')],
      ),
      h(
        'div',
        { class: 'answer-bar' },
        session.revealed
          ? h(
              'div',
              { class: 'ratings' },
              RATINGS.map(({ rating, label, kind }) =>
                h(
                  'button',
                  { class: `rate ${kind}`, type: 'button', onclick: () => rate(rating) },
                  h('span', { class: 'ivl' }, (options[rating].state === State.Review ? '' : '<') + formatInterval(options[rating].due - now)),
                  h('span', { class: 'label' }, label),
                  h('kbd', null, String(rating)),
                ),
              ),
            )
          : h('button', { class: 'btn primary lg', type: 'button', onclick: reveal }, 'Show answer', h('kbd', null, 'Space')),
      ),
    ),
  );
}

// ---- Routing and shortcuts ------------------------------------------------

function route() {
  const [, view = '', id] = location.hash.split('/');
  return { view, deck: id && store.deck(id) };
}

function render() {
  const { view, deck } = route();
  if (view !== 'study' && session.deckId) {
    session.deckId = null;
    stopSpeaking();
  }
  if (view !== 'deck') query = '';
  if (view === 'deck' && deck) renderDeck(deck);
  else if (view === 'study' && deck) renderStudy(deck);
  else renderHome();
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select, button, a')) return;
  if (route().view !== 'study' || !session.cardId) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (session.revealed) rate(Rating.Good);
    else reveal();
  } else if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
    rate(Number(e.key));
  } else if (e.key.toLowerCase() === 'r' && canSpeak()) {
    // Replay: the side this deck reads aloud, or else whichever side appeared last.
    const card = store.card(session.cardId);
    const deck = store.deck(card.deckId);
    const side = deck.speak === 'front' || !session.revealed ? 'front' : 'back';
    speakSideOf(card, deck, side);
  } else if (e.key.toLowerCase() === 'e') {
    e.preventDefault();
    openCardDialog({ card: store.card(session.cardId) });
  }
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});

// Counts change as the day rolls over and learning steps come due.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !document.querySelector('dialog[open]') && route().view !== 'study') render();
});

await store.load();
store.onStorageChange(render);
applyTheme();
render();
