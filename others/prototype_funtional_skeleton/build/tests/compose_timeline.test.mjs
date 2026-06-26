// Unit tests for composeTimeline + the v4 motion / regeneration helpers (carried
// forward byte-identical to v4 into v5; the v5 networked-surface swap is
// render/template-side and does not change this tier-A logic).
//
// Carries forward the v3 branch-arc + selection sub-branch tests (regression
// anchors: default params reproduce the prior outcomes) and the four v4 criteria as
// PURE unit tests on the modules:
//   (a) the drive/stop indicator reflects each beat's motion_state — motionStateFor
//       returns the payload-declared motion for every beat;
//   (b) every USER_SELECTION beat is motion_state STOPPED (held);
//   (c) the UC-01 rest-spot motion order is S005 MOVING ① · S006 STOPPED held ·
//       S007/S008 MOVING resume/en-route · S009 STOPPED arrive ③ · S010A STOPPED
//       held · S011 MOVING depart — no overshoot (no STOPPED after S011);
//   (d) explore-mode regeneration — a parameter change that flips the trigger
//       result yields a DIFFERENT regenerated timeline (branch + beats).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composeTimeline, motionStateFor, regenerateTimeline, beatLayout, restStopIdsFor } from '../compose_timeline.mjs';
import { evaluateTrigger } from '../evaluate_trigger.mjs';
import { firePosition } from '../firePosition.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const buildData = JSON.parse(readFileSync(join(here, '..', 'build_data.json'), 'utf8'));
const cat = buildData.beat_catalog;
const motionKeys = buildData.motion_state_keys;
const flow = buildData.flow_skeletons;
const fragments = buildData.fragment_library;

const DEFAULTS = Object.fromEntries(buildData.inputs.map(i => [i.id, i.default]));
function withCtx(ctx) { return { ...DEFAULTS, ...ctx }; }

// Helper: drop alternate sibling variants (shared numeric stem, later letter).
function realized(list) {
  const seen = new Set();
  const out = [];
  for (const id of list) {
    const m = /^(.*?)([A-Z])$/.exec(id);
    if (m) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
    }
    out.push(id);
  }
  return out;
}

const byBranch = Object.fromEntries(buildData.cases.map(c => [c.branch, c]));
// Every authored beat across all cases, keyed by id (for the regenerator).
const allBeatById = Object.fromEntries(
  buildData.cases.flatMap(c => c.timeline || []).map(b => [b.status_id, b])
);

// ============ v3 regression anchors — branch arc + selection sub-branch ============

test('no_fire branch ends on the no_fire terminal within the pre arc', () => {
  const c = byBranch['no_fire'];
  const arc = composeTimeline(c, cat);
  const terminal = cat.no_fire[cat.no_fire.length - 1];
  assert.equal(arc[arc.length - 1], terminal);
  const idx = cat.pre.indexOf(terminal);
  assert.deepEqual(arc, cat.pre.slice(0, idx + 1));
});

test('fallback branch ends on the fallback terminal (acknowledgement beat)', () => {
  const c = byBranch['fallback'];
  const arc = composeTimeline(c, cat);
  const terminal = cat.fallback[cat.fallback.length - 1];
  assert.equal(arc[arc.length - 1], terminal);
});

test('fire / rest-option outcome — pre + proposal/selection + rest-option path, ending at return-to-drive', () => {
  const c = byBranch['fire'];
  const arc = composeTimeline(c, cat, 'rest_option');
  const lead = realized(cat.fire.slice(0, cat.fire.indexOf(cat.selection_beat) + 1));
  const tail = realized(cat.selection_sub_branches.rest_option);
  assert.deepEqual(arc, cat.pre.concat(lead, tail));
  assert.equal(arc[arc.length - 1], cat.selection_sub_branches.rest_option[cat.selection_sub_branches.rest_option.length - 1]);
  assert.ok(!arc.includes(cat.postpone_beat), 'rest-option arc does not include the postpone beat');
});

test('fire / postpone outcome — pre + proposal/selection + the postpone terminal UC-01-S006A only', () => {
  const c = byBranch['fire'];
  const arc = composeTimeline(c, cat, 'postpone');
  const lead = realized(cat.fire.slice(0, cat.fire.indexOf(cat.selection_beat) + 1));
  assert.deepEqual(arc, cat.pre.concat(lead, [cat.postpone_beat]));
  assert.equal(arc[arc.length - 1], cat.postpone_beat);
  for (const id of cat.selection_sub_branches.rest_option) {
    assert.ok(!arc.includes(id), `postpone arc excludes rest-option beat ${id}`);
  }
});

test('fire / default outcome (no pick) — keeps the rest-option path', () => {
  const c = byBranch['fire'];
  assert.deepEqual(composeTimeline(c, cat), composeTimeline(c, cat, 'rest_option'));
});

test('no hardcoded beat ids — empty catalog yields empty/derived arc', () => {
  const arc = composeTimeline({ branch: 'fire' }, { pre: [], no_fire: [], fire: [], fallback: [] });
  assert.deepEqual(arc, []);
});

test('determinism — same case + outcome yields the same arc', () => {
  const c = byBranch['fire'];
  assert.deepEqual(composeTimeline(c, cat, 'postpone'), composeTimeline(c, cat, 'postpone'));
});

// ============ v4 (a) motion_state threaded for every beat ============

test('(a) motionStateFor returns the payload-declared motion for every authored beat', () => {
  const held = new Set(motionKeys.held_for_selection_stop || []);
  const arrival = new Set(motionKeys.uc01_arrival_stop || []);
  for (const id of Object.keys(allBeatById)) {
    const ms = motionStateFor(id, motionKeys);
    if (held.has(id) || arrival.has(id)) assert.equal(ms, 'STOPPED', `${id} stopped`);
    else assert.equal(ms, motionKeys.default_motion || 'MOVING', `${id} moving`);
    // The authored per-beat motion_state agrees with the module's reading.
    assert.equal(allBeatById[id].motion_state, ms, `authored motion matches module for ${id}`);
  }
});

// ============ v4 (b) every USER_SELECTION beat is STOPPED ============

test('(b) every USER_SELECTION beat is motion_state STOPPED (held)', () => {
  let seen = 0;
  for (const c of buildData.cases) {
    for (const b of (c.timeline || [])) {
      if (b.category === 'USER_SELECTION') {
        seen++;
        assert.equal(b.motion_state, 'STOPPED', `${b.status_id} held STOPPED`);
        assert.equal(motionStateFor(b.status_id, motionKeys), 'STOPPED');
      }
    }
  }
  assert.ok(seen > 0, 'at least one USER_SELECTION beat present');
});

// ============ v4 (c) UC-01 rest-spot motion order, no overshoot ============

test('(c) UC-01 rest-spot motion order: S005 MOVING ① · S006 STOPPED · S007/S008 MOVING · S009 STOPPED ③ · S010A STOPPED · S011 MOVING (depart), no overshoot', () => {
  const order = {
    'UC-01-S005': 'MOVING', 'UC-01-S006': 'STOPPED',
    'UC-01-S007': 'MOVING', 'UC-01-S008': 'MOVING',
    'UC-01-S009': 'STOPPED', 'UC-01-S010A': 'STOPPED', 'UC-01-S011': 'MOVING'
  };
  for (const [id, want] of Object.entries(order)) {
    assert.equal(motionStateFor(id, motionKeys), want, `${id} -> ${want}`);
  }
  const arc = composeTimeline(byBranch['fire'], cat, 'rest_option');
  const depart = arc[arc.length - 1];
  assert.equal(motionStateFor(depart, motionKeys), 'MOVING', 'departs (resumes) at the end');
  const afterArrival = arc.slice(arc.indexOf('UC-01-S009'));
  assert.equal(motionStateFor(afterArrival[afterArrival.length - 1], motionKeys), 'MOVING');
  // The postpone outcome never stops (no waypoint, no rest-spot stop).
  const postponeArc = composeTimeline(byBranch['fire'], cat, 'postpone');
  for (const id of postponeArc) {
    if (id === cat.selection_beat) continue; // the selection hold itself is STOPPED
    assert.notEqual(motionStateFor(id, motionKeys), 'STOPPED', `postpone arc has no rest-spot stop at ${id}`);
  }
});

// ============ v4 (d) explore-mode whole-timeline regeneration ============

function regenFor(inputState, outcome) {
  return regenerateTimeline({
    result: evaluateTrigger(inputState),
    flowSkeletons: flow,
    beatById: allBeatById,
    motionKeys,
    fragments,
    selectionOutcome: outcome
  });
}

test('(d) regeneration — flipping the trigger result yields a different regenerated timeline (branch + beats)', () => {
  const noTrig = regenFor(byBranch['no_fire'].input_state, 'rest_option');
  const restProp = regenFor(buildData.cases.find(c => c.expected_result === 'REST_PROPOSAL').input_state, 'rest_option');
  assert.equal(noTrig.result_type, 'NO_TRIGGER');
  assert.equal(restProp.result_type, 'REST_PROPOSAL');
  assert.notEqual(noTrig.branch, restProp.branch, 'branch changes when the result flips');
  assert.notDeepEqual(noTrig.beats.map(b => b.id), restProp.beats.map(b => b.id),
    'included beats change when the result flips');
  assert.ok(restProp.beats.length > noTrig.beats.length, 'firing timeline is longer than the silent one');
});

test('(d) regeneration — each regenerated beat carries content + motion_state', () => {
  const r = regenFor(byBranch['fire'].input_state, 'rest_option');
  for (const b of r.beats) {
    assert.ok(b.id, 'beat id present');
    assert.ok(b.motion_state === 'MOVING' || b.motion_state === 'STOPPED', 'motion_state present');
    assert.ok(typeof b.title === 'string' && b.title.length > 0, 'title present');
  }
  const sel = r.beats.find(b => b.category === 'USER_SELECTION');
  assert.ok(sel && sel.motion_state === 'STOPPED', 'selection beat STOPPED in regenerated timeline');
});

test('(d) regeneration — postpone outcome regenerates a shorter no-stop arc than rest-option', () => {
  const rest = regenFor(byBranch['fire'].input_state, 'rest_option');
  const postpone = regenFor(byBranch['fire'].input_state, 'postpone');
  assert.notDeepEqual(rest.beats.map(b => b.id), postpone.beats.map(b => b.id));
  assert.ok(postpone.beats.some(b => b.id === cat.postpone_beat), 'postpone arc includes the postpone terminal');
  const arrivalStops = new Set(motionKeys.uc01_arrival_stop || []);
  assert.ok(!postpone.beats.some(b => arrivalStops.has(b.id)), 'postpone arc has no rest-spot arrival stop');
});

test('(d) regeneration determinism — same inputs give the same regenerated timeline', () => {
  const a = regenFor(byBranch['fire'].input_state, 'rest_option');
  const b = regenFor(byBranch['fire'].input_state, 'rest_option');
  assert.deepEqual(a, b);
});

// ============ regression anchor — preset cases reproduce their branch arcs ============

test('every case branch composes to a non-empty arc (regression anchor)', () => {
  for (const c of buildData.cases) {
    const arc = composeTimeline(c, cat);
    assert.ok(Array.isArray(arc) && arc.length > 0, `case ${c.id}`);
  }
});

test('regression anchor — default preset results match the embedded expected_result', () => {
  for (const c of buildData.cases) {
    assert.equal(evaluateTrigger(c.input_state).result_type, c.expected_result, c.id);
  }
});

// ============ REQ-INT-010 behavioral regression — the car's ROUTE POSITION through
// the recovery, now a pure module (beatLayout), unit-tested directly. ============

function uc01RestLayout() {
  const c = buildData.cases.find(x => x.expected_result === 'REST_PROPOSAL');
  const course = buildData.courses.find(x => x.id === c.course);
  const restAt = course.segments.find(s => s.is_rest_facility).at;
  const bb = Object.fromEntries((c.timeline || []).map(b => [b.status_id, b]));
  const r = regenerateTimeline({ result: evaluateTrigger(c.input_state), flowSkeletons: flow, beatById: bb, motionKeys, fragments, selectionOutcome: 'rest_option' });
  const arc = r.beats.map(b => b.id);
  const fp1 = firePosition(1, { result_type: 'REST_PROPOSAL' }, course);
  const lay = beatLayout({ arc, motionKeys, preLen: (cat.pre || []).length, fp1, restAt, restLayout: true });
  return { arc, restAt, lay, stopIds: new Set(restStopIdsFor(arc, motionKeys)) };
}

test('beatLayout — every STOPPED arrival/recovery beat is held AT the rest spot (no overshoot)', () => {
  const { restAt, lay, stopIds } = uc01RestLayout();
  assert.ok(stopIds.size >= 1, 'UC-01 fire arc has arrival/recovery stop beats');
  for (const b of lay) {
    if (stopIds.has(b.id)) {
      assert.equal(b.pos, restAt, `${b.id} is co-located AT the rest-spot fraction`);
    }
  }
  for (const b of lay) {
    if (stopIds.has(b.id)) assert.ok(b.pos <= restAt + 1e-9, `${b.id} not past the rest spot`);
  }
});

test('beatLayout — depart beats follow AFTER the rest spot; approach beats lead up to it', () => {
  const { restAt, lay, stopIds } = uc01RestLayout();
  let lastStop = -1;
  lay.forEach((b, i) => { if (stopIds.has(b.id)) lastStop = i; });
  const firstStop = lay.findIndex(b => stopIds.has(b.id));
  for (let i = (cat.pre || []).length; i < firstStop; i++) assert.ok(lay[i].pos < restAt + 1e-9, `${lay[i].id} approaches the rest spot`);
  for (let i = lastStop + 1; i < lay.length; i++) assert.ok(lay[i].pos > restAt, `${lay[i].id} departs after the rest spot`);
});

test('beatLayout — a non-rest arc keeps the even spread (other use cases unaffected)', () => {
  const arc = ['A', 'B', 'C', 'D'];
  const lay = beatLayout({ arc, motionKeys: {}, preLen: 1, fp1: 0.4, restAt: null, restLayout: false });
  assert.equal(lay[0].pos, 0, 'pre beat at 0');
  assert.ok(Math.abs(lay[1].pos - 0.4) < 1e-9, 'first branch beat at fp1');
  assert.ok(lay[3].pos > lay[2].pos && lay[2].pos > lay[1].pos, 'branch beats strictly increasing across [fp1,1]');
  assert.deepEqual(restStopIdsFor(arc, {}), [], 'no rest-stop beats without uc01_arrival_stop');
});

// REQ-INT-011 §1A pt3 regression — the STYLE hyperparameters must change the
// regenerated per-beat content (G7 parameter-liveness for the content half).
test('regeneration content — style hyperparameters change per-beat content', () => {
  const c = buildData.cases.find(x => x.expected_result === 'REST_PROPOSAL');
  const bb = Object.fromEntries((c.timeline || []).map(b => [b.status_id, b]));
  const info = (params) => regenerateTimeline({
    result: evaluateTrigger(c.input_state), flowSkeletons: flow, beatById: bb,
    motionKeys, fragments, selectionOutcome: 'rest_option', params
  }).beats.map(b => b.information).join('|');
  const base = { ...c.input_state };
  assert.notEqual(info({ ...base, assertiveness: 'gentle' }), info({ ...base, assertiveness: 'firm' }),
    'assertiveness changes the proposal/selection tone');
  assert.notEqual(info({ ...base, content_safety_strictness: 'lenient' }), info({ ...base, content_safety_strictness: 'strict' }),
    'content_safety_strictness changes the recovery/content note');
  assert.notEqual(info({ ...base, personalization_eagerness: 'low' }), info({ ...base, personalization_eagerness: 'high' }),
    'personalization_eagerness changes the proposal personalization note');
});
