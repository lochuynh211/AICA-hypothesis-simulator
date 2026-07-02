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

// run_log_e2e (Task S4.2, run_manager keystone port): create_run/tick/action
// (run_manager.py) + create_draft (run_plan.py) are pure internal services
// with no dedicated debug HTTP endpoint that returns the raw RunLog without
// a live server + disk round-trip, so run_log_e2e.json was derived by
// importing the actual Python modules from app/api's project venv
// (`./.venv/bin/python`) and driving them directly, end to end:
//   package = PackageManifest(**<reconstructed rest_rule_based_v0_1 dict>)
//     — this declarative_rule package used to exist at
//     packages/rest_rule_based_v0_1/package.json (deleted at commit
//     a612b56; reconstructed byte-for-byte from a612b56~1). It is used
//     instead of either package actually bundled into the htmlapp today
//     (nri_fatigue_score_v1, aica_transparent_hybrid_trigger_v1) because
//     BOTH of those are algorithm.type="python_module", which
//     src/engine/algorithms/adapter.ts does not support (only
//     declarative_rule/weighted_score are ported) — every TS tick() would
//     immediately raise AlgorithmAdapterError("unsupported_algorithm_type"),
//     never reach a REST_PROPOSAL, and never exercise accept_rest.
//   scenario = ScenarioDef(**json.load(open("scenarios/uc01_fatigue_recovery_v0_1.json")))
//     — the SAME JSON the offline app ships at
//     src/data/scenarios/uc01_fatigue_recovery_v0_1.json (byte-identical;
//     diffed during authoring). Its own _comment documents that
//     declarative_rule fires REST_PROPOSAL around tick 29 against this
//     exact profile/route/presets.
//   plan = create_draft(plan_id=..., package=package, scenario=scenario,
//                        presets={}, parameters={}, hyperparameters={})
//   create_run(plan_id, run_id, runs_dir=<tmp>)
//   loop: outcome = tick(run_id); on the first outcome.paused (always a
//     REST_PROPOSAL — SEVERE_INTERVENTION/NO_PRACTICAL_ACTION_FALLBACK never
//     set decision.proposal for this algorithm, so they never pause):
//       action(run_id, "accept_rest", recovery_option_id="nap_karaoke",
//              rest_spot=RestSpot(id="p1", label={"ja":"SA","en":"SA"},
//              route_fraction=0.5))
//     any SUBSEQUENT pause (none occurred in the captured run —
//     declined_count stayed 0): action(run_id, "decline")
//   until outcome.completed. Captured run needed exactly ONE accept_rest
//   action (114 events: 113 tick + 1 action; result_type counts included
//   REST_PROPOSAL x4 — 3 suppressed by the active-recovery fire-control
//   guard, so only the first ever paused the run — SEVERE_INTERVENTION x27
//   and NO_PRACTICAL_ACTION_FALLBACK x15, neither of which ever pauses since
//   declarative_rule sets proposal=null for both).
// fixture = {
//   "input": {"package": <the reconstructed dict, unmodified>,
//             "scenario": <raw bundled JSON dict, unmodified>,
//             "parameters": {}, "hyperparameters": {}, "presets": {},
//             "runMode": "standard", "recoveryOptionId": "nap_karaoke",
//             "restSpot": {"id": "p1", "label": {"ja": "SA", "en": "SA"},
//                          "route_fraction": 0.5}},
//   "output": get_active_run_log(run_id).model_dump(mode="json"),
// }
// The generating script (not committed) lived at capture_run_log_e2e.py
// during authoring — see task-S4.2-report.md for the exact source if it
// needs to be regenerated.

// feedback (Task S5.1): effective_schema/validate (feedback.py) are pure
// internal service functions with no dedicated debug HTTP endpoint that
// returns their raw output outside a live server + PackageRegistry/RunLog
// setup, so feedback.json was derived by importing the actual Python
// modules from app/api's project venv (`./.venv/bin/python`) and calling
// them directly:
//   manifest = json.load(open("app/api/tests/fixtures/pkg_with_extras/package.json"))
//     — the same fixture package test_feedback_schema.py's T004-2 tests use
//     (2 extras: "comfort" choice, "seat_quality" scale) — chosen over the
//     schema-only baseline package referenced by those tests
//     (packages/rest_rule_based_v0_1/package.json) because that path no
//     longer exists in this repo (pre-existing gap: the package was deleted
//     at some point after the M5 tests were written; run
//     `app/api/.venv/bin/python -m pytest tests/test_feedback_schema.py`
//     to see the 7 resulting FileNotFoundError failures — unrelated to this
//     port, out of scope to fix here). pkg_with_extras exercises BOTH the
//     V1-baseline-first ordering AND the extras-appended behavior in one
//     fixture, which the baseline-only package could not.
//   pkg = PackageManifest(**manifest); schema = effective_schema(pkg)  → 11 fields
//   run_log = RunLog(run_id=..., snapshot=Snapshot(package=ArtifactRef(id=pkg.id, ...), ...),
//                     route_facts=RouteFacts(), event_plan=EventPlan(), events=[])
//   valid_body   = {target: {scope: "run"}, labels: {proposal_timing: "appropriate",
//                   safety_impression: "safe", comfort: "smooth", seat_quality: 4},
//                   comment: "Felt natural"}
//   invalid_body = {target: {scope: "run"}, labels: {proposal_timing: "maybe" (bad option),
//                   seat_quality: 10 (exceeds max=5.0)}, comment: null}
//   valid_ev  = FeedbackEvent(kind="feedback", target=FeedbackTarget(**valid_body["target"]),
//               labels=valid_body["labels"], comment=valid_body["comment"])
//   invalid_ev = <same shape from invalid_body>
//   valid_errors   = validate(valid_ev, schema, run_log)    → []
//   invalid_errors = validate(invalid_ev, schema, run_log)  → 2 ValidationErrors
//     (labels.proposal_timing: bad option; labels.seat_quality: exceeds maximum)
// fixture = {
//   "input": {"manifest": manifest, "body": valid_body, "invalid_body": invalid_body},
//   "output": {"schema": [f.model_dump() for f in schema],
//              "valid": len(valid_errors) == 0,
//              "invalid_errors": [{"field": e.field, "message": e.message} for e in invalid_errors],
//              "event": valid_ev.model_dump()},
// }
// The generating script (not committed) was run as an inline `python -c`
// one-liner during authoring — see task-S5.1-report.md for the exact
// source if it needs to be regenerated.

// evidence_report / evidence_markdown (Task S8.1): build_evidence_report
// (evidence.py) and render_evidence_markdown (evidence_markdown.py) are pure
// internal services with no dedicated debug HTTP endpoint that returns their
// raw dict/string output outside a live server (the router endpoints
// @619/@656 generate report_id/timestamp and shape the HTTP response), so
// both fixtures were derived by importing the actual Python modules from
// app/api's project venv (`./.venv/bin/python`) and driving them directly,
// end to end — reusing the SAME reconstructed declarative_rule package
// (`rest_rule_based_v0_1`) + scenario (`uc01_fatigue_recovery_v0_1`) +
// accept_rest flow as run_log_e2e.json (Task S4.2; see that fixture's own
// capture-notes above for why: both packages actually bundled into the
// htmlapp are algorithm.type="python_module", unsupported by
// src/engine/algorithms/adapter.ts, so every tick would immediately raise
// AlgorithmAdapterError and never reach a REST_PROPOSAL/accept_rest):
//   package = PackageManifest(**<same reconstructed rest_rule_based_v0_1 dict
//     as run_log_e2e.json's input.package>)
//   scenario = ScenarioDef(**json.load(open("scenarios/uc01_fatigue_recovery_v0_1.json")))
//   create_draft(plan_id="plan_evidence_fixture", package=package, scenario=scenario,
//                presets={}, parameters={}, hyperparameters={}, run_mode="standard")
//   create_run("plan_evidence_fixture", "run_evidence_fixture", runs_dir=<tmp>)
//   loop: outcome = tick(run_id); on the first outcome.paused (REST_PROPOSAL):
//     action(run_id, "accept_rest", recovery_option_id="nap_karaoke",
//            rest_spot=RestSpot(id="p1", label={"ja":"SA","en":"SA"}, route_fraction=0.5))
//     until outcome.completed (same 4x REST_PROPOSAL / 1x accept_rest / 113-tick
//     shape as run_log_e2e.json — tick 29 fires the accepted proposal).
//   THEN, to exercise BOTH ## Human Review subsections (not just an empty
//   run), two FeedbackEvents were appended via run_manager.append_feedback:
//     decision_feedback = FeedbackEvent(kind="feedback",
//       target=FeedbackTarget(scope="decision", event_ref=29, tick_index=29),
//       labels={"proposal_timing": "appropriate", "safety_impression": "safe"},
//       comment="Felt like a natural moment to suggest a rest.")
//     run_feedback = FeedbackEvent(kind="feedback",
//       target=FeedbackTarget(scope="run"),
//       labels={"overall_judgment": "good_trigger"}, comment=None)
//   report = build_evidence_report(get_active_run_log(run_id),
//     report_id="report_fixture_20260701-000000_abcdef",
//     timestamp="2026-07-01T00:00:00+00:00", ui_language="en")
//     — captures ONE language (en); the parity test renders that same report
//     (uiLanguage is a pass-through label field, not branching logic — the
//     Python renderer never special-cases it beyond echoing the string).
//   markdown = render_evidence_markdown(report)
// fixture = {
//   "evidence_report.json": {
//     "input": {"package": <dict>, "scenario": <dict>, "parameters": {},
//               "hyperparameters": {}, "presets": {}, "runMode": "standard",
//               "recoveryOptionId": "nap_karaoke",
//               "restSpot": {"id": "p1", "label": {"ja": "SA", "en": "SA"},
//                            "lat": None, "lng": None, "route_fraction": 0.5},
//               "uiLanguage": "en",
//               "feedback": {"decision": decision_feedback.model_dump_json(),
//                            "run": run_feedback.model_dump_json(),
//                            "proposalTickIndex": 29, "proposalEventRef": 29}},
//     "output": report,   # the raw dict returned by build_evidence_report
//   },
//   "evidence_markdown.json": {"input": report, "output": markdown},
// }
// A guard in the capture script also asserts no Google Maps key material
// (the string "googleMapsApiKey"/"google_maps_api_key", or an "AIza..."-shaped
// token) appears anywhere in the report JSON or markdown — the master
// invariant that the evidence export never carries the Maps key, verified at
// fixture-generation time as well as by tests/evidence.test.ts.
// The generating script (not committed) lived at
// capture_evidence_fixtures.py during authoring — see task-S8.1-report.md
// for the exact source if it needs to be regenerated.

console.log('capture complete')
