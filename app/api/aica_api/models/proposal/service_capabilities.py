"""ServiceCapability / ServiceCapabilities contract (data-model.md
§"ServiceCapability / ServiceCapabilities").

Loader/accessor over the frozen versioned artifact
``proposal_contracts/service_capabilities/service_capabilities.v1.json``
(the 14 spec §7.1/§7.2 per-service capability facts).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

from aica_api.models.proposal.enums import ServiceId

__all__ = [
    "ServiceCapability",
    "ServiceCapabilities",
]


class ServiceCapability(BaseModel):
    """Per-service capability facts (research.md D2, spec §7.1/§7.2)."""

    service_id: ServiceId
    driving_capable: bool
    screen_dependent: bool
    stopped_only: bool
    background_on_motion: bool
    lighting_compatible: bool | Literal["recipe"]
    requires_entity: str | None = None

    @model_validator(mode="after")
    def background_on_motion_requires_screen(self) -> "ServiceCapability":
        if self.background_on_motion and not self.screen_dependent:
            raise ValueError(
                f"{self.service_id.value!r} has background_on_motion=True but "
                "screen_dependent=False — a non-screen service has nothing to "
                "background."
            )
        return self


class ServiceCapabilities(BaseModel):
    """The frozen v1 service-capability artifact (data-model.md).

    Validators
    ----------
    Every ``ServiceId`` member must be present — enforced by ``load()`` (the
    only way an artifact reaches this model in practice) rather than by a
    model-level validator, so that direct in-memory construction with a
    partial ``services`` dict (e.g. for isolated per-field tests) is not
    blocked; the loader is the contract-facing entry point.
    """

    capabilities_version: str
    services: dict[ServiceId, ServiceCapability]

    def get(self, service_id: ServiceId) -> ServiceCapability:
        """Return the capability facts for *service_id*."""
        return self.services[service_id]

    # ------------------------------------------------------------------
    # Loader
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: Path) -> "ServiceCapabilities":
        """Load and validate the capabilities artifact from a frozen JSON
        artifact path.

        Raises ``ValueError`` if any ``ServiceId`` member is absent from the
        payload (a partial capabilities artifact could silently exclude a
        service from every eligibility check).
        """
        with Path(path).open(encoding="utf-8") as fh:
            data = json.load(fh)

        services = {
            entry["service_id"]: ServiceCapability(**entry) for entry in data["services"]
        }

        missing = set(ServiceId) - set(services.keys())
        if missing:
            raise ValueError(
                "service_capabilities artifact is missing ServiceId member(s): "
                f"{sorted(m.value for m in missing)}"
            )

        return cls(capabilities_version=data["capabilities_version"], services=services)
