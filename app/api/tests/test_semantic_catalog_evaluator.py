"""Pure semantic-catalog evidence evaluation.

These tests deliberately use the production quickview response vocabulary:
``fires`` (never the singular compatibility alias), a proposal evidence log,
and content-stage ``ALGORITHM_ERROR`` events.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = _REPO_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from semantic_catalog.evaluator import (  # noqa: E402
    aggregate_suite,
    evaluate_case,
    evaluate_suite,
)


def _candidate(
    candidate_id: str,
    rank: int,
    *,
    feature_id: str = "driver_fatigue_level",
    contribution: float = 0.4,
) -> dict:
    return {
        "rank": rank,
        "candidate_id": candidate_id,
        "score": 0.8 - rank / 10,
        "rationale": ["fixture rationale"],
        "supporting_feature_ids": [feature_id] if contribution > 0 else [],
        "opposing_feature_ids": [feature_id] if contribution < 0 else [],
        "feature_contributions": [
            {
                "feature_id": feature_id,
                "feature_value": "high",
                "response_coefficient": 0.8,
                "weight": 0.5,
                "contribution": contribution,
            }
        ],
    }


def _service_output(candidates: list[dict] | None = None) -> dict:
    return {
        "decision_type": "ranked_candidates",
        "ranked_candidates": candidates
        if candidates is not None
        else [
            _candidate("music_playlist", 1),
            _candidate("breathing_coach", 2),
            _candidate("quiz", 3),
        ],
        "excluded_candidates": [],
        "unused_available_features": [],
        "missing_features": [],
    }


def _content_output() -> dict:
    return {
        "decision_type": "complete_plan",
        "selected_service_id": "music_playlist",
        "requested_item_count": 5,
        "returned_item_count": 2,
        "ordered_items": [
            {
                "position": 1,
                "item_id": "track-a",
                "item_fit": 0.91,
                "trait_values": {"arousal": 0.6, "valence": 0.7},
                "feature_contributions": [],
                "rationale": ["preferred artist"],
            },
            {
                "position": 2,
                "item_id": "track-b",
                "item_fit": 0.82,
                "trait_values": {"arousal": 0.8, "valence": 0.6},
                "feature_contributions": [],
                "rationale": ["high arousal"],
            },
        ],
        "excluded_items": [
            {"item_id": "track-skipped", "reason_codes": ["recently_skipped"]}
        ],
    }


def _evidence(step: str, output: dict | None, error: dict | None = None) -> dict:
    return {
        "step": step,
        "package_id": f"transparent_{step}_v1",
        "contract_version": "1.0.0",
        "schema_version": "1.0.0",
        "matrix_version": "1.0.0",
        "input_snapshot": {},
        "output": output,
        "error": error,
        "used_feature_ids": [],
        "unused_available_features": [],
        "missing_features": [],
    }


def _proposal(
    *,
    service_output: dict | None = None,
    content_output: dict | None = None,
    content_error_category: str | None = None,
) -> dict:
    evidence = [
        _evidence(
            "service",
            _service_output() if service_output is None else service_output,
        )
    ]
    if content_output is not None:
        evidence.append(_evidence("content", content_output))

    events = []
    if content_error_category is not None:
        events.append(
            {
                "event_type": "ALGORITHM_ERROR",
                "at": "2026-07-29T00:00:00Z",
                "payload": {
                    "step": "content",
                    "category": content_error_category,
                    "message": f"fixture {content_error_category}",
                },
            }
        )

    return {
        "evidence": evidence,
        "events": events,
        "status": "error" if content_error_category else "content_selected",
    }


def _fire(
    *,
    category: str = "rest_required",
    tick: int = 18,
    time_min: float = 18.0,
    proposal: dict | None = None,
    trigger_feature_id: str = "drowsiness_level",
) -> dict:
    return {
        "category": category,
        "strength": "strong",
        "tick": tick,
        "time_min": time_min,
        "feature_contributions": {
            category: {
                "score": 0.82,
                "clamped": False,
                "rows": [
                    {
                        "feature_id": trigger_feature_id,
                        "value": 80,
                        "band": "high",
                        "weight": 0.5,
                        "contribution": 0.4,
                    }
                ],
                "gates": [],
            }
        },
        "criteria": {"threshold": 0.7},
        "proposal": proposal if proposal is not None else _proposal(content_output=_content_output()),
        "proposal_error": None,
    }


def _case(
    *,
    case_id: str = "case-tc-r01",
    display_id: str = "TC-R01",
    trigger_outcome: str = "rest_required",
    content_outcome: str = "complete_plan",
) -> dict:
    trigger = {
        "outcome": trigger_outcome,
        "max_fire_count": 1 if trigger_outcome != "none" else 0,
    }
    if trigger_outcome != "none":
        trigger.update(
            {
                "time_window_min": [15.0, 20.0],
                "required_positive_feature_ids": ["drowsiness_level"],
            }
        )

    content = {
        "expected_stage_outcome": content_outcome,
        "required_track_ids": [],
        "excluded_track_ids": [],
    }
    if content_outcome == "complete_plan":
        content.update(
            {
                "returned_count": 2,
                "required_track_ids": ["track-a"],
                "excluded_track_ids": ["track-skipped"],
                "oshi_artist_id": "artist-oshi",
                "mean_arousal_range": [0.65, 0.75],
            }
        )

    return {
        "case_id": case_id,
        "display_id": display_id,
        "group": "rest",
        "expectations": {
            "trigger": trigger,
            "service": {
                "rank_1_acceptable_ids": ["music_playlist"],
                "top_3_required_ids": ["music_playlist", "quiz"],
                "top_3_prohibited_ids": ["stretch_video"],
                "required_positive_feature_ids": ["driver_fatigue_level"],
            },
            "content": content,
        },
    }


def _result(*fires: dict) -> dict:
    return {
        "fires": list(fires),
        "fire": fires[0] if fires else None,
        "error": None,
        "track_index": {
            "track-a": {"artist_ids": ["artist-oshi"]},
            "track-b": {"artist_ids": ["artist-other"]},
            "track-skipped": {"artist_ids": ["artist-other"]},
        },
    }


def _check(evaluation: dict, check_id: str) -> dict:
    matches = [check for check in evaluation["checks"] if check["check_id"] == check_id]
    assert len(matches) == 1, (check_id, evaluation["checks"])
    return matches[0]


def test_expected_rest_with_matching_service_and_plan_is_match():
    evaluation = evaluate_case(_case(), _result(_fire()))

    assert evaluation["verdict"] == "MATCH"
    assert evaluation["actual"]["selected_fire"]["category"] == "rest_required"
    assert evaluation["actual"]["service"]["rank_1_id"] == "music_playlist"
    assert evaluation["actual"]["content"]["ordered_track_ids"] == ["track-a", "track-b"]
    assert _check(evaluation, "content.returned_count")["evidence_path"] == (
        "$.fires[category=rest_required][occurrence=1]"
        ".proposal.evidence[1].output.returned_item_count"
    )
    assert all(check["status"] == "MATCH" for check in evaluation["checks"])


def test_expected_no_fire_is_match_and_downstream_not_applicable():
    case = _case(trigger_outcome="none", content_outcome="not_applicable")
    case["expectations"]["service"] = {
        "rank_1_acceptable_ids": [],
        "top_3_required_ids": [],
        "top_3_prohibited_ids": [],
        "required_positive_feature_ids": [],
    }
    # The stale singular alias is intentionally populated: the evaluator must
    # use only ``fires`` and therefore still observe a no-fire run.
    result = _result()
    result["fire"] = _fire()

    evaluation = evaluate_case(case, result)

    assert evaluation["verdict"] == "MATCH"
    assert _check(evaluation, "trigger.outcome")["status"] == "MATCH"
    assert _check(evaluation, "service.stage")["status"] == "NOT_EVALUATED"
    assert _check(evaluation, "content.stage")["status"] == "NOT_EVALUATED"


def test_missing_expected_fire_is_mismatch_and_downstream_not_evaluated():
    evaluation = evaluate_case(_case(), _result())

    assert evaluation["verdict"] == "MISMATCH"
    assert _check(evaluation, "trigger.outcome")["status"] == "MISMATCH"
    assert sum(check["status"] == "MISMATCH" for check in evaluation["checks"]) == 1
    assert {
        check["status"]
        for check in evaluation["checks"]
        if check["stage"] in {"service", "content"}
    } == {"NOT_EVALUATED"}


def test_right_category_wrong_time_is_partial_match():
    evaluation = evaluate_case(
        _case(),
        # Tick 16 would be in-window if treated as minutes.  The wire contract's
        # authoritative ``time_min`` is 28.0 and must drive the partial verdict.
        _result(_fire(tick=16, time_min=28.0)),
    )

    assert _check(evaluation, "trigger.outcome")["status"] == "MATCH"
    assert _check(evaluation, "trigger.time_window_min")["status"] == "PARTIAL_MATCH"
    assert evaluation["verdict"] == "PARTIAL_MATCH"


def test_visible_output_with_missing_required_reason_is_partial_match():
    evaluation = evaluate_case(
        _case(),
        _result(_fire(trigger_feature_id="fatigue_level")),
    )

    reason = _check(evaluation, "trigger.required_positive_feature_ids")
    assert reason["status"] == "PARTIAL_MATCH"
    assert reason["actual"] == ["fatigue_level"]
    assert evaluation["verdict"] == "PARTIAL_MATCH"


def test_unsupported_content_is_read_from_algorithm_error_event():
    case = _case(content_outcome="unsupported_service")
    case["expectations"]["content"] = {
        "expected_stage_outcome": "unsupported_service",
        "required_track_ids": [],
        "excluded_track_ids": [],
    }
    proposal = _proposal(
        content_error_category="unsupported_service",
    )

    evaluation = evaluate_case(case, _result(_fire(proposal=proposal)))

    stage = _check(evaluation, "content.expected_stage_outcome")
    assert stage["actual"] == "unsupported_service"
    assert stage["status"] == "EXPECTED_LIMITATION"
    assert stage["evidence_path"] == (
        "$.fires[category=rest_required][occurrence=1]"
        ".proposal.events[0].payload.category"
    )
    assert evaluation["verdict"] == "EXPECTED_LIMITATION"


def test_unexpected_content_error_is_execution_error():
    proposal = _proposal(content_error_category="invalid_catalog")

    evaluation = evaluate_case(_case(), _result(_fire(proposal=proposal)))

    stage = _check(evaluation, "content.expected_stage_outcome")
    assert stage["actual"] == "invalid_catalog"
    assert stage["status"] == "EXECUTION_ERROR"
    assert evaluation["verdict"] == "EXECUTION_ERROR"


def test_top_level_error_is_execution_error_even_without_fires_field():
    result = {
        "error": {
            "error_type": "algorithm_error",
            "message": "fixture quickview failure",
        }
    }

    evaluation = evaluate_case(_case(), result)

    execution = _check(evaluation, "execution.quickview")
    assert execution["status"] == "EXECUTION_ERROR"
    assert execution["evidence_path"] == "$.error"
    assert _check(evaluation, "service.stage")["status"] == "NOT_EVALUATED"
    assert _check(evaluation, "content.stage")["status"] == "NOT_EVALUATED"
    assert evaluation["verdict"] == "EXECUTION_ERROR"


def test_multiple_fires_selects_declared_category_and_occurrence():
    case = _case()
    case["expectations"]["trigger"]["max_fire_count"] = 3
    later_rest = _fire(tick=20, time_min=20.0)
    early_monotony = _fire(
        category="monotony_prevention",
        tick=5,
        time_min=5.0,
        trigger_feature_id="road_monotony",
    )
    selected_rest = _fire(tick=16, time_min=16.0)

    evaluation = evaluate_case(
        case,
        _result(later_rest, early_monotony, selected_rest),
    )

    assert evaluation["actual"]["selected_fire"]["category"] == "rest_required"
    assert evaluation["actual"]["selected_fire"]["occurrence"] == 1
    assert evaluation["actual"]["selected_fire"]["tick"] == 16
    assert _check(evaluation, "trigger.outcome")["evidence_path"] == (
        "$.fires[category=rest_required][occurrence=1].category"
    )


def test_second_declared_occurrence_selects_second_category_fire():
    case = _case()
    case["expectations"]["trigger"]["occurrence"] = 2
    case["expectations"]["trigger"]["max_fire_count"] = 2

    evaluation = evaluate_case(
        case,
        _result(
            _fire(tick=16, time_min=16.0),
            _fire(tick=18, time_min=18.0),
        ),
    )

    assert evaluation["actual"]["selected_fire"]["occurrence"] == 2
    assert evaluation["actual"]["selected_fire"]["tick"] == 18
    assert _check(evaluation, "trigger.outcome")["evidence_path"] == (
        "$.fires[category=rest_required][occurrence=2].category"
    )
    assert "occurrence 2" in _check(evaluation, "trigger.outcome")["explanation"]
    assert evaluation["verdict"] == "MATCH"


def test_missing_declared_occurrence_is_mismatch_and_downstream_not_evaluated():
    case = _case()
    case["expectations"]["trigger"]["occurrence"] = 2

    evaluation = evaluate_case(case, _result(_fire()))

    assert _check(evaluation, "trigger.outcome")["status"] == "MISMATCH"
    assert evaluation["actual"]["selected_fire"] is None
    assert {
        check["status"]
        for check in evaluation["checks"]
        if check["stage"] in {"service", "content"}
    } == {"NOT_EVALUATED"}
    assert evaluation["verdict"] == "MISMATCH"


def test_empty_candidate_list_never_vacuously_matches():
    case = _case()
    case["expectations"]["service"] = {
        "rank_1_acceptable_ids": [],
        "top_3_required_ids": [],
        "top_3_prohibited_ids": [],
        "required_positive_feature_ids": [],
    }
    proposal = _proposal(service_output=_service_output([]))

    evaluation = evaluate_case(case, _result(_fire(proposal=proposal)))

    assert _check(evaluation, "service.rank_1")["status"] == "MISMATCH"
    assert _check(evaluation, "content.stage")["status"] == "NOT_EVALUATED"
    assert evaluation["verdict"] == "MISMATCH"


def test_wrong_service_decision_type_is_mismatch_and_content_not_evaluated():
    wrong_type_output = {
        **_service_output(),
        "decision_type": "no_proposal",
    }
    proposal = _proposal(service_output=wrong_type_output)

    evaluation = evaluate_case(_case(), _result(_fire(proposal=proposal)))

    stage = _check(evaluation, "service.stage")
    assert stage["actual"] == "no_proposal"
    assert stage["status"] == "MISMATCH"
    assert _check(evaluation, "content.stage")["status"] == "NOT_EVALUATED"
    assert evaluation["verdict"] == "MISMATCH"


def test_multiple_service_evidence_records_is_execution_error():
    proposal = _proposal(content_output=_content_output())
    proposal["evidence"].append(copy.deepcopy(proposal["evidence"][0]))

    evaluation = evaluate_case(_case(), _result(_fire(proposal=proposal)))

    assert _check(evaluation, "service.stage")["status"] == "EXECUTION_ERROR"
    assert _check(evaluation, "content.stage")["status"] == "NOT_EVALUATED"
    assert evaluation["verdict"] == "EXECUTION_ERROR"


@pytest.mark.parametrize(
    ("verdicts", "expected"),
    [
        (["MATCH", "EXPECTED_LIMITATION"], "EXPECTED_LIMITATION"),
        (["MATCH", "PARTIAL_MATCH"], "PARTIAL_MATCH"),
        (["PARTIAL_MATCH", "UNVERIFIABLE"], "UNVERIFIABLE"),
        (["UNVERIFIABLE", "MISMATCH"], "MISMATCH"),
        (["MISMATCH", "EXECUTION_ERROR"], "EXECUTION_ERROR"),
    ],
)
def test_suite_aggregation_uses_documented_precedence(verdicts, expected):
    summary = aggregate_suite(
        [
            {"case_id": f"case-{index}", "verdict": verdict}
            for index, verdict in enumerate(verdicts)
        ]
    )

    assert summary["total_cases"] == len(verdicts)
    assert summary["verdict"] == expected
    assert sum(summary["verdict_counts"].values()) == len(verdicts)


def test_evaluate_suite_attaches_reciprocal_contrast_deltas():
    baseline = _case()
    baseline["contrast"] = {
        "role": "baseline",
        "with_case_id": "TC-R02",
        "kind": "semantic_real_world",
        "changed_inputs": ["initial_drowsiness"],
        "expected_delta": {"ja": "後で", "en": "later"},
    }
    variant = _case(case_id="case-tc-r02", display_id="TC-R02")
    variant["contrast"] = {
        "role": "variant",
        "with_case_id": "TC-R01",
        "kind": "semantic_real_world",
        "changed_inputs": ["initial_drowsiness"],
        "expected_delta": {"ja": "早く", "en": "earlier"},
    }
    catalog = {"catalog_version": "1.0.0", "cases": [baseline, variant]}
    run_suite = {
        "case_results": [
            {"case_id": "case-tc-r01", "response": _result(_fire(tick=16, time_min=16.0))},
            {"case_id": "case-tc-r02", "response": _result(_fire(tick=20, time_min=20.0))},
        ]
    }

    suite = evaluate_suite(catalog, run_suite)

    by_display_id = {item["display_id"]: item for item in suite["case_results"]}
    delta = by_display_id["TC-R01"]["contrast_delta"]
    # Per-service score movement is recorded alongside the rank comparison so a
    # pair that moves scores without flipping rank 1 is still visible.
    assert "service_score_deltas" in delta
    assert "service_scores" in delta
    assert {k: v for k, v in delta.items()
            if k not in ("service_score_deltas", "service_scores")} == {
        "with_case_id": "TC-R02",
        "fire_count_delta": 0,
        "selected_fire_time_min_delta": -4.0,
        "trigger_score_delta": 0.0,
        "rank_1_service_changed": False,
        "returned_content_count_delta": 0,
        "mean_arousal_delta": 0.0,
    }
    assert by_display_id["TC-R02"]["contrast_delta"][
        "selected_fire_time_min_delta"
    ] == 4.0
    assert suite["summary"] == aggregate_suite(suite["case_results"])


def test_evaluate_suite_marks_missing_run_result_as_execution_error():
    suite = evaluate_suite(
        {"catalog_version": "1.0.0", "cases": [_case()]},
        {"case_results": []},
    )

    assert len(suite["case_results"]) == 1
    evaluation = suite["case_results"][0]
    assert _check(evaluation, "execution.quickview")["status"] == "EXECUTION_ERROR"
    assert evaluation["verdict"] == "EXECUTION_ERROR"
    assert suite["summary"]["verdict"] == "EXECUTION_ERROR"


def test_evaluate_case_is_pure():
    case = _case()
    result = _result(_fire())
    original_case = copy.deepcopy(case)
    original_result = copy.deepcopy(result)

    evaluate_case(case, result)

    assert case == original_case
    assert result == original_result
