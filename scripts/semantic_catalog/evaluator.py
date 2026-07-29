"""Pure semantic predicates over completed Combined quickview evidence.

The evaluator intentionally knows only the recorded wire shapes.  It does not
import, call, or reproduce any trigger/service/content algorithm.  Every result
is therefore a read-only adjudication of evidence that already exists.
"""

from __future__ import annotations

import copy
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

EVALUATOR_VERSION = "1.0.0"

_IN_SCOPE_CATEGORIES = frozenset({"rest_required", "monotony_prevention"})
_CASE_VERDICTS = (
    "MATCH",
    "PARTIAL_MATCH",
    "MISMATCH",
    "UNVERIFIABLE",
    "EXECUTION_ERROR",
    "EXPECTED_LIMITATION",
)
_PRECEDENCE = (
    "EXECUTION_ERROR",
    "MISMATCH",
    "UNVERIFIABLE",
    "PARTIAL_MATCH",
)


def _mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _sequence(value: Any) -> list[Any] | None:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return list(value)
    return None


def _number(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _check(
    check_id: str,
    stage: str,
    expected: Any,
    actual: Any,
    status: str,
    explanation: str,
    evidence_path: str,
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "stage": stage,
        "expected": copy.deepcopy(expected),
        "actual": copy.deepcopy(actual),
        "status": status,
        "explanation": explanation,
        "evidence_path": evidence_path,
    }


def _overall_verdict(checks: Sequence[Mapping[str, Any]]) -> str:
    statuses = {str(check.get("status")) for check in checks}
    for status in _PRECEDENCE:
        if status in statuses:
            return status
    if "EXPECTED_LIMITATION" in statuses:
        return "EXPECTED_LIMITATION"
    if "MATCH" in statuses:
        return "MATCH"
    return "UNVERIFIABLE"


def _fire_sort_key(fire: Mapping[str, Any]) -> tuple[float, str]:
    tick = _number(fire.get("tick"))
    return (float(tick) if tick is not None else float("inf"), str(fire.get("category") or ""))


def _fire_summary(fire: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "category": fire.get("category"),
        "tick": fire.get("tick"),
        "time_min": fire.get("time_min"),
        "strength": fire.get("strength"),
    }


def _positive_feature_ids(rows: Sequence[Any]) -> list[str]:
    found: list[str] = []
    for value in rows:
        row = _mapping(value)
        if row is None:
            continue
        feature_id = row.get("feature_id")
        contribution = _number(row.get("contribution"))
        if isinstance(feature_id, str) and contribution is not None and contribution > 0:
            if feature_id not in found:
                found.append(feature_id)
    return found


def _not_evaluated(
    check_id: str,
    stage: str,
    expected: Any,
    explanation: str,
) -> dict[str, Any]:
    return _check(
        check_id,
        stage,
        expected,
        None,
        "NOT_EVALUATED",
        explanation,
        "",
    )


def _base_actual(
    in_scope_fires: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "fire_count": len(in_scope_fires),
        "fires": [_fire_summary(fire) for fire in in_scope_fires],
        "selected_fire": None,
        "service": None,
        "content": None,
    }


def _base_evaluation(case: Mapping[str, Any], actual: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "case_id": case.get("case_id"),
        "display_id": case.get("display_id"),
        "group": case.get("group"),
        "evaluator_version": EVALUATOR_VERSION,
        "checks": [],
        "actual": copy.deepcopy(actual),
    }


def _finish(evaluation: dict[str, Any]) -> dict[str, Any]:
    evaluation["verdict"] = _overall_verdict(evaluation["checks"])
    return evaluation


def _append_trigger_not_evaluated_checks(
    checks: list[dict[str, Any]],
    trigger_expectation: Mapping[str, Any],
    explanation: str,
) -> None:
    for property_name in (
        "time_window_min",
        "max_fire_count",
        "required_positive_feature_ids",
    ):
        if property_name in trigger_expectation:
            checks.append(
                _not_evaluated(
                    f"trigger.{property_name}",
                    "trigger",
                    trigger_expectation[property_name],
                    explanation,
                )
            )


def _append_downstream_not_evaluated(
    checks: list[dict[str, Any]],
    expectations: Mapping[str, Any],
    explanation: str,
) -> None:
    checks.append(
        _not_evaluated(
            "service.stage",
            "service",
            expectations.get("service"),
            explanation,
        )
    )
    checks.append(
        _not_evaluated(
            "content.stage",
            "content",
            expectations.get("content"),
            explanation,
        )
    )


def _step_records(
    proposal: Mapping[str, Any], step: str
) -> tuple[list[tuple[int, Mapping[str, Any]]], bool]:
    evidence = _sequence(proposal.get("evidence"))
    if evidence is None:
        return [], False
    records = [
        (index, record)
        for index, value in enumerate(evidence)
        if (record := _mapping(value)) is not None and record.get("step") == step
    ]
    return records, True


def _content_error_event(
    proposal: Mapping[str, Any],
) -> tuple[int, Mapping[str, Any], Mapping[str, Any]] | None:
    events = _sequence(proposal.get("events"))
    if events is None:
        return None
    for index, value in enumerate(events):
        event = _mapping(value)
        if event is None or str(event.get("event_type", "")).upper() != "ALGORITHM_ERROR":
            continue
        payload = _mapping(event.get("payload"))
        if payload is not None and payload.get("step") == "content":
            return index, event, payload
    return None


def _candidate_sort_key(candidate: Mapping[str, Any]) -> tuple[float, str]:
    rank = _number(candidate.get("rank"))
    return (
        float(rank) if rank is not None else float("inf"),
        str(candidate.get("candidate_id") or ""),
    )


def _append_service_checks(
    checks: list[dict[str, Any]],
    expectation: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    evidence_base: str,
) -> bool:
    """Append service predicates and return whether content can be evaluated."""

    if not candidates:
        checks.append(
            _check(
                "service.rank_1",
                "service",
                expectation.get("rank_1_acceptable_ids", []),
                None,
                "MISMATCH",
                "The service selector returned no ranked candidate; an empty list is not a proposal.",
                f"{evidence_base}.output.ranked_candidates",
            )
        )
        return False

    rank_1 = candidates[0]
    rank_1_id = rank_1.get("candidate_id")
    acceptable = _sequence(expectation.get("rank_1_acceptable_ids")) or []
    rank_1_matches = not acceptable or rank_1_id in acceptable
    checks.append(
        _check(
            "service.rank_1",
            "service",
            acceptable if acceptable else "any ranked candidate",
            rank_1_id,
            "MATCH" if rank_1_matches else "MISMATCH",
            (
                f"Rank 1 was {rank_1_id!r}, which is acceptable for this hypothesis."
                if rank_1_matches
                else f"Rank 1 was {rank_1_id!r}, outside the authored acceptable set."
            ),
            f"{evidence_base}.output.ranked_candidates[rank=1].candidate_id",
        )
    )

    top_3_ids = [
        candidate.get("candidate_id")
        for candidate in candidates[:3]
        if isinstance(candidate.get("candidate_id"), str)
    ]

    required = _sequence(expectation.get("top_3_required_ids")) or []
    if required:
        missing = [candidate_id for candidate_id in required if candidate_id not in top_3_ids]
        checks.append(
            _check(
                "service.top_3_required_ids",
                "service",
                required,
                top_3_ids,
                "MATCH" if not missing else "PARTIAL_MATCH",
                (
                    "Every required service appeared in the top three."
                    if not missing
                    else f"The top three omitted required service(s): {', '.join(map(str, missing))}."
                ),
                f"{evidence_base}.output.ranked_candidates[rank<=3].candidate_id",
            )
        )

    prohibited = _sequence(expectation.get("top_3_prohibited_ids")) or []
    if prohibited:
        present = [candidate_id for candidate_id in prohibited if candidate_id in top_3_ids]
        checks.append(
            _check(
                "service.top_3_prohibited_ids",
                "service",
                {"absent": prohibited},
                top_3_ids,
                "MATCH" if not present else "MISMATCH",
                (
                    "No prohibited service appeared in the top three."
                    if not present
                    else f"Prohibited service(s) appeared in the top three: {', '.join(map(str, present))}."
                ),
                f"{evidence_base}.output.ranked_candidates[rank<=3].candidate_id",
            )
        )

    required_positive = _sequence(expectation.get("required_positive_feature_ids")) or []
    if required_positive:
        contribution_rows = _sequence(rank_1.get("feature_contributions"))
        if contribution_rows is None:
            checks.append(
                _check(
                    "service.required_positive_feature_ids",
                    "service",
                    required_positive,
                    None,
                    "UNVERIFIABLE",
                    "The rank-1 evidence did not expose feature contributions.",
                    f"{evidence_base}.output.ranked_candidates[rank=1].feature_contributions",
                )
            )
        else:
            positive = _positive_feature_ids(contribution_rows)
            missing = [feature_id for feature_id in required_positive if feature_id not in positive]
            checks.append(
                _check(
                    "service.required_positive_feature_ids",
                    "service",
                    required_positive,
                    positive,
                    "MATCH" if not missing else "PARTIAL_MATCH",
                    (
                        "The rank-1 candidate had every required positive reason."
                        if not missing
                        else f"The visible rank-1 output lacked required positive reason(s): {', '.join(missing)}."
                    ),
                    f"{evidence_base}.output.ranked_candidates[rank=1].feature_contributions",
                )
            )
    return True


def _artist_ids_from_metadata(value: Any) -> tuple[set[str], bool]:
    metadata = _mapping(value)
    if metadata is None:
        return set(), False

    found: set[str] = set()
    exposed = False

    for key in ("artist_id", "oshi_artist_id"):
        artist_id = metadata.get(key)
        if isinstance(artist_id, str):
            exposed = True
            found.add(artist_id)

    artist_ids = _sequence(metadata.get("artist_ids"))
    if artist_ids is not None:
        exposed = True
        found.update(value for value in artist_ids if isinstance(value, str))

    artists = _sequence(metadata.get("artists"))
    if artists is not None:
        exposed = True
        for artist in artists:
            if isinstance(artist, str):
                found.add(artist)
            elif (artist_mapping := _mapping(artist)) is not None:
                artist_id = artist_mapping.get("id") or artist_mapping.get("artist_id")
                if isinstance(artist_id, str):
                    found.add(artist_id)

    for key in ("metadata", "catalog_metadata", "track", "spotify_track"):
        nested = metadata.get(key)
        nested_ids, nested_exposed = _artist_ids_from_metadata(nested)
        found.update(nested_ids)
        exposed = exposed or nested_exposed

    return found, exposed


def _track_metadata(
    result: Mapping[str, Any],
    ordered_item: Mapping[str, Any],
    track_id: str,
) -> tuple[set[str], bool]:
    found, exposed = _artist_ids_from_metadata(ordered_item)
    if exposed:
        return found, True

    for key in ("track_index", "track_metadata", "content_track_index"):
        index = _mapping(result.get(key))
        if index is not None and track_id in index:
            found, exposed = _artist_ids_from_metadata(index[track_id])
            if exposed:
                return found, True

    tracks = _sequence(result.get("tracks"))
    if tracks is not None:
        for value in tracks:
            track = _mapping(value)
            if track is not None and (track.get("item_id") == track_id or track.get("track_id") == track_id):
                found, exposed = _artist_ids_from_metadata(track)
                if exposed:
                    return found, True
    return set(), False


def _append_complete_plan_checks(
    checks: list[dict[str, Any]],
    expectation: Mapping[str, Any],
    output: Mapping[str, Any],
    result: Mapping[str, Any],
    evidence_base: str,
) -> dict[str, Any]:
    ordered_values = _sequence(output.get("ordered_items"))
    ordered_items = (
        [item for value in ordered_values if (item := _mapping(value)) is not None]
        if ordered_values is not None
        else []
    )
    ordered_shape_valid = ordered_values is not None and len(ordered_items) == len(ordered_values)
    ordered_ids = [
        item.get("item_id")
        for item in ordered_items
        if isinstance(item.get("item_id"), str)
    ]

    excluded_values = _sequence(output.get("excluded_items"))
    excluded_items = (
        [item for value in excluded_values if (item := _mapping(value)) is not None]
        if excluded_values is not None
        else []
    )
    excluded_ids = [
        item.get("item_id")
        for item in excluded_items
        if isinstance(item.get("item_id"), str)
    ]

    returned_count = _number(output.get("returned_item_count"))
    arousal_values: list[float] = []
    arousal_complete = ordered_shape_valid
    for item in ordered_items:
        traits = _mapping(item.get("trait_values"))
        arousal = _number(traits.get("arousal")) if traits is not None else None
        if arousal is None:
            arousal_complete = False
        else:
            arousal_values.append(float(arousal))
    mean_arousal = (
        sum(arousal_values) / len(arousal_values)
        if arousal_values and arousal_complete
        else None
    )

    actual_content = {
        "stage_outcome": output.get("decision_type"),
        "returned_count": returned_count,
        "ordered_track_ids": ordered_ids,
        "excluded_track_ids": excluded_ids,
        "mean_arousal": mean_arousal,
        "ordered_items": copy.deepcopy(ordered_items),
        "excluded_items": copy.deepcopy(excluded_items),
        "error": None,
    }

    if "returned_count" in expectation:
        expected_count = expectation["returned_count"]
        if returned_count is None:
            status = "UNVERIFIABLE"
            explanation = "The content output did not expose returned_item_count."
        elif returned_count == expected_count:
            status = "MATCH"
            explanation = f"The content plan returned the expected {expected_count} item(s)."
        else:
            status = "PARTIAL_MATCH"
            explanation = (
                f"The content plan returned {returned_count} item(s), not the expected {expected_count}."
            )
        checks.append(
            _check(
                "content.returned_count",
                "content",
                expected_count,
                returned_count,
                status,
                explanation,
                f"{evidence_base}.output.returned_item_count",
            )
        )

    required_tracks = _sequence(expectation.get("required_track_ids")) or []
    if required_tracks:
        if not ordered_shape_valid:
            status = "UNVERIFIABLE"
            explanation = "The content output did not expose a valid ordered_items list."
        else:
            missing = [track_id for track_id in required_tracks if track_id not in ordered_ids]
            status = "MATCH" if not missing else "PARTIAL_MATCH"
            explanation = (
                "Every required track appeared in the returned plan."
                if not missing
                else f"The returned plan omitted required track(s): {', '.join(missing)}."
            )
        checks.append(
            _check(
                "content.required_track_ids",
                "content",
                required_tracks,
                ordered_ids if ordered_shape_valid else None,
                status,
                explanation,
                f"{evidence_base}.output.ordered_items[*].item_id",
            )
        )

    excluded_tracks = _sequence(expectation.get("excluded_track_ids")) or []
    if excluded_tracks:
        if not ordered_shape_valid:
            status = "UNVERIFIABLE"
            explanation = "The content output did not expose a valid ordered_items list."
        else:
            violations = [track_id for track_id in excluded_tracks if track_id in ordered_ids]
            status = "MATCH" if not violations else "PARTIAL_MATCH"
            explanation = (
                "Every authored excluded track was absent from the returned plan."
                if not violations
                else f"Excluded track(s) appeared in the returned plan: {', '.join(violations)}."
            )
        checks.append(
            _check(
                "content.excluded_track_ids",
                "content",
                {"absent": excluded_tracks},
                ordered_ids if ordered_shape_valid else None,
                status,
                explanation,
                f"{evidence_base}.output.ordered_items[*].item_id",
            )
        )

    expected_oshi = expectation.get("oshi_artist_id")
    if isinstance(expected_oshi, str):
        returned_artist_ids: set[str] = set()
        metadata_complete = ordered_shape_valid
        for item in ordered_items:
            track_id = item.get("item_id")
            if not isinstance(track_id, str):
                metadata_complete = False
                continue
            artist_ids, exposed = _track_metadata(result, item, track_id)
            returned_artist_ids.update(artist_ids)
            metadata_complete = metadata_complete and exposed
        if expected_oshi in returned_artist_ids:
            status = "MATCH"
            explanation = "The returned plan represents the authored OSHI artist."
        elif not metadata_complete:
            status = "UNVERIFIABLE"
            explanation = "The recorded output does not expose artist identity for every returned track."
        else:
            status = "PARTIAL_MATCH"
            explanation = "The returned plan does not represent the authored OSHI artist."
        checks.append(
            _check(
                "content.oshi_artist_id",
                "content",
                expected_oshi,
                sorted(returned_artist_ids) if returned_artist_ids or metadata_complete else None,
                status,
                explanation,
                f"{evidence_base}.output.ordered_items[*].item_id -> $.track_index",
            )
        )

    mean_range = _sequence(expectation.get("mean_arousal_range"))
    if mean_range is not None:
        bounds_valid = len(mean_range) == 2 and all(_number(value) is not None for value in mean_range)
        if not bounds_valid or mean_arousal is None:
            status = "UNVERIFIABLE"
            explanation = "A complete numeric arousal trace was not available for the returned plan."
        else:
            lower, upper = float(mean_range[0]), float(mean_range[1])
            in_range = lower <= mean_arousal <= upper
            status = "MATCH" if in_range else "PARTIAL_MATCH"
            explanation = (
                f"Mean arousal {mean_arousal:.3f} was inside the authored range."
                if in_range
                else f"Mean arousal {mean_arousal:.3f} was outside the authored range."
            )
        checks.append(
            _check(
                "content.mean_arousal_range",
                "content",
                mean_range,
                mean_arousal,
                status,
                explanation,
                f"{evidence_base}.output.ordered_items[*].trait_values.arousal",
            )
        )
    return actual_content


def _evaluate_content(
    checks: list[dict[str, Any]],
    expectation: Mapping[str, Any],
    proposal: Mapping[str, Any],
    result: Mapping[str, Any],
    fire_base: str,
) -> dict[str, Any] | None:
    expected_outcome = expectation.get("expected_stage_outcome")
    records, evidence_is_list = _step_records(proposal, "content")

    if len(records) > 1:
        checks.append(
            _check(
                "content.expected_stage_outcome",
                "content",
                expected_outcome,
                "multiple_content_evidence_records",
                "EXECUTION_ERROR",
                "The proposal contains more than one content evidence record.",
                f"{fire_base}.proposal.evidence",
            )
        )
        return {
            "stage_outcome": None,
            "returned_count": None,
            "ordered_track_ids": [],
            "excluded_track_ids": [],
            "mean_arousal": None,
            "ordered_items": [],
            "excluded_items": [],
            "error": "multiple_content_evidence_records",
        }

    actual_outcome: Any = None
    outcome_path = f"{fire_base}.proposal.evidence"
    output: Mapping[str, Any] | None = None
    content_evidence_base: str | None = None
    unexpected_error = False

    if records:
        evidence_index, record = records[0]
        evidence_base = f"{fire_base}.proposal.evidence[{evidence_index}]"
        content_evidence_base = evidence_base
        error = _mapping(record.get("error"))
        if error is not None:
            actual_outcome = error.get("category")
            outcome_path = f"{evidence_base}.error.category"
            unexpected_error = True
        else:
            output = _mapping(record.get("output"))
            if output is None:
                checks.append(
                    _check(
                        "content.expected_stage_outcome",
                        "content",
                        expected_outcome,
                        None,
                        "UNVERIFIABLE",
                        "The content evidence record has neither output nor a structured error.",
                        evidence_base,
                    )
                )
                return None
            actual_outcome = output.get("decision_type")
            outcome_path = f"{evidence_base}.output.decision_type"
    else:
        fallback = _content_error_event(proposal)
        if fallback is not None:
            event_index, _event, payload = fallback
            actual_outcome = payload.get("category")
            outcome_path = f"{fire_base}.proposal.events[{event_index}].payload.category"
            unexpected_error = True
        elif expected_outcome == "not_applicable":
            actual_outcome = "not_applicable"
            outcome_path = f"{fire_base}.proposal.evidence"
        else:
            checks.append(
                _check(
                    "content.expected_stage_outcome",
                    "content",
                    expected_outcome,
                    None,
                    "UNVERIFIABLE",
                    (
                        "The proposal exposed no content evidence or content-stage error."
                        if evidence_is_list
                        else "The proposal did not expose an evidence list."
                    ),
                    f"{fire_base}.proposal",
                )
            )
            return None

    if expected_outcome == "unsupported_service" and actual_outcome == "unsupported_service":
        status = "EXPECTED_LIMITATION"
        explanation = (
            "The frozen content-package boundary recorded the explicitly expected unsupported service."
        )
    elif unexpected_error:
        status = "EXECUTION_ERROR"
        explanation = f"The content stage failed unexpectedly with {actual_outcome!r}."
    elif actual_outcome == expected_outcome:
        status = "MATCH"
        explanation = f"The content stage produced the expected {expected_outcome!r} outcome."
    else:
        status = "MISMATCH"
        explanation = (
            f"The content stage produced {actual_outcome!r}, not the expected {expected_outcome!r}."
        )

    checks.append(
        _check(
            "content.expected_stage_outcome",
            "content",
            expected_outcome,
            actual_outcome,
            status,
            explanation,
            outcome_path,
        )
    )

    if output is not None and actual_outcome == "complete_plan" and expected_outcome == "complete_plan":
        assert content_evidence_base is not None
        return _append_complete_plan_checks(
            checks,
            expectation,
            output,
            result,
            content_evidence_base,
        )

    return {
        "stage_outcome": actual_outcome,
        "returned_count": None,
        "ordered_track_ids": [],
        "excluded_track_ids": [],
        "mean_arousal": None,
        "ordered_items": [],
        "excluded_items": [],
        "error": actual_outcome if unexpected_error else None,
    }


def evaluate_case(
    case: Mapping[str, Any],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    """Evaluate one compiled case against one completed quickview response.

    Both inputs are treated as immutable.  The singular ``result["fire"]``
    compatibility alias is deliberately ignored; only ``result["fires"]`` is
    authoritative.
    """

    expectations = _mapping(case.get("expectations")) or {}
    trigger_expectation = _mapping(expectations.get("trigger")) or {}
    service_expectation = _mapping(expectations.get("service")) or {}
    content_expectation = _mapping(expectations.get("content")) or {}

    top_level_error = result.get("error")
    if top_level_error is not None:
        evaluation = _base_evaluation(case, _base_actual([]))
        evaluation["checks"].append(
            _check(
                "execution.quickview",
                "execution",
                None,
                top_level_error,
                "EXECUTION_ERROR",
                "The quickview run ended with an unexpected trigger/orchestration error.",
                "$.error",
            )
        )
        _append_downstream_not_evaluated(
            evaluation["checks"],
            expectations,
            "Dependent stages were not evaluated because quickview execution failed.",
        )
        return _finish(evaluation)

    fire_values = _sequence(result.get("fires")) if "fires" in result else None
    if fire_values is None:
        evaluation = _base_evaluation(case, _base_actual([]))
        status = "EXECUTION_ERROR" if "fires" in result else "UNVERIFIABLE"
        evaluation["checks"].append(
            _check(
                "trigger.outcome",
                "trigger",
                trigger_expectation.get("outcome"),
                None,
                status,
                (
                    "The quickview fires field is not a list."
                    if "fires" in result
                    else "The quickview response does not expose the authoritative fires list."
                ),
                "$.fires",
            )
        )
        _append_downstream_not_evaluated(
            evaluation["checks"],
            expectations,
            "Dependent stages cannot be evaluated without an authoritative fires list.",
        )
        return _finish(evaluation)

    malformed_fires = [value for value in fire_values if _mapping(value) is None]
    fires = [fire for value in fire_values if (fire := _mapping(value)) is not None]
    in_scope_fires = sorted(
        [fire for fire in fires if fire.get("category") in _IN_SCOPE_CATEGORIES],
        key=_fire_sort_key,
    )
    evaluation = _base_evaluation(case, _base_actual(in_scope_fires))
    checks: list[dict[str, Any]] = evaluation["checks"]

    if malformed_fires:
        checks.append(
            _check(
                "trigger.outcome",
                "trigger",
                trigger_expectation.get("outcome"),
                "malformed_fire_record",
                "EXECUTION_ERROR",
                "The quickview fires list contains a non-object record.",
                "$.fires",
            )
        )
        _append_downstream_not_evaluated(
            checks,
            expectations,
            "Dependent stages cannot be evaluated from malformed fire evidence.",
        )
        return _finish(evaluation)

    expected_outcome = trigger_expectation.get("outcome")
    if expected_outcome == "none":
        if in_scope_fires:
            actual_outcome: Any = [fire.get("category") for fire in in_scope_fires]
            status = "MISMATCH"
            explanation = "An in-scope trigger fired during a declared no-fire journey."
        else:
            actual_outcome = "none"
            status = "MATCH"
            explanation = "No in-scope fire occurred during the complete declared journey."
        checks.append(
            _check(
                "trigger.outcome",
                "trigger",
                "none",
                actual_outcome,
                status,
                explanation,
                "$.fires",
            )
        )
        if status == "MATCH" and "max_fire_count" in trigger_expectation:
            maximum = trigger_expectation["max_fire_count"]
            checks.append(
                _check(
                    "trigger.max_fire_count",
                    "trigger",
                    {"maximum": maximum},
                    len(in_scope_fires),
                    "MATCH",
                    "The in-scope fire count stayed within the authored maximum.",
                    "$.fires",
                )
            )
        _append_downstream_not_evaluated(
            checks,
            expectations,
            "Service and content are not applicable to an expected no-fire journey.",
        )
        return _finish(evaluation)

    if expected_outcome not in _IN_SCOPE_CATEGORIES:
        checks.append(
            _check(
                "trigger.outcome",
                "trigger",
                expected_outcome,
                None,
                "UNVERIFIABLE",
                "The case does not declare a supported semantic trigger outcome.",
                "$.expectations.trigger.outcome",
            )
        )
        _append_downstream_not_evaluated(
            checks,
            expectations,
            "Dependent stages cannot be evaluated without a supported trigger outcome.",
        )
        return _finish(evaluation)

    requested_occurrence = trigger_expectation.get("occurrence", 1)
    if (
        isinstance(requested_occurrence, bool)
        or not isinstance(requested_occurrence, int)
        or requested_occurrence < 1
    ):
        checks.append(
            _check(
                "trigger.outcome",
                "trigger",
                expected_outcome,
                None,
                "UNVERIFIABLE",
                "The authored trigger occurrence must be a positive integer.",
                "$.expectations.trigger.occurrence",
            )
        )
        _append_downstream_not_evaluated(
            checks,
            expectations,
            "Dependent stages cannot be evaluated without a valid trigger occurrence.",
        )
        return _finish(evaluation)

    matching_fires = [fire for fire in in_scope_fires if fire.get("category") == expected_outcome]
    if len(matching_fires) < requested_occurrence:
        actual_categories = [fire.get("category") for fire in in_scope_fires]
        checks.append(
            _check(
                "trigger.outcome",
                "trigger",
                expected_outcome,
                actual_categories if actual_categories else "none",
                "MISMATCH",
                (
                    f"The requested {expected_outcome} occurrence "
                    f"{requested_occurrence} did not occur; "
                    f"{len(matching_fires)} occurrence(s) were recorded."
                ),
                "$.fires",
            )
        )
        _append_trigger_not_evaluated_checks(
            checks,
            trigger_expectation,
            "This trigger predicate depends on the absent expected fire.",
        )
        _append_downstream_not_evaluated(
            checks,
            expectations,
            "Service and content depend on the absent expected fire.",
        )
        return _finish(evaluation)

    occurrence = requested_occurrence
    selected = matching_fires[occurrence - 1]
    fire_base = f"$.fires[category={expected_outcome}][occurrence={occurrence}]"
    chain_container = _mapping(selected.get("feature_contributions"))
    chain = _mapping(chain_container.get(expected_outcome)) if chain_container is not None else None
    row_values = _sequence(chain.get("rows")) if chain is not None else None
    gate_values = _sequence(chain.get("gates")) if chain is not None else None
    rows = (
        [row for value in row_values if (row := _mapping(value)) is not None]
        if row_values is not None
        else []
    )
    gates = (
        [gate for value in gate_values if (gate := _mapping(value)) is not None]
        if gate_values is not None
        else []
    )
    selected_actual = {
        **_fire_summary(selected),
        "occurrence": occurrence,
        "score": chain.get("score") if chain is not None else None,
        "rows": copy.deepcopy(rows),
        "gates": copy.deepcopy(gates),
    }
    evaluation["actual"]["selected_fire"] = selected_actual

    checks.append(
        _check(
            "trigger.outcome",
            "trigger",
            expected_outcome,
            selected.get("category"),
            "MATCH",
            (
                (
                    f"The first {expected_outcome} fire"
                    if occurrence == 1
                    else f"The {expected_outcome} fire occurrence {occurrence}"
                )
                + f" occurred at {selected.get('time_min')} min."
            ),
            f"{fire_base}.category",
        )
    )

    if "time_window_min" in trigger_expectation:
        expected_window = _sequence(trigger_expectation.get("time_window_min"))
        time_min = _number(selected.get("time_min"))
        if (
            expected_window is None
            or len(expected_window) != 2
            or any(_number(value) is None for value in expected_window)
            or time_min is None
        ):
            time_status = "UNVERIFIABLE"
            time_explanation = "The authoritative fire time or authored time window is unavailable."
        else:
            lower, upper = float(expected_window[0]), float(expected_window[1])
            in_window = lower <= float(time_min) <= upper
            time_status = "MATCH" if in_window else "PARTIAL_MATCH"
            time_explanation = (
                f"The fire time {time_min} min was inside the authored window."
                if in_window
                else f"The category was right, but {time_min} min was outside the authored window."
            )
        checks.append(
            _check(
                "trigger.time_window_min",
                "trigger",
                expected_window,
                time_min,
                time_status,
                time_explanation,
                f"{fire_base}.time_min",
            )
        )

    if "max_fire_count" in trigger_expectation:
        maximum = trigger_expectation.get("max_fire_count")
        maximum_number = _number(maximum)
        if maximum_number is None:
            count_status = "UNVERIFIABLE"
            count_explanation = "The authored maximum fire count is not numeric."
        else:
            count_matches = len(in_scope_fires) <= maximum_number
            count_status = "MATCH" if count_matches else "MISMATCH"
            count_explanation = (
                "The in-scope fire count stayed within the authored maximum."
                if count_matches
                else f"The run produced {len(in_scope_fires)} in-scope fires, above the maximum {maximum_number}."
            )
        checks.append(
            _check(
                "trigger.max_fire_count",
                "trigger",
                {"maximum": maximum},
                len(in_scope_fires),
                count_status,
                count_explanation,
                "$.fires",
            )
        )

    required_trigger_features = (
        _sequence(trigger_expectation.get("required_positive_feature_ids")) or []
    )
    if required_trigger_features:
        rows_valid = row_values is not None and len(rows) == len(row_values)
        if not rows_valid:
            trigger_reason_status = "UNVERIFIABLE"
            positive_trigger_features: list[str] | None = None
            trigger_reason_explanation = (
                "The selected-category trigger chain did not expose valid contribution rows."
            )
        else:
            positive_trigger_features = _positive_feature_ids(rows)
            missing = [
                feature_id
                for feature_id in required_trigger_features
                if feature_id not in positive_trigger_features
            ]
            trigger_reason_status = "MATCH" if not missing else "PARTIAL_MATCH"
            trigger_reason_explanation = (
                "The selected trigger had every required positive reason."
                if not missing
                else f"The visible trigger lacked required positive reason(s): {', '.join(missing)}."
            )
        checks.append(
            _check(
                "trigger.required_positive_feature_ids",
                "trigger",
                required_trigger_features,
                positive_trigger_features,
                trigger_reason_status,
                trigger_reason_explanation,
                f"{fire_base}.feature_contributions.{expected_outcome}.rows",
            )
        )

    proposal_error = selected.get("proposal_error")
    proposal = _mapping(selected.get("proposal"))
    if proposal_error is not None:
        checks.append(
            _check(
                "service.stage",
                "service",
                service_expectation,
                proposal_error,
                "EXECUTION_ERROR",
                "The selected fire's proposal projection failed unexpectedly.",
                f"{fire_base}.proposal_error",
            )
        )
        evaluation["actual"]["service"] = {"error": copy.deepcopy(proposal_error)}
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on a successfully projected service proposal.",
            )
        )
        return _finish(evaluation)

    if proposal is None:
        checks.append(
            _check(
                "service.stage",
                "service",
                service_expectation,
                None,
                "UNVERIFIABLE",
                "The expected fire has no attached proposal evidence.",
                f"{fire_base}.proposal",
            )
        )
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on an attached service proposal.",
            )
        )
        return _finish(evaluation)

    service_records, evidence_is_list = _step_records(proposal, "service")
    if len(service_records) != 1:
        status = "EXECUTION_ERROR" if len(service_records) > 1 else "UNVERIFIABLE"
        checks.append(
            _check(
                "service.stage",
                "service",
                "exactly one service evidence record",
                len(service_records) if evidence_is_list else None,
                status,
                (
                    "The proposal contains multiple service evidence records."
                    if len(service_records) > 1
                    else "The proposal exposes no service evidence record."
                ),
                f"{fire_base}.proposal.evidence",
            )
        )
        evaluation["actual"]["service"] = {"error": "service_evidence_cardinality"}
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on one resolved service evidence record.",
            )
        )
        return _finish(evaluation)

    service_index, service_record = service_records[0]
    service_base = f"{fire_base}.proposal.evidence[{service_index}]"
    service_error = _mapping(service_record.get("error"))
    if service_error is not None:
        checks.append(
            _check(
                "service.stage",
                "service",
                "successful service output",
                service_error,
                "EXECUTION_ERROR",
                "The service selector recorded an unexpected algorithm error.",
                f"{service_base}.error",
            )
        )
        evaluation["actual"]["service"] = {"error": copy.deepcopy(service_error)}
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on a successful service selection.",
            )
        )
        return _finish(evaluation)

    service_output = _mapping(service_record.get("output"))
    if (
        service_output is not None
        and service_output.get("decision_type") != "ranked_candidates"
    ):
        decision_type = service_output.get("decision_type")
        checks.append(
            _check(
                "service.stage",
                "service",
                "ranked_candidates",
                decision_type,
                "MISMATCH",
                (
                    f"The service stage produced {decision_type!r}, not the "
                    "required ranked_candidates outcome."
                ),
                f"{service_base}.output.decision_type",
            )
        )
        evaluation["actual"]["service"] = {
            "rank_1_id": None,
            "top_3_ids": [],
            "ranked_candidates": [],
            "error": None,
            "stage_outcome": decision_type,
        }
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on a ranked service outcome.",
            )
        )
        return _finish(evaluation)

    candidate_values = (
        _sequence(service_output.get("ranked_candidates"))
        if service_output is not None
        else None
    )
    if candidate_values is None:
        checks.append(
            _check(
                "service.stage",
                "service",
                "ranked_candidates output",
                None,
                "UNVERIFIABLE",
                "The service evidence does not expose a ranked_candidates list.",
                f"{service_base}.output.ranked_candidates",
            )
        )
        evaluation["actual"]["service"] = {"error": "missing_ranked_candidates"}
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on a usable rank-1 service.",
            )
        )
        return _finish(evaluation)

    candidates = [
        candidate
        for value in candidate_values
        if (candidate := _mapping(value)) is not None
    ]
    if len(candidates) != len(candidate_values):
        checks.append(
            _check(
                "service.stage",
                "service",
                "object-shaped ranked candidates",
                "malformed_candidate",
                "EXECUTION_ERROR",
                "The service output contains a malformed ranked candidate.",
                f"{service_base}.output.ranked_candidates",
            )
        )
        evaluation["actual"]["service"] = {"error": "malformed_candidate"}
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content depends on a valid rank-1 service.",
            )
        )
        return _finish(evaluation)

    candidates = sorted(candidates, key=_candidate_sort_key)
    top_3 = candidates[:3]
    rank_1_id = candidates[0].get("candidate_id") if candidates else None
    top_3_ids = [
        candidate.get("candidate_id")
        for candidate in top_3
        if isinstance(candidate.get("candidate_id"), str)
    ]
    evaluation["actual"]["service"] = {
        "rank_1_id": rank_1_id,
        "top_3_ids": top_3_ids,
        "ranked_candidates": copy.deepcopy(top_3),
        "error": None,
    }
    checks.append(
        _check(
            "service.stage",
            "service",
            "ranked_candidates",
            service_output.get("decision_type"),
            "MATCH",
            "Exactly one successful service evidence record was resolved.",
            f"{service_base}.output.decision_type",
        )
    )
    content_evaluable = _append_service_checks(
        checks,
        service_expectation,
        candidates,
        service_base,
    )
    if not content_evaluable:
        checks.append(
            _not_evaluated(
                "content.stage",
                "content",
                content_expectation,
                "Content cannot run without a usable rank-1 service.",
            )
        )
        return _finish(evaluation)

    evaluation["actual"]["content"] = _evaluate_content(
        checks,
        content_expectation,
        proposal,
        result,
        fire_base,
    )
    return _finish(evaluation)


def aggregate_suite(
    case_results: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Count case verdicts and apply the documented suite precedence."""

    results = list(case_results)
    verdict_counter = Counter(
        result.get("verdict")
        if result.get("verdict") in _CASE_VERDICTS
        else "UNVERIFIABLE"
        for result in results
    )
    verdict_counts = {
        status: verdict_counter.get(status, 0)
        for status in _CASE_VERDICTS
    }
    present = {status for status, count in verdict_counts.items() if count}
    for status in _PRECEDENCE:
        if status in present:
            verdict = status
            break
    else:
        verdict = "EXPECTED_LIMITATION" if "EXPECTED_LIMITATION" in present else (
            "MATCH" if "MATCH" in present else "UNVERIFIABLE"
        )

    group_counter = Counter(
        str(result.get("group"))
        for result in results
        if result.get("group") is not None
    )
    return {
        "total_cases": len(results),
        "verdict": verdict,
        "verdict_counts": verdict_counts,
        "group_counts": dict(sorted(group_counter.items())),
    }


def _numeric_delta(left: Any, right: Any) -> float | int | None:
    left_number = _number(left)
    right_number = _number(right)
    if left_number is None or right_number is None:
        return None
    return left_number - right_number


def _contrast_delta(
    evaluation: Mapping[str, Any],
    other: Mapping[str, Any],
    with_case_id: str,
) -> dict[str, Any]:
    actual = _mapping(evaluation.get("actual")) or {}
    other_actual = _mapping(other.get("actual")) or {}
    selected = _mapping(actual.get("selected_fire")) or {}
    other_selected = _mapping(other_actual.get("selected_fire")) or {}
    service = _mapping(actual.get("service")) or {}
    other_service = _mapping(other_actual.get("service")) or {}
    content = _mapping(actual.get("content")) or {}
    other_content = _mapping(other_actual.get("content")) or {}

    left_rank_1 = service.get("rank_1_id")
    right_rank_1 = other_service.get("rank_1_id")
    rank_changed = (
        left_rank_1 != right_rank_1
        if left_rank_1 is not None and right_rank_1 is not None
        else None
    )
    return {
        "with_case_id": with_case_id,
        "fire_count_delta": _numeric_delta(
            actual.get("fire_count"),
            other_actual.get("fire_count"),
        ),
        "selected_fire_time_min_delta": _numeric_delta(
            selected.get("time_min"),
            other_selected.get("time_min"),
        ),
        "trigger_score_delta": _numeric_delta(
            selected.get("score"),
            other_selected.get("score"),
        ),
        "rank_1_service_changed": rank_changed,
        "returned_content_count_delta": _numeric_delta(
            content.get("returned_count"),
            other_content.get("returned_count"),
        ),
        "mean_arousal_delta": _numeric_delta(
            content.get("mean_arousal"),
            other_content.get("mean_arousal"),
        ),
    }


def _run_entries(run_suite: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    for key in ("case_results", "results", "runs"):
        value = run_suite.get(key)
        if isinstance(value, Mapping):
            return [
                (
                    {**entry, "case_id": entry.get("case_id", case_id)}
                    if isinstance(entry, Mapping)
                    else {"case_id": case_id, "response": entry}
                )
                for case_id, entry in value.items()
            ]
        sequence = _sequence(value)
        if sequence is not None:
            return [
                entry
                for value in sequence
                if (entry := _mapping(value)) is not None
            ]
    return []


def _entry_response(entry: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in ("response", "quickview_response", "result"):
        response = _mapping(entry.get(key))
        if response is not None:
            return response
    return entry


def evaluate_suite(
    catalog: Mapping[str, Any],
    run_suite: Mapping[str, Any],
) -> dict[str, Any]:
    """Evaluate every catalog case and attach reciprocal contrast deltas."""

    case_values = _sequence(catalog.get("cases")) or []
    cases = [
        case
        for value in case_values
        if (case := _mapping(value)) is not None
    ]
    entries = _run_entries(run_suite)
    entry_by_id: dict[str, Mapping[str, Any]] = {}
    for entry in entries:
        for key in ("case_id", "display_id"):
            value = entry.get(key)
            if isinstance(value, str):
                entry_by_id[value] = entry

    evaluated: list[dict[str, Any]] = []
    case_by_display_id: dict[str, Mapping[str, Any]] = {}
    for case in cases:
        case_id = case.get("case_id")
        display_id = case.get("display_id")
        entry = (
            entry_by_id.get(str(case_id))
            or entry_by_id.get(str(display_id))
        )
        if entry is None:
            response: Mapping[str, Any] = {
                "fires": [],
                "error": {
                    "category": "missing_run_result",
                    "message": "No quickview result was supplied for this catalog case.",
                },
            }
        else:
            response = _entry_response(entry)
        evaluation = evaluate_case(case, response)
        evaluated.append(evaluation)
        if isinstance(display_id, str):
            case_by_display_id[display_id] = case

    evaluation_by_id: dict[str, dict[str, Any]] = {}
    for evaluation in evaluated:
        for key in ("case_id", "display_id"):
            value = evaluation.get(key)
            if isinstance(value, str):
                evaluation_by_id[value] = evaluation

    contrast_deltas: list[dict[str, Any]] = []
    for evaluation in evaluated:
        display_id = evaluation.get("display_id")
        case = case_by_display_id.get(str(display_id))
        contrast = _mapping(case.get("contrast")) if case is not None else None
        with_case_id = contrast.get("with_case_id") if contrast is not None else None
        other = (
            evaluation_by_id.get(with_case_id)
            if isinstance(with_case_id, str)
            else None
        )
        if other is None or not isinstance(with_case_id, str):
            continue
        delta = _contrast_delta(evaluation, other, with_case_id)
        evaluation["contrast_delta"] = delta
        contrast_deltas.append(
            {
                "case_id": evaluation.get("case_id"),
                "display_id": display_id,
                **delta,
            }
        )

    return {
        "evaluator_version": EVALUATOR_VERSION,
        "catalog_version": catalog.get("catalog_version") or catalog.get("version"),
        "case_results": evaluated,
        "contrast_deltas": contrast_deltas,
        "summary": aggregate_suite(evaluated),
    }


__all__ = [
    "EVALUATOR_VERSION",
    "aggregate_suite",
    "evaluate_case",
    "evaluate_suite",
]
