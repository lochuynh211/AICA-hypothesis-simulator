"""Read-only base-seed store (T013) — P3 Editable World (feature 014).

Scans a seeds directory (``proposal_contracts/seeds/`` in production) for
committed ``SeedWorld`` JSON files. Mirrors the scan/index/error structure
already established by ``DatasetCatalogRegistry``
(``services/dataset_catalog_registry.py``) and ``ProposalPackageRegistry``
(``services/proposal_package_registry.py``): scan a directory, validate every
candidate strictly against the model, collect errors, and never partially
expose an invalid entry via the public getters.

Seeds are COMMITTED artifacts, promoted one-time from
``generation_workspace/worlds.json`` by ``scripts/promote_seeds.py`` (T014)
and then hand-committed to the repo. This store is READ-ONLY: it only reads
``*.json`` files under the seeds directory and never writes, moves, or
mutates them (research.md R5).

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``,
``aica_api.storage.file_store``, and stdlib — never the trigger
``aica_api.models`` package, and never ``mdg``.

Public API:
  WorldSeedStore(seeds_dir: Path)
    .list_seeds()        -> list[dict]           — {seed_id, label, description} summaries
    .list_errors()        -> list[dict]           — {file, message} for invalid seed files
    .get_seed(seed_id)    -> SeedWorld | None     — the full, complete SeedWorld
"""
from __future__ import annotations

import pathlib
from typing import Any

from aica_api.models.proposal.world import SeedWorld
from aica_api.storage.file_store import read_json


class WorldSeedStore:
    """In-memory, read-only index of committed base-seed worlds."""

    def __init__(self, seeds_dir: pathlib.Path) -> None:
        self._seeds: dict[str, SeedWorld] = {}
        self._errors: list[dict[str, Any]] = []
        self._scan(seeds_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_seeds(self) -> list[dict]:
        """Return {seed_id, label, description} summaries for every valid seed."""
        return [
            {
                "seed_id": seed.seed_id,
                "label": seed.label.model_dump(),
                "description": seed.description.model_dump(),
            }
            for seed in self._seeds.values()
        ]

    def list_errors(self) -> list[dict]:
        """Return {file, message} entries for seed files that failed to validate."""
        return list(self._errors)

    def get_seed(self, seed_id: str) -> SeedWorld | None:
        """Return the full, complete SeedWorld for seed_id, or None if unknown/quarantined."""
        return self._seeds.get(seed_id)

    # ── Private helpers ────────────────────────────────────────────────────

    def _scan(self, seeds_dir: pathlib.Path) -> None:
        """Scan seeds_dir for ``*.json`` base-seed files."""
        if not seeds_dir.exists():
            return

        for path in sorted(seeds_dir.glob("*.json")):
            try:
                data = read_json(str(path))
                seed = SeedWorld.model_validate(data)
            except Exception as exc:
                self._errors.append({"file": path.name, "message": str(exc)})
                continue

            self._seeds[seed.seed_id] = seed
