"""US3 trust invariant — failure visibility (T039). FR-019/020/021, SC-008.

Three distinct "never fabricate a proposal" outcomes, each with a different
meaning and none of them a substitute for the others:

  (a) A raising / structurally-invalid selector package -> an explicit
      ``algorithm_error`` (AlgorithmEvidence.error set, .output is None) —
      NEVER a fabricated ranked_candidates/plan. Exercised directly against
      ``dispatch_selector`` with tiny throwaway packages (one per internal
      failure category: raising evaluate(), a non-dict return, a
      schema-invalid dict return, and a missing entrypoint file).
  (b) An empty allowed/eligible candidate set -> the algorithm's own honest
      ``no_proposal`` decision_type — a VALID non-error outcome, distinct
      from (a): evidence.error stays None, evidence.output is a real
      ServiceSelectorOutput with an empty ranked_candidates list.
  (c) A syntactically valid but out-of-scope (unsupported) service request
      -> the content mock's own ``unsupported_service`` decision_type — again
      a valid non-error outcome, never a fabricated plan for a service the
      package cannot honestly support.

(a)/(b)/(c) are exercised directly against ``dispatch_selector`` (the
dispatch boundary itself); the endpoint-level counterpart is confirmed by
asserting that a REJECTED (c)-shaped request at the real
``POST .../select-service`` endpoint (the router's own pre-slot-check, see
``test_ep_select_service.py``) never contaminates the persisted run: the
run's evidence/status are left exactly as STEP 1 left them.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.proposal.package_manifest import ProposalPackageManifest
from aica_api.services.proposal_selector import dispatch_selector

client = TestClient(app)

_MATRIX_VERSION = "test-v1"

_MINIMAL_SERVICE_MANIFEST = {
    "id": "throwaway_service_selector",
    "version": "1.0.0",
    "label": {"ja": "x", "en": "x"},
    "kind": "service_selector",
    "family": "service_selector",
    "approach": "transparent",
    "contract_version": "1.0.0",
    "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
    "supported_services": [],
    "parameters": {},
    "hyperparameters": [],
}


def _write_package(pkg_dir, manifest: dict, algorithm_source: str | None) -> ProposalPackageManifest:
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
    if algorithm_source is not None:
        (pkg_dir / "algorithm.py").write_text(algorithm_source, encoding="utf-8")
    return ProposalPackageManifest(**manifest)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    yield


# ---------------------------------------------------------------------------
# (a) Raising / structurally-invalid selectors -> algorithm_error, never a
#     fabricated proposal.
# ---------------------------------------------------------------------------


def test_raising_evaluate_yields_algorithm_error_not_a_fabricated_proposal(tmp_path):
    pkg_dir = tmp_path / "throwaway_raising"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_raising"},
        "def evaluate(context):\n    raise RuntimeError('deliberate failure for T039')\n",
    )

    evidence = dispatch_selector(pkg, {}, tmp_path, matrix_version=_MATRIX_VERSION)

    assert evidence.error is not None
    assert evidence.output is None
    assert evidence.error.category == "algorithm_exception"
    assert "deliberate failure for T039" in evidence.error.message


def test_non_dict_return_yields_algorithm_error_not_a_fabricated_proposal(tmp_path):
    pkg_dir = tmp_path / "throwaway_non_dict"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_non_dict"},
        "def evaluate(context):\n    return ['not', 'a', 'dict']\n",
    )

    evidence = dispatch_selector(pkg, {}, tmp_path, matrix_version=_MATRIX_VERSION)

    assert evidence.error is not None
    assert evidence.output is None
    assert evidence.error.category == "invalid_result_shape"


def test_schema_invalid_dict_yields_algorithm_error_not_a_fabricated_proposal(tmp_path):
    """A dict that IS a dict but is missing required ServiceSelectorOutput
    fields must still surface as an explicit error, never a partially-built
    fabricated proposal."""
    pkg_dir = tmp_path / "throwaway_bad_shape"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_bad_shape"},
        "def evaluate(context):\n    return {'decision_type': 'ranked_candidates'}\n",
    )

    evidence = dispatch_selector(pkg, {}, tmp_path, matrix_version=_MATRIX_VERSION)

    assert evidence.error is not None
    assert evidence.output is None
    assert evidence.error.category == "invalid_result_shape"


def test_missing_entrypoint_yields_algorithm_error_not_a_fabricated_proposal(tmp_path):
    pkg_dir = tmp_path / "throwaway_missing_entrypoint"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_missing_entrypoint"},
        None,  # no algorithm.py written at all
    )

    evidence = dispatch_selector(pkg, {}, tmp_path, matrix_version=_MATRIX_VERSION)

    assert evidence.error is not None
    assert evidence.output is None
    assert evidence.error.category == "missing_evaluate"


# ---------------------------------------------------------------------------
# (b) Empty allowed set -> the real mock's own honest no_proposal, a VALID
#     non-error outcome (distinct from (a)).
# ---------------------------------------------------------------------------


def test_empty_allowed_set_yields_no_proposal_not_an_error():
    reg_pkg = ProposalPackageManifest(
        **json.loads((settings.packages_dir / "mock_service_selector_v1" / "package.json").read_text())
    )

    evidence = dispatch_selector(
        reg_pkg,
        {"allowed_service_ids": []},
        settings.packages_dir,
        matrix_version=_MATRIX_VERSION,
    )

    assert evidence.error is None
    assert evidence.output is not None
    assert evidence.output["decision_type"] == "no_proposal"
    assert evidence.output["ranked_candidates"] == []


# ---------------------------------------------------------------------------
# (c) Unsupported service -> the content mock's own honest
#     unsupported_service, a VALID non-error outcome (never a fabricated plan).
# ---------------------------------------------------------------------------


def test_unsupported_service_yields_unsupported_service_not_an_error():
    reg_pkg = ProposalPackageManifest(
        **json.loads((settings.packages_dir / "mock_content_selector_v1" / "package.json").read_text())
    )

    evidence = dispatch_selector(
        reg_pkg,
        {"selected_service_id": "quiz"},  # quiz is not in supported_services
        settings.packages_dir,
        matrix_version=_MATRIX_VERSION,
    )

    assert evidence.error is None
    assert evidence.output is not None
    assert evidence.output["decision_type"] == "unsupported_service"
    assert evidence.output["ordered_items"] == []
    assert evidence.output["returned_item_count"] == 0


# ---------------------------------------------------------------------------
# Endpoint-level: a rejected (unsupported-service) select-service attempt
# never contaminates the persisted run.
# ---------------------------------------------------------------------------


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def test_rejected_select_service_never_contaminates_persisted_run():
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]
    assert created["status"] == "service_selected"
    assert len(created["evidence"]) == 1

    # live_viewing IS in the allowed set, but the mock content package does
    # not declare it in supported_services -> the router's own pre-check
    # rejects it (422) BEFORE dispatch_selector is ever called.
    assert "live_viewing" in created["opportunity"]["allowed_service_ids"]
    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "live_viewing"},
    )
    assert resp.status_code == 422

    # The persisted run is untouched: still exactly what STEP 1 left it.
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened == created
    assert reopened["status"] == "service_selected"
    assert len(reopened["evidence"]) == 1
