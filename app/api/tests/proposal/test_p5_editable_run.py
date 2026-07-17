"""TDD: P5 Unit E T029 (US3) -- editability proven end-to-end through
``POST /api/proposal/runs`` for the REAL transparent service-selector
package (``aica_transparent_service_selector_v1``).

Mirrors ``test_p5_run_integration.py``'s TestClient pattern: same seed world,
same ``_create_run_body`` shape. ``CreateProposalRunBody.hyperparameters`` is
a full REPLACEMENT (not a merge) of the package's manifest hyperparameters
(``routers/proposal.py::create_proposal_run``: ``body.hyperparameters or
{defaults}``) -- every run below therefore posts a full, deep-copied
hyperparameter dict.

Three runs of the SAME seed world/opportunity:

1. Default hyperparameters.
2. A raised route-context weight (`Situation/route_context` share x50) and a
   lowered driver-state weight (`Situation/driver_state` share x0.05) --
   verified empirically to change the top-3 CANDIDATE SET (not merely the
   scores): `quiz` drops out of the top 3 and `music_playlist` enters at
   rank 2 for `seed-night-highway-oshi`.
3. An invariant-breaking edit (`Situation` share -> 0.15, mirroring
   ``test_p5_service_math.py::test_dominance_invariant_violating_custom_weights_still_evaluates``)
   -- still ranks (never blocked), and reports `dominance_not_guaranteed`.
"""
from __future__ import annotations

import copy
import json

from fastapi.testclient import TestClient

import pytest

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_TRANSPARENT_PACKAGE_ID = "aica_transparent_service_selector_v1"


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _load_service_manifest() -> dict:
    from aica_api.config import settings as _settings  # local import, mirrors conftest pattern

    pkg_dir = _settings.packages_dir / _TRANSPARENT_PACKAGE_ID
    return json.loads((pkg_dir / "package.json").read_text(encoding="utf-8"))


def _default_hyperparameters() -> dict:
    manifest = _load_service_manifest()
    return {h["key"]: copy.deepcopy(h["default"]) for h in manifest["hyperparameters"]}


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
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _service_evidence(run_log: dict) -> dict:
    return next(ev for ev in run_log["evidence"] if ev["step"] == "service")


def test_raised_route_context_weight_produces_different_ranking_with_entered_and_resolved_evidence():
    hp_default = _default_hyperparameters()

    hp_raised = copy.deepcopy(hp_default)
    hp_raised["hierarchy_weights"]["Situation"]["subgroups"]["route_context"]["share"] *= 50.0
    hp_raised["hierarchy_weights"]["Situation"]["subgroups"]["driver_state"]["share"] *= 0.05

    resp_default = client.post(
        "/api/proposal/runs", json=_create_run_body(hyperparameters=hp_default)
    )
    resp_raised = client.post(
        "/api/proposal/runs", json=_create_run_body(hyperparameters=hp_raised)
    )
    assert resp_default.status_code == 201, resp_default.text
    assert resp_raised.status_code == 201, resp_raised.text

    run_default = resp_default.json()
    run_raised = resp_raised.json()
    assert run_default["status"] == "service_selected"
    assert run_raised["status"] == "service_selected"

    ev_default = _service_evidence(run_default)
    ev_raised = _service_evidence(run_raised)
    assert ev_default["error"] is None
    assert ev_raised["error"] is None

    ranking_default = [c["candidate_id"] for c in ev_default["output"]["ranked_candidates"]]
    ranking_raised = [c["candidate_id"] for c in ev_raised["output"]["ranked_candidates"]]
    # a materially different config produces a materially different ranking
    # (verified empirically: `quiz` drops out of the top-3, `music_playlist`
    # enters) -- editability is not just cosmetic score churn.
    assert ranking_raised != ranking_default

    # BOTH runs' evidence carry entered + resolved values (doc §12 "the
    # resolved normalized values are recorded beside the customer-entered
    # ones").
    for evidence, hp in ((ev_default, hp_default), (ev_raised, hp_raised)):
        resolved = evidence["output"]["resolved_config_versions"]
        assert resolved["entered_hierarchy_weights"] == hp["hierarchy_weights"]
        assert resolved["entered_purpose_multipliers"] == hp["purpose_multipliers"]
        effective = evidence["output"]["effective_weights"]
        assert sum(effective.values()) == pytest.approx(1.0, abs=1e-9)
        assert evidence["output"]["dominance"] is not None

    # the two configs resolve to genuinely different effective weights.
    assert ev_default["output"]["effective_weights"] != ev_raised["output"]["effective_weights"]


def test_invariant_breaking_weight_edit_still_ranks_and_records_dominance_not_guaranteed():
    hp_broken = _default_hyperparameters()
    # mirrors test_p5_service_math.py::test_dominance_invariant_violating_custom_weights_still_evaluates
    hp_broken["hierarchy_weights"]["Situation"]["share"] = 0.15

    resp = client.post("/api/proposal/runs", json=_create_run_body(hyperparameters=hp_broken))
    assert resp.status_code == 201, resp.text
    run_log = resp.json()

    # never blocked -- the run still reaches a real ranked decision.
    assert run_log["status"] == "service_selected"

    evidence = _service_evidence(run_log)
    assert evidence["error"] is None
    output = evidence["output"]
    assert output["decision_type"] == "ranked_candidates"
    assert output["ranked_candidates"], "an invariant-breaking edit must still produce a real ranking"

    assert output["dominance"]["status"] == "dominance_not_guaranteed"
    for candidate in output["ranked_candidates"]:
        assert candidate["dominance"]["status"] == "dominance_not_guaranteed"

    resolved = output["resolved_config_versions"]
    assert resolved["entered_hierarchy_weights"] == hp_broken["hierarchy_weights"]
