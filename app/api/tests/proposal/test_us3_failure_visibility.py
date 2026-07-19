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
  (d) A syntactically valid ``ServiceSelectorOutput`` whose ``candidate_id``
      falls OUTSIDE the opportunity's frozen ``allowed_service_ids`` (FR-013,
      SC-002) -> an explicit ``algorithm_error`` with category
      ``candidate_outside_allowed_set`` — a buggy/future/LLM package must
      never have an out-of-set candidate silently persisted and shown as a
      legitimate recommendation.

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
# (d) Candidate outside the frozen allowed_service_ids -> algorithm_error
#     (FR-013, SC-002), never a fabricated/persisted proposal.
# ---------------------------------------------------------------------------


def test_candidate_outside_allowed_set_yields_algorithm_error_not_a_fabricated_proposal(tmp_path):
    """A syntactically-valid ServiceSelectorOutput naming a candidate_id NOT
    in the allowed_service_ids passed to dispatch_selector must be rejected
    as an algorithm_error — the core FR-013 boundary this foundation exists
    to enforce."""
    pkg_dir = tmp_path / "throwaway_out_of_set"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_out_of_set"},
        "def evaluate(context):\n"
        "    return {\n"
        "        'decision_type': 'ranked_candidates',\n"
        "        'ranked_candidates': [{\n"
        "            'rank': 1,\n"
        "            'candidate_id': 'music_playlist',\n"
        "            'score': 0.9,\n"
        "            'rationale': ['x'],\n"
        "            'supporting_feature_ids': [],\n"
        "            'opposing_feature_ids': [],\n"
        "            'uncertainty': None,\n"
        "            'feature_contributions': [],\n"
        "        }],\n"
        "        'excluded_candidates': [],\n"
        "        'unused_available_features': [],\n"
        "        'missing_features': [],\n"
        "        'next_package_runtime_state': {},\n"
        "        'algorithm_provenance': {},\n"
        "    }\n",
    )

    # music_playlist is NOT in this allowed set.
    evidence = dispatch_selector(
        pkg,
        {},
        tmp_path,
        matrix_version=_MATRIX_VERSION,
        allowed_service_ids=["live_viewing", "stretch_video"],
    )

    assert evidence.error is not None
    assert evidence.output is None
    assert evidence.error.category == "candidate_outside_allowed_set"
    assert "music_playlist" in evidence.error.message


def test_platform_excluded_candidate_passthrough_is_not_flagged_outside_allowed_set(tmp_path):
    """A candidate that was EXCLUDED by platform eligibility (e.g. oshi_reexperience
    when no oshi is registered) is passed INTO the selector via
    context['excluded_candidates'] and echoed back in the output's
    excluded_candidates. It is outside the (already-narrowed) eligible
    allowed_service_ids BY DESIGN and must NOT trip candidate_outside_allowed_set
    — the safety net only guards against INVENTED candidates. Regression for the
    after_rest_before_restart + oshi-off run erroring instead of proposing."""
    pkg_dir = tmp_path / "throwaway_excluded_passthrough"
    pkg = _write_package(
        pkg_dir,
        {**_MINIMAL_SERVICE_MANIFEST, "id": "throwaway_excluded_passthrough"},
        "def evaluate(context):\n"
        "    return {\n"
        "        'decision_type': 'ranked_candidates',\n"
        "        'ranked_candidates': [{\n"
        "            'rank': 1,\n"
        "            'candidate_id': 'stretch_video',\n"
        "            'score': 0.4,\n"
        "            'rationale': ['x'],\n"
        "            'supporting_feature_ids': [],\n"
        "            'opposing_feature_ids': [],\n"
        "            'uncertainty': None,\n"
        "            'feature_contributions': [],\n"
        "        }],\n"
        "        'excluded_candidates': list(context.get('excluded_candidates') or []),\n"
        "        'unused_available_features': [],\n"
        "        'missing_features': [],\n"
        "        'next_package_runtime_state': {},\n"
        "        'algorithm_provenance': {},\n"
        "    }\n",
    )

    evidence = dispatch_selector(
        pkg,
        {"excluded_candidates": [
            {"candidate_id": "oshi_reexperience", "platform_reason": "missing_required_entity"},
        ]},
        tmp_path,
        matrix_version=_MATRIX_VERSION,
        # The eligible (already-narrowed) allowed set — oshi_reexperience is NOT in it.
        allowed_service_ids=["live_viewing", "stretch_video", "full_karaoke", "call_response_stopped"],
    )

    assert evidence.error is None, evidence.error
    assert evidence.output is not None
    excluded = evidence.output["excluded_candidates"]
    assert [e["candidate_id"] for e in excluded] == ["oshi_reexperience"]


def test_candidate_inside_allowed_set_still_passes_when_allowed_set_is_checked(tmp_path):
    """Sanity check: passing allowed_service_ids doesn't break an honest
    package whose candidates are all in-set (mirrors the real mock's
    behavior swept in test_us3_allowed_set.py)."""
    manifest = ProposalPackageManifest(
        **json.loads((settings.packages_dir / "mock_service_selector_v1" / "package.json").read_text())
    )

    evidence = dispatch_selector(
        manifest,
        {"allowed_service_ids": ["music_playlist", "humming_karaoke"]},
        settings.packages_dir,
        matrix_version=_MATRIX_VERSION,
        allowed_service_ids=["music_playlist", "humming_karaoke"],
    )

    assert evidence.error is None
    assert evidence.output is not None
    for cand in evidence.output["ranked_candidates"]:
        assert cand["candidate_id"] in {"music_playlist", "humming_karaoke"}


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
