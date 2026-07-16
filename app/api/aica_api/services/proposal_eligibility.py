"""Eligibility resolver (US1, P4) — narrows an opportunity's allowed-services
row to an eligible/excluded split BEFORE any selector package ranks
candidates.

Authoritative design: research.md D1 (orchestrator narrows before the
selector), D2 (capability mapping), D3 (reason-code vocabulary), D8
(legacy world_snapshot back-compat); data-model.md
"EligibilityExclusion / EligibilityResult".

``resolve_eligibility`` is PURE — no IO, no clock, no randomness. The
router (``routers/proposal.py``) owns loading ``ServiceCapabilities`` and
deriving ``registered_entities``/``unavailable_service_ids`` from run state,
then calls this function and persists the result.

ISOLATION: no imports from ``aica_api.models`` (the trigger package) or
``aica_api.algorithms`` — enums are imported from ``.enums`` only, mirroring
every other ``models/proposal`` / ``services`` module that touches the P1+
proposal-simulator contract.
"""
from __future__ import annotations

from aica_api.models.proposal.eligibility import EligibilityExclusion, EligibilityResult
from aica_api.models.proposal.enums import EligibilityReasonCode, MotionState, ServiceId
from aica_api.models.proposal.service_capabilities import ServiceCapabilities

__all__ = ["resolve_eligibility", "derive_registered_entities"]


def resolve_eligibility(
    allowed_service_ids: list[ServiceId],
    motion_state: MotionState,
    capabilities: ServiceCapabilities,
    *,
    registered_entities: set[str],
    unavailable_service_ids: set[str] = frozenset(),
) -> EligibilityResult:
    """Split ``allowed_service_ids`` into eligible / excluded-with-reasons.

    Rules (research.md D2/D5), evaluated in this fixed, deterministic order
    per service (motion reason, then entity readiness, then catalog
    availability) so multi-reason exclusions always list their codes in the
    same order:

    1. ``motion_state == driving``:
       - ``full_karaoke`` -> ``full_karaoke_requires_stopped`` (special-cased
         ahead of the generic stopped-only rule).
       - elif ``capability.stopped_only`` -> ``stopped_only_while_driving``.
       - elif ``capability.screen_dependent`` and not
         ``capability.background_on_motion`` -> ``screen_dependent_while_driving``.
       - A ``background_on_motion`` screen-dependent service (``live_viewing``)
         is NEVER excluded for motion alone.
    2. ``capability.requires_entity`` set and not in ``registered_entities``
       -> ``missing_required_entity``. A service may collect BOTH a motion
       reason and this one — one ``EligibilityExclusion`` with multiple
       ``reason_codes``, never two separate exclusion records.
    3. ``service_id.value in unavailable_service_ids`` ->
       ``catalog_item_unavailable``.
    4. No reason codes collected -> eligible.

    No score/fit/weight/utility is ever attached to an exclusion (FR-003/
    FR-004) — ``EligibilityExclusion`` structurally has no such field.
    ``eligible`` preserves the input order of ``allowed_service_ids``.
    """
    eligible: list[ServiceId] = []
    excluded: list[EligibilityExclusion] = []

    for service_id in allowed_service_ids:
        capability = capabilities.get(service_id)
        reason_codes: list[EligibilityReasonCode] = []

        # 1. Motion reason.
        if motion_state == MotionState.driving:
            if service_id == ServiceId.full_karaoke:
                reason_codes.append(EligibilityReasonCode.full_karaoke_requires_stopped)
            elif capability.stopped_only:
                reason_codes.append(EligibilityReasonCode.stopped_only_while_driving)
            elif capability.screen_dependent and not capability.background_on_motion:
                reason_codes.append(EligibilityReasonCode.screen_dependent_while_driving)

        # 2. Entity readiness.
        if capability.requires_entity and capability.requires_entity not in registered_entities:
            reason_codes.append(EligibilityReasonCode.missing_required_entity)

        # 3. Catalog availability.
        if service_id.value in unavailable_service_ids:
            reason_codes.append(EligibilityReasonCode.catalog_item_unavailable)

        if reason_codes:
            excluded.append(EligibilityExclusion(service_id=service_id, reason_codes=reason_codes))
        else:
            eligible.append(service_id)

    return EligibilityResult(eligible=eligible, excluded=excluded)


def derive_registered_entities(world_snapshot: dict | None) -> set[str]:
    """Derive the ``registered_entities`` set from a run's world data (T017).

    Covers both back-compat shapes (research.md D8):

    - Typed-world path: ``World.project()`` places ``oshi_registered`` under
      ``feature_snapshot["preference"]["oshi_registered"]`` (the "Preference"
      disposition group — see ``models/proposal/dispositions.py``).
    - Legacy opaque ``world_snapshot`` path: callers may set a flat
      ``feature_snapshot["oshi_registered"]`` key directly (no "preference"
      grouping exists on an arbitrary caller-supplied dict).

    A missing/empty ``feature_snapshot`` (or ``world_snapshot`` itself) never
    raises — it simply yields an empty set, so entity-dependent services are
    excluded via ``missing_required_entity`` rather than crashing.
    """
    feature_snapshot = (world_snapshot or {}).get("feature_snapshot") or {}

    oshi_registered = feature_snapshot.get("oshi_registered")
    if oshi_registered is None:
        preference = feature_snapshot.get("preference")
        if isinstance(preference, dict):
            oshi_registered = preference.get("oshi_registered")

    return {"oshi"} if oshi_registered else set()
