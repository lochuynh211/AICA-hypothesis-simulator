"""Proposal run manager (T017) — create/get/list/delete a ProposalRunLog.

Reuses ``storage/file_store``'s atomic JSON writer for on-disk persistence
under ``settings.proposal_runs_dir`` (a namespace entirely separate from the
trigger ``runs/`` directory — this module never touches trigger state).

Design constraints (mirrors the trigger ``run_manager``'s discipline):
  - ``run_id`` generation (timestamp + random hex) happens ONLY at
    ``create_run`` — the sole place randomness/clock is allowed in this
    module. Format: ``prun_<YYYYMMDD-HHMMSS>_<6hex>``.
  - Params/hyperparameters are frozen into the log at creation: the caller's
    dicts are deep-copied before being stored, so a later mutation of the
    caller's own dict cannot retroactively change the persisted log.
  - Append-only: ``append_event``/``append_evidence`` only ever add to the
    end of ``events``/``evidence``, then rewrite the whole log file
    atomically (mirrors ``storage/evidence_recorder.EvidenceRecorder``, but
    reads back from disk each time rather than holding in-memory state —
    P1 has no in-process run registry yet).
  - Reopen (``get_run``) renders the log from disk WITHOUT recomputing any
    selector — no algorithm is ever invoked in this module.

Public API:
  create_run(...) -> ProposalRunLog
  get_run(run_id, runs_dir) -> ProposalRunLog | None
  list_runs(runs_dir) -> list[ProposalRun]
  delete_run(run_id, runs_dir) -> bool
  append_event(run_id, event, runs_dir) -> ProposalRunLog
  append_evidence(run_id, evidence, runs_dir) -> ProposalRunLog
  update_state(run_id, runs_dir, *, status=None, journey_state=None) -> ProposalRunLog
"""
from __future__ import annotations

import copy
import os
import pathlib
from datetime import datetime, timezone

from aica_api.models.proposal.enums import ProposalRunStatus
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.storage.file_store import read_json, write_json_atomic

__all__ = [
    "ProposalRunNotFoundError",
    "create_run",
    "get_run",
    "list_runs",
    "delete_run",
    "append_event",
    "append_evidence",
    "update_state",
]


class ProposalRunNotFoundError(Exception):
    """Raised when a run_id is not found under the configured runs_dir."""


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _make_run_id() -> str:
    """Generate a unique run_id: prun_<YYYYMMDD-HHMMSS>_<6-hex>.

    The ONLY place timestamp/randomness is generated in this module.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"prun_{ts}_{rand}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _run_path(run_id: str, runs_dir: pathlib.Path) -> pathlib.Path:
    return pathlib.Path(runs_dir) / f"{run_id}.json"


def _persist(run_log: ProposalRunLog, runs_dir: pathlib.Path) -> None:
    write_json_atomic(str(_run_path(run_log.run_id, runs_dir)), run_log.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Public API — create_run
# ---------------------------------------------------------------------------


def create_run(
    *,
    opportunity: ProposalOpportunity,
    matrix_version: str,
    world_snapshot: dict,
    service_package_id: str,
    content_package_id: str | None,
    parameters: dict,
    hyperparameters: dict,
    journey_state: JourneyState,
    events: list[DiscreteEvent] | None = None,
    evidence: list[AlgorithmEvidence] | None = None,
    status: ProposalRunStatus = ProposalRunStatus.created,
    runs_dir: pathlib.Path,
) -> ProposalRunLog:
    """Build a ``ProposalRunLog``, append any provided events/evidence, and
    persist it atomically to ``<runs_dir>/<run_id>.json``.

    Setup-time-only discipline: ``parameters``/``hyperparameters`` are
    deep-copied here so the persisted log is frozen at creation and immune
    to later mutation of the caller's dicts.

    Args:
        opportunity:          The resolved ``ProposalOpportunity``.
        matrix_version:       The frozen purpose/stage matrix version used.
        world_snapshot:       Reviewer-set world/situation snapshot dict.
        service_package_id:   The service-selector package id used.
        content_package_id:   The content-selector package id, or None
                               (not yet selected — STEP 1 only).
        parameters:           Setup-time parameter overrides (frozen).
        hyperparameters:      Setup-time hyperparameter overrides (frozen).
        journey_state:        The initial ``JourneyState`` snapshot.
        events:                Initial discrete events to append (e.g.
                               ``OPPORTUNITY_OPENED``/``SERVICE_SELECTED``).
        evidence:              Initial algorithm evidence entries.
        status:                Initial ``ProposalRunStatus``.
        runs_dir:              Directory for persisting ``<run_id>.json``
                               (``settings.proposal_runs_dir`` in production
                               — NEVER the trigger ``runs_dir``).

    Returns:
        The persisted ``ProposalRunLog``.
    """
    run_id = _make_run_id()
    run_log = ProposalRunLog(
        run_id=run_id,
        created_at=_now_iso(),
        opportunity=opportunity,
        matrix_version=matrix_version,
        world_snapshot=copy.deepcopy(world_snapshot),
        service_package_id=service_package_id,
        content_package_id=content_package_id,
        parameters=copy.deepcopy(parameters),
        hyperparameters=copy.deepcopy(hyperparameters),
        journey_state=journey_state,
        events=list(events) if events else [],
        evidence=list(evidence) if evidence else [],
        status=status,
    )
    _persist(run_log, pathlib.Path(runs_dir))
    return run_log


# ---------------------------------------------------------------------------
# Public API — get / list / delete
# ---------------------------------------------------------------------------


def get_run(run_id: str, runs_dir: pathlib.Path) -> ProposalRunLog | None:
    """Load the full ``ProposalRunLog`` for ``run_id`` from disk, or None.

    Renders from the persisted record WITHOUT recomputing any selector.
    """
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        return None
    data = read_json(str(path))
    return ProposalRunLog(**data)


def list_runs(runs_dir: pathlib.Path) -> list[ProposalRun]:
    """Return summaries for every persisted run under ``runs_dir``.

    Corrupt/invalid files are skipped rather than raised (mirrors registry
    error-tolerance elsewhere) — this is a listing helper, not a validator.
    """
    runs_dir = pathlib.Path(runs_dir)
    if not runs_dir.exists():
        return []

    summaries: list[ProposalRun] = []
    for path in sorted(runs_dir.glob("*.json")):
        try:
            data = read_json(str(path))
            log = ProposalRunLog(**data)
        except Exception:
            continue
        summaries.append(
            ProposalRun(
                run_id=log.run_id,
                status=log.status,
                opportunity_id=log.opportunity.opportunity_id,
                created_at=log.created_at,
                service_package_id=log.service_package_id,
                content_package_id=log.content_package_id,
            )
        )
    return summaries


def delete_run(run_id: str, runs_dir: pathlib.Path) -> bool:
    """Delete ``<runs_dir>/<run_id>.json``. Returns True if it existed."""
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        return False
    path.unlink()
    return True


# ---------------------------------------------------------------------------
# Public API — append_event / append_evidence
# ---------------------------------------------------------------------------


def append_event(run_id: str, event: DiscreteEvent, runs_dir: pathlib.Path) -> ProposalRunLog:
    """Append one ``DiscreteEvent`` to an existing run and re-persist.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    run_log.events.append(event)
    _persist(run_log, pathlib.Path(runs_dir))
    return run_log


def append_evidence(run_id: str, evidence: AlgorithmEvidence, runs_dir: pathlib.Path) -> ProposalRunLog:
    """Append one ``AlgorithmEvidence`` to an existing run and re-persist.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    run_log.evidence.append(evidence)
    _persist(run_log, pathlib.Path(runs_dir))
    return run_log


def update_state(
    run_id: str,
    runs_dir: pathlib.Path,
    *,
    status: ProposalRunStatus | None = None,
    journey_state: JourneyState | None = None,
) -> ProposalRunLog:
    """Update ``status`` and/or ``journey_state`` on an existing run and re-persist.

    Neither field is mutated by ``append_event``/``append_evidence`` (which only
    ever append to their respective lists), so a STEP-2-style transition
    (e.g. ``content_selected`` + a newly-confirmed ``active_service_id``) needs
    this small, additive counterpart. Omitted (``None``) fields are left
    unchanged.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    if status is not None:
        run_log.status = status
    if journey_state is not None:
        run_log.journey_state = journey_state
    _persist(run_log, pathlib.Path(runs_dir))
    return run_log
