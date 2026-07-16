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

US2 implements the real ``accept``/``complete``/``continue_``/``stop``
handlers — the mocked-accepted-plan lifecycle (spec.md User Story 2;
FR-008..FR-010, FR-012, SC-004). US3 (this unit) implements the real
``reject``/``choose_another``/``request_more``/``postpone`` handlers — the
advisory service-stage actions that must never dead-end the run (spec.md
User Story 3; FR-007, FR-011..FR-013, SC-005). US4 implements the real
``motion_change``/``rest_spot_arrived``/``rest_started``/``rest_completed``
handlers — deterministic motion-driven screen/background/stop behavior plus
eligibility re-evaluation, and the rest-stage journey transitions (spec.md
User Story 4; FR-014..FR-016, SC-006). Only `motion_change` needs the
optional `capabilities` parameter `apply_action` threads through to every
handler.

This module is ISOLATED from trigger models/algorithms:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
"""
from __future__ import annotations

from collections.abc import Callable

from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    LifecycleStage,
    MotionState,
    PlaybackState,
    ProposalRunStatus,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.journey import PreviousContent
from aica_api.models.proposal.journey_action import (
    JourneyAction,
    JourneyTransition,
    TransitionRejection,
)
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.models.proposal.service_capabilities import ServiceCapabilities
from aica_api.services.proposal_eligibility import derive_registered_entities, resolve_eligibility

__all__ = ["apply_action"]


_Handler = Callable[
    [ProposalRunLog, JourneyAction, str, "ServiceCapabilities | None"], JourneyTransition
]


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
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """Shared stub for every ``JourneyActionType`` not yet implemented.

    Every handler in ``_HANDLERS`` shares this signature
    `(run_log, action, now, capabilities) -> JourneyTransition` and must stay
    pure (no clock/random/IO) — `now` is the only timestamp source and
    `capabilities` is the only IO-derived data, both passed in by the caller
    (``apply_action``), never fetched here.
    """
    del now, capabilities  # unused by the stub
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


def _service_evidence(run_log: ProposalRunLog) -> AlgorithmEvidence | None:
    """Return the last committed (non-error) SERVICE-step evidence — its
    ``.output`` is the ``ServiceSelectorOutput`` dict (``ranked_candidates``)
    and its ``.input_snapshot`` carries the frozen US1 eligible set
    (``eligible_candidates``) — or ``None`` if the run has no such evidence
    yet (mirrors ``_committed_plan`` above, one step earlier in the flow)."""
    for evidence in reversed(run_log.evidence):
        if evidence.step == "service" and evidence.error is None:
            return evidence
    return None


def _eligible_pool(run_log: ProposalRunLog) -> list[str]:
    """The ordered pool of eligible service-candidate ids that US3's
    advisory actions (reject/choose_another/request_more) draw from: the
    SERVICE evidence's ``input_snapshot['eligible_candidates']`` ids (US1's
    frozen eligible set — data-model.md §"Relationships & lifecycle"),
    ordered by the service output's ``ranked_candidates`` rank first, then
    any remaining eligible ids in their original eligible-set order.

    No re-scoring: this reads the EXISTING service evidence only — it never
    dispatches a selector. Returns ``[]`` if there is no committed SERVICE
    evidence (e.g. a bare/synthetic ``ProposalRunLog`` in a unit test)."""
    evidence = _service_evidence(run_log)
    if evidence is None:
        return []
    eligible_ids = [
        candidate["candidate_id"]
        for candidate in evidence.input_snapshot.get("eligible_candidates", [])
    ]
    ranked = evidence.output.get("ranked_candidates", []) if evidence.output else []
    ranked_ids = [
        candidate["candidate_id"]
        for candidate in sorted(ranked, key=lambda c: c["rank"])
        if candidate["candidate_id"] in eligible_ids
    ]
    remaining_ids = [cid for cid in eligible_ids if cid not in ranked_ids]
    return ranked_ids + remaining_ids


# ---------------------------------------------------------------------------
# US3 handlers — reject / choose_another / request_more / postpone (spec.md
# User Story 3; FR-007, FR-011..FR-013, SC-005): advisory service actions
# never dead-end the run. ``rejected_service_ids`` drives non-re-offer;
# rejecting never dead-ends the run while an eligible candidate remains, and
# when the pool is fully exhausted an explicit ``NO_ELIGIBLE_CANDIDATE``
# event is emitted — a success end-state, never a crash/error.
# ``choose_another``/``request_more`` reuse the EXISTING ``_eligible_pool``
# ranking/order — neither ever dispatches a selector or adds a new
# ``AlgorithmEvidence`` (no re-scoring).
# ---------------------------------------------------------------------------


def _reject_service(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-011/FR-013: reject the currently-offered service.

    The offered service is ``journey_state.active_service_id`` unless the
    caller names a different one via ``payload["selected_service_id"]``.
    Recorded into ``rejected_service_ids`` (never re-offered — FR-011) and
    ``active_service_id`` is cleared. If the eligible pool still has an
    id not yet rejected, the run stays open at ``service_selected`` (SC-005
    — not dead-ended). If NONE remain, an explicit ``NO_ELIGIBLE_CANDIDATE``
    event is ALSO emitted alongside ``SERVICE_REJECTED`` — a success
    end-state, not an error/crash (FR-013).

    FR-012 payload hardening: an unrecognized ``selected_service_id`` string
    (not a valid ``ServiceId`` member) is a structured ``invalid_payload``
    rejection, never a raw ``ValueError`` (-> 500)."""
    if run_log.status != ProposalRunStatus.service_selected:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "reject requires a service_selected run / "
                "rejectはservice_selected状態のランでのみ有効です"
            ),
        )
    js = run_log.journey_state
    payload_service_id = action.payload.get("selected_service_id")
    if payload_service_id is not None:
        try:
            offered = ServiceId(payload_service_id)
        except ValueError:
            return _reject(
                run_log,
                "invalid_payload",
                (
                    f"Unknown selected_service_id: {payload_service_id!r} / "
                    f"不明なselected_service_id: {payload_service_id!r}"
                ),
            )
    else:
        offered = js.active_service_id
    if offered is None:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "No offered service to reject / "
                "拒否する提示中のサービスがありません"
            ),
        )

    rejected_ids: list[ServiceId] = list(js.rejected_service_ids)
    if offered not in rejected_ids:
        rejected_ids.append(offered)

    events = [
        DiscreteEvent(
            event_type=DiscreteEventType.SERVICE_REJECTED,
            at=now,
            payload={"rejected_service_id": offered.value},
        )
    ]

    pool = _eligible_pool(run_log)
    remaining = [cid for cid in pool if cid not in rejected_ids]
    if not remaining:
        events.append(
            DiscreteEvent(
                event_type=DiscreteEventType.NO_ELIGIBLE_CANDIDATE,
                at=now,
                payload={"rejected_service_ids": [sid.value for sid in rejected_ids]},
            )
        )

    new_journey_state = js.model_copy(
        update={"active_service_id": None, "rejected_service_ids": rejected_ids}
    )
    return JourneyTransition(
        events=events,
        new_journey_state=new_journey_state,
        new_status=ProposalRunStatus.service_selected,
    )


def _choose_another(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-011: advance to the next eligible, non-rejected candidate — reuses
    the EXISTING ``_eligible_pool`` order (no re-scoring, no new
    ``AlgorithmEvidence``). When no further candidate remains, a structured
    ``TransitionRejection(code="no_eligible_candidate")`` is returned
    (FR-012) — distinct from ``reject``'s success-shaped
    ``NO_ELIGIBLE_CANDIDATE`` event: there is nothing left to switch TO, so
    no state change is applied."""
    if run_log.status != ProposalRunStatus.service_selected:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "choose_another requires a service_selected run / "
                "choose_anotherはservice_selected状態のランでのみ有効です"
            ),
        )
    js = run_log.journey_state
    pool = _eligible_pool(run_log)
    next_id = next(
        (
            cid
            for cid in pool
            if cid not in js.rejected_service_ids and cid != js.active_service_id
        ),
        None,
    )
    if next_id is None:
        return _reject(
            run_log,
            "no_eligible_candidate",
            (
                "No further eligible candidate to switch to / "
                "切り替え可能な適格候補がこれ以上ありません"
            ),
        )

    # `next_id` is drawn from `_eligible_pool` (US1's frozen eligible set /
    # committed service-selector ranking), not a user-supplied payload value
    # -- but wrapped defensively anyway (FR-012) so a corrupt persisted log
    # can never surface as a raw 500.
    try:
        next_service_id = ServiceId(next_id)
    except ValueError:
        return _reject(
            run_log,
            "invalid_payload",
            (
                f"Eligible pool contains an unknown service id: {next_id!r} / "
                f"適格候補プールに不明なサービスIDが含まれています: {next_id!r}"
            ),
        )
    rank: int | None = None
    evidence = _service_evidence(run_log)
    if evidence is not None and evidence.output:
        for candidate in evidence.output.get("ranked_candidates", []):
            if candidate["candidate_id"] == next_id:
                rank = candidate["rank"]
                break

    selected_payload: dict = {"selected_service_id": next_id}
    if rank is not None:
        selected_payload["rank"] = rank

    events = [
        DiscreteEvent(
            event_type=DiscreteEventType.CHOOSE_ANOTHER,
            at=now,
            payload={"selected_service_id": next_id},
        ),
        DiscreteEvent(
            event_type=DiscreteEventType.SERVICE_SELECTED,
            at=now,
            payload=selected_payload,
        ),
    ]
    new_journey_state = js.model_copy(update={"active_service_id": next_service_id})
    return JourneyTransition(
        events=events,
        new_journey_state=new_journey_state,
        new_status=ProposalRunStatus.service_selected,
    )


def _request_more(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-011: surface the remaining eligible candidates WITHOUT producing
    any new score — reuses ``_eligible_pool`` (no selector dispatch, no new
    ``AlgorithmEvidence``). State is unchanged otherwise."""
    if run_log.status != ProposalRunStatus.service_selected:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "request_more requires a service_selected run / "
                "request_moreはservice_selected状態のランでのみ有効です"
            ),
        )
    js = run_log.journey_state
    pool = _eligible_pool(run_log)
    remaining = [cid for cid in pool if cid not in js.rejected_service_ids]
    event = DiscreteEvent(
        event_type=DiscreteEventType.REQUEST_MORE,
        at=now,
        payload={"remaining_candidate_ids": remaining},
    )
    return JourneyTransition(
        events=[event],
        new_journey_state=js,
        new_status=run_log.status,
    )


def _postpone(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-011: postpone the current proposal — the opportunity returns to an
    open state. Kept minimal: ``active_service_id`` is left as-is and
    ``status`` moves to (or stays at) ``service_selected`` so a later action
    remains reachable, even when postponing away from ``content_selected``."""
    if run_log.status not in (
        ProposalRunStatus.service_selected,
        ProposalRunStatus.content_selected,
    ):
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "postpone requires a service_selected or content_selected run / "
                "postponeはservice_selectedまたはcontent_selected状態のランでのみ有効です"
            ),
        )
    event = DiscreteEvent(event_type=DiscreteEventType.POSTPONED, at=now, payload={})
    return JourneyTransition(
        events=[event],
        new_journey_state=run_log.journey_state,
        new_status=ProposalRunStatus.service_selected,
    )


# ---------------------------------------------------------------------------
# US2 handlers — accept / complete / continue_ / stop (mocked accepted-plan
# lifecycle; data-model.md §"Relationships & lifecycle" happy path:
#   content_selected -> [accept] content_started -> [complete] content_completed
#   -> [continue] content_completed (event only, P4 scope) | [stop] content_stopped
# ---------------------------------------------------------------------------


def _accept(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
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


def _complete(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
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


def _continue(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
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


def _stop(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
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


# ---------------------------------------------------------------------------
# US4 handlers — motion_change / rest_spot_arrived / rest_started /
# rest_completed (spec.md User Story 4; FR-014..FR-016, SC-006).
# ---------------------------------------------------------------------------


def _motion_change(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-014/SC-006: deterministically apply screen/background/stop
    behavior to any active plan on a motion change, and re-evaluate
    eligibility (research.md D5). Valid from any run status/state — the
    only hard precondition is that the caller (the router) actually supplies
    `capabilities`; a missing one (should not occur outside a defensive/
    synthetic call — the router always supplies it) is rejected rather than
    silently skipping the capability-driven branch.

    `active_plan_disposition` in the emitted event is one of:
      - `"none"`        -- no active/backgrounded plan to affect.
      - `"backgrounded"` -- driving + `background_on_motion` service: screen
        suppressed, playback continues.
      - `"stopped"`     -- driving + hard stopped-only / non-backgroundable
        screen-dependent service (`full_karaoke` is special-cased ahead of
        the generic `stopped_only` check, mirroring
        `resolve_eligibility`'s own D2 ordering).
      - `"unchanged"`   -- every other case: a driving-capable audio plan
        stays `active` while driving (never suppressed), and ANY transition
        to `stopped` is "no forced stop" (research.md D5) — a previously
        `backgrounded` plan simply resumes to `active`, which isn't a
        distinct disposition bucket of its own.

    FR-012 payload hardening: a missing/invalid `motion_state` is a
    structured `invalid_payload` rejection, never a raw `ValueError`.
    """
    if capabilities is None:
        return _reject(
            run_log,
            "capabilities_unavailable",
            (
                "motion_change requires ServiceCapabilities / "
                "motion_changeにはServiceCapabilitiesが必要です"
            ),
        )

    raw_motion_state = action.payload.get("motion_state")
    try:
        new_motion = MotionState(raw_motion_state)
    except ValueError:
        return _reject(
            run_log,
            "invalid_payload",
            (
                f"Invalid or missing motion_state: {raw_motion_state!r} / "
                f"無効または欠落したmotion_state: {raw_motion_state!r}"
            ),
        )

    js = run_log.journey_state
    has_active_plan = js.active_service_id is not None and js.playback_state in (
        PlaybackState.active,
        PlaybackState.backgrounded,
    )

    new_playback_state = js.playback_state
    disposition = "none"

    if has_active_plan:
        disposition = "unchanged"
        if new_motion == MotionState.driving:
            cap = capabilities.get(js.active_service_id)
            if cap.background_on_motion:
                new_playback_state = PlaybackState.backgrounded
                disposition = "backgrounded"
            elif (
                js.active_service_id == ServiceId.full_karaoke
                or cap.stopped_only
                or (cap.screen_dependent and not cap.background_on_motion)
            ):
                new_playback_state = PlaybackState.stopped
                disposition = "stopped"
        else:  # new_motion == MotionState.stopped
            if js.playback_state == PlaybackState.backgrounded:
                new_playback_state = PlaybackState.active

    new_journey_state = js.model_copy(
        update={"motion_state": new_motion, "playback_state": new_playback_state}
    )

    registered_entities = derive_registered_entities(run_log.world_snapshot)
    eligibility_result = resolve_eligibility(
        run_log.opportunity.allowed_service_ids,
        new_motion,
        capabilities,
        registered_entities=registered_entities,
    )
    event = DiscreteEvent(
        event_type=DiscreteEventType.MOTION_CHANGED,
        at=now,
        payload={
            "motion_state": new_motion.value,
            "active_plan_disposition": disposition,
            "eligible": [sid.value for sid in eligibility_result.eligible],
            "excluded": [
                {
                    "candidate_id": excl.service_id.value,
                    "platform_reason": ",".join(rc.value for rc in excl.reason_codes),
                }
                for excl in eligibility_result.excluded
            ],
        },
    )
    return JourneyTransition(
        events=[event],
        new_journey_state=new_journey_state,
        new_status=run_log.status,
    )


def _rest_spot_arrived(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-015: arriving at a rest spot sets motion `stopped` and lifecycle
    stage `during_rest_stopped` -- a journey event only (FR-016: no ranked
    candidate is ever fabricated for this transition)."""
    if run_log.opportunity.trigger_purpose != TriggerPurpose.rest_recommended:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "rest_spot_arrived requires a rest_recommended opportunity / "
                "rest_spot_arrivedはrest_recommended機会でのみ有効です"
            ),
        )
    new_journey_state = run_log.journey_state.model_copy(
        update={
            "motion_state": MotionState.stopped,
            "lifecycle_stage": LifecycleStage.during_rest_stopped,
        }
    )
    event = DiscreteEvent(event_type=DiscreteEventType.REST_SPOT_ARRIVED, at=now, payload={})
    return JourneyTransition(
        events=[event],
        new_journey_state=new_journey_state,
        new_status=run_log.status,
    )


def _rest_started(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-015: rest formally begins -- a journey event only; no state change
    beyond recording it (the run is already `during_rest_stopped`/`stopped`
    from `rest_spot_arrived`)."""
    if run_log.journey_state.lifecycle_stage != LifecycleStage.during_rest_stopped:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "rest_started requires lifecycle_stage=during_rest_stopped / "
                "rest_startedはduring_rest_stopped状態でのみ有効です"
            ),
        )
    event = DiscreteEvent(event_type=DiscreteEventType.REST_STARTED, at=now, payload={})
    return JourneyTransition(
        events=[event],
        new_journey_state=run_log.journey_state,
        new_status=run_log.status,
    )


def _rest_completed(
    run_log: ProposalRunLog,
    action: JourneyAction,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """FR-015/FR-016: rest completion applies the EXPLICIT supplied
    post-rest driver-state values, moves lifecycle stage to
    `after_rest_before_restart`, and opens a fresh opportunity -- at the
    EVENT level only. No matrix/selector re-dispatch happens here (no
    ranked candidate is fabricated for the new stage); a full post-rest
    re-proposal (matrix resolve + selector dispatch) is P7 or a fresh run
    (research.md D7).

    FR-012 payload hardening: a missing `post_rest`, or a `drowsiness_level`/
    `fatigue_level` that is absent, not an int, or outside 0..100, is a
    structured `invalid_payload` rejection, never a raw KeyError/ValueError.
    """
    if run_log.journey_state.lifecycle_stage != LifecycleStage.during_rest_stopped:
        return _reject(
            run_log,
            "invalid_precondition",
            (
                "rest_completed requires lifecycle_stage=during_rest_stopped / "
                "rest_completedはduring_rest_stopped状態でのみ有効です"
            ),
        )

    post_rest = action.payload.get("post_rest")
    if not isinstance(post_rest, dict):
        return _reject(
            run_log,
            "invalid_payload",
            (
                "rest_completed requires a post_rest object with "
                "drowsiness_level and fatigue_level / "
                "rest_completedにはdrowsiness_levelとfatigue_levelを含む"
                "post_restオブジェクトが必要です"
            ),
        )

    def _valid_level(value: object) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100

    drowsiness_level = post_rest.get("drowsiness_level")
    fatigue_level = post_rest.get("fatigue_level")
    if not _valid_level(drowsiness_level) or not _valid_level(fatigue_level):
        return _reject(
            run_log,
            "invalid_payload",
            (
                "post_rest.drowsiness_level and post_rest.fatigue_level "
                "must each be an int in 0..100 / "
                "post_rest.drowsiness_levelとpost_rest.fatigue_levelは"
                "それぞれ0から100の整数である必要があります"
            ),
        )

    new_journey_state = run_log.journey_state.model_copy(
        update={"lifecycle_stage": LifecycleStage.after_rest_before_restart}
    )
    events = [
        DiscreteEvent(
            event_type=DiscreteEventType.REST_COMPLETED,
            at=now,
            payload={"drowsiness_level": drowsiness_level, "fatigue_level": fatigue_level},
        ),
        DiscreteEvent(
            event_type=DiscreteEventType.OPPORTUNITY_OPENED,
            at=now,
            payload={
                "trigger_purpose": run_log.opportunity.trigger_purpose.value,
                "lifecycle_stage": LifecycleStage.after_rest_before_restart.value,
            },
        ),
    ]
    return JourneyTransition(
        events=events,
        new_journey_state=new_journey_state,
        new_status=run_log.status,
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
_HANDLERS[JourneyActionType.reject] = _reject_service
_HANDLERS[JourneyActionType.choose_another] = _choose_another
_HANDLERS[JourneyActionType.request_more] = _request_more
_HANDLERS[JourneyActionType.postpone] = _postpone
_HANDLERS[JourneyActionType.motion_change] = _motion_change
_HANDLERS[JourneyActionType.rest_spot_arrived] = _rest_spot_arrived
_HANDLERS[JourneyActionType.rest_started] = _rest_started
_HANDLERS[JourneyActionType.rest_completed] = _rest_completed


def apply_action(
    run_log: ProposalRunLog,
    action: JourneyAction,
    *,
    now: str,
    capabilities: ServiceCapabilities | None = None,
) -> JourneyTransition:
    """Apply one journey action to `run_log`'s current state.

    PURE: no clock, no randomness, no file I/O. `now` is the caller-minted
    timestamp string threaded through to handlers; `capabilities` is
    caller-loaded data (the router's `_get_service_capabilities()`) threaded
    through the same way -- the engine never loads it itself. Only
    `motion_change` actually uses `capabilities`; every other handler
    ignores it, and it defaults to `None` so every pre-existing caller (US2/
    US3 tests, this module's own callers before this unit) keeps working
    unchanged.

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
    return handler(run_log, action, now, capabilities)
