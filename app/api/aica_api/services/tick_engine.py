"""Tick engine (T013 migration; feature 009 signal-tier redesign) — M1 and M2 tick
advancement.

Pure, deterministic, side-effect-free.  Same inputs → same outputs every call.

M1 API (stateless, reads from frozen per-tick plan):
  compute_tick_state(plan, tick_index, scenario) -> TickState
  build_adapter_context(tick_state) -> dict

M2 API (stateful, profile-driven, no pre-computed per-tick plan):
  advance_tick(prior_state, tick_index, event_plan, route_facts, scenario,
               *, recovery=None, run_seed=None,
               content=None, content_relief=None) -> TickState

M2 design (feature 009):
  - Position: effective_speed_kph = traffic_jam_kph if jam else
    speed_profile[segment_type] (`_speed_kph`); distance_km += effective_speed *
    tick_seconds / 3600.  nextRestSpotMin integrates that SAME speed rule forward
    over the planned profile (`_eta_min_to_km`) instead of dividing the remaining
    distance by the momentary speed.
  - Driver signals (Tier 3a): drowsiness/fatigue advance via
    behavior.driver_signals.advance_driver_state.  The attention signal and the
    whole vehicle model (steering/pedal/lane/ADAS) are retired.
  - Anomaly signal (Tier 3b): behavior.anomaly_signal.advance_anomaly — the ONLY
    source of randomness, seeded by (run_seed, tick_index, "anomaly").  Its rolling
    window state is threaded via TickState.anomaly_events.
  - TickState.signals carries the tiered {fixed, dynamic, simulated} dict (see
    specs/009-signal-tier-redesign/contracts/tiered-context.md) — replaces the old
    flat raw_state dict.  NONE of the removed signals (attentionLevel,
    steeringInstabilityLevel, pedalAbnormalityLevel, laneDepartureCount,
    adasWarningCount, *RemainingMin, restSpotDensityNext30Min) are emitted.
  - feature_groups derived from route/context state via binning.build_feature_groups
    (Principle IV route boundary-binning; unrelated to Tier-3 signals).
  - completed = True when distance_km >= total_route_distance_km.
  - Recovery-semantics refactor: ONE motion-split recovery path. STOPPED +
    an active RecoveryState stage recovers via a per-tick curve across the
    dwell (apply_stage_recovery_tick); MOVING + a ContentContext playing
    recovers via a per-tick rate on the <service>@<purpose> recovery_model
    entry (apply_rest_recovery_rate_capped), and freezes + drains the
    monotony proxy (signals.dynamic.stimulusFrozen / .stimulusReliefMin)
    while it plays — freeze alone does not satisfy Design §6 case 1; the
    accumulator-minutes drained THIS tick are published in
    stimulusReliefMin (0.0 when nothing is playing) so a pure algorithm
    package can apply the SAME drain to its own accumulator instead of
    re-deriving it. The two retired one-shot functions (apply_rest_recovery /
    apply_rest_recovery_minutes) and RecoveryStage.grants_moving_recovery are
    gone.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from aica_api.models.run import (
    ContentContext,
    ContentReliefState,
    EventPlan,
    FeatureGroups,
    RecoveryState,
    RouteFacts,
    TickState,
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.binning import (
    bin_context,
    bin_drowsiness_level,
    bin_fatigue_level,
    build_feature_groups,
)

if TYPE_CHECKING:
    pass

# ---------------------------------------------------------------------------
# M1 Public API
# ---------------------------------------------------------------------------


def compute_tick_state(
    plan: EventPlan,
    tick_index: int,
    scenario: ScenarioDef,
) -> TickState:
    """Compute the TickState for a given tick index from the frozen M1 plan.

    Args:
        plan:       The frozen EventPlan (must have per-tick ticks[]).
        tick_index: The tick to evaluate (0-based).
        scenario:   The scenario definition (for initial_state + segment info).

    Returns:
        A TickState.  When tick_index >= len(plan.ticks) the returned state
        has completed=True, route_fraction=1.0, and the last known segment.
    """
    total_ticks = len(plan.ticks)
    fatigue_level = scenario.initial_state.get("fatigue_level", "low")
    segments = scenario.route_intent.segments
    last_segment_id = segments[-1].id if segments else "unknown"

    # ── Completed: past the last valid index ──────────────────────────────
    if tick_index >= total_ticks:
        elapsed_seconds = scenario.total_duration_seconds
        return TickState(
            tick_index=tick_index,
            elapsed_seconds=elapsed_seconds,
            route_fraction=1.0,
            active_segment_id=last_segment_id,
            drowsiness_level=_last_drowsiness(plan),
            fatigue_level=fatigue_level,
            signal_duration="transient",
            continuous_driving_time=_drive_time_band(elapsed_seconds),
            rest_spot_eta="none",
            completed=True,
        )

    # ── Normal tick ───────────────────────────────────────────────────────
    entry = plan.ticks[tick_index]

    # Access extra fields stored on TickPlanEntry (extra="allow")
    extra = entry.model_extra or {}
    elapsed_seconds = extra.get("elapsed_seconds", tick_index * scenario.tick_seconds)
    continuous_driving_time = extra.get(
        "continuous_driving_time",
        _drive_time_band(elapsed_seconds),
    )
    active_segment_id = extra.get("active_segment_id", last_segment_id)

    return TickState(
        tick_index=tick_index,
        elapsed_seconds=elapsed_seconds,
        route_fraction=entry.route_fraction,
        active_segment_id=active_segment_id,
        drowsiness_level=entry.drowsiness_band,
        fatigue_level=fatigue_level,
        signal_duration=entry.signal_duration,
        continuous_driving_time=continuous_driving_time,
        rest_spot_eta=entry.rest_spot_eta,
        completed=False,
    )


def build_adapter_context(tick_state: TickState) -> dict:
    """Build the adapter context dict from a TickState.

    For M1 TickStates (no signals — legacy compute_tick_state path): returns dict
    with only ordinal-band string values (qualitative discipline preserved).

    For M2 TickStates (feature 009: tiered signals present): returns
    {"signals": {fixed, dynamic, simulated}, "feature_groups": {normalized, ordinal}}
    per specs/009-signal-tier-redesign/contracts/tiered-context.md.  run_manager.tick()
    layers simulation_time_sec / proposal_history / recovery_active /
    hyperparameters / package_runtime_state on top of this dict.

    Args:
        tick_state: The computed TickState for the current tick.

    Returns:
        A context dict.  For M1: only flat ordinal bands.
        For M2: {"signals": {...}, "feature_groups": {...}}.
    """
    # If the tick_state has tiered signals populated (M2 path), return the
    # tiered-context shape exactly — no flattening, no removed keys.
    if tick_state.signals:
        return {
            "signals": tick_state.signals,
            "feature_groups": {
                "normalized": tick_state.feature_groups.normalized,
                "ordinal": tick_state.feature_groups.ordinal,
            },
        }

    # M1: flat ordinal bands only
    return {
        "drowsiness_level": tick_state.drowsiness_level,
        "fatigue_level": tick_state.fatigue_level,
        "signal_duration": tick_state.signal_duration,
        "continuous_driving_time": tick_state.continuous_driving_time,
        "rest_spot_eta": tick_state.rest_spot_eta,
    }


# ---------------------------------------------------------------------------
# M2 Public API
# ---------------------------------------------------------------------------


def advance_tick(
    prior_state: TickState | None,
    tick_index: int,
    event_plan: EventPlan,
    route_facts: RouteFacts,
    scenario: ScenarioDef,
    *,
    recovery: RecoveryState | None = None,
    run_seed: int | None = None,
    content: ContentContext | None = None,
    content_relief: ContentReliefState | None = None,
) -> TickState:
    """Advance the simulation by one tick using the M2 tiered-signal model.

    Args:
        prior_state: TickState from the previous tick (None for tick 0).
        tick_index:  Current tick index (0-based).
        event_plan:  Frozen M2 EventPlan (tick_seconds + event lists).
        route_facts: RouteFacts from analyze_route(scenario).
        scenario:    Validated ScenarioDef with driver_signal_params /
                     anomaly_signal_params.
        recovery:    Current RecoveryState (None if not resting).
        run_seed:    Deterministic seed for the anomaly generator.  Defaults to
                     scenario.run_seed_default when not supplied.
        content:        The content episode playing this tick (service + purpose),
                        or None. Selects the `<service>@<purpose>` recovery_model
                        entry. Independent of `recovery` — content can play while
                        driving to a rest spot.
        content_relief: Accrual carried from the previous tick of the SAME
                        episode. Reset automatically when `content.recovery_key`
                        differs from `content_relief.content_key`.

    Returns:
        TickState with signals (tiered {fixed, dynamic, simulated}), feature_groups,
        distance_km, continuous_driving_min, monotony_accrued_min, anomaly_events,
        and M1 backward-compat ordinal fields.  completed=True when distance_km >=
        total_route_distance_km.
    """
    tick_seconds = event_plan.tick_seconds
    total_km = route_facts.total_route_distance_km or 120.0
    sp = scenario.speed_profile
    seed = run_seed if run_seed is not None else scenario.run_seed_default

    # ── Get prior numeric values ──────────────────────────────────────────
    if prior_state is None or not prior_state.signals:
        # Tick 0: initialize from scenario.initial_state
        drowsiness = _initial_drowsiness(scenario.initial_state.get("drowsiness_level", "none"))
        fatigue = _initial_fatigue(scenario.initial_state.get("fatigue_level", "low"))
        distance_km = 0.0
        continuous_driving_min = 0.0
        monotony_accrued_min = 0.0
        above_weak = 0
        anomaly_events: list[int] = []
    else:
        simulated = prior_state.signals.get("simulated", {})
        drowsiness = float(simulated.get("drowsiness", 0.0))
        fatigue = float(simulated.get("fatigue", 0.0))
        distance_km = prior_state.distance_km or 0.0
        continuous_driving_min = prior_state.continuous_driving_min or 0.0
        monotony_accrued_min = prior_state.monotony_accrued_min or 0.0
        above_weak = prior_state.above_weak_ticks
        anomaly_events = list(prior_state.anomaly_events)

    # ── Determine active segment type at current distance ─────────────────
    segment_type = _segment_type_at(distance_km, route_facts)

    # ── Check active events at this tick ──────────────────────────────────
    elapsed_min = tick_index * tick_seconds / 60.0
    is_traffic_jam = _active_traffic_jam(elapsed_min, distance_km, event_plan)
    is_night = scenario.is_night
    is_monotonous = segment_type in ("highway", "normal_road")
    is_mountain_road = segment_type == "mountain_road"

    # ── Advance position ──────────────────────────────────────────────────
    effective_speed = _speed_kph(segment_type, is_traffic_jam, sp)

    new_distance_km = distance_km + effective_speed * tick_seconds / 3600.0
    route_fraction = min(1.0, new_distance_km / total_km)
    completed = new_distance_km >= total_km
    new_continuous_min = continuous_driving_min + tick_seconds / 60.0

    # ── Recovery override (Approach A) ────────────────────────────────────
    from aica_api.services.recovery import advance_recovery, current_stage
    recovery_next = None
    motion_state = "MOVING"
    recovery_phase = None
    if recovery is not None and recovery.active:
        option = next((o for o in scenario.recovery_options if o.id == recovery.option_id), None)
        if option is not None:
            stage = current_stage(recovery, option)
            # Snapping BACK to the spot is legitimate ONLY when the car overshot
            # it within THIS tick's own travel — that is the arrival clamp that
            # stops a one-step overshoot drawing a hook on the distance axis.
            # A larger gap means the spot is genuinely behind the driver, and
            # pulling them back would put a backward step in `progress` (observed
            # on uc04-01: a 26km jump that drew the rest dot behind the proposal
            # that caused it). A car cannot un-drive road.
            _tick_frac = (effective_speed * tick_seconds / 3600.0) / total_km if total_km else 0.0
            def _snap(current_frac: float) -> float:
                if spot_frac >= current_frac:
                    return spot_frac                      # spot still ahead — clamp forward
                if current_frac - spot_frac <= _tick_frac + 1e-9:
                    return spot_frac                      # just overshot this tick — snap back
                return current_frac                       # genuinely behind — hold position
            spot_frac = recovery.rest_spot.route_fraction if recovery.rest_spot else 1.0
            at_spot = new_distance_km / total_km >= spot_frac
            if stage is not None and stage.motion == "STOPPED":
                # Hold position at the rest spot; do not advance distance.
                # NEVER move BACKWARDS: a car cannot un-drive road. If the chosen
                # spot is behind the current position the driver is already past
                # it, so hold where they are rather than teleporting back. Without
                # this guard the `progress` series goes non-monotonic, and every
                # consumer that maps minutes onto route_fraction (the quickview
                # chart, the map markers) draws the rest dot BEHIND the proposal
                # that caused it (observed on uc04-01/NRI: 372min@0.9240 followed
                # by 375min@0.8718, a 26km jump backwards).
                hold_frac = _snap(route_fraction)
                new_distance_km = hold_frac * total_km
                route_fraction = hold_frac
                completed = False
                motion_state = "STOPPED"
            elif stage is not None and stage.motion == "MOVING" and at_spot:
                # fixbug-0806: the MOVING approach (wakefulness) stage drove the
                # car TOWARD the spot; on the tick it arrives (at_spot) it must
                # CLAMP exactly at the spot, not overshoot past it. Without this,
                # the arrival tick's route_fraction sat a step BEYOND spot_frac
                # and the next (now STOPPED) tick snapped it back — a
                # non-monotonic forward-then-back blip that drew as a hook on the
                # distance-axis quickview score curve right at the rest spot.
                # Never backwards (see the STOPPED branch): clamp forward to the
                # spot on arrival, but hold position if the car is already past it.
                arrive_frac = _snap(route_fraction)
                new_distance_km = arrive_frac * total_km
                route_fraction = arrive_frac
                completed = False
            elif stage is None:
                # fixbug-0806: the one-tick "resuming" phase — every stage is done
                # (stage_index past the last stage) and recovery is about to go
                # inactive. The driver has JUST finished resting and has not pulled
                # away yet, so position must STILL be held at the spot; the car
                # only advances on the NEXT tick, once run_state.recovery is None.
                # Without this the resuming tick advanced a full tick past the spot
                # (0.5 -> 0.5083), and the merged auto-drive pauses on exactly this
                # tick to surface the after-rest proposal — so the animation parked
                # the car one tick BEYOND the gold rest-spot marker ("rested a bit
                # past the rest spot").
                # Never backwards: the driver has just finished resting and has
                # not pulled away yet, so hold where they ARE. Clamping blindly to
                # spot_frac moved the car back on the resuming tick whenever it had
                # been held ahead of the spot, which put a backward step in
                # `progress` at every "restart from rest".
                resume_frac = _snap(route_fraction)
                new_distance_km = resume_frac * total_km
                route_fraction = resume_frac
                completed = False
            recovery_phase = recovery.phase
            recovery_next = advance_recovery(recovery, option, at_rest_spot=at_spot)

    # ── Monotony proxy (feature 020, Slice-3) ──────────────────────────────
    # Package-agnostic 0-100 signal derived purely from segment_type/motion_state/
    # is_night; simulator-owned (this module), never reads/touches any package's
    # own internal monotony state (e.g. the Hybrid package's mono_min). Accrues
    # while driving a monotonous segment (highway/normal_road) MOVING; decays
    # (at twice the accrual rate) otherwise; night adds a flat +20 bonus.
    _MONOTONOUS_SEGMENTS = ("highway", "normal_road")
    # Recovery-semantics refactor: driving content is stimulus, so
    # 刺激がない状態の継続 stops continuing (CDC-SU slide 31). Applies only while
    # MOVING — content at a rest spot is ご褒美, not a countermeasure (slide 38).
    content_active = content is not None
    stimulus_frozen = content_active and motion_state == "MOVING"
    if stimulus_frozen:
        new_monotony_accrued_min = monotony_accrued_min
    elif segment_type in _MONOTONOUS_SEGMENTS and motion_state == "MOVING":
        new_monotony_accrued_min = monotony_accrued_min + tick_seconds / 60.0
    else:
        new_monotony_accrued_min = max(0.0, monotony_accrued_min - 2.0 * tick_seconds / 60.0)

    # Drain on top of the freeze, bounded per episode.  `stimulus_relief_min` is
    # published into `signals.dynamic` (below) so a PURE algorithm package can
    # apply the identical drain to its own accumulator (recovery-semantics
    # refactor — Design §6 case 1 specifies freeze+drain, not freeze alone;
    # algorithms have no clock/behavior imports, so the engine is the only
    # place this amount can be computed, and every consumer must read the
    # SAME number rather than re-derive it, or Hybrid/NRI drift apart).
    content_relief_next: ContentReliefState | None = None
    stimulus_relief_min = 0.0
    if content is not None:
        key = content.recovery_key
        if content_relief is not None and content_relief.content_key == key:
            content_relief_next = content_relief.model_copy()
        else:
            content_relief_next = ContentReliefState(content_key=key)
        if stimulus_frozen and scenario.driver_signal_params is not None:
            from aica_api.services.behavior.driver_signals import apply_stimulus_relief
            _drained, _accrued_stimulus = apply_stimulus_relief(
                scenario.driver_signal_params,
                key,
                tick_minutes=tick_seconds / 60.0,
                accrued_stimulus=content_relief_next.accrued_stimulus,
            )
            new_monotony_accrued_min = max(0.0, new_monotony_accrued_min - _drained)
            stimulus_relief_min = _drained
            content_relief_next = content_relief_next.model_copy(
                update={"accrued_stimulus": _accrued_stimulus}
            )

    # Saturation span for the 0-100 monotony proxy. At the original 30 minutes the
    # display pinned at 100 after half an hour of monotonous driving, so on any
    # long run the whole second half read as a flat 100 — and content relief, which
    # genuinely drains the accumulator (Hybrid: 90 -> 70 min on uc04), was invisible
    # because the clamp swallowed it. 60 minutes is the middle ground: an hour of
    # monotonous driving reads ~80 instead of pinning at 100, so relief shows as a
    # real dip while the curve still occupies a share of the 0-100 band comparable
    # to the drowsiness/fatigue curves beside it (at 120 it sat in the bottom
    # quarter and looked negligible next to them).
    _MONOTONY_SATURATION_MIN = 60.0
    monotony_level = round(
        min(
            100.0,
            (new_monotony_accrued_min / _MONOTONY_SATURATION_MIN) * 80.0
            + (20.0 if is_night else 0.0),
        )
    )

    # ── Advance driver signals (Tier 3a: drowsiness/fatigue) ───────────────
    if scenario.driver_signal_params is not None:
        from aica_api.services.behavior.driver_signals import DriverState, advance_driver_state
        driver_state = DriverState(drowsiness=drowsiness, fatigue=fatigue)
        driver_update = advance_driver_state(
            scenario.driver_signal_params, driver_state, tick_seconds,
            is_night=is_night,
            is_monotonous=is_monotonous,
            is_traffic_jam=is_traffic_jam,
            is_mountain_road=is_mountain_road,
            continuous_driving_min=continuous_driving_min,
            suppress_monotony_growth=stimulus_frozen,
        )
        new_drowsiness = driver_update.next.drowsiness
        new_fatigue = driver_update.next.fatigue
    else:
        driver_update = None
        new_drowsiness = drowsiness
        new_fatigue = fatigue

    # ── Apply recovery ────────────────────────────────────────────────────
    # Recovery-semantics refactor. TWO mechanisms, split by MOTION:
    #
    #   STOPPED + RecoveryState stage  -> rest-activity recovery, per-tick
    #       curve across the dwell (apply_stage_recovery_tick). Total is
    #       identical to the retired one-shot-on-entry model.
    #   MOVING + content playing       -> driving-content recovery, per-tick
    #       rate from the <service>@<purpose> entry, capped per episode.
    #
    # They are independent: a driver en route to a rest spot is MOVING with
    # content playing, so only the second applies until the wheels stop.
    if scenario.driver_signal_params is not None:
        from aica_api.services.behavior.driver_signals import (
            DriverState, apply_rest_recovery_rate_capped, apply_stage_recovery_tick,
        )

        if motion_state == "STOPPED" and recovery is not None and recovery.active:
            _rec_option = next(
                (o for o in scenario.recovery_options if o.id == recovery.option_id), None
            )
            _stage = (
                _rec_option.stages[recovery.stage_index]
                if _rec_option and 0 <= recovery.stage_index < len(_rec_option.stages)
                else None
            )
            if _stage is not None:
                recovered, _acc_d, _acc_f = apply_stage_recovery_tick(
                    scenario.driver_signal_params,
                    DriverState(drowsiness=new_drowsiness, fatigue=new_fatigue),
                    _stage.content,
                    stage_ticks=(_stage.ticks or 0),
                    tick_seconds=tick_seconds,
                    accrued_drowsiness=recovery.moving_recovery_accrued_drowsiness,
                    accrued_fatigue=recovery.moving_recovery_accrued_fatigue,
                )
                new_drowsiness, new_fatigue = recovered.drowsiness, recovered.fatigue
                if (
                    recovery_next is not None
                    and recovery_next.stage_index == recovery.stage_index
                ):
                    recovery_next = recovery_next.model_copy(update={
                        "moving_recovery_accrued_drowsiness": _acc_d,
                        "moving_recovery_accrued_fatigue": _acc_f,
                    })

        elif stimulus_frozen and content_relief_next is not None:
            recovered, _acc_d, _acc_f = apply_rest_recovery_rate_capped(
                scenario.driver_signal_params,
                DriverState(drowsiness=new_drowsiness, fatigue=new_fatigue),
                content.recovery_key,
                tick_minutes=tick_seconds / 60.0,
                accrued_drowsiness=content_relief_next.accrued_drowsiness,
                accrued_fatigue=content_relief_next.accrued_fatigue,
            )
            new_drowsiness, new_fatigue = recovered.drowsiness, recovered.fatigue
            content_relief_next = content_relief_next.model_copy(update={
                "accrued_drowsiness": _acc_d,
                "accrued_fatigue": _acc_f,
            })

    # ── Update drowsinessAboveWeakTicks counter (signal_duration ordinal) ──
    new_above_weak = above_weak + 1 if new_drowsiness >= 20.0 else 0

    # ── Advance anomaly signal (Tier 3b) — the ONLY source of randomness ───
    if scenario.anomaly_signal_params is not None:
        from aica_api.services.behavior.anomaly_signal import AnomalyState, advance_anomaly
        anomaly_update = advance_anomaly(
            params=scenario.anomaly_signal_params,
            prev=AnomalyState(events=anomaly_events),
            drowsiness=new_drowsiness,
            tick_index=tick_index,
            tick_seconds=tick_seconds,
            run_seed=seed,
            is_moving=(motion_state == "MOVING"),
        )
        anomaly_rate = anomaly_update.anomaly_rate
        new_anomaly_events = anomaly_update.next.events
    else:
        anomaly_rate = 0
        new_anomaly_events = anomaly_events

    # ── Compute nextRestSpotMin ───────────────────────────────────────────
    # Minutes to the next rest opportunity ahead, integrated over the PLANNED
    # speed profile between here and that spot (see `_eta_min_to_km`) — NOT
    # `remaining_km / current_speed`. Sentinel 9999.0 still means "no rest spot
    # remains ahead", and nothing else: an unreachable-in-reasonable-time spot
    # returns a large but finite ETA, because the sentinel is what tells a
    # package there is nowhere to stop at all (`nri_fatigue_score_v1` FIRES on
    # it, deliberately).
    next_rest_min: float = _NO_REST_SENTINEL
    for pos_km in sorted(route_facts.rest_spot_positions):
        if pos_km > new_distance_km:
            next_rest_min = _eta_min_to_km(
                target_km=pos_km,
                from_km=new_distance_km,
                from_elapsed_min=elapsed_min + tick_seconds / 60.0,
                route_facts=route_facts,
                event_plan=event_plan,
                sp=sp,
            )
            break

    # ── Build the tiered signals dict (feature 009 contract) ──────────────
    signals: dict = {
        "fixed": {
            "isNight": is_night,
            "familiarRoute": scenario.familiar_route,
            "childPassenger": scenario.child_passenger,
            "weatherRiskLevel": scenario.weather_risk,
        },
        "dynamic": {
            "segmentType": segment_type,
            "motionState": motion_state,
            "continuousDrivingMin": new_continuous_min,
            "speedKph": effective_speed,
            "routeFraction": route_fraction,
            "nextRestSpotMin": next_rest_min,
            "isTrafficJam": is_traffic_jam,
            "recoveryPhase": recovery_phase,
            "monotonyLevel": monotony_level,
            "contentActive": content_active,
            "stimulusFrozen": stimulus_frozen,
            "stimulusReliefMin": stimulus_relief_min,
        },
        "simulated": {
            "drowsiness": new_drowsiness,
            "fatigue": new_fatigue,
            "anomaly_rate": anomaly_rate,
        },
    }

    # ── Build feature_groups (route/context ordinal bands only) ───────────
    fg_dict = build_feature_groups(
        {
            "continuousDrivingMin": new_continuous_min,
            "nextRestSpotMin": next_rest_min,
            "drowsinessAboveWeakTicks": new_above_weak,
        }
    )
    feature_groups = FeatureGroups(
        normalized=fg_dict["normalized"],
        ordinal=fg_dict["ordinal"],
    )
    ordinal = fg_dict["ordinal"]

    # ── Active segment ID (for M1 compat field) ───────────────────────────
    active_segment_id = _active_segment_id(route_fraction, scenario)

    # ── Build driver_update dict for evidence trace ───────────────────────
    if driver_update is not None:
        import dataclasses as _dc
        driver_update_dict = {
            "previous": _dc.asdict(driver_update.previous),
            "delta": _dc.asdict(driver_update.delta),
            "next": {"drowsiness": new_drowsiness, "fatigue": new_fatigue},
        }
    else:
        driver_update_dict = {}

    ts = TickState(
        tick_index=tick_index,
        elapsed_seconds=(tick_index + 1) * tick_seconds,
        route_fraction=route_fraction,
        active_segment_id=active_segment_id,
        drowsiness_level=bin_drowsiness_level(new_drowsiness),
        fatigue_level=bin_fatigue_level(new_fatigue),
        signal_duration=ordinal["signal_duration"],
        continuous_driving_time=ordinal["continuous_driving_time"],
        rest_spot_eta=ordinal["rest_spot_eta"],
        completed=completed,
        signals=signals,
        feature_groups=feature_groups,
        distance_km=new_distance_km,
        continuous_driving_min=new_continuous_min,
        monotony_accrued_min=new_monotony_accrued_min,
        anomaly_events=new_anomaly_events,
        above_weak_ticks=new_above_weak,
        # Pass state through extra fields (model_config extra=allow)
        _driver_update=driver_update_dict,
    )
    if recovery_next is not None:
        ts.model_extra["_recovery_next"] = recovery_next
    if content_relief_next is not None:
        ts.model_extra["_content_relief_next"] = content_relief_next
    return ts


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _drive_time_band(elapsed_seconds: int) -> str:
    """Convert elapsed seconds to a continuous_driving_time band via binning."""
    banded = bin_context({"travel_time_sec": elapsed_seconds})
    return banded["continuous_driving_time"]


def _last_drowsiness(plan: EventPlan) -> str:
    """Return the drowsiness band of the last tick in the plan."""
    if plan.ticks:
        return plan.ticks[-1].drowsiness_band
    return "none"


def _initial_drowsiness(value) -> float:
    """Convert a drowsiness band label or numeric value to an initial float.

    Accepts either:
    - A number (int/float): clamp to [0, 100] and return as float.
    - A band string: map via the established drowsiness-band lookup.
    """
    if isinstance(value, (int, float)):
        return float(max(0.0, min(100.0, float(value))))
    return {
        "none": 0.0,
        "weak": 20.0,
        "moderate": 40.0,
        "strong": 60.0,
        "severe": 80.0,
    }.get(value, 0.0)


def _initial_fatigue(value) -> float:
    """Convert a fatigue band label or numeric value to an initial float.

    Accepts either:
    - A number (int/float): clamp to [0, 100] and return as float.
    - A band string: map via the established fatigue-band lookup.
    """
    if isinstance(value, (int, float)):
        return float(max(0.0, min(100.0, float(value))))
    return {
        "low": 0.0,
        "medium": 30.0,
        "high": 60.0,
    }.get(value, 0.0)


# M2 segment type from km position along route_facts
_ROUTE_SEGMENT_TYPES = {"highway", "mountain_road", "sightseeing_road", "normal_road"}


def _segment_type_at(distance_km: float, route_facts: RouteFacts) -> str:
    """Return the segment type at the given distance along the route."""
    current_type = "normal_road"
    for seg in route_facts.route_segments:
        if seg.start_km <= distance_km:
            current_type = seg.segment_type
    return current_type


def _speed_kph(segment_type: str, is_traffic_jam: bool, sp) -> float:
    """Effective speed for a segment type, or the jam speed when jammed.

    The ONE definition of how fast the car moves at a point on the route: the
    per-tick position advance and the `nextRestSpotMin` ETA integration below
    both call it, so an ETA can never be computed against a speed model the
    simulation itself does not use. `sp` is `scenario.speed_profile` (None
    falls back to the same defaults this code has always used).
    """
    if is_traffic_jam:
        return float(sp.traffic_jam_kph) if sp else 20.0
    speed_map = {
        "normal_road": float(sp.normal_road_kph) if sp else 60.0,
        "highway": float(sp.highway_kph) if sp else 100.0,
        "mountain_road": float(sp.mountain_road_kph) if sp else 40.0,
        "sightseeing_road": float(sp.sightseeing_road_kph) if sp else 30.0,
    }
    return speed_map.get(segment_type, 60.0)


# Sentinel for `nextRestSpotMin`: no rest spot remains ahead on this route.
_NO_REST_SENTINEL = 9999.0

# Integration granularity / ceiling for `_eta_min_to_km`. The step is the
# resolution at which a jam or segment boundary is noticed (so the ETA error
# from a crossing is at most half a minute per boundary); the cap bounds the
# loop for a spot that is unreachably far at a crawl.
_ETA_STEP_MIN = 0.5
_ETA_CAP_MIN = 600.0


def _eta_min_to_km(
    *,
    target_km: float,
    from_km: float,
    from_elapsed_min: float,
    route_facts: RouteFacts,
    event_plan: EventPlan,
    sp,
) -> float:
    """Minutes to drive from `from_km` to `target_km` over the PLANNED profile.

    Forward-integrates the same speed rule the tick loop advances position with
    (`_speed_kph` over `_segment_type_at` / `_active_traffic_jam`), rather than
    dividing the remaining distance by the speed the car happens to be doing
    right now.

    Why (fixbug-0806, UC-01-02): the old `remaining_km / effective_speed`
    presumed the CURRENT condition held all the way to the spot. Sitting in a
    5 km jam at 10 kph with the next facility 18 km away, it reported 106
    minutes for a drive that the frozen event plan says takes ~37 — the jam
    ends at a known kilometre and the road past it is 80 kph highway. That
    inflated number is read by `nri_fatigue_score_v1`'s rest-band ETA filter
    (`rest_spot_eta_filter_min`, default 60), so an over-threshold REST
    proposal was withheld for the entire jam and only fired once traffic
    cleared — kilometres later, with the driver's score still climbing. The
    engine already knows where the jam ends; the ETA now says so.

    A speed of 0 (a jam authored at 0 kph) advances time but not distance, so a
    time-gated stop-dead jam still clears; a km-gated one runs out the cap.
    Returns at most `_ETA_CAP_MIN` — deliberately NOT `_NO_REST_SENTINEL`,
    which means "nowhere to stop ahead" and makes NRI fire.
    """
    distance_km = from_km
    elapsed_min = 0.0
    while distance_km < target_km and elapsed_min < _ETA_CAP_MIN:
        speed = _speed_kph(
            _segment_type_at(distance_km, route_facts),
            _active_traffic_jam(from_elapsed_min + elapsed_min, distance_km, event_plan),
            sp,
        )
        if speed <= 0:
            elapsed_min += _ETA_STEP_MIN
            continue
        # The final step lands exactly on the spot, so a constant-speed run is
        # exact (no rounding up to the step) and terminates without overshoot.
        step_min = min(_ETA_STEP_MIN, (target_km - distance_km) / speed * 60.0)
        distance_km += speed * step_min / 60.0
        elapsed_min += step_min
    return min(elapsed_min, _ETA_CAP_MIN)


def _active_traffic_jam(elapsed_min: float, distance_km: float, event_plan: EventPlan) -> bool:
    """Check if a traffic jam event is active at elapsed_min / distance_km.

    Gates on POSITION (``start_km <= distance_km < end_km``) when an event
    carries both ``start_km`` and ``end_km`` — the correct axis for a
    km-painted jam, since routes are not time-linear in distance. Falls back
    to the original TIME gate (``start_min <= elapsed_min < start_min +
    duration_min``) for events without km fields (back-compat with
    time-only jams, e.g. ``uc03_01_monotony_daytime_jam``).
    """
    for event in event_plan.traffic_events:
        if event.start_km is not None and event.end_km is not None:
            if event.start_km <= distance_km < event.end_km:
                return True
        elif event.start_min <= elapsed_min < event.start_min + event.duration_min:
            return True
    return False


def _active_segment_id(route_fraction: float, scenario: ScenarioDef) -> str:
    """Return the active segment ID for the given route_fraction."""
    segments = scenario.route_intent.segments
    active = segments[0].id if segments else "unknown"
    for seg in segments:
        if seg.at <= route_fraction:
            active = seg.id
    return active
