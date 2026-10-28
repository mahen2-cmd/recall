---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["js/app.js","css/styles.css"]
---

# Recall app (all screens)

Scope: the whole app (decks, deck page, study, card editor and dialogs, imports, statistics, upcoming). Visitor mode: Operate.

Audience and job: a self-learner (European Portuguese, robotics maths) reviewing every day at a desktop by keyboard, on a phone in short bursts, writing many cards, often at night. Success: nothing stands between them and the next card; managing decks and cards is dense and calm.

Constraints: offline (fonts in vendor/fonts), Anki vocabulary, light and dark both first-class, plain HTML/CSS/JS. The user asked for calm and minimal, distinct through craft, at the bar of iA Writer, Things and Linear; earlier rounds rejected themed worlds (post office, timetable, airport, darkroom, lexicon) and the old index-card skeuomorphism, coloured pill badges, violet SaaS buttons, busy screens and wasted space.

## Direction contract

THESIS: The card is the only object that matters; everything else is quiet type on one ground. Refuses the category default of tiles, coloured pill badges and a violet primary on a grey dashboard.

OWN-WORLD: One cool neutral ground (no cream), ink text, a single deep cobalt accent for action and focus; state colours are Anki's (blue new, ochre learning, green due) used only as a 6px dot beside a tabular numeral. Hairline rules instead of boxes, no shadows except dialogs. Hanken Grotesk for the interface, Source Serif 4 (optical sizes) for card text beside KaTeX.

STORY: Open Recall, see in one line what is due and a ruled list of decks; press Study; read one card set large; see on a time ruler when each answer would bring it back; rate with 1-4; finish and leave.

FIRST VIEWPORT: Home: text nav (Decks, Upcoming, Statistics) right of a wordmark; a one-line summary; decks as rows in a ruled list with New/Learning/Due columns of dotted numerals and a Study button at each row end; the primary action is the Study button of the first deck with cards due. Study: one thin header line (close, deck name, counts), a hairline progress, the card text centred at display size, and below it the rating row.

FORM: Signature move is the interval ruler: above the four rating buttons a hairline log-time axis from now to a year, with each rating's next review marked where it falls; hovering or focusing a button lights its mark. The canon path taken at full craft after two rejected rounds (the user's own choice, not a ranked grounded candidate). seed:04e94681bb9d59c9

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
