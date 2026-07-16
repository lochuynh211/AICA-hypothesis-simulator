"""Tests for aica_api.config.Settings.proposal_runs_dir (P1 T001).

Follows the exact pattern of the existing proposal_contracts_dir /
proposal_dataset_dir tests in app/api/tests/test_config.py.
"""
from __future__ import annotations

from pathlib import Path


def test_proposal_runs_dir_default_ends_with_proposal_runs():
    """Default proposal_runs_dir should end with 'proposal_runs'."""
    from aica_api.config import Settings
    s = Settings()
    assert s.proposal_runs_dir.name == "proposal_runs"


def test_proposal_runs_dir_is_sibling_of_runs_dir():
    """Default proposal_runs_dir resolves under the repo root, alongside runs_dir."""
    from aica_api.config import Settings
    s = Settings()
    assert s.proposal_runs_dir.parent == s.runs_dir.parent


def test_proposal_runs_dir_env_override(monkeypatch, tmp_path):
    """AICA_PROPOSAL_RUNS_DIR env var overrides the default proposal_runs directory."""
    custom = tmp_path / "my_proposal_runs"
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(custom))
    from aica_api import config as cfg
    assert cfg.Settings().proposal_runs_dir == custom.resolve()


def test_proposal_runs_dir_returns_path_object():
    """proposal_runs_dir returns a pathlib.Path instance."""
    from aica_api.config import Settings
    s = Settings()
    assert isinstance(s.proposal_runs_dir, Path)
