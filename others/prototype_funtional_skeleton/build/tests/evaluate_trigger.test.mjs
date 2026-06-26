// Unit tests for evaluateTrigger — the §5 first-match rule list (R1..R5).
// Covers every preset vector (cases A–E), the severe override (R1), the
// rest-proposal conjunction (R3) and each broken conjunct, the fallback boundary
// (R2 vs. R3 on actionability), the soft-warning catch (R4), and NO_TRIGGER (R5).
// The trigger model is byte-identical to v4 (the v5 diff is the networked-surface
// swap, render/template-side; the boundary-binning feeds this SAME engine the SAME
// ordinal bands), so this suite carries forward unchanged (regression anchor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateTrigger } from '../evaluate_trigger.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const buildData = JSON.parse(readFileSync(join(here, '..', 'build_data.json'), 'utf8'));

// Default hyperparameter vector from the catalog defaults.
const DEFAULTS = Object.fromEntries(buildData.inputs.map(i => [i.id, i.default]));
function withCtx(ctx) {
  return { ...DEFAULTS, ...ctx };
}

// --- Preset vectors A–E (from the BUILD-DATA cases) reproduce their results ---
test('preset cases A–E classify to their expected result type', () => {
  for (const c of buildData.cases) {
    const out = evaluateTrigger(c.input_state);
    assert.equal(out.result_type, c.expected_result, `case ${c.id} -> ${c.expected_result}`);
    assert.match(out.rule_id, /^R[1-5]$/);
    assert.ok(Array.isArray(out.reason_inputs) && out.reason_inputs.length > 0);
  }
});

// --- R1 severe override: drowsiness severe always wins ---
test('R1 — drowsiness severe overrides everything', () => {
  const out = evaluateTrigger(withCtx({ drowsiness_level: 'severe' }));
  assert.equal(out.result_type, 'SEVERE_INTERVENTION');
  assert.equal(out.rule_id, 'R1');
  assert.deepEqual(out.reason_inputs, ['drowsiness_level']);
});

test('R1 — strong+high+sustained band reaches the severe cut-point when severe_threshold is low/medium', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'strong', fatigue_level: 'high', signal_duration: 'sustained',
    continuous_driving_time: 'long', severe_threshold: 'medium'
  }));
  assert.equal(out.result_type, 'SEVERE_INTERVENTION');
  assert.equal(out.rule_id, 'R1');
});

test('R1 — same band stays out of severe at default severe_threshold high (falls to R3)', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'strong', fatigue_level: 'high', signal_duration: 'sustained',
    continuous_driving_time: 'long', severe_threshold: 'high', rest_spot_eta: 'near'
  }));
  assert.equal(out.result_type, 'REST_PROPOSAL');
  assert.equal(out.rule_id, 'R3');
});

// --- R3 rest-proposal conjunction and each broken conjunct ---
test('R3 — full proposing conjunction with reachable rest', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'sustained',
    continuous_driving_time: 'long', rest_spot_eta: 'near'
  }));
  assert.equal(out.result_type, 'REST_PROPOSAL');
  assert.equal(out.rule_id, 'R3');
});

test('R3 broken — drowsiness below moderate does not reach the proposal band', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'weak', signal_duration: 'sustained',
    continuous_driving_time: 'long', rest_spot_eta: 'near'
  }));
  assert.notEqual(out.result_type, 'REST_PROPOSAL');
});

test('R3 broken — non-sustained signal does not reach the proposal band', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'brief',
    continuous_driving_time: 'long', rest_spot_eta: 'near'
  }));
  assert.notEqual(out.result_type, 'REST_PROPOSAL');
});

test('R3 broken — short driving time does not reach the proposal band', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'sustained',
    continuous_driving_time: 'short', rest_spot_eta: 'near'
  }));
  assert.notEqual(out.result_type, 'REST_PROPOSAL');
});

// --- R2 vs. R3 fallback boundary on actionability ---
test('R2 — proposing long-drive band with no reachable rest spot -> fallback', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'persistent',
    continuous_driving_time: 'long', rest_spot_eta: 'none', require_actionable: true
  }));
  assert.equal(out.result_type, 'NO_PRACTICAL_ACTION_FALLBACK');
  assert.equal(out.rule_id, 'R2');
});

test('R2 boundary — far rest spot with low rest_spot_sensitivity -> fallback', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'persistent',
    continuous_driving_time: 'long', rest_spot_eta: 'far',
    rest_spot_sensitivity: 'low', require_actionable: true
  }));
  assert.equal(out.result_type, 'NO_PRACTICAL_ACTION_FALLBACK');
});

test('R2/R3 boundary — same band with require_actionable false stays REST_PROPOSAL', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'persistent',
    continuous_driving_time: 'long', rest_spot_eta: 'none', require_actionable: false
  }));
  assert.equal(out.result_type, 'REST_PROPOSAL');
  assert.equal(out.rule_id, 'R3');
});

// --- R4 soft-warning catch ---
test('R4 — reaction reached but below the proposal band -> SOFT_WARNING', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'moderate', signal_duration: 'sustained',
    continuous_driving_time: 'short', trigger_sensitivity: 'medium'
  }));
  assert.equal(out.result_type, 'SOFT_WARNING');
  assert.equal(out.rule_id, 'R4');
});

// --- R5 catch-all ---
test('R5 — weak/brief/short stays below the reaction point -> NO_TRIGGER', () => {
  const out = evaluateTrigger(withCtx({
    drowsiness_level: 'weak', signal_duration: 'brief', continuous_driving_time: 'short'
  }));
  assert.equal(out.result_type, 'NO_TRIGGER');
  assert.equal(out.rule_id, 'R5');
});

// --- Totality & determinism ---
test('totality — exactly one of the five result types for every preset', () => {
  const ALLOWED = new Set([
    'NO_TRIGGER', 'SOFT_WARNING', 'REST_PROPOSAL', 'SEVERE_INTERVENTION', 'NO_PRACTICAL_ACTION_FALLBACK'
  ]);
  for (const c of buildData.cases) {
    const out = evaluateTrigger(c.input_state);
    assert.ok(ALLOWED.has(out.result_type));
  }
});

test('determinism — the same input yields the same result', () => {
  const v = withCtx({ drowsiness_level: 'moderate', signal_duration: 'sustained', continuous_driving_time: 'long' });
  assert.deepEqual(evaluateTrigger(v), evaluateTrigger(v));
});
// Parametric liveness (G7) — the algorithm hyperparameters MUST move the result;
// a declared-but-inert dial (the prior proposal_threshold) is the defect this guards.
test('parametric liveness (G7) — proposal_threshold and severe_threshold move the result', () => {
  // proposal_threshold gates proposing vs soft-warning for a mid-band state.
  const mid = withCtx({ drowsiness_level: 'moderate', signal_duration: 'sustained', continuous_driving_time: 'moderate' });
  assert.equal(evaluateTrigger({ ...mid, proposal_threshold: 'low' }).result_type, 'REST_PROPOSAL');
  assert.equal(evaluateTrigger({ ...mid, proposal_threshold: 'high' }).result_type, 'SOFT_WARNING');
  // severe_threshold gates severe vs proposing for a strong state.
  const strong = withCtx({ drowsiness_level: 'strong', fatigue_level: 'high', signal_duration: 'sustained', continuous_driving_time: 'long' });
  assert.equal(evaluateTrigger({ ...strong, severe_threshold: 'medium' }).result_type, 'SEVERE_INTERVENTION');
  assert.equal(evaluateTrigger({ ...strong, severe_threshold: 'high' }).result_type, 'REST_PROPOSAL');
});
