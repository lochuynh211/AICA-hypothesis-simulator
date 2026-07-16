"""T044 — the frozen v1 purpose/stage matrix artifact matches consolidated
spec §7.5 (guards master-doc drift).

If the spec §7.5 matrix changes, this test must be updated deliberately
alongside the frozen artifact — it prevents silent divergence between the
committed `purpose_stage_matrix.v1.json` and the authoritative spec table.
"""
from __future__ import annotations

import json
import pathlib

_ARTIFACT = (
    pathlib.Path(__file__).resolve().parents[4]
    / "proposal_contracts"
    / "matrix"
    / "purpose_stage_matrix.v1.json"
)

# The Slide-65 driving-content set shared by before_rest and the three
# active_driving_content rows (spec §7.5).
_DRIVING_CONTENT = [
    "music_playlist",
    "humming_karaoke",
    "quiz",
    "ranking_creation",
    "radio_style",
    "call_response_driving",
]

# spec §7.5, exact rows (order-insensitive on the service lists).
_EXPECTED = {
    ("rest_recommended", "before_rest_until_stop"): _DRIVING_CONTENT,
    ("rest_recommended", "during_rest_stopped"): [],  # journey-engine rest actions (§7.3), no ServiceIds
    ("rest_recommended", "after_rest_before_restart"): [
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",  # §17 post-rest 4->5 resolved in P1
    ],
    ("inattentive_driving_prevention_recovery", "active_driving_content"): _DRIVING_CONTENT,
    ("route_music", "active_driving_content"): _DRIVING_CONTENT,
    ("child_passenger_experience", "active_driving_content"): _DRIVING_CONTENT,
}


def _load_rows() -> dict:
    data = json.loads(_ARTIFACT.read_text(encoding="utf-8"))
    return {
        (r["trigger_purpose"], r["lifecycle_stage"]): r["allowed_service_ids"]
        for r in data["rows"]
    }


def test_matrix_has_exactly_the_six_spec_rows():
    rows = _load_rows()
    assert set(rows) == set(_EXPECTED), "matrix rows diverge from spec §7.5"


def test_each_row_matches_spec_service_set():
    rows = _load_rows()
    for key, expected in _EXPECTED.items():
        assert sorted(rows[key]) == sorted(expected), f"row {key} diverges from spec §7.5"


def test_post_rest_row_has_five_including_call_response_stopped():
    rows = _load_rows()
    post_rest = rows[("rest_recommended", "after_rest_before_restart")]
    assert len(post_rest) == 5
    assert "call_response_stopped" in post_rest
