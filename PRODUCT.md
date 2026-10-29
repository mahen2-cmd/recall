# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The author first: a self-learner studying European Portuguese vocabulary and technical subjects such as robotics maths (Lynch & Park's *Modern Robotics*). Later, other self-learners who clone the repository from GitHub and run it themselves, many of them coming from Anki.

They use it in several settings, all of them real:

- long keyboard-driven review sessions at a desktop;
- short bursts of review on a phone over the local network, using touch;
- long stretches writing cards: equations, screenshots from books, imports from spreadsheets and Anki;
- often in the evening or in low light, in dark mode.

## Product Purpose

Recall is a small, fast spaced-repetition flashcard app with Anki's scheduling and a cleaner interface. It runs on the learner's own computer, keeps every card in a plain file they own (`data/recall.json`, images in `data/media/`), and reads cards aloud, with a language for each side. Success means a learner reviews every day without friction and trusts that the schedule is exactly Anki's.

## Positioning

Recall uses Anki's own scheduler (SM-2 by default, FSRS-6 per deck), ported from Anki's source, and an Anki import that keeps every card's due date, interval and ease. It adds things Anki makes awkward: maths typed in a visual editor, images pasted straight onto a card, per-side read-aloud in two languages, and a reserve of cards held out of study until pulled in. It is local-first and the data is a plain file the learner owns.

## Operating Context

- The main loop is a daily study session: show the front, reveal the back, rate Again / Hard / Good / Easy. Each button shows when the card would come back.
- Keyboard: `Space`/`Enter` reveals then rates Good, `1`–`4` rate, `R` replays audio, `E` edits, `Ctrl+Enter` saves in the editor.
- Card authoring: LaTeX between `\( \)` and `\[ \]` markers, the MathLive equation editor, images pasted, dropped or picked.
- Imports: Excel/CSV into a deck or its reserve, and Anki `.apkg` packages.
- Review planning: statistics (forecast, activity calendar, card states, answer buttons, retention) and upcoming cards by day.
- Started with `npm start` and opened at `http://localhost:5173`, on desktop or on a phone on the same network.

## Capabilities and Constraints

- Decks and cards: create, edit, move, search, filter, sort, select and delete in bulk.
- Per-deck settings: new cards per day, easy interval, scheduler (Anki default or FSRS), FSRS retention, auto-play audio, front and back language, speaking speed, keeping generated audio.
- Reserve: import into it, pull in N or all, reorder by drag or by Up/Down/To top/To bottom, add reversed copies, send cards back.
- Must work fully offline: KaTeX and MathLive are vendored in `vendor/`, and any fonts or assets must be bundled locally, with nothing loaded from a CDN.
- The current stack is plain HTML, CSS and JavaScript with no build step, served by a single Node file (`server.js`). Avoiding new dependencies was not made a hard rule.
- Light and dark themes are both first-class.
- Works at phone width with touch.

## Brand Commitments

- Name: **Recall**.
- Keep Anki's vocabulary so Anki users feel at home: Again, Hard, Good, Easy; new, learning, due, young, mature; deck, card, review.
- Voice in the README and UI: plain, short, concrete English sentences that say what happens ("Pulled cards become ordinary new cards").
- Look and feel (chosen 2026-10-28): calm and minimal, distinct through craft rather than a theme, at the level of iA Writer, Things and Linear. Themed worlds (post office, timetable, airport signage, darkroom, dictionary page) and the old index-card skeuomorphism were rejected; so were coloured pill badges, busy screens and wasted space.
- Look and feel, refined (chosen 2026-10-29): "Night minimal". The same calm, minimal family, with more presence and built dark-first for evening study: a serif headline on the home page saying what is left today, one "Start review" button, the day's figures and a seven-day streak strip, decks as quiet blocks, larger card type, a segmented progress bar, rating buttons that lean toward Good, and on a phone a bottom tab bar and two-by-two rating buttons. Chosen from mockups over a Swiss-grid identity (rejected outright), a sidebar workspace, and a single "Today" queue across decks, which was set aside because it would change how studying works.

## Evidence on Hand

- Screenshots of the deck list and the study screen: `docs/decks.png`, `docs/study.png`.
- The README documents every feature in detail.
- No users, testimonials or usage numbers exist yet. Do not invent any.

## Product Principles

1. The daily review is sacred: nothing gets between the learner and the next card.
2. Trust through fidelity: scheduling numbers match Anki's, and the interface shows them honestly.
3. The learner owns everything: local, offline, a plain file.
4. Authoring is a first-class job, not an afterthought to studying.
5. Quiet enough for a late-night session, clear enough on a phone in a queue.

## Accessibility & Inclusion

Full keyboard operation for study and authoring. Comfortable reading in low light. Touch targets that work on a phone.
