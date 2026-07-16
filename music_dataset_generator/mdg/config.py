"""MDG runtime configuration.

Resolves file-system paths for generator data directories and credentials:
  workspace_dir      — AICA_GENERATION_WORKSPACE_DIR  (default: <repo-root>/generation_workspace)
  dataset_dir        — AICA_PROPOSAL_DATASET_DIR       (default: <repo-root>/proposal_contracts/dataset)

Soundcharts credentials are read from environment ONLY and never written anywhere.

The repo root is derived from this file's location:
  music_dataset_generator/mdg/config.py  →  parents[2]  →  repo root
"""

import os
from pathlib import Path
from typing import Optional


def _repo_root() -> Path:
    """Best-effort repo root for the default data-dir locations.

    Host layout ``<repo>/music_dataset_generator/mdg/config.py``: parents[0]=mdg,
    parents[1]=music_dataset_generator, ``parents[2]`` = repo root. Guard the index so
    importing this module never raises in unexpected layouts.
    """
    parents = Path(__file__).resolve().parents
    return parents[2] if len(parents) > 2 else parents[-1]


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


def secrets_file() -> Path:
    """Path to the operator's local, gitignored Soundcharts credential file.

    Default: ``<repo-root>/generation_workspace/soundcharts.env`` (the whole
    ``generation_workspace/`` tree is gitignored, so this file can never be committed).
    Override with ``AICA_SOUNDCHARTS_ENV_FILE``. The tool only ever *reads* this file into
    the process environment; it never writes credentials to it or anywhere else.
    """
    override = os.environ.get("AICA_SOUNDCHARTS_ENV_FILE")
    if override:
        return Path(override)
    return _repo_root() / "generation_workspace" / "soundcharts.env"


def load_secrets_file(path: Optional[Path] = None) -> None:
    """Load ``KEY=VALUE`` lines from the local secrets file into ``os.environ``.

    Best-effort and idempotent: missing file is a no-op; an already-set environment
    variable always wins (so an explicit ``export`` overrides the file). Lines that are
    blank or start with ``#`` are ignored. Values are never logged.
    """
    path = Path(path) if path else secrets_file()
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def soundcharts_credentials() -> Optional[tuple[str, str]]:
    """Return (app_id, api_key) from the environment, or None if either is unset.

    Credentials are read from the environment only. As a convenience for the operator, a
    local gitignored ``soundcharts.env`` file (if present) is loaded into the environment
    first — it is never written to, committed, or logged (FR-011).
    """
    load_secrets_file()
    app_id = os.environ.get("SOUNDCHARTS_APP_ID")
    api_key = os.environ.get("SOUNDCHARTS_API_KEY")
    if app_id and api_key:
        return (app_id, api_key)
    return None
