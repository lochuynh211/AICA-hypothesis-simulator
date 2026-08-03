"""Regenerate all parity golden fixtures + the nri_tick_by_tick golden.

Run from repo root:
  PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_all.py

No docker required; uses the in-process ASGI app (TestClient) and direct
module imports from the project's Python source (app/api/aica_api/).

Fixtures written:
  src/engine/__fixtures__/parity/
    binning.json              — binning.build_feature_groups / bin_context / bin_drowsiness_level / bin_fatigue_level
    driver_signals.json       — behavior/driver_signals.advance_driver_state / apply_rest_recovery
    anomaly.json              — behavior/anomaly_signal.advance_anomaly
    prng.json                 — services/prng.seeded_uniform / _subseed
    event_plan.json           — services/event_plan.build_event_plan (+ freeze_event_plan)
    tick_sequence.json        — services/tick_engine.advance_tick (full run; 108 ticks)
    run_plan.json             — services/run_plan.create_draft
    run_log_e2e.json          — services/run_manager (full run, real nri_fatigue_score_v1 package)
    route_analysis.json       — services/route_analysis.analyze_route
    recovery.json             — services/recovery (start_recovery / advance_recovery)
    preview.json              — POST /api/runs/preview (TestClient)
    preview_min_ahead.json    — same endpoint, but with 2 extra named rest spots (maps route_facts
                                  override) positioned to discriminate the auto-accept step's
                                  two-stage MIN_AHEAD rest-spot pick (_pick_rest_spot) from an
                                  implementation that only has the "anything ahead" fallback
    rest_spots.json           — POST /api/run-plans + /api/runs + tick + GET /api/runs/{id}/rest-spots (TestClient)
    rest_spots_min_ahead.json — same endpoint, but with 2 extra named rest spots (maps route_facts
                                  override) positioned to discriminate the two-stage MIN_AHEAD
                                  selection (stage 1 vs. the "anything ahead" fallback) from an
                                  implementation that only has the fallback
    nri_fatigue_score_v1.json — packages/nri_fatigue_score_v1/algorithm.evaluate (direct import)
    aica_transparent_hybrid_trigger_v1.json — packages/aica_transparent_hybrid_trigger_v1/algorithm.evaluate (direct import)
    feedback.json             — services/feedback.effective_schema / validate
    evidence_report.json      — services/evidence.build_evidence_report (full nri run)
    evidence_markdown.json    — services/evidence_markdown.render_evidence_markdown
    evidence_markdown_nri.json — separate nri_fatigue_score_v1 run (all pauses declined),
                                  guards whole-number-float hyperparameter formatting
    nri_tick_by_tick.json     — POST /api/run-plans + runs + tick loop (TestClient), per-tick decision_result
    service_selector.json     — packages/aica_transparent_service_selector_v1/algorithm.evaluate
                                  (direct import, 11-case representative set; C1 Task 4)
    content_selector.json     — packages/aica_transparent_content_selector_v1/algorithm.evaluate
                                  (direct import, 21-case representative set; C1 Task 5, fix round 1)
    proposal_eligibility.json — services/proposal_eligibility.resolve_eligibility /
                                  derive_registered_entities (direct import; C2 Task 2)
    algorithm_config.json     — services/algorithm_config.merge_algorithm_config (direct import; C2 Task 2)
    world_validation.json     — services/world_validation.validate_world (direct import,
                                  real committed seed + dataset catalog; C2 Task 2)
    world_overrides.json      — services/world_clone_store.apply_overrides, success + raising
                                  cases (direct import, real committed seed + dataset catalog; C2 Task 2)
    proposal_selector_dispatch.json — services/proposal_selector.dispatch_selector, both
                                  families' success path (direct import, real committed packages; C2 Task 3)
    proposal_run_manager.json — services/proposal_run_manager's 8 public functions, one
                                  scripted scenario (direct import; C2 Task 4)
    explanation_builder.json  — services/explanation_builder's shared vocabulary + sentence
                                  machinery (label_for, feature_meaning, feature_family,
                                  situation_sentence, trigger_sentence, preference_sentence,
                                  history_sentences, score_evidence, category_readout, and
                                  the internal display/factor helpers; direct calls, one
                                  named case per branch; C3 Task 1)
    trigger_explanation.json — services/trigger_explanation's resolve_category/build_target/
                                  template + the display helpers (_num, _threshold_for,
                                  _ranked_rows, _fmt_num, _score_display, _signed_score_display,
                                  _unit_kind_for, _fmt_multiplier, _row_value_display,
                                  _row_phrase, _dead_band_reason_applies). Real fires are built
                                  from REAL nri_fatigue_score_v1 / aica_transparent_hybrid_trigger_v1
                                  algorithm.evaluate() calls (mirrors
                                  app/api/tests/proposal/test_trigger_explanation.py's own
                                  fixture-building technique) rather than hand-faked chain
                                  shapes; synthetic cases are hand-built ONLY in the recorded
                                  chain SHAPE, for edge/boundary branches a real run cannot
                                  reach on demand. C3 Task 2 (+ build_prompt added by C3 Task 4,
                                  deferred out of Task 2's own scope per the brief).
    service_explanation.json — services/service_explanation's build_prompt/template (C3 Task 3)
    content_explanation.json — services/content_explanation's build_prompt/template + the
                                  causal-bridge machinery (C3 Task 3)
    explanation_facade.json  — services/explanation_builder's FAÇADE half:
                                  build_explanation_prompt/template_rationale (step dispatch
                                  across trigger_explanation/service_explanation/
                                  content_explanation) and the pure LLM-response guards
                                  parse_bilingual/response_is_usable/strip_placeholder_artifacts.
                                  C3 Task 4.
    merged_adapter.json      — services/merged_adapter's map_trigger_purpose/
                                  map_lifecycle_stage/map_road_type (direct calls,
                                  exhaustive/representative cases) + build_world_from_tick
                                  over REAL (tick_state, decision) pairs from
                                  run_log_e2e.json's own committed tick events against a
                                  real committed World template. C4 Task 2.
    merged_painter.json      — services/merged_painter's inject_mountain_segment /
                                  jam_traffic_event (direct calls) over REAL route facts
                                  from route_analysis.json's own committed output. C4 Task 2.
    proposal_matrix.json     — models/proposal/matrix.py's PurposeStageServiceMatrix
                                  load()/resolve() (direct calls) over the REAL committed
                                  proposal_contracts/matrix/purpose_stage_matrix.v1.json,
                                  plus synthetic (labeled) tampered copies reaching each
                                  of the 3 model_validators' raise branches, mirroring
                                  test_matrix_resolver.py's own direct-construction
                                  technique. C4a Task 1.
    proposal_context_base.json — routers/proposal.py's `_resolve_run_setup`, called
                                  directly against the real `CreateProposalRunBody`/
                                  `World` types over a REAL committed seed
                                  (seed-night-highway-oshi). C4a Task 1. (`_now_iso`/
                                  `_make_opportunity_id` are format-tested only, like
                                  every other id/timestamp minter in this port — see
                                  that module's own doc comment for why no golden
                                  captures them.)
    proposal_create_run.json — routers/proposal.py's `create_proposal_run` +
                                  `_freeze_setup_snapshot` (direct calls, always
                                  `cache={}`, real committed seed-night-highway-oshi +
                                  the two real transparent packages; a few labeled
                                  synthetic mutations for branches the real data alone
                                  cannot reach). C4a Task 3.
    proposal_select_service.json — routers/proposal.py's `select_service` +
                                  `_dispatch_content_for_service` +
                                  `_apply_quick_check_content` (direct calls against a
                                  real, disk-persisted run — AICA_PROPOSAL_RUNS_DIR
                                  monkeypatched to a tempdir, mirroring
                                  test_step2_real_content.py's own fixture — for
                                  `select_service`'s own real-vs-mock content dispatch;
                                  a few hand-built run_logs, mirroring
                                  proposal_run_manager.json's own direct-construction
                                  technique, for branches the real matrix/eligibility
                                  data cannot reach through create_proposal_run's own
                                  call site). C4a Task 4.
    proposal_explain.json    — routers/proposal.py's `explain_from_run_log` +
                                  `_generate_explanation` + `_find_explain_target`,
                                  plus `explanation_builder.prompt_hash` (direct calls;
                                  real disk-persisted run over seed-night-highway-oshi
                                  for the success/unknown_target/no-content-yet cases,
                                  hand-built run_logs for the two evidence-absent/
                                  evidence-errored no_decision branches, and a
                                  dedicated set of prompt_hash byte-parity cases
                                  covering quote/backslash/control-char/Japanese/empty/
                                  multi-message escaping). provider="browser" only —
                                  offline's "off"/"backend" have no Python equivalent to
                                  capture parity against, see explain.ts's own module
                                  doc. C4a Task 7 (final porting task).
    merged_run_setup.json    — routers/merged_runs.py's SETUP endpoint bodies:
                                  create_merged_plan_endpoint (POST /api/merged-runs/plan),
                                  create_merged_run_endpoint (POST /api/merged-runs),
                                  get_merged_run_endpoint (GET /api/merged-runs/{id}),
                                  list_merged_runs_endpoint (GET /api/merged-runs) — direct
                                  function calls (real registries/packages, AICA_RUNS_DIR/
                                  AICA_MERGED_RUNS_DIR/AICA_PROPOSAL_RUNS_DIR monkeypatched
                                  to a tempdir), every validation-failure branch plus a
                                  synthetic incompatible-package/scenario pair (no real one
                                  exists in this repo) and a hand-tampered corrupt list
                                  entry. C4 Task 5.
    merged_tick.json          — routers/merged_runs.py's tick_merged_run_endpoint
                                  (934-1203), _serialize_trigger_tick (183-210), and
                                  _override_nap_stage_ticks (784-821) — direct function
                                  calls: isolated synthetic TickOutcome cases for
                                  _serialize_trigger_tick; isolated real-scenario calls
                                  for _override_nap_stage_ticks (incl. mutation-safety
                                  self-check); a full 44-tick real sequence
                                  (nri_fatigue_score_v1 x uc01_fatigue_recovery_v0_1,
                                  the REAL aica_transparent_service_selector_v1/
                                  aica_transparent_content_selector_v1 packages, NOT the
                                  TS-unported mocks) that naturally reaches 4 distinct
                                  proposal-run generations (create / category-escalation
                                  / re-arm / escalation-again), the before→during→after
                                  rest-journey auto-drive, and silent during-recovery
                                  passthrough ticks — ids frozen to deterministic
                                  first-encounter-order placeholders (prun_GEN_N) so
                                  cross-run/cross-language equality is checkable without
                                  ever comparing raw ids; plus the proposal_mode hard-422
                                  branch. C4 Task 6.
    merged_actions.json       — routers/merged_runs.py's accept_rest_endpoint
                                  (824-892), decline_rest_endpoint (892-934), and
                                  proposal_action_endpoint (1206-1327) — direct
                                  function calls, same package/scenario/seed
                                  combo as merged_tick.json (tick 12 monotony
                                  fire, tick 17 rest fire): accept-rest success
                                  with/without a nap_minutes override (the
                                  installed scenario's own overridden stage
                                  ticks read back directly), decline success,
                                  every 404/422 rejection path for all three
                                  endpoints, a real 5-step proposal-action
                                  sequence (reject/select_service+acknowledge/
                                  complete-rejected/accept/complete-success)
                                  through ONE monotony-fired run, plus two
                                  hand-built (disclosed synthetic) handles:
                                  correlation_log reverse-iteration finding the
                                  LAST matching entry, and an uncaught 404
                                  propagating with the handle left untouched.
    merged_explain.json       — routers/merged_runs.py's merged_explain_endpoint
                                  (553-600) and explain_trigger_endpoint
                                  (600-681) — direct function calls. Real
                                  service/content success (a real
                                  create_proposal_run + select_service run,
                                  frozen ids), malformed/unknown-step/
                                  unknown-provider/unknown-target 422s, the
                                  step="trigger" no_decision 422 (real,
                                  reachable — trigger never has run-log
                                  evidence), and explain_trigger_endpoint over
                                  real NRI-produced fires (rest + monotony
                                  categories): explicit category, category
                                  resolved from the fire's own recorded
                                  category, provider="template", and the
                                  unknown-category / malformed-fire 422s. C4
                                  Task 8. (The offline-only `'off'`/`'backend'`
                                  provider branches have no Python-comparable
                                  behavior to capture — see explain.ts's own
                                  module doc — and are unit-tested directly.)
    merged_review_feedback.json — routers/merged_runs.py's
                                  post_review_feedback_endpoint (1327-1366)
                                  and get_review_feedback_endpoint
                                  (1366-1415) — direct function calls. Two
                                  appended review judgements (append-only,
                                  same order preserved) read back via the GET
                                  endpoint with package_versions attached,
                                  plus the merged-run-not-found and
                                  trigger-run-not-found 404s. C4 Task 8.
                                  C4 Task 7.

Usage invariant: every output file is written atomically (write temp, then rename).
"""
from __future__ import annotations

import dataclasses
import json
import pathlib
import sys
import tempfile
import os

# ---------------------------------------------------------------------------
# Repo / output paths
# ---------------------------------------------------------------------------

_REPO = pathlib.Path(__file__).resolve().parents[4]  # repo root
_OUT = _REPO / "htmlapp" / "frontend" / "src" / "engine" / "__fixtures__" / "parity"
_OUT.mkdir(parents=True, exist_ok=True)

# The offline app reads its scenario from the generated data seam
# (htmlapp/frontend/data/, produced by `npm run build:data`). Point the capture
# rig at the SAME file — if these ever diverge, every golden silently encodes a
# scenario the app does not run.
_SCENARIO_PATH = _REPO / "htmlapp" / "frontend" / "data" / "scenarios" / "uc01_fatigue_recovery_v0_1.json"

if not _SCENARIO_PATH.exists():
    raise SystemExit(
        f"missing {_SCENARIO_PATH}\n"
        "Run `npm run build:data` in htmlapp/frontend first — the data tree is generated, not committed."
    )

# packages dir (for evaluate_preview)
_PACKAGES_DIR = _REPO / "packages"
_SCENARIOS_DIR = _REPO / "scenarios"


def _write(name: str, obj: object) -> None:
    """Write fixture atomically via a temp file."""
    dest = _OUT / f"{name}.json"
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(dest)
    print(f"  wrote {dest.name}")


def _load_json(path: pathlib.Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1. binning
# ---------------------------------------------------------------------------

def _capture_binning() -> None:
    from aica_api.services.binning import (
        bin_context,
        bin_drowsiness_level,
        bin_fatigue_level,
        build_feature_groups,
    )

    existing = _load_json(_OUT / "binning.json")
    inp = existing["input"]

    _write("binning", {
        "input": inp,
        "output": {
            "feature_groups": [build_feature_groups(c) for c in inp["feature_groups"]],
            "drowsiness_bands": [bin_drowsiness_level(v) for v in inp["drowsiness_levels"]],
            "fatigue_bands": [bin_fatigue_level(v) for v in inp["fatigue_levels"]],
            "bin_context": [bin_context(c) for c in inp["bin_context"]],
        },
    })


# ---------------------------------------------------------------------------
# 2. driver_signals — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_driver_signals() -> None:
    from aica_api.services.behavior.driver_signals import (
        DriverState,
        advance_driver_state,
        apply_rest_recovery,
    )
    from aica_api.models.profile import DriverSignalParams

    existing = _load_json(_OUT / "driver_signals.json")
    inp = existing["input"]
    params = DriverSignalParams.model_validate(inp["params"])

    advance_outputs = []
    for c in inp["advance"]:
        state = DriverState(**c["state"])
        upd = advance_driver_state(
            params, state, c["tick_seconds"],
            is_night=c["isNight"],
            is_monotonous=c["isMonotonous"],
            is_traffic_jam=c["isTrafficJam"],
            is_mountain_road=c["isMountainRoad"],
            continuous_driving_min=c["continuousDrivingMin"],
        )
        advance_outputs.append({
            "previous": dataclasses.asdict(upd.previous),
            "delta": dataclasses.asdict(upd.delta),
            "next": dataclasses.asdict(upd.next),
        })

    recovery_outputs = []
    for c in inp["recovery"]:
        state = DriverState(**c["state"])
        out_state = apply_rest_recovery(params, state, c["activity"])
        recovery_outputs.append(dataclasses.asdict(out_state))

    _write("driver_signals", {
        "input": inp,
        "output": {
            "advance": advance_outputs,
            "recovery": recovery_outputs,
        },
    })


# ---------------------------------------------------------------------------
# 3. anomaly — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_anomaly() -> None:
    from aica_api.services.behavior.anomaly_signal import AnomalyState, advance_anomaly
    from aica_api.models.profile import AnomalySignalParams

    existing = _load_json(_OUT / "anomaly.json")
    sequences_input = existing["input"]["sequences"]

    sequences_output = []
    for seq in sequences_input:
        p = AnomalySignalParams.model_validate(seq["params"])
        state = AnomalyState(events=[])
        steps_out = []
        for step in seq["steps"]:
            upd = advance_anomaly(
                p, state,
                drowsiness=step["drowsiness"],
                tick_index=step["tick_index"],
                tick_seconds=seq["tick_seconds"],
                run_seed=seq["run_seed"],
                is_moving=step["is_moving"],
            )
            steps_out.append({
                "spike": upd.spike,
                "anomaly_rate": upd.anomaly_rate,
                "events": upd.next.events,
            })
            state = upd.next
        sequences_output.append({"steps": steps_out})

    _write("anomaly", {
        "input": existing["input"],
        "output": {"sequences": sequences_output},
    })


# ---------------------------------------------------------------------------
# 4. prng — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_prng() -> None:
    from aica_api.services.prng import _subseed, seeded_uniform

    existing = _load_json(_OUT / "prng.json")
    cases = existing["input"]["cases"]

    results = []
    for c in cases:
        ss = _subseed(c["run_seed"], c["tick"], c["channel"])
        u = seeded_uniform(c["run_seed"], c["tick"], c["channel"])
        results.append({"subseed": str(ss), "uniform": u})

    _write("prng", {
        "input": existing["input"],
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 5. event_plan
# ---------------------------------------------------------------------------

def _capture_event_plan() -> None:
    from aica_api.services.event_plan import build_event_plan
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    existing = _load_json(_OUT / "event_plan.json")
    scenario_raw = existing["input"]["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    event_plan = build_event_plan(route_facts, scenario, {})

    _write("event_plan", {
        "input": existing["input"],
        "output": json.loads(event_plan.model_dump_json()),
    })


# ---------------------------------------------------------------------------
# 6. tick_sequence
# ---------------------------------------------------------------------------

def _capture_tick_sequence() -> None:
    from aica_api.services.event_plan import build_event_plan
    from aica_api.services.route_analysis import analyze_route
    from aica_api.services.tick_engine import advance_tick
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.run import RouteFacts, EventPlan

    existing = _load_json(_OUT / "tick_sequence.json")
    inp = existing["input"]
    scenario_raw = inp["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = RouteFacts.model_validate(inp["route_facts"])
    event_plan = EventPlan.model_validate(inp["event_plan"])
    run_seed = inp.get("run_seed", 0) or 0

    prior = None
    states = []
    for i in range(400):
        state = advance_tick(
            prior_state=prior,
            tick_index=i,
            event_plan=event_plan,
            route_facts=route_facts,
            scenario=scenario,
            run_seed=run_seed,
        )
        states.append(json.loads(state.model_dump_json()))
        prior = state
        if state.completed:
            break

    _write("tick_sequence", {
        "input": inp,
        "output": {"states": states},
    })


# ---------------------------------------------------------------------------
# 7. run_plan
# ---------------------------------------------------------------------------

def _capture_run_plan() -> None:
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest

    existing = _load_json(_OUT / "run_plan.json")
    inp = existing["input"]
    pkg_raw = inp["package"]
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = inp["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    plan_id = inp.get("plan_id", "fixture-plan-1")

    from aica_api.services.run_plan import get_draft_entry
    clear_draft_registry()
    create_draft(
        plan_id=plan_id,
        package=pkg,
        scenario=scenario,
        presets=inp.get("presets", {}),
        parameters=inp.get("parameters", {}),
        hyperparameters=inp.get("hyperparameters", {}),
    )
    entry = get_draft_entry(plan_id)
    assert entry is not None, f"No draft registered for plan_id={plan_id!r}"
    draft, eff_pkg, eff_scn = entry

    _write("run_plan", {
        "input": inp,
        "output": {
            "draft": json.loads(draft.model_dump_json()),
            "package": json.loads(eff_pkg.model_dump_json()),
            "scenario": json.loads(eff_scn.model_dump_json()),
        },
    })


# ---------------------------------------------------------------------------
# 8. run_log_e2e (real nri_fatigue_score_v1 package + generated scenario)
# ---------------------------------------------------------------------------
#
# Previously this reconstructed a synthetic `rest_rule_based_v0_1` package
# with algorithm.type='declarative_rule'. Feature 009 narrowed
# AlgorithmDef.type to Literal["python_module"], and the package itself no
# longer exists — that reconstruction is retired per the 021 ADR. This now
# runs the real, committed nri_fatigue_score_v1 package (packages/
# nri_fatigue_score_v1/package.json) against the real generated scenario
# (_SCENARIO_PATH), so the golden always matches what the offline app
# actually ships.
#
# Feature 025 added a MONOTONY_PROPOSAL path (threshold_monotony) that now
# fires before the drowsiness/fatigue-driven REST_PROPOSAL in this scenario.
# The driver loop below is proposal-type aware: it acknowledges/declines
# any non-REST_PROPOSAL pause and only calls accept_rest on the first
# genuine REST_PROPOSAL, so "accept_rest" in the captured log always means
# what it says.


def _capture_run_log_e2e() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest
    from aica_api.models.run import RestSpot

    # Non-schema test parameters (which recovery option / rest spot / seed to
    # exercise) are preserved from the existing fixture; the package and
    # scenario themselves are always sourced fresh (see header comment above).
    existing = _load_json(_OUT / "run_log_e2e.json")
    prior_inp = existing.get("input", {})

    pkg_raw = _load_json(_PACKAGES_DIR / "nri_fatigue_score_v1" / "package.json")
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    recovery_option_id = prior_inp.get("recoveryOptionId", "nap_karaoke")
    rest_spot_raw = prior_inp.get("restSpot", {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "lat": None, "lng": None, "route_fraction": 0.5})
    rest_spot = RestSpot.model_validate(rest_spot_raw)
    run_seed = prior_inp.get("run_seed", 0) or 0

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan-e2e-test"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run-e2e-test"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        accepted_once = False
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                proposal = outcome.decision.proposal if outcome.decision else None
                result_type = outcome.decision.result_type if outcome.decision else None
                if result_type == "REST_PROPOSAL" and not accepted_once:
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
                elif proposal is not None and "acknowledge" in proposal.options:
                    action(run_id, "acknowledge")
                else:
                    action(run_id, "decline")

        assert accepted_once, "no REST_PROPOSAL fired in run_log_e2e"
        run_log = get_active_run_log(run_id)
        assert run_log is not None

    output = json.loads(run_log.model_dump_json())
    # run_manager.create_run() stamps RunLog.created_at with wall-clock time
    # (aica_api/services/run_manager.py:545, _now_iso()) and takes no
    # timestamp parameter to override it — unlike build_evidence_report(),
    # which accepts an explicit `timestamp` (see _capture_evidence_fixtures,
    # frozen to "2026-07-01T00:00:00+00:00"). Freezing there is not an option
    # without editing run_manager.py, which must stay untouched (the Python
    # is the reference). created_at is documented wall-clock metadata, not a
    # decision input (see the module docstring above create_run), so it is
    # safe to normalize post hoc: overwrite it with the same frozen literal
    # used elsewhere in this rig so re-running the capture is a true no-op
    # instead of a permanent one-line timestamp diff on every run.
    output["created_at"] = "2026-07-01T00:00:00+00:00"

    _write("run_log_e2e", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            # Preserved verbatim: this capture always runs with empty
            # overrides / standard mode (matches the create_draft() call
            # above). Several tests (replay/run_manager/feedback/rehydrate/
            # maps_client/expert_override) destructure these keys straight
            # out of fixture.input, so they must stay present even though
            # this function never varies them.
            "presets": prior_inp.get("presets", {}),
            "parameters": prior_inp.get("parameters", {}),
            "hyperparameters": prior_inp.get("hyperparameters", {}),
            "runMode": prior_inp.get("runMode", "standard"),
            "recoveryOptionId": recovery_option_id,
            "restSpot": rest_spot_raw,
            "run_seed": run_seed,
        },
        "output": output,
    })


# ---------------------------------------------------------------------------
# 9. route_analysis
# ---------------------------------------------------------------------------

def _capture_route_analysis() -> None:
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    existing = _load_json(_OUT / "route_analysis.json")
    scenario_raw = existing["input"]["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    result = analyze_route(scenario)

    _write("route_analysis", {
        "input": existing["input"],
        "output": json.loads(result.model_dump_json()),
    })


# ---------------------------------------------------------------------------
# 10. recovery
# ---------------------------------------------------------------------------

def _capture_recovery() -> None:
    from aica_api.services.recovery import start_recovery, advance_recovery
    from aica_api.models.run import RecoveryState, RestSpot
    from aica_api.models.scenario import RecoveryOption

    existing = _load_json(_OUT / "recovery.json")
    # recovery.json is an array of cases, each with {name, input, output}
    new_cases = []
    for case in existing:
        inp = case["input"]
        opt = RecoveryOption.model_validate(inp["option"])
        at_rest_spot = inp["atRestSpot"]

        if inp.get("start"):
            rest_spot_raw = inp["restSpot"]
            rest_spot = RestSpot.model_validate(rest_spot_raw)
            state = start_recovery(opt, rest_spot)
        else:
            state = RecoveryState.model_validate(inp["state"])

        out_state = advance_recovery(state, opt, at_rest_spot=at_rest_spot)
        new_cases.append({
            "name": case.get("name"),
            "input": inp,
            "output": json.loads(out_state.model_dump_json()),
        })

    _write("recovery", new_cases)


# ---------------------------------------------------------------------------
# 11. preview (via TestClient)
# ---------------------------------------------------------------------------

def _capture_preview() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    existing = _load_json(_OUT / "preview.json")
    cases = existing["input"]["cases"]

    c = TestClient(app)
    results = []
    for case in cases:
        body = {
            "package_id": case["package_id"],
            "scenario_id": case["scenario_id"],
            "hyperparameter_overrides": case.get("hyperparameter_overrides", {}),
            "run_seed": case.get("run_seed", 0),
        }
        if case.get("rest_option_id") is not None:
            body["rest_option_id"] = case["rest_option_id"]
        r = c.post("/api/runs/preview", json=body)
        assert r.status_code == 200, f"preview failed: {r.status_code} {r.text}"
        results.append(r.json())

    _write("preview", {
        "input": existing["input"],
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 11b. preview_min_ahead — discriminates the two-stage MIN_AHEAD selection
#      used by the preview's auto-accept rest-spot pick (_pick_rest_spot)
# ---------------------------------------------------------------------------
#
# NOT built by extending _capture_preview() above: that function treats the
# existing preview.json's "input.cases" as the SOURCE OF TRUTH (it re-derives
# ONLY "output" from cases already committed in the golden), so adding a
# case there means hand-authoring fixture content rather than deriving it —
# exactly what "never edit an existing golden to make code pass" rules out
# in spirit, and a larger, riskier change to a function every other preview
# case still depends on. A dedicated capture (mirroring
# _capture_rest_spots_min_ahead's technique for the sibling endpoint) is
# strictly additive and leaves preview.json's regeneration untouched.

def _capture_preview_min_ahead() -> None:
    """Fixture exercising services/preview.py's `_pick_rest_spot` two-stage
    selection (`_PREVIEW_REST_MIN_AHEAD_KM` = 20km ahead stage, falling back
    to "anything ahead" only when stage 1 is empty) — the same blind spot
    `rest_spots.json` had before this task's earlier fix (task 3c) to the
    LIVE-RUN endpoint, still open here for the quickview/preview auto-accept
    path `_pick_rest_spot` serves.

    Same technique as `_capture_rest_spots_min_ahead`: two extra named rest
    spots are injected via the maps route_facts override, positioned near
    (+5km, inside the min-ahead band) and far (+40km, clears it) of the
    driver's position. Unlike that fixture, the position can't be derived
    from route physics alone — the preview's fire/auto-accept TICK is
    algorithm-driven (drowsiness/fatigue crossing a threshold), not a fixed
    tick count — so it is discovered from an UNMODIFIED probe run via
    `iter_preview_ticks` (the first `rest_required` proposal episode with a
    non-None rest_spot — the same tick and same `tick_state.distance_km`
    `_pick_rest_spot` is called with for both the yielded PreviewFireEvent
    and the accept step immediately after it), then verified — not assumed
    — unchanged by a self-check against the REAL (augmented) run below.
    """
    from fastapi.testclient import TestClient
    from aica_api.main import app
    from aica_api.config import settings
    from aica_api.services.preview import iter_preview_ticks
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    run_seed = 42

    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    route_facts_dict = json.loads(route_facts.model_dump_json())

    # ── Probe: unmodified local route/package — find the tick at which the
    # FIRST rest_required proposal becomes actionable (a non-None rest_spot),
    # and the driver's real distance_km there.
    probe_accept_distance_km: float | None = None
    for ev in iter_preview_ticks(
        package_id=pkg_id,
        scenario_id=scn_id,
        hyperparameter_overrides={},
        run_seed=run_seed,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
    ):
        if ev.decision.selected_category == "rest_required" and ev.rest_spot is not None:
            probe_accept_distance_km = ev.tick_state.distance_km
            break
    assert probe_accept_distance_km is not None, (
        "probe preview never reached an actionable rest_required proposal — "
        "this fixture's near/far offsets need a different anchor tick."
    )

    near_km = probe_accept_distance_km + 5.0    # inside the 20km min-ahead band
    far_km = probe_accept_distance_km + 40.0    # clears the 20km min-ahead band

    route_facts_dict["named_rest_spots"] = route_facts_dict["named_rest_spots"] + [
        {"name": "Test Near Rest Area", "position_km": near_km, "lat": None, "lng": None, "synthetic": False},
        {"name": "Test Far Rest Area", "position_km": far_km, "lat": None, "lng": None, "synthetic": False},
    ]
    route_facts_dict["rest_spot_positions"] = route_facts_dict["rest_spot_positions"] + [near_km, far_km]
    route_facts_dict["route_source"] = "maps"

    body = {
        "package_id": pkg_id,
        "scenario_id": scn_id,
        "hyperparameter_overrides": {},
        "run_seed": run_seed,
        "route_source": "maps",
        "route_id": "route-0",
        "route_facts": route_facts_dict,
    }
    r = c.post("/api/runs/preview", json=body)
    assert r.status_code == 200, f"preview failed: {r.status_code} {r.text}"
    result = r.json()

    # Self-check: this fixture only earns its keep if it actually discriminates
    # stage 1 from a stage-2-only implementation. Stage 1 (correct) must never
    # auto-accept the near spot; a stage-2-only implementation would (it is
    # nearest, so it wins the sorted-ascending pick).
    assert result["error"] is None, f"unexpected preview error: {result['error']}"
    assert result["rest_spots"], "expected at least one auto-accepted rest spot"
    assert all(abs(s["at_km"] - near_km) > 1e-6 for s in result["rest_spots"]), (
        "expected the near spot (+5km ahead, inside the 20km min-ahead band) "
        "to never be auto-accepted -- got it in rest_spots. This fixture "
        "would not discriminate stage 1 from a stage-2-only implementation "
        "and needs its offsets revisited."
    )
    assert any(abs(s["at_km"] - far_km) < 1e-6 for s in result["rest_spots"]), (
        "expected the far spot (+40km ahead) to be auto-accepted at least once."
    )

    _write("preview_min_ahead", {
        "input": {
            "package_id": pkg_id,
            "scenario_id": scn_id,
            "hyperparameter_overrides": {},
            "run_seed": run_seed,
            "route_source": "maps",
            "route_id": "route-0",
            "route_facts": route_facts_dict,
        },
        "output": result,
    })


# ---------------------------------------------------------------------------
# 12. rest_spots (via TestClient, real nri_fatigue_score_v1 package)
# ---------------------------------------------------------------------------

def _capture_rest_spots() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    c = TestClient(app)

    # The output only depends on run position + scenario rest spots, not the
    # algorithm itself — nri_fatigue_score_v1 is used because it is the real,
    # committed package (the earlier declarative_rule rest_rule_based_v0_1
    # package this used to reconstruct no longer exists — retired by feature 009).
    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    n_ticks = 5

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans failed: {plan.status_code}"
    plan_id = plan.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code}"
        body = t.json()
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline failed: {a.status_code}"

    # Default rest spots (no overrides)
    rs_default = c.get(f"/api/runs/{run_id}/rest-spots")
    assert rs_default.status_code == 200, f"rest-spots failed: {rs_default.status_code}"

    # Custom ceiling/spacing
    rs_custom = c.get(f"/api/runs/{run_id}/rest-spots?drowsiness_ceiling=5.0&min_distance_km=1.0")
    assert rs_custom.status_code == 200, f"rest-spots custom failed: {rs_custom.status_code}"

    # Load the bundled nri package manifest for the input section
    pkg_path = (_REPO / "packages" / pkg_id / "package.json")
    pkg_raw = _load_json(pkg_path)
    scenario_raw = _load_json(_SCENARIO_PATH)

    _write("rest_spots", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            "n_ticks": n_ticks,
        },
        "output": {
            "default": rs_default.json(),
            "custom_ceiling_5_spacing_1": rs_custom.json(),
        },
    })


# ---------------------------------------------------------------------------
# 12b. rest_spots_min_ahead — discriminates the two-stage MIN_AHEAD selection
# ---------------------------------------------------------------------------

def _capture_rest_spots_min_ahead() -> None:
    """Fixture that exercises the TWO-STAGE selection in routers/runs.py's
    rest_spots_endpoint (stage 1: only candidates more than
    `_REST_SPOTS_MIN_AHEAD_KM` (20km) ahead of the driver; stage 2 fallback:
    "anything ahead" — used only when stage 1 is empty).

    Every OTHER rest_spots fixture drives a route with exactly one
    non-synthetic named rest spot, so stage 1 and the stage-2 fallback always
    pick the SAME candidate — no existing fixture can tell an implementation
    that only has stage 2 apart from one with both stages. This fixture
    injects two EXTRA named rest spots via the maps route-facts override
    (route_source="maps", same contract routers/run_plans.py validates and
    the offline `createDraft` mirrors), positioned relative to the driver's
    position after a known number of ticks:
      near @ +5km ahead  — inside the 20km min-ahead band; a correct stage-1
                            filter drops it. A stage-2-only implementation
                            offers it (and offers it FIRST, since it is
                            nearest).
      far  @ +40km ahead — clears the min-ahead band; the only spot a
                            correct implementation offers by default (the
                            scenario's own "Yuuko Roadside Station" @60km is
                            also >20km ahead, but the greedy spacing filter
                            then drops it as <20km from `far`).

    Driver position after `n_ticks` ticks is deterministic from route
    physics, NOT assumed: the loop below records the real `distance_km` from
    each tick response and the near/far offsets are computed from that
    recorded value, so this capture stays self-consistent even if the route
    physics ever change. A self-check further down asserts the fixture still
    discriminates (the near spot must be ABSENT from stage 1's output) —
    if a future change to route physics or defaults makes that assumption
    false, this capture fails loudly instead of silently degrading into a
    fixture that can no longer catch the bug it exists to catch.
    """
    from fastapi.testclient import TestClient
    from aica_api.main import app
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    n_ticks = 5

    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    route_facts_dict = json.loads(route_facts.model_dump_json())

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans (probe) failed: {plan.status_code}"
    probe_plan_id = plan.json()["plan_id"]
    probe_run = c.post("/api/runs", json={"plan_id": probe_plan_id})
    assert probe_run.status_code == 201, f"runs create (probe) failed: {probe_run.status_code}"
    probe_run_id = probe_run.json()["run_id"]

    # ── Probe run: unmodified local route, purely to learn the deterministic
    # driver position after n_ticks (physics do not depend on named_rest_spots,
    # so this position is identical to the one the REAL fixture run below
    # reaches — verified by the self-check after the real run, not assumed).
    probe_distance_km: float | None = None
    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{probe_run_id}/tick")
        assert t.status_code == 200, f"tick (probe) failed: {t.status_code}"
        body = t.json()
        probe_distance_km = body.get("distance_km", probe_distance_km)
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{probe_run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline (probe) failed: {a.status_code}"
    assert probe_distance_km is not None, "probe run never advanced distance_km"

    near_km = probe_distance_km + 5.0    # inside the 20km min-ahead band
    far_km = probe_distance_km + 40.0    # clears the 20km min-ahead band

    route_facts_dict["named_rest_spots"] = route_facts_dict["named_rest_spots"] + [
        {"name": "Test Near Rest Area", "position_km": near_km, "lat": None, "lng": None, "synthetic": False},
        {"name": "Test Far Rest Area", "position_km": far_km, "lat": None, "lng": None, "synthetic": False},
    ]
    route_facts_dict["rest_spot_positions"] = route_facts_dict["rest_spot_positions"] + [near_km, far_km]
    route_facts_dict["route_source"] = "maps"

    # ── Real fixture run: same package/scenario, but with the augmented
    # route_facts injected via the maps override contract.
    plan2 = c.post("/api/run-plans", json={
        "package_id": pkg_id,
        "scenario_id": scn_id,
        "route_source": "maps",
        "route_id": "route-0",
        "route_facts": route_facts_dict,
    })
    assert plan2.status_code in (200, 201), f"run-plans failed: {plan2.status_code} {plan2.text}"
    plan_id = plan2.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    last_distance_km: float | None = None
    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code}"
        body = t.json()
        last_distance_km = body.get("distance_km", last_distance_km)
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline failed: {a.status_code}"

    assert last_distance_km is not None
    assert abs(last_distance_km - probe_distance_km) < 1e-9, (
        f"augmenting route_facts with extra rest spots changed the driver's "
        f"physical position after {n_ticks} ticks ({probe_distance_km}km -> "
        f"{last_distance_km}km) — the near/far offsets need to be computed "
        "from THIS run's own distance, not the probe run's."
    )

    rs_default = c.get(f"/api/runs/{run_id}/rest-spots")
    assert rs_default.status_code == 200, f"rest-spots failed: {rs_default.status_code}"
    default_body = rs_default.json()

    # Self-check: this fixture only earns its keep if it actually discriminates
    # stage 1 from a stage-2-only implementation. Stage 1 (correct) must
    # EXCLUDE the near spot; a stage-2-only implementation would include it
    # (and would include it FIRST, since it is nearest).
    assert default_body["rest_spots"], "expected at least one rest spot in the default output"
    assert all(s["label"]["en"] != "Test Near Rest Area" for s in default_body["rest_spots"]), (
        "expected the near spot (+5km ahead, inside the 20km min-ahead band) "
        "to be excluded by stage 1 -- got it in the output. This fixture "
        "would not discriminate stage 1 from a stage-2-only implementation "
        "and needs its offsets revisited."
    )
    assert any(s["label"]["en"] == "Test Far Rest Area" for s in default_body["rest_spots"]), (
        "expected the far spot (+40km ahead) to be present in the default output."
    )

    pkg_path = (_REPO / "packages" / pkg_id / "package.json")
    pkg_raw = _load_json(pkg_path)

    _write("rest_spots_min_ahead", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            "route_facts": route_facts_dict,
            "n_ticks": n_ticks,
        },
        "output": {
            "default": default_body,
        },
    })


# ---------------------------------------------------------------------------
# 13. nri_fatigue_score_v1 (direct algorithm.evaluate call)
# ---------------------------------------------------------------------------

def _run_algorithm_over_ticks(alg_path: pathlib.Path, pkg_id: str) -> None:
    """Regenerate a python_module algorithm fixture by replaying recorded tick inputs.

    Per-tick signals/feature_groups/history are preserved as recorded — they
    are synthetic driving state, independent of the algorithm's hyperparameter
    schema. The hyperparameters (and parameters) dict is always refreshed to
    the package's CURRENT committed defaults (packages/<pkg_id>/package.json)
    rather than replayed verbatim: the recorded values go stale whenever a
    package adds/renames/retunes a hyperparameter (e.g. feature 025's
    threshold_fire 80->100 and the new threshold_monotony /
    monotony_saturation_min), and replaying a stale set either crashes
    evaluate() outright (missing required key) or silently exercises the
    algorithm against parameters nobody ships. The refreshed values are
    written back into the fixture's "input" so input and output stay
    self-consistent.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(f"{pkg_id}_algorithm", alg_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    current_hyperparameters = {hp["key"]: hp["default"] for hp in pkg_raw.get("hyperparameters", [])}
    current_parameters = {p["key"]: p["default"] for p in pkg_raw.get("parameters", [])}

    existing = _load_json(_OUT / f"{pkg_id}.json")
    inp = existing["input"]
    ticks_input = inp["ticks"]

    pkg_runtime_state: dict = {}
    decisions_output = []
    refreshed_ticks = []

    for tick_ctx in ticks_input:
        refreshed_ctx = dict(tick_ctx)
        refreshed_ctx["hyperparameters"] = current_hyperparameters
        if "parameters" in refreshed_ctx:
            refreshed_ctx["parameters"] = current_parameters
        refreshed_ticks.append(refreshed_ctx)

        ctx = dict(refreshed_ctx)
        ctx["package_runtime_state"] = pkg_runtime_state
        decision = evaluate(ctx)
        if hasattr(decision, "model_dump_json"):
            dec_dict = json.loads(decision.model_dump_json())
        elif dataclasses.is_dataclass(decision):
            dec_dict = dataclasses.asdict(decision)
        else:
            dec_dict = dict(decision)
        decisions_output.append(dec_dict)
        pkg_runtime_state = dec_dict.get("next_package_runtime_state", {})

    _write(pkg_id, {
        "input": {**inp, "ticks": refreshed_ticks},
        "output": {"decisions": decisions_output},
    })


def _capture_nri_fatigue_score_v1() -> None:
    _run_algorithm_over_ticks(
        _PACKAGES_DIR / "nri_fatigue_score_v1" / "algorithm.py",
        "nri_fatigue_score_v1",
    )


# ---------------------------------------------------------------------------
# 14. aica_transparent_hybrid_trigger_v1 (direct algorithm.evaluate call)
# ---------------------------------------------------------------------------

def _capture_aica_transparent_hybrid_trigger_v1() -> None:
    _run_algorithm_over_ticks(
        _PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1" / "algorithm.py",
        "aica_transparent_hybrid_trigger_v1",
    )


# ---------------------------------------------------------------------------
# 15. feedback
# ---------------------------------------------------------------------------

def _capture_feedback() -> None:
    from aica_api.services.feedback import effective_schema, validate
    from aica_api.models.package import PackageManifest, AlgorithmDef
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    existing = _load_json(_OUT / "feedback.json")
    inp = existing["input"]
    manifest_raw = inp["manifest"]
    # The fixture uses a synthetic test package with algorithm.type='declarative_rule',
    # which is no longer accepted by Pydantic validation (only 'python_module' is).
    # effective_schema() only reads package.id and package.feedback_schema,
    # so we use model_construct() to bypass algorithm.type validation.
    alg_raw = manifest_raw.get("algorithm", {})
    alg_type = alg_raw.get("type", "python_module")
    if alg_type != "python_module":
        alg_raw = {**alg_raw, "type": "python_module"}
    alg = AlgorithmDef.model_validate(alg_raw)
    pkg = PackageManifest.model_construct(
        id=manifest_raw["id"],
        version=manifest_raw.get("version", "0.1"),
        label=manifest_raw.get("label", {}),
        compatible_scenario_types=manifest_raw.get("compatible_scenario_types", ["uc01_fatigue"]),
        algorithm=alg,
        parameters=manifest_raw.get("parameters", []),
        hyperparameters=manifest_raw.get("hyperparameters", []),
        features=manifest_raw.get("features", []),
        trigger_categories=manifest_raw.get("trigger_categories", []),
        rules=manifest_raw.get("rules", []),
        fire_control=manifest_raw.get("fire_control"),
        proposals=manifest_raw.get("proposals", []),
        feedback_schema=manifest_raw.get("feedback_schema", []),
        evidence_metrics=manifest_raw.get("evidence_metrics", []),
    )

    schema = effective_schema(pkg)

    valid_body = inp["body"]
    invalid_body = inp["invalid_body"]

    valid_ev = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(**valid_body["target"]),
        labels=valid_body["labels"],
        comment=valid_body.get("comment"),
    )

    invalid_ev = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(**invalid_body["target"]),
        labels=invalid_body["labels"],
        comment=invalid_body.get("comment"),
    )

    # validate needs a run_log; use a minimal stub.
    # Both valid_body and invalid_body use scope='run' (no event_ref), so
    # the stub log's events list is never consulted.
    import datetime
    from aica_api.models.log import RunLog
    from aica_api.models.run import RouteFacts, EventPlan, Snapshot, ArtifactRef
    stub_log = RunLog(
        run_id="stub",
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        simulator_version="0.0.0",
        snapshot=Snapshot(
            package=ArtifactRef(id="stub", version="0.0", hash="0"),
            scenario=ArtifactRef(id="stub", version="0.0", hash="0"),
        ),
        route_facts=RouteFacts(),
        event_plan=EventPlan(total_ticks=0, tick_seconds=180, ticks=[]),
        events=[],
    )

    valid_errors = validate(valid_ev, schema, stub_log)
    invalid_errors = validate(invalid_ev, schema, stub_log)

    _write("feedback", {
        "input": inp,
        "output": {
            "schema": [json.loads(f.model_dump_json()) for f in schema],
            "valid": len(valid_errors) == 0,
            "invalid_errors": [{"field": e.field, "message": e.message} for e in invalid_errors],
            "event": json.loads(valid_ev.model_dump_json()),
        },
    })


# ---------------------------------------------------------------------------
# 16. evidence_report + evidence_markdown + evidence_markdown_nri
# ---------------------------------------------------------------------------

def _capture_evidence_fixtures() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry, append_feedback
    from aica_api.services.evidence import build_evidence_report
    from aica_api.services.evidence_markdown import render_evidence_markdown
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest
    from aica_api.models.run import RestSpot
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
    from aica_api.models.log import RunLog

    # Package + scenario are always sourced fresh from the committed sources
    # (packages/nri_fatigue_score_v1/package.json, _SCENARIO_PATH), not from
    # whatever was embedded in the previous capture of this fixture — see the
    # run_log_e2e header comment above for why replaying a stale package here
    # both drifts silently and crashes evaluate() (feature 025 added a
    # required threshold_monotony hyperparameter).
    pkg_raw = _load_json(_PACKAGES_DIR / "nri_fatigue_score_v1" / "package.json")
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan_evidence_fixture"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run_evidence_fixture"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        recovery_option_id = "nap_karaoke"
        rest_spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, lat=None, lng=None, route_fraction=0.5)

        # Feature 025's MONOTONY_PROPOSAL fires before the drowsiness/fatigue
        # REST_PROPOSAL in this scenario — acknowledge/decline it and only
        # accept_rest on the first genuine REST_PROPOSAL, so proposal_tick_index
        # (used for the decision-scoped feedback event below) points at the
        # rest proposal, not an earlier monotony nudge.
        accepted_once = False
        proposal_tick_index = None
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                proposal = outcome.decision.proposal if outcome.decision else None
                result_type = outcome.decision.result_type if outcome.decision else None
                if result_type == "REST_PROPOSAL" and not accepted_once:
                    proposal_tick_index = outcome.evaluated_tick_index
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
                elif proposal is not None and "acknowledge" in proposal.options:
                    action(run_id, "acknowledge")
                else:
                    action(run_id, "decline")

        assert accepted_once, "no REST_PROPOSAL fired in evidence fixture run"

        # Append two feedback events (same as the fixture originally had)
        decision_feedback = FeedbackEvent(
            kind="feedback",
            target=FeedbackTarget(
                scope="decision",
                event_ref=proposal_tick_index,
                tick_index=proposal_tick_index,
            ),
            labels={"proposal_timing": "appropriate", "safety_impression": "safe"},
            comment="Felt like a natural moment to suggest a rest.",
        )
        run_feedback = FeedbackEvent(
            kind="feedback",
            target=FeedbackTarget(scope="run"),
            labels={"overall_judgment": "good_trigger"},
            comment=None,
        )
        append_feedback(run_id, decision_feedback)
        append_feedback(run_id, run_feedback)

        run_log = get_active_run_log(run_id)
        assert run_log is not None

        report = build_evidence_report(
            run_log,
            report_id="report_fixture_20260701-000000_abcdef",
            timestamp="2026-07-01T00:00:00+00:00",
            ui_language="en",
        )
        markdown = render_evidence_markdown(report)

        # Key exclusion guard
        report_str = json.dumps(report, ensure_ascii=False)
        assert "googleMapsApiKey" not in report_str
        assert "google_maps_api_key" not in report_str
        import re
        assert not re.search(r"AIza[0-9A-Za-z_-]{10,}", report_str)

        _write("evidence_report", {
            "input": {
                "package": pkg_raw,
                "scenario": scenario_raw,
                "parameters": {},
                "hyperparameters": {},
                "presets": {},
                "runMode": "standard",
                "recoveryOptionId": recovery_option_id,
                "restSpot": json.loads(rest_spot.model_dump_json()),
                "uiLanguage": "en",
                "feedback": {
                    "decision": json.loads(decision_feedback.model_dump_json()),
                    "run": json.loads(run_feedback.model_dump_json()),
                },
            },
            "output": report,
        })

        _write("evidence_markdown", {
            "input": report,
            "output": markdown,
        })

    # evidence_markdown_nri: SEPARATE NRI run (nri_fatigue_score_v1 +
    # uc01_fatigue_recovery_v0_1) with ALL REST_PROPOSAL pauses declined,
    # so the fixture is intentionally distinct from evidence_markdown.json.
    # This guards nri whole-number-float hyperparameter formatting:
    # e.g. w_child: 20.0, theta_sleep: 60.0, rest_cooldown_sec: 600.0 must
    # render as "20.0"/"60.0" not "20"/"60", while genuine-int hyperparameters
    # (max_proposals_per_30min: 3, persistence_ticks: 2) must stay as "3"/"2".
    _capture_evidence_markdown_nri()


def _capture_evidence_markdown_nri() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry
    from aica_api.services.evidence import build_evidence_report
    from aica_api.services.evidence_markdown import render_evidence_markdown
    from aica_api.models.package import PackageManifest

    pkg_path = (_REPO / "packages" / "nri_fatigue_score_v1" / "package.json")
    pkg_raw = _load_json(pkg_path)
    pkg = PackageManifest.model_validate(pkg_raw)

    scenario_raw = _load_json(_SCENARIO_PATH)
    from aica_api.models.scenario import ScenarioDef
    scenario = ScenarioDef.model_validate(scenario_raw)

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan_evidence_nri_fixture"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run_evidence_nri_fixture"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        # Decline ALL REST_PROPOSAL pauses — this produces a distinct run log
        # compared to evidence_markdown.json (which accepts one rest).
        declined_count = 0
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                action(run_id, "decline")
                declined_count += 1

        assert declined_count > 0, "no REST_PROPOSAL fired in evidence_markdown_nri run"

        run_log = get_active_run_log(run_id)
        assert run_log is not None

        nri_report = build_evidence_report(
            run_log,
            report_id="report_nri_fixture_20260701-000000_abcdef",
            timestamp="2026-07-01T00:00:00+00:00",
            ui_language="en",
        )
        nri_markdown = render_evidence_markdown(nri_report)

        # Key exclusion guard
        report_str = json.dumps(nri_report, ensure_ascii=False)
        assert "googleMapsApiKey" not in report_str
        assert "google_maps_api_key" not in report_str
        import re
        assert not re.search(r"AIza[0-9A-Za-z_-]{10,}", report_str)

        _write("evidence_markdown_nri", {
            "input": nri_report,
            "output": nri_markdown,
        })


# ---------------------------------------------------------------------------
# 17. nri_tick_by_tick (via TestClient — full NRI run, per-tick decision_result)
# ---------------------------------------------------------------------------

def _capture_nri_tick_by_tick() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans failed: {plan.status_code}"
    plan_id = plan.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    accepted_once = False
    accept_at_tick = None
    decisions = []

    for guard in range(400):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code} {t.text}"
        body = t.json()

        if "error" in body:
            raise RuntimeError(f"algorithm_error at guard {guard}: {body['error']}")

        decision = body.get("decision")
        decisions.append(decision)

        if body.get("completed"):
            break

        if body.get("paused"):
            # Feature 025's MONOTONY_PROPOSAL fires before the drowsiness/
            # fatigue REST_PROPOSAL in this scenario — acknowledge/decline it
            # and only accept_rest on the first genuine REST_PROPOSAL, so
            # acceptAt always points at the rest proposal, not an earlier
            # monotony nudge.
            tick_index = body.get("tick_index")
            result_type = (decision or {}).get("result_type")
            options = ((decision or {}).get("proposal") or {}).get("options", [])
            if result_type == "REST_PROPOSAL" and not accepted_once:
                accept_at_tick = tick_index
                act_body = {
                    "action": "accept_rest",
                    "recovery_option_id": "nap_karaoke",
                    "rest_spot": {
                        "id": "p1",
                        "label": {"ja": "SA", "en": "SA"},
                        "lat": None,
                        "lng": None,
                        "route_fraction": 0.5,
                    },
                }
                a = c.post(f"/api/runs/{run_id}/actions", json=act_body)
                assert a.status_code == 200, f"accept_rest failed: {a.status_code}"
                accepted_once = True
            elif "acknowledge" in options:
                a = c.post(f"/api/runs/{run_id}/actions", json={"action": "acknowledge"})
                assert a.status_code == 200, f"acknowledge failed: {a.status_code}"
            else:
                a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
                assert a.status_code == 200, f"decline failed: {a.status_code}"
    else:
        raise RuntimeError("nri run did not complete within 400 ticks")

    assert accepted_once, "no REST_PROPOSAL fired in nri_tick_by_tick run"
    print(f"    nri: {len(decisions)} ticks, acceptAt={accept_at_tick}")

    _write("nri_tick_by_tick", {
        "input": {
            "package": pkg_id,
            "scenario": scn_id,
            "acceptAt": accept_at_tick,
        },
        "output": {"decisions": decisions},
    })


# ---------------------------------------------------------------------------
# 18. service_selector (aica_transparent_service_selector_v1.algorithm.evaluate,
#     direct import over an 11-case representative set — C1 Task 4)
# ---------------------------------------------------------------------------
#
# Proposal-family package (package.json: kind/family="service_selector"), NOT
# wired to any trigger-side capture above and not yet dispatched by anything
# in the app — the proposal engine is a later slice (C2). Verified standalone
# by calling `evaluate(context)` directly, once per case (the package is
# stateless across calls: `next_package_runtime_state` is always `{}`, never
# consumed as an accumulator the way the trigger packages' state is).
#
# Every case is built from COMMITTED data: the package's own resolved
# defaults (packages/aica_transparent_service_selector_v1/package.json) and
# the SS10 worked-example fixture (proposal_contracts/fixtures/service/
# worked-example.json — hand-authored from docs/master/
# aica_transparent_service_proposal_algorithm.md SS10/SS11, "never
# score-derived", see that fixture's own _comment and its sibling
# contrast-*.json files) — the SAME committed sources
# app/api/tests/proposal/conftest.py's `build_service_context()` /
# `load_worked_example_context()` test harness draws from. That harness is
# NOT imported directly here — importing anything under app/api/tests/ risks
# the documented "tests/ package collision" gotcha (see htmlapp memory), so
# the same construction is re-derived below instead.
#
# The 11 cases were chosen to reach every semantically significant branch in
# evaluate() that a VALID (non-raising) call can reach — see the C1 Task 4
# report for the full per-branch coverage table. Deliberately EXCLUDED: the
# _RequestError/_ConfigError/_CatalogError raising paths (an invalid
# trigger_purpose/lifecycle_stage combination, a candidate outside
# allowed_service_ids or its stage family, a malformed response-coefficient
# override, ...) — calling evaluate() with one of those inputs raises an
# exception, which cannot be captured as a golden "success" case, exactly
# mirroring how nri_fatigue_score_v1 / aica_transparent_hybrid_trigger_v1's
# own strict hyperparameter accessors are never golden-exercised on their
# throwing path either. The TS port still mirrors those raises faithfully
# (see the report for how).

def _capture_service_selector() -> None:
    import copy
    import importlib.util

    pkg_id = "aica_transparent_service_selector_v1"
    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    default_hp = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}
    default_params = pkg_raw["parameters"]

    worked_raw = _load_json(
        _REPO / "proposal_contracts" / "fixtures" / "service" / "worked-example.json"
    )
    worked_raw = {k: v for k, v in worked_raw.items() if not k.startswith("_")}

    def worked_context(**overrides: object) -> dict:
        """Deep-copy the SS10 worked-example context, merge in the package's
        resolved defaults (the fixture never embeds config — see
        proposal_contracts/fixtures/service/README.md), apply overrides."""
        ctx = copy.deepcopy(worked_raw)
        ctx["parameters"] = copy.deepcopy(default_params)
        ctx["hyperparameters"] = copy.deepcopy(default_hp)
        ctx.update(copy.deepcopy(overrides))
        return ctx

    def base_context(
        *,
        trigger_purpose: str,
        lifecycle_stage: str,
        allowed_service_ids: list,
        eligible_candidates: list | None = None,
        excluded_candidates: list | None = None,
        feature_snapshot: dict | None = None,
        hyperparameters: dict | None = None,
        parameters: dict | None = None,
        opportunity_id: str = "opportunity-service-selector-fixture",
        simulation_time: str = "2026-08-01T12:00:00Z",
        run_seed: str = "seed-service-selector-fixture",
    ) -> dict:
        """Assemble a full SelectorInput-shaped context from scratch — mirrors
        app/api/tests/proposal/conftest.py's build_service_context() (not
        imported, see module note above)."""
        allowed = list(allowed_service_ids)
        if eligible_candidates is None:
            eligible_candidates = [{"candidate_id": sid} for sid in allowed]
        return {
            "contract_version": pkg_raw.get("contract_version", "1.0.0"),
            "schema_version": pkg_raw.get("schema_version", "1.0.0"),
            "opportunity_id": opportunity_id,
            "simulation_time": simulation_time,
            "trigger_purpose": trigger_purpose,
            "lifecycle_stage": lifecycle_stage,
            "allowed_service_ids": allowed,
            "selected_service_id": None,
            "feature_snapshot": feature_snapshot or {},
            "feature_provenance": {},
            "enabled_feature_extensions": [],
            "eligible_candidates": eligible_candidates,
            "excluded_candidates": excluded_candidates or [],
            "parameters": copy.deepcopy(parameters) if parameters is not None else copy.deepcopy(default_params),
            "hyperparameters": copy.deepcopy(hyperparameters) if hyperparameters is not None else copy.deepcopy(default_hp),
            "package_runtime_state": {},
            "catalog_version": "n/a",
            "run_seed": run_seed,
        }

    cases: list[tuple[str, dict]] = []

    # 1. worked_example — SS10's 6-candidate driving world, verbatim. Default
    # top_k=3 truncates 6 eligible candidates to 3; dominance preserved;
    # multi-row positive AND negative rationale.
    cases.append(("worked_example", worked_context()))

    # 2. tie_break_highway — call_response_driving & quiz share an IDENTICAL
    # service_response_profiles row on every FEATURE_ORDER feature (they
    # differ ONLY at road_response_profiles.mountain: -0.5 vs -1.0), and
    # neither has a preference/history table entry in the worked-example
    # snapshot, so every per-candidate (direct-feature) evidence term is
    # identically 0.0 (missing_neutral) for both. situation.road_type ==
    # "highway" (not mountain) here, so their two scores are bit-for-bit
    # IDENTICAL (verified empirically: both 0.4848812095032397). Exercises
    # the `scored.sort(key=lambda s: (-s["score"], s["candidate_id"]))` tuple
    # comparator (divergence hazard #2): candidate_id ascending must place
    # call_response_driving ('c') above quiz ('q').
    cases.append(("tie_break_highway", worked_context(
        allowed_service_ids=["call_response_driving", "quiz"],
        eligible_candidates=[{"candidate_id": "call_response_driving"}, {"candidate_id": "quiz"}],
    )))

    # 3. custom_weights_dominance_zero_weight — two independent hyperparameter
    # edits on the worked-example snapshot: (a) hierarchy_weights.Situation.
    # share -> 0.01 breaks the SS6.4 W_D*material_safety_gap > 2*W_L
    # invariant (still scores, never blocks — dominance.status ==
    # "dominance_not_guaranteed") AND pushes W_D below the default
    # safety_share_warning_floor (0.4) -> safety_share_warning == true too
    # (verified empirically: W_D == 0.3937 at share=0.01, vs 0.6329 at the
    # more modest 0.15 first tried — 0.15 alone triggers
    # dominance_not_guaranteed but NOT the separate safety_share_warning
    # flag, so both hyperparameter edits are pushed further to reach both
    # branches in one case rather than needing a 12th case); (b)
    # hierarchy_weights.Situation.subgroups.driving_environment.leaves.
    # night_state.share -> 0.0 makes that leaf's effective_weight EXACTLY
    # 0.0, so its contribution row's status == "zero_weight" for every
    # candidate.
    hp_edge = copy.deepcopy(default_hp)
    hp_edge["hierarchy_weights"]["Situation"]["share"] = 0.01
    hp_edge["hierarchy_weights"]["Situation"]["subgroups"]["driving_environment"]["leaves"]["night_state"]["share"] = 0.0
    cases.append(("custom_weights_dominance_zero_weight", worked_context(hyperparameters=hp_edge)))

    # 4. confidence_shrinkage_on — route_music/active_driving_content, the
    # opt-in confidence_shrinkage_v1 hyperparameter ON, THREE candidates so
    # all three _apply_confidence_shrinkage shapes appear in one case:
    #   - music_playlist: confidence PRESENT and exactly 1.0 — a whole-number
    #     float. Python's f-string `f"...[confidence={conf}]"` renders this
    #     "1.0" (float repr always shows a decimal point); a naive JS
    #     template-literal interpolation of the same number renders "1"
    #     (JS Number-to-string drops a trailing ".0") — this is the
    #     float->string-formatting divergence hazard, and this is the one
    #     case in the whole fixture set that actually exercises it (every
    #     other confidence value used below has a nonzero fractional part,
    #     which happens to format identically in both languages and would
    #     NOT have caught a naive port).
    #   - humming_karaoke: confidence PRESENT and fractional (0.2) — the
    #     "ordinary" shrink path.
    #   - quiz: confidence entry ABSENT entirely -> the missing-confidence
    #     branch (treated as 1.0, no shrink, hardcoded "(missing,
    #     disclosed)" text — a Python string literal, not an interpolated
    #     float, so no formatting hazard on that branch).
    # Also moves the two confidence fields out of unused_available_features
    # (scan_unused_snapshot_keys's confidence_shrinkage_on branch) and marks
    # every acceptance/recovery row's response_provenance ==
    # "confidence_shrinkage_v1".
    hp_shrink = copy.deepcopy(default_hp)
    hp_shrink["confidence_shrinkage_v1"] = True
    cases.append(("confidence_shrinkage_on", base_context(
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke", "quiz"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 10, "fatigue_level": 15, "traffic_state": "congested",
                "road_type": "mountain", "night_state": "night", "monotony_level": 55,
                "route_tags": ["scenic_byway"], "destination_tags": [], "child_present": True,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"music_playlist": 60, "humming_karaoke": 60, "quiz": 60},
                "service_recovery_rate": {"music_playlist": 50, "humming_karaoke": 50, "quiz": 50},
            },
            "additional_proposed": {
                "service_proposal_acceptance_confidence": {"music_playlist": 1.0, "humming_karaoke": 0.2},
                "service_recovery_confidence": {},
            },
        },
        hyperparameters=hp_shrink,
    )))

    # 5. empty_eligible_no_proposal — allowed_service_ids/eligible_candidates
    # both empty -> decision_type == "no_proposal" (dominance/effective_weights/
    # resolved_config_versions are STILL populated on this path — pure
    # functions of the resolved weights, computed before the eligibility
    # check runs). excluded_candidates is non-empty here to verify the
    # straight passthrough.
    cases.append(("empty_eligible_no_proposal", base_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=[],
        eligible_candidates=[],
        excluded_candidates=[{"candidate_id": "quiz", "platform_reason": "not_available_this_trip"}],
        feature_snapshot=worked_raw["feature_snapshot"],
    )))

    # 6. during_rest_stopped_structurally_empty — the documented limitation
    # (algorithm.py module docstring / package.json candidate_stage_family):
    # during_rest_stopped's candidate family is frozen EMPTY, so a caller can
    # only ever pass eligible_candidates=[] for this stage (anything else
    # raises _CatalogError) — this is the stage's ONLY reachable non-raising
    # shape, always no_proposal.
    cases.append(("during_rest_stopped_structurally_empty", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="during_rest_stopped",
        allowed_service_ids=[],
        eligible_candidates=[],
    )))

    # 7. unknown_tags_missing_fields — a sparse situation (fatigue_level/
    # traffic_state/night_state/monotony_level/child_present/
    # multiple_passengers all OMITTED) + empty preference/history/
    # additional_proposed -> "missing" status on every omitted scalar
    # feature and "missing_neutral" on all 5 direct candidate-indexed
    # features (incl. oshi_registered/oshi_mode entirely absent — which does
    # NOT trip the oshi-consistency check; only an explicit
    # oshi_registered=False + oshi_mode='on' does, and that combination is
    # deliberately never constructed anywhere in this fixture set — see the
    # report's hazard/branch notes). route_tags/destination_tags each carry
    # one unrecognized tag -> unused_available_features. Omitting
    # monotony_level specifically (rather than leaving it present, as an
    # earlier revision of this case did) ALSO exercises
    # derive_scene_ids's `isinstance(monotony, (int, float))` gate on its
    # FALSE branch — with no monotony value at all, the monotony:high/medium
    # scene-tag check is skipped entirely rather than evaluated against a
    # number; every other case always supplies a numeric monotony_level, so
    # this is the only place that branch is reached. (The 3 numeric-value
    # branches — >= high_min, medium_min..high_min, < medium_min — stay
    # covered elsewhere: worked_example, case 4, and cases 6/10/11
    # respectively, so removing monotony_level here costs no other
    # coverage.)
    cases.append(("unknown_tags_missing_fields", base_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 50,
                "road_type": "local",
                "route_tags": ["highway", "unknown_tag_xyz"],
                "destination_tags": ["unknown_dest_tag"],
            },
            "preference": {},
            "history": {},
            "additional_proposed": {},
        },
    )))

    # 8. response_coefficient_override — SS4.2/SS12 customer edit:
    # music_playlist/drowsiness_level's default 0.0 (neutral_source_silent)
    # overridden to +0.6. Retains the ORIGINAL provenance and ADDS
    # customer_override.
    hp_override = copy.deepcopy(default_hp)
    hp_override["response_coefficient_overrides"] = {"music_playlist": {"drowsiness_level": 0.6}}
    cases.append(("response_coefficient_override", worked_context(
        allowed_service_ids=["music_playlist"],
        eligible_candidates=[{"candidate_id": "music_playlist"}],
        hyperparameters=hp_override,
    )))

    # 9. after_rest_content — rest_recommended/after_rest_before_restart, the
    # 5-candidate post-rest family (live_viewing/stretch_video/full_karaoke/
    # call_response_stopped/oshi_reexperience). road_type is OMITTED (a
    # stopped/post-rest snapshot commonly carries none) -> "missing" status
    # on the road row for every candidate; every candidate's
    # neutral_source_silent columns (traffic_state, night_state, ...) land on
    # "neutral" status (present, weighted, contributes exactly 0).
    cases.append(("after_rest_content", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        allowed_service_ids=["live_viewing", "stretch_video", "call_response_stopped", "full_karaoke", "oshi_reexperience"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 15, "fatigue_level": 20,
                "traffic_state": "normal", "night_state": "day", "monotony_level": 10,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"live_viewing": 60, "stretch_video": 40},
                "service_recovery_rate": {"live_viewing": 55, "stretch_video": 65},
            },
            "additional_proposed": {},
        },
    )))

    # 10. rest_recommended_before_rest — rest_recommended/before_rest_until_stop,
    # the same 6-candidate driving family as the worked example but a
    # DIFFERENT purpose_multipliers row (driver_state 1.4 vs 1.5, route_context
    # 1.0 vs 0.75, ...) and a fresh moderate-fatigue situation. route_tags/
    # destination_tags are OMITTED ENTIRELY (not even an empty list) — the
    # one case in the set that exercises resolve_scalar_evidence's "missing"
    # status for these two features specifically (every other case sets them
    # to a present list, empty or not — status "used" either way, per
    # algorithm.py: `status = "used" if present else "missing"`, independent
    # of whether the present value is actually a list).
    cases.append(("rest_recommended_before_rest", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
        allowed_service_ids=["music_playlist", "humming_karaoke", "call_response_driving", "quiz", "ranking_creation", "radio_style"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 55, "fatigue_level": 50, "traffic_state": "normal",
                "road_type": "local", "night_state": "day", "monotony_level": 30,
                "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )))

    # 11. child_passenger_experience — the 4th purpose (never exercised by
    # the other 10 cases), with child_present/multiple_passengers both true
    # -> the passenger_composition subgroup's 5.0x multiplier dominates.
    cases.append(("child_passenger_experience", base_context(
        trigger_purpose="child_passenger_experience",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke", "call_response_driving", "quiz", "ranking_creation", "radio_style"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 20, "fatigue_level": 15, "traffic_state": "normal",
                "road_type": "highway", "night_state": "day", "monotony_level": 20,
                "route_tags": [], "destination_tags": [], "child_present": True,
                "multiple_passengers": True,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )))

    spec = importlib.util.spec_from_file_location(
        "aica_service_selector_v1_algorithm", _PACKAGES_DIR / pkg_id / "algorithm.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    results = []
    for name, ctx in cases:
        decision = evaluate(ctx)
        results.append({"name": name, "decision": decision})

    _write("service_selector", {
        "input": {"cases": [{"name": name, "context": ctx} for name, ctx in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 19. content_selector (aica_transparent_content_selector_v1.algorithm.evaluate,
#     direct import over a representative case set — C1 Task 5)
# ---------------------------------------------------------------------------
#
# Proposal-family package (package.json: kind/family="content_selector"), NOT
# wired to any trigger-side capture above and not yet dispatched by anything
# in the app — the proposal engine is a later slice (C2). Verified standalone
# by calling `evaluate(context)` directly, once per case.
#
# Most cases are built from the small, committed `smoke-catalog.json` fixture
# (6 hand-authored songs, proposal_contracts/fixtures/catalog/smoke-catalog.json
# — the SAME fixture app/api/tests/proposal's own content-selector test suite
# uses) so each case's expected outcome is easy to reason about by hand. ONE
# case (`real_dataset_slice`) instead uses the real, large song catalog
# (proposal_contracts/dataset/soundcharts-grounded-.../catalog.json, 300
# songs) SLICED DOWN to the first 10 entries plus a matching slice of
# genre_affinity_v1.json (only the artist ids actually credited on those 10
# songs) — bounding it at 10 keeps the fixture reviewable (roughly ~1000
# lines of embedded real Spotify-shaped JSON, vs. ~30,000 for the full
# catalog) while still exercising the real schema's extra fields (images,
# external_urls, analysis_url, ...) that the algorithm must safely ignore,
# and giving genuine ranking diversity across real audio features.
#
# Unlike aica_transparent_service_selector_v1 (C1 Task 4), content_selector's
# evaluate() CATCHES its own _ConfigError/_CatalogError internally and
# returns a structured decision_type ("invalid_configuration"/
# "invalid_catalog") rather than raising — so those ARE golden-capturable
# "success" (non-throwing) cases here, unlike the service selector's raise
# paths. See the C1 Task 5 report for the full per-branch coverage table and
# for which hyperparameter-key accesses are NOT caught by evaluate() at all
# (bare Python KeyError, uncaught) — those remain deliberately unverified by
# this golden (a raising call can't be captured as a golden "success" case)
# and are instead covered by tests/content_selector_validation.test.ts.

def _capture_content_selector() -> None:
    import copy
    import importlib.util

    pkg_id = "aica_transparent_content_selector_v1"
    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    default_hp = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}
    default_params = pkg_raw["parameters"]

    dispositions_raw = _load_json(_REPO / "proposal_contracts" / "dispositions" / "content_feature_dispositions.v1.json")
    dispositions = dispositions_raw["entries"]

    smoke_list = _load_json(_REPO / "proposal_contracts" / "fixtures" / "catalog" / "smoke-catalog.json")

    def smoke_catalog() -> dict:
        return {song["spotify_track"]["id"]: copy.deepcopy(song) for song in smoke_list}

    def base_context(
        *,
        selected_service_id: str = "music_playlist",
        trigger_purpose: str = "rest_recommended",
        lifecycle_stage: str = "before_rest_until_stop",
        feature_snapshot: dict,
        enabled_feature_extensions: list | None = None,
        eligible_candidates: list | None = None,
        excluded_candidates: list | None = None,
        hyperparameters: dict | None = None,
        parameters: dict | None = None,
        simulation_time: str = "2026-07-14T22:10:00Z",
        catalog_version: str = "smoke-1",
    ) -> dict:
        """Assemble a runtime context dict for the content selector. Mirrors
        app/api/tests/proposal/conftest.py's build_content_context() (not
        imported directly, to avoid the documented tests/-package-collision
        gotcha — the same construction is re-derived here, exactly like
        _capture_service_selector does for its own sibling harness)."""
        catalog = feature_snapshot.get("catalog", {})
        if eligible_candidates is None:
            eligible_candidates = [{"candidate_id": tid} for tid in catalog]
        return {
            "contract_version": pkg_raw.get("contract_version", "1.0.0"),
            "opportunity_id": "opportunity-content-selector-fixture",
            "simulation_time": simulation_time,
            "trigger_purpose": trigger_purpose,
            "lifecycle_stage": lifecycle_stage,
            "allowed_service_ids": [selected_service_id],
            "selected_service_id": selected_service_id,
            "feature_snapshot": feature_snapshot,
            "feature_provenance": {},
            "enabled_feature_extensions": enabled_feature_extensions or [],
            "eligible_candidates": eligible_candidates,
            "excluded_candidates": excluded_candidates or [],
            "parameters": copy.deepcopy(parameters) if parameters is not None else copy.deepcopy(default_params),
            "hyperparameters": copy.deepcopy(hyperparameters) if hyperparameters is not None else copy.deepcopy(default_hp),
            "package_runtime_state": {},
            "feature_dispositions": dispositions,
            "catalog_version": catalog_version,
            "run_seed": "seed-content-selector-fixture",
        }

    cases: list[tuple[str, dict]] = []

    # 1. baseline_complete_plan — smoke catalog (6 songs), music_playlist,
    # driving, extension OFF (every genre-gated leaf must land context_only),
    # rich situation/preference/history so drowsiness/fatigue/monotony/
    # traffic/road/night/motion/age/item_usage/played/acceptance/recovery are
    # all "used"; oshi_registered=False (gate=0, the FIRST of 3 distinct oshi
    # gate=0 shapes exercised across this case set). plan_item_count=5 over 6
    # eligible candidates -> non-empty scored_tail (1) with a real cut_margin.
    # music_playlist is not in lighting_compatible_services -> lighting=None.
    #
    # Fix round 1: this case ALSO carries every `_played_evidence` time
    # bucket (algorithm.py:434-452, previously only `le_7d` was reached) and
    # 3 of the remaining 4 `_era_bucket` shapes (algorithm.py:189-206,
    # previously only 2010s/2020s were reached, via distinct songs' own
    # `album.release_date`), reusing this case's already-populated
    # preference/catalog rather than adding new cases:
    #   - track1001: played le_30m (20 min before sim_time -> <=1800s).
    #   - track1002: played today (~12h10m before -> >1800s, <=86400s) AND
    #     release_date moved to 1975 -> pre1980 era bucket.
    #   - track1004: played le_7d (UNCHANGED from before this fix -> >86400s,
    #     <=604800s) AND release_date corrupted to a non-empty, non-parseable
    #     string -> `_era_bucket`'s `int(str(release_date)[:4])` raises
    #     ValueError, caught, returns None -> the "band present but era
    #     unresolvable" branch (distinct from "no release_date at all").
    #   - track1006: played else (44 days before -> >604800s) AND release_date
    #     moved to 1985 -> 1980s era bucket.
    # track1003/1005 keep their existing acceptance/recovery-only roles,
    # untouched. (1990s/2000s era buckets are exercised by `real_dataset_slice`
    # below — see the coverage table.)
    cat1 = smoke_catalog()
    cat1["synthetic-track-1002"]["spotify_track"]["album"]["release_date"] = "1975-06-01"
    cat1["synthetic-track-1004"]["spotify_track"]["album"]["release_date"] = "not-a-parseable-date"
    cat1["synthetic-track-1006"]["spotify_track"]["album"]["release_date"] = "1985-03-01"
    cases.append(("baseline_complete_plan", base_context(
        selected_service_id="music_playlist",
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
        feature_snapshot={
            "catalog": cat1,
            "situation": {
                "drowsiness_level": 70, "fatigue_level": 40, "monotony_level": 50,
                "traffic_state": "congested", "road_type": "highway", "night_state": "night",
                "motion_state": "driving", "route_tags": ["highway", "unknown_tag_xyz"],
                "destination_tags": ["resort"], "child_present": False, "multiple_passengers": False,
            },
            "preference": {
                "age_band": "30s", "oshi_registered": False, "oshi_mode": "off",
                "catalog_item_usage_level": {"synthetic-track-1002": "high"},
                "hobby_interest_tags": ["anime-fan"],
                "played_items": [
                    {"track_id": "synthetic-track-1001", "last_played_at": "2026-07-14T21:50:00Z"},
                    {"track_id": "synthetic-track-1002", "last_played_at": "2026-07-14T10:00:00Z"},
                    {"track_id": "synthetic-track-1004", "last_played_at": "2026-07-13T20:00:00Z"},
                    {"track_id": "synthetic-track-1006", "last_played_at": "2026-06-01T00:00:00Z"},
                ],
                "changed_from_items": [],
            },
            "history": {
                "content_proposal_acceptance_rate": {"synthetic-track-1003": 80},
                "content_recovery_rate": {"synthetic-track-1005": 30},
            },
        },
    )))

    # 2. humming_genre_oshi_on — humming_karaoke, genre_affinity_v1 ON with
    # REAL matches on all 6 genre-gated leaves (route/destination/child/
    # hobbies/genre_usage/scene_genre), oshi ON with a match, AND a
    # multi-artist-credited clone song exercising the "MAX not sum" oshi
    # comment (algorithm.py:366-372) directly: two credited artists both
    # registered as oshi at different enthusiasm levels on the SAME track.
    # service_ease -> humming_ease; mode.fixed_segment_sec; humming_karaoke IS
    # lighting-compatible. plan_item_count=4 over 6 -> tail of 2.
    cat2 = smoke_catalog()
    # track1003 gets a second credited artist (also an oshi, lower enthusiasm)
    # to exercise "two oshi on one song -> max, not sum".
    cat2["synthetic-track-1003"]["spotify_track"]["artists"].append(
        {"id": "synthetic-artist-9002", "name": "Second Oshi", "type": "artist", "uri": "spotify:artist:synthetic-artist-9002"}
    )
    cases.append(("humming_genre_oshi_on", base_context(
        selected_service_id="humming_karaoke",
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        enabled_feature_extensions=["genre_affinity_v1"],
        feature_snapshot={
            "catalog": cat2,
            "situation": {
                "drowsiness_level": 30, "fatigue_level": 20, "monotony_level": 40,
                "traffic_state": "normal", "road_type": "highway", "night_state": "day",
                "motion_state": "driving", "route_tags": ["highway"], "destination_tags": ["resort"],
                "child_present": True, "multiple_passengers": False,
            },
            "preference": {
                "oshi_registered": True, "oshi_mode": "on",
                "oshi_artists": [
                    {"artist_id": "synthetic-artist-1003", "enthusiasm": 0.4, "oshi_type": "artist"},
                    {"artist_id": "synthetic-artist-9002", "enthusiasm": 0.9, "oshi_type": "artist"},
                ],
                "hobby_interest_tags": ["anime-fan"],
                "age_band": "20s",
            },
            "history": {},
            "current_scene": "monotony:medium",
            "genre_affinity_v1": {
                "artist_genres": {
                    "synthetic-artist-1003": ["j-rock"],
                    "synthetic-artist-9002": ["j-rock"],
                },
                "usage_by_genre": {"j-rock": "high", "city pop": "med"},
                "scene_genre_usage": {"monotony:medium": {"j-rock": "high"}},
            },
        },
        hyperparameters={**default_hp, "plan_item_count": 4},
    )))

    # 3. full_karaoke_stopped_directional_keep_alert — full_karaoke, stopped
    # (required), directional_hypothesis="keep_alert" (flips fatigue/
    # traffic/night alphas; the default "soothe_destress" never flips, only
    # exercised by cases that DON'T override it, e.g. case 1/2 above).
    # oshi_registered=True but oshi_mode="off" -> gate=0, the SECOND distinct
    # oshi gate=0 shape (case 1 was registered=False; this one is
    # mode=off). service_ease -> full_karaoke_ease. plan_item_count=4 over 6
    # -> tail of 2.
    cat3 = smoke_catalog()
    cases.append(("full_karaoke_stopped_directional_keep_alert", base_context(
        selected_service_id="full_karaoke",
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        feature_snapshot={
            "catalog": cat3,
            "situation": {
                "drowsiness_level": 20, "fatigue_level": 60, "monotony_level": 20,
                "traffic_state": "congested", "road_type": "mountain", "night_state": "night",
                "motion_state": "stopped", "route_tags": [], "destination_tags": [],
                "child_present": False, "multiple_passengers": True,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {},
        },
        hyperparameters={**default_hp, "plan_item_count": 4, "directional_hypothesis": "keep_alert"},
    )))

    # 4. full_karaoke_driving_refused — full_karaoke while still driving ->
    # decision_type "full_karaoke_requires_stopped" BEFORE any scoring; mode
    # still reflects full_karaoke's own plan_mode (stopped_only/
    # simulated_queue True) even though the decision blocked.
    cases.append(("full_karaoke_driving_refused", base_context(
        selected_service_id="full_karaoke",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))

    # 5. invalid_request_missing_service — selected_service_id is None ->
    # decision_type "invalid_request"; mode/selected_service_id fall back to
    # "music_playlist" (service_id not in _MUSIC_SERVICES).
    cases.append(("invalid_request_missing_service", base_context(
        selected_service_id="music_playlist",  # placeholder for allowed_service_ids
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))
    cases[-1] = (cases[-1][0], {**cases[-1][1], "selected_service_id": None})

    # 6. unsupported_recipe — selected_service_id is a non-music recipe ->
    # decision_type "unsupported_recipe"; same fallback mode as case 5.
    cases.append(("unsupported_recipe", base_context(
        selected_service_id="music_playlist",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))
    cases[-1] = (cases[-1][0], {**cases[-1][1], "selected_service_id": "quiz"})

    # 7. invalid_catalog_unknown_candidate — an eligible_candidate id that is
    # NOT a key in feature_snapshot.catalog -> _CatalogError caught ->
    # decision_type "invalid_catalog". excluded_items on THIS path is always
    # [] (the _error() helper never merges in the partially-accumulated
    # excluded_items — a real divergence-prone detail, see the port's module
    # doc), verified even though excluded_candidates is non-empty below.
    cases.append(("invalid_catalog_unknown_candidate", base_context(
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "stopped"}},
        eligible_candidates=[{"candidate_id": "synthetic-track-DOES-NOT-EXIST"}],
        excluded_candidates=[{"candidate_id": "some-other-id", "platform_reason": "not_available_this_trip"}],
    )))

    # 8. invalid_catalog_missing_audio_field — one song's spotify_audio_features
    # is missing a required field (energy) -> _CatalogError from
    # _audio_components, caught -> decision_type "invalid_catalog" (a
    # DIFFERENT raise site than case 7, same outer except/decision_type).
    cat8 = smoke_catalog()
    del cat8["synthetic-track-1001"]["spotify_audio_features"]["energy"]
    cases.append(("invalid_catalog_missing_audio_field", base_context(
        feature_snapshot={"catalog": cat8, "situation": {"motion_state": "stopped"}},
    )))

    # 9. invalid_configuration_zero_denominator — content_category_weights
    # all zeroed -> raw_total <= 0 -> _ConfigError caught -> decision_type
    # "invalid_configuration".
    hp_zero = copy.deepcopy(default_hp)
    hp_zero["content_category_weights"] = {"Situation": 0.0, "Preference": 0.0, "History": 0.0}
    cases.append(("invalid_configuration_zero_denominator", base_context(
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "stopped"}},
        hyperparameters=hp_zero,
    )))

    # 10. insufficient_eligible_items — 3 candidates (1 explicitly excluded
    # via not_playable, so excluded_items carries a REAL entry -- unlike
    # cases 7-9's always-[] excluded_items, this path's excluded_items IS the
    # accumulated list), default plan_item_count=5 -> only 2 scored ->
    # decision_type "insufficient_eligible_items".
    cat10 = smoke_catalog()
    small10 = {k: cat10[k] for k in ["synthetic-track-1001", "synthetic-track-1002", "synthetic-track-1003"]}
    small10["synthetic-track-1002"]["spotify_track"]["is_playable"] = False
    cases.append(("insufficient_eligible_items", base_context(
        feature_snapshot={"catalog": small10, "situation": {"motion_state": "stopped"}},
    )))

    # 11. no_proposal_all_excluded — every catalog song not_playable ->
    # decision_type "no_proposal"; excluded_items = context-provided
    # excluded_candidates PASSTHROUGH ++ the 6 catalog-loop exclusions (the
    # Python dict-union `_error(...) | {"excluded_items": ...}` merge).
    cat11 = smoke_catalog()
    for song in cat11.values():
        song["spotify_track"]["is_playable"] = False
    cases.append(("no_proposal_all_excluded", base_context(
        feature_snapshot={"catalog": cat11, "situation": {"motion_state": "stopped"}},
        excluded_candidates=[{"candidate_id": "ext-1", "platform_reason": "not_available_this_trip"}],
    )))

    # 12. eligibility_reasons_bundle — one case exercising EVERY
    # eligibility_reasons() branch at once (algorithm.py:484-522, exact
    # append order): explicit_under_child (1001), not_playable (1002),
    # market_unavailable (1003), restricted (1004), recent_skip (1005),
    # older_skip -- scored -0.5, NOT excluded -- + duplicate (1006, listed
    # twice), identity_mismatch (a fresh clone, 1099: audio_features
    # duration_ms deliberately differs from spotify_track duration_ms).
    # Exactly ONE clean candidate (1006) remains -> plan_item_count=1 ->
    # decision_type "complete_plan" with an EMPTY scored_tail (the
    # "everything scored was picked" branch, distinct from case 1's non-empty
    # tail) despite 7 of 8 listed candidates being excluded.
    cat12 = smoke_catalog()
    cat12["synthetic-track-1001"]["spotify_track"]["explicit"] = True
    cat12["synthetic-track-1002"]["spotify_track"]["is_playable"] = False
    cat12["synthetic-track-1003"]["spotify_track"]["available_markets"] = ["US"]
    cat12["synthetic-track-1004"]["spotify_track"]["restrictions"] = {"reason": "market"}
    clone99 = copy.deepcopy(cat12["synthetic-track-1001"])
    clone99["spotify_track"]["id"] = "synthetic-track-1099"
    clone99["spotify_track"]["uri"] = "spotify:track:synthetic-track-1099"
    clone99["spotify_track"]["explicit"] = False
    clone99["spotify_audio_features"]["id"] = "synthetic-track-1099"
    clone99["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-1099"
    clone99["spotify_audio_features"]["duration_ms"] = 999999  # != spotify_track.duration_ms -> identity_mismatch
    cat12["synthetic-track-1099"] = clone99
    cases.append(("eligibility_reasons_bundle", base_context(
        feature_snapshot={
            "catalog": cat12,
            "market": "JP",
            "situation": {
                "drowsiness_level": 60, "fatigue_level": 20, "monotony_level": 30,
                "traffic_state": "normal", "road_type": "local", "night_state": "day",
                "motion_state": "driving", "child_present": True,
            },
            "preference": {
                "skipped_items": [
                    {"track_id": "synthetic-track-1005", "skipped_at": "2026-07-14T21:50:00Z"},  # 20 min before -> in-window
                    {"track_id": "synthetic-track-1006", "skipped_at": "2026-06-01T00:00:00Z"},   # weeks before -> older, scored
                ],
            },
            "history": {},
        },
        eligible_candidates=[
            {"candidate_id": "synthetic-track-1001"},
            {"candidate_id": "synthetic-track-1002"},
            {"candidate_id": "synthetic-track-1003"},
            {"candidate_id": "synthetic-track-1004"},
            {"candidate_id": "synthetic-track-1005"},
            {"candidate_id": "synthetic-track-1006"},
            {"candidate_id": "synthetic-track-1006"},
            {"candidate_id": "synthetic-track-1099"},
        ],
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 13. humming_unavailable_excluded — humming_karaoke, one song flagged
    # humming_karaoke_available=0 -> excluded "humming_unavailable";
    # plan_item_count=3 over 5 remaining -> tail of 2. Fix round 1: also
    # carries `road_type: "parking"` — a real, distinct entry in
    # context_response_matrix.road (alpha=0, beta=0, package.json), never
    # exercised by any other case (which use highway/mountain/local, or omit
    # road_type entirely -> "local" default).
    cat13 = smoke_catalog()
    cat13["synthetic-track-1001"]["simulation_flags"]["humming_karaoke_available"] = 0
    cases.append(("humming_unavailable_excluded", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": cat13, "situation": {"motion_state": "driving", "road_type": "parking"}},
        hyperparameters={**default_hp, "plan_item_count": 3},
    )))

    # 14. full_karaoke_available_flag_excluded — full_karaoke (stopped), one
    # song flagged full_karaoke_available=0 -> excluded
    # "full_karaoke_unavailable"; plan_item_count=3 over 5 remaining -> tail
    # of 2. Fix round 1: also carries an UNRECOGNIZED `road_type` (not one of
    # highway/local/mountain/parking) -> `crm["road"].get(rtype, {"alpha":
    # 0.0, "beta": 0.0})`'s fallback-default branch (algorithm.py:278),
    # distinct from "parking" above (a real, present table entry).
    cat14 = smoke_catalog()
    cat14["synthetic-track-1002"]["simulation_flags"]["full_karaoke_available"] = 0
    cases.append(("full_karaoke_available_flag_excluded", base_context(
        selected_service_id="full_karaoke",
        feature_snapshot={"catalog": cat14, "situation": {"motion_state": "stopped", "road_type": "not_a_real_road_type"}},
        hyperparameters={**default_hp, "plan_item_count": 3},
    )))

    # 15. lighting_mid_cue — deterministic: exactly ONE eligible/scored song
    # (trivially chosen[0]) with a hand-tuned trait valence in
    # [low_threshold, high_threshold) = [0.33, 0.66) (valence=0.60, mode=0 ->
    # trait valence = 0.65*0.60 + 0.35*0 = 0.39) -> _lighting()'s "mid_cue"
    # branch, the one lighting cue band not naturally reached by the other
    # humming/full_karaoke cases above (their smoke-catalog songs' valence
    # traits cluster at the high/low extremes).
    cat15 = smoke_catalog()
    only15 = {"synthetic-track-1005": cat15["synthetic-track-1005"]}
    only15["synthetic-track-1005"]["spotify_audio_features"]["valence"] = 0.60
    only15["synthetic-track-1005"]["spotify_audio_features"]["mode"] = 0
    cases.append(("lighting_mid_cue", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": only15, "situation": {"motion_state": "driving"}},
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 16. real_dataset_slice — the first 10 songs of the real, committed
    # dataset catalog (proposal_contracts/dataset/soundcharts-grounded-.../
    # catalog.json, 300 songs total; see the module comment above this
    # function for the bound and the reasoning), with a matching slice of
    # genre_affinity_v1.json (only artist ids credited on those 10 songs).
    # genre_affinity_v1 extension ON but WITHOUT populating route_tags/
    # destination_tags/hobby_interest_tags/usage_by_genre/scene_genre_usage
    # -> the genre-on-but-NO-match branch for route/destination/hobbies/
    # genre_usage/scene_genre (distinct from case 2's genre-on-WITH-match).
    # oshi ON with a registered artist NOT credited on any of the 10 sliced
    # songs -> gate=1 but affinity=0 (matched=[]) -- the THIRD distinct oshi
    # shape (cases 1/3 were gate=0; case 2 was gate=1 WITH a match; this is
    # gate=1 WITHOUT one).
    real_catalog_path = _REPO / "proposal_contracts" / "dataset" / "soundcharts-grounded-spotify-compatible-demonstration-seed-1042" / "catalog.json"
    real_genre_path = _REPO / "proposal_contracts" / "dataset" / "soundcharts-grounded-spotify-compatible-demonstration-seed-1042" / "genre_affinity_v1.json"
    real_songs = _load_json(real_catalog_path)[:10]
    real_catalog = {song["spotify_track"]["id"]: song for song in real_songs}
    real_artist_ids = {
        artist["id"]
        for song in real_songs
        for artist in song["spotify_track"].get("artists", [])
        if artist.get("id")
    }
    real_genre_raw = _load_json(real_genre_path)
    real_genre_slice = {
        "artist_genres": {
            aid: genres for aid, genres in real_genre_raw["artist_genres"].items() if aid in real_artist_ids
        },
    }
    cases.append(("real_dataset_slice", base_context(
        selected_service_id="music_playlist",
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        enabled_feature_extensions=["genre_affinity_v1"],
        feature_snapshot={
            "catalog": real_catalog,
            "situation": {
                "drowsiness_level": 45, "fatigue_level": 25, "monotony_level": 35,
                "traffic_state": "normal", "road_type": "highway", "night_state": "night",
                "motion_state": "driving", "child_present": False, "multiple_passengers": False,
            },
            "preference": {
                "oshi_registered": True, "oshi_mode": "on",
                "oshi_artists": [{"artist_id": "synthetic-artist-9999-not-credited", "enthusiasm": 1.0, "oshi_type": "artist"}],
                "age_band": "40s",
            },
            "history": {},
            "genre_affinity_v1": real_genre_slice,
        },
        catalog_version="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        hyperparameters={**default_hp, "plan_item_count": 5},
    )))

    # 17. tie_break_item_fit_clone — two BIT-FOR-BIT identical songs (a clone
    # with a different track id, no preference/history table entries for
    # either) -> identical item_fit -> forces the
    # `(-item_fit, track_id)` tuple tie-break (divergence hazard 2).
    # track_id ascending must place "synthetic-track-1005" ahead of its
    # "synthetic-track-1005-clone".
    cat17 = smoke_catalog()
    base_song = cat17["synthetic-track-1005"]
    clone17 = copy.deepcopy(base_song)
    clone17["spotify_track"]["id"] = "synthetic-track-1005-clone"
    clone17["spotify_track"]["uri"] = "spotify:track:synthetic-track-1005-clone"
    clone17["spotify_audio_features"]["id"] = "synthetic-track-1005-clone"
    clone17["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-1005-clone"
    cases.append(("tie_break_item_fit_clone", base_context(
        feature_snapshot={
            "catalog": {"synthetic-track-1005": base_song, "synthetic-track-1005-clone": clone17},
            "situation": {"drowsiness_level": 50, "motion_state": "driving"},
        },
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 18. lighting_low_cue — same deterministic single-song technique as
    # lighting_mid_cue, but tuned for top_valence <= low_threshold (0.33):
    # valence=0.10, mode=0 -> trait valence = 0.65*0.10 + 0.35*0 = 0.065.
    # None of the other humming/full_karaoke cases land here naturally (their
    # smoke-catalog songs' traits cluster at the high extreme once the
    # winning candidate is picked) -> closes the third and last
    # `_lighting()` cue band (high/mid already covered above).
    cat18b = smoke_catalog()
    only18b = {"synthetic-track-1002": cat18b["synthetic-track-1002"]}
    only18b["synthetic-track-1002"]["spotify_audio_features"]["valence"] = 0.10
    only18b["synthetic-track-1002"]["spotify_audio_features"]["mode"] = 0
    cases.append(("lighting_low_cue", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": only18b, "situation": {"motion_state": "driving"}},
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 19. purpose_multiplier_fallback — resolve_weights's
    # `multipliers.get(subgroup, {}).get(purpose, 1.0)` (algorithm.py:146) is
    # a SAFE, defaulted read (never a raise) that none of cases 1-17 reach:
    # the package's own default purpose_multipliers table is complete for all
    # 4 purposes x every subgroup, so `.get(purpose, 1.0)` always finds a
    # REAL entry in every other case. Here the driver_state/route_music entry
    # (0.90 by default, deliberately NOT 1.0 so the fallback is observable)
    # is deleted via an hp override -> drowsiness/fatigue's purpose_multiplier
    # must come back as the bare default 1.0 instead.
    #
    # Fix round 1: this case ALSO deletes the "changed" leaf's "mask" key
    # entirely from hierarchy_weights (Preference/operations/changed) ->
    # `leaf_def.get("mask", 0)` (algorithm.py:140) must fall back to 0 ->
    # "changed_from_items" is excluded from scored_leaves entirely (distinct
    # from every other case, where it is always explicitly mask=1 and lands
    # "active"/"missing_neutral" -> here it must land "context_only" instead,
    # the disposition classification only reachable when a leaf's own
    # feature_id is absent from scored_fids).
    hp_pmult = copy.deepcopy(default_hp)
    del hp_pmult["purpose_multipliers"]["driver_state"]["route_music"]
    del hp_pmult["hierarchy_weights"]["Preference"]["operations"]["leaves"]["changed"]["mask"]
    cases.append(("purpose_multiplier_fallback", base_context(
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving", "drowsiness_level": 50}},
        hyperparameters=hp_pmult,
    )))

    # 20. oshi_registered_on_empty_artists — preference.oshi_registered=True,
    # oshi_mode="on", but oshi_artists=[] (empty list -> by_id stays empty)
    # -> gate=0 via a DIFFERENT path than cases 1 (registered=False) or 3
    # (mode="off"): here BOTH registered and mode_on are truthy, only the
    # emptiness of by_id makes the `registered and mode_on and by_id` gate
    # condition false (algorithm.py:363).
    cases.append(("oshi_registered_on_empty_artists", base_context(
        feature_snapshot={
            "catalog": smoke_catalog(),
            "situation": {"motion_state": "stopped", "drowsiness_level": 40},
            "preference": {"oshi_registered": True, "oshi_mode": "on", "oshi_artists": []},
        },
        hyperparameters={**default_hp, "plan_item_count": 2},
    )))

    # 21. all_neutral_rationale — a fully "quiet" input (no contrivance: every
    # situation flag at its neutral/default value, no oshi, no age band, no
    # history) makes EVERY scored leaf's contribution exactly 0.0 for EVERY
    # candidate (drowsiness/fatigue/monotony/traffic/night/motion all have
    # e_i=0 at these values; "road" has e_i=1 but road_type="highway" has
    # alpha=beta=0 -> a_i=0 regardless of trait values; oshi/age/item_usage/
    # played/skipped/changed/acceptance/recovery all read absent
    # preference/history -> e_i=0; genre leaves are masked off entirely,
    # extension OFF) -> `_build_reasons`'s `pos`/`neg` lists both end up
    # empty -> the "中立的なスコア。 / Neutral score." fallback (algorithm.py:
    # 578-579), never otherwise reached in this case set. Also incidentally a
    # 6-way item_fit tie (every smoke-catalog song scores exactly 0.0),
    # exercising the tuple tie-break again on a much wider tie than case 17.
    cases.append(("all_neutral_rationale", base_context(
        feature_snapshot={
            "catalog": smoke_catalog(),
            "situation": {
                "drowsiness_level": 0, "fatigue_level": 0, "monotony_level": 0,
                "traffic_state": "normal", "road_type": "highway", "night_state": "day",
                "motion_state": "stopped",
            },
            "preference": {},
            "history": {},
        },
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    spec = importlib.util.spec_from_file_location(
        "aica_content_selector_v1_algorithm", _PACKAGES_DIR / pkg_id / "algorithm.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    results = []
    for name, ctx in cases:
        decision = evaluate(ctx)
        results.append({"name": name, "decision": decision})

    # Self-checks: this fixture set only earns its keep if it actually
    # discriminates the branches the report claims it does.
    by_name = {r["name"]: r["decision"] for r in results}
    assert by_name["baseline_complete_plan"]["decision_type"] == "complete_plan"
    assert len(by_name["baseline_complete_plan"]["scored_tail"]) == 1

    def _contrib(decision, track_id, feature_id):
        rows = decision["ordered_items"] + [
            {"item_id": t["item_id"], "feature_contributions": t["feature_contributions"]}
            for t in decision.get("scored_tail", [])
        ]
        for it in rows:
            if it["item_id"] == track_id:
                for c in it["feature_contributions"]:
                    if c["feature_id"] == feature_id:
                        return c
        raise AssertionError(f"{track_id}/{feature_id} not found in decision")

    baseline = by_name["baseline_complete_plan"]
    # played_items time buckets (algorithm.py:434-452, history_curves.played
    # default {le_30m:-1.0, today:-0.5, le_7d:-0.25, else:0.0}). le_30m/today/
    # le_7d are numerically distinctive; "else" coincides with 0.0 (the same
    # value an ABSENT played_items entry would produce) -- asserted anyway
    # because the underlying delta-threshold computation still has to land on
    # the right branch for parity to hold (a wrong threshold could just as
    # easily have landed on le_7d's -0.25), even though this specific value
    # can't visually prove which branch fired on its own.
    assert _contrib(baseline, "synthetic-track-1001", "played_items")["e_i"] == -1.0
    assert _contrib(baseline, "synthetic-track-1002", "played_items")["e_i"] == -0.5
    assert _contrib(baseline, "synthetic-track-1004", "played_items")["e_i"] == -0.25
    assert _contrib(baseline, "synthetic-track-1006", "played_items")["e_i"] == 0.0
    # _era_bucket shapes (algorithm.py:189-206). age_band="30s" throughout.
    # pre1980 (-0.3) is numerically distinctive. 1980s's affinity for "30s"
    # happens to be exactly 0.0 (package.json's own age_era_affinity table) --
    # e_i=1.0 (band&&era both resolved) still distinguishes it from the
    # "band absent"/"era unresolvable" shapes, which are e_i=0.0.
    pre1980_age = _contrib(baseline, "synthetic-track-1002", "age_band")
    assert pre1980_age["e_i"] == 1.0 and pre1980_age["a_i"] == -0.3, pre1980_age
    unresolvable_age = _contrib(baseline, "synthetic-track-1004", "age_band")
    assert unresolvable_age["e_i"] == 0.0 and unresolvable_age["a_i"] == 0.0, unresolvable_age
    era1980s_age = _contrib(baseline, "synthetic-track-1006", "age_band")
    assert era1980s_age["e_i"] == 1.0 and era1980s_age["a_i"] == 0.0, era1980s_age
    assert by_name["humming_genre_oshi_on"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_stopped_directional_keep_alert"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_driving_refused"]["decision_type"] == "full_karaoke_requires_stopped"
    assert by_name["invalid_request_missing_service"]["decision_type"] == "invalid_request"
    assert by_name["unsupported_recipe"]["decision_type"] == "unsupported_recipe"
    assert by_name["invalid_catalog_unknown_candidate"]["decision_type"] == "invalid_catalog"
    assert by_name["invalid_catalog_unknown_candidate"]["excluded_items"] == []
    assert by_name["invalid_catalog_missing_audio_field"]["decision_type"] == "invalid_catalog"
    assert by_name["invalid_configuration_zero_denominator"]["decision_type"] == "invalid_configuration"
    assert by_name["insufficient_eligible_items"]["decision_type"] == "insufficient_eligible_items"
    assert len(by_name["insufficient_eligible_items"]["excluded_items"]) == 1
    assert by_name["no_proposal_all_excluded"]["decision_type"] == "no_proposal"
    assert len(by_name["no_proposal_all_excluded"]["excluded_items"]) == 7
    bundle = by_name["eligibility_reasons_bundle"]
    assert bundle["decision_type"] == "complete_plan"
    assert bundle["scored_tail"] == []
    assert bundle["ordered_items"][0]["item_id"] == "synthetic-track-1006"
    bundle_reasons = {e["item_id"]: e["reason_codes"] for e in bundle["excluded_items"]}
    assert bundle_reasons["synthetic-track-1001"] == ["explicit_under_child"]
    assert bundle_reasons["synthetic-track-1002"] == ["not_playable"]
    assert bundle_reasons["synthetic-track-1003"] == ["market_unavailable"]
    assert bundle_reasons["synthetic-track-1004"] == ["restricted"]
    assert bundle_reasons["synthetic-track-1005"] == ["recent_skip"]
    assert bundle_reasons["synthetic-track-1099"] == ["identity_mismatch"]
    assert by_name["humming_unavailable_excluded"]["decision_type"] == "complete_plan"
    assert any(e["item_id"] == "synthetic-track-1001" and e["reason_codes"] == ["humming_unavailable"]
               for e in by_name["humming_unavailable_excluded"]["excluded_items"])
    assert by_name["full_karaoke_available_flag_excluded"]["decision_type"] == "complete_plan"
    assert any(e["item_id"] == "synthetic-track-1002" and e["reason_codes"] == ["full_karaoke_unavailable"]
               for e in by_name["full_karaoke_available_flag_excluded"]["excluded_items"])
    mid_cue = by_name["lighting_mid_cue"]["lighting_configuration"]
    assert mid_cue is not None and mid_cue["notes"] == default_hp["lighting_lookup"]["mid_cue"], mid_cue
    low_cue = by_name["lighting_low_cue"]["lighting_configuration"]
    assert low_cue is not None and low_cue["notes"] == default_hp["lighting_lookup"]["low_cue"], low_cue
    assert by_name["real_dataset_slice"]["decision_type"] == "complete_plan"
    tie = by_name["tie_break_item_fit_clone"]
    assert tie["decision_type"] == "complete_plan"
    assert tie["ordered_items"][0]["item_id"] == "synthetic-track-1005"
    assert tie["scored_tail"][0]["item_id"] == "synthetic-track-1005-clone"
    assert abs(tie["ordered_items"][0]["item_fit"] - tie["scored_tail"][0]["item_fit"]) < 1e-15
    pmult_fallback = by_name["purpose_multiplier_fallback"]
    assert pmult_fallback["decision_type"] == "complete_plan"
    for it in pmult_fallback["ordered_items"] + [{"feature_contributions": t["feature_contributions"]} for t in pmult_fallback["scored_tail"]]:
        for c in it["feature_contributions"]:
            if c["feature_id"] == "drowsiness_level":
                assert c["purpose_multiplier"] == 1.0, c
            # mask key-absent default (algorithm.py:140, leaf_def.get("mask",
            # 0)): "changed_from_items" must be ABSENT from every candidate's
            # feature_contributions entirely (masked out, never scored).
            assert c["feature_id"] != "changed_from_items", c
    pmult_active = set(pmult_fallback["algorithm_provenance"]["active_features"])
    pmult_context_only = set(pmult_fallback["algorithm_provenance"]["context_only_features"])
    pmult_missing = set(pmult_fallback["algorithm_provenance"]["missing_features"])
    assert "changed_from_items" not in pmult_active
    assert "changed_from_items" not in pmult_missing
    assert "changed_from_items" in pmult_context_only, (
        "mask key-absent leaf must classify as context_only (never scored), not active/missing_neutral"
    )

    # road_type="parking" (case 13) / an unrecognized road_type (case 14):
    # both a REAL table entry lookup and the `.get(rtype, default)` fallback
    # coincide numerically with highway/local's alpha=0,beta=0 in this
    # package's own data (parking IS defined as alpha=0,beta=0; the inline
    # Python default is ALSO {"alpha":0.0,"beta":0.0}) -- so neither can be
    # visually distinguished from an "absent road_type" contribution by value
    # alone. Asserted only for "doesn't crash / still produces a plan";
    # parity with the real Python capture is what actually proves the two
    # DIFFERENT code paths (real dict hit vs. synthesized fallback) each
    # landed on the correct branch, since a wrong lookup (e.g. accidentally
    # hitting "mountain", alpha=-1) WOULD have produced a visibly different,
    # parity-breaking a_i.
    assert by_name["humming_unavailable_excluded"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_available_flag_excluded"]["decision_type"] == "complete_plan"

    oshi_empty = by_name["oshi_registered_on_empty_artists"]
    assert oshi_empty["decision_type"] == "complete_plan"
    for it in oshi_empty["ordered_items"] + [{"item_id": t["item_id"], "feature_contributions": t["feature_contributions"]} for t in oshi_empty["scored_tail"]]:
        for c in it["feature_contributions"]:
            if c["feature_id"] == "oshi_artists":
                assert c["e_i"] == 0.0 and c["a_i"] == 0.0 and c["matched_artist_ids"] == [], c

    neutral = by_name["all_neutral_rationale"]
    assert neutral["decision_type"] == "complete_plan"
    assert neutral["ordered_items"][0]["item_fit"] == 0.0
    assert neutral["ordered_items"][0]["rationale"] == ["中立的なスコア。 / Neutral score."], neutral["ordered_items"][0]["rationale"]
    assert all(c["contribution"] == 0.0 for c in neutral["ordered_items"][0]["feature_contributions"])

    _write("content_selector", {
        "input": {"cases": [{"name": name, "context": ctx} for name, ctx in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 20. proposal_eligibility (services/proposal_eligibility.resolve_eligibility /
#     derive_registered_entities — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Pure, direct-import capture (no TestClient). `resolve_eligibility` cases 1-2
# and the `derive_registered_entities` cases mirror
# app/api/tests/proposal/test_eligibility_resolver.py's own scenarios
# one-for-one (same POST_REST_ROW, same motion/registration combinations).
# Cases 3-5 fill branch-coverage gaps that Python's OWN test suite does not
# exercise (verified by reading that file in full): rule 3
# (catalog_item_unavailable), rule 1's third branch (screen_dependent_while_
# driving — unreachable via the real committed service_capabilities.v1.json,
# since every screen_dependent service there is either stopped_only or
# background_on_motion; exercised instead via a synthetic single-service
# capabilities table, since `capabilities` is a parameter, not hardwired to
# the committed file), and the fixed multi-reason ordering (motion, then
# entity, then catalog) on one service that trips all three simultaneously.

def _capture_eligibility() -> None:
    from aica_api.models.proposal.enums import MotionState, ServiceId
    from aica_api.models.proposal.service_capabilities import ServiceCapabilities, ServiceCapability
    from aica_api.services.proposal_eligibility import derive_registered_entities, resolve_eligibility

    capabilities_path = _REPO / "proposal_contracts" / "service_capabilities" / "service_capabilities.v1.json"
    capabilities = ServiceCapabilities.load(capabilities_path)

    post_rest_row = [
        ServiceId.live_viewing, ServiceId.stretch_video, ServiceId.full_karaoke,
        ServiceId.oshi_reexperience, ServiceId.call_response_stopped,
    ]

    cases: list[tuple[str, dict, object]] = []

    r1 = resolve_eligibility(post_rest_row, MotionState.driving, capabilities, registered_entities=set())
    cases.append(("post_rest_driving_no_oshi", {
        "allowed_service_ids": [s.value for s in post_rest_row],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": [],
    }, r1))

    r2 = resolve_eligibility(post_rest_row, MotionState.stopped, capabilities, registered_entities={"oshi"})
    cases.append(("post_rest_stopped_with_oshi", {
        "allowed_service_ids": [s.value for s in post_rest_row],
        "motion_state": "stopped",
        "registered_entities": ["oshi"],
        "unavailable_service_ids": [],
    }, r2))

    r3 = resolve_eligibility(
        [ServiceId.music_playlist, ServiceId.quiz], MotionState.stopped, capabilities,
        registered_entities=set(), unavailable_service_ids={"quiz"},
    )
    cases.append(("unavailable_catalog_item", {
        "allowed_service_ids": ["music_playlist", "quiz"],
        "motion_state": "stopped",
        "registered_entities": [],
        "unavailable_service_ids": ["quiz"],
    }, r3))

    synthetic_service = ServiceCapability(
        service_id=ServiceId.music_playlist, driving_capable=True, screen_dependent=True,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage",
        services={ServiceId.music_playlist: synthetic_service},
    )
    r4 = resolve_eligibility([ServiceId.music_playlist], MotionState.driving, synthetic_caps, registered_entities=set())
    cases.append(("screen_dependent_while_driving_synthetic", {
        "allowed_service_ids": ["music_playlist"],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": [],
        "synthetic_capabilities": {
            "capabilities_version": "synthetic-branch-coverage",
            "services": [json.loads(synthetic_service.model_dump_json())],
        },
    }, r4))

    r5 = resolve_eligibility(
        [ServiceId.oshi_reexperience], MotionState.driving, capabilities,
        registered_entities=set(), unavailable_service_ids={"oshi_reexperience"},
    )
    cases.append(("combined_all_three_reasons_ordering", {
        "allowed_service_ids": ["oshi_reexperience"],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": ["oshi_reexperience"],
    }, r5))

    results = [{"name": name, "output": json.loads(r.model_dump_json())} for name, _inp, r in cases]

    derive_cases: list[tuple[str, object]] = [
        ("typed_nested_true", {"feature_snapshot": {"preference": {"oshi_registered": True}}}),
        ("typed_nested_false", {"feature_snapshot": {"preference": {"oshi_registered": False}}}),
        ("legacy_flat_true", {"feature_snapshot": {"oshi_registered": True}}),
        ("legacy_flat_false", {"feature_snapshot": {"oshi_registered": False}}),
        ("no_feature_snapshot_key", {}),
        ("empty_feature_snapshot", {"feature_snapshot": {}}),
        ("none_world_snapshot", None),
    ]
    derive_results = [
        {"name": name, "registered_entities": sorted(derive_registered_entities(ws))}
        for name, ws in derive_cases
    ]

    _write("proposal_eligibility", {
        "input": {
            "cases": [{"name": name, **inp} for name, inp, _r in cases],
            "derive_cases": [{"name": name, "world_snapshot": ws} for name, ws in derive_cases],
        },
        "output": {"results": results, "derive_results": derive_results},
    })


# ---------------------------------------------------------------------------
# 21. algorithm_config (services/algorithm_config.merge_algorithm_config — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Pure dict deep-merge. Cases 1-7 mirror
# app/api/tests/proposal/test_config_override_merge.py's own scenarios
# one-for-one; case 4 is grounded in a REAL package's default hyperparameters
# (aica_transparent_service_selector_v1's own nested hierarchy_weights)
# rather than a synthetic literal, per the task's "driven from committed
# data" instruction.

def _capture_algorithm_config() -> None:
    from aica_api.services.algorithm_config import merge_algorithm_config

    pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_service_selector_v1" / "package.json")
    real_defaults = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}

    cases: list[tuple[str, dict, object]] = []
    cases.append(("none_override", real_defaults, None))
    cases.append(("empty_dict_override", real_defaults, {}))
    cases.append(("top_level_scalar_override", {"directional_hypothesis": "soothe", "other_key": "unchanged"}, {"directional_hypothesis": "keep_alert"}))
    cases.append(("nested_dict_merge_real_hierarchy", real_defaults, {"hierarchy_weights": {"Situation": {"share": 0.01}}}))
    cases.append(("non_dict_override_replaces_dict_default", real_defaults, {"hierarchy_weights": "not-a-dict-anymore"}))
    cases.append(("list_override_replaces_wholesale", {"tags": ["a", "b", "c"]}, {"tags": ["z"]}))
    cases.append(("new_key_added", {"a": 1}, {"b": 2}))
    cases.append((
        "deep_nested_merge_siblings_untouched",
        {
            "hierarchy_weights": {
                "Preference": {"upro_oshi": {"leaves": {
                    "age": {"feature_id": "age_band", "mask": 1, "share": 0.2},
                    "oshi": {"feature_id": "oshi_id", "mask": 1, "share": 0.3},
                }}}
            },
            "norm_bounds": {"loudness_min": -60},
        },
        {"hierarchy_weights": {"Preference": {"upro_oshi": {"leaves": {"age": {"share": 0.35}}}}}},
    ))

    results = []
    for name, defaults, overrides in cases:
        merged = merge_algorithm_config(defaults, overrides)
        results.append({"name": name, "merged": merged})

    _write("algorithm_config", {
        "input": {"cases": [{"name": name, "defaults": defaults, "overrides": overrides} for name, defaults, overrides in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 22. world_validation (services/world_validation.validate_world — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Direct import over a real committed seed (seed-night-highway-oshi) + the
# real dataset catalog it references. Cases mirror
# app/api/tests/proposal/test_world_validation.py's own scenarios
# one-for-one (mutating an already-validated World in place — the same
# "invalid but in-memory" manufacturing technique that test file uses, since
# these models don't set validate_assignment), plus two extra cases
# (percent-map range violation, enthusiasm-grid violation) strengthening
# rule 1's "numeric ranges" bucket beyond the two fields Python's own suite
# happens to pick.

def _capture_world_validation() -> None:
    from aica_api.models.proposal.enums import ServiceId, TriggerPurpose, UsageLevel
    from aica_api.models.proposal.song_schema import Song
    from aica_api.models.proposal.world import ChangedFromItem, PlayedItem, SkippedItem, World
    from aica_api.services.world_seed_store import WorldSeedStore
    from aica_api.services.world_validation import validate_world

    dataset_id = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
    dataset_dir = _REPO / "proposal_contracts" / "dataset" / dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    base_seed = seed_store.get_seed("seed-night-highway-oshi")
    assert base_seed is not None
    base_world_dict = base_seed.world.model_dump(mode="json")

    def fresh_world() -> World:
        return World.model_validate(json.loads(json.dumps(base_world_dict)))

    cases: list[tuple[str, dict, list]] = []

    def add(name: str, mutate) -> None:
        world = fresh_world()
        mutate(world)
        issues = validate_world(world, catalog)
        cases.append((name, json.loads(world.model_dump_json()), [json.loads(i.model_dump_json()) for i in issues]))

    add("valid_world_no_issues", lambda w: None)
    add("out_of_range_int", lambda w: setattr(w.situation, "drowsiness_level", 150))
    add("invalid_enum_member", lambda w: setattr(w.situation, "traffic_state", "bogus-state"))
    add("incompatible_purpose_stage", lambda w: setattr(w.control_inputs, "trigger_purpose", TriggerPurpose.route_music))
    add("unknown_oshi_artist_id", lambda w: setattr(w.driver_profile.oshi_artists[0], "artist_id", "synthetic-artist-DOES-NOT-EXIST"))

    def mutate_played_item(w: World) -> None:
        w.driver_profile.played_items = [
            PlayedItem(track_id="synthetic-track-DOES-NOT-EXIST", last_played_at="2026-07-16T10:00:00Z")
        ]
    add("unknown_played_item_track_id", mutate_played_item)

    def mutate_usage_level(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-NOPE": UsageLevel.high}
    add("unknown_catalog_item_usage_level_key", mutate_usage_level)

    def mutate_multiple(w: World) -> None:
        w.situation.drowsiness_level = 999
        w.driver_profile.oshi_artists[0].artist_id = "synthetic-artist-DOES-NOT-EXIST"
    add("multiple_violations_all_reported", mutate_multiple)

    def mutate_percent_map(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {ServiceId.music_playlist: 150}
    add("percent_map_out_of_range", mutate_percent_map)

    def mutate_enthusiasm_grid(w: World) -> None:
        w.driver_profile.oshi_artists[0].enthusiasm = 0.35
    add("enthusiasm_not_on_grid", mutate_enthusiasm_grid)

    def mutate_duplicate_oshi(w: World) -> None:
        a = w.driver_profile.oshi_artists[0]
        w.driver_profile.oshi_artists = [a, a.model_copy()]
    add("duplicate_oshi_artist_id", mutate_duplicate_oshi)

    # --- fix round 1: service_usage_level / service_recency_state /
    # scene_service_usage_level (live-scored inputs to the service selector's
    # resolve_direct_evidence, per algorithm.py:535-558 — confirmed via grep,
    # not assumed). Built-in dict[K, V] validation, NOT a custom
    # field_validator: checks BOTH key (ServiceId) and value (the enum), and
    # reports EVERY invalid entry, not just the first.

    def mutate_service_usage_level_bad_key(w: World) -> None:
        w.driver_profile.service_usage_level = {"not_a_service": "high"}
    add("service_usage_level_bad_key", mutate_service_usage_level_bad_key)

    def mutate_service_usage_level_bad_value(w: World) -> None:
        w.driver_profile.service_usage_level = {"music_playlist": "bogus_level"}
    add("service_usage_level_bad_value", mutate_service_usage_level_bad_value)

    def mutate_service_recency_state_bad_key(w: World) -> None:
        w.driver_profile.service_recency_state = {"not_a_service": "recent"}
    add("service_recency_state_bad_key", mutate_service_recency_state_bad_key)

    def mutate_service_recency_state_bad_value(w: World) -> None:
        w.driver_profile.service_recency_state = {"music_playlist": "bogus_recency"}
    add("service_recency_state_bad_value", mutate_service_recency_state_bad_value)

    def mutate_scene_service_usage_level_bad_inner(w: World) -> None:
        w.driver_profile.scene_service_usage_level = {
            "scene_a": {"music_playlist": "bogus"},
            "scene_b": {"not_a_service": "high"},
        }
    add("scene_service_usage_level_bad_inner", mutate_scene_service_usage_level_bad_inner)

    def mutate_service_usage_level_multiple_bad(w: World) -> None:
        # Proves ALL invalid entries are reported (not just the first) —
        # the divergence risk that makes this a built-in-type-validation
        # field genuinely different from the custom-validator rate maps
        # above (which raise on first violation only).
        w.driver_profile.service_usage_level = {"music_playlist": "bogus1", "quiz": "bogus2"}
    add("service_usage_level_multiple_bad_entries", mutate_service_usage_level_multiple_bad)

    def mutate_gate_interaction(w: World) -> None:
        # Proves the SAME model-validator skip-on-field-failure gate already
        # verified for the rate maps also holds for these built-in-validated
        # fields: a service_usage_level entry error blocks the sibling
        # duplicate-oshi-id model validator from firing, even though a
        # genuine duplicate is also present.
        a = w.driver_profile.oshi_artists[0]
        w.driver_profile.oshi_artists = [a, a.model_copy()]
        w.driver_profile.service_usage_level = {"music_playlist": "bogus"}
    add("service_usage_level_error_blocks_duplicate_check", mutate_gate_interaction)

    # --- fix round 2: catalog_item_usage_level's dict VALUE (a UsageLevel).
    # disposition:scored for the content selector (packages/
    # aica_transparent_content_selector_v1/algorithm.py:396, grep-verified) —
    # the residual gap named at the end of fix round 1's report. The KEY here
    # is an UNCONSTRAINED str (a track id), unlike service_usage_level's
    # ServiceId-typed key — so no `.[key]` marker branch applies to this field.

    def mutate_catalog_item_usage_level_bad_value(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-0001": "bogus_level"}
    add("catalog_item_usage_level_bad_value", mutate_catalog_item_usage_level_bad_value)

    def mutate_catalog_item_usage_level_multiple_bad(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {
            "synthetic-track-0001": "bogus1",
            "synthetic-track-0002": "bogus2",
        }
    add("catalog_item_usage_level_multiple_bad_entries", mutate_catalog_item_usage_level_multiple_bad)

    def mutate_catalog_item_usage_level_bad_value_and_unknown_ref(w: World) -> None:
        # Same key is BOTH an enum-invalid value (rule 1) AND an unknown
        # catalog reference (rule 3) — proves the two rules fire
        # independently, with their own distinct path SHAPES (dot-joined vs
        # bracketed) — verified via a direct validate_world() capture before
        # writing this case, not assumed from the structural-only case above.
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-DOES-NOT-EXIST": "bogus_level"}
    add("catalog_item_usage_level_bad_value_and_unknown_ref", mutate_catalog_item_usage_level_bad_value_and_unknown_ref)

    # --- fix round 2 re-audit: the remaining `disposition: scored` entries
    # in the content dispositions registry not yet covered by rounds 1-2 —
    # route_tags/destination_tags/child_present (Situation), hobby_interest_tags/
    # content_tag_usage_level/scene_content_tag_usage_level/played_items/
    # skipped_items/changed_from_items (DriverProfile). See the module doc for
    # which of these the shipped content-selector algorithm.py actually reads
    # today vs. which are declared scored but currently dead in that file —
    # checked regardless, since the registry is the authoritative
    # classification this whole rule system is built on.

    def mutate_route_tags_bad_item(w: World) -> None:
        w.situation.route_tags = ["ok", 123]  # type: ignore[list-item]
    add("route_tags_bad_item_type", mutate_route_tags_bad_item)

    def mutate_destination_tags_bad_item(w: World) -> None:
        w.situation.destination_tags = [456]  # type: ignore[list-item]
    add("destination_tags_bad_item_type", mutate_destination_tags_bad_item)

    def mutate_child_present_bad_type(w: World) -> None:
        w.situation.child_present = []  # type: ignore[assignment]
    add("child_present_bad_type", mutate_child_present_bad_type)

    def mutate_hobby_interest_tags_bad_item(w: World) -> None:
        w.driver_profile.hobby_interest_tags = ["ok", True]  # type: ignore[list-item]
    add("hobby_interest_tags_bad_item_type", mutate_hobby_interest_tags_bad_item)

    def mutate_content_tag_usage_level_bad_value(w: World) -> None:
        w.driver_profile.content_tag_usage_level = {"some-tag": "bogus"}  # type: ignore[dict-item]
    add("content_tag_usage_level_bad_value", mutate_content_tag_usage_level_bad_value)

    def mutate_scene_content_tag_usage_level_bad_inner(w: World) -> None:
        w.driver_profile.scene_content_tag_usage_level = {"scene_a": {"some-tag": "bogus"}}  # type: ignore[dict-item]
    add("scene_content_tag_usage_level_bad_inner", mutate_scene_content_tag_usage_level_bad_inner)

    def mutate_played_items_bad_shape(w: World) -> None:
        w.driver_profile.played_items = [PlayedItem(track_id="x", last_played_at="2026-01-01T00:00:00Z")]
        w.driver_profile.played_items[0].track_id = 123  # type: ignore[assignment] — same direct-mutation technique as oshi_artists[0].artist_id above (no validate_assignment on these models)
    add("played_items_bad_track_id_type", mutate_played_items_bad_shape)

    def mutate_skipped_items_bad_shape(w: World) -> None:
        w.driver_profile.skipped_items = [SkippedItem(track_id="x", skipped_at="2026-01-01T00:00:00Z")]
        w.driver_profile.skipped_items[0].track_id = 5  # type: ignore[assignment]
    add("skipped_items_bad_track_id_type", mutate_skipped_items_bad_shape)

    def mutate_changed_from_items_bad_shape(w: World) -> None:
        w.driver_profile.changed_from_items = [ChangedFromItem(track_id="x", changed_at="2026-01-01T00:00:00Z")]
        w.driver_profile.changed_from_items[0].changed_at = 5  # type: ignore[assignment]
    add("changed_from_items_bad_timestamp_type", mutate_changed_from_items_bad_shape)

    # --- fix round 2, second pass: multiple_passengers/oshi_registered are
    # in the SERVICE selector's own FEATURE_ORDER (packages/
    # aica_transparent_service_selector_v1/algorithm.py:58-59) but NOT
    # `disposition: scored` in the CONTENT dispositions registry (context_only
    # there) — the registry only covers the content selector; the service
    # selector never consults it. Found by a selector-source grep, the OTHER
    # half of "per the dispositions registry OR a selector-source grep".

    def mutate_multiple_passengers_bad_type(w: World) -> None:
        w.situation.multiple_passengers = []  # type: ignore[assignment]
    add("multiple_passengers_bad_type", mutate_multiple_passengers_bad_type)

    def mutate_oshi_registered_bad_type(w: World) -> None:
        w.driver_profile.oshi_registered = []  # type: ignore[assignment]
    add("oshi_registered_bad_type", mutate_oshi_registered_bad_type)

    # service_proposal_acceptance_rate/service_recovery_rate/*_confidence are
    # dict[ServiceId, float] — the KEY is pydantic's own built-in dict-key
    # type coercion, which runs BEFORE the custom range-check field_validator
    # (_rate_maps_in_percent_range/_confidence_maps_in_unit_range) even gets a
    # chance to run. Verified via a direct capture with BOTH a bad key AND an
    # out-of-range value on a valid key in the SAME dict: only the key error
    # is reported, proving the range check is skipped entirely when a key
    # fails to coerce — not merely that the key error happens to be listed
    # first.
    def mutate_service_proposal_acceptance_rate_bad_key(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {"not_a_service": 50}  # type: ignore[dict-item]
    add("service_proposal_acceptance_rate_bad_key", mutate_service_proposal_acceptance_rate_bad_key)

    def mutate_service_proposal_acceptance_rate_bad_key_and_bad_value(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {  # type: ignore[dict-item]
            "not_a_service": 50,
            "music_playlist": 150,
        }
    add(
        "service_proposal_acceptance_rate_bad_key_suppresses_value_check",
        mutate_service_proposal_acceptance_rate_bad_key_and_bad_value,
    )

    # --- fix round 2, third pass: the genre extension (opt-in,
    # genre_affinity_v1_enabled) — NOT in the content dispositions registry
    # at all, found only via a selector-source grep
    # (packages/aica_transparent_content_selector_v1/algorithm.py:335,340).
    # usage_by_genre_bad_key also exercises GenreLiteral's "children's music"
    # member, the ONE enum value in this whole port whose Python repr needs
    # double quotes (contains an apostrophe) — verified via direct capture.

    def mutate_usage_by_genre_bad_key(w: World) -> None:
        w.driver_profile.usage_by_genre = {"not-a-genre": "high"}  # type: ignore[dict-item]
    add("usage_by_genre_bad_key", mutate_usage_by_genre_bad_key)

    def mutate_usage_by_genre_bad_value(w: World) -> None:
        w.driver_profile.usage_by_genre = {"j-pop": "bogus"}  # type: ignore[dict-item]
    add("usage_by_genre_bad_value", mutate_usage_by_genre_bad_value)

    def mutate_scene_genre_usage_bad_inner(w: World) -> None:
        w.driver_profile.scene_genre_usage = {"scene_a": {"j-pop": "bogus"}}  # type: ignore[dict-item]
    add("scene_genre_usage_bad_inner", mutate_scene_genre_usage_bad_inner)

    # --- C2 follow-up fix wave, item 1: an apostrophe-bearing dict key.
    # `content_proposal_acceptance_rate` is BOTH a `_TRACK_ID_MAP_FIELDS`
    # entry (rule 3, catalog reference — `{key!r}` at world_validation.py:209)
    # AND a non-ServiceId-keyed percent rate map (rule 1,
    # `_validate_percent_map` — `{key!r}` at world.py:295/302); a single key
    # that is neither a real catalog track id nor a value in [0, 100]
    # independently exercises `{key!r}`'s double-quote branch at BOTH sites
    # in the SAME captured case (verified via direct capture: both issues
    # fire, each repr-quoting the same key). This is the one previously-
    # unexercised branch that was reachable with real data — no ServiceId
    # member ever contains an apostrophe (closed, fixed, snake_case enum), so
    # the sibling ServiceId-keyed maps' `<ServiceId.x: 'x'>` shape has no
    # equivalent apostrophe-bearing capture and is instead verified directly
    # against a real interpreter (see the C2 follow-up report).
    def mutate_content_proposal_acceptance_rate_apostrophe_key(w: World) -> None:
        w.driver_profile.content_proposal_acceptance_rate = {"o'brien-track": 150}
    add(
        "content_proposal_acceptance_rate_apostrophe_key",
        mutate_content_proposal_acceptance_rate_apostrophe_key,
    )

    _write("world_validation", {
        "input": {"dataset_id": dataset_id, "cases": [{"name": name, "world": world} for name, world, _issues in cases]},
        "output": {"results": [{"name": name, "issues": issues} for name, _world, issues in cases]},
    })


# ---------------------------------------------------------------------------
# 23. world_overrides (services/world_clone_store.apply_overrides — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Direct import over the same real committed seed + dataset catalog as
# world_validation above. `success` cases + `raises` cases (capturing
# InvalidOverrideError.issues as a structured value, not just "did it
# throw") mirror app/api/tests/proposal/test_p7_apply_overrides.py's own
# scenarios one-for-one, PLUS malformed_path/list_index_out_of_range (not
# individually named in that Python file, but reachable through the same
# function via a syntactically-embedded bad path segment — verified via
# direct interpreter capture, not guessed).
#
# NOT captured here: an EMPTY override path. `FieldOverride`'s own
# `path_non_empty` field validator intercepts an empty path before
# `apply_overrides`'s `_split_path` ever runs, for BOTH a raw dict input
# (`FieldOverride.model_validate({"path": "", ...})`) and a directly
# constructed instance (`FieldOverride(path="", ...)` raises at
# construction) — there is no real Python call path that reaches
# `_split_path`'s own empty-path guard with an empty string. Covered instead
# by a direct TS-logic assertion (see world_overrides_validation.test.ts) —
# see world_overrides.ts's module doc for the full reasoning.

def _capture_world_overrides() -> None:
    from aica_api.models.proposal.song_schema import Song
    from aica_api.models.proposal.world import FieldOverride, World
    from aica_api.services.world_clone_store import InvalidOverrideError, apply_overrides
    from aica_api.services.world_seed_store import WorldSeedStore

    dataset_id = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
    dataset_dir = _REPO / "proposal_contracts" / "dataset" / dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    base_seed = seed_store.get_seed("seed-night-highway-oshi")
    assert base_seed is not None
    base_world: World = base_seed.world

    def overrides_json(overrides: list) -> list:
        return [json.loads(o.model_dump_json()) if isinstance(o, FieldOverride) else o for o in overrides]

    success_cases: list[tuple[str, list, bool, dict, list]] = []

    def add_success(name: str, overrides: list, use_catalog: bool) -> None:
        world, diffs = apply_overrides(base_world, overrides, catalog=catalog if use_catalog else None)
        success_cases.append((
            name, overrides_json(overrides), use_catalog,
            json.loads(world.model_dump_json()), [json.loads(d.model_dump_json()) for d in diffs],
        ))

    add_success("empty_overrides_with_catalog", [], True)
    add_success("empty_overrides_without_catalog", [], False)
    add_success("one_valid_override_instance_shape", [FieldOverride(path="situation.drowsiness_level", value=10)], True)
    add_success("one_valid_override_dict_shape", [{"path": "situation.fatigue_level", "value": 20}], True)

    raise_cases: list[tuple[str, list, bool, list]] = []

    def add_raise(name: str, overrides: list, use_catalog: bool) -> None:
        try:
            apply_overrides(base_world, overrides, catalog=catalog if use_catalog else None)
            raise AssertionError(f"{name}: expected InvalidOverrideError, nothing was raised")
        except InvalidOverrideError as exc:
            raise_cases.append((name, overrides_json(overrides), use_catalog, [json.loads(i.model_dump_json()) for i in exc.issues]))

    add_raise("malformed_path_segment", [FieldOverride(path="situation.drowsiness_level[bad]", value=10)], True)
    add_raise("unknown_path", [FieldOverride(path="situation.no_such_field", value=1)], True)
    add_raise("list_index_out_of_range", [FieldOverride(path="driver_profile.oshi_artists[99].artist_id", value="x")], True)
    add_raise("out_of_range_value", [FieldOverride(path="situation.drowsiness_level", value=999)], True)
    # A NESTED (list-index) structural failure reached through apply_overrides'
    # own re-validate step — proves it produces the SAME dot-joined `loc`-tuple
    # path format (`driver_profile.oshi_artists.0.enthusiasm`, NOT bracketed)
    # as world_validation.validate_world's, even though the OVERRIDE PATH that
    # reached it is bracketed (`oshi_artists[0].enthusiasm`) — the two path
    # conventions coexist in the same error.
    add_raise("nested_structural_error_via_override", [FieldOverride(path="driver_profile.oshi_artists[0].enthusiasm", value=1.5)], True)
    add_raise(
        "dangling_catalog_reference_with_catalog",
        [FieldOverride(path="driver_profile.oshi_artists[0].artist_id", value="synthetic-artist-DOES-NOT-EXIST")],
        True,
    )
    add_raise(
        "dangling_catalog_reference_without_catalog",
        [FieldOverride(path="driver_profile.oshi_artists[0].artist_id", value="synthetic-artist-DOES-NOT-EXIST")],
        False,
    )
    # --- fix round 1: catalog_ref / DatasetVersion. CatalogRef is
    # frozen=True in Python, but that's irrelevant to apply_overrides — it
    # never mutates a live instance, always re-validating a plain dict from
    # scratch (verified: `del world.catalog_ref.dataset_version` on the real
    # live instance raises `frozen_instance` immediately, but overriding
    # through apply_overrides' own dict-based path mechanism works exactly
    # like any other field, reached through the SAME structural re-validate
    # step as situation.drowsiness_level above).
    add_raise("catalog_ref_dataset_id_bad_type", [FieldOverride(path="catalog_ref.dataset_id", value=123)], True)
    add_raise(
        "catalog_ref_dataset_version_subfield_bad_type",
        [FieldOverride(path="catalog_ref.dataset_version.schema_version", value=123)],
        True,
    )
    # --- C2 follow-up fix wave, item 1: an apostrophe-bearing path segment,
    # proving the shared repr helper's double-quote branch is wired into
    # BOTH `_split_path`'s `{segment!r}` (malformed_path) and
    # `_get_at_path`'s `{full_path!r}`/`{token!r}` (unknown_override_path).
    # These two are the only `apply_overrides` error branches an
    # apostrophe-bearing segment can actually reach: both check an ARBITRARY
    # string against a regex / dict lookup, with no requirement that it name
    # a real field. The OTHER two `_set_at_path`-own branches
    # (list_index_out_of_range / "not an object", see
    # world_overrides_validation.test.ts) structurally CANNOT carry an
    # apostrophe — both require the "before" read (always against the
    # UNMUTATED base dict) to succeed at that exact final segment first,
    # which means the segment must be a REAL field/index name in the World
    # schema, and no field name in this schema contains an apostrophe.
    # Verified, not assumed: substituting an apostrophe-bearing segment there
    # reaches `_get_at_path`'s own "no such field" error instead (the base
    # object was never mutated by a prior override, so the field genuinely
    # doesn't exist) — never `_set_at_path`'s branch.
    add_raise("malformed_path_segment_apostrophe", [FieldOverride(path="situation.o'clock[bad]", value=10)], True)
    add_raise("unknown_path_apostrophe", [FieldOverride(path="situation.o'clock", value=1)], True)

    _write("world_overrides", {
        "input": {"dataset_id": dataset_id},
        "output": {
            "success": [
                {"name": name, "overrides": ov, "use_catalog": uc, "world": world, "diffs": diffs}
                for name, ov, uc, world, diffs in success_cases
            ],
            "raises": [
                {"name": name, "overrides": ov, "use_catalog": uc, "issues": issues}
                for name, ov, uc, issues in raise_cases
            ],
        },
    })


# ---------------------------------------------------------------------------
# 26. proposal_selector_dispatch (services/proposal_selector.dispatch_selector
#     — C2 Task 3)
# ---------------------------------------------------------------------------
#
# Wraps the REAL dispatch_selector() around already-committed, already-valid
# contexts (the "worked_example"/first case from the already-written
# service_selector.json / content_selector.json fixtures — re-loaded here
# rather than duplicated) so this capture exercises dispatch_selector's OWN
# evidence-shaping (step/package_id/contract_version/schema_version/
# matrix_version stamping, used_feature_ids passthrough, an
# evidence_input_snapshot redaction, and the allowed_service_ids
# candidate-membership check on its PASSING branch) around a real,
# successful evaluate() call for EACH family (service_selector,
# content_selector).
#
# The FAILURE branches (unregistered/unported package, a thrown exception, a
# non-dict return, a candidate outside allowed_service_ids) are deliberately
# NOT captured here: Python's own test_proposal_selector.py reaches them by
# writing a fake `algorithm.py` to `tmp_path` — a filesystem technique htmlapp
# has no equivalent of (the task brief's "one place the port must NOT mirror
# Python's mechanism"). Those branches are instead covered by
# tests/proposal_selector_port.test.ts's own direct TS-logic assertions: the
# algorithm_exception branch by feeding the REAL ported
# aica_transparent_service_selector_v1 evaluator a deliberately-invalid
# trigger_purpose (still a real, dispatch_selector-mediated call — just not a
# byte-parity golden, since the exact exception message text is not asserted
# — see the task report's hazard notes), and the two branches no real
# evaluator can reach (invalid_result_shape, candidate_outside_allowed_set)
# via `dispatchSelector`'s injectable `options.evaluators` testability seam.

def _capture_proposal_selector_dispatch() -> None:
    from aica_api.services.proposal_selector import dispatch_selector
    from aica_api.models.proposal.package_manifest import ProposalPackageManifest

    service_pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_service_selector_v1" / "package.json")
    service_pkg = ProposalPackageManifest.model_validate(service_pkg_raw)
    content_pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_content_selector_v1" / "package.json")
    content_pkg = ProposalPackageManifest.model_validate(content_pkg_raw)

    service_ctx = _load_json(_OUT / "service_selector.json")["input"]["cases"][0]["context"]
    content_ctx = _load_json(_OUT / "content_selector.json")["input"]["cases"][0]["context"]

    inputs = []
    results = []

    # 1. service family, success, allowed_service_ids check ACTIVE and
    # passing — every candidate the real algorithm ranks/excludes for this
    # context is a member of allowed_service_ids, proving the
    # checked-and-passed branch, not merely the None-skips-the-check branch.
    ev1 = dispatch_selector(
        service_pkg, service_ctx, _PACKAGES_DIR,
        matrix_version="v-selector-dispatch-1",
        used_feature_ids=["drowsiness_level", "fatigue_level"],
        allowed_service_ids=service_ctx["allowed_service_ids"],
    )
    inputs.append({
        "name": "service_family_success_allowed_ids_checked",
        "package": service_pkg_raw,
        "context": service_ctx,
        "matrix_version": "v-selector-dispatch-1",
        "used_feature_ids": ["drowsiness_level", "fatigue_level"],
        "allowed_service_ids": service_ctx["allowed_service_ids"],
        "evidence_input_snapshot": None,
    })
    results.append({
        "name": "service_family_success_allowed_ids_checked",
        "evidence": json.loads(ev1.model_dump_json()),
    })

    # 2. content family, success, evidence_input_snapshot REDACTS the
    # persisted input_snapshot while evaluate() still runs on the full
    # context (proves the redaction seam is independent of evaluate()'s own
    # input) — allowed_service_ids intentionally omitted (content family
    # never runs that check regardless of whether it's passed).
    redacted_snapshot = {"redacted": True, "reason": "bulky read-only catalog omitted from persisted evidence"}
    ev2 = dispatch_selector(
        content_pkg, content_ctx, _PACKAGES_DIR,
        matrix_version="v-selector-dispatch-1",
        evidence_input_snapshot=redacted_snapshot,
    )
    inputs.append({
        "name": "content_family_success_redacted_snapshot",
        "package": content_pkg_raw,
        "context": content_ctx,
        "matrix_version": "v-selector-dispatch-1",
        "used_feature_ids": None,
        "allowed_service_ids": None,
        "evidence_input_snapshot": redacted_snapshot,
    })
    results.append({
        "name": "content_family_success_redacted_snapshot",
        "evidence": json.loads(ev2.model_dump_json()),
    })

    _write("proposal_selector_dispatch", {
        "input": {"cases": inputs},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 29. proposal_run_manager (direct import; C2 Task 4)
# ---------------------------------------------------------------------------
#
# Exercises all 8 public functions of services/proposal_run_manager.py against
# a single scripted scenario (one "minimal" run mutated step-by-step, plus a
# "full" run exercising create_run's world/setup_snapshot/events/evidence/
# status/mode optional args, plus a dedicated single-run dir for list_runs so
# the array isn't order-ambiguous once run_id is stripped for parity).
#
# run_id/created_at are the ONLY randomness/wall-clock in this module
# (_make_run_id/_now_iso) — frozen to fixed literals post-hoc (same technique
# _capture_run_log_e2e uses for created_at) so a re-run is a git-clean no-op.
# The TS port's parity test strips both via normalizeForParity (src/engine/
# __fixtures__/transcript.ts) rather than relying on the frozen literal
# matching — see that module's VOLATILE set, which already lists run_id/
# created_at (ported run_ids use a different format on purpose).

def _capture_proposal_run_manager() -> None:
    import pathlib
    import tempfile

    from aica_api.models.proposal.enums import ProposalRunMode, ProposalRunStatus
    from aica_api.models.proposal.events import DiscreteEvent
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.explanation import Explanation
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.world import SetupSnapshot, World
    from aica_api.services import proposal_run_manager as prm

    _DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"

    def _opportunity_raw(opp_id: str) -> dict:
        return {
            "opportunity_id": opp_id,
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "after_rest_before_restart",
            "allowed_service_ids": ["live_viewing", "stretch_video"],
            "simulation_time": "2026-07-16T10:00:00Z",
            "run_seed": "seed-1",
        }

    def _journey_state_raw(**overrides: object) -> dict:
        # Pydantic-defaulted (feature 019/P4 fields filled in) so "input" is
        # already the shape the router would hand create_run/update_state --
        # the TS side never has to independently know Python's defaults.
        base = {
            "lifecycle_stage": "after_rest_before_restart",
            "motion_state": "stopped",
            "active_service_id": None,
            "active_plan_id": None,
        }
        base.update(overrides)
        return json.loads(JourneyState.model_validate(base).model_dump_json())

    def _world_raw() -> dict:
        return {
            "control_inputs": {
                "trigger_purpose": "rest_recommended",
                "lifecycle_stage": "before_rest_until_stop",
                "motion_state": "driving",
                "matrix_version": "v1",
                "dataset_id": _DATASET_ID,
            },
            "situation": {
                "drowsiness_level": 50, "fatigue_level": 50, "traffic_state": "normal",
                "road_type": "highway", "night_state": "day", "monotony_level": 50,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False, "motion_state": "driving",
                "estimated_min_until_rest_spot": 10, "rest_spot_type": "sa_pa",
                "active_service": None, "recent_service_rejections": [],
            },
            "driver_profile": {
                "oshi_registered": False, "oshi_mode": "off", "age_band": "30s", "gender": "unspecified",
            },
            "catalog_ref": {
                "dataset_id": _DATASET_ID,
                "dataset_version": {
                    "schema_version": "1.0.0",
                    "spotify_track_reference_version": "1.0.0",
                    "spotify_audio_features_reference_version": "1.0.0",
                },
                "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
            },
        }

    def _setup_snapshot_raw() -> dict:
        return {
            "origin": {"seed_id": "seed-night-highway-oshi", "clone_id": None, "profile_id": None, "origin_preset_id": None},
            "matrix_version": "v1",
            "dataset_id": _DATASET_ID,
            "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
            "service_package_id": "aica_transparent_service_selector_v1",
            "service_contract_version": "1.0.0",
            "content_package_id": None,
            "content_contract_version": None,
            "service_parameter_set_version": "1.0.0",
            "content_parameter_set_version": None,
            "feature_provenance": {},
        }

    create_minimal_raw = {
        "opportunity": _opportunity_raw("op-test-1"),
        "matrix_version": "v1",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": None,
        "parameters": {"top_k": 3},
        "hyperparameters": {"response_matrix": {}},
        "journey_state": _journey_state_raw(),
    }

    create_full_raw = {
        "opportunity": _opportunity_raw("op-test-full"),
        "matrix_version": "v1",
        "world_snapshot": {"feature_snapshot": {"drowsiness_level": 72}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "parameters": {"top_k": 5},
        "hyperparameters": {"response_matrix": {"a": 1}},
        "journey_state": _journey_state_raw(active_service_id="music_playlist"),
        "events": [
            {"event_type": "OPPORTUNITY_OPENED", "at": "2026-07-16T10:00:00Z", "payload": {}},
        ],
        "evidence": [
            {
                "step": "service", "package_id": "mock_service_selector_v1", "contract_version": "1.0.0",
                "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
                "output": {"decision_type": "no_proposal"}, "error": None,
                "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
            },
        ],
        "status": "service_selected",
        "mode": "quick_check",
        "world": _world_raw(),
        "setup_snapshot": _setup_snapshot_raw(),
    }

    def _build_create_kwargs(raw: dict) -> dict:
        kwargs = dict(raw)
        kwargs["opportunity"] = ProposalOpportunity.model_validate(raw["opportunity"])
        kwargs["journey_state"] = JourneyState.model_validate(raw["journey_state"])
        if "events" in raw:
            kwargs["events"] = [DiscreteEvent.model_validate(e) for e in raw["events"]]
        if "evidence" in raw:
            kwargs["evidence"] = [AlgorithmEvidence.model_validate(e) for e in raw["evidence"]]
        if "status" in raw:
            kwargs["status"] = ProposalRunStatus(raw["status"])
        if "mode" in raw:
            kwargs["mode"] = ProposalRunMode(raw["mode"])
        if "world" in raw:
            kwargs["world"] = World.model_validate(raw["world"])
        if "setup_snapshot" in raw:
            kwargs["setup_snapshot"] = SetupSnapshot.model_validate(raw["setup_snapshot"])
        return kwargs

    event_1_raw = {"event_type": "SERVICE_SELECTED", "at": "2026-07-16T10:01:00Z", "payload": {"selected_service_id": "live_viewing"}}
    event_2_raw = {"event_type": "CONTENT_SELECTED", "at": "2026-07-16T10:02:00Z", "payload": {}}
    evidence_1_raw = {
        "step": "service", "package_id": "mock_service_selector_v1", "contract_version": "1.0.0",
        "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
        "output": {"decision_type": "no_proposal"}, "error": None,
        "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
    }
    evidence_2_raw = {
        "step": "content", "package_id": "mock_content_selector_v1", "contract_version": "1.0.0",
        "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
        "output": None, "error": {"category": "algorithm_exception", "message": "boom"},
        "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
    }
    explanation_1_raw = {
        "step": "service", "target_id": "rest_stop", "requested_provider": "backend",
        "provider_used": "backend", "model": "qwen2.5:3b", "rationale": ["理由1", "reason1"],
        "fell_back": False, "error": None, "prompt_hash": "deadbeef1", "generated_at": "2026-07-17T00:00:00Z",
    }
    explanation_2_raw = {
        "step": "content", "target_id": "other", "requested_provider": "backend",
        "provider_used": "template", "model": "template", "rationale": ["理由2", "reason2"],
        "fell_back": True, "error": "ollama timeout", "prompt_hash": "deadbeef2", "generated_at": "2026-07-17T00:01:00Z",
    }

    update_full_raw = {
        "status": "content_selected",
        "journey_state": _journey_state_raw(motion_state="driving"),
        "content_parameters": {"volume": 0.5},
        "content_hyperparameters": {"style": "chill"},
        "setup_snapshot": _setup_snapshot_raw(),
        "opportunity": _opportunity_raw("op-test-2"),
        "world_snapshot": {"feature_snapshot": {"situation": {"drowsiness_level": 90}}, "feature_provenance": {}},
        "opportunity_history": [_opportunity_raw("op-test-0")],
        "setup_snapshot_history": [_setup_snapshot_raw()],
    }
    update_partial_raw = {"status": "content_started"}

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)

        log_min = prm.create_run(**_build_create_kwargs(create_minimal_raw), runs_dir=runs_dir)
        log_full = prm.create_run(**_build_create_kwargs(create_full_raw), runs_dir=runs_dir)

        after_event_1 = prm.append_event(log_min.run_id, DiscreteEvent.model_validate(event_1_raw), runs_dir)
        after_event_2 = prm.append_event(log_min.run_id, DiscreteEvent.model_validate(event_2_raw), runs_dir)
        after_evidence_1 = prm.append_evidence(log_min.run_id, AlgorithmEvidence.model_validate(evidence_1_raw), runs_dir)
        after_evidence_2 = prm.append_evidence(log_min.run_id, AlgorithmEvidence.model_validate(evidence_2_raw), runs_dir)
        after_explanation_1 = prm.append_explanation(log_min.run_id, Explanation.model_validate(explanation_1_raw), runs_dir)
        after_explanation_2 = prm.append_explanation(log_min.run_id, Explanation.model_validate(explanation_2_raw), runs_dir)

        update_full_kwargs = dict(update_full_raw)
        update_full_kwargs["status"] = ProposalRunStatus(update_full_raw["status"])
        update_full_kwargs["journey_state"] = JourneyState.model_validate(update_full_raw["journey_state"])
        update_full_kwargs["setup_snapshot"] = SetupSnapshot.model_validate(update_full_raw["setup_snapshot"])
        update_full_kwargs["opportunity"] = ProposalOpportunity.model_validate(update_full_raw["opportunity"])
        update_full_kwargs["opportunity_history"] = [ProposalOpportunity.model_validate(o) for o in update_full_raw["opportunity_history"]]
        update_full_kwargs["setup_snapshot_history"] = [SetupSnapshot.model_validate(s) for s in update_full_raw["setup_snapshot_history"]]
        after_update_full = prm.update_state(log_min.run_id, runs_dir, **update_full_kwargs)

        after_update_partial = prm.update_state(
            log_min.run_id, runs_dir, status=ProposalRunStatus(update_partial_raw["status"]),
        )

        get_found = prm.get_run(log_min.run_id, runs_dir)
        get_missing = prm.get_run("prun_does_not_exist_at_all", runs_dir)

        with tempfile.TemporaryDirectory() as td_list:
            list_dir = pathlib.Path(td_list)
            list_log = prm.create_run(**_build_create_kwargs(create_minimal_raw), runs_dir=list_dir)
            list_single = prm.list_runs(list_dir)
            list_empty = prm.list_runs(pathlib.Path(td_list) / "nonexistent-subdir")

            deleted_true = prm.delete_run(list_log.run_id, list_dir)
            deleted_false = prm.delete_run(list_log.run_id, list_dir)
            get_after_delete = prm.get_run(list_log.run_id, list_dir)

    def _dump(obj) -> dict:
        return json.loads(obj.model_dump_json())

    def _freeze(d: dict, run_id_literal: str) -> dict:
        d = dict(d)
        d["run_id"] = run_id_literal
        d["created_at"] = "2026-07-01T00:00:00+00:00"
        return d

    _write("proposal_run_manager", {
        "input": {
            "create_minimal": create_minimal_raw,
            "create_full": create_full_raw,
            "event_1": event_1_raw,
            "event_2": event_2_raw,
            "evidence_1": evidence_1_raw,
            "evidence_2": evidence_2_raw,
            "explanation_1": explanation_1_raw,
            "explanation_2": explanation_2_raw,
            "update_full": update_full_raw,
            "update_partial": update_partial_raw,
        },
        "output": {
            "create_minimal": _freeze(_dump(log_min), "prun_TEST_FIXED_MIN"),
            "create_full": _freeze(_dump(log_full), "prun_TEST_FIXED_FULL"),
            "after_event_1": _freeze(_dump(after_event_1), "prun_TEST_FIXED_MIN"),
            "after_event_2": _freeze(_dump(after_event_2), "prun_TEST_FIXED_MIN"),
            "after_evidence_1": _freeze(_dump(after_evidence_1), "prun_TEST_FIXED_MIN"),
            "after_evidence_2": _freeze(_dump(after_evidence_2), "prun_TEST_FIXED_MIN"),
            "after_explanation_1": _freeze(_dump(after_explanation_1), "prun_TEST_FIXED_MIN"),
            "after_explanation_2": _freeze(_dump(after_explanation_2), "prun_TEST_FIXED_MIN"),
            "after_update_full": _freeze(_dump(after_update_full), "prun_TEST_FIXED_MIN"),
            "after_update_partial": _freeze(_dump(after_update_partial), "prun_TEST_FIXED_MIN"),
            "get_found": _freeze(_dump(get_found), "prun_TEST_FIXED_MIN"),
            "get_missing": get_missing,
            "list_single": [_freeze(_dump(list_single[0]), "prun_TEST_FIXED_LIST")],
            "list_empty": list_empty,
            "deleted_true": deleted_true,
            "deleted_false": deleted_false,
            "get_after_delete": get_after_delete,
        },
    })


# ---------------------------------------------------------------------------
# 30. proposal_journey (services/proposal_journey.apply_action — C2 Task 5)
# ---------------------------------------------------------------------------
#
# apply_action is PURE (no clock/random/IO) -- `now` is caller-supplied, so
# every case is deterministic with no post-hoc freezing needed (unlike
# proposal_run_manager.json). Each case is a fully independent
# ProposalRunLog + JourneyAction construction (not a scripted multi-step
# scenario) -- this keeps every branch isolated and separately named, and
# lets a chained scenario (e.g. reject -> choose_another) be expressed as two
# independent cases sharing hand-built state rather than a stateful replay.
#
# Real committed `service_capabilities.v1.json` is used for every case except
# the one synthetic-capabilities case explicitly proving the
# `screen_dependent and not background_on_motion` leg (unreachable via the
# real 14-service artifact -- see the task report).

def _capture_journey() -> None:
    from aica_api.models.proposal.enums import (
        JourneyActionType, LifecycleStage, MotionState, PlaybackState,
        ProposalRunStatus, ServiceId, TriggerPurpose,
    )
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.journey import JourneyState, PreviousContent
    from aica_api.models.proposal.journey_action import JourneyAction
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    from aica_api.models.proposal.service_capabilities import ServiceCapabilities, ServiceCapability
    from aica_api.services.proposal_journey import apply_action

    capabilities_path = _REPO / "proposal_contracts" / "service_capabilities" / "service_capabilities.v1.json"
    real_capabilities = ServiceCapabilities.load(capabilities_path)

    # All 14 real ServiceId values, in ServiceId enum declaration order --
    # used by the rank>=10 numeric-sort pin below (fix round 1).
    _ALL_SERVICE_IDS = [s.value for s in ServiceId]

    def _opportunity(opp_id: str, purpose: str, stage: str, allowed: list[str]) -> ProposalOpportunity:
        return ProposalOpportunity(
            opportunity_id=opp_id,
            trigger_purpose=TriggerPurpose(purpose),
            lifecycle_stage=LifecycleStage(stage),
            allowed_service_ids=[ServiceId(s) for s in allowed],
            simulation_time="2026-07-20T09:00:00Z",
            run_seed="seed-journey-1",
        )

    def _journey_state(**overrides: object) -> JourneyState:
        base: dict = dict(
            lifecycle_stage=LifecycleStage.active_driving_content,
            motion_state=MotionState.driving,
            active_service_id=None,
            active_plan_id=None,
            playback_state=PlaybackState.idle,
            current_plan_ref=None,
            previous_content=None,
            rejected_service_ids=[],
        )
        base.update(overrides)
        return JourneyState(**base)

    def _service_evidence(eligible_ids: list[str], ranked: list[tuple[str, int]]) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="service", package_id="mock_service_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1",
            input_snapshot={"eligible_candidates": [{"candidate_id": cid} for cid in eligible_ids]},
            output={
                "decision_type": "ranked_candidates",
                "ranked_candidates": [{"candidate_id": cid, "rank": r} for cid, r in ranked],
            },
            error=None, used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _content_evidence(
        selected_service_id: str | None = None,
        next_transition_policy: str = "auto_advance",
        error: str | None = None,
    ) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="content", package_id="mock_content_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1", input_snapshot={},
            output=None if error else {
                "selected_service_id": selected_service_id,
                "next_transition_policy": next_transition_policy,
                "approval_policy": "auto",
                "completion_rule": "duration_elapsed",
            },
            error={"category": "algorithm_exception", "message": error} if error else None,
            used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _run_log(
        *, status: str, journey_state: JourneyState, opportunity: ProposalOpportunity,
        evidence: list[AlgorithmEvidence] = (), world_snapshot: dict | None = None,
    ) -> ProposalRunLog:
        return ProposalRunLog(
            run_id="prun_journey_test",
            created_at="2026-07-20T09:00:00Z",
            opportunity=opportunity,
            matrix_version="v1",
            world_snapshot=world_snapshot if world_snapshot is not None else {"feature_snapshot": {}, "feature_provenance": {}},
            service_package_id="mock_service_selector_v1",
            content_package_id="mock_content_selector_v1",
            parameters={}, hyperparameters={},
            journey_state=journey_state,
            events=[], evidence=list(evidence),
            status=ProposalRunStatus(status),
        )

    cases: list[dict] = []

    def _case(
        name: str, run_log: ProposalRunLog, action_type: str, payload: dict | None = None,
        now: str = "2026-07-20T10:00:00Z", capabilities: ServiceCapabilities | None = None,
    ) -> None:
        action = JourneyAction(action_type=JourneyActionType(action_type), payload=payload or {})
        transition = apply_action(run_log, action, now=now, capabilities=capabilities)
        cases.append({
            "name": name,
            "input": {
                "run_log": json.loads(run_log.model_dump_json()),
                "action": json.loads(action.model_dump_json()),
                "now": now,
                # Array-shaped (matches the raw `service_capabilities.v1.json`
                # artifact format the TS side's `buildServiceCapabilities`
                # consumes) -- NOT `capabilities.model_dump_json()` directly,
                # which pydantic would dict-key by service_id instead.
                "capabilities": (
                    {
                        "capabilities_version": capabilities.capabilities_version,
                        "services": [json.loads(c.model_dump_json()) for c in capabilities.services.values()],
                    }
                    if capabilities is not None else None
                ),
            },
            "output": json.loads(transition.model_dump_json()),
        })

    # === reject (_reject_service): 7 cases ===================================
    _case(
        "reject_wrong_status",
        _run_log(status="content_selected", journey_state=_journey_state(), opportunity=_opportunity(
            "op-reject-1", "route_music", "active_driving_content", ["music_playlist"])),
        "reject",
    )
    _case(
        "reject_success_remaining_nonempty",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing", "stretch_video"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing", "stretch_video"],
                [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject",
    )
    _case(
        "reject_invalid_payload_service_id",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-3", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "reject", payload={"selected_service_id": "not_a_real_service"},
    )
    _case(
        "reject_no_offered_service",
        _run_log(
            status="service_selected", journey_state=_journey_state(active_service_id=None),
            opportunity=_opportunity("op-reject-4", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "reject",
    )
    _case(
        "reject_success_pool_exhausted_emits_no_eligible_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-5", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_service_evidence(["music_playlist"], [("music_playlist", 1)])],
        ),
        "reject",
    )
    _case(
        "reject_already_rejected_no_duplicate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.music_playlist],
            ),
            opportunity=_opportunity("op-reject-6", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject",
    )
    _case(
        "reject_payload_overrides_active_service",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing),
            opportunity=_opportunity("op-reject-7", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject", payload={"selected_service_id": "music_playlist"},
    )

    # === choose_another (_choose_another): 5 cases ============================
    _case(
        "choose_another_wrong_status",
        _run_log(status="content_selected", journey_state=_journey_state(), opportunity=_opportunity(
            "op-choose-1", "route_music", "active_driving_content", ["music_playlist"])),
        "choose_another",
    )
    _case(
        "choose_another_success_with_rank",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-choose-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing", "stretch_video"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing", "stretch_video"],
                [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "choose_another",
    )
    _case(
        "choose_another_success_without_rank",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-choose-3", "route_music", "active_driving_content",
                                      ["music_playlist", "stretch_video"]),
            evidence=[_service_evidence(["music_playlist", "stretch_video"], [("music_playlist", 1)])],
        ),
        "choose_another",
    )
    _case(
        "choose_another_no_further_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.live_viewing],
            ),
            opportunity=_opportunity("op-choose-4", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "choose_another",
    )
    _case(
        "choose_another_defensive_invalid_pool_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=None),
            opportunity=_opportunity("op-choose-5", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_service_evidence(["bogus_service_xyz"], [])],
        ),
        "choose_another",
    )

    # === request_more (_request_more): 4 cases =================================
    _case(
        "request_more_wrong_status",
        _run_log(status="created", journey_state=_journey_state(), opportunity=_opportunity(
            "op-more-1", "route_music", "active_driving_content", ["music_playlist"])),
        "request_more",
    )
    _case(
        "request_more_success_nonempty",
        _run_log(
            status="service_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-more-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "request_more",
    )
    _case(
        "request_more_success_empty_all_rejected",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.music_playlist, ServiceId.live_viewing],
            ),
            opportunity=_opportunity("op-more-3", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "request_more",
    )
    # Pins eligiblePool's numeric rank sort (journey.ts:222-224) against a
    # regression to a bare `.sort()`: all 14 real ServiceIds, ranked 14
    # DOWN TO 1 (reverse of both insertion order and the correct output
    # order) so the ONLY way `remaining_candidate_ids` comes out correctly
    # ascending-by-rank is a genuine numeric comparator. Fix round 1 (C2
    # Task 5 review): the prior fixture never used a rank >= 10, the only
    # range where numeric and (a hypothetical) lexicographic-of-the-rank
    # sort would diverge -- see the task report for what actually happens
    # with a bare `.sort()` on this object array (empirically confirmed,
    # not assumed).
    _case(
        "request_more_rank_ge_10_pins_numeric_sort",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-more-4", "route_music", "active_driving_content", _ALL_SERVICE_IDS),
            evidence=[_service_evidence(
                _ALL_SERVICE_IDS, list(zip(_ALL_SERVICE_IDS, range(14, 0, -1))),
            )],
        ),
        "request_more",
    )

    # === postpone (_postpone): 3 cases ==========================================
    _case(
        "postpone_wrong_status",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.active),
                  opportunity=_opportunity("op-postpone-1", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )
    _case(
        "postpone_from_service_selected",
        _run_log(status="service_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
                  opportunity=_opportunity("op-postpone-2", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )
    _case(
        "postpone_from_content_selected",
        _run_log(status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
                  opportunity=_opportunity("op-postpone-3", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )

    # === accept (_accept): 3 cases ==============================================
    _case(
        "accept_wrong_status",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-accept-1", "route_music", "active_driving_content", ["music_playlist"])),
        "accept",
    )
    _case(
        "accept_no_committed_plan",
        _run_log(
            status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-accept-2", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(error="boom")],
        ),
        "accept",
    )
    _case(
        "accept_success",
        _run_log(
            status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-accept-3", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(selected_service_id="music_playlist", next_transition_policy="auto_advance")],
        ),
        "accept",
    )

    # === complete (_complete): 2 cases ==========================================
    _case(
        "complete_wrong_playback_state",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.idle),
                  opportunity=_opportunity("op-complete-1", "route_music", "active_driving_content", ["music_playlist"])),
        "complete",
    )
    _case(
        "complete_success",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.active),
            opportunity=_opportunity("op-complete-2", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "complete",
    )

    # === continue_ (_continue): 3 cases =========================================
    _case(
        "continue_wrong_playback_state",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.active),
                  opportunity=_opportunity("op-continue-1", "route_music", "active_driving_content", ["music_playlist"])),
        "continue",
    )
    _case(
        "continue_no_committed_plan",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed),
            opportunity=_opportunity("op-continue-2", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(error="boom")],
        ),
        "continue",
    )
    _case(
        "continue_success",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed),
            opportunity=_opportunity("op-continue-3", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(selected_service_id="music_playlist", next_transition_policy="auto_advance")],
        ),
        "continue",
    )

    # === stop (_stop): 4 cases ===================================================
    _case(
        "stop_wrong_playback_state",
        _run_log(status="content_selected", journey_state=_journey_state(playback_state=PlaybackState.idle),
                  opportunity=_opportunity("op-stop-1", "route_music", "active_driving_content", ["music_playlist"])),
        "stop",
    )
    _case(
        "stop_from_active_no_previous_content",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.active,
                                          previous_content=None),
            opportunity=_opportunity("op-stop-2", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "stop",
    )
    _case(
        "stop_from_backgrounded_with_previous_content",
        _run_log(
            status="content_started",
            journey_state=_journey_state(
                active_service_id=ServiceId.live_viewing, playback_state=PlaybackState.backgrounded,
                previous_content=PreviousContent(service_id=ServiceId.music_playlist, plan_ref="music_playlist-plan"),
            ),
            opportunity=_opportunity("op-stop-3", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
        ),
        "stop",
    )
    _case(
        "stop_from_completed_no_previous_content",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed,
                                          previous_content=None),
            opportunity=_opportunity("op-stop-4", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "stop",
    )

    # === motion_change (_motion_change): 10 cases ===============================
    _case(
        "motion_change_capabilities_unavailable",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-motion-1", "route_music", "active_driving_content", ["music_playlist"])),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=None,
    )
    _case(
        "motion_change_invalid_payload_motion_state",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-motion-2", "route_music", "active_driving_content", ["music_playlist"])),
        "motion_change", payload={"motion_state": "flying"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_no_active_plan",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=None, playback_state=PlaybackState.idle),
            opportunity=_opportunity("op-motion-3", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_background_on_motion",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-4", "route_music", "active_driving_content", ["live_viewing"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_stopped_only",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.stretch_video, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-5", "route_music", "active_driving_content", ["stretch_video"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_full_karaoke_special_case",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.full_karaoke, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-6", "route_music", "active_driving_content", ["full_karaoke"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_unchanged_audio_only",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-7", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    synthetic_service = ServiceCapability(
        service_id=ServiceId.music_playlist, driving_capable=True, screen_dependent=True,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage",
        services={ServiceId.music_playlist: synthetic_service},
    )
    _case(
        "motion_change_driving_screen_dependent_not_backgroundable_synthetic",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-8", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=synthetic_caps,
    )
    # Isolates the LEFTMOST leg of the 3-way `or` (`active_service_id ==
    # full_karaoke`) from the `stopped_only` leg immediately after it: the
    # real committed full_karaoke capability has stopped_only=True too, so
    # motion_change_driving_full_karaoke_special_case above can't prove leg
    # 1 fires independently of leg 2. This synthetic full_karaoke capability
    # sets stopped_only=False AND screen_dependent=False (so leg 3 can't
    # fire either) -- the ONLY way this case reaches "stopped" is via
    # `active_service_id == full_karaoke` itself. Fix round 1 (C2 Task 5
    # review) -- same synthetic-capability technique as the case above.
    synthetic_full_karaoke = ServiceCapability(
        service_id=ServiceId.full_karaoke, driving_capable=False, screen_dependent=False,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_full_karaoke_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage-full-karaoke-leg",
        services={ServiceId.full_karaoke: synthetic_full_karaoke},
    )
    _case(
        "motion_change_driving_full_karaoke_leg_isolated_synthetic",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.full_karaoke, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-8b", "route_music", "active_driving_content", ["full_karaoke"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=synthetic_full_karaoke_caps,
    )
    _case(
        "motion_change_stopped_from_backgrounded_resumes_active",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing, motion_state=MotionState.driving,
                                          playback_state=PlaybackState.backgrounded),
            opportunity=_opportunity("op-motion-9", "route_music", "active_driving_content", ["live_viewing"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_stopped_from_active_stays_unchanged",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.driving,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-10", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )

    # === rest_spot_arrived (_rest_spot_arrived): 2 cases ========================
    _case(
        "rest_spot_arrived_wrong_purpose",
        _run_log(status="service_selected", journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
                  opportunity=_opportunity("op-rsa-1", "route_music", "active_driving_content", ["music_playlist"])),
        "rest_spot_arrived",
    )
    _case(
        "rest_spot_arrived_success",
        _run_log(
            status="created",
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop, motion_state=MotionState.driving),
            opportunity=_opportunity("op-rsa-2", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
        "rest_spot_arrived",
    )

    # === rest_started (_rest_started): 2 cases ==================================
    _case(
        "rest_started_wrong_lifecycle_stage",
        _run_log(status="created", journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
                  opportunity=_opportunity("op-rst-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"])),
        "rest_started",
    )
    _case(
        "rest_started_success",
        _run_log(
            status="created",
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
            opportunity=_opportunity("op-rst-2", "rest_recommended", "during_rest_stopped", ["live_viewing"]),
        ),
        "rest_started",
    )

    # === rest_completed (_rest_completed): 5 cases ==============================
    _case(
        "rest_completed_wrong_lifecycle_stage",
        _run_log(status="created", journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
                  opportunity=_opportunity("op-rc-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 15}},
    )
    _case(
        "rest_completed_missing_post_rest",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-2", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={},
    )
    _case(
        "rest_completed_drowsiness_out_of_range",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-3", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 150, "fatigue_level": 20}},
    )
    _case(
        "rest_completed_fatigue_is_boolean_not_int",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-4", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": True}},
    )
    _case(
        "rest_completed_success",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-5", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 15}},
    )

    # === apply_action dispatch fallback: unrecognized action_type (1 case) =====
    # Bypasses pydantic validation via model_construct -- mirrors the
    # docstring's own "fabricated/bypassed value" defensive scenario; a
    # normal JourneyAction(action_type=...) can never hold a value outside
    # the closed JourneyActionType enum.
    bogus_run_log = _run_log(status="created", journey_state=_journey_state(),
                              opportunity=_opportunity("op-bogus-1", "route_music", "active_driving_content", ["music_playlist"]))
    bogus_action = JourneyAction.model_construct(action_type="totally_bogus_action_type", payload={})
    bogus_transition = apply_action(bogus_run_log, bogus_action, now="2026-07-20T10:00:00Z")
    cases.append({
        "name": "apply_action_unrecognized_action_type",
        "input": {
            "run_log": json.loads(bogus_run_log.model_dump_json()),
            "action": {"action_type": "totally_bogus_action_type", "payload": {}},
            "now": "2026-07-20T10:00:00Z",
            "capabilities": None,
        },
        "output": json.loads(bogus_transition.model_dump_json()),
    })

    _write("proposal_journey", {
        "input": {"cases": [{"name": c["name"], **c["input"]} for c in cases]},
        "output": {"results": [{"name": c["name"], "transition": c["output"]} for c in cases]},
    })


# ---------------------------------------------------------------------------
# 31. proposal_journey_preview (services/proposal_journey_preview.preview — C2 Task 5)
# ---------------------------------------------------------------------------

def _capture_journey_preview() -> None:
    from aica_api.models.proposal.enums import LifecycleStage, MotionState, PlaybackState, ProposalRunStatus, ServiceId, TriggerPurpose
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    from aica_api.services.proposal_journey_preview import preview

    def _opportunity(opp_id: str, purpose: str, stage: str, allowed: list[str]) -> ProposalOpportunity:
        return ProposalOpportunity(
            opportunity_id=opp_id, trigger_purpose=TriggerPurpose(purpose), lifecycle_stage=LifecycleStage(stage),
            allowed_service_ids=[ServiceId(s) for s in allowed],
            simulation_time="2026-07-20T09:00:00Z", run_seed="seed-preview-1",
        )

    def _journey_state(**overrides: object) -> JourneyState:
        base: dict = dict(
            lifecycle_stage=LifecycleStage.before_rest_until_stop, motion_state=MotionState.driving,
            active_service_id=None, active_plan_id=None, playback_state=PlaybackState.idle,
            current_plan_ref=None, previous_content=None, rejected_service_ids=[],
        )
        base.update(overrides)
        return JourneyState(**base)

    def _content_evidence(selected_service_id: str, next_transition_policy: str) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="content", package_id="mock_content_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1", input_snapshot={},
            output={
                "selected_service_id": selected_service_id, "next_transition_policy": next_transition_policy,
                "approval_policy": "auto", "completion_rule": "duration_elapsed",
            },
            error=None, used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _run_log(*, journey_state: JourneyState, opportunity: ProposalOpportunity,
                 evidence: list[AlgorithmEvidence] = ()) -> ProposalRunLog:
        return ProposalRunLog(
            run_id="prun_preview_test", created_at="2026-07-20T09:00:00Z", opportunity=opportunity,
            matrix_version="v1", world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
            service_package_id="mock_service_selector_v1", content_package_id="mock_content_selector_v1",
            parameters={}, hyperparameters={}, journey_state=journey_state, events=[],
            evidence=list(evidence), status=ProposalRunStatus.content_selected,
        )

    cases: list[dict] = []

    def _case(name: str, run_log: ProposalRunLog) -> None:
        result = preview(run_log)
        cases.append({
            "name": name,
            "input": {"run_log": json.loads(run_log.model_dump_json())},
            "output": json.loads(result.model_dump_json()),
        })

    _case(
        "rest_chain_from_before_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
            opportunity=_opportunity("op-prev-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
    )
    _case(
        "rest_chain_from_during_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
            opportunity=_opportunity("op-prev-2", "rest_recommended", "during_rest_stopped", ["live_viewing"]),
        ),
    )
    _case(
        "rest_chain_from_after_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.after_rest_before_restart),
            opportunity=_opportunity("op-prev-3", "rest_recommended", "after_rest_before_restart", ["live_viewing"]),
        ),
    )
    _case(
        "active_content_chain_with_policy_note",
        _run_log(
            journey_state=_journey_state(
                lifecycle_stage=LifecycleStage.active_driving_content, active_service_id=ServiceId.music_playlist,
            ),
            opportunity=_opportunity("op-prev-4", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence("music_playlist", "auto_advance")],
        ),
    )
    _case(
        "active_content_chain_no_committed_plan_note_none",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
            opportunity=_opportunity("op-prev-5", "inattentive_driving_prevention_recovery",
                                      "active_driving_content", ["music_playlist"]),
        ),
    )
    # rest_recommended purpose, but journey_state.lifecycle_stage is NOT one
    # of the three rest stages (no cross-validator ties journey_state's
    # lifecycle_stage to the opportunity's own -- they're independent
    # fields) -- exercises `_rest_chain_from`'s `next(..., 0)` not-found
    # fallback. Expected to be byte-IDENTICAL to "rest_chain_from_before_rest"
    # (see the task report): `next(..., 0)` defaults to the SAME index 0 a
    # found match at `before_rest_until_stop` would give.
    _case(
        "rest_chain_stage_not_found_falls_back_to_full_chain",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
            opportunity=_opportunity("op-prev-6", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
    )

    _write("proposal_journey_preview", {
        "input": {"cases": [{"name": c["name"], **c["input"]} for c in cases]},
        "output": {"results": [{"name": c["name"], "preview": c["output"]} for c in cases]},
    })


# ---------------------------------------------------------------------------
# 31. explanation_builder (direct calls — C3 task 1, shared vocabulary +
#     sentence machinery every step module builds on)
# ---------------------------------------------------------------------------
#
# Every case below is named for the branch it targets (see task-1-report.md's
# branch-coverage table for the full cross-reference). Two cases
# ("real_service_candidate"/"real_content_item") are pulled from the ALREADY
# COMMITTED service_selector.json / content_selector.json goldens (real
# algorithm.evaluate() output, not hand-authored) so at least one case per
# function runs against a genuine candidate/item shape, not just synthetic
# boundary probes. The rest are hand-authored dicts shaped exactly like the
# real `RankedCandidate` / `OrderedItem` / `FeatureContribution` /
# `ItemFeatureContribution` contracts (see app/api/aica_api/models/proposal/
# service_output.py + content_output.py) — this file's own capture rig has
# precedent for hand-authored "input" cases (see e.g. _capture_driver_signals,
# _capture_anomaly: "preserve existing inputs, re-derive outputs"), and a
# pure function operating on plain dicts does not need a full algorithm run
# to exercise a specific branch honestly.

def _capture_explanation_builder() -> None:
    from aica_api.services import explanation_builder as eb

    # ── real candidate/item pulled from already-committed goldens ──────────
    service_selector_golden = _load_json(_OUT / "service_selector.json")
    real_service_candidate = None
    for case in service_selector_golden["output"]["results"]:
        cands = case["decision"].get("ranked_candidates") or []
        if cands:
            real_service_candidate = cands[0]
            break
    assert real_service_candidate is not None, "no ranked_candidates in service_selector.json to sample from"

    content_selector_golden = _load_json(_OUT / "content_selector.json")
    real_content_item = None
    for case in content_selector_golden["output"]["results"]:
        items = case["decision"].get("ordered_items") or []
        if items:
            real_content_item = items[0]
            break
    assert real_content_item is not None, "no ordered_items in content_selector.json to sample from"

    # ======================================================================
    # label_for / feature_meaning
    # ======================================================================
    label_ids = [
        "drowsiness_level", "drowsiness", "oshi_artists", "continuous_driving_min",
        "totally_unknown_feature", "",
    ]
    labels_out = {fid: eb.label_for(fid) for fid in label_ids}

    meaning_ids = ["drowsiness_level", "age_band", "driving_anomaly", "totally_unknown_feature"]
    meanings_out = {fid: eb.feature_meaning(fid) for fid in meaning_ids}

    # ======================================================================
    # feature_family
    # ======================================================================
    family_ids = [
        "drowsiness_level", "drowsiness", "oshi_artists", "catalog_item_usage_level",
        "service_recovery_rate", "motion_state", "totally_unknown",
    ]
    family_out = {fid: eb.feature_family(fid) for fid in family_ids}

    # ======================================================================
    # _value_display
    # ======================================================================
    value_display_cases = [
        ("bool_true", True), ("bool_false", False),
        ("numeric_high", 0.72), ("numeric_medium", 0.50), ("numeric_low", 0.20),
        ("numeric_boundary_high_0.62", 0.62), ("numeric_boundary_medium_0.40", 0.40),
        ("string_passthrough", "heavy"), ("string_empty", ""), ("none_value", None),
    ]
    value_display_out = {name: eb._value_display(v) for name, v in value_display_cases}

    # ======================================================================
    # _lvl3
    # ======================================================================
    lvl3_cases = [
        ("none", None, 0.34, 0.66),
        ("low", 0.10, 0.34, 0.66),
        ("boundary_lo_is_mid_not_low", 0.34, 0.34, 0.66),
        ("mid", 0.50, 0.34, 0.66),
        ("boundary_hi_is_high", 0.66, 0.34, 0.66),
        ("high", 0.99, 0.34, 0.66),
    ]
    lvl3_out = {name: eb._lvl3(v, lo, hi) for name, v, lo, hi in lvl3_cases}

    # ======================================================================
    # _reason_row_value / _reason_row_contribution (direct)
    # ======================================================================
    def _row_target(rows):
        return {"feature_contributions": rows}

    reason_row_cases = {
        "feature_value_branch": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "e_i_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": 0.5, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "no_match": {
            "target": _row_target([{"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_non_numeric": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": None}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "matched_row_but_neither_value_field_present": {
            "target": _row_target([{"feature_id": "drowsiness_level", "contribution": 0.02}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        # ── divergence hazard 8 (design doc): isinstance(x, (int, float))
        # accepts bool in Python; a naive `typeof x === 'number'` TS guard
        # does not. These four synthetic cases (a bool can never reach here
        # from real Pydantic-typed evidence, hence hand-constructed rather
        # than pulled from a golden) pin `_reason_row_value`'s `e_i` branch
        # and `_reason_row_contribution`'s own guard on both True and False.
        "e_i_bool_true_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": True, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "e_i_bool_false_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": False, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_bool_true": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": True}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_bool_false": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": False}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        # ── featureIdStr defect coverage (whole-slice review finding) ──────
        # `str(fc.get("feature_id", ""))` (line 448/463) only substitutes the
        # default when the KEY IS ABSENT — an explicit `None`/bool
        # feature_id still goes through `str()`, giving "None"/"True", NOT
        # the empty string a `.get(key, "")`-alone read would suggest. Match
        # against the STRINGIFIED id so the case only succeeds (returns the
        # row's real value/contribution instead of None) when the id is
        # coerced correctly — a naive `fc.feature_id ?? ''`/`String(bool)`
        # TS port would fail to match "None"/"True" and silently return None
        # for both fields instead.
        "explicit_none_feature_id_matches_the_string_None": {
            "target": _row_target([{"feature_id": None, "feature_value": 42, "contribution": 0.1}]),
            "feature_ids": ["None"],
        },
        "explicit_bool_true_feature_id_matches_the_string_True": {
            "target": _row_target([{"feature_id": True, "feature_value": 42, "contribution": 0.1}]),
            "feature_ids": ["True"],
        },
    }
    reason_row_out = {}
    for name, spec in reason_row_cases.items():
        reason_row_out[name] = {
            "value": eb._reason_row_value(spec["target"], *spec["feature_ids"]),
            "contribution": eb._reason_row_contribution(spec["target"], *spec["feature_ids"]),
        }

    # ======================================================================
    # _factors_from_target
    # ======================================================================
    factors_cases = {
        "normal_sort_and_band": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "e_i": None, "contribution": 0.05},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.20},
            {"feature_id": "monotony_level", "feature_value": 50, "contribution": -0.10},
        ]),
        "drop_negligible": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": 0.05},
            {"feature_id": "road_type", "feature_value": "highway", "contribution": 1e-8},
        ]),
        "missing_value_blank_display": _row_target([
            {"feature_id": "oshi_artists", "contribution": 0.05},
        ]),
        "string_value_passthrough": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": "heavy", "contribution": 0.3},
        ]),
        # divergence hazard 8 (design doc): `contribution = float(fc.get(...)
        # or 0.0)` treats a bool contribution as truthy/falsy, not just
        # "is it a number" — True -> 1.0 (kept), False -> 0.0 (falls below
        # _MIN_ABS_CONTRIBUTION and is dropped, same as an absent/zero row).
        # Hand-constructed: contribution is Pydantic-typed float on real
        # evidence, so a bool value cannot arrive from a real run.
        "bool_contribution_true_kept_false_dropped": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": True},
            {"feature_id": "road_type", "feature_value": "highway", "contribution": False},
        ]),
        # ── featureIdStr defect coverage (whole-slice review finding) ──────
        # `str(fc.get("feature_id", ""))` (line 361) turns an explicit
        # `None`/bool feature_id into "None"/"True", which then flows
        # straight into the output row's `feature_id` AND (via `label_for`'s
        # not-found fallback, `{"ja": feature_id, "en": feature_id}`) its
        # `label_ja`/`label_en` too — neither id is in FEATURE_LABELS, so the
        # fallback echoes the stringified id verbatim, making the divergence
        # directly visible in the captured output (a buggy TS port that
        # returns "" or "true" would print a DIFFERENT feature_id/label than
        # this golden's "None"/"True").
        "explicit_none_feature_id_labels_as_the_string_None": _row_target([
            {"feature_id": None, "feature_value": 80, "contribution": 0.05},
        ]),
        "explicit_bool_true_feature_id_labels_as_the_string_True": _row_target([
            {"feature_id": True, "feature_value": 80, "contribution": 0.05},
        ]),
        "cap_at_max_factors": _row_target([
            {"feature_id": f"synthetic_feature_{i:02d}", "feature_value": 50, "contribution": (i + 1) * 0.01}
            for i in range(30)
        ]),
        "stable_sort_ties": _row_target([
            {"feature_id": "feature_a", "feature_value": 50, "contribution": 0.05},
            {"feature_id": "feature_b", "feature_value": 50, "contribution": -0.05},
            {"feature_id": "feature_c", "feature_value": 50, "contribution": 0.05},
        ]),
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    factors_out = {name: eb._factors_from_target(t) for name, t in factors_cases.items()}

    # ======================================================================
    # situation_sentence
    # ======================================================================
    situation_cases = {
        "none_when_no_situation_rows": {
            "target": _row_target([{"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.1}]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "alert_engaging_fatigue_excluded": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 10, "contribution": 0.05},
                {"feature_id": "monotony_level", "feature_value": 15, "contribution": 0.02},
                {"feature_id": "fatigue_level", "feature_value": 40, "contribution": 0.01},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "getting_drowsy_and_a_little_monotonous_and_fatigue_boundaries": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 30, "contribution": 0.05},
                {"feature_id": "monotony_level", "feature_value": 35, "contribution": 0.02},
                {"feature_id": "fatigue_level", "feature_value": 55, "contribution": 0.01},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "very_drowsy_and_very_monotonous_boundary_via_e_i": {
            "target": _row_target([
                {"feature_id": "drowsiness", "e_i": 0.60, "contribution": 0.1},
                {"feature_id": "monotony", "e_i": 0.60, "contribution": 0.1},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "night_traffic_road_with_rest_trigger_neutral_lead": {
            "target": _row_target([
                {"feature_id": "night_state", "feature_value": "night", "contribution": 0.01},
                {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.02},
                {"feature_id": "road_type", "feature_value": "mountain_road", "contribution": 0.0},
            ]),
            "trigger_purpose": "rest_recommended", "contributing_only": False,
        },
        "traffic_normal_excluded_env_empty_period_only": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 50, "contribution": 0.05},
                {"feature_id": "traffic_state", "feature_value": "normal", "contribution": 0.02},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "very_drowsy_feature_value_no_env": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 85, "contribution": 0.1}]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "contributing_only_all_gated_out_returns_null": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
                {"feature_id": "monotony_level", "feature_value": 65, "contribution": 0.0},
            ]),
            "trigger_purpose": "route_music", "contributing_only": True,
        },
        "contributing_only_keeps_meaningful_drowsiness": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.25}]),
            "trigger_purpose": "inattentive_driving_prevention_recovery", "contributing_only": True,
        },
        "contributing_only_partial_gate_neutral_fallback_with_env": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
                {"feature_id": "night_state", "feature_value": "night", "contribution": 0.02},
            ]),
            "trigger_purpose": "route_music", "contributing_only": True,
        },
        "content_default_ignores_contribution_magnitude": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0}]),
            "trigger_purpose": "route_music", "contributing_only": False,
        },
        "real_service_candidate_contributing_only": {
            "target": real_service_candidate,
            "trigger_purpose": "inattentive_driving_prevention_recovery", "contributing_only": True,
        },
        "real_content_item_default": {
            "target": real_content_item,
            "trigger_purpose": "route_music", "contributing_only": False,
        },
    }
    situation_out = {}
    for name, spec in situation_cases.items():
        situation_out[name] = eb.situation_sentence(spec["target"], spec["trigger_purpose"], spec["contributing_only"])

    # ======================================================================
    # trigger_sentence
    # ======================================================================
    trigger_sentence_cases = {
        "known_purpose_rest_recommended_motion_stopped": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "stopped", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "known_purpose_inattentive_motion_driving": {
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "driving", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "known_purpose_route_music_lifecycle_fallback_moving": {
            "trigger_purpose": "route_music",
            "target": _row_target([]),
            "lifecycle_stage": "active_driving_content",
        },
        "known_purpose_child_passenger_lifecycle_fallback_stopped": {
            "trigger_purpose": "child_passenger_experience",
            "target": _row_target([]),
            "lifecycle_stage": "during_rest_stopped",
        },
        "unknown_truthy_purpose": {
            "trigger_purpose": "some_future_purpose",
            "target": _row_target([]),
            "lifecycle_stage": None,
        },
        "falsy_purpose_none": {
            "trigger_purpose": None,
            "target": _row_target([]),
            "lifecycle_stage": None,
        },
        "before_rest_until_stop_is_still_moving_trap": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([]),
            "lifecycle_stage": "before_rest_until_stop",
        },
        "after_rest_before_restart_is_stopped": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([]),
            "lifecycle_stage": "after_rest_before_restart",
        },
        "motion_value_uppercase_case_insensitive": {
            "trigger_purpose": "route_music",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "STOPPED", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "motion_value_parked": {
            "trigger_purpose": "route_music",
            "target": _row_target([{"feature_id": "motion", "feature_value": "parked", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
    }
    trigger_sentence_out = {}
    for name, spec in trigger_sentence_cases.items():
        trigger_sentence_out[name] = eb.trigger_sentence(spec["trigger_purpose"], spec["target"], spec["lifecycle_stage"])

    # ======================================================================
    # preference_sentence
    # ======================================================================
    preference_cases = {
        "oshi_artist_only": {"oshi_artist": "YOASOBI"},
        "empty_context_returns_null": {},
        "oshi_registered_false": {"driver_profile": {"oshi_registered": False}},
        "genres_high_and_med_real_enum_only_high_matches": {
            "driver_profile": {"usage_by_genre": {"jpop": "high", "rock": "med"}, "age_band": "20s"},
        },
        "genres_literal_mid_string_also_matches": {
            "driver_profile": {"usage_by_genre": {"anime_song": "mid"}},
        },
        "age_band_via_context_fallback": {
            "driver_profile": {}, "age_band": "30s",
        },
        "all_three_parts_capitalization_and_join": {
            "oshi_artist": "YOASOBI",
            "driver_profile": {"usage_by_genre": {"jpop": "high"}, "age_band": "20s"},
        },
    }
    preference_out = {name: eb.preference_sentence(ctx) for name, ctx in preference_cases.items()}

    # ======================================================================
    # history_sentences
    # ======================================================================
    history_cases = {
        "content_rows_usage_acceptance_played": _row_target([
            {"feature_id": "catalog_item_usage_level", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "content_proposal_acceptance_rate", "e_i": 0.95, "contribution": 0.1},
            {"feature_id": "played_items", "e_i": 1.0, "contribution": 0.05},
        ]),
        "service_rows_recovery_and_usage_mid": _row_target([
            {"feature_id": "service_recovery_rate", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "service_usage_level", "e_i": 0.5, "contribution": 0.05},
        ]),
        "empty_no_history_rows": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": 0.1},
        ]),
        "unhandled_history_fid_falls_through_silently": _row_target([
            {"feature_id": "changed_from_items", "e_i": 1.0, "contribution": 0.05},
        ]),
        "skipped_items_recent": _row_target([
            {"feature_id": "skipped_items", "e_i": 1.0, "contribution": 0.03},
        ]),
        "content_tag_usage_mid_and_scene_high": _row_target([
            {"feature_id": "content_tag_usage_level", "e_i": 0.5, "contribution": 0.02},
            {"feature_id": "scene_content_tag_usage_level", "e_i": 0.9, "contribution": 0.02},
        ]),
        "service_proposal_acceptance_high": _row_target([
            {"feature_id": "service_proposal_acceptance_rate", "e_i": 0.95, "contribution": 0.03},
        ]),
        "service_recency_state_non_normal": _row_target([
            {"feature_id": "service_recency_state", "feature_value": "long_unused", "contribution": 0.02},
        ]),
        "service_recency_state_normal_absorbed_silently": _row_target([
            {"feature_id": "service_recency_state", "feature_value": "normal", "contribution": 0.02},
        ]),
        "dedupe_two_fids_same_sentence_text": _row_target([
            {"feature_id": "service_usage_level", "e_i": 0.9, "contribution": 0.02},
            {"feature_id": "scene_service_usage_level", "e_i": 0.9, "contribution": 0.02},
        ]),
        "content_recovery_rate_high": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.05},
        ]),
        "feature_value_scaling_above_and_below_one": _row_target([
            # fv=90 > 1 -> scaled /100 -> 0.9 -> high -> "often" (catalog_item_usage_level)
            {"feature_id": "catalog_item_usage_level", "feature_value": 90, "contribution": 0.02},
            # fv=0.5 <= 1 -> used UNSCALED -> mid -> "sometimes" (service_usage_level, via the
            # feature_value fallback path rather than e_i — both scaling branches exercised here)
            {"feature_id": "service_usage_level", "feature_value": 0.5, "contribution": 0.02},
        ]),
        # divergence hazard 8 (design doc): `e` starts as `fc.get("e_i")`;
        # `isinstance(e, (int, float))` accepts a bool `e_i` as-is (True/False
        # compare numerically as 1/0 in `_lvl3`), and when `e_i` is absent the
        # `feature_value` fallback's own `isinstance(fv, (int, float))` guard
        # accepts a bool `fv` the same way. Hand-constructed: both fields are
        # Pydantic-typed float on real evidence, so a bool cannot arrive from
        # a real run.
        "history_e_i_bool_true_recovery_high": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": True, "contribution": 0.1},
        ]),
        "history_e_i_bool_false_recovery_low_no_sentence": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": False, "contribution": 0.1},
        ]),
        "history_feature_value_bool_true_usage_high": _row_target([
            {"feature_id": "catalog_item_usage_level", "feature_value": True, "contribution": 0.05},
        ]),
        "history_feature_value_bool_false_usage_low_no_sentence": _row_target([
            {"feature_id": "catalog_item_usage_level", "feature_value": False, "contribution": 0.05},
        ]),
        # ── featureIdStr defect coverage (whole-slice review finding) ──────
        # `str(fc.get("feature_id", ""))` (line 616) is exercised here too —
        # included for call-path coverage (the row must not raise and must
        # be silently skipped either way). NOTE: unlike factors_cases/
        # reason_row_cases above, this case is NOT expected to move the
        # golden: history_sentences only ever uses `fid` for membership
        # tests against the fixed _REASON_HISTORY_FEATURES/_SITUATION/
        # _PREFERENCE sets, none of which contain "None"/"True"/""/"False"
        # (verified against explanation_builder.py's literal set contents),
        # so a None/bool feature_id row is dropped identically whether `fid`
        # stringifies correctly or not. Kept anyway so the shared
        # `featureIdStr` helper's call site inside `historySentences` is
        # still exercised end-to-end (no exception, no stray sentence).
        "explicit_none_feature_id_no_family_match_dropped_silently": _row_target([
            {"feature_id": None, "e_i": 0.9, "contribution": 0.05},
        ]),
        "explicit_bool_true_feature_id_no_family_match_dropped_silently": _row_target([
            {"feature_id": True, "e_i": 0.9, "contribution": 0.05},
        ]),
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    history_out = {name: eb.history_sentences(t) for name, t in history_cases.items()}

    # ======================================================================
    # _score_strength (direct)
    # ======================================================================
    score_strength_cases = [
        ("positive_major", 0.30), ("positive_major_boundary_0.08", 0.08),
        ("positive_significant", 0.05), ("positive_significant_boundary_0.04", 0.04),
        ("positive_minor", 0.02), ("positive_minor_boundary_0.015", 0.015),
        ("positive_slight", 0.005),
        ("negative_strongly", -0.30), ("negative_strongly_boundary_0.08", -0.08),
        ("negative_moderately", -0.05), ("negative_moderately_boundary_0.04", -0.04),
        ("negative_slightly", -0.01),
        ("exact_zero_reads_as_slightly_against", 0.0),
    ]
    score_strength_out = {name: eb._score_strength(c) for name, c in score_strength_cases}

    # ======================================================================
    # score_evidence
    # ======================================================================
    def _factor(fid, label_en, contribution):
        return {"feature_id": fid, "label_en": label_en, "label_ja": label_en, "contribution": contribution,
                "value": None, "value_display": "", "meaning": ""}

    score_evidence_cases = {
        "oshi_positive_with_artist_name": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", 0.30)], "YOASOBI",
        ),
        "oshi_positive_without_artist_name": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", 0.30)], None,
        ),
        "oshi_negative_falls_back_to_plain_label": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", -0.10)], "YOASOBI",
        ),
        "mixed_tiers_four_positive_and_three_negative": (
            [
                _factor("a", "feat a", 0.30), _factor("b", "feat b", 0.05),
                _factor("c", "feat c", 0.02), _factor("d", "feat d", 0.010),
                _factor("e", "feat e", -0.30), _factor("f", "feat f", -0.05),
            ], None,
        ),
        "mixed_tiers_negative_slightly_via_score_evidence": (
            [_factor("g", "feat g", -0.01)], None,
        ),
        "skip_below_0.008_threshold": (
            [_factor("a", "feat a", 0.30), _factor("b", "feat b", 0.005), _factor("c", "feat c", 0.02)], None,
        ),
        "cap_at_first_six_no_resort": (
            [_factor(f"f{i}", f"feat {i}", 0.01 * (i + 1)) for i in range(8)], None,
        ),
    }
    score_evidence_out = {name: eb.score_evidence(factors, oshi) for name, (factors, oshi) in score_evidence_cases.items()}

    # ======================================================================
    # category_readout
    # ======================================================================
    category_cases = {
        "dominant_situation": {"situation_fit": 0.30, "preference_fit": 0.05, "history_fit": -0.02},
        "dominant_preference_by_magnitude": {"situation_fit": 0.04, "preference_fit": -0.20, "history_fit": 0.03},
        "dominant_history": {"situation_fit": 0.01, "preference_fit": 0.01, "history_fit": 0.5},
        "none_when_no_subtotals": {"item_id": "x"},
        "partial_only_situation_and_preference": {"situation_fit": 0.02, "preference_fit": 0.10},
        "tie_situation_vs_preference_first_wins": {"situation_fit": 0.05, "preference_fit": -0.05, "history_fit": 0.01},
        "tie_preference_vs_history_first_present_wins": {"preference_fit": -0.08, "history_fit": 0.08},
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    category_out = {name: eb.category_readout(t) for name, t in category_cases.items()}

    # ======================================================================
    # shared kernel constants the step modules (tasks 2-3) read off `_k.*`
    # ======================================================================
    constants_out = {
        "MAX_FACTORS": eb.MAX_FACTORS,
        "MIN_ABS_CONTRIBUTION": eb._MIN_ABS_CONTRIBUTION,
        "CONTRIBUTING_THRESHOLD": eb._CONTRIBUTING_THRESHOLD,
        "CONTENT_LANG_SEP": eb._CONTENT_LANG_SEP,
        "FORMAT_REMINDER": eb._FORMAT_REMINDER,
        "REASON_CLOSING": eb._REASON_CLOSING,
        "CONTENT_REASON_SYSTEM": eb._CONTENT_REASON_SYSTEM,
        "SERVICE_REASON_SYSTEM": eb._SERVICE_REASON_SYSTEM,
    }

    _write("explanation_builder", {
        "input": {
            "label_ids": label_ids,
            "meaning_ids": meaning_ids,
            "family_ids": family_ids,
            "value_display_cases": [{"name": n, "value": v} for n, v in value_display_cases],
            "lvl3_cases": [{"name": n, "v": v, "lo": lo, "hi": hi} for n, v, lo, hi in lvl3_cases],
            "reason_row_cases": reason_row_cases,
            "factors_cases": factors_cases,
            "situation_cases": situation_cases,
            "trigger_sentence_cases": trigger_sentence_cases,
            "preference_cases": preference_cases,
            "history_cases": history_cases,
            "score_strength_cases": [{"name": n, "c": c} for n, c in score_strength_cases],
            "score_evidence_cases": {
                name: {"factors": factors, "oshi_artist": oshi} for name, (factors, oshi) in score_evidence_cases.items()
            },
            "category_cases": category_cases,
        },
        "output": {
            "labels": labels_out,
            "meanings": meanings_out,
            "family": family_out,
            "value_display": value_display_out,
            "lvl3": lvl3_out,
            "reason_row": reason_row_out,
            "factors": factors_out,
            "situation": situation_out,
            "trigger_sentence": trigger_sentence_out,
            "preference": preference_out,
            "history": history_out,
            "score_strength": score_strength_out,
            "score_evidence": score_evidence_out,
            "category": category_out,
            "constants": constants_out,
        },
    })


# ---------------------------------------------------------------------------
# 32. trigger_explanation (direct calls — C3 task 2, trigger-fire rank-1
#     rationale target-building + template rendering)
# ---------------------------------------------------------------------------
#
# Real fires are built from REAL nri_fatigue_score_v1 /
# aica_transparent_hybrid_trigger_v1 algorithm.evaluate() calls — the SAME
# signal/context/prev-state recipes app/api/tests/proposal/
# test_trigger_explanation.py itself uses (duplicated here rather than
# imported, since that module's fixtures are pytest.fixture-wrapped and not
# directly callable outside a pytest session) — so the fixture exercises
# genuine recorded chain shapes, not a hand-faked one. Edge/boundary cases a
# real run cannot reach on demand (malformed rows, an explicit unrecognized
# category, a bool score/threshold, a dead-band zero row, ...) are
# hand-built, but ONLY in the recorded chain SHAPE (feature_id/value/band/
# weight/contribution), mirroring that test module's own precedent for when
# a synthetic-but-legally-shaped chain is fair game.

def _capture_trigger_explanation() -> None:
    from aica_api.services import trigger_explanation as te
    import importlib.util

    def _load_alg_module(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    nri_dir = _PACKAGES_DIR / "nri_fatigue_score_v1"
    hybrid_dir = _PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1"

    def _hp(pkg_dir):
        data = _load_json(pkg_dir / "package.json")
        return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}

    nri = _load_alg_module("nri_alg_trigger_explain_capture", nri_dir / "algorithm.py")
    hybrid = _load_alg_module("hybrid_alg_trigger_explain_capture", hybrid_dir / "algorithm.py")
    nri_hp = _hp(nri_dir)
    hybrid_hp = _hp(hybrid_dir)

    empty_ph = {
        "lastProposalTimeSec": None, "lastProposalCategory": None,
        "lastProposalResult": None, "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 0.0,
    }

    # ── NRI real-run fire builders (mirrors test_trigger_explanation.py) ──

    def _nri_signals(**overrides):
        signals = {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
        }
        for key, value in overrides.items():
            for group in signals.values():
                if key in group:
                    group[key] = value
        return signals

    def _nri_ctx(signals, prev_state=None, sim_time=60.0):
        return {
            "simulation_time_sec": sim_time,
            "signals": signals,
            "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
            "hyperparameters": nri_hp,
            "parameters": {},
            "proposal_history": dict(empty_ph),
            "user_action_history": [],
            "package_runtime_state": prev_state or {},
            "recovery_active": False,
        }

    def _nri_primed_state(driving_min_since_rest=None):
        if driving_min_since_rest is None:
            driving_min_since_rest = nri_hp["threshold_fire"] / nri_hp["w_base"]
        return {
            "cumulative_jam_min": 0.0, "cumulative_highway_min": 0.0,
            "cumulative_monotonous_min": 0.0,
            "driving_min_since_rest": driving_min_since_rest,
            "last_sim_time": 0.0, "was_in_recovery": False,
        }

    def _nri_between_thresholds_state():
        target = (nri_hp["threshold_monotony"] + nri_hp["threshold_fire"]) / 2.0
        driving_min = target / nri_hp["w_base"] - 1.0
        return _nri_primed_state(driving_min_since_rest=driving_min)

    def _fire_from_result(result, tick=1, time_min=1.0):
        category = result["selected_category"]
        strength = next((c.get("strength") for c in result["candidates"] if c["category"] == category), None)
        return {
            "category": category, "strength": strength, "tick": tick, "time_min": time_min,
            "feature_contributions": result["feature_contributions"], "criteria": result["criteria"],
        }

    nri_rest_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_primed_state(), sim_time=60.0))
    )
    assert nri_rest_fire["category"] == "rest_required", "setup sanity"

    nri_monotony_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_between_thresholds_state(), sim_time=60.0))
    )
    assert nri_monotony_fire["category"] == "monotony_prevention", "setup sanity"

    nri_drowsiness_led_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(
            _nri_signals(drowsiness=100.0, fatigue=0.0),
            prev_state=_nri_primed_state(driving_min_since_rest=90.0), sim_time=60.0,
        ))
    )
    assert nri_drowsiness_led_fire["category"] == "rest_required", "setup sanity"

    # ── Hybrid real-run fire builder ──

    def _hybrid_signals(**overrides):
        signals = {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
        }
        for key, value in overrides.items():
            for group in signals.values():
                if key in group:
                    group[key] = value
        return signals

    hybrid_high_signals = _hybrid_signals(drowsiness=85.0, fatigue=85.0, anomaly_rate=6.0, nextRestSpotMin=10.0)

    def _hybrid_ctx(signals, prev_state=None, sim_time=3600.0):
        return {
            "simulation_time_sec": sim_time,
            "signals": signals,
            "feature_groups": {"normalized": {}, "ordinal": {}},
            "hyperparameters": hybrid_hp,
            "parameters": {},
            "proposal_history": dict(empty_ph),
            "user_action_history": [],
            "package_runtime_state": prev_state or {},
            "recovery_active": False,
        }

    def _hybrid_steady_state(signals, counter_rest):
        accumulators = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}
        feats = hybrid.extract_features(signals, accumulators, hybrid_hp)
        scores = hybrid.category_scores(feats, hybrid_hp)
        return {
            "smoothed_features": dict(feats),
            "smoothed_scores": {
                "rest_required_score": scores["rest_required_score"],
                "monotony_prevention_score": scores["monotony_prevention_score"],
            },
            "persistence_counters": {"rest_required": counter_rest, "monotony_prevention": 0},
            "states": {"rest_state": "REST_NORMAL", "monotony_state": "MONOTONY_NORMAL"},
            "accumulators": accumulators,
        }

    hybrid_prev = _hybrid_steady_state(hybrid_high_signals, counter_rest=int(hybrid_hp["rest_persistence_ticks"]) - 1)
    hybrid_rest_fire = _fire_from_result(hybrid.evaluate(_hybrid_ctx(hybrid_high_signals, prev_state=hybrid_prev)))
    assert hybrid_rest_fire["category"] == "rest_required", "setup sanity"

    # ======================================================================
    # resolve_category
    # ======================================================================
    resolve_category_cases = {
        "defaults_to_fires_own_category": {"fire": nri_rest_fire, "category": None},
        "explicit_choice_wins_over_fires_own": {"fire": nri_rest_fire, "category": "monotony_prevention"},
        "empty_string_category_falls_through_to_fires_own": {"fire": nri_rest_fire, "category": ""},
        "falls_back_to_highest_scoring_chain_when_both_absent": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 12.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "none_when_fire_carries_no_chains": {
            "fire": {"category": None, "feature_contributions": {}}, "category": None,
        },
        "zero_score_chain_still_wins_when_it_is_the_highest": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 0.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": -5.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "picks_rest_required_when_it_is_the_higher_scoring_chain": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 90.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        # divergence hazard 8 (design doc): resolve_category's inner
        # _chain_score is the ONE isinstance guard in this whole module that
        # does NOT exclude bool (line 117) — a bool score IS accepted and
        # coerced (True -> 1.0, False -> 0.0). Hand-constructed: a chain's
        # `score` is always a real float from either package's algorithm.py.
        "bool_score_true_accepted_as_1.0_wins_the_tiebreak": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": True, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 0.5, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "bool_score_false_accepted_as_0.0_loses_the_tiebreak": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": False, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 0.5, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        # divergence hazard 4 (design doc): max(chains, key=...) only
        # replaces the incumbent on a STRICTLY greater score, so a genuine
        # TIE resolves to whichever key comes FIRST in `chains`' own
        # insertion/dict order — this is exactly what happens on every REAL
        # NRI fire (NRI publishes ONE raw score banded by TWO thresholds, so
        # rest_required/monotony_prevention always carry the IDENTICAL
        # score — see the Python module's own docstring). Reusing
        # nri_rest_fire's real (tied) chains with category forced back to
        # None proves the tie-break picks "rest_required" because it is
        # inserted FIRST by `_build_feature_contributions`
        # (packages/nri_fatigue_score_v1/algorithm.py), not because it is
        # hardcoded or alphabetically first.
        "tie_real_nri_scores_first_key_in_insertion_order_wins": {
            "fire": {"category": None, "feature_contributions": nri_rest_fire["feature_contributions"]},
            "category": None,
        },
    }
    resolve_category_out = {
        name: te.resolve_category(spec["fire"], spec["category"]) for name, spec in resolve_category_cases.items()
    }

    # ======================================================================
    # build_target
    # ======================================================================
    build_target_cases = {
        "flattens_chain_and_criteria": {"fire": nri_rest_fire, "category": "rest_required"},
        "degrades_to_an_empty_chain_for_an_unresolved_category": {"fire": {"feature_contributions": {}}, "category": None},
        "category_not_in_chains_degrades_too": {"fire": nri_rest_fire, "category": "totally_unknown_category"},
        "criteria_missing_key_defaults_to_empty": {
            "fire": {
                "category": "rest_required",
                "feature_contributions": {"rest_required": {"score": 10.0, "clamped": False, "rows": [], "gates": []}},
            },
            "category": "rest_required",
        },
        "rows_and_gates_explicit_null_default_to_empty_list": {
            "fire": {
                "category": "rest_required",
                "feature_contributions": {"rest_required": {"score": 10.0, "clamped": False, "rows": None, "gates": None}},
                "criteria": {},
            },
            "category": "rest_required",
        },
        "tick_time_min_strength_pass_through": {"fire": nri_rest_fire, "category": "rest_required"},
    }
    build_target_out = {
        name: te.build_target(spec["fire"], spec["category"]) for name, spec in build_target_cases.items()
    }

    # ======================================================================
    # _num
    # ======================================================================
    num_cases = [
        ("plain_float", 5.5), ("plain_int", 5), ("negative", -3.2), ("zero", 0.0),
        ("bool_true_excluded_reads_as_0", True), ("bool_false_excluded_reads_as_0", False),
        ("string_excluded", "abc"), ("none_excluded", None),
    ]
    num_out = {name: te._num(v) for name, v in num_cases}

    # ======================================================================
    # _threshold_for
    # ======================================================================
    threshold_for_cases = {
        "rest_required_threshold_fire_present": {"category": "rest_required", "criteria": {"threshold_fire": 100.0}},
        "rest_required_falls_back_to_threshold_suggest": {
            "category": "rest_required", "criteria": {"threshold_suggest": 0.7},
        },
        "rest_required_priority_threshold_fire_wins_over_suggest": {
            "category": "rest_required", "criteria": {"threshold_fire": 100.0, "threshold_suggest": 0.7},
        },
        "monotony_prevention_threshold_monotony_present": {
            "category": "monotony_prevention", "criteria": {"threshold_monotony": 60.0},
        },
        "monotony_prevention_falls_back_to_monotony_suggest_threshold": {
            "category": "monotony_prevention", "criteria": {"monotony_suggest_threshold": 0.4},
        },
        "monotony_prevention_priority_threshold_monotony_wins": {
            "category": "monotony_prevention", "criteria": {"threshold_monotony": 60.0, "monotony_suggest_threshold": 0.4},
        },
        "none_category_no_candidate_keys": {"category": None, "criteria": {"threshold_fire": 100.0}},
        "unknown_category_no_candidate_keys": {"category": "totally_unknown_category", "criteria": {"threshold_fire": 100.0}},
        "criteria_missing_all_candidate_keys": {"category": "rest_required", "criteria": {}},
        # divergence hazard 8 (design doc): _threshold_for excludes bool
        # (isinstance(v,(int,float)) and not isinstance(v,bool)) — a bool
        # threshold_fire is skipped, falling through to the next candidate
        # key (or None if exhausted). Hand-constructed: criteria values are
        # always real floats from a package's algorithm.py.
        "bool_first_key_excluded_falls_to_second_key": {
            "category": "rest_required", "criteria": {"threshold_fire": True, "threshold_suggest": 0.7},
        },
        "bool_first_key_excluded_no_second_key_present_returns_none": {
            "category": "rest_required", "criteria": {"threshold_fire": True},
        },
        "string_value_excluded": {"category": "rest_required", "criteria": {"threshold_fire": "not_a_number"}},
    }
    threshold_for_out = {
        name: te._threshold_for(spec["category"], spec["criteria"]) for name, spec in threshold_for_cases.items()
    }

    # ======================================================================
    # _ranked_rows
    # ======================================================================
    ranked_rows_cases = {
        "normal_sort_descending_by_abs_contribution": [
            {"feature_id": "a", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
            {"feature_id": "b", "value": 1.0, "band": None, "weight": 1.0, "contribution": -20.0},
            {"feature_id": "c", "value": 1.0, "band": None, "weight": 1.0, "contribution": 10.0},
        ],
        "stable_sort_ties_preserve_original_order": [
            {"feature_id": "x", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
            {"feature_id": "y", "value": 1.0, "band": None, "weight": 1.0, "contribution": -5.0},
            {"feature_id": "z", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
        ],
        "malformed_rows_dropped_not_raised": [
            None, {"feature_id": "x", "contribution": 3.0}, "not_a_dict", {"contribution": "not_a_number"},
        ],
        "empty_list": [],
        "none_rows_default_to_empty": None,
        "real_nri_rest_rows": nri_rest_fire["feature_contributions"]["rest_required"]["rows"],
        "real_hybrid_rest_rows": hybrid_rest_fire["feature_contributions"]["rest_required"]["rows"],
    }
    ranked_rows_out = {name: te._ranked_rows(rows) for name, rows in ranked_rows_cases.items()}

    # ======================================================================
    # _fmt_num — hazard 7 primary site: banker's-rounding ties at both the
    # .0f (abs>1.5) and .2f (abs<=1.5) branches.
    # ======================================================================
    fmt_num_cases = [
        ("large_scale_tie_2.5_banker_rounds_to_even_2", 2.5),
        ("large_scale_tie_4.5_banker_rounds_to_even_4", 4.5),
        ("large_scale_non_tie", 89.3),
        ("large_scale_negative", -104.0),
        ("boundary_exactly_1.5_uses_2f_branch", 1.5),
        ("boundary_just_above_1.5_uses_0f_branch", 1.5000001),
        ("small_scale_tie_0.125_banker_rounds_to_even_0.12", 0.125),
        ("small_scale_non_tie", 0.781),
        ("small_scale_negative", -0.125),
        ("zero", 0.0),
    ]
    fmt_num_out = {name: te._fmt_num(v) for name, v in fmt_num_cases}

    # ======================================================================
    # _score_display
    # ======================================================================
    score_display_cases = [
        ("nri_scale_raw_score", 63.5),
        ("nri_scale_threshold", 100.0),
        ("hybrid_scale_clamped_score", 0.781),
        ("hybrid_scale_threshold", 0.7),
        ("boundary_1.5_hybrid_branch", 1.5),
        ("tie_2.5_points_branch", 2.5),
        ("zero", 0.0),
    ]
    score_display_out = {name: te._score_display(v) for name, v in score_display_cases}

    # ======================================================================
    # _signed_score_display
    # ======================================================================
    signed_score_display_cases = [
        ("positive_clearance_points_scale", 4.0),
        ("negative_clearance_points_scale", -4.0),
        ("zero_clearance_reads_as_plus", 0.0),
        ("positive_clearance_fraction_scale", 0.081),
        ("negative_clearance_fraction_scale", -0.081),
        ("negative_zero_reads_as_plus", -0.0),
    ]
    signed_score_display_out = {name: te._signed_score_display(v) for name, v in signed_score_display_cases}

    # ======================================================================
    # _unit_kind_for — every table kind + the monotony disambiguation floor
    # ======================================================================
    unit_kind_for_cases = [
        ("table_minutes_continuous_driving_min", "continuous_driving_min", 52.0),
        ("table_minutes_traffic_jam", "traffic_jam", 12.0),
        ("table_minutes_long_highway", "long_highway", 40.0),
        ("table_level_drowsiness", "drowsiness", 66.8),
        ("table_level_fatigue", "fatigue", 31.7),
        ("table_boolean_child_passenger", "child_passenger", 1.0),
        ("table_multiplier_night_amplification", "night_amplification", 1.2),
        ("table_multiplier_familiar_route_amplification", "familiar_route_amplification", 1.0),
        ("unknown_feature_id_returns_none", "totally_unrecognized_feature", 250.0),
        ("monotony_above_floor_is_minutes_nri_style", "monotony", 42.0),
        ("monotony_at_floor_boundary_is_none", "monotony", 1.0),
        ("monotony_below_floor_is_none_hybrid_style", "monotony", 0.75),
        ("monotony_non_numeric_value_is_none", "monotony", "heavy"),
        ("monotony_bool_value_is_none_moot_since_bool_never_exceeds_floor", "monotony", True),
    ]
    unit_kind_for_out = {name: te._unit_kind_for(fid, v) for name, fid, v in unit_kind_for_cases}

    # ======================================================================
    # _fmt_multiplier
    # ======================================================================
    fmt_multiplier_cases = [
        ("trims_trailing_zero_1.20_to_1.2", 1.2),
        ("keeps_one_decimal_1.00_to_1.0", 1.0),
        ("tie_1.125_banker_rounds_to_even_1.12", 1.125),
        ("no_trim_needed_1.23", 1.23),
        ("zero", 0.0),
    ]
    fmt_multiplier_out = {name: te._fmt_multiplier(v) for name, v in fmt_multiplier_cases}

    # ======================================================================
    # _row_value_display / _row_phrase
    # ======================================================================
    row_value_display_cases = {
        "band_wins_over_everything": {"feature_id": "traffic_state", "value": 5.0, "band": "heavy"},
        "band_empty_string_falls_through": {"feature_id": "drowsiness", "value": 70.0, "band": ""},
        "band_none_falls_through": {"feature_id": "drowsiness", "value": 70.0, "band": None},
        "boolean_kind_real_bool_true": {"feature_id": "child_passenger", "value": True},
        "boolean_kind_real_bool_false": {"feature_id": "child_passenger", "value": False},
        "boolean_kind_float_1.0_truthy": {"feature_id": "child_passenger", "value": 1.0},
        "boolean_kind_float_0.0_falsy": {"feature_id": "child_passenger", "value": 0.0},
        "boolean_kind_non_numeric_value_reads_false": {"feature_id": "child_passenger", "value": "yes"},
        "defensive_real_bool_outside_boolean_table_true": {"feature_id": "totally_new_signal", "value": True},
        "defensive_real_bool_outside_boolean_table_false": {"feature_id": "totally_new_signal", "value": False},
        "non_numeric_non_bool_value_renders_dash": {"feature_id": "drowsiness", "value": "heavy"},
        "none_value_renders_dash": {"feature_id": "drowsiness", "value": None},
        "minutes_kind": {"feature_id": "continuous_driving_min", "value": 52.0},
        "multiplier_kind": {"feature_id": "night_amplification", "value": 1.2},
        "level_kind_no_suffix": {"feature_id": "drowsiness", "value": 66.8},
        "unrecognized_feature_id_bare_number": {"feature_id": "totally_new_signal_no_one_has_seen", "value": 250.0},
        "monotony_disambiguated_as_minutes": {"feature_id": "monotony", "value": 42.0},
        "monotony_disambiguated_as_bare": {"feature_id": "monotony", "value": 0.75},
        # divergence hazard 8 corollary: str(row.get("feature_id", "")) — an
        # EXPLICIT None feature_id (key present, value None) prints Python's
        # "None" (not "" and not JS's "null"). No real row omits feature_id
        # or sets it to None (both packages' _row() always supplies a real
        # string), so hand-constructed.
        "explicit_none_feature_id_stringifies_to_python_None": {"feature_id": None, "value": 5.0},
        "missing_feature_id_key_defaults_to_empty_string": {"value": 5.0},
    }
    row_value_display_out = {name: te._row_value_display(row) for name, row in row_value_display_cases.items()}

    row_phrase_cases = {
        "band_wins": {"feature_id": "traffic_state", "value": 5.0, "band": "heavy"},
        "minutes_row": {"feature_id": "continuous_driving_min", "value": 52.0, "band": None},
        "level_row": {"feature_id": "drowsiness", "value": 66.8, "band": None},
        "boolean_row_aboard": {"feature_id": "child_passenger", "value": 1.0, "band": None},
        "multiplier_row": {"feature_id": "night_amplification", "value": 1.2, "band": None},
        "unknown_feature_id_label_falls_back_to_raw_id": {"feature_id": "totally_unrecognized", "value": 5.0, "band": None},
        # divergence hazard 8 corollary (see row_value_display_cases above):
        # str(None) == "None" in Python, not "" and not JS's "null" — this
        # is the ONE case where that actually shows up in rendered text
        # (label_for's fallback echoes the raw id string verbatim, so a
        # wrong stringification would print a visibly wrong label).
        "explicit_none_feature_id_label_becomes_the_python_None_string": {"feature_id": None, "value": 5.0, "band": None},
    }
    row_phrase_out = {name: te._row_phrase(row) for name, row in row_phrase_cases.items()}

    # ======================================================================
    # _dead_band_reason_applies — both ways, plus the boundary
    # ======================================================================
    dead_band_reason_applies_cases = {
        "drowsiness_dead_band_proven": {"feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 0.0},
        # Pulled from the ALREADY-COMMITTED nri_fatigue_score_v1.json golden
        # (decision index 12, a real evaluate() call whose fatigue row
        # genuinely lands at value=31.7/weight=1.5/contribution=0.0 — the
        # dead-band proof, from a real run, not a hand-picked shape).
        # nri_rest_fire's OWN fatigue row can't demonstrate this branch —
        # its signals default fatigue=0.0, so value>0.0 never holds there.
        "fatigue_dead_band_proven_from_a_real_captured_run": next(
            r for r in _load_json(_OUT / "nri_fatigue_score_v1.json")["output"]["decisions"][12]
            ["feature_contributions"]["rest_required"]["rows"]
            if r["feature_id"] == "fatigue"
        ),
        "drowsiness_value_zero_does_not_prove_dead_band": {
            "feature_id": "drowsiness", "value": 0.0, "weight": 1.5, "contribution": 0.0,
        },
        "drowsiness_weight_zero_does_not_prove_dead_band": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 0.0, "contribution": 0.0,
        },
        "drowsiness_real_nonzero_contribution_does_not_apply": {
            "feature_id": "drowsiness", "value": 66.8, "weight": 1.5, "contribution": 10.2,
        },
        "feature_id_outside_dead_band_set_short_circuits_false": {
            "feature_id": "continuous_driving_min", "value": 45.0, "weight": 1.5, "contribution": 0.0,
        },
        "boundary_contribution_exactly_at_epsilon_is_false": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 1e-06,
        },
        "boundary_contribution_just_below_epsilon_is_true": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 0.9e-06,
        },
        "negative_near_zero_contribution_still_applies": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": -1e-08,
        },
        # divergence hazard 8 (design doc): _dead_band_reason_applies uses
        # THIS module's own bool-EXCLUDING _num — a bool weight reads as
        # 0.0, so `weight > 0.0` fails regardless of value/contribution.
        # Hand-constructed: no package emits a bool weight.
        "bool_weight_excluded_reads_as_0_fails_the_check": {
            "feature_id": "drowsiness", "value": 45.0, "weight": True, "contribution": 0.0,
        },
    }
    dead_band_reason_applies_out = {
        name: te._dead_band_reason_applies(row) for name, row in dead_band_reason_applies_cases.items()
    }

    # ======================================================================
    # template — real fires, the Python test suite's own edge fixtures
    # (hand-built ONLY in the recorded chain shape), and gap-filling cases
    # (see task-2-report.md's branch table for which is which).
    # ======================================================================
    template_cases = {
        "nri_rest_names_category_threshold_and_clearance": te.build_target(nri_rest_fire, "rest_required"),
        "nri_monotony_names_its_own_threshold_not_the_fire_one": te.build_target(nri_monotony_fire, "monotony_prevention"),
        "hybrid_fire_produces_a_real_sentence": te.build_target(hybrid_rest_fire, "rest_required"),
        "drowsiness_led_fire_level_value_never_gets_a_minutes_suffix": te.build_target(nri_drowsiness_led_fire, "rest_required"),
        "unrecognized_feature_id_renders_bare_not_guessed": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 300.0, "clamped": False,
                    "rows": [
                        {"feature_id": "totally_new_signal_no_one_has_seen", "value": 250.0, "band": None, "weight": 1.0, "contribution": 250.0},
                        {"feature_id": "continuous_driving_min", "value": 50.0, "band": None, "weight": 0.5, "contribution": 25.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "names_the_dead_band_reason_when_a_zero_row_proves_it": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 105.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 150.0, "band": None, "weight": 0.5, "contribution": 75.0},
                        {"feature_id": "drowsiness", "value": 45.0, "band": None, "weight": 1.5, "contribution": 0.0},
                        {"feature_id": "fatigue", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "does_not_claim_the_dead_band_reason_when_the_row_does_not_support_it": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 100.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 200.0, "band": None, "weight": 0.5, "contribution": 100.0},
                        {"feature_id": "drowsiness", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "two_strongest_rows_and_the_zero_contribution_row_are_named": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 112.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 142.0, "band": None, "weight": 0.5, "contribution": 71.0},
                        {"feature_id": "monotony", "value": 96.0, "band": None, "weight": 0.3, "contribution": 28.8},
                        {"feature_id": "drowsiness", "value": 15.0, "band": None, "weight": 1.5, "contribution": 0.0},
                        {"feature_id": "child_passenger", "value": 0.0, "band": None, "weight": 20.0, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "never_raises_on_an_empty_rows_list": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 90.0},
        }, "rest_required"),
        "never_raises_on_missing_criteria": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []}},
        }, "rest_required"),
        "never_raises_on_a_null_category": te.build_target({"feature_contributions": {}}, None),
        "never_raises_on_an_unrecognized_non_null_category": te.build_target({
            "category": "totally_unknown_category",
            "feature_contributions": {},
        }, "totally_unknown_category"),
        "never_raises_on_malformed_rows": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 100.0, "clamped": False,
                    "rows": [None, {"feature_id": "x"}, "not_a_dict", {"contribution": "not_a_number"}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 90.0},
        }, "rest_required"),
        "has_threshold_but_no_score_omits_the_score_clause": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "bool_score_excluded_omits_the_score_clause_despite_being_1": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": True, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "exactly_one_contributing_row_no_second_phrase": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 125.0, "clamped": False,
                    "rows": [{"feature_id": "continuous_driving_min", "value": 250.0, "band": None, "weight": 0.5, "contribution": 125.0}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "zero_contribution_row_with_null_value_excluded_from_zero_rows": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 125.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 250.0, "band": None, "weight": 0.5, "contribution": 125.0},
                        {"feature_id": "drowsiness", "value": None, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
    }
    template_out = {name: te.template(target) for name, target in template_cases.items()}

    # ======================================================================
    # build_prompt (C3 task 4 — deferred out of Task 2's scope per the
    # brief's own file listing; see task-2-report.md / progress.md). Reuses
    # several already-built REAL targets above, plus synthetic targets for
    # branches no real fire is guaranteed to land in on demand: both margin
    # branches ("just barely" vs "clearly" cleared), a missing threshold, a
    # missing score (threshold present), the bool-accepted score (hazard 8
    # — build_prompt's OWN isinstance(score, (int, float)) checks at lines
    # 536/569 carry NO "and not isinstance(score, bool)" exclusion, unlike
    # template()'s has_score at line 429, which DOES exclude bool — so a
    # bool score is ACCEPTED here and rejected there, on the identical
    # input), empty rows (both WHAT-DROVE-IT and NOTABLY-ABSENT sections
    # omitted), an absent-fact-only row (no contributing rows at all), more
    # than 6 contributing rows (proves the [:6] cap), a row whose `band`
    # wins over `_value_display` in the fact line, and both unknown-category
    # label fallback branches (a real-but-unrecognized string vs None).
    # ======================================================================
    build_prompt_cases = {
        "real_nri_rest_fire": te.build_target(nri_rest_fire, "rest_required"),
        "real_hybrid_rest_fire": te.build_target(hybrid_rest_fire, "rest_required"),
        "real_nri_monotony_fire": te.build_target(nri_monotony_fire, "monotony_prevention"),
        "margin_just_barely_clears": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 101.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 202.0, "band": None, "weight": 0.5, "contribution": 101.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "margin_clearly_clears": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 200.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 400.0, "band": None, "weight": 0.5, "contribution": 200.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "threshold_missing_reads_as_unavailable": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 150.0, "clamped": False, "rows": [], "gates": []}},
            "criteria": {},
        }, "rest_required"),
        "score_missing_but_threshold_present_also_reads_as_unavailable": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "bool_score_true_accepted_unlike_templates_has_score": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": True, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "bool_score_false_accepted_reads_as_negative_clearance": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": False, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "empty_rows_omits_both_drove_it_and_absent_sections": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 150.0, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "absent_fact_only_no_contributing_rows": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 100.0, "clamped": False,
                    "rows": [{"feature_id": "drowsiness", "value": 45.0, "band": None, "weight": 1.5, "contribution": 0.0}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "more_than_six_contributing_rows_caps_at_six": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 300.0, "clamped": False,
                    "rows": [
                        {"feature_id": f"f{i}", "value": float(i + 1), "band": None, "weight": 1.0, "contribution": float(10 - i)}
                        for i in range(8)
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "row_band_wins_over_value_display_in_fact_line": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 150.0, "clamped": False,
                    "rows": [{"feature_id": "traffic_state", "value": 5.0, "band": "heavy", "weight": 1.0, "contribution": 50.0}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "unrecognized_category_label_falls_back_to_raw_string": te.build_target({
            "category": "totally_unknown_category",
            "feature_contributions": {"totally_unknown_category": {"score": 5.0, "clamped": False, "rows": [], "gates": []}},
            "criteria": {},
        }, "totally_unknown_category"),
        "null_category_label_falls_back_to_unknown_placeholder": te.build_target({"feature_contributions": {}}, None),
    }
    build_prompt_out = {name: te.build_prompt(target, {}).model_dump() for name, target in build_prompt_cases.items()}

    _write("trigger_explanation", {
        "input": {
            "resolve_category_cases": resolve_category_cases,
            "build_target_cases": build_target_cases,
            "num_cases": [{"name": n, "v": v} for n, v in num_cases],
            "threshold_for_cases": threshold_for_cases,
            "ranked_rows_cases": ranked_rows_cases,
            "fmt_num_cases": [{"name": n, "v": v} for n, v in fmt_num_cases],
            "score_display_cases": [{"name": n, "v": v} for n, v in score_display_cases],
            "signed_score_display_cases": [{"name": n, "v": v} for n, v in signed_score_display_cases],
            "unit_kind_for_cases": [{"name": n, "feature_id": fid, "value": v} for n, fid, v in unit_kind_for_cases],
            "fmt_multiplier_cases": [{"name": n, "v": v} for n, v in fmt_multiplier_cases],
            "row_value_display_cases": row_value_display_cases,
            "row_phrase_cases": row_phrase_cases,
            "dead_band_reason_applies_cases": dead_band_reason_applies_cases,
            "template_cases": template_cases,
            "build_prompt_cases": build_prompt_cases,
        },
        "output": {
            "resolve_category": resolve_category_out,
            "build_target": build_target_out,
            "num": num_out,
            "threshold_for": threshold_for_out,
            "ranked_rows": ranked_rows_out,
            "fmt_num": fmt_num_out,
            "score_display": score_display_out,
            "signed_score_display": signed_score_display_out,
            "unit_kind_for": unit_kind_for_out,
            "fmt_multiplier": fmt_multiplier_out,
            "row_value_display": row_value_display_out,
            "row_phrase": row_phrase_out,
            "dead_band_reason_applies": dead_band_reason_applies_out,
            "template": template_out,
            "build_prompt": build_prompt_out,
        },
    })


# ---------------------------------------------------------------------------
# 33. service_explanation (C3 task 3) — direct calls against REAL
#     RankedCandidate output already committed in service_selector.json
#     (C1 Task 4), plus one REAL mock_service_selector_v1.evaluate() call
#     (proves _passthrough's fallback is reachable from a real package, not
#     merely synthetic — mock_service_selector_v1 never sets situation_fit/
#     preference_fit/history_fit, so category_readout returns None on every
#     one of its candidates), plus hand-built edge cases for branches no
#     real ServiceId-typed candidate can reach (unknown candidate id, a
#     malformed rationale shape, a strongest_support/oppose dict missing
#     feature_id).
# ---------------------------------------------------------------------------

def _capture_service_explanation() -> None:
    from aica_api.services import service_explanation as se
    import importlib.util

    golden = _load_json(_OUT / "service_selector.json")
    cases = golden["input"]["cases"]
    results = golden["output"]["results"]

    def _cand(case_idx: int, cand_idx: int) -> dict:
        return results[case_idx]["decision"]["ranked_candidates"][cand_idx]

    def _ctx_for(case_idx: int) -> dict:
        c = cases[case_idx]["context"]
        return {"trigger_purpose": c.get("trigger_purpose"), "lifecycle_stage": c.get("lifecycle_stage")}

    # ── _service_label ──────────────────────────────────────────────────
    service_label_ids = ["humming_karaoke", "music_playlist", "oshi_reexperience", "totally_new_future_service"]
    service_label_out = {sid: se._service_label(sid) for sid in service_label_ids}

    # ── build_prompt — real candidates spanning every _TRIGGER_SENTENCES
    #    lead + the stopped/moving motion distinction (rest_recommended
    #    fires BOTH ways depending on lifecycle_stage, see case 8 vs 9) +
    #    situation-gated-in/out + history present/absent, plus one
    #    hand-built target for the unknown-candidate-id desc/label fallback.
    # ======================================================================
    build_prompt_cases = {
        # case 0 cand 0: inattentive_driving_prevention_recovery, situation
        # fully gated in (drowsiness/fatigue/monotony/night/traffic/road all
        # contribute), history present (service_recency_state + acceptance).
        "worked_example_full_situation_and_history": {"target": _cand(0, 0), "context": _ctx_for(0)},
        # case 0 cand 1: same fire, but THIS candidate's history is empty —
        # exercises the "history section omitted" branch.
        "worked_example_no_history": {"target": _cand(0, 1), "context": _ctx_for(0)},
        # case 2 cand 1 (music_playlist): situation entirely gated OUT
        # (contributing_only=True finds no row above CONTRIBUTING_THRESHOLD
        # for this specific candidate) — situation section omitted; history
        # present.
        "situation_entirely_gated_out": {"target": _cand(2, 1), "context": _ctx_for(2)},
        # case 3 cand 0 (music_playlist, route_music trigger purpose):
        # "neutral state" lead phrase (parts empty but env non-empty).
        "neutral_state_lead_with_env": {"target": _cand(3, 0), "context": _ctx_for(3)},
        # case 8 cand 0: rest_recommended + lifecycle_stage=after_rest_before_restart
        # (a genuinely-stopped stage) -> "the car is stopped" branch.
        "rest_recommended_car_stopped": {"target": _cand(8, 0), "context": _ctx_for(8)},
        # case 9 cand 0: rest_recommended + lifecycle_stage=before_rest_until_stop
        # (STILL DRIVING toward the stop, deliberately excluded from
        # _STOPPED_STAGES) -> "the car is moving" branch DESPITE the
        # rest_recommended trigger purpose — the exact documented distinction.
        "rest_recommended_car_still_moving": {"target": _cand(9, 0), "context": _ctx_for(9)},
        # case 10 cand 0: child_passenger_experience trigger purpose (the
        # 4th _TRIGGER_SENTENCES entry).
        "child_passenger_trigger_purpose": {"target": _cand(10, 0), "context": _ctx_for(10)},
        # Unknown candidate_id: _SERVICE_DESC/_SERVICE_LABELS both fall back
        # (raw id passthrough for desc, neutral phrase for the template()
        # label) — unreachable from real evidence (candidate_id is
        # ServiceId-typed on every real RankedCandidate; all 14 members are
        # covered by both tables), hand-built.
        "unknown_candidate_id_desc_falls_back_to_raw_id": {
            "target": {
                "candidate_id": "totally_new_future_service", "rank": 1, "score": 0.4,
                "rationale": ["a", "b"], "supporting_feature_ids": [], "opposing_feature_ids": [],
                "feature_contributions": [],
            },
            "context": {"trigger_purpose": None, "lifecycle_stage": None},
        },
    }
    build_prompt_out = {name: se.build_prompt(spec["target"], spec["context"]).model_dump() for name, spec in build_prompt_cases.items()}

    # ── template — real dom=situation/preference (both with/without
    #    strongest_oppose), real mock-package passthrough, and hand-built
    #    edge cases for branches no real candidate reaches.
    # ======================================================================
    mock_dir = _PACKAGES_DIR / "mock_service_selector_v1"
    mock_spec = importlib.util.spec_from_file_location("mock_service_selector_v1_explain_capture", mock_dir / "algorithm.py")
    mock_mod = importlib.util.module_from_spec(mock_spec)
    mock_spec.loader.exec_module(mock_mod)  # type: ignore[attr-defined]
    mock_out = mock_mod.evaluate({"allowed_service_ids": ["humming_karaoke", "music_playlist", "quiz"]})
    mock_candidate = mock_out["ranked_candidates"][0]
    assert mock_candidate.get("situation_fit") is None, "setup sanity: mock package must not set §14 fields"

    template_cases = {
        "dom_situation_no_oppose": _cand(0, 0),
        "dom_situation_with_oppose": _cand(3, 0),
        "dom_preference_no_oppose": _cand(2, 0),
        # CORRECTED after verification (per the brief's own warning: build
        # the enumeration first, don't assume a scan of `strongest_oppose`
        # truthiness alone proves the guard passes): case 9 cand 0 was
        # ORIGINALLY intended as "dom_preference_with_oppose", but its
        # `strongest_support` is `None` (only `strongest_oppose` is
        # populated) — `template()`'s guard requires BOTH, so this candidate
        # actually falls through to `_passthrough`, not the composed
        # sentence. Scanned the full 11-case golden: NO real candidate has
        # dom=preference with BOTH strongest_support AND strongest_oppose
        # populated (see task-3-report.md) — kept as a REAL passthrough
        # case (still useful, just renamed honestly) and paired with a
        # genuine synthetic case below for the branch it was meant to prove.
        "real_dom_preference_but_ss_is_none_falls_through_to_passthrough": _cand(9, 0),
        "synthetic_dom_preference_with_oppose": {
            "candidate_id": "music_playlist", "rank": 1, "score": 0.4,
            "rationale": ["ja placeholder", "en placeholder"],
            "supporting_feature_ids": [], "opposing_feature_ids": [], "feature_contributions": [],
            "situation_fit": 0.02, "preference_fit": 0.15, "history_fit": 0.0,
            "strongest_support": {"feature_id": "usage_by_genre", "contribution": 0.15},
            "strongest_oppose": {"feature_id": "drowsiness_level", "contribution": -0.03},
        },
        # REAL mock-package output — category_readout is None for every
        # mock_service_selector_v1 candidate (it never sets situation_fit/
        # preference_fit/history_fit), so this is a REAL, not merely
        # synthetic, path into _passthrough.
        "passthrough_via_real_mock_package_no_readout": mock_candidate,
        # dom=history: NOT reachable in the 11-case service_selector.json
        # golden (scanned all candidates — zero have history as the
        # dominant §14 category), so hand-built in the recorded SHAPE
        # (situation_fit/preference_fit/history_fit + strongest_support),
        # labelled synthetic.
        "dom_history_synthetic": {
            "candidate_id": "stretch_video", "rank": 1, "score": 0.3,
            "rationale": ["ja placeholder", "en placeholder"],
            "supporting_feature_ids": [], "opposing_feature_ids": [], "feature_contributions": [],
            "situation_fit": 0.02, "preference_fit": 0.0, "history_fit": 0.20,
            "strongest_support": {"feature_id": "service_recovery_rate", "contribution": 0.20},
            "strongest_oppose": None,
        },
        # Passthrough sub-branches: rationale key absent / empty list /
        # non-list / exactly one element (ja==en) / two-plus elements.
        # None of these are reachable from a real RankedCandidate
        # (Pydantic-typed rationale: list[str], always populated) so all
        # hand-built, mirroring _passthrough's own degrade contract.
        "passthrough_rationale_key_absent": {"candidate_id": "quiz"},
        "passthrough_rationale_empty_list": {"candidate_id": "quiz", "rationale": []},
        "passthrough_rationale_non_list": {"candidate_id": "quiz", "rationale": "not a list"},
        "passthrough_rationale_one_element": {"candidate_id": "quiz", "rationale": ["only one"]},
        "passthrough_rationale_two_elements": {"candidate_id": "quiz", "rationale": ["日本語", "english"]},
        # readout present, strongest_support present but missing feature_id
        # -> guard fails -> passthrough. Unreachable from real evidence (the
        # P5 selector always sets feature_id when it sets strongest_support
        # at all) — hand-built.
        "readout_present_ss_missing_feature_id": {
            "candidate_id": "quiz", "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"contribution": 0.1},
        },
        # cid falsy (candidate_id missing) -> guard fails regardless of
        # readout/ss -> passthrough. Unreachable from real evidence
        # (candidate_id is a required ServiceId field) — hand-built.
        "cid_falsy_forces_passthrough": {
            "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.1},
        },
        # Happy path (readout+ss+cid all valid) but strongest_oppose is a
        # dict MISSING feature_id -> the oppose clause's own guard
        # (`isinstance(so, dict) and so.get("feature_id")`) fails silently,
        # same shape as the ss-missing-feature_id guard above but on the
        # OTHER field — the main sentence still renders normally, just
        # without the oppose clause. Unreachable from real evidence — hand-built.
        "oppose_dict_present_but_missing_feature_id_renders_main_sentence_only": {
            "candidate_id": "quiz", "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.1},
            "strongest_oppose": {"contribution": -0.05},
        },
    }
    template_out = {name: se.template(target) for name, target in template_cases.items()}

    _write("service_explanation", {
        "input": {
            "service_label_ids": service_label_ids,
            "build_prompt_cases": build_prompt_cases,
            "template_cases": template_cases,
        },
        "output": {
            "service_label": service_label_out,
            "build_prompt": build_prompt_out,
            "template": template_out,
        },
    })


# ---------------------------------------------------------------------------
# 34. content_explanation (C3 task 3) — direct calls against REAL
#     OrderedItem output already committed in content_selector.json (C1 Task
#     5), plus one REAL mock_content_selector_v1.evaluate() call (readout is
#     None for every mock item — a REAL, not merely synthetic, path where
#     _situation_led_sentence1 still succeeds), plus a large hand-built
#     matrix for the causal-bridge machinery's branches (dense conditionals
#     that varying REAL selector output cannot reliably hit on demand) and
#     _legacy_join (confirmed NOT reachable from real evidence — see the
#     module's own doc comment and task-3-report.md).
# ---------------------------------------------------------------------------

def _capture_content_explanation() -> None:
    from aica_api.services import content_explanation as ce
    import importlib.util

    golden = _load_json(_OUT / "content_selector.json")
    cases = golden["input"]["cases"]
    results = golden["output"]["results"]

    def _item(case_idx: int, item_idx: int) -> dict:
        return results[case_idx]["decision"]["ordered_items"][item_idx]

    def _ctx_for(case_idx: int, **extra) -> dict:
        c = cases[case_idx]["context"]
        base = {"trigger_purpose": c.get("trigger_purpose"), "lifecycle_stage": c.get("lifecycle_stage")}
        base.update(extra)
        return base

    # ── _effective_alpha_beta ───────────────────────────────────────────
    eab_cases = {
        "both_none_directional_unsafe": (None, None, "fatigue_level"),
        "both_none_in_static_demand": (None, None, "drowsiness_level"),
        "both_none_not_in_static_not_unsafe": (None, None, "totally_unknown_feature"),
        "alpha_none_beta_real": (None, 0.3, "totally_unknown_feature"),
        "alpha_real_beta_none": (0.4, None, "totally_unknown_feature"),
        "both_real_both_near_zero": (1e-7, -1e-7, "totally_unknown_feature"),
        "both_real_normal": (0.5, -0.2, "totally_unknown_feature"),
        "boundary_at_1e6_not_excluded": (1e-6, 0.0, "totally_unknown_feature"),
        "boundary_both_just_below_1e6_excluded": (0.9e-6, 0.9e-6, "totally_unknown_feature"),
        # hazard 8: bool alpha/beta (never real on Pydantic-typed evidence).
        "bool_alpha_true_accepted_as_1.0": (True, None, "totally_unknown_feature"),
        "bool_beta_false_accepted_as_0.0": (0.5, False, "totally_unknown_feature"),
    }
    eab_out = {name: ce._effective_alpha_beta(a, b, fid) for name, (a, b, fid) in eab_cases.items()}

    # ── demand_phrase ────────────────────────────────────────────────────
    demand_phrase_cases = {
        "a_positive_b_not_positive_no_append": (0.5, -0.1, "totally_unknown_feature"),
        "a_positive_b_positive_appends_brighter": (0.8, 0.2, "drowsiness_level"),
        "a_negative_b_not_positive_no_append": (-0.5, -0.1, "totally_unknown_feature"),
        "a_negative_b_positive_appends_brighter": (-0.5, 0.5, "totally_unknown_feature"),
        "a_zero_default_bright_phrase": (0.0, 0.5, "totally_unknown_feature"),
        "resolved_none_directional_unsafe_no_row": (None, None, "fatigue_level"),
    }
    demand_phrase_out = {name: ce.demand_phrase(a, b, fid) for name, (a, b, fid) in demand_phrase_cases.items()}

    # ── _arousal_band ────────────────────────────────────────────────────
    arousal_band_cases = [
        ("high", 0.72), ("boundary_high_0.62", 0.62), ("medium", 0.50),
        ("boundary_low_0.40", 0.40), ("low", 0.20),
    ]
    arousal_band_out = {name: ce._arousal_band(v) for name, v in arousal_band_cases}

    # ── _axis_satisfaction ───────────────────────────────────────────────
    axis_satisfaction_cases = {
        "arousal_energize_satisfied": ("arousal", "energize", "high", None),
        "arousal_energize_unsatisfied": ("arousal", "energize", "medium", None),
        "arousal_soothe_satisfied": ("arousal", "soothe", "low", None),
        "arousal_soothe_unsatisfied": ("arousal", "soothe", "high", None),
        "valence_none_unsatisfied": ("valence", "bright", "medium", None),
        "valence_bright_satisfied": ("valence", "bright", None, 0.7),
        "valence_bright_unsatisfied": ("valence", "bright", None, 0.3),
        "valence_darker_satisfied": ("valence", "darker", None, 0.2),
        "valence_darker_unsatisfied": ("valence", "darker", None, 0.8),
    }
    axis_satisfaction_out = {
        name: ce._axis_satisfaction(axis, direction, band, val)
        for name, (axis, direction, band, val) in axis_satisfaction_cases.items()
    }

    # ── _axis_trait_words ────────────────────────────────────────────────
    axis_trait_words_cases = {
        "arousal_high": ("arousal", "high", None),
        "arousal_medium": ("arousal", "medium", None),
        "arousal_low": ("arousal", "low", None),
        "arousal_band_none_defaults_medium": ("arousal", None, None),
        "valence_none": ("valence", None, None),
        "valence_bright": ("valence", None, 0.7),
        "valence_darker": ("valence", None, 0.2),
        "valence_neutral_zone": ("valence", None, 0.45),
    }
    axis_trait_words_out = {
        name: list(ce._axis_trait_words(axis, band, val)) for name, (axis, band, val) in axis_trait_words_cases.items()
    }

    # ── _axis_choice ─────────────────────────────────────────────────────
    axis_choice_cases = {
        "only_a_arousal_energize": (0.5, 0.0, "medium", None),
        "only_b_valence_bright": (0.0, 0.5, "medium", None),
        "only_a_negative_soothe": (-0.5, 0.0, "medium", None),
        "only_b_negative_darker": (0.0, -0.5, "medium", None),
        "both_arousal_satisfied_only": (0.5, 0.3, "high", 0.3),
        "both_valence_satisfied_only": (0.5, 0.3, "medium", 0.7),
        "both_satisfied_tie_coeff_arousal_wins": (0.5, 0.5, "high", 0.7),
        "both_satisfied_valence_bigger_coeff_wins": (0.3, 0.5, "high", 0.7),
        "neither_satisfied_tie_coeff_arousal_wins": (0.5, 0.5, "low", 0.2),
        "neither_satisfied_arousal_bigger_coeff_wins": (0.6, 0.3, "medium", 0.45),
        "neither_satisfied_valence_bigger_coeff_wins": (0.3, 0.6, "medium", 0.45),
        "no_candidates_both_near_zero": (1e-10, -1e-10, "medium", 0.5),
    }
    axis_choice_out = {
        name: list(ce._axis_choice(a, b, band, val)) if ce._axis_choice(a, b, band, val) is not None else None
        for name, (a, b, band, val) in axis_choice_cases.items()
    }

    # ── _axis_bridge ─────────────────────────────────────────────────────
    axis_bridge_cases = {
        "normal_satisfied": (0.8, 0.2, "high", 0.7),
        "normal_unsatisfied": (0.8, 0.2, "low", 0.2),
        # Defensive-only: choice=None is PROVABLY unreachable when a/b come
        # from _effective_alpha_beta (see content.ts's own comment) — this
        # case calls _axis_bridge DIRECTLY (bypassing _effective_alpha_beta)
        # to exercise the guard itself, which no real call site can trigger.
        "choice_none_direct_call_both_near_zero": (1e-10, -1e-10, "medium", 0.5),
    }
    axis_bridge_out = {name: ce._axis_bridge(a, b, band, val) for name, (a, b, band, val) in axis_bridge_cases.items()}

    # ── _song_facts_lines / causal_bridge_lines — real items ────────────
    real_bridge_item = _item(11, 0)  # eligibility_reasons_bundle, has a motion_state row (skipped) + satisfied lines
    real_bridge_item_unsatisfied = _item(0, 4)  # negative-contribution "leans" branch, synthetic-track-1002
    real_oshi_item = _item(1, 0)  # humming_genre_oshi_on

    song_facts_cases = {
        "real_item_with_oshi_match": {"target": real_oshi_item, "context": {"song_name": "Test Song"}},
        "real_item_no_song_name": {"target": real_bridge_item, "context": {}},
        # hazard 8: e_i bool True for the oshi_artists row equality check
        # (`fc.get("e_i") == 1.0`) — never real (e_i is Pydantic float).
        "oshi_e_i_bool_true_matches_1.0": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "e_i": True, "exact_match": None, "contribution": 0.05}]},
            "context": {},
        },
        "oshi_exact_match_true_no_e_i": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "exact_match": True, "contribution": 0.05}]},
            "context": {},
        },
        "oshi_neither_signal_is_no": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "exact_match": False, "e_i": 0.0, "contribution": 0.0}]},
            "context": {},
        },
    }
    song_facts_out = {name: ce._song_facts_lines(spec["target"], spec["context"]) for name, spec in song_facts_cases.items()}

    causal_bridge_cases = {
        "real_item_satisfied_lines_skips_motion_state": real_bridge_item,
        "real_item_unsatisfied_leans_negative_contribution": real_bridge_item_unsatisfied,
        # HAZARD 7 mutation-test anchor: 0.0625 is an EXACT decimal tie at
        # 3 places (0.0625 * 1000 = 62.5 exactly, in binary too — 1/16 is a
        # power-of-two fraction) — Python's `:+.3f` rounds half-to-even
        # ("+0.062", 62 is even) while `Number.prototype.toFixed` rounds
        # ties away from zero ("+0.063"). No real algorithm.evaluate() run
        # coincidentally lands on an exact tie, so hand-built (contribution
        # is the ONLY field this pins; alpha/beta absent so drowsiness_level
        # resolves via _STATIC_DEMAND, same as several real rows above).
        "hazard7_exact_tie_at_3_decimals": {
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "contribution": 0.0625},
            ],
        },
    }
    causal_bridge_out = {name: ce.causal_bridge_lines(target) for name, target in causal_bridge_cases.items()}

    # ── build_prompt — real content items ───────────────────────────────
    build_prompt_cases = {
        "real_situation_led_with_song_name_and_artist": {
            "target": _item(0, 0),
            "context": {**_ctx_for(0), "song_name": "Jessica", "song_artist": "The Allman Brothers Band"},
        },
        "real_preference_dominant_with_oshi": {
            "target": _item(1, 0),
            "context": {**_ctx_for(1), "song_name": None, "oshi_artist": "Test Artist"},
        },
        # No song_name in context -> name falls back to target_id.
        "no_song_name_falls_back_to_target_id": {"target": _item(15, 0), "context": _ctx_for(15)},
    }
    build_prompt_out = {
        name: ce.build_prompt(spec["target"], spec["context"]).model_dump() for name, spec in build_prompt_cases.items()
    }

    # ── mock_content_selector_v1 — REAL, readout=None path ─────────────
    mock_dir = _PACKAGES_DIR / "mock_content_selector_v1"
    mock_spec = importlib.util.spec_from_file_location("mock_content_selector_v1_explain_capture", mock_dir / "algorithm.py")
    mock_mod = importlib.util.module_from_spec(mock_spec)
    mock_spec.loader.exec_module(mock_mod)  # type: ignore[attr-defined]
    mock_result = mock_mod.evaluate({"selected_service_id": "humming_karaoke", "motion_state": "moving"})
    mock_item = mock_result["ordered_items"][0]
    from aica_api.services import explanation_builder as _eb_check
    assert _eb_check.category_readout(mock_item) is None, "setup sanity: mock content package must not set §14 fields"

    # ── _family_of ───────────────────────────────────────────────────────
    family_of_ids = [
        "drowsiness_level", "oshi_artists", "catalog_item_usage_level", "genre_affinity", "totally_unknown",
    ]
    family_of_out = {fid: ce._family_of(fid) for fid in family_of_ids}

    # ── _dominant_family_sentence1 ──────────────────────────────────────
    dominant_family_cases = {
        "real_preference_positive_support": (real_oshi_item, "preference"),
        "no_feature_in_family_at_all": (
            {"feature_contributions": [{"feature_id": "drowsiness_level", "contribution": 0.2}]}, "preference",
        ),
        "feature_present_but_negative": (
            {"feature_contributions": [{"feature_id": "oshi_artists", "contribution": -0.1}]}, "preference",
        ),
        # dom=history real case from content_selector.json (case 0 item 3)
        # has its best history feature at a NEGATIVE contribution -> None,
        # falls through — a REAL negative-side proof (not synthetic).
        "real_history_dominant_but_negative_falls_through": (_item(0, 3), "history"),
        # dom=history WITH a genuinely positive support feature — NOT
        # reachable in the 21-case content_selector.json golden (scanned
        # every item; the one real history-dominant item's best feature is
        # negative, per the case above) — hand-built, labelled synthetic.
        "synthetic_history_positive_support": (
            {"feature_contributions": [
                {"feature_id": "content_recovery_rate", "contribution": 0.15},
                {"feature_id": "drowsiness_level", "contribution": 0.02},
            ]}, "history",
        ),
    }
    dominant_family_out = {
        name: ce._dominant_family_sentence1(target, dom) for name, (target, dom) in dominant_family_cases.items()
    }

    # ── _situation_led_sentence1 ─────────────────────────────────────────
    situation_led_cases = {
        "real_item": (real_bridge_item, "high", 0.5),
        "best_none_no_situation_feature": (
            {"feature_contributions": [{"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.1}]}, "high", 0.5,
        ),
        "arousal_band_none": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.2},
            ]}, None, 0.5,
        ),
        "value_not_numeric_or_bool_excluded": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": "not_a_number", "feature_value": "also_not",
                 "alpha": 0.8, "beta": 0.2, "contribution": 0.2},
            ]}, "high", 0.5,
        ),
        # hazard 8: bool `value` (e_i=True) must reach valueDisplay's OWN
        # boolean branch (level_ja/level_en = "高く"/"high"), not a coerced
        # plain-number path — never real (e_i is Pydantic float).
        "value_bool_true_via_value_display_boolean_branch": (
            {"feature_contributions": [
                {"feature_id": "child_present", "e_i": True, "alpha": 0.5, "beta": 0.0, "contribution": 0.05},
            ]}, "high", 0.5,
        ),
        # LEVEL_WORDS branch coverage: "real_item" hits 'medium' ("やや高め
        # で"/"elevated") and the bool-True case above hits 'high' ("高く"/
        # "high") — this one hits the 3rd, otherwise-uncovered 'low' band
        # ("低く"/"low"), via a low e_i value (0.15 < 0.40).
        "value_display_low_band": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.15, "alpha": 0.8, "beta": 0.2, "contribution": 0.05},
            ]}, "high", 0.5,
        ),
    }
    situation_led_out = {
        name: ce._situation_led_sentence1(target, band, val) for name, (target, band, val) in situation_led_cases.items()
    }

    # ── template — the full opening-sentence + reinforcement matrix ─────
    template_cases: dict = {
        "real_situation_led_satisfied": _item(0, 0),
        "real_preference_dominant_no_reinforcement": _item(1, 0),
        "real_history_dominant_falls_through_with_negative_reinforcement": _item(0, 3),
        "real_mock_package_readout_none_situation_led_succeeds": mock_item,
        # Synthetic reinforcement matrix — verified directly against a live
        # Python interpreter before capture (see task-3-report.md): a real
        # situation-led sentence1 (lead_family=None) with each of
        # preference/history reinforcing positively, isolated from the one
        # real negative-history case above.
        "synthetic_situation_led_preference_reinforces_positive": {
            "situation_fit": 0.20, "preference_fit": 0.08, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.08},
            ],
        },
        "synthetic_situation_led_preference_reinforces_negative": {
            "situation_fit": 0.20, "preference_fit": -0.08, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "oshi_artists", "e_i": 0.0, "contribution": -0.08},
            ],
        },
        "synthetic_situation_led_history_reinforces_positive": {
            "situation_fit": 0.20, "preference_fit": 0.0, "history_fit": 0.09,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.09},
            ],
        },
        "synthetic_dominant_family_history_positive_leads": {
            "situation_fit": 0.02, "preference_fit": 0.0, "history_fit": 0.15,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.15},
                {"feature_id": "drowsiness_level", "e_i": 0.5, "alpha": 0.8, "beta": 0.2, "contribution": 0.02},
            ],
        },
        "synthetic_dom_preference_attempt_fails_but_still_reinforces_sentence2": {
            "situation_fit": 0.05, "preference_fit": -0.12, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "oshi_artists", "e_i": 0.0, "contribution": -0.12},
                {"feature_id": "drowsiness_level", "e_i": 0.5, "alpha": 0.8, "beta": 0.2, "contribution": 0.05},
            ],
        },
        # _legacy_join reachability — hand-built, trait_values omitted
        # entirely (see this module's own doc comment + task-3-report.md for
        # why no real evidence reaches this).
        "legacy_join_no_rationale": {"item_id": "x"},
        "legacy_join_empty_rationale": {"item_id": "x", "rationale": []},
        "legacy_join_non_list_rationale": {"item_id": "x", "rationale": "not a list"},
        "legacy_join_one_entry_no_separator": {"item_id": "x", "rationale": ["ある理由"]},
        "legacy_join_one_entry_with_separator": {"item_id": "x", "rationale": ["日本語の理由 / english reason"]},
        "legacy_join_multi_entries": {"item_id": "x", "rationale": ["理由1 / reason1", "理由2 / reason2"]},
    }
    template_out = {name: ce.template(target) for name, target in template_cases.items()}

    # ── _legacy_join direct (non-list entries -> str() coercion, incl.
    #    Python's str(None) == "None") ─────────────────────────────────
    legacy_join_direct_cases = {
        "multi_entries": {"rationale": ["理由1 / reason1", "理由2 / reason2"]},
        "non_string_entries_str_coerced": {"rationale": [None, 5, True]},
    }
    legacy_join_direct_out = {name: ce._legacy_join(spec) for name, spec in legacy_join_direct_cases.items()}

    _write("content_explanation", {
        "input": {
            "effective_alpha_beta_cases": {n: {"alpha": a, "beta": b, "feature_id": fid} for n, (a, b, fid) in eab_cases.items()},
            "demand_phrase_cases": {n: {"alpha": a, "beta": b, "feature_id": fid} for n, (a, b, fid) in demand_phrase_cases.items()},
            "arousal_band_cases": [{"name": n, "v": v} for n, v in arousal_band_cases],
            "axis_satisfaction_cases": {
                n: {"axis": ax, "direction": d, "arousal_band": ab, "valence": v}
                for n, (ax, d, ab, v) in axis_satisfaction_cases.items()
            },
            "axis_trait_words_cases": {
                n: {"axis": ax, "arousal_band": ab, "valence": v} for n, (ax, ab, v) in axis_trait_words_cases.items()
            },
            "axis_choice_cases": {
                n: {"a": a, "b": b, "arousal_band": ab, "valence": v} for n, (a, b, ab, v) in axis_choice_cases.items()
            },
            "axis_bridge_cases": {
                n: {"a": a, "b": b, "arousal_band": ab, "valence": v} for n, (a, b, ab, v) in axis_bridge_cases.items()
            },
            "song_facts_cases": song_facts_cases,
            "causal_bridge_cases": causal_bridge_cases,
            "build_prompt_cases": build_prompt_cases,
            "family_of_ids": family_of_ids,
            "dominant_family_cases": {n: {"target": t, "dom": d} for n, (t, d) in dominant_family_cases.items()},
            "situation_led_cases": {
                n: {"target": t, "arousal_band": b, "valence": v} for n, (t, b, v) in situation_led_cases.items()
            },
            "template_cases": template_cases,
            "legacy_join_direct_cases": legacy_join_direct_cases,
            "mock_item": mock_item,
        },
        "output": {
            "effective_alpha_beta": eab_out,
            "demand_phrase": demand_phrase_out,
            "arousal_band": arousal_band_out,
            "axis_satisfaction": axis_satisfaction_out,
            "axis_trait_words": axis_trait_words_out,
            "axis_choice": axis_choice_out,
            "axis_bridge": axis_bridge_out,
            "song_facts": song_facts_out,
            "causal_bridge": causal_bridge_out,
            "build_prompt": build_prompt_out,
            "family_of": family_of_out,
            "dominant_family": dominant_family_out,
            "situation_led": situation_led_out,
            "template": template_out,
            "legacy_join_direct": legacy_join_direct_out,
        },
    })


# ---------------------------------------------------------------------------
# 35. explanation_facade (C3 task 4) — direct calls against
#     `explanation_builder`'s FAÇADE half: `build_explanation_prompt` /
#     `template_rationale` (step dispatch across trigger_explanation /
#     service_explanation / content_explanation) and the three pure
#     LLM-response guards `parse_bilingual` / `response_is_usable` /
#     `strip_placeholder_artifacts`. Reuses REAL candidates/items/targets
#     already committed in service_selector.json / content_selector.json /
#     trigger_explanation.json so the dispatch cases exercise real evidence
#     shapes, not just synthetic ones. `_EXAMPLE_JA`/`_EXAMPLE_EN` are
#     captured as raw values (not hand-transcribed) so the TS port's
#     parrot-guard test cases can byte-match them exactly.
# ---------------------------------------------------------------------------

def _capture_explanation_facade() -> None:
    from aica_api.services import explanation_builder as eb
    from aica_api.models.proposal.explanation import ExplanationPrompt

    constants_out = {
        "EXAMPLE_JA": eb._EXAMPLE_JA,
        "EXAMPLE_EN": eb._EXAMPLE_EN,
    }

    # ── real targets for the step dispatch ─────────────────────────────────
    service_selector_golden = _load_json(_OUT / "service_selector.json")
    real_service_candidate = None
    for case in service_selector_golden["output"]["results"]:
        cands = case["decision"].get("ranked_candidates") or []
        if cands:
            real_service_candidate = cands[0]
            break
    assert real_service_candidate is not None, "no ranked_candidates in service_selector.json to sample from"

    content_selector_golden = _load_json(_OUT / "content_selector.json")
    real_content_item = None
    for case in content_selector_golden["output"]["results"]:
        items = case["decision"].get("ordered_items") or []
        if items:
            real_content_item = items[0]
            break
    assert real_content_item is not None, "no ordered_items in content_selector.json to sample from"

    trigger_golden = _load_json(_OUT / "trigger_explanation.json")
    real_trigger_target = trigger_golden["output"]["build_target"]["flattens_chain_and_criteria"]

    # ======================================================================
    # build_explanation_prompt — step dispatch. "step" is a raw str in
    # Python (not enum-enforced at this layer, see the function's own
    # signature), so anything other than "service"/"trigger" falls through
    # to content_explanation.build_prompt as the unconditional else branch —
    # proven directly with a bogus step string, not merely "content" itself.
    # ======================================================================
    build_explanation_prompt_cases = {
        "service": ("service", real_service_candidate, {"trigger_purpose": "route_music", "lifecycle_stage": None}),
        "content": ("content", real_content_item, {"trigger_purpose": None, "lifecycle_stage": None}),
        "trigger": ("trigger", real_trigger_target, {}),
        "unrecognized_step_falls_through_to_content_else_branch": (
            "totally_bogus_step", real_content_item, {"trigger_purpose": None, "lifecycle_stage": None},
        ),
    }
    build_explanation_prompt_out = {
        name: eb.build_explanation_prompt(step, target, context).model_dump()
        for name, (step, target, context) in build_explanation_prompt_cases.items()
    }

    # ======================================================================
    # template_rationale — same three-way (+ else) dispatch, no LLM/prompt
    # involved.
    # ======================================================================
    template_rationale_cases = {
        "service": ("service", real_service_candidate),
        "content": ("content", real_content_item),
        "trigger": ("trigger", real_trigger_target),
        "unrecognized_step_falls_through_to_content_else_branch": ("totally_bogus_step", real_content_item),
    }
    template_rationale_out = {
        name: eb.template_rationale(step, target) for name, (step, target) in template_rationale_cases.items()
    }

    # ======================================================================
    # parse_bilingual — every parsing branch: inline JA:/EN: (the primary
    # DOTALL regex path, same-line and cross-line), case-insensitive
    # prefixes, code-fence + backtick stripping, JA-only / EN-only (the
    # other falls back to it), plain two-line / one-line / empty input, a
    # plain line sandwiched between two prefixed ones (still ja/en-prefixed
    # wins), and more than two plain lines (only the first two are used).
    # ======================================================================
    parse_bilingual_cases = {
        "ja_en_prefixed_separate_lines": "JA: こんにちは\nEN: hello",
        "ja_en_prefixed_same_line_inline_regex_path": "JA: こんにちは EN: hello",
        "case_insensitive_lowercase_prefixes": "ja: こんにちは\nen: hello",
        "code_fence_and_backtick_wrapped": "```\nJA: `こんにちは`\nEN: `hello`\n```",
        "only_ja_prefix_en_falls_back_to_ja": "JA: こんにちは",
        "only_en_prefix_ja_falls_back_to_en": "EN: hello",
        "two_plain_lines_no_prefixes": "こんにちは\nhello",
        "one_plain_line_both_slots_same": "just one line",
        "empty_input": "",
        "whitespace_only_input": "   ",
        # VERIFIED against a real run (not assumed): the primary regex is
        # `re.DOTALL`, so its non-greedy `(.+?)` group 1 still expands ACROSS
        # the embedded newline + stray line to reach the NEXT "en:" token —
        # group 1 captures "こんにちは\nsome stray plain line", not just
        # "こんにちは". Renamed from an original (wrong) guess that assumed
        # the stray line would fall outside the match.
        "sandwiched_plain_line_gets_absorbed_into_ja_group_by_dotall_regex": "JA: こんにちは\nsome stray plain line\nEN: hello",
        "more_than_two_plain_lines_only_first_two_used": "line1\nline2\nline3",
        # VERIFIED: group 2 (`(.+)`, no end anchor) is greedy and DOTALL, so
        # it swallows everything to the end of the string, including the
        # trailing "noise after" line — en ends up "hello\nnoise after", not
        # bare "hello". Renamed from an original (wrong) guess for the same
        # reason as the case above.
        "inline_regex_en_group_greedily_swallows_trailing_lines": "noise before\nJA: こんにちは\nEN: hello\nnoise after",
    }
    parse_bilingual_out = {name: eb.parse_bilingual(text) for name, text in parse_bilingual_cases.items()}

    # ======================================================================
    # response_is_usable — every rejection reason, individually, plus the
    # positive (usable) case. The docstring names 3 reasons (empty; every
    # non-empty line echoes a user fact line; the JA slot is not actually
    # Japanese script); the EXAMPLE_JA/EXAMPLE_EN verbatim-parrot check is a
    # 4th, DISTINCT reason — the example text is never embedded in the
    # actual prompt messages (see the module's own comment), so it cannot be
    # caught by the echo check; it needs its own case.
    # ======================================================================
    _user_prompt = {
        "messages": [
            {"role": "system", "content": "irrelevant system text"},
            {"role": "user", "content": "- drowsiness: high\n- fatigue: medium\nTHE SITUATION RIGHT NOW: the driver is drowsy."},
        ],
        "grounding": {},
    }
    response_is_usable_cases = {
        "empty_rationale_list": {"rationale": [], "prompt": _user_prompt},
        "whitespace_only_entries_read_as_empty": {"rationale": ["   ", ""], "prompt": _user_prompt},
        "example_ja_verbatim_parrot_rejected": {"rationale": [eb._EXAMPLE_JA, "a genuine english reason"], "prompt": _user_prompt},
        "example_en_verbatim_parrot_rejected": {"rationale": ["本物の日本語の理由です", eb._EXAMPLE_EN], "prompt": _user_prompt},
        "ja_slot_not_japanese_script_hangul_rejected": {"rationale": ["이것은 한국어입니다", "this is korean"], "prompt": _user_prompt},
        "ja_slot_not_japanese_script_pure_english_rejected": {"rationale": ["this is english not japanese", "this is english"], "prompt": _user_prompt},
        "every_line_echoes_a_user_fact_line_rejected": {
            "rationale": ["drowsiness: high", "fatigue: medium"], "prompt": _user_prompt,
        },
        "every_line_echoes_after_stripping_leading_dashes_rejected": {
            "rationale": ["- drowsiness: high", "- fatigue: medium"], "prompt": _user_prompt,
        },
        "ja_empty_string_skips_script_check_but_still_needs_non_echo_text": {
            "rationale": ["", "the driver is drowsy so a rest stop makes sense"], "prompt": _user_prompt,
        },
        "genuine_non_echoing_japanese_reason_is_usable": {
            "rationale": ["眠気が強いため休憩を提案しました。", "drowsiness was high, so a rest stop was suggested."],
            "prompt": _user_prompt,
        },
        # VERIFIED against a real run: rationale[0] is ALWAYS the ja slot the
        # script check runs against, regardless of echo status — an English
        # rationale[0] fails the script check FIRST (returns False before
        # the echo logic even runs). To isolate "at least one non-echoing
        # line is enough" from the script check, the ja slot here is valid
        # (non-echoing) Japanese and the ECHOING line is the en slot.
        "one_echoing_line_and_one_genuine_line_is_usable": {
            "rationale": ["眠気が強い状態が続いていました。", "drowsiness: high"],
            "prompt": _user_prompt,
        },
    }
    response_is_usable_out = {
        name: eb.response_is_usable(spec["rationale"], ExplanationPrompt.model_validate(spec["prompt"]))
        for name, spec in response_is_usable_cases.items()
    }

    # ======================================================================
    # strip_placeholder_artifacts — placeholder removal (English + Japanese,
    # half/full-width, bracketed/unbracketed, case-insensitive, word-boundary
    # guarded), empty-bracket-pair cleanup, whitespace collapse, space-before-
    # punctuation collapse (ASCII + full-width), dangling leading/trailing
    # conjunction removal, and the falsy-input passthrough.
    # ======================================================================
    strip_placeholder_artifacts_cases = {
        "bare_factor_a_removed": "This was driven by factor a and history.",
        "bracketed_factor_b_removed_parens": "This was driven by (factor B) mostly.",
        "bracketed_factor_a_removed_japanese_brackets": "これは「factor A」による判断です。",
        "square_bracketed_factor_b_removed": "Mostly [factor b] drove this.",
        "youin_a_removed": "これは要因Aによる判断です。",
        "youin_b_removed_fullwidth_letter": "これは要因Ｂによる判断です。",
        "word_boundary_guard_factor_above_not_touched": "See the factor above for context.",
        "word_boundary_guard_factors_c_not_touched": "Several factors c contributed.",
        "empty_bracket_pair_left_behind_removed_parens": "This choice was made ( ) mostly for safety.",
        "empty_bracket_pair_left_behind_removed_japanese": "この理由は「 」十分です。",
        "whitespace_collapse_multiple_spaces": "This   was    driven  by history.",
        "space_before_ascii_punctuation_removed": "This was the reason .",
        "space_before_fullwidth_punctuation_removed": "これが理由です 。",
        "space_before_fullwidth_comma_removed": "眠気が強く 、休憩を提案しました",
        "dangling_leading_and_removed_case_insensitive": "And this is why it was chosen.",
        "dangling_leading_japanese_comma_removed": "、これが理由です。",
        "dangling_leading_ascii_comma_removed": ", this is why.",
        "dangling_trailing_and_removed": "This is why it was chosen and",
        "dangling_trailing_japanese_comma_removed": "これが理由です、",
        "dangling_trailing_ascii_comma_removed": "this is why,",
        "falsy_empty_string_input_returned_as_is": "",
        "no_artifacts_present_unchanged_aside_from_trim": "A perfectly normal reason.",
    }
    strip_placeholder_artifacts_out = {
        name: eb.strip_placeholder_artifacts(text) for name, text in strip_placeholder_artifacts_cases.items()
    }

    _write("explanation_facade", {
        "input": {
            "build_explanation_prompt_cases": {
                name: {"step": step, "target": target, "context": context}
                for name, (step, target, context) in build_explanation_prompt_cases.items()
            },
            "template_rationale_cases": {
                name: {"step": step, "target": target}
                for name, (step, target) in template_rationale_cases.items()
            },
            "parse_bilingual_cases": parse_bilingual_cases,
            "response_is_usable_cases": response_is_usable_cases,
            "strip_placeholder_artifacts_cases": strip_placeholder_artifacts_cases,
        },
        "output": {
            "constants": constants_out,
            "build_explanation_prompt": build_explanation_prompt_out,
            "template_rationale": template_rationale_out,
            "parse_bilingual": parse_bilingual_out,
            "response_is_usable": response_is_usable_out,
            "strip_placeholder_artifacts": strip_placeholder_artifacts_out,
        },
    })


# ---------------------------------------------------------------------------
# 36. merged_adapter (services/merged_adapter.py — feature 026, htmlapp
#     Combined export, slice C4 Task 2). `map_trigger_purpose`/
#     `map_road_type` over every mapped key + a fallback; `map_lifecycle_stage`
#     over the exhaustive 2x2x2 (fired x result_type x recovery_phase)
#     cross-product; `build_world_from_tick` over REAL (tick_state, decision)
#     pairs pulled from run_log_e2e.json's own committed tick events (a real
#     nri_fatigue_score_v1 run) against a real committed World template
#     (world_validation.json's "valid_world_no_issues" case) — never
#     hand-typed dicts. The shipped uc01 scenario never produces a
#     mountain_road/sightseeing_road segment or an isNight/isTrafficJam=True
#     tick (verified: route_segments are only normal_road/highway, and both
#     flags are constant False across all 41 real tick events), so those
#     branches are exercised as direct/synthetic cases in the TS test file
#     instead — see task-2-report.md for the full real-vs-synthetic table.
# ---------------------------------------------------------------------------

def _capture_merged_adapter() -> None:
    import types
    from aica_api.services.merged_adapter import (
        build_world_from_tick,
        map_trigger_purpose,
        map_lifecycle_stage,
        map_road_type,
    )
    from aica_api.models.proposal.world import World

    wv = _load_json(_OUT / "world_validation.json")
    base_world_case = wv["input"]["cases"][0]
    assert base_world_case["name"] == "valid_world_no_issues", (
        f"world_validation.json case 0 is {base_world_case['name']!r}, expected "
        "'valid_world_no_issues' — capture rig ordering assumption broke."
    )
    base_world_raw = base_world_case["world"]
    world_template = World.model_validate(base_world_raw)

    # ---- map_trigger_purpose: every result_type BOTH shipped packages
    # actually emit (`grep -n 'result_type = "' packages/*/algorithm.py`):
    # REST_PROPOSAL/MONOTONY_PROPOSAL are mapped; SUPPRESSED/NO_PROPOSAL are
    # NOT — the unmapped ones are the load-bearing case (task brief).
    purpose_cases = {
        rt: map_trigger_purpose(rt)
        for rt in ("REST_PROPOSAL", "MONOTONY_PROPOSAL", "SUPPRESSED", "NO_PROPOSAL")
    }

    # ---- map_lifecycle_stage: exhaustive fired x result_type x
    # recovery_phase cross-product (2x2x2=8), enumerated rather than sampled
    # per the task brief. Only 2 of these 8 combos are ever reached by a
    # real production caller (`_project_fire`/`tick_merged_run_endpoint`
    # both always pass fired=True, recovery_phase=None — verified by
    # grepping every `map_lifecycle_stage(` call site in app/api); the other
    # 6 are unit-level-only direct calls (same reach as Python's own test
    # suite), captured here via a direct function call, not a real run.
    stage_cases = []
    for fired in (True, False):
        for result_type in ("REST_PROPOSAL", "NO_PROPOSAL"):
            for recovery_phase in (None, "nap"):
                stage_cases.append({
                    "fired": fired,
                    "result_type": result_type,
                    "recovery_phase": recovery_phase,
                    "stage": map_lifecycle_stage(
                        fired=fired, result_type=result_type, recovery_phase=recovery_phase
                    ),
                })

    # ---- map_road_type: every mapped segment_type + an unrecognised string
    # + None (2 different "parking" code paths — see adapter.ts doc comment).
    road_cases = [
        {"segment_type": st, "road_type": map_road_type(st)}
        for st in ("highway", "normal_road", "mountain_road", "sightseeing_road", "rest", "unknown_type", None)
    ]

    # ---- build_world_from_tick: REAL correlated (tick_state, result_type)
    # pairs from run_log_e2e.json's committed tick events.
    run_log = _load_json(_OUT / "run_log_e2e.json")
    tick_events = [e for e in run_log["output"]["events"] if e["kind"] == "tick"]

    def _case(idx: int, *, trigger_purpose: str | None = None, lifecycle_stage: str | None = None) -> dict:
        ev = tick_events[idx]
        rt = ev["trace"]["decision_result"]["result_type"]
        purpose = trigger_purpose if trigger_purpose is not None else map_trigger_purpose(rt)
        entry: dict = {
            "tick_index": idx,
            "result_type": rt,
            "purpose": purpose,
            "signals": ev["tick_state"]["signals"],
        }
        if purpose is None:
            entry["stage"] = map_lifecycle_stage(fired=True, result_type=rt, recovery_phase=None)
            entry["world"] = None
            return entry
        stage = lifecycle_stage if lifecycle_stage is not None else map_lifecycle_stage(
            fired=True, result_type=rt, recovery_phase=None
        )
        ts = types.SimpleNamespace(signals=ev["tick_state"]["signals"])
        w = build_world_from_tick(world_template, ts, trigger_purpose=purpose, lifecycle_stage=stage)
        entry["stage"] = stage
        entry["world"] = json.loads(w.model_dump_json())
        return entry

    real_build_cases = {
        # NO_PROPOSAL, unfired — the load-bearing "both proposal and
        # proposal_error None" precursor: purpose is None, no world built.
        "no_proposal_tick0": _case(0),
        "monotony_proposal_tick12_normal_road": _case(12),
        "rest_proposal_tick17_normal_road": _case(17),
        # SUPPRESSED with a non-None recoveryPhase INSIDE the tick's own raw
        # signals (dynamic.recoveryPhase="wakefulness") — proves
        # build_world_from_tick never reads that field at all (only the
        # CALLER's recovery_phase argument, fed to map_lifecycle_stage
        # separately, affects lifecycle_stage).
        "suppressed_tick18_wakefulness_recoveryphase": _case(18),
        "monotony_proposal_tick37_highway": _case(37),
        # After-nap projection: mirrors `_project_after_rest`'s REAL call
        # shape (purpose/stage hardcoded to rest_recommended/
        # after_rest_before_restart regardless of the tick's own
        # result_type) over a real STOPPED/nap tick (idx 20) — this is a
        # genuine second real call site, not a synthetic pairing.
        "after_rest_style_tick20_stopped": _case(
            20, trigger_purpose="rest_recommended", lifecycle_stage="after_rest_before_restart"
        ),
    }

    _write("merged_adapter", {
        "input": {
            "world_template": base_world_raw,
            "situation_key_order": list(base_world_raw["situation"].keys()),
            "control_inputs_key_order": list(base_world_raw["control_inputs"].keys()),
        },
        "output": {
            "purpose_cases": purpose_cases,
            "stage_cases": stage_cases,
            "road_cases": road_cases,
            "real_build_cases": real_build_cases,
        },
    })


# ---------------------------------------------------------------------------
# 37. merged_painter (services/merged_painter.py — feature 026, htmlapp
#     Combined export, slice C4 Task 2). Both functions run against REAL
#     route facts (route_analysis.json's own committed `analyze_route()`
#     output over the shipped uc01 scenario) — never hand-typed segment
#     lists, except the deliberately-out-of-scope empty-list edge case.
# ---------------------------------------------------------------------------

def _capture_merged_painter() -> None:
    from aica_api.models.run import RouteSegmentFact
    from aica_api.services.merged_painter import inject_mountain_segment, jam_traffic_event

    ra = _load_json(_OUT / "route_analysis.json")
    real_segments_raw = ra["output"]["route_segments"]
    real_segments = [RouteSegmentFact.model_validate(s) for s in real_segments_raw]
    real_total_km = ra["output"]["total_route_distance_km"]
    real_duration_min = ra["output"]["estimated_route_duration_min"]

    def _dump(segs) -> list:
        return [json.loads(s.model_dump_json()) for s in segs]

    mountain_cases = {
        # Fully inside real segment 0 (normal_road [0,24)) — 3-piece split.
        "real_fully_inside_first_segment": {
            "start_km": 5.0, "end_km": 15.0,
            "result": _dump(inject_mountain_segment(real_segments, 5.0, 15.0)),
        },
        # Spans the REAL normal_road[60,90)/highway[90,120) boundary at 90 —
        # splits two segments of DIFFERENT original types, 2 adjacent
        # mountain_road pieces in the result.
        "real_spanning_normal_road_highway_boundary": {
            "start_km": 80.0, "end_km": 100.0,
            "result": _dump(inject_mountain_segment(real_segments, 80.0, 100.0)),
        },
        "real_invalid_range_start_gte_end": {
            "start_km": 200.0, "end_km": 200.0,
            "result": _dump(inject_mountain_segment(real_segments, 200.0, 200.0)),
        },
        # end_km beyond the real total (120) clamps to 120; start_km below 0
        # clamps to 0 — the whole real route becomes one mountain_road run.
        "real_range_clamped_to_total_extent": {
            "start_km": -50.0, "end_km": 500.0,
            "result": _dump(inject_mountain_segment(real_segments, -50.0, 500.0)),
        },
        "empty_segments_list": {
            "start_km": 10.0, "end_km": 20.0,
            "result": _dump(inject_mountain_segment([], 10.0, 20.0)),
        },
    }

    jam_cases = {
        "real_default_kwargs": jam_traffic_event(30.0, 50.0, real_total_km, real_duration_min),
        "real_keyword_overrides": jam_traffic_event(
            0.0, 10.0, real_total_km, real_duration_min,
            speed_kph=5.0, event_id="jam-2", affected_segment_id="seg-7",
        ),
    }

    _write("merged_painter", {
        "input": {
            "real_segments": real_segments_raw,
            "real_total_km": real_total_km,
            "real_duration_min": real_duration_min,
        },
        "output": {
            "mountain_cases": mountain_cases,
            "jam_cases": jam_cases,
        },
    })


# ---------------------------------------------------------------------------
# 38. proposal_matrix (models/proposal/matrix.py — feature 026, htmlapp
#     Combined export, slice C4a Task 1). Real committed
#     proposal_contracts/matrix/purpose_stage_matrix.v1.json for load()+
#     resolve() success paths; synthetic (labeled) tampered copies for the
#     3 model_validators' raise branches, mirroring
#     app/api/tests/proposal/test_matrix_resolver.py's own direct-
#     construction technique (real committed data is always valid — none
#     of these branches are reachable through it). The
#     active_driving_content/ACTIVE_DRIVING_PURPOSES-incompatible branch's
#     message is DELIBERATELY NOT CAPTURED as text — its `_ACTIVE_DRIVING_
#     PURPOSES` frozenset iterates in hash-seed-dependent order (same
#     finding already documented for world_validation.json's own
#     incompatible_purpose_stage case) — only "raises: true" is recorded.
# ---------------------------------------------------------------------------

def _capture_proposal_matrix() -> None:
    from pydantic import ValidationError
    from aica_api.models.proposal.enums import LifecycleStage, TriggerPurpose
    from aica_api.models.proposal.matrix import MatrixResolutionError, MatrixRow, PurposeStageServiceMatrix

    matrix_path = _REPO / "proposal_contracts" / "matrix" / "purpose_stage_matrix.v1.json"
    raw = _load_json(matrix_path)
    matrix = PurposeStageServiceMatrix.load(matrix_path)

    # All 6 real rows resolve to exactly their own committed allowed_service_ids.
    resolve_cases = []
    for row in raw["rows"]:
        purpose = TriggerPurpose(row["trigger_purpose"])
        stage = LifecycleStage(row["lifecycle_stage"])
        resolved = matrix.resolve(purpose, stage)
        resolve_cases.append({
            "trigger_purpose": purpose.value,
            "lifecycle_stage": stage.value,
            "allowed_service_ids": [s.value for s in resolved],
        })

    def _resolution_error(purpose: TriggerPurpose, stage: LifecycleStage) -> str:
        try:
            matrix.resolve(purpose, stage)
        except MatrixResolutionError as exc:
            return str(exc)
        raise AssertionError("expected MatrixResolutionError")

    # Real data, incompatible pair (fails the compatibility rule).
    resolution_error_incompatible = _resolution_error(
        TriggerPurpose.route_music, LifecycleStage.before_rest_until_stop
    )
    # Real data, structurally-valid-but-unrepresented pair.
    resolution_error_unknown_pair = _resolution_error(
        TriggerPurpose.child_passenger_experience, LifecycleStage.during_rest_stopped
    )

    def _first_error_message(exc: ValidationError) -> str:
        """pydantic v2: a raised `ValueError` inside a validator surfaces as
        `type='value_error'` with the ORIGINAL message in `ctx.error`
        (`msg` carries a "Value error, " PREFIX that is pydantic's own
        wrapper, not part of the domain message); a structural error (e.g.
        `type='enum'`) has no `ctx.error` at all — `msg` IS the domain
        message there. Branching on `type` gets the bare domain message
        either way, matching what `matrix.ts` actually raises (a plain
        message, never pydantic's wrapper prefix — see that module's doc)."""
        err = exc.errors()[0]
        if err["type"] == "value_error":
            return str(err["ctx"]["error"])
        return err["msg"]

    def _row_validation_error(**kwargs) -> str:
        try:
            MatrixRow(**kwargs)
        except ValidationError as exc:
            return _first_error_message(exc)
        raise AssertionError("expected ValidationError")

    def _row_raises(**kwargs) -> bool:
        try:
            MatrixRow(**kwargs)
        except ValidationError:
            return True
        return False

    # SYNTHETIC (labeled): direct MatrixRow construction with a deliberately
    # incompatible/invalid field — the real frozen artifact never reaches
    # these branches, mirroring test_matrix_resolver.py's own technique.
    rest_stage_incompatible_msg = _row_validation_error(
        trigger_purpose="route_music", lifecycle_stage="during_rest_stopped", allowed_service_ids=[],
    )
    invalid_service_id_msg = _row_validation_error(
        trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop",
        allowed_service_ids=["not_a_real_service_id"],
    )
    invalid_trigger_purpose_raises = _row_raises(
        trigger_purpose="not_a_real_purpose", lifecycle_stage="before_rest_until_stop", allowed_service_ids=[],
    )
    invalid_lifecycle_stage_raises = _row_raises(
        trigger_purpose="rest_recommended", lifecycle_stage="not_a_real_stage", allowed_service_ids=[],
    )
    active_driving_incompatible_raises = _row_raises(
        trigger_purpose="rest_recommended", lifecycle_stage="active_driving_content", allowed_service_ids=[],
    )

    # MatrixRow tolerates the `_note` extra key directly (not just via load()).
    tolerant_row = MatrixRow(
        trigger_purpose="rest_recommended", lifecycle_stage="during_rest_stopped",
        allowed_service_ids=[], _note="explanatory text, not part of the contract",
    )
    tolerates_note_key = tolerant_row.allowed_service_ids == []

    def _matrix_validation_error(rows) -> str:
        try:
            PurposeStageServiceMatrix(matrix_version="v1", rows=rows)
        except ValidationError as exc:
            return _first_error_message(exc)
        raise AssertionError("expected ValidationError")

    # SYNTHETIC (labeled): tampered copies of the real 6 rows, one field
    # changed each time, mirroring test_matrix_resolver.py's own tampering
    # technique exactly (`test_validator_rejects_wrong_row_count`,
    # `test_validator_rejects_malformed_post_rest_row`).
    wrong_row_count_msg = _matrix_validation_error(raw["rows"][:5])

    rows_bad_post_rest_count = [dict(r) for r in raw["rows"]]
    for row in rows_bad_post_rest_count:
        if row["trigger_purpose"] == "rest_recommended" and row["lifecycle_stage"] == "after_rest_before_restart":
            row["allowed_service_ids"] = ["live_viewing"]
    post_rest_wrong_count_msg = _matrix_validation_error(rows_bad_post_rest_count)

    rows_bad_post_rest_members = [dict(r) for r in raw["rows"]]
    for row in rows_bad_post_rest_members:
        if row["trigger_purpose"] == "rest_recommended" and row["lifecycle_stage"] == "after_rest_before_restart":
            row["allowed_service_ids"] = [
                "live_viewing", "stretch_video", "full_karaoke", "oshi_reexperience", "music_playlist",
            ]
    post_rest_wrong_members_msg = _matrix_validation_error(rows_bad_post_rest_members)

    _write("proposal_matrix", {
        "input": {"real_matrix": raw},
        "output": {
            "matrix_version": matrix.matrix_version,
            "resolve_cases": resolve_cases,
            "resolution_error_incompatible": resolution_error_incompatible,
            "resolution_error_unknown_pair": resolution_error_unknown_pair,
            "row_validators": {
                "rest_stage_incompatible_msg": rest_stage_incompatible_msg,
                "invalid_service_id_msg": invalid_service_id_msg,
                "invalid_trigger_purpose_raises": invalid_trigger_purpose_raises,
                "invalid_lifecycle_stage_raises": invalid_lifecycle_stage_raises,
                "active_driving_incompatible_raises": active_driving_incompatible_raises,
                "tolerates_note_key": tolerates_note_key,
            },
            "matrix_validators": {
                "wrong_row_count_msg": wrong_row_count_msg,
                "post_rest_wrong_count_msg": post_rest_wrong_count_msg,
                "post_rest_wrong_members_msg": post_rest_wrong_members_msg,
            },
        },
    })


# ---------------------------------------------------------------------------
# 39. proposal_context_base (routers/proposal.py's `_resolve_run_setup` —
#     feature 026, htmlapp Combined export, slice C4a Task 1). Direct calls
#     against the REAL `CreateProposalRunBody`/`World` pydantic types (not a
#     hand-rolled stand-in) over a REAL committed seed
#     (seed-night-highway-oshi, the same seed world_validation.json already
#     uses). `_now_iso`/`_make_opportunity_id` are intentionally NOT
#     captured here — see context_base.ts's own module doc for why (same
#     "nothing parses it, format-tested only" reasoning as every other
#     id/timestamp minter already in this port).
# ---------------------------------------------------------------------------

def _capture_proposal_context_base() -> None:
    from fastapi import HTTPException
    from aica_api.routers.proposal import CreateProposalRunBody, _resolve_run_setup
    from aica_api.services.world_seed_store import WorldSeedStore

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    seed = seed_store.get_seed("seed-night-highway-oshi")
    assert seed is not None
    world = seed.world
    real_control_inputs = json.loads(world.control_inputs.model_dump_json())

    _COMMON = dict(service_package_id="x", content_package_id="y", run_seed="seed1", simulation_time=0)

    def _case(name, *, include_world, trigger_purpose=None, lifecycle_stage=None, motion_state=None):
        kwargs = dict(_COMMON)
        if include_world:
            kwargs["world"] = world
        if trigger_purpose is not None:
            kwargs["trigger_purpose"] = trigger_purpose
        if lifecycle_stage is not None:
            kwargs["lifecycle_stage"] = lifecycle_stage
        if motion_state is not None:
            kwargs["motion_state"] = motion_state
        body = CreateProposalRunBody(**kwargs)

        entry = {
            "name": name,
            "body": {
                "trigger_purpose": trigger_purpose,
                "lifecycle_stage": lifecycle_stage,
                "motion_state": motion_state,
                "world_control_inputs": (
                    json.loads(body.world.control_inputs.model_dump_json()) if body.world is not None else None
                ),
            },
        }
        try:
            result = _resolve_run_setup(body)
            entry["result"] = {
                "triggerPurpose": result[0].value,
                "lifecycleStage": result[1].value,
                "motionState": result[2].value,
            }
        except HTTPException as exc:
            entry["raises"] = True
            entry["status_code"] = exc.status_code
            entry["detail"] = exc.detail
        return entry

    cases = [
        _case("typed_world_no_override", include_world=True),
        _case(
            "typed_world_full_override", include_world=True,
            trigger_purpose="route_music", lifecycle_stage="active_driving_content", motion_state="driving",
        ),
        _case("typed_world_partial_override_trigger_purpose_only", include_world=True, trigger_purpose="route_music"),
        _case(
            "legacy_path_all_three_present", include_world=False,
            trigger_purpose="child_passenger_experience", lifecycle_stage="active_driving_content", motion_state="driving",
        ),
        _case(
            "legacy_path_missing_motion_state", include_world=False,
            trigger_purpose="child_passenger_experience", lifecycle_stage="active_driving_content",
        ),
        _case("legacy_path_all_three_missing", include_world=False),
    ]

    _write("proposal_context_base", {
        "input": {"seed_control_inputs": real_control_inputs},
        "output": {"resolve_run_setup_cases": cases},
    })


# ---------------------------------------------------------------------------
# 40. proposal_context (routers/proposal.py's context builders + song/artist/
#     genre resolvers — feature 026, htmlapp Combined export, slice C4a
#     Task 2): `_build_service_context`, `_build_content_context`,
#     `_build_real_content_context`, `_resolve_oshi_artist`,
#     `_genre_affinity_artist_genres`, `_resolve_song_name`,
#     `_resolve_song_artist`, `_dataset_id_for_run`,
#     `_catalog_map_for_dataset`, `_redact_catalog_for_evidence`.
#
#     Every case calls the REAL private router function directly (never a
#     hand-rolled stand-in), over REAL committed catalog/seed/profile data
#     (`proposal_contracts/dataset/soundcharts-...`, `proposal_contracts/
#     seeds/seed-night-highway-oshi.json`, `proposal_contracts/profiles/
#     profile-{jrock-fitness,neutral-default}.json`) wherever the branch is
#     reachable that way. `_catalog_map_for_dataset`'s real dataset has 300
#     songs (~1.5MB dumped) — too large to embed verbatim, so that case
#     records `song_count` + the full ORDERED `track_ids` list (cheap: 300
#     short strings) rather than every song body; content-level fidelity for
#     specific songs is instead covered by the (small-output)
#     resolve_song_name/resolve_song_artist/resolve_oshi_artist cases below,
#     which each embed just the one resolved string. Likewise
#     `_build_real_content_context`'s own output embeds `feature_snapshot.
#     catalog` only as a `{song_count, sample_track_id}` projection —
#     see `_trim_catalog` — with the full-catalog claim cross-checked
#     structurally by the `catalog_map_for_dataset` cases instead of
#     re-embedding 300 songs a second time.
#
#     SYNTHETIC cases (each labeled `"synthetic": True` with a `"note"`
#     explaining why no real run can produce that exact input) are used only
#     where the 5 committed seeds + 4 committed profiles genuinely cannot
#     reach a branch:
#       - `_resolve_oshi_artist`: oshi_registered=True/oshi_mode="off" (every
#         committed profile with oshi_mode="off" also has oshi_registered=
#         False, and vice-versa — the two guards always co-occur in real
#         data); oshi_artists=[] while registered+mode=on; an oshi artist_id
#         absent from the one real catalog (no-match fallthrough); a
#         same-enthusiasm tie between two oshi artists (proves first-in-list
#         wins, mirroring Python's `max()` tie-break) — real artist ids are
#         reused throughout, only the enthusiasm/mode/artists-list values are
#         synthetic.
#       - `_dataset_id_for_run`: `world=None` with `setup_snapshot` still
#         populated — `create_proposal_run` never persists that combination
#         (setup_snapshot is only ever set alongside `world`), so this exact
#         input is only reachable by constructing a `ProposalRunLog` directly,
#         never through any real endpoint flow. Exercises the function's
#         fallback branch anyway since the code path exists and is otherwise
#         silently unreached by every other case here.
#       - `_build_content_context`: a legacy `world_snapshot` already
#         containing a `feature_snapshot.catalog` dict — no committed run in
#         this repo has that shape (the real content-catalog wiring always
#         goes through `_build_real_content_context` instead), so this one
#         case uses 2 placeholder track ids purely to prove the dict-keys ->
#         `eligible_candidates` iteration order, not to resolve any song data.
#       - `_redact_catalog_for_evidence`: the 3 defensive-guard misses
#         (`feature_snapshot` absent / not a dict / `catalog` present-but-
#         not-a-dict) are exercised with minimal hand-built context dicts —
#         this function's own guards are about the CONTEXT SHAPE, not about
#         song/artist/genre data, so no real catalog is needed to reach them.
#     `_resolve_oshi_artist`'s bare `except Exception` branch is NOT captured
#     — no realistic malformed-but-JSON-shaped input was found that reaches
#     it without also failing one of the earlier explicit guards first (see
#     the task report for the full reachability discussion).
# ---------------------------------------------------------------------------

def _capture_proposal_context() -> None:
    from aica_api.models.proposal.enums import (
        LifecycleStage, MotionState, OshiMode, ProposalRunStatus, ServiceId, TriggerPurpose,
    )
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    from aica_api.models.proposal.world import OshiArtist
    from aica_api.routers.proposal import (
        _build_content_context,
        _build_real_content_context,
        _build_service_context,
        _catalog_map_for_dataset,
        _dataset_id_for_run,
        _freeze_setup_snapshot,
        _genre_affinity_artist_genres,
        _redact_catalog_for_evidence,
        _resolve_oshi_artist,
        _resolve_song_artist,
        _resolve_song_name,
    )
    from aica_api.services.driver_profile_store import DriverProfileStore
    from aica_api.services.proposal_package_registry import ProposalPackageRegistry
    from aica_api.services.world_seed_store import WorldSeedStore

    _DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    profile_store = DriverProfileStore(_REPO / "proposal_contracts" / "profiles")
    reg = ProposalPackageRegistry(_PACKAGES_DIR)

    seed = seed_store.get_seed("seed-night-highway-oshi")
    assert seed is not None
    base_world = seed.world

    service_pkg = reg.get("aica_transparent_service_selector_v1")
    content_pkg = reg.get("aica_transparent_content_selector_v1")
    mock_service_pkg = reg.get("mock_service_selector_v1")
    mock_content_pkg = reg.get("mock_content_selector_v1")
    assert service_pkg is not None and content_pkg is not None
    assert mock_service_pkg is not None and mock_content_pkg is not None

    service_hp = {h.key: h.default for h in service_pkg.hyperparameters}
    content_hp = {h.key: h.default for h in content_pkg.hyperparameters}

    world_snapshot, setup_snapshot = _freeze_setup_snapshot(
        world=base_world, matrix_version="v1", service_pkg=service_pkg, content_pkg=content_pkg,
        service_hyperparameters=service_hp,
    )

    opportunity = ProposalOpportunity(
        opportunity_id="op-ctx-test", trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.before_rest_until_stop,
        allowed_service_ids=[ServiceId.music_playlist, ServiceId.full_karaoke],
        simulation_time="2026-07-20T09:00:00Z", run_seed="seed-ctx-test",
    )
    journey_state = JourneyState(
        lifecycle_stage=LifecycleStage.before_rest_until_stop, motion_state=MotionState.driving,
        active_service_id=None, active_plan_id=None,
    )

    def _run_log(
        *, world=None, setup_snap=None, ws=None, evidence=(), content_package_id=None,
    ) -> ProposalRunLog:
        return ProposalRunLog(
            run_id="prun_ctx_test", created_at="2026-07-20T09:00:00Z", opportunity=opportunity,
            matrix_version="v1",
            world_snapshot=ws if ws is not None else {"feature_snapshot": {}, "feature_provenance": {}},
            setup_snapshot=setup_snap,
            service_package_id=service_pkg.id,
            content_package_id=content_package_id if content_package_id is not None else content_pkg.id,
            parameters={}, hyperparameters=service_hp, journey_state=journey_state,
            events=[], evidence=list(evidence), status=ProposalRunStatus.service_selected, world=world,
        )

    run_log_typed = _run_log(world=base_world, setup_snap=setup_snapshot, ws=world_snapshot)
    run_log_legacy = _run_log(world=None, setup_snap=None, ws={"feature_snapshot": {}, "feature_provenance": {}})

    def _evidence(step: str, output: dict | None) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step=step, package_id=service_pkg.id if step == "service" else content_pkg.id,
            contract_version="1.0.0", schema_version="1.0.0", matrix_version="v1",
            input_snapshot={}, output=output, error=None,
            used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _dump_run_log(rl: ProposalRunLog) -> dict:
        return json.loads(rl.model_dump_json())

    def _trim_catalog(ctx: dict) -> dict:
        """Replace the (large) real `feature_snapshot.catalog` map with a
        cheap-to-embed projection — see this capture's module comment.

        Deliberately does NOT embed a sample song body: this function's
        song dicts are `Song.model_dump(mode="json")` output, which the TS
        side's `catalogMapForDataset` intentionally does NOT reproduce
        (documented "KNOWN PRE-EXISTING DIVERGENCE" in context.ts's module
        doc — dropped `language` field, added `linked_from`/`preview_url`/
        `restrictions`, reordered keys). Embedding one here would make this
        golden assert a field-order/field-set fidelity this port explicitly
        does not attempt; song-CONTENT fidelity (name/artist) is instead
        proven by the resolve_song_name/resolve_song_artist/
        resolve_oshi_artist cases below, each of which embeds only the one
        resolved string.
        """
        fs = dict(ctx["feature_snapshot"])
        catalog = fs["catalog"]
        first_id = next(iter(catalog))
        fs["catalog"] = {"_song_count": len(catalog), "_sample_track_id": first_id}
        return {**ctx, "feature_snapshot": fs}

    # === _build_service_context ============================================
    build_service_context_cases = []

    ctx = _build_service_context(
        package=service_pkg, opportunity=opportunity, world_snapshot=world_snapshot,
        enabled_feature_extensions=["genre_affinity_v1"], parameters=dict(service_pkg.parameters),
        hyperparameters=service_hp, eligible_service_ids=[ServiceId.music_playlist],
        excluded_candidates=[{"candidate_id": "full_karaoke", "platform_reason": "stopped_only_while_driving"}],
    )
    build_service_context_cases.append({
        "name": "real_seed_full",
        "input": {
            "package_contract_version": service_pkg.contract_version,
            "opportunity": json.loads(opportunity.model_dump_json()),
            "world_snapshot": world_snapshot,
            "enabled_feature_extensions": ["genre_affinity_v1"],
            "parameters": dict(service_pkg.parameters),
            "hyperparameters": service_hp,
            "eligible_service_ids": ["music_playlist"],
            "excluded_candidates": [{"candidate_id": "full_karaoke", "platform_reason": "stopped_only_while_driving"}],
        },
        "output": ctx,
    })

    ws_no_catalog_version = {k: v for k, v in world_snapshot.items() if k != "catalog_version"}
    ctx_no_cv = _build_service_context(
        package=service_pkg, opportunity=opportunity, world_snapshot=ws_no_catalog_version,
        enabled_feature_extensions=[], parameters={}, hyperparameters={},
        eligible_service_ids=[], excluded_candidates=[],
    )
    build_service_context_cases.append({
        "name": "catalog_version_key_absent_defaults_to_n_a",
        "input": {
            "package_contract_version": service_pkg.contract_version,
            "opportunity": json.loads(opportunity.model_dump_json()),
            "world_snapshot": ws_no_catalog_version,
            "enabled_feature_extensions": [],
            "parameters": {},
            "hyperparameters": {},
            "eligible_service_ids": [],
            "excluded_candidates": [],
        },
        "output": ctx_no_cv,
    })

    # `.get(key, default)` returns default ONLY when the key is ABSENT — a
    # key present with value None is returned as None, NOT "n/a". SYNTHETIC
    # (labeled): no real world_snapshot (typed-world OR legacy) ever sets
    # catalog_version to an explicit null — the typed-world path always
    # freezes a real dataset_hash string; this proves pyGetDefault's
    # present-vs-absent distinction is actually observable, catching a
    # `?? "n/a"` mis-port that a bare key-removal case cannot.
    ws_null_catalog_version = {**world_snapshot, "catalog_version": None}
    ctx_null_cv = _build_service_context(
        package=service_pkg, opportunity=opportunity, world_snapshot=ws_null_catalog_version,
        enabled_feature_extensions=[], parameters={}, hyperparameters={},
        eligible_service_ids=[], excluded_candidates=[],
    )
    build_service_context_cases.append({
        "name": "catalog_version_key_present_but_null_stays_null_SYNTHETIC",
        "synthetic": True,
        "note": "no real world_snapshot ever sets catalog_version to an explicit null; proves dict.get(key, default) only applies the default when the key is ABSENT, not merely falsy.",
        "input": {
            "package_contract_version": service_pkg.contract_version,
            "opportunity": json.loads(opportunity.model_dump_json()),
            "world_snapshot": ws_null_catalog_version,
            "enabled_feature_extensions": [],
            "parameters": {},
            "hyperparameters": {},
            "eligible_service_ids": [],
            "excluded_candidates": [],
        },
        "output": ctx_null_cv,
    })

    # === _catalog_map_for_dataset ===========================================
    real_catalog_map = _catalog_map_for_dataset(_DATASET_ID)
    assert real_catalog_map is not None
    unknown_catalog_map = _catalog_map_for_dataset("not-a-real-dataset-id")
    catalog_map_for_dataset_cases = [
        {
            "name": "known_real_dataset",
            "input": {"dataset_id": _DATASET_ID},
            "output": {"song_count": len(real_catalog_map), "track_ids": list(real_catalog_map.keys())},
        },
        {
            "name": "unknown_dataset_id",
            "input": {"dataset_id": "not-a-real-dataset-id"},
            "output": {"is_null": unknown_catalog_map is None},
        },
    ]

    # === _genre_affinity_artist_genres ======================================
    real_gav1 = _genre_affinity_artist_genres(_DATASET_ID)
    unknown_gav1 = _genre_affinity_artist_genres("not-a-real-dataset-id")
    genre_affinity_artist_genres_cases = [
        {"name": "known_real_dataset", "input": {"dataset_id": _DATASET_ID}, "output": real_gav1},
        {"name": "unknown_dataset_id", "input": {"dataset_id": "not-a-real-dataset-id"}, "output": unknown_gav1},
    ]

    # === _build_content_context (mock/legacy path) ==========================
    build_content_context_cases = []

    ctx = _build_content_context(
        package=mock_content_pkg, run_log=run_log_legacy, selected_service_id=ServiceId.music_playlist,
        content_parameters={}, content_hyperparameters={},
    )
    build_content_context_cases.append({
        "name": "legacy_no_catalog",
        "input": {
            "package_contract_version": mock_content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_legacy),
            "selected_service_id": "music_playlist",
            "content_parameters": {}, "content_hyperparameters": {},
        },
        "output": ctx,
    })

    # SYNTHETIC (labeled — see module comment): no committed run has a
    # legacy world_snapshot with a pre-populated feature_snapshot.catalog.
    run_log_legacy_catalog = run_log_legacy.model_copy(update={
        "world_snapshot": {
            "feature_snapshot": {"catalog": {"trk-a": {}, "trk-b": {}}},
            "feature_provenance": {}, "catalog_version": "legacy-v1",
        },
    })
    ctx = _build_content_context(
        package=mock_content_pkg, run_log=run_log_legacy_catalog, selected_service_id=ServiceId.music_playlist,
        content_parameters={}, content_hyperparameters={},
    )
    build_content_context_cases.append({
        "name": "legacy_with_catalog_dict_SYNTHETIC",
        "synthetic": True,
        "note": "no committed run has a legacy world_snapshot with a pre-populated feature_snapshot.catalog; proves dict-keys iteration order only, no real song data involved.",
        "input": {
            "package_contract_version": mock_content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_legacy_catalog),
            "selected_service_id": "music_playlist",
            "content_parameters": {}, "content_hyperparameters": {},
        },
        "output": ctx,
    })

    # package_runtime_state loop: a "content" evidence entry (must be
    # skipped, wrong step), then a "service" entry with an EMPTY (Python-
    # falsy) output (must ALSO be skipped — the exact case a naive
    # `if (ev.output)` JS port would get wrong, since `{}` is truthy in JS),
    # then a REAL "service" entry with next_package_runtime_state (must win).
    ev_content = _evidence("content", {"next_package_runtime_state": {"should_not_be_picked": True}})
    ev_service_empty = _evidence("service", {})
    ev_service_real = _evidence("service", {
        "decision_type": "ranked_candidates",
        "ranked_candidates": [{"candidate_id": "music_playlist", "rank": 1}],
        "next_package_runtime_state": {"cooldowns": {"music_playlist": 2}},
    })
    run_log_evidence_chain = run_log_legacy.model_copy(update={
        "evidence": [ev_content, ev_service_empty, ev_service_real],
    })
    ctx = _build_content_context(
        package=mock_content_pkg, run_log=run_log_evidence_chain, selected_service_id=ServiceId.music_playlist,
        content_parameters={}, content_hyperparameters={},
    )
    build_content_context_cases.append({
        "name": "package_runtime_state_skips_wrong_step_and_falsy_empty_output",
        "input": {
            "package_contract_version": mock_content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_evidence_chain),
            "selected_service_id": "music_playlist",
            "content_parameters": {}, "content_hyperparameters": {},
        },
        "output": ctx,
    })

    # === _build_real_content_context ========================================
    build_real_content_context_cases = []

    ctx = _build_real_content_context(
        package=content_pkg, run_log=run_log_typed, selected_service_id=ServiceId.music_playlist,
        content_parameters=dict(content_pkg.parameters), content_hyperparameters=content_hp,
    )
    build_real_content_context_cases.append({
        "name": "genre_extension_off",
        "input": {
            "package_contract_version": content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_typed),
            "selected_service_id": "music_playlist",
            "content_parameters": dict(content_pkg.parameters), "content_hyperparameters": content_hp,
        },
        "output": _trim_catalog(ctx),
    })

    jrock_profile = profile_store.get_profile("profile-jrock-fitness")
    assert jrock_profile is not None
    jrock = jrock_profile.profile
    world_genre = base_world.model_copy(update={"driver_profile": jrock})
    world_snapshot_genre, setup_snapshot_genre = _freeze_setup_snapshot(
        world=world_genre, matrix_version="v1", service_pkg=service_pkg, content_pkg=content_pkg,
        service_hyperparameters=service_hp,
    )
    run_log_genre = _run_log(
        world=world_genre, setup_snap=setup_snapshot_genre, ws=world_snapshot_genre,
        evidence=[ev_service_empty, ev_service_real],
    )
    ctx = _build_real_content_context(
        package=content_pkg, run_log=run_log_genre, selected_service_id=ServiceId.music_playlist,
        content_parameters=dict(content_pkg.parameters), content_hyperparameters=content_hp,
    )
    build_real_content_context_cases.append({
        "name": "genre_extension_on_merges_artist_genres_and_picks_real_runtime_state",
        "input": {
            "package_contract_version": content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_genre),
            "selected_service_id": "music_playlist",
            "content_parameters": dict(content_pkg.parameters), "content_hyperparameters": content_hp,
        },
        "output": _trim_catalog(ctx),
    })

    def _real_content_context_raises(rl: ProposalRunLog) -> str:
        try:
            _build_real_content_context(
                package=content_pkg, run_log=rl, selected_service_id=ServiceId.music_playlist,
                content_parameters={}, content_hyperparameters={},
            )
        except AssertionError as exc:
            return "AssertionError" + (f": {exc}" if str(exc) else "")
        raise AssertionError("expected an AssertionError")

    raises_desc = _real_content_context_raises(run_log_legacy)
    build_real_content_context_cases.append({
        "name": "setup_snapshot_none_raises",
        "input": {
            "package_contract_version": content_pkg.contract_version,
            "run_log": _dump_run_log(run_log_legacy),
            "selected_service_id": "music_playlist",
            "content_parameters": {}, "content_hyperparameters": {},
        },
        "raises": True,
        "output": raises_desc,
    })

    # === _redact_catalog_for_evidence ========================================
    redact_catalog_for_evidence_cases = []

    real_ctx = _build_real_content_context(
        package=content_pkg, run_log=run_log_genre, selected_service_id=ServiceId.music_playlist,
        content_parameters=dict(content_pkg.parameters), content_hyperparameters=content_hp,
    )
    redacted = _redact_catalog_for_evidence(real_ctx, dataset_id=setup_snapshot_genre.dataset_id)
    redact_catalog_for_evidence_cases.append({
        "name": "real_full_catalog_redacted_original_untouched",
        "input": {"context": _trim_catalog(real_ctx), "dataset_id": setup_snapshot_genre.dataset_id},
        "output": {
            "redacted_catalog_field": redacted["feature_snapshot"]["catalog"],
            "original_context_song_count_after_call": len(real_ctx["feature_snapshot"]["catalog"]),
        },
    })

    ctx_no_catalog_key = _build_content_context(
        package=mock_content_pkg, run_log=run_log_legacy, selected_service_id=ServiceId.music_playlist,
        content_parameters={}, content_hyperparameters={},
    )
    redacted_no_catalog = _redact_catalog_for_evidence(ctx_no_catalog_key, dataset_id="whatever")
    redact_catalog_for_evidence_cases.append({
        "name": "feature_snapshot_has_no_catalog_key_noop",
        "input": {"context": ctx_no_catalog_key, "dataset_id": "whatever"},
        "output": redacted_no_catalog,
    })

    # SYNTHETIC (labeled): these 3 minimal hand-built dicts exist only to
    # exercise _redact_catalog_for_evidence's own defensive isinstance()
    # guards (a context shape check, not a song/artist/genre lookup) — no
    # real committed context is ever missing feature_snapshot entirely or
    # carries a non-dict feature_snapshot/catalog.
    weird_missing_fs = {"other": 1}
    redact_catalog_for_evidence_cases.append({
        "name": "feature_snapshot_key_absent_noop_SYNTHETIC",
        "synthetic": True,
        "note": "no real context is ever missing feature_snapshot entirely; exercises the isinstance(feature_snapshot, dict) guard directly.",
        "input": {"context": weird_missing_fs, "dataset_id": "x"},
        "output": _redact_catalog_for_evidence(weird_missing_fs, dataset_id="x"),
    })

    weird_fs_not_dict = {"feature_snapshot": "not-a-dict", "other": 1}
    redact_catalog_for_evidence_cases.append({
        "name": "feature_snapshot_not_a_dict_noop_SYNTHETIC",
        "synthetic": True,
        "note": "no real context ever has a non-dict feature_snapshot; exercises the isinstance(feature_snapshot, dict) guard's False branch.",
        "input": {"context": weird_fs_not_dict, "dataset_id": "x"},
        "output": _redact_catalog_for_evidence(weird_fs_not_dict, dataset_id="x"),
    })

    weird_catalog_not_dict = {"feature_snapshot": {"catalog": ["not", "a", "dict"]}}
    redact_catalog_for_evidence_cases.append({
        "name": "catalog_present_but_not_a_dict_noop_SYNTHETIC",
        "synthetic": True,
        "note": "no real context ever has a non-dict catalog; exercises the isinstance(catalog, dict) guard's False branch.",
        "input": {"context": weird_catalog_not_dict, "dataset_id": "x"},
        "output": _redact_catalog_for_evidence(weird_catalog_not_dict, dataset_id="x"),
    })

    # === _dataset_id_for_run =================================================
    dataset_id_for_run_cases = [
        {
            "name": "typed_world_present",
            "input": {"run_log": _dump_run_log(run_log_typed)},
            "output": _dataset_id_for_run(run_log_typed),
        },
        {
            "name": "legacy_world_none_setup_snapshot_none",
            "input": {"run_log": _dump_run_log(run_log_legacy)},
            "output": _dataset_id_for_run(run_log_legacy),
        },
    ]
    # SYNTHETIC (labeled — see module comment): create_proposal_run never
    # persists world=None with setup_snapshot populated; only reachable by
    # constructing a ProposalRunLog directly.
    run_log_setup_only = run_log_legacy.model_copy(update={"setup_snapshot": setup_snapshot})
    dataset_id_for_run_cases.append({
        "name": "world_none_but_setup_snapshot_present_fallback_SYNTHETIC",
        "synthetic": True,
        "note": "create_proposal_run always sets world and setup_snapshot together; this combination is never produced by any real endpoint flow.",
        "input": {"run_log": _dump_run_log(run_log_setup_only)},
        "output": _dataset_id_for_run(run_log_setup_only),
    })

    # === _resolve_song_name / _resolve_song_artist ==========================
    known_track_id = "synthetic-track-0001"
    resolve_song_name_cases = [
        {
            "name": "known_track_real_catalog",
            "input": {"run_log": _dump_run_log(run_log_typed), "track_id": known_track_id},
            "output": _resolve_song_name(run_log_typed, known_track_id),
        },
        {
            "name": "unknown_track_id",
            "input": {"run_log": _dump_run_log(run_log_typed), "track_id": "not-a-real-track"},
            "output": _resolve_song_name(run_log_typed, "not-a-real-track"),
        },
        {
            "name": "legacy_run_no_dataset",
            "input": {"run_log": _dump_run_log(run_log_legacy), "track_id": known_track_id},
            "output": _resolve_song_name(run_log_legacy, known_track_id),
        },
    ]
    resolve_song_artist_cases = [
        {
            "name": "known_track_real_catalog",
            "input": {"run_log": _dump_run_log(run_log_typed), "track_id": known_track_id},
            "output": _resolve_song_artist(run_log_typed, known_track_id),
        },
        {
            "name": "unknown_track_id",
            "input": {"run_log": _dump_run_log(run_log_typed), "track_id": "not-a-real-track"},
            "output": _resolve_song_artist(run_log_typed, "not-a-real-track"),
        },
        {
            "name": "legacy_run_no_dataset",
            "input": {"run_log": _dump_run_log(run_log_legacy), "track_id": known_track_id},
            "output": _resolve_song_artist(run_log_legacy, known_track_id),
        },
    ]

    # === _resolve_oshi_artist ================================================
    resolve_oshi_artist_cases = [
        {
            "name": "real_single_oshi_artist",
            "input": {"run_log": _dump_run_log(run_log_typed)},
            "output": _resolve_oshi_artist(run_log_typed),
        },
        {
            "name": "real_two_oshi_artists_distinct_enthusiasm_max_wins",
            "input": {"run_log": _dump_run_log(run_log_genre)},
            "output": _resolve_oshi_artist(run_log_genre),
        },
        {
            "name": "legacy_world_none",
            "input": {"run_log": _dump_run_log(run_log_legacy)},
            "output": _resolve_oshi_artist(run_log_legacy),
        },
    ]

    neutral_profile = profile_store.get_profile("profile-neutral-default")
    assert neutral_profile is not None
    world_neutral = base_world.model_copy(update={"driver_profile": neutral_profile.profile})
    run_log_neutral = run_log_typed.model_copy(update={"world": world_neutral})
    resolve_oshi_artist_cases.append({
        "name": "real_oshi_registered_false_and_mode_off_together",
        "note": "profile-neutral-default: oshi_registered=False AND oshi_mode='off' together — every committed profile with one guard false also has the other false, so guards 2 and 3 are NOT independently exercised by any real data (see task report).",
        "input": {"run_log": _dump_run_log(run_log_neutral)},
        "output": _resolve_oshi_artist(run_log_neutral),
    })

    # SYNTHETIC (labeled): registered=True but mode='off' alone — no
    # committed profile has this combination (see note above).
    jrock_mode_off = jrock.model_copy(update={"oshi_mode": OshiMode.off})
    world_mode_off = base_world.model_copy(update={"driver_profile": jrock_mode_off})
    run_log_mode_off = run_log_typed.model_copy(update={"world": world_mode_off})
    resolve_oshi_artist_cases.append({
        "name": "oshi_registered_true_mode_off_alone_SYNTHETIC",
        "synthetic": True,
        "note": "no committed profile has oshi_registered=True with oshi_mode='off' in isolation; real profiles co-vary both fields together.",
        "input": {"run_log": _dump_run_log(run_log_mode_off)},
        "output": _resolve_oshi_artist(run_log_mode_off),
    })

    # SYNTHETIC (labeled): oshi_artists emptied while registered+mode=on.
    jrock_no_artists = jrock.model_copy(update={"oshi_artists": []})
    world_no_artists = base_world.model_copy(update={"driver_profile": jrock_no_artists})
    run_log_no_artists = run_log_typed.model_copy(update={"world": world_no_artists})
    resolve_oshi_artist_cases.append({
        "name": "oshi_artists_empty_SYNTHETIC",
        "synthetic": True,
        "note": "no committed profile has oshi_registered=True/oshi_mode='on' with an empty oshi_artists list.",
        "input": {"run_log": _dump_run_log(run_log_no_artists)},
        "output": _resolve_oshi_artist(run_log_no_artists),
    })

    # SYNTHETIC (labeled): artist_id absent from the one real catalog (no-
    # match fallthrough after both nested for-loops exhaust).
    jrock_unknown_artist = jrock.model_copy(update={
        "oshi_artists": [OshiArtist(artist_id="synthetic-artist-9999", enthusiasm=1.0)],
    })
    world_unknown_artist = base_world.model_copy(update={"driver_profile": jrock_unknown_artist})
    run_log_unknown_artist = run_log_typed.model_copy(update={"world": world_unknown_artist})
    resolve_oshi_artist_cases.append({
        "name": "oshi_artist_id_not_in_catalog_fallthrough_SYNTHETIC",
        "synthetic": True,
        "note": "synthetic-artist-9999 does not exist in the one real committed dataset; only 300 real artist ids do. Exercises the nested-loop no-match fallthrough.",
        "input": {"run_log": _dump_run_log(run_log_unknown_artist)},
        "output": _resolve_oshi_artist(run_log_unknown_artist),
    })

    # SYNTHETIC (labeled): two REAL artist ids tied at equal enthusiasm —
    # proves Python's max() first-occurrence tie-break (never independently
    # provable from any committed profile, none of which has a tie).
    jrock_tie = jrock.model_copy(update={"oshi_artists": [
        OshiArtist(artist_id="synthetic-artist-0079", enthusiasm=0.7),
        OshiArtist(artist_id="synthetic-artist-0017", enthusiasm=0.7),
    ]})
    world_tie = base_world.model_copy(update={"driver_profile": jrock_tie})
    run_log_tie = run_log_typed.model_copy(update={"world": world_tie})
    resolve_oshi_artist_cases.append({
        "name": "tie_break_first_in_list_wins_SYNTHETIC",
        "synthetic": True,
        "note": "both artist ids are real; the 0.7/0.7 enthusiasm TIE is synthetic — no committed profile has two oshi artists at equal enthusiasm. Proves max()'s first-occurrence tie-break (synthetic-artist-0079 'HY' must win, not synthetic-artist-0017 'Alva Noto').",
        "input": {"run_log": _dump_run_log(run_log_tie)},
        "output": _resolve_oshi_artist(run_log_tie),
    })

    _write("proposal_context", {
        "input": {"real_dataset_id": _DATASET_ID, "seed_id": "seed-night-highway-oshi"},
        "output": {
            "build_service_context_cases": build_service_context_cases,
            "build_content_context_cases": build_content_context_cases,
            "catalog_map_for_dataset_cases": catalog_map_for_dataset_cases,
            "genre_affinity_artist_genres_cases": genre_affinity_artist_genres_cases,
            "build_real_content_context_cases": build_real_content_context_cases,
            "redact_catalog_for_evidence_cases": redact_catalog_for_evidence_cases,
            "dataset_id_for_run_cases": dataset_id_for_run_cases,
            "resolve_song_name_cases": resolve_song_name_cases,
            "resolve_song_artist_cases": resolve_song_artist_cases,
            "resolve_oshi_artist_cases": resolve_oshi_artist_cases,
        },
    })


# ---------------------------------------------------------------------------
# 41. proposal_create_run (routers/proposal.py's `create_proposal_run` +
#     `_freeze_setup_snapshot` — feature 026, htmlapp Combined export, slice
#     C4a Task 3). Every case calls the REAL `create_proposal_run` directly
#     (never a hand-rolled stand-in), always with `cache={}` (in-memory,
#     never touches `proposal_runs_dir` — side-effect-free for this script;
#     the cache/no-cache VALUE-parity guarantee is already established by
#     `proposal_run_manager.json`/`proposal_run_manager_cache.test.ts`, so a
#     second on-disk capture of the identical value would add nothing), over
#     the REAL committed seed `seed-night-highway-oshi` and the two REAL
#     ported packages `aica_transparent_service_selector_v1`/
#     `aica_transparent_content_selector_v1` (the exact pair
#     `test_proposal_cache.py`'s own router-level acceptance test uses).
#
#     SYNTHETIC (labeled) mutations, each reaching a branch the seed's own
#     unmodified data cannot:
#       - `unknown_dataset_id_raises`: `control_inputs.dataset_id` replaced
#         with a nonexistent id.
#       - `catalog_reference_invalid_raises`: `driver_profile.oshi_artists[0]
#         .artist_id` replaced with an id absent from the real catalog —
#         proves `_freeze_setup_snapshot`'s `validate_world` call is
#         genuinely wired in (rule 3, catalog references; rule 1/2
#         structural issues are provably unreachable through this real call
#         site, since `CreateProposalRunBody(world=...)` already pydantic-
#         validates `world` at BODY construction, before
#         `create_proposal_run` ever runs — same reasoning
#         `world_validation.ts`'s own module doc documents).
#       - `explicit_null_parameter_set_version`: `hyperparameters` includes
#         `"parameter_set_version": None` EXPLICITLY (not absent) — the
#         `dict.get(key, default)` hazard's canonical discriminating case;
#         proves `setup_snapshot.service_parameter_set_version` stays `None`,
#         not `service_pkg.version` (the two REAL packages never exercise
#         this distinction on their own: the real service package has no
#         `parameter_set_version` hyperparameter at all -> naturally
#         ABSENT -> default branch; the real content package has one SET ->
#         naturally PRESENT-non-null -> passthrough branch; neither
#         produces the PRESENT-BUT-null case this synthetic one exists for).
#     "Eligibility rejects every candidate" (T017a) is NOT captured here —
#     verified UNREACHABLE through this real call site with the real
#     committed `service_capabilities.v1.json`/`purpose_stage_matrix.v1.json`
#     (every non-empty matrix row has at least one motion/entity-safe
#     service; `create_proposal_run` never passes `unavailable_service_ids`
#     to `resolve_eligibility`, so rule 3 can never fire from here either) —
#     even Python's OWN test suite
#     (`test_p4_evidence_gate.py::test_no_eligible_candidate_event_payload_is_
#     also_score_free`) reaches this branch only by MONKEYPATCHING
#     `resolve_eligibility` itself, not through any real body. This port
#     covers the branch the same way, at the TS test level (see
#     `tests/proposal_create_run_port.test.ts`), never via a fabricated
#     Python capture that misrepresents what real data can produce.
# ---------------------------------------------------------------------------

def _capture_proposal_create_run() -> None:
    import copy

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.routers.proposal import CreateProposalRunBody, _freeze_setup_snapshot, create_proposal_run
    from aica_api.services.proposal_package_registry import ProposalPackageRegistry
    from aica_api.services.world_seed_store import WorldSeedStore

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"

    reg = ProposalPackageRegistry(_PACKAGES_DIR)
    service_pkg = reg.get(_SERVICE_PKG_ID)
    content_pkg = reg.get(_CONTENT_PKG_ID)
    assert service_pkg is not None and content_pkg is not None

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    seed = seed_store.get_seed(_SEED_ID)
    assert seed is not None

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return copy.deepcopy(json.loads(path.read_text(encoding="utf-8"))["world"])

    def _base_kwargs(**overrides) -> dict:
        kwargs = dict(
            world=_seed_world_dict(),
            service_package_id=_SERVICE_PKG_ID,
            content_package_id=_CONTENT_PKG_ID,
            run_seed="seed-create-run-test",
            simulation_time="2026-08-02T09:00:00Z",
        )
        kwargs.update(overrides)
        return kwargs

    def _freeze_ids(obj, run_id: str, opportunity_id: str):
        """Replace the two id-minting sources' own random output
        (`_make_run_id`/`_make_opportunity_id`/`_now_iso`, at BOTH
        `create_proposal_run`'s own call sites AND `proposal_run_manager`'s)
        with fixed literals, recursively, wherever they appear in the dumped
        run log (top-level `run_id`/`created_at`, `opportunity.opportunity_id`,
        the SAME id echoed inside every event payload/evidence input_snapshot,
        and every event's own `at`). Mirrors `_capture_proposal_run_manager`'s
        own documented `_freeze` post-hoc technique (same file) — the
        general-purpose recursive form is needed here because this capture
        walks a FULL run log (ids/timestamps recur in many nested places),
        not one flat dict.
        """
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k == "created_at" or k == "at":
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif k == "run_id" and v == run_id:
                    out[k] = "prun_TEST_FIXED"
                elif k == "opportunity_id" and v == opportunity_id:
                    out[k] = "op_TEST_FIXED"
                else:
                    out[k] = _freeze_ids(v, run_id, opportunity_id)
            return out
        if isinstance(obj, list):
            return [_freeze_ids(v, run_id, opportunity_id) for v in obj]
        return obj

    def _run_case(name: str, kwargs: dict, *, synthetic: bool = False, note: str | None = None) -> dict:
        entry: dict = {"name": name}
        if synthetic:
            entry["synthetic"] = True
            entry["note"] = note
        try:
            body = CreateProposalRunBody(**kwargs)
        except Exception as exc:  # pydantic ValidationError at BODY construction (not create_proposal_run itself)
            entry["body_construction_error"] = str(exc)
            return entry
        try:
            log = create_proposal_run(body, cache={})
            entry["raises"] = False
            entry["result"] = _freeze_ids(
                json.loads(log.model_dump_json()), log.run_id, log.opportunity.opportunity_id,
            )
        except HTTPException as exc:
            entry["raises"] = True
            entry["status_code"] = exc.status_code
            entry["detail"] = exc.detail
        return entry

    cases = []

    # -- Success paths ------------------------------------------------------
    cases.append(_run_case("interactive_full_mode_service_selected_no_content", _base_kwargs(mode="interactive")))
    cases.append(_run_case("quick_check_content_dispatched_rank1", _base_kwargs(mode="quick_check")))
    # rank-1 for this seed is naturally "humming_karaoke" (see
    # interactive_full_mode_service_selected_no_content's own ranked_candidates) —
    # "quiz" is ranked #3, a genuine non-rank-1 override, proving
    # quick_check_service_id actually changes the STEP-1 selection rather than
    # coincidentally matching what rank-1 would have picked anyway. "quiz" is
    # NOT in the real content package's supported_services (music_playlist/
    # humming_karaoke/full_karaoke only), so STEP 2 (content, out of this
    # task's scope) ends in status=error/unsupported_service — irrelevant to
    # what THIS task verifies (STEP 1's own selection + that content
    # parameters/hyperparameters were still resolved and a dispatch was
    # attempted at all).
    cases.append(_run_case(
        "quick_check_content_dispatched_with_override",
        _base_kwargs(mode="quick_check", quick_check_service_id="quiz"),
    ))

    algo_overrides_kwargs = _base_kwargs(
        mode="quick_check",
        algorithm_config_overrides={"service": {"gamma_drowsiness": 0.123456}, "content": {"plan_item_count": 1}},
    )
    cases.append(_run_case("algorithm_config_overrides_applied", algo_overrides_kwargs))

    # NOTE: an explicit `hyperparameters={"parameter_set_version": None, ...}`
    # case was tried and DELIBERATELY DROPPED — `SetupSnapshot.
    # service_parameter_set_version` is a REQUIRED non-nullable `str`
    # (models/proposal/world.py:711), so passing an explicit `None` here
    # crashes `_freeze_setup_snapshot` with an UNCAUGHT pydantic
    # ValidationError (not a handled `HTTPException` — `create_proposal_run`
    # never catches it), i.e. this is not a legitimate, completable Python
    # call at all, and "capturing" it would only capture a crash. The
    # `pyGetDefault`(key,default)` present-vs-absent distinction for THIS
    # specific field is therefore verified directly at the `freezeSetupSnapshot`
    # unit level in the TS test (no Python counterpart exists for that exact
    # state) — see `tests/proposal_create_run_port.test.ts`'s own note.

    legacy_world_snapshot, _legacy_setup_snapshot = _freeze_setup_snapshot(
        world=seed.world, matrix_version="v1", service_pkg=service_pkg, content_pkg=content_pkg,
        service_hyperparameters={hp.key: hp.default for hp in service_pkg.hyperparameters},
    )
    legacy_kwargs = dict(
        world_snapshot=json.loads(json.dumps(legacy_world_snapshot, default=str)),
        trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop", motion_state="driving",
        service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
        run_seed="seed-create-run-test", simulation_time="2026-08-02T09:00:00Z", mode="interactive",
    )
    cases.append(_run_case("legacy_world_snapshot_path_no_freeze", legacy_kwargs))

    # -- Raising paths --------------------------------------------------------
    cases.append(_run_case(
        "unknown_service_package_id_raises", _base_kwargs(service_package_id="not_a_real_package_id"),
    ))
    cases.append(_run_case(
        "mis_slotted_service_package_id_raises", _base_kwargs(service_package_id=_CONTENT_PKG_ID),
    ))
    cases.append(_run_case(
        "unknown_content_package_id_raises", _base_kwargs(content_package_id="not_a_real_package_id"),
    ))
    cases.append(_run_case(
        "neither_world_nor_world_snapshot_raises",
        dict(
            trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop", motion_state="driving",
            service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
            run_seed="seed-create-run-test", simulation_time="2026-08-02T09:00:00Z",
        ),
    ))
    cases.append(_run_case(
        "empty_matrix_row_raises",
        _base_kwargs(trigger_purpose="rest_recommended", lifecycle_stage="during_rest_stopped"),
    ))
    cases.append(_run_case(
        "incompatible_matrix_pair_raises",
        _base_kwargs(trigger_purpose="rest_recommended", lifecycle_stage="active_driving_content"),
    ))

    unknown_dataset_world = _seed_world_dict()
    unknown_dataset_world["control_inputs"]["dataset_id"] = "not-a-real-dataset-id"
    cases.append(_run_case(
        "unknown_dataset_id_raises", _base_kwargs(world=unknown_dataset_world),
        synthetic=True, note="control_inputs.dataset_id replaced with a nonexistent dataset id.",
    ))

    bad_catalog_ref_world = _seed_world_dict()
    bad_catalog_ref_world["driver_profile"]["oshi_artists"][0]["artist_id"] = "not-a-real-artist-id"
    cases.append(_run_case(
        "catalog_reference_invalid_raises", _base_kwargs(world=bad_catalog_ref_world),
        synthetic=True,
        note=(
            "driver_profile.oshi_artists[0].artist_id replaced with an id absent from the real catalog — "
            "structurally valid (any string), so this reaches validate_world's rule-3 catalog-reference check "
            "specifically, not a pydantic construction failure."
        ),
    ))

    _write("proposal_create_run", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {"create_proposal_run_cases": cases},
    })


# ---------------------------------------------------------------------------
# 42. proposal_select_service (routers/proposal.py's `select_service` +
#     `_dispatch_content_for_service` + `_apply_quick_check_content` —
#     feature 026, htmlapp Combined export, slice C4a Task 4).
#
#     Group A cases call the REAL `create_proposal_run` (never `cache=`, so
#     the run is genuinely persisted to a tempdir pointed at by
#     `AICA_PROPOSAL_RUNS_DIR` — `select_service` hard-codes
#     `settings.proposal_runs_dir` internally with no `cache`/`runs_dir`
#     parameter of its own, unlike `create_proposal_run`, so this is the
#     ONLY way to exercise it against a real persisted run; mirrors
#     `app/api/tests/proposal/test_step2_real_content.py`'s own
#     `monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", ...)` fixture), then call
#     the REAL `select_service(run_id, body)` directly — over the real
#     committed seed `seed-night-highway-oshi` and the two real ported
#     packages (`aica_transparent_service_selector_v1`/
#     `aica_transparent_content_selector_v1`).
#
#     Group B cases build the run_log DIRECTLY via `prm.create_run` (mirrors
#     `_capture_proposal_run_manager`'s own direct-construction technique),
#     bypassing `create_proposal_run`'s own matrix/eligibility resolution —
#     needed to reach `select_service`'s eligibility-rejection and
#     mis-slotted/None-content-package branches, which the real committed
#     matrix/capability data cannot reach through a NORMAL
#     `create_proposal_run` call (every real matrix row's own content
#     package is always valid by construction at create time).
#
#     Group C cases call `_apply_quick_check_content` directly, always
#     `cache={}` (in-memory, side-effect-free — mirrors
#     `_capture_proposal_create_run`'s own convention).
#
#     `quick_check_mis_slotted_raises` (Group C) is the one case worth
#     reading closely: `content_package_id` is set to the REAL SERVICE
#     package id (`aica_transparent_service_selector_v1`, which itself
#     declares `supported_services` including "music_playlist") — a
#     genuinely reachable-with-real-committed-data way to slip PAST
#     `_apply_quick_check_content`'s own `content_pkg is None or
#     selected_service_id not in content_pkg.supported_services` guard and
#     into `_dispatch_content_for_service`'s OWN family re-check, which DOES
#     raise — uncaught, propagating out of `_apply_quick_check_content`. See
#     `select_service.ts`'s own module doc ("REDUNDANT-BUT-LIVE CHECK") for
#     the full reasoning.
# ---------------------------------------------------------------------------


def _capture_proposal_select_service() -> None:
    import copy
    import os
    import pathlib
    import tempfile

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.proposal.enums import ServiceId
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.world import World
    from aica_api.routers.proposal import (
        CreateProposalRunBody,
        SelectServiceBody,
        _apply_quick_check_content,
        _freeze_setup_snapshot,
        create_proposal_run,
        select_service,
    )
    from aica_api.services import proposal_run_manager as prm
    from aica_api.services.proposal_package_registry import ProposalPackageRegistry

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RUN_SEED = "seed-select-service-test"
    _SIM_TIME = "2026-08-02T09:00:00Z"

    reg = ProposalPackageRegistry(_PACKAGES_DIR)
    service_pkg = reg.get(_SERVICE_PKG_ID)
    content_pkg = reg.get(_CONTENT_PKG_ID)
    assert service_pkg is not None and content_pkg is not None

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return copy.deepcopy(json.loads(path.read_text(encoding="utf-8"))["world"])

    def _freeze(obj, freeze_map: dict):
        """Recursively replaces `created_at`/`at` values with a fixed
        literal, and any STRING value present as a key in `freeze_map` with
        its mapped replacement (run_id/opportunity_id — both minted fresh,
        non-deterministically, by the real Python call sites this captures).
        Generalizes `_capture_proposal_create_run`'s own `_freeze_ids`
        (single run_id/opportunity_id pair) to this function's MANY
        separately-built runs, each with its own pair."""
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k in ("created_at", "at"):
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif isinstance(v, str) and v in freeze_map:
                    out[k] = freeze_map[v]
                else:
                    out[k] = _freeze(v, freeze_map)
            return out
        if isinstance(obj, list):
            return [_freeze(v, freeze_map) for v in obj]
        return obj

    def _dump(log) -> dict:
        return json.loads(log.model_dump_json())

    cases: list[dict] = []

    def _snapshot(log) -> tuple[dict, dict]:
        """Dump `log` to a plain dict IMMEDIATELY — before any mutating
        operation runs against it. Load-bearing for the `cache={}` Group C
        cases: `prm.create_run(..., cache=cache)` stores the run_log object
        itself at `cache[run_id]` (NOT a copy), and `_apply_quick_check_
        content`'s own internal `update_state` MUTATES that same object
        in-place (`run_log.status = status`, ...) for cache-mode calls.
        Snapshotting AFTER the operation would silently capture the AFTER
        state as "before" (caught empirically: a first draft of this capture
        did exactly that — every Group C `before.status` read back as
        `content_selected`/`error` instead of the true pre-dispatch
        `service_selected`/`created`). Disk-mode calls (`select_service`,
        every Group A/B case) do not share this hazard (`prm.get_run` always
        deserializes a FRESH object from disk), but every case snapshots
        this way uniformly rather than relying on two different disciplines
        for two different groups."""
        freeze_map = {
            log.run_id: "prun_TEST_FIXED",
            log.opportunity.opportunity_id: "op_TEST_FIXED",
        }
        return _dump(log), freeze_map

    def _record(name: str, before_dump: dict, freeze_map: dict, *, note: str | None = None,
                synthetic: bool = False, **result_kwargs) -> None:
        case: dict = {"name": name}
        if note is not None:
            case["note"] = note
        if synthetic:
            case["synthetic"] = True
        case["before"] = _freeze(before_dump, freeze_map)
        if result_kwargs.get("result") is not None:
            result_kwargs = dict(result_kwargs)
            result_kwargs["result"] = _freeze(result_kwargs["result"], freeze_map)
        case.update(result_kwargs)
        cases.append(case)

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)
        prev_runs_dir = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
        os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
        try:
            # -- Group A: real create_proposal_run + real select_service ------

            def _create_typed(**overrides) -> object:
                kwargs = dict(
                    world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                    content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                    simulation_time=_SIM_TIME, mode="interactive",
                )
                kwargs.update(overrides)
                return create_proposal_run(CreateProposalRunBody(**kwargs))

            def _try_select(run_id: str, **body_kwargs) -> dict:
                try:
                    result = select_service(run_id, SelectServiceBody(**body_kwargs))
                    return {"raises": False, "result": _dump(result)}
                except HTTPException as exc:
                    return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

            run_a1 = _create_typed()
            before_a1, fm_a1 = _snapshot(run_a1)
            _record("real_content_dispatch_success", before_a1, fm_a1,
                    **_try_select(run_a1.run_id, selected_service_id="music_playlist"))

            run_a2 = _create_typed()
            before_a2, fm_a2 = _snapshot(run_a2)
            _record("unsupported_service_422", before_a2, fm_a2,
                    **_try_select(run_a2.run_id, selected_service_id="quiz"))

            run_a3 = _create_typed()
            before_a3, fm_a3 = _snapshot(run_a3)
            _record("service_not_in_allowed_ids_422", before_a3, fm_a3,
                    note="full_karaoke is not in the before_rest_until_stop matrix row's allowed_service_ids.",
                    **_try_select(run_a3.run_id, selected_service_id="full_karaoke"))

            run_a4 = _create_typed()
            before_a4, fm_a4 = _snapshot(run_a4)
            _record(
                "algorithm_config_overrides_applied", before_a4, fm_a4,
                **_try_select(
                    run_a4.run_id, selected_service_id="music_playlist",
                    algorithm_config_overrides={"content": {"plan_item_count": 1}},
                ),
            )

            # Legacy world_snapshot path: no typed `world` -> setup_snapshot
            # stays None -> _dispatch_content_for_service takes the
            # MOCK/legacy `_build_content_context` branch even though
            # content_package_id IS the real transparent package (the branch
            # condition's SECOND half, `setup_snapshot is not None`, is what
            # is false here).
            legacy_world_snapshot, _legacy_setup_snapshot = _freeze_setup_snapshot(
                world=World.model_validate(_seed_world_dict()), matrix_version="v1", service_pkg=service_pkg,
                content_pkg=content_pkg,
                service_hyperparameters={hp.key: hp.default for hp in service_pkg.hyperparameters},
            )
            legacy_kwargs = dict(
                world_snapshot=json.loads(json.dumps(legacy_world_snapshot, default=str)),
                trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop",
                motion_state="driving", service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                simulation_time=_SIM_TIME, mode="interactive",
            )
            run_a5 = create_proposal_run(CreateProposalRunBody(**legacy_kwargs))
            before_a5, fm_a5 = _snapshot(run_a5)
            _record(
                "legacy_world_snapshot_mock_context_dispatch", before_a5, fm_a5,
                note=(
                    "setup_snapshot is None (legacy world_snapshot path) -> _build_content_context "
                    "(mock/legacy) branch, even with the REAL content package id."
                ),
                **_try_select(run_a5.run_id, selected_service_id="humming_karaoke"),
            )

            run_a6 = _create_typed()
            before_a6, fm_a6 = _snapshot(run_a6)
            _record(
                "run_not_found_404", before_a6, fm_a6,
                **_try_select("not-a-real-run-id-at-all", selected_service_id="music_playlist"),
            )

            # -- Group B: hand-built run_log (prm.create_run directly) --------

            def _hand_built_run(*, allowed_service_ids, motion_state, content_package_id,
                                 lifecycle_stage="before_rest_until_stop", cache=None):
                opportunity = ProposalOpportunity(
                    opportunity_id="op-select-service-manual",
                    trigger_purpose="rest_recommended", lifecycle_stage=lifecycle_stage,
                    allowed_service_ids=allowed_service_ids, simulation_time=_SIM_TIME, run_seed=_RUN_SEED,
                )
                journey_state = JourneyState(
                    lifecycle_stage=lifecycle_stage, motion_state=motion_state,
                    active_service_id=None, active_plan_id=None,
                )
                return prm.create_run(
                    opportunity=opportunity, matrix_version="v1",
                    world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
                    service_package_id=_SERVICE_PKG_ID, content_package_id=content_package_id,
                    parameters={}, hyperparameters={}, journey_state=journey_state,
                    runs_dir=runs_dir, cache=cache,
                )

            run_b1 = _hand_built_run(
                allowed_service_ids=["full_karaoke", "music_playlist"], motion_state="driving",
                content_package_id=_CONTENT_PKG_ID,
            )
            before_b1, fm_b1 = _snapshot(run_b1)
            _record(
                "service_not_eligible_422", before_b1, fm_b1,
                note=(
                    "full_karaoke IS in allowed_service_ids but excluded while driving "
                    "(full_karaoke_requires_stopped) -- the resolve_eligibility re-check, not the "
                    "allowed_service_ids membership check."
                ),
                synthetic=True,
                **_try_select(run_b1.run_id, selected_service_id="full_karaoke"),
            )

            run_b2 = _hand_built_run(
                allowed_service_ids=["music_playlist"], motion_state="stopped",
                content_package_id=_SERVICE_PKG_ID,  # wrong family, on purpose
            )
            before_b2, fm_b2 = _snapshot(run_b2)
            _record(
                "content_package_mis_slotted_422", before_b2, fm_b2,
                note=(
                    "content_package_id points at the SERVICE package (wrong family) -- caught by "
                    "select_service's OWN pre-check, before _dispatch_content_for_service is ever called."
                ),
                synthetic=True,
                **_try_select(run_b2.run_id, selected_service_id="music_playlist"),
            )

            run_b3 = _hand_built_run(
                allowed_service_ids=["music_playlist"], motion_state="stopped",
                content_package_id=None,
            )
            before_b3, fm_b3 = _snapshot(run_b3)
            _record(
                "content_package_none_422", before_b3, fm_b3,
                note="run_log.content_package_id is None -- repr(None) == 'None' (bare, unquoted) in the message.",
                synthetic=True,
                **_try_select(run_b3.run_id, selected_service_id="music_playlist"),
            )

            # -- Group C: _apply_quick_check_content, always cache={} ---------
            #
            # Mirrors the REAL production quick_check call pattern
            # (create_proposal_run's own inline block: `prm.create_run(...,
            # cache=cache)` immediately followed by
            # `_apply_quick_check_content(..., cache=cache)` with the SAME
            # dict) — the run must already be a key in the cache passed to
            # _apply_quick_check_content, or its own internal append_event/
            # append_evidence/update_state calls raise ProposalRunNotFoundError
            # (cache mode never falls back to disk).

            def _content_defaults():
                return (
                    dict(content_pkg.parameters),
                    {hp.key: hp.default for hp in content_pkg.hyperparameters},
                )

            def _create_typed_cached(**overrides):
                kwargs = dict(
                    world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                    content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                    simulation_time=_SIM_TIME, mode="interactive",
                )
                kwargs.update(overrides)
                cache: dict = {}
                log = create_proposal_run(CreateProposalRunBody(**kwargs), cache=cache)
                return log, cache

            def _try_apply_quick_check(run_log, cache: dict, selected_service_id: str) -> dict:
                params, hparams = _content_defaults()
                try:
                    result = _apply_quick_check_content(
                        run_log.run_id, run_log, ServiceId(selected_service_id), params, hparams,
                        cache=cache,
                    )
                    return {"raises": False, "result": _dump(result)}
                except HTTPException as exc:
                    return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

            run_c1, cache_c1 = _create_typed_cached()
            before_c1, fm_c1 = _snapshot(run_c1)
            _record("quick_check_success", before_c1, fm_c1, **_try_apply_quick_check(run_c1, cache_c1, "music_playlist"))

            run_c2, cache_c2 = _create_typed_cached()
            before_c2, fm_c2 = _snapshot(run_c2)
            _record(
                "quick_check_unsupported_service_immediate_error", before_c2, fm_c2,
                note=(
                    "selected_service_id not in the real content package's supported_services -- "
                    "ALGORITHM_ERROR event, status=error, RETURNS NORMALLY (never raises)."
                ),
                **_try_apply_quick_check(run_c2, cache_c2, "quiz"),
            )

            cache_c3: dict = {}
            run_c3 = _hand_built_run(
                allowed_service_ids=["music_playlist"], motion_state="stopped", content_package_id=None,
                cache=cache_c3,
            )
            before_c3, fm_c3 = _snapshot(run_c3)
            _record(
                "quick_check_content_package_none", before_c3, fm_c3,
                note=(
                    "run_log.content_package_id is None -- same unsupported_service-shaped early return "
                    "as quick_check_unsupported_service_immediate_error."
                ),
                synthetic=True,
                **_try_apply_quick_check(run_c3, cache_c3, "music_playlist"),
            )

            cache_c4: dict = {}
            run_c4 = _hand_built_run(
                allowed_service_ids=["music_playlist"], motion_state="stopped",
                content_package_id=_SERVICE_PKG_ID,  # wrong family, but supports "music_playlist" itself
                cache=cache_c4,
            )
            before_c4, fm_c4 = _snapshot(run_c4)
            _record(
                "quick_check_mis_slotted_raises", before_c4, fm_c4,
                note=(
                    "content_package_id points at the SERVICE package (wrong family), but 'music_playlist' "
                    "IS in aica_transparent_service_selector_v1's own supported_services, so "
                    "_apply_quick_check_content's OWN guard does not fire -- it falls through to "
                    "_dispatch_content_for_service, whose family re-check DOES raise, UNCAUGHT, propagating "
                    "out. Reachable with REAL committed package data (only the run_log's content_package_id "
                    "assignment is hand-built, not the package itself)."
                ),
                synthetic=True,
                **_try_apply_quick_check(run_c4, cache_c4, "music_playlist"),
            )
        finally:
            if prev_runs_dir is None:
                os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
            else:
                os.environ["AICA_PROPOSAL_RUNS_DIR"] = prev_runs_dir

    _write("proposal_select_service", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {"select_service_cases": cases},
    })


# ---------------------------------------------------------------------------
# 43. proposal_recompute (routers/proposal.py's `recompute_proposal_run` --
#     feature 026, htmlapp Combined export, slice C4a Task 5).
#
#     Every case calls the REAL `recompute_proposal_run(run_id, body)`
#     directly (never a hand-rolled stand-in), always disk-mode
#     (`AICA_PROPOSAL_RUNS_DIR` monkeypatched to a tempdir -- Python's own
#     `recompute_proposal_run` has NO `cache` parameter at all, unlike
#     `create_proposal_run`), over the REAL committed seed
#     `seed-night-highway-oshi` and the two REAL ported packages
#     (`aica_transparent_service_selector_v1`/
#     `aica_transparent_content_selector_v1`).
#
#     Group A cases drive a run through the REAL journey-action sequence
#     (`apply_journey_action`, imported directly -- same function
#     `test_p7_recompute.py` reaches via TestClient) -- `rest_spot_arrived`
#     -> `rest_started` -> `rest_completed` reaches
#     after_rest_before_restart/stopped exactly like that test file's own
#     `_advance_to_after_rest` helper (mirrored here under the same name).
#     `select_service`/`apply_journey_action("accept"/"stop")` reach the
#     playback-active guard the same way `test_p7_recompute.py`'s own
#     `test_recompute_rejected_while_playback_active_then_succeeds_after_stop`
#     does.
#
#     Group B cases build the run_log DIRECTLY via `prm.create_run` (mirrors
#     `_capture_proposal_select_service`'s own Group B technique) to reach
#     the unknown/mis-slotted service/content package_id 422s -- a normal
#     `create_proposal_run` call can never produce an invalid package id on a
#     real run.
#
#     Two branches are DELIBERATELY NOT captured here -- proven unreachable
#     through this real call site (see recompute.ts's own module doc for the
#     full reasoning), covered instead via `vi.spyOn` at the TS test level,
#     mirroring `create_run.ts`'s OWN identical-shaped T017a precedent:
#       - `NO_ELIGIBLE_CANDIDATE` (zero eligible candidates) -- even
#         `test_p7_recompute.py`'s own
#         `test_recompute_zero_eligible_records_no_eligible_candidate_never_
#         fabricated` reaches it only by monkeypatching `resolve_eligibility`.
#       - `MatrixResolutionError` (an unrepresented purpose/stage pair) -- the
#         real committed matrix has a row for EVERY purpose/stage pair
#         `World`'s own compatibility validator allows, so any override that
#         would produce an unrepresented pair is already rejected one step
#         earlier by `apply_overrides`' own structural re-validation.
#     A THIRD branch (`evidence.error is not None` on the SERVICE dispatch,
#     -> ALGORITHM_ERROR) is also not captured here for the SAME reason
#     `create_run.ts`'s own port documents: the real ported selector never
#     throws for structurally valid input. `test_p7_recompute.py`'s own
#     equivalent test reaches it via a broken on-disk package + a
#     monkeypatched `AICA_PACKAGES_DIR` -- a heavier mechanism than the
#     `vi.spyOn(dispatchSelector)` technique this port already uses
#     elsewhere for the identical branch shape (`select_service.ts`'s own
#     content-dispatch ALGORITHM_ERROR describe block); covered that way
#     instead, for consistency with the rest of this slice.
# ---------------------------------------------------------------------------


def _capture_proposal_recompute() -> None:
    import copy
    import os
    import pathlib
    import tempfile

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.journey_action import JourneyAction
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.recompute import RecomputeRequest
    from aica_api.models.proposal.world import World
    from aica_api.routers.proposal import (
        CreateProposalRunBody,
        SelectServiceBody,
        _freeze_setup_snapshot,
        apply_journey_action,
        create_proposal_run,
        recompute_proposal_run,
        select_service,
    )
    from aica_api.services import proposal_run_manager as prm
    from aica_api.services.proposal_package_registry import ProposalPackageRegistry

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RUN_SEED = "seed-recompute-test"
    _SIM_TIME = "2026-08-02T09:00:00Z"

    reg = ProposalPackageRegistry(_PACKAGES_DIR)
    service_pkg = reg.get(_SERVICE_PKG_ID)
    content_pkg = reg.get(_CONTENT_PKG_ID)
    assert service_pkg is not None and content_pkg is not None

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return copy.deepcopy(json.loads(path.read_text(encoding="utf-8"))["world"])

    def _dump(log) -> dict:
        return json.loads(log.model_dump_json())

    def _post_rest_overrides(drowsiness: int, fatigue: int) -> list[dict]:
        return [
            {"path": "situation.drowsiness_level", "value": drowsiness},
            {"path": "situation.fatigue_level", "value": fatigue},
        ]

    cases: list[dict] = []

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)
        prev_runs_dir = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
        os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
        try:

            def _freeze(obj, freeze_map: dict):
                """Recursively replaces `created_at`/`at` with a fixed
                literal and any STRING value present as a key in
                `freeze_map` with its placeholder -- mirrors
                `_capture_proposal_select_service`'s own `_freeze`."""
                if isinstance(obj, dict):
                    out = {}
                    for k, v in obj.items():
                        if k in ("created_at", "at"):
                            out[k] = "2026-01-01T00:00:00.000000Z"
                        elif isinstance(v, str) and v in freeze_map:
                            out[k] = freeze_map[v]
                        else:
                            out[k] = _freeze(v, freeze_map)
                    return out
                if isinstance(obj, list):
                    return [_freeze(v, freeze_map) for v in obj]
                return obj

            class _Scenario:
                """Accumulates a freeze_map across possibly MULTIPLE
                recomputes on the SAME run -- each recompute mints its own
                fresh opportunity_id, so a multi-step case (e.g. recomputing
                twice) needs every one of them frozen against ONE consistent
                map, not just the first. Generalizes
                `_capture_proposal_create_run`'s own single-pair `_freeze_ids`
                to an unbounded number of opportunity_ids, in MINTING order."""

                def __init__(self, log):
                    self.freeze_map: dict = {log.run_id: "prun_TEST_FIXED"}
                    self._n = 0
                    self._add_opportunity_id(log.opportunity.opportunity_id)

                def _add_opportunity_id(self, opportunity_id: str) -> None:
                    if opportunity_id not in self.freeze_map:
                        self.freeze_map[opportunity_id] = f"op_TEST_FIXED_{self._n}"
                        self._n += 1

                def snap(self, log) -> dict:
                    self._add_opportunity_id(log.opportunity.opportunity_id)
                    return _freeze(_dump(log), self.freeze_map)

            def _record(name: str, *, before=None, note: str | None = None, synthetic: bool = False, **result_kwargs) -> None:
                case: dict = {"name": name}
                if note is not None:
                    case["note"] = note
                if synthetic:
                    case["synthetic"] = True
                if before is not None:
                    case["before"] = before
                case.update(result_kwargs)
                cases.append(case)

            def _try_recompute(scenario: "_Scenario", run_id: str, body_kwargs: dict) -> dict:
                try:
                    result = recompute_proposal_run(run_id, RecomputeRequest(**body_kwargs))
                    return {"raises": False, "result": scenario.snap(result)}
                except HTTPException as exc:
                    return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

            def _create_typed(**overrides):
                kwargs = dict(
                    world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                    content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                    simulation_time=_SIM_TIME, mode="interactive",
                )
                kwargs.update(overrides)
                return create_proposal_run(CreateProposalRunBody(**kwargs))

            def _advance_to_after_rest(run_id: str, *, drowsiness: int, fatigue: int):
                apply_journey_action(run_id, JourneyAction(action_type="rest_spot_arrived"))
                apply_journey_action(run_id, JourneyAction(action_type="rest_started"))
                return apply_journey_action(
                    run_id,
                    JourneyAction(
                        action_type="rest_completed",
                        payload={"post_rest": {"drowsiness_level": drowsiness, "fatigue_level": fatigue}},
                    ),
                )

            def _hand_built_typed_run(*, service_package_id, content_package_id):
                """Group B -- mirrors `_capture_proposal_select_service`'s own
                `_hand_built_run`, widened to include a typed `world`/
                `setup_snapshot` (recompute's own `world is None` guard would
                otherwise reject it before ever reaching the package-id
                checks under test)."""
                world = World.model_validate(_seed_world_dict())
                opportunity = ProposalOpportunity(
                    opportunity_id="op-recompute-manual",
                    trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop",
                    allowed_service_ids=["music_playlist"], simulation_time=_SIM_TIME, run_seed=_RUN_SEED,
                )
                journey_state = JourneyState(
                    lifecycle_stage="before_rest_until_stop", motion_state="driving",
                    active_service_id=None, active_plan_id=None,
                )
                world_snapshot, setup_snapshot = _freeze_setup_snapshot(
                    world=world, matrix_version="v1", service_pkg=service_pkg, content_pkg=content_pkg,
                    service_hyperparameters={hp.key: hp.default for hp in service_pkg.hyperparameters},
                )
                return prm.create_run(
                    opportunity=opportunity, matrix_version="v1", world_snapshot=world_snapshot,
                    service_package_id=service_package_id, content_package_id=content_package_id,
                    parameters={}, hyperparameters={}, journey_state=journey_state,
                    setup_snapshot=setup_snapshot, world=world,
                    runs_dir=runs_dir,
                )

            # -- Group A0: trivial guards --------------------------------------

            try:
                recompute_proposal_run("not-a-real-run-id-at-all", RecomputeRequest())
                raise AssertionError("expected HTTPException")
            except HTTPException as exc:
                _record("run_not_found_404", raises=True, status_code=exc.status_code, detail=exc.detail)

            legacy_world_snapshot, _legacy_setup_snapshot = _freeze_setup_snapshot(
                world=World.model_validate(_seed_world_dict()), matrix_version="v1",
                service_pkg=service_pkg, content_pkg=content_pkg,
                service_hyperparameters={hp.key: hp.default for hp in service_pkg.hyperparameters},
            )
            legacy_kwargs = dict(
                world_snapshot=json.loads(json.dumps(legacy_world_snapshot, default=str)),
                trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop",
                motion_state="driving", service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                simulation_time=_SIM_TIME, mode="interactive",
            )
            legacy_run = create_proposal_run(CreateProposalRunBody(**legacy_kwargs))
            assert legacy_run.world is None
            legacy_scn = _Scenario(legacy_run)
            _record(
                "legacy_run_no_typed_world_422", before=legacy_scn.snap(legacy_run),
                note="run_log.world is None (legacy world_snapshot path) -- recompute requires a typed-world run.",
                **_try_recompute(legacy_scn, legacy_run.run_id, {"overrides": []}),
            )

            # -- Group A1: success paths, real journey-driven ------------------

            run3 = _create_typed()
            scn3 = _Scenario(run3)
            _record(
                "interactive_no_journey_advance_success", before=scn3.snap(run3),
                note=(
                    "Recompute immediately after create, no journey advance, empty overrides -- still mints a "
                    "NEW opportunity_id/SERVICE_SELECTED for the SAME before_rest_until_stop row, no CONTEXT_EDITED."
                ),
                **_try_recompute(scn3, run3.run_id, {"overrides": []}),
            )

            run4 = _create_typed()
            adv4 = _advance_to_after_rest(run4.run_id, drowsiness=80, fatigue=70)
            scn4 = _Scenario(adv4)
            _record(
                "interactive_after_rest_full_sequence_with_overrides", before=scn4.snap(adv4),
                note=(
                    "rest_spot_arrived -> rest_started -> rest_completed (real journey engine) reaches "
                    "after_rest_before_restart/stopped; recompute with matching post-rest overrides -- "
                    "CONTEXT_EDITED, OPPORTUNITY_OPENED, RECOMPUTED, SERVICE_SELECTED in order; journey_state "
                    "active_service_id/rejected_service_ids reset, lifecycle_stage/motion_state preserved."
                ),
                **_try_recompute(scn4, run4.run_id, {"overrides": _post_rest_overrides(80, 70)}),
            )

            run5 = _create_typed()
            adv5 = _advance_to_after_rest(run5.run_id, drowsiness=80, fatigue=70)
            scn5 = _Scenario(adv5)
            before5 = scn5.snap(adv5)
            first5 = _try_recompute(scn5, run5.run_id, {"overrides": _post_rest_overrides(80, 70)})
            second5 = _try_recompute(scn5, run5.run_id, {"overrides": _post_rest_overrides(10, 5)})
            _record(
                "recompute_twice_history_grows_and_top_ranked_changes", before=before5,
                note=(
                    "FR-008/SC-003: high (80/70) vs low (10/5) post-rest recompute on the SAME run yields a "
                    "DIFFERENT top-ranked service for the identical after_rest_before_restart opportunity, and "
                    "opportunity_history/setup_snapshot_history grow from length 0 -> 1 -> 2 (append-only)."
                ),
                raises=False, result_first=first5["result"], result_second=second5["result"],
            )

            run6 = _create_typed()
            adv6 = _advance_to_after_rest(run6.run_id, drowsiness=80, fatigue=70)
            scn6 = _Scenario(adv6)
            _record(
                "empty_overrides_no_context_edited_event", before=scn6.snap(adv6),
                note="overrides=[] (genuinely empty list, not merely values matching the seed) -- no CONTEXT_EDITED event, everything else still recomputes.",
                **_try_recompute(scn6, run6.run_id, {"overrides": []}),
            )

            # -- Group A2: invalid-override guards ------------------------------

            run7 = _create_typed()
            adv7 = _advance_to_after_rest(run7.run_id, drowsiness=80, fatigue=70)
            scn7 = _Scenario(adv7)
            before7 = scn7.snap(adv7)
            result7 = _try_recompute(scn7, run7.run_id, {"overrides": [{"path": "situation.drowsiness_level", "value": 999}]})
            unchanged7 = prm.get_run(run7.run_id, runs_dir)
            _record(
                "invalid_override_out_of_range_422", before=before7,
                note=(
                    "drowsiness_level=999 is out of range -- InvalidOverrideError -> 422 array-of-issues. "
                    "unchanged_after_fetch proves the run is BYTE-IDENTICAL after the rejected attempt (no "
                    "snapshot ever appended on a 422)."
                ),
                unchanged_after_fetch=scn7.snap(unchanged7),
                **result7,
            )

            run8 = _create_typed()
            adv8 = _advance_to_after_rest(run8.run_id, drowsiness=80, fatigue=70)
            scn8 = _Scenario(adv8)
            _record(
                "unknown_override_path_422", before=scn8.snap(adv8),
                **_try_recompute(scn8, run8.run_id, {"overrides": [{"path": "situation.does_not_exist", "value": 1}]}),
            )

            run9 = _create_typed()
            adv9 = _advance_to_after_rest(run9.run_id, drowsiness=80, fatigue=70)
            scn9 = _Scenario(adv9)
            _record(
                "dangling_catalog_reference_422", before=scn9.snap(adv9),
                note="driver_profile.oshi_artists[0].artist_id replaced with an id absent from the real catalog -- issue.code == 'unknown_catalog_reference'.",
                **_try_recompute(
                    scn9, run9.run_id,
                    {"overrides": [{"path": "driver_profile.oshi_artists[0].artist_id", "value": "synthetic-artist-DOES-NOT-EXIST"}]},
                ),
            )

            run10 = _create_typed()
            scn10 = _Scenario(run10)
            _record(
                "empty_matrix_row_422", before=scn10.snap(run10),
                note=(
                    "override control_inputs.lifecycle_stage -> during_rest_stopped (structurally COMPATIBLE with "
                    "the unchanged trigger_purpose=rest_recommended, per World's own validator) -- resolveMatrix "
                    "succeeds with an EMPTY allowed_service_ids row, so buildProposalOpportunity's OWN "
                    "empty-list validator raises (bare string), never MatrixResolutionError."
                ),
                synthetic=True,
                **_try_recompute(scn10, run10.run_id, {"overrides": [{"path": "control_inputs.lifecycle_stage", "value": "during_rest_stopped"}]}),
            )

            # -- Group A3: playback-active guard, real journey-driven -----------

            run11 = _create_typed()
            top_candidate = run11.evidence[0].output["ranked_candidates"][0]["candidate_id"]
            selected11 = select_service(run11.run_id, SelectServiceBody(selected_service_id=top_candidate))
            accepted11 = apply_journey_action(run11.run_id, JourneyAction(action_type="accept"))
            assert accepted11.journey_state.playback_state.value == "active"
            scn11 = _Scenario(accepted11)
            before_blocked11 = scn11.snap(accepted11)
            _record(
                "playback_active_blocks_recompute_422", before=before_blocked11,
                note="journey_state.playback_state == active (via select-service + journey/action accept, real endpoints) -- STRUCTURED {code: 'recompute_requires_idle_playback', message} detail.",
                **_try_recompute(scn11, run11.run_id, {"overrides": []}),
            )
            stopped11 = apply_journey_action(run11.run_id, JourneyAction(action_type="stop"))
            assert stopped11.journey_state.playback_state.value == "stopped"
            before_after_stop11 = scn11.snap(stopped11)
            _record(
                "playback_stopped_recompute_succeeds", before=before_after_stop11,
                note="SAME run as playback_active_blocks_recompute_422, after journey/action stop -- recompute now succeeds.",
                **_try_recompute(scn11, run11.run_id, {"overrides": []}),
            )
            del selected11  # only used to advance the run to playback_state=active via the accept action above

            # -- Group A4: quick_check content dispatch --------------------------
            #
            # NOTE (found empirically, not assumed): after_rest_before_restart's
            # allowed row is {live_viewing, stretch_video, full_karaoke,
            # oshi_reexperience, call_response_stopped}; the REAL content
            # package's own supported_services is only {music_playlist,
            # humming_karaoke, full_karaoke} (select_service.ts's own module
            # doc). Neither (80/70) nor (10/5) post-rest ranks full_karaoke
            # #1 (stretch_video / oshi_reexperience do, per the high/low
            # post-rest cases above) -- so an after-rest quick_check recompute
            # genuinely, reproducibly ends in the "content package doesn't
            # support the newly-selected service" ALGORITHM_ERROR branch, NOT
            # a successful dispatch. Captured as its OWN case below (a real,
            # valuable branch), with a SEPARATE before_rest_until_stop-stage
            # case (content package DOES support that row's own rank-1) to
            # cover the successful-dispatch branch too.

            run12 = _create_typed(mode="quick_check")
            scn12 = _Scenario(run12)
            _record(
                "quick_check_content_dispatch_succeeds_before_rest_stage", before=scn12.snap(run12),
                note=(
                    "mode=quick_check, no journey advance (stays before_rest_until_stop, whose rank-1 IS "
                    "supported by the real content package) -> recompute additionally dispatches content for "
                    "the rank-1 service in the SAME call and succeeds -- CONTENT_SELECTED, status=content_selected."
                ),
                **_try_recompute(scn12, run12.run_id, {"overrides": []}),
            )

            run13 = _create_typed(mode="quick_check")
            scn13 = _Scenario(run13)
            content_hp_override = {hp.key: hp.default for hp in content_pkg.hyperparameters}
            content_hp_override["plan_item_count"] = 1
            _record(
                "quick_check_content_hyperparameters_override_applied", before=scn13.snap(run13),
                note="body.content_hyperparameters explicitly supplied (pyTruthy true branch) -> used verbatim instead of content_pkg's own manifest defaults -- same successful before_rest_until_stop-stage dispatch as above.",
                **_try_recompute(scn13, run13.run_id, {"overrides": [], "content_hyperparameters": content_hp_override}),
            )

            run12b = _create_typed(mode="quick_check")
            adv12b = _advance_to_after_rest(run12b.run_id, drowsiness=80, fatigue=70)
            scn12b = _Scenario(adv12b)
            _record(
                "quick_check_content_unsupported_service_after_rest", before=scn12b.snap(adv12b),
                note=(
                    "mode=quick_check, advanced to after_rest_before_restart -> recompute's own service dispatch "
                    "ranks 'stretch_video' #1 (a REAL after-rest candidate), which the real content package does "
                    "NOT support -- _apply_quick_check_content's OWN unsupported_service guard fires, appending "
                    "ALGORITHM_ERROR and status=error, WITHOUT raising (quick_check has no HTTP request to 422 "
                    "back to) -- a genuinely reachable branch with real committed data, not a coincidence."
                ),
                **_try_recompute(scn12b, run12b.run_id, {"overrides": _post_rest_overrides(80, 70)}),
            )

            # -- Group A5: parameters/hyperparameters fallback + override -------

            run14 = _create_typed(mode="interactive", algorithm_config_overrides={"service": {"gamma_drowsiness": 0.123456}})
            assert run14.hyperparameters.get("gamma_drowsiness") == 0.123456
            scn14 = _Scenario(run14)
            _record(
                "hyperparameters_fallback_carries_run_not_package_defaults", before=scn14.snap(run14),
                note=(
                    "body.hyperparameters ABSENT -> falls back to run_log's OWN current hyperparameters "
                    "(gamma_drowsiness=0.123456, from algorithm_config_overrides at CREATE time), NOT "
                    "service_pkg's manifest default (1.0, verified to differ) -- proven via "
                    "result.evidence[-1].input_snapshot.hyperparameters.gamma_drowsiness (the freshly-dispatched "
                    "context), NOT result.hyperparameters -- update_state has NO parameters/hyperparameters "
                    "kwarg at all (routers/proposal.py:1778-1787), so result.hyperparameters is BYTE-IDENTICAL "
                    "to before.hyperparameters regardless of what body.hyperparameters was -- see recompute.ts's "
                    "own module doc 'DIVERGES...are NEVER PERSISTED' note."
                ),
                **_try_recompute(scn14, run14.run_id, {"overrides": []}),
            )

            run15 = _create_typed(mode="interactive")
            scn15 = _Scenario(run15)
            probe_params = {"probe_marker_C4A_TASK5": True}
            _record(
                "parameters_explicit_override_supplied_at_recompute", before=scn15.snap(run15),
                note=(
                    "body.parameters explicitly supplied at recompute (pyTruthy true branch, a synthetic probe "
                    "dict deliberately unlike either run_log.parameters or service_pkg.parameters) -> proven via "
                    "result.evidence[-1].input_snapshot.parameters == body.parameters verbatim. "
                    "result.parameters itself (the run's own top-level field) stays BYTE-IDENTICAL to "
                    "before.parameters regardless -- update_state never touches it (same reasoning as the "
                    "hyperparameters case above)."
                ),
                **_try_recompute(scn15, run15.run_id, {"overrides": [], "parameters": probe_params}),
            )

            # -- Group B: hand-built runs, package-id edges ----------------------

            run16 = _hand_built_typed_run(service_package_id="not_a_real_package_id", content_package_id=_CONTENT_PKG_ID)
            scn16 = _Scenario(run16)
            _record(
                "service_package_unknown_422", before=scn16.snap(run16), synthetic=True,
                **_try_recompute(scn16, run16.run_id, {"overrides": []}),
            )

            run17 = _hand_built_typed_run(service_package_id=_CONTENT_PKG_ID, content_package_id=_CONTENT_PKG_ID)
            scn17 = _Scenario(run17)
            _record(
                "service_package_mis_slotted_422", before=scn17.snap(run17), synthetic=True,
                note="service_package_id points at the REAL CONTENT package (wrong family).",
                **_try_recompute(scn17, run17.run_id, {"overrides": []}),
            )

            run18 = _hand_built_typed_run(service_package_id=_SERVICE_PKG_ID, content_package_id="not_a_real_package_id")
            scn18 = _Scenario(run18)
            _record(
                "content_package_unknown_422", before=scn18.snap(run18), synthetic=True,
                **_try_recompute(scn18, run18.run_id, {"overrides": []}),
            )

            run19 = _hand_built_typed_run(service_package_id=_SERVICE_PKG_ID, content_package_id=_SERVICE_PKG_ID)
            scn19 = _Scenario(run19)
            _record(
                "content_package_mis_slotted_422", before=scn19.snap(run19), synthetic=True,
                note="content_package_id points at the REAL SERVICE package (wrong family) -- caught by recompute's OWN pre-check, before step 12/17 (dispatch/quick_check) ever run.",
                **_try_recompute(scn19, run19.run_id, {"overrides": []}),
            )

            run20 = _hand_built_typed_run(service_package_id=_SERVICE_PKG_ID, content_package_id=None)
            scn20 = _Scenario(run20)
            _record(
                "content_package_none_422", before=scn20.snap(run20), synthetic=True,
                note="run_log.content_package_id is None -- repr(None) == 'None' (bare, unquoted) in the message.",
                **_try_recompute(scn20, run20.run_id, {"overrides": []}),
            )
        finally:
            if prev_runs_dir is None:
                os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
            else:
                os.environ["AICA_PROPOSAL_RUNS_DIR"] = prev_runs_dir

    _write("proposal_recompute", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {"recompute_cases": cases},
    })


def _capture_proposal_journey_action() -> None:
    """Capture for `apply_journey_action` (routers/proposal.py:1863-1915) and
    `get_proposal_run` (1831-1848) -- feature 026 (htmlapp Combined export),
    slice C4a Task 6. Ports `src/engine/proposal/orchestrator/journey_action.ts`.

    Every case calls the REAL `apply_journey_action`/`get_proposal_run`
    directly (disk-mode -- neither Python signature has a `cache` parameter,
    same class `_capture_proposal_recompute` already documents for its own
    function), over the REAL committed seeds (`seed-night-highway-oshi` for
    every case except `rest_spot_arrived_wrong_trigger_purpose_422`, which
    needs a REAL non-`rest_recommended` seed and uses
    `seed-characteristic-route-event` instead of a hand-built run) and the
    two REAL ported packages.

    ALL TWELVE `JourneyActionType`s are exercised through this capture:
      RUN1 (service-then-content lifecycle chain): request_more, reject,
        choose_another, postpone, [select_service -- NOT a journey action],
        accept, complete, continue, stop, then a trailing reject rejected
        (wrong status, post-stop) = 8 action types + 1 rejection.
      RUN2 (rest lifecycle chain): motion_change (no active plan),
        rest_spot_arrived, rest_started, rest_completed = 4 action types,
        plus 3 separate rejection-path runs (rest_started too early,
        rest_completed bad payload, motion_change bad payload) and one more
        (rest_spot_arrived wrong trigger_purpose, real alt seed).
      RUN3: motion_change WITH an active plan (the `hasActivePlan` branch;
        1 more instance of an already-covered action type, deliberately, to
        exercise the OTHER branch of `motionChange`'s own precondition).
      RUN4: `reject` looped with `choose_another` until the real 6-candidate
        eligible pool is fully exhausted -- covers `reject`'s OWN
        NO_ELIGIBLE_CANDIDATE SUCCESS event (not an error) AND
        `choose_another`'s SEPARATE `no_eligible_candidate` REJECTION, both
        genuinely reachable with real committed data.
      Plus: run_not_found_404 (both functions), an `unrecognized_action_type`
      422 (via `JourneyAction.model_construct(...)`, bypassing pydantic's
      closed-enum validation the same way a real HTTP request never could --
      marked `synthetic` for that reason, but still a REAL call through the
      real `apply_journey_action`/`journey.applyAction` code path, not a
      hand-built result), and `get_proposal_run` success/idempotency.

    NOT captured (disclosed in `journey_action.ts`'s own module doc, not
    silently skipped): `capabilities_unavailable` -- `_get_service_
    capabilities()` (routers/proposal.py:128-130) return-types `->
    ServiceCapabilities` and either returns a real instance or raises, NEVER
    `None`, so this rejection is unreachable from `apply_journey_action`'s
    real call site in EITHER language; ``accept``'s/``continue_``'s own "no
    committed content plan" 422s, which require a `content_selected`/
    `playback_state=='completed'` run with no committed CONTENT evidence --
    structurally impossible via any real call sequence (status only reaches
    those values immediately after a content dispatch that itself appends
    the evidence `committed_plan` reads). Both are covered directly against
    `applyAction`/`journey.ts` by C2's own `tests/proposal_journey_
    validation.test.ts`, not re-derived here.
    """
    import os
    import pathlib
    import tempfile

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.proposal.journey_action import JourneyAction
    from aica_api.routers.proposal import (
        CreateProposalRunBody,
        SelectServiceBody,
        apply_journey_action,
        create_proposal_run,
        get_proposal_run,
        select_service,
    )

    _SEED_ID = "seed-night-highway-oshi"
    _ALT_SEED_ID = "seed-characteristic-route-event"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _SIM_TIME = "2026-08-02T09:00:00Z"

    def _seed_world_dict(seed_id: str) -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _dump(log) -> dict:
        return json.loads(log.model_dump_json())

    def _freeze(obj, freeze_map: dict):
        """Recursively replaces `created_at`/`at` values with a fixed literal,
        and any STRING value present as a key in `freeze_map` (only `run_id`
        for this capture -- NEITHER function ever mints a new opportunity_id,
        unlike `_capture_proposal_recompute`'s own `_freeze`) with its mapped
        replacement."""
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k in ("created_at", "at"):
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif isinstance(v, str) and v in freeze_map:
                    out[k] = freeze_map[v]
                else:
                    out[k] = _freeze(v, freeze_map)
            return out
        if isinstance(obj, list):
            return [_freeze(v, freeze_map) for v in obj]
        return obj

    def _snapshot(log) -> tuple[dict, dict]:
        """Dump `log` to a plain dict IMMEDIATELY, before any mutating call --
        mirrors `_capture_proposal_select_service`'s own `_snapshot` (see its
        doc comment for the general in-place-mutation hazard). NOT
        load-bearing for THIS function specifically: both `apply_journey_
        action` and `get_proposal_run` are ALWAYS disk-mode (verified --
        `prm.get_run(run_id, settings.proposal_runs_dir)` /
        `prm.append_event(run_id, event, settings.proposal_runs_dir)` /
        `prm.update_state(run_id, settings.proposal_runs_dir, ...)` never
        pass `cache=`; neither router function's own signature even HAS a
        `cache` parameter), and disk-mode's `get_run` always deserializes a
        FRESH object (`ProposalRunLog(**data)`) -- so no captured reference
        is ever aliased with what a later call mutates. Followed anyway for
        uniform discipline across every capture function in this file.

        Also freezes `log.opportunity.opportunity_id` -- neither function
        MINTS a new one (unlike `_capture_proposal_recompute`'s own
        `_Scenario`), but the run's ORIGINAL opportunity_id (minted once at
        create time) is itself non-deterministic and appears unchanged
        throughout every dump -- caught empirically: a first draft of this
        capture froze only `run_id` and failed the determinism check (two
        consecutive runs differed only in `opportunity_id` occurrences)."""
        freeze_map = {
            log.run_id: "prun_TEST_FIXED",
            log.opportunity.opportunity_id: "op_TEST_FIXED",
        }
        return _dump(log), freeze_map

    journey_action_cases: list[dict] = []
    get_run_cases: list[dict] = []

    def _record(name: str, before_dump: dict, freeze_map: dict, *, note: str | None = None,
                synthetic: bool = False, **result_kwargs) -> None:
        case: dict = {"name": name}
        if note is not None:
            case["note"] = note
        if synthetic:
            case["synthetic"] = True
        case["before"] = _freeze(before_dump, freeze_map)
        if result_kwargs.get("result") is not None:
            result_kwargs = dict(result_kwargs)
            result_kwargs["result"] = _freeze(result_kwargs["result"], freeze_map)
        case.update(result_kwargs)
        journey_action_cases.append(case)

    def _try_action(run_id: str, action_type: str, **kwargs) -> dict:
        try:
            result = apply_journey_action(run_id, JourneyAction(action_type=action_type, **kwargs))
            return {"raises": False, "result": _dump(result)}
        except HTTPException as exc:
            return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)
        prev_runs_dir = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
        os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
        try:
            def _create(seed_id: str = _SEED_ID, **overrides):
                kwargs = dict(
                    world=_seed_world_dict(seed_id), service_package_id=_SERVICE_PKG_ID,
                    content_package_id=_CONTENT_PKG_ID, run_seed=f"seed-for-{seed_id}",
                    simulation_time=_SIM_TIME, mode="interactive",
                )
                kwargs.update(overrides)
                return create_proposal_run(CreateProposalRunBody(**kwargs))

            # -- Group A0: trivial guards, both functions ----------------------

            try:
                apply_journey_action("not-a-real-run-id-at-all", JourneyAction(action_type="accept"))
                raise AssertionError("expected HTTPException")
            except HTTPException as exc:
                journey_action_cases.append({
                    "name": "run_not_found_404", "raises": True,
                    "status_code": exc.status_code, "detail": exc.detail,
                })

            try:
                get_proposal_run("not-a-real-run-id-at-all")
                raise AssertionError("expected HTTPException")
            except HTTPException as exc:
                get_run_cases.append({
                    "name": "get_run_not_found_404", "raises": True,
                    "status_code": exc.status_code, "detail": exc.detail,
                })

            # -- Group A1: RUN1 -- service-then-content lifecycle chain -------
            # request_more, reject, choose_another, postpone, [select_service],
            # accept, complete, continue, stop, then a trailing wrong-status
            # reject.

            run1 = _create()
            before1, fm1 = _snapshot(run1)
            _record(
                "request_more_success", before1, fm1,
                note="status=service_selected -> REQUEST_MORE event only, no state change.",
                **_try_action(run1.run_id, "request_more"),
            )

            before1b, fm1b = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "reject_success_pool_not_exhausted", before1b, fm1b,
                note="Rejects the rank-1 offered service; 5 of 6 real eligible candidates "
                     "remain -- SERVICE_REJECTED only, no NO_ELIGIBLE_CANDIDATE.",
                **_try_action(run1.run_id, "reject"),
            )

            before1c, fm1c = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "choose_another_success", before1c, fm1c,
                note="Advances to the next eligible, non-rejected candidate (real rank-2) -- "
                     "CHOOSE_ANOTHER then SERVICE_SELECTED, IN ORDER.",
                **_try_action(run1.run_id, "choose_another"),
            )

            before1d, fm1d = _snapshot(get_proposal_run(run1.run_id))
            _record("postpone_success", before1d, fm1d, **_try_action(run1.run_id, "postpone"))

            # select_service (STEP 2, CONTENT dispatch -- NOT a journey action)
            # picks a content-package-supported service directly, independent
            # of whichever service `choose_another` left active.
            select_service(run1.run_id, SelectServiceBody(selected_service_id="music_playlist"))

            before1e, fm1e = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "accept_success", before1e, fm1e,
                note="status=content_selected -> content_started; captures previous_content "
                     "for stop to restore later.",
                **_try_action(run1.run_id, "accept"),
            )

            before1f, fm1f = _snapshot(get_proposal_run(run1.run_id))
            _record("complete_success", before1f, fm1f, **_try_action(run1.run_id, "complete"))

            before1g, fm1g = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "continue_success", before1g, fm1g,
                note="playback_state stays completed -- CONTINUE_REQUESTED event only.",
                **_try_action(run1.run_id, "continue"),
            )

            before1h, fm1h = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "stop_success", before1h, fm1h,
                note="Restores the previous_content captured at accept -- RETURN_TO_PREVIOUS_CONTENT.",
                **_try_action(run1.run_id, "stop"),
            )

            before1i, fm1i = _snapshot(get_proposal_run(run1.run_id))
            _record(
                "reject_wrong_status_422", before1i, fm1i,
                note="status=content_stopped (post-stop) -- reject requires service_selected. "
                     "Nothing appended (append-only proof case).",
                **_try_action(run1.run_id, "reject"),
            )

            # -- Group A2: RUN2 -- rest lifecycle chain ------------------------

            run2 = _create()
            before2, fm2 = _snapshot(run2)
            _record(
                "motion_change_no_active_plan_success", before2, fm2,
                note="No active/backgrounded plan yet -- active_plan_disposition == 'none'.",
                **_try_action(run2.run_id, "motion_change", payload={"motion_state": "stopped"}),
            )

            before2b, fm2b = _snapshot(get_proposal_run(run2.run_id))
            _record("rest_spot_arrived_success", before2b, fm2b, **_try_action(run2.run_id, "rest_spot_arrived"))

            before2c, fm2c = _snapshot(get_proposal_run(run2.run_id))
            _record("rest_started_success", before2c, fm2c, **_try_action(run2.run_id, "rest_started"))

            before2d, fm2d = _snapshot(get_proposal_run(run2.run_id))
            _record(
                "rest_completed_success", before2d, fm2d,
                note="REST_COMPLETED then OPPORTUNITY_OPENED, IN ORDER; lifecycle_stage -> "
                     "after_rest_before_restart.",
                **_try_action(
                    run2.run_id, "rest_completed",
                    payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 15}},
                ),
            )

            # rest_started too early (before rest_spot_arrived), fresh run.
            run2b = _create()
            before2e, fm2e = _snapshot(run2b)
            _record("rest_started_wrong_lifecycle_422", before2e, fm2e, **_try_action(run2b.run_id, "rest_started"))

            # rest_completed, invalid/missing payload.
            run2c = _create()
            apply_journey_action(run2c.run_id, JourneyAction(action_type="rest_spot_arrived"))
            before2f, fm2f = _snapshot(get_proposal_run(run2c.run_id))
            _record(
                "rest_completed_invalid_payload_422", before2f, fm2f,
                **_try_action(run2c.run_id, "rest_completed", payload={}),
            )

            # motion_change, invalid/missing payload.
            run2d = _create()
            before2g, fm2g = _snapshot(run2d)
            _record(
                "motion_change_invalid_payload_422", before2g, fm2g,
                **_try_action(run2d.run_id, "motion_change", payload={}),
            )

            # rest_spot_arrived, wrong trigger_purpose -- REAL alt seed
            # (route_music), not a hand-built run.
            run2e = _create(seed_id=_ALT_SEED_ID)
            before2h, fm2h = _snapshot(run2e)
            _record(
                "rest_spot_arrived_wrong_trigger_purpose_422", before2h, fm2h,
                note=f"opportunity.trigger_purpose == route_music (real seed {_ALT_SEED_ID!r}), "
                     "not rest_recommended.",
                **_try_action(run2e.run_id, "rest_spot_arrived"),
            )

            # -- Group A3: RUN3 -- motion_change WITH an active plan -----------

            run3 = _create()
            select_service(run3.run_id, SelectServiceBody(selected_service_id="music_playlist"))
            apply_journey_action(run3.run_id, JourneyAction(action_type="accept"))
            before3, fm3 = _snapshot(get_proposal_run(run3.run_id))
            _record(
                "motion_change_active_plan_success", before3, fm3,
                note="hasActivePlan branch (active_service_id set, playback_state=active) -- "
                     "the real disposition bucket is observed empirically here, not forced; "
                     "motionChange's OWN bucketing logic is C2's to verify, not re-derived here.",
                **_try_action(run3.run_id, "motion_change", payload={"motion_state": "driving"}),
            )

            # -- Group A4: RUN4 -- reject looped with choose_another until the
            # real eligible pool is fully exhausted. Covers reject's OWN
            # NO_ELIGIBLE_CANDIDATE SUCCESS event (not an error) AND
            # choose_another's SEPARATE no_eligible_candidate REJECTION.

            run4 = _create()
            service_evidence4 = [e for e in run4.evidence if e.step == "service" and e.error is None][-1]
            eligible_count = len(service_evidence4.input_snapshot["eligible_candidates"])
            assert eligible_count > 1, f"expected >1 real eligible candidate, got {eligible_count}"
            # Drain down to the LAST remaining candidate without recording
            # these intermediate steps -- `reject_success_pool_not_exhausted`/
            # `choose_another_success` above already cover the ORDINARY,
            # non-exhausting shape of these same two actions.
            for _ in range(eligible_count - 1):
                apply_journey_action(run4.run_id, JourneyAction(action_type="reject"))
                apply_journey_action(run4.run_id, JourneyAction(action_type="choose_another"))

            before4, fm4 = _snapshot(get_proposal_run(run4.run_id))
            result4 = _try_action(run4.run_id, "reject")
            assert not result4["raises"], f"unexpected raise draining the pool: {result4}"
            assert result4["result"]["events"][-1]["event_type"] == "NO_ELIGIBLE_CANDIDATE"
            _record(
                "reject_until_pool_exhausted_no_eligible_candidate", before4, fm4,
                note=f"After draining all {eligible_count} real eligible candidates via "
                     "alternating reject/choose_another, this LAST reject emits "
                     "SERVICE_REJECTED then NO_ELIGIBLE_CANDIDATE together -- a SUCCESS "
                     "end-state, never an error/crash.",
                **result4,
            )

            before4b, fm4b = _snapshot(get_proposal_run(run4.run_id))
            _record(
                "choose_another_no_eligible_candidate_422", before4b, fm4b,
                note="Pool fully exhausted -- choose_another's OWN rejection (distinct code "
                     "from reject's success-shaped NO_ELIGIBLE_CANDIDATE event above).",
                **_try_action(run4.run_id, "choose_another"),
            )

            # -- Group A5: unrecognized action_type (bypass-constructed) -------
            # `JourneyAction(action_type=...)` cannot hold this value through
            # normal pydantic validation (JourneyActionType is a closed enum)
            # -- mirrors journey.ts's own doc note on the model_construct-bypass
            # defense. `synthetic` because no real HTTP request can ever reach
            # this shape -- but it IS a real call through the real
            # apply_journey_action/applyAction code path, not a hand-built
            # result.

            run5 = _create()
            before5, fm5 = _snapshot(run5)
            bogus_action = JourneyAction.model_construct(action_type="garbage_xyz", payload={})
            try:
                apply_journey_action(run5.run_id, bogus_action)
                raise AssertionError("expected HTTPException")
            except HTTPException as exc:
                _record(
                    "unrecognized_action_type_422", before5, fm5, synthetic=True,
                    note="JourneyAction.model_construct(...) bypasses pydantic's closed-enum "
                         "validation -- proves applyAction's own generic 'not recognized' "
                         "rejection is wrapped exactly like any handler-specific one.",
                    raises=True, status_code=exc.status_code, detail=exc.detail,
                )

            # -- get_proposal_run: success + idempotency -----------------------

            run6 = _create()
            apply_journey_action(run6.run_id, JourneyAction(action_type="request_more"))
            apply_journey_action(run6.run_id, JourneyAction(action_type="reject"))
            before6, fm6 = _snapshot(get_proposal_run(run6.run_id))
            result6a = _freeze(_dump(get_proposal_run(run6.run_id)), fm6)
            result6b = _freeze(_dump(get_proposal_run(run6.run_id)), fm6)
            get_run_cases.append({
                "name": "get_run_success_renders_persisted_state_idempotently",
                "note": "get_proposal_run never recomputes/mutates -- two successive calls "
                        "return byte-identical results, both equal to the persisted state.",
                "before": _freeze(before6, fm6),
                "result": result6a,
                "result_repeat_call": result6b,
            })
        finally:
            if prev_runs_dir is None:
                os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
            else:
                os.environ["AICA_PROPOSAL_RUNS_DIR"] = prev_runs_dir

    _write("proposal_journey_action", {
        "input": {
            "seed_id": _SEED_ID,
            "alt_seed_id": _ALT_SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {
            "journey_action_cases": journey_action_cases,
            "get_run_cases": get_run_cases,
        },
    })


def _capture_proposal_explain() -> None:
    """Capture for `explain_from_run_log` (routers/proposal.py:2172-2269),
    `_generate_explanation` (2104-2171), and `_find_explain_target`
    (2068-2086) -- feature 026 (htmlapp Combined export), slice C4a Task 7
    (the LAST porting task). Ports
    `src/engine/proposal/orchestrator/explain.ts`.

    Every `raises`/`result` case calls the REAL `explain_from_run_log`
    directly (never a hand-rolled stand-in) with `provider="browser"` --
    the ONLY provider value this capture can exercise: `"backend"` would
    require a live/mocked Ollama server, and the offline TS port never
    attempts that provider at all (see explain.ts's own module doc for the
    `off`/`browser`/`backend` design) -- there is no Python behavior for an
    offline `"off"` request to capture parity against (`"off"` does not
    exist as a value in Python's `ExplainRequestBody.provider` literal), and
    an offline `"backend"` request is rejected before any Python-comparable
    work happens. So `provider="browser"` is the ONLY case shape this
    capture needs -- confirmed against `_generate_explanation`'s own
    `provider == "browser"` immediate-return branch, which is unconditional
    and needs no Ollama mock.

    Group A: real disk-persisted run (`AICA_PROPOSAL_RUNS_DIR` monkeypatched
    to a tempdir, mirroring `_capture_proposal_select_service`'s own
    pattern) over the real committed `seed-night-highway-oshi` (chosen
    because it has a registered oshi -- exercises `_resolve_oshi_artist`'s
    real, non-None path through `explain_from_run_log`'s own content-step
    context block, not just service_explanation.json's/content_
    explanation.json's own already-covered unit-level captures) and the two
    real ported packages:
      - `service_browser_success` / `service_unknown_target_422` -- called
        BEFORE `select_service`, against the real service evidence
        `create_proposal_run` itself always records.
      - `content_no_decision_422_before_select_service` -- same pre-
        `select_service` run, step="content": zero content evidence exists
        yet, so `_find_explain_target` returns `(None, None)`.
      - `content_browser_success` / `content_unknown_target_422` -- after a
        real `select_service("music_playlist")` call (same service this
        seed's own `proposal_select_service.json#real_content_dispatch_
        success` already uses), against the real content evidence.
      - `browser_provider_never_persists_even_with_persist_run_id_set` --
        proves `explain_from_run_log`'s `provider == "browser"` branch
        returns BEFORE the persistence block runs, even when a real
        `persist_run_id` is supplied (`run_log.explanations` stays `[]`
        after the call) -- a structural, not value, assertion.

    Group B: hand-built run_logs (`prm.create_run` directly, mirroring
    `_capture_proposal_select_service`'s own Group B technique) for the FOUR
    `_find_explain_target` branches real committed data cannot reach on its
    own:
      - `service_no_decision_422_empty_evidence` -- `evidence=[]` (no
        service decision was ever recorded at all).
      - `service_no_decision_422_only_errored_evidence` -- ONE service
        `AlgorithmEvidence` IS present, but `error is not None` (an
        `ALGORITHM_ERROR`), proving the `e.error is None` guard, not merely
        "no evidence entries exist", is what `_find_explain_target` checks.
      - `service_no_decision_422_error_set_even_though_output_present` --
        `error is not None` AND `output` is non-empty. Added during this
        task's mutation pass: the two cases above BOTH have empty `output`,
        so mutating `e.error is None` to a constant `True` left them green.
        This case is what actually discriminates the error guard, because
        the truthy `output` means only the error check can reject it.
      - `service_no_decision_422_error_none_but_output_empty_dict` -- the
        mirror image: `error is None` but `output` is `{}`, so only the
        `and e.output` truthiness check can reject it. Together the pair
        pins BOTH halves of the compound guard independently; either one
        alone leaves a mutation undetected.

    `prompt_hash` -- direct byte-parity captures (Python's
    `json.dumps([[m.role, m.content] for m in messages], ensure_ascii=False,
    sort_keys=True)` + `hashlib.sha256(...).hexdigest()`) over an assortment
    of message payloads exercising the escaping edge cases the TS port's
    `JSON.stringify`-based reconstruction must reproduce byte-for-byte:
    ASCII, embedded double-quotes/backslash, newline/tab/CR control chars,
    Japanese + full-width punctuation, an empty `messages` list, and a
    multi-message payload (ordering matters -- `prompt_hash` never sorts the
    message list itself, only `sort_keys=True` on each dict-shaped element,
    which is moot here since the serialized unit is `[role, content]`
    LISTS, not dicts -- so `sort_keys` has no observable effect at all; kept
    in the ported implementation only because Python's call site passes it,
    not because it changes any byte). Two of the real target/context pairs
    from Group A (`build_explanation_prompt` re-invoked directly, not
    re-derived from the `explain_from_run_log` response, which does not
    itself expose `prompt_hash`) are included so the byte-parity check also
    covers a REAL prompt shape, not only hand-built edge cases.
    """
    import os
    import pathlib
    import tempfile

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.routers.proposal import (
        CreateProposalRunBody,
        ExplainRequestBody,
        SelectServiceBody,
        create_proposal_run,
        explain_from_run_log,
        select_service,
    )
    from aica_api.services import explanation_builder as eb
    from aica_api.services import proposal_run_manager as prm

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RUN_SEED = "seed-explain-test"
    _SIM_TIME = "2026-08-02T09:00:00Z"

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _dump(log) -> dict:
        return json.loads(log.model_dump_json())

    def _freeze(obj, freeze_map: dict):
        """Same recursive `created_at`/`at` + id-substitution technique as
        `_capture_proposal_select_service`'s own `_freeze` (this capture's
        sibling task, same file)."""
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k in ("created_at", "at"):
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif isinstance(v, str) and v in freeze_map:
                    out[k] = freeze_map[v]
                else:
                    out[k] = _freeze(v, freeze_map)
            return out
        if isinstance(obj, list):
            return [_freeze(v, freeze_map) for v in obj]
        return obj

    explain_cases: list[dict] = []

    def _try_explain(run_log, freeze_map: dict, *, persist_run_id: str | None = None, **body_kwargs) -> dict:
        try:
            result = explain_from_run_log(
                run_log, ExplainRequestBody(**body_kwargs), persist_run_id=persist_run_id,
            )
            return {"raises": False, "result": _freeze(_dump(result), freeze_map)}
        except HTTPException as exc:
            return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)
        prev_runs_dir = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
        os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
        try:
            # -- Group A: real create_proposal_run (+ select_service) -------

            run = create_proposal_run(CreateProposalRunBody(
                world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                simulation_time=_SIM_TIME, mode="interactive",
            ))
            fm = {run.run_id: "prun_TEST_FIXED", run.opportunity.opportunity_id: "op_TEST_FIXED"}

            service_ev = next(
                e for e in reversed(run.evidence) if e.step == "service" and e.error is None
            )
            real_service_candidate = service_ev.output["ranked_candidates"][0]
            real_service_candidate_id = real_service_candidate["candidate_id"]

            explain_cases.append({
                "name": "service_browser_success",
                **_try_explain(run, fm, step="service", target_id=real_service_candidate_id, provider="browser"),
            })
            explain_cases.append({
                "name": "service_unknown_target_422",
                **_try_explain(run, fm, step="service", target_id="not-a-real-candidate-id", provider="browser"),
            })
            explain_cases.append({
                "name": "content_no_decision_422_before_select_service",
                "note": "No select_service call has happened yet on this run -- zero content evidence exists.",
                **_try_explain(run, fm, step="content", target_id="anything", provider="browser"),
            })
            explain_cases.append({
                "name": "browser_provider_never_persists_even_with_persist_run_id_set",
                "note": (
                    "provider=\"browser\" returns BEFORE explain_from_run_log's persistence block -- "
                    "run_log.explanations stays [] even though persist_run_id is supplied."
                ),
                **_try_explain(
                    run, fm, persist_run_id=run.run_id,
                    step="service", target_id=real_service_candidate_id, provider="browser",
                ),
            })
            explanations_after_browser_persist_attempt = _dump(
                prm.get_run(run.run_id, runs_dir)
            )["explanations"]

            run2 = select_service(run.run_id, SelectServiceBody(selected_service_id="music_playlist"))
            content_ev = next(
                e for e in reversed(run2.evidence) if e.step == "content" and e.error is None
            )
            real_content_item = content_ev.output["ordered_items"][0]
            real_content_item_id = real_content_item["item_id"]

            explain_cases.append({
                "name": "content_browser_success",
                "note": (
                    "seed-night-highway-oshi has a registered oshi -- exercises _resolve_oshi_artist's "
                    "real non-None path, plus _resolve_song_name/_resolve_song_artist, through this real "
                    "call site (not just the already-covered unit-level context.py captures)."
                ),
                **_try_explain(run2, fm, step="content", target_id=real_content_item_id, provider="browser"),
            })
            explain_cases.append({
                "name": "content_unknown_target_422",
                **_try_explain(run2, fm, step="content", target_id="not-a-real-item-id", provider="browser"),
            })

            # -- Group B: hand-built run_log (prm.create_run directly) ------

            def _hand_built_run(*, evidence: list = ()) -> object:
                opportunity = ProposalOpportunity(
                    opportunity_id="op-explain-manual",
                    trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop",
                    allowed_service_ids=["music_playlist"], simulation_time=_SIM_TIME, run_seed=_RUN_SEED,
                )
                journey_state = JourneyState(
                    lifecycle_stage="before_rest_until_stop", motion_state="driving",
                    active_service_id=None, active_plan_id=None,
                )
                return prm.create_run(
                    opportunity=opportunity, matrix_version="v1",
                    world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
                    service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                    parameters={}, hyperparameters={}, journey_state=journey_state,
                    evidence=list(evidence), runs_dir=runs_dir,
                )

            run_b1 = _hand_built_run()
            fm_b1 = {run_b1.run_id: "prun_TEST_FIXED", run_b1.opportunity.opportunity_id: "op_TEST_FIXED"}
            explain_cases.append({
                "name": "service_no_decision_422_empty_evidence",
                "synthetic": True,
                "note": "No service decision was ever recorded at all -- evidence=[].",
                **_try_explain(run_b1, fm_b1, step="service", target_id="anything", provider="browser"),
            })

            errored_service_evidence = AlgorithmEvidence(
                step="service", package_id=_SERVICE_PKG_ID, contract_version="1.0.0",
                schema_version="1.0.0", matrix_version="v1", input_snapshot={},
                output=None, error={"category": "algorithm_exception", "message": "boom"},
                used_feature_ids=[], unused_available_features=[], missing_features=[],
            )
            run_b2 = _hand_built_run(evidence=[errored_service_evidence])
            fm_b2 = {run_b2.run_id: "prun_TEST_FIXED", run_b2.opportunity.opportunity_id: "op_TEST_FIXED"}
            explain_cases.append({
                "name": "service_no_decision_422_only_errored_evidence",
                "synthetic": True,
                "note": (
                    "ONE service AlgorithmEvidence IS present, but error is not None (an ALGORITHM_ERROR) "
                    "-- proves the e.error is None guard, not merely \"no evidence entries exist\", is what "
                    "_find_explain_target checks."
                ),
                **_try_explain(run_b2, fm_b2, step="service", target_id="anything", provider="browser"),
            })

            # Deliberately malformed (never produced by real dispatch code,
            # which always sets output XOR error -- see _service_evidence/
            # _content_evidence's own mutual-exclusivity convention elsewhere
            # in this file) but pydantic-valid: error IS set AND output is
            # ALSO non-empty. Verified directly against a live interpreter
            # (not assumed) that Python's `e.error is None` guard excludes
            # this REGARDLESS of output's truthiness -- proves the error
            # check is independently load-bearing, not merely redundant with
            # (or masked by) the separate output-truthiness guard below it.
            # `service_no_decision_422_only_errored_evidence` above cannot
            # prove this on its own: its errored entry ALSO has output=None,
            # so pyTruthy(e.output) alone would already exclude it even with
            # the error check deleted entirely -- a genuinely weaker case
            # this one supersedes for mutation-discriminating purposes.
            errored_but_output_present_evidence = AlgorithmEvidence(
                step="service", package_id=_SERVICE_PKG_ID, contract_version="1.0.0",
                schema_version="1.0.0", matrix_version="v1", input_snapshot={},
                output={"ranked_candidates": [{"candidate_id": "anything", "rank": 1}]},
                error={"category": "algorithm_exception", "message": "boom"},
                used_feature_ids=[], unused_available_features=[], missing_features=[],
            )
            run_b4 = _hand_built_run(evidence=[errored_but_output_present_evidence])
            fm_b4 = {run_b4.run_id: "prun_TEST_FIXED", run_b4.opportunity.opportunity_id: "op_TEST_FIXED"}
            explain_cases.append({
                "name": "service_no_decision_422_error_set_even_though_output_present",
                "synthetic": True,
                "note": (
                    "Malformed (real dispatch code never sets BOTH), but pydantic-valid: error IS set AND "
                    "output is ALSO non-empty (even containing a candidate matching the requested target_id) "
                    "-- proves e.error is None is independently load-bearing, not masked by/redundant with "
                    "the separate pyTruthy(e.output) guard. Without this case, deleting the error check "
                    "entirely would not be caught by any other golden here."
                ),
                **_try_explain(run_b4, fm_b4, step="service", target_id="anything", provider="browser"),
            })

            empty_output_evidence = AlgorithmEvidence(
                step="service", package_id=_SERVICE_PKG_ID, contract_version="1.0.0",
                schema_version="1.0.0", matrix_version="v1", input_snapshot={},
                output={}, error=None,
                used_feature_ids=[], unused_available_features=[], missing_features=[],
            )
            run_b3 = _hand_built_run(evidence=[empty_output_evidence])
            fm_b3 = {run_b3.run_id: "prun_TEST_FIXED", run_b3.opportunity.opportunity_id: "op_TEST_FIXED"}
            explain_cases.append({
                "name": "service_no_decision_422_error_none_but_output_empty_dict",
                "synthetic": True,
                "note": (
                    "error IS None (not an ALGORITHM_ERROR) but output == {} -- Python-falsy despite being "
                    "non-None -- proves the SEPARATE bare `and e.output` truthiness guard (mirrored as "
                    "pyTruthy(e.output) in the TS port), independently of the e.error is None check above: "
                    "an evidence entry can pass the error check and still not count as a decision."
                ),
                **_try_explain(run_b3, fm_b3, step="service", target_id="anything", provider="browser"),
            })

            # -- prompt_hash -- direct byte-parity captures ------------------

            real_service_context = {
                "trigger_purpose": service_ev.input_snapshot.get("trigger_purpose"),
                "lifecycle_stage": service_ev.input_snapshot.get("lifecycle_stage"),
            }
            real_content_context = {
                "trigger_purpose": content_ev.input_snapshot.get("trigger_purpose"),
                "lifecycle_stage": content_ev.input_snapshot.get("lifecycle_stage"),
                "song_name": None, "song_artist": None, "oshi_artist": None,
            }
            prompt_hash_prompts: dict[str, ExplanationPrompt] = {
                "real_service_prompt": eb.build_explanation_prompt(
                    "service", real_service_candidate, real_service_context,
                ),
                "real_content_prompt": eb.build_explanation_prompt(
                    "content", real_content_item, real_content_context,
                ),
                "ascii_simple": ExplanationPrompt(
                    messages=[ExplainMessage(role="system", content="Hello world")], grounding={},
                ),
                "quotes_and_backslash": ExplanationPrompt(
                    messages=[ExplainMessage(role="user", content='He said "hi" and used a \\ backslash')],
                    grounding={},
                ),
                "newline_tab_cr_control_chars": ExplanationPrompt(
                    messages=[ExplainMessage(role="user", content="line1\nline2\ttabbed\r\nline3")],
                    grounding={},
                ),
                "japanese_and_fullwidth_punctuation": ExplanationPrompt(
                    messages=[ExplainMessage(role="system", content="日本語テスト　全角スペース＆記号")],
                    grounding={},
                ),
                "empty_messages_list": ExplanationPrompt(messages=[], grounding={}),
                "multiple_messages_ordering_matters": ExplanationPrompt(
                    messages=[
                        ExplainMessage(role="system", content="A"),
                        ExplainMessage(role="user", content="B"),
                        ExplainMessage(role="user", content="C"),
                    ],
                    grounding={},
                ),
            }
            prompt_hash_cases = {
                name: {
                    "messages": [m.model_dump() for m in p.messages],
                    "hash": eb.prompt_hash(p),
                }
                for name, p in prompt_hash_prompts.items()
            }
        finally:
            if prev_runs_dir is None:
                os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
            else:
                os.environ["AICA_PROPOSAL_RUNS_DIR"] = prev_runs_dir

    _write("proposal_explain", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {
            "explain_cases": explain_cases,
            "explanations_after_browser_persist_attempt": explanations_after_browser_persist_attempt,
            "prompt_hash_cases": prompt_hash_cases,
        },
    })


def _capture_merged_quickview() -> None:
    """POST /api/merged-runs/quickview -- services/merged_quickview.py::project
    (312 LOC) -- feature 026 (htmlapp Combined export), slice C4 Task 4.

    Real end-to-end capture through the SAME endpoint the offline app's
    (later) `merged.quickview` worker op will call: drives the
    non-persisting trigger preview (`iter_preview_ticks`) AND the
    non-persisting `cache={}` proposal projection for every fire/after-rest,
    in one call.

    Uses (`nri_fatigue_score_v1`, `uc01_fatigue_recovery_v0_1`,
    `run_seed=42`) -- the SAME combo `preview.json`'s own second case
    already captures (see that fixture's `input.cases[1]`) -- because it is
    the one real, already-known-deterministic combo that produces 3 fires
    spanning BOTH mapped categories (monotony, rest, monotony -- exercising
    hazard 4's fires/proposal zip across a non-trivial length AND a
    non-uniform category order) plus one auto-accepted rest whose recovery
    reaches STOPPED ticks (`recovery_from_min`/`to_min` both set in
    `preview.json`), which is exactly what stashes a `_post_rest_tick_state`
    and exercises `_project_after_rest`'s proposal-set path. `world` is the
    real committed `seed-night-highway-oshi` seed (the SAME seed
    `proposal_create_run.json`/`proposal_context.json` already use) -- an
    arbitrary-but-real typed World a reviewer could plausibly configure; its
    own situation/motion fields are irrelevant here (`build_world_from_tick`
    overwrites them every fire from the tick state, per Task 2).

    A second case reuses the IDENTICAL body with an unknown
    `service_package_id`, capturing the `proposal_error`-SET path on a REAL
    fire: `create_proposal_run`'s own `HTTPException` is caught INSIDE
    `_project_fire`/`_project_after_rest`, so the ENDPOINT itself still
    returns 200 with `fires[i].proposal = None` /
    `fires[i].proposal_error = "<text>"` on every fire, and
    `rest_options[0].after_rest_proposal_error` set the same way -- this is
    the one Python-reachable state `_readable_error_text`'s real call site
    needs a golden for (the "both None" unmapped-`result_type` state has NO
    real call site at all -- see Task 2's own `map_trigger_purpose`
    enumeration -- and is exercised in the TS test directly via a synthetic
    `PreviewFireEvent`, not a capture).

    `run_id`/`created_at`/`opportunity_id`/every event `at` inside every
    embedded `ProposalRunLog` (`fires[].proposal`,
    `rest_options[].after_rest_proposal`) are frozen post-hoc to fixed
    literals (unavoidably non-deterministic real ids/clock reads) --
    mirrors `_capture_proposal_create_run`'s own `_freeze_ids` technique,
    generalized (prefix-matched rather than compared against one known id)
    because THIS response embeds an UNBOUNDED number of independent
    `ProposalRunLog`s (one per fire, one per after-rest), not exactly one.
    """
    from fastapi.testclient import TestClient
    from aica_api.main import app
    from aica_api.config import settings

    c = TestClient(app)

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _base_body(**overrides) -> dict:
        body = {
            "package_id": "nri_fatigue_score_v1",
            "scenario_id": "uc01_fatigue_recovery_v0_1",
            "run_seed": 42,
            "hyperparameter_overrides": {},
            "rest_option_id": None,
            "world": _seed_world_dict(),
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
            "run_seed_proposal": "seed-quickview-test",
        }
        body.update(overrides)
        return body

    def _freeze_ids(obj):
        """Recursively freeze every run_id/created_at/opportunity_id/event
        `at` found anywhere in the response -- the ONLY non-deterministic
        values `project()` ever emits (the trigger side is fully
        deterministic given `run_seed`; every random id/clock read comes
        from a `create_proposal_run(..., cache={})` call inside it)."""
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k in ("created_at", "at"):
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif k == "run_id" and isinstance(v, str) and v.startswith("prun_"):
                    out[k] = "prun_TEST_FIXED"
                elif k == "opportunity_id" and isinstance(v, str) and v.startswith("op_"):
                    out[k] = "op_TEST_FIXED"
                else:
                    out[k] = _freeze_ids(v)
            return out
        if isinstance(obj, list):
            return [_freeze_ids(v) for v in obj]
        return obj

    def _run(name: str, body: dict) -> dict:
        r = c.post("/api/merged-runs/quickview", json=body)
        assert r.status_code == 200, f"quickview failed: {r.status_code} {r.text}"
        return {"name": name, "status_code": r.status_code, "result": _freeze_ids(r.json())}

    cases = []
    cases.append(_run("fires_and_after_rest_proposal_all_success", _base_body()))
    cases.append(_run(
        "fires_proposal_error_unknown_service_package_id",
        _base_body(service_package_id="not_a_real_package_id"),
    ))

    # Self-check: this fixture only earns its keep if it actually reaches
    # the branches its own docstring claims. Assert them here so a future
    # scenario/algorithm change that silently stops producing 3 fires (or
    # stops reaching a stopped recovery) fails LOUDLY at capture time,
    # rather than silently degrading the golden's own coverage.
    success = cases[0]["result"]
    assert len(success["fires"]) == 3, f"expected 3 fires, got {len(success['fires'])}"
    assert all(f["proposal"] is not None and f["proposal_error"] is None for f in success["fires"]), (
        "expected every fire's proposal to be set (both mapped categories) in the success case"
    )
    assert len(success["rest_options"]) == 1, "expected exactly one auto-accepted rest"
    assert success["rest_options"][0]["after_rest_proposal"] is not None, (
        "expected the auto-accepted rest to have reached a stopped tick and produced an after-rest proposal"
    )
    assert success["rest_options"][0]["after_rest_proposal_error"] is None

    error_case = cases[1]["result"]
    assert len(error_case["fires"]) == 3
    assert all(f["proposal"] is None and f["proposal_error"] for f in error_case["fires"]), (
        "expected every fire's proposal_error to be set (unknown service_package_id) in the error case"
    )
    assert error_case["rest_options"][0]["after_rest_proposal"] is None
    assert error_case["rest_options"][0]["after_rest_proposal_error"]

    _write("merged_quickview", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": {"cases": cases},
    })


# ---------------------------------------------------------------------------
# 55. merged_run_setup — routers/merged_runs.py's SETUP endpoint bodies
#     (_make_trigger_run_id / _make_merged_plan_id / _readable_error_text /
#     _build_quickview_route_facts, plus the plan/create/get/list endpoint
#     bodies at lines 216/681/712/756) — feature 026 (htmlapp Combined
#     export), slice C4 Task 5.
# ---------------------------------------------------------------------------


def _capture_merged_run_setup() -> None:
    """POST /api/merged-runs/plan, POST /api/merged-runs, GET /api/merged-runs/{id},
    GET /api/merged-runs -- direct function calls (mirrors
    `_capture_proposal_create_run`'s own technique) rather than TestClient:
    FastAPI's own request-body pydantic validation is orthogonal to what this
    task ports (the endpoint BODY's own business-logic HTTPExceptions), so
    calling create_merged_plan_endpoint / create_merged_run_endpoint /
    get_merged_run_endpoint / list_merged_runs_endpoint directly, after
    constructing their pydantic body models explicitly, captures the exact
    same status_code/detail an HTTP caller would see with less test-harness
    noise.

    `AICA_RUNS_DIR` / `AICA_MERGED_RUNS_DIR` / `AICA_PROPOSAL_RUNS_DIR` are
    monkeypatched to a shared tempdir for the whole capture (restored in a
    `finally`) so nothing is written under the real repo's runs/
    merged_runs/ proposal_runs/ directories -- required for "a second run
    leaves git status clean".

    The plan endpoint's "incompatible package/scenario" 400 has NO reachable
    real-data pair in this repo (every committed trigger package/scenario
    combination is type=uc01_fatigue on both sides) -- a temp packages_dir
    holding a single mutated copy of nri_fatigue_score_v1 with
    compatible_scenario_types=["some_other_uc_type"] is used instead
    (PackageManifest's own validator rejects an EMPTY list outright --
    "must not be empty" -- so [] fails at package LOAD, landing in the
    "not found or invalid" branch instead of "incompatible"; found by
    running the capture and inspecting its own output, not assumed).
    AICA_PACKAGES_DIR is monkeypatched for that ONE case only, mirroring
    this program's
    established "construct minimal synthetic input to reach an otherwise-
    unreachable branch" precedent (e.g. proposal_matrix.json's tampered
    copies).
    """
    import os
    import tempfile

    from fastapi import HTTPException

    from aica_api.config import settings
    from aica_api.models.merged_run import CreateMergedRunBody
    from aica_api.routers.merged_runs import (
        CreateMergedPlanBody,
        create_merged_plan_endpoint,
        create_merged_run_endpoint,
        get_merged_run_endpoint,
        list_merged_runs_endpoint,
    )
    from aica_api.routers.proposal import CreateProposalRunBody, create_proposal_run
    from aica_api.services.merged_run_coordinator import create_handle, save_handle
    from aica_api.services.run_manager import clear_registry as clear_trigger_registry
    from aica_api.services.run_plan import clear_draft_registry, get_draft_entry

    _PACKAGE_ID = "nri_fatigue_score_v1"
    _SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _REAL_ROUTE_PRESET_ID = "short_tokyo_chichibu"

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    with tempfile.TemporaryDirectory() as td:
        td_path = pathlib.Path(td)
        env_overrides = {
            "AICA_RUNS_DIR": str(td_path / "runs"),
            "AICA_MERGED_RUNS_DIR": str(td_path / "merged_runs"),
            "AICA_PROPOSAL_RUNS_DIR": str(td_path / "proposal_runs"),
        }
        prev_env = {k: os.environ.get(k) for k in env_overrides}
        os.environ.update(env_overrides)
        try:
            clear_draft_registry()
            clear_trigger_registry()

            # ================================================================
            # PLAN — POST /api/merged-runs/plan (create_merged_plan_endpoint)
            # ================================================================

            def _base_plan_kwargs(**overrides) -> dict:
                kwargs = dict(
                    package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID, route_preset_id=None,
                    run_seed=42, mountain_range_km=None, jam_range_km=None, jam_speed_kph=15.0,
                    presets={}, parameters={}, hyperparameters={},
                    profiles=None, initial_state=None, context_overrides=None,
                )
                kwargs.update(overrides)
                return kwargs

            def _run_plan(name: str, kwargs: dict, *, inspect_draft: bool = False) -> dict:
                entry: dict = {"name": name}
                body = CreateMergedPlanBody(**kwargs)
                try:
                    result = create_merged_plan_endpoint(body)
                    entry["raises"] = False
                    plan_id = result.get("plan_id")
                    entry["result_keys"] = sorted(result.keys())
                    entry["plan_id_is_str"] = isinstance(plan_id, str) and plan_id.startswith("plan_")
                    entry["_plan_id"] = plan_id  # kept out of assertions/output; used to chain into CREATE
                    if inspect_draft and isinstance(plan_id, str):
                        draft_entry = get_draft_entry(plan_id)
                        assert draft_entry is not None
                        draft, _pkg, _scn = draft_entry
                        entry["draft_route_source"] = draft.route_facts.route_source
                        entry["draft_total_km"] = draft.route_facts.total_route_distance_km
                        entry["draft_route_segments"] = [s.model_dump(mode="json") for s in draft.route_facts.route_segments]
                except HTTPException as exc:
                    entry["raises"] = True
                    entry["status_code"] = exc.status_code
                    entry["detail"] = exc.detail
                return entry

            plan_cases = []
            plan_cases.append(_run_plan("success_local_route", _base_plan_kwargs()))
            plan_cases.append(_run_plan("unknown_package_id", _base_plan_kwargs(package_id="not_a_real_package")))
            plan_cases.append(_run_plan("unknown_scenario_id", _base_plan_kwargs(scenario_id="not_a_real_scenario")))

            # -- incompatible package/scenario: no real pair exists, so build one --
            pkgs_td = td_path / "packages_incompatible"
            (pkgs_td / _PACKAGE_ID).mkdir(parents=True)
            pkg_raw = _load_json(_PACKAGES_DIR / _PACKAGE_ID / "package.json")
            pkg_raw = dict(pkg_raw, compatible_scenario_types=["some_other_uc_type"])
            (pkgs_td / _PACKAGE_ID / "package.json").write_text(json.dumps(pkg_raw), encoding="utf-8")
            prev_packages_dir = os.environ.get("AICA_PACKAGES_DIR")
            os.environ["AICA_PACKAGES_DIR"] = str(pkgs_td)
            try:
                plan_cases.append(_run_plan("incompatible_package_scenario", _base_plan_kwargs()))
            finally:
                if prev_packages_dir is None:
                    os.environ.pop("AICA_PACKAGES_DIR", None)
                else:
                    os.environ["AICA_PACKAGES_DIR"] = prev_packages_dir

            plan_cases.append(_run_plan(
                "route_preset_success", _base_plan_kwargs(route_preset_id=_REAL_ROUTE_PRESET_ID),
                inspect_draft=True,
            ))
            plan_cases.append(_run_plan("route_preset_not_found", _base_plan_kwargs(route_preset_id="not_a_real_preset")))
            plan_cases.append(_run_plan(
                "mountain_painted", _base_plan_kwargs(mountain_range_km=[10.0, 30.0]), inspect_draft=True,
            ))
            plan_cases.append(_run_plan("jam_painted", _base_plan_kwargs(jam_range_km=[40.0, 60.0])))

            plan_cases.append(_run_plan(
                "initial_state_unknown_key", _base_plan_kwargs(initial_state={"bogus_field": 50}),
            ))
            plan_cases.append(_run_plan(
                "initial_state_wrong_type_bool",
                _base_plan_kwargs(initial_state={"drowsiness_level": True}),
            ))
            plan_cases.append(_run_plan(
                "initial_state_wrong_type_string",
                _base_plan_kwargs(initial_state={"drowsiness_level": "50"}),
            ))
            plan_cases.append(_run_plan(
                "initial_state_out_of_range", _base_plan_kwargs(initial_state={"drowsiness_level": 150}),
            ))
            plan_cases.append(_run_plan(
                "initial_state_valid",
                _base_plan_kwargs(initial_state={"drowsiness_level": 50, "fatigue_level": 30}),
            ))

            plan_cases.append(_run_plan(
                "context_overrides_unknown_key", _base_plan_kwargs(context_overrides={"bogus_field": True}),
            ))
            plan_cases.append(_run_plan(
                "context_overrides_weather_risk_wrong_type_bool",
                _base_plan_kwargs(context_overrides={"weather_risk": True}),
            ))
            plan_cases.append(_run_plan(
                "context_overrides_weather_risk_out_of_range",
                _base_plan_kwargs(context_overrides={"weather_risk": 150}),
            ))
            plan_cases.append(_run_plan(
                "context_overrides_non_weather_wrong_type",
                _base_plan_kwargs(context_overrides={"is_night": "yes"}),
            ))
            plan_cases.append(_run_plan(
                "context_overrides_valid",
                _base_plan_kwargs(context_overrides={
                    "child_passenger": True, "familiar_route": False, "is_night": True, "weather_risk": 40,
                }),
            ))

            plan_cases.append(_run_plan(
                "hyperparameter_invalid",
                _base_plan_kwargs(hyperparameters={"not_a_real_hp": 1}),
            ))

            # Self-check: this fixture only earns its keep if it reaches every
            # branch its own case list claims.
            by_name = {c["name"]: c for c in plan_cases}
            assert by_name["success_local_route"]["raises"] is False
            for name in [
                "unknown_package_id", "unknown_scenario_id", "incompatible_package_scenario",
                "route_preset_not_found", "initial_state_unknown_key", "initial_state_wrong_type_bool",
                "initial_state_wrong_type_string", "initial_state_out_of_range",
                "context_overrides_unknown_key", "context_overrides_weather_risk_wrong_type_bool",
                "context_overrides_weather_risk_out_of_range", "context_overrides_non_weather_wrong_type",
                "hyperparameter_invalid",
            ]:
                assert by_name[name]["raises"] is True, f"expected {name!r} to raise"
            for name in ["route_preset_success", "mountain_painted", "jam_painted", "initial_state_valid", "context_overrides_valid"]:
                assert by_name[name]["raises"] is False, f"expected {name!r} to succeed"
            assert by_name["route_preset_success"]["draft_route_source"] == "maps"
            mountain_segments = by_name["mountain_painted"]["draft_route_segments"]
            assert any(s["segment_type"] == "mountain_road" for s in mountain_segments), (
                "expected mountain_painted's registered draft to contain a mountain_road segment"
            )

            # ================================================================
            # CREATE — POST /api/merged-runs (create_merged_run_endpoint)
            # ================================================================

            # Reuse the plan already registered by the "success_local_route" plan
            # case above (still live in run_plan.py's in-memory draft registry —
            # a plan_id is never invalidated after use).
            create_plan_id = by_name["success_local_route"]["_plan_id"]
            for c in plan_cases:
                c.pop("_plan_id", None)

            def _run_create(name: str, kwargs: dict) -> dict:
                entry: dict = {"name": name}
                body = CreateMergedRunBody(**kwargs)
                try:
                    result = create_merged_run_endpoint(body)
                    entry["raises"] = False
                    entry["result_keys"] = sorted(result.keys())
                    entry["merged_run_id_is_str"] = isinstance(result.get("merged_run_id"), str) and result["merged_run_id"].startswith("mrun_")
                    entry["trigger_run_id_is_str"] = isinstance(result.get("trigger_run_id"), str) and result["trigger_run_id"].startswith("run_")
                    entry["_merged_run_id"] = result["merged_run_id"]  # kept out of assertions; used to chain into GET
                except HTTPException as exc:
                    entry["raises"] = True
                    entry["status_code"] = exc.status_code
                    entry["detail"] = exc.detail
                return entry

            def _base_create_kwargs(**overrides) -> dict:
                kwargs = dict(
                    trigger_plan_id=create_plan_id, world=_seed_world_dict(),
                    service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                    proposal_mode="interactive", run_seed="seed-merged-create-test",
                    service_parameters={}, service_hyperparameters={},
                    content_parameters={}, content_hyperparameters={},
                )
                kwargs.update(overrides)
                return kwargs

            create_cases = []
            success_create = _run_create("success", _base_create_kwargs())
            create_cases.append(success_create)
            create_cases.append(_run_create("unknown_trigger_plan_id", _base_create_kwargs(trigger_plan_id="not_a_real_plan_id")))

            create_by_name = {c["name"]: c for c in create_cases}
            assert create_by_name["success"]["raises"] is False
            assert create_by_name["unknown_trigger_plan_id"]["raises"] is True
            assert create_by_name["unknown_trigger_plan_id"]["detail"] == "Unknown plan_id 'not_a_real_plan_id'"

            fresh_merged_run_id = success_create["_merged_run_id"]
            for c in create_cases:
                c.pop("_merged_run_id", None)

            # ================================================================
            # GET — GET /api/merged-runs/{merged_run_id} (get_merged_run_endpoint)
            # ================================================================

            def _run_get(name: str, merged_run_id: str) -> dict:
                # `merged_run_id`/embedded proposal `run_id`s are either
                # explicit deterministic literals (the two synthetic cases)
                # or minted by `_make_trigger_run_id`/`make_merged_run_id`/
                # `create_proposal_run` (timestamp + random hex) for the
                # "fresh" case -- NEVER captured as raw values (this rig's
                # own "a second run leaves git status clean" invariant), only
                # as a self-consistency boolean against the id the caller
                # already knows (the query param / `real_plog.run_id`,
                # captured by the caller's own assert below, not written to
                # the fixture either).
                entry: dict = {"name": name}
                try:
                    result = get_merged_run_endpoint(merged_run_id)
                    entry["raises"] = False
                    entry["has_handle"] = "handle" in result
                    entry["handle_merged_run_id_matches_query"] = result["handle"]["merged_run_id"] == merged_run_id
                    entry["trigger_log_is_none"] = result["trigger_log"] is None
                    entry["proposal_logs_count"] = len(result["proposal_logs"])
                except HTTPException as exc:
                    entry["raises"] = True
                    entry["status_code"] = exc.status_code
                    entry["detail"] = exc.detail
                return entry

            get_cases = []
            get_cases.append(_run_get("not_found", "not_a_real_merged_run_id"))
            get_cases.append(_run_get("success_fresh_no_proposals", fresh_merged_run_id))

            # -- synthetic: trigger_log missing (handle points nowhere) --
            synthetic_handle_1 = create_handle(
                merged_run_id="mrun_synthetic_missing_trigger", trigger_run_id="run_does_not_exist",
                world_template=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, proposal_mode="interactive",
                run_seed="seed-x", merged_dir=settings.merged_runs_dir,
            )
            save_handle(synthetic_handle_1, settings.merged_runs_dir)
            get_cases.append(_run_get("trigger_log_missing_synthetic", "mrun_synthetic_missing_trigger"))

            # -- synthetic: one real, persisted ProposalRunLog referenced --
            real_plog = create_proposal_run(CreateProposalRunBody(
                world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                run_seed="seed-merged-get-test", simulation_time="2026-08-02T09:00:00Z", mode="interactive",
            ))
            synthetic_handle_2 = create_handle(
                merged_run_id="mrun_synthetic_with_proposal", trigger_run_id="run_does_not_exist",
                world_template=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, proposal_mode="interactive",
                run_seed="seed-x", merged_dir=settings.merged_runs_dir,
            )
            synthetic_handle_2.proposal_run_ids = [real_plog.run_id]
            save_handle(synthetic_handle_2, settings.merged_runs_dir)
            get_cases.append(_run_get("with_one_real_proposal_log", "mrun_synthetic_with_proposal"))

            get_by_name = {c["name"]: c for c in get_cases}
            assert get_by_name["not_found"]["raises"] is True
            assert get_by_name["not_found"]["detail"] == "Merged run 'not_a_real_merged_run_id' not found"
            assert get_by_name["success_fresh_no_proposals"]["raises"] is False
            assert get_by_name["success_fresh_no_proposals"]["trigger_log_is_none"] is False
            assert get_by_name["success_fresh_no_proposals"]["proposal_logs_count"] == 0
            assert get_by_name["trigger_log_missing_synthetic"]["raises"] is False
            assert get_by_name["trigger_log_missing_synthetic"]["trigger_log_is_none"] is True
            assert get_by_name["with_one_real_proposal_log"]["proposal_logs_count"] == 1

            # ================================================================
            # LIST — GET /api/merged-runs (list_merged_runs_endpoint)
            # ================================================================

            list_empty_dir = td_path / "merged_runs_list_empty"
            prev_merged_dir = os.environ["AICA_MERGED_RUNS_DIR"]
            os.environ["AICA_MERGED_RUNS_DIR"] = str(list_empty_dir)
            list_empty_result = list_merged_runs_endpoint()
            os.environ["AICA_MERGED_RUNS_DIR"] = prev_merged_dir

            # Ordering + skip-corrupt: explicit, deliberately out-of-natural-order
            # merged_run_ids in a FRESH dir (isolated from the handles created
            # above, so this case's list is exactly the 3 handles below).
            list_dir = td_path / "merged_runs_list_ordering"
            list_dir.mkdir(parents=True)
            prev_merged_dir_2 = os.environ["AICA_MERGED_RUNS_DIR"]
            os.environ["AICA_MERGED_RUNS_DIR"] = str(list_dir)
            for mrid, trigger_id, n_proposals in [
                ("mrun_bbb", "run_bbb", 2), ("mrun_aaa", "run_aaa", 0), ("mrun_ccc", "run_ccc", 1),
            ]:
                h = create_handle(
                    merged_run_id=mrid, trigger_run_id=trigger_id, world_template=_seed_world_dict(),
                    service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                    proposal_mode="interactive", run_seed="seed-x", merged_dir=list_dir,
                )
                h.proposal_run_ids = [f"prun_{i}" for i in range(n_proposals)]
                save_handle(h, list_dir)
            # A genuinely corrupt file — mirrors Python's own json.loads-failure
            # skip case (never reachable through save_handle, only by direct
            # filesystem tampering, exactly like a hand-edited runs/ file).
            (list_dir / "zzz_corrupt.json").write_text("{not valid json", encoding="utf-8")
            list_ordering_result = list_merged_runs_endpoint()
            os.environ["AICA_MERGED_RUNS_DIR"] = prev_merged_dir_2

            assert list_empty_result == {"merged_runs": []}
            ordering_ids = [item["merged_run_id"] for item in list_ordering_result["merged_runs"]]
            assert ordering_ids == ["mrun_aaa", "mrun_bbb", "mrun_ccc"], (
                f"expected lexicographic order regardless of insertion order, got {ordering_ids}"
            )
            counts = {item["merged_run_id"]: item["proposal_run_ids_count"] for item in list_ordering_result["merged_runs"]}
            assert counts == {"mrun_aaa": 0, "mrun_bbb": 2, "mrun_ccc": 1}
            assert len(list_ordering_result["merged_runs"]) == 3, "the corrupt file must be skipped, not raise/appear"

        finally:
            for k, v in prev_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    _write("merged_run_setup", {
        "input": {
            "package_id": _PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
            "route_preset_id": _REAL_ROUTE_PRESET_ID,
        },
        "output": {
            "plan_cases": plan_cases,
            "create_cases": create_cases,
            "get_cases": get_cases,
            "list_empty": list_empty_result,
            "list_ordering": list_ordering_result,
        },
    })


# ---------------------------------------------------------------------------
# 56. merged_tick -- routers/merged_runs.py's tick_merged_run_endpoint
#     (934-1203), _serialize_trigger_tick (183-210), and
#     _override_nap_stage_ticks (784-821) -- feature 026 (htmlapp Combined
#     export), slice C4 Task 6.
# ---------------------------------------------------------------------------

def _capture_merged_tick() -> None:
    """`tick_merged_run_endpoint` (routers/merged_runs.py:934-1203) +
    `_serialize_trigger_tick` (183-210) + `_override_nap_stage_ticks`
    (784-821) -- feature 026 (htmlapp Combined export), slice C4 Task 6.

    Four sections:

    1. `_serialize_trigger_tick` -- isolated, hand-built `TickOutcome`
       (a plain `@dataclass`, no pydantic validation, so any value is legal
       for the unused `run_state` field) cases exercising its own
       tick_state=None / empty-signals / dynamic-present-but-empty /
       fully-populated branches directly, independent of a real tick loop.
       Fully deterministic (no ids) -- byte-exact target.

    2. `_override_nap_stage_ticks` -- isolated, direct calls against the
       REAL `uc01_fatigue_recovery_v0_1` scenario (recovery_options:
       nap_karaoke has a nap+STOPPED stage; convenience_stretch has a
       STOPPED stage but NOT phase=="nap"; postpone has no stages at all).
       Covers: a normal nap_minutes, two fractional (non-tie) roundings, a
       negative nap_minutes (Pydantic's own `AcceptRestBody.nap_minutes`
       carries no positivity constraint -- verified directly), an unknown
       recovery_option_id (no matching option), a matching option WITHOUT a
       nap+STOPPED stage, and a matching option with NO stages at all.
       Also asserts (self-check, not merely captured) that the INPUT
       scenario's own nested recovery_options/stages are byte-unchanged
       after every call -- the never-mutates-shared-state invariant the
       Python docstring itself warns is safety-critical (a shared
       plan-registry ScenarioDef).

    3. The full tick sequence -- THE headline capture. `nri_fatigue_score_v1`
       x `uc01_fatigue_recovery_v0_1` (route_preset_id=None, local route,
       trigger run_seed=42) x `seed-night-highway-oshi` x the REAL
       `aica_transparent_service_selector_v1`/`aica_transparent_content_
       selector_v1` packages (NOT `mock_service_selector_v1`/
       `mock_content_selector_v1` -- deliberately, even though the sibling
       Python integration tests `test_merged_rest_journey.py`/
       `test_merged_monotony_journey.py` use those mocks for pytest speed:
       the mocks have NO `evaluate()` port on the TS side at all --
       `tests/proposal_selector_port.test.ts` documents this explicitly
       ("unported mock_* package id ... missing_evaluate") -- so driving
       THIS capture's cross-language sequence through the mocks would
       exercise a documented-unported code path on the TS side instead of
       the real one. The REAL transparent selectors are fully ported and
       C4a-proven (10,323 leaf fields, 0 mismatches) and the shared
       `proposal_matrix.json` has rows for every lifecycle stage this
       sequence reaches (`rest_recommended`/before_rest_until_stop,
       during_rest_stopped, after_rest_before_restart;
       `inattentive_driving_prevention_recovery`/active_driving_content --
       verified directly via `get_matrix()`, not assumed), so this is a
       like-for-like substitution, not a weakened test.

       Empirically verified (this exact seed/seed/run_seed combination,
       run to completion) to naturally exercise -- with NO synthetic
       tampering -- every branch this task's brief names as required
       (ticks 0-11 no-fire; tick 12 CREATE #1 monotony; ticks 13-16 fired-
       repeat/no new proposal; tick 17 CREATE #2 category-escalation to
       rest; ticks 18-19 before/not-yet-stopped passthrough; tick 20 UPDATE
       #1 before->during; ticks 21-25 during-recovery-active passthrough;
       tick 26 UPDATE #2 during->after, paused; ticks 27-36 no-fire; tick 37
       CREATE #3 re-arm; tick 41 run completion) PLUS the accept-rest
       nap-stage-override path

       CORRECTED against the committed fixture: an earlier draft of this
       docstring described a 4-generation sequence ending at tick 43, with
       recovery spanning 21-27 and UPDATE #2 at tick 28. The capture that
       actually shipped produces THREE proposal runs (prun_GEN_0/1/2), with
       correlations at ticks 12/17/20/26/37 and completion at tick 41 --
       verified by reading merged_tick.json directly. The prose was left
       over from an earlier run of a different seed and never reconciled.
       This section deliberately uses `nap_minutes=None` (accept-rest's
       default nap duration, no override) rather than Section 2's own
       already-exhaustively-tested override value -- `_override_nap_stage_
       ticks`/`accept_rest_endpoint`'s nap-duration wiring belongs to Task 7
       (`accept_rest_endpoint` is out of THIS task's endpoint range), so this
       section reproduces only what `run_manager.action("accept_rest", ...)`
       itself needs -- already fully ported and used elsewhere in this port.

       Every tick's FULL `_serialize_trigger_tick` output is captured
       (fully deterministic, no ids -- byte-exact target for every single
       tick, not just the interesting ones). Every tick where a proposal
       run is created/updated ALSO captures a REDACTED proposal summary
       (status/journey_state/opportunity/matrix_version/package
       ids/world.situation+control_inputs/event_type list/mode) and, where
       a correlation is emitted, a REDACTED correlation summary
       (trigger_tick_index/event-type list parsed off proposal_event_ids/a
       boolean proving `correlation.proposal_run_id ==
       THIS-tick's-proposal.run_id`).

       Ids are never captured raw (this rig's own "a second run leaves git
       status clean" invariant) -- but rather than STRIPPING them (losing
       the ability to tell "same run" from "different run" apart), every
       `run_id`/`proposal_run_id` value is frozen to a DETERMINISTIC
       placeholder keyed by FIRST-ENCOUNTER ORDER across the whole 44-tick
       sequence (`prun_GEN_0`, `prun_GEN_1`, ...) -- the SAME `_freeze_ids`-
       family technique `_capture_merged_quickview` already established,
       generalized to preserve EQUALITY relationships (two ids that are
       the SAME real value freeze to the SAME placeholder; two DIFFERENT
       real ids freeze to DIFFERENT placeholders) rather than collapsing
       everything to one fixed literal. This is what lets the TS test
       assert, byte-exact against this golden, "tick 20's correlation
       targets prun_GEN_1 (the SAME run tick 17 created), not prun_GEN_0"
       -- the headline correlation-correctness claim -- without either
       side's real (language-divergent) id format ever entering the
       comparison.

    4. `proposal_mode` hard-422 -- a SECOND merged run created with
       `proposal_mode="not_a_real_mode"` (reachable through the PUBLIC
       `POST /api/merged-runs` body -- `CreateMergedRunBody.proposal_mode`
       is an unconstrained `str` on both the router body AND
       `MergedRunHandle` -- verified directly, not assumed), ticked until
       its first fire. Captures that the resulting exception is a genuine
       HARD failure (propagates OUT of `tick_merged_run_endpoint` itself,
       unlike `create_proposal_run`'s own caught-and-downgraded failures)
       with `status_code == 422` and a `detail` mentioning both `mode` and
       the two valid literal values -- NOT a byte-exact reproduction of
       pydantic's full `.errors()` array (type/loc/ctx/a pydantic-version-
       tied `url`) -- see `tick.ts`'s own "Mode validation" doc section for
       why a semantic (not structural) check is the right target here,
       mirroring this same file's OWN established precedent for a caught
       `ValidationError` (`ProposalOpportunity` construction,
       `proposal_create_run.json`'s own capture).
    """
    import os
    import tempfile
    import warnings

    warnings.filterwarnings("ignore", category=UserWarning)

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.decision import Candidate, DecisionResult, FireControl, Proposal
    from aica_api.models.merged_run import AcceptRestBody, CreateMergedRunBody
    from aica_api.models.run import TickState
    from aica_api.routers.merged_runs import (
        CreateMergedPlanBody,
        _override_nap_stage_ticks,
        _serialize_trigger_tick,
        accept_rest_endpoint,
        create_merged_plan_endpoint,
        create_merged_run_endpoint,
        tick_merged_run_endpoint,
    )
    from aica_api.routers.runs import rest_spots_endpoint
    from aica_api.services.merged_run_coordinator import get_handle
    from aica_api.services.run_manager import TickOutcome
    from aica_api.services.run_manager import clear_registry as clear_trigger_registry
    from aica_api.services.run_plan import clear_draft_registry
    from aica_api.services.scenario_registry import ScenarioRegistry

    _PACKAGE_ID = "nri_fatigue_score_v1"
    _SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RECOVERY_OPTION_ID = "nap_karaoke"
    _TRIGGER_RUN_SEED = 42
    _PROPOSAL_RUN_SEED = "7"
    _NAP_MINUTES = None  # accept-rest is Task 7's own endpoint; the tick
    # sequence only needs run_manager.action("accept_rest", ...) to start
    # recovery -- nap_minutes=None skips the _override_nap_stage_ticks call
    # entirely (already exhaustively covered in isolation by Section 2 above),
    # so this section does not need a ported replace_scenario/accept_rest_endpoint
    # to reproduce byte-exact tick timing against a TS-side test.
    _MAX_TICKS = 60

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    # ================================================================
    # Section 1 -- _serialize_trigger_tick, isolated synthetic TickOutcome
    # ================================================================

    def _mk_tick_state(signals: dict) -> TickState:
        return TickState(
            tick_index=5, elapsed_seconds=300, route_fraction=0.3, active_segment_id="seg1",
            drowsiness_level="moderate", fatigue_level="low", signal_duration="short",
            continuous_driving_time="30", rest_spot_eta="10", completed=False,
            distance_km=12.5, signals=signals,
        )

    def _mk_decision(*, fired: bool = True, result_type: str = "REST_PROPOSAL", proposal_set: bool = True) -> DecisionResult:
        return DecisionResult(
            result_type=result_type, trigger_candidate=True, selected_category="rest_required",
            score=0.9, features={}, criteria={},
            candidates=[Candidate(category="rest_required", exists=True, score=0.9, state=None, strength=None,
                                   fire_control=FireControl(fired=fired, suppressed=False, override=False, reason=None))],
            fire_control=FireControl(fired=fired, suppressed=False, override=False, reason=None),
            proposal=Proposal(id="p1", message={"ja": "x", "en": "x"}, options=["accept_rest"]) if proposal_set else None,
            reason_inputs=[], explanation="x",
        )

    def _redact_serialize_result(r: dict) -> dict:
        out = dict(r)
        if out.get("decision") is not None:
            out["decision"] = out["decision"].model_dump(mode="json")
        if out.get("error") is not None:
            out["error"] = out["error"].model_dump(mode="json")
        return out

    serialize_cases = []
    def _run_serialize(name: str, outcome) -> None:
        serialize_cases.append({"name": name, "result": _redact_serialize_result(_serialize_trigger_tick(outcome))})

    _run_serialize("completed_noop_no_tick_state", TickOutcome(
        run_state=None, decision=None, algorithm_error=None,
        paused=False, completed=True, evaluated_tick_index=None, tick_state=None,
    ))
    _run_serialize("empty_signals_dict", TickOutcome(
        run_state=None, decision=_mk_decision(fired=False, result_type="NO_PROPOSAL", proposal_set=False),
        algorithm_error=None, paused=False, completed=False,
        evaluated_tick_index=5, tick_state=_mk_tick_state({}),
    ))
    _run_serialize("dynamic_present_but_empty", TickOutcome(
        run_state=None, decision=None, algorithm_error=None,
        paused=False, completed=False, evaluated_tick_index=6, tick_state=_mk_tick_state({"dynamic": {}}),
    ))
    _run_serialize("full_dynamic_populated", TickOutcome(
        run_state=None, decision=_mk_decision(), algorithm_error=None,
        paused=True, completed=False, evaluated_tick_index=7,
        tick_state=_mk_tick_state({"dynamic": {
            "speedKph": 80.5, "motionState": "STOPPED", "recoveryPhase": "nap",
            "isTrafficJam": True, "segmentType": "highway",
        }}),
    ))

    serialize_by_name = {c["name"]: c for c in serialize_cases}
    assert serialize_by_name["completed_noop_no_tick_state"]["result"]["route_fraction"] is None
    assert serialize_by_name["completed_noop_no_tick_state"]["result"]["distance_km"] is None
    assert serialize_by_name["empty_signals_dict"]["result"]["speed_kph"] is None
    assert serialize_by_name["dynamic_present_but_empty"]["result"]["motion_state"] is None
    assert serialize_by_name["full_dynamic_populated"]["result"]["speed_kph"] == 80.5
    assert serialize_by_name["full_dynamic_populated"]["result"]["motion_state"] == "STOPPED"
    assert serialize_by_name["full_dynamic_populated"]["result"]["recovery_phase"] == "nap"
    assert serialize_by_name["full_dynamic_populated"]["result"]["is_traffic_jam"] is True
    assert serialize_by_name["full_dynamic_populated"]["result"]["segment_type"] == "highway"

    # ================================================================
    # Section 2 -- _override_nap_stage_ticks, isolated real-scenario calls
    # ================================================================

    scenario_reg = ScenarioRegistry(settings.scenarios_dir)
    base_scenario = scenario_reg.get(_SCENARIO_ID)
    assert base_scenario is not None

    def _stage_view(stages) -> list:
        # Excludes `grants_moving_recovery` (a Pydantic-materialized default
        # absent from the raw scenario JSON on BOTH source trees -- see
        # tick.ts's own doc comment) so this fixture's shape matches what a
        # raw-JSON-reading TS port can actually produce.
        return [{"phase": s.phase, "content": s.content, "motion": s.motion, "ticks": s.ticks} for s in stages]

    def _option_view(scenario, option_id):
        opt = next((o for o in scenario.recovery_options if o.id == option_id), None)
        if opt is None:
            return None
        return {"id": opt.id, "stages": _stage_view(opt.stages)}

    _ORIGINAL_NAP_KARAOKE_STAGES = _stage_view(next(o for o in base_scenario.recovery_options if o.id == "nap_karaoke").stages)

    nap_cases = []
    for name, opt_id, minutes in [
        ("normal_15min", _RECOVERY_OPTION_ID, 15),
        ("fractional_10min", _RECOVERY_OPTION_ID, 10),
        ("fractional_8min", _RECOVERY_OPTION_ID, 8),
        ("zero_minutes", _RECOVERY_OPTION_ID, 0),
        ("negative_minutes", _RECOVERY_OPTION_ID, -8),
        ("unknown_recovery_option_id", "not_a_real_option", 15),
        ("option_without_nap_stage", "convenience_stretch", 15),
        ("option_with_no_stages_at_all", "postpone", 15),
    ]:
        result_scenario = _override_nap_stage_ticks(base_scenario, opt_id, minutes)
        # Self-check: the INPUT scenario must be byte-unchanged after every
        # call -- the never-mutates-shared-state invariant.
        current_nap_karaoke_stages = _stage_view(next(o for o in base_scenario.recovery_options if o.id == "nap_karaoke").stages)
        assert current_nap_karaoke_stages == _ORIGINAL_NAP_KARAOKE_STAGES, (
            f"case {name!r} mutated the shared input scenario's nap_karaoke stages in place"
        )
        nap_cases.append({
            "name": name,
            "recovery_option_id": opt_id,
            "nap_minutes": minutes,
            "matched_option": _option_view(result_scenario, opt_id),
            "recovery_options_count": len(result_scenario.recovery_options),
        })

    nap_by_name = {c["name"]: c for c in nap_cases}
    assert nap_by_name["normal_15min"]["matched_option"]["stages"][1]["ticks"] == 5, "round(15*60/180) == 5"
    assert nap_by_name["fractional_10min"]["matched_option"]["stages"][1]["ticks"] == 3, "round(10*60/180) == round(3.333) == 3"
    assert nap_by_name["fractional_8min"]["matched_option"]["stages"][1]["ticks"] == 3, "round(8*60/180) == round(2.667) == 3"
    assert nap_by_name["zero_minutes"]["matched_option"]["stages"][1]["ticks"] == 0
    assert nap_by_name["negative_minutes"]["matched_option"]["stages"][1]["ticks"] == -3, "round(-8*60/180) == round(-2.667) == -3"
    assert nap_by_name["unknown_recovery_option_id"]["matched_option"] is None
    assert nap_by_name["unknown_recovery_option_id"]["recovery_options_count"] == 3, "scenario itself still has all 3 options"
    # convenience_stretch has a STOPPED stage but phase != "nap" -- unchanged.
    assert nap_by_name["option_without_nap_stage"]["matched_option"]["stages"] == [
        {"phase": "wakefulness", "content": "stretch", "motion": "MOVING", "ticks": None},
        {"phase": "content", "content": "stretch", "motion": "STOPPED", "ticks": 2},
    ]
    assert nap_by_name["option_with_no_stages_at_all"]["matched_option"]["stages"] == []

    # ================================================================
    # Section 3 -- the full tick sequence (THE headline capture)
    # ================================================================

    with tempfile.TemporaryDirectory() as td:
        td_path = pathlib.Path(td)
        env_overrides = {
            "AICA_RUNS_DIR": str(td_path / "runs"),
            "AICA_MERGED_RUNS_DIR": str(td_path / "merged_runs"),
            "AICA_PROPOSAL_RUNS_DIR": str(td_path / "proposal_runs"),
        }
        prev_env = {k: os.environ.get(k) for k in env_overrides}
        os.environ.update(env_overrides)
        try:
            clear_draft_registry()
            clear_trigger_registry()

            id_map: dict = {}

            def freeze_id(raw: str | None):
                if raw is None:
                    return None
                if raw not in id_map:
                    id_map[raw] = f"prun_GEN_{len(id_map)}"
                return id_map[raw]

            def redact_trigger(t: dict) -> dict:
                out = dict(t)
                if out.get("decision") is not None:
                    out["decision"] = out["decision"].model_dump(mode="json")
                if out.get("error") is not None:
                    out["error"] = out["error"].model_dump(mode="json")
                return out

            def redact_proposal(p: dict) -> dict:
                world = p.get("world") or {}
                control_inputs = (world.get("control_inputs") or {}) if world else {}
                return {
                    "run_id_frozen": freeze_id(p["run_id"]),
                    "status": p["status"],
                    "mode": p["mode"],
                    "journey_state": {
                        "lifecycle_stage": p["journey_state"]["lifecycle_stage"],
                        "playback_state": p["journey_state"]["playback_state"],
                        "motion_state": p["journey_state"]["motion_state"],
                        "active_service_id": p["journey_state"]["active_service_id"],
                    },
                    "opportunity": {
                        "trigger_purpose": p["opportunity"]["trigger_purpose"],
                        "lifecycle_stage": p["opportunity"]["lifecycle_stage"],
                        "allowed_service_ids": p["opportunity"]["allowed_service_ids"],
                    },
                    "matrix_version": p["matrix_version"],
                    "service_package_id": p["service_package_id"],
                    "content_package_id": p["content_package_id"],
                    "world_situation": world.get("situation"),
                    "world_control_inputs_subset": {
                        k: control_inputs.get(k) for k in ("trigger_purpose", "lifecycle_stage", "motion_state")
                    },
                    "event_types": [e["event_type"] for e in p["events"]],
                }

            def redact_correlation(c: dict, response_proposal_run_id) -> dict:
                event_types = [eid.rsplit("@", 1)[0] for eid in c["proposal_event_ids"]]
                return {
                    "trigger_tick_index": c["trigger_tick_index"],
                    "proposal_run_id_frozen": freeze_id(c["proposal_run_id"]),
                    "proposal_event_types": event_types,
                    "targets_this_ticks_own_proposal": c["proposal_run_id"] == response_proposal_run_id,
                }

            seed_world = _seed_world_dict()

            plan = create_merged_plan_endpoint(CreateMergedPlanBody(
                package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID, route_preset_id=None,
                run_seed=_TRIGGER_RUN_SEED, mountain_range_km=None, jam_range_km=None,
                jam_speed_kph=15.0, presets={}, parameters={}, hyperparameters={},
                profiles=None, initial_state=None, context_overrides=None,
            ))
            run = create_merged_run_endpoint(CreateMergedRunBody(
                trigger_plan_id=plan["plan_id"], world=seed_world,
                service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                proposal_mode="interactive", run_seed=_PROPOSAL_RUN_SEED,
                service_parameters={}, service_hyperparameters={},
                content_parameters={}, content_hyperparameters={},
            ))
            mid = run["merged_run_id"]
            tid = run["trigger_run_id"]

            ticks = []
            accept_rest_issued = False
            first_rest_tick_index = None
            for i in range(_MAX_TICKS):
                resp = tick_merged_run_endpoint(mid)
                entry = {
                    "i": i,
                    "trigger": redact_trigger(resp.trigger),
                    "has_proposal": resp.proposal is not None,
                    "has_correlation": resp.correlation is not None,
                }
                if resp.proposal is not None:
                    entry["proposal"] = redact_proposal(resp.proposal)
                if resp.correlation is not None:
                    entry["correlation"] = redact_correlation(
                        resp.correlation.model_dump(mode="json"),
                        resp.proposal["run_id"] if resp.proposal else None,
                    )
                ticks.append(entry)

                d = resp.trigger.get("decision")
                if (
                    not accept_rest_issued
                    and d is not None
                    and d.result_type == "REST_PROPOSAL"
                    and resp.proposal is not None
                ):
                    first_rest_tick_index = i
                    spots = rest_spots_endpoint(tid)
                    first_spot = spots["rest_spots"][0]
                    accept_resp = accept_rest_endpoint(mid, AcceptRestBody(
                        recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=first_spot, nap_minutes=_NAP_MINUTES,
                    ))
                    assert accept_resp.get("status") == "playing", accept_resp
                    accept_rest_issued = True

                if resp.trigger.get("completed"):
                    break

            assert first_rest_tick_index is not None, "expected a REST_PROPOSAL fire within budget"
            assert accept_rest_issued

            # Self-check: this fixture only earns its keep if it reaches
            # every branch the module doc (and the task brief) claims. A
            # CREATE tick is one whose proposal generation was never seen
            # before this tick; an UPDATE tick reuses an EXISTING
            # generation (NOT distinguished by the first event type, since
            # `proposal_event_ids`/`event_types` are CUMULATIVE from run
            # start -- every tick for a given run, update or not, starts
            # with OPPORTUNITY_OPENED).
            seen_generations: set = set()
            create_ticks = []
            update_ticks = []
            for e in ticks:
                if not e["has_proposal"]:
                    continue
                gen = e["proposal"]["run_id_frozen"]
                is_new = gen not in seen_generations
                seen_generations.add(gen)
                if e["has_correlation"]:
                    (create_ticks if is_new else update_ticks).append(e)
            # >= 3, not >= 4: nap_minutes=None uses nap_karaoke's SCENARIO-
            # DEFAULT 3-tick nap (not the 5-tick override Section 2 tests in
            # isolation) so the route completes (tick ~41) before a FOURTH
            # generation (a second rest-escalation) has room to fire. The
            # three generations reached still exercise all THREE of Branch
            # A's own OR-conditions at least once: tick 12
            # (current_proposal_run_id is None), tick 17 (category differs:
            # monotony -> rest, while rest_stage_synced is still null), tick
            # 37 (BOTH rest_stage_synced=='after' AND category differs
            # simultaneously: monotony re-fires after the completed rest
            # journey) -- verified by inspecting each generation's own fire
            # context directly, not assumed from the count alone.
            assert len(seen_generations) >= 3, (
                f"expected >= 3 distinct proposal-run generations (create/"
                f"create-escalation/create-rearm), got {seen_generations}"
            )
            no_fire_ticks = [e for e in ticks if not e["has_proposal"] and not e["has_correlation"]]
            assert len(no_fire_ticks) >= 5, "expected several plain no-op ticks"
            assert len(create_ticks) >= 3, f"expected >= 3 CREATE ticks, got {len(create_ticks)}"
            assert len(update_ticks) >= 2, (
                f"expected at least the before->during and during->after UPDATE ticks, got {len(update_ticks)}"
            )
            during_recovery_silent_ticks = [
                e for e in ticks
                if not e["has_proposal"] and e["trigger"]["motion_state"] == "STOPPED"
            ]
            assert len(during_recovery_silent_ticks) >= 1, "expected at least one silent mid-recovery tick"
            after_rest_tick = next((e for e in ticks if e["has_proposal"]
                                     and e["proposal"]["journey_state"]["lifecycle_stage"] == "after_rest_before_restart"), None)
            assert after_rest_tick is not None
            assert after_rest_tick["trigger"]["paused"] is True, "the after-rest tick must be paused"
            assert all(e["correlation"]["targets_this_ticks_own_proposal"] for e in ticks if e["has_correlation"]), (
                "every emitted correlation must target THIS tick's own returned proposal"
            )
            assert all(e["trigger"].get("proposal_error") is None for e in ticks), (
                "expected zero proposal_error in the nominal real-package sequence"
            )

        finally:
            for k, v in prev_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    # ================================================================
    # Section 4 -- proposal_mode hard-422 (Branch A2)
    # ================================================================

    with tempfile.TemporaryDirectory() as td2:
        td2_path = pathlib.Path(td2)
        env_overrides2 = {
            "AICA_RUNS_DIR": str(td2_path / "runs"),
            "AICA_MERGED_RUNS_DIR": str(td2_path / "merged_runs"),
            "AICA_PROPOSAL_RUNS_DIR": str(td2_path / "proposal_runs"),
        }
        prev_env2 = {k: os.environ.get(k) for k in env_overrides2}
        os.environ.update(env_overrides2)
        try:
            clear_draft_registry()
            clear_trigger_registry()

            plan2 = create_merged_plan_endpoint(CreateMergedPlanBody(
                package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID, route_preset_id=None,
                run_seed=_TRIGGER_RUN_SEED, mountain_range_km=None, jam_range_km=None,
                jam_speed_kph=15.0, presets={}, parameters={}, hyperparameters={},
                profiles=None, initial_state=None, context_overrides=None,
            ))
            run2 = create_merged_run_endpoint(CreateMergedRunBody(
                trigger_plan_id=plan2["plan_id"], world=_seed_world_dict(),
                service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
                proposal_mode="not_a_real_mode", run_seed=_PROPOSAL_RUN_SEED,
                service_parameters={}, service_hyperparameters={},
                content_parameters={}, content_hyperparameters={},
            ))
            mid2 = run2["merged_run_id"]

            invalid_mode_status_code = None
            invalid_mode_detail = None
            invalid_mode_raised = False
            for i in range(_MAX_TICKS):
                try:
                    resp2 = tick_merged_run_endpoint(mid2)
                except HTTPException as exc:
                    invalid_mode_raised = True
                    invalid_mode_status_code = exc.status_code
                    invalid_mode_detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail, default=str)
                    break
                if resp2.trigger.get("completed"):
                    break

            assert invalid_mode_raised, "expected an uncaught HTTPException from the invalid proposal_mode branch"
            assert invalid_mode_status_code == 422
            assert "mode" in invalid_mode_detail
            assert "interactive" in invalid_mode_detail and "quick_check" in invalid_mode_detail

        finally:
            for k, v in prev_env2.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    _write("merged_tick", {
        "input": {
            "package_id": _PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "trigger_run_seed": _TRIGGER_RUN_SEED,
            "proposal_run_seed": _PROPOSAL_RUN_SEED,
            "nap_minutes": _NAP_MINUTES,
        },
        "output": {
            "serialize_cases": serialize_cases,
            "nap_override_cases": nap_cases,
            "tick_sequence": ticks,
            "first_rest_tick_index": first_rest_tick_index,
            "invalid_mode_case": {
                "status_code": invalid_mode_status_code,
                "detail": invalid_mode_detail,
            },
        },
    })


# ---------------------------------------------------------------------------
# 57. merged_actions -- routers/merged_runs.py's accept_rest_endpoint
#     (824-892), decline_rest_endpoint (892-934), and
#     proposal_action_endpoint (1206-1327) -- feature 026 (htmlapp Combined
#     export), slice C4 Task 7.
# ---------------------------------------------------------------------------

def _capture_merged_actions() -> None:
    """`accept_rest_endpoint` (824-892), `decline_rest_endpoint` (892-934),
    `proposal_action_endpoint` (1206-1327) -- feature 026, slice C4 Task 7.
    Ports `src/engine/merged/actions.ts`.

    Direct function calls (mirrors `_capture_merged_run_setup`/
    `_capture_merged_tick`'s own technique), `AICA_RUNS_DIR`/
    `AICA_MERGED_RUNS_DIR`/`AICA_PROPOSAL_RUNS_DIR` monkeypatched to a shared
    tempdir for the whole capture. Real merged runs use the SAME package/
    scenario/seed combination `_capture_merged_tick` established
    (`nri_fatigue_score_v1` x `uc01_fatigue_recovery_v0_1`,
    `seed-night-highway-oshi`, the REAL `aica_transparent_service_selector_v1`/
    `aica_transparent_content_selector_v1` packages, trigger run_seed=42,
    proposal run_seed="7") -- already empirically pinned: tick 12 fires
    MONOTONY_PROPOSAL, tick 17 fires REST_PROPOSAL (verified directly against
    a live interpreter before writing this capture, not assumed carried over).

    Three sections, one per endpoint:

    Section A -- `accept_rest_endpoint`:
      - `not_paused`: a FRESH (un-ticked) run -> 422 ActionNotAllowedError
        (`run_manager.action`'s own "No pending proposal" message -- already
        ported/tested elsewhere; captured for a SEMANTIC, not byte-exact,
        assertion, since that message embeds Python's `RunStatus!r}` Enum
        repr, `<RunStatus.created: 'created'>`, which this port's own
        `action()` does not byte-reproduce -- a pre-existing, out-of-scope
        divergence, not introduced by this task).
      - `unknown_recovery_option`: a run paused on ANY fire (MONOTONY, tick
        12 -- `accept_rest` is unconditionally in `uc01`'s
        `scenario.allowed_actions`, so this doesn't need the REST-specific
        tick 17) with a bogus `recovery_option_id` -> 422.
      - `merged_run_not_found` / `trigger_run_not_found` (the latter via
        `clear_registry()` AFTER `create_merged_run_endpoint` -- the handle
        persists but the trigger run's in-memory registry entry is gone,
        reaching `accept_rest_endpoint`'s OWN `scenario is None` 404, a
        DIFFERENT code path than `run_manager.action`'s own
        `RunNotFoundError` catch -- see `actions.ts`'s own doc for why the
        latter is structurally unreachable in both languages).
      - `success_no_nap_override` (tick 17 REST fire, `nap_minutes=None`):
        captures the redacted `RunState` (status/current_tick/
        pending_proposal/recovery) AND the handle
        (`rest_stage_synced`/`nap_minutes`) after the call.
      - `success_with_nap_override` (a SEPARATE fresh run, same tick-17
        fire, `nap_minutes=15`): SAME captures, PLUS the installed
        scenario's own `nap_karaoke` STOPPED+nap stage `ticks` value read
        directly via `run_manager.get_scenario(trigger_run_id)` right after
        the call -- proves the override actually reached the trigger run's
        OWN registry entry (`replace_scenario`), not merely that
        `handle.nap_minutes` was recorded. `round(15*60/180) == 5` (vs. the
        scenario-authored default of 3, unchanged in the `None` case above)
        -- matches `merged_tick.json`'s own already-captured
        `nap_override_cases.normal_15min`.

    Section B -- `decline_rest_endpoint`:
      - `not_paused`, `merged_run_not_found`, `trigger_run_not_found`
        (SAME three shapes as Section A, `decline` has no `get_scenario`
        pre-check of its own so `trigger_run_not_found` reaches it via
        `run_manager.action`'s OWN `RunNotFoundError` -- a genuinely
        DIFFERENT code path than accept-rest's, exercised deliberately).
      - `success` (tick 17 REST fire, decline): redacted `RunState`
        (status='playing', recovery=None) + handle
        (`current_proposal_run_id`/`current_proposal_category` both
        reset to null -- the re-arm-the-fire-guard behavior).

    Section C -- `proposal_action_endpoint`:
      - `merged_run_not_found`, `no_active_proposal_run` (a FRESH run,
        before any fire).
      - `select_service_required_missing`, `select_service_invalid_enum`
        (real `SelectServiceBody` `ValidationError.errors()`, captured RAW
        -- see this function's own `_try` -- for documentation, but
        `actions.ts` follows this port's established "bare single-line
        message" precedent for a caught `ValidationError`, matching
        `tick.ts`'s own Branch A2 mode-validation shape decision; the TS
        test asserts SEMANTICALLY against this raw detail, not byte-exact).
      - `journey_action_required_missing`, `journey_action_invalid_enum`
        (SAME shape, for `JourneyAction`'s `action_type` enum).
      - A REAL sequence on ONE monotony-fired run (tick 12), driven THROUGH
        `proposal_action_endpoint` itself (not `select_service`/
        `apply_journey_action` directly), reproducing the exact chain a
        live capture of this exact package/scenario/seed already proved
        live before writing this function:
          1. `journey_action` `reject` -> success (SERVICE_REJECTED).
          2. `select_service` (a DIFFERENT allowed id than the rejected
             one) -> success (CONTENT_SELECTED) AND the best-effort
             `acknowledge` branch fires for real (category is
             `monotony_prevention`, the trigger run is STILL paused on
             this exact pending proposal) -- captures the TRIGGER run's
             OWN status transition (paused -> playing) as proof this
             genuinely reached `run_manager.action`, not merely that no
             exception was raised.
          3. `journey_action` `complete` -> a REAL 422 TransitionRejection
             (`invalid_precondition`, "only available while content is
             actively playing") -- captures the HANDLE unchanged before
             vs. after (byte-for-byte, INCLUDING `correlation_log`) since
             Python's own rejection raise happens BEFORE the
             correlation-refresh loop / `save_handle` ever run -- the
             append-only "a rejection touches nothing" case.
          4. `journey_action` `accept` -> success (CONTENT_STARTED).
          5. `journey_action` `complete` -> success this time
             (CONTENT_COMPLETED, playback_state is now `active` from #4).
        Every step's redacted `plog` (status/journey_state subset/
        event_types) AND the correlation entry's OWN refreshed
        `event_types` (`handle.correlation_log[0]`) are captured, proving
        the SAME single entry accumulates every dispatched action's events
        in order across five separate calls -- the append-ONLY-not-rewrite
        claim for the common (single-generation) case.
      - `correlation_multi_entry_reverse_iteration` (HAND-BUILT, disclosed
        as synthetic): a real proposal run (freshly fired on its own
        merged run), with a HAND-CONSTRUCTED
        `handle.correlation_log = [X, Y1, Y2]` where X targets an
        unrelated (never-resolved -- only ever string-compared, never
        looked up) placeholder run id and Y1/Y2 BOTH target the SAME real
        run id, installed via `save_handle` directly (mirrors this
        program's established "hand-built handle for a branch the natural
        flow can't reach standalone" precedent, e.g.
        `_capture_merged_run_setup`'s own corrupt-list-entry case). A
        SINGLE real `journey_action` `reject` call against that run is
        captured with the handle's `correlation_log` BEFORE and AFTER:
        X and Y1 byte-unchanged, ONLY Y2 (the LAST match, mirroring
        Python's `for corr in reversed(handle.correlation_log): ... break`)
        refreshed, length/order preserved -- the reverse-iteration-finds-
        LAST-not-FIRST claim, Hazard 4.
      - `uncaught_error_propagates` (HAND-BUILT): a merged run's handle
        with `current_proposal_run_id` overwritten to a bogus, never-
        created proposal run id (via `save_handle` directly) -- BOTH
        `select_service` and `journey_action` kinds raise `HTTPException`
        (a bare-string 404, `Proposal run {id!r} not found`) that
        PROPAGATES OUT of `proposal_action_endpoint` uncaught (no try/
        except wraps `select_service(...)`/`apply_journey_action(...)`
        themselves in Python, only the pydantic body construction above
        them) -- captured for a semantic assertion, and the handle is
        proven unchanged (the correlation-refresh loop / `save_handle`
        below never runs either).

    NOT captured (disclosed, not silently skipped): all TWELVE
    `JourneyActionType`s individually reaching `apply_journey_action`
    THROUGH this endpoint -- `actions.ts`'s own module doc states (mirroring
    `journey_action.ts`'s established framing) that `proposal_action_endpoint`
    performs NO action-type-specific branching of its own, so this is a
    `vi.spyOn`-proven claim in the TS test file (proving the wrapper's OWN
    enum-gate accepts and correctly forwards all twelve, without re-deriving
    each of the twelve's OWN precondition logic -- already exhaustively
    proven by C4a Task 6's `apply_journey_action`/`journey.ts` tests), not a
    Python golden -- Python's OWN equivalent ("does `JourneyAction(action_type=x)`
    construct for each of the twelve") is definitionally true by the enum's
    own declaration and not independently interesting to capture.
    """
    import os
    import tempfile
    import warnings

    warnings.filterwarnings("ignore", category=UserWarning)

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.merged_run import AcceptRestBody, CorrelationEntry, CreateMergedRunBody, MergedProposalActionBody
    from aica_api.routers.merged_runs import (
        CreateMergedPlanBody,
        accept_rest_endpoint,
        create_merged_plan_endpoint,
        create_merged_run_endpoint,
        decline_rest_endpoint,
        proposal_action_endpoint,
        tick_merged_run_endpoint,
    )
    from aica_api.routers.runs import rest_spots_endpoint
    from aica_api.services.merged_run_coordinator import get_handle, save_handle
    from aica_api.services import run_manager
    from aica_api.services.run_manager import clear_registry as clear_trigger_registry
    from aica_api.services.run_plan import clear_draft_registry

    _PACKAGE_ID = "nri_fatigue_score_v1"
    _SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RECOVERY_OPTION_ID = "nap_karaoke"
    _TRIGGER_RUN_SEED = 42
    _PROPOSAL_RUN_SEED = "7"
    _MAX_TICKS = 20

    _DUMMY_SPOT = {
        "id": "rest_0", "label": {"ja": "x", "en": "x"}, "route_fraction": 0.5,
        "distance_km": 1.0, "eta_min": 1.0, "reachable": True,
    }

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _create_merged_run() -> tuple[str, str]:
        plan = create_merged_plan_endpoint(CreateMergedPlanBody(
            package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID, route_preset_id=None,
            run_seed=_TRIGGER_RUN_SEED, mountain_range_km=None, jam_range_km=None,
            jam_speed_kph=15.0, presets={}, parameters={}, hyperparameters={},
            profiles=None, initial_state=None, context_overrides=None,
        ))
        run = create_merged_run_endpoint(CreateMergedRunBody(
            trigger_plan_id=plan["plan_id"], world=_seed_world_dict(),
            service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
            proposal_mode="interactive", run_seed=_PROPOSAL_RUN_SEED,
            service_parameters={}, service_hyperparameters={},
            content_parameters={}, content_hyperparameters={},
        ))
        return run["merged_run_id"], run["trigger_run_id"]

    def _tick_until_fire(mid: str, *, want_rest: bool):
        for i in range(_MAX_TICKS):
            resp = tick_merged_run_endpoint(mid)
            d = resp.trigger.get("decision")
            if resp.proposal is not None and d is not None:
                if not want_rest or d.result_type == "REST_PROPOSAL":
                    return i, resp
        raise AssertionError(f"expected a fire within {_MAX_TICKS} ticks (want_rest={want_rest})")

    id_map: dict = {}

    def freeze(raw):
        if raw is None:
            return None
        if raw not in id_map:
            id_map[raw] = f"ID_{len(id_map)}"
        return id_map[raw]

    def _redact_run_state(rs: dict) -> dict:
        recovery = rs.get("recovery")
        return {
            "status": rs["status"],
            "current_tick": rs["current_tick"],
            "pending_proposal": rs["pending_proposal"],
            "recovery": None if recovery is None else {
                "active": recovery["active"],
                "option_id": recovery["option_id"],
                "phase": recovery["phase"],
                "stage_index": recovery["stage_index"],
                "stage_ticks_remaining": recovery["stage_ticks_remaining"],
            },
        }

    def _redact_handle(h) -> dict:
        return {
            "current_proposal_run_id_frozen": freeze(h.current_proposal_run_id),
            "current_proposal_category": h.current_proposal_category,
            "rest_stage_synced": h.rest_stage_synced,
            "nap_minutes": h.nap_minutes,
            "correlation_log": [
                {
                    "trigger_tick_index": c.trigger_tick_index,
                    "proposal_run_id_frozen": freeze(c.proposal_run_id),
                    "event_types": [eid.rsplit("@", 1)[0] for eid in c.proposal_event_ids],
                }
                for c in h.correlation_log
            ],
        }

    def _redact_plog(p: dict) -> dict:
        return {
            "status": p["status"],
            "journey_state": {
                "lifecycle_stage": p["journey_state"]["lifecycle_stage"],
                "playback_state": p["journey_state"]["playback_state"],
                "active_service_id": p["journey_state"]["active_service_id"],
                "rejected_service_ids": p["journey_state"]["rejected_service_ids"],
            },
            "event_types": [e["event_type"] for e in p["events"]],
        }

    def _scrub(value, scrub_map: dict):
        """Replace every occurrence of a real (non-deterministic) run id with
        a fixed placeholder -- applied to string details ONLY (list/dict
        details in this capture never embed a raw id; every id-bearing raise
        in this file's Python scope is a bare f-string). Required for "two
        consecutive runs are byte-identical": `run_manager.action`'s own
        "No pending proposal"/"not found" messages embed the run_id itself
        via `{run_id!r}`, which is minted from `datetime.now()` + `os.urandom`
        -- see `_make_trigger_run_id`/`make_merged_run_id`/
        `_make_proposal_run_id` (all wall-clock+random, never seeded)."""
        if not isinstance(value, str):
            return value
        for real, placeholder in scrub_map.items():
            if real is not None:
                value = value.replace(real, placeholder)
        return value

    def _try(fn, scrub_map: dict | None = None):
        try:
            return {"raises": False, "result": fn()}
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, (str, list, dict)) else str(exc.detail)
            if scrub_map:
                detail = _scrub(detail, scrub_map)
            return {"raises": True, "status_code": exc.status_code, "detail": detail}

    accept_rest_cases: dict = {}
    decline_cases: dict = {}
    proposal_action_cases: dict = {}

    with tempfile.TemporaryDirectory() as td:
        td_path = pathlib.Path(td)
        env_overrides = {
            "AICA_RUNS_DIR": str(td_path / "runs"),
            "AICA_MERGED_RUNS_DIR": str(td_path / "merged_runs"),
            "AICA_PROPOSAL_RUNS_DIR": str(td_path / "proposal_runs"),
        }
        prev_env = {k: os.environ.get(k) for k in env_overrides}
        os.environ.update(env_overrides)
        try:
            clear_draft_registry()
            clear_trigger_registry()

            # =========================================================
            # Section A -- accept_rest_endpoint
            # =========================================================

            mid, tid = _create_merged_run()
            case = _try(lambda: accept_rest_endpoint(mid, AcceptRestBody(
                recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=_DUMMY_SPOT, nap_minutes=None,
            )), {tid: "<TRIGGER_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 422
            accept_rest_cases["not_paused"] = case

            case = _try(lambda: accept_rest_endpoint("mrun_bogus_id", AcceptRestBody(
                recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=_DUMMY_SPOT, nap_minutes=None,
            )))
            assert case["raises"] and case["status_code"] == 404
            accept_rest_cases["merged_run_not_found"] = case

            mid2, tid2 = _create_merged_run()
            clear_trigger_registry()
            case = _try(lambda: accept_rest_endpoint(mid2, AcceptRestBody(
                recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=_DUMMY_SPOT, nap_minutes=None,
            )), {tid2: "<TRIGGER_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 404
            accept_rest_cases["trigger_run_not_found"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid3, tid3 = _create_merged_run()
            _tick_until_fire(mid3, want_rest=False)  # ANY fire (tick 12, monotony) is enough
            case = _try(lambda: accept_rest_endpoint(mid3, AcceptRestBody(
                recovery_option_id="bogus_option_id", rest_spot=_DUMMY_SPOT, nap_minutes=None,
            )))
            assert case["raises"] and case["status_code"] == 422
            accept_rest_cases["unknown_recovery_option"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid4, tid4 = _create_merged_run()
            _tick_until_fire(mid4, want_rest=True)  # tick 17, REST_PROPOSAL
            spots4 = rest_spots_endpoint(tid4)
            spot4 = spots4["rest_spots"][0]
            accept_resp = accept_rest_endpoint(mid4, AcceptRestBody(
                recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=spot4, nap_minutes=None,
            ))
            handle4 = get_handle(mid4, settings.merged_runs_dir)
            assert handle4.rest_stage_synced == "before"
            assert handle4.nap_minutes is None
            accept_rest_cases["success_no_nap_override"] = {
                "raises": False,
                "run_state": _redact_run_state(accept_resp),
                "handle": _redact_handle(handle4),
            }

            clear_draft_registry()
            clear_trigger_registry()
            mid5, tid5 = _create_merged_run()
            _tick_until_fire(mid5, want_rest=True)
            spots5 = rest_spots_endpoint(tid5)
            spot5 = spots5["rest_spots"][0]
            accept_resp5 = accept_rest_endpoint(mid5, AcceptRestBody(
                recovery_option_id=_RECOVERY_OPTION_ID, rest_spot=spot5, nap_minutes=15,
            ))
            handle5 = get_handle(mid5, settings.merged_runs_dir)
            assert handle5.rest_stage_synced == "before"
            assert handle5.nap_minutes == 15
            scenario5 = run_manager.get_scenario(tid5)
            nap_stage_ticks = None
            for opt in scenario5.recovery_options:
                if opt.id == _RECOVERY_OPTION_ID:
                    for stage in opt.stages:
                        if stage.phase == "nap" and stage.motion == "STOPPED":
                            nap_stage_ticks = stage.ticks
            assert nap_stage_ticks == 5, f"round(15*60/180) == 5, got {nap_stage_ticks}"
            accept_rest_cases["success_with_nap_override"] = {
                "raises": False,
                "run_state": _redact_run_state(accept_resp5),
                "handle": _redact_handle(handle5),
                "installed_nap_stage_ticks": nap_stage_ticks,
            }

            # =========================================================
            # Section B -- decline_rest_endpoint
            # =========================================================

            clear_draft_registry()
            clear_trigger_registry()
            mid6, tid6 = _create_merged_run()
            case = _try(lambda: decline_rest_endpoint(mid6), {tid6: "<TRIGGER_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 422
            decline_cases["not_paused"] = case

            case = _try(lambda: decline_rest_endpoint("mrun_bogus_id"))
            assert case["raises"] and case["status_code"] == 404
            decline_cases["merged_run_not_found"] = case

            mid7, tid7 = _create_merged_run()
            clear_trigger_registry()
            case = _try(lambda: decline_rest_endpoint(mid7), {tid7: "<TRIGGER_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 404
            decline_cases["trigger_run_not_found"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid8, tid8 = _create_merged_run()
            _tick_until_fire(mid8, want_rest=True)
            decline_resp = decline_rest_endpoint(mid8)
            handle8 = get_handle(mid8, settings.merged_runs_dir)
            assert handle8.current_proposal_run_id is None
            assert handle8.current_proposal_category is None
            decline_cases["success"] = {
                "raises": False,
                "run_state": _redact_run_state(decline_resp),
                "handle": _redact_handle(handle8),
            }

            # =========================================================
            # Section C -- proposal_action_endpoint
            # =========================================================

            case = _try(lambda: proposal_action_endpoint("mrun_bogus_id", MergedProposalActionBody(
                kind="select_service", selected_service_id="music_playlist",
            )))
            assert case["raises"] and case["status_code"] == 404
            proposal_action_cases["merged_run_not_found"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid9, tid9 = _create_merged_run()
            case = _try(lambda: proposal_action_endpoint(mid9, MergedProposalActionBody(
                kind="select_service", selected_service_id="music_playlist",
            )), {mid9: "<MERGED_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 404
            proposal_action_cases["no_active_proposal_run"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid10, tid10 = _create_merged_run()
            _tick_until_fire(mid10, want_rest=False)

            case = _try(lambda: proposal_action_endpoint(mid10, MergedProposalActionBody(kind="select_service")))
            assert case["raises"] and case["status_code"] == 422
            proposal_action_cases["select_service_required_missing"] = case

            case = _try(lambda: proposal_action_endpoint(mid10, MergedProposalActionBody(
                kind="select_service", selected_service_id="bogus_service_id",
            )))
            assert case["raises"] and case["status_code"] == 422
            proposal_action_cases["select_service_invalid_enum"] = case

            case = _try(lambda: proposal_action_endpoint(mid10, MergedProposalActionBody(kind="journey_action")))
            assert case["raises"] and case["status_code"] == 422
            proposal_action_cases["journey_action_required_missing"] = case

            case = _try(lambda: proposal_action_endpoint(mid10, MergedProposalActionBody(
                kind="journey_action", action_type="bogus_action_type",
            )))
            assert case["raises"] and case["status_code"] == 422
            proposal_action_cases["journey_action_invalid_enum"] = case

            # ---- Real sequence: reject -> select_service(+acknowledge) ->
            #      complete(REJECTED) -> accept -> complete(success) ----
            seq_steps: dict = {}

            step1 = proposal_action_endpoint(mid10, MergedProposalActionBody(kind="journey_action", action_type="reject"))
            handle_after_1 = get_handle(mid10, settings.merged_runs_dir)
            seq_steps["1_reject"] = {"plog": _redact_plog(step1), "handle": _redact_handle(handle_after_1)}

            rejected_id = step1["journey_state"]["rejected_service_ids"][0]
            select_target = next(sid for sid in step1["opportunity"]["allowed_service_ids"] if sid != rejected_id)
            trigger_status_before_ack = run_manager.get_run(tid10).status.value
            step2 = proposal_action_endpoint(mid10, MergedProposalActionBody(
                kind="select_service", selected_service_id=select_target,
            ))
            trigger_status_after_ack = run_manager.get_run(tid10).status.value
            handle_after_2 = get_handle(mid10, settings.merged_runs_dir)
            seq_steps["2_select_service"] = {
                "plog": _redact_plog(step2),
                "handle": _redact_handle(handle_after_2),
                "trigger_status_before_acknowledge": trigger_status_before_ack,
                "trigger_status_after_acknowledge": trigger_status_after_ack,
            }

            handle_before_3 = get_handle(mid10, settings.merged_runs_dir)
            case3 = _try(lambda: proposal_action_endpoint(mid10, MergedProposalActionBody(
                kind="journey_action", action_type="complete",
            )))
            handle_after_3 = get_handle(mid10, settings.merged_runs_dir)
            assert case3["raises"] and case3["status_code"] == 422
            seq_steps["3_complete_rejected"] = {
                "case": case3,
                "handle_before": _redact_handle(handle_before_3),
                "handle_after": _redact_handle(handle_after_3),
            }

            step4 = proposal_action_endpoint(mid10, MergedProposalActionBody(kind="journey_action", action_type="accept"))
            seq_steps["4_accept"] = {"plog": _redact_plog(step4)}

            step5 = proposal_action_endpoint(mid10, MergedProposalActionBody(kind="journey_action", action_type="complete"))
            handle_after_5 = get_handle(mid10, settings.merged_runs_dir)
            seq_steps["5_complete_success"] = {"plog": _redact_plog(step5), "handle": _redact_handle(handle_after_5)}

            proposal_action_cases["real_sequence"] = seq_steps

            # ---- Hand-built: correlation_log reverse-iteration finds LAST match ----
            clear_draft_registry()
            clear_trigger_registry()
            mid11, tid11 = _create_merged_run()
            _tick_until_fire(mid11, want_rest=False)
            handle11 = get_handle(mid11, settings.merged_runs_dir)
            real_run_id = handle11.current_proposal_run_id
            handle11.correlation_log = [
                CorrelationEntry(trigger_tick_index=0, proposal_run_id="never_resolved_placeholder",
                                  proposal_event_ids=["UNRELATED@t0"]),
                CorrelationEntry(trigger_tick_index=1, proposal_run_id=real_run_id,
                                  proposal_event_ids=["STALE_FIRST@t1"]),
                CorrelationEntry(trigger_tick_index=2, proposal_run_id=real_run_id,
                                  proposal_event_ids=["STALE_SECOND@t2"]),
            ]
            save_handle(handle11, settings.merged_runs_dir)
            before_multi = get_handle(mid11, settings.merged_runs_dir)
            # `proposal_event_ids` is captured via `.rsplit("@", 1)[0]` (event
            # TYPE only, dropping the `@{at}` suffix) everywhere in this
            # capture EXCEPT here the three seeded values are synthetic
            # literals (`"UNRELATED@t0"` etc, not real `{at}` timestamps) --
            # kept verbatim in `before_multi_snapshot` since they are already
            # fully deterministic. `after_multi_snapshot`'s REFRESHED entry
            # (index 2) is NOT synthetic -- it is a real `SERVICE_REJECTED`
            # event with a genuine wall-clock `at`, so it MUST go through the
            # same `.rsplit("@", 1)[0]` reduction as every other real
            # captured entry in this file, or two consecutive runs of this
            # capture would differ only in that one embedded timestamp
            # (caught by exactly that diff before this comment was written).
            before_multi_snapshot = [
                {"trigger_tick_index": c.trigger_tick_index,
                 "proposal_run_id_is_real_run": c.proposal_run_id == real_run_id,
                 "proposal_event_ids": list(c.proposal_event_ids)}
                for c in before_multi.correlation_log
            ]
            proposal_action_endpoint(mid11, MergedProposalActionBody(kind="journey_action", action_type="reject"))
            after_multi = get_handle(mid11, settings.merged_runs_dir)
            after_multi_snapshot = [
                {"trigger_tick_index": c.trigger_tick_index,
                 "proposal_run_id_is_real_run": c.proposal_run_id == real_run_id,
                 "proposal_event_types": [eid.rsplit("@", 1)[0] for eid in c.proposal_event_ids]}
                for c in after_multi.correlation_log
            ]
            proposal_action_cases["correlation_multi_entry_reverse_iteration"] = {
                "before": before_multi_snapshot,
                "after": after_multi_snapshot,
            }
            assert after_multi_snapshot[0] == {
                "trigger_tick_index": 0, "proposal_run_id_is_real_run": False,
                "proposal_event_types": ["UNRELATED"],
            }
            assert after_multi_snapshot[1] == {
                "trigger_tick_index": 1, "proposal_run_id_is_real_run": True,
                "proposal_event_types": ["STALE_FIRST"],
            }
            assert after_multi_snapshot[2]["proposal_event_types"] != ["STALE_SECOND"], (
                "the LAST matching entry must be the one refreshed"
            )
            assert after_multi_snapshot[2]["proposal_event_types"] == [
                "DiscreteEventType.OPPORTUNITY_OPENED", "DiscreteEventType.SERVICE_SELECTED",
                "DiscreteEventType.SERVICE_REJECTED",
            ], after_multi_snapshot[2]

            # ---- Hand-built: bogus current_proposal_run_id propagates uncaught ----
            clear_draft_registry()
            clear_trigger_registry()
            mid12, tid12 = _create_merged_run()
            _tick_until_fire(mid12, want_rest=False)
            handle12 = get_handle(mid12, settings.merged_runs_dir)
            handle12.current_proposal_run_id = "prun_never_created"
            save_handle(handle12, settings.merged_runs_dir)
            before12 = get_handle(mid12, settings.merged_runs_dir)
            before12_snapshot = _redact_handle(before12)

            case_select = _try(lambda: proposal_action_endpoint(mid12, MergedProposalActionBody(
                kind="select_service", selected_service_id="music_playlist",
            )))
            case_journey = _try(lambda: proposal_action_endpoint(mid12, MergedProposalActionBody(
                kind="journey_action", action_type="reject",
            )))
            after12 = get_handle(mid12, settings.merged_runs_dir)
            after12_snapshot = _redact_handle(after12)
            assert case_select["raises"] and case_select["status_code"] == 404
            assert case_journey["raises"] and case_journey["status_code"] == 404
            proposal_action_cases["uncaught_error_propagates"] = {
                "select_service": case_select,
                "journey_action": case_journey,
                "handle_before": before12_snapshot,
                "handle_after": after12_snapshot,
            }
            assert before12_snapshot == after12_snapshot, "an uncaught error must leave the handle untouched"

        finally:
            for k, v in prev_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    _write("merged_actions", {
        "input": {
            "package_id": _PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "trigger_run_seed": _TRIGGER_RUN_SEED,
            "proposal_run_seed": _PROPOSAL_RUN_SEED,
        },
        "output": {
            "accept_rest": accept_rest_cases,
            "decline": decline_cases,
            "proposal_action": proposal_action_cases,
        },
    })


def _capture_merged_explain() -> None:
    """`merged_explain_endpoint` (routers/merged_runs.py:553-600) and
    `explain_trigger_endpoint` (600-681) -- feature 026, slice C4 Task 8.
    Ports `src/engine/merged/explain.ts`.

    Direct function calls (mirrors `_capture_proposal_explain`'s own
    technique for the sibling run-id-addressed endpoint).

    Section A -- `merged_explain_endpoint`, over a REAL
    `create_proposal_run` (+ `select_service`) run
    (`seed-night-highway-oshi`, the two real transparent packages), the
    FULL `ProposalRunLog.model_dump(mode="json")` posted back inline
    (ids/timestamps frozen to deterministic placeholders):
      - `service_browser_success` / `content_browser_success` (the latter
        after a real `select_service("music_playlist")` call, against the
        real content evidence).
      - `unknown_target_422` (a real candidate id that doesn't exist).
      - `unknown_step_422` / `unknown_provider_422` -- a bogus `step`/
        `provider` string, caught by the SAME try/except
        `ProposalRunLog.model_validate` is (`ExplainRequestBody`
        construction failing its own Literal check).
      - `step_trigger_no_decision_422` -- `step="trigger"` is a REAL,
        reachable Python behavior: `ExplainRequestBody.step` accepts it
        (`Literal["service","content","trigger"]`), but no
        `AlgorithmEvidence.step` is ever `"trigger"`, so `_find_explain_
        target` always misses -> `no_decision` 422. Proves the TS port's
        OWN scope note (`ExplainStep` is `'service'|'content'` only,
        `'trigger'` reaches `explainFromRunLog` only via a compile-time
        cast) produces the IDENTICAL runtime decision as real Python.
      - `malformed_proposal_missing_evidence_422` -- a dict that IS a
        valid `dict[str, Any]` (so it passes `MergedExplainBody`'s own
        field-type check unconditionally) but fails
        `ProposalRunLog.model_validate` (missing the required `evidence`
        key) -- the REACHABLE malformed-body case (a `proposal` that is
        not even a dict at all can never reach `merged_explain_endpoint`'s
        own try/except in real Python -- FastAPI's request-body parsing
        would reject it before the endpoint function ever runs, since
        `MergedExplainBody.proposal: dict[str, Any]` -- so that variant has
        NO Python-comparable capture and is unit-tested directly in the TS
        suite instead, per this file's own `explain.ts` module doc).

    NOT captured (disclosed, not silently skipped): the offline-only
    `provider="off"` (service/content) and `provider="backend"`/`"off"`
    (trigger) branches -- `off` does not exist as a value in Python's real
    `ExplainRequestBody`/`ExplainTriggerBody` provider literals at all
    (sending it to REAL Python 422s as just another unrecognized string,
    the SAME decision as `unknown_provider_422` above -- not a distinct
    Python behavior worth a second golden case), and an offline `backend`
    request is rejected before any Python-comparable work happens (same
    established precedent as `_capture_proposal_explain`'s own docstring).

    Section B -- `explain_trigger_endpoint`, over REAL NRI-produced fires
    (mirrors `_capture_trigger_explanation`'s own `_fire_from_result`
    technique -- a genuine `nri_fatigue_score_v1.algorithm.evaluate()`
    result, not a hand-fabricated fire dict) spanning BOTH trigger
    categories:
      - `rest_explicit_category_browser_success` -- `category="rest_required"`
        given explicitly.
      - `rest_omitted_category_resolves_from_fire_own_category` --
        `category=None`, resolved from the fire's OWN recorded `category`
        field (the SECOND priority branch of `resolve_category` -- the
        THIRD, both-None max-tiebreak branch is already exhaustively
        covered at the unit level by `trigger_explanation.json`, C3 Task 2,
        and not re-derived here).
      - `monotony_explicit_category_browser_success` -- the sibling
        category, proving the endpoint's own wiring is not
        rest-required-only.
      - `template_provider_success` -- `provider="template"` (feature 025
        S11): the deterministic sentence, `fell_back=False`, `error=None`,
        no Ollama call.
      - `unknown_category_422` -- an explicit `category` absent from the
        fire's own recorded chains.
      - `malformed_fire_422` -- a `fire` dict missing the required
        `tick`/`time_min` fields (`FirePoint.model_validate` failure) --
        REACHABLE in real Python because `ExplainTriggerBody.fire: dict[str,
        Any]` accepts any dict at the body-construction layer, the same
        "malformed but a dict" reachability reasoning as Section A's own
        `malformed_proposal_missing_evidence_422`. A `fire` that is not a
        dict AT ALL has the same no-Python-comparable-capture gap as
        Section A's own `malformed_proposal_not_a_dict_422` -- unit-tested
        directly, not captured here.
    """
    import importlib.util
    import os
    import pathlib
    import tempfile
    import warnings

    warnings.filterwarnings("ignore", category=UserWarning)

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.routers.merged_runs import ExplainTriggerBody, MergedExplainBody, explain_trigger_endpoint, merged_explain_endpoint
    from aica_api.routers.proposal import CreateProposalRunBody, SelectServiceBody, create_proposal_run, select_service

    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _RUN_SEED = "seed-merged-explain-test"
    _SIM_TIME = "2026-08-02T09:00:00Z"

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _dump(model) -> dict:
        return json.loads(model.model_dump_json())

    def _freeze(obj, freeze_map: dict):
        """Same recursive `created_at`/`at` + id-substitution technique as
        `_capture_proposal_explain`'s own `_freeze` (this capture's sibling
        task, same file)."""
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if k in ("created_at", "at"):
                    out[k] = "2026-01-01T00:00:00.000000Z"
                elif isinstance(v, str) and v in freeze_map:
                    out[k] = freeze_map[v]
                else:
                    out[k] = _freeze(v, freeze_map)
            return out
        if isinstance(obj, list):
            return [_freeze(v, freeze_map) for v in obj]
        return obj

    def _try_merged_explain(body_kwargs: dict) -> dict:
        try:
            result = merged_explain_endpoint(MergedExplainBody(**body_kwargs))
            return {"raises": False, "result": _dump(result)}
        except HTTPException as exc:
            return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

    def _try_explain_trigger(body_kwargs: dict) -> dict:
        try:
            result = explain_trigger_endpoint(ExplainTriggerBody(**body_kwargs))
            return {"raises": False, "result": _dump(result)}
        except HTTPException as exc:
            return {"raises": True, "status_code": exc.status_code, "detail": exc.detail}

    merged_explain_cases: dict = {}

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)
        prev_runs_dir = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
        os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
        try:
            run = create_proposal_run(CreateProposalRunBody(
                world=_seed_world_dict(), service_package_id=_SERVICE_PKG_ID,
                content_package_id=_CONTENT_PKG_ID, run_seed=_RUN_SEED,
                simulation_time=_SIM_TIME, mode="interactive",
            ))
            fm = {run.run_id: "prun_TEST_FIXED", run.opportunity.opportunity_id: "op_TEST_FIXED"}
            proposal_pre_select = _freeze(_dump(run), fm)

            service_ev = next(e for e in reversed(run.evidence) if e.step == "service" and e.error is None)
            real_service_candidate_id = service_ev.output["ranked_candidates"][0]["candidate_id"]

            case = _try_merged_explain({
                "proposal": proposal_pre_select, "step": "service",
                "target_id": real_service_candidate_id, "provider": "browser",
            })
            assert not case["raises"]
            merged_explain_cases["service_browser_success"] = case

            case = _try_merged_explain({
                "proposal": proposal_pre_select, "step": "service",
                "target_id": "not-a-real-candidate-id", "provider": "browser",
            })
            assert case["raises"] and case["status_code"] == 422
            merged_explain_cases["unknown_target_422"] = case

            case = _try_merged_explain({
                "proposal": proposal_pre_select, "step": "bogus_step",
                "target_id": "anything", "provider": "browser",
            })
            assert case["raises"] and case["status_code"] == 422
            merged_explain_cases["unknown_step_422"] = case

            case = _try_merged_explain({
                "proposal": proposal_pre_select, "step": "service",
                "target_id": "anything", "provider": "nonsense_provider",
            })
            assert case["raises"] and case["status_code"] == 422
            merged_explain_cases["unknown_provider_422"] = case

            case = _try_merged_explain({
                "proposal": proposal_pre_select, "step": "trigger",
                "target_id": "anything", "provider": "browser",
            })
            assert case["raises"] and case["status_code"] == 422
            assert case["detail"]["code"] == "no_decision"
            merged_explain_cases["step_trigger_no_decision_422"] = case

            malformed_proposal = {k: v for k, v in proposal_pre_select.items() if k != "evidence"}
            case = _try_merged_explain({
                "proposal": malformed_proposal, "step": "service",
                "target_id": "anything", "provider": "browser",
            })
            assert case["raises"] and case["status_code"] == 422
            merged_explain_cases["malformed_proposal_missing_evidence_422"] = case

            run2 = select_service(run.run_id, SelectServiceBody(selected_service_id="music_playlist"))
            proposal_post_select = _freeze(_dump(run2), fm)
            content_ev = next(e for e in reversed(run2.evidence) if e.step == "content" and e.error is None)
            real_content_item_id = content_ev.output["ordered_items"][0]["item_id"]

            case = _try_merged_explain({
                "proposal": proposal_post_select, "step": "content",
                "target_id": real_content_item_id, "provider": "browser",
            })
            assert not case["raises"]
            merged_explain_cases["content_browser_success"] = case
        finally:
            if prev_runs_dir is None:
                os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
            else:
                os.environ["AICA_PROPOSAL_RUNS_DIR"] = prev_runs_dir

    # -- Section B: explain_trigger_endpoint, real NRI-produced fires -------

    def _load_alg_module(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    nri_dir = _PACKAGES_DIR / "nri_fatigue_score_v1"
    nri = _load_alg_module("nri_alg_merged_explain_capture", nri_dir / "algorithm.py")
    nri_pkg_data = _load_json(nri_dir / "package.json")
    nri_hp = {hp["key"]: hp["default"] for hp in nri_pkg_data["hyperparameters"]}

    empty_ph = {
        "lastProposalTimeSec": None, "lastProposalCategory": None,
        "lastProposalResult": None, "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 0.0,
    }

    def _nri_signals(**overrides):
        signals = {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
        }
        for key, value in overrides.items():
            for group in signals.values():
                if key in group:
                    group[key] = value
        return signals

    def _nri_ctx(signals, prev_state=None, sim_time=60.0):
        return {
            "simulation_time_sec": sim_time,
            "signals": signals,
            "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
            "hyperparameters": nri_hp,
            "parameters": {},
            "proposal_history": dict(empty_ph),
            "user_action_history": [],
            "package_runtime_state": prev_state or {},
            "recovery_active": False,
        }

    def _nri_primed_state(driving_min_since_rest=None):
        if driving_min_since_rest is None:
            driving_min_since_rest = nri_hp["threshold_fire"] / nri_hp["w_base"]
        return {
            "cumulative_jam_min": 0.0, "cumulative_highway_min": 0.0,
            "cumulative_monotonous_min": 0.0,
            "driving_min_since_rest": driving_min_since_rest,
            "last_sim_time": 0.0, "was_in_recovery": False,
        }

    def _nri_between_thresholds_state():
        target = (nri_hp["threshold_monotony"] + nri_hp["threshold_fire"]) / 2.0
        driving_min = target / nri_hp["w_base"] - 1.0
        return _nri_primed_state(driving_min_since_rest=driving_min)

    def _fire_from_result(result, tick=1, time_min=1.0):
        category = result["selected_category"]
        strength = next((c.get("strength") for c in result["candidates"] if c["category"] == category), None)
        return {
            "category": category, "strength": strength, "tick": tick, "time_min": time_min,
            "feature_contributions": result["feature_contributions"], "criteria": result["criteria"],
        }

    real_rest_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_primed_state(), sim_time=60.0))
    )
    assert real_rest_fire["category"] == "rest_required", "setup sanity"

    real_monotony_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_between_thresholds_state(), sim_time=60.0))
    )
    assert real_monotony_fire["category"] == "monotony_prevention", "setup sanity"

    trigger_cases: dict = {}

    case = _try_explain_trigger({"fire": real_rest_fire, "category": "rest_required", "provider": "browser"})
    assert not case["raises"]
    trigger_cases["rest_explicit_category_browser_success"] = case

    case = _try_explain_trigger({"fire": real_rest_fire, "category": None, "provider": "browser"})
    assert not case["raises"] and case["result"]["target_id"] == "rest_required"
    trigger_cases["rest_omitted_category_resolves_from_fire_own_category"] = case

    case = _try_explain_trigger({"fire": real_monotony_fire, "category": "monotony_prevention", "provider": "browser"})
    assert not case["raises"]
    trigger_cases["monotony_explicit_category_browser_success"] = case

    case = _try_explain_trigger({"fire": real_rest_fire, "category": "rest_required", "provider": "template"})
    assert not case["raises"] and case["result"]["provider_used"] == "template" and case["result"]["fell_back"] is False
    trigger_cases["template_provider_success"] = case

    case = _try_explain_trigger({"fire": real_rest_fire, "category": "not_a_real_category", "provider": "browser"})
    assert case["raises"] and case["status_code"] == 422 and case["detail"]["code"] == "unknown_target"
    trigger_cases["unknown_category_422"] = case

    case = _try_explain_trigger({"fire": {"category": "rest_required"}, "provider": "browser"})
    assert case["raises"] and case["status_code"] == 422
    trigger_cases["malformed_fire_422"] = case

    _write("merged_explain", {
        "input": {
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
            # The exact REPLAYABLE inputs each case above was run against —
            # the TS test loads these directly (rather than reconstructing a
            # real run itself) and posts them through `mergedExplainEndpoint`/
            # `explainTriggerEndpoint` to reproduce each case byte-for-byte.
            "proposal_pre_select": proposal_pre_select,
            "proposal_post_select": proposal_post_select,
            "real_rest_fire": real_rest_fire,
            "real_monotony_fire": real_monotony_fire,
        },
        "output": {
            "merged_explain": merged_explain_cases,
            "explain_trigger": trigger_cases,
        },
    })


def _capture_merged_review_feedback() -> None:
    """`post_review_feedback_endpoint` (routers/merged_runs.py:1327-1366) and
    `get_review_feedback_endpoint` (1366-1415) -- feature 026, slice C4 Task
    8. Ports `src/engine/merged/review_feedback.ts`.

    Direct function calls (mirrors `_capture_merged_actions`'s own setup
    technique -- `AICA_RUNS_DIR`/`AICA_MERGED_RUNS_DIR`/
    `AICA_PROPOSAL_RUNS_DIR` monkeypatched to a shared tempdir), same
    package/scenario/seed combo as `_capture_merged_tick`/
    `_capture_merged_actions` (`nri_fatigue_score_v1` x
    `uc01_fatigue_recovery_v0_1`, `seed-night-highway-oshi`, the two real
    transparent packages).

    - `merged_run_not_found_post` / `merged_run_not_found_get` -- a bogus
      `merged_run_id` -> 404 for BOTH endpoints independently.
    - `trigger_run_not_found_post` -- a real merged run whose HANDLE is then
      overwritten (`save_handle`, mirroring `_capture_merged_actions`'s own
      hand-built-handle precedent) with a bogus `trigger_run_id` that was
      NEVER created at all. This is the genuinely reachable "neither tier
      has it" case for `services.feedback.append_feedback`'s two-tier
      resolution: merely `clear_registry()`-ing a REAL trigger run's
      in-memory entry does NOT reach this branch, because
      `EvidenceRecorder.__init__` persists the run's initial (zero-event)
      log to disk IMMEDIATELY at `create_run` time (`storage/
      evidence_recorder.py:39`, `self._persist()` in the constructor, before
      any tick/action ever happens) -- verified directly against a live
      interpreter (not assumed): clearing the registry alone still lets
      `append_feedback` succeed via its own on-disk fallback tier. Only a
      trigger_run_id that was NEVER created in EITHER tier reaches the real
      404.
    - `two_review_judgements_appended_in_order` -- POST a
      `review_input`(with `feature_id`) THEN a `review_decision` (no
      `feature_id`) judgement on the SAME real merged run; GET afterward
      returns BOTH, in the SAME order, with `package_versions` attached
      (trigger id/version read off the run's own recorded snapshot;
      service/content versions from the real registry). Proves append-only
      (two calls, two distinct events, neither overwrites the other) AND
      the GET endpoint's own filter (only `review_*`-scoped events are
      returned -- this run's OTHER events, e.g. whatever `create_merged_run
      _endpoint` itself appends, if any, must NOT leak into the list).
    - `get_before_any_feedback_empty_events` -- GET on a fresh merged run
      (before any POST) -> `events: []`, `package_versions.trigger`
      non-null (the trigger run DOES exist and DOES have a `snapshot`, just
      zero feedback events yet) -- proves the empty-list case is genuinely
      `[]`, not a 404.
    """
    import os
    import tempfile
    import warnings

    warnings.filterwarnings("ignore", category=UserWarning)

    from fastapi import HTTPException
    from aica_api.config import settings
    from aica_api.models.merged_run import CreateMergedRunBody
    from aica_api.models.feedback import FeedbackTarget
    from aica_api.routers.merged_runs import (
        CreateMergedPlanBody,
        ReviewFeedbackBody,
        create_merged_plan_endpoint,
        create_merged_run_endpoint,
        get_review_feedback_endpoint,
        post_review_feedback_endpoint,
    )
    from aica_api.services.merged_run_coordinator import get_handle, save_handle
    from aica_api.services import run_manager
    from aica_api.services.run_manager import clear_registry as clear_trigger_registry
    from aica_api.services.run_plan import clear_draft_registry
    from aica_api.services.proposal_package_registry import ProposalPackageRegistry

    _PACKAGE_ID = "nri_fatigue_score_v1"
    _SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
    _SEED_ID = "seed-night-highway-oshi"
    _SERVICE_PKG_ID = "aica_transparent_service_selector_v1"
    _CONTENT_PKG_ID = "aica_transparent_content_selector_v1"
    _TRIGGER_RUN_SEED = 42
    _PROPOSAL_RUN_SEED = "7"

    def _seed_world_dict() -> dict:
        path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
        return json.loads(path.read_text(encoding="utf-8"))["world"]

    def _create_merged_run() -> tuple[str, str]:
        plan = create_merged_plan_endpoint(CreateMergedPlanBody(
            package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID, route_preset_id=None,
            run_seed=_TRIGGER_RUN_SEED, mountain_range_km=None, jam_range_km=None,
            jam_speed_kph=15.0, presets={}, parameters={}, hyperparameters={},
            profiles=None, initial_state=None, context_overrides=None,
        ))
        run = create_merged_run_endpoint(CreateMergedRunBody(
            trigger_plan_id=plan["plan_id"], world=_seed_world_dict(),
            service_package_id=_SERVICE_PKG_ID, content_package_id=_CONTENT_PKG_ID,
            proposal_mode="interactive", run_seed=_PROPOSAL_RUN_SEED,
            service_parameters={}, service_hyperparameters={},
            content_parameters={}, content_hyperparameters={},
        ))
        return run["merged_run_id"], run["trigger_run_id"]

    def _scrub(value, scrub_map: dict):
        if not isinstance(value, str):
            return value
        for real, placeholder in scrub_map.items():
            if real is not None:
                value = value.replace(real, placeholder)
        return value

    def _try_post(mid: str, body: ReviewFeedbackBody, scrub_map: dict | None = None) -> dict:
        try:
            # post_review_feedback_endpoint already returns
            # `event.model_dump(mode="json")` -- a plain dict, not a
            # pydantic model -- unlike every OTHER endpoint this capture
            # file wraps.
            result = post_review_feedback_endpoint(mid, body)
            return {"raises": False, "result": result}
        except HTTPException as exc:
            detail = _scrub(exc.detail, scrub_map) if scrub_map else exc.detail
            return {"raises": True, "status_code": exc.status_code, "detail": detail}

    def _try_get(mid: str, scrub_map: dict | None = None) -> dict:
        try:
            result = get_review_feedback_endpoint(mid)
            return {"raises": False, "result": result}
        except HTTPException as exc:
            detail = _scrub(exc.detail, scrub_map) if scrub_map else exc.detail
            return {"raises": True, "status_code": exc.status_code, "detail": detail}

    cases: dict = {}

    with tempfile.TemporaryDirectory() as td:
        td_path = pathlib.Path(td)
        env_overrides = {
            "AICA_RUNS_DIR": str(td_path / "runs"),
            "AICA_MERGED_RUNS_DIR": str(td_path / "merged_runs"),
            "AICA_PROPOSAL_RUNS_DIR": str(td_path / "proposal_runs"),
        }
        prev_env = {k: os.environ.get(k) for k in env_overrides}
        os.environ.update(env_overrides)
        try:
            clear_draft_registry()
            clear_trigger_registry()

            case = _try_post("mrun_bogus_id", ReviewFeedbackBody(
                scope="review_decision", case_id="c1", checkpoint_id="cp1",
                stage="trigger", review_target="decision",
            ))
            assert case["raises"] and case["status_code"] == 404
            cases["merged_run_not_found_post"] = case

            case = _try_get("mrun_bogus_id")
            assert case["raises"] and case["status_code"] == 404
            cases["merged_run_not_found_get"] = case

            mid1, tid1 = _create_merged_run()
            handle1 = get_handle(mid1, settings.merged_runs_dir)
            bogus_tid = "run_bogus_never_created_000000"
            handle1.trigger_run_id = bogus_tid
            save_handle(handle1, settings.merged_runs_dir)
            case = _try_post(mid1, ReviewFeedbackBody(
                scope="review_decision", case_id="c1", checkpoint_id="cp1",
                stage="trigger", review_target="decision",
            ), {bogus_tid: "<TRIGGER_RUN_ID>"})
            assert case["raises"] and case["status_code"] == 404
            cases["trigger_run_not_found_post"] = case

            clear_draft_registry()
            clear_trigger_registry()
            mid2, tid2 = _create_merged_run()
            case = _try_get(mid2)
            assert not case["raises"]
            assert case["result"]["events"] == []
            assert case["result"]["package_versions"]["trigger"]["id"] is not None
            cases["get_before_any_feedback_empty_events"] = case

            post1 = post_review_feedback_endpoint(mid2, ReviewFeedbackBody(
                scope="review_input", case_id="case-1", checkpoint_id="cp-trigger",
                stage="trigger", review_target="feature", feature_id="continuousDrivingMin",
                labels={"agreement": "agree"}, comment="looks right",
            ))
            post2 = post_review_feedback_endpoint(mid2, ReviewFeedbackBody(
                scope="review_decision", case_id="case-1", checkpoint_id="cp-trigger",
                stage="trigger", review_target="decision",
                labels={"overall_judgment": "good_trigger"}, comment=None,
            ))
            get_after = get_review_feedback_endpoint(mid2)
            assert len(get_after["events"]) == 2
            assert get_after["events"][0]["target"]["scope"] == "review_input"
            assert get_after["events"][1]["target"]["scope"] == "review_decision"
            cases["two_review_judgements_appended_in_order"] = {
                "post_1": post1,
                "post_2": post2,
                "get_after": get_after,
            }
        finally:
            for k, v in prev_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    _write("merged_review_feedback", {
        "input": {
            "package_id": _PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "seed_id": _SEED_ID,
            "service_package_id": _SERVICE_PKG_ID,
            "content_package_id": _CONTENT_PKG_ID,
        },
        "output": cases,
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

CAPTURES = [
    ("binning", _capture_binning),
    ("driver_signals", _capture_driver_signals),
    ("anomaly", _capture_anomaly),
    ("prng", _capture_prng),
    ("event_plan", _capture_event_plan),
    ("tick_sequence", _capture_tick_sequence),
    ("run_plan", _capture_run_plan),
    ("run_log_e2e", _capture_run_log_e2e),
    ("route_analysis", _capture_route_analysis),
    ("recovery", _capture_recovery),
    ("preview", _capture_preview),
    ("preview_min_ahead", _capture_preview_min_ahead),
    ("rest_spots", _capture_rest_spots),
    ("rest_spots_min_ahead", _capture_rest_spots_min_ahead),
    ("nri_fatigue_score_v1", _capture_nri_fatigue_score_v1),
    ("aica_transparent_hybrid_trigger_v1", _capture_aica_transparent_hybrid_trigger_v1),
    ("feedback", _capture_feedback),
    ("evidence_report+evidence_markdown", _capture_evidence_fixtures),
    ("evidence_markdown_nri", _capture_evidence_markdown_nri),
    ("nri_tick_by_tick", _capture_nri_tick_by_tick),
    ("service_selector", _capture_service_selector),
    ("content_selector", _capture_content_selector),
    ("proposal_eligibility", _capture_eligibility),
    ("algorithm_config", _capture_algorithm_config),
    ("world_validation", _capture_world_validation),
    ("world_overrides", _capture_world_overrides),
    ("proposal_selector_dispatch", _capture_proposal_selector_dispatch),
    ("proposal_run_manager", _capture_proposal_run_manager),
    ("proposal_journey", _capture_journey),
    ("proposal_journey_preview", _capture_journey_preview),
    ("explanation_builder", _capture_explanation_builder),
    ("trigger_explanation", _capture_trigger_explanation),
    ("service_explanation", _capture_service_explanation),
    ("content_explanation", _capture_content_explanation),
    ("explanation_facade", _capture_explanation_facade),
    ("merged_adapter", _capture_merged_adapter),
    ("merged_painter", _capture_merged_painter),
    ("proposal_matrix", _capture_proposal_matrix),
    ("proposal_context_base", _capture_proposal_context_base),
    ("proposal_context", _capture_proposal_context),
    ("proposal_create_run", _capture_proposal_create_run),
    ("proposal_select_service", _capture_proposal_select_service),
    ("proposal_recompute", _capture_proposal_recompute),
    ("proposal_journey_action", _capture_proposal_journey_action),
    ("proposal_explain", _capture_proposal_explain),
    ("merged_quickview", _capture_merged_quickview),
    ("merged_run_setup", _capture_merged_run_setup),
    ("merged_tick", _capture_merged_tick),
    ("merged_actions", _capture_merged_actions),
    ("merged_explain", _capture_merged_explain),
    ("merged_review_feedback", _capture_merged_review_feedback),
]

if __name__ == "__main__":
    # If specific fixture names are passed on the command line, run only those.
    targets = set(sys.argv[1:]) if len(sys.argv) > 1 else None

    for name, fn in CAPTURES:
        if targets and name not in targets:
            continue
        print(f"[{name}]")
        fn()

    print("\nAll captures complete.")
