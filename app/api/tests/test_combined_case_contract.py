"""Every committed experience test case validates and resolves.

These tests read the contract directory from disk — no endpoint is involved,
because the catalog is bundled into the frontend rather than served.
"""
from __future__ import annotations

import json
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_CASES_DIR = _REPO_ROOT / "combined_contracts" / "test_cases"
_SCHEMA = _REPO_ROOT / "combined_contracts" / "schema" / "combined_test_case.schema.json"

_CASE_FILES = sorted(_CASES_DIR.glob("case-*.json")) if _CASES_DIR.exists() else []


def _load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_schema_file_exists():
    assert _SCHEMA.exists(), "the case schema must be committed beside the cases"


def test_at_least_one_case_is_committed():
    assert _CASE_FILES, "no case-*.json found in combined_contracts/test_cases"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_validates_against_the_schema(path):
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(instance=_load(path), schema=_load(_SCHEMA))


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_id_matches_its_filename(path):
    assert _load(path)["case_id"] == path.stem


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_carries_no_expectation_fields(path):
    """Phase 1 authors NO expectations — the expectation is review's OUTPUT."""
    case = _load(path)
    forbidden = {"checkpoints", "expected", "hypothesis", "top_fit_min", "contrast"}
    assert forbidden.isdisjoint(case), f"{sorted(forbidden & set(case))} must not be authored"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_every_referenced_artifact_exists(path):
    case = _load(path)
    journey = case["journey"]

    scenario = _REPO_ROOT / "scenarios" / f"{journey['scenario_ref']}.json"
    assert scenario.exists(), f"unknown scenario_ref {journey['scenario_ref']}"

    route = _REPO_ROOT / "routes" / "presets" / f"{journey['route_preset_ref']}.json"
    assert route.exists(), f"unknown route_preset_ref {journey['route_preset_ref']}"

    profile = _REPO_ROOT / "proposal_contracts" / "presets" / f"{case['persona']['profile_ref']}.json"
    assert profile.exists(), f"unknown profile_ref {case['persona']['profile_ref']}"

    for key, package_id in case["algorithm_defaults"].items():
        assert (_REPO_ROOT / "packages" / package_id).is_dir(), f"unknown {key} package {package_id}"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_user_facing_text_is_bilingual(path):
    case = _load(path)
    for field in (case["title"], case["brief"], case["persona"]["narrative"]):
        assert field["ja"].strip() and field["en"].strip()
        assert field["ja"] != field["en"]
    for chip in case["what_to_watch"]:
        assert chip["ja"].strip() and chip["en"].strip()


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_journey_is_deterministic(path):
    journey = _load(path)["journey"]
    assert isinstance(journey["seed"], int)
    assert isinstance(journey["tick_seconds"], int) and journey["tick_seconds"] > 0


def test_case_ids_are_unique():
    ids = [_load(p)["case_id"] for p in _CASE_FILES]
    assert len(ids) == len(set(ids))
