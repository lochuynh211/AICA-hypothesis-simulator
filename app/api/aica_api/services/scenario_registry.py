"""Scenario registry (T019) — scans scenarios_dir and loads ScenarioDefs.

Scans the scenarios directory for ``*.json`` files.  Valid definitions are
loaded and indexed by id; invalid ones are reported in an errors list.

Public API:
  ScenarioRegistry(scenarios_dir: Path)
    .list_summaries() -> list[dict]   — id, version, type, review_focus
    .list_errors()    -> list[dict]   — {file, error} for invalid files
    .get(scenario_id) -> ScenarioDef | None
    .is_compatible(scenario, package) -> bool
"""

from __future__ import annotations

import pathlib
from typing import Any

from pydantic import ValidationError

from aica_api.models.package import PackageManifest
from aica_api.models.scenario import ScenarioDef
from aica_api.storage.file_store import read_json


class ScenarioRegistry:
    """In-memory index of all available scenarios in a scenarios directory."""

    def __init__(self, scenarios_dir: pathlib.Path) -> None:
        self._scenarios: dict[str, ScenarioDef] = {}
        self._errors: list[dict[str, Any]] = []
        self._scan(scenarios_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_summaries(self) -> list[dict]:
        """Return lightweight summaries for all successfully loaded scenarios."""
        return [
            {
                "id": sc.id,
                "version": sc.version,
                "type": sc.type,
                "review_focus": sc.review_focus,
                "total_duration_seconds": sc.total_duration_seconds,
                "tick_seconds": sc.tick_seconds,
            }
            for sc in self._scenarios.values()
        ]

    def list_errors(self) -> list[dict]:
        """Return error entries for scenarios that failed to load."""
        return list(self._errors)

    def get(self, scenario_id: str) -> ScenarioDef | None:
        """Return the full ScenarioDef for a scenario_id, or None."""
        return self._scenarios.get(scenario_id)

    def is_compatible(
        self, scenario: ScenarioDef, package: PackageManifest
    ) -> bool:
        """Return True if the scenario type is in the package's compat list."""
        return scenario.type in package.compatible_scenario_types

    # ── Private helpers ────────────────────────────────────────────────────

    def _scan(self, scenarios_dir: pathlib.Path) -> None:
        """Scan scenarios_dir for .json files."""
        if not scenarios_dir.exists():
            return

        for sc_file in sorted(scenarios_dir.glob("*.json")):
            if not sc_file.is_file():
                continue
            try:
                data = read_json(str(sc_file))
                scenario = ScenarioDef(**data)
                self._scenarios[scenario.id] = scenario
            except (ValidationError, Exception) as exc:
                self._errors.append(
                    {
                        "file": str(sc_file),
                        "error": str(exc),
                    }
                )
