"""TDD tests for the transparent hybrid package aica_transparent_hybrid_trigger_v1 (M3 T011, T012).

The headline M3 deliverable: a faithful, STATEFUL Python trigger whose runtime state
(smoothed features/scores, persistence counters, state-machine labels) evolves tick-to-tick
and whose full decision basis is reviewable.

RED first: these tests fail because packages/aica_transparent_hybrid_trigger_v1/algorithm.py
(and package.json) do not exist yet.

Contract: specs/004-m3-python-algorithm-support/contracts/transparent-hybrid.md
  - smoothing alpha = 0.35 on FEATURES (prev from package_runtime_state.smoothed_features)
  - category scores computed from SMOOTHED features (same formulas as weighted_score)
  - velocity = score - prev smoothed score
  - persistence: rest 2 consecutive over-threshold ticks, monotony 3; skip-if
    (score > 0.88 OR velocity > 0.08) bypasses persistence
  - state machines: REST_NORMAL->WATCH(0.45)->SUGGEST(0.62)->RECOMMEND(0.76)->URGENT(0.88)
    (->RECOVERY on accept); MONOTONY_NORMAL->WATCH(0.40)->CONTENT_SUGGEST(0.58)
  - fire-control order: no-candidate -> emergency override -> cooldown -> 30-min count -> pass
  - priority [rest_required, monotony_prevention] then score; suppressed candidates retained
  - result_type VERBATIM: REST_PROPOSAL / MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL
  - next_package_runtime_state{smoothed_features, smoothed_scores, persistence_counters, states}
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_manager import (
    clear_registry as _clear_run_registry,
    create_run as _create_run,
    tick as _tick,
)
from aica_api.services.run_plan import clear_draft_registry, create_draft
from aica_api.services.scenario_registry import ScenarioRegistry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1"
_PKG_ALG = _PKG_DIR / "algorithm.py"
_PKG_JSON = _PKG_DIR / "package.json"
_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"


# ---------------------------------------------------------------------------
# Load the package algorithm module directly (white-box unit driving evaluate)
# ---------------------------------------------------------------------------


def _load_module():
    spec = importlib.util.spec_from_file_location("hybrid_alg_under_test", _PKG_ALG)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


mod = _load_module()


def _default_hp() -> dict:
    """Read declared hyperparameter defaults from the package manifest."""
    data = json.loads(_PKG_JSON.read_text(encoding="utf-8"))
    return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}


HP = _default_hp()

_EMPTY_PH = {
    "lastProposalTimeSec": None,
    "lastProposalCategory": None,
    "lastProposalResult": None,
    "proposalCountLast30Min": 0,
    "acceptanceRateRecent": 0.0,
}


def _norm_from_raw(raw: dict) -> dict:
    drowsiness = float(raw.get("drowsinessLevel", 0.0))
    fatigue = float(raw.get("fatigueLevel", 0.0))
    attention = float(raw.get("attentionLevel", 100.0))
    steering = float(raw.get("steeringInstabilityLevel", 0.0))
    return {
        "drowsiness_score": min(1.0, max(0.0, drowsiness / 100.0)),
        "fatigue_score": min(1.0, max(0.0, fatigue / 100.0)),
        "attention_score": min(1.0, max(0.0, attention / 100.0)),
        "driving_anomaly_score": min(1.0, max(0.0, steering / 100.0)),
    }


def _ctx(raw, prev_state=None, proposal_history=None, sim_time=3600.0, hp=None):
    return {
        "simulation_time_sec": sim_time,
        "raw_state": raw,
        "feature_groups": {"normalized": _norm_from_raw(raw), "ordinal": {}},
        "hyperparameters": hp if hp is not None else HP,
        "parameters": {},
        "proposal_history": proposal_history or dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
    }


def _steady_state(raw, hp=None, counter_rest=0, counter_mono=0, vel_rest=0.0, vel_mono=0.0):
    """Build a prev runtime state at steady-state for the given raw.

    When threaded with the SAME raw, smoothed features == feats (stable), so the
    category scores stay constant and the per-tick velocity equals vel_rest/vel_mono.
    """
    hp = hp if hp is not None else HP
    feats = mod.extract_features(raw, _norm_from_raw(raw))
    scores = mod.category_scores(feats, hp)
    return {
        "smoothed_features": dict(feats),
        "smoothed_scores": {
            "rest_required_score": scores["rest_required_score"] - vel_rest,
            "monotony_prevention_score": scores["monotony_prevention_score"] - vel_mono,
        },
        "persistence_counters": {
            "rest_required": counter_rest,
            "monotony_prevention": counter_mono,
        },
        "states": {"rest_state": "REST_NORMAL", "monotony_state": "MONOTONY_NORMAL"},
    }


# Crafted raw_states ----------------------------------------------------------

# rest_required in (0.62, 0.88) — fires REST_PROPOSAL once persistence clears.
_HIGH_RAW = {
    "drowsinessLevel": 70.0,
    "fatigueLevel": 70.0,
    "attentionLevel": 50.0,
    "steeringInstabilityLevel": 40.0,
    "speedKph": 80.0,
    "nextRestSpotMin": 10.0,
    "isNight": False,
}

# rest_required = 1.0 (> 0.88) — skip-if (score) bypasses persistence; strength strong.
_MAX_RAW = {
    "drowsinessLevel": 100.0,
    "fatigueLevel": 100.0,
    "attentionLevel": 0.0,
    "steeringInstabilityLevel": 100.0,
    "speedKph": 80.0,
    "nextRestSpotMin": 10.0,
    "isNight": False,
}

# Both rest and monotony over their suggest thresholds.
_BOTH_RAW = {
    "drowsinessLevel": 70.0,
    "fatigueLevel": 70.0,
    "attentionLevel": 0.0,
    "steeringInstabilityLevel": 40.0,
    "speedKph": 80.0,
    "nextRestSpotMin": 10.0,
    "isNight": False,
    "monotonousRoadRemainingMin": 60.0,
    "familiarRouteRatio": 0.8,
    "trafficJamAheadMin": 40.0,
    "highwayRemainingMin": 60.0,
}

# Low risk — no candidate.
_LOW_RAW = {
    "drowsinessLevel": 5.0,
    "fatigueLevel": 5.0,
    "attentionLevel": 95.0,
    "steeringInstabilityLevel": 0.0,
    "speedKph": 60.0,
    "nextRestSpotMin": 5.0,
    "isNight": False,
}


# ---------------------------------------------------------------------------
# Sanity: crafted inputs land where the tests assume
# ---------------------------------------------------------------------------


def test_high_raw_rest_score_in_proposal_band():
    feats = mod.extract_features(_HIGH_RAW, _norm_from_raw(_HIGH_RAW))
    scores = mod.category_scores(feats, HP)
    assert 0.62 < scores["rest_required_score"] < 0.88
    # monotony stays below its suggest threshold for the high-rest raw.
    assert scores["monotony_prevention_score"] < HP["monotony_suggest_threshold"]


# ---------------------------------------------------------------------------
# Smoothing
# ---------------------------------------------------------------------------


def test_smoothing_damps_one_tick_spike():
    """A 1-tick feature spike does NOT jump the smoothed feature vs the prev value."""
    prev = _steady_state(_LOW_RAW)
    low_feats = mod.extract_features(_LOW_RAW, _norm_from_raw(_LOW_RAW))

    # Spike: drowsiness jumps to 1.0 for a single tick.
    spike_raw = dict(_LOW_RAW, drowsinessLevel=100.0)
    res = mod.evaluate(_ctx(spike_raw, prev_state=prev))

    smoothed_after = res["next_package_runtime_state"]["smoothed_features"]
    # alpha=0.35: smoothed drowsiness = 0.35*1.0 + 0.65*low, never near the raw spike.
    assert smoothed_after["drowsiness"] < 0.5
    assert smoothed_after["drowsiness"] > low_feats["drowsiness"]

    # The smoothed rest score is far below the UNSMOOTHED spike score.
    unsmoothed = mod.category_scores(
        mod.extract_features(spike_raw, _norm_from_raw(spike_raw)), HP
    )
    assert res["scores"]["rest_required_score"] < unsmoothed["rest_required_score"] - 0.15
    # A single spike never fires.
    assert res["result_type"] in ("NO_PROPOSAL", "SUPPRESSED")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def test_persistence_gates_firing():
    """A single over-threshold tick does NOT fire until the counter clears."""
    prev = _steady_state(_HIGH_RAW, counter_rest=0, vel_rest=0.02)

    r1 = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev))
    assert r1["result_type"] == "SUPPRESSED", r1["result_type"]
    assert r1["next_package_runtime_state"]["persistence_counters"]["rest_required"] == 1
    # The rest candidate is retained and marked suppressed by the persistence gate.
    rest_cand = next(c for c in r1["candidates"] if c["category"] == "rest_required")
    assert rest_cand["exists"] is True
    assert rest_cand["fire_control"]["fired"] is False
    assert rest_cand["fire_control"]["suppressed"] is True

    # Thread the returned state: the 2nd consecutive over-threshold tick fires.
    r2 = mod.evaluate(_ctx(_HIGH_RAW, prev_state=r1["next_package_runtime_state"]))
    assert r2["result_type"] == "REST_PROPOSAL", r2["result_type"]
    assert r2["selected_category"] == "rest_required"
    assert r2["proposal"] is not None


def test_skip_if_score_bypasses_persistence():
    """score > 0.88 fires on the first over-threshold tick (skip-if)."""
    prev = _steady_state(_MAX_RAW, counter_rest=0, vel_rest=0.0)
    r1 = mod.evaluate(_ctx(_MAX_RAW, prev_state=prev))
    assert r1["result_type"] == "REST_PROPOSAL"
    assert r1["score"] > 0.88


def test_skip_if_velocity_bypasses_persistence():
    """velocity > 0.08 fires on the first over-threshold tick (skip-if)."""
    prev = _steady_state(_HIGH_RAW, counter_rest=0, vel_rest=0.20)
    r1 = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev))
    assert r1["result_type"] == "REST_PROPOSAL"


# ---------------------------------------------------------------------------
# State machines
# ---------------------------------------------------------------------------


def test_rest_state_machine_bands():
    assert mod.rest_state_label(0.30, False, HP) == "REST_NORMAL"
    assert mod.rest_state_label(0.50, False, HP) == "REST_WATCH"
    assert mod.rest_state_label(0.65, False, HP) == "REST_SUGGEST"
    assert mod.rest_state_label(0.80, False, HP) == "REST_RECOMMEND"
    assert mod.rest_state_label(0.92, False, HP) == "REST_URGENT"
    # ->RECOVERY when an accept has been observed.
    assert mod.rest_state_label(0.92, True, HP) == "REST_RECOVERY"


def test_monotony_state_machine_bands():
    assert mod.monotony_state_label(0.30, HP) == "MONOTONY_NORMAL"
    assert mod.monotony_state_label(0.45, HP) == "MONOTONY_WATCH"
    assert mod.monotony_state_label(0.60, HP) == "MONOTONY_CONTENT_SUGGEST"


def test_state_machine_advances_with_rising_score():
    """The recorded rest_state advances through the bands as the score rises."""
    seq = [_LOW_RAW, dict(_HIGH_RAW, drowsinessLevel=40.0, fatigueLevel=40.0),
           _HIGH_RAW, _MAX_RAW]
    prev = {}
    seen = []
    for raw in seq:
        # warm the smoother toward the target so each step reflects the rising input.
        for _ in range(6):
            res = mod.evaluate(_ctx(raw, prev_state=prev))
            prev = res["next_package_runtime_state"]
        seen.append(res["states"]["rest"])
    # Non-decreasing band order, visiting NORMAL then a proposal-or-watch band then URGENT.
    order = {
        "REST_NORMAL": 0, "REST_WATCH": 1, "REST_SUGGEST": 2,
        "REST_RECOMMEND": 3, "REST_URGENT": 4, "REST_RECOVERY": 5,
    }
    ranks = [order[s] for s in seen]
    assert ranks == sorted(ranks), seen
    assert ranks[0] == 0
    assert ranks[-1] == 4


# ---------------------------------------------------------------------------
# Fire-control cooldown
# ---------------------------------------------------------------------------


def test_fire_control_cooldown_suppresses_too_soon():
    """A too-soon second proposal is suppressed via proposal_history cooldown."""
    prev = _steady_state(_HIGH_RAW, counter_rest=2, vel_rest=0.0)

    too_soon = {
        "lastProposalTimeSec": 3600.0 - 10.0,
        "lastProposalCategory": "rest_required",
        "lastProposalResult": "postpone",
        "proposalCountLast30Min": 1,
        "acceptanceRateRecent": 0.0,
    }
    r_sup = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev, proposal_history=too_soon, sim_time=3600.0))
    assert r_sup["result_type"] == "SUPPRESSED"
    rest_cand = next(c for c in r_sup["candidates"] if c["category"] == "rest_required")
    assert rest_cand["fire_control"]["suppressed"] is True
    assert "cooldown" in (rest_cand["fire_control"]["reason"] or "")

    # Long ago -> cooldown elapsed -> fires.
    long_ago = dict(too_soon, lastProposalTimeSec=10.0)
    r_fire = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev, proposal_history=long_ago, sim_time=3600.0))
    assert r_fire["result_type"] == "REST_PROPOSAL"


def test_fire_control_count_limit_suppresses():
    """The 30-min count limit suppresses once the cap is reached."""
    prev = _steady_state(_HIGH_RAW, counter_rest=2, vel_rest=0.0)
    capped = dict(
        _EMPTY_PH,
        proposalCountLast30Min=int(HP["max_proposals_per_30min"]),
    )
    r = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev, proposal_history=capped))
    assert r["result_type"] == "SUPPRESSED"
    rest_cand = next(c for c in r["candidates"] if c["category"] == "rest_required")
    assert "rate_limit" in (rest_cand["fire_control"]["reason"] or "") or \
           "count" in (rest_cand["fire_control"]["reason"] or "")


# ---------------------------------------------------------------------------
# Priority + suppressed retained
# ---------------------------------------------------------------------------


def test_priority_rest_over_monotony_suppressed_retained():
    """rest selected over monotony when both fire; all candidates retained."""
    feats = mod.extract_features(_BOTH_RAW, _norm_from_raw(_BOTH_RAW))
    scores = mod.category_scores(feats, HP)
    assert scores["rest_required_score"] >= HP["threshold_suggest"]
    assert scores["monotony_prevention_score"] >= HP["monotony_suggest_threshold"]

    prev = _steady_state(_BOTH_RAW, counter_rest=2, counter_mono=3, vel_rest=0.0, vel_mono=0.0)
    r = mod.evaluate(_ctx(_BOTH_RAW, prev_state=prev))
    assert r["result_type"] == "REST_PROPOSAL"
    assert r["selected_category"] == "rest_required"
    # Both candidates retained in the trace.
    cats = {c["category"] for c in r["candidates"]}
    assert {"rest_required", "monotony_prevention"} <= cats


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_sequence_identical_trace_and_state():
    seq = [_LOW_RAW, _HIGH_RAW, _HIGH_RAW, _MAX_RAW, _HIGH_RAW]

    def run():
        prev = {}
        out = []
        for raw in seq:
            res = mod.evaluate(_ctx(raw, prev_state=prev))
            prev = res["next_package_runtime_state"]
            out.append((res["result_type"], res["score"], res["selected_category"], prev))
        return out

    assert run() == run()


# ---------------------------------------------------------------------------
# Runtime-state threading evolves
# ---------------------------------------------------------------------------


def test_runtime_state_threading_evolves_smoothed_values():
    """Feeding next_package_runtime_state back changes the smoothed values."""
    prev = {}
    smoothed_series = []
    for _ in range(4):
        res = mod.evaluate(_ctx(_HIGH_RAW, prev_state=prev))
        nrs = res["next_package_runtime_state"]
        assert nrs, "next_package_runtime_state must be non-empty"
        assert set(nrs) >= {"smoothed_features", "smoothed_scores", "persistence_counters", "states"}
        smoothed_series.append(nrs["smoothed_scores"]["rest_required_score"])
        prev = nrs
    # The smoothed rest score rises monotonically toward steady state (state carried fwd).
    assert smoothed_series[0] < smoothed_series[1] < smoothed_series[2]
    assert smoothed_series == sorted(smoothed_series)


# ===========================================================================
# T012 — end-to-end over a UC-01 rest scenario through the run loop
# ===========================================================================


@pytest.fixture(autouse=True)
def _reset_registries():
    _clear_run_registry()
    clear_draft_registry()
    yield
    _clear_run_registry()
    clear_draft_registry()


def _hybrid_package():
    registry = PackageRegistry(settings.packages_dir)
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None, "aica_transparent_hybrid_trigger_v1 not in registry"
    return pkg


def _scenario():
    registry = ScenarioRegistry(settings.scenarios_dir)
    sc = registry.get(_SCENARIO_ID)
    assert sc is not None, f"{_SCENARIO_ID} not in scenario registry"
    return sc


def _run_to_end(tmp_path, plan_id="hybrid_plan", run_id="hybrid_run"):
    pkg = _hybrid_package()
    sc = _scenario()
    create_draft(
        plan_id=plan_id,
        package=pkg,
        scenario=sc,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    _create_run(plan_id=plan_id, run_id=run_id, runs_dir=tmp_path)

    decisions = []
    runtime_states = []
    for _ in range(600):  # generous safety cap
        outcome = _tick(run_id)
        if outcome.decision is not None:
            decisions.append(outcome.decision)
            runtime_states.append(outcome.decision.next_package_runtime_state)
        if outcome.completed or outcome.paused:
            break
    return decisions, runtime_states, outcome


def test_e2e_friend_drive_fires_exactly_one_rest_proposal(tmp_path):
    decisions, runtime_states, outcome = _run_to_end(tmp_path)

    rest_proposals = [d for d in decisions if d.result_type == "REST_PROPOSAL"]
    assert len(rest_proposals) == 1, (
        f"Expected exactly one REST_PROPOSAL, got {len(rest_proposals)} "
        f"(types: {[d.result_type for d in decisions]})"
    )
    assert outcome.paused is True, "Run must pause on the actionable rest proposal"

    rp = rest_proposals[0]
    # Full reviewable trace.
    assert rp.scores and {"base_safety_risk", "rest_required_score", "monotony_prevention_score"} <= set(rp.scores)
    assert rp.states and {"rest", "monotony"} <= set(rp.states)
    assert rp.candidates and any(c.category == "rest_required" for c in rp.candidates)
    assert rp.fire_control.fired is True
    assert rp.proposal is not None and rp.proposal.message
    assert rp.explanation
    assert rp.reason_inputs

    # Non-empty, EVOLVING next_package_runtime_state across ticks.
    assert all(s for s in runtime_states), "every tick must record runtime state"
    rest_score_series = [s["smoothed_scores"]["rest_required_score"] for s in runtime_states]
    assert len(set(rest_score_series)) > 1, "smoothed scores must evolve across ticks"
    counters = [s["persistence_counters"]["rest_required"] for s in runtime_states]
    assert max(counters) >= 1, "persistence counter must advance"


def test_e2e_friend_drive_pre_proposal_no_rest(tmp_path):
    decisions, _runtime_states, _outcome = _run_to_end(tmp_path)
    # Every decision before the (final) proposal must not be a REST_PROPOSAL.
    for d in decisions[:-1]:
        assert d.result_type != "REST_PROPOSAL", (
            f"Unexpected early REST_PROPOSAL: {[x.result_type for x in decisions]}"
        )


def test_e2e_friend_drive_determinism(tmp_path):
    d1, rs1, _ = _run_to_end(tmp_path, plan_id="p1", run_id="r1")
    d2, rs2, _ = _run_to_end(tmp_path, plan_id="p2", run_id="r2")
    trace1 = [(d.result_type, d.score, d.selected_category) for d in d1]
    trace2 = [(d.result_type, d.score, d.selected_category) for d in d2]
    assert trace1 == trace2
    assert rs1 == rs2
