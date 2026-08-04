"""T030 — Registry validation hardening tests (US4).

Verifies that:
  - Invalid package manifests appear in GET /api/packages `errors`, are absent
    from `packages`, and GET /api/packages/{id} returns 404.
  - Invalid scenario files appear in GET /api/scenarios `errors`, are absent
    from `scenarios`, and GET /api/scenarios/{id} returns 404.
  - An incompatible package+scenario pairing → POST /api/runs 400, no run
    created.
  - PackageRegistry.is_compatible() returns False for mismatched types
    (service-level guard, independent of the HTTP layer).

All HTTP tests monkeypatch AICA_PACKAGES_DIR / AICA_SCENARIOS_DIR /
AICA_RUNS_DIR so the real packages/ and scenarios/ directories are
never touched.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_REPO_ROOT = Path(__file__).resolve().parents[3]
_REAL_PACKAGES_DIR = _REPO_ROOT / "packages"
_REAL_SCENARIOS_DIR = _REPO_ROOT / "scenarios"

# ── Fixture data ──────────────────────────────────────────────────────────────

_VALID_BASE_PACKAGE: dict = {
    "id": "valid_test_pkg",
    "version": "0.1.0",
    "label": {"en": "Valid Test", "ja": "テスト有効"},
    "compatible_scenario_types": ["uc01_fatigue"],
    # Feature 009: declarative_rule is retired — python_module is the only
    # supported algorithm type (this base dict is only ever used as a template
    # for the deliberately-INVALID packages below, never registered directly).
    "algorithm": {"type": "python_module", "entrypoint": "algorithm.py"},
    "parameters": [],
    "features": [],
    "hyperparameters": [],
    "trigger_categories": [{"id": "rest_required", "priority": 1}],
    "rules": [],
    "fire_control": {
        "threshold_source": "score",
        "actionability_guard": "score >= proposal_cut",
    },
    "proposals": [],
    "feedback_schema": [],
    "evidence_metrics": [],
}

# Bad algorithm type — Literal["declarative_rule"] rejects any other value.
INVALID_PKG_BAD_ALGO_TYPE: dict = {
    **_VALID_BASE_PACKAGE,
    "id": "pkg_bad_algo_type",
    "algorithm": {"type": "not_a_real_algorithm", "entrypoint": "rules"},
}

# Band parameter whose default is not in band_values → Pydantic model_validator
# raises ValueError.
INVALID_PKG_BAD_BAND_DEFAULT: dict = {
    **_VALID_BASE_PACKAGE,
    "id": "pkg_bad_band_default",
    "parameters": [
        {
            "key": "trigger_sensitivity",
            "label": {"en": "Sensitivity", "ja": "感度"},
            "kind": "band",
            "band_values": ["low", "medium", "high"],
            "default": "extreme",  # not in band_values
        }
    ],
}

# Valid scenario whose type is not in the real package's compatible_scenario_types.
_INCOMPAT_SCENARIO: dict = {
    "id": "uc99_incompat_v0_1",
    "version": "0.1.0",
    "type": "uc99_unknown_type",  # real package only supports uc01_fatigue
    "persona": {"name": "Test Driver", "description": ""},
    "route_intent": {
        "rest_facility": {"label": {"en": "Test Stop"}},
        "segments": [
            {
                "id": "seg_start",
                "name": {"en": "Start"},
                "type": "start",
                "at": 0.0,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": False,
            },
            {
                "id": "seg_rest",
                "name": {"en": "Rest"},
                "type": "rest",
                "at": 0.5,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": True,
            },
            {
                "id": "seg_end",
                "name": {"en": "End"},
                "type": "end",
                "at": 1.0,
                "speed_band": "low",
                "length_band": "short",
                "is_rest_facility": False,
            },
        ],
    },
    "initial_state": {},
    "event_presets": {
        "drowsiness_schedule": [{"at": 0.0, "band": "none"}],
        "signal_duration_at_trigger": "brief",
    },
    "total_duration_seconds": 3600,
    "tick_seconds": 60,
    "allowed_actions": ["accept_rest"],
    "review_focus": "",
}

# ── Helpers ───────────────────────────────────────────────────────────────────


def _write_package(packages_dir: Path, data: dict) -> Path:
    """Write a package.json into a named subdirectory of packages_dir."""
    pkg_dir = packages_dir / data["id"]
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "package.json").write_text(json.dumps(data), encoding="utf-8")
    return pkg_dir


def _write_scenario(scenarios_dir: Path, data: dict) -> Path:
    """Write a scenario JSON file into scenarios_dir."""
    sc_file = scenarios_dir / f"{data['id']}.json"
    sc_file.write_text(json.dumps(data), encoding="utf-8")
    return sc_file


@pytest.fixture(autouse=True)
def _reset_run_registry():
    """Isolate every test — clear both in-memory registries before and after."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ── T030a: Bad algorithm type ─────────────────────────────────────────────────


class TestInvalidPackageBadAlgoType:
    """Algorithm type not in Literal['declarative_rule'] — registry reports it."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        packages_dir = tmp_path / "packages"
        packages_dir.mkdir()
        _write_package(packages_dir, INVALID_PKG_BAD_ALGO_TYPE)
        monkeypatch.setenv("AICA_PACKAGES_DIR", str(packages_dir))
        return TestClient(app)

    def test_appears_in_errors(self, client):
        body = client.get("/api/packages").json()
        assert len(body["errors"]) >= 1

    def test_error_message_is_informative(self, client):
        errors = client.get("/api/packages").json()["errors"]
        messages = " ".join(e["message"] for e in errors)
        # Pydantic will mention the invalid literal or the field name
        assert (
            "not_a_real_algorithm" in messages
            or "declarative_rule" in messages
            or "algorithm" in messages
        )

    def test_absent_from_summaries(self, client):
        ids = [p["id"] for p in client.get("/api/packages").json()["packages"]]
        assert "pkg_bad_algo_type" not in ids

    def test_detail_is_404(self, client):
        assert client.get("/api/packages/pkg_bad_algo_type").status_code == 404


# ── T030b: Band default outside band_values ───────────────────────────────────


class TestInvalidPackageBadBandDefault:
    """Parameter default not in band_values — model_validator rejects it."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        packages_dir = tmp_path / "packages"
        packages_dir.mkdir()
        _write_package(packages_dir, INVALID_PKG_BAD_BAND_DEFAULT)
        monkeypatch.setenv("AICA_PACKAGES_DIR", str(packages_dir))
        return TestClient(app)

    def test_appears_in_errors(self, client):
        body = client.get("/api/packages").json()
        assert len(body["errors"]) >= 1

    def test_error_message_mentions_validation(self, client):
        errors = client.get("/api/packages").json()["errors"]
        messages = " ".join(e["message"] for e in errors)
        assert (
            "band_values" in messages
            or "extreme" in messages
            or "default" in messages
        )

    def test_absent_from_summaries(self, client):
        ids = [p["id"] for p in client.get("/api/packages").json()["packages"]]
        assert "pkg_bad_band_default" not in ids

    def test_detail_is_404(self, client):
        assert client.get("/api/packages/pkg_bad_band_default").status_code == 404


# ── T030c: Invalid scenario file ─────────────────────────────────────────────


class TestInvalidScenarioFile:
    """Scenario JSON missing required fields — registry reports it."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        scenarios_dir = tmp_path / "scenarios"
        scenarios_dir.mkdir()
        # Minimal JSON that has an id but is missing most required fields
        (scenarios_dir / "bad_scenario.json").write_text(
            '{"id": "bad_scenario", "version": "0.1.0"}', encoding="utf-8"
        )
        monkeypatch.setenv("AICA_SCENARIOS_DIR", str(scenarios_dir))
        return TestClient(app)

    def test_appears_in_errors(self, client):
        body = client.get("/api/scenarios").json()
        assert len(body["errors"]) >= 1

    def test_absent_from_summaries(self, client):
        ids = [s["id"] for s in client.get("/api/scenarios").json()["scenarios"]]
        assert "bad_scenario" not in ids

    def test_detail_is_404(self, client):
        assert client.get("/api/scenarios/bad_scenario").status_code == 404


# ── T030d: Mixed valid + invalid — valid survives contamination ───────────────


class TestMixedValidAndInvalidPackages:
    """A valid package alongside an invalid one: valid loads, invalid is reported."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        packages_dir = tmp_path / "packages"
        packages_dir.mkdir()
        shutil.copytree(
            _REAL_PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1",
            packages_dir / "aica_transparent_hybrid_trigger_v1",
        )
        _write_package(packages_dir, INVALID_PKG_BAD_ALGO_TYPE)
        monkeypatch.setenv("AICA_PACKAGES_DIR", str(packages_dir))
        return TestClient(app)

    def test_valid_package_in_summaries(self, client):
        ids = [p["id"] for p in client.get("/api/packages").json()["packages"]]
        assert "aica_transparent_hybrid_trigger_v1" in ids

    def test_invalid_package_not_in_summaries(self, client):
        ids = [p["id"] for p in client.get("/api/packages").json()["packages"]]
        assert "pkg_bad_algo_type" not in ids

    def test_error_reported_for_invalid(self, client):
        errors = client.get("/api/packages").json()["errors"]
        assert len(errors) >= 1


class TestMixedValidAndInvalidScenarios:
    """A valid scenario alongside an invalid one: valid loads, invalid is reported."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        scenarios_dir = tmp_path / "scenarios"
        scenarios_dir.mkdir()
        shutil.copy(
            _REAL_SCENARIOS_DIR / "uc01_fatigue_recovery_v0_1.json",
            scenarios_dir / "uc01_fatigue_recovery_v0_1.json",
        )
        (scenarios_dir / "bad.json").write_text(
            '{"id": "bad_sc"}', encoding="utf-8"
        )
        monkeypatch.setenv("AICA_SCENARIOS_DIR", str(scenarios_dir))
        return TestClient(app)

    def test_valid_scenario_in_summaries(self, client):
        ids = [s["id"] for s in client.get("/api/scenarios").json()["scenarios"]]
        assert "uc01_fatigue_recovery_v0_1" in ids

    def test_invalid_scenario_not_in_summaries(self, client):
        ids = [s["id"] for s in client.get("/api/scenarios").json()["scenarios"]]
        assert "bad_sc" not in ids

    def test_error_reported_for_invalid(self, client):
        errors = client.get("/api/scenarios").json()["errors"]
        assert len(errors) >= 1


# ── T030e: Incompatible pairing → 400 ────────────────────────────────────────


class TestIncompatiblePairing:
    """Valid package + valid scenario with incompatible type → POST /api/run-plans 400."""

    @pytest.fixture
    def setup(self, tmp_path, monkeypatch):
        scenarios_dir = tmp_path / "scenarios"
        scenarios_dir.mkdir()
        _write_scenario(scenarios_dir, _INCOMPAT_SCENARIO)
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir()
        monkeypatch.setenv("AICA_SCENARIOS_DIR", str(scenarios_dir))
        monkeypatch.setenv("AICA_RUNS_DIR", str(runs_dir))
        client = TestClient(app)
        return client, runs_dir

    def test_incompatible_pairing_returns_400(self, setup):
        client, _ = setup
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": "aica_transparent_hybrid_trigger_v1",
                "scenario_id": "uc99_incompat_v0_1",
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert resp.status_code == 400

    def test_incompatible_pairing_no_run_file_created(self, setup):
        client, runs_dir = setup
        client.post(
            "/api/run-plans",
            json={
                "package_id": "aica_transparent_hybrid_trigger_v1",
                "scenario_id": "uc99_incompat_v0_1",
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert list(runs_dir.glob("*.json")) == []

    def test_incompatible_pairing_error_detail(self, setup):
        client, _ = setup
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": "aica_transparent_hybrid_trigger_v1",
                "scenario_id": "uc99_incompat_v0_1",
                "parameters": {},
                "hyperparameters": {},
            },
        )
        detail = resp.json()["detail"]
        # The error should mention incompatibility or the scenario id
        assert "compatible" in detail or "uc99_incompat_v0_1" in detail


# ── T030f: Service-level is_compatible guard ──────────────────────────────────


def test_is_compatible_returns_false_for_mismatched_type():
    """PackageRegistry.is_compatible returns False for a mismatched scenario type."""
    from aica_api.models.scenario import ScenarioDef

    pkg_reg = PackageRegistry(_REAL_PACKAGES_DIR)
    pkg = pkg_reg.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None
    assert "uc01_fatigue" in pkg.compatible_scenario_types

    sc = ScenarioDef(**_INCOMPAT_SCENARIO)
    assert sc.type == "uc99_unknown_type"
    assert pkg_reg.is_compatible(pkg, sc) is False


def test_is_compatible_returns_true_for_matched_type():
    """PackageRegistry.is_compatible returns True for the real valid pair."""
    from aica_api.models.scenario import ScenarioDef

    pkg_reg = PackageRegistry(_REAL_PACKAGES_DIR)
    pkg = pkg_reg.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None

    scenario_data = json.loads(
        (_REAL_SCENARIOS_DIR / "uc01_fatigue_recovery_v0_1.json").read_text(encoding="utf-8")
    )
    sc = ScenarioDef(**scenario_data)
    assert pkg_reg.is_compatible(pkg, sc) is True


# ── T030g: FireControlRule.monotony_threshold_source (bug 2 fix) ──────────────


def test_nri_fatigue_score_v1_declares_monotony_threshold_source():
    """The real nri_fatigue_score_v1 manifest declares the monotony threshold key
    so the Combined screen's BASIC popup can look up threshold_monotony (default
    60.0) instead of falling back to 0.
    """
    pkg_reg = PackageRegistry(_REAL_PACKAGES_DIR)
    pkg = pkg_reg.get("nri_fatigue_score_v1")
    assert pkg is not None
    assert pkg.fire_control.monotony_threshold_source == "threshold_monotony"


def test_fire_control_rule_without_monotony_threshold_source_defaults_to_none():
    """Manifests that omit monotony_threshold_source (e.g. older fixtures) must
    still validate — the field is optional and defaults to None.
    """
    from aica_api.models.package import FireControlRule

    rule = FireControlRule(threshold_source="score", actionability_guard="score >= proposal_cut")
    assert rule.monotony_threshold_source is None
