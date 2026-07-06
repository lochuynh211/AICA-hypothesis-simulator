"""TDD tests for the compact-9-feature transparent hybrid package (feature 009, Unit D).

The headline 009 deliverable: `aica_transparent_hybrid_trigger_v1` rewritten onto the
tiered-signal contract (`context["signals"] = {fixed, dynamic, simulated}`) with the
compact 9-feature form (adds driving_time + childPassenger bonus; one stochastic signal `anomaly_rate`).

Authoritative math: `specs/009-signal-tier-redesign/data-model.md` §5 and
`others/aica_trigger_algorithms_math_comparison.md` Part 2 §2.3.
Context shape: `specs/009-signal-tier-redesign/contracts/tiered-context.md`.

Everything downstream of feature extraction (smoothing, category-score structure,
velocity, persistence, state machines, fire-control, priority, proposal/explanation,
next_package_runtime_state threading) is UNCHANGED from the pre-009 Hybrid — only the
feature *inputs* changed. Those behaviors are re-verified here on the new context shape.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1"
_PKG_ALG = _PKG_DIR / "algorithm.py"
_PKG_JSON = _PKG_DIR / "package.json"


# ---------------------------------------------------------------------------
# Load the package algorithm module directly (white-box unit driving evaluate)
# ---------------------------------------------------------------------------


def _load_module():
    spec = importlib.util.spec_from_file_location("hybrid_alg_under_test_009", _PKG_ALG)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


mod = _load_module()


def _default_hp() -> dict:
    """Read declared hyperparameter defaults from the package manifest (single source)."""
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


# ---------------------------------------------------------------------------
# Tiered-signal context builder
# ---------------------------------------------------------------------------


def _signals(
    *,
    drowsiness=0.0,
    fatigue=0.0,
    anomaly_rate=0.0,
    is_night=False,
    familiar_route=False,
    weather_risk_level=0.0,
    segment_type="normal_road",
    motion_state="MOVING",
    is_traffic_jam=False,
    next_rest_spot_min=9999.0,
    recovery_phase=None,
    child_passenger=False,
    continuous_driving_min=0.0,
    speed_kph=80.0,
    route_fraction=0.0,
) -> dict:
    return {
        "fixed": {
            "isNight": is_night,
            "familiarRoute": familiar_route,
            "childPassenger": child_passenger,
            "weatherRiskLevel": weather_risk_level,
        },
        "dynamic": {
            "segmentType": segment_type,
            "motionState": motion_state,
            "continuousDrivingMin": continuous_driving_min,
            "speedKph": speed_kph,
            "routeFraction": route_fraction,
            "nextRestSpotMin": next_rest_spot_min,
            "isTrafficJam": is_traffic_jam,
            "recoveryPhase": recovery_phase,
        },
        "simulated": {
            "drowsiness": drowsiness,
            "fatigue": fatigue,
            "anomaly_rate": anomaly_rate,
        },
    }


def _ctx(
    signals,
    prev_state=None,
    proposal_history=None,
    sim_time=3600.0,
    hp=None,
    recovery_active=False,
):
    return {
        "simulation_time_sec": sim_time,
        "signals": signals,
        "feature_groups": {"normalized": {}, "ordinal": {}},
        "hyperparameters": hp if hp is not None else HP,
        "parameters": {},
        "proposal_history": proposal_history or dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
        "recovery_active": recovery_active,
    }


def _steady_state(signals, hp=None, counter_rest=0, counter_mono=0, vel_rest=0.0, vel_mono=0.0,
                   accumulators=None, prev_sim_time_sec=None):
    """Build a prev runtime state at steady-state for the given signals.

    When threaded with the SAME signals/accumulators, smoothed features == feats
    (stable), so the category scores stay constant and the per-tick velocity
    equals vel_rest/vel_mono.
    """
    hp = hp if hp is not None else HP
    accumulators = accumulators if accumulators is not None else {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}
    feats = mod.extract_features(signals, accumulators, hp)
    scores = mod.category_scores(feats, hp)
    state = {
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
        "accumulators": accumulators,
    }
    if prev_sim_time_sec is not None:
        state["prev_sim_time_sec"] = prev_sim_time_sec
    return state


# Crafted tiered signals ------------------------------------------------------

# rest_required in (0.58, 0.88) — fires REST_PROPOSAL once persistence clears.
_HIGH_SIGNALS = _signals(
    drowsiness=70.0, fatigue=70.0, anomaly_rate=2.0, next_rest_spot_min=10.0,
)

# rest_required = 1.0 (> 0.88) — skip-if (score) bypasses persistence; strength strong.
_MAX_SIGNALS = _signals(
    drowsiness=100.0, fatigue=100.0, anomaly_rate=25.0, next_rest_spot_min=10.0,
)

# Both rest and monotony over their suggest thresholds (env_load + monotony pushed
# up via traffic jam / highway segment / night / monotony accumulators).
_BOTH_SIGNALS = _signals(
    drowsiness=70.0, fatigue=70.0, anomaly_rate=2.0, next_rest_spot_min=10.0,
    is_night=True, familiar_route=True, is_traffic_jam=True, segment_type="highway",
)
_BOTH_ACCUMULATORS = {"jam_min": 20.0, "hw_min": 60.0, "mono_min": 30.0}

# Low risk — no candidate.
_LOW_SIGNALS = _signals(
    drowsiness=5.0, fatigue=5.0, anomaly_rate=0.0, next_rest_spot_min=5.0,
)


# ---------------------------------------------------------------------------
# Feature extraction — the compact 9-feature form
# ---------------------------------------------------------------------------


def test_extract_features_returns_exactly_the_compact_9_keys():
    feats = mod.extract_features(_HIGH_SIGNALS, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert set(feats) == {
        "drowsiness", "fatigue", "driving_anomaly", "driving_time", "env_load",
        "monotony", "rest_window", "rest_scarcity", "familiar_route",
    }
    for key, value in feats.items():
        assert 0.0 <= value <= 1.0, f"{key}={value} not in [0,1]"


def test_drowsiness_fatigue_are_signal_over_100():
    signals = _signals(drowsiness=62.0, fatigue=40.0)
    feats = mod.extract_features(signals, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert feats["drowsiness"] == 0.62
    assert feats["fatigue"] == 0.40


def test_driving_anomaly_tracks_anomaly_rate_over_k():
    hp = dict(HP, K=5)
    signals = _signals(anomaly_rate=2.0)
    feats = mod.extract_features(signals, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, hp)
    assert feats["driving_anomaly"] == 2.0 / 5.0

    # Clamped at 1.0 once anomaly_rate/K exceeds 1.
    signals_high = _signals(anomaly_rate=25.0)
    feats_high = mod.extract_features(signals_high, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, hp)
    assert feats_high["driving_anomaly"] == 1.0


def test_env_load_from_accumulators_and_traffic_jam_and_weather():
    # isTrafficJam true -> jam term pinned at 1.0 regardless of jam_min.
    signals_jam = _signals(is_traffic_jam=True, weather_risk_level=0.0)
    feats = mod.extract_features(signals_jam, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert feats["env_load"] == 0.5

    # No current jam -> jam term from accumulated jam_min/20.
    signals_no_jam = _signals(is_traffic_jam=False)
    feats2 = mod.extract_features(signals_no_jam, {"jam_min": 10.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert feats2["env_load"] == 0.5 * 0.5

    # hw_min/60 contributes the 0.3 term.
    feats3 = mod.extract_features(signals_no_jam, {"jam_min": 0.0, "hw_min": 30.0, "mono_min": 0.0}, HP)
    assert abs(feats3["env_load"] - 0.3 * 0.5) < 1e-9

    # weatherRiskLevel/100 contributes the 0.2 term.
    signals_weather = _signals(is_traffic_jam=False, weather_risk_level=50.0)
    feats4 = mod.extract_features(signals_weather, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert abs(feats4["env_load"] - 0.2 * 0.5) < 1e-9


def test_monotony_from_mono_min_accumulator_and_is_night():
    signals_day = _signals(is_night=False)
    feats = mod.extract_features(signals_day, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 15.0}, HP)
    assert abs(feats["monotony"] - 0.6 * 0.5) < 1e-9

    signals_night = _signals(is_night=True)
    feats2 = mod.extract_features(signals_night, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert abs(feats2["monotony"] - 0.4) < 1e-9


def test_rest_window_banded_and_rest_scarcity_continuous():
    assert mod._rest_window_score(9999.0) == 0.0
    assert mod._rest_window_score(3.0) == 0.6
    assert mod._rest_window_score(10.0) == 1.0
    assert mod._rest_window_score(20.0) == 0.6
    assert mod._rest_window_score(50.0) == 0.2

    # rest_scarcity = clamp((next_rest_min - 10) / 50)
    assert mod._rest_scarcity_score(10.0) == 0.0
    assert mod._rest_scarcity_score(0.0) == 0.0  # clamped at 0
    assert mod._rest_scarcity_score(60.0) == 1.0
    assert abs(mod._rest_scarcity_score(35.0) - 0.5) < 1e-9


def test_familiar_route_boolean_to_feature():
    feats_true = mod.extract_features(_signals(familiar_route=True), {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    feats_false = mod.extract_features(_signals(familiar_route=False), {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert feats_true["familiar_route"] == 1.0
    assert feats_false["familiar_route"] == 0.0


# ---------------------------------------------------------------------------
# driving_time — banded time-on-task feature (continuousDrivingMin, reset on rest)
# ---------------------------------------------------------------------------


def test_driving_time_band_boundaries():
    assert mod._driving_time_score(0.0) == 0.0
    assert mod._driving_time_score(59.0) == 0.0
    assert mod._driving_time_score(60.0) == 0.4
    assert mod._driving_time_score(119.0) == 0.4
    assert mod._driving_time_score(120.0) == 0.7
    assert mod._driving_time_score(179.0) == 0.7
    assert mod._driving_time_score(180.0) == 1.0
    assert mod._driving_time_score(500.0) == 1.0


def test_driving_time_feature_from_drive_min_since_rest_accumulator():
    feats = mod.extract_features(
        _signals(),
        {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0, "drive_min_since_rest": 130.0},
        HP,
    )
    assert feats["driving_time"] == 0.7


def test_driving_time_defaults_to_zero_when_accumulator_absent():
    """Back-compat: callers passing only jam/hw/mono get driving_time == 0, so the
    pre-existing crafted-signal calibration is preserved."""
    feats = mod.extract_features(_signals(), {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert feats["driving_time"] == 0.0


def test_driving_time_raises_base_safety_risk_by_its_weight():
    signals = _signals(drowsiness=40.0, fatigue=40.0, next_rest_spot_min=10.0)
    acc_fresh = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0, "drive_min_since_rest": 0.0}
    acc_long = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0, "drive_min_since_rest": 200.0}
    base_fresh = mod.category_scores(mod.extract_features(signals, acc_fresh, HP), HP)["base_safety_risk"]
    base_long = mod.category_scores(mod.extract_features(signals, acc_long, HP), HP)["base_safety_risk"]
    assert base_long > base_fresh
    # driving_time raw = 1.0 at 200 min -> adds exactly w_driving_time to base.
    assert abs((base_long - base_fresh) - HP["w_driving_time"] * 1.0) < 1e-9


def test_drive_min_since_rest_rebaselines_while_recovery_active():
    """continuousDrivingMin is monotonic (the engine never resets it). The Hybrid
    rebaselines its since-rest clock while recovery_active, so time-on-task drops
    to its lowest band right after a rest even though continuousDrivingMin climbs."""
    pre = _signals(drowsiness=40.0, fatigue=40.0, next_rest_spot_min=10.0, continuous_driving_min=200.0)
    r_pre = mod.evaluate(_ctx(pre, prev_state={}, recovery_active=False))
    assert r_pre["next_package_runtime_state"]["smoothed_features"]["driving_time"] > 0.0
    assert r_pre["next_package_runtime_state"]["drive_min_baseline"] == 0.0

    # Rest: recovery_active True; continuousDrivingMin still rising (engine counts stopped time).
    resting = _signals(drowsiness=10.0, fatigue=10.0, continuous_driving_min=205.0)
    r_rest = mod.evaluate(_ctx(resting, prev_state=r_pre["next_package_runtime_state"], recovery_active=True))
    assert r_rest["next_package_runtime_state"]["drive_min_baseline"] == 205.0

    # Resume driving shortly after: since-rest is small -> driving_time raw band 0.
    resumed = _signals(drowsiness=30.0, fatigue=30.0, next_rest_spot_min=10.0, continuous_driving_min=210.0)
    r_resume = mod.evaluate(_ctx(resumed, prev_state=r_rest["next_package_runtime_state"], recovery_active=False))
    assert r_resume["next_package_runtime_state"]["drive_min_baseline"] == 205.0
    assert mod._driving_time_score(210.0 - 205.0) == 0.0


def test_monotony_and_env_exposure_rebaseline_after_rest():
    """The jam/highway/monotony accumulators are measured SINCE THE LAST REST: a
    rest rebaselines them so monotony DROPS afterwards and rebuilds, instead of
    saturating and never falling. Regression for 'monotony not decrease after rest'."""
    # Drive a long monotonous highway stretch (advance sim_time so mono_min grows).
    st: dict = {}
    t = 3600.0
    for i in range(6):
        sig = _signals(segment_type="highway", motion_state="MOVING", continuous_driving_min=(i + 1) * 30.0)
        st = mod.evaluate(_ctx(sig, prev_state=st, sim_time=t))["next_package_runtime_state"]
        t += 1800.0  # +30 min/tick

    mono_driving = st["smoothed_features"]["monotony"]
    cumulative_mono = st["accumulators"]["mono_min"]
    assert mono_driving > 0.2 and cumulative_mono >= 100.0  # built up + saturated

    # Rest: recovery_active True -> baseline captures the current cumulative totals.
    resting = _signals(segment_type="highway", motion_state="STOPPED", continuous_driving_min=210.0)
    r_rest = mod.evaluate(_ctx(resting, prev_state=st, sim_time=t, recovery_active=True))
    base = r_rest["next_package_runtime_state"]["accum_baseline"]
    assert base["mono_min"] == cumulative_mono
    assert "jam_min" in base and "hw_min" in base  # env_load exposure rebaselined too

    # Resume shortly after (small delta) -> since-rest monotony ~0 -> smoothed DROPS.
    resumed = _signals(segment_type="highway", motion_state="MOVING", continuous_driving_min=211.0)
    r_resume = mod.evaluate(_ctx(resumed, prev_state=r_rest["next_package_runtime_state"], sim_time=t + 60.0))
    mono_after = r_resume["next_package_runtime_state"]["smoothed_features"]["monotony"]
    assert mono_after < mono_driving, f"monotony must fall after a rest: {mono_after} !< {mono_driving}"


# ---------------------------------------------------------------------------
# child_passenger — fixed additive bonus into rest_required_score (raw, not smoothed)
# ---------------------------------------------------------------------------


def test_child_passenger_adds_fixed_bonus_to_rest_required_score_only():
    feats = mod.extract_features(_HIGH_SIGNALS, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    no_child = mod.category_scores(feats, HP, child_passenger=False)
    with_child = mod.category_scores(feats, HP, child_passenger=True)
    delta = with_child["rest_required_score"] - no_child["rest_required_score"]
    assert abs(delta - HP["w_child_bonus"]) < 1e-9
    # base_safety_risk and monotony are untouched by the child bonus.
    assert with_child["base_safety_risk"] == no_child["base_safety_risk"]
    assert with_child["monotony_prevention_score"] == no_child["monotony_prevention_score"]


def test_child_bonus_does_not_unlock_rest_spot_bonus_gate():
    """The child bonus lands in rest_required_score, NOT base_safety_risk, so it must
    not open the base >= minimum_risk_for_rest_bonus gate on its own."""
    signals = _signals(drowsiness=20.0, fatigue=10.0, next_rest_spot_min=10.0)  # low base
    feats = mod.extract_features(signals, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    base = mod.category_scores(feats, HP)["base_safety_risk"]
    assert base < HP["minimum_risk_for_rest_bonus"]  # gate closed
    with_child = mod.category_scores(feats, HP, child_passenger=True)
    # rest score == base + 0 (gate closed, no rest-spot bonus) + child_bonus only.
    assert abs(with_child["rest_required_score"] - (base + HP["w_child_bonus"])) < 1e-9


def test_child_bonus_applies_from_tick_zero_not_ramped():
    """The child bonus is a raw constant: it applies fully on tick 0, unlike a
    smoothed feature which would ramp in over several ticks."""
    child = _signals(drowsiness=50.0, fatigue=50.0, next_rest_spot_min=10.0, child_passenger=True)
    plain = _signals(drowsiness=50.0, fatigue=50.0, next_rest_spot_min=10.0, child_passenger=False)
    r_child = mod.evaluate(_ctx(child, prev_state={}))
    r_plain = mod.evaluate(_ctx(plain, prev_state={}))
    delta = r_child["scores"]["rest_required_score"] - r_plain["scores"]["rest_required_score"]
    assert abs(delta - HP["w_child_bonus"]) < 1e-9


# ---------------------------------------------------------------------------
# Accumulators — advance only while MOVING
# ---------------------------------------------------------------------------


def test_accumulators_advance_only_while_moving():
    dynamic_moving = {"motionState": "MOVING", "isTrafficJam": True, "segmentType": "highway"}
    prev_state = {"prev_sim_time_sec": 0.0, "accumulators": {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}}
    acc = mod.advance_accumulators(dynamic_moving, prev_state, sim_time=60.0)
    # 60 sec elapsed -> 1.0 min; isTrafficJam + highway (also monotonous) -> all three advance.
    assert acc["jam_min"] == 1.0
    assert acc["hw_min"] == 1.0
    assert acc["mono_min"] == 1.0

    dynamic_stopped = {"motionState": "STOPPED", "isTrafficJam": True, "segmentType": "highway"}
    acc_stopped = mod.advance_accumulators(dynamic_stopped, prev_state, sim_time=60.0)
    assert acc_stopped == {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}


def test_accumulators_zero_delta_on_first_tick_no_prior_state():
    dynamic_moving = {"motionState": "MOVING", "isTrafficJam": True, "segmentType": "highway"}
    acc = mod.advance_accumulators(dynamic_moving, {}, sim_time=30.0)
    assert acc == {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}


def test_accumulators_carry_forward_across_ticks_via_evaluate():
    """The accumulators returned in next_package_runtime_state feed the NEXT tick."""
    signals = _signals(segment_type="highway", is_traffic_jam=True, motion_state="MOVING")
    prev = {}
    accs = []
    sim_time = 0.0
    for _ in range(3):
        res = mod.evaluate(_ctx(signals, prev_state=prev, sim_time=sim_time))
        prev = res["next_package_runtime_state"]
        accs.append(prev["accumulators"]["jam_min"])
        sim_time += 30.0
    # Strictly increasing (30s = 0.5 min per tick while jammed and moving).
    assert accs[0] < accs[1] < accs[2]
    assert abs(accs[2] - 1.0) < 1e-9  # 2 full ticks of 0.5 min each after tick 0's zero delta


# ---------------------------------------------------------------------------
# No removed keys are read (guards against reintroducing dead L-tier inputs)
# ---------------------------------------------------------------------------


def test_extract_features_ignores_absent_removed_signals():
    """A context missing every old removed key (attention/steering/etc.) still
    extracts cleanly — the compact form never reads them."""
    minimal_signals = {
        "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
        "dynamic": {"segmentType": "normal_road", "motionState": "MOVING", "nextRestSpotMin": 9999.0, "isTrafficJam": False},
        "simulated": {"drowsiness": 10.0, "fatigue": 10.0, "anomaly_rate": 0},
    }
    feats = mod.extract_features(minimal_signals, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    assert set(feats) == set(mod.FEATURE_KEYS)


# ---------------------------------------------------------------------------
# Sanity: crafted inputs land where the tests assume
# ---------------------------------------------------------------------------


def test_high_signals_rest_score_in_proposal_band():
    feats = mod.extract_features(_HIGH_SIGNALS, {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}, HP)
    scores = mod.category_scores(feats, HP)
    assert HP["threshold_suggest"] < scores["rest_required_score"] < HP["threshold_urgent"]
    assert scores["monotony_prevention_score"] < HP["monotony_suggest_threshold"]


# ---------------------------------------------------------------------------
# Smoothing
# ---------------------------------------------------------------------------


def test_smoothing_damps_one_tick_spike():
    """A 1-tick feature spike does NOT jump the smoothed feature vs the prev value."""
    accumulators = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}
    prev = _steady_state(_LOW_SIGNALS, accumulators=accumulators)
    low_feats = mod.extract_features(_LOW_SIGNALS, accumulators, HP)

    # Spike: drowsiness jumps to 100 for a single tick.
    spike_signals = _signals(drowsiness=100.0, fatigue=5.0, next_rest_spot_min=5.0)
    res = mod.evaluate(_ctx(spike_signals, prev_state=prev))

    smoothed_after = res["next_package_runtime_state"]["smoothed_features"]
    # alpha=0.35: smoothed drowsiness = 0.35*1.0 + 0.65*low, never near the raw spike.
    assert smoothed_after["drowsiness"] < 0.5
    assert smoothed_after["drowsiness"] > low_feats["drowsiness"]

    # The smoothed rest score is far below the UNSMOOTHED spike score.
    unsmoothed = mod.category_scores(
        mod.extract_features(spike_signals, accumulators, HP), HP
    )
    assert res["scores"]["rest_required_score"] < unsmoothed["rest_required_score"] - 0.15
    # A single spike never fires.
    assert res["result_type"] in ("NO_PROPOSAL", "SUPPRESSED")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def test_persistence_gates_firing():
    """A single over-threshold tick does NOT fire until the counter clears."""
    prev = _steady_state(_HIGH_SIGNALS, counter_rest=0, vel_rest=0.02)

    r1 = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev))
    assert r1["result_type"] == "SUPPRESSED", r1["result_type"]
    assert r1["next_package_runtime_state"]["persistence_counters"]["rest_required"] == 1
    # The rest candidate is retained and marked suppressed by the persistence gate.
    rest_cand = next(c for c in r1["candidates"] if c["category"] == "rest_required")
    assert rest_cand["exists"] is True
    assert rest_cand["fire_control"]["fired"] is False
    assert rest_cand["fire_control"]["suppressed"] is True

    # Thread the returned state: the 2nd consecutive over-threshold tick fires.
    r2 = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=r1["next_package_runtime_state"]))
    assert r2["result_type"] == "REST_PROPOSAL", r2["result_type"]
    assert r2["selected_category"] == "rest_required"
    assert r2["proposal"] is not None


def test_skip_if_score_bypasses_persistence():
    """score > 0.88 fires on the first over-threshold tick (skip-if)."""
    prev = _steady_state(_MAX_SIGNALS, counter_rest=0, vel_rest=0.0)
    r1 = mod.evaluate(_ctx(_MAX_SIGNALS, prev_state=prev))
    assert r1["result_type"] == "REST_PROPOSAL"
    assert r1["score"] > HP["skip_if_score"]


def test_skip_if_velocity_bypasses_persistence():
    """velocity > 0.08 fires on the first over-threshold tick (skip-if)."""
    prev = _steady_state(_HIGH_SIGNALS, counter_rest=0, vel_rest=0.20)
    r1 = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev))
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
    seq = [
        _LOW_SIGNALS,
        _signals(drowsiness=40.0, fatigue=40.0, next_rest_spot_min=10.0),
        _HIGH_SIGNALS,
        _MAX_SIGNALS,
    ]
    prev = {}
    seen = []
    for signals in seq:
        # warm the smoother toward the target so each step reflects the rising input.
        for _ in range(6):
            res = mod.evaluate(_ctx(signals, prev_state=prev))
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
    prev = _steady_state(_HIGH_SIGNALS, counter_rest=2, vel_rest=0.0)

    too_soon = {
        "lastProposalTimeSec": 3600.0 - 10.0,
        "lastProposalCategory": "rest_required",
        "lastProposalResult": "postpone",
        "proposalCountLast30Min": 1,
        "acceptanceRateRecent": 0.0,
    }
    r_sup = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev, proposal_history=too_soon, sim_time=3600.0))
    assert r_sup["result_type"] == "SUPPRESSED"
    rest_cand = next(c for c in r_sup["candidates"] if c["category"] == "rest_required")
    assert rest_cand["fire_control"]["suppressed"] is True
    assert "cooldown" in (rest_cand["fire_control"]["reason"] or "")

    # Long ago -> cooldown elapsed -> fires.
    long_ago = dict(too_soon, lastProposalTimeSec=10.0)
    r_fire = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev, proposal_history=long_ago, sim_time=3600.0))
    assert r_fire["result_type"] == "REST_PROPOSAL"


def test_recovery_after_accept_suppresses_only_while_recovery_active():
    """REST_RECOVERY suppression is scoped to the active rest sequence.

    Regression: rest_recovered used to latch forever on lastProposalResult ==
    "accept_rest" (which never clears, since no later rest proposal is allowed
    to fire), leaving the algorithm stuck in REST_RECOVERY and suppressing every
    subsequent proposal with recovery_after_accept.  It must now depend on the
    adapter's recovery_active flag: True only while the driver is still resting.
    """
    prev = _steady_state(_HIGH_SIGNALS, counter_rest=2, vel_rest=0.0)
    accepted = {
        "lastProposalTimeSec": 10.0,  # long ago -> cooldown elapsed
        "lastProposalCategory": "rest_required",
        "lastProposalResult": "accept_rest",
        "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 1.0,
    }

    # Driver still resting -> suppressed as recovery_after_accept, state RECOVERY.
    r_resting = mod.evaluate(
        _ctx(_HIGH_SIGNALS, prev_state=prev, proposal_history=accepted,
             sim_time=3600.0, recovery_active=True)
    )
    assert r_resting["result_type"] == "SUPPRESSED"
    assert r_resting["states"]["rest"] == "REST_RECOVERY"
    rest_cand = next(c for c in r_resting["candidates"] if c["category"] == "rest_required")
    assert rest_cand["fire_control"]["reason"] == "recovery_after_accept"

    # Driver has resumed -> no longer in recovery -> evaluates normally and fires
    # the next proposal when drowsiness is high again.
    r_resumed = mod.evaluate(
        _ctx(_HIGH_SIGNALS, prev_state=prev, proposal_history=accepted,
             sim_time=3600.0, recovery_active=False)
    )
    assert r_resumed["states"]["rest"] != "REST_RECOVERY"
    assert r_resumed["result_type"] == "REST_PROPOSAL"
    rest_cand2 = next(c for c in r_resumed["candidates"] if c["category"] == "rest_required")
    assert rest_cand2["fire_control"]["reason"] != "recovery_after_accept"


def test_fire_control_count_limit_suppresses():
    """The 30-min count limit suppresses once the cap is reached."""
    prev = _steady_state(_HIGH_SIGNALS, counter_rest=2, vel_rest=0.0)
    capped = dict(
        _EMPTY_PH,
        proposalCountLast30Min=int(HP["max_proposals_per_30min"]),
    )
    r = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev, proposal_history=capped))
    assert r["result_type"] == "SUPPRESSED"
    rest_cand = next(c for c in r["candidates"] if c["category"] == "rest_required")
    assert "rate_limit" in (rest_cand["fire_control"]["reason"] or "") or \
           "count" in (rest_cand["fire_control"]["reason"] or "")


# ---------------------------------------------------------------------------
# Priority + suppressed retained
# ---------------------------------------------------------------------------


def test_priority_rest_over_monotony_suppressed_retained():
    """rest selected over monotony when both fire; all candidates retained."""
    feats = mod.extract_features(_BOTH_SIGNALS, _BOTH_ACCUMULATORS, HP)
    scores = mod.category_scores(feats, HP)
    assert scores["rest_required_score"] >= HP["threshold_suggest"]
    assert scores["monotony_prevention_score"] >= HP["monotony_suggest_threshold"]

    prev = _steady_state(
        _BOTH_SIGNALS, counter_rest=2, counter_mono=3, vel_rest=0.0, vel_mono=0.0,
        accumulators=_BOTH_ACCUMULATORS,
    )
    r = mod.evaluate(_ctx(_BOTH_SIGNALS, prev_state=prev))
    assert r["result_type"] == "REST_PROPOSAL"
    assert r["selected_category"] == "rest_required"
    # Both candidates retained in the trace.
    cats = {c["category"] for c in r["candidates"]}
    assert {"rest_required", "monotony_prevention"} <= cats


# ---------------------------------------------------------------------------
# No hyperparameter fallback — a missing key is a real error (FR-009)
# ---------------------------------------------------------------------------


def test_missing_hyperparameter_key_raises_keyerror_not_silent_default():
    """The algorithm indexes hp[key] directly; a caller that forgets a manifest
    key gets a loud KeyError, never a silently-wrong hardcoded fallback."""
    incomplete_hp = dict(HP)
    del incomplete_hp["w_drowsiness"]
    import pytest as _pytest

    with _pytest.raises(KeyError):
        mod.evaluate(_ctx(_HIGH_SIGNALS, hp=incomplete_hp))


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_sequence_identical_trace_and_state():
    seq = [_LOW_SIGNALS, _HIGH_SIGNALS, _HIGH_SIGNALS, _MAX_SIGNALS, _HIGH_SIGNALS]

    def run():
        prev = {}
        out = []
        sim_time = 0.0
        for signals in seq:
            res = mod.evaluate(_ctx(signals, prev_state=prev, sim_time=sim_time))
            prev = res["next_package_runtime_state"]
            out.append((res["result_type"], res["score"], res["selected_category"], prev))
            sim_time += 30.0
        return out

    assert run() == run()


def test_determinism_short_run_same_seed_identical_trace():
    """A short synthetic 'run' (fixed tick_seconds cadence, same seeded anomaly_rate
    series) reproduces an identical decision trace end to end — the same guarantee
    the real run loop relies on for replay."""
    rng_like_anomaly_series = [0.0, 1.0, 2.0, 2.0, 3.0, 2.0, 1.0, 0.0]

    def run_short_scenario():
        prev = {}
        sim_time = 0.0
        trace = []
        for i, anomaly_rate in enumerate(rng_like_anomaly_series):
            signals = _signals(
                drowsiness=20.0 + i * 8.0,
                fatigue=15.0 + i * 6.0,
                anomaly_rate=anomaly_rate,
                next_rest_spot_min=max(1.0, 30.0 - i * 4.0),
                is_night=(i >= 4),
                segment_type="highway" if i % 2 == 0 else "normal_road",
                is_traffic_jam=(i == 3),
            )
            res = mod.evaluate(_ctx(signals, prev_state=prev, sim_time=sim_time))
            prev = res["next_package_runtime_state"]
            trace.append((res["result_type"], res["score"], res["selected_category"]))
            sim_time += 30.0
        return trace, prev

    trace1, final_state1 = run_short_scenario()
    trace2, final_state2 = run_short_scenario()
    assert trace1 == trace2
    assert final_state1 == final_state2


# ---------------------------------------------------------------------------
# Runtime-state threading evolves
# ---------------------------------------------------------------------------


def test_runtime_state_threading_evolves_smoothed_values():
    """Feeding next_package_runtime_state back changes the smoothed values."""
    prev = {}
    smoothed_series = []
    for _ in range(4):
        res = mod.evaluate(_ctx(_HIGH_SIGNALS, prev_state=prev))
        nrs = res["next_package_runtime_state"]
        assert nrs, "next_package_runtime_state must be non-empty"
        assert set(nrs) >= {
            "smoothed_features", "smoothed_scores", "persistence_counters",
            "states", "accumulators", "prev_sim_time_sec",
        }
        smoothed_series.append(nrs["smoothed_scores"]["rest_required_score"])
        prev = nrs
    # The smoothed rest score rises monotonically toward steady state (state carried fwd).
    assert smoothed_series[0] < smoothed_series[1] < smoothed_series[2]
    assert smoothed_series == sorted(smoothed_series)
