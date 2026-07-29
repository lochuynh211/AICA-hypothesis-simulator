"""Production-path integration contract for every compiled semantic case."""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from scripts.semantic_catalog.generator import compile_artifacts, load_catalog
from scripts.semantic_catalog.runner import run_catalog


_REPO_ROOT = Path(__file__).resolve().parents[3]
_SOURCE_CATALOG = _REPO_ROOT / "scripts" / "semantic_combined_catalog.json"
_IN_SCOPE_CATEGORIES = {"rest_required", "monotony_prevention"}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def compiled_workspace(tmp_path: Path) -> Path:
    """Compile current source cases in isolation; never pollute source artifacts."""

    root = tmp_path / "repo"
    schema_dir = root / "combined_contracts" / "schema"
    schema_dir.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT
        / "combined_contracts"
        / "schema"
        / "combined_test_case.schema.json",
        schema_dir / "combined_test_case.schema.json",
    )
    scripts_dir = root / "scripts"
    scripts_dir.mkdir(parents=True)
    shutil.copy2(
        _SOURCE_CATALOG,
        scripts_dir / "semantic_combined_catalog.json",
    )

    seeds_dir = root / "proposal_contracts" / "seeds"
    seeds_dir.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT
        / "proposal_contracts"
        / "seeds"
        / "seed-night-highway-oshi.json",
        seeds_dir / "seed-night-highway-oshi.json",
    )
    presets_dir = root / "proposal_contracts" / "presets"
    presets_dir.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT
        / "proposal_contracts"
        / "presets"
        / "preset-oshi-superfan.json",
        presets_dir / "preset-oshi-superfan.json",
    )
    for directory in (
        "dataset",
        "dispositions",
        "matrix",
        "service_capabilities",
    ):
        (root / "proposal_contracts" / directory).symlink_to(
            _REPO_ROOT / "proposal_contracts" / directory,
            target_is_directory=True,
        )
    (root / "packages").symlink_to(
        _REPO_ROOT / "packages",
        target_is_directory=True,
    )
    (root / "routes").symlink_to(
        _REPO_ROOT / "routes",
        target_is_directory=True,
    )

    compile_artifacts(load_catalog(_SOURCE_CATALOG), root)
    return root


@pytest.fixture(autouse=True)
def isolate_runtime_dirs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def _records_for_step(proposal: Mapping[str, Any], step: str) -> list[Mapping[str, Any]]:
    evidence = proposal.get("evidence")
    assert isinstance(evidence, list), "attached proposal must expose evidence"
    return [
        record
        for value in evidence
        if isinstance(value, Mapping)
        and (record := value).get("step") == step
    ]


def _has_recorded_content_error(proposal: Mapping[str, Any]) -> bool:
    content_records = _records_for_step(proposal, "content")
    if any(record.get("error") is not None for record in content_records):
        return True

    events = proposal.get("events")
    if not isinstance(events, list):
        return False
    return any(
        isinstance(event, Mapping)
        and event.get("event_type") == "ALGORITHM_ERROR"
        and isinstance(event.get("payload"), Mapping)
        and event["payload"].get("step") == "content"
        for event in events
    )


def test_every_compiled_semantic_case_is_evaluable_through_production_quickview(
    compiled_workspace: Path,
) -> None:
    cases = [
        _load(path)
        for path in sorted(
            (
                compiled_workspace
                / "combined_contracts"
                / "test_cases"
            ).glob("case-tc-*.json")
        )
    ]
    suite = run_catalog(compiled_workspace)
    runs = {
        run["display_id"]: run
        for run in suite["case_results"]
    }

    assert list(runs) == sorted(case["display_id"] for case in cases)
    for case in cases:
        display_id = case["display_id"]
        run = runs[display_id]
        result = run["response"]

        assert run["audit"]["http_status"] == 200, display_id
        assert result.get("error") is None, (
            f"{display_id}: unexpected quickview error: {result.get('error')}"
        )
        fires = result.get("fires")
        assert isinstance(fires, list), f"{display_id}: fires is not evaluable"
        in_scope_fires = [
            fire
            for fire in fires
            if isinstance(fire, Mapping)
            and fire.get("category") in _IN_SCOPE_CATEGORIES
        ]

        expected_outcome = case["expectations"]["trigger"]["outcome"]
        if expected_outcome == "none":
            assert in_scope_fires == [], (
                f"{display_id}: expected no in-scope fire, got {in_scope_fires}"
            )
            continue

        matching_fires = [
            fire
            for fire in in_scope_fires
            if fire.get("category") == expected_outcome
        ]
        assert matching_fires, (
            f"{display_id}: expected an evaluable {expected_outcome} fire"
        )

        for fire in in_scope_fires:
            contributions = fire.get("feature_contributions")
            assert isinstance(contributions, Mapping), (
                f"{display_id}: in-scope fire has no contribution chains"
            )
            assert _IN_SCOPE_CATEGORIES <= set(contributions), (
                f"{display_id}: both category contribution chains are required"
            )
            for category in _IN_SCOPE_CATEGORIES:
                chain = contributions[category]
                assert isinstance(chain, Mapping), (
                    f"{display_id}: {category} contribution chain is malformed"
                )
                assert isinstance(chain.get("rows"), list), (
                    f"{display_id}: {category} contribution rows are missing"
                )

            proposal = fire.get("proposal")
            if not isinstance(proposal, Mapping):
                assert fire.get("proposal_error") is not None, (
                    f"{display_id}: fire has neither proposal nor proposal error"
                )
                continue

            service_records = _records_for_step(proposal, "service")
            assert len(service_records) == 1, (
                f"{display_id}: attached proposal must have one service record"
            )
            service = service_records[0]
            assert service.get("output") is not None or service.get("error") is not None, (
                f"{display_id}: service has neither result nor explicit error"
            )

            content_records = _records_for_step(proposal, "content")
            complete_plan = any(
                isinstance(record.get("output"), Mapping)
                and record["output"].get("decision_type") == "complete_plan"
                for record in content_records
            )
            assert complete_plan or _has_recorded_content_error(proposal), (
                f"{display_id}: content has neither complete plan nor recorded error"
            )
