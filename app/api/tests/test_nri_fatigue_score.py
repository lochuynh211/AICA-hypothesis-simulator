"""TDD tests for `nri_fatigue_score_v1` on the tiered-signal contract (feature 009, Unit E).

NRI's scoring math is UNCHANGED:

    S_total = S_base + S_env + S_realtime
    S_base    = child_offset + T_drive * W_base * M_night * M_familiar
    S_env     = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
    S_realtime = max(0, V_sleep - theta_sleep) * W_sleep + max(0, V_fatigue - theta_fatigue) * W_fatigue

Only the input SOURCE changes: flat `raw_state` -> tiered `context["signals"]`
(`specs/009-signal-tier-redesign/contracts/tiered-context.md`). The key behavior change
under test: `S_realtime` is now genuinely live because Tier-3a `drowsiness`/`fatigue`
signals exist (they were always 0 before 009).

Authoritative math: `others/aica_trigger_algorithms_math_comparison.md` Part 1 Section 1.2
and `specs/009-signal-tier-redesign/data-model.md` Section 6 (NRI unchanged).

This test must not read any removed flat key (`drowsinessLevel`, `isTrafficJam` bare,
`fatigueLevel`, etc.) — everything goes through the tiered `signals` dict.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "nri_fatigue_score_v1"
_PKG_ALG = _PKG_DIR / "algorithm.py"
_PKG_JSON = _PKG_DIR / "package.json"


# ---------------------------------------------------------------------------
# Load the package algorithm module directly (white-box unit driving evaluate)
# ---------------------------------------------------------------------------


def _load_module():
    spec = importlib.util.spec_from_file_location("nri_alg_under_test_009", _PKG_ALG)
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
    child_passenger=False,
    weather_risk_level=0.0,
    segment_type="normal_road",
    motion_state="MOVING",
    is_traffic_jam=False,
    next_rest_spot_min=9999.0,
    recovery_phase=None,
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
    sim_time=60.0,
    hp=None,
    recovery_active=False,
    ordinal=None,
    nri_forecast=None,
):
    """`ordinal` optionally EXTENDS the default `{"signal_duration": "transient"}`
    ordinal view (rather than replacing it), so existing call sites that don't
    pass it keep the exact same context they always built.

    `nri_forecast` optionally attaches an orchestration-supplied
    `context["nri_forecast"]` block (see the shared actionability contract);
    omitted, `evaluate()` falls back to the native `nextRestSpotMin` gate."""
    ordinal_view = {"signal_duration": "transient"}
    if ordinal:
        ordinal_view.update(ordinal)
    return {
        "simulation_time_sec": sim_time,
        "signals": signals,
        "feature_groups": {"normalized": {}, "ordinal": ordinal_view},
        "hyperparameters": hp if hp is not None else HP,
        "parameters": {},
        "proposal_history": proposal_history or dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
        "recovery_active": recovery_active,
        "nri_forecast": nri_forecast,
    }


# ---------------------------------------------------------------------------
# S_base — child offset, night / familiar multipliers (helper-level, verbatim math)
# ---------------------------------------------------------------------------


def test_compute_base_score_child_offset_and_multipliers():
    # Baseline: no child, no night, not familiar -> pure T_drive * W_base.
    base = mod._compute_base_score(100.0, False, False, False, HP)
    assert base == pytest.approx(100.0 * 0.5)

    # Child passenger adds a flat W_child offset.
    with_child = mod._compute_base_score(100.0, True, False, False, HP)
    assert with_child == pytest.approx(base + 20.0)

    # Night multiplies the time-damage term by M_night (1.2), not the offset.
    with_night = mod._compute_base_score(100.0, False, True, False, HP)
    assert with_night == pytest.approx(100.0 * 0.5 * 1.2)

    # Familiar route multiplies by M_familiar (1.2).
    with_familiar = mod._compute_base_score(100.0, False, False, True, HP)
    assert with_familiar == pytest.approx(100.0 * 0.5 * 1.2)

    # Combined: multipliers compound, child offset stays additive (unmultiplied).
    combined = mod._compute_base_score(100.0, True, True, True, HP)
    assert combined == pytest.approx(20.0 + 100.0 * 0.5 * 1.2 * 1.2)


# ---------------------------------------------------------------------------
# S_env — cumulative jam / highway / monotonous weights (helper-level)
# ---------------------------------------------------------------------------


def test_compute_env_score_weights():
    env = mod._compute_env_score(10.0, 20.0, 30.0, HP)
    assert env == pytest.approx(10.0 * 0.8 + 20.0 * 0.2 + 30.0 * 0.3)


# ---------------------------------------------------------------------------
# S_realtime — ReLU dead-band on drowsiness/fatigue (the key 009 behavior change:
# these signals are now genuinely live, not always 0).
# ---------------------------------------------------------------------------


def test_compute_realtime_score_zero_below_dead_band():
    # Both signals below theta (60) -> S_realtime stays exactly 0 (dead-band).
    assert mod._compute_realtime_score(0.0, 0.0, HP) == 0.0
    assert mod._compute_realtime_score(59.9, 59.9, HP) == 0.0
    assert mod._compute_realtime_score(60.0, 60.0, HP) == 0.0  # boundary: not > theta


def test_compute_realtime_score_nonzero_above_dead_band_now_live():
    # This is the headline 009 change: drowsiness/fatigue now exist as live Tier-3a
    # signals, so S_realtime can be genuinely non-zero (it was always 0 pre-009).
    realtime = mod._compute_realtime_score(70.0, 0.0, HP)
    assert realtime == pytest.approx((70.0 - 60.0) * 1.5)
    assert realtime > 0.0

    both = mod._compute_realtime_score(80.0, 90.0, HP)
    assert both == pytest.approx((80.0 - 60.0) * 1.5 + (90.0 - 60.0) * 1.5)


# ---------------------------------------------------------------------------
# evaluate() — reads tiered signals; S_realtime now live end-to-end
# ---------------------------------------------------------------------------


def test_evaluate_reads_tiered_signals_and_s_realtime_is_live():
    signals = _signals(drowsiness=90.0, fatigue=90.0)
    ctx = _ctx(signals, sim_time=60.0)
    result = mod.evaluate(ctx)

    # S_realtime must reflect the live drowsiness/fatigue signals.
    expected_realtime = (90.0 - 60.0) * 1.5 * 2
    assert result["scores"]["s_realtime"] == pytest.approx(expected_realtime)
    assert result["scores"]["s_realtime"] > 0.0


def test_evaluate_s_realtime_zero_when_signals_below_dead_band():
    signals = _signals(drowsiness=10.0, fatigue=10.0)
    ctx = _ctx(signals, sim_time=60.0)
    result = mod.evaluate(ctx)
    assert result["scores"]["s_realtime"] == 0.0


def test_criteria_exposes_normalized_threshold_matching_rest_required_score_scale():
    """The timeline plots the NORMALIZED rest_required_score (0-1); criteria must
    carry the threshold on the SAME scale (rest_required_threshold), else the UI's
    y-domain stretches to the raw threshold_fire (~80) and flattens the curve.
    """
    ctx = _ctx(_signals(drowsiness=90.0, fatigue=90.0), sim_time=60.0)
    result = mod.evaluate(ctx)
    crit = result["criteria"]
    threshold_fire = HP["threshold_fire"]

    # Raw threshold is still exposed (truthful, for the "fire ⇔ s_total ≥ 80" rule).
    assert crit["threshold_fire"] == threshold_fire
    # Normalized threshold is present, on the 0-1 rest_required_score scale.
    norm = crit["rest_required_threshold"]
    assert 0.0 <= norm <= 1.0
    # It equals threshold_fire normalized by the same divisor the score uses.
    max_display = max(threshold_fire * 1.5, 150.0)
    assert norm == pytest.approx(threshold_fire / max_display)
    # And it is genuinely on the score's scale (both ≤ 1), unlike threshold_fire.
    assert result["scores"]["rest_required_score"] <= 1.0
    assert crit["threshold_fire"] > 1.0  # the raw one would flatten a 0-1 curve


def test_evaluate_uses_fixed_tier_for_child_night_familiar():
    signals_plain = _signals()
    signals_loaded = _signals(is_night=True, familiar_route=True, child_passenger=True)

    result_plain = mod.evaluate(_ctx(signals_plain, sim_time=60.0))
    result_loaded = mod.evaluate(_ctx(signals_loaded, sim_time=60.0))

    # Same 1-minute tick duration, but child/night/familiar all raise S_base.
    assert result_loaded["scores"]["s_base"] > result_plain["scores"]["s_base"]


# ---------------------------------------------------------------------------
# Accumulators — advance only while MOVING; threaded via package_runtime_state
# ---------------------------------------------------------------------------


def test_accumulators_advance_only_while_moving_across_ticks():
    signals_moving_jam = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")

    # Tick 1 (sim_time=60, no prior state -> 1.0 min tick duration per algorithm quirk).
    r1 = mod.evaluate(_ctx(signals_moving_jam, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] == pytest.approx(1.0)
    assert state1["cumulative_highway_min"] == pytest.approx(1.0)
    assert state1["cumulative_monotonous_min"] == pytest.approx(1.0)  # highway counts as monotonous

    # Tick 2 (sim_time=120, prior state threaded -> another 1.0 min).
    r2 = mod.evaluate(_ctx(signals_moving_jam, prev_state=state1, sim_time=120.0))
    state2 = r2["next_package_runtime_state"]
    assert state2["cumulative_jam_min"] == pytest.approx(2.0)
    assert state2["cumulative_highway_min"] == pytest.approx(2.0)
    assert state2["cumulative_monotonous_min"] == pytest.approx(2.0)


def test_accumulators_do_not_advance_when_stopped():
    signals_stopped = _signals(is_traffic_jam=True, segment_type="highway", motion_state="STOPPED")
    r1 = mod.evaluate(_ctx(signals_stopped, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] == 0.0
    assert state1["cumulative_highway_min"] == 0.0
    assert state1["cumulative_monotonous_min"] == 0.0
    assert state1["driving_min_since_rest"] == 0.0


def test_accumulators_reset_after_recovery_completes():
    signals_moving_jam = _signals(is_traffic_jam=True, segment_type="highway")
    r1 = mod.evaluate(_ctx(signals_moving_jam, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] > 0.0
    assert state1["was_in_recovery"] is False

    # Enter recovery (recoveryPhase set) — no accumulation happens while resting,
    # and was_in_recovery flips to True. Recovery suppression is unconditional (we
    # never propose a rest while the driver is already resting), regardless of score.
    signals_recovering = _signals(
        drowsiness=100.0, fatigue=0.0, recovery_phase="resting", motion_state="STOPPED"
    )
    r2 = mod.evaluate(_ctx(signals_recovering, prev_state=state1, sim_time=120.0))
    state2 = r2["next_package_runtime_state"]
    assert state2["was_in_recovery"] is True
    # Suppressed while recovery is active regardless of score.
    assert r2["fire_control"]["suppressed"] is True
    assert r2["fire_control"]["reason"] == "recovery_after_accept"

    # Recovery completes (recoveryPhase None again) — accumulators reset to 0 before
    # this tick's own contribution is added. Use a non-jam, non-monotonous segment so
    # every accumulator's post-reset value is exactly 0 (no same-tick re-accumulation
    # muddies the assertion).
    signals_resumed = _signals(is_traffic_jam=False, segment_type="mountain_road")
    r3 = mod.evaluate(_ctx(signals_resumed, prev_state=state2, sim_time=180.0))
    state3 = r3["next_package_runtime_state"]
    assert state3["cumulative_jam_min"] == 0.0
    assert state3["cumulative_highway_min"] == 0.0
    assert state3["cumulative_monotonous_min"] == 0.0
    # driving_min_since_rest DOES advance this tick (MOVING), starting fresh from the
    # post-recovery reset (0.0 + this tick's 1.0), confirming the reset actually happened
    # rather than merely coinciding with a low number.
    assert state3["driving_min_since_rest"] == 1.0


# ---------------------------------------------------------------------------
# fixbug-0806 — the reset belongs to the END OF THE REST, at the rest spot.
#
# `services/recovery.py` gives every finished recovery one `phase ==
# "resuming"` tick: all stages done, engine still HOLDING the car at the spot
# (`tick_engine.py`'s `stage is None` branch), recovery deactivating on the
# NEXT tick — which is the first tick of the resumed drive, already past the
# spot. Keying the reset on "recovery went inactive" therefore drew NRI's whole
# post-rest drop on the road AFTER the rest spot (the chart's x-axis is route
# fraction), and the parked resuming tick even accrued a phantom driving minute
# that kicked the score UP at the spot first.
# ---------------------------------------------------------------------------


def test_the_resuming_tick_resets_at_the_rest_spot_and_accrues_nothing():
    # Drive: accumulate real exposure.
    driving = _signals(is_traffic_jam=True, segment_type="highway")
    r1 = mod.evaluate(_ctx(driving, sim_time=60.0))
    s1 = r1["next_package_runtime_state"]
    assert s1["driving_min_since_rest"] > 0.0

    # Rest (STOPPED dwell): frozen, nothing accrues, nothing resets yet.
    resting = _signals(recovery_phase="resting", motion_state="STOPPED")
    r2 = mod.evaluate(_ctx(resting, prev_state=s1, sim_time=120.0))
    s2 = r2["next_package_runtime_state"]
    assert s2["driving_min_since_rest"] == pytest.approx(s1["driving_min_since_rest"])

    # The "resuming" tick — the rest is OVER and the car is still at the spot.
    # The engine reports MOVING on it even though position is held, so this is
    # exactly the tick that used to charge a driving minute for a parked car.
    resuming = _signals(recovery_phase="resuming", segment_type="highway", is_traffic_jam=True)
    r3 = mod.evaluate(_ctx(resuming, prev_state=s2, sim_time=180.0))
    s3 = r3["next_package_runtime_state"]
    assert s3["driving_min_since_rest"] == 0.0
    assert s3["cumulative_jam_min"] == 0.0
    assert s3["cumulative_highway_min"] == 0.0
    assert s3["cumulative_monotonous_min"] == 0.0
    # The score's drop lands HERE — at the rest spot, not a tick later.
    assert r3["scores"]["s_base"] == 0.0
    assert r3["scores"]["s_env"] == 0.0
    # Still resting as far as firing goes: no proposal at the spot.
    assert r3["fire_control"]["suppressed"] is True

    # First tick of the resumed drive: exposure starts from zero and GROWS.
    # It must NOT be reset a second time — that would zero the first real
    # minute of driving and hold the score flat as the car pulls away.
    resumed = _signals(segment_type="highway", is_traffic_jam=True)
    r4 = mod.evaluate(_ctx(resumed, prev_state=s3, sim_time=240.0))
    s4 = r4["next_package_runtime_state"]
    assert s4["driving_min_since_rest"] == pytest.approx(1.0)
    assert s4["cumulative_highway_min"] == pytest.approx(1.0)
    assert r4["scores"]["s_total"] > r3["scores"]["s_total"]


# ---------------------------------------------------------------------------
# Recovery-semantics refactor (2026-08-08) — narrow the freeze to the STOPPED
# dwell only. The 2026-08-04 bugfix froze all four accumulators for the
# ENTIRE recovery window (accept tick, MOVING drive-to-spot, STOPPED dwell).
# That over-froze: the driver is still driving, and still accumulating real
# exposure, during the MOVING approach to the rest spot. Accumulation is now
# gated on `motionState` alone (`is_moving`) rather than
# `is_moving and not recovery_active` — the approach leg accrues exactly like
# ordinary driving; only the STOPPED dwell freezes. The resume-edge reset to 0
# is unchanged (design §6 case 2 + case 4).
# ---------------------------------------------------------------------------


def test_accumulators_freeze_only_during_the_stopped_dwell():
    """The corrected gap this narrows: accumulators must keep growing through
    the MOVING drive-to-spot leg (real driving, real exposure) and freeze only
    once the vehicle actually stops — not for the whole recovery window.
    """
    # Build up real pre-accept exposure so a regression in either direction
    # (frozen too early, or never freezing at all) is visibly detectable.
    signals_pre_accept = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")
    r1 = mod.evaluate(_ctx(signals_pre_accept, sim_time=60.0))
    state = r1["next_package_runtime_state"]
    pre_accept_jam = state["cumulative_jam_min"]
    assert pre_accept_jam > 0.0
    assert state["cumulative_highway_min"] > 0.0
    assert state["cumulative_monotonous_min"] > 0.0
    assert state["driving_min_since_rest"] > 0.0

    # Accept-tick and several more MOVING ticks while recoveryPhase is set —
    # the drive-to-spot leg. All four accumulators keep GROWING tick over
    # tick, exactly like ordinary driving; firing stays suppressed throughout.
    t = 120.0
    for _ in range(5):
        signals_driving_to_spot = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
            recovery_phase="driving_to_spot",
        )
        r = mod.evaluate(_ctx(signals_driving_to_spot, prev_state=state, sim_time=t))
        ns = r["next_package_runtime_state"]
        assert ns["cumulative_jam_min"] > state["cumulative_jam_min"]
        assert ns["cumulative_highway_min"] > state["cumulative_highway_min"]
        assert ns["cumulative_monotonous_min"] > state["cumulative_monotonous_min"]
        assert ns["driving_min_since_rest"] > state["driving_min_since_rest"]
        assert r["fire_control"]["suppressed"] is True
        assert r["fire_control"]["reason"] == "recovery_after_accept"
        state = ns
        t += 60.0

    # Confirm the approach really grew them past the pre-accept value before
    # checking the freeze below (otherwise a frozen-at-pre-accept regression
    # would be indistinguishable from a frozen-at-approach-end pass).
    assert state["cumulative_jam_min"] > pre_accept_jam
    approach_end_jam = state["cumulative_jam_min"]
    approach_end_hw = state["cumulative_highway_min"]
    approach_end_mono = state["cumulative_monotonous_min"]
    approach_end_driving = state["driving_min_since_rest"]

    # Now the STOPPED dwell — accumulators freeze at the approach-end value.
    for _ in range(3):
        signals_dwell = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="STOPPED",
            recovery_phase="resting",
        )
        r = mod.evaluate(_ctx(signals_dwell, prev_state=state, sim_time=t))
        ns = r["next_package_runtime_state"]
        assert ns["cumulative_jam_min"] == pytest.approx(approach_end_jam)
        assert ns["cumulative_highway_min"] == pytest.approx(approach_end_hw)
        assert ns["cumulative_monotonous_min"] == pytest.approx(approach_end_mono)
        assert ns["driving_min_since_rest"] == pytest.approx(approach_end_driving)
        state = ns
        t += 60.0

    # Resume (recoveryPhase None again): resets to 0 and starts re-accumulating
    # fresh, landing back at "one fresh tick" (1.0 each) — a genuine
    # restart from 0, not merely a smaller number than the approach-end total.
    signals_resumed = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")
    r_resume = mod.evaluate(_ctx(signals_resumed, prev_state=state, sim_time=t))
    ns_resume = r_resume["next_package_runtime_state"]
    assert ns_resume["cumulative_jam_min"] == pytest.approx(1.0)
    assert ns_resume["cumulative_highway_min"] == pytest.approx(1.0)
    assert ns_resume["cumulative_monotonous_min"] == pytest.approx(1.0)
    assert ns_resume["driving_min_since_rest"] == pytest.approx(1.0)
    # One more tick after resume grows past the "1.0" reset value, proving
    # accumulation resumed from 0 and not from the (much larger) approach total.
    r_after_resume = mod.evaluate(_ctx(signals_resumed, prev_state=ns_resume, sim_time=t + 60.0))
    assert r_after_resume["next_package_runtime_state"]["cumulative_jam_min"] == pytest.approx(2.0)


def test_score_keeps_growing_during_the_approach_then_drops_at_resume():
    """Since the accumulators now grow through the MOVING drive-to-spot leg
    (matching ordinary driving), s_total keeps growing right through the
    approach too — it is no longer held flat for the whole recovery window.
    Recovery still suppresses FIRING, not scoring; the score only drops at
    the resume edge, once the accumulators reset to 0.
    """
    signals_pre_accept = _signals(
        is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
        drowsiness=90.0, fatigue=0.0,
    )
    r1 = mod.evaluate(_ctx(signals_pre_accept, sim_time=60.0))
    state = r1["next_package_runtime_state"]
    last_total = r1["scores"]["s_total"]

    # Several approach ticks: s_total keeps growing, exactly like ordinary
    # driving would.
    t = 120.0
    for _ in range(3):
        signals_driving_to_spot = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
            drowsiness=90.0, fatigue=0.0, recovery_phase="driving_to_spot",
        )
        r = mod.evaluate(_ctx(signals_driving_to_spot, prev_state=state, sim_time=t))
        assert r["scores"]["s_total"] > last_total
        last_total = r["scores"]["s_total"]
        state = r["next_package_runtime_state"]
        t += 60.0

    approach_end_total = last_total

    # STOPPED dwell: frozen at the approach-end value.
    signals_dwell = _signals(
        is_traffic_jam=True, segment_type="highway", motion_state="STOPPED",
        drowsiness=90.0, fatigue=0.0, recovery_phase="resting",
    )
    r_dwell = mod.evaluate(_ctx(signals_dwell, prev_state=state, sim_time=t))
    assert r_dwell["scores"]["s_total"] == pytest.approx(approach_end_total)
    state = r_dwell["next_package_runtime_state"]
    t += 60.0

    # Resume edge: accumulators reset to 0, so the total drops well below the
    # approach-end plateau, leaving only this tick's fresh contribution.
    signals_resumed = _signals(
        is_traffic_jam=False, segment_type="mountain_road", motion_state="MOVING",
        drowsiness=90.0, fatigue=0.0,
    )
    r_resume = mod.evaluate(_ctx(signals_resumed, prev_state=state, sim_time=t))
    assert r_resume["scores"]["s_total"] < approach_end_total
    assert r_resume["scores"]["s_total"] == pytest.approx(
        r_resume["scores"]["s_base"] + r_resume["scores"]["s_env"] + r_resume["scores"]["s_realtime"]
    )


# ---------------------------------------------------------------------------
# Fire condition — SINGLE fire threshold + post-fire ETA filter (design-aligned).
#
# NRI's documented fire logic is one threshold: fire ⇔ S_total ≥ threshold_fire,
# with the next-rest-spot ETA as a post-fire filter only. There is NO
# suggest/recommend/urgent ladder, persistence gate, cooldown, 30-min cap, or
# emergency override — those were carried over from the Hybrid and are removed to
# match the spec (others/20260630_発火ロジック検討用資料.md line 217-218; math
# comparison §1.2 "fire ⇔ S_total ≥ threshold_fire (80); post-fire filter").
# ---------------------------------------------------------------------------


def _primed_state(
    *, driving_min_since_rest=None, jam_min=0.0, hw_min=0.0, mono_min=0.0
) -> dict:
    """Runtime state as if the driver has accumulated enough exposure that one more
    1-minute tick lands S_total ≥ threshold_fire. `last_sim_time=0.0` forces the
    algorithm's documented default 1-minute tick duration.

    Default `driving_min_since_rest` is derived from the manifest's own
    `threshold_fire`/`w_base` (not a hardcoded literal) so it keeps landing in
    the REST band — not the lower `threshold_monotony` band — whichever
    threshold values the manifest declares (S1: raised 80->100 / 55->60).
    `driving_min_since_rest = threshold_fire / w_base` makes one more 1-minute
    tick's S_base land exactly `w_base` pts above threshold_fire.
    """
    if driving_min_since_rest is None:
        driving_min_since_rest = HP["threshold_fire"] / HP["w_base"]
    return {
        "cumulative_jam_min": jam_min,
        "cumulative_highway_min": hw_min,
        "cumulative_monotonous_min": mono_min,
        "driving_min_since_rest": driving_min_since_rest,
        "last_sim_time": 0.0,
        "was_in_recovery": False,
    }


def test_fires_on_first_tick_at_or_above_threshold_fire_no_persistence():
    # _primed_state()'s default drives S_base one w_base above threshold_fire on
    # the FIRST over-threshold tick — fires immediately, no persistence gate.
    # A reachable rest spot passes the ETA filter (fixbug: the 9999.0 sentinel
    # used to pass this filter too — that exception is gone, see the sentinel
    # tests below).
    signals = _signals(next_rest_spot_min=10.0)
    r = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert r["scores"]["s_total"] >= HP["threshold_fire"]
    assert r["candidates"][0]["exists"] is True
    assert r["fire_control"]["fired"] is True
    assert r["fire_control"]["reason"] == "fire_threshold_passed"
    assert r["result_type"] == "REST_PROPOSAL"
    assert r["proposal"] is not None
    assert r["states"]["rest"] == "REST_FIRE"


def test_below_fire_threshold_is_no_proposal():
    signals = _signals(drowsiness=0.0, fatigue=0.0)  # tiny S_total
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert result["scores"]["s_total"] < HP["threshold_fire"]
    assert result["candidates"][0]["exists"] is False
    assert result["fire_control"]["fired"] is False
    assert result["fire_control"]["reason"] == "below_fire_threshold"
    assert result["result_type"] == "NO_PROPOSAL"


# ---------------------------------------------------------------------------
# Post-fire ETA filter (the only gate after the fire threshold)
# ---------------------------------------------------------------------------


def test_post_fire_eta_filter_suppresses_when_rest_spot_too_far():
    signals = _signals(next_rest_spot_min=90.0)  # > rest_spot_eta_filter_min (30)
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["scores"]["s_total"] >= HP["threshold_fire"]
    assert result["fire_control"]["suppressed"] is True
    # Shared actionability enum contract (Task 2): "rest_spot_too_far" was
    # replaced by "rest_spot_eta_over_limit".
    assert result["fire_control"]["reason"] == "rest_spot_eta_over_limit"
    assert result["fire_control"]["fired"] is False


def test_post_fire_eta_filter_fires_when_spot_within_filter():
    signals = _signals(next_rest_spot_min=10.0)  # <= 15
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "fire_threshold_passed"


def test_post_fire_eta_filter_suppresses_when_no_rest_spot_ahead_sentinel():
    """Fixbug: 9999.0 (no spot ahead) used to PASS this filter and fire — that
    was the bug. It must now suppress, same as any other unreachable spot."""
    signals = _signals(next_rest_spot_min=9999.0)  # no spot ahead -> must suppress
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is False
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "no_spot_ahead"


def test_hybrid_style_fire_control_hyperparameters_are_removed():
    """Design-aligned NRI has one fire threshold — the Hybrid-style knobs must be
    gone from the manifest (they are undocumented for NRI)."""
    removed = {
        "threshold_suggest", "threshold_recommend", "threshold_urgent",
        "persistence_ticks", "rest_cooldown_sec", "max_proposals_per_30min",
        "emergency_override_threshold",
    }
    assert removed.isdisjoint(set(HP)), f"stale fire-control hp still declared: {removed & set(HP)}"


# ---------------------------------------------------------------------------
# Recovery suppression
# ---------------------------------------------------------------------------


def test_recovery_active_suppresses_firing_regardless_of_score():
    signals = _signals(
        drowsiness=100.0, fatigue=100.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway", next_rest_spot_min=5.0,
        recovery_phase="resting", motion_state="STOPPED",
    )
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "recovery_after_accept"
    assert result["states"]["rest"] == "REST_RECOVERY"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_context_yields_same_result():
    signals = _signals(drowsiness=65.0, fatigue=50.0, is_night=True, is_traffic_jam=True)
    ctx = _ctx(signals, sim_time=60.0)
    r1 = mod.evaluate(dict(ctx))
    r2 = mod.evaluate(dict(ctx))
    assert r1["scores"] == r2["scores"]
    assert r1["fire_control"] == r2["fire_control"]
    assert r1["next_package_runtime_state"] == r2["next_package_runtime_state"]


# ---------------------------------------------------------------------------
# Manifest single-source defaults — no hardcoded hp.get(key, default) fallback
# ---------------------------------------------------------------------------


def test_missing_hyperparameter_key_raises_keyerror_not_silent_default():
    # The adapter guarantees a fully-resolved hyperparameters dict; a missing key
    # here is a real configuration bug and must surface as KeyError, never a
    # silently-wrong hardcoded default.
    incomplete_hp = dict(HP)
    del incomplete_hp["threshold_fire"]
    signals = _signals(drowsiness=90.0, fatigue=90.0)
    with pytest.raises(KeyError):
        mod.evaluate(_ctx(signals, sim_time=60.0, hp=incomplete_hp))


def test_every_hyperparameter_the_algorithm_reads_has_a_manifest_default():
    required_keys = {
        "w_base", "w_child", "m_night", "m_familiar",
        "w_jam", "w_highway", "w_monotonous",
        "theta_sleep", "w_sleep", "theta_fatigue", "w_fatigue",
        "threshold_fire", "threshold_monotony", "rest_spot_eta_filter_min",
    }
    assert required_keys <= set(HP)


# ---------------------------------------------------------------------------
# Monotony trigger — a SECOND, LOWER threshold on the SAME S_total
# ---------------------------------------------------------------------------
#
# NRI produces one final score. Rather than invent a second scoring pipeline for
# monotony, the score is banded by two thresholds:
#
#     S_total >= threshold_fire                      -> rest_required
#     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
#     S_total <  threshold_monotony                   -> nothing
#
# The rest band keeps its post-fire rest-spot ETA filter; the monotony band has
# no such filter, because refreshing content does not need a place to stop.


def _score_between_thresholds_state() -> dict:
    """Runtime state that lands S_total inside the monotony band on the next tick.

    S_base = driving_min * w_base, and the algorithm's default tick duration is
    1 minute when `last_sim_time` is 0 — so driving_min_since_rest + 1 minutes of
    accumulated driving sets the score directly.
    """
    target = (HP["threshold_monotony"] + HP["threshold_fire"]) / 2.0
    driving_min = target / HP["w_base"] - 1.0
    return _primed_state(driving_min_since_rest=driving_min)


def test_manifest_declares_a_monotony_threshold_below_the_fire_threshold():
    assert "threshold_monotony" in HP
    assert HP["threshold_monotony"] < HP["threshold_fire"], (
        "the monotony band only exists when its threshold is the LOWER of the two"
    )


def test_score_inside_the_band_fires_monotony_not_rest():
    r = mod.evaluate(_ctx(_signals(), prev_state=_score_between_thresholds_state(), sim_time=60.0))
    s = r["scores"]["s_total"]
    assert HP["threshold_monotony"] <= s < HP["threshold_fire"], f"setup: s_total={s}"

    assert r["result_type"] == "MONOTONY_PROPOSAL"
    assert r["selected_category"] == "monotony_prevention"
    assert r["fire_control"]["fired"] is True
    assert r["proposal"] is not None
    # A monotony proposal is acknowledged, never "accept_rest" — it does not send
    # the driver to a rest spot.
    assert "accept_rest" not in r["proposal"]["options"]
    assert "acknowledge" in r["proposal"]["options"]


def test_score_above_the_fire_threshold_still_fires_rest_not_monotony():
    # A reachable rest spot — the default `_signals()` sentinel (9999.0, no spot
    # ahead) now correctly suppresses (see the sentinel tests), so this test
    # supplies a real spot to isolate the threshold-band behavior it targets.
    r = mod.evaluate(_ctx(
        _signals(next_rest_spot_min=10.0), prev_state=_primed_state(), sim_time=60.0
    ))
    assert r["scores"]["s_total"] >= HP["threshold_fire"]
    assert r["result_type"] == "REST_PROPOSAL"
    assert r["selected_category"] == "rest_required"

    mono = next(c for c in r["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["fired"] is False
    # Honest about WHY: the score cleared the monotony threshold too, but the
    # higher-priority rest band owns it.
    assert mono["fire_control"]["reason"] == "superseded_by_rest_required"


def test_score_below_both_thresholds_proposes_nothing():
    r = mod.evaluate(_ctx(_signals(), sim_time=60.0))
    assert r["scores"]["s_total"] < HP["threshold_monotony"]
    assert r["result_type"] == "NO_PROPOSAL"
    assert r["fire_control"]["fired"] is False
    for c in r["candidates"]:
        assert c["exists"] is False


def test_both_categories_are_always_retained_in_candidates():
    """The §11 trace keeps every category, fired or not — a reviewer must be able
    to see the monotony candidate's verdict even on a rest tick."""
    for state in (None, _score_between_thresholds_state(), _primed_state()):
        r = mod.evaluate(_ctx(_signals(), prev_state=state, sim_time=60.0))
        cats = [c["category"] for c in r["candidates"]]
        assert cats == ["rest_required", "monotony_prevention"], cats


def test_monotony_band_is_not_gated_by_the_rest_spot_eta_filter():
    """The ETA filter is a REST concern — content needs no place to stop."""
    far = _signals(next_rest_spot_min=90.0)  # > rest_spot_eta_filter_min (60)
    r = mod.evaluate(_ctx(far, prev_state=_score_between_thresholds_state(), sim_time=60.0))
    assert r["fire_control"]["fired"] is True
    assert r["result_type"] == "MONOTONY_PROPOSAL"


def test_recovery_suppresses_the_monotony_band_too():
    """Nothing is proposed while the driver is actually resting."""
    resting = _signals(recovery_phase="nap", motion_state="STOPPED")
    r = mod.evaluate(_ctx(resting, prev_state=_score_between_thresholds_state(), sim_time=60.0))
    assert r["fire_control"]["fired"] is False
    mono = next(c for c in r["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["reason"] == "recovery_after_accept"


def test_monotony_threshold_is_exposed_on_the_same_0_1_scale_as_the_score():
    """The timeline plots the NORMALIZED score, so its threshold line must be
    normalized by the SAME divisor — exactly as `rest_required_threshold` is.
    Without this the monotony rule would be drawn at ~55 on a 0-1 axis."""
    r = mod.evaluate(_ctx(_signals(), sim_time=60.0))
    crit = r["criteria"]

    assert crit["threshold_monotony"] == HP["threshold_monotony"]  # raw, s_total scale
    max_display = max(HP["threshold_fire"] * 1.5, 150.0)
    assert crit["monotony_suggest_threshold"] == pytest.approx(
        HP["threshold_monotony"] / max_display
    )
    # Below the rest rule on the shared axis, and both genuinely 0-1.
    assert 0.0 <= crit["monotony_suggest_threshold"] < crit["rest_required_threshold"] <= 1.0


def test_nri_reports_no_separate_monotony_curve():
    """NRI has ONE score. It must NOT emit `monotony_prevention_score` — doing so
    would draw a second curve identical to the first. Two thresholds, one score."""
    r = mod.evaluate(_ctx(_signals(), prev_state=_score_between_thresholds_state(), sim_time=60.0))
    assert "monotony_prevention_score" not in r["scores"]
    assert r["scores"]["rest_required_score"] == r["score"]


def test_a_monotony_threshold_at_or_above_the_fire_threshold_empties_the_band():
    """Degrades safely to the pre-existing rest-only behavior rather than
    inverting the bands."""
    hp = dict(HP, threshold_monotony=HP["threshold_fire"])
    r = mod.evaluate(_ctx(_signals(), prev_state=_score_between_thresholds_state(), sim_time=60.0, hp=hp))
    assert r["result_type"] != "MONOTONY_PROPOSAL"


# ---------------------------------------------------------------------------
# S1 Task 1 — raised thresholds (owner: "no need to change anything except
# threshold, so increase to 100 and 60"). Literal-value check: the `<` ordering
# is already covered above by `test_manifest_declares_a_monotony_threshold_
# below_the_fire_threshold`, but that test would pass at ANY ordered pair —
# this pins the actual owner-specified numbers.
# ---------------------------------------------------------------------------


def test_manifest_thresholds_are_now_100_and_60():
    assert HP["threshold_fire"] == 100.0
    assert HP["threshold_monotony"] == 60.0
    assert HP["threshold_monotony"] < HP["threshold_fire"]


# ---------------------------------------------------------------------------
# S1 Task 2 — `feature_contributions`: EXACT additive decomposition of s_total.
#
# NRI is a pure sum, so — unlike the Hybrid's clamped/smoothed score — this
# decomposition is exact, not an approximation: Sigma(contribution) == s_total
# to float precision. See `_build_feature_contributions`'s docstring in
# packages/nri_fatigue_score_v1/algorithm.py for the row-by-row algebra.
# ---------------------------------------------------------------------------


def _rich_signals():
    """Every input nonzero so every one of the 9 rows has a nonzero contribution."""
    return _signals(
        drowsiness=90.0, fatigue=90.0,
        is_night=True, familiar_route=True, child_passenger=True,
    )


def _rich_state():
    return _primed_state(driving_min_since_rest=50.0, jam_min=10.0, hw_min=20.0, mono_min=30.0)


def test_feature_contributions_rows_sum_to_s_total_exactly():
    r = mod.evaluate(_ctx(_rich_signals(), prev_state=_rich_state(), sim_time=60.0))
    chain = r["feature_contributions"]["rest_required"]
    row_sum = sum(row["contribution"] for row in chain["rows"])
    assert row_sum == pytest.approx(r["scores"]["s_total"], abs=1e-9)
    assert chain["score"] == r["scores"]["s_total"]
    assert chain["clamped"] is False  # NRI never clamps


def test_feature_contributions_driving_rows_reconstruct_time_damage_with_night_and_familiar():
    # child_passenger=False isolates the three driving rows from the separate
    # child_passenger row (which would otherwise also land in s_base).
    signals = _signals(is_night=True, familiar_route=True, child_passenger=False)
    state = _primed_state(driving_min_since_rest=50.0)  # jam/hw/mono default 0
    r = mod.evaluate(_ctx(signals, prev_state=state, sim_time=60.0))

    # T is the SAME driving_min_since_rest this tick's s_base actually used —
    # read it back from the recorded next state rather than re-deriving the
    # tick-duration quirk here.
    t_drive = r["next_package_runtime_state"]["driving_min_since_rest"]
    expected = t_drive * HP["w_base"] * HP["m_night"] * HP["m_familiar"]

    rows = {row["feature_id"]: row for row in r["feature_contributions"]["rest_required"]["rows"]}
    driving_rows_sum = (
        rows["continuous_driving_min"]["contribution"]
        + rows["night_amplification"]["contribution"]
        + rows["familiar_route_amplification"]["contribution"]
    )
    assert driving_rows_sum == pytest.approx(expected, abs=1e-9)
    # And they equal s_base directly (child_passenger=False -> no offset term).
    assert driving_rows_sum == pytest.approx(r["scores"]["s_base"], abs=1e-9)


def test_feature_contributions_amplification_rows_zero_when_flags_off():
    signals = _signals(is_night=False, familiar_route=False)
    r = mod.evaluate(_ctx(signals, prev_state=_primed_state(driving_min_since_rest=50.0), sim_time=60.0))
    rows = {row["feature_id"]: row for row in r["feature_contributions"]["rest_required"]["rows"]}
    # Exact zero (m_night == m_familiar == 1.0 unambiguously when the flag is
    # off), not merely small — no pytest.approx needed.
    assert rows["night_amplification"]["contribution"] == 0.0
    assert rows["familiar_route_amplification"]["contribution"] == 0.0
    # Values report the (inactive) multiplier itself, not 0.
    assert rows["night_amplification"]["value"] == 1.0
    assert rows["familiar_route_amplification"]["value"] == 1.0


def test_feature_contributions_rows_have_unique_ids_and_are_nonempty_on_a_normal_tick():
    r = mod.evaluate(_ctx(_signals(), sim_time=60.0))  # a plain, default-signal MOVING tick
    rows = r["feature_contributions"]["rest_required"]["rows"]
    assert len(rows) > 0
    ids = [row["feature_id"] for row in rows]
    assert len(ids) == len(set(ids)), f"duplicate feature_id in rows: {ids}"


def test_monotony_prevention_reuses_the_same_score_as_rest_required():
    """One score, two thresholds (see the module docstring) — the
    `feature_contributions` block must not invent a second curve either."""
    r = mod.evaluate(_ctx(_rich_signals(), prev_state=_rich_state(), sim_time=60.0))
    fc = r["feature_contributions"]
    assert fc["monotony_prevention"]["score"] == fc["rest_required"]["score"]
    assert fc["monotony_prevention"]["score"] == r["scores"]["s_total"]


def test_feature_contributions_eta_gate_reports_suppress_when_rest_spot_too_far():
    signals = _signals(next_rest_spot_min=90.0)  # > rest_spot_eta_filter_min (30)
    r = mod.evaluate(_ctx(signals, sim_time=60.0))
    gates = {g["gate_id"]: g for g in r["feature_contributions"]["rest_required"]["gates"]}
    eta_gate = gates["rest_spot_eta_filter_min"]
    # evaluated_inputs now also carries the shared actionability `reason`
    # (spec §11.2) alongside the raw ETA value.
    assert eta_gate["evaluated_inputs"] == {
        "nextRestSpotMin": 90.0, "reason": "rest_spot_eta_over_limit",
    }
    assert eta_gate["threshold"] == HP["rest_spot_eta_filter_min"]
    assert eta_gate["passed"] is False
    assert eta_gate["effect"] == "suppress"


def test_feature_contributions_eta_gate_reports_allow_within_filter():
    signals = _signals(next_rest_spot_min=10.0)  # <= 15
    r = mod.evaluate(_ctx(signals, sim_time=60.0))
    eta_gate = next(
        g for g in r["feature_contributions"]["rest_required"]["gates"]
        if g["gate_id"] == "rest_spot_eta_filter_min"
    )
    assert eta_gate["passed"] is True
    assert eta_gate["effect"] == "allow"


def test_feature_contributions_recovery_gate_present_on_both_categories():
    r = mod.evaluate(_ctx(_signals(), sim_time=60.0))
    for category in ("rest_required", "monotony_prevention"):
        gate_ids = {g["gate_id"] for g in r["feature_contributions"][category]["gates"]}
        assert "recovery_suppression" in gate_ids


def test_feature_contributions_monotony_gate_reports_superseded_when_rest_owns_the_tick():
    r = mod.evaluate(_ctx(_signals(), prev_state=_primed_state(), sim_time=60.0))
    assert r["scores"]["s_total"] >= HP["threshold_fire"]
    gate = next(
        g for g in r["feature_contributions"]["monotony_prevention"]["gates"]
        if g["gate_id"] == "superseded_by_rest_required"
    )
    assert gate["passed"] is False
    assert gate["effect"] == "suppress"


def test_feature_contributions_band_populated_from_ordinal_and_none_for_a_miss():
    # "drowsiness" has a matching ordinal entry; "night_amplification" has none
    # (it isn't one of the package's declared `features` keys) — the row's
    # band must stay None rather than guess.
    signals = _signals(drowsiness=90.0, is_night=True)
    r = mod.evaluate(_ctx(signals, sim_time=60.0, ordinal={"drowsiness": "high"}))
    rows = {row["feature_id"]: row for row in r["feature_contributions"]["rest_required"]["rows"]}
    assert rows["drowsiness"]["band"] == "high"
    assert rows["night_amplification"]["band"] is None


# ---------------------------------------------------------------------------
# Recovery-semantics refactor (2026-08-08) — mirror the engine's monotony
# freeze+drain, and narrow the recovery freeze to the STOPPED dwell only.
#
# The served-monotony-proposal relief hack ("relieve cumulative_monotonous_min
# when its own proposal is ANSWERED", `mono_intervention_sec` /
# `prev_handled_sec` / `mono_intervention_handled_sec`) is RETIRED — see
# `test_answered_monotony_proposal_no_longer_zeroes_the_accumulator` below,
# which asserts the opposite of what the deleted tests used to assert. Relief
# on the monotony channel is now the engine's `stimulusFrozen` freeze plus its
# `stimulusReliefMin` drain (design §7, P5), mirroring
# aica_transparent_hybrid_trigger_v1 exactly.
#
# The whole-`recovery_active`-window freeze is also narrowed: only the
# STOPPED dwell freezes exposure now — the MOVING drive-to-spot still
# accrues, since the driver is still driving (design §6 case 2). See
# `test_exposure_keeps_accruing_while_driving_to_the_rest_spot` /
# `test_exposure_freezes_during_the_stopped_dwell` below.
# ---------------------------------------------------------------------------


def _nri_context(**overrides) -> dict:
    """Build a full tiered context for the recovery-semantics tests.

    `overrides` may include any `_signals(...)` kwarg (e.g. `segment_type`,
    `motion_state`, `recovery_phase`) plus:
      - `stimulus_frozen` / `stimulus_relief_min`: threaded onto
        `signals.dynamic.stimulusFrozen` / `stimulusReliefMin`.
      - `cumulative_monotonous_min` / `driving_min_since_rest`: seeded into
        `package_runtime_state` (with `last_sim_time` pinned to `sim_time` so
        the seeded values pass through unchanged by the elapsed-time delta).
      - `last_proposal_category` / `last_proposal_result`: threaded onto
        `proposal_history`.
      - `sim_time` / `hp`: passed straight through to `_ctx`.
    """
    signal_keys = (
        "drowsiness", "fatigue", "anomaly_rate", "is_night", "familiar_route",
        "child_passenger", "weather_risk_level", "segment_type", "motion_state",
        "is_traffic_jam", "next_rest_spot_min", "recovery_phase",
        "continuous_driving_min", "speed_kph", "route_fraction",
    )
    signal_kwargs = {k: v for k, v in overrides.items() if k in signal_keys}
    signals = _signals(**signal_kwargs)

    stimulus_frozen = overrides.get("stimulus_frozen", False)
    stimulus_relief_min = overrides.get("stimulus_relief_min", 0.0)
    signals["dynamic"]["stimulusFrozen"] = stimulus_frozen
    signals["dynamic"]["stimulusReliefMin"] = stimulus_relief_min

    sim_time = overrides.get("sim_time", 60.0)
    prev_state = {"last_sim_time": sim_time}
    if "cumulative_monotonous_min" in overrides:
        prev_state["cumulative_monotonous_min"] = overrides["cumulative_monotonous_min"]
    if "driving_min_since_rest" in overrides:
        prev_state["driving_min_since_rest"] = overrides["driving_min_since_rest"]

    proposal_history = dict(_EMPTY_PH)
    if "last_proposal_category" in overrides:
        proposal_history["lastProposalCategory"] = overrides["last_proposal_category"]
    if "last_proposal_result" in overrides:
        proposal_history["lastProposalResult"] = overrides["last_proposal_result"]

    return _ctx(
        signals,
        prev_state=prev_state,
        proposal_history=proposal_history,
        sim_time=sim_time,
        hp=overrides.get("hp"),
    )


def test_stimulus_frozen_stops_cumulative_monotonous_min_advancing():
    frozen = mod.evaluate(_nri_context(segment_type="highway", stimulus_frozen=True,
                                        cumulative_monotonous_min=20.0))
    thawed = mod.evaluate(_nri_context(segment_type="highway", stimulus_frozen=False,
                                        cumulative_monotonous_min=20.0))
    fs = frozen["next_package_runtime_state"]
    ts = thawed["next_package_runtime_state"]
    assert fs["cumulative_monotonous_min"] == pytest.approx(20.0)
    assert ts["cumulative_monotonous_min"] > 20.0
    # highway exposure still accrues in both
    assert fs["cumulative_highway_min"] == pytest.approx(ts["cumulative_highway_min"])


def test_stimulus_relief_min_drains_cumulative_monotonous_min_on_top_of_the_freeze():
    """Design §6 case 1: freeze alone is incomplete — the engine's published
    drain amount must also reduce cumulative_monotonous_min, floored at 0."""
    drained = mod.evaluate(_nri_context(
        segment_type="highway", is_traffic_jam=True,
        stimulus_frozen=True, stimulus_relief_min=6.0,
        cumulative_monotonous_min=10.0,
    ))
    state = drained["next_package_runtime_state"]
    # frozen (no advance) then drained by 6.0 -> 10.0 - 6.0 = 4.0
    assert state["cumulative_monotonous_min"] == pytest.approx(4.0)


def test_stimulus_relief_min_floors_cumulative_monotonous_min_at_zero():
    drained = mod.evaluate(_nri_context(
        segment_type="highway", stimulus_frozen=True, stimulus_relief_min=999.0,
        cumulative_monotonous_min=10.0,
    ))
    assert drained["next_package_runtime_state"]["cumulative_monotonous_min"] == 0.0


def test_answered_monotony_proposal_no_longer_zeroes_the_accumulator():
    result = mod.evaluate(_nri_context(
        cumulative_monotonous_min=40.0,
        last_proposal_category="monotony_prevention",
        last_proposal_result="acknowledge",
    ))
    state = result["next_package_runtime_state"]
    assert state["cumulative_monotonous_min"] >= 40.0
    assert "mono_intervention_handled_sec" not in state


def test_exposure_keeps_accruing_while_driving_to_the_rest_spot():
    """Design §6 case 2 — only the STOPPED dwell freezes, not the approach."""
    en_route = mod.evaluate(_nri_context(
        recovery_phase="wakefulness", motion_state="MOVING",
        driving_min_since_rest=100.0,
    ))
    assert en_route["next_package_runtime_state"]["driving_min_since_rest"] > 100.0


def test_exposure_freezes_during_the_stopped_dwell():
    dwelling = mod.evaluate(_nri_context(
        recovery_phase="nap", motion_state="STOPPED",
        driving_min_since_rest=100.0,
    ))
    assert dwelling["next_package_runtime_state"]["driving_min_since_rest"] == pytest.approx(100.0)


def test_threshold_forecast_rest_default_is_80():
    assert HP["threshold_forecast_rest"] == 80.0


def test_rest_spot_eta_filter_default_is_30():
    assert HP["rest_spot_eta_filter_min"] == 30.0


def test_forecast_rest_proposal_declared_with_expected_options():
    data = json.loads(_PKG_JSON.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["proposals"]}
    assert "forecast_rest_required_proposal" in by_id
    assert by_id["forecast_rest_required_proposal"]["options"] == [
        "accept_rest", "postpone", "decline",
    ]


# ---------------------------------------------------------------------------
# Task 3 — kill the 9999.0-fires exception; ordinary rest uses shared
# actionability (spec §20.1 items 6-7; §20.3 items 4, 8).
#
# The old rule ("nextRestSpotMin <= filter OR nextRestSpotMin >= 9999.0 ->
# allow") let the "no spot ahead" sentinel PASS the gate and FIRE a rest
# proposal — exactly backwards. The corrected rule: a spot must exist AND be
# reachable within the filter to be actionable. When the orchestration
# supplies `context["nri_forecast"].current_rest_spot`, its `actionable` /
# `unactionable_reason` are used instead of the raw ETA gate (it additionally
# knows about the destination-edge case); when absent, the native
# `nextRestSpotMin` gate is used, minus the sentinel exception.
# ---------------------------------------------------------------------------


def test_sentinel_next_rest_fails_eta_contribution_gate():
    """9999.0 (no spot ahead) must FAIL, not pass, the rest ETA gate."""
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=9999.0))
    result = mod.evaluate(ctx)
    fc = result["feature_contributions"]["rest_required"]
    eta_gate = next(g for g in fc["gates"] if g["gate_id"] in
                    ("rest_spot_eta_filter_min", "forecast_current_rest_spot_eta"))
    assert eta_gate["passed"] is False


def test_score_at_or_above_100_with_no_spot_is_suppressed_not_fired():
    """Score >= threshold_fire but nextRestSpotMin==9999 → SUPPRESSED, no proposal."""
    # Drive the raw score >= 100 with no reachable spot.
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=9999.0),
               sim_time=6000.0)
    result = mod.evaluate(ctx)
    assert result["scores"]["s_total"] >= 100.0
    assert result["result_type"] == "SUPPRESSED"
    assert result["trigger_candidate"] is False
    assert result["selected_category"] is None
    assert result["fire_control"]["fired"] is False
    assert result["proposal"] is None
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["fired"] is False
    assert rest["fire_control"]["reason"] == "no_spot_ahead"


def test_score_100_with_actionable_current_spot_still_fires_ordinary_rest():
    """Regression guard: a real, near spot still fires the ordinary rest path."""
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=12.0),
               sim_time=6000.0)
    result = mod.evaluate(ctx)
    assert result["result_type"] == "REST_PROPOSAL"
    assert result["selected_category"] == "rest_required"


def test_ordinary_path_honors_forecast_current_spot_block_when_present():
    """When orchestration supplies nri_forecast.current_rest_spot, the ordinary
    path uses ITS actionability (incl. destination-edge), not the raw ETA gate."""
    fc_block = {
        "evaluated": True, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "future_fire": {"found": False},
        "current_rest_spot": {
            "exists": True, "position_km": 198.0,
            "eta_from_current_min": 8.0, "eta_to_destination_min": 4.0,
            "actionable": False, "unactionable_reason": "inside_destination_edge",
        },
    }
    # near spot (raw ETA passes) but inside the destination edge → must suppress
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=8.0),
               sim_time=6000.0, nri_forecast=fc_block)
    result = mod.evaluate(ctx)
    assert result["result_type"] == "SUPPRESSED"
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["reason"] == "inside_destination_edge"


# ===========================================================================
# Task 5 — forecast-based EARLY-rest decision path (REST_FORECAST_FIRE)
# (spec §11, §12, §14; brief §20.1 items 3,4,5,8,9,10,12,13,14)
# ===========================================================================
#
# Deterministic score control: with `motion_state="STOPPED"` no accumulator
# accrues this tick (`accrue=False`), so s_base and s_realtime are 0 and
# s_total == cumulative_jam_min * w_jam (0.8). Seeding prev_state with
# cumulative_jam_min=100.0 → s_total==80.0 exactly (the early threshold
# boundary); 110.0 → 88.0 (strictly inside the (80, 100) early band). Both
# products are exact in IEEE-754 (verified). No signal tuning that depends on
# the drowsiness/fatigue ReLU weights (which cannot hit 80.0 exactly) is used.


def _forecast_block(*, current_actionable=True, future_unactionable=True,
                    future_found=True, order_valid=True):
    """An orchestration-supplied `nri_forecast` block (Task 4 shape) describing
    an eligible early-rest situation: a future fire is forecast, the future
    rest spot there would be unusable, and the CURRENT spot is actionable."""
    return {
        "evaluated": True,
        "error": None,
        "threshold_order_valid": order_valid,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": {"content_active": True, "service_id": "humming_karaoke",
                           "content_remaining_min": 11.0},
        "future_fire": {"found": future_found, "tick_index": 42, "elapsed_min": 126.0,
                        "distance_km": 101.5, "route_fraction": 0.84, "s_total": 100.8},
        "forecast_rest_spot": {"exists": True, "position_km": 116.0, "eta_from_fire_min": 34.0,
                               "eta_to_destination_min": 22.0, "actionable": False},
        "forecast_future_rest_unactionable": future_unactionable,
        "forecast_rest_unactionable_reason": "eta_over_30_min" if future_unactionable else None,
        "current_rest_spot": {"exists": True, "position_km": 83.0, "eta_from_current_min": 18.0,
                              "eta_to_destination_min": 31.0, "actionable": current_actionable,
                              "unactionable_reason": None if current_actionable
                              else "rest_spot_eta_over_limit"},
    }


def _early_ctx(nri_forecast, *, jam_min=110.0):
    """Context whose raw s_total == jam_min * 0.8 (STOPPED → nothing accrues),
    default 88.0 — strictly inside the early band (80, 100)."""
    sig = _signals(motion_state="STOPPED")
    return _ctx(sig, prev_state={"cumulative_jam_min": jam_min}, nri_forecast=nri_forecast)


def test_score_exactly_80_does_not_fire_early():
    # s_total == 80.0 exactly: NOT strictly above the early threshold (§7), so
    # the forecast path must not engage even with every other gate satisfied.
    ctx = _early_ctx(_forecast_block(), jam_min=100.0)
    result = mod.evaluate(ctx)
    assert result["scores"]["s_total"] == 80.0
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    assert result["fire_control"].get("reason") != "forecast_rest_opportunity_passed"


def test_score_above_80_fires_early_when_all_gates_pass():
    ctx = _early_ctx(_forecast_block())
    result = mod.evaluate(ctx)
    assert 80.0 < result["scores"]["s_total"] < 100.0
    assert result["result_type"] == "REST_PROPOSAL"
    assert result["selected_category"] == "rest_required"
    assert result["trigger_candidate"] is True
    assert result["states"]["rest"] == "REST_FORECAST_FIRE"
    assert result["fire_control"]["reason"] == "forecast_rest_opportunity_passed"


def test_early_fire_uses_forecast_proposal_with_clear_strength():
    ctx = _early_ctx(_forecast_block())
    result = mod.evaluate(ctx)
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["strength"] == "clear"
    assert result["proposal"]["options"] == ["accept_rest", "postpone", "decline"]
    assert result["proposal"]["id"] == "forecast_rest_required_proposal"
    # Copy must NOT claim the safety threshold (100) was already crossed
    # (§12.1, §20.1-14). The forecast future-fire figures 101.5 km / 100.8 pts
    # are stripped before the check since they are legitimate forecast values,
    # not a claim about the CURRENT score.
    text = (result["proposal"]["message"]["en"] + result["explanation"][0]["en"]).lower()
    assert "100" not in text.replace("101", "").replace("100.8", "")
    assert "exceeded the threshold" not in text


def test_early_fire_suppresses_monotony_as_superseded_by_forecast_rest():
    ctx = _early_ctx(_forecast_block())
    result = mod.evaluate(ctx)
    mono = next(c for c in result["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["fired"] is False
    assert mono["fire_control"]["reason"] == "superseded_by_forecast_rest"


def test_blocked_early_path_never_sets_forecast_fire_state():
    # Current spot not actionable → no early fire; monotony stays ordinary.
    ctx = _early_ctx(_forecast_block(current_actionable=False))
    result = mod.evaluate(ctx)
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["fired"] is False
    mono = next(c for c in result["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["reason"] != "superseded_by_forecast_rest"


def test_invalid_threshold_order_disables_only_forecast_path():
    ctx = _early_ctx(_forecast_block(order_valid=False))
    result = mod.evaluate(ctx)
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    assert result["criteria"]["forecast_threshold_order_valid"] is False


def test_future_unactionable_alone_without_current_spot_does_not_fire():
    # Future spot unusable but the CURRENT spot is not actionable either →
    # nothing to propose early; the forecast path stays off.
    ctx = _early_ctx(_forecast_block(current_actionable=False,
                                     future_unactionable=True))
    result = mod.evaluate(ctx)
    assert (result["result_type"] != "REST_PROPOSAL"
            or result["selected_category"] != "rest_required")
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"


def test_early_fire_replaces_rest_gates_with_forecast_gate_list():
    # §14.2: when a forecast block is present the rest_required gate list is
    # the full ordered 11-gate forecast list, not the 2-gate ordinary summary.
    ctx = _early_ctx(_forecast_block())
    result = mod.evaluate(ctx)
    gates = result["feature_contributions"]["rest_required"]["gates"]
    gate_ids = [g["gate_id"] for g in gates]
    assert gate_ids == [
        "forecast_threshold_order",
        "forecast_current_score",
        "forecast_future_fire",
        "forecast_committed_intervention",
        "forecast_future_rest_spot",
        "forecast_future_rest_spot_eta",
        "forecast_destination_edge",
        "forecast_current_rest_spot",
        "forecast_current_rest_spot_eta",
        "forecast_current_rest_spot_destination_edge",
        "recovery_suppression",
    ]
    by_id = {g["gate_id"]: g for g in gates}
    # The FUTURE rest-spot ETA gate is the one that fails (34 min > 30 filter):
    # that unusable future spot is precisely why an early rest fires now.
    assert by_id["forecast_future_rest_spot_eta"]["passed"] is False
    # The CURRENT spot's gates all pass (18 min ETA ≤ 30, 31 min to dest ≥ 10),
    # and recovery is not active — so the early rest is actionable right now.
    assert by_id["forecast_current_rest_spot_eta"]["passed"] is True
    assert by_id["forecast_current_rest_spot_destination_edge"]["passed"] is True
    assert by_id["recovery_suppression"]["passed"] is True


def test_early_fire_criteria_expose_forecast_evidence():
    # §14.1: the forecast block's key figures are surfaced under criteria for
    # the review panel to audit the early-fire decision.
    ctx = _early_ctx(_forecast_block())
    result = mod.evaluate(ctx)
    crit = result["criteria"]
    assert crit["threshold_forecast_rest"] == 80.0
    assert crit["forecast_threshold_order_valid"] is True
    assert crit["forecast_fire_found"] is True
    assert crit["forecast_fire_s_total"] == 100.8
    assert crit["forecast_future_rest_unactionable"] is True
    assert crit["forecast_rest_unactionable_reason"] == "eta_over_30_min"
    assert crit["current_rest_spot_actionable"] is True
    # eta-from-now = future_fire.elapsed_min - sim_time/60 = 126.0 - 60/60 = 125.0
    assert crit["forecast_fire_eta_from_now_min"] == pytest.approx(125.0)


def test_no_forecast_block_leaves_ordinary_two_gate_rest_list():
    # Regression guard: without a forecast block the rest gate list stays the
    # ordinary [recovery, eta] pair — the forecast machinery is inert.
    ctx = _ctx(_signals(motion_state="STOPPED"),
               prev_state={"cumulative_jam_min": 110.0})
    result = mod.evaluate(ctx)
    gate_ids = [g["gate_id"] for g in result["feature_contributions"]["rest_required"]["gates"]]
    assert "forecast_threshold_order" not in gate_ids
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"

