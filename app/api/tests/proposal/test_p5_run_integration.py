"""TDD: P5 Unit C T019 -- end-to-end run integration for the REAL transparent
service-selector package (``aica_transparent_service_selector_v1``).

Drives a typed-World run through ``POST /api/proposal/runs`` (mirrors
``test_p5_context_fields.py``'s ``_load_seed_world_dict`` pattern) using the
committed ``seed-night-highway-oshi`` seed with ``service_package_id`` set to
the real transparent package, and asserts the persisted ``ProposalRunLog``:

  - the STEP-1 (``step == "service"``) evidence's ``output`` carries REAL
    ``ranked_candidates`` (a real float ``score``, drawn only from the
    opportunity's eligible ``allowed_service_ids``, at most 3 entries, ranks
    contiguous from 1);
  - a ``SERVICE_SELECTED`` discrete event is emitted;
  - ``status == "service_selected"``.

Deviation note (see Unit C report): the task brief referred to this as
"call select-service with service_package_id=...", but in this codebase the
service-selector package is dispatched at run CREATION time
(``POST /api/proposal/runs``, see ``routers/proposal.py::create_proposal_run``)
-- ``POST .../select-service`` (STEP 2) is the CONTENT-selector step and takes
no ``service_package_id`` at all (see ``SelectServiceBody``). This test
therefore exercises ``POST /api/proposal/runs`` directly, which is where the
real behavior T019 describes actually lives.

The error path forces an ``_ConfigError`` inside the real scorer
(``packages/aica_transparent_service_selector_v1/algorithm.py``) by supplying
a hyperparameters override that omits a required key (``hierarchy_weights``).
Per the package's own docstring, ``dispatch_selector`` converts ANY raised
exception into an ``AlgorithmEvidence.error`` with category
``"algorithm_exception"`` (not a literal ``"invalid_configuration"`` string --
that's the algorithm doc's SS13 semantic name, not the dispatch-layer
category) -- and NEVER a fabricated ranking (Constitution Principle V).
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_TRANSPARENT_PACKAGE_ID = "aica_transparent_service_selector_v1"


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _create_run_body(**overrides) -> dict:
    body = {
        "world": _load_seed_world_dict(),
        "service_package_id": _TRANSPARENT_PACKAGE_ID,
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    # POST /api/proposal/runs auto-persists to AICA_PROPOSAL_RUNS_DIR -- read
    # via aica_api.config.settings at call time (not module-import time), so
    # a plain monkeypatch.setenv (used consistently across the P5 suite) is
    # sufficient isolation here.
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


# ---------------------------------------------------------------------------
# Success path -- real ranking, eligible-only, contiguous ranks, SERVICE_SELECTED
# ---------------------------------------------------------------------------


def _service_evidence(run_log: dict) -> dict:
    return next(ev for ev in run_log["evidence"] if ev["step"] == "service")


def test_real_transparent_ranking_end_to_end():
    resp = client.post("/api/proposal/runs", json=_create_run_body())
    assert resp.status_code == 201, resp.text
    run_log = resp.json()

    assert run_log["status"] == "service_selected"
    assert run_log["service_package_id"] == _TRANSPARENT_PACKAGE_ID

    evidence = _service_evidence(run_log)
    assert evidence["package_id"] == _TRANSPARENT_PACKAGE_ID
    assert evidence["error"] is None
    assert evidence["output"] is not None

    output = evidence["output"]
    assert output["decision_type"] == "ranked_candidates"
    ranked = output["ranked_candidates"]
    assert ranked, "expected at least one ranked candidate for this world"

    allowed = set(run_log["opportunity"]["allowed_service_ids"])
    assert allowed, "the seed's opportunity must have a non-empty allowed set"

    assert len(ranked) <= 3

    ranks_seen = []
    for candidate in ranked:
        # Real (non-fabricated) score -- a float, not a mock placeholder.
        assert isinstance(candidate["score"], float)
        assert candidate["candidate_id"] in allowed
        ranks_seen.append(candidate["rank"])

    assert ranks_seen == list(range(1, len(ranked) + 1))


def test_real_transparent_ranking_service_selected_event_emitted():
    resp = client.post("/api/proposal/runs", json=_create_run_body())
    assert resp.status_code == 201, resp.text
    run_log = resp.json()

    event_types = [e["event_type"] for e in run_log["events"]]
    assert "SERVICE_SELECTED" in event_types

    selected_event = next(e for e in run_log["events"] if e["event_type"] == "SERVICE_SELECTED")
    top_candidate_id = _service_evidence(run_log)["output"]["ranked_candidates"][0]["candidate_id"]
    assert selected_event["payload"]["selected_service_id"] == top_candidate_id


def test_determinism_same_seed_same_ranking():
    resp1 = client.post("/api/proposal/runs", json=_create_run_body())
    resp2 = client.post("/api/proposal/runs", json=_create_run_body())
    assert resp1.status_code == 201 and resp2.status_code == 201

    out1 = _service_evidence(resp1.json())["output"]
    out2 = _service_evidence(resp2.json())["output"]
    assert out1 == out2


# ---------------------------------------------------------------------------
# Error path -- invalid hyperparameter override -> algorithm error, no
# fabricated ranking (Constitution Principle V).
# ---------------------------------------------------------------------------


def test_invalid_hyperparameter_override_yields_algorithm_error_not_fabricated_ranking():
    # Omits every required hyperparameter key except gamma_drowsiness (e.g.
    # hierarchy_weights) -- the real scorer's direct-index hyperparameter
    # reader (`_hp`) raises `_ConfigError("missing hyperparameter '...'")`
    # for the first key it needs that isn't present.
    resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(hyperparameters={"gamma_drowsiness": 1.0}),
    )
    assert resp.status_code == 201, resp.text
    run_log = resp.json()

    assert run_log["status"] == "error"

    evidence = _service_evidence(run_log)
    assert evidence["error"] is not None
    assert evidence["error"]["category"] == "algorithm_exception"
    assert "hyperparameter" in evidence["error"]["message"]
    assert evidence["output"] is None

    event_types = [e["event_type"] for e in run_log["events"]]
    assert "ALGORITHM_ERROR" in event_types
    assert "SERVICE_SELECTED" not in event_types

    # No fabricated ranking anywhere in the run log's service evidence.
    assert evidence["output"] is None
