"""Tests for the read-only dataset/catalog provenance models (T003 / P3 foundational).

Covers:
- ``DatasetProvenance.from_manifest`` parses the committed
  ``dataset_manifest.json`` for the frozen P2 dataset.
- Provenance exposes ``dataset_id``/``dataset_version``/``dataset_hash``/``tier``.
- ``CatalogRef`` (dataset_id + version + hash) derives from a provenance.
- Both models are immutable: no field may be reassigned after construction
  (frozen), and neither exposes any edit/mutate method.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.proposal.dataset import CatalogRef, DatasetProvenance, DatasetVersion

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"


@pytest.fixture()
def manifest_data() -> dict:
    manifest_path = settings.proposal_dataset_dir / _DATASET_ID / "dataset_manifest.json"
    with manifest_path.open(encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture()
def provenance(manifest_data: dict) -> DatasetProvenance:
    return DatasetProvenance.from_manifest(manifest_data)


# ---------------------------------------------------------------------------
# Parses the committed dataset_manifest.json
# ---------------------------------------------------------------------------


def test_from_manifest_parses_committed_manifest(provenance: DatasetProvenance, manifest_data: dict):
    assert provenance.dataset_id == manifest_data["dataset_id"]
    assert provenance.dataset_hash == manifest_data["dataset_hash"]
    assert provenance.tier == manifest_data["tier"]
    assert provenance.synthetic_only == manifest_data["synthetic_only"]
    assert provenance.provenance_note == manifest_data["provenance_note"]
    assert provenance.generator_version == manifest_data["generator_version"]


def test_provenance_exposes_dataset_version_sub_versions(
    provenance: DatasetProvenance, manifest_data: dict
):
    assert isinstance(provenance.dataset_version, DatasetVersion)
    assert provenance.dataset_version.schema_version == manifest_data["schema_version"]
    assert (
        provenance.dataset_version.spotify_track_reference_version
        == manifest_data["spotify_track_reference_version"]
    )
    assert (
        provenance.dataset_version.spotify_audio_features_reference_version
        == manifest_data["spotify_audio_features_reference_version"]
    )


def test_from_manifest_ignores_unmapped_manifest_fields(manifest_data: dict):
    """Fields not surfaced by DatasetProvenance (e.g. random_seed) must not break parsing."""
    assert "random_seed" in manifest_data  # sanity: the raw manifest really has extras
    # Constructing succeeds despite the extra keys not being modeled.
    DatasetProvenance.from_manifest(manifest_data)


# ---------------------------------------------------------------------------
# CatalogRef derivation
# ---------------------------------------------------------------------------


def test_to_catalog_ref_derives_matching_ref(provenance: DatasetProvenance):
    ref = provenance.to_catalog_ref()
    assert isinstance(ref, CatalogRef)
    assert ref.dataset_id == provenance.dataset_id
    assert ref.dataset_hash == provenance.dataset_hash
    assert ref.dataset_version == provenance.dataset_version


# ---------------------------------------------------------------------------
# Immutability — no edit/mutate API
# ---------------------------------------------------------------------------


def test_provenance_is_frozen(provenance: DatasetProvenance):
    with pytest.raises(ValidationError):
        provenance.dataset_id = "some-other-id"


def test_catalog_ref_is_frozen(provenance: DatasetProvenance):
    ref = provenance.to_catalog_ref()
    with pytest.raises(ValidationError):
        ref.dataset_id = "some-other-id"


def test_provenance_has_no_edit_method(provenance: DatasetProvenance):
    for attr in ("edit", "update", "mutate", "set"):
        assert not hasattr(provenance, attr)


def test_catalog_ref_has_no_edit_method(provenance: DatasetProvenance):
    ref = provenance.to_catalog_ref()
    for attr in ("edit", "update", "mutate", "set"):
        assert not hasattr(ref, attr)
