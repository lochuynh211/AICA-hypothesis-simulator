"""Feature-disposition registry — single source of truth.

One :class:`DispositionEntry` per **content** field in the specification §9 table
("Feature Contract — Concrete Content Proposal, One Independent Table", a.k.a.
Appendix A.2), marking each field's disposition (scored / context_only /
available_but_not_used), its feature-origin provenance, and — for scored rows —
its response-coefficient provenance. Genre-gated rows carry ``genre_gated=True``
and behave as ``context_only`` when the ``genre_affinity_v1`` extension is off.

Authoritative sources:
- ``docs/master/aica_proposal_simulator_specification.md`` §9 — the field set.
- ``docs/master/aica_transparent_content_proposal_algorithm.md`` §5.3 (Table 3)
  and §6.1 — per-feature scored / context-only decisions, the six ``genre‡``
  features, and the explicit statement that "the remaining 15 stay
  ``context_only``".
- ``docs/superpowers/specs/2026-07-16-proposal-p0.5-design.md`` §6.1 —
  disposition population rules.

Provenance is held in **two separate fields** (``feature_origin`` and
``response_provenance``) and is never conflated (FR-020).

This module is ISOLATED from the trigger models — it imports only from
``aica_api.models.proposal.enums``.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from aica_api.models.proposal.enums import (
    FeatureDisposition,
    FeatureOriginProvenance,
    ResponseCoefficientProvenance,
)

registry_version: str = "1"


class DispositionEntry(BaseModel):
    """A single content-feature field's disposition + provenance record."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    feature_id: str
    category: str
    subcategory: str
    feature_name: str
    disposition: FeatureDisposition
    feature_origin: FeatureOriginProvenance
    response_provenance: ResponseCoefficientProvenance | None = None
    genre_gated: bool = False
    enum_responses: dict[str, str] | None = None
    source_reference: str
    rationale: str


# Shorthands for readability in the table below.
_SCORED = FeatureDisposition.scored
_CONTEXT = FeatureDisposition.context_only
_AVAILABLE = FeatureDisposition.available_but_not_used

_BASELINE = FeatureOriginProvenance.cdc_su_baseline
_NORMALIZED = FeatureOriginProvenance.normalized_cdc_su_concept
_PROPOSED = FeatureOriginProvenance.proposed_addition

_EXPLICIT = ResponseCoefficientProvenance.cdc_su_explicit
_SERVICE_DEF = ResponseCoefficientProvenance.service_definition
_HYPOTHESIS = ResponseCoefficientProvenance.normalized_context_hypothesis


CONTENT_FEATURE_DISPOSITIONS: list[DispositionEntry] = [
    # -----------------------------------------------------------------------
    # Situation (§9 rows 1–11)
    # -----------------------------------------------------------------------
    DispositionEntry(
        feature_id="drowsiness_level",
        category="Situation",
        subcategory="Current driver state",
        feature_name="Drowsiness level",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (Situation)",
        rationale="Scored: drowsiness → song arousal/valence traits (+0.80·A_s + 0.20·V_s).",
    ),
    DispositionEntry(
        feature_id="fatigue_level",
        category="Situation",
        subcategory="Current driver state",
        feature_name="Fatigue level",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        source_reference="spec §9; content-algo §5.3 Table 3 (Situation, ⚠)",
        rationale="Scored via directional hypothesis (−0.50·A_s + 0.50·V_s); §5.6 ⚠.",
    ),
    DispositionEntry(
        feature_id="traffic_state",
        category="Situation",
        subcategory="Driving environment",
        feature_name="Traffic state",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=False,
        enum_responses={
            "normal": "0",
            "congested": "-0.40*A_s + 0.60*V_s",
        },
        source_reference="spec §9; content-algo §5.3 Table 3 (Situation, ⚠ congested)",
        rationale="Scored categorical; per-enum responses recorded; congested is a ⚠ hypothesis.",
    ),
    DispositionEntry(
        feature_id="road_type",
        category="Situation",
        subcategory="Driving environment",
        feature_name="Road type",
        disposition=_SCORED,
        feature_origin=_NORMALIZED,
        response_provenance=_EXPLICIT,
        enum_responses={
            "highway": "+1.00*A_s",
            "local": "0",
            "mountain": "-1.00*A_s",
            "parking": "0",
        },
        source_reference="spec §9 (normalized enum); content-algo §5.3 Table 3",
        rationale="Scored categorical; §9 marks the enum normalized (feature_origin=normalized).",
    ),
    DispositionEntry(
        feature_id="night_state",
        category="Situation",
        subcategory="Driving environment",
        feature_name="Day/night state",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        enum_responses={
            "day": "0",
            "night": "-0.50*A_s + 0.50*V_s",
        },
        source_reference="spec §9; content-algo §5.3 Table 3 (Situation, ⚠ night)",
        rationale="Scored categorical; night is a ⚠ directional hypothesis.",
    ),
    DispositionEntry(
        feature_id="monotony_level",
        category="Situation",
        subcategory="Driving environment",
        feature_name="Road monotony",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (Situation)",
        rationale="Scored: monotony → +0.90·A_s + 0.10·V_s.",
    ),
    DispositionEntry(
        feature_id="route_tags",
        category="Situation",
        subcategory="Route and destination",
        feature_name="Route characteristics",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡) / §5.7",
        rationale="Genre-gated: scored via genre_affinity_v1 route→genre map when the "
        "extension is on (mask 1); context-only when off.",
    ),
    DispositionEntry(
        feature_id="destination_tags",
        category="Situation",
        subcategory="Route and destination",
        feature_name="Destination characteristics",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡) / §5.7",
        rationale="Genre-gated: scored via destination→genre map when the extension is on.",
    ),
    DispositionEntry(
        feature_id="child_present",
        category="Situation",
        subcategory="Passenger composition",
        feature_name="Child present",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡ + eligibility) / §5.7",
        rationale="Genre-gated: scored via child-friendly genre map when extension is on; "
        "also drives explicit eligibility (§7).",
    ),
    DispositionEntry(
        feature_id="multiple_passengers",
        category="Situation",
        subcategory="Passenger composition",
        feature_name="Multiple passengers",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: no group-appeal song field exists in V1.",
    ),
    DispositionEntry(
        feature_id="motion_state",
        category="Situation",
        subcategory="Driving state",
        feature_name="Driving/stopped state",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        enum_responses={
            "driving": "alpha_drive*A_s (alpha_drive=-0.30)",
            "stopped": "0",
        },
        source_reference="spec §9; content-algo §5.3 Table 3 (⚠ driving) + eligibility",
        rationale="Scored categorical; driving is a ⚠ hypothesis; stopped also gates full-karaoke eligibility.",
    ),
    # -----------------------------------------------------------------------
    # Preference (§9 rows 12–31)
    # -----------------------------------------------------------------------
    DispositionEntry(
        feature_id="oshi_registered",
        category="Preference",
        subcategory="Oshi information",
        feature_name="Oshi registered",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (gate)",
        rationale="Context-only gate: enables the Oshi ID score; not a standalone score.",
    ),
    DispositionEntry(
        feature_id="oshi_mode",
        category="Preference",
        subcategory="Oshi information",
        feature_name="Oshi mode",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (gate)",
        rationale="Context-only gate: `off` forces the oshi gate to 0; enables Oshi ID, not standalone.",
    ),
    DispositionEntry(
        feature_id="oshi_artists",
        category="Preference",
        subcategory="Oshi information",
        feature_name="Oshi artists",
        disposition=_SCORED,
        feature_origin=_NORMALIZED,
        response_provenance=_EXPLICIT,
        source_reference="spec §9 (normalized UPro identity); content-algo §5.3 Table 3",
        rationale="Scored: gate-enabled match of spotify_track.artists[*].id against the "
        "driver's registered oshi artists, using the MAX 熱狂度 (enthusiasm) among "
        "matched artists as the affinity (feature 025 slice S2 — replaces the single "
        "oshi_id exact match with a list so a driver can register several oshi, each "
        "at a different intensity); §9 marks the identity normalized "
        "(feature_origin=normalized).",
    ),
    DispositionEntry(
        feature_id="oshi_tags",
        category="Preference",
        subcategory="Oshi information",
        feature_name="Oshi tags",
        disposition=_CONTEXT,
        feature_origin=_NORMALIZED,
        source_reference="spec §9 (normalized UPro identity); content-algo §5.3 (not scored)",
        rationale="Context-only: no song semantic tags in V1.",
    ),
    DispositionEntry(
        feature_id="service_recency_state",
        category="Preference",
        subcategory="Unused function",
        feature_name="Service recency",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: service-level; same value for every candidate in the selected service.",
    ),
    DispositionEntry(
        feature_id="service_usage_level",
        category="Preference",
        subcategory="Overall usage frequency",
        feature_name="Service usage level",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: service-level; same across candidates.",
    ),
    DispositionEntry(
        feature_id="scene_service_usage_level",
        category="Preference",
        subcategory="Scene-specific tendency",
        feature_name="Scene/service usage level",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: service-level; same across candidates.",
    ),
    DispositionEntry(
        feature_id="age_band",
        category="Preference",
        subcategory="UPro information",
        feature_name="Age band",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: album.release_date → era → age_era_affinity[band][era] (designed affinity).",
    ),
    DispositionEntry(
        feature_id="gender",
        category="Preference",
        subcategory="UPro information",
        feature_name="Gender",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9 (default weight 0); content-algo §5.3 (not scored)",
        rationale="Context-only: CDC-SU preserved at default transparent weight 0; "
        "content-algo §5.3 folds it into the remaining 15 context_only fields.",
    ),
    DispositionEntry(
        feature_id="hobby_interest_tags",
        category="Preference",
        subcategory="UPro information",
        feature_name="Hobbies and interests",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡) / §5.7",
        rationale="Genre-gated: scored via hobby→genre map when the extension is on.",
    ),
    DispositionEntry(
        feature_id="catalog_item_recency_state",
        category="Preference",
        subcategory="Unused content",
        feature_name="Catalog item recency",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: not in CDC-SU content inputs (slides 71–73 have no novelty row).",
    ),
    DispositionEntry(
        feature_id="content_tag_recency_state",
        category="Preference",
        subcategory="Unused content",
        feature_name="Content-tag recency",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: not in CDC-SU content inputs (slides 71–73).",
    ),
    DispositionEntry(
        feature_id="content_tag_usage_level",
        category="Preference",
        subcategory="Overall usage frequency",
        feature_name="Content-tag usage level",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡) / §5.7 (a.k.a. usage_by_genre)",
        rationale="Genre-gated: scored via usage_by_genre curve when the extension is on; "
        "renamed to `usage_by_genre` under genre_affinity_v1.",
    ),
    DispositionEntry(
        feature_id="catalog_item_usage_level",
        category="Preference",
        subcategory="Overall usage frequency",
        feature_name="Catalog item usage level",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: catalog_item_usage_level[id] band → spotify_track.id exact match.",
    ),
    DispositionEntry(
        feature_id="scene_content_tag_usage_level",
        category="Preference",
        subcategory="Scene-specific tendency",
        feature_name="Scene/content-tag usage level",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_HYPOTHESIS,
        genre_gated=True,
        source_reference="spec §9; content-algo §5.3 (genre‡) / §5.7 (a.k.a. scene_genre_usage)",
        rationale="Genre-gated: scored via scene_genre_usage[scene] curve when the extension is on; "
        "renamed to `scene_genre_usage` under genre_affinity_v1.",
    ),
    DispositionEntry(
        feature_id="played_items",
        category="Preference",
        subcategory="Playback and user operations",
        feature_name="Played items",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: recency-windowed played_items → spotify_track.id exact match.",
    ),
    DispositionEntry(
        feature_id="skipped_items",
        category="Preference",
        subcategory="Playback and user operations",
        feature_name="Skipped items",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored + eligibility)",
        rationale="Scored: in-window skips excluded by eligibility; older skips −.5; id exact match.",
    ),
    DispositionEntry(
        feature_id="cancelled_content_plans",
        category="Preference",
        subcategory="Playback and user operations",
        feature_name="Cancelled content plans",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: not in the slide 71/72 playback-ops list (played/skip/change only).",
    ),
    DispositionEntry(
        feature_id="changed_from_items",
        category="Preference",
        subcategory="Playback and user operations",
        feature_name="Changed-from items",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: changed_from_items in-window −.75 → spotify_track.id exact match.",
    ),
    # -----------------------------------------------------------------------
    # History (§9 rows 32–38)
    # -----------------------------------------------------------------------
    DispositionEntry(
        feature_id="service_proposal_acceptance_rate",
        category="History",
        subcategory="Proposal result",
        feature_name="Service proposal acceptance rate",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: service-level; same across all candidates.",
    ),
    DispositionEntry(
        feature_id="service_recovery_rate",
        category="History",
        subcategory="Recovery result",
        feature_name="Service recovery rate",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored)",
        rationale="Context-only: service-level; same across all candidates.",
    ),
    DispositionEntry(
        feature_id="scheduled_event_type",
        category="History",
        subcategory="Schedule",
        feature_name="Scheduled event type",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored); design §6.2",
        rationale="Context-only: no song event relation in V1; schedule→content affinity deferred.",
    ),
    DispositionEntry(
        feature_id="scheduled_event_timing",
        category="History",
        subcategory="Schedule",
        feature_name="Scheduled event timing",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored); design §6.2",
        rationale="Context-only: timing alone cannot establish item affinity.",
    ),
    DispositionEntry(
        feature_id="scheduled_event_tags",
        category="History",
        subcategory="Schedule",
        feature_name="Scheduled event tags",
        disposition=_CONTEXT,
        feature_origin=_BASELINE,
        source_reference="spec §9; content-algo §5.3 Table 3 (not scored); design §6.2",
        rationale="Context-only: no song event tags in V1.",
    ),
    DispositionEntry(
        feature_id="content_proposal_acceptance_rate",
        category="History",
        subcategory="Proposal result",
        feature_name="Content proposal acceptance rate",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: content_proposal_acceptance_rate[track_id] → 2·rate/100−1; id exact match.",
    ),
    DispositionEntry(
        feature_id="content_recovery_rate",
        category="History",
        subcategory="Recovery result",
        feature_name="Content recovery rate",
        disposition=_SCORED,
        feature_origin=_BASELINE,
        response_provenance=_EXPLICIT,
        source_reference="spec §9; content-algo §5.3 Table 3 (scored)",
        rationale="Scored: content_recovery_rate[track_id] → 2·rate/100−1; id exact match.",
    ),
    # -----------------------------------------------------------------------
    # Additional proposed (§9 rows 39–49) — simulator proposals, out of scope
    # for baseline-only V1 scoring; carried as visible context.
    # -----------------------------------------------------------------------
    DispositionEntry(
        feature_id="estimated_min_until_rest_spot",
        category="Additional proposed",
        subcategory="Rest-route feasibility",
        feature_name="Minutes until rest spot",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed rest-route feasibility field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="rest_spot_type",
        category="Additional proposed",
        subcategory="Rest-route feasibility",
        feature_name="Rest spot type",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed field; adapts context but not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="active_service",
        category="Additional proposed",
        subcategory="Current proposal session",
        feature_name="Active service",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed session field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="recent_service_rejections",
        category="Additional proposed",
        subcategory="Current proposal session",
        feature_name="Recent service rejections",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed session field; service-level, not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="service_proposal_acceptance_confidence",
        category="Additional proposed",
        subcategory="Evidence reliability",
        feature_name="Service acceptance confidence",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed reliability field; service-level, not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="service_recovery_confidence",
        category="Additional proposed",
        subcategory="Evidence reliability",
        feature_name="Service recovery confidence",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed reliability field; service-level, not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="completed_items",
        category="Additional proposed",
        subcategory="Granular operations",
        feature_name="Completed items",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed granular-ops field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="manually_selected_items",
        category="Additional proposed",
        subcategory="Granular operations",
        feature_name="Manually selected items",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed granular-ops field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="repeated_items",
        category="Additional proposed",
        subcategory="Granular operations",
        feature_name="Repeated items",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed granular-ops field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="content_proposal_acceptance_confidence",
        category="Additional proposed",
        subcategory="Evidence reliability",
        feature_name="Content acceptance confidence",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed reliability field; not scored in baseline V1.",
    ),
    DispositionEntry(
        feature_id="content_recovery_confidence",
        category="Additional proposed",
        subcategory="Evidence reliability",
        feature_name="Content recovery confidence",
        disposition=_CONTEXT,
        feature_origin=_PROPOSED,
        source_reference="spec §9 (Simulator proposal); content-algo §5.3 (baseline-only V1 out of scope)",
        rationale="Context-only: simulator-proposed reliability field; not scored in baseline V1.",
    ),
]
