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
    # result_type is now a plain str (M3 T003 relaxation); compare as string
    assert dr.result_type == "REST_PROPOSAL"
    assert dr.trigger_candidate is True
    assert len(dr.candidates) == 1
    assert dr.candidates[0].fire_control.fired is True
    assert dr.proposal.id == "rest_guidance"


def test_decision_result_unknown_type_now_valid():
    """M3 T003: result_type is a plain str — arbitrary values are accepted verbatim.

    Previously (M1/M2) this field was a strict ResultType enum and "UNKNOWN_TYPE"
    raised ValidationError.  After the T003 relaxation any string is valid so that
    python_module packages can emit their own result categories.
    """
    from aica_api.models.decision import DecisionResult

    dr = DecisionResult(**{**VALID_DECISION, "result_type": "UNKNOWN_TYPE"})
    assert dr.result_type == "UNKNOWN_TYPE"


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


# ─── T008 — M2 extended model tests ──────────────────────────────────────────


# ── Extended PackageManifest: weighted_score algorithm + numeric hyperparams ──


def test_package_manifest_weighted_score_algorithm_accepted():
    """algorithm.type = 'weighted_score' is now a valid Literal value."""
    from aica_api.models.package import PackageManifest

    ws_pkg = {
        **VALID_PACKAGE,
        "algorithm": {"type": "weighted_score", "entrypoint": "aica_api.algorithms.weighted_score"},
    }
    m = PackageManifest(**ws_pkg)
    assert m.algorithm.type == "weighted_score"


def test_package_manifest_numeric_hyperparameter_accepted():
    """HyperparameterDef with kind='numeric' is accepted for weighted_score packages."""
    from aica_api.models.package import HyperparameterDef

    hp = HyperparameterDef(
        key="drowsiness_weight",
        label={"ja": "眠気重み", "en": "Drowsiness Weight"},
        kind="numeric",
        default=0.5,
        min=0.0,
        max=1.0,
        step=0.05,
    )
    assert hp.key == "drowsiness_weight"
    assert hp.default == 0.5
    assert hp.min == 0.0


def test_package_manifest_numeric_hyperparameter_in_manifest():
    """A full PackageManifest with mixed band + numeric hyperparameters parses."""
    from aica_api.models.package import PackageManifest

    mixed_hyper = [
        {
            "key": "proposal_threshold",
            "label": {"ja": "提案閾値", "en": "Proposal Threshold"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "medium",
        },
        {
            "key": "drowsiness_weight",
            "label": {"ja": "眠気重み", "en": "Drowsiness Weight"},
            "kind": "numeric",
            "default": 0.5,
            "min": 0.0,
            "max": 1.0,
            "step": 0.05,
        },
    ]
    m = PackageManifest(**{**VALID_PACKAGE, "hyperparameters": mixed_hyper})
    assert len(m.hyperparameters) == 2
    assert m.hyperparameters[1].kind == "numeric"


# ── Extended ScenarioDef: profiles, is_night ──────────────────────────────────

_DRIVER_PROFILE_DICT = {
    "id": "default_driver",
    "drowsiness_model": {
        "base_growth_per_min": 0.1,
        "night_add_per_min": 0.05,
        "monotony_add_per_min": 0.02,
        "traffic_jam_add_per_min": 0.03,
    },
    "fatigue_model": {
        "base_growth_per_min": 0.08,
        "continuous_driving_add_per_min_after_60_min": 0.04,
        "mountain_road_add_per_min": 0.06,
        "traffic_jam_add_per_min": 0.02,
    },
    "attention_model": {
        "base_recovery_per_min": 0.0,
        "monotony_drop_per_min": 0.01,
        "drowsiness_drop_factor": 0.5,
        "active_content_recovery_per_min": 0.1,
    },
    "recovery_model": {
        "short_rest_drowsiness_recovery": 30.0,
        "short_rest_fatigue_recovery": 20.0,
        "long_rest_drowsiness_recovery": 80.0,
        "long_rest_fatigue_recovery": 60.0,
    },
}

_VEHICLE_PROFILE_DICT = {
    "rolling_window_seconds": 300,
    "steering_instability": {
        "base_level": 0.1,
        "drowsiness_factor": 0.3,
        "fatigue_factor": 0.2,
        "mountain_road_add": 0.05,
        "traffic_jam_reduce": 0.02,
    },
    "lane_departure": {
        "enabled_on": ["highway", "normal_road"],
        "drowsiness_threshold": 60.0,
        "fatigue_threshold": 70.0,
        "count_when_threshold_exceeded": 2,
    },
    "pedal_abnormality": {
        "base_level": 0.05,
        "fatigue_factor": 0.2,
        "traffic_jam_add": 0.1,
        "mountain_road_add": 0.08,
    },
    "adas_warning": {
        "lane_departure_warning_threshold": 80.0,
        "steering_instability_warning_threshold": 75.0,
    },
}

_SPEED_PROFILE_DICT = {
    "normal_road_kph": 60,
    "highway_kph": 100,
    "mountain_road_kph": 40,
    "sightseeing_road_kph": 30,
    "traffic_jam_kph": 10,
}

# Build a VALID_SCENARIO extended with M2 profiles
VALID_SCENARIO_M2 = {
    **{k: v for k, v in VALID_SCENARIO.items()},
    "driver_profile": _DRIVER_PROFILE_DICT,
    "vehicle_profile": _VEHICLE_PROFILE_DICT,
    "speed_profile": _SPEED_PROFILE_DICT,
    "is_night": True,
    "presets": {"monotony": "highway"},
}


def test_scenario_def_with_m2_profiles_valid():
    """ScenarioDef with full M2 profiles, is_night, and presets parses correctly."""
    from aica_api.models.scenario import ScenarioDef

    s = ScenarioDef(**VALID_SCENARIO_M2)
    assert s.driver_profile is not None
    assert s.driver_profile.id == "default_driver"
    assert s.vehicle_profile is not None
    assert s.vehicle_profile.rolling_window_seconds == 300
    assert s.speed_profile is not None
    assert s.speed_profile.highway_kph == 100
    assert s.is_night is True
    assert s.presets == {"monotony": "highway"}


def test_scenario_def_without_profiles_valid():
    """ScenarioDef without profiles still parses (profiles default to None)."""
    from aica_api.models.scenario import ScenarioDef

    s = ScenarioDef(**VALID_SCENARIO)
    assert s.driver_profile is None
    assert s.vehicle_profile is None
    assert s.speed_profile is None
    assert s.is_night is False


# ── Extended DecisionResult: localized explanation ────────────────────────────


def test_decision_result_explanation_str():
    """Plain string explanation (M1 backward compat)."""
    from aica_api.models.decision import DecisionResult

    dr = DecisionResult(**VALID_DECISION)
    assert isinstance(dr.explanation, str)


def test_decision_result_explanation_localized():
    """LocalizedText dict explanation accepted."""
    from aica_api.models.decision import DecisionResult, LocalizedText

    loc_decision = {**VALID_DECISION, "explanation": {"ja": "眠気が高い", "en": "High drowsiness"}}
    dr = DecisionResult(**loc_decision)
    assert isinstance(dr.explanation, LocalizedText)
    assert dr.explanation.en == "High drowsiness"


def test_decision_result_explanation_list():
    """List of str/LocalizedText explanation accepted."""
    from aica_api.models.decision import DecisionResult, LocalizedText

    list_explanation = [
        "First reason",
        {"ja": "二番目の理由", "en": "Second reason"},
    ]
    list_decision = {**VALID_DECISION, "explanation": list_explanation}
    dr = DecisionResult(**list_decision)
    assert isinstance(dr.explanation, list)
    assert len(dr.explanation) == 2
    assert isinstance(dr.explanation[1], LocalizedText)


# ── Extended log: decline action, TickEvent M2 fields, RunLog M2 fields ───────


def test_action_event_decline_accepted():
    """ActionEvent.action = 'decline' is accepted."""
    from aica_api.models.log import ActionEvent

    evt = ActionEvent(kind="action", tick_index=5, action="decline", resulting_status="playing")
    assert evt.action == "decline"


def test_tick_event_m2_fields():
    """TickEvent carries raw_state, feature_groups, driver_update, vehicle_update, package_runtime_state."""
    from aica_api.models.log import TickEvent
    from aica_api.models.run import FeatureGroups

    m2_tick_event = {
        "kind": "tick",
        "tick_index": 0,
        "tick_state": VALID_TICK_STATE,
        "trace": VALID_TRACE,
        "raw_state": {"drowsiness": 0.45, "fatigue": 0.3, "is_night": False},
        "feature_groups": {"normalized": {"drowsiness": 0.45}, "ordinal": {"drowsiness_level": "mild"}},
        "driver_update": {"drowsiness_delta": 0.02},
        "vehicle_update": {"steering_instability": 0.12},
        "package_runtime_state": {"last_triggered_at": 42},
    }
    evt = TickEvent(**m2_tick_event)
    assert evt.raw_state["drowsiness"] == 0.45
    assert isinstance(evt.feature_groups, FeatureGroups)
    assert evt.feature_groups.ordinal["drowsiness_level"] == "mild"
    assert evt.driver_update["drowsiness_delta"] == 0.02
    assert evt.package_runtime_state["last_triggered_at"] == 42


def test_run_log_m2_fields():
    """RunLog carries original_values, modified_values, and parameter snapshots."""
    from aica_api.models.log import RunLog

    m2_log = {
        **VALID_RUN_LOG,
        "original_values": {"proposal_threshold": "medium"},
        "modified_values": {"proposal_threshold": "high"},
        "initial_parameters": {"sensitivity": "medium"},
        "current_parameters": {"sensitivity": "high"},
        "initial_hyperparameters": {"proposal_threshold": "medium"},
        "current_hyperparameters": {"proposal_threshold": "high"},
    }
    log = RunLog(**m2_log)
    assert log.original_values == {"proposal_threshold": "medium"}
    assert log.modified_values == {"proposal_threshold": "high"}
    assert log.initial_parameters == {"sensitivity": "medium"}
    assert log.current_hyperparameters == {"proposal_threshold": "high"}


# ── Extended RunState: M2 fields ──────────────────────────────────────────────


def test_run_state_m2_fields():
    """RunState carries profile snapshots and parameter audit fields."""
    from aica_api.models.run import RunState, RunStatus

    run_state_dict = {
        "run_id": "run_m2_test",
        "status": "created",
        "current_tick": 0,
        "pending_proposal": None,
        "snapshot": VALID_SNAPSHOT,
        "event_plan": VALID_EVENT_PLAN,
        "route_facts": VALID_ROUTE_FACTS,
        "run_mode": "standard",
        "evidence_status": "standard",
        "initial_parameters": {"sensitivity": "medium"},
        "current_parameters": {"sensitivity": "medium"},
        "initial_hyperparameters": {"proposal_threshold": "medium"},
        "current_hyperparameters": {"proposal_threshold": "medium"},
        "original_values": {},
        "modified_values": {},
    }
    rs = RunState(**run_state_dict)
    assert rs.run_mode == "standard"
    assert rs.evidence_status == "standard"
    assert rs.initial_parameters == {"sensitivity": "medium"}
    assert rs.driver_profile is None  # optional, not supplied


# ── Extended RouteFacts + EventPlan M2 fields ─────────────────────────────────


def test_route_facts_m2_fields():
    """RouteFacts accepts M2 fields (total_route_distance_km, route_segments, etc.)."""
    from aica_api.models.run import RouteFacts, RouteSegmentFact

    rf = RouteFacts(
        total_route_distance_km=250.0,
        estimated_route_duration_min=180.0,
        route_segments=[
            {"segment_type": "highway", "start_km": 0.0, "length_km": 120.0},
            {"segment_type": "normal_road", "start_km": 120.0, "length_km": 80.0},
            {"segment_type": "mountain_road", "start_km": 200.0, "length_km": 50.0},
        ],
        rest_spot_positions=[80.0, 160.0],
        route_progress_checkpoints=[0.25, 0.5, 0.75],
    )
    assert rf.total_route_distance_km == 250.0
    assert len(rf.route_segments) == 3
    assert rf.route_segments[0].segment_type == "highway"
    assert rf.rest_spot_positions == [80.0, 160.0]


def test_route_segment_fact_invalid_type_rejected():
    """RouteSegmentFact rejects unknown segment_type values."""
    from aica_api.models.run import RouteSegmentFact

    with pytest.raises(Exception):
        RouteSegmentFact(segment_type="urban", start_km=0.0, length_km=10.0)


def test_event_plan_m2_fields():
    """EventPlan accepts M2 traffic/weather/rest-opportunity event lists."""
    from aica_api.models.run import EventPlan, RestOpportunity, TrafficEvent, WeatherEvent

    ep = EventPlan(
        tick_seconds=60,
        traffic_events=[
            {"id": "te1", "start_min": 30.0, "duration_min": 20.0, "affected_segment_id": "seg_urban", "speed_kph": 20.0},
        ],
        weather_events=[
            {"id": "we1", "start_min": 60.0, "duration_min": 15.0},
        ],
        rest_opportunities=[
            {"id": "ro1", "route_position_km": 80.0},
        ],
    )
    assert ep.tick_seconds == 60
    assert len(ep.traffic_events) == 1
    assert ep.traffic_events[0].id == "te1"
    assert ep.rest_opportunities[0].route_position_km == 80.0


def test_event_plan_m1_backward_compat():
    """EventPlan with only M1 ticks field still parses (backward compat)."""
    from aica_api.models.run import EventPlan

    ep = EventPlan(**VALID_EVENT_PLAN)
    assert len(ep.ticks) == 1
    assert ep.traffic_events == []


# ── RunPlanDraft ──────────────────────────────────────────────────────────────


def test_run_plan_draft_valid():
    """RunPlanDraft parses with all required fields."""
    from aica_api.models.run import EventPlan, RouteFacts, RunPlanDraft

    draft = RunPlanDraft(
        plan_id="plan_001",
        package_id="rest_rule_based_v0_1",
        scenario_id="uc01_fatigue_friend_drive_v0_1",
        route_facts=RouteFacts(**VALID_ROUTE_FACTS),
        effective_setup={"run_mode": "standard"},
        draft_event_plan=EventPlan(**VALID_EVENT_PLAN),
        validation_errors=[],
    )
    assert draft.plan_id == "plan_001"
    assert draft.package_id == "rest_rule_based_v0_1"
    assert draft.validation_errors == []


def test_run_plan_draft_defaults():
    """RunPlanDraft optional fields default correctly."""
    from aica_api.models.run import RouteFacts, RunPlanDraft

    draft = RunPlanDraft(
        plan_id="plan_002",
        package_id="pkg",
        scenario_id="sc",
        route_facts=RouteFacts(**VALID_ROUTE_FACTS),
    )
    assert draft.effective_setup == {}
    assert draft.validation_errors == []


# ── TickState M2 fields ───────────────────────────────────────────────────────


def test_tick_state_m2_fields():
    """TickState accepts raw_state, feature_groups, distance_km, continuous_driving_min."""
    from aica_api.models.run import FeatureGroups, TickState

    ts = TickState(
        **VALID_TICK_STATE,
        raw_state={"drowsiness": 0.45, "fatigue": 0.30},
        feature_groups={"normalized": {"drowsiness": 0.45}, "ordinal": {"drowsiness_level": "mild"}},
        distance_km=42.5,
        continuous_driving_min=35.0,
    )
    assert ts.raw_state == {"drowsiness": 0.45, "fatigue": 0.30}
    assert isinstance(ts.feature_groups, FeatureGroups)
    assert ts.distance_km == 42.5
    assert ts.continuous_driving_min == 35.0


# ─── M3 T002 — AlgorithmDef python_module + new fields ───────────────────────


def test_algorithm_def_python_module_type_accepted():
    """AlgorithmDef accepts type='python_module' (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    algo = AlgorithmDef(type="python_module", entrypoint="algorithm.py")
    assert algo.type == "python_module"
    assert algo.entrypoint == "algorithm.py"


def test_algorithm_def_tick_seconds_optional_with_value():
    """AlgorithmDef accepts optional tick_seconds (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    algo = AlgorithmDef(type="python_module", entrypoint="algorithm.py", tick_seconds=30)
    assert algo.tick_seconds == 30


def test_algorithm_def_tick_seconds_defaults_none():
    """AlgorithmDef tick_seconds defaults to None when omitted (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    algo = AlgorithmDef(type="declarative_rule", entrypoint="aica_api.algorithms.declarative_rule")
    assert algo.tick_seconds is None


def test_algorithm_def_error_mode_defaults_blocking():
    """AlgorithmDef error_mode defaults to 'blocking' when omitted (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    algo = AlgorithmDef(type="declarative_rule", entrypoint="aica_api.algorithms.declarative_rule")
    assert algo.error_mode == "blocking"


def test_algorithm_def_error_mode_non_blocking_accepted():
    """AlgorithmDef accepts error_mode='non_blocking' (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    algo = AlgorithmDef(type="python_module", entrypoint="algorithm.py", error_mode="non_blocking")
    assert algo.error_mode == "non_blocking"


def test_algorithm_def_error_mode_invalid_rejected():
    """AlgorithmDef rejects unknown error_mode values (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    with pytest.raises(ValidationError):
        AlgorithmDef(type="python_module", entrypoint="algorithm.py", error_mode="silent")


def test_algorithm_def_existing_types_backward_compat():
    """Existing declarative_rule and weighted_score manifests still validate without new fields (M3 T002)."""
    from aica_api.models.package import AlgorithmDef

    dr = AlgorithmDef(type="declarative_rule", entrypoint="aica_api.algorithms.declarative_rule")
    ws = AlgorithmDef(type="weighted_score", entrypoint="aica_api.algorithms.weighted_score")
    assert dr.type == "declarative_rule"
    assert ws.type == "weighted_score"
    # Defaults apply when fields are absent
    assert dr.tick_seconds is None
    assert dr.error_mode == "blocking"
    assert ws.tick_seconds is None
    assert ws.error_mode == "blocking"


def test_package_manifest_python_module_algorithm_accepted():
    """Full PackageManifest validates with algorithm.type='python_module' (M3 T002)."""
    from aica_api.models.package import PackageManifest

    py_pkg = {
        **VALID_PACKAGE,
        "algorithm": {
            "type": "python_module",
            "entrypoint": "algorithm.py",
            "tick_seconds": 30,
            "error_mode": "blocking",
        },
    }
    m = PackageManifest(**py_pkg)
    assert m.algorithm.type == "python_module"
    assert m.algorithm.tick_seconds == 30
    assert m.algorithm.error_mode == "blocking"


# ─── M3 T003 — DecisionResult.result_type relaxed to str ─────────────────────


def test_decision_result_builtin_via_enum_member_coerces_to_str():
    """ResultType enum member is coerced to its plain string value (M3 T003).

    Because ResultType is a str-subclass enum, passing ResultType.REST_PROPOSAL
    to a str field is valid and the stored value compares equal to both the
    enum member and its string value.
    """
    from aica_api.models.decision import DecisionResult, ResultType

    dr = DecisionResult(**{**VALID_DECISION, "result_type": ResultType.REST_PROPOSAL})
    # Stored value equals the enum member (str-enum equality)
    assert dr.result_type == ResultType.REST_PROPOSAL
    # And equals the plain string
    assert dr.result_type == "REST_PROPOSAL"


def test_decision_result_custom_result_types_verbatim():
    """Arbitrary package-defined result_type strings are accepted and stored verbatim (M3 T003)."""
    from aica_api.models.decision import DecisionResult

    base = {
        **VALID_DECISION,
        "proposal": None,
        "trigger_candidate": False,
        "selected_category": None,
        "score": None,
    }
    for custom_rt in ["MONOTONY_PROPOSAL", "SUPPRESSED", "NO_PROPOSAL", "PKG_DEFINED_RESULT_XYZ"]:
        dr = DecisionResult(**{**base, "result_type": custom_rt})
        assert dr.result_type == custom_rt, f"Expected {custom_rt!r}, got {dr.result_type!r}"


def test_decision_result_all_five_builtin_values_still_valid_as_str():
    """All 5 original ResultType enum values still validate as plain strings (M3 T003)."""
    from aica_api.models.decision import DecisionResult, ResultType

    base = {
        **VALID_DECISION,
        "proposal": None,
        "trigger_candidate": False,
        "selected_category": None,
        "score": None,
    }
    for rt in ResultType:
        dr = DecisionResult(**{**base, "result_type": rt.value})
        assert dr.result_type == rt.value
        # str-enum equality: plain string equals its enum counterpart
        assert dr.result_type == rt


# ─── M4 T002 — Route provenance + DisplayRoute model ─────────────────────────


def test_route_facts_route_source_defaults_local():
    """RouteFacts.route_source defaults to 'local' (backward compat, M4 T002)."""
    from aica_api.models.run import RouteFacts

    rf = RouteFacts(**VALID_ROUTE_FACTS)
    assert rf.route_source == "local"


def test_route_facts_route_source_accepts_maps():
    """RouteFacts.route_source accepts 'maps' (M4 T002)."""
    from aica_api.models.run import RouteFacts

    rf = RouteFacts(**{**VALID_ROUTE_FACTS, "route_source": "maps"})
    assert rf.route_source == "maps"


def test_route_facts_route_source_rejects_unknown():
    """RouteFacts.route_source rejects an unknown value (M4 T002)."""
    from aica_api.models.run import RouteFacts

    with pytest.raises(ValidationError):
        RouteFacts(**{**VALID_ROUTE_FACTS, "route_source": "google_maps"})


def test_display_route_valid():
    """DisplayRoute validates with the four required fields (M4 T002)."""
    from aica_api.models.run import DisplayRoute

    dr = DisplayRoute(
        summary="Tokyo → Osaka via Tomei Expressway",
        encoded_polyline="_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        start_label="Tokyo Station",
        end_label="Osaka Station",
    )
    assert dr.summary == "Tokyo → Osaka via Tomei Expressway"
    assert dr.encoded_polyline == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert dr.start_label == "Tokyo Station"
    assert dr.end_label == "Osaka Station"


def test_display_route_model_dump_roundtrip():
    """DisplayRoute round-trips via model_dump (M4 T002)."""
    from aica_api.models.run import DisplayRoute

    original = DisplayRoute(
        summary="A → B",
        encoded_polyline="abc123",
        start_label="Start",
        end_label="End",
    )
    dumped = original.model_dump()
    restored = DisplayRoute(**dumped)
    assert restored.summary == original.summary
    assert restored.encoded_polyline == original.encoded_polyline
    assert restored.start_label == original.start_label
    assert restored.end_label == original.end_label


def test_run_state_route_source_and_display_route():
    """RunState accepts route_source and display_route (M4 T002)."""
    from aica_api.models.run import DisplayRoute, RunState

    display_route = DisplayRoute(
        summary="A → B",
        encoded_polyline="abc123",
        start_label="A",
        end_label="B",
    )
    rs = RunState(
        run_id="run_m4_test",
        status="created",
        current_tick=0,
        pending_proposal=None,
        snapshot=VALID_SNAPSHOT,
        event_plan=VALID_EVENT_PLAN,
        route_facts=VALID_ROUTE_FACTS,
        route_source="maps",
        display_route=display_route,
    )
    assert rs.route_source == "maps"
    assert rs.display_route is not None
    assert rs.display_route.summary == "A → B"


def test_run_state_backward_compat_without_m4_fields():
    """RunState validates without route_source/display_route (M1-M3 backward compat, M4 T002)."""
    from aica_api.models.run import RunState

    rs = RunState(
        run_id="run_m1_compat",
        status="created",
        current_tick=0,
        pending_proposal=None,
        snapshot=VALID_SNAPSHOT,
        event_plan=VALID_EVENT_PLAN,
        route_facts=VALID_ROUTE_FACTS,
    )
    assert rs.route_source == "local"
    assert rs.display_route is None


def test_run_log_route_source_and_display_route():
    """RunLog accepts route_source and display_route (M4 T002)."""
    from aica_api.models.log import RunLog

    display_route = {
        "summary": "Tokyo → Osaka",
        "encoded_polyline": "xyz789",
        "start_label": "Tokyo",
        "end_label": "Osaka",
    }
    log = RunLog(**{
        **VALID_RUN_LOG,
        "route_source": "maps",
        "display_route": display_route,
    })
    assert log.route_source == "maps"
    assert log.display_route is not None
    assert log.display_route.end_label == "Osaka"


def test_run_log_backward_compat_without_m4_fields():
    """RunLog validates without route_source/display_route (M1-M3 backward compat, M4 T002)."""
    from aica_api.models.log import RunLog

    log = RunLog(**VALID_RUN_LOG)
    assert log.route_source == "local"
    assert log.display_route is None


def test_run_plan_draft_route_source_and_display_route():
    """RunPlanDraft accepts route_source and display_route (M4 T002)."""
    from aica_api.models.run import DisplayRoute, EventPlan, RouteFacts, RunPlanDraft

    display_route = DisplayRoute(
        summary="X → Y",
        encoded_polyline="def456",
        start_label="X",
        end_label="Y",
    )
    draft = RunPlanDraft(
        plan_id="plan_m4",
        package_id="pkg",
        scenario_id="sc",
        route_facts=RouteFacts(**VALID_ROUTE_FACTS),
        route_source="maps",
        display_route=display_route,
    )
    assert draft.route_source == "maps"
    assert draft.display_route is not None
    assert draft.display_route.start_label == "X"


def test_run_plan_draft_backward_compat_without_m4_fields():
    """RunPlanDraft validates without route_source/display_route (M1-M3 backward compat, M4 T002)."""
    from aica_api.models.run import RouteFacts, RunPlanDraft

    draft = RunPlanDraft(
        plan_id="plan_compat",
        package_id="pkg",
        scenario_id="sc",
        route_facts=RouteFacts(**VALID_ROUTE_FACTS),
    )
    assert draft.route_source == "local"
    assert draft.display_route is None


def test_key_safety_no_maps_key_in_models():
    """No persisted model defines a maps_key or key field (M4 T002 key-safety guard)."""
    from aica_api.models.run import DisplayRoute, RouteFacts, RunPlanDraft, RunState
    from aica_api.models.log import RunLog

    for model in [RouteFacts, RunState, RunLog, RunPlanDraft, DisplayRoute]:
        assert "maps_key" not in model.model_fields, (
            f"{model.__name__} must not define a 'maps_key' field"
        )
        assert "key" not in model.model_fields, (
            f"{model.__name__} must not define a 'key' field"
        )
