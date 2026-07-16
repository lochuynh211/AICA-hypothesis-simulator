"""T012+T013 — handoff: test-first (TDD).

Tests for mdg/handoff.py:
- write_input writes schema-valid JSON to a path
- read_output loads + validates using the stage's schema
- read_output raises on: malformed JSON, schema violation, isrc-bearing output, audio-key-bearing output
- At minimum the 's1b_naming' stage is covered
"""
import json
import pytest
from pathlib import Path

from mdg.handoff import write_input, read_output, HandoffValidationError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_S1B_INPUT = {
    "unfilled_cells": [
        {
            "cell_id": "E-hi_T-hi_P-balanced-vocal",
            "energy_band": "high",
            "tempo_band": "high",
            "profile_family": "balanced_vocal",
            "target_language": "ja",
        }
    ],
    "language_targets": {"ja": 30, "en": 6, "other": 0},
    "exclude_names": ["real band|night runner"],
    "per_cell_target": 3,
}

VALID_S1B_OUTPUT = [
    {
        "title": "Yoru ni Kakeru",
        "artist": "YOASOBI",
        "release_year": 2019,
        "expected_language": "ja",
        "target_cell_id": "E-hi_T-hi_P-balanced-vocal",
        "why_fits_cell": "Fast BPM, high energy J-pop",
        "web_evidence": ["https://example.invalid/evidence1"],
    }
]


# ---------------------------------------------------------------------------
# write_input
# ---------------------------------------------------------------------------

class TestWriteInput:
    def test_write_creates_file(self, tmp_path):
        out = tmp_path / "s1b_input.json"
        write_input("s1b_naming", VALID_S1B_INPUT, out)
        assert out.exists()

    def test_write_produces_valid_json(self, tmp_path):
        out = tmp_path / "s1b_input.json"
        write_input("s1b_naming", VALID_S1B_INPUT, out)
        loaded = json.loads(out.read_text(encoding="utf-8"))
        assert loaded == VALID_S1B_INPUT

    def test_write_creates_parent_dirs(self, tmp_path):
        out = tmp_path / "nested" / "deep" / "s1b_input.json"
        write_input("s1b_naming", VALID_S1B_INPUT, out)
        assert out.exists()


# ---------------------------------------------------------------------------
# read_output — valid cases
# ---------------------------------------------------------------------------

class TestReadOutputValid:
    def test_valid_output_accepted(self, tmp_path):
        out = tmp_path / "s1b_output.json"
        out.write_text(json.dumps(VALID_S1B_OUTPUT), encoding="utf-8")
        result = read_output("s1b_naming", out)
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["title"] == "Yoru ni Kakeru"

    def test_multiple_items_accepted(self, tmp_path):
        items = VALID_S1B_OUTPUT * 3
        out = tmp_path / "s1b_output.json"
        out.write_text(json.dumps(items), encoding="utf-8")
        result = read_output("s1b_naming", out)
        assert len(result) == 3


# ---------------------------------------------------------------------------
# read_output — malformed JSON
# ---------------------------------------------------------------------------

class TestReadOutputMalformedJson:
    def test_malformed_json_raises(self, tmp_path):
        out = tmp_path / "bad.json"
        out.write_text("{ not valid json }", encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_empty_file_raises(self, tmp_path):
        out = tmp_path / "empty.json"
        out.write_text("", encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_null_raises(self, tmp_path):
        out = tmp_path / "null.json"
        out.write_text("null", encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)


# ---------------------------------------------------------------------------
# read_output — schema violations (missing required fields)
# ---------------------------------------------------------------------------

class TestReadOutputSchemaViolation:
    def test_missing_title_raises(self, tmp_path):
        bad = [{"artist": "YOASOBI", "release_year": 2019,
                "expected_language": "ja", "target_cell_id": "x",
                "why_fits_cell": "y", "web_evidence": []}]
        out = tmp_path / "bad_schema.json"
        out.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_missing_artist_raises(self, tmp_path):
        bad = [{"title": "Song", "release_year": 2019,
                "expected_language": "ja", "target_cell_id": "x",
                "why_fits_cell": "y", "web_evidence": []}]
        out = tmp_path / "bad_schema2.json"
        out.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_not_a_list_raises(self, tmp_path):
        bad = {"title": "Song", "artist": "Artist"}
        out = tmp_path / "not_list.json"
        out.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)


# ---------------------------------------------------------------------------
# read_output — FR-005 firewall: isrc / audio keys
# ---------------------------------------------------------------------------

class TestReadOutputFirewall:
    def _write_item(self, tmp_path: Path, extra_fields: dict) -> Path:
        item = {
            "title": "Night Runner",
            "artist": "Real Band",
            "release_year": 2021,
            "expected_language": "ja",
            "target_cell_id": "E-hi_T-hi_P-balanced-vocal",
            "why_fits_cell": "energetic",
            "web_evidence": [],
        }
        item.update(extra_fields)
        out = tmp_path / "firewalled.json"
        out.write_text(json.dumps([item]), encoding="utf-8")
        return out

    def test_isrc_bearing_output_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"isrc": "JPXXX2021001"})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_energy_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"energy": 0.8})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_tempo_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"tempo": 130.0})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_valence_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"valence": 0.6})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_danceability_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"danceability": 0.7})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_time_signature_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"time_signature": 4})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)

    def test_timeSignature_key_rejected(self, tmp_path):
        out = self._write_item(tmp_path, {"timeSignature": 4})
        with pytest.raises(HandoffValidationError):
            read_output("s1b_naming", out)
