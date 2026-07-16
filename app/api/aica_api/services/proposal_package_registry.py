"""Proposal package registry (T015) — scans packages_dir for proposal manifests.

Mirrors the trigger ``PackageRegistry``'s scan/error structure
(``services/package_registry.py``) but is scoped to *proposal-family*
manifests only — those whose ``package.json`` declares a top-level
``family`` key. Every candidate is validated strictly against
``ProposalPackageManifest``; invalid ones are reported in ``list_errors()``
and NEVER partially used (absent from ``.get()`` / ``list_summaries()``).

A manifest with no ``family`` key at all (a trigger package) is not a
proposal candidate — it is skipped silently, exactly mirroring the trigger
registry's inverse skip (``kind``/``family`` present => trigger registry
skips it; ``family`` absent => this registry skips it).

This module does NOT import ``aica_api.models`` (the trigger package) —
only ``aica_api.models.proposal`` and the shared stdlib-only
``aica_api.storage.file_store`` helper (isolation invariant, T011).

Public API:
  ProposalPackageRegistry(packages_dir: Path)
    .list_summaries() -> list[dict]   — id, family, approach, label, ...
    .list_errors()    -> list[dict]   — {package_dir, error} for invalid manifests
    .get(package_id)  -> ProposalPackageManifest | None
    .list_slots()     -> list[dict]   — the 4 canonical slots + filling package_id
"""
from __future__ import annotations

import pathlib
from typing import Any

from pydantic import ValidationError

from aica_api.models.proposal.package_manifest import (
    ALL_FAMILY_SLOTS,
    ProposalPackageFamilySlot,
    ProposalPackageManifest,
)
from aica_api.storage.file_store import read_json


class ProposalPackageRegistry:
    """In-memory index of all proposal-family packages in a packages directory."""

    def __init__(self, packages_dir: pathlib.Path) -> None:
        self._packages: dict[str, ProposalPackageManifest] = {}
        self._errors: list[dict[str, Any]] = []
        self._scan(packages_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_summaries(self) -> list[dict]:
        """Return lightweight summaries for all successfully loaded packages."""
        return [
            {
                "id": pkg.id,
                "family": pkg.family.value,
                "approach": pkg.approach.value,
                "label": pkg.label.model_dump(),
                "supported_services": [s.value for s in pkg.supported_services],
                "parameters": pkg.parameters,
                "hyperparameters": [hp.model_dump(mode="json") for hp in pkg.hyperparameters],
            }
            for pkg in self._packages.values()
        ]

    def list_errors(self) -> list[dict]:
        """Return error entries for manifests that failed to validate."""
        return list(self._errors)

    def get(self, package_id: str) -> ProposalPackageManifest | None:
        """Return the full ProposalPackageManifest for a package_id, or None."""
        return self._packages.get(package_id)

    def list_slots(self) -> list[dict]:
        """Return the 4 canonical (family, approach) slots and which package
        (if any) fills each.

        A package's slot is a computed property of its own ``family`` +
        ``approach`` fields (``ProposalPackageManifest.slot``) — this method
        never itself decides compatibility; it only reports what each
        manifest's own declared slot already is. A content package can
        therefore never appear under a ``service_selector`` slot key, and
        vice versa.
        """
        by_slot: dict[ProposalPackageFamilySlot, str] = {}
        for pkg in self._packages.values():
            by_slot.setdefault(pkg.slot, pkg.id)

        slots: list[dict] = []
        for family, approach in ALL_FAMILY_SLOTS:
            slot = ProposalPackageFamilySlot.from_family_approach(family, approach)
            slots.append(
                {
                    "family": family.value,
                    "approach": approach.value,
                    "package_id": by_slot.get(slot),
                }
            )
        return slots

    # ── Private helpers ────────────────────────────────────────────────────

    def _scan(self, packages_dir: pathlib.Path) -> None:
        """Scan packages_dir for subdirectories containing a proposal package.json."""
        if not packages_dir.exists():
            return

        for pkg_dir in sorted(packages_dir.iterdir()):
            if not pkg_dir.is_dir():
                continue
            manifest_path = pkg_dir / "package.json"
            if not manifest_path.exists():
                continue
            try:
                data = read_json(str(manifest_path))
            except Exception:
                # Cannot even parse JSON — not confidently a proposal
                # candidate; leave it alone (mirrors trigger registry
                # behavior of only erroring once a manifest is confirmed
                # to be its own kind).
                continue

            # Proposal-family manifests declare a top-level `family` key.
            # Its absence means this is a trigger package (or unrelated) —
            # skip silently, never surfaced as an error here.
            if data.get("family") is None:
                continue

            try:
                manifest = ProposalPackageManifest(**data)
            except (ValidationError, Exception) as exc:
                self._errors.append(
                    {
                        "package_dir": str(pkg_dir),
                        "error": str(exc),
                    }
                )
                continue

            self._packages[manifest.id] = manifest
