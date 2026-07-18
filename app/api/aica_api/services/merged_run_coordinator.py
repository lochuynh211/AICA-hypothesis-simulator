"""Merged run coordinator (feature 020, Task 3) — registry + persistence.

Owns the on-disk life-cycle of ``MergedRunHandle`` records
(``aica_api.models.merged_run``) under ``merged_runs/<merged_run_id>.json``,
mirroring ``services/proposal_run_manager``'s discipline:

  - ``make_merged_run_id`` mints the id (timestamp + random hex) — the ONLY
    place randomness/clock is used in this module. Format:
    ``mrun_<YYYYMMDD-HHMMSS>_<6hex>``.
  - ``create_handle`` builds a ``MergedRunHandle`` in memory only; it does
    NOT persist (mirrors the id being minted once, then the caller decides
    when to write).
  - ``save_handle`` persists atomically via
    ``storage.file_store.write_json_atomic``.
  - ``get_handle`` reads back from disk and returns ``None`` when the file
    is absent (no exception — mirrors ``proposal_run_manager.get_run``).

This module intentionally imports ONLY ``aica_api.models.merged_run`` plus
``storage.file_store`` and stdlib — it does not import the trigger
``run_manager``/``tick_engine`` or the proposal router/``proposal_run_manager``
(that composition is the later merged-runs router's job, per the feature-020
isolation constraint).
"""
from __future__ import annotations

import os
import pathlib
from datetime import datetime, timezone

from aica_api.models.merged_run import MergedRunHandle
from aica_api.storage.file_store import read_json, write_json_atomic

__all__ = [
    "make_merged_run_id",
    "create_handle",
    "save_handle",
    "get_handle",
]


# ---------------------------------------------------------------------------
# Id minting
# ---------------------------------------------------------------------------


def make_merged_run_id() -> str:
    """Generate a unique merged-run id: ``mrun_<YYYYMMDD-HHMMSS>_<6hex>``.

    The ONLY place timestamp/randomness is generated in this module (mirrors
    ``proposal_run_manager._make_run_id``).
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"mrun_{ts}_{rand}"


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _handle_path(merged_run_id: str, merged_dir: pathlib.Path) -> pathlib.Path:
    return pathlib.Path(merged_dir) / f"{merged_run_id}.json"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_handle(
    *,
    merged_run_id: str,
    trigger_run_id: str,
    world_template: dict,
    service_package_id: str,
    content_package_id: str,
    proposal_mode: str,
    run_seed: str,
    merged_dir: pathlib.Path,
    service_parameters: dict | None = None,
    service_hyperparameters: dict | None = None,
    content_parameters: dict | None = None,
    content_hyperparameters: dict | None = None,
) -> MergedRunHandle:
    """Build a ``MergedRunHandle`` in memory. Does NOT persist — call
    ``save_handle`` to write it to disk.

    ``merged_dir`` is accepted (unused here) to keep this function's
    signature symmetric with ``save_handle``/``get_handle`` and to leave
    room for future validation against the registry without changing the
    call sites that already pass it.

    ``service_parameters``/``service_hyperparameters``/``content_parameters``/
    ``content_hyperparameters`` (feature 020 override plumbing) default to
    ``None`` here and are normalized to ``{}`` (``MergedRunHandle``'s own
    field default) — additive-only: an existing call site that omits them
    behaves exactly as before.
    """
    return MergedRunHandle(
        merged_run_id=merged_run_id,
        trigger_run_id=trigger_run_id,
        world_template=world_template,
        service_package_id=service_package_id,
        content_package_id=content_package_id,
        proposal_mode=proposal_mode,
        run_seed=run_seed,
        service_parameters=service_parameters or {},
        service_hyperparameters=service_hyperparameters or {},
        content_parameters=content_parameters or {},
        content_hyperparameters=content_hyperparameters or {},
    )


def save_handle(handle: MergedRunHandle, merged_dir: pathlib.Path) -> None:
    """Persist ``handle`` atomically to ``<merged_dir>/<merged_run_id>.json``."""
    write_json_atomic(str(_handle_path(handle.merged_run_id, merged_dir)), handle.model_dump(mode="json"))


def get_handle(merged_run_id: str, merged_dir: pathlib.Path) -> MergedRunHandle | None:
    """Load the ``MergedRunHandle`` for ``merged_run_id`` from disk, or None."""
    path = _handle_path(merged_run_id, merged_dir)
    if not path.exists():
        return None
    data = read_json(str(path))
    return MergedRunHandle(**data)
