"""Contract tests for the customer HTML report (renderer 2.x).

The renderer leads with the run AICA actually performed, then the ranked services
and the planned content with their reasons, and pushes setup/parameters/audit into
collapsed panels. These tests pin those properties -- not incidental markup.
"""

from __future__ import annotations

import collections
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS = _REPO_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from semantic_catalog.report import REPORT_VERSION, render_report  # noqa: E402


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #
def _text(en: str, ja: str = "日本語テキスト") -> dict[str, str]:
    return {"en": en, "ja": ja}


def _case(display_id: str, group: str = "rest", contrast: dict | None = None) -> dict:
    case = {
        "case_id": f"case-{display_id.lower()}",
        "display_id": display_id,
        "group": group,
        "title": _text(f"{display_id} purpose-led title"),
        "purpose": _text("purpose"),
        "real_world": {
            "before_trip": _text("Before the trip."),
            "trip_reason": _text("Why they drive."),
            "state_at_departure": _text("State at departure."),
            "journey_evolution": _text("How it evolves."),
        },
        "hypothesis": {"rationale": _text("Rationale.")},
        "expectations": {
            "trigger": {"outcome": "rest_required", "max_fire_count": 1},
            "service": {"rank_1_acceptable_ids": ["music_playlist"]},
            "content": {"expected_stage_outcome": "complete_plan"},
        },
        "persona": {
            "persona_id": f"persona-{display_id.lower()}",
            "profile_ref": "profile-semantic-neutral",
            "profile_ref_version": "1.0.0",
        },
        "journey": {
            "scenario_ref": "semantic_tc_r01",
            "route_preset_ref": None,
            "seed": 42,
            "tick_seconds": 180,
            "scenario": {"initial_drowsiness": 78, "route_distance_km": 200},
        },
    }
    if contrast:
        case["contrast"] = contrast
    return case


def _evaluation(display_id: str, verdict: str = "MATCH", fires: int = 1) -> dict:
    return {
        "case_id": f"case-{display_id.lower()}",
        "display_id": display_id,
        "group": "rest",
        "verdict": verdict,
        "checks": [
            {
                "check_id": "trigger.outcome",
                "stage": "trigger",
                "expected": "rest_required",
                "actual": "rest_required",
                "status": "MATCH",
                "explanation": "The first rest fire occurred at 141 min.",
                "evidence_path": "$.fires",
            }
        ],
        "actual": {
            "fire_count": fires,
            "fires": [
                {"category": "rest_required", "tick": 47, "time_min": 141.0}
                for _ in range(fires)
            ],
            "trigger_evidence": {
                "peak_score": 0.7131,
                "threshold": 0.7,
                "margin_to_threshold": 0.0131,
                "monotony_threshold": 0.7,
                "ticks_evaluated": 48,
                "journey_end_min": 144.0,
                "tick_minutes": 3.0,
                "rest_spot_count": 0,
                "rest_score_series": [0.1, 0.35, 0.6, 0.71],
                "monotony_score_series": [0.05, 0.1, 0.2, 0.3],
                "segments": [
                    {"type": "normal_road", "from_min": 0.0, "to_min": 12.0},
                    {"type": "highway", "from_min": 12.0, "to_min": 144.0},
                ],
            },
            "service": {
                "rank_1_id": "music_playlist",
                "ranked_candidates": [
                    {
                        "rank": 1,
                        "candidate_id": "music_playlist",
                        "score": 0.0438,
                        "situation_fit": 0.11,
                        "preference_fit": 0.01,
                        "history_fit": 0.02,
                        "rationale": [
                            "回復率が支持 / recovery rate supports this pick (+0.0174)"
                        ],
                        "strongest_support": {
                            "feature_id": "service_recovery_rate",
                            "contribution": 0.0174,
                        },
                        "strongest_oppose": {
                            "feature_id": "oshi_mode",
                            "contribution": -0.006,
                        },
                    }
                ],
            },
            "content": {
                "stage_outcome": "complete_plan",
                "returned_count": 1,
                "ordered_items": [
                    {
                        "position": 1,
                        "item_id": "synthetic-track-0266",
                        "item_fit": 0.1257,
                        "trait_values": {"arousal": 0.797, "valence": 0.98},
                        "rationale": [
                            "単調性が寄与 / monotony supports this pick (+0.065)"
                        ],
                        "strongest_support": {
                            "feature_id": "monotony_level",
                            "contribution": 0.065,
                        },
                    }
                ],
                "excluded_track_ids": [],
            },
            "track_index": {
                "synthetic-track-0266": {
                    "track_id": "synthetic-track-0266",
                    "title": "Bright Morning Drive",
                    "artist_names": ["Synthetic Artist 12"],
                    "realized_genres": ["j-rock", "anime"],
                }
            },
        },
    }


@pytest.fixture
def catalog() -> dict:
    shared = {
        "kind": "semantic_real_world",
        "changed_inputs": ["journey.scenario.initial_drowsiness"],
    }
    return {
        "catalog_id": "semantic-combined-experience-catalog",
        "catalog_version": "1.0.0",
        "cases": [
            _case(
                "TC-R01",
                contrast={
                    "role": "baseline",
                    "with_case_id": "TC-R02",
                    "expected_delta": _text("R01 should fire while R02 stays quiet."),
                    **shared,
                },
            ),
            _case(
                "TC-R02",
                contrast={
                    "role": "variant",
                    "with_case_id": "TC-R01",
                    "expected_delta": _text("R02 stays quiet."),
                    **shared,
                },
            ),
        ],
    }


@pytest.fixture
def suite() -> dict:
    left = _evaluation("TC-R01", "MATCH")
    right = _evaluation("TC-R02", "MISMATCH", fires=0)
    right["actual"]["fires"] = []
    left["contrast_delta"] = {
        "with_case_id": "TC-R02",
        "service_score_deltas": {"music_playlist": 0.105292, "humming_karaoke": 0.0},
        "service_scores": {"this_case": {}, "other_case": {}},
        "fire_count_delta": 1,
    }
    return {
        "evaluator_version": "1.1.0",
        "catalog_version": "1.0.0",
        "case_results": [left, right],
        "summary": {"total_cases": 2, "verdict_counts": {"MATCH": 1, "MISMATCH": 1}},
        "findings": [_text("Rest proposals arrive late on long journeys.")],
    }


# --------------------------------------------------------------------------- #
# structure
# --------------------------------------------------------------------------- #
class _Structure(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: collections.Counter = collections.Counter()
        self.details_open = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids[attributes["id"]] += 1
        if tag == "details" and "open" in attributes:
            self.details_open += 1


def test_report_is_valid_html_with_unique_ids(catalog, suite):
    html = render_report(catalog, suite)
    parser = _Structure()
    parser.feed(html)
    assert html.lower().startswith("<!doctype html>")
    assert not [key for key, count in parser.ids.items() if count > 1]
    assert 'id="case-TC-R01"' in html and 'id="case-TC-R02"' in html


def test_report_is_self_contained_with_no_external_request(catalog, suite):
    html = render_report(catalog, suite)
    assert "http://" not in html and "https://" not in html
    assert "<script src" not in html
    assert "<link" not in html
    assert "<style" in html and "<script" in html


def test_every_case_renders_the_actual_run_as_a_chart(catalog, suite):
    html = render_report(catalog, suite)
    assert html.count('class="runchart"') == 2
    points = re.findall(r'<polyline points="([^"]+)"', html)
    assert points and all(point.strip() for point in points)
    assert "firing threshold" in html


def test_service_and_content_are_listed_with_their_reasons(catalog, suite):
    html = render_report(catalog, suite)
    assert "Services AICA ranked" in html and "Content AICA planned" in html
    assert "music_playlist" in html
    assert "recovery rate supports this pick" in html
    # content is named from the frozen catalog, not shown as a bare ID
    assert "Bright Morning Drive" in html
    assert "Synthetic Artist 12" in html
    assert "j-rock" in html
    # only the English half of a bilingual rationale reaches the visible cell
    # (the raw bilingual string still appears inside the collapsed audit dump)
    assert '<td class="why">recovery rate supports this pick (+0.0174)' in html


def test_setup_and_audit_are_collapsed_so_they_do_not_distract(catalog, suite):
    html = render_report(catalog, suite)
    parser = _Structure()
    parser.feed(html)
    assert parser.details_open == 0, "no panel may be expanded by default"
    assert html.count('class="setup"') == 2
    assert html.count('class="audit"') == 2
    assert "Setup, parameters and authored expectations" in html


def test_filters_expose_the_documented_axes(catalog, suite):
    html = render_report(catalog, suite)
    for axis in ("group", "verdict", "expected trigger", "contrast role"):
        assert f'aria-label="Filter by {axis}"' in html
    assert 'data-verdict="MATCH"' in html and 'data-verdict="MISMATCH"' in html


def test_customer_wording_and_contrast_delta_are_shown(catalog, suite):
    html = render_report(catalog, suite)
    assert "Appropriate for this hypothesis" in html
    assert "Not appropriate for this hypothesis" in html
    assert "Contrast with TC-R02" in html
    assert "0.10529" in html, "the service score movement must be visible"


def test_report_makes_no_safety_or_medical_claim(catalog, suite):
    lowered = render_report(catalog, suite).lower()
    for word in ("clinically", "medically proven", "guaranteed safe"):
        assert word not in lowered
    assert "not a safety certification" in lowered


def test_render_report_escapes_authored_text_and_is_pure(catalog, suite):
    catalog["cases"][0]["title"]["en"] = '<script>alert("x")</script> & more'
    before = repr(suite)
    html = render_report(catalog, suite)
    assert "<script>alert" not in html
    assert "&lt;script&gt;alert" in html
    assert repr(suite) == before, "the renderer must not mutate its inputs"


def test_report_declares_its_version(catalog, suite):
    assert REPORT_VERSION in render_report(catalog, suite)


def test_missing_evaluation_does_not_break_rendering(catalog):
    html = render_report(catalog, {"case_results": [], "summary": {}})
    assert html.count('class="case"') == 2
    assert "No per-tick trajectory was recorded" in html
