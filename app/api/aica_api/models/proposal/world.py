"""Typed World model — P3 Editable World, Driver Profiles & Contrast (feature 014).

Implements ``ControlInputs``, ``Situation``, ``DriverProfile``, ``World`` (T007/T008)
and ``World.project()`` (T009/T010) per ``specs/014-proposal-p3-editable-world/data-model.md``.

Editing/UI grouping vs projection grouping
-------------------------------------------
The UI edits the world as three groups — ``control_inputs`` + ``situation`` +
``driver_profile`` — but the content-selector ALGORITHM consumes a differently
grouped ``feature_snapshot``: ``situation`` / ``preference`` / ``history`` /
``additional_proposed`` (+ optional ``genre_affinity_v1``), matching the P0.5
fixture the real content package (``packages/aica_transparent_content_selector_v1``)
was tested against (see ``proposal_contracts/fixtures/worlds/night-highway-baseline.json``
and research.md §R1). ``World.project()`` is the deterministic bridge between the two:
it re-buckets every A.1/A.2 field by the frozen disposition registry's ``category``
(``Situation`` -> ``situation``, ``Preference``/``History`` -> ``preference``/``history``
MINUS the fields the registry re-categorizes as ``Additional proposed``, which land in
``additional_proposed`` regardless of which UI group edits them). This is why, for
example, ``completed_items``/``manually_selected_items``/``repeated_items`` are edited
under the driver profile's Preference group but project into ``additional_proposed``,
and why ``estimated_min_until_rest_spot``/``rest_spot_type``/``active_service``/
``recent_service_rejections`` are edited under Situation but also project into
``additional_proposed``.

``catalog`` and ``_service_id`` are NOT world-owned — they are added by the caller
(the run/selector-dispatch code) when building the selector context, since the
former is the frozen dataset catalog (a different entity, see ``dataset.py``) and
the latter is the already-selected service, not a world field. Likewise the
``genre_affinity_v1.artist_genres`` map is catalog-derived (see
``proposal_contracts/dataset/<id>/genre_affinity_v1.json``), not world-owned — the
World only owns ``usage_by_genre``/``scene_genre_usage`` (the driver's own genre
affinity/usage data), so ``project()`` emits only those two keys under
``genre_affinity_v1`` when the extension is enabled; the caller merges in
``artist_genres`` from the dataset alongside ``catalog``.

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard test):
this module imports only ``aica_api.models.proposal.*``, stdlib, and pydantic —
never the trigger ``aica_api.models`` package, and never ``mdg``.

``World.project()`` is pure and deterministic: no clock/random/network/IO. Its
result depends only on the World's own field values and the frozen, in-repo
``CONTENT_FEATURE_DISPOSITIONS`` registry.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aica_api.models.proposal.dataset import CatalogRef
from aica_api.models.proposal.dispositions import CONTENT_FEATURE_DISPOSITIONS
from aica_api.models.proposal.enums import (
    AgeBand,
    GenreLiteral,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    OshiType,
    RecencyState,
    RestSpotType,
    RoadType,
    ScheduledEventTiming,
    ScheduledEventType,
    ServiceId,
    TrafficState,
    TriggerPurpose,
    UsageLevel,
)
from aica_api.models.proposal.package_manifest import BilingualLabel
from aica_api.models.proposal.selector_input import FeatureProvenanceEntry

__all__ = [
    "ControlInputs",
    "PlayedItem",
    "SkippedItem",
    "ChangedFromItem",
    "CompletedItem",
    "ManuallySelectedItem",
    "RepeatedItem",
    "CancelledContentPlan",
    "ServiceRejection",
    "Situation",
    "DriverProfile",
    "World",
    "SeedWorld",
    "DriverProfileRecord",
    "FieldOverride",
    "FieldDiff",
    "WorldClone",
    "SetupSnapshotOrigin",
    "SetupSnapshot",
]

# ---------------------------------------------------------------------------
# Compatibility rule (data-model.md — same rule as SelectorInput / ProposalOpportunity)
# ---------------------------------------------------------------------------

_REST_STAGES = frozenset(
    {
        LifecycleStage.before_rest_until_stop,
        LifecycleStage.during_rest_stopped,
        LifecycleStage.after_rest_before_restart,
    }
)

_ACTIVE_DRIVING_PURPOSES = frozenset(
    {
        TriggerPurpose.inattentive_driving_prevention_recovery,
        TriggerPurpose.route_music,
        TriggerPurpose.child_passenger_experience,
    }
)


def _purpose_stage_compatible(purpose: TriggerPurpose, stage: LifecycleStage) -> None:
    if stage in _REST_STAGES and purpose != TriggerPurpose.rest_recommended:
        raise ValueError(
            f"Lifecycle stage '{stage.value}' is only compatible with "
            f"trigger_purpose 'rest_recommended', but got '{purpose.value}'."
        )
    if stage == LifecycleStage.active_driving_content and purpose not in _ACTIVE_DRIVING_PURPOSES:
        raise ValueError(
            f"Lifecycle stage 'active_driving_content' is only compatible "
            f"with purposes {[p.value for p in _ACTIVE_DRIVING_PURPOSES]}, "
            f"but got '{purpose.value}'."
        )


# ---------------------------------------------------------------------------
# ControlInputs
# ---------------------------------------------------------------------------


class ControlInputs(BaseModel):
    """The run's control inputs (data-model.md §ControlInputs).

    ``matrix_version``/``dataset_id`` are validated here only for non-emptiness;
    actual resolvability against the matrix/dataset registries is a service-layer
    concern (``services/world_validation.py``, a later P3 task), not this model.
    """

    model_config = ConfigDict(extra="forbid")

    trigger_purpose: TriggerPurpose
    lifecycle_stage: LifecycleStage
    motion_state: MotionState
    matrix_version: str
    dataset_id: str

    @field_validator("matrix_version")
    @classmethod
    def matrix_version_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("matrix_version must not be empty.")
        return v

    @field_validator("dataset_id")
    @classmethod
    def dataset_id_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("dataset_id must not be empty.")
        return v

    @model_validator(mode="after")
    def purpose_stage_compatible(self) -> "ControlInputs":
        _purpose_stage_compatible(self.trigger_purpose, self.lifecycle_stage)
        return self


# ---------------------------------------------------------------------------
# Timestamped item/event sub-models (spec §9: "timestamped item-ID array" etc.)
# ---------------------------------------------------------------------------


class PlayedItem(BaseModel):
    """One played-item history entry. Field names match what the real content
    selector reads directly (``track_id``, ``last_played_at``)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    last_played_at: str


class SkippedItem(BaseModel):
    """One skipped-item history entry (``track_id``, ``skipped_at``)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    skipped_at: str


class ChangedFromItem(BaseModel):
    """One changed-from-item history entry (``track_id``, ``changed_at``)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    changed_at: str


class CompletedItem(BaseModel):
    """One completed-item history entry (Additional proposed / Granular operations)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    completed_at: str


class ManuallySelectedItem(BaseModel):
    """One manually-selected-item history entry (Additional proposed / Granular operations)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    selected_at: str


class RepeatedItem(BaseModel):
    """One repeated-item history entry (Additional proposed / Granular operations)."""

    model_config = ConfigDict(extra="forbid")

    track_id: str
    repeated_at: str


class CancelledContentPlan(BaseModel):
    """One cancelled content-plan record (spec §9: "timestamped plan record array")."""

    model_config = ConfigDict(extra="forbid")

    plan_id: str
    cancelled_at: str


class ServiceRejection(BaseModel):
    """One recent service-rejection record (spec §8/§9: "timestamped service-ID array")."""

    model_config = ConfigDict(extra="forbid")

    service_id: ServiceId
    rejected_at: str


# ---------------------------------------------------------------------------
# Situation — the momentary scene (data-model.md §Situation)
# ---------------------------------------------------------------------------


class Situation(BaseModel):
    """The momentary driving scene (data-model.md §Situation).

    Owns the 11 core-scene A.1/A.2 fields plus the 4 "additional proposed" scene
    fields (``estimated_min_until_rest_spot``/``rest_spot_type``/``active_service``/
    ``recent_service_rejections``) — the UI edits them together as one "Situation"
    group, but ``World.project()`` re-buckets the latter 4 into
    ``feature_snapshot["additional_proposed"]`` per the disposition registry.
    """

    model_config = ConfigDict(extra="forbid")

    # --- core scene (11 fields; project() -> feature_snapshot["situation"]) ---
    drowsiness_level: int = Field(ge=0, le=100)
    fatigue_level: int = Field(ge=0, le=100)
    traffic_state: TrafficState
    road_type: RoadType
    night_state: NightState
    monotony_level: int = Field(ge=0, le=100)
    route_tags: list[str] = Field(default_factory=list)
    destination_tags: list[str] = Field(default_factory=list)
    child_present: bool
    multiple_passengers: bool
    motion_state: MotionState

    # --- additional-proposed scene fields (4; project() -> "additional_proposed") ---
    estimated_min_until_rest_spot: int | None = Field(default=None, ge=0)
    rest_spot_type: RestSpotType
    active_service: ServiceId | None = None
    recent_service_rejections: list[ServiceRejection] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# DriverProfile — preference + history + genre extension (data-model.md §DriverProfile)
# ---------------------------------------------------------------------------


def _validate_unit_interval_map(values: dict[Any, float], field_name: str) -> dict[Any, float]:
    for key, val in values.items():
        if not (0.0 <= float(val) <= 1.0):
            raise ValueError(f"{field_name}[{key!r}] must be in [0, 1], got {val!r}.")
    return values


def _validate_percent_map(values: dict[Any, float], field_name: str) -> dict[Any, float]:
    for key, val in values.items():
        if not (0.0 <= float(val) <= 100.0):
            raise ValueError(f"{field_name}[{key!r}] must be in [0, 100], got {val!r}.")
    return values


class DriverProfile(BaseModel):
    """Preference + history + profile-side additional-proposed fields + the
    opt-in genre extension (data-model.md §DriverProfile).

    Field groupings below reflect the UI/editing grouping (Preference / History /
    genre extension); ``World.project()`` re-buckets some of these fields into
    ``feature_snapshot["additional_proposed"]`` per the disposition registry
    (``completed_items``/``manually_selected_items``/``repeated_items`` from
    Preference; the four ``*_confidence`` maps from History).
    """

    model_config = ConfigDict(extra="forbid")

    # --- Preference: Oshi information ---
    oshi_registered: bool
    oshi_mode: OshiMode
    oshi_id: str | None = None
    oshi_type: OshiType | None = None
    oshi_tags: list[str] = Field(default_factory=list)

    # --- Preference: UPro information ---
    age_band: AgeBand
    gender: Gender
    hobby_interest_tags: list[str] = Field(default_factory=list)

    # --- Preference: usage / recency / scene tendency ---
    service_usage_level: dict[ServiceId, UsageLevel] = Field(default_factory=dict)
    service_recency_state: dict[ServiceId, RecencyState] = Field(default_factory=dict)
    scene_service_usage_level: dict[str, dict[ServiceId, UsageLevel]] = Field(default_factory=dict)
    catalog_item_usage_level: dict[str, UsageLevel] = Field(default_factory=dict)
    catalog_item_recency_state: dict[str, RecencyState] = Field(default_factory=dict)
    content_tag_usage_level: dict[str, UsageLevel] = Field(default_factory=dict)
    content_tag_recency_state: dict[str, RecencyState] = Field(default_factory=dict)
    scene_content_tag_usage_level: dict[str, dict[str, UsageLevel]] = Field(default_factory=dict)

    # --- Preference: playback and user operations ---
    played_items: list[PlayedItem] = Field(default_factory=list)
    skipped_items: list[SkippedItem] = Field(default_factory=list)
    changed_from_items: list[ChangedFromItem] = Field(default_factory=list)
    cancelled_content_plans: list[CancelledContentPlan] = Field(default_factory=list)

    # --- Preference: granular operations (project() -> "additional_proposed") ---
    completed_items: list[CompletedItem] = Field(default_factory=list)
    manually_selected_items: list[ManuallySelectedItem] = Field(default_factory=list)
    repeated_items: list[RepeatedItem] = Field(default_factory=list)

    # --- History: proposal / recovery results ---
    service_proposal_acceptance_rate: dict[ServiceId, float] = Field(default_factory=dict)
    service_recovery_rate: dict[ServiceId, float] = Field(default_factory=dict)
    content_proposal_acceptance_rate: dict[str, float] = Field(default_factory=dict)
    content_recovery_rate: dict[str, float] = Field(default_factory=dict)

    # --- History: evidence reliability (project() -> "additional_proposed") ---
    service_proposal_acceptance_confidence: dict[ServiceId, float] = Field(default_factory=dict)
    service_recovery_confidence: dict[ServiceId, float] = Field(default_factory=dict)
    content_proposal_acceptance_confidence: dict[str, float] = Field(default_factory=dict)
    content_recovery_confidence: dict[str, float] = Field(default_factory=dict)

    # --- History: schedule promotion ---
    scheduled_event_type: ScheduledEventType | None = None
    scheduled_event_timing: ScheduledEventTiming | None = None
    scheduled_event_tags: list[str] = Field(default_factory=list)

    # --- Genre extension (opt-in; NOT part of the A.1/A.2 field count) ---
    genre_affinity_v1_enabled: bool = False
    usage_by_genre: dict[GenreLiteral, UsageLevel] | None = None
    scene_genre_usage: dict[str, dict[GenreLiteral, UsageLevel]] | None = None

    # ------------------------------------------------------------------
    # Range validators — percent maps (0-100) and unit-interval maps (0-1)
    # ------------------------------------------------------------------

    @field_validator(
        "service_proposal_acceptance_rate",
        "service_recovery_rate",
        "content_proposal_acceptance_rate",
        "content_recovery_rate",
    )
    @classmethod
    def _rate_maps_in_percent_range(cls, v: dict, info) -> dict:
        return _validate_percent_map(v, info.field_name)

    @field_validator(
        "service_proposal_acceptance_confidence",
        "service_recovery_confidence",
        "content_proposal_acceptance_confidence",
        "content_recovery_confidence",
    )
    @classmethod
    def _confidence_maps_in_unit_range(cls, v: dict, info) -> dict:
        return _validate_unit_interval_map(v, info.field_name)


# ---------------------------------------------------------------------------
# World — control_inputs + situation + driver_profile + catalog_ref
# ---------------------------------------------------------------------------

# Maps the frozen disposition registry's ``category`` to the projected
# feature_snapshot group key (research.md §R1 / data-model.md "Editing/UI
# grouping vs projection grouping").
_CATEGORY_TO_GROUP: dict[str, str] = {
    "Situation": "situation",
    "Preference": "preference",
    "History": "history",
    "Additional proposed": "additional_proposed",
}


def _dump_optional_genre_field(profile: DriverProfile, field_name: str) -> dict:
    """Return the JSON-mode dump of a single genre-extension field, defaulting to {}.

    Small helper so ``project()`` doesn't need to re-dump the whole profile twice
    just to read ``usage_by_genre``/``scene_genre_usage`` with plain (non-Enum)
    dict keys.
    """
    if getattr(profile, field_name) is None:
        return {}
    dumped = profile.model_dump(mode="json", include={field_name})
    return dumped.get(field_name) or {}


class World(BaseModel):
    """The complete editable proposal world (data-model.md §World).

    ``control_inputs`` + ``situation`` + ``driver_profile`` is the UI's editing
    grouping. ``catalog_ref`` pins which frozen dataset the world's catalog
    references are drawn from (immutable — see ``dataset.py``).
    """

    model_config = ConfigDict(extra="forbid")

    control_inputs: ControlInputs
    situation: Situation
    driver_profile: DriverProfile
    catalog_ref: CatalogRef

    # ------------------------------------------------------------------
    # project() — the deterministic World -> feature_snapshot bridge
    # ------------------------------------------------------------------

    def project(self) -> tuple[dict[str, Any], dict[str, FeatureProvenanceEntry]]:
        """Return ``(feature_snapshot, feature_provenance)``.

        ``feature_snapshot`` matches the shape the real content selector reads:
        ``{situation, preference, history, additional_proposed,
        _genre_extension_enabled[, genre_affinity_v1]}``. ``catalog`` and
        ``_service_id`` are NOT included here — they are not world-owned (see
        module docstring) and must be merged in by the caller before dispatch.

        Pure and deterministic: depends only on this World's field values and
        the frozen, in-repo ``CONTENT_FEATURE_DISPOSITIONS`` registry (no
        clock/random/network/IO). Identical World -> byte-identical output.
        """
        situation_values = self.situation.model_dump(mode="json")
        profile_values = self.driver_profile.model_dump(
            mode="json",
            exclude={"genre_affinity_v1_enabled", "usage_by_genre", "scene_genre_usage"},
        )
        flat: dict[str, Any] = {**situation_values, **profile_values}

        feature_snapshot: dict[str, Any] = {
            "situation": {},
            "preference": {},
            "history": {},
            "additional_proposed": {},
        }
        feature_provenance: dict[str, FeatureProvenanceEntry] = {}

        for entry in CONTENT_FEATURE_DISPOSITIONS:
            group = _CATEGORY_TO_GROUP[entry.category]
            feature_snapshot[group][entry.feature_id] = flat[entry.feature_id]
            feature_provenance[entry.feature_id] = FeatureProvenanceEntry(
                feature_origin=entry.feature_origin,
                source_reference=entry.source_reference,
            )

        genre_on = self.driver_profile.genre_affinity_v1_enabled
        feature_snapshot["_genre_extension_enabled"] = genre_on
        if genre_on:
            feature_snapshot["genre_affinity_v1"] = {
                "usage_by_genre": _dump_optional_genre_field(self.driver_profile, "usage_by_genre"),
                "scene_genre_usage": _dump_optional_genre_field(self.driver_profile, "scene_genre_usage"),
            }

        return feature_snapshot, feature_provenance


# ---------------------------------------------------------------------------
# SeedWorld — a committed, COMPLETE base-seed world (data-model.md §SeedWorld)
# ---------------------------------------------------------------------------


class SeedWorld(BaseModel):
    """A committed, ready-made "base seed" world reviewers can load and edit.

    Loaded read-only from ``proposal_contracts/seeds/*.json`` by
    ``services/world_seed_store.py`` (T013). Seeds are promoted, one-time,
    from ``generation_workspace/worlds.json`` by ``scripts/promote_seeds.py``
    (T014) and then committed — the generator workspace itself is a build
    area and is never read at runtime.

    ``world`` is always a COMPLETE, valid ``World`` (every A.1/A.2 field
    initialized) — the promotion script's job is exactly to complete it, not
    this model's (this model only shapes/validates what a seed *is*: an id
    plus a bilingual label/description plus the embedded world).
    """

    model_config = ConfigDict(extra="forbid")

    seed_id: str
    label: BilingualLabel
    description: BilingualLabel
    world: World

    @field_validator("seed_id")
    @classmethod
    def seed_id_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("seed_id must not be empty.")
        return v


# ---------------------------------------------------------------------------
# DriverProfileRecord — a stored, named driver profile (data-model.md
# §DriverProfileRecord)
# ---------------------------------------------------------------------------


class DriverProfileRecord(BaseModel):
    """A named, stored ``DriverProfile`` (data-model.md §DriverProfileRecord).

    Loaded/persisted by ``services/driver_profile_store.py`` (T015/T016).
    ``builtin=True`` records ship read-only under
    ``proposal_contracts/profiles/``; ``builtin=False`` records are
    reviewer-saved and persist under ``settings.proposal_profiles_dir``
    (git-ignored). Either kind embeds a fully-validated ``DriverProfile`` that
    can be loaded into any ``World`` (subject to that world's catalog
    reference validation).
    """

    model_config = ConfigDict(extra="forbid")

    profile_id: str
    label: BilingualLabel
    builtin: bool
    profile: DriverProfile

    @field_validator("profile_id")
    @classmethod
    def profile_id_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("profile_id must not be empty.")
        return v


# ---------------------------------------------------------------------------
# WorldClone — clone-and-change-one-variable contrast (data-model.md
# §WorldClone / research.md §R5, T028-T031)
# ---------------------------------------------------------------------------


class FieldOverride(BaseModel):
    """One requested change: set the field at ``path`` (dotted, e.g.
    ``"situation.drowsiness_level"``, ``"driver_profile.oshi_mode"``,
    optionally bracketed with a list index, e.g.
    ``"driver_profile.played_items[0].track_id"``) to ``value``.

    Applying/validating overrides is a service concern
    (``services/world_clone_store.py``) — this model only shapes the
    request, it does not itself walk the path.
    """

    model_config = ConfigDict(extra="forbid")

    path: str
    value: Any

    @field_validator("path")
    @classmethod
    def path_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Override path must not be empty.")
        return v


class FieldDiff(BaseModel):
    """One field-level before/after difference produced by a clone.

    ``path`` matches the ``FieldOverride.path`` it came from; ``before``/
    ``after`` are the plain (JSON-mode) values at that path in the base and
    cloned world respectively.
    """

    model_config = ConfigDict(extra="forbid")

    path: str
    before: Any
    after: Any


class WorldClone(BaseModel):
    """A user-created "clone the base seed and change ONE variable" contrast
    (data-model.md §WorldClone).

    ``world`` is the base seed's world with every override in ``overrides``
    applied — a COMPLETE, valid ``World`` (never a partial one). ``diff`` is
    computed deterministically as EXACTLY the overridden path(s) with their
    before/after values — nothing unchanged ever appears in it. Built and
    persisted by ``services/world_clone_store.py`` (T029) under
    ``settings.proposal_worlds_dir`` (git-ignored, unlike the committed
    ``SeedWorld``s it is based on).
    """

    model_config = ConfigDict(extra="forbid")

    clone_id: str
    base_seed_id: str
    overrides: list[FieldOverride]
    world: World
    diff: list[FieldDiff]

    @field_validator("clone_id", "base_seed_id")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("clone_id/base_seed_id must not be empty.")
        return v


# ---------------------------------------------------------------------------
# SetupSnapshot — frozen provenance of what produced a run (data-model.md
# §SetupSnapshot / research.md §R6)
# ---------------------------------------------------------------------------


class SetupSnapshotOrigin(BaseModel):
    """Which committed artifact(s) the run's world was assembled from.

    At most a run typically has one of ``seed_id``/``clone_id`` set (which
    base the world started from) plus, independently, ``profile_id`` if a
    reusable ``DriverProfileRecord`` was loaded into it — all three are
    optional and independent because a reviewer may also hand-edit a world
    from scratch (all three ``None``) or load a profile into a hand-edited
    world (only ``profile_id`` set).
    """

    model_config = ConfigDict(extra="forbid")

    seed_id: str | None = None
    clone_id: str | None = None
    profile_id: str | None = None


class SetupSnapshot(BaseModel):
    """Frozen provenance of what produced a run (data-model.md §SetupSnapshot).

    Embedded into ``ProposalRunLog`` at run-create time (replacing the opaque
    ``world_snapshot`` dict — the router migration to populate this field is a
    later P3 task; this model only defines the shape). Reopening a run renders
    this snapshot as-is, without recomputation.
    """

    model_config = ConfigDict(extra="forbid")

    origin: SetupSnapshotOrigin
    matrix_version: str
    dataset_id: str
    dataset_hash: str
    service_package_id: str
    service_contract_version: str
    content_package_id: str | None = None
    content_contract_version: str | None = None
    service_parameter_set_version: str
    content_parameter_set_version: str | None = None
    feature_provenance: dict[str, FeatureProvenanceEntry] = Field(default_factory=dict)
