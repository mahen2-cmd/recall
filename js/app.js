import { hasRichContent, imageToken, mathSpans, mathToken, parseContent, speechText } from './content.js';
import { DAY, MINUTE, Rating, State, dayStart } from './fsrs.js';
import { parseSpreadsheet } from './importer.js';
import * as store from './store.js';

const app = document.getElementById('app');
const toasts = document.getElementById('toasts');

// The card currently on screen in study mode.
const session = { deckId: null, cardId: null, revealed: false, done: 0, spoken: null };
let query = '';

// Filters on a deck's card list, reset whenever a different deck is opened.
const NO_FILTERS = { groups: [], due: 'any', added: 'any', lapses: 'any', sort: 'newest' };
let filters = { ...NO_FILTERS };
let filtersDeck = null;
// Ids of the cards ticked in that list. Only cards on screen stay selected.
let selected = new Set();

const CARD_GROUPS = [
  ['new', 'New'],
  ['learning', 'Learning'],
  ['due', 'Due'],
  ['later', 'Not due yet'],
  ['reserve', 'On reserve'],
];
const FILTER_SELECTS = [
  ['due', 'Next review', [['any', 'Any time'], ['overdue', 'Overdue'], ['today', 'Today or overdue'], ['week', 'Within 7 days'], ['month', 'Within 30 days']]],
  ['added', 'Added', [['any', 'Any time'], ['today', 'Today'], ['week', 'In the last 7 days'], ['month', 'In the last 30 days']]],
  ['lapses', 'Forgotten', [['any', 'Any'], ['some', 'At least once'], ['many', '3 times or more']]],
  ['sort', 'Sort by', [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['due', 'Next review'], ['front', 'Front, A to Z'], ['lapses', 'Most forgotten'], ['reserve', 'Reserve order']]],
];

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
  chart: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  box: '<path d="M4 8h16v11H4zM3 5h18v3H3zM10 12h4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 15l-5-5-9 9"/>',
};

function icon(name) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return span;
}

const iconButton = (name, label, onclick, extra = '') =>
  h('button', { class: `icon-btn ${extra}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

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
  if (card.reserved) return { kind: 'zero', label: 'On reserve' };
  if (card.state === State.New) return { kind: 'new', label: 'New' };
  if (card.state !== State.Review) return { kind: 'learning', label: 'Learning' };
  const days = Math.round((new Date(card.due).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return { kind: 'review', label: 'Due today' };
  return { kind: 'zero', label: `Due in ${formatInterval(days * DAY)}` };
}

function tomorrowText({ tomorrow: t, reserve }) {
  if (!t.total) return reserve ? 'Nothing comes tomorrow. Pull some cards in from the reserve.' : 'Nothing comes tomorrow.';
  return `Tomorrow: ${plural(t.total, 'card')} (${t.new.toLocaleString()} new, ${t.learning.toLocaleString()} learning, ${t.review.toLocaleString()} due)`;
}

function countPills(c) {
  const pill = (kind, n, label) =>
    h('span', { class: `pill ${n ? kind : 'zero'}`, title: `${n} ${label.toLowerCase()}` }, h('b', null, String(n)), h('span', null, label));
  return h('div', { class: 'counts' }, pill('new', c.new, 'New'), pill('learning', c.learning, 'Learning'), pill('review', c.review, 'Due'));
}

// ---- Card content ---------------------------------------------------------
// A side's text, with its maths typeset by KaTeX (loaded by index.html from vendor/katex/)
// and its images shown from the server.

const mediaUrl = (name) => `api/media/${encodeURIComponent(name)}`;

function mathElement(tex, display, onclick) {
  const el = h('span', { class: `math${display ? ' display' : ''}${onclick ? ' editable' : ''}`, title: onclick && 'Edit this maths', onclick });
  if (globalThis.katex) globalThis.katex.render(tex, el, { displayMode: display, throwOnError: false });
  else el.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  return el;
}

/** The nodes that show a card side. With `editMath`, clicking the nth piece of maths calls `editMath(n)`. */
const rich = (text, editMath) => {
  let n = 0;
  return parseContent(text).map((part) => {
    if (part.text !== undefined) return part.text;
    if (part.math !== undefined) {
      const index = n++;
      return mathElement(part.math, part.display, editMath && (() => editMath(index)));
    }
    return h('img', {
      class: 'card-image',
      src: mediaUrl(part.image),
      alt: '',
      loading: 'lazy',
      onerror: (e) => e.target.replaceWith(h('span', { class: 'image-missing' }, 'Image not found')),
    });
  });
};

// ---- Equation editor ------------------------------------------------------
// MathLive, from vendor/mathlive/, loaded the first time it is needed. It shares KaTeX's fonts.

let mathLive = null;

function loadMathLive() {
  mathLive ??= import('../vendor/mathlive/mathlive.min.mjs').then(({ MathfieldElement }) => {
    MathfieldElement.fontsDirectory = new URL('../vendor/katex/fonts/', import.meta.url).href;
    MathfieldElement.soundsDirectory = null;
  });
  mathLive.catch(() => (mathLive = null));
  return mathLive;
}

// Shortcuts above the equation box. In each, #0 stands for what is selected and #? for an
// empty slot to fill in.
const matrix = (n) => `\\begin{bmatrix}${Array.from({ length: n }, () => Array(n).fill('#?').join('&')).join('\\\\')}\\end{bmatrix}`;
const MATH_TOOLS = [
  ['a/b', 'Fraction', '\\frac{#0}{#?}'],
  ['√', 'Square root', '\\sqrt{#0}'],
  ['xⁿ', 'Power', '#0^{#?}'],
  ['xₙ', 'Subscript', '#0_{#?}'],
  ['ẋ', 'Rate of change (dot)', '\\dot{#0}'],
  ['v⃗', 'Vector arrow', '\\vec{#0}'],
  ['2×2', '2 by 2 matrix', matrix(2)],
  ['3×3', '3 by 3 matrix', matrix(3)],
  ['4×4', '4 by 4 matrix', matrix(4)],
];

/**
 * Open the equation editor on `math` (LaTeX), and call `onsave(math, display)` with the result.
 * `display` is whether the maths sits on a line of its own.
 */
async function openMathDialog({ math = '', display = false, editing = false }, onsave) {
  try {
    await loadMathLive();
  } catch {
    toast('Could not load the equation editor.');
    return;
  }
  const field = h('math-field', { class: 'math-input', 'aria-label': 'Equation' });
  field.value = math;
  const ownLine = h('input', { type: 'checkbox', checked: display });
  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        // An empty slot left in a fraction or power is written as a placeholder; drop it.
        const latex = field
          .getValue('latex-expanded')
          .replace(/\\placeholder(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
          .trim();
        if (!latex) return field.focus();
        // Close first: closing hands the focus back, and the text box should end up with it.
        dialog.close();
        onsave(latex, ownLine.checked);
      },
    },
    h(
      'div',
      { class: 'math-tools', role: 'toolbar', 'aria-label': 'Insert' },
      MATH_TOOLS.map(([text, title, latex]) =>
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            title,
            'aria-label': title,
            // Keep the focus, and so the selection, in the equation box.
            onmousedown: (e) => e.preventDefault(),
            onclick: () => {
              field.insert(latex, { selectionMode: 'placeholder', focus: true });
              field.focus();
            },
          },
          text,
        ),
      ),
    ),
    field,
    h('small', { class: 'field-note math-help' }, 'Type maths as it looks: / starts a fraction, ^ a power and _ a subscript, and the arrow keys move between the parts and between the cells of a matrix. Type sqrt, theta, omega, pi or sum by name. More is in the menu at the end of the box. On a phone, a maths keyboard opens.'),
    h('label', { class: 'check' }, ownLine, 'On a line of its own, centred'),
    h(
      'div',
      { class: 'modal-foot' },
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save' : 'Insert'),
    ),
  );
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // The dialog sits above the page, so the maths keyboard opens in a layer inside it, and
  // the dialog moves to the top of the screen to stay clear of it.
  const keyboard = globalThis.mathVirtualKeyboard;
  const keyboardLayer = h('div', { class: 'math-keyboard' });
  const placeDialog = () => dialog.element.classList.toggle('with-keyboard', keyboard.visible);
  const dialog = modal(editing ? 'Edit maths' : 'Insert maths', form, {
    narrow: true,
    onclose: () => {
      keyboard.hide();
      keyboard.container = document.body;
      keyboard.removeEventListener('geometrychange', placeDialog);
      keyboard.removeEventListener('virtual-keyboard-toggle', placeDialog);
    },
  });
  dialog.element.append(keyboardLayer);
  keyboard.container = keyboardLayer;
  keyboard.addEventListener('geometrychange', placeDialog);
  keyboard.addEventListener('virtual-keyboard-toggle', placeDialog);
  field.focus();
}

/** Keep an image on the server, returning the name a card refers to it by. */
async function uploadImage(blob) {
  if (!store.storageInfo().available) throw new Error('Images are kept by the Recall server. Start it with "npm start".');
  const res = await fetch('api/media', { method: 'POST', body: blob });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).name;
}

// ---- Speech ---------------------------------------------------------------
// Uses the server's voice when there is one, otherwise the browser's own. Only a side's words
// are read: its maths and images are skipped.

const LANGUAGES = [
  ['pt-PT', 'Portuguese (Portugal)'],
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
];
let player = null;
let speechToken = 0;

const ttsUrl = (text, lang, save = true) => `api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}${save ? '' : '&save=0'}`;
const serverVoice = () => store.storageInfo().voice;
const canSpeak = () => Boolean(serverVoice()) || 'speechSynthesis' in window;

function stopSpeaking() {
  speechToken++;
  player?.pause();
  player = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Read `text` aloud. With `save` false, the server makes the audio without keeping it. */
async function speak(text, lang, rate = 1, save = true) {
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
    const res = await fetch(ttsUrl(text, lang, save));
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

// A reversed card shows the deck's back on its front, so each of its sides takes the
// language and the auto-play setting of the deck's other side.
const deckSide = (card, side) => (card.reversed ? (side === 'front' ? 'back' : 'front') : side);
const sideLang = (card, deck, side) => deck[`${deckSide(card, side)}Lang`];

/** Read the words on one side of a card aloud, in that side's language. */
const speakSideOf = (card, deck, side) => speak(speechText(card[side]), sideLang(card, deck, side), deck.speechRate, deck.saveAudio);

const speaksSide = (card, deck, side) => deck.speak === deckSide(card, side) || deck.speak === 'both';

/** Make a side's audio ahead of time, unless its deck keeps no audio to play later. */
function prepareSideSpeech(card, deck, side) {
  if (deck.saveAudio) prepareSpeech(speechText(card[side]), sideLang(card, deck, side));
}

function prepareCardSpeech(card) {
  const deck = store.deck(card.deckId);
  for (const side of ['front', 'back']) {
    if (speaksSide(card, deck, side)) prepareSideSpeech(card, deck, side);
  }
}

const speakButton = (card, deck, side) =>
  canSpeak() &&
  speechText(card[side]) !== '' &&
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
  return { close, element: dialog };
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
  const saveAudio = h('input', { type: 'checkbox', checked: defaults.saveAudio });

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
          saveAudio: saveAudio.checked,
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
      h('small', { class: 'field-note' }, 'Auto-play reads a side aloud when it appears, in that side’s language. You can always play either side with its speaker button. Maths is read out in words, in English; images are skipped.'),
      serverVoice() && [
        h('label', { class: 'check', style: 'margin-top: 12px' }, saveAudio, 'Keep the audio made for this deck'),
        h('small', { class: 'field-note' }, 'Turn this off for decks that are mostly maths: audio is then made each time it plays instead of being kept, and “npm run cache-voice” leaves the deck out.'),
      ],
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

/**
 * Put `text` in a text box in place of `start` to `end` (the selection unless given), on a line
 * of its own when `ownLine` is set.
 */
function insertText(textarea, text, { start = textarea.selectionStart, end = textarea.selectionEnd, ownLine = false } = {}) {
  const { value } = textarea;
  const before = ownLine && start && value[start - 1] !== '\n' ? '\n' : '';
  const after = ownLine && end < value.length && value[end] !== '\n' ? '\n' : '';
  textarea.setRangeText(before + text + after, start, end, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

const insertAtCursor = (textarea, text) => insertText(textarea, text, { ownLine: true });

/**
 * The editor for one side of a card: its text box, buttons to add maths and images, paste or
 * drop for images, and a preview of the side once it holds maths or images. Clicking maths in
 * the preview, or pressing Maths with the cursor in some, opens it in the equation editor.
 */
function sideEditor(label, textarea) {
  const preview = h('div', { class: 'side-preview', 'aria-live': 'polite' });
  const editMath = (span) =>
    openMathDialog({ ...span, editing: true }, (math, display) =>
      insertText(textarea, mathToken(math, display), { start: span.start, end: span.end, ownLine: display && !span.display }),
    );
  const update = () => {
    preview.hidden = !hasRichContent(textarea.value);
    if (!preview.hidden) preview.replaceChildren(...rich(textarea.value, (n) => editMath(mathSpans(textarea.value)[n])));
  };
  const mathButton = () => {
    const { selectionStart: start, selectionEnd: end } = textarea;
    const inside = mathSpans(textarea.value).find((span) => span.start <= start && end <= span.end && start < span.end);
    if (inside) return editMath(inside);
    openMathDialog({}, (math, display) => insertText(textarea, mathToken(math, display), { start, end, ownLine: display }));
  };
  const isImage = (file) => file.type.startsWith('image/');
  const addImages = async (files) => {
    try {
      const names = [];
      for (const file of files.filter(isImage)) names.push(await uploadImage(file));
      if (names.length) insertAtCursor(textarea, names.map(imageToken).join('\n'));
    } catch (error) {
      toast(error.message || 'Could not add that image.');
    }
  };
  const picker = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
    multiple: true,
    hidden: true,
    onchange: () => {
      addImages([...picker.files]);
      picker.value = '';
    },
  });
  textarea.setAttribute('aria-label', label);
  textarea.addEventListener('input', update);
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });
  textarea.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  textarea.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter(isImage);
    if (!files.length) return;
    e.preventDefault();
    textarea.focus();
    addImages(files);
  });
  update();
  return h(
    'div',
    { class: 'field' },
    h(
      'div',
      { class: 'field-head' },
      h('span', null, label),
      h(
        'div',
        { class: 'field-tools' },
        h('button', { class: 'btn ghost sm', type: 'button', title: `Write maths on the ${label.toLowerCase()}, or edit the maths at the cursor`, onclick: mathButton }, icon('sigma'), 'Maths'),
        h('button', { class: 'btn ghost sm', type: 'button', title: `Add an image to the ${label.toLowerCase()}`, onclick: () => picker.click() }, icon('image'), 'Add image'),
      ),
      picker,
    ),
    textarea,
    preview,
  );
}

function openCardDialog({ card, deckId }) {
  const front = h('textarea', { required: true, value: card?.front ?? '', placeholder: 'Question or prompt' });
  const back = h('textarea', { required: true, value: card?.back ?? '', placeholder: 'Answer' });
  const deckSelect = h(
    'select',
    null,
    store.decks().map((d) => h('option', { value: d.id, selected: d.id === (card?.deckId ?? deckId) }, d.name)),
  );
  // Only a card that has never been studied can wait on the reserve.
  const reserved = h('input', { type: 'checkbox', checked: Boolean(card?.reserved) });
  const canReserve = !card || card.state === State.New;
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
          store.updateCard(card.id, { ...values, deckId: deckSelect.value, reserved: (canReserve && reserved.checked) || undefined });
          prepareCardSpeech(store.card(card.id));
          dialog.close();
          return;
        }
        // Stay open so several cards can be added in a row.
        prepareCardSpeech(store.addCard(deckSelect.value, values.front, values.back, Date.now(), { reserved: reserved.checked }));
        front.value = back.value = '';
        for (const box of [front, back]) box.dispatchEvent(new Event('input'));
        note.textContent = reserved.checked ? 'Card added to the reserve' : 'Card added';
        note.className = 'note ok';
        front.focus();
        render();
      },
    },
    sideEditor('Front', front),
    sideEditor('Back', back),
    h('small', { class: 'field-note', style: 'margin: -6px 0 14px' }, 'Paste or drop images into a side. Press Maths to write an equation, or click one in the preview to change it. Maths can also be typed as LaTeX: \\( x^2 \\) within a line, \\[ x^2 \\] on its own line.'),
    h('label', { class: 'field' }, h('span', null, 'Deck'), deckSelect),
    canReserve && h('label', { class: 'check' }, reserved, 'Keep on reserve, out of study until pulled in'),
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

async function removeCards(ids) {
  const one = ids.length === 1;
  const ok = await confirmDialog({
    title: `Delete ${plural(ids.length, 'card')}?`,
    message: `${one ? 'This card and its' : 'These cards and their'} review history will be permanently deleted.`,
    confirmLabel: `Delete ${plural(ids.length, 'card')}`,
  });
  if (!ok) return;
  const deleted = store.deleteCards(ids);
  selected = new Set();
  toast(`${plural(deleted, 'card')} deleted`);
  render();
}

/** Put a reversed copy of each card on the reserve, and leave the copies ticked, ready to be moved. */
function addReversedCards(ids) {
  const added = store.addReversed(ids);
  const skipped = ids.length - added.length;
  const already = skipped ? `${skipped.toLocaleString()} already had one` : '';
  if (added.length) {
    selected = new Set(added.map((card) => card.id));
    toast(`${plural(added.length, 'reversed card')} added to the reserve${already && `, ${already}`}`);
  } else {
    toast(skipped === 1 ? 'This card already has a reversed version' : 'These cards already have reversed versions');
  }
  render();
}

/** Put cards back on the reserve, after asking first if that wipes out their progress. */
async function returnCardsToReserve(ids) {
  const studied = ids.map(store.card).filter((card) => card && !card.reserved && card.state !== State.New).length;
  if (studied) {
    const one = studied === 1;
    const which = ids.length === 1 ? 'This card has' : one ? 'One of these cards has' : `${studied.toLocaleString()} of these cards have`;
    const ok = await confirmDialog({
      title: `Put ${plural(ids.length, 'card')} back on reserve?`,
      message: `${which} already been studied. ${one ? 'Its' : 'Their'} progress will be reset, and ${one ? 'it starts' : 'they start'} over as new when pulled in again.`,
      confirmLabel: 'Put back on reserve',
    });
    if (!ok) return;
  }
  const moved = store.returnToReserve(ids);
  toast(`${plural(moved, 'card')} put back on reserve`);
  render();
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

/**
 * Keep the pictures read from a spreadsheet on the server, and point the cells at the stored
 * copies. A picture the server will not take, such as a drawing saved by Excel as EMF, is left
 * out, as are all of them without a server. Returns the rows and how many pictures were left out.
 */
async function storeSheetImages(rows, images) {
  const stored = new Map();
  for (const [path, bytes] of images) {
    stored.set(path, store.storageInfo().available ? await uploadImage(new Blob([bytes])).catch(() => null) : null);
  }
  const cells = rows.map((row) =>
    row.map((cell) =>
      cell
        .replace(/\[image:([^\]\s]+)\]/g, (_, path) => (stored.get(path) ? imageToken(stored.get(path)) : ''))
        .trim(),
    ),
  );
  return { rows: cells, skipped: [...stored.values()].filter((name) => !name).length };
}

function pickImportFile(deck, toReserve = false) {
  const input = h('input', {
    type: 'file',
    accept: '.xlsx,.csv,.tsv,.txt',
    onchange: async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const images = new Map();
        let rows = await parseSpreadsheet(await file.arrayBuffer(), file.name, images);
        if (!rows.length) throw new Error('That file has no rows to import.');
        if (images.size) {
          const result = await storeSheetImages(rows, images);
          rows = result.rows;
          if (!store.storageInfo().available) toast('Pictures are kept by the Recall server, so they will be left out. Start it with "npm start" to import them.');
          else if (result.skipped) toast(`${plural(result.skipped, 'picture')} in a format Recall cannot show will be left out`);
        }
        openImportDialog(deck, file.name, rows, toReserve);
      } catch (error) {
        toast(error.message || 'Could not read that file.');
      }
    },
  });
  input.click();
}

function openImportDialog(deck, fileName, rows, toReserve = false) {
  const width = Math.max(...rows.map((row) => row.length));
  const existing = store.cardsIn(deck.id).map((card) => cardKey(card.front));
  const columnSelect = (selected) =>
    h(
      'select',
      { onchange: () => update() },
      Array.from({ length: width }, (_, i) => {
        const sample = rows.find((row) => row[i])?.[i] ?? 'empty';
        const words = sample.replace(/\[image:[^\]\s]+\]/g, '(image)');
        const label = `${columnName(i)}: ${words.length > 28 ? `${words.slice(0, 28)}…` : words}`;
        return h('option', { value: i, selected: i === selected }, label);
      }),
    );
  const front = columnSelect(0);
  const back = columnSelect(Math.min(1, width - 1));
  const header = h('input', { type: 'checkbox', onchange: () => update() });
  const skipExisting = h('input', { type: 'checkbox', checked: true, onchange: () => update() });
  const reserved = h('input', { type: 'checkbox', checked: toReserve });
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
      h('tbody', null, cards.slice(0, 5).map(([f, b]) => h('tr', null, h('td', null, rich(f)), h('td', null, rich(b))))),
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
        store.addCards(deck.id, cards, Date.now(), { reserved: reserved.checked });
        dialog.close();
        toast(`Imported ${plural(cards.length, 'card')} into ${reserved.checked ? `the reserve of ${deck.name}` : deck.name}`);
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
    h('label', { class: 'check' }, reserved, 'Put these cards on reserve, to pull in when you want them'),
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
        // The whole package goes, as the server stores the images the cards show.
        const res = await fetch('api/anki', { method: 'POST', body: file });
        if (!res.ok) throw new Error(await res.text());
        openAnkiDialog(file.name, await res.json());
      } catch (error) {
        toast(error.message || 'Could not read that file.');
      }
    },
  });
  input.click();
}

function openAnkiDialog(fileName, { decks, suspended, blank, sound, missingImages }) {
  const known = store.ankiCardIds();
  const incoming = decks
    .map((deck) => ({ ...deck, cards: deck.cards.filter((card) => !known.has(card.ankiId)) }))
    .filter((deck) => deck.cards.length);
  const total = incoming.reduce((sum, deck) => sum + deck.cards.length, 0);
  const existing = decks.reduce((sum, deck) => sum + deck.cards.length, 0) - total;
  const fresh = incoming.reduce((sum, deck) => sum + deck.cards.filter((card) => card.state === State.New).length, 0);
  const reserved = h('input', { type: 'checkbox' });

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
    sound && 'Audio is not imported. Images and maths are.',
    missingImages && `${plural(missingImages, 'image')} named on cards ${missingImages === 1 ? 'is' : 'are'} missing from the file or in a format Recall cannot show, and will be left out.`,
    ...incoming
      .filter((deck) => deck.custom.length)
      .map((deck) => `“${deck.name}” has its own ${deck.custom.join(', ')} in Anki. Recall uses Anki’s defaults for these, so some intervals will differ.`),
  ].filter(Boolean);

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const added = store.importAnkiDecks(incoming, Date.now(), { reserved: reserved.checked });
        dialog.close();
        const onReserve = !reserved.checked ? '' : fresh === added ? ' onto the reserve' : `, ${fresh.toLocaleString()} of them on reserve`;
        toast(`Imported ${plural(added, 'card')} from Anki${onReserve}`);
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
    fresh > 0 &&
      h(
        'label',
        { class: 'check', style: 'margin-top: 14px' },
        reserved,
        fresh === total ? 'Put these cards on reserve, to pull in when you want them' : `Put the ${plural(fresh, 'new card')} on reserve, to pull in when you want them`,
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
    h('a', { class: 'icon-btn', href: '#/upcoming', title: 'Upcoming cards', 'aria-label': 'Upcoming cards' }, icon('calendar')),
    h('a', { class: 'icon-btn', href: '#/stats', title: 'Statistics', 'aria-label': 'Statistics' }, icon('chart')),
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
        h(
          'div',
          { class: 'deck-meta' },
          plural(c.cards, 'card') + (c.reserve ? `, ${c.reserve.toLocaleString()} on reserve` : '') + (c.tomorrow.total ? ` · ${c.tomorrow.total.toLocaleString()} tomorrow` : ''),
        ),
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

/** A deck's reserve: how many cards are waiting, and the controls to pull some in or rearrange them. */
function reserveBar(deck, n) {
  const pull = (count) => {
    const pulled = store.pullFromReserve(deck.id, count);
    toast(`${plural(pulled, 'card')} pulled in as new ${pulled === 1 ? 'card' : 'cards'}`);
    render();
  };
  const amount = h('input', { type: 'number', required: true, min: 1, max: n, step: 1, value: Math.min(n, 10), 'aria-label': 'How many cards to pull in' });
  return h(
    'form',
    {
      class: 'reserve',
      onsubmit: (e) => {
        e.preventDefault();
        pull(Number(amount.value));
      },
    },
    icon('box'),
    h(
      'div',
      { class: 'reserve-text' },
      h('b', null, n ? `${plural(n, 'card')} on reserve` : 'Nothing on reserve'),
      h('span', null, n ? 'Kept out of study until you pull them in, the first in line first.' : 'Cards on reserve are kept out of study until you pull them in.'),
    ),
    n > 0 && [amount, h('button', { class: 'btn primary', type: 'submit' }, 'Pull in'), n > 1 && h('button', { class: 'btn', type: 'button', onclick: () => pull(n) }, `Pull all ${n.toLocaleString()}`)],
    n > 1 &&
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          title: 'List the reserve in the order it is pulled in, to rearrange it',
          onclick: () => {
            query = '';
            filters = { ...NO_FILTERS, groups: ['reserve'], sort: 'reserve' };
            render();
          },
        },
        icon('up'),
        'Reorder',
      ),
    h('button', { class: 'btn', type: 'button', title: 'Import cards from a CSV or Excel file straight into the reserve', onclick: () => pickImportFile(deck, true) }, icon('upload'), 'Import to reserve'),
  );
}

function renderDeck(deck) {
  const now = Date.now();
  const c = store.counts(deck.id, now);
  const cards = store.cardsIn(deck.id);
  if (filtersDeck !== deck.id) {
    filters = { ...NO_FILTERS };
    filtersDeck = deck.id;
    selected = new Set();
  }
  const filtering = Object.keys(NO_FILTERS).some((key) => key !== 'sort' && String(filters[key]) !== String(NO_FILTERS[key]));
  const setFilters = (patch) => {
    filters = { ...filters, ...patch };
    render();
  };

  const groupCounts = {};
  for (const card of cards) {
    const group = store.cardGroup(card, now);
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  }
  const filterBar = [
    h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Show cards that are' },
      CARD_GROUPS.map(([group, label]) => {
        const on = filters.groups.includes(group);
        return h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(on),
            onclick: () => setFilters({ groups: on ? filters.groups.filter((g) => g !== group) : [...filters.groups, group] }),
          },
          label,
          h('b', null, (groupCounts[group] ?? 0).toLocaleString()),
        );
      }),
    ),
    h(
      'div',
      { class: 'filters' },
      FILTER_SELECTS.map(([key, label, options]) => {
        const select = h(
          'select',
          { onchange: () => setFilters({ [key]: select.value }) },
          options.map(([value, text]) => h('option', { value, selected: value === filters[key] }, text)),
        );
        return h('label', { class: key !== 'sort' && filters[key] !== NO_FILTERS[key] ? 'on' : '' }, h('span', null, label), select);
      }),
      filtering && h('button', { class: 'btn ghost', type: 'button', onclick: () => setFilters({ ...NO_FILTERS, sort: filters.sort }) }, icon('close'), 'Clear filters'),
    ),
  ];

  const list = h('div');
  const shown = h('span', { class: 'count' });
  // Ids of the reserve cards being dragged to a new place.
  let dragged = null;

  const drawList = () => {
    const q = query.trim();
    const matches = store.findCards(deck.id, { text: q, ...filters }, now);
    shown.textContent = q || filtering ? `${matches.length.toLocaleString()} of ${plural(cards.length, 'card')}` : plural(cards.length, 'card');
    selected = new Set(matches.filter((card) => selected.has(card.id)).map((card) => card.id));
    const pick = (ids, on) => {
      for (const id of ids) on ? selected.add(id) : selected.delete(id);
      drawList();
    };
    // In reserve order, the reserve cards shown can be moved: `line` is those, first to last.
    const line = filters.sort === 'reserve' ? matches.filter((card) => card.reserved) : [];
    const picked = line.filter((card) => selected.has(card.id));
    const waiting = line.filter((card) => !selected.has(card.id));
    const movable = picked.length > 0 && picked.length === selected.size;
    // Ticked cards not on reserve, which can be put back on it.
    const unreserved = matches.filter((card) => selected.has(card.id) && !card.reserved).map((card) => card.id);
    const move = (ids, where) => {
      dragged = null;
      store.moveInReserve(deck.id, ids, where);
      drawList();
    };
    // One place up or down among the cards shown, which gathers the ticked cards together.
    const step = (down) => {
      const edge = line.indexOf(picked.at(down ? -1 : 0));
      const anchor = line[edge + (down ? 1 : -1)] ?? waiting.at(down ? -1 : 0);
      if (anchor) move([...selected], { [down ? 'after' : 'before']: anchor.id });
    };
    const moveButton = (label, title, onclick, glyph) => h('button', { class: 'btn', type: 'button', title, onclick }, glyph && icon(glyph), label);
    if (!matches.length) {
      const message = q && !filtering ? `No cards match “${q}”.` : q ? `No cards match “${q}” with these filters.` : 'No cards match these filters.';
      list.replaceChildren(h('div', { class: 'card-list' }, h('div', { class: 'list-empty' }, message)));
      return;
    }
    list.replaceChildren(
      h(
        'div',
        { class: 'card-list' },
        h(
          'div',
          { class: 'select-bar' },
          h(
            'label',
            { class: 'pick' },
            h('input', {
              type: 'checkbox',
              checked: selected.size === matches.length,
              indeterminate: selected.size > 0 && selected.size < matches.length,
              onchange: (e) => pick(matches.map((card) => card.id), e.target.checked),
            }),
            selected.size ? `${selected.size.toLocaleString()} selected` : matches.length === cards.length ? 'Select all' : `Select all ${matches.length.toLocaleString()} shown`,
          ),
          line.length > 1 && !selected.size && h('span', { class: 'hint' }, 'Drag cards to reorder them, or tick several to move them together.'),
          movable &&
            line.length > 1 && [
              moveButton('Up', 'Move up one place', () => step(false), 'up'),
              moveButton('Down', 'Move down one place', () => step(true), 'down'),
              moveButton('To top', 'Move to the front of the reserve, to be pulled in first', () => {
                const first = store.reserveIn(deck.id).find((card) => !selected.has(card.id));
                if (first) move([...selected], { before: first.id });
              }),
              moveButton('To bottom', 'Move to the end of the reserve, to be pulled in last', () => move([...selected])),
            ],
          selected.size > 0 && [
            unreserved.length > 0 &&
              h(
                'button',
                { class: 'btn', type: 'button', title: 'Take the ticked cards out of study and put them at the end of the reserve', onclick: () => returnCardsToReserve(unreserved) },
                icon('box'),
                'Back to reserve',
              ),
            h(
              'button',
              { class: 'btn', type: 'button', title: 'Add a copy of each ticked card with its front and back swapped, on the reserve', onclick: () => addReversedCards([...selected]) },
              icon('swap'),
              'Add reversed',
            ),
            h('button', { class: 'btn danger', type: 'button', onclick: () => removeCards([...selected]) }, icon('trash'), `Delete ${plural(selected.size, 'card')}`),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => pick([...selected], false) }, 'Cancel'),
          ],
        ),
        matches.map((card) => {
          const status = cardStatus(card, now);
          const sortable = line.length > 1 && card.reserved;
          // Dropping on the lower half of a row puts the cards after it.
          const below = (e) => {
            const box = row.getBoundingClientRect();
            return e.clientY > box.top + box.height / 2;
          };
          const mark = (side) => {
            row.classList.toggle('drop-before', side === 'before');
            row.classList.toggle('drop-after', side === 'after');
          };
          const row = h(
            'div',
            {
              class: `card-row ${selected.has(card.id) ? 'selected' : ''}`,
              onclick: () => openCardDialog({ card }),
              ...(sortable && {
                draggable: true,
                // Dragging a ticked card takes the other ticked cards along.
                ondragstart: (e) => {
                  dragged = selected.has(card.id) ? picked.map((c) => c.id) : [card.id];
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', card.front);
                },
                ondragover: (e) => {
                  if (!dragged || dragged.includes(card.id)) return;
                  e.preventDefault();
                  mark(below(e) ? 'after' : 'before');
                },
                ondragleave: () => mark(),
                ondrop: (e) => {
                  if (!dragged || dragged.includes(card.id)) return;
                  e.preventDefault();
                  move(dragged, { [below(e) ? 'after' : 'before']: card.id });
                },
                ondragend: () => {
                  dragged = null;
                },
              }),
            },
            h(
              'label',
              { class: 'pick', onclick: (e) => e.stopPropagation() },
              sortable && h('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip')),
              h('input', { type: 'checkbox', 'aria-label': 'Select card', checked: selected.has(card.id), onchange: (e) => pick([card.id], e.target.checked) }),
            ),
            h('div', { class: 'text' }, rich(card.front)),
            h('div', { class: 'text back-text' }, rich(card.back)),
            h('span', { class: `pill ${status.kind} due`, style: 'justify-self: start' }, status.label),
            h(
              'div',
              { class: 'row-actions', onclick: (e) => e.stopPropagation() },
              iconButton('edit', 'Edit card', () => openCardDialog({ card })),
              iconButton('trash', 'Delete card', () => removeCard(card), 'danger'),
            ),
          );
          return row;
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
    ? [reserveBar(deck, c.reserve), h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), shown), filterBar, list]
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
        h('div', null, h('h1', null, deck.name), countPills(c), h('div', { class: 'deck-meta tomorrow' }, tomorrowText(c), ' ', h('a', { href: `#/upcoming/${deck.id}` }, 'See the days ahead'))),
        h(
          'div',
          { class: 'actions' },
          h('a', { class: 'icon-btn', href: `#/upcoming/${deck.id}`, title: 'Upcoming cards', 'aria-label': 'Upcoming cards' }, icon('calendar')),
          h('a', { class: 'icon-btn', href: `#/stats/${deck.id}`, title: 'Deck statistics', 'aria-label': 'Deck statistics' }, icon('chart')),
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
  if (!card || card.deckId !== deckId || card.reserved) {
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
          !empty && h('p', null, tomorrowText(c)),
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
    if (speaksSide(card, deck, side)) speakSideOf(card, deck, side);
    else stopSpeaking();
    if (!session.revealed && speaksSide(card, deck, 'back')) prepareSideSpeech(card, deck, 'back');
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
        h('div', { class: 'face question' }, rich(card.front)),
        speakButton(card, deck, 'front'),
        session.revealed && [h('hr'), h('div', { class: 'face answer' }, rich(card.back)), speakButton(card, deck, 'back')],
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

// ---- Statistics -----------------------------------------------------------

// `bin` is how many days each bar of the forecast covers.
const RANGES = [
  { days: 30, bin: 1, label: '1 month', span: 'month' },
  { days: 91, bin: 7, label: '3 months', span: '3 months' },
  { days: 360, bin: 30, label: '1 year', span: 'year' },
];
let statsRange = RANGES[0];

const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const monthName = new Intl.DateTimeFormat(undefined, { month: 'short' });

const sum = (list) => list.reduce((total, n) => total + n, 0);
const percent = (part, whole) => `${Math.round((part / whole) * 100)}%`;

function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d;
}

/** A day key such as '2026-01-31', written out. */
const sinceDate = (key) => longDate.format(new Date(`${key}T12:00`));

// One tooltip shared by every chart.
const tip = h('div', { class: 'chart-tip', hidden: true });
let tipTimer = null;
document.body.append(tip);

/** Show `value` and `label` beside the pointer while it is over `el`. */
function withTip(el, value, label) {
  const show = (e) => {
    clearTimeout(tipTimer);
    tip.replaceChildren(h('b', null, value), h('span', null, label));
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = e.clientY - tip.offsetHeight - 12;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y < 8 ? e.clientY + 18 : y}px`;
  };
  const hide = () => (tip.hidden = true);
  el.addEventListener('pointerdown', show);
  el.addEventListener('pointermove', show);
  // A finger leaves as soon as it lifts, so keep the tooltip up long enough to read.
  el.addEventListener('pointerleave', (e) => (e.pointerType === 'mouse' ? hide() : (tipTimer = setTimeout(hide, 1800))));
  return el;
}

/** The same figures as a chart, for screen readers. */
const dataTable = (caption, head, rows) =>
  h(
    'table',
    { class: 'sr-only' },
    h('caption', null, caption),
    h('thead', null, h('tr', null, head.map((text) => h('th', { scope: 'col' }, text)))),
    h('tbody', null, rows.map((row) => h('tr', null, row.map((text) => h('td', null, String(text)))))),
  );

const panel = (title, sub, ...content) =>
  h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, title), sub && h('p', null, sub)), content);

/** A round number at or above `max` for the top of an axis, and the step between its ticks. */
function axisTop(max) {
  const rough = Math.max(max, 4) / 4;
  const unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * unit).find((size) => size >= rough);
  return { step, top: Math.ceil(Math.max(max, 4) / step) * step };
}

/**
 * Vertical bars from `[{ value, label, tick, parts }]`; `tick` is the text under a bar, if any,
 * and `parts`, if given, splits the bar into `[kind, value]` pieces, from the bottom up.
 */
function columnChart(items, unit) {
  const { step, top } = axisTop(Math.max(...items.map((item) => item.value)));
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return h(
    'div',
    { class: 'chart', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'chart-plot' },
      ticks.map((t) => h('div', { class: 'chart-tick', style: `bottom: ${(t / top) * 100}%` }, h('span', null, t >= 1000 ? `${+(t / 1000).toFixed(1)}K` : String(t)))),
      h(
        'div',
        { class: 'chart-cols' },
        items.map((item) =>
          withTip(
            h(
              'div',
              { class: 'chart-col' },
              item.value > 0 &&
                h(
                  'div',
                  { class: item.parts ? 'chart-bar split' : 'chart-bar', style: `height: ${(item.value / top) * 100}%` },
                  item.parts?.filter(([, n]) => n).map(([kind, n]) => h('i', { class: `k-${kind}`, style: `flex: ${n} 0 0` })),
                ),
            ),
            plural(item.value, unit),
            item.label,
          ),
        ),
      ),
    ),
    h('div', { class: 'chart-x' }, items.map((item) => h('span', null, item.tick ?? ''))),
  );
}

function forecastPanel(s, today) {
  const { days, bin, span } = statsRange;
  const every = { 1: 7, 7: 4, 30: 3 }[bin];
  const items = [];
  for (let i = 0; i < days; i += bin) {
    const from = addDays(today, i);
    const label =
      bin > 1
        ? `${shortDate.format(from)} to ${shortDate.format(addDays(today, i + bin - 1))}`
        : i === 0
          ? 'Today, with anything overdue'
          : longDate.format(from);
    const tick = (i / bin) % every ? null : i === 0 && bin === 1 ? 'Today' : shortDate.format(from);
    items.push({ value: sum(s.forecast.slice(i, i + bin)), label, tick });
  }
  const total = sum(s.forecast);
  const sub = total
    ? `${plural(total, 'review')} scheduled over the next ${span}, about ${+(total / days).toFixed(1)} a day.`
    : `No reviews are scheduled over the next ${span}.`;
  return panel(
    'Forecast',
    sub,
    columnChart(items, 'review'),
    dataTable('Reviews coming due', ['When', 'Reviews'], items.map((item) => [item.label, item.value])),
  );
}

/** A year of days as a grid of weeks, shaded by how many cards were answered. */
function activityPanel(s, today, deck) {
  const WEEKS = 53;
  const start = addDays(today, -((WEEKS - 1) * 7 + ((new Date(today).getDay() + 6) % 7))); // a Monday
  const days = [];
  for (let d = start; d <= today; d = addDays(d, 1)) days.push({ date: d, n: s.perDay[store.dayKey(d)] ?? 0 });
  const max = Math.max(...days.map((day) => day.n));
  const active = days.filter((day) => day.n);

  const months = [];
  for (let week = 0; week < WEEKS; week++) {
    const monday = addDays(start, week * 7);
    if (week === 0 || monday.getMonth() !== addDays(monday, -7).getMonth()) months.push({ week, name: monthName.format(monday) });
  }
  // The first month is often a sliver; drop its name when the next would run into it.
  if (months[1]?.week < 3) months.shift();

  const scroller = h(
    'div',
    { class: 'heat-scroll' },
    h('div', { class: 'heat-months' }, months.map(({ week, name }) => h('span', { style: `grid-column: ${week + 1}` }, name))),
    h(
      'div',
      { class: 'heat-grid' },
      days.map(({ date, n }) =>
        withTip(h('i', { class: `heat l${n ? Math.ceil((4 * n) / max) : 0}` }), n ? plural(n, 'review') : 'No reviews', longDate.format(date)),
      ),
    ),
  );
  const sub = active.length
    ? `${plural(sum(active.map((day) => day.n)), 'review')} on ${plural(active.length, 'day')} in the past year.`
    : 'No reviews in the past year.';
  const section = panel(
    'Activity',
    sub,
    h(
      'div',
      { class: 'heatmap', role: 'img', 'aria-label': `Calendar of reviews per day. ${sub}` },
      h('div', { class: 'heat-days', 'aria-hidden': 'true' }, ['Mon', '', 'Wed', '', 'Fri', '', ''].map((day) => h('span', null, day))),
      scroller,
    ),
    h(
      'div',
      { class: 'heat-key', 'aria-hidden': 'true' },
      'Less',
      [0, 1, 2, 3, 4].map((level) => h('i', { class: `heat l${level}` })),
      'More',
    ),
    deck && s.partial && h('p', { class: 'panel-note' }, `Reviews are counted for each deck separately ${s.loggedFrom ? `since ${sinceDate(s.loggedFrom)}` : 'from now on'}. Choose all decks to see earlier ones.`),
  );
  return { section, scroller };
}

const CARD_KINDS = [
  ['new', 'New', 'never studied'],
  ['learning', 'Learning', 'in their first steps, or being relearned'],
  ['young', 'Young', 'in review, with an interval under 21 days'],
  ['mature', 'Mature', 'in review, with an interval of 21 days or more'],
];

function cardsPanel(s) {
  const total = sum(Object.values(s.cards));
  return panel(
    'Cards',
    `${plural(total, 'card')} by how well you know them.`,
    h(
      'div',
      { class: 'stack', 'aria-hidden': 'true' },
      CARD_KINDS.filter(([kind]) => s.cards[kind]).map(([kind, label]) =>
        withTip(h('div', { class: `k-${kind}`, style: `flex-grow: ${s.cards[kind]}` }), plural(s.cards[kind], 'card'), `${label}, ${percent(s.cards[kind], total)}`),
      ),
    ),
    h(
      'ul',
      { class: 'legend' },
      CARD_KINDS.map(([kind, label, meaning]) =>
        h(
          'li',
          { title: `${label}: ${meaning}` },
          h('i', { class: `k-${kind}` }),
          h('span', null, label),
          h('b', null, s.cards[kind].toLocaleString()),
          h('span', { class: 'share' }, percent(s.cards[kind], total)),
        ),
      ),
    ),
  );
}

function answersPanel(s) {
  const { span } = statsRange;
  const names = RATINGS.map((r) => r.label);
  const max = Math.max(...s.answers.flat());
  const since = s.partial && s.loggedFrom && `Recorded since ${sinceDate(s.loggedFrom)}; reviews before that are not broken down.`;
  if (!max) {
    const message = s.partial && !s.loggedFrom ? 'Recall has only just started recording which button you press. Study some cards to see the breakdown here.' : `No answers in the past ${span}.`;
    return panel('Answer buttons', null, h('p', { class: 'panel-empty' }, message));
  }
  return panel(
    'Answer buttons',
    `How often you pressed each button over the past ${span}, by the kind of card.`,
    h(
      'div',
      { class: 'answers', 'aria-hidden': 'true' },
      s.answers.map((counts, kind) => {
        const total = sum(counts);
        return h(
          'div',
          { class: 'answer-kind' },
          h('div', { class: 'answer-head' }, h('b', null, store.ANSWER_KINDS[kind]), h('span', null, total ? `${percent(total - counts[0], total)} correct` : 'No answers')),
          h(
            'div',
            { class: 'answer-cols' },
            counts.map((n, i) =>
              withTip(
                h('div', { class: 'answer-col' }, h('span', { class: 'cap' }, n.toLocaleString()), h('div', { class: 'chart-bar', style: `height: ${(n / max) * 96}px` }), h('span', null, names[i])),
                plural(n, 'answer'),
                total ? `${names[i]} on ${store.ANSWER_KINDS[kind].toLowerCase()} cards, ${percent(n, total)}` : names[i],
              ),
            ),
          ),
        );
      }),
    ),
    dataTable('Answers by kind of card', ['Kind', ...names], s.answers.map((counts, kind) => [store.ANSWER_KINDS[kind], ...counts])),
    since && h('p', { class: 'panel-note' }, since),
  );
}

function renderStats(deck) {
  const now = Date.now();
  const decks = store.decks();
  const s = store.statistics(deck?.id, statsRange.days, now);
  const today = new Date(dayStart(now));
  const reviews = [...s.answers[1], ...s.answers[2]];
  const reviewed = sum(reviews);
  const hasCards = sum(Object.values(s.cards)) > 0;

  const deckSelect = h(
    'select',
    { 'aria-label': 'Deck', onchange: () => (location.hash = deckSelect.value ? `#/stats/${deckSelect.value}` : '#/stats') },
    h('option', { value: '' }, 'All decks'),
    decks.map((d) => h('option', { value: d.id, selected: d.id === deck?.id }, d.name)),
  );
  const activity = hasCards && activityPanel(s, today, deck);

  app.replaceChildren(
    h(
      'div',
      { class: 'page' },
      topbar(),
      h('a', { class: 'back', href: deck ? `#/deck/${deck.id}` : '#/' }, icon('back'), deck ? deck.name : 'All decks'),
      h('div', { class: 'page-head', style: 'margin-top: 14px' }, h('div', null, h('h1', null, 'Statistics'), h('p', { class: 'sub' }, deck ? deck.name : 'All decks'))),
      hasCards
        ? [
            h(
              'div',
              { class: 'filters' },
              decks.length > 1 && deckSelect,
              h(
                'div',
                { class: 'segmented', role: 'group', 'aria-label': 'Period' },
                RANGES.map((range) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      'aria-pressed': String(range === statsRange),
                      onclick: () => {
                        statsRange = range;
                        render();
                      },
                    },
                    range.label,
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'summary' },
              h('div', { class: 'stat' }, h('b', null, String(s.forecast[0])), s.forecast[0] === 1 ? 'review due today' : 'reviews due today'),
              h('div', { class: 'stat' }, h('b', null, String(s.reviewedToday)), 'reviewed today'),
              h('div', { class: 'stat' }, h('b', null, String(s.streak)), 'day streak'),
              reviewed > 0 &&
                h(
                  'div',
                  { class: 'stat', title: `Reviews you answered Hard, Good or Easy over the past ${statsRange.span}. Cards still being learned are not counted.` },
                  h('b', null, percent(reviewed - reviews[0] - reviews[4], reviewed)),
                  'retention',
                ),
            ),
            forecastPanel(s, today),
            activity.section,
            cardsPanel(s),
            answersPanel(s),
          ]
        : h(
            'div',
            { class: 'empty' },
            h('h2', null, 'Nothing to show yet'),
            h('p', null, 'Add some cards and study them. Your progress will be charted here.'),
            h('a', { class: 'btn primary', href: deck ? `#/deck/${deck.id}` : '#/' }, deck ? 'Go to deck' : 'Go to decks'),
          ),
    ),
  );
  // Show the most recent weeks when the calendar is wider than the screen.
  if (activity) activity.scroller.scrollLeft = activity.scroller.scrollWidth;
}

// ---- Upcoming -------------------------------------------------------------

// How many days ahead of today the page lists, and how often the chart labels a day.
const AHEAD = [
  { days: 7, every: 1, label: '1 week', span: 'week' },
  { days: 30, every: 7, label: '1 month', span: 'month' },
  { days: 90, every: 14, label: '3 months', span: '3 months' },
];
let ahead = AHEAD[0];

const dayName = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

// The kinds of card counted each day, as `store.upcoming` names them, and their colours.
const UPCOMING_KINDS = [
  ['new', 'New', 'new'],
  ['learning', 'Learning', 'learning'],
  ['review', 'Due', 'young'],
];

const breakdown = (day) => UPCOMING_KINDS.map(([kind, label]) => `${day[kind].toLocaleString()} ${label.toLowerCase()}`).join(', ');

function renderUpcoming(deck) {
  const now = Date.now();
  const decks = store.decks();
  const all = store.upcoming(deck?.id, Math.max(31, ahead.days + 1), now);
  const days = all.slice(0, ahead.days + 1);
  const name = (day, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayName.format(day.start));
  const cards = deck ? store.cardsIn(deck.id) : decks.flatMap((d) => store.cardsIn(d.id));
  const hasCards = cards.length > 0;
  const reserve = cards.some((c) => c.reserved);

  const deckSelect = h(
    'select',
    { 'aria-label': 'Deck', onchange: () => (location.hash = deckSelect.value ? `#/upcoming/${deckSelect.value}` : '#/upcoming') },
    h('option', { value: '' }, 'All decks'),
    decks.map((d) => h('option', { value: d.id, selected: d.id === deck?.id }, d.name)),
  );
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n.toLocaleString()), label);
  const ahead7 = sum(all.slice(1, 8).map((d) => d.total));
  const ahead30 = sum(all.slice(1, 31).map((d) => d.total));

  const items = days.map((day, i) => ({
    value: day.total,
    label: `${i < 2 ? `${name(day, i)}, ${dayName.format(day.start)}` : longDate.format(day.start)}: ${breakdown(day)}`,
    tick: i % ahead.every ? null : i === 0 ? 'Today' : ahead.every === 1 ? weekday.format(day.start) : shortDate.format(day.start),
    parts: [...UPCOMING_KINDS].reverse().map(([kind, , colour]) => [colour, day[kind]]),
  }));
  const total = sum(days.slice(1).map((d) => d.total));
  const busiest = days.slice(1).reduce((best, day) => (day.total > best.total ? day : best), { total: 0 });
  const sub = total
    ? `${plural(total, 'card')} over the next ${ahead.span}, about ${+(total / ahead.days).toFixed(1)} a day. The busiest day is ${dayName.format(busiest.start)}, with ${busiest.total.toLocaleString()}.`
    : `Nothing comes up over the next ${ahead.span}.`;

  const table = h(
    'table',
    { class: 'upcoming' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Day'), UPCOMING_KINDS.map(([, label]) => h('th', { scope: 'col' }, label)), h('th', { scope: 'col' }, 'Total'))),
    h(
      'tbody',
      null,
      days.map((day, i) =>
        h(
          'tr',
          { class: [!day.total && 'none', i > 0 && new Date(day.start).getDay() === 1 && 'week-start'].filter(Boolean).join(' ') },
          h('th', { scope: 'row' }, name(day, i), i < 2 && h('span', null, dayName.format(day.start))),
          UPCOMING_KINDS.map(([kind]) => h('td', { class: day[kind] ? kind : null }, day[kind] ? day[kind].toLocaleString() : '–')),
          h('td', null, h('b', null, day.total.toLocaleString())),
        ),
      ),
    ),
  );

  app.replaceChildren(
    h(
      'div',
      { class: 'page' },
      topbar(),
      h('a', { class: 'back', href: deck ? `#/deck/${deck.id}` : '#/' }, icon('back'), deck ? deck.name : 'All decks'),
      h('div', { class: 'page-head', style: 'margin-top: 14px' }, h('div', null, h('h1', null, 'Upcoming'), h('p', { class: 'sub' }, deck ? deck.name : 'All decks'))),
      hasCards
        ? [
            h(
              'div',
              { class: 'filters' },
              decks.length > 1 && deckSelect,
              h(
                'div',
                { class: 'segmented', role: 'group', 'aria-label': 'How far ahead' },
                AHEAD.map((range) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      'aria-pressed': String(range === ahead),
                      onclick: () => {
                        ahead = range;
                        render();
                      },
                    },
                    range.label,
                  ),
                ),
              ),
            ),
            h('div', { class: 'summary' }, stat(all[0].total, 'today'), stat(all[1].total, 'tomorrow'), stat(ahead7, 'in the next 7 days'), stat(ahead30, 'in the next 30 days')),
            panel(
              'Cards each day',
              sub,
              columnChart(items, 'card'),
              h(
                'ul',
                { class: 'legend' },
                UPCOMING_KINDS.map(([kind, label, colour]) => h('li', null, h('i', { class: `k-${colour}` }), h('span', null, label), h('b', null, sum(days.map((d) => d[kind])).toLocaleString()))),
              ),
            ),
            panel(
              'Day by day',
              null,
              h('div', { class: 'table-scroll' }, table),
              h(
                'p',
                { class: 'panel-note' },
                'New cards are counted at each deck’s daily limit, supposing you study every day. The cards you study will come back on later days too, so those days fill up as you go.',
                reserve ? ' Cards on reserve are not counted until they are pulled in.' : '',
              ),
            ),
          ]
        : h(
            'div',
            { class: 'empty' },
            h('h2', null, 'Nothing coming up'),
            h('p', null, 'Add some cards and study them. The days they come back on will be listed here.'),
            h('a', { class: 'btn primary', href: deck ? `#/deck/${deck.id}` : '#/' }, deck ? 'Go to deck' : 'Go to decks'),
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
  if (view !== 'deck') {
    query = '';
    filtersDeck = null;
  }
  tip.hidden = true;
  if (view === 'deck' && deck) renderDeck(deck);
  else if (view === 'study' && deck) renderStudy(deck);
  else if (view === 'stats') renderStats(deck);
  else if (view === 'upcoming') renderUpcoming(deck);
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
