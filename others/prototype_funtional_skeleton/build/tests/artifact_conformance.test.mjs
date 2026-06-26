// Artifact-conformance tests (v5) — derived from the v5 acceptance criteria
// (acceptance_criteria.md AC-01 … AC-10) and the interface acceptance criteria.
// These load the RENDERED index.html (not the modules) and assert it realizes every
// region/surface the criteria name and carries the content the criteria require —
// including the v5 networked-surface behaviors (REQ-INT-013 / DIFF-014):
//   * the persistent embedded REAL Google map slot (the spike's reparented map-div);
//   * the map-control bar (Load-map, Find-route, start/end selection);
//   * the runtime BYO-key gate (map inert until a key is present; NO key value
//     shipped / shown / defaulted / persisted);
//   * the on-map AICA proposal overlay over the visible map;
//   * map persistence via the structural-signature re-render (tested module bound);
//   * boundary-binning of the live route into ordinal bands before the engine —
// plus the carried v4..v1 assertions (selector hold, next-beat + click-seek, the
// drive/stop indicator, held-stopped, the rest-spot motion order, the explore-mode
// regeneration, inputs, why-fired, options, export, warning).
// They are red-first: against a missing region or dropped content they fail before
// the template / build-spec fix. Fix the template / BUILD-DATA / modules and
// re-render — never hand-edit the artifact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(here, '..', '..', 'index.html');
const buildData = JSON.parse(readFileSync(join(here, '..', 'build_data.json'), 'utf8'));

const html = existsSync(artifactPath) ? readFileSync(artifactPath, 'utf8') : '';
function need() {
  assert.ok(html.length > 0, `rendered artifact missing at ${artifactPath} — run render.mjs first`);
}

// AC-01 (v5) — networked surface waiver: the ONLY permitted external reference is
// the declared networked map / route / places surface; it is INERT until a runtime
// key is present, and NO key value is shipped, shown, defaulted, or persisted.
test('AC-01 — networked map surface declared; BYO-key gate present; no key value shipped', () => {
  need();
  // No external stylesheet links; no external image/script src OTHER THAN the
  // declared Google Maps surface and the optional relative key.local.js placeholder.
  assert.ok(!/<link\b[^>]*\brel=["']stylesheet["']/i.test(html), 'no external stylesheet link');
  const externalSrcs = [...html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1])
    .filter(u => /^https?:/i.test(u) || /^\/\//.test(u));
  for (const u of externalSrcs) {
    assert.ok(/maps\.googleapis\.com/i.test(u), `the only external src is the declared map surface, not ${u}`);
  }
  // The map script URL is assembled at runtime from the entered key (no committed URL with a key).
  assert.match(html, /maps\.googleapis\.com\/maps\/api\/js\?key=\$\{encodeURIComponent\(key\)\}/, 'map script key is the runtime-entered key');
  // BYO-key gate field present.
  assert.match(html, /id="gkey"/, 'BYO-key field present');
  assert.match(html, /inert until/i, 'inert-until-key gate documented');
  // No key value is shipped / defaulted: the gkey field has no value attribute, and
  // no real-looking Google key (AIza...) appears anywhere.
  assert.ok(!/id="gkey"[^>]*\bvalue=/.test(html), 'BYO-key field carries no default value');
  assert.ok(!/AIza[0-9A-Za-z_\-]{10,}/.test(html), 'no Google Maps key value embedded');
  // The dev-key auto-load is gated on a git-ignored placeholder, never a committed key.
  assert.match(html, /window\.__DEV_MAPS_KEY/, 'dev key auto-load is gated on an external git-ignored placeholder');
});

// AC-02 / criterion 1 — case selector with every defined case, and it HOLDS.
test('AC-02 — case selector region present with all defined cases', () => {
  need();
  assert.match(html, /id="case-select"/, 'case selector present');
  for (const c of buildData.cases) {
    assert.ok(html.includes(c.label), `case option label present: ${c.label}`);
  }
});
test('AC-02 (REQ-INT-004) — selector holds (built once, not rebuilt on render)', () => {
  need();
  assert.match(html, /buildCaseSelectOnce/, 'one-time case-select builder present');
  assert.match(html, /dataset\.built/, 'selector-built guard present (no rebuild on render)');
  assert.match(html, /hold the chosen case/i, 'hold-the-selection logic present');
});

// AC-03 / criterion 2 — course progress + step controls + on-route markers +
// the single-action next-beat + click-a-beat-to-seek.
test('AC-03 — course progress region, step controls, on-route markers', () => {
  need();
  assert.match(html, /id="markers"/, 'on-route marker layer present');
  assert.match(html, /id="track"/, 'progress track present');
  assert.match(html, /id="car"/, 'advancing car present');
  assert.match(html, /id="play"/, 'play step control present');
  assert.match(html, /id="scrub"/, 'scrub step control present');
});
test('AC-03 (REQ-INT-001) — next-beat control + click-to-seek beats', () => {
  need();
  assert.match(html, /id="next-beat"/, 'single-action next-beat control present');
  assert.match(html, /stepNextBeat/, 'next-beat step handler present');
  assert.match(html, /seekToBeat/, 'click-a-beat-to-seek handler present');
  assert.match(html, /data-idx=/, 'beats carry a seek index');
  assert.match(html, /Click a beat to jump/i, 'click-to-seek affordance hint present');
});

// AC-03 (REQ-INT-012) — an always-legible drive-vs-stopped motion indicator on the
// animation surface, driven by the current beat's motion_state.
test('AC-03 (REQ-INT-012) — drive-vs-stopped motion indicator follows motion_state through every control', () => {
  need();
  assert.match(html, /id="motion-indicator"/, 'motion indicator element present');
  assert.match(html, /id="motion-label"/, 'motion indicator label present');
  assert.match(html, /renderMotionIndicator/, 'motion-indicator render hook present');
  assert.match(html, /currentMotionState/, 'current-beat motion-state reader present');
  assert.match(html, /motionStateFor/, 'per-beat motion-state module bound in the artifact');
  assert.match(html, /Driving/, 'driving state label present');
  assert.match(html, /Stopped/, 'stopped state label present');
  assert.match(html, /data-motion=/, 'each timeline beat carries its motion_state');
});

// AC-04 / criterion 3 — every input control: 9 context + 12 hyper + the two
// networked-surface controls, in their panels.
test('AC-04 — three parameter panels carry every input control incl. the networked-surface controls', () => {
  need();
  assert.match(html, /id="panel-context"/, 'context input panel present');
  assert.match(html, /id="panel-hyper"/, 'hyper input panel present');
  assert.match(html, /id="panel-networked_surface"/, 'networked-surface input panel present');
  for (const inp of buildData.inputs) {
    assert.ok(html.includes(inp.label), `input control label present: ${inp.label}`);
  }
  // The two networked-surface controls are present in the payload as a distinct group.
  const ns = buildData.inputs.filter(i => i.group === 'networked_surface').map(i => i.id);
  assert.deepEqual(ns.sort(), ['byo_maps_key', 'route_selection'], 'the two networked-surface controls present');
});

// AC-04/AC-05 (REQ-INT-011) — explore-mode whole-timeline regeneration binds the
// timeline + car + map to the recomputed data.
test('AC-05 (REQ-INT-011) — explore-mode whole-timeline regeneration binds timeline + car + map', () => {
  need();
  assert.match(html, /regenerateTimeline/, 'whole-timeline regenerator bound in the artifact');
  assert.match(html, /function regen\(\)/, 'regen() wiring present');
  assert.match(html, /flow_skeletons/, 'flow_skeletons consumed by the regeneration');
  assert.match(html, /const beats = regen\(\)\.beats/, 'timeline display binds to the regenerated timeline');
  assert.match(html, /const arc = \(\) => regen\(\)\.beats\.map/, 'arc derives from the regenerated timeline');
  assert.ok(html.includes('"flow_skeletons"'), 'flow_skeletons in payload');
  assert.ok(html.includes('"fragment_library"'), 'fragment_library in payload');
  assert.ok(html.includes('"motion_state_keys"'), 'motion_state_keys in payload');
});

// AC-05 (boundary-binning, REQ-INT-013) — the live route is boundary-binned into
// ordinal bands BEFORE the engine; the binners are the tested module, bound here.
test('AC-05 (REQ-INT-013) — boundary-binning of the live route feeds the tier-A engine in ordinal bands', () => {
  need();
  assert.match(html, /boundaryBin/, 'boundary-binning module bound in the artifact');
  assert.match(html, /function boundaryBin\(/, 'boundaryBin body inlined (tested-equals-shipped)');
  // The app layer feeds the binned bands (not raw numbers) onto the trigger inputs.
  assert.match(html, /live\.continuous_driving_time = bands\.continuous_driving_time/, 'binned driving-time band assigned, not a number');
  assert.match(html, /live\.rest_spot_eta = boundaryBin\(/, 'rest-spot reachability is binned before it touches the trigger input');
  // Each case carries a captured route snapshot (ordinal bands only, no geometry, no key).
  for (const c of buildData.cases) {
    assert.ok(c.route_snapshot && c.route_snapshot.route_bands, `case ${c.id} carries a route_snapshot of ordinal bands`);
    assert.equal(c.route_snapshot.stores_raw_geometry, undefined, 'snapshot carries no raw geometry field');
  }
  assert.ok(html.includes('"snapshot_for_review"'), 'snapshot-for-review block in payload');
  assert.ok(html.includes('"stores_raw_geometry": false'), 'snapshot stores no raw geometry');
  assert.ok(html.includes('"stores_key": false'), 'snapshot stores no key');
});

// AC-04/AC-05 — result recompute + marker reposition surface present.
test('AC-05 — result recompute + marker reposition surface present', () => {
  need();
  assert.match(html, /id="overlay"/, 'why-fired/result overlay present');
  assert.match(html, /firePosition/, 'on-route marker placement module present');
  for (const rt of Object.keys(buildData.result_meta)) {
    assert.ok(html.includes(buildData.result_meta[rt].label), `result label present: ${rt}`);
  }
});

// AC-08 (REQ-INT-009) — the car is held stopped at the selection beat.
test('AC-08 (REQ-INT-009) — held-stopped at the USER_SELECTION beat', () => {
  need();
  assert.match(html, /selectionStopClamp/, 'held-for-selection clamp present');
  assert.match(html, /selectionStopFraction/, 'selection-stop fraction resolver present');
  assert.match(html, /selectionConsumed/, 'selection-consumed release flag present');
  assert.match(html, /held_for_selection_stop/, 'held-for-selection key consumed');
  assert.match(html, /selectionConsumed = true;/, 'the choice drives the next beat (clamp releases)');
  const fireCase = buildData.cases.find(c => c.branch === 'fire');
  const sel = fireCase.timeline.find(b => b.category === 'USER_SELECTION');
  assert.equal(sel.motion_state, 'STOPPED', 'selection beat STOPPED in payload');
});

// AC-06 (REQ-INT-013) — persistent embedded REAL-map nav surface + map-control bar,
// AND the proposal + options render as an ON-MAP OVERLAY over the visible map; the
// map persists via the tested structural-signature re-render.
test('AC-06 (REQ-INT-013) — persistent embedded real map + control bar + on-map overlay + structural-signature persistence', () => {
  need();
  assert.match(html, /id="cockpit"/, 'cockpit region present');
  // The persistent embedded real-map slot (the reparented map-div pattern).
  assert.match(html, /mapSurfaceSVG/, 'map-surface renderer present');
  assert.match(html, /id="gmap-slot"/, 'persistent embedded real-map slot present');
  assert.match(html, /class="mapsurface"/, 'map-surface class present');
  assert.match(html, /reparent/i, 'reparented-map-div pattern documented');
  assert.match(html, /function syncGmap\(/, 'reparenting sync present');
  // The map-control bar: Load-map, Find-route, start/end selection.
  assert.match(html, /id="mapctl"/, 'map-control bar present');
  assert.match(html, /id="gload"/, 'Load-map control present');
  assert.match(html, /id="groute"/, 'Find-route control present');
  assert.match(html, /id="gstart"/, 'start-place selection present');
  assert.match(html, /id="gend"/, 'end-place selection present');
  // Find-route + rest-spot listing.
  assert.match(html, /function findRoute\(/, 'live route find present');
  assert.match(html, /function findRestSpots\(/, 'rest-spot listing present');
  // Each preset's named start/end come from that case's map_info.
  assert.match(html, /curCase\(\) && curCase\(\)\.map_info|c && c\.map_info/, 'preset route uses the case map_info');
  for (const c of buildData.cases) {
    assert.ok(c.map_info && c.map_info.start_place && c.map_info.end_place, `case ${c.id} carries named start/end places`);
    assert.ok(html.includes(c.map_info.end_place), `case end place shipped: ${c.map_info.end_place}`);
  }
  // The on-map overlay over the persistent map.
  assert.match(html, /navSurfaceBlock/, 'persistent map block renderer present');
  assert.match(html, /class="mapwrap"/, 'map wrapper (overlay anchor) present');
  assert.match(html, /class="mapoverlay"/, 'on-map overlay class present');
  assert.match(html, /map stays visible underneath|ON-MAP OVERLAY/i, 'overlay-over-persistent-map intent documented');
  // The map persists via the tested structural-signature re-render (not on a tick).
  assert.match(html, /structuralSignature/, 'structural-signature module bound in the artifact');
  assert.match(html, /function structuralSignature\(/, 'structuralSignature body inlined (tested-equals-shipped)');
  assert.match(html, /if \(sig === __cockSig && mapAttached\)\{ updateMapMarkers\(\); return; \}/, 'cockpit re-renders only on a structural-signature change (map persists across Play)');
  const fireCase = buildData.cases.find(c => c.branch === 'fire');
  const proposalBeat = fireCase.timeline.find(b => b.category === 'AICA_PROPOSAL');
  assert.ok(html.includes(proposalBeat.aica_message), 'AICA proposal message shipped');
  assert.ok(html.includes(buildData.result_meta.REST_PROPOSAL.action_preview), 'action preview shipped');
});

// AC-08 / criterion 7 — selectable recovery options + verdict capture (closed set).
test('AC-08 — selectable recovery options + verdict capture (closed set)', () => {
  need();
  const fireCase = buildData.cases.find(c => c.branch === 'fire');
  const selBeat = fireCase.timeline.find(b => b.category === 'USER_SELECTION');
  assert.ok(selBeat && Array.isArray(selBeat.user_options) && selBeat.user_options.length > 0,
    'fire case has recovery options in its USER_SELECTION beat');
  for (const opt of selBeat.user_options) {
    assert.ok(html.includes(opt), `recovery option shipped verbatim: ${opt}`);
  }
  for (const verdict of buildData.review.verdicts) {
    assert.ok(html.includes(verdict), `verdict in closed set shipped: ${verdict}`);
  }
  assert.match(html, /id="cap-verdict"/, 'verdict capture control present');
  assert.match(html, /id="cap-actual"/, 'actual-result capture control present');
});

// AC-08 (REQ-INT-007, UC-01) — animated recovery visuals while stopped.
test('AC-08 (REQ-INT-007) — animated dim/sleep + cue + chosen-content visuals (UC-01)', () => {
  need();
  if (buildData.meta.use_case !== 'UC-01') return; // UC-01-only recovery visuals
  assert.match(html, /renderRecoverySequence/, 'stopped recovery-sequence renderer present');
  assert.match(html, /class="dimlayer"/, 'dim/darkening sleep overlay element present');
  assert.match(html, /@keyframes dimsleep/, 'dim/darkening is genuinely animated (CSS keyframes)');
  assert.match(html, /class="sleepcue"/, 'sleep cue element present');
  assert.match(html, /@keyframes moonpulse/, 'pulsing-moon sleep cue animated');
  assert.match(html, /class="karaoke"/, 'animated chosen-content (karaoke) visual present');
  assert.match(html, /@keyframes eq/, 'karaoke bars genuinely animated');
  assert.match(html, /selectedOption/, 'chosen recovery content drives off the selected option');
});

// AC-08 (REQ-INT-005, UC-01) — the selection drives the flow.
test('AC-08 (REQ-INT-005) — selection drives rest-vs-postpone flow (UC-01)', () => {
  need();
  if (buildData.meta.use_case !== 'UC-01') return;
  assert.match(html, /selectionOutcomeKey/, 'selection-outcome resolver present');
  assert.match(html, /postpone/i, 'postpone branch present');
  assert.ok(html.includes('"postpone_beat": "UC-01-S006A"'), 'postpone terminal beat in payload');
  assert.ok(html.includes('"selection_sub_branches"'), 'selection sub-branches in payload');
  const postBeat = buildData.cases.flatMap(c => c.timeline || []).find(b => b.status_id === 'UC-01-S006A');
  assert.ok(postBeat && postBeat.aica_message, 'postpone beat authored with a message');
  assert.ok(html.includes(postBeat.aica_message), 'postpone (keep-driving) message shipped');
});

// AC-08 (REQ-INT-010, UC-01) — the rest-spot motion order, no overshoot.
test('AC-08 (REQ-INT-010) — UC-01 rest-spot motion order with no overshoot', () => {
  need();
  if (buildData.meta.use_case !== 'UC-01') return;
  const fireCase = buildData.cases.find(c => c.branch === 'fire');
  const byId = Object.fromEntries(fireCase.timeline.map(b => [b.status_id, b]));
  assert.equal(byId['UC-01-S008'].motion_state, 'MOVING', 'S008 en route is MOVING (no early arrival)');
  assert.equal(byId['UC-01-S009'].motion_state, 'STOPPED', 'S009 arrive-and-stop is STOPPED');
  assert.equal(byId['UC-01-S010A'].motion_state, 'STOPPED', 'S010A hold-through-recovery is STOPPED');
  assert.equal(byId['UC-01-S011'].motion_state, 'MOVING', 'S011 depart resumes MOVING');
  assert.match(html, /uc01RestClamp/, 'UC-01 rest-spot playback clamp present');
  assert.match(html, /recoveryReleased/, 'clamp-releases-after-recovery flag present');
  assert.ok(html.includes('"uc01_arrival_stop"'), 'rest-spot arrival stop set in payload');
  assert.match(html, /M\.beatLayout\(/, 'template delegates the position math to the tested module');
  assert.match(html, /stop\.forEach\(\(b\) => \{ b\.pos = restAt; \}\)/, 'inlined module co-locates stopped recovery beats at the rest-spot fraction');
});

// AC-08 (REQ-INT-008, UC-01) — non-stuck playback advance past the rest spot.
test('AC-08 (REQ-INT-008) — non-stuck playback advance past the rest spot (UC-01)', () => {
  need();
  if (buildData.meta.use_case !== 'UC-01') return;
  assert.match(html, /uc01RestClamp/, 'UC-01 rest-spot playback clamp present');
  assert.match(html, /REST_DWELL_SECONDS/, 'dwell-then-release advance present');
  assert.match(html, /recoveryCursor < rs\.length - 1/, 'clamp releases only after the last recovery beat');
});

test('animation pace — playback advance is halved (speed / 36)', () => {
  need();
  assert.match(html, /pos \+ dt \* speed \/ 36/, 'playback advance halved to speed / 36');
});

// AC-09 — export action present + review questions shipped; no key value exported.
test('AC-09 — export action + review questions present; BYO-key never exported', () => {
  need();
  assert.match(html, /id="export-btn"/, 'export control present');
  for (const q of buildData.review.questions) {
    assert.ok(html.includes(q), `review question shipped: ${q}`);
  }
  // input_values include the input ids but the export never includes a key VALUE.
  assert.match(html, /BYO-key VALUE is NEVER captured or exported/i, 'no-key-in-export rule documented');
});

// AC-10 — the byte-exact temporary-behavior warning always visible.
test('AC-10 — byte-exact temporary-behavior warning shipped', () => {
  need();
  const warn = buildData.meta.warning;
  assert.ok(html.includes(JSON.stringify(warn).slice(1, -1)) || html.includes(warn),
    'temporary-behavior warning present in artifact');
});

// UC-01-only marker rule: events ②③ present for UC-01.
test('uc-events — ②③ flagged uc01_only present when use case is UC-01', () => {
  need();
  const isUc01 = buildData.meta.use_case === 'UC-01';
  const hasRestEvents = buildData.meta.course_sim.uc_events.some(e => e.uc01_only);
  assert.ok(hasRestEvents, 'uc_events catalog defines ②③ with uc01_only flag');
  assert.match(html, /uc01_only/, 'uc01_only gating present in render logic');
  if (isUc01) {
    assert.ok(html.includes('Rest-spot imminent') || html.includes('②'), 'UC-01 ships ②③ events');
  }
});

// Module-inlined-equals-tested guarantee: module sources are substrings (G3).
test('tested-equals-shipped — module sources inlined in the artifact', () => {
  need();
  const trig = readFileSync(join(here, '..', 'evaluate_trigger.mjs'), 'utf8');
  const comp = readFileSync(join(here, '..', 'compose_timeline.mjs'), 'utf8');
  const fire = readFileSync(join(here, '..', 'firePosition.mjs'), 'utf8');
  const bin = readFileSync(join(here, '..', 'surface_binning.mjs'), 'utf8');
  const probe = (src) => src.split('\n').find(l => l.includes('function') && l.includes('('));
  assert.ok(html.includes(probe(trig).replace(/^export\s+/, '')), 'evaluateTrigger body inlined');
  assert.ok(html.includes(probe(comp).replace(/^export\s+/, '')), 'composeTimeline body inlined');
  assert.ok(html.includes(probe(fire).replace(/^export\s+/, '')), 'firePosition body inlined');
  assert.ok(html.includes(probe(bin).replace(/^export\s+/, '')), 'surface_binning body inlined');
});

// Exactly one BUILD-DATA region.
test('single BUILD-DATA region', () => {
  need();
  const starts = (html.match(/<!-- BUILD-DATA:START -->/g) || []).length;
  const ends = (html.match(/<!-- BUILD-DATA:END -->/g) || []).length;
  assert.equal(starts, 1);
  assert.equal(ends, 1);
});

// Data fidelity — the embedded payload carries the v5 identity (LOOP-005, v5).
test('data fidelity — embedded build-data is v5 (LOOP-005)', () => {
  need();
  assert.equal(buildData.meta.loop, 'LOOP-005');
  assert.equal(buildData.meta.prototype_version, 'v5');
  assert.ok(html.includes('"loop": "LOOP-005"'), 'embedded data names LOOP-005');
  assert.ok(html.includes('"prototype_version": "v5"'), 'embedded data names v5');
  // The v5 networked_surface block is present (the recorded scope change).
  assert.ok(html.includes('"networked_surface"'), 'networked_surface block embedded');
  assert.ok(html.includes('"target_kind": "real_google_map"'), 'real-map target declared');
  assert.ok(html.includes('"G5_self_containment": "waived_for_live_map"'), 'G5 waiver recorded for the live map surface');
  assert.ok(html.includes('"G3_tested_shipped": "holds"'), 'G3 still holds');
});
