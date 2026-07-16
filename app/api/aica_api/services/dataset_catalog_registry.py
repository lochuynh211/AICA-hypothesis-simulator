"""Read-only dataset/catalog registry (T003-T006) — P3 Editable World (feature 014).

Scans ``settings.proposal_dataset_dir`` for frozen P2 datasets: each dataset
is a subdirectory containing ``dataset_manifest.json`` (provenance) and
``catalog.json`` (a JSON list of Song records). Every song is validated
against the frozen ``Song`` model (``Song.model_validate``) — the same model
``mdg.validator.validate_song`` wraps, so validation is identical without
importing ``mdg`` (avoids a cyclic ``aica-api`` <-> ``mdg`` runtime
dependency, since ``mdg`` already depends on ``aica-api`` for ``Song``). A
dataset with even one invalid song is quarantined
into ``list_errors()`` and is NEVER partially available via
``get_catalog``/``get_provenance``/``list_datasets`` (research.md R3,
data-model.md validation rule 4).

Mirrors the scan/index/error structure already established by
``ProposalPackageRegistry`` (``services/proposal_package_registry.py``): scan
a directory, index valid entries, collect errors, never partially use an
invalid entry.

READ-ONLY: this module only reads files under
``proposal_contracts/dataset/**`` — it never writes, moves, or mutates them.
The frozen dataset changes only by re-running the P2 generator.

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``,
``aica_api.config``, ``aica_api.storage.file_store``, and stdlib — never the
trigger ``aica_api.models`` package, and (deliberately) never ``mdg``.

Public API:
  DatasetCatalogRegistry(dataset_dir: Path)
    .list_datasets()       -> list[dict]              — provenance summaries + song_count
    .list_errors()         -> list[dict]               — {dataset_id, message} for quarantined datasets
    .get_catalog(dataset_id) -> list[Song] | None       — validated songs, or None if unknown/quarantined
    .get_provenance(dataset_id) -> DatasetProvenance | None
"""
from __future__ import annotations

import pathlib
from typing import Any

from aica_api.models.proposal.dataset import DatasetProvenance
from aica_api.models.proposal.song_schema import Song
from aica_api.storage.file_store import read_json


class DatasetCatalogRegistry:
    """In-memory, read-only index of frozen datasets under a dataset directory."""

    def __init__(self, dataset_dir: pathlib.Path) -> None:
        self._provenance: dict[str, DatasetProvenance] = {}
        self._catalogs: dict[str, list[Song]] = {}
        self._errors: list[dict[str, Any]] = []
        self._scan(dataset_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_datasets(self) -> list[dict]:
        """Return provenance summaries (+ song_count) for every validly-loaded dataset."""
        return [
            {
                "dataset_id": prov.dataset_id,
                "dataset_version": prov.dataset_version.model_dump(),
                "dataset_hash": prov.dataset_hash,
                "tier": prov.tier,
                "synthetic_only": prov.synthetic_only,
                "song_count": len(self._catalogs[dataset_id]),
            }
            for dataset_id, prov in self._provenance.items()
        ]

    def list_errors(self) -> list[dict]:
        """Return {dataset_id, message} entries for datasets that failed to load."""
        return list(self._errors)

    def get_catalog(self, dataset_id: str) -> list[Song] | None:
        """Return the validated song list for dataset_id, or None if unknown/quarantined."""
        return self._catalogs.get(dataset_id)

    def get_provenance(self, dataset_id: str) -> DatasetProvenance | None:
        """Return the DatasetProvenance for dataset_id, or None if unknown/quarantined."""
        return self._provenance.get(dataset_id)

    # ── Private helpers ────────────────────────────────────────────────────

    def _scan(self, dataset_dir: pathlib.Path) -> None:
        """Scan dataset_dir for subdirectories containing a manifest + catalog."""
        if not dataset_dir.exists():
            return

        for ds_dir in sorted(dataset_dir.iterdir()):
            if not ds_dir.is_dir():
                continue
            manifest_path = ds_dir / "dataset_manifest.json"
            catalog_path = ds_dir / "catalog.json"
            if not manifest_path.exists() or not catalog_path.exists():
                # Not a dataset candidate (e.g. a .gitkeep placeholder) — skip
                # silently, never surfaced as an error here.
                continue

            try:
                manifest_data = read_json(str(manifest_path))
                provenance = DatasetProvenance.from_manifest(manifest_data)
            except Exception as exc:
                self._errors.append(
                    {"dataset_id": ds_dir.name, "message": str(exc)}
                )
                continue

            try:
                catalog_data = read_json(str(catalog_path))
                songs = self._validate_catalog(catalog_data)
            except Exception as exc:
                self._errors.append(
                    {"dataset_id": provenance.dataset_id, "message": str(exc)}
                )
                continue

            self._provenance[provenance.dataset_id] = provenance
            self._catalogs[provenance.dataset_id] = songs

    @staticmethod
    def _validate_catalog(catalog_data: list) -> list[Song]:
        """Validate every song against the frozen Song model.

        Raises on the first invalid song (the caller quarantines the whole
        dataset — never partially returned). ``Song.model_validate`` enforces
        the full frozen-schema contract (synthetic-id prefixes, ``.invalid``
        hosts, numeric ranges, cross-object identity) — the same checks
        ``mdg.validator.validate_song`` performs, since it wraps this very
        model.
        """
        songs: list[Song] = []
        for song_dict in catalog_data:
            songs.append(Song.model_validate(song_dict))
        return songs
