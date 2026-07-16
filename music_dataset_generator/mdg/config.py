"""MDG runtime configuration.

Resolves file-system paths for generator data directories and credentials:
  workspace_dir      — AICA_GENERATION_WORKSPACE_DIR  (default: <repo-root>/generation_workspace)
  dataset_dir        — AICA_PROPOSAL_DATASET_DIR       (default: <repo-root>/proposal_contracts/dataset)

Soundcharts credentials are read from environment ONLY and never written anywhere.

The repo root is derived from this file's location:
  music_dataset_generator/mdg/config.py  →  parents[3]  →  repo root
"""

import os
from pathlib import Path
from typing import Optional


def _repo_root() -> Path:
    """Best-effort repo root for the default data-dir locations.

    Host layout: ``<repo>/music_dataset_generator/mdg/config.py`` → ``parents[3]`` = repo root.
    Guard the index so importing this module never raises in unexpected layouts.
    """
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else parents[-1]


def _resolve(env_var: str, default_name: str) -> Path:
    """Return the Path from the env-var override, or the repo-root default."""
    override = os.environ.get(env_var)
    if override:
        return Path(override).resolve()
    return _repo_root() / default_name


def workspace_dir() -> Path:
    """Directory for intermediate generation workspace files."""
    return _resolve("AICA_GENERATION_WORKSPACE_DIR", "generation_workspace")


def dataset_dir() -> Path:
    """Directory for the final proposal dataset outputs."""
    return _resolve("AICA_PROPOSAL_DATASET_DIR", "proposal_contracts/dataset")


def soundcharts_credentials() -> Optional[tuple[str, str]]:
    """Return (app_id, api_key) from env vars, or None if either is unset.

    Credentials are NEVER written to any file — only read from the environment.
    """
    app_id = os.environ.get("SOUNDCHARTS_APP_ID")
    api_key = os.environ.get("SOUNDCHARTS_API_KEY")
    if app_id and api_key:
        return (app_id, api_key)
    return None
