// Anki's scheduler with FSRS enabled, ported from Anki's source:
//   - memory model: fsrs-rs (FSRS-6), src/model_v6.rs
//   - learning steps, review constraints and fuzz: anki/rslib/src/scheduler/states
// Pure functions only: no DOM, no storage. Times are epoch milliseconds.

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };

// Default FSRS-6 parameters (w0..w20), as shipped with Anki.
export const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
  0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
];

export const MINUTE = 60_000;
export const DAY = 86_400_000;
const DAY_SECS = 86_400;

// Anki's deck defaults.
export const LEARN_STEPS = [1, 10]; // minutes
export const RELEARN_STEPS = [10]; // minutes
export const MAX_INTERVAL = 36500;
const ROLLOVER_HOUR = 4; // a new day starts at 4am

const S_MIN = 0.0001;
const S_MAX = 36500;
const D_MIN = 1;
const D_MAX = 10;

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// ---- Days -------------------------------------------------------------------

/** The next day rollover (4am local time) after `now`. */
export function nextDayAt(now) {
  const d = new Date(now);
  d.setHours(ROLLOVER_HOUR, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Start of the scheduling day that `now` falls in. */
export function dayStart(now) {
  const d = new Date(nextDayAt(now));
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** Days elapsed since `then`, counted in scheduling days as Anki does. */
export function daysElapsed(then, now) {
  return Math.max(0, Math.floor((nextDayAt(now) - then) / DAY));
}

// ---- FSRS-6 memory model ----------------------------------------------------

function curve(w) {
  const decay = -w[20];
  return { decay, factor: Math.pow(0.9, 1 / decay) - 1 };
}

/** Probability of recall after `t` days for a card with stability `s`. */
export function retrievability(t, s, w = DEFAULT_W) {
  const { decay, factor } = curve(w);
  return Math.pow(1 + (factor * Math.max(t, 0)) / Math.max(s, S_MIN), decay);
}

/** Days (fractional) until retrievability drops to `retention`. */
export function nextInterval(s, retention = 0.9, w = DEFAULT_W) {
  const { decay, factor } = curve(w);
  const dr = clamp(retention, 0.0001, 0.9999);
  return clamp((Math.max(s, S_MIN) / factor) * (Math.pow(dr, 1 / decay) - 1), 0, S_MAX);
}

const initDifficulty = (g, w) => w[4] - Math.exp(w[5] * (g - 1)) + 1;

function nextDifficulty(d, g, w) {
  const delta = -w[6] * (g - 3);
  const damped = d + ((10 - d) / 9) * delta;
  // Mean reversion toward the initial difficulty of an "Easy" card.
  return clamp(w[7] * initDifficulty(Rating.Easy, w) + (1 - w[7]) * damped, D_MIN, D_MAX);
}

function stabilityAfterSuccess(s, r, d, g, w) {
  const hardPenalty = g === Rating.Hard ? w[15] : 1;
  const easyBonus = g === Rating.Easy ? w[16] : 1;
  return (
    s *
    (Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) *
      hardPenalty *
      easyBonus +
      1)
  );
}

function stabilityAfterFailure(s, r, d, w) {
  const ceiling = s / Math.exp(w[17] * w[18]);
  const next =
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(next, ceiling);
}

/** Stability and difficulty after answering `g`, `elapsed` days after the last review. */
export function nextMemory(memory, g, elapsed, w = DEFAULT_W) {
  if (!memory || !memory.stability) {
    return {
      stability: clamp(w[g - 1], S_MIN, S_MAX),
      difficulty: clamp(initDifficulty(g, w), D_MIN, D_MAX),
    };
  }
  const s = clamp(memory.stability, S_MIN, S_MAX);
  const d = clamp(memory.difficulty, D_MIN, D_MAX);
  const t = Math.round(Math.max(elapsed, 0));
  let stability;
  if (t === 0) {
    // Same-day review.
    const sinc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
    stability = s * (g >= Rating.Hard ? Math.max(sinc, 1) : sinc);
  } else {
    const r = retrievability(t, s, w);
    stability =
      g === Rating.Again ? stabilityAfterFailure(s, r, d, w) : stabilityAfterSuccess(s, r, d, g, w);
  }
  return { stability: clamp(stability, S_MIN, S_MAX), difficulty: nextDifficulty(d, g, w) };
}

// ---- Learning steps (anki: states/steps.rs) ---------------------------------

const stepSecs = (steps, index) => (index < steps.length ? Math.trunc(steps[index] * 60) : undefined);

const stepIndex = (steps, left) =>
  Math.min(Math.max(steps.length - (left % 1000), 0), Math.max(steps.length - 1, 0));

const roundInDays = (secs) => (secs > DAY_SECS ? Math.round(secs / DAY_SECS) * DAY_SECS : secs);

function hardDelaySecs(steps, left) {
  const index = stepIndex(steps, left);
  const current = stepSecs(steps, index) ?? stepSecs(steps, 0);
  if (index !== 0) return current;
  // On the first step, Hard sits between Again and Good.
  const next = stepSecs(steps, 1);
  if (next !== undefined) return roundInDays(Math.trunc((current + next) / 2));
  return roundInDays(Math.min(Math.trunc((current * 3) / 2), current + DAY_SECS));
}

const goodDelaySecs = (steps, left) => stepSecs(steps, stepIndex(steps, left) + 1);
const leftAfterGood = (steps, left) => Math.max(steps.length - (stepIndex(steps, left) + 1), 0);

// ---- Fuzz (anki: states/fuzz.rs) --------------------------------------------

const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];

function fuzzDelta(interval) {
  if (interval < 2.5) return 0;
  return FUZZ_RANGES.reduce(
    (delta, r) => delta + r.factor * Math.max(Math.min(interval, r.end) - r.start, 0),
    1,
  );
}

function fuzzBounds(interval, minimum, maximum) {
  minimum = Math.min(minimum, maximum);
  interval = clamp(interval, minimum, maximum);
  const delta = fuzzDelta(interval);
  const lower = clamp(Math.round(interval - delta), minimum, maximum);
  let upper = clamp(Math.round(interval + delta), minimum, maximum);
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return [lower, upper];
}

/** Pick a whole-day interval near `interval`. `fuzz` is in [0, 1), or undefined for none. */
export function withReviewFuzz(fuzz, interval, minimum, maximum) {
  if (fuzz === undefined) return clamp(Math.round(interval), minimum, maximum);
  const [lower, upper] = fuzzBounds(interval, minimum, maximum);
  return Math.floor(lower + fuzz * (1 + upper - lower));
}

/** Lowest interval fuzz may pick, so a passed review never shrinks the interval by chance. */
function minimumFuzzInterval(interval, previous, maximum) {
  const [, upper] = fuzzBounds(interval, 1, maximum);
  if (Math.round(interval) > previous) return previous + 1;
  if (previous <= upper) return previous;
  return 0; // interval genuinely shrank
}

// ---- Scheduling -------------------------------------------------------------

/** Scheduling fields for a card that has never been reviewed. */
export function newSchedule(now = Date.now()) {
  return {
    state: State.New,
    stability: 0,
    difficulty: 0,
    due: now,
    scheduledDays: 0,
    left: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
}

/**
 * The outcome of each possible rating for `card` at time `now`.
 * Returns `{ 1: schedule, 2: schedule, 3: schedule, 4: schedule }`.
 *
 * Options:
 *   retention     desired retention, 0..1
 *   fuzz          number in [0, 1) used to spread review intervals; omit for none
 *   easyInterval  fixed interval in days for Easy on a card still being learned for
 *                 the first time; 0 lets FSRS decide, as Anki does with FSRS on
 */
export function preview(card, now = Date.now(), options = {}) {
  const {
    retention = 0.9,
    w = DEFAULT_W,
    maxInterval = MAX_INTERVAL,
    fuzz,
    easyInterval = 0,
  } = options;
  const maximum = Math.max(maxInterval, 1);
  const elapsed = card.lastReview == null ? 0 : daysElapsed(card.lastReview, now);

  const memory = {};
  const interval = {};
  for (const g of [1, 2, 3, 4]) {
    memory[g] = nextMemory(card, g, elapsed, w);
    interval[g] = nextInterval(memory[g].stability, retention, w);
  }

  const fuzzed = (days, minimum) => withReviewFuzz(fuzz, days, clamp(minimum, 1, maximum), maximum);
  const whole = (days) => Math.max(Math.round(days), 1);

  const base = (g) => ({ ...memory[g], reps: card.reps + 1, lapses: card.lapses, lastReview: now });
  const step = (g, state, secs, left) => ({
    ...base(g),
    state,
    left,
    due: now + secs * 1000,
    scheduledDays: card.scheduledDays ?? 0,
  });
  const review = (g, days) => ({
    ...base(g),
    state: State.Review,
    left: 0,
    due: now + days * DAY,
    scheduledDays: days,
  });

  if (card.state === State.Review) {
    const previous = card.scheduledDays ?? 0;
    const passing = (g, floor) =>
      fuzzed(interval[g], Math.max(minimumFuzzInterval(interval[g], previous, maximum), floor));
    const hard = passing(2, 1);
    const good = passing(3, hard + 1);
    const easy = passing(4, good + 1);
    return {
      1: {
        ...step(1, State.Relearning, stepSecs(RELEARN_STEPS, 0), RELEARN_STEPS.length),
        lapses: card.lapses + 1,
        // Interval the card would get straight after the lapse; fuzz comes on leaving relearning.
        scheduledDays: whole(interval[1]),
      },
      2: review(2, hard),
      3: review(3, good),
      4: review(4, easy),
    };
  }

  // New, learning and relearning cards all walk through steps.
  const relearning = card.state === State.Relearning;
  const steps = relearning ? RELEARN_STEPS : LEARN_STEPS;
  const state = relearning ? State.Relearning : State.Learning;
  const left = card.state === State.New ? steps.length : (card.left ?? 0);

  const goodDelay = goodDelaySecs(steps, left);
  const graduateGood = () => fuzzed(whole(interval[3]), 1);
  const graduateEasy = () => {
    if (!relearning && easyInterval > 0) return Math.min(Math.round(easyInterval), maximum);
    const good = fuzzed(interval[3], 1);
    return fuzzed(whole(interval[4]), good + 1);
  };

  return {
    1: step(1, state, stepSecs(steps, 0), steps.length),
    2: step(2, state, hardDelaySecs(steps, left), left),
    3:
      goodDelay !== undefined
        ? step(3, state, goodDelay, leftAfterGood(steps, left))
        : review(3, graduateGood()),
    4: review(4, graduateEasy()),
  };
}

/** New scheduling fields for `card` after it is answered with `rating`. */
export function schedule(card, rating, now = Date.now(), options = {}) {
  return preview(card, now, options)[rating];
}
