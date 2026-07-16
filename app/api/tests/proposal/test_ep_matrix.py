"""TDD: GET /api/proposal/matrix — T020.

Covers:
  - Returns the frozen matrix_version + the 6 spec §7.5 rows.
  - Each row exposes trigger_purpose, lifecycle_stage, allowed_service_ids.
  - The after_rest_before_restart (post-rest) row lists exactly the 5
    services incl. call_response_stopped.
  - The during_rest_stopped row resolves to an empty allowed set.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


def test_get_matrix_returns_version_and_six_rows():
    resp = client.get("/api/proposal/matrix")
    assert resp.status_code == 200
    body = resp.json()
    assert body["matrix_version"] == "v1"
    assert isinstance(body["rows"], list)
    assert len(body["rows"]) == 6
    for row in body["rows"]:
        assert set(row.keys()) == {"trigger_purpose", "lifecycle_stage", "allowed_service_ids"}


def test_get_matrix_post_rest_row_has_five_services_incl_call_response_stopped():
    resp = client.get("/api/proposal/matrix")
    body = resp.json()
    post_rest = [
        row
        for row in body["rows"]
        if row["trigger_purpose"] == "rest_recommended"
        and row["lifecycle_stage"] == "after_rest_before_restart"
    ]
    assert len(post_rest) == 1
    allowed = post_rest[0]["allowed_service_ids"]
    assert len(allowed) == 5
    assert "call_response_stopped" in allowed
    assert set(allowed) == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }


def test_get_matrix_during_rest_stopped_row_is_empty():
    resp = client.get("/api/proposal/matrix")
    body = resp.json()
    during_rest = [
        row
        for row in body["rows"]
        if row["trigger_purpose"] == "rest_recommended"
        and row["lifecycle_stage"] == "during_rest_stopped"
    ]
    assert len(during_rest) == 1
    assert during_rest[0]["allowed_service_ids"] == []


def test_get_matrix_active_driving_rows_present_for_all_three_purposes():
    resp = client.get("/api/proposal/matrix")
    body = resp.json()
    active_driving_purposes = {
        row["trigger_purpose"]
        for row in body["rows"]
        if row["lifecycle_stage"] == "active_driving_content"
    }
    assert active_driving_purposes == {
        "inattentive_driving_prevention_recovery",
        "route_music",
        "child_passenger_experience",
    }
