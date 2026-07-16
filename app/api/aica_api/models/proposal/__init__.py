"""Proposal contract subpackage.

This package is ISOLATED from the trigger-model namespace.
It must not import from ``aica_api.models`` (the trigger package),
and ``aica_api.models.__init__`` must not import from here.

Version constants — consume these; never hardcode the strings.
"""
from __future__ import annotations

CONTRACT_VERSION: str = "1.0.0"
SCHEMA_VERSION: str = "1.0.0"
GENRE_EXTENSION_VERSION: str = "genre_affinity_v1"

# ---------------------------------------------------------------------------
# Re-exports (populated as each module is added in later tasks)
# ---------------------------------------------------------------------------
# from aica_api.models.proposal.enums import (  # noqa: F401  — T006
#     TriggerPurpose,
#     LifecycleStage,
#     ServiceId,
#     RestSpotType,
#     ContentDecisionType,
#     FeatureDisposition,
#     FeatureOriginProvenance,
#     ResponseCoefficientProvenance,
#     GenreLiteral,
#     UsageLevel,
# )

__all__ = [
    "CONTRACT_VERSION",
    "SCHEMA_VERSION",
    "GENRE_EXTENSION_VERSION",
]
