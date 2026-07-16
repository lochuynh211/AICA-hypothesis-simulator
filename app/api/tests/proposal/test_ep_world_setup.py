"""TDD: P3 world-setup endpoints — T021/T022 — P3 Editable World (feature 014).

Covers, per ``specs/014-proposal-p3-editable-world/contracts/proposal-p3-api.md``:

  - ``GET /api/proposal/datasets`` — list + provenance + errors.
  - ``GET /api/proposal/datasets/{dataset_id}/catalog`` — read-only songs +
    provenance, offset/limit, 404 unknown id.
  - ``GET /api/proposal/seeds`` / ``GET /api/proposal/seeds/{seed_id}`` —
    404 unknown.
  - Driver-profile CRUD: list/get/create(201)/delete(204); 422 invalid
    profile; 409 deleting a built-in; 404 unknown.
  - ``POST /api/proposal/worlds/validate`` — valid world -> no issues;
    unknown catalog reference -> field-level issue; unknown dataset_id ->
    an issue (never a 500).
  - Worlds: clone & diff (T030) — ``POST /api/proposal/worlds/clone`` (201 +
    exact diff, 404 unknown base_seed_id, 422 invalid override
    path/value/reference) and ``GET``/``GET {id}``/``DELETE`` clones round-trip.

Isolation invariant: every dataset/profile fixture test monkeypatches the
relevant ``AICA_PROPOSAL_*_DIR`` env var so nothing here ever writes to the
real committed ``proposal_contracts/`` tree.
"""
from __future__ import annotations

import copy
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_SEED_ID = "seed-night-highway-oshi"
_EXPECTED_SEED_IDS = {
    "seed-night-highway-oshi",
    "seed-daytime-ordinary",
    "seed-characteristic-route-event",
    "seed-multiple-passengers-child",
    "seed-upcoming-oshi-live-event",
}
_EXPECTED_BUILTIN_PROFILE_IDS = {
    "profile-anime-fan",
    "profile-wellness-calm",
    "profile-jrock-fitness",
    "profile-neutral-default",
}


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


# ---------------------------------------------------------------------------
# GET /api/proposal/datasets
# ---------------------------------------------------------------------------


def test_get_datasets_lists_the_frozen_dataset():
    resp = client.get("/api/proposal/datasets")
    assert resp.status_code == 200
    body = resp.json()
    assert body["errors"] == []
    ids = {d["dataset_id"] for d in body["datasets"]}
    assert _DATASET_ID in ids
    entry = next(d for d in body["datasets"] if d["dataset_id"] == _DATASET_ID)
    assert entry["song_count"] == 300
    assert entry["tier"] == "demonstration"
    assert entry["synthetic_only"] is False
    assert "dataset_hash" in entry
    assert "dataset_version" in entry


# ---------------------------------------------------------------------------
# GET /api/proposal/datasets/{dataset_id}/catalog
# ---------------------------------------------------------------------------


def test_get_dataset_catalog_returns_provenance_and_songs():
    resp = client.get(f"/api/proposal/datasets/{_DATASET_ID}/catalog")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 300
    assert len(body["songs"]) == 300
    prov = body["provenance"]
    assert prov["dataset_id"] == _DATASET_ID
    assert prov["tier"] == "demonstration"
    assert "dataset_hash" in prov
    assert "provenance_note" in prov
    # every song is a full Song record (spotify_track present)
    assert "spotify_track" in body["songs"][0]


def test_get_dataset_catalog_supports_offset_and_limit():
    resp = client.get(f"/api/proposal/datasets/{_DATASET_ID}/catalog", params={"offset": 10, "limit": 5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 300
    assert len(body["songs"]) == 5

    full = client.get(f"/api/proposal/datasets/{_DATASET_ID}/catalog").json()
    assert body["songs"] == full["songs"][10:15]


def test_get_dataset_catalog_404_unknown_dataset_id():
    resp = client.get("/api/proposal/datasets/no-such-dataset/catalog")
    assert resp.status_code == 404


def test_no_catalog_edit_or_import_route_exists():
    # Only GET is wired for the catalog surface — no mutate verb exists.
    resp = client.post(f"/api/proposal/datasets/{_DATASET_ID}/catalog", json={})
    assert resp.status_code in (404, 405)
    resp = client.put(f"/api/proposal/datasets/{_DATASET_ID}/catalog", json={})
    assert resp.status_code in (404, 405)


# ---------------------------------------------------------------------------
# GET /api/proposal/seeds & GET /api/proposal/seeds/{seed_id}
# ---------------------------------------------------------------------------


def test_get_seeds_lists_the_5_representative_seeds():
    resp = client.get("/api/proposal/seeds")
    assert resp.status_code == 200
    body = resp.json()
    ids = {s["seed_id"] for s in body["seeds"]}
    assert ids == _EXPECTED_SEED_IDS
    for s in body["seeds"]:
        assert set(s["label"].keys()) == {"ja", "en"}
        assert set(s["description"].keys()) == {"ja", "en"}


def test_get_seed_returns_full_world():
    resp = client.get(f"/api/proposal/seeds/{_SEED_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["seed_id"] == _SEED_ID
    assert body["world"]["control_inputs"]["dataset_id"] == _DATASET_ID
    assert body["world"]["control_inputs"]["trigger_purpose"] == "rest_recommended"


def test_get_seed_404_unknown_seed_id():
    resp = client.get("/api/proposal/seeds/no-such-seed")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Driver-profile CRUD
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolate_profiles_dir(tmp_path, monkeypatch):
    """Route user-profile writes to an isolated tmp dir for every test in
    this module (built-ins keep loading from the real, committed
    ``proposal_contracts/profiles/`` directory)."""
    monkeypatch.setenv("AICA_PROPOSAL_PROFILES_DIR", str(tmp_path))
    yield


@pytest.fixture(autouse=True)
def isolate_worlds_dir(tmp_path, monkeypatch):
    """Route world-clone writes to an isolated tmp dir for every test in this
    module (seeds keep loading from the real, committed
    ``proposal_contracts/seeds/`` directory)."""
    clones_dir = tmp_path / "proposal_worlds"
    monkeypatch.setenv("AICA_PROPOSAL_WORLDS_DIR", str(clones_dir))
    yield clones_dir


def test_get_profiles_lists_builtins():
    resp = client.get("/api/proposal/profiles")
    assert resp.status_code == 200
    body = resp.json()
    ids = {p["profile_id"] for p in body["profiles"]}
    assert _EXPECTED_BUILTIN_PROFILE_IDS <= ids
    for p in body["profiles"]:
        if p["profile_id"] in _EXPECTED_BUILTIN_PROFILE_IDS:
            assert p["builtin"] is True


def test_get_profile_returns_full_record():
    resp = client.get("/api/proposal/profiles/profile-neutral-default")
    assert resp.status_code == 200
    body = resp.json()
    assert body["profile_id"] == "profile-neutral-default"
    assert body["builtin"] is True
    assert body["profile"]["oshi_registered"] is False


def test_get_profile_404_unknown():
    resp = client.get("/api/proposal/profiles/no-such-profile")
    assert resp.status_code == 404


def test_create_profile_201_and_then_gettable():
    body = {
        "label": {"ja": "テスト", "en": "Test profile"},
        "profile": {
            "oshi_registered": False,
            "oshi_mode": "off",
            "age_band": "20s",
            "gender": "unspecified",
        },
    }
    resp = client.post("/api/proposal/profiles", json=body)
    assert resp.status_code == 201
    created = resp.json()
    assert created["builtin"] is False
    assert created["label"] == {"ja": "テスト", "en": "Test profile"}
    profile_id = created["profile_id"]

    fetched = client.get(f"/api/proposal/profiles/{profile_id}")
    assert fetched.status_code == 200
    assert fetched.json()["profile"]["age_band"] == "20s"


def test_create_profile_422_invalid_profile_field_level():
    body = {
        "label": {"ja": "無効", "en": "Invalid"},
        "profile": {
            "oshi_registered": False,
            "oshi_mode": "off",
            "age_band": "not-a-real-age-band",  # invalid enum member
            "gender": "unspecified",
        },
    }
    resp = client.post("/api/proposal/profiles", json=body)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail  # non-empty, field-level


def test_delete_profile_204_for_a_user_profile():
    create_resp = client.post(
        "/api/proposal/profiles",
        json={
            "label": {"ja": "削除用", "en": "To delete"},
            "profile": {
                "oshi_registered": False,
                "oshi_mode": "off",
                "age_band": "40s",
                "gender": "unspecified",
            },
        },
    )
    profile_id = create_resp.json()["profile_id"]

    del_resp = client.delete(f"/api/proposal/profiles/{profile_id}")
    assert del_resp.status_code == 204

    assert client.get(f"/api/proposal/profiles/{profile_id}").status_code == 404


def test_delete_profile_409_for_a_builtin_profile():
    resp = client.delete("/api/proposal/profiles/profile-neutral-default")
    assert resp.status_code == 409


def test_delete_profile_404_for_unknown_profile():
    resp = client.delete("/api/proposal/profiles/no-such-profile")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/proposal/worlds/validate
# ---------------------------------------------------------------------------


def test_validate_world_valid_seed_yields_no_issues():
    world = _load_seed_world_dict()
    resp = client.post("/api/proposal/worlds/validate", json={"world": world})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["issues"] == []


def test_validate_world_unknown_catalog_reference_is_a_field_level_issue():
    world = copy.deepcopy(_load_seed_world_dict())
    world["driver_profile"]["oshi_id"] = "synthetic-artist-DOES-NOT-EXIST"
    resp = client.post("/api/proposal/worlds/validate", json={"world": world})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert any(
        issue["code"] == "unknown_catalog_reference" and issue["path"] == "driver_profile.oshi_id"
        for issue in body["issues"]
    )


def test_validate_world_unknown_dataset_id_yields_an_issue_not_a_500():
    world = copy.deepcopy(_load_seed_world_dict())
    world["control_inputs"]["dataset_id"] = "no-such-dataset"
    resp = client.post("/api/proposal/worlds/validate", json={"world": world})
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert any(issue["code"] == "unknown_dataset" for issue in body["issues"])


def test_validate_world_structurally_invalid_body_is_422_at_the_type_boundary():
    # Enum/range violations are already enforced by the World pydantic model
    # itself at body-parse time (world_validation.py's Rules 1-2 exist for
    # in-memory-mutated Worlds, not the HTTP boundary) -> FastAPI's own 422,
    # never a 500 and never a fabricated "valid: true".
    world = copy.deepcopy(_load_seed_world_dict())
    world["situation"]["drowsiness_level"] = 999  # out of [0, 100]
    resp = client.post("/api/proposal/worlds/validate", json={"world": world})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Worlds: clone & diff — T030
# ---------------------------------------------------------------------------


def test_clone_world_201_with_exact_diff():
    resp = client.post(
        "/api/proposal/worlds/clone",
        json={
            "base_seed_id": _SEED_ID,
            "overrides": [{"path": "situation.drowsiness_level", "value": 5}],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["base_seed_id"] == _SEED_ID
    assert body["clone_id"]
    assert body["world"]["situation"]["drowsiness_level"] == 5
    assert len(body["diff"]) == 1
    assert body["diff"][0] == {
        "path": "situation.drowsiness_level",
        "before": _load_seed_world_dict()["situation"]["drowsiness_level"],
        "after": 5,
    }


def test_clone_world_404_unknown_base_seed_id():
    resp = client.post(
        "/api/proposal/worlds/clone",
        json={"base_seed_id": "no-such-seed", "overrides": [{"path": "situation.drowsiness_level", "value": 5}]},
    )
    assert resp.status_code == 404


def test_clone_world_422_unknown_override_path():
    resp = client.post(
        "/api/proposal/worlds/clone",
        json={"base_seed_id": _SEED_ID, "overrides": [{"path": "situation.no_such_field", "value": 5}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]


def test_clone_world_422_invalid_override_value():
    resp = client.post(
        "/api/proposal/worlds/clone",
        json={"base_seed_id": _SEED_ID, "overrides": [{"path": "situation.drowsiness_level", "value": 999}]},
    )
    assert resp.status_code == 422


def test_clone_world_422_dangling_catalog_reference():
    resp = client.post(
        "/api/proposal/worlds/clone",
        json={
            "base_seed_id": _SEED_ID,
            "overrides": [{"path": "driver_profile.oshi_id", "value": "synthetic-artist-DOES-NOT-EXIST"}],
        },
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any(issue.get("code") == "unknown_catalog_reference" for issue in detail)


def test_clone_world_deterministic_diff_on_repeat():
    body = {"base_seed_id": _SEED_ID, "overrides": [{"path": "situation.fatigue_level", "value": 12}]}
    first = client.post("/api/proposal/worlds/clone", json=body).json()
    second = client.post("/api/proposal/worlds/clone", json=body).json()
    assert first["clone_id"] != second["clone_id"]
    assert first["world"] == second["world"]
    assert first["diff"] == second["diff"]


def test_list_get_delete_world_clone_round_trip():
    create_resp = client.post(
        "/api/proposal/worlds/clone",
        json={"base_seed_id": _SEED_ID, "overrides": [{"path": "situation.drowsiness_level", "value": 20}]},
    )
    clone_id = create_resp.json()["clone_id"]

    list_resp = client.get("/api/proposal/worlds/clones")
    assert list_resp.status_code == 200
    ids = {c["clone_id"] for c in list_resp.json()["clones"]}
    assert clone_id in ids

    get_resp = client.get(f"/api/proposal/worlds/clones/{clone_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["clone_id"] == clone_id

    del_resp = client.delete(f"/api/proposal/worlds/clones/{clone_id}")
    assert del_resp.status_code == 204

    assert client.get(f"/api/proposal/worlds/clones/{clone_id}").status_code == 404


def test_get_world_clone_404_unknown_clone_id():
    resp = client.get("/api/proposal/worlds/clones/no-such-clone")
    assert resp.status_code == 404


def test_delete_world_clone_404_unknown_clone_id():
    resp = client.delete("/api/proposal/worlds/clones/no-such-clone")
    assert resp.status_code == 404
