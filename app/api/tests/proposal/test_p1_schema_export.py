"""Drift-guard test (T019) — committed P1 schema artifacts must byte-match a
fresh in-memory export.

Mirrors ``tests/proposal/test_schema_export.py`` exactly, but for the new
P1 (013-proposal-p1-screen-foundation) contract schemas exported by
``aica_api.models.proposal.export_schema._p1_schema_artifacts``.

Run from ``app/api/``::

    python -m pytest tests/proposal/test_p1_schema_export.py -q
"""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.models.proposal.export_schema import render_json


def _fresh_opportunity_schema() -> str:
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    return render_json(ProposalOpportunity.model_json_schema())


def _fresh_service_output_schema() -> str:
    from aica_api.models.proposal.service_output import ServiceSelectorOutput
    return render_json(ServiceSelectorOutput.model_json_schema())


def _fresh_matrix_schema() -> str:
    from aica_api.models.proposal.matrix import PurposeStageServiceMatrix
    return render_json(PurposeStageServiceMatrix.model_json_schema())


def _fresh_package_manifest_schema() -> str:
    from aica_api.models.proposal.package_manifest import ProposalPackageManifest
    return render_json(ProposalPackageManifest.model_json_schema())


def _fresh_discrete_event_schema() -> str:
    from aica_api.models.proposal.events import DiscreteEvent
    return render_json(DiscreteEvent.model_json_schema())


def _fresh_journey_state_schema() -> str:
    from aica_api.models.proposal.journey import JourneyState
    return render_json(JourneyState.model_json_schema())


def _fresh_algorithm_evidence_schema() -> str:
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    return render_json(AlgorithmEvidence.model_json_schema())


def _fresh_proposal_run_log_schema() -> str:
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    return render_json(ProposalRunLog.model_json_schema())


_DRIFT_CASES = [
    ("schema/p1_opportunity.schema.json", _fresh_opportunity_schema),
    ("schema/p1_service_output.schema.json", _fresh_service_output_schema),
    ("schema/p1_matrix.schema.json", _fresh_matrix_schema),
    ("schema/p1_package_manifest.schema.json", _fresh_package_manifest_schema),
    ("schema/p1_discrete_event.schema.json", _fresh_discrete_event_schema),
    ("schema/p1_journey_state.schema.json", _fresh_journey_state_schema),
    ("schema/p1_algorithm_evidence.schema.json", _fresh_algorithm_evidence_schema),
    ("schema/p1_proposal_run_log.schema.json", _fresh_proposal_run_log_schema),
]


@pytest.mark.parametrize("rel_path,fresh_fn", _DRIFT_CASES, ids=[c[0] for c in _DRIFT_CASES])
def test_committed_p1_artifact_matches_fresh_export(rel_path: str, fresh_fn) -> None:
    """Committed P1 artifact must byte-match a fresh in-memory render.

    If this test fails, regenerate the artifacts by running:
        python -m aica_api.models.proposal.export_schema
    from the ``app/api/`` directory, then commit the updated files.
    """
    artifact_path = settings.proposal_contracts_dir / rel_path

    assert artifact_path.exists(), (
        f"Artifact not found: {artifact_path}\n"
        "Generate it by running: python -m aica_api.models.proposal.export_schema"
        " (from app/api/)"
    )

    committed_text = artifact_path.read_text(encoding="utf-8")
    fresh_text = fresh_fn()

    assert committed_text == fresh_text, (
        f"Drift detected in committed artifact: {rel_path}\n"
        "The committed file does not match a fresh in-memory export.\n"
        "Regenerate by running: python -m aica_api.models.proposal.export_schema"
        " (from app/api/), then commit the updated files."
    )
