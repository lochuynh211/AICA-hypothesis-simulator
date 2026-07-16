"""Package registry (T019) — scans packages_dir and loads PackageManifests.

Scans the packages directory for subdirectories each containing a
``package.json`` file.  Valid manifests are loaded and indexed by id;
invalid ones are reported in an errors list and never partially used.

Public API:
  PackageRegistry(packages_dir: Path)
    .list_summaries() -> list[dict]   — id, version, label, compatible_scenario_types
    .list_errors()    -> list[dict]   — {package_dir, error} for invalid packages
    .get(package_id)  -> PackageManifest | None
    .is_compatible(package, scenario) -> bool
"""

from __future__ import annotations

import pathlib
from typing import Any

from pydantic import ValidationError

from aica_api.models.package import PackageManifest
from aica_api.models.scenario import ScenarioDef
from aica_api.storage.file_store import read_json


class PackageRegistry:
    """In-memory index of all available packages in a packages directory."""

    def __init__(self, packages_dir: pathlib.Path) -> None:
        self._packages: dict[str, PackageManifest] = {}
        self._errors: list[dict[str, Any]] = []
        self._scan(packages_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_summaries(self) -> list[dict]:
        """Return lightweight summaries for all successfully loaded packages."""
        return [
            {
                "id": pkg.id,
                "version": pkg.version,
                "label": pkg.label,
                "compatible_scenario_types": pkg.compatible_scenario_types,
                "algorithm_type": pkg.algorithm.type,
            }
            for pkg in self._packages.values()
        ]

    def list_errors(self) -> list[dict]:
        """Return error entries for packages that failed to load."""
        return list(self._errors)

    def get(self, package_id: str) -> PackageManifest | None:
        """Return the full PackageManifest for a package_id, or None."""
        return self._packages.get(package_id)

    def is_compatible(
        self, package: PackageManifest, scenario: ScenarioDef
    ) -> bool:
        """Return True if the scenario type is in the package's compat list."""
        return scenario.type in package.compatible_scenario_types

    # ── Private helpers ────────────────────────────────────────────────────

    def _scan(self, packages_dir: pathlib.Path) -> None:
        """Scan packages_dir for subdirectories containing package.json."""
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
                # Proposal-family packages (they declare `kind`/`family`, e.g. the
                # transparent content selector) are owned by the separate proposal
                # package registry, not the trigger registry. Skip them silently —
                # they are not trigger packages and must not surface as errors here.
                if data.get("kind") is not None or data.get("family") is not None:
                    continue
                manifest = PackageManifest(**data)
                self._packages[manifest.id] = manifest
            except (ValidationError, Exception) as exc:
                self._errors.append(
                    {
                        "package_dir": str(pkg_dir),
                        "error": str(exc),
                    }
                )
