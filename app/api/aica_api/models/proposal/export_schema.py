"""JSON-Schema + registry exporter for the P0.5 content contracts.

Run as a module from ``app/api/``::

    python -m aica_api.models.proposal.export_schema

Writes the following files under ``proposal_contracts/`` (resolved via config):

    schema/selector_input.schema.json
    schema/content_output.schema.json
    schema/song.schema.json
    schema/genre_affinity_v1.schema.json
    dispositions/content_feature_dispositions.v1.json

**Determinism guarantee**: all files are serialized with
:func:`render_json` (``json.dumps`` with ``indent=2``, ``sort_keys=True``,
``ensure_ascii=False``, trailing newline).  The drift-guard test
(``tests/proposal/test_schema_export.py``) imports :func:`render_json` and
:func:`export_all` directly and byte-compares committed artifacts against a
fresh in-memory export — so never hand-edit files under ``schema/`` or
``dispositions/``.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Canonical serialisation helper (shared with the drift-guard test)
# ---------------------------------------------------------------------------

def render_json(obj: Any) -> str:
    """Serialize *obj* to a canonical, deterministic JSON string.

    Uses ``sort_keys=True``, ``indent=2``, ``ensure_ascii=False``, and
    appends a single trailing newline so ``git diff`` stays clean.
    This is the ONE formatting function used by both the exporter and the
    drift-guard test — import it from here rather than re-implementing it.
    """
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Artifact builders
# ---------------------------------------------------------------------------

def _schema_artifacts() -> dict[str, Any]:
    """Return a mapping of relative path → JSON-serialisable schema dict."""
    from aica_api.models.proposal.selector_input import SelectorInput
    from aica_api.models.proposal.content_output import CompletePlan
    from aica_api.models.proposal.song_schema import Song
    from aica_api.models.proposal.genre_extension import GenreAffinityV1

    return {
        "schema/selector_input.schema.json": SelectorInput.model_json_schema(),
        "schema/content_output.schema.json": CompletePlan.model_json_schema(),
        "schema/song.schema.json": Song.model_json_schema(),
        "schema/genre_affinity_v1.schema.json": GenreAffinityV1.model_json_schema(),
        **_p1_schema_artifacts(),
    }


def _p1_schema_artifacts() -> dict[str, Any]:
    """P1 (013-proposal-p1-screen-foundation) contract schemas (T019).

    Freezes the top-level contracts worth guarding against drift: the
    opportunity/matrix/package-manifest inputs, the service-selector output,
    and the run-log + its nested shapes (events/journey/evidence).
    """
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.service_output import ServiceSelectorOutput
    from aica_api.models.proposal.matrix import PurposeStageServiceMatrix
    from aica_api.models.proposal.package_manifest import ProposalPackageManifest
    from aica_api.models.proposal.events import DiscreteEvent
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.proposal_run import ProposalRunLog

    return {
        "schema/p1_opportunity.schema.json": ProposalOpportunity.model_json_schema(),
        "schema/p1_service_output.schema.json": ServiceSelectorOutput.model_json_schema(),
        "schema/p1_matrix.schema.json": PurposeStageServiceMatrix.model_json_schema(),
        "schema/p1_package_manifest.schema.json": ProposalPackageManifest.model_json_schema(),
        "schema/p1_discrete_event.schema.json": DiscreteEvent.model_json_schema(),
        "schema/p1_journey_state.schema.json": JourneyState.model_json_schema(),
        "schema/p1_algorithm_evidence.schema.json": AlgorithmEvidence.model_json_schema(),
        "schema/p1_proposal_run_log.schema.json": ProposalRunLog.model_json_schema(),
    }


def _dispositions_artifact() -> tuple[str, Any]:
    """Return (relative path, JSON-serialisable dict) for the registry."""
    from aica_api.models.proposal.dispositions import (
        CONTENT_FEATURE_DISPOSITIONS,
        registry_version,
    )

    payload = {
        "registry_version": registry_version,
        "entries": [entry.model_dump(mode="json") for entry in CONTENT_FEATURE_DISPOSITIONS],
    }
    return "dispositions/content_feature_dispositions.v1.json", payload


# ---------------------------------------------------------------------------
# Public write helper
# ---------------------------------------------------------------------------

def export_all(base_dir: Path) -> None:
    """Write all schema + registry artifacts under *base_dir*.

    Creates the ``schema/`` and ``dispositions/`` sub-directories if absent.
    Existing files are overwritten in-place (content is deterministic, so a
    no-op run leaves the tree unchanged).
    """
    schema_dir = base_dir / "schema"
    dispositions_dir = base_dir / "dispositions"
    schema_dir.mkdir(parents=True, exist_ok=True)
    dispositions_dir.mkdir(parents=True, exist_ok=True)

    # Write JSON-Schema files
    for rel_path, schema_obj in _schema_artifacts().items():
        out_path = base_dir / rel_path
        out_path.write_text(render_json(schema_obj), encoding="utf-8")
        print(f"  wrote {out_path}")

    # Write disposition registry
    rel_path, payload = _dispositions_artifact()
    out_path = base_dir / rel_path
    out_path.write_text(render_json(payload), encoding="utf-8")
    print(f"  wrote {out_path}")


# ---------------------------------------------------------------------------
# __main__ entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from aica_api.config import settings

    base_dir: Path = settings.proposal_contracts_dir
    print(f"Exporting proposal contract artifacts to: {base_dir}")
    export_all(base_dir)
    print("Done.")
