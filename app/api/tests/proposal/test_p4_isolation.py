"""P4 POLISH cross-cutting guard (T034) — isolation from the trigger
simulator (spec.md FR-021; Constitution HARD ISOLATION RULE).

Extends the P1/P3 isolation guards (``test_p1_isolation_imports.py``,
``test_us3_isolation.py``) to the P4 modules specifically:

  1. Static AST scan: none of the P4 models/services modules import
     ``aica_api.models`` (the trigger package) OR ``aica_api.algorithms``
     (the trigger algorithm adapter) — the P1 guard only checked the former;
     P4 introduces the ``aica_api.algorithms`` prohibition into every P4
     module's own docstring, so this test pins it as an executable
     assertion, mirroring ``test_p1_isolation_imports.py``'s approach.
  2. The shared proposal router (``routers/proposal.py``, which carries the
     P4 eligibility/journey/preview endpoints) never references
     ``settings.runs_dir`` (the trigger run-log directory) as an attribute
     access anywhere in its source — only ``proposal_runs_dir``/
     ``packages_dir``/``proposal_contracts_dir``.
  3. Behavioral (mirrors ``test_us3_isolation.py``): driving the P4
     endpoints end-to-end (create with eligibility narrowing, journey
     actions, journey preview) never touches a pre-seeded trigger ``runs/``
     directory (byte-for-byte unchanged) nor populates the trigger's
     in-memory run registry.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import aica_api.models.proposal as proposal_pkg
import aica_api.routers.proposal as proposal_router_module
import aica_api.services as services_pkg
import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services import run_manager

client = TestClient(app)

PROPOSAL_MODELS_DIR = Path(proposal_pkg.__file__).resolve().parent
SERVICES_DIR = Path(services_pkg.__file__).resolve().parent
ROUTER_FILE = Path(proposal_router_module.__file__).resolve()

# The P4 modules named in the brief (data-model.md / plan.md; T033/T034).
P4_MODEL_FILES = [
    PROPOSAL_MODELS_DIR / "service_capabilities.py",
    PROPOSAL_MODELS_DIR / "eligibility.py",
    PROPOSAL_MODELS_DIR / "journey_action.py",
    PROPOSAL_MODELS_DIR / "journey_preview.py",
]
P4_SERVICE_FILES = [
    SERVICES_DIR / "proposal_eligibility.py",
    SERVICES_DIR / "proposal_journey.py",
    SERVICES_DIR / "proposal_journey_preview.py",
]


def _forbidden_imports(source: str, filename: str) -> list[str]:
    """Return forbidden import module-path strings found in *source*:
    any ``aica_api.models`` (except the ``aica_api.models.proposal``
    subpackage itself) or any ``aica_api.algorithms`` import."""
    tree = ast.parse(source, filename=filename)
    violations: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _is_forbidden(alias.name):
                    violations.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if _is_forbidden(module):
                violations.append(module)

    return violations


def _is_forbidden(module_path: str) -> bool:
    if module_path == "aica_api.algorithms" or module_path.startswith("aica_api.algorithms."):
        return True
    if not module_path.startswith("aica_api.models"):
        return False
    if module_path == "aica_api.models.proposal" or module_path.startswith(
        "aica_api.models.proposal."
    ):
        return False
    return True


class TestP4ModulesDiscovered:
    def test_p4_model_files_exist(self):
        for path in P4_MODEL_FILES:
            assert path.exists(), f"expected P4 model module missing: {path}"

    def test_p4_service_files_exist(self):
        for path in P4_SERVICE_FILES:
            assert path.exists(), f"expected P4 service module missing: {path}"


class TestP4ModulesIsolatedFromTrigger:
    def test_no_p4_module_imports_trigger_models_or_algorithms(self):
        offenders: dict[str, list[str]] = {}
        for path in [*P4_MODEL_FILES, *P4_SERVICE_FILES]:
            source = path.read_text(encoding="utf-8")
            violations = _forbidden_imports(source, str(path))
            if violations:
                offenders[path.name] = violations

        assert not offenders, (
            "Isolation violation: the following P4 modules import the trigger "
            f"package (aica_api.models) or the trigger algorithm adapter "
            f"(aica_api.algorithms): {offenders}"
        )


class TestRouterNeverReferencesTriggerRunsDir:
    def test_router_source_has_no_settings_runs_dir_attribute_access(self):
        """AST-level check (not a plain substring match) so a docstring
        MENTIONING ``settings.runs_dir`` (as this file's own module
        docstring does, to document the invariant) does not itself trip
        the guard — only an actual ``settings.runs_dir`` attribute access
        in code would."""
        source = ROUTER_FILE.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(ROUTER_FILE))

        offending_nodes = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr == "runs_dir"
        ]
        assert offending_nodes == [], (
            "routers/proposal.py must never reference settings.runs_dir "
            "(the trigger run-log directory) — only proposal_runs_dir/"
            "packages_dir/proposal_contracts_dir."
        )

    def test_router_only_uses_proposal_scoped_dir_attributes(self):
        """Every ``settings.*_dir`` attribute the router touches must be
        either the shared ``packages_dir`` (used by both trigger and
        proposal package registries — legitimate, not trigger-run-scoped)
        or a ``proposal_*_dir`` (proposal_runs_dir/proposal_contracts_dir,
        plus the P3 proposal_worlds_dir/proposal_dataset_dir/
        proposal_profiles_dir/proposal_seeds_dir stores this same shared
        router also owns) — never the bare trigger ``runs_dir``."""
        source = ROUTER_FILE.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(ROUTER_FILE))

        dir_attrs_used = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr.endswith("_dir")
        }
        non_proposal_scoped = {
            attr for attr in dir_attrs_used if attr != "packages_dir" and not attr.startswith("proposal_")
        }
        assert non_proposal_scoped == set(), (
            "routers/proposal.py references a *_dir setting outside the "
            f"proposal-scoped allowlist: {non_proposal_scoped}"
        )
        # Sanity: the file actually uses at least the run-persistence one, so
        # this isn't vacuously true because nothing matched *_dir at all.
        assert "proposal_runs_dir" in dir_attrs_used


# ---------------------------------------------------------------------------
# Behavioral: driving the P4 endpoints never touches the trigger runs/ dir
# or its in-memory registry (mirrors test_us3_isolation.py).
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    proposal_runs_dir = tmp_path / "proposal_runs"
    trigger_runs_dir = tmp_path / "runs"
    proposal_runs_dir.mkdir()
    trigger_runs_dir.mkdir()
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(proposal_runs_dir))
    monkeypatch.setenv("AICA_RUNS_DIR", str(trigger_runs_dir))
    run_manager.clear_registry()
    yield proposal_runs_dir, trigger_runs_dir
    run_manager.clear_registry()


def _seed_pre_existing_trigger_evidence(trigger_runs_dir):
    fixture_path = trigger_runs_dir / "run_pretend_trigger_p4.json"
    payload = {"run_id": "run_pretend_trigger_p4", "status": "created", "sentinel": True}
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")
    return fixture_path, fixture_path.read_bytes()


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "driving",
        "world_snapshot": {
            "feature_snapshot": {"oshi_registered": False},
            "feature_provenance": {},
        },
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def _action(run_id: str, action_type: str, payload: dict | None = None):
    return client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": action_type, "payload": payload or {}},
    )


class TestP4EndpointsNeverTouchTriggerRunsDir:
    def test_eligibility_narrowed_create_leaves_trigger_dir_untouched(self, isolate_dirs):
        _proposal_runs_dir, trigger_runs_dir = isolate_dirs
        fixture_path, before_bytes = _seed_pre_existing_trigger_evidence(trigger_runs_dir)

        resp = client.post("/api/proposal/runs", json=_create_run_body())
        assert resp.status_code == 201

        assert fixture_path.read_bytes() == before_bytes
        assert [p.name for p in trigger_runs_dir.iterdir()] == [fixture_path.name]

    def test_full_journey_action_sequence_and_preview_leave_trigger_dir_untouched(self, isolate_dirs):
        _proposal_runs_dir, trigger_runs_dir = isolate_dirs
        fixture_path, before_bytes = _seed_pre_existing_trigger_evidence(trigger_runs_dir)
        before_listing = sorted(p.name for p in trigger_runs_dir.iterdir())

        created = client.post(
            "/api/proposal/runs",
            json=_create_run_body(
                motion_state="stopped",
                world_snapshot={
                    "feature_snapshot": {"oshi_registered": True},
                    "feature_provenance": {},
                },
            ),
        ).json()
        run_id = created["run_id"]
        client.post(
            f"/api/proposal/runs/{run_id}/select-service",
            json={"selected_service_id": "full_karaoke"},
        )
        _action(run_id, "accept")
        _action(run_id, "complete")
        _action(run_id, "continue")
        _action(run_id, "stop")
        client.get(f"/api/proposal/runs/{run_id}/journey/preview")
        client.get(f"/api/proposal/runs/{run_id}")
        client.delete(f"/api/proposal/runs/{run_id}")

        after_listing = sorted(p.name for p in trigger_runs_dir.iterdir())
        assert after_listing == before_listing
        assert fixture_path.read_bytes() == before_bytes

    def test_p4_endpoints_never_populate_trigger_in_memory_registry(self):
        assert run_manager._registry == {}

        created = client.post("/api/proposal/runs", json=_create_run_body()).json()
        run_id = created["run_id"]
        client.get(f"/api/proposal/runs/{run_id}/journey/preview")
        client.get(f"/api/proposal/runs/{run_id}")

        assert run_manager._registry == {}
