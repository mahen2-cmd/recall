---
name: Recall
description: A calm, minimal spaced-repetition app where the card is the only object that matters.
colors:
  ground: "#f7f8f9"
  surface: "#ffffff"
  surface-sunk: "#eef0f2"
  hover-wash: "#f0f2f4"
  hairline: "#e4e6e9"
  hairline-strong: "#cdd1d6"
  ink: "#15171a"
  muted-ink: "#5d636c"
  cobalt: "#2b4fb7"
  cobalt-deep: "#213f97"
  cobalt-wash: "#e7ecfa"
  link: "#2b4fb7"
  on-accent: "#ffffff"
  state-new: "#2f63d1"
  state-learning: "#ad620c"
  state-due: "#1d7b4d"
  danger: "#c3313c"
  danger-wash: "#fbe8e9"
  ground-dark: "#111315"
  surface-dark: "#181a1d"
  hairline-dark: "#26292e"
  hairline-strong-dark: "#363a41"
  ink-dark: "#e8e9eb"
  muted-ink-dark: "#9ba1a9"
  cobalt-dark: "#3e62d4"
  cobalt-lift-dark: "#4b6fe0"
  link-dark: "#93acff"
  state-new-dark: "#7ea6ff"
  state-learning-dark: "#e3a258"
  state-due-dark: "#5dc78f"
typography:
  today-headline:
    fontFamily: "Source Serif 4, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(38px, 5.4vw, 58px)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  display-short:
    fontFamily: "Source Serif 4, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(44px, 7vw, 80px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Source Serif 4, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(28px, 4.4vw, 44px)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  card-answer:
    fontFamily: "Source Serif 4, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(21px, 2.8vw, 28px)"
    fontWeight: 400
    lineHeight: 1.45
  card-inline:
    fontFamily: "Source Serif 4, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  headline:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  meta:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 560
    lineHeight: 1.5
  ruler-tick:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  inner: "5px"
  sm: "7px"
  md: "10px"
  round: "50%"
spacing:
  hair: "4px"
  tight: "8px"
  row: "16px"
  gutter-phone: "16px"
  block: "24px"
  gutter: "32px"
  section: "40px"
  page-max: "1000px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.hover-wash}"
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-large:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 26px"
    height: "48px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.sm}"
    size: "34px"
  rate-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
  rate-button-hover:
    backgroundColor: "{colors.hover-wash}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
  chip-pressed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  menu:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "6px"
    width: "210px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "22px 24px 24px"
    width: "540px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  state-dot:
    size: "6px"
    rounded: "{rounded.round}"
---

# Design System: Recall

## Overview

**Creative North Star: "Night Minimal"** (chosen 2026-10-29, replacing "Quiet Type on One Ground")

Recall is built dark-first for evening study and is just as complete in light. The home page opens on the day itself: a large serif sentence saying what is left ("Five cards, then you're done."), one way in, and the day's figures beside it. Decks sit below as quiet blocks. The study screen keeps the card unboxed and large, with a segmented progress bar, the interval ruler and four rating buttons that lean toward Good, the answer Space gives. On a phone the main links move to a tab bar along the bottom and the rating buttons go two by two.

What follows from "Quiet Type on One Ground" still holds unless a section says otherwise.

The card is the only object that matters. Everything else in Recall is quiet type set on a single cool neutral ground: ink for what you read, a muted grey for what you can skip, and one deep cobalt for the thing you can press next. Structure comes from hairline rules, not boxes; lists are ruled rows, the day's figures are a ruled strip, and the card itself is unboxed words set large in a serif, centred, with nothing around them.

Density is calm, not sparse. A deck block carries its name, a meta line, three labelled dotted numerals and a Study button; a study screen is one thin header line, a 4px progress bar, the card, the interval ruler and four rating buttons. Both themes are first-class and share every rule; the dark theme is a near-black cool ground, not an inversion.

The one signature device is the interval ruler on the study screen: a hairline log-time axis from one minute to one year, with each answer's next review marked where it falls. It is the only place the interface draws a picture, and it exists to show the scheduler honestly. The old index-card skeuomorphism, themed worlds and coloured pill badges were rejected for this system.

**Key Characteristics:**
- One cool neutral ground per theme; no cream. Dark is the evening default; light is the same design.
- A single cobalt accent for action and focus, with white text on it in both themes.
- State is a 6px dot beside a tabular numeral, never a coloured badge.
- Hairline rules divide; shadows appear only on things that float.
- Interface in Hanken Grotesk; card text, and the home page's one headline, in Source Serif 4.
- The interval ruler is the signature: a log-time axis with lit marks.

## Colors

A cool, nearly colourless neutral scale with a single deep cobalt and three small Anki state hues.

### Primary
- **Deep Cobalt** (cobalt): the only action colour. Primary buttons, the Study button of the deck that is due, the lit ruler mark, the caret, selection tint, checkbox accent and the focus border on inputs. In dark mode it lifts slightly (cobalt-dark) so it still reads on the near-black ground.
- **Cobalt Deep** (cobalt-deep): hover state of primary buttons in light mode; in dark mode the hover lightens instead (cobalt-lift-dark).
- **Cobalt Wash** (cobalt-wash): the 3px focus halo around inputs, selected card rows, active filters, editable maths on hover.
- **White On-Accent** (on-accent): text on cobalt, in both themes.
- **Link Tint** (link / link-dark): a separate token for text links, the hovered deck name and the 2px `:focus-visible` outline. In light mode it equals cobalt; in dark mode it is a pale periwinkle so link text and focus rings stay legible where the solid cobalt fill would not.

### Secondary
- **Anki State Hues** (state-new blue, state-learning ochre, state-due green): Anki's own state colours. Used only as the fill of a 6px dot beside a numeral or status word, as the bar colours of charts (separate `--chart-*` tokens), and as the done-screen tick. Each theme has its own tuned set.

### Tertiary
- **Signal Red** (danger / danger-wash): destructive buttons and menu items, the save-error chip, and hover on destructive icon buttons.

### Neutral
- **Cool Ground** (ground / ground-dark): the page itself. The study screen and the card sit directly on it.
- **Surface** (surface / surface-dark): fills of buttons, inputs, rating buttons, dialogs and menus; one step off the ground.
- **Sunk Surface** (surface-sunk): track of the segmented control.
- **Hover Wash** (hover-wash): row and button hover.
- **Hairline** (hairline / hairline-dark): the default rule between rows, around the summary strip, under the top bar, and the progress track.
- **Strong Hairline** (hairline-strong / hairline-strong-dark): the rule under a column head, button and input strokes, the ruler axis, the short rule between question and answer, and the dot of a zero count.
- **Ink** (ink / ink-dark): primary text, the progress fill, the active nav underline, the pressed chip stroke, and the toast fill.
- **Muted Ink** (muted-ink / muted-ink-dark): meta lines, labels, unlit ruler rings, tick labels, icon buttons at rest.

### Named Rules
**The One Cobalt Rule.** Cobalt means "press this" or "you are here". On the home screen the one filled button is "Start review", which opens the first deck with cards due; every deck's own Study button is the plain outlined button. On the study screen Good, the answer Space gives, is the one rating outlined in the link colour on a cobalt wash, and its ruler mark is ringed to match.

**The Dot Rule.** State colour appears only as a 6px round dot beside a tabular numeral or a status word. A zero count greys its dot (strong hairline) and its numeral (muted ink). Never tint a background, a pill or a whole row by state.

**The Separate Link Rule.** Links and focus rings use the link token, never cobalt directly, so the dark theme can keep a solid cobalt fill under white text while links and focus stay pale and legible.

## Typography

**Display Font:** Source Serif 4 (with Iowan Old Style, Palatino, Georgia)
**Body Font:** Hanken Grotesk (with ui-sans-serif, system-ui)

**Character:** A plain, slightly warm grotesque runs the whole interface; a book serif with Greek sets only the words being learned, so the card always reads as a different voice from the controls around it. Both are vendored locally; nothing loads from a CDN.

### Hierarchy
- **Today Headline** (Source Serif 4, 400, clamp(38px, 5.4vw, 58px), 1.08, -0.02em): the home page's one sentence about the day. The only interface text set in the serif.
- **Display Short** (Source Serif 4, 400, clamp(44px, 7vw, 80px), 1.1): a question side of 28 characters or fewer on one line, with no maths or images. Its short answer is clamp(30px, 4.4vw, 44px).
- **Display** (Source Serif 4, 400, clamp(28px, 4.4vw, 44px), 1.25): any longer question side, centred and balanced.
- **Card Answer** (Source Serif 4, 400, clamp(21px, 2.8vw, 28px), 1.45): the revealed answer, in the answer token: 82% ink mixed into the ground in light, pale periwinkle (#b9c9ff) in dark.
- **Card Inline** (Source Serif 4, 400, 16px, 1.45): card text in the card list (clamped to two lines), editor previews and import previews.
- **Headline** (Hanken Grotesk, 650, 30px, 1.15, -0.025em): page titles. 26px under 640px. The done screen uses 28px.
- **Figure** (600, 26px, -0.02em): the large numbers in the summary strip. 21px under 640px.
- **Title** (600 to 650, 17px, -0.01em): deck names, the wordmark (700), panel headings. Dialog titles go to 19px.
- **Body** (400, 15px, 1.5): everything else. Tabular numerals are on for the whole body.
- **Meta** (400, 13.5px): deck meta lines, counts, rating intervals, panel notes.
- **Label** (560 to 600, 12.5 to 13px): column heads, field labels, small help text. Sentence case, no tracking.
- **Ruler Tick** (12px muted): the 1m / 1h / 1d / 1w / 1mo / 1y labels; the per-mark rating number is 10.5px 600.

### Named Rules
**The Two Voices Rule.** Serif is for card content, plus the single Today Headline on the home page; the rest of the interface never sets its chrome in Source Serif 4, and card text never appears in Hanken Grotesk.

**The Tabular Rule.** Every figure is tabular (`font-variant-numeric: tabular-nums` on body) so counts line up in their columns.

## Layout

A single centred column, 1000px wide, with 32px side gutters and 96px of bottom room (16px gutters under 640px, with bottom room for the tab bar). The top bar is 64px tall (56px on phones) with a 1px hairline beneath it: wordmark, then text nav (Decks, Upcoming, Statistics) with a 2px ink underline on the current page, then a spacer and quiet icon buttons. Page heads sit 40px below the bar with 24px beneath; titles and their action buttons share one baseline row.

The home page opens with the Today section, 52px below the bar: a two-column grid of the headline column and a 240px figures column, 48px apart. The headline column holds the part of the day ("Thursday evening", where the small hours before 4am still belong to the day before), the Today Headline, then a 52px "Start review" button with a muted line naming the deck it opens. The figures column is a stack of ruled figures: reviewed today; the last seven days as a strip of 22px squares (cobalt for days with reviews, sunk surface for none, today ringed in the link colour) above the streak; and the cards due tomorrow. Below it, a "Decks" heading with Import from Anki and New deck, then one block per deck: surface fill, 1px hairline, 14px radius, 10px apart, holding name and meta, the labelled counts, and the deck's action in a 240px column. Secondary deck actions stay invisible until hover or focus-within. Other lists (cards in a deck, upcoming days) stay ruled rows. The summary strip on the statistics and upcoming pages is a ruled band of equal columns divided by vertical hairlines.

The study screen is a full-height column: header line (60px), 4px progress bar, the card centred in the remaining space, then the answer bar (ruler above a four-column rating grid with 10px gaps).

Responsive adaptations:
- **760px:** the Today section becomes one column; its figures become a ruled three-column strip and the seven-day squares hide. Each deck block becomes name and meta over the counts, with the Study button spanning both lines on the right and the per-deck icon buttons hidden.
- **640px:** gutters drop to 16px; top bar to 56px; the main links become a fixed tab bar along the bottom (three equal tabs of icon over a 12px label, 56px tall, the current one in the link colour, on a 92% ground with a 12px blur, above the safe area), and toasts rise above it; headline to 26px; card rows reflow to text, back text and due date stacked beside the checkbox with actions always visible; filters fold behind a toggle; chips wrap onto further lines rather than scrolling sideways, so none is hidden off screen; the reserve bar collapses its extra actions into a menu; rating buttons go two by two, 64px tall with a 14px radius, centre their label and interval and drop their keycaps; the study header drops the state and count labels; the "saved" chip hides unless it shows an error.
- **`pointer: coarse`:** every control reaches 44px for the finger: buttons, inputs, icon buttons, speak buttons and menu items are 44px tall, chips are 44px with 8px gaps, checkboxes grow to 22px inside a 44px label, and the "See the days ahead" link gains an invisible 12px tap margin. Desktop sizes are unchanged. Controls also take `touch-action: manipulation`, so taps register without the double-tap-zoom delay.
- **Safe areas:** the page uses `viewport-fit=cover`, and the study screen keeps its rating buttons above the phone's home indicator with `env(safe-area-inset-bottom)`. Full-height views use `100dvh` (with a `100vh` fallback) so mobile browser bars do not cut them off.

A deck's card list draws the first 200 matching cards, with a "Show 200 more" row beneath them and a count of how many are shown; searching starts again from 200. Select all still ticks every match, drawn or not.

`prefers-reduced-motion: reduce` switches off every animation and transition.

## Elevation & Depth

Flat by default. Depth is expressed by hairlines and by the surface/ground step, not by shadow. One shadow token exists, a soft two-layer lift, and it is reserved for things that float above the page: dialogs, menus, toasts and the chart tooltip. Dialogs also dim the page with a 40% cool-black backdrop.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 2px 6px rgb(20 24 32 / 0.06), 0 24px 60px rgb(20 24 32 / 0.18)`; dark: `0 2px 6px rgb(0 0 0 / 0.3), 0 24px 60px rgb(0 0 0 / 0.55)`): dialogs, dropdown menus, toasts, chart tooltips.
- **Focus Halo** (`box-shadow: 0 0 0 3px var(--accent-soft)`): not depth, a focus ring on inputs and the maths field.
- **Lit Mark Halo** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)`): the soft ring around the lit ruler mark.

### Named Rules
**The Hairline-Not-Box Rule.** Group content with 1px rules above and below. The one exception is the deck block on the home page, a bordered surface with no shadow. The study card has no box at all.

**The Only-What-Floats Rule.** Shadow appears only on surfaces that overlay the page (dialog, menu, toast, tooltip). Nothing at rest in the page flow casts one.

## Shapes

Gently rounded controls on a square-ruled page. Buttons, inputs, chips, toasts and images use a 7px radius; rating buttons use 12px (14px on phones) and deck blocks 14px; dialogs, menus and the large button use 10px; items inside a menu or segmented control use 5px; keycaps and small inline previews use 4px. Dots, ruler marks, the speak button and the done badge are full circles. Rules are always 1px; the only heavier lines are the 2px nav underline, the 4px progress bar and the 2px drop indicator when reordering. Icons are inline SVG at 18px with a 1.7 round stroke in currentColor.

## Components

### Buttons
Plain and firm: a stroked rectangle that presses down a pixel.
- **Shape:** gently rounded (7px), 36px tall (44px on touch screens), 14px side padding, weight 560.
- **Default:** surface fill, strong-hairline stroke, ink text. Hover washes the fill and darkens the stroke toward ink.
- **Primary:** cobalt fill and stroke, white text; hover goes to cobalt-deep (dark theme lifts lighter).
- **Ghost:** no fill or stroke until hover.
- **Danger:** red fill, white text (near-black text in the dark theme).
- **Large:** 48px, 26px padding, 16px text, 10px radius; the done screen's call to action.
- **Small:** 28px, 13px text, used in editor field tools; selection bars use 32px.
- **Active:** `translateY(1px)`. Disabled: 50% opacity.
- **Keycaps:** shortcut hints sit inside buttons as an outlined 11px keycap (1px currentColor stroke, 60% opacity); hidden under 640px.

### Icon Buttons
- 34px square (44px on touch screens), transparent, muted icon; hover washes the background and inks the icon. Destructive ones wash red on hover.

### Chips
- **Style:** 30px (44px on touch screens), 7px radius, light hairline stroke, transparent fill, muted 13.5px text with a lighter count.
- **State:** pressed chips take a surface fill, ink text and an ink stroke; no colour fill.

### Cards / Containers
- **Corner Style:** none for content groups; they are not boxed.
- **Background:** the ground itself.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px hairline rules above and below (summary strip, reserve bar, empty state, panels).
- **Internal Padding:** vertical only, 14 to 32px; horizontal alignment comes from the page gutter.

### Inputs / Fields
- **Style:** surface fill, strong-hairline stroke, 7px radius, 8px 11px padding; 36px tall in toolbars. Labels sit above in 13px 600.
- **Focus:** stroke turns cobalt with a 3px cobalt-wash halo; no outline.
- **Help text:** 12.5px muted below the field.

### Navigation
- Text links in 550 weight, muted at rest, ink on hover. The current page is ink with a 2px ink underline that sits on the top bar's hairline. No pills, no backgrounds. Under 640px the same links become the bottom tab bar (see Layout); their icons show only there.

### Dialogs, Menus and Toasts
- **Dialog:** 540px (420px narrow), surface, light hairline, 10px radius, float shadow, rises 8px on open; title 19px 650 with a close icon button.
- **Menu:** a `details` disclosure; 210px panel, 6px padding, 10px radius, float shadow, reveals 4px; items are 7px 10px rows with a 5px radius and a muted icon.
- **Toast:** an inverted rectangle (ink fill, ground text, 7px radius) at the bottom centre, float shadow.

### State Marks (counts and status)
A 6px circular dot in the state hue, then the numeral in ink 650, then the label in muted 13.5px. In deck blocks the labels are always shown. Zero counts grey both dot and numeral. A status mark (dot plus word) is used in card rows and the study header.

### Rating Buttons
- Four equal columns, 10px gap. Each is a hairline-stroked 12px rectangle at least 72px tall: rating word in 650, the interval in muted 13.5px beneath, keycap on the right. Hover darkens the stroke and washes the fill.
- **Again:** its word is in the danger colour; nothing else about it changes.
- **Good:** link-coloured stroke on a cobalt wash, with its word, interval and keycap in the link colour. Its keycap reads "Space", since Space and Enter answer Good; 3 still works, and the button's title says so.
- Under 640px they go two by two (see Layout), centre their content and drop the keycap.

### Interval Ruler (signature)
A hairline log-time axis spanning the width of the rating row, from one minute to one year, with tick labels 1m, 1h, 1d, 1w, 1mo, 1y in 12px muted type below it.
- **Marks:** each rating's next review is a 9px ring (1.5px muted stroke, ground fill) placed on the log scale. Marks are kept at least 4% of the axis apart, pushed right and then clamped back from the end, so four answers never collide.
- **Lit mark:** hovering or focusing a rating button fills its mark with cobalt and adds a 3px soft cobalt ring (28% mix). At rest, Good's mark has a link-coloured ring to match its button.
- **Touch:** under `hover: none` each mark shows its rating number (10.5px 600 muted) above it, and the ruler gains 14px top padding to hold them.
- **Motion:** on reveal the marks travel out from "now" (the left end) to their positions over 0.7s on the house ease, staggered 40ms per mark; the ruler and rating row fade up 4px.
- The ruler is `aria-hidden`; the intervals are stated in text on each button.

### Study Card
Unboxed. The question is set in Display (Display Short for a word or short phrase), the answer in Card Answer below a 56px strong-hairline rule, each followed by a 40px round speak button with a hairline ring.

### Progress
A 4px rounded bar under the study header. A session of 2 to 24 cards shows one segment per card, 4px apart, filled in the link colour as each is answered (empty segments in the strong hairline); a longer session shows one continuous bar. It carries an `aria-label` such as "2 of 5 cards done". The card rises 8px on arrival; the answer reveals 4px. Display maths may break out to the column width and fades at the edge when it scrolls.

### Motion
One ease, `cubic-bezier(0.16, 1, 0.3, 1)`, for rises (0.3 to 0.4s), reveals (0.2 to 0.35s), progress width (0.5s) and the ruler's travel (0.7s). Hover colour changes are 0.15s linear defaults.

## Do's and Don'ts

### Do:
- **Do** separate content with 1px hairlines (`--border`, `--border-strong` under column heads) and leave it on the ground.
- **Do** show state as a 6px dot beside a tabular numeral, in Anki's blue, ochre and green.
- **Do** fill exactly one action per view with cobalt and give it white text, in both themes ("Start review" on the home page).
- **Do** use the link token for text links and the 2px `:focus-visible` outline.
- **Do** set card content and the home page's Today Headline in Source Serif 4, and all other interface text in Hanken Grotesk.
- **Do** keep secondary row actions hidden until hover or focus-within on wide screens, and visible on phones.
- **Do** keep every interval visible as text on its rating button; the ruler only illustrates it.
- **Do** keep Anki's words: Again, Hard, Good, Easy; New, Learning, Due.

### Don't:
- **Don't** put content in bordered boxes other than the home page's deck blocks, and never give anything at rest a shadow; shadow is only for dialogs, menus, toasts and tooltips.
- **Don't** use coloured pill badges or tinted backgrounds to show state.
- **Don't** introduce a second accent hue or a cream or warm ground.
- **Don't** use cobalt for links or focus rings directly; use the link token.
- **Don't** return to index-card skeuomorphism or any themed world.
- **Don't** add uppercase tracked labels or kickers above headings; labels are sentence case.
- **Don't** show ruler numbers on hover-capable screens; there the lit mark does the work.
- **Don't** set any text below 12px, except keycaps and ruler mark numbers, which repeat information shown in full elsewhere.
- **Don't** make a touch target smaller than 44px or hide part of a set of chips in a sideways scroll on a phone.
