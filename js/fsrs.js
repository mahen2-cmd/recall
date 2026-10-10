// FSRS-6 scheduler (Free Spaced Repetition Scheduler).
// Pure functions only: no DOM, no storage. Times are epoch milliseconds.

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };

// Default FSRS-6 parameters (w0..w20).
export const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
  0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
];

export const MINUTE = 60_000;
export const DAY = 86_400_000;

const S_MIN = 0.001;
const S_MAX = 36500;

// Short (same-day) steps in minutes, used while a card is being (re)learned.
const STEPS = {
  newAgain: 1,
  newHard: 5,
  newGood: 10,
  learnAgain: 5,
  learnHard: 10,
};

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

function curve(w) {
  const decay = -w[20];
  return { decay, factor: Math.pow(0.9, 1 / decay) - 1 };
}

/** Probability of recall after `t` days for a card with stability `s`. */
export function retrievability(t, s, w = DEFAULT_W) {
  const { decay, factor } = curve(w);
  return Math.pow(1 + (factor * t) / s, decay);
}

/** Days until retrievability drops to `retention`. */
export function nextInterval(s, retention = 0.9, w = DEFAULT_W, maxInterval = S_MAX) {
  const { decay, factor } = curve(w);
  const days = (s / factor) * (Math.pow(retention, 1 / decay) - 1);
  return clamp(Math.round(days), 1, maxInterval);
}

const initStability = (g, w) => Math.max(w[g - 1], 0.1);
const initDifficulty = (g, w) => w[4] - Math.exp(w[5] * (g - 1)) + 1;

function nextDifficulty(d, g, w) {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  // Mean reversion toward the initial difficulty of an "Easy" card.
  return clamp(w[7] * initDifficulty(Rating.Easy, w) + (1 - w[7]) * damped, 1, 10);
}

function recallStability(d, s, r, g, w) {
  const hardPenalty = g === Rating.Hard ? w[15] : 1;
  const easyBonus = g === Rating.Easy ? w[16] : 1;
  return (
    s *
    (1 +
      Math.exp(w[8]) *
        (11 - d) *
        Math.pow(s, -w[9]) *
        (Math.exp((1 - r) * w[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function forgetStability(d, s, r, w) {
  const sf =
    w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(sf, s / Math.exp(w[17] * w[18]));
}

function shortTermStability(s, g, w) {
  let sinc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
  if (g >= Rating.Good) sinc = Math.max(sinc, 1);
  return s * sinc;
}

/** Whole calendar days (local time) between two timestamps. */
export function daysBetween(from, to) {
  const a = new Date(from).setHours(0, 0, 0, 0);
  const b = new Date(to).setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((b - a) / DAY));
}

function nextMemory(card, g, now, w) {
  if (card.state === State.New) {
    return { stability: initStability(g, w), difficulty: clamp(initDifficulty(g, w), 1, 10) };
  }
  const { stability: s, difficulty: d } = card;
  const elapsed = daysBetween(card.lastReview, now);
  let next;
  if (elapsed === 0) {
    next = shortTermStability(s, g, w);
  } else {
    const r = retrievability(elapsed, s, w);
    next = g === Rating.Again ? forgetStability(d, s, r, w) : recallStability(d, s, r, g, w);
  }
  return { stability: clamp(next, S_MIN, S_MAX), difficulty: nextDifficulty(d, g, w) };
}

/** Scheduling fields for a card that has never been reviewed. */
export function newSchedule(now = Date.now()) {
  return {
    state: State.New,
    stability: 0,
    difficulty: 0,
    due: now,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
}

/**
 * The outcome of each possible rating for `card` at time `now`.
 * Returns `{ 1: schedule, 2: schedule, 3: schedule, 4: schedule }`.
 */
export function preview(card, now = Date.now(), options = {}) {
  const { retention = 0.9, w = DEFAULT_W, maxInterval = S_MAX } = options;
  const memory = {};
  for (const g of [1, 2, 3, 4]) memory[g] = nextMemory(card, g, now, w);
  const interval = (g) => nextInterval(memory[g].stability, retention, w, maxInterval);

  const base = (g) => ({
    ...memory[g],
    reps: card.reps + 1,
    lapses: card.lapses,
    lastReview: now,
  });
  const step = (g, minutes, state) => ({
    ...base(g),
    state,
    due: now + minutes * MINUTE,
    scheduledDays: 0,
  });
  const graduate = (g, days) => ({
    ...base(g),
    state: State.Review,
    due: now + days * DAY,
    scheduledDays: days,
  });

  if (card.state === State.New) {
    return {
      1: step(1, STEPS.newAgain, State.Learning),
      2: step(2, STEPS.newHard, State.Learning),
      3: step(3, STEPS.newGood, State.Learning),
      4: graduate(4, interval(4)),
    };
  }

  if (card.state === State.Learning || card.state === State.Relearning) {
    const good = interval(3);
    return {
      1: step(1, STEPS.learnAgain, card.state),
      2: step(2, STEPS.learnHard, card.state),
      3: graduate(3, good),
      4: graduate(4, Math.max(interval(4), good + 1)),
    };
  }

  // Review: keep hard < good < easy so the buttons are always distinguishable.
  let good = interval(3);
  const hard = Math.min(interval(2), good);
  good = Math.max(good, hard + 1);
  const easy = Math.max(interval(4), good + 1);
  return {
    1: { ...step(1, STEPS.learnAgain, State.Relearning), lapses: card.lapses + 1 },
    2: graduate(2, hard),
    3: graduate(3, good),
    4: graduate(4, easy),
  };
}

/** New scheduling fields for `card` after it is answered with `rating`. */
export function schedule(card, rating, now = Date.now(), options = {}) {
  return preview(card, now, options)[rating];
}
