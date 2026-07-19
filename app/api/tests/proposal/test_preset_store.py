"""Tests for the committed preset store (feature 018 — Proposal Preset
Test-Cases).

Covers (data-model.md §Preset/§PresetSummary, contracts/preset_endpoints.md):
  - all 18 committed presets load and validate with no errors;
  - each loaded preset round-trips through the Preset model unchanged;
  - PresetSummary projection shape ({preset_id, label, brief, category, family, journey,
    contrast_with, hypothesis}), sorted by preset_id;
  - a deliberately malformed preset (built in a tmp dir fixture) is REJECTED
    with a visible error (``PresetLoadError`` raised at construction) —
    never silently skipped/quarantined, unlike ``WorldSeedStore``.
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
from aica_api.models.proposal.preset import Preset, PresetSummary
from aica_api.services.preset_store import PresetLoadError, PresetStore

_PRESETS_DIR = settings.proposal_contracts_dir / "presets"

_EXPECTED_PRESET_IDS = {p.stem for p in _PRESETS_DIR.glob("preset-*.json")}


@pytest.fixture()
def store() -> PresetStore:
    return PresetStore(_PRESETS_DIR)


# ---------------------------------------------------------------------------
# All 18 committed presets load + validate
# ---------------------------------------------------------------------------


def test_exactly_the_committed_presets_are_present(store: PresetStore):
    summaries = store.list_summaries()
    ids = {s.preset_id for s in summaries}
    assert ids == _EXPECTED_PRESET_IDS
    assert len(summaries) == 35


@pytest.mark.parametrize("preset_id", sorted(_EXPECTED_PRESET_IDS))
def test_each_preset_loads_as_a_valid_preset(store: PresetStore, preset_id: str):
    preset = store.get(preset_id)
    assert isinstance(preset, Preset)
    assert preset.preset_id == preset_id
    assert preset.schema_version == "1.0.0"


def test_unknown_preset_id_returns_none(store: PresetStore):
    assert store.get("preset-does-not-exist") is None


# ---------------------------------------------------------------------------
# Round-trip: load -> model_dump -> re-validate is identical
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("preset_id", sorted(_EXPECTED_PRESET_IDS))
def test_preset_round_trip_is_identical(store: PresetStore, preset_id: str):
    preset = store.get(preset_id)
    dumped = preset.model_dump(mode="json")
    reloaded = Preset.model_validate(dumped)
    assert reloaded.model_dump(mode="json") == dumped


def test_preset_files_load_from_disk_without_information_loss():
    # NOTE: this intentionally does NOT assert byte-for-byte dict equality
    # against the on-disk JSON — the generator OMITS unset-optional
    # ``ExpectedTop`` keys (e.g. ``track_id``/``genre``/``arousal_band`` when
    # unused) rather than writing them as explicit ``null``, whereas the
    # model always dumps every declared field. ``test_preset_round_trip_is_identical``
    # (model -> dump -> revalidate -> dump) already proves true round-trip
    # fidelity; this test instead spot-checks that every top-level/expectation
    # value present on disk survives validation unchanged.
    for path in sorted(_PRESETS_DIR.glob("*.json")):
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        preset = Preset.model_validate(on_disk)
        dumped = preset.model_dump(mode="json")

        assert dumped["preset_id"] == on_disk["preset_id"]
        assert dumped["family"] == on_disk["family"]
        assert dumped["contrast_with"] == on_disk["contrast_with"]
        assert dumped["world"] == on_disk["world"]
        disk_overrides = on_disk["algorithm_config_overrides"]
        if disk_overrides is None:
            assert dumped["algorithm_config_overrides"] is None
        else:
            for key, value in disk_overrides.items():
                assert dumped["algorithm_config_overrides"][key] == value
        for key, value in on_disk["expectation"].items():
            if key == "expected_top":
                for sub_key, sub_value in value.items():
                    assert dumped["expectation"]["expected_top"][sub_key] == sub_value
            elif key == "should_rank_below":
                dumped_list = dumped["expectation"]["should_rank_below"]
                assert len(dumped_list) == len(value)
                for disk_item, dumped_item in zip(value, dumped_list):
                    for sub_key, sub_value in disk_item.items():
                        assert dumped_item[sub_key] == sub_value
            else:
                assert dumped["expectation"][key] == value


# ---------------------------------------------------------------------------
# contrast_with symmetry (data-model.md validation rule)
# ---------------------------------------------------------------------------


def test_contrast_with_pairs_are_symmetric_when_set(store: PresetStore):
    for preset_id in _EXPECTED_PRESET_IDS:
        preset = store.get(preset_id)
        if preset.contrast_with is None:
            continue
        assert preset.contrast_with in _EXPECTED_PRESET_IDS
        partner = store.get(preset.contrast_with)
        assert partner is not None
        assert partner.contrast_with == preset.preset_id


# ---------------------------------------------------------------------------
# PresetSummary projection shape
# ---------------------------------------------------------------------------


def test_list_summaries_shape_and_sort_order(store: PresetStore):
    summaries = store.list_summaries()
    assert [s.preset_id for s in summaries] == sorted(s.preset_id for s in summaries)
    for summary in summaries:
        assert isinstance(summary, PresetSummary)
        assert summary.label.ja and summary.label.en
        assert summary.brief.ja and summary.brief.en
        assert summary.hypothesis
        preset = store.get(summary.preset_id)
        assert summary.family == preset.family
        assert summary.contrast_with == preset.contrast_with
        assert summary.hypothesis == preset.expectation.hypothesis


# ---------------------------------------------------------------------------
# Read-only / malformed-preset behaviour — VISIBLE error, never quarantined
# (deliberately unlike WorldSeedStore.list_errors()).
# ---------------------------------------------------------------------------


def test_malformed_preset_raises_a_visible_error_not_silently_skipped(tmp_path):
    (tmp_path / "preset-broken.json").write_text(
        json.dumps({"preset_id": "preset-broken"}), encoding="utf-8"
    )
    with pytest.raises(PresetLoadError) as excinfo:
        PresetStore(tmp_path)
    assert "preset-broken.json" in str(excinfo.value)


def test_preset_id_mismatched_with_filename_stem_raises(tmp_path):
    valid = json.loads((_PRESETS_DIR / "preset-coldstart-neutral.json").read_text(encoding="utf-8"))
    valid["preset_id"] = "preset-something-else"
    (tmp_path / "preset-coldstart-neutral.json").write_text(json.dumps(valid), encoding="utf-8")
    with pytest.raises(PresetLoadError) as excinfo:
        PresetStore(tmp_path)
    assert "does not match filename stem" in str(excinfo.value)


def test_unknown_top_level_field_is_rejected_extra_forbid(tmp_path):
    valid = json.loads((_PRESETS_DIR / "preset-coldstart-neutral.json").read_text(encoding="utf-8"))
    valid["unexpected_field"] = "should not be allowed"
    (tmp_path / "preset-coldstart-neutral.json").write_text(json.dumps(valid), encoding="utf-8")
    with pytest.raises(PresetLoadError):
        PresetStore(tmp_path)


def test_nonexistent_presets_dir_yields_empty_store(tmp_path):
    empty_store = PresetStore(tmp_path / "does-not-exist")
    assert empty_store.list_summaries() == []


def test_frozen_preset_files_byte_unchanged_after_load():
    before = {p.name: p.read_bytes() for p in sorted(_PRESETS_DIR.glob("*.json"))}
    PresetStore(_PRESETS_DIR)
    after = {p.name: p.read_bytes() for p in sorted(_PRESETS_DIR.glob("*.json"))}
    assert before == after
