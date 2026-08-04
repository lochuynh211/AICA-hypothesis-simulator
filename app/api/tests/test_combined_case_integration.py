"""Every committed case runs through the real merged path and yields a review.

This is the test that would catch a case whose journey never reaches the
decision point it was written to examine.

For each ``combined_contracts/test_cases/case-*.json`` file, this test
resolves its references (route/scenario/algorithm packages already checked
by ``test_combined_case_contract.py``; here we resolve ``persona.profile_ref``
into a driver profile too) and builds the SAME ``POST /api/merged-runs/quickview``
request body ``MergedSetupPanel``'s auto-quickview effect builds for a
freshly-selected case (``app/frontend/src/components/merged/MergedSetupPanel.tsx``,
the effect registered around ``coordinator.quickview({...})``):

  - ``package_id``/``scenario_id``/``route_preset_id``/``run_seed`` from the
    case's ``journey`` (mirrors ``caseResolver.ts``'s ``resolveCase``).
  - ``mountain_range_km``/``jam_range_km`` from ``journey.fixed_overrides``
    when the case paints one (same fields ``resolveCase`` surfaces).
  - ``world`` = the same base world ``test_merged_quickview.py`` uses
    (``seed-night-highway-oshi``), with ONLY ``driver_profile`` replaced by
    the case's resolved ``profile_ref`` preset (mirrors the ``LOAD_PROFILE``
    reducer case in ``proposalStore.ts``, which replaces ONLY
    ``world.driver_profile``) and ``situation.night_state``/``child_present``
    synced from ``fixed_overrides.is_night``/``child_passenger`` (mirrors
    ``MergedSetupPanel``'s ``effectiveWorld`` memo) -- this is the PROPOSAL
    side's view of night/child, read by service/content selection.
  - ``context_overrides`` = ``{is_night, child_passenger}`` taken directly from
    ``journey.fixed_overrides``, whichever of the two keys the case actually
    pins (mirrors ``caseResolver.ts``'s ``resolveCase().contextOverrides``,
    which ``useCaseSelection.ts`` dispatches as ``SET_CONTEXT_OVERRIDE`` into
    ``runStore``, which the quickview effect then sends verbatim as
    ``rs.contextOverrides`` -- see ``MergedSetupPanel.tsx`` around the
    ``coordinator.quickview({...})`` call). This is the TRIGGER side's view
    of the same flags; it is what ``nri_fatigue_score_v1``'s ``isNight``/
    ``childPassenger`` Tier-1 signals and ``S_base``'s child/night terms
    actually read.
  - ``initial_state`` = ``{drowsiness_level, fatigue_level}`` from
    ``fixed_overrides.initial_drowsiness``/``initial_fatigue`` (mirrors
    ``resolveCase()``'s ``initialDrowsiness``/``initialFatigue``, dispatched
    as ``SET_INITIAL_DROWSINESS``/``SET_INITIAL_FATIGUE`` and sent as
    ``rs.initialDrowsiness``/``rs.initialFatigue`` via the same
    ``quickviewInitialState`` memo ``MergedSetupPanel.tsx`` builds for both
    the projection and the real "Play" run).
  - ``tick_seconds`` = ``journey.tick_seconds`` (mirrors ``resolveCase()``'s
    ``tickSeconds``, unconditionally dispatched as ``SET_TICK_SECONDS`` by
    ``caseDispatches`` -- unlike the pins above this is not "when present",
    every case carries its own ``tick_seconds``).
  - ``service_package_id``/``content_package_id``/``run_seed_proposal`` from
    the case's ``algorithm_defaults``/``journey.seed``.

This closes the gap an earlier version of this module's docstring described
as pre-existing and out of scope: ``MergedQuickviewBody`` DOES carry
``context_overrides``/``initial_state``/``tick_seconds`` fields (see
``models/merged_run.py``), and the real ``MergedSetupPanel`` auto-quickview
effect DOES send them (confirmed by reading its source, not just this
docstring's earlier claim) -- so a case's own pins now reach the tick engine
through this endpoint exactly as they would through a real "Play" run's
``buildTriggerPlan``. Fixing this measurably changed several cases' fire
timing (e.g. C-01's rest fire moved from minute 51 to minute 63) -- this
test's assertions below are written against the CURRENT, fixed behaviour.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_CASES_DIR = _REPO_ROOT / "combined_contracts" / "test_cases"
_CASE_FILES = sorted(_CASES_DIR.glob("case-*.json")) if _CASES_DIR.exists() else []

_IN_SCOPE_CATEGORIES = {"rest_required", "monotony_prevention"}
_SEED_ID = "seed-night-highway-oshi"

client = TestClient(app)


def _load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    """Never let these tests write into real runs/proposal_runs/merged_runs
    (same isolation as tests/test_merged_quickview.py)."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def _base_world() -> dict:
    path = settings.proposal_seeds_dir / f"{_SEED_ID}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _resolve_driver_profile(profile_ref: str) -> dict:
    path = settings.proposal_presets_dir / f"{profile_ref}.json"
    preset = json.loads(path.read_text(encoding="utf-8"))
    return preset["world"]["driver_profile"]


def _build_quickview_body(case: dict) -> dict:
    """Mirrors MergedSetupPanel's auto-quickview effect for a freshly
    selected case -- see the module docstring for the exact correspondence."""
    journey = case["journey"]
    fixed = journey.get("fixed_overrides", {})
    defaults = case["algorithm_defaults"]

    world = json.loads(json.dumps(_base_world()))  # deep copy
    world["driver_profile"] = _resolve_driver_profile(case["persona"]["profile_ref"])

    situation = dict(world["situation"])
    if "is_night" in fixed:
        situation["night_state"] = "night" if fixed["is_night"] else "day"
    if "child_passenger" in fixed:
        situation["child_present"] = bool(fixed["child_passenger"])
    world["situation"] = situation

    body: dict[str, Any] = {
        "package_id": defaults["trigger"],
        "scenario_id": journey["scenario_ref"],
        "route_preset_id": journey["route_preset_ref"],
        "run_seed": journey["seed"],
        "world": world,
        "service_package_id": defaults["service"],
        "content_package_id": defaults["content"],
        "run_seed_proposal": str(journey["seed"]),
        # journey.tick_seconds is unconditional -- caseDispatches always
        # dispatches SET_TICK_SECONDS, never gated on `"tick_seconds" in fixed`.
        "tick_seconds": journey["tick_seconds"],
    }
    if "mountain_range_km" in fixed:
        body["mountain_range_km"] = fixed["mountain_range_km"]
    if "jam_range_km" in fixed:
        body["jam_range_km"] = fixed["jam_range_km"]

    # TRIGGER-side pins -- separate channel from the world.situation mutation
    # above, which only reaches the PROPOSAL side's service/content selection.
    # See the module docstring for the exact resolveCase()/runStore mapping.
    context_overrides: dict[str, Any] = {}
    if "is_night" in fixed:
        context_overrides["is_night"] = fixed["is_night"]
    if "child_passenger" in fixed:
        context_overrides["child_passenger"] = fixed["child_passenger"]
    if context_overrides:
        body["context_overrides"] = context_overrides

    initial_state: dict[str, Any] = {}
    if "initial_drowsiness" in fixed:
        initial_state["drowsiness_level"] = fixed["initial_drowsiness"]
    if "initial_fatigue" in fixed:
        initial_state["fatigue_level"] = fixed["initial_fatigue"]
    if initial_state:
        body["initial_state"] = initial_state

    return body


def _quickview(case: dict) -> dict:
    body = _build_quickview_body(case)
    resp = client.post("/api/merged-runs/quickview", json=body)
    assert resp.status_code == 200, f"{case['case_id']}: {resp.text}"
    return resp.json()


def _route_total_km(route_preset_ref: str) -> float:
    """Same computation ``routers/route_presets.py::load_route_preset`` uses
    (``total_km = raw_route["distance_m"] / 1000.0``) -- reads the preset file
    directly rather than hitting an endpoint, since this is the one number
    (route length) this test needs to turn a fire's ``progress`` fraction into
    a km position."""
    path = settings.routes_dir / "presets" / f"{route_preset_ref}.json"
    raw_route = json.loads(path.read_text(encoding="utf-8"))["raw_route"]
    return raw_route["distance_m"] / 1000.0


def _fire_km(result: dict, fire: dict, total_km: float) -> float:
    """The fire's position along the route in km, via the per-tick
    ``progress`` map (``t`` -> route-fraction ``frac``) the quickview result
    carries -- the SAME map the Combined Simulator uses to align a fire with
    the distance-axis animation (``ProgressPoint``, ``models/run.py``)."""
    frac_by_tick = {p["t"]: p["frac"] for p in result.get("progress", [])}
    frac = frac_by_tick.get(fire["tick"])
    assert frac is not None, f"no progress entry recorded for fire tick {fire['tick']}"
    return frac * total_km


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_run_completes_without_algorithm_error(path):
    case = _load(path)
    result = _quickview(case)
    assert result["error"] is None, f"{case['case_id']} ended in an algorithm error: {result['error']}"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_reaches_an_in_scope_fire_with_both_categories(path):
    """Every case, including C-01, exists to be examined at a real decision
    point: at least one fire in {rest_required, monotony_prevention}, and
    that fire's feature_contributions carries BOTH categories with
    non-empty rows -- the hybrid trigger's recorded runner-up comparison
    (see test_merged_quickview.py::test_quickview_fire_carries_both_trigger_categories).

    C-01 used to be excluded here (it was authored as a silent control that
    was never supposed to fire). It no longer is: under NRI a 111-minute
    familiar highway drive crosses the theta=60 dead-band and the
    threshold_monotony/threshold_fire bands regardless of how mild the
    driver starts (see the case's own brief and
    test_case_c01_is_a_comparison_baseline below), so it now reaches an
    in-scope fire exactly like every other case and belongs in this
    reachability check too."""
    case = _load(path)
    result = _quickview(case)

    assert result["fired"] is True, f"{case['case_id']}: expected the run to fire"
    in_scope_fires = [f for f in result["fires"] if f.get("category") in _IN_SCOPE_CATEGORIES]
    assert in_scope_fires, f"{case['case_id']}: no in-scope fire among {result['fires']}"

    fire = in_scope_fires[0]

    # Positional correspondence, where the case's own cause is genuinely
    # wired: C-04/C-05 paint a mountain/jam band onto the route
    # (mountain_range_km/jam_range_km ARE threaded through
    # MergedQuickviewBody -> _build_quickview_route_facts -- verified
    # empirically, see task-19-report.md), so for THOSE two the fire must
    # land within or after the painted band, not merely "somewhere on the
    # route" -- otherwise this test would only prove "a fire happened",
    # never "the fire happened where this case put the cause".
    #
    # C-01/C-02/C-03/C-06 have no such wiring to lean on: their pins
    # (initial_drowsiness/initial_fatigue, is_night, child_passenger) ARE
    # now threaded through this endpoint (context_overrides/initial_state,
    # fixed by this module's _build_quickview_body -- see its docstring),
    # but they are non-positional signal values, not a km range painted onto
    # the route -- there is no "position" a value pin could be checked
    # against the way a painted band's start/end km can be. Their assertion
    # stays reachability-only; strengthening it further would mean asserting
    # a specific fire TIMING, which is exactly what
    # test_case_c01_is_a_comparison_baseline (below) already does for C-01
    # against the other five, rather than duplicating that logic here for
    # every pinned case.
    fixed = case["journey"].get("fixed_overrides", {})
    band = fixed.get("mountain_range_km") or fixed.get("jam_range_km")
    if band is not None:
        total_km = _route_total_km(case["journey"]["route_preset_ref"])
        fire_km = _fire_km(result, fire, total_km)
        band_start_km = band[0]
        assert fire_km >= band_start_km, (
            f"{case['case_id']}: fire at {fire_km:.1f} km falls BEFORE the "
            f"painted band start {band_start_km} km -- the fire did not "
            f"happen where this case put the cause"
        )

    contributions = fire.get("feature_contributions") or {}
    assert set(contributions) == _IN_SCOPE_CATEGORIES, (
        f"{case['case_id']}: expected both categories recorded, got {sorted(contributions)}"
    )
    for category, chain in contributions.items():
        assert chain.get("rows"), f"{case['case_id']}: {category} recorded no rows"

    # Wherever the fire has a proposal, its content step's plan has either a
    # non-empty scored_tail or a genuinely exhausted pool (tail_truncated is
    # False AND the pool really was exhausted, not just an empty tail).
    proposal = fire.get("proposal")
    if proposal is not None:
        content_evidence = [ev for ev in proposal["evidence"] if ev["step"] == "content"]
        assert content_evidence, f"{case['case_id']}: fire has a proposal but no content evidence"
        content_output = content_evidence[0].get("output")
        assert content_output is not None, f"{case['case_id']}: content step recorded no output"

        scored_tail = content_output.get("scored_tail") or []
        tail_truncated = content_output.get("tail_truncated")
        if scored_tail:
            pass  # non-empty scored_tail satisfies the assertion on its own
        else:
            assert tail_truncated is False, (
                f"{case['case_id']}: empty scored_tail must mean tail_truncated is False"
            )
            # A "genuinely exhausted pool": every scored candidate was
            # returned or excluded, none held back in a tail that doesn't
            # exist.
            returned = content_output.get("returned_item_count") or 0
            excluded = len(content_output.get("excluded_items") or [])
            requested = content_output.get("requested_item_count") or 0
            assert returned + excluded >= requested, (
                f"{case['case_id']}: tail empty but pool not exhausted "
                f"(returned={returned}, excluded={excluded}, requested={requested})"
            )


def _uc01_subset_summary(case: dict) -> dict:
    """The three numbers the C-01 comparison (below) needs, all read
    straight off a live ``POST /api/merged-runs/quickview`` result -- never
    hardcoded: ``time_min`` (the FIRST in-scope fire's elapsed drive time,
    the endpoint's own ``time_min`` field -- see ``models/run.py``'s
    ``ProgressPoint``/fire shape, NOT a value derived from ``tick`` itself,
    which earlier probing found uses a different, undocumented
    tick-to-minute convention than the live endpoint's own ``time_min``
    field), ``peak_score`` (``MergedInstantResult.peak_score`` -- the
    RUN-WIDE peak of the normalized 0-1 score curve, not just the first
    fire's own raw ``s_total`` -- see ``models/merged_run.py``), and
    ``fire_count`` (how many in-scope fires the run produced in total)."""
    result = _quickview(case)
    in_scope_fires = [f for f in result["fires"] if f.get("category") in _IN_SCOPE_CATEGORIES]
    assert in_scope_fires, f"{case['case_id']}: no in-scope fire among {result['fires']}"
    return {
        "time_min": in_scope_fires[0]["time_min"],
        "peak_score": result["peak_score"],
        "fire_count": len(in_scope_fires),
    }


def test_case_c01_is_a_comparison_baseline():
    """C-01 was redefined (owner decision, slice S8) from a silent control
    that asserts nothing fires -- unachievable under NRI, since a familiar
    111-minute highway drive crosses the theta=60 dead-band and both
    threshold bands regardless of tuning -- into the MILDEST intervention
    among the cases that share its fatigue scenario.

    Slice S8's original claim compared C-01 against ALL FIVE other cases,
    including case-c03-monotonous-highway, and that comparison genuinely
    IS false (confirmed live): C-03 runs on ``scenarios/uc02_monotony_v0_1
    .json``, whose ``driver_signal_params.drowsiness_model.
    base_growth_per_min`` (0.1) is ~9x slower than C-01's own
    ``uc01_fatigue_recovery_v0_1`` (0.9) -- BY DESIGN, C-03 exists to
    isolate monotony from fatigue, so its drowsiness/fatigue never cross
    NRI's theta=60 dead-band and its fire is driven purely by slow
    S_base/S_env time-on-task accumulation. Comparing C-01's fire timing
    against C-03's would therefore compare two DIFFERENT fatigue models,
    not two different situations on the same one -- not a fair comparison,
    and not a "cherry pick" either: it is excluded on that principled,
    documented basis (this comment), not to rescue the claim.

    The comparison set here is every OTHER case whose ``journey.
    scenario_ref`` equals C-01's own (derived live from each case file,
    never a hardcoded id list, so a future case cannot silently fall
    outside the comparison just because nobody remembered to add it here).
    Within that scenario-matched subset, C-01 is verifiably (live,
    confirmed via ``combined_contracts/test_cases``'s own numbers at the
    time of writing -- case/scenario/1st-fire-min/peak/fires: c01/uc01/48/
    0.814/2, c02/uc01/21/0.912/10, c04/uc01/48/1.000/3, c05/uc01/24/0.986/10,
    c06/uc01/15/1.000/10):

      - the LATEST first in-scope fire (48 min -- ties C-04's 48 min, hence
        ``>=`` below, not ``>``);
      - the LOWEST run-wide peak score (0.814, the lowest of the five); and
      - the FEWEST in-scope fires (2, the fewest of the five).

    All three properties are derived from a live run each time this test
    executes -- a future tuning change that breaks any of them fails this
    test loudly, not silently."""
    cases = {p.stem: _load(p) for p in _CASE_FILES}

    c01_stem = "case-c01-alert-daytime-control"
    c01_case = cases[c01_stem]
    c01_scenario = c01_case["journey"]["scenario_ref"]

    # The comparison set: every OTHER case sharing C-01's own fatigue
    # scenario -- see the module docstring above for why C-03 (a different
    # scenario, a different drowsiness model) is excluded on principle.
    same_scenario = {
        stem: case
        for stem, case in cases.items()
        if stem != c01_stem and case["journey"]["scenario_ref"] == c01_scenario
    }
    assert same_scenario, (
        f"{c01_stem}: expected at least one other case sharing its scenario "
        f"({c01_scenario!r}) to compare against"
    )

    c01_summary = _uc01_subset_summary(c01_case)
    others = {stem: _uc01_subset_summary(case) for stem, case in same_scenario.items()}

    latest_min = max(s["time_min"] for s in others.values())
    lowest_peak = min(s["peak_score"] for s in others.values())
    fewest_fires = min(s["fire_count"] for s in others.values())

    assert c01_summary["time_min"] >= latest_min, (
        f"C-01 fires at {c01_summary['time_min']} min, expected >= the latest of the "
        f"other {len(others)} same-scenario cases ({latest_min} min) -- "
        f"c01={c01_summary}, others={others}"
    )
    assert c01_summary["peak_score"] <= lowest_peak, (
        f"C-01's run-wide peak score is {c01_summary['peak_score']}, expected <= the "
        f"lowest of the other {len(others)} same-scenario cases ({lowest_peak}) -- "
        f"c01={c01_summary}, others={others}"
    )
    assert c01_summary["fire_count"] <= fewest_fires, (
        f"C-01 fired {c01_summary['fire_count']} times, expected <= the fewest of the "
        f"other {len(others)} same-scenario cases ({fewest_fires}) -- "
        f"c01={c01_summary}, others={others}"
    )
