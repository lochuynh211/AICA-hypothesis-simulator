"""TDD: feature-disposition registry completeness + Appendix A.2 / §9 cross-check.

Phase 5 — User Story 3 (T017 RED → T018/T019 GREEN).

The registry ``CONTENT_FEATURE_DISPOSITIONS`` in
``aica_api.models.proposal.dispositions`` is the single source of truth marking
every content-feature field from the specification §9 table
("Feature Contract — Concrete Content Proposal, One Independent Table") with a
disposition + provenance. These tests assert:

- every §9 field appears exactly once in the registry;
- every entry has a valid disposition + feature_origin; scored rows carry a
  response_provenance; feature_origin and response_provenance are SEPARATE
  fields, never conflated (FR-020);
- exactly the six genre-gated fields are flagged;
- scored categorical fields carry non-empty enum_responses;
- cross-check: the field-name set parsed directly from the §9 markdown table in
  ``docs/master/aica_proposal_simulator_specification.md`` equals the registry's
  field-name set (row-set equality — drift guard against A.2/§9).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from aica_api.models.proposal.dispositions import (
    CONTENT_FEATURE_DISPOSITIONS,
    DispositionEntry,
    registry_version,
)
from aica_api.models.proposal.enums import (
    FeatureDisposition,
    FeatureOriginProvenance,
    ResponseCoefficientProvenance,
)


# ---------------------------------------------------------------------------
# §9 markdown table parser (robust, structural)
# ---------------------------------------------------------------------------

# The six genre-gated fields (design §6.1 / content-algo §5.3 `genre‡`).
GENRE_GATED_FIELDS = {
    "route_tags",
    "destination_tags",
    "child_present",
    "hobby_interest_tags",
    "content_tag_usage_level",
    "scene_content_tag_usage_level",
}

# Scored categorical fields whose per-enum-value responses must be recorded.
SCORED_CATEGORICAL_FIELDS = {
    "road_type",
    "traffic_state",
    "night_state",
    "motion_state",
}


def _find_repo_root() -> Path:
    """Walk up from this test file until the master spec doc is found."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "docs" / "master" / "aica_proposal_simulator_specification.md"
        if candidate.exists():
            return parent
    raise FileNotFoundError("Could not locate repo root containing docs/master/")


def _spec_doc_path() -> Path:
    return (
        _find_repo_root()
        / "docs"
        / "master"
        / "aica_proposal_simulator_specification.md"
    )


def _extract_field_id(cell: str) -> str | None:
    """Extract the bare field identifier from a '`field[...]` — desc' cell.

    The field is the FIRST backticked identifier in the "Field and value type"
    column; any ``[subscript]`` map/index suffix is stripped so
    e.g. ``service_recency_state[service]`` -> ``service_recency_state``.
    """
    match = re.search(r"`([^`]+)`", cell)
    if match is None:
        return None
    token = match.group(1).strip()
    # Strip trailing map/index subscript(s): field[key][key2] -> field
    token = token.split("[", 1)[0].strip()
    return token or None


def parse_section9_field_ids() -> list[str]:
    """Parse §9's field table and return the ordered list of field identifiers."""
    text = _spec_doc_path().read_text(encoding="utf-8")
    lines = text.splitlines()

    # Locate the §9 heading, then collect table rows until the next '## ' heading.
    start = None
    for i, line in enumerate(lines):
        if line.startswith("## 9.") and "Concrete Content Proposal" in line:
            start = i
            break
    assert start is not None, "Could not find §9 heading in the specification doc"

    field_ids: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):  # next top-level section — stop
            break
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        # Skip header row and the |---|---| separator row.
        if cells[0] == "Category" or set(cells[0]) <= {"-", ":"}:
            continue
        field_cell = cells[3]  # "Field and value type" column
        field_id = _extract_field_id(field_cell)
        if field_id is not None:
            field_ids.append(field_id)
    return field_ids


# ---------------------------------------------------------------------------
# Registry shape
# ---------------------------------------------------------------------------

def test_registry_is_list_of_entries():
    assert isinstance(CONTENT_FEATURE_DISPOSITIONS, list)
    assert len(CONTENT_FEATURE_DISPOSITIONS) > 0
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        assert isinstance(entry, DispositionEntry)


def test_registry_version_is_one():
    assert registry_version == "1"


# ---------------------------------------------------------------------------
# Completeness: every §9 field appears exactly once
# ---------------------------------------------------------------------------

def test_every_field_appears_exactly_once():
    ids = [e.feature_id for e in CONTENT_FEATURE_DISPOSITIONS]
    # No duplicates.
    duplicates = {fid for fid in ids if ids.count(fid) > 1}
    assert not duplicates, f"duplicate feature_ids in registry: {duplicates}"


def test_registry_field_set_equals_section9_row_set():
    """Row-set equality between the registry and the §9 markdown table."""
    spec_ids = parse_section9_field_ids()
    # Sanity: the parser must find a non-trivial table.
    assert len(spec_ids) >= 40, f"parser only found {len(spec_ids)} §9 rows"
    # No duplicate field rows in the doc itself.
    assert len(spec_ids) == len(set(spec_ids)), "duplicate field rows parsed from §9"

    registry_ids = {e.feature_id for e in CONTENT_FEATURE_DISPOSITIONS}
    spec_set = set(spec_ids)

    missing = spec_set - registry_ids  # §9 fields absent from registry
    extra = registry_ids - spec_set  # registry fields absent from §9
    assert not missing, f"§9 fields missing from registry: {sorted(missing)}"
    assert not extra, f"registry fields not present in §9: {sorted(extra)}"
    # And exactly-once cardinality vs the doc.
    assert len(CONTENT_FEATURE_DISPOSITIONS) == len(spec_ids)


# ---------------------------------------------------------------------------
# Validity: disposition + provenance
# ---------------------------------------------------------------------------

def test_every_entry_has_valid_disposition_and_feature_origin():
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        assert isinstance(entry.disposition, FeatureDisposition)
        assert isinstance(entry.feature_origin, FeatureOriginProvenance)


def test_scored_rows_carry_response_provenance():
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        if entry.disposition is FeatureDisposition.scored:
            assert entry.response_provenance is not None, (
                f"scored field {entry.feature_id!r} lacks response_provenance"
            )
            assert isinstance(
                entry.response_provenance, ResponseCoefficientProvenance
            )


def test_non_scored_rows_have_no_response_provenance():
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        if entry.disposition is not FeatureDisposition.scored:
            assert entry.response_provenance is None, (
                f"non-scored field {entry.feature_id!r} should not carry "
                f"response_provenance"
            )


def test_feature_origin_and_response_provenance_are_separate_fields():
    """FR-020: origin and response-coefficient provenance are never conflated.

    They are held in distinct fields drawing from distinct enums; a value from
    one enum must never appear in the other's field.
    """
    origin_values = {m.value for m in FeatureOriginProvenance}
    response_values = {m.value for m in ResponseCoefficientProvenance}
    # The two enums must not share any string values (else conflation is possible).
    assert origin_values.isdisjoint(response_values)
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        assert entry.feature_origin.value in origin_values
        if entry.response_provenance is not None:
            assert entry.response_provenance.value in response_values


# ---------------------------------------------------------------------------
# Genre-gated set
# ---------------------------------------------------------------------------

def test_exactly_six_genre_gated_fields():
    gated = {e.feature_id for e in CONTENT_FEATURE_DISPOSITIONS if e.genre_gated}
    assert gated == GENRE_GATED_FIELDS
    assert len(gated) == 6


def test_genre_gated_rows_are_scored_disposition():
    for entry in CONTENT_FEATURE_DISPOSITIONS:
        if entry.genre_gated:
            assert entry.disposition is FeatureDisposition.scored


# ---------------------------------------------------------------------------
# Scored categorical fields carry per-enum responses
# ---------------------------------------------------------------------------

def test_scored_categoricals_have_enum_responses():
    by_id = {e.feature_id: e for e in CONTENT_FEATURE_DISPOSITIONS}
    for field_id in SCORED_CATEGORICAL_FIELDS:
        assert field_id in by_id, f"{field_id} missing from registry"
        entry = by_id[field_id]
        assert entry.disposition is FeatureDisposition.scored
        assert entry.enum_responses is not None, (
            f"scored categorical {field_id!r} has no enum_responses"
        )
        assert len(entry.enum_responses) > 0
        for value, response in entry.enum_responses.items():
            assert isinstance(value, str) and value
            assert isinstance(response, str) and response


# ---------------------------------------------------------------------------
# Count discipline: 15 Spotify-only scored + 6 genre-gated (design §6.1)
# ---------------------------------------------------------------------------

def test_scored_counts_match_design():
    scored = [
        e for e in CONTENT_FEATURE_DISPOSITIONS
        if e.disposition is FeatureDisposition.scored
    ]
    genre_gated_scored = [e for e in scored if e.genre_gated]
    spotify_only_scored = [e for e in scored if not e.genre_gated]
    assert len(genre_gated_scored) == 6
    assert len(spotify_only_scored) == 15
