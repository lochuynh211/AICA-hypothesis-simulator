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
# Re-exports — enums (T006)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.enums import (  # noqa: F401
    TriggerPurpose,
    LifecycleStage,
    ServiceId,
    RestSpotType,
    ContentDecisionType,
    FeatureDisposition,
    FeatureOriginProvenance,
    ResponseCoefficientProvenance,
    GenreLiteral,
    UsageLevel,
)

# ---------------------------------------------------------------------------
# Re-exports — selector input (T009 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.selector_input import (  # noqa: F401
    SelectorInput,
    FeatureProvenanceEntry,
    CandidateRef,
    ExcludedCandidate,
)

# ---------------------------------------------------------------------------
# Re-exports — content output (T010 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.content_output import (  # noqa: F401
    CompletePlan,
    OrderedItem,
    ItemFeatureContribution,
    SongTraitValues,
    PlanMode,
    LightingConfiguration,
    ExcludedItem,
)

# ---------------------------------------------------------------------------
# Re-exports — song schema (T015 / T016)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.song_schema import (  # noqa: F401
    Song,
    SpotifyTrack,
    SpotifyAudioFeatures,
    SimulationFlags,
    Album,
    ArtistRef,
    ExternalIds,
    ExternalUrls,
    Image,
    Restrictions,
    LinkedFrom,
)

__all__ = [
    "CONTRACT_VERSION",
    "SCHEMA_VERSION",
    "GENRE_EXTENSION_VERSION",
    # enums
    "TriggerPurpose",
    "LifecycleStage",
    "ServiceId",
    "RestSpotType",
    "ContentDecisionType",
    "FeatureDisposition",
    "FeatureOriginProvenance",
    "ResponseCoefficientProvenance",
    "GenreLiteral",
    "UsageLevel",
    # selector input
    "SelectorInput",
    "FeatureProvenanceEntry",
    "CandidateRef",
    "ExcludedCandidate",
    # content output
    "CompletePlan",
    "OrderedItem",
    "ItemFeatureContribution",
    "SongTraitValues",
    "PlanMode",
    "LightingConfiguration",
    "ExcludedItem",
    # song schema
    "Song",
    "SpotifyTrack",
    "SpotifyAudioFeatures",
    "SimulationFlags",
    "Album",
    "ArtistRef",
    "ExternalIds",
    "ExternalUrls",
    "Image",
    "Restrictions",
    "LinkedFrom",
]
