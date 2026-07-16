"""AICA API runtime configuration.

Resolves file-system paths for the four data directories:
  packages_dir          — AICA_PACKAGES_DIR           (default: <repo-root>/packages)
  scenarios_dir         — AICA_SCENARIOS_DIR          (default: <repo-root>/scenarios)
  runs_dir              — AICA_RUNS_DIR               (default: <repo-root>/runs)
  proposal_contracts_dir — AICA_PROPOSAL_CONTRACTS_DIR (default: <repo-root>/proposal_contracts)

The repo root is derived from this file's location:
  app/api/aica_api/config.py  →  parents[3]  →  repo root
Environment variable overrides always win. No third-party libraries are used.
"""

import os
from pathlib import Path

def _repo_root() -> Path:
    """Best-effort repo root for the default data-dir locations.

    Host layout: ``<repo>/app/api/aica_api/config.py`` → ``parents[3]`` = repo root.
    In the container the package is mounted at ``/app`` (a shallower path), where
    the default is never used because ``AICA_*_DIR`` env vars are set explicitly;
    guard the index so importing this module never raises there.
    """
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else parents[-1]


def _resolve(env_var: str, default_name: str) -> Path:
    """Return the Path from the env-var override, or the repo-root default."""
    override = os.environ.get(env_var)
    if override:
        return Path(override).resolve()
    return _repo_root() / default_name


class Settings:
    """Lightweight settings object — no Pydantic dependency."""

    @property
    def packages_dir(self) -> Path:
        return _resolve("AICA_PACKAGES_DIR", "packages")

    @property
    def scenarios_dir(self) -> Path:
        return _resolve("AICA_SCENARIOS_DIR", "scenarios")

    @property
    def runs_dir(self) -> Path:
        return _resolve("AICA_RUNS_DIR", "runs")

    @property
    def routes_dir(self) -> Path:
        return _resolve("AICA_ROUTES_DIR", "routes")

    @property
    def proposal_contracts_dir(self) -> Path:
        return _resolve("AICA_PROPOSAL_CONTRACTS_DIR", "proposal_contracts")


settings = Settings()
