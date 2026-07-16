"""Pure P4 journey-engine skeleton (data-model.md §"JourneyAction (request) /
JourneyTransition (engine output)"; contracts/journey-api.md §"POST
/api/proposal/runs/{run_id}/journey/action").

``apply_action`` is the SOLE entry point: given the run's current log and a
requested action, it returns a ``JourneyTransition`` describing what should
happen next — new events, the new journey state, and the new run status —
WITHOUT ever touching the clock, a random source, or the filesystem. The
timestamp (``now``) is minted by the CALLER (``routers/proposal.py``'s action
endpoint) and threaded in as a parameter; persisting the transition's result
(appending events, updating state) is also the router's job, via
``services/proposal_run_manager``. This module never imports that manager,
and never reads/writes a file.

THIS UNIT ships only the dispatch SKELETON: a small table mapping every
``JourneyActionType`` to a handler. All handlers are the SAME stub for now —
each rejects with ``code="invalid_precondition"`` — since real accept/reject/
postpone/choose_another/request_more/complete/continue/stop/motion_change/
rest_* behavior is implemented by later P4 units (US2/US3/US4). Those units
replace individual ``_HANDLERS`` entries in place; `apply_action` itself, and
the rejection shape, are the stable seam and need no restructuring.

This module is ISOLATED from trigger models/algorithms:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
"""
from __future__ import annotations

from collections.abc import Callable

from aica_api.models.proposal.enums import JourneyActionType
from aica_api.models.proposal.journey_action import (
    JourneyAction,
    JourneyTransition,
    TransitionRejection,
)
from aica_api.models.proposal.proposal_run import ProposalRunLog

__all__ = ["apply_action"]


_Handler = Callable[[ProposalRunLog, JourneyAction, str], JourneyTransition]


def _reject(run_log: ProposalRunLog, code: str, message: str) -> JourneyTransition:
    """Build a no-op rejection transition: state/status carried over
    unchanged from `run_log`, no events appended (contracts/journey-api.md:
    "Never a silent no-op" — the rejection itself IS the signal)."""
    return JourneyTransition(
        events=[],
        new_journey_state=run_log.journey_state,
        new_status=run_log.status,
        rejected=TransitionRejection(code=code, message=message),
    )


def _not_yet_implemented(
    run_log: ProposalRunLog, action: JourneyAction, now: str
) -> JourneyTransition:
    """Shared stub for every ``JourneyActionType`` in this unit.

    # TODO(US2/US3/US4): replace this stub in `_HANDLERS` with the real
    # accept / reject / postpone / choose_another / request_more / complete /
    # continue_ / stop / motion_change / rest_spot_arrived / rest_started /
    # rest_completed handler for each action. Each real handler has this same
    # signature `(run_log, action, now) -> JourneyTransition` and must stay
    # pure (no clock/random/IO) — `now` is the only timestamp source.
    """
    del now  # unused by the stub; real handlers will stamp event `at` with it
    return _reject(
        run_log,
        "invalid_precondition",
        (
            f"Action {action.action_type.value!r} is not yet implemented / "
            f"アクション「{action.action_type.value}」は未実装です"
        ),
    )


# Dispatch table — the stable seam later units slot real handlers into.
# Every JourneyActionType has an entry so `apply_action` never needs an
# elif-chain rewrite when a handler is implemented; only the mapped value
# changes.
_HANDLERS: dict[JourneyActionType, _Handler] = {
    action_type: _not_yet_implemented for action_type in JourneyActionType
}


def apply_action(
    run_log: ProposalRunLog, action: JourneyAction, *, now: str
) -> JourneyTransition:
    """Apply one journey action to `run_log`'s current state.

    PURE: no clock, no randomness, no file I/O. `now` is the caller-minted
    timestamp string threaded through to handlers (this unit's stub handlers
    ignore it).

    An `action.action_type` with no entry in `_HANDLERS` (should not occur
    for a `JourneyAction` built through normal pydantic validation, since
    `JourneyActionType` is a closed enum — this defends against a
    fabricated/bypassed value, e.g. via `model_construct`) is rejected the
    same way an implemented-but-precondition-failing action is.
    """
    handler = _HANDLERS.get(action.action_type)
    if handler is None:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                f"Unknown action_type: {action.action_type!r} / "
                f"未知のアクション種別: {action.action_type!r}"
            ),
        )
    return handler(run_log, action, now)
