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


# ---------------------------------------------------------------------------
# P1 enums (data-model.md §Enums, [new])
# ---------------------------------------------------------------------------

class MotionState(str, Enum):
    """Vehicle motion state at proposal time (P1 journey-state snapshot)."""
    driving = "driving"
    stopped = "stopped"


class ProposalPackageFamily(str, Enum):
    """Which half of the two-step proposal a package fills."""
    service_selector = "service_selector"
    content_selector = "content_selector"


class ProposalPackageApproach(str, Enum):
    """Algorithmic approach a package implements."""
    transparent = "transparent"
    constrained_llm = "constrained_llm"


class ServiceDecisionType(str, Enum):
    """Outcome category returned by the service selector (spec §5.4 service side)."""
    ranked_candidates = "ranked_candidates"
    no_proposal = "no_proposal"


class DiscreteEventType(str, Enum):
    """Discrete event kinds appended to a ``ProposalRunLog`` (shape/enum only in
    P1; only ``OPPORTUNITY_OPENED``, ``SERVICE_SELECTED``, ``CONTENT_SELECTED``,
    and ``ALGORITHM_ERROR`` are actually emitted by the P1 mock flow)."""
    OPPORTUNITY_OPENED = "OPPORTUNITY_OPENED"
    SERVICE_SELECTED = "SERVICE_SELECTED"
    CONTENT_SELECTED = "CONTENT_SELECTED"
    TRIGGER_PURPOSE_CHANGED = "TRIGGER_PURPOSE_CHANGED"
    REST_SPOT_ARRIVED = "REST_SPOT_ARRIVED"
    REST_COMPLETED = "REST_COMPLETED"
    CONTENT_COMPLETED = "CONTENT_COMPLETED"
    ALGORITHM_ERROR = "ALGORITHM_ERROR"
    # P4 additions (data-model.md §"DiscreteEventType — new members")
    SERVICE_REJECTED = "SERVICE_REJECTED"
    CONTENT_STARTED = "CONTENT_STARTED"
    MOTION_CHANGED = "MOTION_CHANGED"
    CONTINUE_REQUESTED = "CONTINUE_REQUESTED"
    RETURN_TO_PREVIOUS_CONTENT = "RETURN_TO_PREVIOUS_CONTENT"
    REST_STARTED = "REST_STARTED"
    POSTPONED = "POSTPONED"
    CHOOSE_ANOTHER = "CHOOSE_ANOTHER"
    REQUEST_MORE = "REQUEST_MORE"
    NO_ELIGIBLE_CANDIDATE = "NO_ELIGIBLE_CANDIDATE"


class ProposalRunStatus(str, Enum):
    """Lifecycle status of a ``ProposalRun``."""
    created = "created"
    service_selected = "service_selected"
    content_selected = "content_selected"
    error = "error"
    # P4 additions (data-model.md §"ProposalRunStatus — new members")
    content_started = "content_started"
    content_completed = "content_completed"
    content_stopped = "content_stopped"


# ---------------------------------------------------------------------------
# P3 enums (data-model.md §Situation / §DriverProfile, [new])
# ---------------------------------------------------------------------------

class TrafficState(str, Enum):
    """Traffic condition (spec §8/§9 content feature table)."""
    normal = "normal"
    congested = "congested"


class RoadType(str, Enum):
    """Normalized road-type context (spec §8/§9)."""
    highway = "highway"
    local = "local"
    mountain = "mountain"
    parking = "parking"


class NightState(str, Enum):
    """Day/night driving state (spec §8/§9)."""
    day = "day"
    night = "night"


class OshiMode(str, Enum):
    """Whether oshi (favorite-artist) personalization is explicitly enabled."""
    on = "on"
    off = "off"


class OshiType(str, Enum):
    """Kind of oshi entity the driver has registered (spec §9, normalized UPro identity)."""
    artist = "artist"
    artist_member = "artist_member"
    group = "group"
    character = "character"
    voice_actor = "voice_actor"
    franchise = "franchise"
    creator = "creator"
    other = "other"


class AgeBand(str, Enum):
    """Driver age band (spec §9; keys mirror the content selector's age_era_affinity table)."""
    teens = "teens"
    twenties = "20s"
    thirties = "30s"
    forties = "40s"
    fifties = "50s"
    sixty_plus = "60plus"


class Gender(str, Enum):
    """Driver gender (spec §9: "enum plus unknown"; default transparent weight is zero)."""
    male = "male"
    female = "female"
    non_binary = "non_binary"
    unspecified = "unspecified"


class RecencyState(str, Enum):
    """Service/item/tag recency band (spec §8/§9: "map to never, long_unused, recent")."""
    never = "never"
    long_unused = "long_unused"
    recent = "recent"


class ScheduledEventType(str, Enum):
    """Kind of upcoming scheduled event (spec §8/§9, simulator proposal)."""
    none = "none"
    live_show = "live_show"
    radio_program = "radio_program"
    concert = "concert"
    oshi_event = "oshi_event"
    other = "other"


class ScheduledEventTiming(str, Enum):
    """Proximity of a scheduled event (spec §8/§9, simulator proposal)."""
    now = "now"
    soon = "soon"
    later = "later"
    unknown = "unknown"


# ---------------------------------------------------------------------------
# P4 enums (data-model.md §"New enums (enums.py)", [new])
# ---------------------------------------------------------------------------

class JourneyActionType(str, Enum):
    """Discrete journey actions accepted by the P4 journey engine (data-model.md).

    NOTE: ``continue`` is a Python keyword, so the member is named
    ``continue_`` with value ``"continue"``. Downstream code must reference
    it as ``JourneyActionType.continue_`` or construct it via
    ``JourneyActionType("continue")``.
    """
    accept = "accept"
    reject = "reject"
    postpone = "postpone"
    choose_another = "choose_another"
    request_more = "request_more"
    complete = "complete"
    continue_ = "continue"
    stop = "stop"
    motion_change = "motion_change"
    rest_spot_arrived = "rest_spot_arrived"
    rest_started = "rest_started"
    rest_completed = "rest_completed"


class PlaybackState(str, Enum):
    """Playback state of the currently active content plan (data-model.md)."""
    idle = "idle"
    active = "active"
    backgrounded = "backgrounded"
    paused = "paused"
    completed = "completed"
    stopped = "stopped"


class EligibilityReasonCode(str, Enum):
    """Closed vocabulary of score-free eligibility exclusion reasons (research.md D3)."""
    screen_dependent_while_driving = "screen_dependent_while_driving"
    stopped_only_while_driving = "stopped_only_while_driving"
    full_karaoke_requires_stopped = "full_karaoke_requires_stopped"
    missing_required_entity = "missing_required_entity"
    catalog_item_unavailable = "catalog_item_unavailable"
    not_in_allowed_row = "not_in_allowed_row"
