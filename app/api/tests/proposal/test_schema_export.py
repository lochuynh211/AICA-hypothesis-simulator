"""Drift-guard test (T028) — committed schema + registry artifacts must
byte-match a fresh in-memory export.

For each of the five artifact files produced by the exporter, this test:
  1. Reads the committed file from ``proposal_contracts/`` (utf-8).
  2. Produces a fresh in-memory rendering via the canonical
     :func:`~aica_api.models.proposal.export_schema.render_json` function
     (the same function the exporter uses — one canonical formatter shared
     between export and test).
  3. Asserts byte equality; on mismatch the failure message names the file
     and instructs running the exporter to regenerate.

Run from ``app/api/``::

    python -m pytest tests/proposal/test_schema_export.py -q
"""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.models.proposal.export_schema import render_json


# ---------------------------------------------------------------------------
# Helpers to produce fresh in-memory payloads
# (mirror exactly what export_all() does, but without writing files)
# ---------------------------------------------------------------------------

def _fresh_selector_input_schema() -> str:
    from aica_api.models.proposal.selector_input import SelectorInput
    return render_json(SelectorInput.model_json_schema())


def _fresh_content_output_schema() -> str:
    from aica_api.models.proposal.content_output import CompletePlan
    return render_json(CompletePlan.model_json_schema())


def _fresh_song_schema() -> str:
    from aica_api.models.proposal.song_schema import Song
    return render_json(Song.model_json_schema())


def _fresh_genre_affinity_schema() -> str:
    from aica_api.models.proposal.genre_extension import GenreAffinityV1
    return render_json(GenreAffinityV1.model_json_schema())


def _fresh_world_schema() -> str:
    from aica_api.models.proposal.world import World
    return render_json(World.model_json_schema())


def _fresh_dataset_schema() -> str:
    from aica_api.models.proposal.dataset import DatasetProvenance
    return render_json(DatasetProvenance.model_json_schema())


def _fresh_dispositions() -> str:
    from aica_api.models.proposal.dispositions import (
        CONTENT_FEATURE_DISPOSITIONS,
        registry_version,
    )
    payload = {
        "registry_version": registry_version,
        "entries": [entry.model_dump(mode="json") for entry in CONTENT_FEATURE_DISPOSITIONS],
    }
    return render_json(payload)


# ---------------------------------------------------------------------------
# Parametrised drift-guard cases
# ---------------------------------------------------------------------------

# Each entry: (artifact relative path under proposal_contracts/, fresh-render callable)
_DRIFT_CASES = [
    ("schema/selector_input.schema.json", _fresh_selector_input_schema),
    ("schema/content_output.schema.json", _fresh_content_output_schema),
    ("schema/song.schema.json", _fresh_song_schema),
    ("schema/genre_affinity_v1.schema.json", _fresh_genre_affinity_schema),
    # P3 (014-proposal-p3-editable-world) additions -- whole-branch review FIX 3.
    ("schema/world.schema.json", _fresh_world_schema),
    ("schema/dataset.schema.json", _fresh_dataset_schema),
    ("dispositions/content_feature_dispositions.v1.json", _fresh_dispositions),
]


@pytest.mark.parametrize("rel_path,fresh_fn", _DRIFT_CASES, ids=[c[0] for c in _DRIFT_CASES])
def test_committed_artifact_matches_fresh_export(rel_path: str, fresh_fn) -> None:
    """Committed artifact must byte-match a fresh in-memory render.

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
