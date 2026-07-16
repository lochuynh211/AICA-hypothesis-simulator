"""Tests for DatasetCatalogRegistry (T005 / P3 foundational).

Mirrors the scan/error/quarantine structure already proven for
``ProposalPackageRegistry`` (see ``test_proposal_registry.py``): a valid
dataset loads with provenance + every song validated; an invalid dataset
(one bad song) is quarantined into the errors list and NEVER partially
returned by ``get_catalog``/``list_datasets``.

Also asserts the read-only invariant: loading a dataset never writes, moves,
or mutates the frozen files under ``proposal_contracts/dataset/`` (research.md
R3) — the manifest and catalog bytes are identical before/after a full scan.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.proposal.dataset import DatasetProvenance
from aica_api.models.proposal.song_schema import Song
from aica_api.services.dataset_catalog_registry import DatasetCatalogRegistry

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_REAL_DATASET_DIR = settings.proposal_dataset_dir


@pytest.fixture()
def real_registry() -> DatasetCatalogRegistry:
    return DatasetCatalogRegistry(_REAL_DATASET_DIR)


def _real_manifest_data() -> dict:
    manifest_path = _REAL_DATASET_DIR / _DATASET_ID / "dataset_manifest.json"
    with manifest_path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _real_catalog_data() -> list:
    catalog_path = _REAL_DATASET_DIR / _DATASET_ID / "catalog.json"
    with catalog_path.open(encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Loads the frozen P2 dataset by id
# ---------------------------------------------------------------------------


def test_real_dataset_loads_with_no_errors(real_registry: DatasetCatalogRegistry):
    assert real_registry.list_errors() == []


def test_list_datasets_includes_the_frozen_dataset(real_registry: DatasetCatalogRegistry):
    summaries = real_registry.list_datasets()
    ids = {s["dataset_id"] for s in summaries}
    assert _DATASET_ID in ids
    summary = next(s for s in summaries if s["dataset_id"] == _DATASET_ID)
    assert summary["song_count"] == len(_real_catalog_data())
    assert summary["tier"] == "demonstration"
    assert summary["synthetic_only"] is False


def test_get_provenance_matches_manifest(real_registry: DatasetCatalogRegistry):
    provenance = real_registry.get_provenance(_DATASET_ID)
    assert isinstance(provenance, DatasetProvenance)
    manifest_data = _real_manifest_data()
    assert provenance.dataset_id == manifest_data["dataset_id"]
    assert provenance.dataset_hash == manifest_data["dataset_hash"]


def test_get_catalog_returns_every_validated_song(real_registry: DatasetCatalogRegistry):
    catalog = real_registry.get_catalog(_DATASET_ID)
    catalog_data = _real_catalog_data()
    assert catalog is not None
    assert len(catalog) == len(catalog_data)
    assert all(isinstance(song, Song) for song in catalog)


def test_unknown_dataset_id_returns_none(real_registry: DatasetCatalogRegistry):
    assert real_registry.get_catalog("no-such-dataset") is None
    assert real_registry.get_provenance("no-such-dataset") is None


# ---------------------------------------------------------------------------
# Read-only invariant — frozen files are byte-unchanged after load
# ---------------------------------------------------------------------------


def test_frozen_files_byte_unchanged_after_load():
    manifest_path = _REAL_DATASET_DIR / _DATASET_ID / "dataset_manifest.json"
    catalog_path = _REAL_DATASET_DIR / _DATASET_ID / "catalog.json"
    manifest_before = manifest_path.read_bytes()
    catalog_before = catalog_path.read_bytes()

    DatasetCatalogRegistry(_REAL_DATASET_DIR)

    assert manifest_path.read_bytes() == manifest_before
    assert catalog_path.read_bytes() == catalog_before


# ---------------------------------------------------------------------------
# Quarantine — an invalid dataset (one bad song) is never partially used
# ---------------------------------------------------------------------------


def _write_dataset(tmp_path: pathlib.Path, dataset_id: str, manifest: dict, catalog: list) -> pathlib.Path:
    ds_dir = tmp_path / dataset_id
    ds_dir.mkdir(parents=True)
    (ds_dir / "dataset_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (ds_dir / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    return ds_dir


@pytest.fixture()
def valid_manifest() -> dict:
    return _real_manifest_data()


@pytest.fixture()
def valid_catalog() -> list:
    # A small, real, valid slice — cheap to copy/mutate per test.
    return copy.deepcopy(_real_catalog_data()[:3])


def test_invalid_song_quarantines_whole_dataset(
    tmp_path: pathlib.Path, valid_manifest: dict, valid_catalog: list
):
    broken_catalog = copy.deepcopy(valid_catalog)
    # Corrupt one song: cross-object identity mismatch (schema-invalid).
    broken_catalog[1]["spotify_track"]["id"] = "synthetic-track-DIFFERENT"

    dataset_id = valid_manifest["dataset_id"]
    _write_dataset(tmp_path, dataset_id, valid_manifest, broken_catalog)

    registry = DatasetCatalogRegistry(tmp_path)

    assert registry.get_catalog(dataset_id) is None
    assert registry.get_provenance(dataset_id) is None
    assert dataset_id not in {s["dataset_id"] for s in registry.list_datasets()}

    errors = registry.list_errors()
    assert len(errors) == 1
    assert errors[0]["dataset_id"] == dataset_id
    assert "message" in errors[0]


def test_valid_custom_dataset_loads_cleanly(
    tmp_path: pathlib.Path, valid_manifest: dict, valid_catalog: list
):
    dataset_id = valid_manifest["dataset_id"]
    _write_dataset(tmp_path, dataset_id, valid_manifest, valid_catalog)

    registry = DatasetCatalogRegistry(tmp_path)

    assert registry.list_errors() == []
    catalog = registry.get_catalog(dataset_id)
    assert catalog is not None
    assert len(catalog) == len(valid_catalog)


def test_missing_manifest_or_catalog_dir_skipped_silently(tmp_path: pathlib.Path):
    # A directory with no dataset_manifest.json / catalog.json (e.g. a
    # .gitkeep placeholder) is not a dataset candidate — skip, no error.
    (tmp_path / ".gitkeep").write_text("", encoding="utf-8")
    registry = DatasetCatalogRegistry(tmp_path)
    assert registry.list_datasets() == []
    assert registry.list_errors() == []


def test_nonexistent_dataset_dir_yields_empty_registry(tmp_path: pathlib.Path):
    registry = DatasetCatalogRegistry(tmp_path / "does-not-exist")
    assert registry.list_datasets() == []
    assert registry.list_errors() == []
