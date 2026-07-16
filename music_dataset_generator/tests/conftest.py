"""Pytest configuration for the music_dataset_generator test suite."""

from pathlib import Path
import pytest


def pytest_configure(config: pytest.Config) -> None:
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "live: marks tests that require live network/API access (deselected by default)",
    )


def pytest_addoption(parser: pytest.Parser) -> None:
    """Add --run-live CLI option."""
    parser.addoption(
        "--run-live",
        action="store_true",
        default=False,
        help="Run tests marked @pytest.mark.live (requires real credentials and network).",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Skip live tests unless --run-live is passed."""
    if config.getoption("--run-live"):
        return
    skip_live = pytest.mark.skip(reason="live test — pass --run-live to run")
    for item in items:
        if item.get_closest_marker("live"):
            item.add_marker(skip_live)


@pytest.fixture
def fixtures_dir() -> Path:
    """Return the path to the test fixtures directory."""
    return Path(__file__).parent / "fixtures"
