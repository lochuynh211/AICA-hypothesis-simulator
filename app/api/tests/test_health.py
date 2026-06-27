"""Contract test for GET /api/health — written BEFORE the implementation (TDD)."""

from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


def test_health_status_code():
    response = client.get("/api/health")
    assert response.status_code == 200


def test_health_response_body():
    response = client.get("/api/health")
    assert response.json() == {"status": "ok", "service": "aica-api", "version": "0.0.0"}
