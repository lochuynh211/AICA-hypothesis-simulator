"""TriggerTickAdapter — pure mapping from a trigger tick to a proposal World.

Feature 020 (Combined Simulator), Task 2: the merge's core seam (design §4).

Maps ``run_manager.TickOutcome``/``TickState`` (trigger side, tiered
``signals`` = ``{fixed, dynamic, simulated}``) onto a proposal ``World``
(``aica_api.models.proposal.world``). Every function here is pure — no IO,
no clock/random, no persistence — so the merged run coordinator (a later
task) can call it deterministically on every trigger fire.

Slice-1 scope (per the feature-020 plan): one trigger fire -> one proposal
run, ``rest_recommended`` only in practice today, but ``MONOTONY_PROPOSAL``
is mapped too since the trigger side already emits it. No journey chain,
recompute, enriched recovery, or monotony-level derivation yet — those are
later slices; ``monotony_level`` is a fixed slice-1 default (0).

This module intentionally imports ONLY ``aica_api.models.proposal.*`` plus
stdlib — it does not import the trigger `run_manager`/`tick_engine` modules
themselves (their outputs are consumed structurally: ``TickOutcome.decision``
attributes and the plain `tick_state.signals` dict), keeping this file safe
to reuse from either side of the merge boundary.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.world import World

__all__ = [
    "map_trigger_purpose",
    "map_lifecycle_stage",
    "map_road_type",
    "build_world_from_tick",
]

# ---------------------------------------------------------------------------
# map_trigger_purpose
# ---------------------------------------------------------------------------

_RESULT_TYPE_TO_PURPOSE: dict[str, str] = {
    "REST_PROPOSAL": "rest_recommended",
    "MONOTONY_PROPOSAL": "inattentive_driving_prevention_recovery",
}


def map_trigger_purpose(result_type: str) -> str | None:
    """Map a trigger ``DecisionResult.result_type`` to a proposal ``trigger_purpose``.

    ``REST_PROPOSAL`` -> ``rest_recommended``; ``MONOTONY_PROPOSAL`` ->
    ``inattentive_driving_prevention_recovery``; anything else (``SUPPRESSED``,
    ``NO_PROPOSAL``, ...) -> ``None`` (no proposal run should be spawned/updated).
    """
    return _RESULT_TYPE_TO_PURPOSE.get(result_type)


# ---------------------------------------------------------------------------
# map_lifecycle_stage
# ---------------------------------------------------------------------------


def map_lifecycle_stage(*, fired: bool, result_type: str, recovery_phase: str | None) -> str:
    """Map trigger fire-control state to a proposal ``lifecycle_stage``.

    Slice-1 rule (later slices add ``after_rest_before_restart`` and richer
    recovery-phase handling):
      - ``recovery_phase`` set (vehicle stopped and recovering) -> ``during_rest_stopped``
      - fired and a REST proposal -> ``before_rest_until_stop``
      - else -> ``active_driving_content``
    """
    if recovery_phase is not None:
        return "during_rest_stopped"
    if fired and result_type == "REST_PROPOSAL":
        return "before_rest_until_stop"
    return "active_driving_content"


# ---------------------------------------------------------------------------
# map_road_type
# ---------------------------------------------------------------------------

_SEGMENT_TYPE_TO_ROAD_TYPE: dict[str, str] = {
    "highway": "highway",
    "normal_road": "local",
    "mountain_road": "mountain",
    "sightseeing_road": "local",
    "rest": "parking",
}


def map_road_type(segment_type: str | None) -> str:
    """Map a trigger-side ``segmentType`` to a proposal ``RoadType``.

    ``rest``/``None`` -> ``parking`` (no proposal-side "rest area" road type
    exists; parking is the closest fit and matches a stopped vehicle).
    """
    if segment_type is None:
        return "parking"
    return _SEGMENT_TYPE_TO_ROAD_TYPE.get(segment_type, "parking")


# ---------------------------------------------------------------------------
# build_world_from_tick
# ---------------------------------------------------------------------------


def build_world_from_tick(
    world_template: World,
    tick_state: Any,
    *,
    trigger_purpose: str,
    lifecycle_stage: str,
) -> World:
    """Overwrite GENERATED situation/control fields from ``tick_state`` onto the
    INLINE ``world_template``.

    GENERATED (overwritten every fire): drowsiness_level, fatigue_level,
    traffic_state, road_type, night_state, motion_state (both locations),
    estimated_min_until_rest_spot. ``monotony_level`` is a slice-1 fixed
    default (0); ``rest_spot_type`` and every other Situation/DriverProfile
    field are left as-is from the template (INLINE — reviewer/preset-owned).

    ``motion_state`` is written to BOTH ``situation.motion_state`` and
    ``control_inputs.motion_state`` (the two-field-sync gotcha from prior
    proposal work — see project memory).
    """
    signals = tick_state.signals
    fixed = signals.get("fixed", {})
    dynamic = signals.get("dynamic", {})
    simulated = signals.get("simulated", {})

    is_night = fixed.get("isNight", False)
    is_traffic_jam = dynamic.get("isTrafficJam", False)
    segment_type = dynamic.get("segmentType")
    next_rest_spot_min = dynamic.get("nextRestSpotMin")

    drowsiness = simulated.get("drowsiness")
    fatigue = simulated.get("fatigue")

    motion = "stopped" if dynamic.get("motionState") == "STOPPED" else "driving"

    situation_update: dict[str, Any] = {
        "traffic_state": "congested" if is_traffic_jam else "normal",
        "road_type": map_road_type(segment_type),
        "night_state": "night" if is_night else "day",
        "monotony_level": 0,
        "motion_state": motion,
        "estimated_min_until_rest_spot": (
            round(next_rest_spot_min) if next_rest_spot_min is not None else None
        ),
    }
    if drowsiness is not None:
        situation_update["drowsiness_level"] = round(drowsiness)
    if fatigue is not None:
        situation_update["fatigue_level"] = round(fatigue)

    new_situation = world_template.situation.model_copy(update=situation_update)
    new_control_inputs = world_template.control_inputs.model_copy(
        update={
            "trigger_purpose": trigger_purpose,
            "lifecycle_stage": lifecycle_stage,
            "motion_state": motion,
        }
    )
    return world_template.model_copy(
        update={"situation": new_situation, "control_inputs": new_control_inputs}
    )
