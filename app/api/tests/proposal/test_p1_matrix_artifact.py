"""Tests for the frozen matrix artifact (P1 T002).

Data-artifact-only check: the JSON parses, has the 6 spec §7.5 rows, the
post-rest (after_rest_before_restart) row lists exactly the 5 services incl.
call_response_stopped, and every non-empty allowed_service_ids entry is a
valid ServiceId enum member. The loader/resolver itself is a later task (T012).
"""
from __future__ import annotations

import json

from aica_api.config import settings
from aica_api.models.proposal.enums import ServiceId


def _load_matrix() -> dict:
    path = settings.proposal_contracts_dir / "matrix" / "purpose_stage_matrix.v1.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def test_matrix_parses_and_has_version():
    data = _load_matrix()
    assert data["matrix_version"] == "v1"
    assert isinstance(data["rows"], list)


def test_matrix_has_six_rows():
    data = _load_matrix()
    assert len(data["rows"]) == 6


def test_post_rest_row_has_five_services_incl_call_response_stopped():
    data = _load_matrix()
    post_rest = [
        row for row in data["rows"]
        if row["trigger_purpose"] == "rest_recommended"
        and row["lifecycle_stage"] == "after_rest_before_restart"
    ]
    assert len(post_rest) == 1
    services = post_rest[0]["allowed_service_ids"]
    assert len(services) == 5
    assert "call_response_stopped" in services
    assert set(services) == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }


def test_all_allowed_service_ids_are_valid_service_ids():
    data = _load_matrix()
    valid_ids = {member.value for member in ServiceId}
    for row in data["rows"]:
        for service_id in row["allowed_service_ids"]:
            assert service_id in valid_ids, f"{service_id!r} is not a valid ServiceId"


def test_every_row_has_required_keys():
    data = _load_matrix()
    for row in data["rows"]:
        assert "trigger_purpose" in row
        assert "lifecycle_stage" in row
        assert "allowed_service_ids" in row
        assert isinstance(row["allowed_service_ids"], list)
