"""Smoke test (T018) — the proposal router is mounted additively; the
existing trigger routers still respond unaffected.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


def test_proposal_router_marker_route_responds():
    response = client.get("/api/proposal/_meta")
    assert response.status_code == 200
    assert response.json() == {"router": "proposal", "status": "ok"}


def test_health_route_still_responds():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_packages_route_still_responds():
    response = client.get("/api/packages")
    assert response.status_code == 200
    body = response.json()
    assert "packages" in body
    assert "errors" in body


def test_scenarios_route_still_responds():
    response = client.get("/api/scenarios")
    assert response.status_code == 200
