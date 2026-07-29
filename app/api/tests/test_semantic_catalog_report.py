"""Customer-facing HTML rendering for evaluated semantic catalog suites."""

from __future__ import annotations

import copy
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = _REPO_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from semantic_catalog.report import render_report  # noqa: E402


_STATUSES = {
    "MATCH",
    "PARTIAL_MATCH",
    "MISMATCH",
    "NOT_EVALUATED",
    "UNVERIFIABLE",
    "EXECUTION_ERROR",
    "EXPECTED_LIMITATION",
}


def _text(en: str, ja: str = "日本語") -> dict[str, str]:
    return {"en": en, "ja": ja}


def two_case_catalog() -> dict:
    return {
        "catalog_id": "semantic-combined-experience",
        "catalog_version": "1.0.0",
        "case_schema_version": "1.0.0",
        "reference_time": "2026-07-29T12:00:00Z",
        "cases": [
            {
                "case_id": "case-tc-r01",
                "display_id": "TC-R01",
                "title": _text("Protect a late-shift worker"),
                "brief": _text("A sleep-deprived worker drives home after midnight."),
                "group": "rest",
                "purpose": _text("Test an early, actionable rest proposal."),
                "what_to_watch": [_text("Trigger timing and downstream proposal.")],
                "real_world": {
                    "who": _text("A hospital worker finishing a late shift."),
                    "before_trip": _text("The driver slept only four hours."),
                    "trip_reason": _text("Drive home on a familiar highway."),
                    "state_at_departure": _text("Already sleepy and fatigued."),
                    "journey_evolution": _text(
                        "Sleepiness increases before the final service area."
                    ),
                    "relevant_profile_history": _text(
                        "Music playlists have helped on prior drives."
                    ),
                    "expected_aica_behavior": _text(
                        "Offer rest early and then a low-distraction service."
                    ),
                },
                "hypothesis": {
                    "rationale": _text(
                        "High starting drowsiness and growth make an early rest "
                        "proposal appropriate."
                    )
                },
                "expectations": {
                    "trigger": {
                        "outcome": "rest_required",
                        "time_window_min": [10, 20],
                    },
                    "service": {
                        "rank_1_acceptable_ids": ["music_playlist"],
                    },
                    "content": {
                        "expected_stage_outcome": "complete_plan",
                        "returned_count": 5,
                    },
                },
                "contrast": {
                    "role": "baseline",
                    "with_case_id": "TC-R02",
                    "kind": "semantic_real_world",
                    "changed_inputs": [
                        "journey.scenario.initial_drowsiness",
                        "journey.scenario.initial_fatigue",
                    ],
                    "expected_delta": _text(
                        "The well-rested journey should remain quiet."
                    ),
                },
                "persona": {
                    "name": _text("Late-shift worker"),
                    "narrative": _text("A worker who wants to reach home safely."),
                    "profile_ref": "profile-semantic-neutral",
                },
                "journey": {
                    "narrative": _text("A 75-minute night-highway journey."),
                    "scenario": {
                        "initial_drowsiness": 68,
                        "initial_fatigue": 58,
                        "is_night": True,
                        "tick_seconds": 180,
                    },
                },
                "algorithm_defaults": {
                    "trigger": "aica_transparent_hybrid_trigger_v1",
                    "service": "aica_transparent_service_selector_v1",
                    "content": "aica_transparent_content_selector_v1",
                },
            },
            {
                "case_id": "case-tc-r02",
                "display_id": "TC-R02",
                "title": _text(
                    "Keep a well-rested worker driving "
                    "(contrast with test case ID TC-R01)"
                ),
                "brief": _text("The same worker starts the trip well rested."),
                "group": "rest",
                "expectations": {"trigger": {"outcome": "none"}},
                "contrast": {
                    "role": "variant",
                    "with_case_id": "TC-R01",
                    "kind": "semantic_real_world",
                },
            },
        ],
    }


def _service(candidate_id: str, rank: int, contribution: float) -> dict:
    return {
        "candidate_id": candidate_id,
        "rank": rank,
        "score": round(0.9 - rank / 10, 2),
        "supporting_feature_ids": ["driver_fatigue_level"],
        "opposing_feature_ids": ["service_recency"],
        "feature_contributions": [
            {
                "feature_id": "driver_fatigue_level",
                "feature_value": 78,
                "contribution": contribution,
            },
            {
                "feature_id": "service_recency",
                "feature_value": "recent",
                "contribution": -0.08,
            },
        ],
    }


def _content(position: int) -> dict:
    return {
        "position": position,
        "item_id": f"track-{position}",
        "title": f"Catalog track {position}",
        "artist_names": [f"Artist {position}"],
        "genres": ["rock" if position % 2 else "pop"],
        "trait_values": {
            "arousal": round(0.5 + position / 20, 2),
            "valence": round(0.6 + position / 30, 2),
        },
        "item_fit": round(0.95 - position / 20, 2),
    }


def evaluated_fixture() -> dict:
    fire = {
        "category": "rest_required",
        "tick": 6,
        "time_min": 18.0,
        "strength": "strong",
        "score": 0.82,
        "feature_contributions": {
            "rest_required": {
                "score": 0.82,
                "rows": [
                    {
                        "feature_id": "driver_drowsiness_level",
                        "value": 81,
                        "band": "high",
                        "weight": 0.5,
                        "contribution": 0.405,
                    }
                ],
                "gates": [
                    {
                        "gate_id": "vehicle_is_moving",
                        "passed": True,
                        "explanation": "The vehicle was moving.",
                    }
                ],
            }
        },
    }
    return {
        "evaluator_version": "semantic-evaluator-v1",
        "generated_at": "2026-07-29T13:00:00Z",
        "summary": {
            "total_cases": 2,
            "verdict": "EXPECTED_LIMITATION",
            "verdict_counts": {"MATCH": 1, "EXPECTED_LIMITATION": 1},
            "group_counts": {"rest": 2},
        },
        "provenance": {
            "package_ids": {
                "trigger": "aica_transparent_hybrid_trigger_v1",
                "service": "aica_transparent_service_selector_v1",
                "content": "aica_transparent_content_selector_v1",
            }
        },
        "findings": [
            {
                "title": "Frozen algorithm finding",
                "explanation": (
                    "The content package records an explicit unsupported-service "
                    "boundary."
                ),
                "case_ids": ["TC-R02"],
            }
        ],
        "case_results": [
            {
                "case_id": "case-tc-r01",
                "display_id": "TC-R01",
                "verdict": "MATCH",
                "verdict_explanation": "The observed chain fits this hypothesis.",
                "caveat": "Simulator evidence is not a road-safety certification.",
                "checks": [
                    {
                        "check_id": "trigger.time_window_min",
                        "stage": "trigger",
                        "expected": [10, 20],
                        "actual": 18.0,
                        "status": "MATCH",
                        "explanation": "The first fire was inside the authored window.",
                        "evidence_path": "$.fires[0].time_min",
                    }
                ],
                "actual": {
                    "fires": [fire],
                    "selected_fire": fire,
                    "service": {
                        "rank_1_id": "music_playlist",
                        "ranked_candidates": [
                            _service("music_playlist", 1, 0.42),
                            _service("breathing_coach", 2, 0.31),
                            _service("call_and_response", 3, 0.19),
                        ],
                    },
                    "content": {
                        "stage_outcome": "complete_plan",
                        "returned_count": 5,
                        "ordered_items": [_content(position) for position in range(1, 6)],
                    },
                },
                "contrast_delta": {
                    "with_case_id": "TC-R02",
                    "selected_fire_time_min_delta": -18.0,
                    "rank_1_service_changed": True,
                },
                "audit": {
                    "request_sha256": "request-sha-123",
                    "response_sha256": "response-sha-456",
                    "request": {
                        "scenario_id": "semantic_tc_r01",
                        "run_seed": 42,
                    },
                    "response": {
                        "selected_fire": {
                            "category": "rest_required",
                            "time_min": 18.0,
                        }
                    },
                },
            },
            {
                "case_id": "case-tc-r02",
                "display_id": "TC-R02",
                "verdict": "EXPECTED_LIMITATION",
                "checks": [
                    {
                        "check_id": "content.expected_stage_outcome",
                        "stage": "content",
                        "expected": "unsupported_service",
                        "actual": "unsupported_service",
                        "status": "EXPECTED_LIMITATION",
                        "explanation": "The frozen package boundary was observed.",
                        "evidence_path": "$.fires[0].proposal.events[0]",
                    }
                ],
                "actual": {
                    "selected_fire": None,
                    "service": None,
                    "content": {
                        "stage_outcome": "unsupported_service",
                        "error": {
                            "category": "unsupported_service",
                            "message": "No content plan exists for the selected service.",
                        },
                    },
                },
            },
        ],
    }


def production_shape_catalog_and_suite() -> tuple[dict, dict]:
    catalog = two_case_catalog()
    case = catalog["cases"][0]
    case["journey"] = {
        "narrative": _text("The compiled journey uses referenced runtime inputs."),
        "scenario_ref": "semantic_tc_r01",
        "route_preset_ref": "long_tokyo_osaka",
        "seed": 99,
        "tick_seconds": 30,
        "fixed_overrides": {
            "initial_drowsiness": 73,
            "is_night": True,
        },
        "automatic_path": {"service_choice": "rank_1"},
    }
    suite = evaluated_fixture()
    suite["case_results"][0]["resolved_inputs"] = {
        "scenario": {
            "id": "semantic_tc_r01",
            "initial_state": {"drowsiness_level": 73},
            "weather_risk": 27,
        },
        "profile": {
            "profile_id": "profile-semantic-runner-resolved",
            "driver_profile": {
                "oshi_mode": "registered",
                "played_items": [{"track_id": "runner-track-9"}],
            },
        },
    }
    return catalog, suite


class _StructureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.case_ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(attributes["id"] or "")
        if "case-detail" in (attributes.get("class") or "").split():
            self.case_ids.append(attributes.get("id") or "")


def test_render_report_is_self_contained_and_has_one_detail_per_case():
    html = render_report(two_case_catalog(), evaluated_fixture())

    assert "<!doctype html>" in html.lower()
    assert "TC-R01" in html and "TC-R02" in html
    assert "Expected vs actual" in html
    assert "Frozen algorithm finding" in html
    assert "https://" not in html and "http://" not in html
    assert html.count('class="case-detail"') == 2
    assert 'aria-label="Filter by verdict"' in html
    assert 'aria-label="Filter by group"' in html
    assert 'aria-label="Filter by expected trigger"' in html
    assert 'aria-label="Filter by contrast role"' in html
    assert "<script" in html and "<style" in html

    parser = _StructureParser()
    parser.feed(html)
    assert len(parser.ids) == len(set(parser.ids))
    assert len(parser.case_ids) == 2
    assert all(parser.case_ids)


def test_render_report_includes_overview_complete_evidence_and_bounded_audit():
    suite = evaluated_fixture()
    suite["case_results"][0]["audit"]["request"]["oversized_payload"] = (
        "REQUEST_SECRET_" * 25_000
    )
    suite["case_results"][0]["audit"]["response"]["oversized_payload"] = (
        "RESPONSE_SECRET_" * 25_000
    )
    suite["case_results"][0]["audit"]["response"]["wide_payload"] = {
        f"field_{index:03d}": "WIDE_SECRET_" * 200 for index in range(100)
    }

    html = render_report(two_case_catalog(), suite)

    assert "aica_transparent_hybrid_trigger_v1" in html
    assert "Coverage by group" in html
    assert "Appropriate for this hypothesis" in html
    assert "Full real-world setup" in html
    assert "initial_drowsiness" in html and ">68<" in html
    assert "driver_drowsiness_level" in html
    assert "vehicle_is_moving" in html
    assert "music_playlist" in html
    assert "breathing_coach" in html
    assert "call_and_response" in html
    assert all(f"Catalog track {position}" in html for position in range(1, 6))
    assert "Artist 1" in html and "rock" in html
    assert "Arousal" in html and "Valence" in html
    assert "selected_fire_time_min_delta" in html
    assert 'href="#case-002-tc-r02"' in html
    assert 'href="#case-001-tc-r01"' in html
    assert "request-sha-123" in html and "response-sha-456" in html
    assert "REQUEST_SECRET_REQUEST_SECRET_" not in html
    assert "RESPONSE_SECRET_RESPONSE_SECRET_" not in html
    assert "WIDE_SECRET_WIDE_SECRET_" not in html
    audit_section = re.search(
        r"<section><h4>Audit evidence</h4>.*?</section>",
        html,
        flags=re.DOTALL,
    )
    assert audit_section is not None
    assert len(audit_section.group(0)) <= 16_384
    assert '"_audit_truncated": true' in html
    assert '"_omitted_payload_sha256":' in html
    assert re.search(r"[a-f0-9]{64}", audit_section.group(0))


def test_render_report_shows_compiled_journey_and_runner_resolved_input_facts():
    catalog, suite = production_shape_catalog_and_suite()

    html = render_report(catalog, suite)

    assert "journey.scenario_ref" in html and "semantic_tc_r01" in html
    assert "journey.route_preset_ref" in html and "long_tokyo_osaka" in html
    assert "journey.seed" in html and ">99<" in html
    assert "journey.tick_seconds" in html and ">30<" in html
    assert "journey.fixed_overrides.initial_drowsiness" in html
    assert "journey.fixed_overrides.is_night" in html
    assert "journey.automatic_path.service_choice" in html
    assert "resolved_scenario.initial_state.drowsiness_level" in html
    assert "resolved_scenario.weather_risk" in html
    assert "resolved_profile.driver_profile.oshi_mode" in html
    assert "runner-track-9" in html


def test_audit_section_budget_applies_after_html_escaping():
    suite = evaluated_fixture()
    audit = suite["case_results"][0]["audit"]
    for key in (
        "request_sha256",
        "canonical_request_sha256",
        "response_sha256",
        "normalized_response_sha256",
        "http_status",
    ):
        audit[key] = "&" * 1_000
    audit["package_ids"] = {
        f"package_{index}": "&" * 1_000 for index in range(5)
    }

    html = render_report(two_case_catalog(), suite)

    audit_section = re.search(
        r"<section><h4>Audit evidence</h4>.*?</section>",
        html,
        flags=re.DOTALL,
    )
    assert audit_section is not None
    assert len(audit_section.group(0)) <= 16_384
    assert "_audit_truncated" in audit_section.group(0)
    assert "_omitted_payload_sha256" in audit_section.group(0)


def test_render_report_exposes_every_design_status_and_tolerates_missing_detail():
    catalog = two_case_catalog()
    suite = evaluated_fixture()
    suite["case_results"][1].pop("checks")
    suite["case_results"][1]["actual"] = {}

    html = render_report(catalog, suite)

    assert _STATUSES <= set(re.findall(r'<option value="([A-Z_]+)"', html))
    assert html.count('class="case-detail"') == 2
    assert "No service result recorded." in html
    assert "No content result recorded." in html
    assert "candidate-1" not in html
    assert "track-1" in html  # recorded for TC-R01 only


@pytest.mark.parametrize("recorded_count", [1, 2])
def test_render_report_labels_incomplete_ranked_service_results(recorded_count):
    suite = evaluated_fixture()
    service = suite["case_results"][0]["actual"]["service"]
    service["ranked_candidates"] = service["ranked_candidates"][:recorded_count]

    html = render_report(two_case_catalog(), suite)

    assert (
        f"Only {recorded_count} of 3 ranked services were recorded." in html
    )


@pytest.mark.parametrize("recorded_count", [1, 2, 3, 4])
def test_render_report_labels_incomplete_complete_plan_content(recorded_count):
    suite = evaluated_fixture()
    content = suite["case_results"][0]["actual"]["content"]
    content["ordered_items"] = content["ordered_items"][:recorded_count]
    content["returned_count"] = recorded_count

    html = render_report(two_case_catalog(), suite)

    assert (
        f"Only {recorded_count} of 5 content items were recorded for a complete plan."
        in html
    )


def test_render_report_escapes_authored_and_observed_text_and_is_pure():
    catalog = two_case_catalog()
    suite = evaluated_fixture()
    catalog["cases"][0]["title"]["en"] = '<img src=x onerror="alert(1)">'
    suite["case_results"][0]["checks"][0]["actual"] = "<script>alert(2)</script>"
    before_catalog = copy.deepcopy(catalog)
    before_suite = copy.deepcopy(suite)

    html = render_report(catalog, suite)

    assert '<img src=x onerror="alert(1)">' not in html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in html
    assert "<script>alert(2)</script>" not in html
    assert "&lt;script&gt;alert(2)&lt;/script&gt;" in html
    assert catalog == before_catalog
    assert suite == before_suite


def test_render_report_redacts_external_urls_in_authored_and_audit_values():
    catalog = two_case_catalog()
    suite = evaluated_fixture()
    catalog["cases"][0]["title"]["en"] = (
        'Visit HTTPS://customer.example/path?q=1 <img src=x onerror="alert(1)">'
    )
    catalog["cases"][0]["brief"]["en"] = (
        "Reference http://author.example/source and continue."
    )
    suite["case_results"][0]["audit"]["request"]["callback"] = (
        "https://request.example/hook"
    )
    suite["case_results"][0]["audit"]["response"]["documentation"] = (
        "HTTP://response.example/docs"
    )
    suite["case_results"][0]["audit"]["response"]["bare_url"] = "https://"

    html = render_report(catalog, suite)

    assert re.search(r"https?://", html, flags=re.IGNORECASE) is None
    assert html.count("[external URL redacted]") >= 4
    assert '<img src=x onerror="alert(1)">' not in html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in html
