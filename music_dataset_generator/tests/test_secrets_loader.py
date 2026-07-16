"""Local secrets-file loader — reads a gitignored credential file into the environment.

Never overwrites an already-set env var; missing file is a no-op; comments/blanks ignored.
The tool only reads the file — it never writes credentials anywhere (FR-011).
"""
from __future__ import annotations

from mdg import config


def test_loads_key_value_pairs(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOUNDCHARTS_APP_ID", raising=False)
    monkeypatch.delenv("SOUNDCHARTS_API_KEY", raising=False)
    secrets = tmp_path / "soundcharts.env"
    secrets.write_text(
        "# comment\n\nSOUNDCHARTS_APP_ID=app-123\nSOUNDCHARTS_API_KEY=\"key-456\"\n"
    )
    monkeypatch.setenv("AICA_SOUNDCHARTS_ENV_FILE", str(secrets))
    creds = config.soundcharts_credentials()
    assert creds == ("app-123", "key-456")


def test_existing_env_var_wins(tmp_path, monkeypatch) -> None:
    secrets = tmp_path / "soundcharts.env"
    secrets.write_text("SOUNDCHARTS_APP_ID=from-file\nSOUNDCHARTS_API_KEY=from-file\n")
    monkeypatch.setenv("AICA_SOUNDCHARTS_ENV_FILE", str(secrets))
    monkeypatch.setenv("SOUNDCHARTS_APP_ID", "from-export")
    monkeypatch.setenv("SOUNDCHARTS_API_KEY", "from-export")
    assert config.soundcharts_credentials() == ("from-export", "from-export")


def test_missing_file_is_none(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SOUNDCHARTS_APP_ID", raising=False)
    monkeypatch.delenv("SOUNDCHARTS_API_KEY", raising=False)
    monkeypatch.setenv("AICA_SOUNDCHARTS_ENV_FILE", str(tmp_path / "nope.env"))
    assert config.soundcharts_credentials() is None


def test_loader_never_writes_file(tmp_path, monkeypatch) -> None:
    secrets = tmp_path / "soundcharts.env"
    original = "SOUNDCHARTS_APP_ID=a\nSOUNDCHARTS_API_KEY=b\n"
    secrets.write_text(original)
    monkeypatch.setenv("AICA_SOUNDCHARTS_ENV_FILE", str(secrets))
    config.load_secrets_file()
    assert secrets.read_text() == original  # unchanged — read-only
