from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from aica_api.models.proposal.world import DriverProfile
from aica_api.models.scenario import ScenarioDef
from scripts.semantic_catalog.generator import (
    compile_artifacts,
    load_catalog,
    validate_catalog,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SOURCE_CATALOG = _REPO_ROOT / "scripts/semantic_combined_catalog.json"

_CHANGED_SLEEP_INPUTS = [
    "journey.scenario.initial_drowsiness",
    "journey.scenario.initial_fatigue",
    "journey.scenario.drowsiness_model.base_growth_per_min",
    "journey.scenario.fatigue_model.base_growth_per_min",
]


def _bilingual(en: str, ja: str = "テスト") -> dict[str, str]:
    return {"en": en, "ja": ja}


def _scenario_recipe() -> dict:
    return {
        "version": "1.0.0",
        "initial_drowsiness": 68,
        "initial_fatigue": 58,
        "drowsiness_model": {
            "base_growth_per_min": 0.8,
            "night_add_per_min": 0.05,
            "monotony_add_per_min": 0.03,
            "traffic_jam_add_per_min": 0.02,
        },
        "fatigue_model": {
            "base_growth_per_min": 0.35,
            "continuous_driving_add_per_min_after_60_min": 0.05,
            "mountain_road_add_per_min": 0.0,
            "traffic_jam_add_per_min": 0.02,
        },
        "anomaly_model": {
            "lambda_base": 0.0,
            "lambda_gain": 0.0,
            "theta": 100.0,
            "window_min": 15.0,
        },
        "route_distance_km": 120,
        "rest_fraction": 0.2,
        "primary_fraction": 0.25,
        "primary_road_type": "highway",
        "traffic_events": [],
        "weather_events": [],
        "is_night": True,
        "child_passenger": False,
        "familiar_route": True,
        "weather_risk": 5,
        "route_tags": ["highway", "night"],
        "destination_tags": ["home"],
        "multiple_passengers": False,
        "total_duration_seconds": 4500,
        "tick_seconds": 180,
        "seed": 42,
        "speed_profile": {
            "normal_road_kph": 60,
            "highway_kph": 100,
            "mountain_road_kph": 40,
            "sightseeing_road_kph": 30,
            "traffic_jam_kph": 20,
        },
        "allowed_actions": [
            "accept_rest",
            "postpone",
            "decline",
            "acknowledge",
        ],
    }


def _case(
    display_id: str,
    *,
    title: str,
    role: str,
    with_case_id: str,
    recipe: dict,
    trigger_outcome: str,
) -> dict:
    no_trigger = trigger_outcome == "none"
    return {
        "display_id": display_id,
        "version": "1.0.0",
        "title": _bilingual(title),
        "brief": _bilingual(
            "A late-shift worker drives home on a familiar highway. "
            "The case checks whether AICA responds at the appropriate time."
        ),
        "group": "rest",
        "purpose": _bilingual(title),
        "what_to_watch": [_bilingual("Trigger timing and downstream proposal")],
        "real_world": {
            "before_trip": _bilingual("The driver has just finished a late shift."),
            "trip_reason": _bilingual("The driver is travelling home."),
            "state_at_departure": _bilingual(
                "The departure state reflects the sleep obtained before work."
            ),
            "journey_evolution": _bilingual(
                "The state changes gradually on a familiar night highway."
            ),
        },
        "hypothesis": {
            "rationale": _bilingual(
                "Initial state and growth jointly represent the driver's sleep history."
            )
        },
        "expectations": {
            "trigger": {
                "outcome": trigger_outcome,
                "time_window_min": [0, 15] if not no_trigger else [0, 75],
                "max_fire_count": 0 if no_trigger else 1,
                "required_positive_feature_ids": (
                    [] if no_trigger else ["driver_drowsiness_level"]
                ),
            },
            "service": {
                "rank_1_acceptable_ids": (
                    [] if no_trigger else ["music_playlist", "humming_karaoke"]
                ),
                "top_3_required_ids": [],
                "top_3_prohibited_ids": (
                    [] if no_trigger else ["full_karaoke", "stretch_video"]
                ),
                "required_positive_feature_ids": [],
            },
            "content": {
                "expected_stage_outcome": (
                    "not_applicable" if no_trigger else "complete_plan"
                ),
                "returned_count": 0 if no_trigger else 5,
                "required_track_ids": [],
                "excluded_track_ids": [],
            },
        },
        "contrast": {
            "role": role,
            "with_case_id": with_case_id,
            "kind": "semantic_real_world",
            "changed_inputs": _CHANGED_SLEEP_INPUTS,
            "expected_delta": _bilingual(
                "The sleep-deprived journey should trigger earlier than the rested journey."
            ),
        },
        "persona": {
            "persona_id": "persona-late-shift-worker",
            "name": _bilingual("Late-shift worker"),
            "narrative": _bilingual(
                "A worker making the same familiar trip home after a late shift."
            ),
            "goals": [_bilingual("Reach home without taking an avoidable risk.")],
            "preferences": [],
            "constraints": [_bilingual("The journey takes place late at night.")],
            "assumptions": [_bilingual("The driver starts in the authored state.")],
            "profile_ref": "profile-semantic-neutral",
            "profile_ref_version": "1.0.0",
        },
        "journey": {
            "narrative": _bilingual("A familiar night highway journey home."),
            "route_preset_ref": "long_tokyo_osaka",
            "automatic_path": {"service_choice": "rank_1"},
            "scenario": recipe,
        },
        "algorithm_defaults": {
            "trigger": "aica_transparent_hybrid_trigger_v1",
            "service": "aica_transparent_service_selector_v1",
            "content": "aica_transparent_content_selector_v1",
        },
    }


def two_case_catalog() -> dict:
    deprived = _scenario_recipe()
    rested = copy.deepcopy(deprived)
    rested["initial_drowsiness"] = 12
    rested["initial_fatigue"] = 15
    rested["drowsiness_model"]["base_growth_per_min"] = 0.08
    rested["fatigue_model"]["base_growth_per_min"] = 0.05
    return {
        "catalog_id": "semantic-combined-experience",
        "catalog_version": "1.0.0",
        "case_schema_version": "1.0.0",
        "reference_time": "2026-07-29T12:00:00Z",
        "profiles": [
            {
                "profile_id": "profile-semantic-neutral",
                "label": _bilingual("Semantic neutral"),
                "builtin": True,
                "version": "1.0.0",
                "profile": {
                    "oshi_registered": False,
                    "oshi_mode": "off",
                    "oshi_id": None,
                    "oshi_type": None,
                    "oshi_tags": [],
                    "age_band": "30s",
                    "gender": "unspecified",
                    "hobby_interest_tags": [],
                    "genre_affinity_v1_enabled": False,
                },
            }
        ],
        "cases": [
            _case(
                "TC-R01",
                title=(
                    "Protect a sleep-deprived late-shift worker with an early "
                    "rest proposal"
                ),
                role="baseline",
                with_case_id="TC-R02",
                recipe=deprived,
                trigger_outcome="rest_required",
            ),
            _case(
                "TC-R02",
                title=(
                    "Keep a well-rested late-shift worker driving without a "
                    "premature rest proposal (contrast with test case ID TC-R01)"
                ),
                role="variant",
                with_case_id="TC-R01",
                recipe=rested,
                trigger_outcome="none",
            ),
        ],
    }


def test_compiler_emits_scenario_profile_and_case(tmp_path: Path):
    written = compile_artifacts(two_case_catalog(), tmp_path)

    assert tmp_path / "scenarios/semantic_tc_r01.json" in written
    assert (
        tmp_path
        / "proposal_contracts/profiles/profile-semantic-neutral.json"
        in written
    )
    assert tmp_path / "combined_contracts/test_cases/case-tc-r01.json" in written


def test_scenario_validates_with_real_model(tmp_path: Path):
    compile_artifacts(two_case_catalog(), tmp_path)
    scenario = json.loads(
        (tmp_path / "scenarios/semantic_tc_r01.json").read_text(encoding="utf-8")
    )

    ScenarioDef.model_validate(scenario)


def test_scenario_type_is_accepted_by_the_frozen_trigger_package(tmp_path: Path):
    compile_artifacts(two_case_catalog(), tmp_path)
    scenario = json.loads(
        (tmp_path / "scenarios/semantic_tc_r01.json").read_text(encoding="utf-8")
    )
    manifest = json.loads(
        (
            _REPO_ROOT
            / "packages"
            / "aica_transparent_hybrid_trigger_v1"
            / "package.json"
        ).read_text(encoding="utf-8")
    )

    assert scenario["type"] in manifest["compatible_scenario_types"]


def test_profile_validates_with_real_model(tmp_path: Path):
    compile_artifacts(two_case_catalog(), tmp_path)
    record = json.loads(
        (
            tmp_path
            / "proposal_contracts/profiles/profile-semantic-neutral.json"
        ).read_text(encoding="utf-8")
    )

    DriverProfile.model_validate(record["profile"])


def test_strict_pair_rejects_an_undeclared_business_difference():
    catalog = two_case_catalog()
    catalog["cases"][1]["journey"]["scenario"]["weather_risk"] = 80

    with pytest.raises(ValueError, match="undeclared strict-contrast difference"):
        validate_catalog(catalog)


def test_controlled_pair_rejects_parent_path_covering_multiple_leaf_differences():
    catalog = two_case_catalog()
    baseline_recipe = catalog["cases"][0]["journey"]["scenario"]
    variant_recipe = copy.deepcopy(baseline_recipe)
    variant_recipe["drowsiness_model"]["base_growth_per_min"] = 0.2
    variant_recipe["drowsiness_model"]["night_add_per_min"] = 0.1
    catalog["cases"][1]["journey"]["scenario"] = variant_recipe
    for case in catalog["cases"]:
        case["contrast"]["kind"] = "controlled_one_factor"
        case["contrast"]["changed_inputs"] = ["journey.scenario.drowsiness_model"]

    with pytest.raises(ValueError, match="exactly one business leaf difference"):
        validate_catalog(catalog)


def test_controlled_pair_requires_the_declared_path_to_be_the_exact_changed_leaf():
    catalog = two_case_catalog()
    baseline_recipe = catalog["cases"][0]["journey"]["scenario"]
    variant_recipe = copy.deepcopy(baseline_recipe)
    variant_recipe["drowsiness_model"]["base_growth_per_min"] = 0.2
    catalog["cases"][1]["journey"]["scenario"] = variant_recipe
    for case in catalog["cases"]:
        case["contrast"]["kind"] = "controlled_one_factor"
        case["contrast"]["changed_inputs"] = ["journey.scenario.drowsiness_model"]

    with pytest.raises(ValueError, match="must exactly match business leaf differences"):
        validate_catalog(catalog)


def test_controlled_pair_counts_each_leaf_when_automatic_path_is_added():
    catalog = two_case_catalog()
    catalog["cases"][1]["journey"]["scenario"] = copy.deepcopy(
        catalog["cases"][0]["journey"]["scenario"]
    )
    del catalog["cases"][0]["journey"]["automatic_path"]
    catalog["cases"][1]["journey"]["automatic_path"] = {
        "service_choice": "rank_1",
        "rest_response": "accept",
        "sleep_minutes": 20,
    }
    for case in catalog["cases"]:
        case["contrast"]["kind"] = "controlled_one_factor"
        case["contrast"]["changed_inputs"] = ["journey.automatic_path"]

    with pytest.raises(ValueError, match="exactly one business leaf difference"):
        validate_catalog(catalog)


def test_semantic_pair_reports_exact_undeclared_leaf_in_added_mapping():
    catalog = two_case_catalog()
    catalog["cases"][1]["journey"]["scenario"] = copy.deepcopy(
        catalog["cases"][0]["journey"]["scenario"]
    )
    del catalog["cases"][0]["journey"]["automatic_path"]
    catalog["cases"][1]["journey"]["automatic_path"] = {
        "service_choice": "rank_1",
        "rest_response": "accept",
        "sleep_minutes": 20,
    }
    declared = [
        "journey.automatic_path.rest_response",
        "journey.automatic_path.service_choice",
    ]
    for case in catalog["cases"]:
        case["contrast"]["changed_inputs"] = declared

    with pytest.raises(
        ValueError,
        match=re.escape("journey.automatic_path.sleep_minutes"),
    ):
        validate_catalog(catalog)


@pytest.mark.parametrize(
    ("path", "expected_context"),
    [
        (("group",), "catalog.cases[0].group"),
        (("what_to_watch",), "catalog.cases[0].what_to_watch"),
        (("title", "en"), "catalog.cases[0].title.en"),
        (("persona", "name"), "catalog.cases[0].persona.name"),
        (("persona", "name", "en"), "catalog.cases[0].persona.name.en"),
        (("persona", "narrative"), "catalog.cases[0].persona.narrative"),
        (
            ("persona", "narrative", "en"),
            "catalog.cases[0].persona.narrative.en",
        ),
        (("journey", "narrative"), "catalog.cases[0].journey.narrative"),
        (
            ("journey", "route_preset_ref"),
            "catalog.cases[0].journey.route_preset_ref",
        ),
    ],
)
def test_catalog_validation_rejects_missing_compiler_consumed_case_field(
    path: tuple[str, ...],
    expected_context: str,
):
    catalog = two_case_catalog()
    parent = catalog["cases"][0]
    for key in path[:-1]:
        parent = parent[key]
    del parent[path[-1]]

    with pytest.raises(ValueError, match=re.escape(expected_context)):
        validate_catalog(catalog)


@pytest.mark.parametrize("field", ["label", "builtin", "profile"])
def test_catalog_validation_rejects_missing_compiler_consumed_profile_field(
    field: str,
):
    catalog = two_case_catalog()
    del catalog["profiles"][0][field]

    with pytest.raises(
        ValueError,
        match=re.escape(f"catalog.profiles[0].{field}"),
    ):
        validate_catalog(catalog)


@pytest.mark.parametrize(
    "field",
    [
        "version",
        "initial_drowsiness",
        "initial_fatigue",
        "drowsiness_model",
        "fatigue_model",
        "anomaly_model",
        "route_distance_km",
        "rest_fraction",
        "primary_fraction",
        "primary_road_type",
        "traffic_events",
        "weather_events",
        "is_night",
        "child_passenger",
        "familiar_route",
        "weather_risk",
        "total_duration_seconds",
        "tick_seconds",
        "seed",
        "speed_profile",
        "allowed_actions",
    ],
)
def test_catalog_validation_rejects_missing_scenario_recipe_field(field: str):
    catalog = two_case_catalog()
    for case in catalog["cases"]:
        del case["journey"]["scenario"][field]

    with pytest.raises(
        ValueError,
        match=re.escape(f"catalog.cases[0].journey.scenario.{field} is required"),
    ):
        validate_catalog(catalog)


def test_invalid_scenario_does_not_replace_a_generated_file(tmp_path: Path):
    catalog = two_case_catalog()
    compile_artifacts(catalog, tmp_path)
    original_outputs = {
        path.relative_to(tmp_path): path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    }
    for case in catalog["cases"]:
        case["journey"]["scenario"]["weather_risk"] = 101

    with pytest.raises(
        ValueError,
        match="scenario for TC-R01 failed model validation",
    ):
        compile_artifacts(catalog, tmp_path)

    current_outputs = {
        path.relative_to(tmp_path): path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    }
    assert current_outputs == original_outputs


def test_compiler_prunes_only_stale_managed_files(tmp_path: Path):
    stale = tmp_path / "scenarios/semantic_tc_stale.json"
    unrelated = tmp_path / "scenarios/customer-authored.json"
    stale.parent.mkdir(parents=True)
    stale.write_text("{}\n", encoding="utf-8")
    unrelated.write_text("{}\n", encoding="utf-8")

    compile_artifacts(two_case_catalog(), tmp_path)

    assert not stale.exists()
    assert unrelated.exists()


def test_load_catalog_validates_and_returns_plain_data(tmp_path: Path):
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(two_case_catalog(), ensure_ascii=False),
        encoding="utf-8",
    )

    loaded = load_catalog(catalog_path)

    assert loaded["catalog_id"] == "semantic-combined-experience"
    assert [case["display_id"] for case in loaded["cases"]] == [
        "TC-R01",
        "TC-R02",
    ]


def test_compiler_returns_sorted_paths_and_exact_bytes_on_repeat(tmp_path: Path):
    first_paths = compile_artifacts(two_case_catalog(), tmp_path)
    first_relative_paths = [
        path.relative_to(tmp_path).as_posix() for path in first_paths
    ]
    first_bytes = {
        relative_path: (tmp_path / relative_path).read_bytes()
        for relative_path in first_relative_paths
    }

    second_paths = compile_artifacts(two_case_catalog(), tmp_path)
    second_relative_paths = [
        path.relative_to(tmp_path).as_posix() for path in second_paths
    ]
    second_bytes = {
        relative_path: (tmp_path / relative_path).read_bytes()
        for relative_path in second_relative_paths
    }

    assert first_relative_paths == sorted(first_relative_paths)
    assert second_relative_paths == first_relative_paths
    assert second_bytes == first_bytes


def test_committed_source_contains_complete_36_case_semantic_catalog(tmp_path: Path):
    catalog = load_catalog(_SOURCE_CATALOG)
    cases = {case["display_id"]: case for case in catalog["cases"]}

    expected_ids = {
        f"TC-{group}{number:02d}"
        for group in ("R", "M", "E", "S", "P", "I")
        for number in range(1, 7)
    }
    assert set(cases) == expected_ids
    assert cases["TC-R01"]["title"]["en"] == (
        "Protect a sleep-deprived late-shift worker with an early rest proposal"
    )
    assert cases["TC-R02"]["title"]["en"] == (
        "Keep a well-rested late-shift worker driving without a premature rest "
        "proposal (contrast with test case ID TC-R01)"
    )
    assert cases["TC-R01"]["contrast"]["kind"] == "semantic_real_world"
    assert set(cases["TC-R02"]["contrast"]["changed_inputs"]) == set(
        _CHANGED_SLEEP_INPUTS
    )

    written = compile_artifacts(catalog, tmp_path)

    assert len(catalog["profiles"]) == 17
    assert len(written) == 36 + 36 + 17


def test_module_cli_compiles_without_runtime_warnings(tmp_path: Path):
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.semantic_catalog.generator",
            "--catalog",
            str(_SOURCE_CATALOG),
            "--repo-root",
            str(tmp_path),
        ],
        cwd=_REPO_ROOT,
        capture_output=True,
        check=False,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
