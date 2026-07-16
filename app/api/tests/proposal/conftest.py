"""Shared fixtures and helpers for the proposal contract test suite.

Provides a ``load_fixture`` helper that resolves paths relative to
``proposal_contracts/`` (via ``aica_api.config``) and loads them as
parsed JSON.  Tests import this helper from conftest via pytest fixture
injection or direct import.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from aica_api.config import settings


def load_fixture(relative_path: str) -> Any:
    """Load a JSON fixture from ``proposal_contracts/<relative_path>``.

    Parameters
    ----------
    relative_path:
        Path relative to the ``proposal_contracts/`` directory,
        e.g. ``"fixtures/songs/smoke/song-0001.json"``.

    Returns
    -------
    Any
        Parsed JSON value (dict, list, etc.).

    Raises
    ------
    FileNotFoundError
        If the resolved path does not exist.
    json.JSONDecodeError
        If the file is not valid JSON.
    """
    full_path: Path = settings.proposal_contracts_dir / relative_path
    with full_path.open(encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture()
def proposal_contracts_dir() -> Path:
    """Return the resolved ``proposal_contracts/`` directory as a Path."""
    return settings.proposal_contracts_dir


# ---------------------------------------------------------------------------
# Content-selector (P6) harness — loads the package + fixtures and assembles
# the runtime context.  ALL file I/O lives here; the package never opens files.
# ---------------------------------------------------------------------------

import importlib.util  # noqa: E402

_REPO_ROOT: Path = settings.proposal_contracts_dir.parent
_CONTENT_PKG_DIR: Path = _REPO_ROOT / "packages" / "aica_transparent_content_selector_v1"


def load_content_selector():
    """Import the content-selector package's ``algorithm`` module by path.

    The package is a standalone ``python_module`` (no ``aica_api`` import); we load it
    by file path exactly as the runtime adapter would in later milestones.
    """
    spec = importlib.util.spec_from_file_location(
        "aica_content_selector_v1_algorithm", _CONTENT_PKG_DIR / "algorithm.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_content_manifest() -> dict:
    """Load the content-selector ``package.json`` manifest."""
    with (_CONTENT_PKG_DIR / "package.json").open(encoding="utf-8") as fh:
        return json.load(fh)


def manifest_hyperparameters() -> dict:
    """Return the fully-resolved default hyperparameter dict (manifest defaults)."""
    manifest = load_content_manifest()
    return {h["key"]: h["default"] for h in manifest["hyperparameters"]}


def load_catalog(relative_path: str) -> dict:
    """Load a song-DB JSON fixture and return a ``{track_id: Song}`` map.

    Accepts either a list of Song records or an already-keyed map.
    """
    data = load_fixture(relative_path)
    if isinstance(data, dict):
        if "spotify_track" in data:  # a single Song record
            return {data["spotify_track"]["id"]: data}
        return data  # already a {track_id: Song} map
    return {song["spotify_track"]["id"]: song for song in data}


def build_content_context(
    *,
    selected_service_id: str = "music_playlist",
    trigger_purpose: str = "rest_recommended",
    lifecycle_stage: str = "before_rest_until_stop",
    feature_snapshot: dict | None = None,
    enabled_feature_extensions: list | None = None,
    eligible_candidates: list | None = None,
    excluded_candidates: list | None = None,
    hyperparameters: dict | None = None,
    parameters: dict | None = None,
    simulation_time: str = "2026-07-14T22:10:00Z",
    catalog_version: str = "smoke-1",
) -> dict:
    """Assemble a runtime ``context`` dict for the content selector.

    ``feature_snapshot`` must contain a ``catalog`` map; if ``eligible_candidates`` is
    omitted, every catalog Track ID is ranked.
    """
    snapshot = feature_snapshot or {}
    catalog = snapshot.get("catalog", {})
    if eligible_candidates is None:
        eligible_candidates = [{"candidate_id": tid} for tid in catalog]
    manifest = load_content_manifest()
    return {
        "contract_version": manifest.get("contract_version", "1.0.0"),
        "opportunity_id": "op-test",
        "simulation_time": simulation_time,
        "trigger_purpose": trigger_purpose,
        "lifecycle_stage": lifecycle_stage,
        "allowed_service_ids": [selected_service_id],
        "selected_service_id": selected_service_id,
        "feature_snapshot": snapshot,
        "feature_provenance": {},
        "enabled_feature_extensions": enabled_feature_extensions or [],
        "eligible_candidates": eligible_candidates,
        "excluded_candidates": excluded_candidates or [],
        "parameters": parameters if parameters is not None else manifest.get("parameters", {}),
        "hyperparameters": hyperparameters or manifest_hyperparameters(),
        "package_runtime_state": {},
        "catalog_version": catalog_version,
        "run_seed": "seed-test",
    }


@pytest.fixture()
def content_selector():
    """The imported content-selector algorithm module."""
    return load_content_selector()


@pytest.fixture()
def content_hyperparameters() -> dict:
    """Fully-resolved default hyperparameters from the manifest."""
    return manifest_hyperparameters()
