"""TDD: GET /api/proposal/packages — T021.

Covers:
  - The 4 canonical (family, approach) slots, with the two mock packages
    filling the transparent slots and the two constrained_llm slots null.
  - The loaded package summaries (id/family/approach/label/supported_services/
    parameters/hyperparameters).
  - The errors list is present (even if empty against the real packages_dir).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


def test_get_packages_returns_four_slots_with_mocks_in_transparent_slots():
    resp = client.get("/api/proposal/packages")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["slots"]) == 4

    by_key = {(s["family"], s["approach"]): s["package_id"] for s in body["slots"]}
    assert by_key[("service_selector", "transparent")] == "mock_service_selector_v1"
    assert by_key[("content_selector", "transparent")] == "mock_content_selector_v1"
    assert by_key[("service_selector", "constrained_llm")] is None
    assert by_key[("content_selector", "constrained_llm")] is None


def test_get_packages_lists_loaded_package_summaries():
    resp = client.get("/api/proposal/packages")
    body = resp.json()
    ids = {p["id"] for p in body["packages"]}
    assert {"mock_service_selector_v1", "mock_content_selector_v1"} <= ids

    for pkg in body["packages"]:
        assert "family" in pkg
        assert "approach" in pkg
        assert "label" in pkg and set(pkg["label"].keys()) == {"ja", "en"}
        assert "supported_services" in pkg
        assert "parameters" in pkg
        assert "hyperparameters" in pkg

    content_pkg = next(p for p in body["packages"] if p["id"] == "mock_content_selector_v1")
    assert set(content_pkg["supported_services"]) == {
        "music_playlist",
        "humming_karaoke",
        "full_karaoke",
    }


def test_get_packages_errors_list_present_and_a_list():
    resp = client.get("/api/proposal/packages")
    body = resp.json()
    assert "errors" in body
    assert isinstance(body["errors"], list)
