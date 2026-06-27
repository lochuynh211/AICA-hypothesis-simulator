"""TDD tests for storage.file_store (T009) — written before implementation."""

import json


BASE_DATA = {"key": "value", "nested": {"a": 1}, "list": [1, 2, 3]}


def test_write_then_read(tmp_path):
    from aica_api.storage.file_store import read_json, write_json_atomic

    target = tmp_path / "out.json"
    write_json_atomic(str(target), BASE_DATA)
    result = read_json(str(target))
    assert result == BASE_DATA


def test_atomic_overwrite(tmp_path):
    from aica_api.storage.file_store import read_json, write_json_atomic

    target = tmp_path / "out.json"
    write_json_atomic(str(target), {"v": 1})
    write_json_atomic(str(target), {"v": 2})
    result = read_json(str(target))
    assert result == {"v": 2}


def test_nested_dirs_created(tmp_path):
    from aica_api.storage.file_store import read_json, write_json_atomic

    target = tmp_path / "deep" / "nested" / "dir" / "out.json"
    write_json_atomic(str(target), BASE_DATA)
    assert target.exists()
    result = read_json(str(target))
    assert result == BASE_DATA


def test_written_file_is_valid_json(tmp_path):
    from aica_api.storage.file_store import write_json_atomic

    target = tmp_path / "check.json"
    write_json_atomic(str(target), BASE_DATA)
    raw = target.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    assert parsed == BASE_DATA


def test_read_nonexistent_raises(tmp_path):
    from aica_api.storage.file_store import read_json

    import pytest

    with pytest.raises(FileNotFoundError):
        read_json(str(tmp_path / "does_not_exist.json"))
