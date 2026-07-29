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


def test_exactly_36_semantic_cases_are_committed():
    assert len(_CASE_FILES) == 36


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_validates_against_the_schema(path):
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(instance=_load(path), schema=_load(_SCHEMA))


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_id_matches_its_filename(path):
    assert _load(path)["case_id"] == path.stem


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_has_customer_semantics(path):
    case = _load(path)
    assert case["display_id"].startswith("TC-")
    assert case["purpose"]["en"].strip()
    assert case["real_world"]["before_trip"]["en"].strip()
    assert case["real_world"]["trip_reason"]["en"].strip()
    assert case["real_world"]["state_at_departure"]["en"].strip()
    assert case["real_world"]["journey_evolution"]["en"].strip()
    assert case["hypothesis"]["rationale"]["en"].strip()
    assert case["expectations"]["trigger"]["outcome"] in {
        "rest_required",
        "monotony_prevention",
        "none",
    }


def test_contrast_titles_name_their_baseline():
    by_id = {_load(path)["display_id"]: _load(path) for path in _CASE_FILES}
    for case in by_id.values():
        contrast = case.get("contrast")
        if contrast and contrast["role"] == "variant":
            baseline = contrast["with_case_id"]
            assert f"(contrast with test case ID {baseline})" in case["title"]["en"]
            assert baseline in by_id


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_every_referenced_artifact_exists(path):
    case = _load(path)
    journey = case["journey"]

    scenario = _REPO_ROOT / "scenarios" / f"{journey['scenario_ref']}.json"
    assert scenario.exists(), f"unknown scenario_ref {journey['scenario_ref']}"

    route = _REPO_ROOT / "routes" / "presets" / f"{journey['route_preset_ref']}.json"
    assert route.exists(), f"unknown route_preset_ref {journey['route_preset_ref']}"

    profile_ref = case["persona"]["profile_ref"]
    profile_kind = "profiles" if profile_ref.startswith("profile-") else "presets"
    profile = _REPO_ROOT / "proposal_contracts" / profile_kind / f"{profile_ref}.json"
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
