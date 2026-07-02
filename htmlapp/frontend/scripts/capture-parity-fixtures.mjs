// Drives the running docker API (http://localhost:8137) and writes golden
// parity fixtures to src/engine/__fixtures__/parity/. Run manually with the
// docker stack up:  docker compose up -d  &&  node scripts/capture-parity-fixtures.mjs
// Each port task ADDS a capture block here; committing the JSON is the contract.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '..', 'src', 'engine', '__fixtures__', 'parity')
mkdirSync(OUT, { recursive: true })
const BASE = process.env.AICA_API || 'http://localhost:8137'

export function write(name, obj) {
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(obj, null, 2) + '\n')
  console.log(`wrote ${name}.json`)
}
export async function api(path, init) {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

// ── Captures (each port task appends here) ──────────────────────────────────

// binning: mirror the canonical inputs/outputs asserted in test_binning.py.
// If no HTTP surface exists, hand-transcribe {input, output} pairs from that
// test into binning.json (the test file is the reference).
//
// binning.py's build_feature_groups/bin_context are internal service
// functions with no dedicated debug HTTP endpoint, so binning.json was
// hand-derived directly from app/api/tests/test_binning.py's asserted
// thresholds/bands rather than captured from a running docker endpoint.

// declarative_rule / weighted_score: adapter.py, declarative_rule.py, and
// weighted_score.py are pure internal functions with no dedicated debug HTTP
// endpoint (they are invoked by the tick engine mid-run, not exposed as a
// standalone route). declarative_rule.json and weighted_score.json were
// derived by importing the actual Python modules from app/api's project
// venv (`./.venv/bin/python`) and calling `evaluate(...)` directly on inputs
// transcribed from app/api/tests/test_declarative_rule.py and
// test_weighted_score.py (R1-R5 result types for declarative_rule; fire /
// no-fire / boundary-strength / high-monotony / suppressed-candidate cases
// for weighted_score), capturing `result.model_dump_json()` as the golden
// output. This is more reliable than hand-computing the float arithmetic
// and exact `.3f`-formatted explanation strings by hand.

// driver_model / vehicle_model / recovery (Task S3.2): advance_driver_state,
// apply_rest_recovery, advance_vehicle_state, current_stage, start_recovery,
// and advance_recovery are pure internal functions with no dedicated debug
// HTTP endpoint (behavior engine + pure state machine, invoked by the tick
// engine and run_manager mid-run). driver_model.json, vehicle_model.json,
// and recovery.json were derived by importing the actual Python modules from
// app/api's project venv (`./.venv/bin/python`) and calling
// advance_driver_state / apply_rest_recovery / advance_vehicle_state /
// start_recovery / advance_recovery directly on inputs transcribed from
// app/api/tests/test_driver_model.py, test_vehicle_model.py, test_recovery.py,
// and the nap_karaoke/postpone RecoveryOption fixtures in
// app/api/tests/test_recovery.py + scenarios/uc01_fatigue_recovery_v0_1.json,
// capturing dataclasses.asdict(...) (driver_model/vehicle_model dataclasses)
// or .model_dump() (recovery's pydantic RecoveryState/RecoveryOption/RestSpot)
// as the golden output. recovery.json's staged-timing cases walk the full
// nap(2 ticks)->content(1 tick)->resuming->done sequence from
// test_stopped_stages_count_down_then_resume, plus a postpone-option
// (empty stages) case and the resuming->{active:false,phase:null} transition
// that gates the REST_RECOVERY re-arm in algorithm.py (M7).

// event_plan / run_plan / tick_sequence (Task S3.3): freeze_event_plan,
// build_event_plan, create_draft, and advance_tick are pure internal
// services with no dedicated debug HTTP endpoint (the tick loop and draft
// registry are invoked mid-run / mid-setup by run_manager and the
// /api/run-plans router, not exposed as raw pass-through routes). All three
// fixtures were derived by importing the actual Python modules from app/api's
// project venv (`./.venv/bin/python`) and calling them directly on the
// bundled uc01_fatigue_recovery_v0_1 scenario JSON shipped at
// src/data/scenarios/uc01_fatigue_recovery_v0_1.json (the SAME JSON the
// offline app ships, so fixture input == app input):
//   - event_plan.json:    freeze_event_plan(scenario) — no seed param exists
//     in Python; the fixture's input.seed=0 is a harness-compatibility no-op
//     (freezeEventPlan(scenario, seed) ignores it — see event_plan.ts docstring).
//   - tick_sequence.json: route_facts = analyze_route(scenario); event_plan =
//     build_event_plan(route_facts, scenario, {}); then prior=None, and for
//     i in range(...): state = advance_tick(prior, i, event_plan, route_facts,
//     scenario); record state; prior = state — until state.completed is True
//     (108 ticks to completion for this scenario, tick 107 inclusive).
//   - run_plan.json: create_draft(plan_id="fixture-plan-1",
//     package=nri_fatigue_score_v1, scenario=uc01_fatigue_recovery_v0_1,
//     presets={}, parameters={}, hyperparameters={}) with route_facts=None
//     (Python derives it locally via analyze_route(scenario)); the fixture's
//     output is {draft, package, scenario} (draft.model_dump(mode="json") +
//     the same package/scenario dumps used as input), NOT the bare RunPlanDraft
//     create_draft actually returns — this shape was chosen so createDraft's
//     TS port can conveniently echo back its (possibly profile-overridden)
//     effective package/scenario alongside the draft, mirroring what
//     get_draft_entry's registry tuple carries.
// Each dump used model.model_dump(mode="json"); the generating script (not
// committed) lived at gen_fixtures.py during authoring — see
// task-S3.3-report.md for the exact snippet if it needs to be regenerated.

// route_analysis (Task S7.2, local path): analyze_route(scenario) is a pure
// internal service with no dedicated debug HTTP endpoint (POST
// /api/routes/analyze wraps it together with the Maps path and notice
// computation, which is out of scope for this fixture). route_analysis.json
// was derived by importing the actual Python modules from app/api's project
// venv (`./.venv/bin/python`) and calling analyze_route(...) directly on the
// bundled uc01_fatigue_recovery_v0_1 scenario JSON shipped at
// src/data/scenarios/uc01_fatigue_recovery_v0_1.json (the SAME JSON the
// offline app ships, so fixture input == app input):
//   scenario = ScenarioDef.model_validate(json.load(open(scenario_path)))
//   result = analyze_route(scenario)
//   fixture = {
//     "input": {"scenario": <raw bundled JSON dict, unmodified — NOT the
//                round-tripped pydantic dump, so fixture input is byte-for-byte
//                what analyzeRoute(scenario) in the TS test actually receives>},
//     "output": json.loads(result.model_dump_json()),
//   }
// The generating script (not committed) lived at gen_route_analysis_fixture.py
// during authoring — see task-S7.2-report.md for the exact snippet if it
// needs to be regenerated. analyze_route_maps (the Maps path) is NOT captured
// here — it is faithfully ported in route_analysis.ts but deferred to task
// S7.3's fixture/parity test, since it needs raw Directions/Places payload
// shapes that S7.3 owns.

console.log('capture complete')
