"""P4 T006 — golden test binding the frozen v1 `service_capabilities` artifact
to research.md §D2 (spec §7.1/§7.2 classification).

If the spec §7.1/§7.2 capability mapping changes, this test must be updated
deliberately alongside the frozen artifact — it prevents silent divergence
between the committed `service_capabilities.v1.json` and the authoritative
spec table (research.md D2).
"""
from __future__ import annotations

import json
import pathlib

_ARTIFACT = (
    pathlib.Path(__file__).resolve().parents[4]
    / "proposal_contracts"
    / "service_capabilities"
    / "service_capabilities.v1.json"
)

# research.md §D2 — exact 14-row mapping (golden-test source of truth).
# Keys: driving_capable, screen_dependent, stopped_only, background_on_motion,
#       lighting_compatible, requires_entity
_EXPECTED = {
    "music_playlist": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": True,
        "requires_entity": None,
    },
    "humming_karaoke": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": True,
        "requires_entity": None,
    },
    "call_response_driving": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "quiz": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "ranking_creation": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "radio_style": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "conversation_audio": {
        "driving_capable": True,
        "screen_dependent": False,
        "stopped_only": False,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "live_viewing": {
        "driving_capable": True,
        "screen_dependent": True,
        "stopped_only": False,
        "background_on_motion": True,
        "lighting_compatible": True,
        "requires_entity": None,
    },
    "stretch_video": {
        "driving_capable": False,
        "screen_dependent": True,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": None,
    },
    "full_karaoke": {
        "driving_capable": False,
        "screen_dependent": True,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": True,
        "requires_entity": None,
    },
    "call_response_stopped": {
        "driving_capable": False,
        "screen_dependent": True,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": True,
        "requires_entity": None,
    },
    "oshi_reexperience": {
        "driving_capable": False,
        "screen_dependent": False,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": False,
        "requires_entity": "oshi",
    },
    "relaxation_multisensory": {
        "driving_capable": False,
        "screen_dependent": False,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": "recipe",
        "requires_entity": None,
    },
    "linked_video_recommendation": {
        "driving_capable": False,
        "screen_dependent": True,
        "stopped_only": True,
        "background_on_motion": False,
        "lighting_compatible": "recipe",
        "requires_entity": None,
    },
}


def _load_services() -> dict:
    data = json.loads(_ARTIFACT.read_text(encoding="utf-8"))
    return {s["service_id"]: s for s in data["services"]}


def test_capabilities_version_is_v1():
    data = json.loads(_ARTIFACT.read_text(encoding="utf-8"))
    assert data["capabilities_version"] == "v1"


def test_artifact_has_exactly_the_fourteen_expected_services():
    services = _load_services()
    assert set(services) == set(_EXPECTED), "service set diverges from research.md D2"


def test_each_service_matches_spec_field_by_field():
    services = _load_services()
    for service_id, expected_fields in _EXPECTED.items():
        actual = services[service_id]
        for field, expected_value in expected_fields.items():
            assert actual[field] == expected_value, (
                f"{service_id}.{field} diverges from research.md D2: "
                f"expected {expected_value!r}, got {actual[field]!r}"
            )


def test_live_viewing_is_sole_background_on_motion_service():
    services = _load_services()
    backgroundable = [
        sid for sid, s in services.items() if s["background_on_motion"] is True
    ]
    assert backgroundable == ["live_viewing"]


def test_stopped_only_services_are_exactly_the_expected_three_plus_stopped_row():
    services = _load_services()
    stopped_only = {sid for sid, s in services.items() if s["stopped_only"] is True}
    assert stopped_only == {
        "stretch_video",
        "full_karaoke",
        "call_response_stopped",
        "oshi_reexperience",
        "relaxation_multisensory",
        "linked_video_recommendation",
    }
    # The three named in research.md D2/tasks.md T006 explicitly.
    assert {"full_karaoke", "stretch_video", "call_response_stopped"} <= stopped_only


def test_oshi_reexperience_requires_entity_oshi():
    services = _load_services()
    assert services["oshi_reexperience"]["requires_entity"] == "oshi"
