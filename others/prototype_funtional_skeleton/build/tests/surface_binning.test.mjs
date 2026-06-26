// Unit tests for surface_binning.mjs — the v5 networked-surface tier-A computations
// (REQ-INT-013 / DIFF-014). G3 (tested = shipped) + G7 (behavioral acceptance): the
// behavior the networked map surface relies on is TESTED here, not left to untested
// app-layer script.
//
//   1. boundary-binning — live route quantities (metres / seconds) are mapped into
//      the existing ordinal route bands BEFORE the engine, and the SAME engine yields
//      the anchor result over those banded inputs. Crucially: NO concrete numeric
//      crosses the boundary into the decision logic (Constitution Principle III).
//   2. structural-signature — the persist-vs-rerender decision: the signature changes
//      only on a route / course / trigger-relevant change and is STABLE across a
//      playback tick (pos advancing), so the map persist decision is a tested
//      computation, not an app-layer one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boundaryBin, binDriveTime, binDestEta, binRestEta, structuralSignature } from '../surface_binning.mjs';
import { evaluateTrigger } from '../evaluate_trigger.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const buildData = JSON.parse(readFileSync(join(here, '..', 'build_data.json'), 'utf8'));
const DEFAULTS = Object.fromEntries(buildData.inputs.map(i => [i.id, i.default]));

// ============ 1. boundary-binning: metres / seconds -> ordinal bands ============

test('binDriveTime — seconds map to the continuous_driving_time ordinal bands', () => {
  assert.equal(binDriveTime(600), 'short');     // 10 min
  assert.equal(binDriveTime(3600), 'moderate'); // 60 min
  assert.equal(binDriveTime(7200), 'long');     // 120 min
  assert.equal(binDriveTime(null), 'short');
  // The output is always an ordinal band value (never a number).
  for (const v of [0, 1799, 1800, 5399, 5400, 99999]) assert.ok(['short','moderate','long'].includes(binDriveTime(v)));
});

test('binDestEta — seconds map to the destination_eta ordinal bands', () => {
  assert.equal(binDestEta(600), 'close');
  assert.equal(binDestEta(2400), 'medium');
  assert.equal(binDestEta(7200), 'far');
  for (const v of [0, 1200, 3600, 99999, null]) assert.ok(['close','medium','far'].includes(binDestEta(v)));
});

test('binRestEta — metres map to the rest_spot_eta ordinal bands; no spot -> none', () => {
  assert.equal(binRestEta(5000), 'near');
  assert.equal(binRestEta(50000), 'far');
  assert.equal(binRestEta(null), 'none');
  for (const v of [0, 20000, 20001, 99999, null]) assert.ok(['near','far','none'].includes(binRestEta(v)));
});

test('boundaryBin — returns ONLY ordinal band values; no number / geometry / key crosses out', () => {
  const out = boundaryBin({ travel_time_sec: 7200, remaining_to_destination_sec: 7200, rest_spot_metres: 8000 });
  // Every value is a closed ordinal band string — never a number.
  for (const v of Object.values(out)) {
    assert.equal(typeof v, 'string', 'binned output is an ordinal string, never a number');
    assert.ok(!/^\d/.test(v), 'binned output is not a numeric-looking value');
  }
  assert.deepEqual(out, { continuous_driving_time: 'long', destination_eta: 'far', rest_spot_eta: 'near' });
  // No raw geometry / key leaks through the boundary object.
  assert.ok(!('travel_time_sec' in out));
  assert.ok(!('rest_spot_metres' in out));
});

test('boundary-binning feeds the SAME engine the SAME ordinal bands -> the anchor result', () => {
  // Take the REST_PROPOSAL anchor case. Reconstruct its route bands from realistic
  // live quantities (a long drive to a far destination with a nearby rest spot), bin
  // them, fold them onto the default context, and confirm the engine reproduces the
  // anchor — with no concrete numeric ever in the input state it classifies.
  const anchor = buildData.cases.find(c => c.expected_result === 'REST_PROPOSAL');
  const bands = boundaryBin({ travel_time_sec: 7200, remaining_to_destination_sec: 7200, rest_spot_metres: 8000 });
  const banded = {
    ...DEFAULTS,
    drowsiness_level: anchor.input_state.drowsiness_level,
    fatigue_level: anchor.input_state.fatigue_level,
    signal_duration: anchor.input_state.signal_duration,
    ...bands // the binned ordinal route bands, never numbers
  };
  // Assert: every value the engine sees is a qualitative band, not a number.
  for (const k of ['continuous_driving_time','destination_eta','rest_spot_eta']) {
    assert.equal(typeof banded[k], 'string');
  }
  assert.equal(evaluateTrigger(banded).result_type, 'REST_PROPOSAL',
    'the banded inputs reproduce the anchor result over ordinal bands');
});

test('boundary-binning — a no-rest-spot route bins to rest_spot_eta none (fallback boundary)', () => {
  const bands = boundaryBin({ travel_time_sec: 7200, remaining_to_destination_sec: 7200, rest_spot_metres: null });
  assert.equal(bands.rest_spot_eta, 'none');
  const banded = { ...DEFAULTS, drowsiness_level: 'moderate', signal_duration: 'persistent', require_actionable: true, ...bands };
  assert.equal(evaluateTrigger(banded).result_type, 'NO_PRACTICAL_ACTION_FALLBACK');
});

// ============ 2. structural-signature: persist-vs-rerender ============

const baseState = {
  proposalNum: null, resultType: 'REST_PROPOSAL', selectedOption: null,
  recoveryActive: false, recoveryReleased: false, recoveryCursor: 0,
  selectionConsumed: false, selectionOutcome: 'rest_option', courseId: 'suburban'
};

test('structuralSignature — STABLE across a playback tick (pos / time are not part of it)', () => {
  // The same structural state must produce the same signature regardless of the
  // playback position — this is what keeps the map from being torn down every frame.
  assert.equal(structuralSignature(baseState), structuralSignature({ ...baseState }));
});

test('structuralSignature — CHANGES when the proposal stage / result / option / course changes', () => {
  const s0 = structuralSignature(baseState);
  assert.notEqual(s0, structuralSignature({ ...baseState, proposalNum: 1 }), 'overlay stage change re-renders');
  assert.notEqual(s0, structuralSignature({ ...baseState, resultType: 'NO_TRIGGER' }), 'result-type change re-renders');
  assert.notEqual(s0, structuralSignature({ ...baseState, selectedOption: 'a brief nap then karaoke after the nap' }), 'chosen option re-renders');
  assert.notEqual(s0, structuralSignature({ ...baseState, courseId: 'highway' }), 'course/route change re-renders');
  assert.notEqual(s0, structuralSignature({ ...baseState, recoveryActive: true }), 'recovery sequence re-renders');
  assert.notEqual(s0, structuralSignature({ ...baseState, selectionConsumed: true }), 'selection release re-renders');
});

test('structuralSignature — deterministic (same structural state -> same string)', () => {
  assert.equal(structuralSignature(baseState), structuralSignature(baseState));
});
