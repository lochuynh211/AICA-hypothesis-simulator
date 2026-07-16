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
