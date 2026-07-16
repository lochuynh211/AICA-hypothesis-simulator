"""Proposal contract enums and version constants.

All enum values are verbatim from data-model.md §Enums.
This module is ISOLATED from trigger models — no import of or from
``aica_api.models`` (the trigger package).

Module constants mirror those in ``proposal/__init__.py`` so that
consumers who import only this module also have access to the versions.
"""
from __future__ import annotations

from enum import Enum

# ---------------------------------------------------------------------------
# Version constants (also re-exported from proposal/__init__.py)
# ---------------------------------------------------------------------------
CONTRACT_VERSION: str = "1.0.0"
SCHEMA_VERSION: str = "1.0.0"
GENRE_EXTENSION_VERSION: str = "genre_affinity_v1"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TriggerPurpose(str, Enum):
    """The high-level intent of the proposal trigger (spec §7)."""
    rest_recommended = "rest_recommended"
    inattentive_driving_prevention_recovery = "inattentive_driving_prevention_recovery"
    route_music = "route_music"
    child_passenger_experience = "child_passenger_experience"


class LifecycleStage(str, Enum):
    """Driving lifecycle stage at the time of proposal (spec §7)."""
    before_rest_until_stop = "before_rest_until_stop"
    during_rest_stopped = "during_rest_stopped"
    after_rest_before_restart = "after_rest_before_restart"
    active_driving_content = "active_driving_content"


class ServiceId(str, Enum):
    """Catalog service identifiers (spec §7.1–7.2, 14 services)."""
    music_playlist = "music_playlist"
    humming_karaoke = "humming_karaoke"
    call_response_driving = "call_response_driving"
    quiz = "quiz"
    ranking_creation = "ranking_creation"
    radio_style = "radio_style"
    conversation_audio = "conversation_audio"
    live_viewing = "live_viewing"
    stretch_video = "stretch_video"
    full_karaoke = "full_karaoke"
    call_response_stopped = "call_response_stopped"
    oshi_reexperience = "oshi_reexperience"
    relaxation_multisensory = "relaxation_multisensory"
    linked_video_recommendation = "linked_video_recommendation"


class RestSpotType(str, Enum):
    """Classification of a rest opportunity location."""
    sa_pa = "sa_pa"
    convenience_store = "convenience_store"
    parking = "parking"
    oshi_spot = "oshi_spot"
    other = "other"
    unknown = "unknown"


class ContentDecisionType(str, Enum):
    """Outcome category returned by the content selector (spec §5.4)."""
    complete_plan = "complete_plan"
    no_proposal = "no_proposal"
    insufficient_eligible_items = "insufficient_eligible_items"
    unsupported_service = "unsupported_service"
    unsupported_recipe = "unsupported_recipe"
    invalid_request = "invalid_request"
    invalid_catalog = "invalid_catalog"
    invalid_configuration = "invalid_configuration"
    full_karaoke_requires_stopped = "full_karaoke_requires_stopped"


class FeatureDisposition(str, Enum):
    """How the content selector treats a feature field (design §6.1)."""
    scored = "scored"
    context_only = "context_only"
    available_but_not_used = "available_but_not_used"


class FeatureOriginProvenance(str, Enum):
    """Provenance of a feature's origin (distinct from response-coefficient provenance — FR-020)."""
    cdc_su_baseline = "cdc_su_baseline"
    normalized_cdc_su_concept = "normalized_cdc_su_concept"
    proposed_addition = "proposed_addition"


class ResponseCoefficientProvenance(str, Enum):
    """Provenance of a response coefficient (distinct from feature-origin provenance — FR-020)."""
    cdc_su_explicit = "cdc_su_explicit"
    service_definition = "service_definition"
    normalized_context_hypothesis = "normalized_context_hypothesis"


class GenreLiteral(str, Enum):
    """Controlled vocabulary of 12 Japanese-market music genres."""
    j_pop = "j-pop"
    j_rock = "j-rock"
    city_pop = "city pop"
    anime = "anime"
    vocaloid = "vocaloid"
    enka = "enka"
    childrens_music = "children's music"
    classical = "classical"
    jazz = "jazz"
    ambient = "ambient"
    electronic = "electronic"
    japanese_folk = "japanese folk"


class UsageLevel(str, Enum):
    """Ordinal usage-frequency level for genre-affinity extension."""
    never = "never"
    low = "low"
    med = "med"
    high = "high"
