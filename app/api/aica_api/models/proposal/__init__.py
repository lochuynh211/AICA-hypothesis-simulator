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
    MotionState,
    ProposalPackageFamily,
    ProposalPackageApproach,
    ServiceDecisionType,
    DiscreteEventType,
    ProposalRunStatus,
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

# ---------------------------------------------------------------------------
# Re-exports — feature-disposition registry (T018 / T019)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.dispositions import (  # noqa: F401
    DispositionEntry,
    CONTENT_FEATURE_DISPOSITIONS,
    registry_version,
)

# ---------------------------------------------------------------------------
# Re-exports — genre extension (T022 / T023)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.genre_extension import (  # noqa: F401
    GenreAffinityV1,
    GENRE_VOCABULARY,
)

# ---------------------------------------------------------------------------
# Re-exports — P1 opportunity contract (T006 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.opportunity import (  # noqa: F401
    ProposalOpportunity,
)

# ---------------------------------------------------------------------------
# Re-exports — P1 service-selector output contract (T007 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.service_output import (  # noqa: F401
    FeatureContribution,
    RankedCandidate,
    ServiceSelectorOutput,
)

# ---------------------------------------------------------------------------
# Re-exports — P1 events / journey / evidence shapes (T008 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.events import (  # noqa: F401
    DiscreteEvent,
)
from aica_api.models.proposal.journey import (  # noqa: F401
    JourneyState,
)
from aica_api.models.proposal.evidence import (  # noqa: F401
    EvidenceError,
    AlgorithmEvidence,
)

# ---------------------------------------------------------------------------
# Re-exports — P1 proposal run / run-log contracts (T009 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.proposal_run import (  # noqa: F401
    ProposalRun,
    ProposalRunLog,
)

# ---------------------------------------------------------------------------
# Re-exports — P1 package manifest contract (T010 / T011)
# ---------------------------------------------------------------------------
from aica_api.models.proposal.package_manifest import (  # noqa: F401
    BilingualLabel,
    ProposalPackageFamilySlot,
    ALL_FAMILY_SLOTS,
    AlgorithmSpec,
    HyperparameterDef,
    ProposalPackageManifest,
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
    "MotionState",
    "ProposalPackageFamily",
    "ProposalPackageApproach",
    "ServiceDecisionType",
    "DiscreteEventType",
    "ProposalRunStatus",
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
    # feature-disposition registry
    "DispositionEntry",
    "CONTENT_FEATURE_DISPOSITIONS",
    "registry_version",
    # genre extension
    "GenreAffinityV1",
    "GENRE_VOCABULARY",
    # opportunity (P1)
    "ProposalOpportunity",
    # service-selector output (P1)
    "FeatureContribution",
    "RankedCandidate",
    "ServiceSelectorOutput",
    # events / journey / evidence (P1)
    "DiscreteEvent",
    "JourneyState",
    "EvidenceError",
    "AlgorithmEvidence",
    # proposal run / run-log (P1)
    "ProposalRun",
    "ProposalRunLog",
    # package manifest (P1)
    "BilingualLabel",
    "ProposalPackageFamilySlot",
    "ALL_FAMILY_SLOTS",
    "AlgorithmSpec",
    "HyperparameterDef",
    "ProposalPackageManifest",
]
