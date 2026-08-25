"""Tests for `iter_preview_ticks` — the extracted preview tick-loop generator
(feature 020, slice 2c, Task 1).

Two things must hold after the extraction:

1. `iter_preview_ticks` is independently usable: it yields a `PreviewFireEvent`
   at each new actionable-proposal episode (rising edge), tick_index ascending,
   each event carrying a non-None `decision.proposal`.
2. `evaluate_preview`'s return dict is BYTE-IDENTICAL to a baseline captured
   from the pre-extraction implementation (characterization test) — the
   refactor is a zero-behavior-change generator extraction.
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.preview import PreviewFireEvent, evaluate_preview, iter_preview_ticks
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_FIXTURES_DIR = pathlib.Path(__file__).resolve().parent / "fixtures"
_BASELINE_PATH = _FIXTURES_DIR / "preview_characterization_baseline.json"

_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_HYBRID_PKG_ID = "aica_transparent_hybrid_trigger_v1"
_NRI_PKG_ID = "nri_fatigue_score_v1"


@pytest.fixture(autouse=True)
def reset_registries():
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def _default_kwargs(**extra):
    kwargs = dict(
        package_id=_HYBRID_PKG_ID,
        scenario_id=_SCENARIO_ID,
        hyperparameter_overrides={},
        run_seed=42,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
    )
    kwargs.update(extra)
    return kwargs


# ---------------------------------------------------------------------------
# Characterization: evaluate_preview's output is byte-identical to a baseline
# captured from the pre-extraction implementation.
#
# Fire-control refactor (task 7, 2026-08-08): the baseline fixture was
# regenerated (`tests/fixtures/preview_characterization_baseline.json`) after
# `_derive_response_suppression`'s acknowledge branch changed from an
# indefinite latch to the same bounded cooldown window decline uses — this is
# an intentional behavior change, not a refactor regression. The ONLY diff
# from the prior baseline is the now-suppressed third (`tick=33`,
# `monotony_prevention`) fire; every other key (score_series, spikes,
# monotony_series, completed_min, segments, ...) is byte-identical — see
# `test_iter_preview_ticks_single_fire_rest_scenario` for why that third fire
# is gone.
#
# Recovery-semantics refactor (2026-08-08): regenerated again. Two intentional
# behavior changes moved it — Hybrid's persistence gate dropped from 6 ticks to
# 3 (fires land earlier: monotony tick 29 -> 26), and content/rest recovery now
# drains the accumulators instead of only freezing them (score and signal
# series differ from the freeze-only baseline). `signal_series` is a new key
# this refactor adds. Structure and fire ORDER are unchanged.
# ---------------------------------------------------------------------------


def test_evaluate_preview_matches_captured_baseline():
    baseline = json.loads(_BASELINE_PATH.read_text(encoding="utf-8"))

    result = evaluate_preview(**_default_kwargs())

    assert result == baseline, "evaluate_preview output diverged from the pre-refactor baseline"


def test_evaluate_preview_baseline_key_aggregates_sanity():
    """Belt-and-braces on the aggregates the refactor is most likely to break
    (per-tick accumulation split across a generator boundary)."""
    baseline = json.loads(_BASELINE_PATH.read_text(encoding="utf-8"))
    result = evaluate_preview(**_default_kwargs())

    assert result["fired"] is baseline["fired"] is True
    assert result["fire"] == baseline["fire"]
    assert result["fires"] == baseline["fires"]
    assert len(result["score_series"]) == len(baseline["score_series"]) == 35
    assert result["peak_score"] == baseline["peak_score"]
    assert result["threshold"] == baseline["threshold"]
    # Spike COUNT is a tuning-sensitive aggregate, not a structural invariant: the
    # seeded-Poisson anomaly rate scales with drowsiness above theta, so any change
    # to the recovery rates legitimately moves it (it went 10 -> 9 when content
    # relief was tuned to produce a real dip). Assert a floor rather than an exact
    # count — that still catches a silently-empty baseline, which is what the magic
    # number was really guarding, without breaking on every calibration change.
    assert len(result["spikes"]) == len(baseline["spikes"]) >= 5
    assert len(result["monotony_series"]) == len(baseline["monotony_series"]) == 35
    assert result["segments"] == baseline["segments"]
    assert result["completed_min"] == baseline["completed_min"] == 108.0
    assert result["error"] is None


# ---------------------------------------------------------------------------
# iter_preview_ticks: yields a PreviewFireEvent per rising-edge fire.
# ---------------------------------------------------------------------------


def test_iter_preview_ticks_yields_one_event_per_rising_edge_fire():
    """A long route (multi-fire rest scenario) yields exactly one
    PreviewFireEvent per distinct actionable episode, tick_index ascending,
    each carrying a non-None decision.proposal — matching evaluate_preview's
    own `fires` accumulation on the SAME inputs."""
    client = TestClient(app)
    preset = client.post("/api/routes/presets/long_tokyo_osaka/load")
    assert preset.status_code == 200, preset.text
    alt = preset.json()["alternatives"][0]

    kwargs = _default_kwargs(
        route_source="maps",
        route_facts=alt["route_facts"],
        display_route=alt["display"],
    )

    # Reference: evaluate_preview's own `fires` list for the SAME inputs.
    clear_registry()
    clear_draft_registry()
    reference = evaluate_preview(**kwargs)
    assert len(reference["fires"]) > 1, "expected a multi-fire route to discriminate this test"

    # iter_preview_ticks driven directly and independently of evaluate_preview.
    clear_registry()
    clear_draft_registry()
    events = list(iter_preview_ticks(**kwargs))

    assert len(events) == len(reference["fires"])
    tick_indices = [ev.tick_index for ev in events]
    assert tick_indices == sorted(tick_indices), "tick_index must be strictly ascending"
    assert tick_indices == [f["tick"] for f in reference["fires"]]

    for ev in events:
        assert isinstance(ev, PreviewFireEvent)
        assert ev.decision.proposal is not None
        assert ev.tick_state is not None
        assert ev.route_facts is not None
        assert ev.effective_scenario is not None


def test_iter_preview_ticks_single_fire_rest_scenario():
    """The default hybrid/rest-recovery scenario escalates monotony -> rest:
    two legitimate episodes, matching evaluate_preview's `fires`.

    Recovery-semantics refactor: the rest_required proposal at tick 32 is
    DECLINED (the route's only rest spot is long behind the vehicle by then).
    Previously that was the end of the run's fires, because accepting/serving
    the tick-29 monotony proposal REBASELINED mono_min to ~0 (the now-deleted
    hack).

    Fire-control refactor (task 7, 2026-08-08): between those two changes,
    this scenario briefly fired monotony_prevention a THIRD time at tick 33,
    because relief is freeze+drain (Design §6 case 1) — which only partially
    reduces monotony_prevention_score, never below its own suggest threshold —
    and the pre-task-7 gate released an acknowledge's INDEFINITE monotony
    suppression the instant ANY REST_PROPOSAL fired (here, at tick 32),
    letting the still-actionable candidate re-fire one tick later. Task 7
    deletes that release-on-rest-fire mechanic: acknowledge now uses the same
    bounded 30-minute cooldown as decline (CDC-SU slide 34/81), and tick 33
    (elapsed_seconds 5400 + 2*tick_seconds, well under the acknowledge's
    5400+1800 release point) falls inside that window, so monotony_prevention
    stays suppressed and only the two episodes below occur. See
    test_monotony_score_falls_after_the_proposal_is_taken_up for the
    quantified freeze+drain relief."""
    kwargs = _default_kwargs()

    clear_registry()
    clear_draft_registry()
    reference = evaluate_preview(**kwargs)
    assert reference["fired"] is True

    clear_registry()
    clear_draft_registry()
    events = list(iter_preview_ticks(**kwargs))

    assert len(events) == 2
    assert len(reference["fires"]) == 2
    categories = [f["category"] for f in reference["fires"]]
    assert categories == ["monotony_prevention", "rest_required"], (
        f"expected monotony -> rest escalation; got {categories}"
    )

    tick_indices = [ev.tick_index for ev in events]
    assert tick_indices == [f["tick"] for f in reference["fires"]]
    assert events[0].tick_index == reference["fire"]["tick"]
    for ev in events:
        assert ev.decision.proposal is not None


# ---------------------------------------------------------------------------
# An escalation from monotony to rest is TWO episodes, not one.
# ---------------------------------------------------------------------------
#
# Episode grouping collapsed consecutive actionable ticks into a single marker
# regardless of category. That was harmless while a run realistically fired one
# category — but both packages fire two now, and a run typically escalates
# monotony -> rest on consecutive ticks. Grouped, the escalation vanished: the
# strip showed a monotony marker and the rest proposal it became was never
# surfaced at all.


def test_monotony_then_rest_on_consecutive_ticks_are_separate_episodes():
    # The 40kph commuter route (not the 60kph `_SCENARIO_ID`): its 60km rest
    # facility is still ahead when NRI's score reaches the fire band, so the run
    # genuinely escalates monotony -> rest. On the 60kph route the score only
    # crosses the threshold after that sole spot is behind the driver, so no
    # actionable spot remains and rest_required does not fire at all (the
    # sentinel-fires bug that used to force a rest fire here was fixed by the
    # forecast-rest feature).
    result = evaluate_preview(
        **_default_kwargs(package_id=_NRI_PKG_ID, scenario_id="uc01_fatigue_recovery_commuter_v0_1")
    )

    categories = [f["category"] for f in result["fires"]]
    assert "monotony_prevention" in categories, (
        f"setup: NRI's lower band should fire first; got {categories}"
    )
    assert "rest_required" in categories, (
        "a rest fire following a monotony fire must get its own marker — "
        f"got {categories}"
    )

    # Ordered: the lower band is reached first.
    assert categories.index("monotony_prevention") < categories.index("rest_required")


def test_consecutive_ticks_of_the_SAME_category_stay_one_episode():
    """The grouping still does its job — a category that fires for many ticks in
    a row is one marker, not one per tick."""
    result = evaluate_preview(**_default_kwargs(package_id=_NRI_PKG_ID))
    fires = result["fires"]
    ticks_by_cat: dict[str, list[int]] = {}
    for f in fires:
        ticks_by_cat.setdefault(f["category"], []).append(f["tick"])
    for category, ticks in ticks_by_cat.items():
        assert all(b - a > 1 for a, b in zip(ticks, ticks[1:])), (
            f"{category} produced adjacent-tick markers: {ticks}"
        )


# ---------------------------------------------------------------------------
# Task 7: the two-pass NRI forecast seam (spec §15.4) is mirrored into the
# preview's parallel `iter_preview_ticks` loop, identically to run_manager.tick().
# ---------------------------------------------------------------------------


def test_preview_mirrors_forecast_seam(monkeypatch):
    """The preview loop wires `run_forecast` the same way the live tick loop
    does: any call it makes carries the NRI package's own thresholds.

    This spies `run_forecast` (delegating to the real implementation so the
    run still completes normally) and drains the generator to completion,
    asserting no exception and that every captured call carries this run's
    NRI thresholds. Empirically, on the shared `uc01_fatigue_recovery_v0_1`
    scenario (package `nri_fatigue_score_v1`, run_seed=7), `s_total` never
    lingers strictly inside the (threshold_forecast_rest, threshold_fire)
    band long enough for `_forecast_eligible` to trigger a projection, so
    `calls` is empty here. That still exercises the real regression this
    guards against: the seam is wired without crashing (a NameError on the
    imported helpers, a KeyError on committed_content, a non-dict from
    `_projected_evaluate`, ...). A dedicated parity test (preview vs. live)
    is a later task, per the task-7 brief.
    """
    import aica_api.services.preview as pv

    calls: list[dict] = []
    orig = pv.run_forecast

    def _spy(**kw):
        calls.append(kw)
        return orig(**kw)

    monkeypatch.setattr(pv, "run_forecast", _spy)

    gen = pv.iter_preview_ticks(
        **_default_kwargs(package_id=_NRI_PKG_ID, run_seed=7)
    )
    # Drain the generator; it must not raise, and any forecast call must carry
    # the NRI thresholds (never a non-NRI package's).
    for _ in gen:
        pass

    for kw in calls:
        assert kw["threshold_forecast_rest"] == 80.0
        assert kw["threshold_fire"] == 100.0


def test_km_jam_derives_minutes_from_progress():
    """A km-authored jam yields from_min/to_min derived from the real progress
    (min<->frac) curve, not None and not the naive uniform ratio."""
    from aica_api.services.preview import _km_to_min

    progress = [
        {"t": 0, "min": 0.0, "frac": 0.0},
        {"t": 1, "min": 3.0, "frac": 0.10},
        {"t": 2, "min": 6.0, "frac": 0.50},
        {"t": 3, "min": 9.0, "frac": 1.00},
    ]
    # frac 0.10 lands exactly on sample t=1 -> 3.0 min
    assert _km_to_min(0.10, progress) == 3.0
    # frac 0.30 is halfway between (0.10,3.0) and (0.50,6.0) -> 4.5 min
    assert abs(_km_to_min(0.30, progress) - 4.5) < 1e-9
    # frac beyond last sample clamps to last min
    assert _km_to_min(1.5, progress) == 9.0
    # empty progress -> None (nothing to interpolate)
    assert _km_to_min(0.3, []) is None
