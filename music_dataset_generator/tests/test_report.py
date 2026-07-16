"""T059 — build report aggregation."""
from __future__ import annotations

from mdg.report import build_report


def _ledger():
    return [
        {"keys": {"isrc": "A", "normalized_name": "a|x"}, "outcome": "accepted",
         "miss_reason": None, "cell": "E-hi_T-hi_P-bv", "loop": 1},
        {"keys": {"normalized_name": "b|y"}, "outcome": "miss",
         "miss_reason": "audio_unavailable", "cell": None, "loop": 1},
        {"keys": {"isrc": "C", "normalized_name": "c|z"}, "outcome": "accepted",
         "miss_reason": None, "cell": "E-lo_T-lo_P-bv", "loop": 2},
    ]


def test_report_aggregates_counts_and_validates() -> None:
    report = build_report(
        candidate_source="isrc_resolved",
        ledger=_ledger(),
        required_cells={"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv", "E-md_T-md_P-dv"},
        soundcharts_calls=5,
        probe_result={"populated_audio": 9, "fetched": 15, "passed": True},
    )
    assert report["candidate_source"] == "isrc_resolved"
    assert report["loop"] == 2
    assert report["new_vs_skipped"]["accepted"] == 2
    assert report["new_vs_skipped"]["miss"] == 1
    assert report["soundcharts_calls"] == 5
    assert report["coverage_checklist"]["covered"] == 2
    assert report["coverage_checklist"]["passed"] is False  # E-md_T-md_P-dv unmet
    assert report["coverage_checklist"]["unmet"] == ["E-md_T-md_P-dv"]
    # miss reasons surfaced as errors.
    assert {"code": "audio_unavailable", "count": 1} in report["errors"]


def test_report_agreement_stats() -> None:
    test_cases = [
        {"test_case_id": "tc1", "agreement": "agree"},
        {"test_case_id": "tc2", "agreement": "disagree"},
    ]
    report = build_report(candidate_source="isrc_resolved", ledger=[], test_cases=test_cases)
    assert report["agreement_stats"]["agree"] == 1
    assert report["agreement_stats"]["disagree"] == 1
    assert report["agreement_stats"]["disagreements"] == ["tc2"]


def test_report_empty_ledger_loop_zero() -> None:
    report = build_report(candidate_source="isrc_resolved", ledger=[])
    assert report["loop"] == 0
    assert report["coverage_checklist"]["passed"] is True  # no required cells
