"""TDD model tests (T003) — written BEFORE models exist; confirm RED, implement to GREEN."""

import pytest
from pydantic import ValidationError


# ─── PackageManifest tests ────────────────────────────────────────────────────

VALID_PACKAGE = {
    "id": "rest_rule_based_v0_1",
    "version": "0.1.0",
    "label": {"ja": "ルールベース安静", "en": "Rule-based Rest"},
    "compatible_scenario_types": ["uc01_fatigue"],
    "algorithm": {"type": "declarative_rule", "entrypoint": "aica_api.algorithms.declarative_rule"},
    "parameters": [
        {
            "key": "sensitivity",
            "label": {"ja": "感度", "en": "Sensitivity"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "medium",
        }
    ],
    "features": [
        {"key": "drowsiness_level", "band_values": ["none", "mild", "moderate", "severe"]},
    ],
    "hyperparameters": [
        {
            "key": "proposal_threshold",
            "label": {"ja": "提案閾値", "en": "Proposal Threshold"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "medium",
        }
    ],
    "trigger_categories": [{"id": "rest_required", "priority": 1}],
    "rules": [{"id": "R1", "condition": "drowsiness_level >= moderate"}],
    "fire_control": {
        "threshold_source": "proposal_threshold",
        "actionability_guard": "rest_spot_reachable",
    },
    "proposals": [
        {
            "id": "rest_guidance",
            "message": {"ja": "休憩をお勧めします", "en": "We recommend taking a rest."},
            "options": ["accept_rest", "postpone"],
        }
    ],
    "feedback_schema": [],
    "evidence_metrics": ["drowsiness_level", "fatigue_level"],
}


def test_package_manifest_valid():
    from aica_api.models.package import PackageManifest

    m = PackageManifest(**VALID_PACKAGE)
    assert m.id == "rest_rule_based_v0_1"
    assert m.algorithm.type == "declarative_rule"
    assert len(m.parameters) == 1
    assert m.parameters[0].key == "sensitivity"
    assert m.trigger_categories[0].id == "rest_required"


def test_package_manifest_invalid_algorithm_type():
    from aica_api.models.package import PackageManifest

    bad = {**VALID_PACKAGE, "algorithm": {"type": "neural_network", "entrypoint": "foo"}}
    with pytest.raises(ValidationError):
        PackageManifest(**bad)


def test_package_manifest_invalid_band_default_not_in_values():
    from aica_api.models.package import PackageManifest

    bad_params = [
        {
            "key": "sensitivity",
            "label": {"ja": "感度", "en": "Sensitivity"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "ultra",  # not in band_values
        }
    ]
    with pytest.raises(ValidationError):
        PackageManifest(**{**VALID_PACKAGE, "parameters": bad_params})


def test_package_manifest_invalid_hyperparameter_default_not_in_values():
    from aica_api.models.package import PackageManifest

    bad_hyper = [
        {
            "key": "proposal_threshold",
            "label": {"ja": "提案閾値", "en": "Proposal Threshold"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "extreme",  # not in band_values
        }
    ]
    with pytest.raises(ValidationError):
        PackageManifest(**{**VALID_PACKAGE, "hyperparameters": bad_hyper})


def test_package_manifest_empty_compatible_types():
    from aica_api.models.package import PackageManifest

    with pytest.raises(ValidationError):
        PackageManifest(**{**VALID_PACKAGE, "compatible_scenario_types": []})


# ─── ScenarioDef tests ────────────────────────────────────────────────────────

VALID_SCENARIO = {
    "id": "uc01_fatigue_friend_drive_v0_1",
    "version": "0.1.0",
    "type": "uc01_fatigue",
    "persona": {"name": "Kenji", "description": "A tired commuter"},
    "route_intent": {
        "rest_facility": {"label": {"ja": "SA花輪", "en": "Hanawa SA"}},
        "segments": [
            {
                "id": "s0",
                "name": {"ja": "出発", "en": "Start"},
                "type": "start",
                "at": 0.0,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": False,
            },
            {
                "id": "s1",
                "name": {"ja": "高速", "en": "Highway"},
                "type": "highway",
                "at": 0.3,
                "speed_band": "high",
                "length_band": "long",
                "is_rest_facility": False,
            },
            {
                "id": "s2",
                "name": {"ja": "SA", "en": "SA"},
                "type": "rest",
                "at": 0.6,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": True,
            },
            {
                "id": "s3",
                "name": {"ja": "到着", "en": "End"},
                "type": "end",
                "at": 1.0,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": False,
            },
        ],
    },
    "initial_state": {"drowsiness_level": "mild", "fatigue_level": "medium"},
    "event_presets": {
        "drowsiness_schedule": [
            {"at": 0.0, "band": "mild"},
            {"at": 0.4, "band": "moderate"},
        ],
        "signal_duration_at_trigger": "sustained",
        "rest_spot_eta_near_before": "s2",
    },
    "driver_profile": {"name": "default"},
    "vehicle_profile": {"name": "default"},
    "total_duration_seconds": 7200,
    "tick_seconds": 10,
    "allowed_actions": ["accept_rest", "postpone"],
    "review_focus": "Check R3 fires before SA",
}


def test_scenario_def_valid():
    from aica_api.models.scenario import ScenarioDef

    s = ScenarioDef(**VALID_SCENARIO)
    assert s.id == "uc01_fatigue_friend_drive_v0_1"
    assert s.total_duration_seconds == 7200
    assert s.tick_seconds == 10
    assert len(s.route_intent.segments) == 4
    assert s.allowed_actions == ["accept_rest", "postpone"]


def test_scenario_at_not_monotonic():
    from aica_api.models.scenario import ScenarioDef

    bad_segments = [
        {
            "id": "s0",
            "name": {"ja": "出発", "en": "Start"},
            "type": "start",
            "at": 0.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
        {
            "id": "s1",
            "name": {"ja": "高速", "en": "Highway"},
            "type": "highway",
            "at": 0.8,
            "speed_band": "high",
            "length_band": "long",
            "is_rest_facility": False,
        },
        {
            "id": "s2",
            "name": {"ja": "SA", "en": "SA"},
            "type": "rest",
            "at": 0.3,  # NOT monotonically increasing
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": True,
        },
        {
            "id": "s3",
            "name": {"ja": "到着", "en": "End"},
            "type": "end",
            "at": 1.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
    ]
    bad_route = {**VALID_SCENARIO["route_intent"], "segments": bad_segments}
    with pytest.raises(ValidationError):
        ScenarioDef(**{**VALID_SCENARIO, "route_intent": bad_route})


def test_scenario_no_rest_facility():
    from aica_api.models.scenario import ScenarioDef

    no_rest_segments = [
        {
            "id": "s0",
            "name": {"ja": "出発", "en": "Start"},
            "type": "start",
            "at": 0.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
        {
            "id": "s1",
            "name": {"ja": "到着", "en": "End"},
            "type": "end",
            "at": 1.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
    ]
    bad_route = {**VALID_SCENARIO["route_intent"], "segments": no_rest_segments}
    with pytest.raises(ValidationError):
        ScenarioDef(**{**VALID_SCENARIO, "route_intent": bad_route})


def test_scenario_two_rest_facilities():
    from aica_api.models.scenario import ScenarioDef

    two_rest_segments = [
        {
            "id": "s0",
            "name": {"ja": "出発", "en": "Start"},
            "type": "start",
            "at": 0.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
        {
            "id": "s1",
            "name": {"ja": "SA1", "en": "SA1"},
            "type": "rest",
            "at": 0.3,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": True,
        },
        {
            "id": "s2",
            "name": {"ja": "SA2", "en": "SA2"},
            "type": "rest",
            "at": 0.6,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": True,
        },
        {
            "id": "s3",
            "name": {"ja": "到着", "en": "End"},
            "type": "end",
            "at": 1.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
    ]
    bad_route = {**VALID_SCENARIO["route_intent"], "segments": two_rest_segments}
    with pytest.raises(ValidationError):
        ScenarioDef(**{**VALID_SCENARIO, "route_intent": bad_route})


def test_scenario_at_out_of_range():
    from aica_api.models.scenario import ScenarioDef

    bad_segments = [
        {
            "id": "s0",
            "name": {"ja": "出発", "en": "Start"},
            "type": "start",
            "at": 0.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
        {
            "id": "s1",
            "name": {"ja": "SA", "en": "SA"},
            "type": "rest",
            "at": 0.6,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": True,
        },
        {
            "id": "s2",
            "name": {"ja": "到着", "en": "End"},
            "type": "end",
            "at": 1.5,  # > 1.0 — out of range
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
    ]
    bad_route = {**VALID_SCENARIO["route_intent"], "segments": bad_segments}
    with pytest.raises(ValidationError):
        ScenarioDef(**{**VALID_SCENARIO, "route_intent": bad_route})


# ─── DecisionResult tests ─────────────────────────────────────────────────────

# Matches the exact §11 shape from contracts/decision-result.md
VALID_DECISION = {
    "result_type": "REST_PROPOSAL",
    "trigger_candidate": True,
    "selected_category": "rest_required",
    "score": 3.2,
    "features": {
        "drowsiness_level": "moderate",
        "fatigue_level": "medium",
        "signal_duration": "sustained",
        "rest_spot_eta": "near",
    },
    "scores": {},
    "states": {},
    "criteria": {"reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0},
    "candidates": [
        {
            "category": "rest_required",
            "exists": True,
            "score": 3.2,
            "state": None,
            "strength": "clear",
            "fire_control": {
                "fired": True,
                "suppressed": False,
                "override": False,
                "reason": "proposal_cut_passed_rest_reachable",
            },
        }
    ],
    # top-level fire_control per contract sample: no "fired" key → defaults to False
    "fire_control": {"suppressed": False, "override": False, "reason": None},
    "proposal": {
        "id": "rest_guidance",
        "message": {"ja": "休憩をお勧めします", "en": "We recommend taking a rest."},
        "options": ["accept_rest", "postpone"],
    },
    "reason_inputs": ["drowsiness_level", "signal_duration", "rest_spot_eta"],
    "explanation": (
        "Damped fatigue/drowsiness blend passed the proposal threshold "
        "and a rest spot is reachable."
    ),
    "next_package_runtime_state": {},
}


def test_decision_result_valid():
    from aica_api.models.decision import DecisionResult

    dr = DecisionResult(**VALID_DECISION)
    assert dr.result_type.value == "REST_PROPOSAL"
    assert dr.trigger_candidate is True
    assert len(dr.candidates) == 1
    assert dr.candidates[0].fire_control.fired is True
    assert dr.proposal.id == "rest_guidance"


def test_decision_result_invalid_type():
    from aica_api.models.decision import DecisionResult

    with pytest.raises(ValidationError):
        DecisionResult(**{**VALID_DECISION, "result_type": "UNKNOWN_TYPE"})


def test_decision_result_all_five_enum_values():
    from aica_api.models.decision import DecisionResult, ResultType

    no_proposal_base = {
        **VALID_DECISION,
        "proposal": None,
        "trigger_candidate": False,
        "selected_category": None,
        "score": None,
    }
    for rt in [
        "NO_TRIGGER",
        "SOFT_WARNING",
        "SEVERE_INTERVENTION",
        "NO_PRACTICAL_ACTION_FALLBACK",
    ]:
        dr = DecisionResult(**{**no_proposal_base, "result_type": rt})
        assert dr.result_type == ResultType(rt)


def test_decision_result_suppressed_candidate_retained():
    from aica_api.models.decision import DecisionResult

    suppressed_candidate = {
        "category": "rest_required",
        "exists": True,
        "score": 2.8,
        "state": None,
        "strength": "weak",
        "fire_control": {
            "fired": False,
            "suppressed": True,
            "override": False,
            "reason": "no_actionable_rest_stop",
        },
    }
    dr = DecisionResult(
        **{
            **VALID_DECISION,
            "result_type": "NO_TRIGGER",
            "trigger_candidate": False,
            "selected_category": None,
            "score": None,
            "proposal": None,
            "candidates": [suppressed_candidate],
        }
    )
    assert len(dr.candidates) == 1
    assert dr.candidates[0].fire_control.suppressed is True


def test_decision_result_optional_fields_default_empty():
    from aica_api.models.decision import DecisionResult

    minimal = {
        "result_type": "NO_TRIGGER",
        "trigger_candidate": False,
        "selected_category": None,
        "score": None,
        "features": {},
        "criteria": {},
        "candidates": [],
        "fire_control": {"suppressed": False, "override": False, "reason": None},
        "proposal": None,
        "reason_inputs": [],
        "explanation": "",
        "next_package_runtime_state": {},
    }
    dr = DecisionResult(**minimal)
    assert dr.scores == {}
    assert dr.states == {}


# ─── RunLog + discriminated events round-trip tests ──────────────────────────

VALID_SNAPSHOT = {
    "package": {"id": "rest_rule_based_v0_1", "version": "0.1.0", "hash": "abc123"},
    "scenario": {"id": "uc01_fatigue_friend_drive_v0_1", "version": "0.1.0", "hash": "def456"},
}

VALID_ROUTE_FACTS = {
    "segments": [
        {
            "id": "s0",
            "name": {"ja": "出発", "en": "Start"},
            "type": "start",
            "at": 0.0,
            "speed_band": "low",
            "length_band": "short",
            "is_rest_facility": False,
        },
    ],
    "bands": {"speed_band": ["low", "medium", "high"]},
}

VALID_EVENT_PLAN = {
    "ticks": [
        {
            "tick_index": 0,
            "drowsiness_band": "mild",
            "route_fraction": 0.0,
            "signal_duration": "brief",
            "rest_spot_eta": "far",
        },
    ]
}

VALID_TICK_STATE = {
    "tick_index": 0,
    "elapsed_seconds": 0,
    "route_fraction": 0.0,
    "active_segment_id": "s0",
    "drowsiness_level": "mild",
    "fatigue_level": "low",
    "signal_duration": "brief",
    "continuous_driving_time": "short",
    "rest_spot_eta": "far",
    "completed": False,
}

VALID_TRACE = {
    "tick_index": 0,
    "decision_result": VALID_DECISION,
}

VALID_RUN_LOG = {
    "run_id": "run_001",
    "created_at": "2026-01-01T00:00:00Z",
    "simulator_version": "0.1.0",
    "snapshot": VALID_SNAPSHOT,
    "route_facts": VALID_ROUTE_FACTS,
    "event_plan": VALID_EVENT_PLAN,
    "run_mode": "standard",
    "evidence_status": "standard",
    "events": [
        {
            "kind": "tick",
            "tick_index": 0,
            "tick_state": VALID_TICK_STATE,
            "trace": VALID_TRACE,
        },
        {
            "kind": "action",
            "tick_index": 0,
            "action": "accept_rest",
            "resulting_status": "completed",
        },
        {
            "kind": "algorithm_error",
            "tick_index": 1,
            "error_type": "validation_error",
            "message": "Algorithm returned invalid shape",
        },
    ],
}


def test_run_log_valid_with_all_event_types():
    from aica_api.models.log import RunLog

    log = RunLog(**VALID_RUN_LOG)
    assert log.run_id == "run_001"
    assert len(log.events) == 3


def test_run_log_tick_event_discriminated():
    from aica_api.models.log import RunLog, TickEvent

    log = RunLog(**VALID_RUN_LOG)
    evt = log.events[0]
    assert isinstance(evt, TickEvent)
    assert evt.kind == "tick"
    assert evt.tick_state.tick_index == 0


def test_run_log_action_event_discriminated():
    from aica_api.models.log import RunLog, ActionEvent

    log = RunLog(**VALID_RUN_LOG)
    evt = log.events[1]
    assert isinstance(evt, ActionEvent)
    assert evt.action == "accept_rest"
    assert evt.resulting_status == "completed"


def test_run_log_algorithm_error_discriminated():
    from aica_api.models.log import RunLog, AlgorithmError

    log = RunLog(**VALID_RUN_LOG)
    evt = log.events[2]
    assert isinstance(evt, AlgorithmError)
    assert evt.error_type == "validation_error"


def test_run_log_json_roundtrip():
    from aica_api.models.log import RunLog

    log = RunLog(**VALID_RUN_LOG)
    json_str = log.model_dump_json()
    log2 = RunLog.model_validate_json(json_str)
    assert log2.run_id == log.run_id
    assert len(log2.events) == len(log.events)
    assert type(log2.events[0]) is type(log.events[0])
    assert type(log2.events[1]) is type(log.events[1])
    assert type(log2.events[2]) is type(log.events[2])
