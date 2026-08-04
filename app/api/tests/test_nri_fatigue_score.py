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
):
    """`ordinal` optionally EXTENDS the default `{"signal_duration": "transient"}`
    ordinal view (rather than replacing it), so existing call sites that don't
    pass it keep the exact same context they always built."""
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
# Bugfix (2026-08-04) — FREEZE (not zero) the four accumulators for the ENTIRE
# recovery window, then reset to 0 only at the recovery_just_completed (resume)
# edge. This is DELIBERATELY NOT a mirror of aica_transparent_hybrid_trigger_v1's
# continuous rebaseline: Hybrid clamps its rest score to [0,1] and is dominated
# by drowsiness/fatigue/anomaly, so zeroing its exposure accumulator every tick
# barely moves the (already saturated) score. NRI's s_total is UNBOUNDED and
# dominated by the accumulated-exposure terms, so zeroing at accept-time would
# collapse the score to near-zero immediately — wrong. Freezing keeps S_total
# flat-high through the whole recovery window (accept -> drive-to-spot ->
# dwell), matching Hybrid's OBSERVABLE OUTCOME (flat-high until resume) without
# copying its mechanism. The score only drops at the resume edge.
# ---------------------------------------------------------------------------


def test_accumulators_frozen_at_pre_accept_value_through_the_entire_recovery_window():
    """The exact gap this fix addresses: accumulators must not grow AND must
    not be zeroed during the whole recovery window (MOVING drive-to-spot AND
    STOPPED dwell) — they must stay pinned at their pre-accept value, so the
    score stays flat-high rather than either climbing (pre-fix bug) or
    collapsing to zero (the wrong "fix" this replaces).
    """
    # Build up real pre-accept exposure so a regression in either direction
    # (still climbing, or wrongly zeroed) is visibly detectable.
    signals_pre_accept = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")
    r1 = mod.evaluate(_ctx(signals_pre_accept, sim_time=60.0))
    state = r1["next_package_runtime_state"]
    pre_accept_jam = state["cumulative_jam_min"]
    pre_accept_hw = state["cumulative_highway_min"]
    pre_accept_mono = state["cumulative_monotonous_min"]
    pre_accept_driving = state["driving_min_since_rest"]
    assert pre_accept_jam > 0.0
    assert pre_accept_hw > 0.0
    assert pre_accept_mono > 0.0
    assert pre_accept_driving > 0.0
    pre_accept_s_total = r1["scores"]["s_total"]
    assert pre_accept_s_total > 0.0

    # Accept-tick and several more MOVING ticks while recoveryPhase is set —
    # the drive-to-spot leg. Every accumulator must stay EXACTLY at its
    # pre-accept value (frozen), not grow and not drop to 0.
    t = 120.0
    for _ in range(5):
        signals_driving_to_spot = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
            recovery_phase="driving_to_spot",
        )
        r = mod.evaluate(_ctx(signals_driving_to_spot, prev_state=state, sim_time=t))
        ns = r["next_package_runtime_state"]
        assert ns["cumulative_jam_min"] == pytest.approx(pre_accept_jam)
        assert ns["cumulative_highway_min"] == pytest.approx(pre_accept_hw)
        assert ns["cumulative_monotonous_min"] == pytest.approx(pre_accept_mono)
        assert ns["driving_min_since_rest"] == pytest.approx(pre_accept_driving)
        assert r["scores"]["s_total"] == pytest.approx(pre_accept_s_total)
        assert r["fire_control"]["suppressed"] is True
        assert r["fire_control"]["reason"] == "recovery_after_accept"
        state = ns
        t += 60.0

    # Now the STOPPED dwell — same freeze, via the pre-existing is_moving gate
    # (accrue is False either way, but the accumulators must still read the
    # SAME frozen value, not 0).
    for _ in range(3):
        signals_dwell = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="STOPPED",
            recovery_phase="resting",
        )
        r = mod.evaluate(_ctx(signals_dwell, prev_state=state, sim_time=t))
        ns = r["next_package_runtime_state"]
        assert ns["cumulative_jam_min"] == pytest.approx(pre_accept_jam)
        assert ns["cumulative_highway_min"] == pytest.approx(pre_accept_hw)
        assert ns["cumulative_monotonous_min"] == pytest.approx(pre_accept_mono)
        assert ns["driving_min_since_rest"] == pytest.approx(pre_accept_driving)
        assert r["scores"]["s_total"] == pytest.approx(pre_accept_s_total)
        state = ns
        t += 60.0

    # Resume (recoveryPhase None again): resets to 0 and starts re-accumulating
    # fresh. In THIS setup the pre-accept state was also produced by a single
    # first tick (prev_state={}), so the resumed accumulators land back at
    # the SAME "one fresh tick" value (1.0 each) — the reset is a genuine
    # restart from 0, not merely "a smaller number than before".
    signals_resumed = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")
    r_resume = mod.evaluate(_ctx(signals_resumed, prev_state=state, sim_time=t))
    ns_resume = r_resume["next_package_runtime_state"]
    assert ns_resume["cumulative_jam_min"] == pytest.approx(1.0)
    assert ns_resume["cumulative_highway_min"] == pytest.approx(1.0)
    assert ns_resume["cumulative_monotonous_min"] == pytest.approx(1.0)
    assert ns_resume["driving_min_since_rest"] == pytest.approx(1.0)
    assert r_resume["scores"]["s_total"] == pytest.approx(pre_accept_s_total)
    # Crucially, this is a real reset-then-regrow, not a no-op freeze that
    # happened to coincide with 1.0: confirm one MORE tick after resume grows
    # past the frozen plateau, proving accumulation resumed from 0 and not
    # from the (much larger, after 8 held ticks) frozen total.
    r_after_resume = mod.evaluate(_ctx(signals_resumed, prev_state=ns_resume, sim_time=t + 60.0))
    assert r_after_resume["next_package_runtime_state"]["cumulative_jam_min"] == pytest.approx(2.0)


def test_score_does_not_drop_at_accept_time_only_at_resume():
    """The corrected contract, stated as the trajectory the user confirmed:
    the score must NOT drop on the first recovery tick (accept-time) — it
    stays ~equal to the pre-accept value — and must drop only at the resume
    edge (recovery_just_completed), once the accumulators reset to 0.
    """
    signals_pre_accept = _signals(
        is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
        drowsiness=90.0, fatigue=0.0,
    )
    r1 = mod.evaluate(_ctx(signals_pre_accept, sim_time=60.0))
    state = r1["next_package_runtime_state"]
    pre_accept_s_total = r1["scores"]["s_total"]
    pre_accept_s_base = r1["scores"]["s_base"]
    pre_accept_s_env = r1["scores"]["s_env"]

    # First recovery tick — still MOVING (drive-to-spot), same drowsiness.
    signals_accept = _signals(
        is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
        drowsiness=90.0, fatigue=0.0, recovery_phase="driving_to_spot",
    )
    r2 = mod.evaluate(_ctx(signals_accept, prev_state=state, sim_time=120.0))

    # s_base and s_env are FROZEN at their pre-accept values (accumulators did
    # not grow, did not zero); s_realtime is untouched by recovery. The total
    # must stay approximately equal to the pre-accept total — NOT drop.
    assert r2["scores"]["s_base"] == pytest.approx(pre_accept_s_base)
    assert r2["scores"]["s_env"] == pytest.approx(pre_accept_s_env)
    assert r2["scores"]["s_total"] == pytest.approx(pre_accept_s_total)

    # Several more approach ticks and a dwell tick: still flat, still no drop.
    t = 180.0
    ns = r2["next_package_runtime_state"]
    for _ in range(3):
        signals_driving_to_spot = _signals(
            is_traffic_jam=True, segment_type="highway", motion_state="MOVING",
            drowsiness=90.0, fatigue=0.0, recovery_phase="driving_to_spot",
        )
        r = mod.evaluate(_ctx(signals_driving_to_spot, prev_state=ns, sim_time=t))
        assert r["scores"]["s_total"] == pytest.approx(pre_accept_s_total)
        ns = r["next_package_runtime_state"]
        t += 60.0

    signals_dwell = _signals(
        is_traffic_jam=True, segment_type="highway", motion_state="STOPPED",
        drowsiness=90.0, fatigue=0.0, recovery_phase="resting",
    )
    r_dwell = mod.evaluate(_ctx(signals_dwell, prev_state=ns, sim_time=t))
    assert r_dwell["scores"]["s_total"] == pytest.approx(pre_accept_s_total)
    ns = r_dwell["next_package_runtime_state"]
    t += 60.0

    # Resume edge: accumulators reset to 0, so s_base/s_env collapse and the
    # total DOES drop, leaving only this tick's fresh contribution.
    signals_resumed = _signals(
        is_traffic_jam=False, segment_type="mountain_road", motion_state="MOVING",
        drowsiness=90.0, fatigue=0.0,
    )
    r_resume = mod.evaluate(_ctx(signals_resumed, prev_state=ns, sim_time=t))
    # s_base is a FRESH one-tick total (driving_min_since_rest reset to 0, then
    # this MOVING tick added 1 min) — numerically equal to the pre-accept
    # tick's s_base (also a fresh first tick), NOT smaller. s_env, however,
    # resets to (near) 0 since the resume signal is jam-free/non-monotonous,
    # so it drops well below the pre-accept accumulated total. That drop is
    # what makes s_total fall relative to the flat plateau held throughout
    # the whole recovery window.
    assert r_resume["scores"]["s_base"] == pytest.approx(pre_accept_s_base)
    assert r_resume["scores"]["s_env"] < pre_accept_s_env
    assert r_resume["scores"]["s_total"] < pre_accept_s_total
    # Only the realtime term plus one fresh tick's driving time survive.
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
    # Sentinel rest spot passes ETA.
    signals = _signals(next_rest_spot_min=9999.0)
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
    signals = _signals(next_rest_spot_min=30.0)  # > rest_spot_eta_filter_min (15)
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["scores"]["s_total"] >= HP["threshold_fire"]
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "rest_spot_too_far"
    assert result["fire_control"]["fired"] is False


def test_post_fire_eta_filter_fires_when_spot_within_filter():
    signals = _signals(next_rest_spot_min=10.0)  # <= 15
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "fire_threshold_passed"


def test_post_fire_eta_filter_fires_when_no_rest_spot_ahead_sentinel():
    signals = _signals(next_rest_spot_min=9999.0)  # no spot ahead -> filter passes
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "fire_threshold_passed"


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
    r = mod.evaluate(_ctx(_signals(), prev_state=_primed_state(), sim_time=60.0))
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
    far = _signals(next_rest_spot_min=30.0)  # > rest_spot_eta_filter_min (15)
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
    signals = _signals(next_rest_spot_min=30.0)  # > rest_spot_eta_filter_min (15)
    r = mod.evaluate(_ctx(signals, sim_time=60.0))
    gates = {g["gate_id"]: g for g in r["feature_contributions"]["rest_required"]["gates"]}
    eta_gate = gates["rest_spot_eta_filter_min"]
    assert eta_gate["evaluated_inputs"] == {"nextRestSpotMin": 30.0}
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
# Bugfix 0804 — relieve MONOTONY exposure when its OWN proposal is ANSWERED
# (acknowledge OR decline), mirroring the Hybrid's `mono_min` rebaseline
# (aica_transparent_hybrid_trigger_v1.algorithm.py, "1d. rebaseline MONOTONY
# exposure on a served MONOTONY proposal"). Before this, once
# `cumulative_monotonous_min` saturated the monotony band it never fell, and
# answering the monotony proposal changed nothing — the score stayed pinned
# above `threshold_monotony` and could re-fire every tick forever (no
# cooldown). Guard: `lastProposalCategory == "monotony_prevention" and
# lastProposalResult is not None` — ANY answer relieves, not acknowledge-only
# (confirmed design decision). Only `cumulative_monotonous_min` is reset —
# jam/highway/driving accumulators are untouched (content does not clear a
# traffic jam or un-drive the highway).
# ---------------------------------------------------------------------------


def _mono_ph(result: str = "acknowledge", time_sec: float = 60.0) -> dict:
    return dict(
        _EMPTY_PH,
        lastProposalTimeSec=time_sec,
        lastProposalCategory="monotony_prevention",
        lastProposalResult=result,
    )


def _drive_monotonous(ticks: int, start_t: float = 60.0, step: float = 60.0):
    """Drive `ticks` MOVING ticks on a monotonous (highway) segment, threading
    `package_runtime_state` forward. Returns (last_next_state, next_sim_time),
    where `next_sim_time` is the sim_time of the NEXT (not yet evaluated) tick.
    """
    state: dict = {}
    t = start_t
    for _ in range(ticks):
        result = mod.evaluate(_ctx(
            _signals(segment_type="highway", motion_state="MOVING"),
            prev_state=state, sim_time=t,
        ))
        state = result["next_package_runtime_state"]
        t += step
    return state, t


def test_monotony_answer_relieves_cumulative_monotonous_min():
    state, t = _drive_monotonous(5)
    assert state["cumulative_monotonous_min"] > 0.0, "setup: monotony must accumulate first"

    # Non-monotonous segment on the relief tick isolates the reset from
    # same-tick re-accumulation (mirrors the existing recovery-reset test).
    ph = _mono_ph(time_sec=t)
    relief = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    next_state = relief["next_package_runtime_state"]
    assert next_state["cumulative_monotonous_min"] == 0.0
    assert next_state["mono_intervention_handled_sec"] == t


def test_monotony_relief_drops_s_env_and_s_total():
    state, t = _drive_monotonous(5)

    baseline = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t,
    ))
    relief = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=_mono_ph(time_sec=t),
    ))

    assert relief["scores"]["s_env"] < baseline["scores"]["s_env"]
    assert relief["scores"]["s_total"] < baseline["scores"]["s_total"]
    assert relief["next_package_runtime_state"]["cumulative_monotonous_min"] == 0.0

    mono_row = next(
        row for row in relief["feature_contributions"]["rest_required"]["rows"]
        if row["feature_id"] == "monotony"
    )
    assert mono_row["contribution"] == 0.0


def test_monotony_relief_fires_only_once():
    state, t = _drive_monotonous(5)
    ph = _mono_ph(time_sec=t)

    relief = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    relieved_state = relief["next_package_runtime_state"]
    assert relieved_state["cumulative_monotonous_min"] == 0.0
    assert relieved_state["mono_intervention_handled_sec"] == t

    # The SAME (already-handled) proposal_history over several more ticks must
    # NOT re-zero the accumulator each tick — it has to resume accumulating,
    # otherwise monotony could never rebuild to fire again.
    later = relieved_state
    tt = t
    prev_val = later["cumulative_monotonous_min"]
    for _ in range(3):
        tt += 60.0
        result = mod.evaluate(_ctx(
            _signals(segment_type="highway", motion_state="MOVING"),
            prev_state=later, sim_time=tt, proposal_history=ph,
        ))
        later = result["next_package_runtime_state"]
        assert later["cumulative_monotonous_min"] > prev_val
        prev_val = later["cumulative_monotonous_min"]
        assert later["mono_intervention_handled_sec"] == t


def test_unanswered_monotony_proposal_does_not_relieve():
    state, t = _drive_monotonous(5)
    ph = _mono_ph(result=None, time_sec=t)
    result = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    next_state = result["next_package_runtime_state"]
    assert next_state["cumulative_monotonous_min"] == pytest.approx(state["cumulative_monotonous_min"])
    assert next_state["mono_intervention_handled_sec"] is None


def test_monotony_decline_also_relieves():
    # Confirmed design decision: ANY non-null result relieves, not
    # acknowledge-only.
    state, t = _drive_monotonous(5)
    ph = _mono_ph(result="decline", time_sec=t)
    result = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    next_state = result["next_package_runtime_state"]
    assert next_state["cumulative_monotonous_min"] == 0.0
    assert next_state["mono_intervention_handled_sec"] == t


def test_rest_proposal_answer_does_not_relieve_monotony():
    """An answered REST proposal (no recoveryPhase set) must not touch monotony
    — nor the jam/highway accumulators. Only a monotony_prevention proposal's
    own answer relieves monotony."""

    def _drive_jam_highway(ticks: int, start_t: float = 60.0, step: float = 60.0):
        state: dict = {}
        t = start_t
        for _ in range(ticks):
            r = mod.evaluate(_ctx(
                _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING"),
                prev_state=state, sim_time=t,
            ))
            state = r["next_package_runtime_state"]
            t += step
        return state, t

    state, t = _drive_jam_highway(5)
    ph = dict(
        _EMPTY_PH,
        lastProposalTimeSec=t,
        lastProposalCategory="rest_required",
        lastProposalResult="accept_rest",
    )

    with_ph = mod.evaluate(_ctx(
        _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    without_ph = mod.evaluate(_ctx(
        _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING"),
        prev_state=state, sim_time=t,
    ))

    ns_with = with_ph["next_package_runtime_state"]
    ns_without = without_ph["next_package_runtime_state"]
    assert ns_with["cumulative_monotonous_min"] == pytest.approx(ns_without["cumulative_monotonous_min"])
    assert ns_with["cumulative_jam_min"] == pytest.approx(ns_without["cumulative_jam_min"])
    assert ns_with["cumulative_highway_min"] == pytest.approx(ns_without["cumulative_highway_min"])
    assert ns_with["mono_intervention_handled_sec"] is None


def test_recovery_completion_still_resets_monotony():
    """The pre-existing recovery-completion reset path must still zero
    monotony after this change — the two reset paths (recovery completion vs.
    an answered monotony proposal) are independent and must not interfere."""
    signals_moving_mono = _signals(segment_type="highway", motion_state="MOVING")
    r1 = mod.evaluate(_ctx(signals_moving_mono, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_monotonous_min"] > 0.0

    signals_recovering = _signals(recovery_phase="resting", motion_state="STOPPED")
    r2 = mod.evaluate(_ctx(signals_recovering, prev_state=state1, sim_time=120.0))
    state2 = r2["next_package_runtime_state"]

    signals_resumed = _signals(segment_type="mountain_road", motion_state="MOVING")
    r3 = mod.evaluate(_ctx(signals_resumed, prev_state=state2, sim_time=180.0))
    state3 = r3["next_package_runtime_state"]
    assert state3["cumulative_monotonous_min"] == 0.0


def test_missing_mono_intervention_handled_sec_key_defaults_gracefully():
    """A prev_state persisted BEFORE this bugfix never had
    `mono_intervention_handled_sec` — its absence must default gracefully
    (falsy/None), not raise KeyError."""
    state, t = _drive_monotonous(5)
    del state["mono_intervention_handled_sec"]  # simulate a pre-bugfix legacy state

    ph = _mono_ph(time_sec=t)
    result = mod.evaluate(_ctx(
        _signals(segment_type="mountain_road", motion_state="MOVING"),
        prev_state=state, sim_time=t, proposal_history=ph,
    ))
    next_state = result["next_package_runtime_state"]
    assert next_state["cumulative_monotonous_min"] == 0.0
    assert next_state["mono_intervention_handled_sec"] == t


def test_determinism_same_context_with_monotony_proposal_history_yields_same_result():
    signals = _signals(
        drowsiness=65.0, fatigue=50.0, is_night=True, is_traffic_jam=True,
        segment_type="highway", motion_state="MOVING",
    )
    ph = _mono_ph(time_sec=30.0)
    ctx = _ctx(signals, sim_time=60.0, proposal_history=ph)
    r1 = mod.evaluate(dict(ctx))
    r2 = mod.evaluate(dict(ctx))
    assert r1["scores"] == r2["scores"]
    assert r1["fire_control"] == r2["fire_control"]
    assert r1["next_package_runtime_state"] == r2["next_package_runtime_state"]
