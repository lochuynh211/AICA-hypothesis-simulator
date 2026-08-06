"""POST /api/proposal/nano-test/results — the in-browser Nano eval sink (feature 019)."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def test_persists_posted_results(tmp_path):
    body = {
        "session_label": "nano-2026-07-18",
        "meta": {"nano_available": True, "user_agent": "Chrome"},
        "results": [
            {"preset": "preset-oshi-superfan", "service": {"ja": "推し", "en": "oshi"},
             "content": {"ja": "推し一致", "en": "oshi match"}},
        ],
    }
    r = client.post("/api/proposal/nano-test/results", json=body)
    assert r.status_code == 200
    assert r.json()["count"] == 1

    stored = json.load(open(tmp_path / "nano-test" / "results.json", encoding="utf-8"))
    assert stored["count"] == 1
    assert stored["session_label"] == "nano-2026-07-18"
    assert stored["meta"]["nano_available"] is True
    assert stored["results"][0]["preset"] == "preset-oshi-superfan"
    assert stored["received_at"]


def test_latest_batch_overwrites(tmp_path):
    client.post("/api/proposal/nano-test/results", json={"results": [{"preset": "a"}]})
    client.post("/api/proposal/nano-test/results", json={"results": [{"preset": "b"}, {"preset": "c"}]})
    stored = json.load(open(tmp_path / "nano-test" / "results.json", encoding="utf-8"))
    assert stored["count"] == 2
    assert [x["preset"] for x in stored["results"]] == ["b", "c"]


def test_rejects_oversized_batch():
    r = client.post("/api/proposal/nano-test/results", json={"results": [{"i": i} for i in range(5001)]})
    assert r.status_code == 413
