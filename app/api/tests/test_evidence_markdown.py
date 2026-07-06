"""TDD tests for S8 / T012 — Markdown evidence export (RED → GREEN).

Tests for:
  - services/evidence_markdown.py::render_evidence_markdown (pure function)
  - GET /api/runs/{run_id}/evidence.md (router endpoint)

Covers:
  - Output has ## Simulator Facts AND ## Human Review headings
  - Known fact (package/scenario id, driver_profile value, algorithm error) appears
    under ## Simulator Facts (before ## Human Review)
  - Feedback label/comment appears under ## Human Review and NOT under ## Simulator Facts
  - No verdict language in output
  - A run with no feedback still renders without crashing (and has ## Human Review section)
  - Route returns Markdown (text/markdown content-type); honors ui_language
  - 404 for unknown run
  - Works for active run + on-disk (past) run via same _resolve_run_log path
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.evidence import build_evidence_report
from aica_api.services.evidence_markdown import render_evidence_markdown
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

# ── Fixtures identical to test_evidence_export to keep isolation ───────────────

VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"  # feature 009: rest_rule_based_v0_1 retired
VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"  # feature 009: friend_drive retired


def _make_report(
    *,
    run_id: str = "run_md_test_001",
    package_id: str = "pkg_md",
    scenario_id: str = "sc_md",
    driver_profile: dict | None = None,
    vehicle_profile: dict | None = None,
    speed_profile: dict | None = None,
    profile_overrides: dict | None = None,
    algorithm_errors: list | None = None,
    feedback_labels: list | None = None,
    free_text_comments: list | None = None,
    ui_language: str = "bilingual",
) -> dict:
    """Build a minimal §14.2 report dict for testing render_evidence_markdown."""
    return {
        "report_id": "rpt-md-001",
        "run_id": run_id,
        "timestamp": "2026-06-28T10:00:00Z",
        "ui_language": ui_language,
        "simulator_version": "1.0.0",
        "package": {"id": package_id, "version": "0.1.0"},
        "scenario": {"id": scenario_id, "version": "0.2.0"},
        "simulator_facts": {
            "route_snapshot": None,
            "route_facts": {
                "total_route_distance_km": 120.0,
                "estimated_duration_seconds": 7200,
                "rest_spot_positions": [],
                "route_source": "local",
            },
            "event_plan": {"ticks": []},
            "run_mode": "standard",
            "evidence_status": "standard",
            "initial_parameters": {"driving_style": "normal"},
            "initial_hyperparameters": {"suggest_threshold": 2.5},
            "driver_profile": driver_profile,
            "vehicle_profile": vehicle_profile,
            "speed_profile": speed_profile,
            "profile_overrides": profile_overrides,
            "timeline_events": [],
            "decision_trace": [],
            "proposal_events": [],
            "actions": [],
            "algorithm_errors": algorithm_errors or [],
        },
        "human_review": {
            "feedback_labels": feedback_labels or [],
            "free_text_comments": free_text_comments or [],
        },
    }


# ── Unit tests: render_evidence_markdown (pure function) ──────────────────────


class TestMarkdownHeadings:
    """Output must contain exactly the required top-level headings."""

    def test_contains_simulator_facts_heading(self):
        report = _make_report()
        md = render_evidence_markdown(report)
        assert "## Simulator Facts" in md

    def test_contains_human_review_heading(self):
        report = _make_report()
        md = render_evidence_markdown(report)
        assert "## Human Review" in md

    def test_simulator_facts_before_human_review(self):
        report = _make_report()
        md = render_evidence_markdown(report)
        facts_pos = md.index("## Simulator Facts")
        review_pos = md.index("## Human Review")
        assert facts_pos < review_pos, "## Simulator Facts must appear before ## Human Review"

    def test_has_title_with_run_id(self):
        report = _make_report(run_id="run_abc_123")
        md = render_evidence_markdown(report)
        assert "run_abc_123" in md


class TestSimulatorFacts:
    """Known facts appear under ## Simulator Facts (before ## Human Review)."""

    def _facts_section(self, md: str) -> str:
        """Extract the text between ## Simulator Facts and ## Human Review."""
        start = md.index("## Simulator Facts")
        end = md.index("## Human Review")
        return md[start:end]

    def test_package_id_in_facts(self):
        report = _make_report(package_id="my_special_package")
        md = render_evidence_markdown(report)
        # Package id must appear in the metadata/Facts region (before ## Human Review)
        assert "my_special_package" in md[:md.index("## Human Review")]

    def test_scenario_id_in_facts_region(self):
        report = _make_report(scenario_id="uc01_fatigue_friend_drive_v0_1")
        md = render_evidence_markdown(report)
        # Scenario id appears in the top-level metadata, which is before Human Review
        review_pos = md.index("## Human Review")
        assert "uc01_fatigue_friend_drive_v0_1" in md[:review_pos]

    def test_driver_profile_value_in_facts(self):
        report = _make_report(driver_profile={"id": "driver_pro_1", "age_band": "30s"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "driver_pro_1" in facts
        assert "age_band" in facts or "30s" in facts

    def test_vehicle_profile_value_in_facts(self):
        report = _make_report(vehicle_profile={"id": "vehicle_eco_1", "type": "sedan"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "vehicle_eco_1" in facts

    def test_algorithm_error_in_facts(self):
        err = {"tick_index": 3, "error_type": "ValueError", "message": "Invalid evaluate() return"}
        report = _make_report(algorithm_errors=[err])
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "ValueError" in facts
        assert "Invalid evaluate() return" in facts

    def test_initial_parameter_in_facts(self):
        report = _make_report()
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "driving_style" in facts

    def test_ui_language_appears_in_output(self):
        report = _make_report(ui_language="ja")
        md = render_evidence_markdown(report)
        assert "ja" in md

    def test_null_profiles_renders_without_crashing(self):
        report = _make_report(driver_profile=None, vehicle_profile=None)
        md = render_evidence_markdown(report)
        assert "## Simulator Facts" in md
        assert "## Human Review" in md


class TestHumanReview:
    """Feedback appears ONLY under ## Human Review; never under ## Simulator Facts."""

    def _facts_section(self, md: str) -> str:
        start = md.index("## Simulator Facts")
        end = md.index("## Human Review")
        return md[start:end]

    def _review_section(self, md: str) -> str:
        start = md.index("## Human Review")
        return md[start:]

    def test_feedback_label_in_human_review(self):
        fb = [{"target": {"scope": "run"}, "labels": {"overall_judgment": "good_trigger"}}]
        report = _make_report(feedback_labels=fb)
        md = render_evidence_markdown(report)
        review = self._review_section(md)
        assert "good_trigger" in review

    def test_feedback_label_not_in_simulator_facts(self):
        fb = [{"target": {"scope": "run"}, "labels": {"overall_judgment": "good_trigger"}}]
        report = _make_report(feedback_labels=fb)
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "good_trigger" not in facts

    def test_feedback_comment_in_human_review(self):
        comments = [{"target": {"scope": "run"}, "comment": "Excellent trigger timing."}]
        report = _make_report(free_text_comments=comments)
        md = render_evidence_markdown(report)
        review = self._review_section(md)
        assert "Excellent trigger timing." in review

    def test_feedback_comment_not_in_simulator_facts(self):
        comments = [{"target": {"scope": "run"}, "comment": "Excellent trigger timing."}]
        report = _make_report(free_text_comments=comments)
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "Excellent trigger timing." not in facts

    def test_no_feedback_run_human_review_section_renders(self):
        report = _make_report(feedback_labels=[], free_text_comments=[])
        md = render_evidence_markdown(report)
        # Section must exist even when empty
        assert "## Human Review" in md
        # Must not crash — no assertion needed beyond this point

    def test_feedback_scope_in_review(self):
        fb = [{"target": {"scope": "decision", "tick_index": 5}, "labels": {"proposal_timing": "late"}}]
        report = _make_report(feedback_labels=fb)
        md = render_evidence_markdown(report)
        review = self._review_section(md)
        assert "late" in review


class TestNoVerdictLanguage:
    """The Markdown MUST NEVER claim the algorithm was correct or wrong."""

    VERDICT_WORDS = [
        "algorithm was correct",
        "algorithm was wrong",
        "algorithm was right",
        "incorrect trigger",
        "algorithm judged",
        "simulator judged",
        "the algorithm's judgment",
        "verdict:",
    ]

    def test_no_verdict_language_with_feedback(self):
        fb = [{"target": {"scope": "run"}, "labels": {"overall_judgment": "good_trigger"}}]
        report = _make_report(feedback_labels=fb)
        md = render_evidence_markdown(report).lower()
        for phrase in self.VERDICT_WORDS:
            assert phrase not in md, f"Verdict language found: {phrase!r}"

    def test_no_verdict_language_without_feedback(self):
        report = _make_report()
        md = render_evidence_markdown(report).lower()
        for phrase in self.VERDICT_WORDS:
            assert phrase not in md, f"Verdict language found: {phrase!r}"


class TestSpeedProfileAndOverridesMarkdown:
    """MINOR 1 + MINOR 3: speed_profile and profile_overrides render correctly in Markdown."""

    def _facts_section(self, md: str) -> str:
        """Extract the text between ## Simulator Facts and ## Human Review."""
        start = md.index("## Simulator Facts")
        end = md.index("## Human Review")
        return md[start:end]

    def test_speed_profile_value_in_facts_when_set(self):
        """A set speed_profile renders its values inside ## Simulator Facts."""
        report = _make_report(speed_profile={"id": "sp1", "highway_speed_band": "fast"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "sp1" in facts
        assert "highway_speed_band" in facts or "fast" in facts

    def test_speed_profile_not_recorded_line_when_absent(self):
        """When speed_profile is None, the facts section says 'not recorded', not 'N/A'."""
        report = _make_report(speed_profile=None)
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "not recorded" in facts
        # Old misleading wording must not appear
        assert "N/A (pre-M5 run or no override)" not in facts

    def test_profile_overrides_in_facts_when_set(self):
        """profile_overrides (sparse overrides) render inside ## Simulator Facts."""
        report = _make_report(
            speed_profile={"id": "sp1", "highway_speed_band": "fast"},
            profile_overrides={"highway_speed_band": "fast"},
        )
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "highway_speed_band" in facts

    def test_profile_overrides_no_override_line_when_absent(self):
        """When profile_overrides is None/empty, facts section says 'no override applied'."""
        report = _make_report(profile_overrides=None)
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "no override applied" in facts

    def test_speed_only_override_appears_in_facts_json_and_markdown(self):
        """Speed-only override: effective speed value visible in Simulator Facts."""
        report = _make_report(
            speed_profile={"id": "sp1", "highway_speed_band": "fast"},
            profile_overrides={"highway_speed_band": "fast"},
        )
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "fast" in facts

    def test_no_override_applied_not_present_when_overrides_exist(self):
        """When overrides ARE set, 'no override applied' should not appear in facts."""
        report = _make_report(profile_overrides={"highway_speed_band": "fast"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "no override applied" not in facts

    def test_driver_profile_not_na_when_present(self):
        """When driver_profile IS set, the old 'N/A (pre-M5 run or no override)' must not appear."""
        report = _make_report(driver_profile={"id": "d1", "age_band": "30s"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "N/A (pre-M5 run or no override)" not in facts
        assert "d1" in facts

    def test_vehicle_profile_not_na_when_present(self):
        """When vehicle_profile IS set, the old 'N/A (pre-M5 run or no override)' must not appear."""
        report = _make_report(vehicle_profile={"id": "v1", "type": "sedan"})
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "N/A (pre-M5 run or no override)" not in facts
        assert "v1" in facts

    def test_pre_m5_run_no_crash_all_profiles_absent(self):
        """Pre-M5 run: all profiles absent — renders without error."""
        report = _make_report(
            driver_profile=None,
            vehicle_profile=None,
            speed_profile=None,
            profile_overrides=None,
        )
        md = render_evidence_markdown(report)
        assert "## Simulator Facts" in md
        assert "## Human Review" in md

    def test_pre_m5_run_shows_not_recorded_not_na_wording(self):
        """Pre-M5 run: 'not recorded' appears; old 'N/A (pre-M5 run or no override)' does not."""
        report = _make_report(
            driver_profile=None,
            vehicle_profile=None,
            speed_profile=None,
            profile_overrides=None,
        )
        md = render_evidence_markdown(report)
        facts = self._facts_section(md)
        assert "not recorded" in facts
        assert "N/A (pre-M5 run or no override)" not in facts


class TestDerivedFromBuildEvidenceReport:
    """render_evidence_markdown must work with real build_evidence_report output."""

    def test_derived_from_real_report(self):
        """Smoke-test: build a real report and render it without error."""
        from aica_api.models.decision import Candidate, DecisionResult, FireControl, ResultType
        from aica_api.models.log import RunLog, TickEvent, TraceEntry
        from aica_api.models.run import ArtifactRef, EventPlan, RouteFacts, Snapshot, TickPlanEntry, TickState

        snapshot = Snapshot(
            package=ArtifactRef(id="pkg_smoke", version="0.1.0", hash="abc"),
            scenario=ArtifactRef(id="sc_smoke", version="0.1.0", hash="def"),
        )
        run_log = RunLog(
            run_id="run_md_smoke",
            created_at="2026-06-28T00:00:00Z",
            simulator_version="1.0.0",
            snapshot=snapshot,
            route_facts=RouteFacts(segments=[], bands={}),
            event_plan=EventPlan(ticks=[]),
            run_mode="standard",
            evidence_status="standard",
            events=[],
            driver_profile={"id": "drv1", "age_band": "40s"},
            vehicle_profile={"id": "veh1", "type": "suv"},
        )
        report = build_evidence_report(run_log, report_id="rpt-smoke", timestamp="2026-06-28T00:00:00Z")
        md = render_evidence_markdown(report)

        assert "## Simulator Facts" in md
        assert "## Human Review" in md
        assert "pkg_smoke" in md
        assert "drv1" in md
        # No feedback → empty Human Review section renders
        assert "## Human Review" in md


# ── Router-level tests: GET /api/runs/{run_id}/evidence.md ───────────────────


@pytest.fixture(autouse=True)
def reset_registries():
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


@pytest.fixture
def active_run_id(client) -> str:
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
        },
    )
    assert plan_resp.status_code == 201
    plan_id = plan_resp.json()["plan_id"]
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201
    return run_resp.json()["run_id"]


@pytest.fixture
def disk_run_id(tmp_path, monkeypatch) -> str:
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    run_id = "run_disk_md_test"
    run_log = {
        "run_id": run_id,
        "created_at": "2026-01-01T00:00:00Z",
        "simulator_version": "0.5.0",
        "snapshot": {
            "package": {"id": VALID_PACKAGE_ID, "version": "0.1.0", "hash": "abc"},
            "scenario": {"id": VALID_SCENARIO_ID, "version": "0.1.0", "hash": "def"},
        },
        "route_facts": {
            "total_route_distance_km": 100.0,
            "estimated_duration_seconds": 3600,
            "rest_spot_positions": [],
            "route_source": "local",
        },
        "event_plan": {"ticks": []},
        "run_mode": "standard",
        "evidence_status": "standard",
        "events": [
            {
                "kind": "feedback",
                "target": {"scope": "run"},
                "labels": {"overall_judgment": "good_trigger"},
                "comment": "Past run review comment.",
            }
        ],
    }
    (tmp_path / f"{run_id}.json").write_text(json.dumps(run_log), encoding="utf-8")
    return run_id


class TestEvidenceMarkdownRoute:
    def test_active_run_returns_200(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        assert resp.status_code == 200

    def test_returns_markdown_content_type(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        ct = resp.headers.get("content-type", "")
        assert "text/" in ct

    def test_content_has_simulator_facts_heading(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        assert "## Simulator Facts" in resp.text

    def test_content_has_human_review_heading(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        assert "## Human Review" in resp.text

    def test_run_id_in_content(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        assert active_run_id in resp.text

    def test_disk_run_returns_200(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence.md")
        assert resp.status_code == 200

    def test_disk_run_feedback_in_human_review_only(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence.md")
        md = resp.text
        # Locate sections
        facts_end = md.index("## Human Review")
        facts_section = md[:facts_end]
        review_section = md[facts_end:]
        # Feedback value must be in review section
        assert "good_trigger" in review_section
        # Must NOT appear in facts section
        assert "good_trigger" not in facts_section

    def test_disk_run_comment_in_human_review_only(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence.md")
        md = resp.text
        facts_end = md.index("## Human Review")
        facts_section = md[:facts_end]
        review_section = md[facts_end:]
        assert "Past run review comment." in review_section
        assert "Past run review comment." not in facts_section

    def test_unknown_run_returns_404(self, client):
        resp = client.get("/api/runs/nonexistent_run_xyz_md/evidence.md")
        assert resp.status_code == 404

    def test_ui_language_default_bilingual_in_content(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md")
        assert "bilingual" in resp.text

    def test_ui_language_ja_in_content(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md?ui_language=ja")
        assert "ja" in resp.text

    def test_ui_language_en_in_content(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence.md?ui_language=en")
        assert "en" in resp.text


class TestMarkdownInjectionDefense:
    """Free-text fields (comment, algorithm error message) must not be able to forge
    document structure.  An embedded ``## Simulator Facts`` or ``## Human Review``
    must never create a second real heading that blurs the Facts/Review boundary.

    These tests are written so they FAIL against the pre-fix code (where free-text
    is interpolated raw) and PASS after the blockquote-escaping fix.
    """

    @staticmethod
    def _count_heading_at_bol(md: str, heading: str) -> int:
        """Count lines in the raw Markdown source that are exactly the given heading."""
        return sum(1 for line in md.splitlines() if line == heading)

    # ── I1 / M4: feedback comment injection ───────────────────────────────────

    def test_comment_cannot_inject_simulator_facts_heading(self):
        """A comment containing '## Simulator Facts' must NOT create a second heading."""
        injected = "normal text\n\n## Simulator Facts\n\nfake_facts"
        comments = [{"target": {"scope": "run"}, "comment": injected}]
        report = _make_report(free_text_comments=comments)
        md = render_evidence_markdown(report)

        # Exactly one real ## Simulator Facts heading in the document
        count = self._count_heading_at_bol(md, "## Simulator Facts")
        assert count == 1, (
            f"Expected exactly 1 '## Simulator Facts' heading at BOL, found {count}. "
            "Comment may have injected a fake heading."
        )

        # The injected text appears only AFTER the real ## Human Review (in quoted form)
        review_pos = md.index("## Human Review")
        review_section = md[review_pos:]
        assert "fake_facts" in review_section, (
            "Injected content should still be present in the Human Review section"
        )

    def test_comment_cannot_inject_human_review_heading(self):
        """A comment containing '## Human Review' must NOT create a second heading."""
        injected = "normal text\n\n## Human Review\n\nfake_review"
        comments = [{"target": {"scope": "run"}, "comment": injected}]
        report = _make_report(free_text_comments=comments)
        md = render_evidence_markdown(report)

        count = self._count_heading_at_bol(md, "## Human Review")
        assert count == 1, (
            f"Expected exactly 1 '## Human Review' heading at BOL, found {count}. "
            "Comment may have injected a fake heading."
        )

    def test_comment_with_none_renders_without_crashing(self):
        """None or empty comment must not crash and must not inject structure."""
        comments = [{"target": {"scope": "run"}, "comment": None}]
        report = _make_report(free_text_comments=comments)
        md = render_evidence_markdown(report)
        assert "## Simulator Facts" in md
        assert "## Human Review" in md
        assert self._count_heading_at_bol(md, "## Human Review") == 1

    # ── M2 / M4: algorithm error message injection ─────────────────────────────

    def test_algorithm_error_cannot_inject_human_review_heading(self):
        """An error message containing '## Human Review' must NOT create a second heading."""
        injected_msg = "line 1\n\n## Human Review\n\nfake_review_content"
        err = {"tick_index": 1, "error_type": "RuntimeError", "message": injected_msg}
        report = _make_report(algorithm_errors=[err])
        md = render_evidence_markdown(report)

        count = self._count_heading_at_bol(md, "## Human Review")
        assert count == 1, (
            f"Expected exactly 1 '## Human Review' heading at BOL, found {count}. "
            "Algorithm error message may have injected a fake heading."
        )

    def test_algorithm_error_cannot_inject_simulator_facts_heading(self):
        """An error message containing '## Simulator Facts' must NOT forge a heading."""
        injected_msg = "err\n\n## Simulator Facts\n\nfake_facts"
        err = {"tick_index": 2, "error_type": "ValueError", "message": injected_msg}
        report = _make_report(algorithm_errors=[err])
        md = render_evidence_markdown(report)

        count = self._count_heading_at_bol(md, "## Simulator Facts")
        assert count == 1, (
            f"Expected exactly 1 '## Simulator Facts' heading at BOL, found {count}. "
            "Algorithm error message may have injected a fake heading."
        )

        # tick index and error type remain readable outside the quoted block
        facts_section = md[md.index("## Simulator Facts"):md.index("## Human Review")]
        assert "ValueError" in facts_section
        assert "fake_facts" in facts_section  # content still present, just quoted
