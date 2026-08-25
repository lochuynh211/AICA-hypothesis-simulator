"""TDD: POST /api/merged-runs/explain-trigger (feature 025, slice S6 — the
TRIGGER rank-1 rationale).

Mirrors `tests/proposal/test_ep_explain.py`'s coverage shape (browser
build-only / backend-with-template-fallback / validation errors) for the
service/content explain endpoints, and `test_merged_quickview.py`'s pattern
of sourcing a REAL fire from `POST /api/merged-runs/quickview` rather than
hand-building one — this endpoint receives exactly that shape inline.

Ollama is never called live: `ollama_client.generate` is monkeypatched to
raise `OllamaError`, mirroring the sibling explain tests' own convention —
the un-mocked transport (`ollama_client._urlopen`) refuses any live network
call during a pytest run by design (see `services/ollama_client.py`).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services import ollama_client
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"

_REST_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
# The 40kph commuter route (not the 60kph uc01_fatigue_recovery_v0_1) so the
# vehicle is still well before its 60km rest facility when the NRI score
# reaches the fire band — a genuinely actionable spot ahead, hence a real
# rest_required fire. On the 60kph route the score only crosses the threshold
# AFTER the sole 60km spot is behind the driver, so nothing actionable remains
# and rest_required correctly does NOT fire (the sentinel-fires bug that used
# to mask this was fixed by the forecast-rest feature).
_REST_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_commuter_v0_1"

_MONOTONY_TRIGGER_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
_MONOTONY_TRIGGER_SCENARIO_ID = "uc02_monotony_v0_1"


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    """Never let these tests write into real runs/proposal_runs/merged_runs —
    this endpoint is non-persisting anyway, but keeps the fixture-loading
    quickview call (used to source a real fire) fully isolated too."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture()
def base_world_dict() -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _quickview_body(world: dict, **overrides) -> dict:
    body = {
        "package_id": _REST_TRIGGER_PACKAGE_ID,
        "scenario_id": _REST_TRIGGER_SCENARIO_ID,
        "run_seed": 42,
        "world": world,
        "service_package_id": _SERVICE_PACKAGE_ID,
        "content_package_id": _CONTENT_PACKAGE_ID,
        "run_seed_proposal": "seed-1",
    }
    body.update(overrides)
    return body


def _rest_fire(base_world_dict: dict) -> dict:
    """A REAL rest_required fire, sourced the same way an actual reviewer
    would get one — the quickview endpoint — not hand-built."""
    resp = client.post("/api/merged-runs/quickview", json=_quickview_body(base_world_dict))
    assert resp.status_code == 200, resp.text
    fires = [f for f in resp.json()["fires"] if f["category"] == "rest_required"]
    assert fires, f"expected a rest_required fire; fires={resp.json()['fires']}"
    return fires[0]


def _monotony_fire(base_world_dict: dict) -> dict:
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(
            base_world_dict,
            package_id=_MONOTONY_TRIGGER_PACKAGE_ID,
            scenario_id=_MONOTONY_TRIGGER_SCENARIO_ID,
            run_seed=7,
        ),
    )
    assert resp.status_code == 200, resp.text
    fires = resp.json()["fires"]
    assert fires, "expected at least one fire"
    return fires[0]


def test_browser_provider_returns_prompt_and_empty_rationale(base_world_dict):
    fire = _rest_fire(base_world_dict)

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "browser"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["step"] == "trigger"
    assert data["target_id"] == "rest_required"
    assert data["provider_used"] == "browser"
    assert data["rationale"] == []
    assert data["prompt"]["messages"], "browser path must return a grounded prompt"
    assert data["prompt"]["messages"][0]["role"] == "system"
    assert data["prompt"]["messages"][1]["role"] == "user"


def test_template_provider_returns_the_deterministic_sentence_without_calling_ollama(base_world_dict, monkeypatch):
    """feature 025, slice S11 — `provider='template'` is how the frontend
    reaches the trigger sentence when the reviewer's explanation provider is
    'off': the deterministic `trigger_explanation.template()` sentence,
    directly, with NO Ollama call at all (not even the CI-safe
    unreachable-and-fall-back path the 'backend' provider exercises above).
    Asserted by making `ollama_client.generate` blow up if it is ever
    invoked — a passing test here proves the client was never reached, not
    merely that CI happens to have no live Ollama."""
    fire = _rest_fire(base_world_dict)

    def must_not_be_called(messages, **kw):
        raise AssertionError("ollama_client.generate must not be called for provider='template'")

    monkeypatch.setattr(ollama_client, "generate", must_not_be_called)

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "template"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["step"] == "trigger"
    assert data["target_id"] == "rest_required"
    assert data["requested_provider"] == "template"
    assert data["provider_used"] == "template"
    assert data["fell_back"] is False
    assert data["error"] is None
    # A real, non-empty bilingual [ja, en] pair — never blank.
    assert len(data["rationale"]) == 2
    assert all(s.strip() for s in data["rationale"])


def test_backend_provider_falls_back_to_template_when_ollama_is_unreachable(base_world_dict, monkeypatch):
    """The normal case in CI: no live Ollama, so this asserts the honest
    template fallback — never a live-model generation."""
    fire = _rest_fire(base_world_dict)

    def boom(messages, **kw):
        raise ollama_client.OllamaError("unreachable", "no ollama")

    monkeypatch.setattr(ollama_client, "generate", boom)

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "backend"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["step"] == "trigger"
    assert data["target_id"] == "rest_required"
    assert data["provider_used"] == "template"
    assert data["fell_back"] is True
    assert data["error"] == "unreachable"
    # A real, non-empty [ja, en] pair — never blank, never a disguised failure.
    assert len(data["rationale"]) == 2
    assert all(s.strip() for s in data["rationale"])


def test_explicit_category_overrides_the_fires_own(base_world_dict, monkeypatch):
    """`category` selects which chain is explained; both NRI categories are
    present on any fire (NRI always emits BOTH — see
    packages/nri_fatigue_score_v1/algorithm.py), so a rest fire can still be
    explained from its monotony_prevention chain on request."""
    fire = _rest_fire(base_world_dict)
    assert "monotony_prevention" in fire["feature_contributions"]

    monkeypatch.setattr(
        ollama_client, "generate", lambda messages, **kw: (_ for _ in ()).throw(ollama_client.OllamaError("unreachable", "x"))
    )

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "category": "monotony_prevention", "provider": "backend"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["target_id"] == "monotony_prevention"


def test_defaults_to_the_highest_scoring_chain_when_the_fire_carries_no_category(base_world_dict, monkeypatch):
    fire = _rest_fire(base_world_dict)
    fire = {**fire, "category": None}

    monkeypatch.setattr(
        ollama_client, "generate", lambda messages, **kw: (_ for _ in ()).throw(ollama_client.OllamaError("unreachable", "x"))
    )

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "backend"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # NRI publishes ONE score banded by TWO thresholds -- both categories on
    # this fire carry the IDENTICAL score (see
    # packages/nri_fatigue_score_v1/algorithm.py's `_build_feature_contributions`
    # docstring), so `resolve_category`'s highest-scoring-chain fallback has
    # no real "higher" to find here: which of the two tied keys `max()`
    # picks is a dict-iteration-order detail of the fallback, not a
    # guarantee that rest_required is somehow the bigger number. This
    # assertion can only pin "one of the two fired" -- not which one.
    assert data["target_id"] in ("rest_required", "monotony_prevention")


def test_422_on_a_malformed_fire():
    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": {"not_a_fire_point": True}, "provider": "browser"},
    )
    assert resp.status_code == 422, resp.text


def test_422_on_an_unknown_category(base_world_dict):
    fire = _rest_fire(base_world_dict)
    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "category": "not_a_real_category", "provider": "browser"},
    )
    assert resp.status_code == 422, resp.text


def test_monotony_fire_from_the_hybrid_package_also_explains(base_world_dict, monkeypatch):
    fire = _monotony_fire(base_world_dict)

    monkeypatch.setattr(
        ollama_client, "generate", lambda messages, **kw: (_ for _ in ()).throw(ollama_client.OllamaError("unreachable", "x"))
    )

    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "backend"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["step"] == "trigger"
    assert data["provider_used"] == "template"
    assert len(data["rationale"]) == 2
    assert all(s.strip() for s in data["rationale"])


def test_nothing_is_persisted(base_world_dict, tmp_path):
    fire = _rest_fire(base_world_dict)
    resp = client.post(
        "/api/merged-runs/explain-trigger",
        json={"fire": fire, "provider": "browser"},
    )
    assert resp.status_code == 200, resp.text
    assert list((tmp_path / "proposal_runs").glob("*.json")) == [] if (tmp_path / "proposal_runs").exists() else True
    assert list((tmp_path / "merged_runs").glob("*.json")) == [] if (tmp_path / "merged_runs").exists() else True
