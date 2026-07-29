"""Compile authored semantic catalog records into runtime JSON artifacts."""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from aica_api.models.proposal.world import DriverProfile, DriverProfileRecord
from aica_api.models.scenario import ScenarioDef


_MODULE_REPO_ROOT = Path(__file__).resolve().parents[2]
_CASE_SCHEMA_RELATIVE_PATH = Path(
    "combined_contracts/schema/combined_test_case.schema.json"
)
_DISPLAY_ID_PATTERN = re.compile(r"^TC-[A-Z][0-9]{2}$")
_PROFILE_ID_PATTERN = re.compile(r"^profile-semantic-[a-z0-9-]+$")
_MANAGED_GLOBS = (
    (Path("scenarios"), "semantic_tc_*.json"),
    (Path("proposal_contracts/profiles"), "profile-semantic-*.json"),
    (Path("combined_contracts/test_cases"), "case-tc-*.json"),
)
_REQUIRED_SCENARIO_RECIPE_FIELDS = (
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
)
_MISSING = object()


def load_catalog(path: Path) -> dict[str, Any]:
    """Load and validate one authored semantic catalog JSON document."""

    try:
        loaded = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load semantic catalog {path}: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ValueError("semantic catalog root must be a JSON object")
    validate_catalog(loaded)
    return loaded


def validate_catalog(catalog: Mapping[str, Any]) -> None:
    """Validate catalog structure and declared contrast boundaries.

    Contrast validation compares executable business inputs only: scenario
    recipes, route/automatic-path choices, the resolved driver profile, and
    frozen algorithm IDs. Narrative and identity fields are intentionally
    excluded.
    """

    if not isinstance(catalog, Mapping):
        raise ValueError("semantic catalog must be a mapping")
    for key in ("catalog_id", "catalog_version", "case_schema_version"):
        _require_nonempty_string(catalog, key, "catalog")

    profiles = _require_list(catalog, "profiles", "catalog")
    cases = _require_list(catalog, "cases", "catalog")
    if not cases:
        raise ValueError("catalog.cases must contain at least one case")

    profiles_by_id: dict[str, Mapping[str, Any]] = {}
    for index, profile in enumerate(profiles):
        where = f"catalog.profiles[{index}]"
        if not isinstance(profile, Mapping):
            raise ValueError(f"{where} must be an object")
        profile_id = _require_nonempty_string(profile, "profile_id", where)
        if not _PROFILE_ID_PATTERN.fullmatch(profile_id):
            raise ValueError(
                f"{where}.profile_id must start with 'profile-semantic-' and "
                "contain only lowercase letters, digits, and hyphens"
            )
        if profile_id in profiles_by_id:
            raise ValueError(f"duplicate semantic profile_id {profile_id!r}")
        _require_mapping(profile, "label", where)
        _require_bool(profile, "builtin", where)
        profile_value = _require_mapping(profile, "profile", where)
        try:
            DriverProfile.model_validate(profile_value)
        except Exception as exc:
            raise ValueError(f"{where}.profile is invalid: {exc}") from exc
        profiles_by_id[profile_id] = profile

    cases_by_id: dict[str, Mapping[str, Any]] = {}
    for index, case in enumerate(cases):
        where = f"catalog.cases[{index}]"
        if not isinstance(case, Mapping):
            raise ValueError(f"{where} must be an object")
        display_id = _require_nonempty_string(case, "display_id", where)
        if not _DISPLAY_ID_PATTERN.fullmatch(display_id):
            raise ValueError(f"{where}.display_id is invalid: {display_id!r}")
        if display_id in cases_by_id:
            raise ValueError(f"duplicate semantic display_id {display_id!r}")
        _require_nonempty_string(case, "version", where)
        _require_nonempty_string(case, "group", where)
        _require_list(case, "what_to_watch", where)
        for key in (
            "title",
            "brief",
            "purpose",
            "real_world",
            "hypothesis",
            "expectations",
            "persona",
            "journey",
            "algorithm_defaults",
        ):
            _require_mapping(case, key, where)
        title = case["title"]
        _require_nonempty_string(title, "en", f"{where}.title")
        persona = case["persona"]
        persona_name = _require_mapping(persona, "name", f"{where}.persona")
        _require_nonempty_string(persona_name, "en", f"{where}.persona.name")
        persona_narrative = _require_mapping(
            persona,
            "narrative",
            f"{where}.persona",
        )
        _require_nonempty_string(
            persona_narrative,
            "en",
            f"{where}.persona.narrative",
        )
        journey = case["journey"]
        _require_mapping(journey, "narrative", f"{where}.journey")
        _require_nonempty_string(
            journey,
            "route_preset_ref",
            f"{where}.journey",
        )
        recipe = _require_mapping(journey, "scenario", f"{where}.journey")
        _validate_scenario_recipe(recipe, f"{where}.journey.scenario")
        profile_ref = _require_nonempty_string(
            persona, "profile_ref", f"{where}.persona"
        )
        if profile_ref not in profiles_by_id:
            raise ValueError(f"{where} references unknown profile {profile_ref!r}")
        cases_by_id[display_id] = case

    checked_pairs: set[tuple[str, str]] = set()
    for display_id, case in cases_by_id.items():
        contrast = case.get("contrast")
        if contrast is None:
            continue
        if not isinstance(contrast, Mapping):
            raise ValueError(f"{display_id}.contrast must be an object")
        paired_id = _require_nonempty_string(
            contrast, "with_case_id", f"{display_id}.contrast"
        )
        paired = cases_by_id.get(paired_id)
        if paired is None:
            raise ValueError(f"{display_id} contrasts with unknown case {paired_id!r}")
        pair_key = tuple(sorted((display_id, paired_id)))
        if pair_key in checked_pairs:
            continue
        checked_pairs.add(pair_key)
        _validate_contrast_pair(
            display_id,
            case,
            paired_id,
            paired,
            profiles_by_id,
        )


def compile_artifacts(
    catalog: Mapping[str, Any],
    repo_root: Path,
) -> list[Path]:
    """Compile, validate, and atomically write all managed runtime artifacts."""

    validate_catalog(catalog)
    root = Path(repo_root)
    artifacts: dict[Path, dict[str, Any]] = {}

    for profile_source in sorted(
        catalog["profiles"], key=lambda record: record["profile_id"]
    ):
        profile_id = profile_source["profile_id"]
        record = {
            "profile_id": profile_id,
            "label": copy.deepcopy(profile_source["label"]),
            "builtin": bool(profile_source["builtin"]),
            "profile": copy.deepcopy(profile_source["profile"]),
        }
        try:
            DriverProfile.model_validate(record["profile"])
            DriverProfileRecord.model_validate(record)
        except Exception as exc:
            raise ValueError(f"profile {profile_id} failed model validation: {exc}") from exc
        artifacts[
            root / "proposal_contracts/profiles" / f"{profile_id}.json"
        ] = record

    schema = _load_case_schema(root)
    for source_case in sorted(catalog["cases"], key=lambda case: case["display_id"]):
        scenario = _compile_scenario(source_case, catalog)
        try:
            ScenarioDef.model_validate(scenario)
        except Exception as exc:
            raise ValueError(
                f"scenario for {source_case['display_id']} failed model validation: {exc}"
            ) from exc

        case = _compile_case(source_case, catalog)
        _validate_json_schema(case, schema)

        scenario_id = scenario["id"]
        artifacts[root / "scenarios" / f"{scenario_id}.json"] = scenario
        artifacts[
            root / "combined_contracts/test_cases" / f"{case['case_id']}.json"
        ] = case

    expected_paths = set(artifacts)
    written: list[Path] = []
    for path in sorted(artifacts, key=lambda item: item.as_posix()):
        _write_json_atomic(path, artifacts[path])
        written.append(path)

    _prune_stale_managed_files(root, expected_paths)
    return written


def _compile_scenario(
    source_case: Mapping[str, Any],
    catalog: Mapping[str, Any],
) -> dict[str, Any]:
    display_id = source_case["display_id"]
    scenario_id = _scenario_id(display_id)
    journey = source_case["journey"]
    recipe = journey["scenario"]

    primary_type = recipe["primary_road_type"]
    primary_speed_band = {
        "highway": "fast",
        "urban": "medium",
        "national": "medium",
        "residential": "slow",
    }.get(primary_type, "medium")
    persona = source_case["persona"]
    title = source_case["title"]
    scenario = {
        "id": scenario_id,
        "version": recipe["version"],
        "type": "semantic_combined",
        "persona": {
            "name": persona["name"]["en"],
            "description": persona["narrative"]["en"],
        },
        "route_intent": {
            "rest_facility": {
                "label": {
                    "en": "Planned Rest Area",
                    "ja": "予定休憩所",
                }
            },
            "segments": [
                {
                    "id": "seg_start",
                    "name": {"en": "Start", "ja": "出発地"},
                    "type": "start",
                    "at": 0.0,
                    "speed_band": "slow",
                    "length_band": "short",
                    "is_rest_facility": False,
                },
                {
                    "id": "seg_rest",
                    "name": {"en": "Planned Rest Area", "ja": "予定休憩所"},
                    "type": "rest",
                    "at": recipe["rest_fraction"],
                    "speed_band": "slow",
                    "length_band": "short",
                    "is_rest_facility": True,
                },
                {
                    "id": "seg_primary",
                    "name": {"en": "Primary Road", "ja": "主要道路"},
                    "type": primary_type,
                    "at": recipe["primary_fraction"],
                    "speed_band": primary_speed_band,
                    "length_band": "long",
                    "is_rest_facility": False,
                },
                {
                    "id": "seg_end",
                    "name": {"en": "Destination", "ja": "目的地"},
                    "type": "end",
                    "at": 1.0,
                    "speed_band": "slow",
                    "length_band": "short",
                    "is_rest_facility": False,
                },
            ],
        },
        "initial_state": {
            "drowsiness_level": recipe["initial_drowsiness"],
            "fatigue_level": recipe["initial_fatigue"],
        },
        "driver_signal_params": {
            "id": f"{scenario_id}_driver",
            "drowsiness_model": copy.deepcopy(recipe["drowsiness_model"]),
            "fatigue_model": copy.deepcopy(recipe["fatigue_model"]),
            "recovery_model": copy.deepcopy(recipe.get("recovery_model", {})),
        },
        "anomaly_signal_params": copy.deepcopy(recipe["anomaly_model"]),
        "run_seed_default": recipe["seed"],
        "speed_profile": copy.deepcopy(recipe["speed_profile"]),
        "is_night": recipe["is_night"],
        "child_passenger": recipe["child_passenger"],
        "familiar_route": recipe["familiar_route"],
        "weather_risk": recipe["weather_risk"],
        "rest_drowsiness_ceiling": recipe.get("rest_drowsiness_ceiling", 100.0),
        "presets": {
            "total_route_distance_km": recipe["route_distance_km"],
            "traffic_events": copy.deepcopy(recipe["traffic_events"]),
            "weather_events": copy.deepcopy(recipe["weather_events"]),
            "semantic_catalog": {
                "catalog_id": catalog["catalog_id"],
                "catalog_version": catalog["catalog_version"],
                "display_id": display_id,
            },
        },
        "event_presets": {
            "signal_duration_at_trigger": recipe.get(
                "signal_duration_at_trigger", "persistent"
            )
        },
        "total_duration_seconds": recipe["total_duration_seconds"],
        "tick_seconds": recipe["tick_seconds"],
        "allowed_actions": copy.deepcopy(recipe["allowed_actions"]),
        "recovery_options": [],
        "review_focus": f"{display_id}: {title['en']}",
    }
    return scenario


def _compile_case(
    source_case: Mapping[str, Any],
    catalog: Mapping[str, Any],
) -> dict[str, Any]:
    display_id = source_case["display_id"]
    source_journey = source_case["journey"]
    recipe = source_journey["scenario"]
    fixed_overrides: dict[str, Any] = {
        "initial_drowsiness": recipe["initial_drowsiness"],
        "initial_fatigue": recipe["initial_fatigue"],
        "is_night": recipe["is_night"],
        "child_passenger": recipe["child_passenger"],
        "route_tags": copy.deepcopy(recipe.get("route_tags", [])),
        "destination_tags": copy.deepcopy(recipe.get("destination_tags", [])),
        "multiple_passengers": recipe.get("multiple_passengers", False),
    }
    for optional_range in ("mountain_range_km", "jam_range_km"):
        if optional_range in recipe:
            fixed_overrides[optional_range] = copy.deepcopy(recipe[optional_range])

    journey = {
        "narrative": copy.deepcopy(source_journey["narrative"]),
        "scenario_ref": _scenario_id(display_id),
        "route_preset_ref": source_journey["route_preset_ref"],
        "seed": recipe["seed"],
        "tick_seconds": recipe["tick_seconds"],
        "fixed_overrides": fixed_overrides,
    }
    if "automatic_path" in source_journey:
        journey["automatic_path"] = copy.deepcopy(source_journey["automatic_path"])

    case = {
        "case_id": _case_id(display_id),
        "display_id": display_id,
        "schema_version": catalog["case_schema_version"],
        "version": source_case["version"],
        "title": copy.deepcopy(source_case["title"]),
        "brief": copy.deepcopy(source_case["brief"]),
        "group": source_case["group"],
        "purpose": copy.deepcopy(source_case["purpose"]),
        "what_to_watch": copy.deepcopy(source_case["what_to_watch"]),
        "real_world": copy.deepcopy(source_case["real_world"]),
        "hypothesis": copy.deepcopy(source_case["hypothesis"]),
        "expectations": copy.deepcopy(source_case["expectations"]),
        "persona": copy.deepcopy(source_case["persona"]),
        "journey": journey,
        "algorithm_defaults": copy.deepcopy(source_case["algorithm_defaults"]),
    }
    if "contrast" in source_case:
        case["contrast"] = copy.deepcopy(source_case["contrast"])
    return case


def _validate_contrast_pair(
    display_id: str,
    case: Mapping[str, Any],
    paired_id: str,
    paired: Mapping[str, Any],
    profiles_by_id: Mapping[str, Mapping[str, Any]],
) -> None:
    contrast = case["contrast"]
    reciprocal = paired.get("contrast")
    if not isinstance(reciprocal, Mapping):
        raise ValueError(f"{paired_id} must declare its reciprocal contrast")
    if reciprocal.get("with_case_id") != display_id:
        raise ValueError(
            f"{paired_id}.contrast.with_case_id must be {display_id!r}"
        )
    roles = {contrast.get("role"), reciprocal.get("role")}
    if roles != {"baseline", "variant"}:
        raise ValueError(
            f"contrast pair {display_id}/{paired_id} must contain one baseline "
            "and one variant"
        )
    kind = contrast.get("kind")
    if kind not in {"controlled_one_factor", "semantic_real_world"}:
        raise ValueError(f"{display_id}.contrast.kind is invalid")
    if reciprocal.get("kind") != kind:
        raise ValueError(f"contrast pair {display_id}/{paired_id} has mixed kinds")

    declared = contrast.get("changed_inputs")
    reciprocal_declared = reciprocal.get("changed_inputs")
    if not isinstance(declared, list) or not all(
        isinstance(path, str) and path for path in declared
    ):
        raise ValueError(f"{display_id}.contrast.changed_inputs must be strings")
    if not isinstance(reciprocal_declared, list) or not all(
        isinstance(path, str) and path for path in reciprocal_declared
    ):
        raise ValueError(f"{paired_id}.contrast.changed_inputs must be strings")
    if len(declared) != len(set(declared)):
        raise ValueError(f"{display_id}.contrast.changed_inputs must be unique")
    if len(reciprocal_declared) != len(set(reciprocal_declared)):
        raise ValueError(f"{paired_id}.contrast.changed_inputs must be unique")
    declared_set = set(declared)
    if declared_set != set(reciprocal_declared):
        raise ValueError(
            f"contrast pair {display_id}/{paired_id} must declare the same changed_inputs"
        )
    if kind == "controlled_one_factor" and len(declared) != 1:
        raise ValueError(
            f"controlled one-factor contrast {display_id}/{paired_id} must "
            "declare exactly one changed input"
        )

    left = _business_inputs(case, profiles_by_id)
    right = _business_inputs(paired, profiles_by_id)
    differences = _diff_paths(left, right)
    if kind == "controlled_one_factor" and len(differences) != 1:
        raise ValueError(
            f"controlled one-factor contrast {display_id}/{paired_id} must contain "
            f"exactly one business leaf difference; found {sorted(differences)!r}"
        )
    if kind == "controlled_one_factor" and declared_set != differences:
        raise ValueError(
            f"controlled one-factor contrast {display_id}/{paired_id} changed_inputs "
            "must exactly match business leaf differences"
        )

    undeclared = sorted(differences - declared_set)
    if undeclared:
        raise ValueError(
            "undeclared strict-contrast difference "
            f"{undeclared[0]!r} between {display_id} and {paired_id}"
        )
    unchanged_declarations = sorted(declared_set - differences)
    if unchanged_declarations:
        raise ValueError(
            f"declared contrast input {unchanged_declarations[0]!r} does not differ "
            f"between {display_id} and {paired_id}"
        )


def _business_inputs(
    case: Mapping[str, Any],
    profiles_by_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    journey = case["journey"]
    profile_ref = case["persona"]["profile_ref"]
    return {
        "journey": {
            "scenario": copy.deepcopy(journey["scenario"]),
            "route_preset_ref": journey["route_preset_ref"],
            "automatic_path": copy.deepcopy(journey.get("automatic_path")),
        },
        "profile": copy.deepcopy(profiles_by_id[profile_ref]["profile"]),
        "algorithm_defaults": copy.deepcopy(case["algorithm_defaults"]),
    }


def _diff_paths(left: Any, right: Any, prefix: str = "") -> set[str]:
    if isinstance(left, Mapping) and isinstance(right, Mapping):
        differences: set[str] = set()
        for key in sorted(set(left) | set(right)):
            child = f"{prefix}.{key}" if prefix else str(key)
            differences.update(
                _diff_paths(left.get(key, _MISSING), right.get(key, _MISSING), child)
            )
        return differences
    if left != right:
        return {prefix}
    return set()


def _scenario_id(display_id: str) -> str:
    return f"semantic_{display_id.lower().replace('-', '_')}"


def _case_id(display_id: str) -> str:
    return f"case-{display_id.lower()}"


def _load_case_schema(repo_root: Path) -> dict[str, Any]:
    candidate = repo_root / _CASE_SCHEMA_RELATIVE_PATH
    schema_path = candidate if candidate.is_file() else _MODULE_REPO_ROOT / _CASE_SCHEMA_RELATIVE_PATH
    try:
        loaded = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load committed case schema {schema_path}: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ValueError(f"committed case schema {schema_path} must be an object")
    return loaded


def _validate_json_schema(
    instance: Any,
    schema: Mapping[str, Any],
    *,
    root_schema: Mapping[str, Any] | None = None,
    path: str = "$",
) -> None:
    """Validate the Draft-07 subset used by the committed case schema."""

    root = schema if root_schema is None else root_schema
    if "$ref" in schema:
        ref = schema["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/"):
            raise ValueError(f"unsupported JSON Schema reference {ref!r}")
        resolved: Any = root
        for token in ref[2:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            if not isinstance(resolved, Mapping) or token not in resolved:
                raise ValueError(f"unresolved JSON Schema reference {ref!r}")
            resolved = resolved[token]
        _validate_json_schema(instance, resolved, root_schema=root, path=path)
        return

    expected_type = schema.get("type")
    if expected_type is not None and not _matches_json_type(instance, expected_type):
        raise ValueError(
            f"case schema validation failed at {path}: expected {expected_type}, "
            f"got {type(instance).__name__}"
        )
    if "const" in schema and instance != schema["const"]:
        raise ValueError(
            f"case schema validation failed at {path}: expected constant "
            f"{schema['const']!r}"
        )
    if "enum" in schema and instance not in schema["enum"]:
        raise ValueError(
            f"case schema validation failed at {path}: {instance!r} is not in "
            f"{schema['enum']!r}"
        )

    if isinstance(instance, Mapping):
        required = schema.get("required", [])
        for key in required:
            if key not in instance:
                raise ValueError(
                    f"case schema validation failed at {path}: missing required "
                    f"property {key!r}"
                )
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            child_path = f"{path}.{key}"
            if key in properties:
                _validate_json_schema(
                    value,
                    properties[key],
                    root_schema=root,
                    path=child_path,
                )
            elif additional is False:
                raise ValueError(
                    f"case schema validation failed at {path}: additional "
                    f"property {key!r} is forbidden"
                )
            elif isinstance(additional, Mapping):
                _validate_json_schema(
                    value,
                    additional,
                    root_schema=root,
                    path=child_path,
                )

    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            raise ValueError(
                f"case schema validation failed at {path}: too few items"
            )
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            raise ValueError(
                f"case schema validation failed at {path}: too many items"
            )
        if schema.get("uniqueItems"):
            canonical_items = [_canonical_json(item) for item in instance]
            if len(canonical_items) != len(set(canonical_items)):
                raise ValueError(
                    f"case schema validation failed at {path}: items must be unique"
                )
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(instance):
                _validate_json_schema(
                    item,
                    item_schema,
                    root_schema=root,
                    path=f"{path}[{index}]",
                )

    if isinstance(instance, str):
        if len(instance) < schema.get("minLength", 0):
            raise ValueError(
                f"case schema validation failed at {path}: string is too short"
            )
        pattern = schema.get("pattern")
        if pattern is not None and re.search(pattern, instance) is None:
            raise ValueError(
                f"case schema validation failed at {path}: {instance!r} does "
                f"not match {pattern!r}"
            )

    if _is_json_number(instance):
        if "minimum" in schema and instance < schema["minimum"]:
            raise ValueError(
                f"case schema validation failed at {path}: below minimum "
                f"{schema['minimum']!r}"
            )
        if "maximum" in schema and instance > schema["maximum"]:
            raise ValueError(
                f"case schema validation failed at {path}: above maximum "
                f"{schema['maximum']!r}"
            )


def _matches_json_type(value: Any, expected: str) -> bool:
    return {
        "object": isinstance(value, Mapping),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": _is_json_number(value),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }.get(expected, False)


def _is_json_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        temp_path.replace(path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _prune_stale_managed_files(
    repo_root: Path,
    expected_paths: set[Path],
) -> None:
    for relative_dir, pattern in _MANAGED_GLOBS:
        directory = repo_root / relative_dir
        if not directory.is_dir():
            continue
        for path in directory.glob(pattern):
            if path not in expected_paths and path.is_file():
                path.unlink()


def _require_list(
    mapping: Mapping[str, Any],
    key: str,
    where: str,
) -> list[Any]:
    value = mapping.get(key)
    if not isinstance(value, list):
        raise ValueError(f"{where}.{key} must be an array")
    return value


def _require_mapping(
    mapping: Mapping[str, Any],
    key: str,
    where: str,
) -> Mapping[str, Any]:
    value = mapping.get(key)
    if not isinstance(value, Mapping):
        raise ValueError(f"{where}.{key} must be an object")
    return value


def _require_bool(
    mapping: Mapping[str, Any],
    key: str,
    where: str,
) -> bool:
    value = mapping.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{where}.{key} must be a boolean")
    return value


def _require_nonempty_string(
    mapping: Mapping[str, Any],
    key: str,
    where: str,
) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{where}.{key} must be a non-empty string")
    return value


def _validate_scenario_recipe(
    recipe: Mapping[str, Any],
    where: str,
) -> None:
    for key in _REQUIRED_SCENARIO_RECIPE_FIELDS:
        if key not in recipe:
            raise ValueError(f"{where}.{key} is required")

    for key in (
        "drowsiness_model",
        "fatigue_model",
        "anomaly_model",
        "speed_profile",
    ):
        _require_mapping(recipe, key, where)
    for key in ("traffic_events", "weather_events", "allowed_actions"):
        _require_list(recipe, key, where)
    _require_nonempty_string(recipe, "version", where)
    _require_nonempty_string(recipe, "primary_road_type", where)


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compile semantic Combined catalog artifacts."
    )
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    written = compile_artifacts(load_catalog(args.catalog), args.repo_root)
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
