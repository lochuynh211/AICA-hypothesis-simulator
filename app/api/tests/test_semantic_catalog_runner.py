from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from scripts.semantic_catalog.generator import compile_artifacts, load_catalog
from scripts.semantic_catalog.runner import (
    build_quickview_body,
    load_track_index,
    run_case,
    run_catalog,
)


_REPO_ROOT = Path(__file__).resolve().parents[3]
_SOURCE_CATALOG = _REPO_ROOT / "scripts" / "semantic_combined_catalog.json"
_EXPECTED_KEYS = {
    "package_id",
    "scenario_id",
    "route_preset_id",
    "run_seed",
    "mountain_range_km",
    "jam_range_km",
    "jam_speed_kph",
    "hyperparameter_overrides",
    "rest_option_id",
    "context_overrides",
    "initial_state",
    "profiles",
    "tick_seconds",
    "world",
    "service_package_id",
    "content_package_id",
    "run_seed_proposal",
    "service_parameters",
    "service_hyperparameters",
    "content_parameters",
    "content_hyperparameters",
}


@pytest.fixture
def compiled_workspace(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    schema_target = root / "combined_contracts" / "schema"
    schema_target.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT / "combined_contracts" / "schema" / "combined_test_case.schema.json",
        schema_target / "combined_test_case.schema.json",
    )
    source_target = root / "scripts"
    source_target.mkdir(parents=True)
    shutil.copy2(
        _SOURCE_CATALOG,
        source_target / "semantic_combined_catalog.json",
    )

    seed_target = root / "proposal_contracts" / "seeds"
    seed_target.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT / "proposal_contracts" / "seeds" / "seed-night-highway-oshi.json",
        seed_target / "seed-night-highway-oshi.json",
    )
    preset_target = root / "proposal_contracts" / "presets"
    preset_target.mkdir(parents=True)
    shutil.copy2(
        _REPO_ROOT / "proposal_contracts" / "presets" / "preset-oshi-superfan.json",
        preset_target / "preset-oshi-superfan.json",
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

    catalog = load_catalog(_SOURCE_CATALOG)
    compile_artifacts(catalog, root)
    return root


@pytest.fixture(autouse=True)
def isolate_runtime_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


class _Response:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> object:
        return self._payload


class _Client:
    def __init__(self, payload: object, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code
        self.requests: list[dict] = []

    def post(self, path: str, *, json: dict) -> _Response:
        assert path == "/api/merged-runs/quickview"
        self.requests.append(json)
        return _Response(self.status_code, self.payload)


def test_build_quickview_body_has_backend_parity_and_synchronized_pins(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )

    body = build_quickview_body(case, compiled_workspace)

    assert set(body) == _EXPECTED_KEYS
    assert body["package_id"] == "aica_transparent_hybrid_trigger_v1"
    assert body["scenario_id"] == "semantic_tc_r01"
    # The semantic catalog runs on the deterministic local route so the authored
    # journey length governs; a preset would override it.
    assert body["route_preset_id"] is None
    assert body["run_seed"] == 42
    assert body["run_seed_proposal"] == "42"
    assert body["tick_seconds"] == 180
    assert body["initial_state"] == {
        "drowsiness_level": 85,
        "fatigue_level": 70,
    }
    assert body["context_overrides"] == {
        "is_night": True,
        "child_passenger": False,
    }
    assert body["world"]["situation"]["night_state"] == "night"
    assert body["world"]["situation"]["child_present"] is False
    assert body["world"]["situation"]["route_tags"] == ["highway", "night"]
    assert body["world"]["situation"]["destination_tags"] == ["home"]
    assert body["world"]["situation"]["multiple_passengers"] is False
    assert body["world"]["driver_profile"] == _load(
        compiled_workspace
        / "proposal_contracts"
        / "profiles"
        / "profile-semantic-neutral.json"
    )["profile"]
    assert body["mountain_range_km"] is None
    assert body["jam_range_km"] is None
    assert body["jam_speed_kph"] == 20
    assert body["hyperparameter_overrides"] == {}
    assert body["rest_option_id"] is None
    assert body["profiles"] is None
    assert body["service_parameters"] == {}
    assert body["service_hyperparameters"] == {}
    assert body["content_parameters"] == {}
    assert body["content_hyperparameters"] == {}


def test_build_quickview_body_resolves_preset_profile_world(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )
    case["persona"]["profile_ref"] = "preset-oshi-superfan"

    body = build_quickview_body(case, compiled_workspace)

    assert body["world"]["driver_profile"] == _load(
        compiled_workspace
        / "proposal_contracts"
        / "presets"
        / "preset-oshi-superfan.json"
    )["world"]["driver_profile"]


def test_load_track_index_joins_frozen_identity_genres_and_audio() -> None:
    index = load_track_index(_REPO_ROOT)

    assert len(index) == 300
    assert index["synthetic-track-0058"] == {
        "track_id": "synthetic-track-0058",
        "title": "Hacking to the Gate",
        "artist_ids": ["synthetic-artist-0068"],
        "artist_names": ["いとうかなこ"],
        "realized_genres": ["anime"],
        "release_year": 2011,
        "audio_features": {
            "acousticness": 0.02,
            "danceability": 0.5,
            "duration_ms": 256000,
            "energy": 0.99,
            "instrumentalness": 0,
            "key": 0,
            "liveness": 0.35,
            "loudness": -2.5,
            "mode": 1,
            "speechiness": 0.12,
            "tempo": 160.96,
            "time_signature": 4,
            "valence": 0.49,
        },
    }


def test_run_case_executes_compiled_r01_through_real_quickview(
    compiled_workspace: Path,
    client: TestClient,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )

    run = run_case(client, case, compiled_workspace)

    assert run["audit"]["http_status"] == 200
    assert run["response"]["error"] is None
    assert run["provenance"]["package_ids"] == {
        "trigger": "aica_transparent_hybrid_trigger_v1",
        "service": "aica_transparent_service_selector_v1",
        "content": "aica_transparent_content_selector_v1",
    }
    assert set(run["provenance"]["package_manifest_sha256"]) == {
        "trigger",
        "service",
        "content",
    }
    assert all(
        digest.startswith("sha256:")
        for digest in run["provenance"]["package_manifest_sha256"].values()
    )

    fires = [
        fire
        for fire in run["response"]["fires"]
        if fire.get("category") in {"rest_required", "monotony_prevention"}
    ]
    assert fires
    fire = fires[0]
    assert fire.get("proposal") is not None or fire.get("proposal_error") is not None
    if fire.get("proposal") is not None:
        evidence = fire["proposal"]["evidence"]
        service = [record for record in evidence if record.get("step") == "service"]
        assert len(service) == 1
        assert service[0].get("output") is not None or service[0].get("error") is not None
        content = [record for record in evidence if record.get("step") == "content"]
        content_errors = [
            event
            for event in fire["proposal"]["events"]
            if event.get("event_type") == "ALGORITHM_ERROR"
            and event.get("payload", {}).get("step") == "content"
        ]
        assert content or content_errors


def test_run_case_records_canonical_request_and_artifact_provenance(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )
    client = _Client({"fires": [], "error": None})

    run = run_case(client, case, compiled_workspace)

    assert run["audit"]["canonical_request"] == client.requests[0]
    assert run["audit"]["canonical_request_sha256"] == _canonical_sha256(
        client.requests[0]
    )
    provenance = run["provenance"]
    assert provenance["catalog_version"] == "1.0.0"
    assert provenance["case_schema_version"] == "1.0.0"
    assert provenance["evaluator_version"] == "1.1.0"
    assert len(provenance["git_commit"]) == 40
    assert provenance["dataset_sha256"].startswith("sha256:")
    assert provenance["matrix_sha256"].startswith("sha256:")


def test_run_case_hashes_response_after_removing_only_declared_volatility(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )

    def payload(suffix: str) -> dict:
        return {
            "run_id": f"run-{suffix}",
            "created_at": f"created-{suffix}",
            "opportunity_id": f"opportunity-{suffix}",
            "at": "route-coordinate-that-must-remain",
            "fires": [
                {
                    "category": "rest_required",
                    "run_id": f"nested-run-{suffix}",
                    "proposal": {
                        "events": [
                            {
                                "event_type": "OPPORTUNITY_OPENED",
                                "at": f"event-time-{suffix}",
                                "payload": {
                                    "at": "payload-value-that-must-remain",
                                },
                            }
                        ],
                        "evidence": [],
                    },
                }
            ],
            "error": None,
        }

    left = run_case(_Client(payload("left")), case, compiled_workspace)
    right = run_case(_Client(payload("right")), case, compiled_workspace)

    # The full normalized payload is no longer stored (it duplicated ``response``
    # and drove the committed results file to 110 MB); the sha256 remains the
    # reproducibility oracle, so normalization is verified directly here.
    from scripts.semantic_catalog.runner import _normalize_response

    normalized = _normalize_response(left["response"])
    assert "run_id" not in normalized
    assert "created_at" not in normalized
    assert "opportunity_id" not in normalized
    assert normalized["at"] == "route-coordinate-that-must-remain"
    normalized_fire = normalized["fires"][0]
    assert "run_id" not in normalized_fire
    normalized_event = normalized_fire["proposal"]["events"][0]
    assert "at" not in normalized_event
    assert normalized_event["payload"]["at"] == "payload-value-that-must-remain"
    assert left["audit"]["normalized_response_sha256"] == _canonical_sha256(
        normalized
    )
    assert (
        left["audit"]["normalized_response_sha256"]
        == right["audit"]["normalized_response_sha256"]
    )


def test_run_case_joins_returned_and_excluded_tracks_to_frozen_catalog(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )
    payload = {
        "fires": [
            {
                "category": "rest_required",
                "proposal": {
                    "evidence": [
                        {
                            "step": "content",
                            "output": {
                                "decision_type": "complete_plan",
                                "ordered_items": [
                                    {"position": 1, "item_id": "synthetic-track-0058"}
                                ],
                                "excluded_items": [
                                    {
                                        "item_id": "synthetic-track-0001",
                                        "reason_codes": ["not_selected"],
                                    }
                                ],
                            },
                            "error": None,
                        }
                    ]
                },
            }
        ],
        "error": None,
    }

    run = run_case(_Client(payload), case, compiled_workspace)

    assert set(run["response"]["track_index"]) == {
        "synthetic-track-0001",
        "synthetic-track-0058",
    }
    returned = run["response"]["track_index"]["synthetic-track-0058"]
    assert returned["title"] == "Hacking to the Gate"
    assert returned["artist_ids"] == ["synthetic-artist-0068"]
    assert returned["artist_names"] == ["いとうかなこ"]
    assert returned["realized_genres"] == ["anime"]
    assert returned["release_year"] == 2011
    assert isinstance(returned["audio_features"]["tempo"], (int, float))


def test_run_case_marks_missing_returned_track_as_structural_execution_error(
    compiled_workspace: Path,
) -> None:
    case = _load(
        compiled_workspace
        / "combined_contracts"
        / "test_cases"
        / "case-tc-r01.json"
    )
    payload = {
        "fires": [
            {
                "category": "rest_required",
                "proposal": {
                    "evidence": [
                        {
                            "step": "content",
                            "output": {
                                "decision_type": "complete_plan",
                                "ordered_items": [
                                    {"position": 1, "item_id": "missing-track"}
                                ],
                                "excluded_items": [],
                            },
                            "error": None,
                        }
                    ]
                },
            }
        ],
        "error": None,
    }

    run = run_case(_Client(payload), case, compiled_workspace)

    assert run["response"]["error"] == {
        "category": "structural_execution_error",
        "code": "missing_catalog_track",
        "message": "Returned track IDs are absent from the frozen catalog.",
        "track_ids": ["missing-track"],
    }


def test_run_catalog_executes_cases_sequentially_in_display_id_order(
    compiled_workspace: Path,
) -> None:
    suite = run_catalog(compiled_workspace)

    assert suite["catalog_id"] == "semantic-combined-experience-catalog"
    assert suite["catalog_version"] == "1.0.0"
    assert suite["case_schema_version"] == "1.0.0"
    assert suite["evaluator_version"] == "1.1.0"
    assert len(suite["git_commit"]) == 40
    # The workspace compiles the committed catalog, so every authored case runs.
    # What this test guarantees is the ORDER contract: stable, sorted by display ID.
    display_ids = [result["display_id"] for result in suite["case_results"]]
    assert display_ids == sorted(display_ids)
    assert {"TC-R01", "TC-R02"} <= set(display_ids)
    assert all(
        result["audit"]["http_status"] == 200
        for result in suite["case_results"]
    )


def test_run_catalog_filters_by_compiled_case_id(
    compiled_workspace: Path,
) -> None:
    suite = run_catalog(compiled_workspace, {"case-tc-r02"})

    assert [
        result["display_id"] for result in suite["case_results"]
    ] == ["TC-R02"]
