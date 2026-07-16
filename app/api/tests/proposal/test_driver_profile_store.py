"""Tests for the driver-profile store (T015) — P3 Editable World (feature 014).

Covers (data-model.md §DriverProfileRecord, research.md §R4):
  - built-in profiles list (>=3, distinct preferences);
  - save a user profile -> appears in list & reloads identically (round-trip);
  - delete a user profile;
  - deleting a built-in -> conflict (``DriverProfileConflictError``);
  - invalid profile on save -> field-level error (``pydantic.ValidationError``);
  - built-in profiles are all valid ``DriverProfile``s and their catalog refs
    (``oshi_id``) resolve against the frozen dataset catalog.

User profiles are exercised against a pytest ``tmp_path`` (never the repo's
``proposal_profiles/``) — mirrors how ``test_seed_store.py``/
``proposal_run_manager`` tests isolate on-disk state.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.proposal.world import DriverProfile, DriverProfileRecord
from aica_api.services.driver_profile_store import (
    DriverProfileConflictError,
    DriverProfileNotFoundError,
    DriverProfileStore,
)

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_DATASET_DIR = settings.proposal_dataset_dir / _DATASET_ID


@pytest.fixture()
def store(tmp_path) -> DriverProfileStore:
    """A store with the real committed built-ins but a tmp user-profiles dir."""
    return DriverProfileStore(profiles_dir=tmp_path)


@pytest.fixture(scope="module")
def catalog_artist_ids() -> set[str]:
    catalog = json.loads((_DATASET_DIR / "catalog.json").read_text(encoding="utf-8"))
    ids: set[str] = set()
    for song in catalog:
        for artist in song["spotify_track"]["album"]["artists"]:
            ids.add(artist["id"])
    return ids


# ---------------------------------------------------------------------------
# Built-in profiles
# ---------------------------------------------------------------------------


def test_built_in_profiles_list_at_least_three(store: DriverProfileStore):
    summaries = store.list_profiles()
    builtins = [s for s in summaries if s["builtin"]]
    assert len(builtins) >= 3


def test_built_in_profiles_are_distinct(store: DriverProfileStore):
    builtin_ids = [s["profile_id"] for s in store.list_profiles() if s["builtin"]]
    records = [store.get_profile(pid) for pid in builtin_ids]

    # Distinct oshi_id / hobby_interest_tags / usage_by_genre across built-ins —
    # this is the whole point (different profile -> different content proposal).
    oshi_ids = {r.profile.oshi_id for r in records}
    hobby_tags = {tuple(sorted(r.profile.hobby_interest_tags)) for r in records}
    usage_by_genre = {
        tuple(sorted((r.profile.usage_by_genre or {}).items())) for r in records
    }
    assert len(oshi_ids) > 1
    assert len(hobby_tags) == len(records)
    assert len(usage_by_genre) == len(records)


def test_built_in_profiles_are_valid_driver_profiles(store: DriverProfileStore):
    for summary in store.list_profiles():
        if not summary["builtin"]:
            continue
        record = store.get_profile(summary["profile_id"])
        assert isinstance(record, DriverProfileRecord)
        assert record.builtin is True
        assert isinstance(record.profile, DriverProfile)
        # Re-validating via the model constructor must not raise.
        revalidated = DriverProfile.model_validate(record.profile.model_dump(mode="json"))
        assert isinstance(revalidated, DriverProfile)


def test_built_in_profile_catalog_refs_resolve(store: DriverProfileStore, catalog_artist_ids: set[str]):
    for summary in store.list_profiles():
        if not summary["builtin"]:
            continue
        record = store.get_profile(summary["profile_id"])
        if record.profile.oshi_id is not None:
            assert record.profile.oshi_id in catalog_artist_ids, (
                f"{record.profile_id}: oshi_id {record.profile.oshi_id!r} not in the frozen catalog"
            )


def test_list_profiles_summary_shape(store: DriverProfileStore):
    for summary in store.list_profiles():
        assert set(summary.keys()) == {"profile_id", "label", "builtin"}
        assert set(summary["label"].keys()) == {"ja", "en"}
        assert isinstance(summary["builtin"], bool)


# ---------------------------------------------------------------------------
# User profile save / list / get / round-trip
# ---------------------------------------------------------------------------


def _valid_profile_dict(**overrides) -> dict:
    base = {
        "oshi_registered": False,
        "oshi_mode": "off",
        "age_band": "20s",
        "gender": "unspecified",
        "hobby_interest_tags": ["custom-tag"],
    }
    base.update(overrides)
    return base


def test_save_profile_appears_in_list(store: DriverProfileStore):
    record = store.save_profile({"ja": "テスト", "en": "Test Profile"}, _valid_profile_dict())
    assert record.builtin is False
    assert record.profile_id

    summaries = store.list_profiles()
    ids = {s["profile_id"] for s in summaries}
    assert record.profile_id in ids


def test_save_profile_round_trips_identically(store: DriverProfileStore):
    record = store.save_profile({"ja": "ラウンドトリップ", "en": "Round Trip"}, _valid_profile_dict())

    reloaded = store.get_profile(record.profile_id)
    assert reloaded is not None
    assert reloaded.model_dump(mode="json") == record.model_dump(mode="json")


def test_saved_user_profiles_visible_from_a_new_store_instance(tmp_path):
    store_a = DriverProfileStore(profiles_dir=tmp_path)
    record = store_a.save_profile({"ja": "共有", "en": "Shared"}, _valid_profile_dict())

    store_b = DriverProfileStore(profiles_dir=tmp_path)
    reloaded = store_b.get_profile(record.profile_id)
    assert reloaded is not None
    assert reloaded.profile_id == record.profile_id


def test_save_profile_accepts_typed_driver_profile(store: DriverProfileStore):
    profile = DriverProfile.model_validate(_valid_profile_dict())
    record = store.save_profile({"ja": "型付き", "en": "Typed"}, profile)
    assert record.profile == profile


def test_two_saved_profiles_get_distinct_ids(store: DriverProfileStore):
    r1 = store.save_profile({"ja": "A", "en": "A"}, _valid_profile_dict())
    r2 = store.save_profile({"ja": "B", "en": "B"}, _valid_profile_dict())
    assert r1.profile_id != r2.profile_id


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


def test_delete_user_profile(store: DriverProfileStore):
    record = store.save_profile({"ja": "削除対象", "en": "To Delete"}, _valid_profile_dict())
    assert store.get_profile(record.profile_id) is not None

    store.delete_profile(record.profile_id)
    assert store.get_profile(record.profile_id) is None


def test_delete_unknown_user_profile_raises_not_found(store: DriverProfileStore):
    with pytest.raises(DriverProfileNotFoundError):
        store.delete_profile("dprof_no-such-profile")


def test_delete_built_in_profile_raises_conflict(store: DriverProfileStore):
    builtin_id = next(s["profile_id"] for s in store.list_profiles() if s["builtin"])
    with pytest.raises(DriverProfileConflictError):
        store.delete_profile(builtin_id)

    # The built-in must still be present/unaffected after the failed delete.
    assert store.get_profile(builtin_id) is not None


# ---------------------------------------------------------------------------
# Invalid profile on save -> field-level error
# ---------------------------------------------------------------------------


def test_save_profile_with_invalid_profile_raises_field_level_error(store: DriverProfileStore):
    invalid = _valid_profile_dict(age_band="not-a-real-age-band")
    with pytest.raises(ValidationError) as exc_info:
        store.save_profile({"ja": "無効", "en": "Invalid"}, invalid)

    errors = exc_info.value.errors()
    assert len(errors) >= 1
    assert any("age_band" in error["loc"] for error in errors)

    # Nothing should have been persisted for the invalid save.
    assert not any(not s["builtin"] for s in store.list_profiles())


def test_save_profile_with_invalid_label_raises_error(store: DriverProfileStore):
    with pytest.raises(ValidationError):
        store.save_profile({"ja": "missing-en"}, _valid_profile_dict())


def test_save_profile_with_out_of_range_rate_raises_error(store: DriverProfileStore):
    invalid = _valid_profile_dict(service_proposal_acceptance_rate={"music_playlist": 150.0})
    with pytest.raises(ValidationError):
        store.save_profile({"ja": "範囲外", "en": "Out of range"}, invalid)


# ---------------------------------------------------------------------------
# Isolation / directory-handling edge cases
# ---------------------------------------------------------------------------


def test_nonexistent_profiles_dir_yields_only_builtins(tmp_path):
    empty_store = DriverProfileStore(profiles_dir=tmp_path / "does-not-exist")
    summaries = empty_store.list_profiles()
    assert summaries
    assert all(s["builtin"] for s in summaries)


def test_get_profile_unknown_id_returns_none(store: DriverProfileStore):
    assert store.get_profile("no-such-profile-at-all") is None
