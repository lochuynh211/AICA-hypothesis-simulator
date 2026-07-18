"""Pure recovery-phase state machine (Approach A).

Drives a RecoveryState through an option's ordered stages. No I/O, no engine
coupling — the tick engine calls advance_recovery once per tick and applies the
motion/recovery effects from the returned phase.
"""
from __future__ import annotations
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption, RecoveryStage


def current_stage(state: RecoveryState, option: RecoveryOption) -> RecoveryStage | None:
    if state.stage_index < 0 or state.stage_index >= len(option.stages):
        return None
    return option.stages[state.stage_index]


def start_recovery(option: RecoveryOption, rest_spot: RestSpot) -> RecoveryState:
    first = option.stages[0] if option.stages else None
    return RecoveryState(
        active=True,
        option_id=option.id,
        rest_spot=rest_spot,
        phase=(first.phase if first else "resuming"),
        stage_index=0,
        stage_ticks_remaining=(first.ticks or 0) if first else 0,
    )


def _enter_stage(state: RecoveryState, option: RecoveryOption, index: int) -> RecoveryState:
    # Feature 020 (Slice-2 core, review fix): reset the MOVING-stage recovery
    # accrual counters on every stage transition, so a cap_drowsiness/
    # cap_fatigue applied to a later stage's own aggregate never inherits an
    # earlier stage's accrued total.
    _reset_accrual = {
        "moving_recovery_accrued_drowsiness": 0.0,
        "moving_recovery_accrued_fatigue": 0.0,
    }
    if index >= len(option.stages):
        return state.model_copy(update={
            "phase": "resuming", "stage_index": index, "stage_ticks_remaining": 0,
            **_reset_accrual,
        })
    stage = option.stages[index]
    return state.model_copy(update={
        "phase": stage.phase, "stage_index": index, "stage_ticks_remaining": stage.ticks or 0,
        **_reset_accrual,
    })


def advance_recovery(state: RecoveryState, option: RecoveryOption, *, at_rest_spot: bool) -> RecoveryState:
    if state.phase == "resuming":
        return state.model_copy(update={"active": False, "phase": None})

    stage = current_stage(state, option)
    if stage is None:
        return state.model_copy(update={"phase": "resuming", "stage_ticks_remaining": 0})

    # MOVING wakefulness: hold until the car reaches the rest spot.
    if stage.motion == "MOVING":
        if not at_rest_spot:
            return state                      # keep driving toward the spot
        return _enter_stage(state, option, state.stage_index + 1)

    # STOPPED stage: count down its dwell ticks, then move on.
    remaining = state.stage_ticks_remaining - 1
    if remaining > 0:
        return state.model_copy(update={"stage_ticks_remaining": remaining})
    return _enter_stage(state, option, state.stage_index + 1)
