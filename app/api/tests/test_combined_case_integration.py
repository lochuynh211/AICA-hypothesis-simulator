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
    ``MergedSetupPanel``'s ``effectiveWorld`` memo).
  - ``service_package_id``/``content_package_id``/``run_seed_proposal`` from
    the case's ``algorithm_defaults``/``journey.seed``.

KNOWN, PRE-EXISTING GAP (not introduced by this test, not fixed by it — see
task-19-report.md): ``MergedQuickviewBody`` has no ``context_overrides`` or
``initial_state`` field, and ``services/preview.py::iter_preview_ticks`` never
forwards an ``initial_state`` to ``create_draft`` at all. So a case's
``fixed_overrides.initial_drowsiness``/``initial_fatigue`` and (on the
TRIGGER side only) ``is_night`` cannot reach the tick engine through this
endpoint -- only through a real "Play" run (``buildTriggerPlan`` in
``MergedSetupPanel.tsx``, which uses ``createRunPlan``/``buildMergedPlan``
instead). ``is_night`` DOES still reach the PROPOSAL side, because
``effectiveWorld`` folds it into ``world.situation.night_state`` before the
quickview call, which is what a fire's service/content selection actually
reads. This asymmetry already existed for C-01/C-03 (their pins happen to
equal the scenario defaults, so it was invisible) -- it is not something a
case's own pins can work around, so this test does not pretend otherwise.
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
    }
    if "mountain_range_km" in fixed:
        body["mountain_range_km"] = fixed["mountain_range_km"]
    if "jam_range_km" in fixed:
        body["jam_range_km"] = fixed["jam_range_km"]
    return body


def _quickview(case: dict) -> dict:
    body = _build_quickview_body(case)
    resp = client.post("/api/merged-runs/quickview", json=body)
    assert resp.status_code == 200, f"{case['case_id']}: {resp.text}"
    return resp.json()


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_run_completes_without_algorithm_error(path):
    case = _load(path)
    result = _quickview(case)
    assert result["error"] is None, f"{case['case_id']} ended in an algorithm error: {result['error']}"


@pytest.mark.parametrize("path", [p for p in _CASE_FILES if p.stem != "case-c01-alert-daytime-control"], ids=lambda p: p.stem)
def test_case_reaches_an_in_scope_fire_with_both_categories(path):
    """Every case except C-01 exists to be examined at a real decision point:
    at least one fire in {rest_required, monotony_prevention}, and that
    fire's feature_contributions carries BOTH categories with non-empty
    rows -- the hybrid trigger's recorded runner-up comparison (see
    test_merged_quickview.py::test_quickview_fire_carries_both_trigger_categories)."""
    case = _load(path)
    result = _quickview(case)

    assert result["fired"] is True, f"{case['case_id']}: expected the run to fire"
    in_scope_fires = [f for f in result["fires"] if f.get("category") in _IN_SCOPE_CATEGORIES]
    assert in_scope_fires, f"{case['case_id']}: no in-scope fire among {result['fires']}"

    fire = in_scope_fires[0]
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


def test_case_c01_control_produces_no_in_scope_fire():
    """C-01 is the control: it exists to prove nothing fires when nothing
    should. Assert the run genuinely happened (ticks ran, no algorithm
    error) so an errored-out or empty run could never masquerade as a
    passing control."""
    path = next(p for p in _CASE_FILES if p.stem == "case-c01-alert-daytime-control")
    case = _load(path)
    result = _quickview(case)

    # The run genuinely happened: it completed cleanly and covered the whole
    # route (a crashed or truncated run is not evidence of "nothing fires").
    assert result["error"] is None
    assert result["completed_min"] is not None and result["completed_min"] > 0
    assert result["score_series"], "expected a real per-tick score series, not an empty/errored run"

    in_scope_fires = [f for f in result["fires"] if f.get("category") in _IN_SCOPE_CATEGORIES]
    assert in_scope_fires == [], f"C-01 is a control case: expected no in-scope fire, got {in_scope_fires}"
