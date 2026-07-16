"""Pure P4 journey-engine (data-model.md §"JourneyAction (request) /
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

US2 (this unit) implements the real ``accept``/``complete``/``continue_``/
``stop`` handlers — the mocked-accepted-plan lifecycle (spec.md User Story
2; FR-008..FR-010, FR-012, SC-004). The remaining action types (reject/
postpone/choose_another/request_more/motion_change/rest_*) are implemented
by later P4 units (US3/US4); those units replace the remaining
``_HANDLERS`` entries in place — `apply_action` itself, and the rejection
shape, are the stable seam and need no restructuring.

This module is ISOLATED from trigger models/algorithms:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
"""
from __future__ import annotations

from collections.abc import Callable

from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    PlaybackState,
    ProposalRunStatus,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.journey import PreviousContent
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
    """Shared stub for every ``JourneyActionType`` not yet implemented.

    # TODO(US3/US4): replace this stub in `_HANDLERS` with the real
    # reject / postpone / choose_another / request_more / motion_change /
    # rest_spot_arrived / rest_started / rest_completed handler for each
    # action. Each real handler has this same signature
    # `(run_log, action, now) -> JourneyTransition` and must stay pure (no
    # clock/random/IO) — `now` is the only timestamp source.
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


def _committed_plan(run_log: ProposalRunLog) -> dict | None:
    """Return the last committed (non-error) CONTENT-step evidence output —
    the ``CompletePlan`` dict (has ``completion_rule``/``next_transition_
    policy``/``approval_policy``/``mode``) — or ``None`` if the run has no
    such evidence yet.

    Never fabricated: this reads exactly what ``routers/proposal.py::
    select_service`` committed via ``dispatch_selector`` at STEP 2.
    """
    for evidence in reversed(run_log.evidence):
        if evidence.step == "content" and evidence.error is None:
            return evidence.output
    return None


# ---------------------------------------------------------------------------
# US2 handlers — accept / complete / continue_ / stop (mocked accepted-plan
# lifecycle; data-model.md §"Relationships & lifecycle" happy path:
#   content_selected -> [accept] content_started -> [complete] content_completed
#   -> [continue] content_completed (event only, P4 scope) | [stop] content_stopped
# ---------------------------------------------------------------------------


def _accept(run_log: ProposalRunLog, action: JourneyAction, now: str) -> JourneyTransition:
    """FR-009: accepting a selected content plan starts it (active content)
    and records a start event."""
    if run_log.status != ProposalRunStatus.content_selected:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "accept requires a content_selected run / "
                "acceptはcontent_selected状態のランでのみ有効です"
            ),
        )
    plan = _committed_plan(run_log)
    if plan is None:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "No committed content plan to accept / "
                "承認する確定済みコンテンツプランがありません"
            ),
        )

    js = run_log.journey_state
    # Capture the pre-accept snapshot (whatever was active/plan-referenced
    # before this accept, if anything) so `stop` can restore it later.
    previous_content = PreviousContent(
        service_id=js.active_service_id, plan_ref=js.current_plan_ref
    )
    # `active_service_id` is already the STEP-2 selected service; accept
    # doesn't change WHICH service is active, only that it now has a
    # committed, playing plan. `current_plan_ref` is a deterministic ref
    # derived from the committed plan's own `selected_service_id`
    # (documented format: "<selected_service_id>-plan").
    plan_ref = f"{plan['selected_service_id']}-plan"
    new_journey_state = js.model_copy(
        update={
            "active_service_id": js.active_service_id,
            "current_plan_ref": plan_ref,
            "playback_state": PlaybackState.active,
            "previous_content": previous_content,
        }
    )
    event = DiscreteEvent(
        event_type=DiscreteEventType.CONTENT_STARTED,
        at=now,
        payload={
            "selected_service_id": (
                js.active_service_id.value if js.active_service_id is not None else None
            )
        },
    )
    return JourneyTransition(
        events=[event],
        new_journey_state=new_journey_state,
        new_status=ProposalRunStatus.content_started,
    )


def _complete(run_log: ProposalRunLog, action: JourneyAction, now: str) -> JourneyTransition:
    """FR-009: completing records a completion event and applies the plan's
    completion policy (P4: the policy string itself is only recorded/
    consumed by `continue_`; no further behavior is fabricated here)."""
    if run_log.journey_state.playback_state != PlaybackState.active:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "complete requires an active playback state / "
                "completeはplayback_state=active状態でのみ有効です"
            ),
        )
    new_journey_state = run_log.journey_state.model_copy(
        update={"playback_state": PlaybackState.completed}
    )
    event = DiscreteEvent(event_type=DiscreteEventType.CONTENT_COMPLETED, at=now, payload={})
    return JourneyTransition(
        events=[event],
        new_journey_state=new_journey_state,
        new_status=ProposalRunStatus.content_completed,
    )


def _continue(run_log: ProposalRunLog, action: JourneyAction, now: str) -> JourneyTransition:
    """FR-009: continuing MUST follow the plan's next-transition policy.

    P4 scope: this records the policy-driven `CONTINUE_REQUESTED` event
    only — it does NOT itself open a new opportunity (that is US4/rest
    scope) — so `playback_state`/`status` are carried over unchanged."""
    if run_log.journey_state.playback_state != PlaybackState.completed:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "continue requires a completed playback state / "
                "continueはplayback_state=completed状態でのみ有効です"
            ),
        )
    plan = _committed_plan(run_log)
    if plan is None:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "No committed content plan to continue / "
                "継続する確定済みコンテンツプランがありません"
            ),
        )
    event = DiscreteEvent(
        event_type=DiscreteEventType.CONTINUE_REQUESTED,
        at=now,
        payload={"next_transition_policy": plan["next_transition_policy"]},
    )
    return JourneyTransition(
        events=[event],
        new_journey_state=run_log.journey_state,
        new_status=run_log.status,
    )


def _stop(run_log: ProposalRunLog, action: JourneyAction, now: str) -> JourneyTransition:
    """FR-009/FR-010: stopping MUST restore the previously-playing content
    and record a restoration event.

    Valid from `active`/`backgrounded` (a plan currently playing/suppressed)
    AND from `completed` (a plan that finished but was not yet continued) —
    widened beyond active/backgrounded so the full spec.md US2 Independent
    Test / SC-004 sequence (accept -> complete -> continue -> stop) can run
    end-to-end on one run: `continue_` intentionally leaves `playback_state`
    at `completed` (P4 scope, above), so `stop` must still be reachable from
    there to restore the pre-accept content."""
    if run_log.journey_state.playback_state not in (
        PlaybackState.active,
        PlaybackState.backgrounded,
        PlaybackState.completed,
    ):
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "stop requires an active, backgrounded, or completed plan / "
                "stopはactive・backgrounded・completed状態でのみ有効です"
            ),
        )
    js = run_log.journey_state
    previous = js.previous_content
    restored_service_id = previous.service_id if previous is not None else None
    restored_plan_ref = previous.plan_ref if previous is not None else None
    new_journey_state = js.model_copy(
        update={
            "active_service_id": restored_service_id,
            "current_plan_ref": restored_plan_ref,
            "previous_content": None,
            "playback_state": PlaybackState.stopped,
        }
    )
    event = DiscreteEvent(
        event_type=DiscreteEventType.RETURN_TO_PREVIOUS_CONTENT,
        at=now,
        payload={
            "restored_service_id": (
                restored_service_id.value if restored_service_id is not None else None
            )
        },
    )
    return JourneyTransition(
        events=[event],
        new_journey_state=new_journey_state,
        new_status=ProposalRunStatus.content_stopped,
    )


# Dispatch table — the stable seam later units slot real handlers into.
# Every JourneyActionType has an entry so `apply_action` never needs an
# elif-chain rewrite when a handler is implemented; only the mapped value
# changes.
_HANDLERS: dict[JourneyActionType, _Handler] = {
    action_type: _not_yet_implemented for action_type in JourneyActionType
}
_HANDLERS[JourneyActionType.accept] = _accept
_HANDLERS[JourneyActionType.complete] = _complete
_HANDLERS[JourneyActionType.continue_] = _continue
_HANDLERS[JourneyActionType.stop] = _stop


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
