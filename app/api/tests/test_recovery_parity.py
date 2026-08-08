"""P5 — both algorithms must react IDENTICALLY to the same driver event.

Any remaining divergence in the curves must come from the algorithms' own
scoring math, never from two different recovery implementations.
"""
import pytest

from tests.helpers_recovery import package_hyperparameter_default, run_identical_stream


@pytest.fixture(autouse=True)
def isolate_run_registries():
    """Clear both in-memory registries so runs from one test don't leak into
    the next (same pattern as test_content_relief.py)."""
    from aica_api.services.run_manager import clear_registry
    from aica_api.services.run_plan import clear_draft_registry

    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def test_both_packages_freeze_monotony_on_exactly_the_same_ticks():
    """Fix-round 2 (Important finding): `accept_monotony_at_tick` alone can't
    make this comparison discriminating. It makes content contingent on EACH
    package's own fire-control timing -- verified empirically, under
    identical is_night/familiar_route/accept_monotony_at_tick, Hybrid's
    6-tick persistence gate fires at a different tick than NRI's immediate
    band crossing (19 vs 16 in one measurement), so `hybrid_frozen ==
    nri_frozen` would be comparing two streams whose content windows don't
    even line up -- a spurious failure, not evidence of anything.

    `content_ticks` sidesteps this: it forces the SAME driver event (content
    plays on these exact ticks) onto both streams as an external fact,
    independent of either package's own trigger logic, which is what makes
    "both algorithms react identically to the same driver event" testable at
    all.
    """
    forced_content_ticks = frozenset(range(10, 15))
    hybrid = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1", content_ticks=forced_content_ticks
    )
    nri = run_identical_stream(
        "nri_fatigue_score_v1", content_ticks=forced_content_ticks
    )

    hybrid_frozen = [
        t.signals["dynamic"]["stimulusFrozen"] for t in hybrid.tick_states
    ]
    nri_frozen = [t.signals["dynamic"]["stimulusFrozen"] for t in nri.tick_states]
    assert any(hybrid_frozen), "content_ticks never landed -- freeze was never exercised"
    assert hybrid_frozen == nri_frozen

    # and each package's own accumulator is flat (or draining) on exactly
    # those ticks -- this loop must actually run, not just type-check
    hybrid_mono = [s["accumulators"]["mono_min"] for s in hybrid.runtime_states]
    nri_mono = [s["cumulative_monotonous_min"] for s in nri.runtime_states]
    comparison_ran = False
    for i, frozen in enumerate(hybrid_frozen[1:], start=1):
        if frozen:
            comparison_ran = True
            assert hybrid_mono[i] <= hybrid_mono[i - 1]
            assert nri_mono[i] <= nri_mono[i - 1]
    assert comparison_ran, "the frozen-tick accumulator comparison never executed"


def test_monotony_relief_never_erases_accumulated_exposure():
    """Design P3 — freeze, don't erase. The old hacks dropped hours to zero.

    is_night/familiar_route are required here, not decorative: under stock
    hyperparameters Hybrid's monotony_prevention_score ceilings at 0.40
    (w_monotony*1.0 with zero env_load) without them, strictly below
    monotony_suggest_threshold=0.5 -- the proposal can never fire, acknowledge
    never lands, and the accumulator is never actually frozen/drained. With
    both flags True the score reaches ~0.75 and genuinely fires (this
    test's own `assert any(frozen)` below is the proof for THIS scenario;
    see also `test_hybrid_monotony_score_has_a_hard_floor_from_night_and_familiar_route`,
    which shares this exact scenario but tests a different, freeze-independent
    claim about the score).
    """
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1",
        is_night=True, familiar_route=True, accept_monotony_at_tick=10,
    )
    frozen = [t.signals["dynamic"]["stimulusFrozen"] for t in result.tick_states]
    assert any(frozen), "acknowledge never landed -- freeze was never exercised"
    mono = [s["accumulators"]["mono_min"] for s in result.runtime_states]
    assert min(mono[10:]) > 0.0, "relief must not zero the accumulator"


def test_nri_monotony_relief_never_erases_accumulated_exposure():
    """Fix-round 2 (Critical finding): the Hybrid-only version of this test
    left NRI's freeze/drain path completely unexercised -- reintroducing
    NRI's own erase-hack (`cumulative_monotonous_min = 0.0` on
    `stimulus_frozen`, at packages/nri_fatigue_score_v1/algorithm.py:503,
    the exact bug this refactor exists to remove) left every test in this
    file green. This is the mirror of
    test_monotony_relief_never_erases_accumulated_exposure for NRI.

    Unlike Hybrid, NRI needs no is_night/familiar_route amplification to
    reach its monotony band: S_total = S_base + S_env (+ S_realtime, ~0 this
    early) crosses threshold_monotony=60 by tick 20 under stock
    hyperparameters and this scenario's own defaults (S_base grows from
    `w_base * driving_min_since_rest`, S_env from `w_monotonous *
    cumulative_monotonous_min` -- both accrue every tick while MOVING on
    this scenario's normal_road segments). NRI also has no persistence gate
    (unlike Hybrid's 6-tick one), so it fires the instant the band is
    entered -- verified: fires at tick 20 with `accept_monotony_at_tick=15`
    below, acknowledge lands immediately once pending.
    """
    result = run_identical_stream("nri_fatigue_score_v1", accept_monotony_at_tick=15)
    frozen = [t.signals["dynamic"]["stimulusFrozen"] for t in result.tick_states]
    assert any(frozen), "acknowledge never landed -- freeze was never exercised"
    mono = [s["cumulative_monotonous_min"] for s in result.runtime_states]
    assert min(mono[15:]) > 0.0, "relief must not zero the accumulator"


def test_hybrid_monotony_score_has_a_hard_floor_from_night_and_familiar_route():
    """Design §7 — night and familiarity are FACTS, not freeze-suppressible
    signals, so they set a floor under monotony_prevention_score that no
    amount of monotony/env freeze-and-drain can push below.

    Renamed in fix-round 3 (was
    test_hybrid_monotony_score_plateaus_at_a_floor_not_zero): it is NOT a
    freeze-exercise test, and claiming otherwise was itself the vacuity bug.
    Round-2 State-3 proved `min(scores[12:]) > 0.0` stayed green even with
    Hybrid's freeze mechanism (`stimulus_frozen`) hardcoded False for the
    whole run — because monotony/env terms only ever ADD to the score in
    `category_scores` (`_row("monotony", ...)`, `_row("env_load", ...)`),
    never subtract, so whether they freeze or not can never be what keeps
    the score above its floor. Freeze/drain IS genuinely exercised
    elsewhere: `test_monotony_relief_never_erases_accumulated_exposure`
    (Hybrid), `test_nri_monotony_relief_never_erases_accumulated_exposure`
    (NRI), and this file's parity test (`content_ticks`-forced comparison).

    The guard here is tight, not `> 0.0`: the score must never drop below
    `w_night*1.0 + w_familiar*familiar_smoothed` — read from the SAME
    manifest `run_identical_stream` loads, not hardcoded, so this stays
    correct if the defaults ever change. `familiar_route`'s smoothed
    feature (`smoothing_alpha=0.5`, constant raw=1.0 every tick since
    `familiar_route=True` from tick 0) is within 2^-13 of 1.0 by tick 12 —
    a fixed 0.999 multiplier is a safe, honest lower bound, not a fudge.
    """
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1",
        is_night=True, familiar_route=True, accept_monotony_at_tick=10,
    )
    scores = [s["smoothed_scores"]["monotony_prevention_score"] for s in result.runtime_states]
    w_night = package_hyperparameter_default("aica_transparent_hybrid_trigger_v1", "w_night")
    w_familiar = package_hyperparameter_default(
        "aica_transparent_hybrid_trigger_v1", "w_familiar"
    )
    expected_floor = w_night + w_familiar * 0.999
    observed_min = min(scores[12:])
    assert observed_min >= expected_floor, (
        f"score dropped below the night+familiar floor: "
        f"min={observed_min!r} < floor={expected_floor!r}"
    )


# §9.2 calibration constraint ("the harness count cap must never be tighter
# than Hybrid's own cadence") is deliberately NOT re-tested here.
#
# A `test_count_cap_never_bites_on_hybrid` lived here and walked
# `decision.fire_control.fired` (the ALGORITHM's raw, per-tick fire flag)
# directly against `_MAX_PROPOSALS_PER_WINDOW` / `_PROPOSAL_COUNT_WINDOW_SEC`.
# Investigated (task 11 fix-round, concern 3) rather than deleted on sight:
#
#   1. At the brief's prescribed `ticks=60` it was vacuous -- Hybrid's first
#      natural fire is at tick 68 under stock hyperparameters, so the loop
#      body never ran.
#   2. Raised to ticks=90 (still no manual responses) to make it real: it
#      went RED. Hybrid fires rest_required every 900s indefinitely once the
#      score plateaus above threshold (its own `rest_cooldown_sec=900`), and
#      the 4th such fire inside a trailing 3600s window trips the count rule
#      (fires at 12420/13320/14220/15120s -- 3 fall within the preceding
#      3600s of the 4th).
#   3. Hypothesis: this is a harness artifact because the stream never
#      answers a paused proposal. Tested directly -- had the stream
#      `action(run_id, "postpone")` every actionable rest_required pause and
#      re-ran to ticks=200. `decision.fire_control.fired` was UNCHANGED,
#      still 900s-spaced. Root cause: the algorithm's raw fire flag is
#      computed from `proposal_history.proposalCountLast30Min`
#      (`_derive_history` in run_manager.py counts EVERY tick with
#      `fire_control.fired=True` unconditionally, regardless of whether that
#      tick's proposal was ever shown/answered) -- responding to the proposal
#      does not change this input at all, so the hypothesis was false: this
#      is NOT an unanswered-proposal artifact.
#   4. What actually changes with a response is `_derive_response_suppression`
#      (used by the REAL `tick()` path to decide `proposal_is_actionable`,
#      i.e. what's actually shown/paused for the driver): once a rest_required
#      fire is answered with postpone, THAT function suppresses the category
#      for 1800s, so the driver-facing cadence is bounded to <= 2/hour --
#      safely under the cap of 3/3600s. The deleted test never exercised that
#      function; it re-implemented only the count half of the rule against
#      the wrong (raw, unfiltered) input, which is why it could go red on a
#      property the real pipeline never exhibits.
#
# Making it "genuinely real" without reproducing this bug means tracking
# `outcome.paused` (driver-facing "shown" fires) instead of raw
# `fire_control.fired`, auto-responding realistically, and asserting the cap
# never trips a naturally-spaced shown cadence -- which is exactly what
# `test_normally_spaced_fires_are_never_count_capped` in
# `test_fire_control_window.py` already proves, synthetically and more
# rigorously (pins the exact boundary: window<=3600 passes, window=3601
# fails; n=9 fires). A live-Hybrid version would only reproduce that same
# property with a coarser, non-boundary-pinned sample. Deleted rather than
# duplicated. See task-11-report.md's fix-round section for the full
# red/green evidence.
