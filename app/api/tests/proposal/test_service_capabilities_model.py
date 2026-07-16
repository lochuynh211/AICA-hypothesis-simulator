"""TDD: `ServiceCapabilities` loader/model (P4 T004).

Covers:
  - `ServiceCapabilities.load(path)` round-trips the frozen v1 artifact.
  - All 14 `ServiceId` members are present in `.services`.
  - `.get(ServiceId.live_viewing).background_on_motion is True`.
  - Validation: `background_on_motion=True` with `screen_dependent=False`
    raises; a payload missing a `ServiceId` raises.

Phase 2 — T004 (RED before T005 lands) -> T005 makes it GREEN.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.proposal.enums import ServiceId
from aica_api.models.proposal.service_capabilities import (
    ServiceCapabilities,
    ServiceCapability,
)

_ARTIFACT_PATH = (
    settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"
)


@pytest.fixture()
def capabilities() -> ServiceCapabilities:
    return ServiceCapabilities.load(_ARTIFACT_PATH)


def _raw_artifact() -> dict:
    with _ARTIFACT_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Loading / round-trip
# ---------------------------------------------------------------------------


def test_loads_from_frozen_artifact(capabilities: ServiceCapabilities):
    assert capabilities.capabilities_version == "v1"
    assert len(capabilities.services) == 14


def test_all_fourteen_service_ids_present(capabilities: ServiceCapabilities):
    assert set(capabilities.services.keys()) == set(ServiceId)


def test_get_live_viewing_background_on_motion_true(capabilities: ServiceCapabilities):
    assert capabilities.get(ServiceId.live_viewing).background_on_motion is True


def test_get_returns_service_capability(capabilities: ServiceCapabilities):
    cap = capabilities.get(ServiceId.music_playlist)
    assert isinstance(cap, ServiceCapability)
    assert cap.service_id == ServiceId.music_playlist


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_background_on_motion_without_screen_dependent_raises():
    with pytest.raises(ValidationError):
        ServiceCapability(
            service_id=ServiceId.music_playlist,
            driving_capable=True,
            screen_dependent=False,
            stopped_only=False,
            background_on_motion=True,
            lighting_compatible=True,
            requires_entity=None,
        )


def test_missing_service_id_raises():
    raw = _raw_artifact()
    # Drop one service (music_playlist) so the payload is missing a ServiceId.
    services = [s for s in raw["services"] if s["service_id"] != "music_playlist"]
    payload = {"capabilities_version": raw["capabilities_version"], "services": services}
    import tempfile
    import pathlib

    with tempfile.TemporaryDirectory() as tmp:
        path = pathlib.Path(tmp) / "incomplete.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        with pytest.raises(ValueError):
            ServiceCapabilities.load(path)


def test_lighting_compatible_accepts_recipe_literal(capabilities: ServiceCapabilities):
    cap = capabilities.get(ServiceId.relaxation_multisensory)
    assert cap.lighting_compatible == "recipe"
