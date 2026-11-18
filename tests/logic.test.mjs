import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, localDateKey, previousDateKey, ensureDay, setPlan,
  increment, undo, getView, parseStoredState, serializeState,
} from '../logic.mjs';

const DAY = '2026-11-17';
const NEXT = '2026-11-18';
const plan = (dhikrId = 'astaghfirullah', goal = 3) => ({ dhikrId, goal });
const withPlan = (goal = 3, key = DAY) => setPlan(createState(), plan('astaghfirullah', goal), key);
const countTimes = (state, count, key = DAY) => {
  for (let i = 0; i < count; i += 1) increment(state, key);
};

test('initial state has no assumed plan and reading it creates no progress', () => {
  const state = createState();
  assert.deepEqual(state, { version: 1, plan: null, days: {} });
  assert.equal(ensureDay(state, DAY), null);
  assert.deepEqual(getView(state, DAY), {
    dateKey: DAY, hasPlan: false, dhikrId: null, goal: null, count: 0,
    counts: {}, progress: 0, visualProgress: 0, completed: false,
    yesterdayCompleted: false, gardenProgress: 0,
  });
  assert.throws(() => increment(state, DAY), /Choose a plan/);
  assert.throws(() => undo(state, DAY), /Choose a plan/);
  assert.deepEqual(state.days, {});
});

test('date helpers use local days and calendar arithmetic across month/year/DST boundaries', () => {
  assert.equal(localDateKey(new Date(2026, 10, 17, 23, 59, 59)), DAY);
  assert.equal(previousDateKey('2024-03-01'), '2024-02-29');
  assert.equal(previousDateKey('2025-03-01'), '2025-02-28');
  assert.equal(previousDateKey('2026-01-01'), '2025-12-31');
  assert.equal(previousDateKey('2026-03-09'), '2026-03-08');
  assert.equal(previousDateKey('2026-11-02'), '2026-11-01');
  assert.equal(previousDateKey('0099-01-01'), '0098-12-31');
  assert.throws(() => localDateKey(new Date('invalid')), TypeError);
  assert.throws(() => previousDateKey('2026-02-29'), RangeError);
  assert.throws(() => previousDateKey('2026-2-01'), TypeError);
});

test('plans accept only supported dhikrs and positive safe-integer goals without partial edits', () => {
  const state = createState();
  for (const goal of [0, -1, 1.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => setPlan(state, plan('astaghfirullah', goal), DAY), TypeError);
  }
  assert.throws(() => setPlan(state, plan('unknown', 3), DAY), TypeError);
  assert.throws(() => setPlan(state, plan(), '2026-02-30'), RangeError);
  assert.deepEqual(state, createState());
  assert.equal(setPlan(state, plan('subhanallah', Number.MAX_SAFE_INTEGER), DAY), state);
  assert.equal(state.days[DAY].goal, Number.MAX_SAFE_INTEGER);
});

test('counting can exceed a goal while visual progress clamps and undo stops at zero', () => {
  const state = withPlan(2);
  countTimes(state, 3);
  assert.equal(getView(state, DAY).count, 3);
  assert.equal(getView(state, DAY).progress, 1.5);
  assert.equal(getView(state, DAY).visualProgress, 1);
  assert.equal(getView(state, DAY).gardenProgress, 1);
  assert.equal(getView(state, DAY).completed, true);
  assert.equal(undo(state, DAY), state);
  undo(state, DAY);
  assert.equal(getView(state, DAY).completed, false);
  undo(state, DAY);
  undo(state, DAY);
  assert.equal(getView(state, DAY).count, 0);
  state.days[DAY].counts.astaghfirullah = Number.MAX_SAFE_INTEGER;
  assert.throws(() => increment(state, DAY), RangeError);
  assert.equal(state.days[DAY].counts.astaghfirullah, Number.MAX_SAFE_INTEGER);
});

test('switching dhikrs preserves every count, restores old counts, and undoes only the active one', () => {
  const state = withPlan(3);
  countTimes(state, 2);
  setPlan(state, plan('subhanallah', 1), DAY);
  assert.equal(getView(state, DAY).count, 0);
  assert.equal(getView(state, DAY).completed, false);
  increment(state, DAY);
  assert.equal(getView(state, DAY).completed, true);
  setPlan(state, plan('astaghfirullah', 3), DAY);
  assert.equal(getView(state, DAY).count, 2);
  assert.equal(getView(state, DAY).completed, false);
  undo(state, DAY);
  assert.deepEqual(state.days[DAY].counts, { astaghfirullah: 1, subhanallah: 1 });
});

test('editing a goal recalculates completion while preserving counts and earlier day snapshots', () => {
  const state = withPlan(2);
  countTimes(state, 2);
  const yesterday = structuredClone(state.days[DAY]);
  ensureDay(state, NEXT);
  countTimes(state, 2, NEXT);
  setPlan(state, plan('astaghfirullah', 4), NEXT);
  assert.equal(getView(state, NEXT).count, 2);
  assert.equal(getView(state, NEXT).progress, 0.5);
  assert.equal(getView(state, NEXT).completed, false);
  setPlan(state, plan('astaghfirullah', 1), NEXT);
  assert.equal(getView(state, NEXT).completed, true);
  setPlan(state, plan('alhamdulillah', 7), NEXT);
  assert.equal(getView(state, NEXT).completed, false);
  assert.deepEqual(state.days[DAY], yesterday);
  assert.equal(state.days[NEXT].counts.astaghfirullah, 2);
});

test('rollover starts fresh counts with a separate plan snapshot and preserves history', () => {
  const state = withPlan(5);
  countTimes(state, 2);
  setPlan(state, plan('subhanallah', 4), DAY);
  increment(state, DAY);
  const yesterday = structuredClone(state.days[DAY]);
  const record = ensureDay(state, NEXT);
  assert.equal(ensureDay(state, NEXT), record);
  assert.deepEqual(record, { dhikrId: 'subhanallah', goal: 4, counts: { subhanallah: 0 } });
  increment(state, NEXT);
  assert.equal(getView(state, NEXT).count, 1);
  assert.deepEqual(state.days[DAY], yesterday);
});

test('a completed yesterday keeps the entire next day lush even at zero and after plan edits', () => {
  const state = withPlan(1);
  increment(state, DAY);
  const beforeRead = serializeState(state);
  assert.equal(getView(state, NEXT).count, 0);
  assert.equal(getView(state, NEXT).completed, false);
  assert.equal(getView(state, NEXT).yesterdayCompleted, true);
  assert.equal(getView(state, NEXT).gardenProgress, 1);
  assert.equal(serializeState(state), beforeRead, 'getView must not create a record');
  setPlan(state, plan('allahuakbar', 8), NEXT);
  increment(state, NEXT);
  undo(state, NEXT);
  assert.equal(getView(state, NEXT).gardenProgress, 1);
});

test('an incomplete yesterday makes the garden follow today rather than yesterday’s progress', () => {
  const state = withPlan(4);
  countTimes(state, 3);
  assert.equal(getView(state, NEXT).gardenProgress, 0);
  increment(state, NEXT);
  assert.equal(getView(state, NEXT).progress, 0.25);
  assert.equal(getView(state, NEXT).gardenProgress, 0.25);
  assert.equal(getView(state, NEXT).yesterdayCompleted, false);
});

test('reopening after missed days is dry with fresh counts and never deletes old completed history', () => {
  const state = withPlan(1);
  increment(state, DAY);
  const historical = structuredClone(state.days[DAY]);
  const reopened = '2026-11-23';
  assert.equal(getView(state, reopened).gardenProgress, 0);
  assert.equal(getView(state, reopened).count, 0);
  ensureDay(state, reopened);
  assert.deepEqual(Object.keys(state.days), [DAY, reopened]);
  assert.deepEqual(state.days[DAY], historical);
  assert.equal(state.days[reopened].counts.astaghfirullah, 0);
  increment(state, reopened);
  assert.equal(getView(state, reopened).gardenProgress, 1);
});

test('storage round-trips snapshots and counts, and views cannot mutate stored counts', () => {
  const state = withPlan(2);
  increment(state, DAY);
  setPlan(state, plan('alhamdulillah', 5), DAY);
  countTimes(state, 2);
  ensureDay(state, NEXT);
  const restored = parseStoredState(serializeState(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(parseStoredState(serializeState(createState())), createState());
  getView(restored, DAY).counts.alhamdulillah = 99;
  assert.equal(restored.days[DAY].counts.alhamdulillah, 2);
  increment(restored, NEXT);
  assert.equal(state.days[NEXT].counts.alhamdulillah, 0);
});

test('malformed storage is rejected whole instead of coercing values or repairing progress', () => {
  const valid = withPlan(3);
  const invalid = [null, '', '{', 'null', '[]', '{}'];
  const variant = (edit) => {
    const state = structuredClone(valid);
    edit(state);
    return JSON.stringify(state);
  };
  invalid.push(
    variant((s) => { s.version = 2; }),
    variant((s) => { s.plan.goal = '3'; }),
    variant((s) => { s.plan.goal = 0; }),
    variant((s) => { s.plan = null; }),
    variant((s) => { s.days = []; }),
    variant((s) => { s.days['2026-02-30'] = s.days[DAY]; }),
    variant((s) => { s.days[DAY].goal = -1; }),
    variant((s) => { s.days[DAY].goal = 2.5; }),
    variant((s) => { s.days[DAY].dhikrId = 'unknown'; }),
    variant((s) => { s.days[DAY].counts = {}; }),
    variant((s) => { s.days[DAY].counts.unknown = 1; }),
    variant((s) => { s.days[DAY].counts.astaghfirullah = -1; }),
    variant((s) => { s.days[DAY].counts.astaghfirullah = '2'; }),
    variant((s) => { s.days[DAY].counts.astaghfirullah = 0.5; }),
    variant((s) => { s.days[DAY].counts.astaghfirullah = Number.MAX_SAFE_INTEGER + 1; }),
    variant((s) => { s.days[DAY].completed = true; }),
  );
  for (const serialized of invalid) {
    assert.equal(parseStoredState(serialized), null, `Should reject: ${serialized}`);
  }
  const invalidState = structuredClone(valid);
  invalidState.days[DAY].counts.astaghfirullah = NaN;
  assert.throws(() => serializeState(invalidState), TypeError);
});
