# Recall

A small, fast flashcard app with Anki's scheduling and a cleaner interface. It runs on your own computer, keeps your cards in a plain file you own, and reads European Portuguese sentences aloud.

![The deck list, showing three Portuguese decks with their new, learning and due counts](docs/decks.png)

![Studying a card in dark mode, with the answer shown and the four rating buttons](docs/study.png)

## Features

- **Decks and cards.** Create as many decks as you like; add, edit, move, search and delete cards.
- **Import from Excel.** Turn a spreadsheet of words into cards in one step.
- **Anki's scheduler.** Ported from Anki's source: its default algorithm (SM-2), and FSRS-6 as a per-deck option, with the same learning steps, relearning, interval fuzz and 4am day rollover.
- **Intervals on the buttons.** Again, Hard, Good and Easy each show when the card would come back.
- **Read aloud.** A speaker button on each side of a card, optional auto-play, and an adjustable speaking speed. Audio is generated once per sentence and cached.
- **Your data in a file.** Everything is saved to `data/recall.json`, with a dated backup each day.
- **Keyboard-first studying**, light and dark themes, and a layout that works on a phone.
- **No dependencies.** The app is plain HTML, CSS and JavaScript; the server is one Node file.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/mahen2-cmd/recall.git
cd recall
npm start
```

Open **http://localhost:5173**. That's all that is needed to make decks and study.

For the full set of voices, run this once (needs Python 3; `ffmpeg` is optional):

```bash
npm run setup-voice
```

## Studying

A new card starts with Anki's default learning steps:

| Button | New card | What it does |
|---|---|---|
| **Again** | <1m | Back to the first step |
| **Hard** | <6m | Stays on the current step |
| **Good** | <10m | Moves to the next step, then graduates to review |
| **Easy** | 4d | Graduates straight away |

After that, the schedule depends on the deck's scheduling setting:

- **Anki default** (SM-2). Each interval is the previous one multiplied by the card's ease, which starts at 250%. Pressing Good every time gives 1, 3, 8, 20, 50, 125 days and so on. Easy adds a 30% bonus and raises the ease; Hard grows the interval by 20% and lowers the ease.
- **FSRS.** Intervals come from a model of how well you remember each card, aiming for the deck's desired retention. This is what Anki does when FSRS is switched on.

In both, forgetting a review card sends it through one 10-minute relearning step. A deck can switch between the two at any time, because both sets of scheduling data are kept for every card.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` or `Enter` | Show the answer, then rate Good |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `R` | Replay the audio |
| `E` | Edit the current card |
| `Ctrl` + `Enter` | Save in the card editor |

### Deck settings

Each deck has its own:

- **New cards per day** (default 20).
- **Easy interval** (default 4 days): how far out Easy sends a card you are learning for the first time. With FSRS, 0 lets FSRS choose, which is what Anki does.
- **Scheduling**: Anki default or FSRS.
- **FSRS retention** (default 90%). Higher means fewer forgotten cards and more reviews.
- **Auto-play audio**: off, front, back or both sides.
- **Speaking speed**, from normal down to very slow.

## Importing from Excel

Open a deck and press **Import**, then choose a file. Each row becomes one card.

- **Files:** Excel `.xlsx`, or `.csv` and tab-separated text. Old `.xls` files need to be saved as `.xlsx` first.
- **Columns:** pick which column is the front and which is the back. Column A and B are used by default.
- **Header row:** tick the box if the first row holds column titles.
- **Duplicates:** rows whose front is already in the deck are skipped, so the same file can be imported again after you add to it.
- **Preview:** the dialog shows the first cards and how many rows will be skipped before anything is added.

Only the first sheet of a workbook is read, and rows missing either a front or a back are left out. Imported cards are new cards, in the order they appear in the file.

## Voices

The speaker reads text as European Portuguese. Several voice engines are supported, and the best one available is used automatically:

| Engine | Needs | Notes |
|---|---|---|
| Azure neural voices | An Azure Speech key | Official and supported |
| Google Translate | Nothing | The default. Unofficial |
| Microsoft Edge voices | `npm run setup-voice` | Unofficial |
| Piper | `npm run setup-voice` | Fully offline; the fallback when nothing else is reachable |

The Google Translate and Edge engines use addresses those companies do not publish for this purpose, so either could stop working without notice. When one fails, the next engine takes over. If the Edge voice breaks, running `npm run setup-voice` again updates it.

To change the engine or voice, create `data/tts.json`. Every field is optional:

```json
{
  "engine": "google",
  "voice": "pt-PT-RaquelNeural",
  "azureKey": "your-key",
  "azureRegion": "westeurope"
}
```

- `engine` is `google`, `edge`, `piper` or `azure`.
- `voice` applies to Edge and Azure, for example `pt-PT-DuarteNeural` for a male voice.
- `azureKey` and `azureRegion` come from a Speech resource in the Azure portal.

Changes take effect on the next sentence played; no restart is needed.

## Your data

| Path | Contents |
|---|---|
| `data/recall.json` | Every deck, card and its learning progress |
| `data/backups/` | A copy from the start of each day you used the app; the last 30 are kept |
| `data/audio/` | Cached audio, one file per sentence per voice |
| `data/tts.json` | Voice settings and keys, if you created it |

The `data/` folder is git-ignored, so none of it is ever committed.

- To keep the data somewhere else, such as a synced folder, start with `RECALL_DATA=/path/to/folder npm start`.
- The download and upload buttons in the top bar export and import everything as one JSON file.
- The top bar shows where data is going. If the server stops while the tab is open, it warns you; changes are held in the browser and written to the file when the server is back.
- Use one tab at a time. Two open tabs overwrite each other's changes.

The server listens only on your own machine and rejects requests from other websites.

## How it works

```
index.html          the page
css/styles.css      all styling, light and dark
js/fsrs.js          the scheduler: Anki's SM-2 and FSRS-6 modes, with no browser code
js/store.js         decks, cards, the study queue and saving
js/importer.js      reads .xlsx and CSV files into rows
js/app.js           the interface
server.js           serves the app and reads and writes data/recall.json
tts.js              the voice engines and the audio cache
tests/              unit tests for the scheduler and the store
```

The scheduler follows two sources: the memory model from [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs), which Anki uses, and the learning, review and fuzz rules from [Anki's scheduler](https://github.com/ankitects/anki/tree/main/rslib/src/scheduler/states).

Run the tests with:

```bash
npm test
```

## Differences from Anki

- Fuzz uses Anki's interval ranges but a different random generator, so the exact day chosen within a range will not match Anki card for card.
- Learning steps are fixed at 1 and 10 minutes, and the relearning step at 10 minutes. The other Anki default options (starting ease, easy bonus, hard interval and so on) are fixed at Anki's defaults too.
- Easy on a new card gives exactly the easy interval; Anki varies it by a day either way.
- FSRS uses its default parameters; they are not optimised from your review history.
- There is no load balancer, no card templates, and no import of Anki `.apkg` files.
- Cards are plain text.
