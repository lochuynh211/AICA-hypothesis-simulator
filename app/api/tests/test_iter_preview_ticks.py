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
    assert len(result["spikes"]) == len(baseline["spikes"]) == 10
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
    """The default (single-fire) rest scenario: exactly one yielded event,
    matching evaluate_preview's `fire`."""
    kwargs = _default_kwargs()

    clear_registry()
    clear_draft_registry()
    reference = evaluate_preview(**kwargs)
    assert reference["fired"] is True

    clear_registry()
    clear_draft_registry()
    events = list(iter_preview_ticks(**kwargs))

    assert len(events) == 1
    assert events[0].tick_index == reference["fire"]["tick"]
    assert events[0].decision.proposal is not None


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
    result = evaluate_preview(**_default_kwargs(package_id=_NRI_PKG_ID))

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
