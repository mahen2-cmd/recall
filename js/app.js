import { DAY, MINUTE, Rating, State } from './fsrs.js';
import * as store from './store.js';

const app = document.getElementById('app');
const toasts = document.getElementById('toasts');

// The card currently on screen in study mode.
const session = { deckId: null, cardId: null, revealed: false, done: 0 };
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

  const form = h(
    'form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const values = {
          name: name.value.trim(),
          newPerDay: Number(newPerDay.value),
          retention: Number(retention.value) / 100,
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
      h('label', { class: 'field' }, h('span', null, 'Desired retention (%)'), retention),
    ),
    h('small', { class: 'modal-note', style: 'color: var(--muted)' }, 'Higher retention means you forget less but review more often. 90% is a good default.'),
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
          dialog.close();
          return;
        }
        // Stay open so several cards can be added in a row.
        store.addCard(deckSelect.value, values.front, values.back);
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

function topbar() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }), 'Recall'),
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
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openDeckDialog() }, icon('plus'), 'New deck')),
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
        h('p', null, 'Add a question on the front and its answer on the back.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => openCardDialog({ deckId: deck.id }) }, icon('plus'), 'Add card')),
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
  if (session.deckId !== deck.id) Object.assign(session, { deckId: deck.id, cardId: null, revealed: false, done: 0 });
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
        session.revealed && [h('hr'), h('div', { class: 'face answer' }, card.back)],
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
                  h('span', { class: 'ivl' }, formatInterval(options[rating].due - now)),
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
  if (view !== 'study') session.deckId = null;
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

store.load();
applyTheme();
render();
