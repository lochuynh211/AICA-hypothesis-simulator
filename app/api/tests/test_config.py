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


def test_ollama_timeout_is_long_enough_for_a_real_generation(monkeypatch):
    """Regression guard for "the LLM option appears to do nothing".

    Measured against the shipped default model (qwen2.5:3b) on the trigger
    explanation prompt, one generation takes 14-33s depending on machine load,
    and the first request after a cold start additionally pays a ~2GB model
    load. The previous 20s default meant `provider="backend"` timed out every
    time, reported `unreachable`, and fell back to the deterministic template —
    indistinguishable, from the panel, from the LLM never having been asked.

    Pinned as a floor rather than an exact value so the timeout can be raised
    further without touching this test, but not quietly dropped back under the
    generation time it exists to accommodate.
    """
    monkeypatch.delenv("OLLAMA_TIMEOUT_SEC", raising=False)
    from aica_api.config import Settings
    assert Settings().ollama_timeout_sec >= 45


def test_ollama_timeout_env_override(monkeypatch):
    monkeypatch.setenv("OLLAMA_TIMEOUT_SEC", "5")
    from aica_api.config import Settings
    assert Settings().ollama_timeout_sec == 5.0
