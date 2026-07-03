"""TDD feedback schema tests (M5 T004) — written RED, implement to GREEN.

Tests for:
  effective_schema(package) -> list[FieldDef]
  - baseline-only (empty extras) returns the 9 V1 fields in order
  - fixture package extras append after the baseline
  - a colliding extra key raises SchemaCollisionError
"""
from __future__ import annotations

import json
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_FIXTURES = pathlib.Path(__file__).parent / "fixtures"
# Feature 009: rest_rule_based_v0_1 is retired.
_BASELINE_PKG_PATH = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1" / "package.json"
_EXTRAS_PKG_PATH = _FIXTURES / "pkg_with_extras" / "package.json"


def _load_package(path: pathlib.Path):
    from aica_api.models.package import PackageManifest

    data = json.loads(path.read_text(encoding="utf-8"))
    return PackageManifest(**data)


# ---------------------------------------------------------------------------
# T004-1 — baseline-only: empty extras returns exactly 9 V1 fields
# ---------------------------------------------------------------------------


def test_effective_schema_baseline_only_returns_9_fields():
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_BASELINE_PKG_PATH)
    assert pkg.feedback_schema == [], "precondition: baseline package has no extras"

    schema = effective_schema(pkg)
    assert len(schema) == 9


def test_effective_schema_baseline_only_keys_match_v1():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_BASELINE_PKG_PATH)
    schema = effective_schema(pkg)

    expected_keys = [fd.key for fd in V1_FEEDBACK_SCHEMA]
    assert [fd.key for fd in schema] == expected_keys


def test_effective_schema_baseline_only_types_are_fielddefs():
    from aica_api.models.feedback import FieldDef
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_BASELINE_PKG_PATH)
    schema = effective_schema(pkg)

    for fd in schema:
        assert isinstance(fd, FieldDef)


# ---------------------------------------------------------------------------
# T004-2 — extras appended: fixture package adds 2 fields after the 9
# ---------------------------------------------------------------------------


def test_effective_schema_with_extras_returns_11_fields():
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_EXTRAS_PKG_PATH)
    assert len(pkg.feedback_schema) == 2, "precondition: fixture has 2 extras"

    schema = effective_schema(pkg)
    assert len(schema) == 11


def test_effective_schema_with_extras_v1_fields_come_first():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_EXTRAS_PKG_PATH)
    schema = effective_schema(pkg)

    v1_keys = [fd.key for fd in V1_FEEDBACK_SCHEMA]
    actual_first_9 = [fd.key for fd in schema[:9]]
    assert actual_first_9 == v1_keys


def test_effective_schema_with_extras_extra_keys_appended():
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_EXTRAS_PKG_PATH)
    schema = effective_schema(pkg)

    extra_keys = [fd.key for fd in schema[9:]]
    assert extra_keys == ["comfort", "seat_quality"]


def test_effective_schema_extras_parsed_as_fielddefs():
    from aica_api.models.feedback import FieldDef
    from aica_api.services.feedback import effective_schema

    pkg = _load_package(_EXTRAS_PKG_PATH)
    schema = effective_schema(pkg)

    comfort = next(fd for fd in schema if fd.key == "comfort")
    assert isinstance(comfort, FieldDef)
    assert comfort.type == "choice"
    assert comfort.options == ["smooth", "ok", "jarring"]

    seat = next(fd for fd in schema if fd.key == "seat_quality")
    assert isinstance(seat, FieldDef)
    assert seat.type == "scale"
    assert seat.min == 1.0
    assert seat.max == 5.0


# ---------------------------------------------------------------------------
# T004-3 — collision: extra whose key matches a V1 key → SchemaCollisionError
# ---------------------------------------------------------------------------


def test_effective_schema_collision_raises():
    from aica_api.models.package import PackageManifest
    from aica_api.services.feedback import SchemaCollisionError, effective_schema

    data = json.loads(_BASELINE_PKG_PATH.read_text(encoding="utf-8"))
    # Inject a colliding key: "proposal_timing" is a V1 key
    data["feedback_schema"] = [
        {
            "key": "proposal_timing",
            "label": {"ja": "テスト", "en": "Test"},
            "type": "choice",
            "options": ["a", "b"],
        }
    ]
    pkg = PackageManifest(**data)

    with pytest.raises(SchemaCollisionError):
        effective_schema(pkg)


def test_effective_schema_collision_error_message_contains_key():
    from aica_api.models.package import PackageManifest
    from aica_api.services.feedback import SchemaCollisionError, effective_schema

    data = json.loads(_BASELINE_PKG_PATH.read_text(encoding="utf-8"))
    data["feedback_schema"] = [
        {
            "key": "overall_judgment",
            "label": {"ja": "テスト", "en": "Test"},
            "type": "choice",
            "options": ["x"],
        }
    ]
    pkg = PackageManifest(**data)

    with pytest.raises(SchemaCollisionError, match="overall_judgment"):
        effective_schema(pkg)


# ---------------------------------------------------------------------------
# T004-4 — malformed extra: missing required field → SchemaCollisionError with package id
# ---------------------------------------------------------------------------


def test_effective_schema_malformed_extra_missing_key_raises_collision_error():
    """An extra missing the required 'key' field → SchemaCollisionError naming the package."""
    from aica_api.models.package import PackageManifest
    from aica_api.services.feedback import SchemaCollisionError, effective_schema

    data = json.loads(_BASELINE_PKG_PATH.read_text(encoding="utf-8"))
    # Inject a malformed extra: 'key' field is absent (required by FieldDef)
    data["feedback_schema"] = [
        {
            "label": {"ja": "テスト", "en": "Test"},
            "type": "choice",
            "options": ["a", "b"],
        }
    ]
    pkg = PackageManifest(**data)

    with pytest.raises(SchemaCollisionError, match=pkg.id):
        effective_schema(pkg)


def test_effective_schema_malformed_extra_bad_type_raises_collision_error():
    """An extra with an invalid 'type' value → SchemaCollisionError naming the package."""
    from aica_api.models.package import PackageManifest
    from aica_api.services.feedback import SchemaCollisionError, effective_schema

    data = json.loads(_BASELINE_PKG_PATH.read_text(encoding="utf-8"))
    data["feedback_schema"] = [
        {
            "key": "custom_field",
            "label": {"ja": "テスト", "en": "Test"},
            "type": "not_a_real_type",  # invalid enum value
        }
    ]
    pkg = PackageManifest(**data)

    with pytest.raises(SchemaCollisionError, match=pkg.id):
        effective_schema(pkg)
