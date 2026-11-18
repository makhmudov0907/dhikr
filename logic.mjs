/**
 * Dhikr's local, mutable domain state. This module has no clock, storage, or DOM
 * side effects. Callers pass the local calendar-day key to every day operation.
 *
 * State: { version: 1, plan: null | { dhikrId, goal }, days: {
 *   [dateKey]: { dhikrId, goal, counts: { [dhikrId]: nonnegativeInteger } }
 * } }
 * Each day keeps its own active-plan snapshot. Changing a plan changes only the
 * addressed day and the plan used to initialize future days. Counts are never
 * removed when the active dhikr changes, even when a count is zero.
 */

export const DHIKR_IDS = Object.freeze([
  'astaghfirullah',
  'subhanallah',
  'alhamdulillah',
  'allahuakbar',
]);

const supportedDhikrs = new Set(DHIKR_IDS);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null);
const hasExactly = (value, keys) => isPlainObject(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => own(value, key));
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isGoal = (value) => Number.isSafeInteger(value) && value > 0;
const isPlan = (value) => hasExactly(value, ['dhikrId', 'goal'])
  && supportedDhikrs.has(value.dhikrId)
  && isGoal(value.goal);

/** Parse a real Gregorian calendar date without involving local time or DST. */
function dateFromKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new TypeError('A date key must use YYYY-MM-DD.');
  }
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 0–99.
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new RangeError('The date key must name a real calendar date.');
  }
  return date;
}

function formatKey(year, month, day) {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError('Date keys require a four-digit year.');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function assertRecord(record) {
  if (!hasExactly(record, ['dhikrId', 'goal', 'counts'])
    || !supportedDhikrs.has(record.dhikrId)
    || !isGoal(record.goal)
    || !isPlainObject(record.counts)
    || !own(record.counts, record.dhikrId)
    || !Object.entries(record.counts).every(([id, count]) => (
      supportedDhikrs.has(id) && isCount(count)
    ))) {
    throw new TypeError('Invalid day record.');
  }
}

function assertStateContainer(state) {
  if (!hasExactly(state, ['version', 'plan', 'days'])
    || state.version !== 1
    || (state.plan !== null && !isPlan(state.plan))
    || !isPlainObject(state.days)
    || (state.plan === null && Object.keys(state.days).length !== 0)) {
    throw new TypeError('Invalid version 1 state.');
  }
}

function assertStoredState(state) {
  assertStateContainer(state);
  for (const [key, record] of Object.entries(state.days)) {
    dateFromKey(key);
    assertRecord(record);
  }
}

function readRecord(state, key) {
  if (!own(state.days, key)) return null;
  const record = state.days[key];
  assertRecord(record);
  return record;
}

function newRecord(plan) {
  return {
    dhikrId: plan.dhikrId,
    goal: plan.goal,
    counts: { [plan.dhikrId]: 0 },
  };
}

/** Return an empty state. No daily quota or religious preference is assumed. */
export function createState() {
  return { version: 1, plan: null, days: {} };
}

/** Use the supplied Date's LOCAL calendar date, never its UTC ISO date. */
export function localDateKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('localDateKey requires a valid Date.');
  }
  return formatKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Return the previous calendar day; subtracting 24 hours would be DST-unsafe. */
export function previousDateKey(key) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() - 1);
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Return the existing day, or add and return a zero-count plan snapshot.
 * Return null without creating a day when no plan has been chosen.
 */
export function ensureDay(state, key) {
  assertStateContainer(state);
  dateFromKey(key);
  const existing = readRecord(state, key);
  if (existing) return existing;
  if (state.plan === null) return null;
  const record = newRecord(state.plan);
  state.days[key] = record;
  return record;
}

/** Mutate the addressed day's plan and the current plan; return the same state. */
export function setPlan(state, plan, key) {
  assertStateContainer(state);
  dateFromKey(key);
  if (!isPlan(plan)) {
    throw new TypeError('Choose a supported dhikr and a positive safe-integer goal.');
  }
  const record = readRecord(state, key) ?? newRecord(plan);
  record.dhikrId = plan.dhikrId;
  record.goal = plan.goal;
  if (!own(record.counts, plan.dhikrId)) record.counts[plan.dhikrId] = 0;
  state.plan = { dhikrId: plan.dhikrId, goal: plan.goal };
  state.days[key] = record;
  return state;
}

/** Add one to the active dhikr, including beyond the goal; return the same state. */
export function increment(state, key) {
  const record = ensureDay(state, key);
  if (!record) throw new Error('Choose a plan before counting.');
  if (record.counts[record.dhikrId] === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('The count has reached the largest safe integer.');
  }
  record.counts[record.dhikrId] += 1;
  return state;
}

/** Subtract one from only the active dhikr, stopping at zero; return the state. */
export function undo(state, key) {
  const record = ensureDay(state, key);
  if (!record) throw new Error('Choose a plan before counting.');
  record.counts[record.dhikrId] = Math.max(0, record.counts[record.dhikrId] - 1);
  return state;
}

/**
 * Read a detached view without changing state. An uncreated day uses the current
 * plan at count zero. progress is the raw count/goal ratio; visualProgress clamps
 * it to 1. Yesterday's completion makes the garden fully lush for all of today;
 * otherwise gardenProgress follows today's visualProgress. Older completed days
 * do not bridge a missing/incomplete yesterday. Completion is always derived
 * from that day's retained active-plan snapshot and count, never a sticky flag.
 */
export function getView(state, key) {
  assertStateContainer(state);
  dateFromKey(key);
  const record = readRecord(state, key)
    ?? (state.plan === null ? null : newRecord(state.plan));
  const yesterday = readRecord(state, previousDateKey(key));
  const count = record ? record.counts[record.dhikrId] : 0;
  const progress = record ? count / record.goal : 0;
  const visualProgress = Math.min(1, progress);
  const yesterdayCompleted = yesterday !== null
    && yesterday.counts[yesterday.dhikrId] >= yesterday.goal;
  return {
    dateKey: key,
    hasPlan: record !== null,
    dhikrId: record?.dhikrId ?? null,
    goal: record?.goal ?? null,
    count,
    counts: record ? { ...record.counts } : {},
    progress,
    visualProgress,
    completed: record !== null && count >= record.goal,
    yesterdayCompleted,
    gardenProgress: yesterdayCompleted ? 1 : visualProgress,
  };
}

/**
 * Parse and strictly validate storage. Return null for missing/malformed or
 * unsupported data. Never coerce, repair, discard history, or invent progress.
 * The caller can report a recovery problem instead of silently overwriting it.
 */
export function parseStoredState(serialized) {
  if (typeof serialized !== 'string') return null;
  try {
    const state = JSON.parse(serialized);
    assertStoredState(state);
    return state;
  } catch {
    return null;
  }
}

/** Validate all records, then return JSON. Invalid state throws without repair. */
export function serializeState(state) {
  assertStoredState(state);
  return JSON.stringify(state);
}
