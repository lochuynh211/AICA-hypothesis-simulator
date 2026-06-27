"""Tests for aica_api.config — path resolution and env-var overrides."""

from pathlib import Path

import pytest


def test_packages_dir_default_ends_with_packages():
    """Default packages_dir should end with 'packages'."""
    from aica_api.config import Settings
    s = Settings()
    assert s.packages_dir.name == "packages"


def test_scenarios_dir_default_ends_with_scenarios():
    """Default scenarios_dir should end with 'scenarios'."""
    from aica_api.config import Settings
    s = Settings()
    assert s.scenarios_dir.name == "scenarios"


def test_runs_dir_default_ends_with_runs():
    """Default runs_dir should end with 'runs'."""
    from aica_api.config import Settings
    s = Settings()
    assert s.runs_dir.name == "runs"


def test_packages_dir_env_override(monkeypatch, tmp_path):
    """AICA_PACKAGES_DIR env var overrides the default packages directory."""
    custom = tmp_path / "my_packages"
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(custom))
    # Re-import to pick up fresh resolution via the property
    from aica_api import config as cfg
    assert cfg.Settings().packages_dir == custom.resolve()


def test_scenarios_dir_env_override(monkeypatch, tmp_path):
    """AICA_SCENARIOS_DIR env var overrides the default scenarios directory."""
    custom = tmp_path / "my_scenarios"
    monkeypatch.setenv("AICA_SCENARIOS_DIR", str(custom))
    from aica_api import config as cfg
    assert cfg.Settings().scenarios_dir == custom.resolve()


def test_runs_dir_env_override(monkeypatch, tmp_path):
    """AICA_RUNS_DIR env var overrides the default runs directory."""
    custom = tmp_path / "my_runs"
    monkeypatch.setenv("AICA_RUNS_DIR", str(custom))
    from aica_api import config as cfg
    assert cfg.Settings().runs_dir == custom.resolve()


def test_dirs_return_path_objects():
    """All settings properties return pathlib.Path instances."""
    from aica_api.config import Settings
    s = Settings()
    assert isinstance(s.packages_dir, Path)
    assert isinstance(s.scenarios_dir, Path)
    assert isinstance(s.runs_dir, Path)
