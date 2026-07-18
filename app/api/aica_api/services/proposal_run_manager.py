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
  create_run(..., cache=None) -> ProposalRunLog
  get_run(run_id, runs_dir, *, cache=None) -> ProposalRunLog | None
  list_runs(runs_dir) -> list[ProposalRun]
  delete_run(run_id, runs_dir) -> bool
  append_event(run_id, event, runs_dir, *, cache=None) -> ProposalRunLog
  append_evidence(run_id, evidence, runs_dir, *, cache=None) -> ProposalRunLog
  update_state(run_id, runs_dir, *, status=None, journey_state=None,
               content_parameters=None, content_hyperparameters=None,
               setup_snapshot=None, opportunity=None, world_snapshot=None,
               opportunity_history=None, setup_snapshot_history=None,
               cache=None)
               -> ProposalRunLog

Non-persisting cache (feature 020, Slice-2c): every writer/reader above
accepts an optional keyword-only ``cache: dict[str, ProposalRunLog] | None``.
When ``cache`` is ``None`` (the default -- every existing call site),
behavior is byte-identical to before this feature: reads/writes go through
``read_json``/``write_json_atomic`` against ``runs_dir`` exactly as always.
When a caller supplies a ``dict`` (even an empty one), it is used as an
in-memory stand-in for disk: reads become ``cache.get(run_id)`` and writes
become ``cache[run_id] = run_log`` -- nothing touches ``runs_dir``. This lets
a quick-check-only proposal run be built and resolved entirely in memory
(``merged_quickview``, feature 020) without ever creating a file under
``proposal_runs/``.
"""
from __future__ import annotations

import copy
import os
import pathlib
from datetime import datetime, timezone

from aica_api.models.proposal.enums import ProposalRunMode, ProposalRunStatus
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.explanation import Explanation
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.models.proposal.world import SetupSnapshot, World
from aica_api.storage.file_store import read_json, write_json_atomic

__all__ = [
    "ProposalRunNotFoundError",
    "create_run",
    "get_run",
    "list_runs",
    "delete_run",
    "append_event",
    "append_evidence",
    "append_explanation",
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
    setup_snapshot: SetupSnapshot | None = None,
    world: World | None = None,
    mode: ProposalRunMode = ProposalRunMode.interactive,
    runs_dir: pathlib.Path,
    cache: dict[str, ProposalRunLog] | None = None,
) -> ProposalRunLog:
    """Build a ``ProposalRunLog``, append any provided events/evidence, and
    persist it atomically to ``<runs_dir>/<run_id>.json``.

    Setup-time-only discipline: ``parameters``/``hyperparameters`` are
    deep-copied here so the persisted log is frozen at creation and immune
    to later mutation of the caller's dicts. ``content_parameters``/
    ``content_hyperparameters`` always start empty at creation (STEP 1) —
    they are frozen separately at STEP 2 by ``update_state`` once the
    reviewer has chosen a service and content package (see
    ``routers/proposal.py::select_service``).

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
        setup_snapshot:        Frozen P3 ``SetupSnapshot`` (typed-world path
                               only) — ``None`` for the legacy opaque
                               ``world_snapshot`` path (P1 back-compat).
        world:                 P7 addition: the run's base typed ``World``
                               (typed-world path only), deep-copied/frozen at
                               creation like ``parameters``/``hyperparameters``
                               — ``None`` for the legacy ``world_snapshot``-only
                               path (data-model.md §"Modified: ProposalRunLog").
        mode:                   P7 addition: the run's frozen
                               ``ProposalRunMode`` (interactive/quick_check).
        runs_dir:              Directory for persisting ``<run_id>.json``
                               (``settings.proposal_runs_dir`` in production
                               — NEVER the trigger ``runs_dir``).
        cache:                  Feature 020 (Slice-2c): when not ``None``,
                               store the built log at ``cache[run_id]``
                               instead of persisting to ``runs_dir`` —
                               ``runs_dir`` is then unused. ``None`` (the
                               default) preserves every existing call site's
                               disk-persisting behavior unchanged.

    Returns:
        The ``ProposalRunLog`` (persisted to disk, or written into ``cache``
        when supplied).
    """
    run_id = _make_run_id()
    run_log = ProposalRunLog(
        run_id=run_id,
        created_at=_now_iso(),
        opportunity=opportunity,
        matrix_version=matrix_version,
        world_snapshot=copy.deepcopy(world_snapshot),
        setup_snapshot=setup_snapshot,
        service_package_id=service_package_id,
        content_package_id=content_package_id,
        parameters=copy.deepcopy(parameters),
        hyperparameters=copy.deepcopy(hyperparameters),
        content_parameters={},
        content_hyperparameters={},
        journey_state=journey_state,
        events=list(events) if events else [],
        evidence=list(evidence) if evidence else [],
        status=status,
        world=copy.deepcopy(world) if world is not None else None,
        mode=mode,
    )
    if cache is not None:
        cache[run_id] = run_log
    else:
        _persist(run_log, pathlib.Path(runs_dir))
    return run_log


# ---------------------------------------------------------------------------
# Public API — get / list / delete
# ---------------------------------------------------------------------------


def get_run(
    run_id: str,
    runs_dir: pathlib.Path,
    *,
    cache: dict[str, ProposalRunLog] | None = None,
) -> ProposalRunLog | None:
    """Load the full ``ProposalRunLog`` for ``run_id``, or None.

    Renders from the persisted record WITHOUT recomputing any selector.

    Feature 020 (Slice-2c): when ``cache`` is not ``None``, reads from
    ``cache.get(run_id)`` instead of disk — ``runs_dir`` is then unused.
    """
    if cache is not None:
        return cache.get(run_id)
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
                mode=log.mode,
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


def append_event(
    run_id: str,
    event: DiscreteEvent,
    runs_dir: pathlib.Path,
    *,
    cache: dict[str, ProposalRunLog] | None = None,
) -> ProposalRunLog:
    """Append one ``DiscreteEvent`` to an existing run and re-persist.

    Feature 020 (Slice-2c): when ``cache`` is not ``None``, reads/writes
    ``cache[run_id]`` instead of disk — ``runs_dir`` is then unused for I/O.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir, cache=cache)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    run_log.events.append(event)
    if cache is not None:
        cache[run_id] = run_log
    else:
        _persist(run_log, pathlib.Path(runs_dir))
    return run_log


def append_evidence(
    run_id: str,
    evidence: AlgorithmEvidence,
    runs_dir: pathlib.Path,
    *,
    cache: dict[str, ProposalRunLog] | None = None,
) -> ProposalRunLog:
    """Append one ``AlgorithmEvidence`` to an existing run and re-persist.

    Feature 020 (Slice-2c): when ``cache`` is not ``None``, reads/writes
    ``cache[run_id]`` instead of disk — ``runs_dir`` is then unused for I/O.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir, cache=cache)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    run_log.evidence.append(evidence)
    if cache is not None:
        cache[run_id] = run_log
    else:
        _persist(run_log, pathlib.Path(runs_dir))
    return run_log


def append_explanation(run_id: str, explanation: Explanation, runs_dir: pathlib.Path) -> ProposalRunLog:
    """Append one ``Explanation`` (feature 019) to an existing run and re-persist.

    Append-only narration record for a generated rationale. Mirrors
    ``append_evidence``: load → append → atomic re-persist → return.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    run_log.explanations.append(explanation)
    _persist(run_log, pathlib.Path(runs_dir))
    return run_log


def update_state(
    run_id: str,
    runs_dir: pathlib.Path,
    *,
    status: ProposalRunStatus | None = None,
    journey_state: JourneyState | None = None,
    content_parameters: dict | None = None,
    content_hyperparameters: dict | None = None,
    setup_snapshot: SetupSnapshot | None = None,
    opportunity: ProposalOpportunity | None = None,
    world_snapshot: dict | None = None,
    opportunity_history: list[ProposalOpportunity] | None = None,
    setup_snapshot_history: list[SetupSnapshot] | None = None,
    cache: dict[str, ProposalRunLog] | None = None,
) -> ProposalRunLog:
    """Update ``status``/``journey_state``/content overrides on an existing
    run and re-persist.

    Feature 020 (Slice-2c): when ``cache`` is not ``None``, reads/writes
    ``cache[run_id]`` instead of disk — ``runs_dir`` is then unused for I/O.

    None of these fields is mutated by ``append_event``/``append_evidence``
    (which only ever append to their respective lists), so a STEP-2-style
    transition (e.g. ``content_selected`` + a newly-confirmed
    ``active_service_id`` + the content package's frozen parameter/
    hyperparameter overrides — FR-002a) needs this small, additive
    counterpart. Omitted (``None``) fields are left unchanged.

    ``content_parameters``/``content_hyperparameters`` are deep-copied here
    (mirroring ``create_run``'s ``parameters``/``hyperparameters`` freezing)
    so the persisted log is immune to later mutation of the caller's dicts —
    once set at STEP 2 they are setup-time-frozen, matching the service side.

    ``setup_snapshot``, when supplied, REPLACES ``run_log.setup_snapshot``
    wholesale (whole-branch review FIX 2) — used by
    ``routers/proposal.py::select_service`` to re-freeze
    ``SetupSnapshot.content_parameter_set_version`` (and
    ``content_contract_version``) to the CONTENT parameter set actually used
    at STEP 2, so the persisted snapshot never misrepresents what produced
    the run (FR-011/SC-008). This never changes what ``evaluate()`` receives
    or the returned plan — only persisted metadata.

    P7 additions (data-model.md §"Run-manager surface", research.md D4):
    ``opportunity``/``world_snapshot`` REPLACE the current head fields (the
    same "current head" ``ProposalRunLog.opportunity``/``world_snapshot`` a
    recompute re-freezes); ``opportunity_history``/``setup_snapshot_history``
    REPLACE the append-only history lists WHOLESALE with the caller-assembled
    list (the caller — the recompute endpoint — is responsible for having
    already appended the prior head before calling this). All four are
    deep-copied here, mirroring ``content_parameters``/
    ``content_hyperparameters``'s freezing discipline, so a later mutation of
    the caller's own objects never retroactively changes the persisted log.

    Raises:
        ProposalRunNotFoundError: If run_id has no persisted log.
    """
    run_log = get_run(run_id, runs_dir, cache=cache)
    if run_log is None:
        raise ProposalRunNotFoundError(f"Unknown proposal run_id: {run_id!r}")
    if status is not None:
        run_log.status = status
    if journey_state is not None:
        run_log.journey_state = journey_state
    if content_parameters is not None:
        run_log.content_parameters = copy.deepcopy(content_parameters)
    if content_hyperparameters is not None:
        run_log.content_hyperparameters = copy.deepcopy(content_hyperparameters)
    if setup_snapshot is not None:
        run_log.setup_snapshot = setup_snapshot
    if opportunity is not None:
        run_log.opportunity = copy.deepcopy(opportunity)
    if world_snapshot is not None:
        run_log.world_snapshot = copy.deepcopy(world_snapshot)
    if opportunity_history is not None:
        run_log.opportunity_history = copy.deepcopy(opportunity_history)
    if setup_snapshot_history is not None:
        run_log.setup_snapshot_history = copy.deepcopy(setup_snapshot_history)
    if cache is not None:
        cache[run_id] = run_log
    else:
        _persist(run_log, pathlib.Path(runs_dir))
    return run_log
