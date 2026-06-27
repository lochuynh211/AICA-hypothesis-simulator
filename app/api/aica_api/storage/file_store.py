"""Atomic JSON file store — stdlib only, no new dependencies."""

from __future__ import annotations

import json
import os
import pathlib
import tempfile


def read_json(path: str) -> dict:
    """Read and parse a JSON file.  Raises FileNotFoundError if absent."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json_atomic(path: str, data: dict) -> None:
    """Write *data* as JSON to *path* atomically.

    Writes to a sibling temp file in the same directory, then uses
    ``os.replace`` for an atomic rename so readers never see a partial file.
    Parent directories are created as needed.
    """
    target = pathlib.Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    # Write to a temp file in the same directory so os.replace is atomic
    # (same filesystem).
    fd, tmp_path = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, target)
    except Exception:
        # Clean up the temp file if anything goes wrong
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
