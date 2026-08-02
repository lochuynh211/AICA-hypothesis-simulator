/**
 * Eligibility resolver — port of `services/proposal_eligibility.py`
 * (`resolve_eligibility`, `derive_registered_entities`).
 *
 * `resolveEligibility` narrows an opportunity's allowed-services row to an
 * eligible/excluded split BEFORE any selector package ranks candidates
 * (research.md D1). PURE — no IO, no clock, no randomness. The caller owns
 * loading `ServiceCapabilities` and deriving `registeredEntities`/
 * `unavailableServiceIds` from run state.
 *
 * ISOLATION (mirrors the Python module's own isolation note): this module
 * defines its own small `ServiceId`/`MotionState`/`EligibilityReasonCode`
 * literal types rather than importing a trigger-side type — the proposal
 * domain's enums are a separate, isolated vocabulary in Python
 * (`aica_api.models.proposal.enums`), and this port keeps that isolation.
 */

export type ServiceId =
  | 'music_playlist'
  | 'humming_karaoke'
  | 'call_response_driving'
  | 'quiz'
  | 'ranking_creation'
  | 'radio_style'
  | 'conversation_audio'
  | 'live_viewing'
  | 'stretch_video'
  | 'full_karaoke'
  | 'call_response_stopped'
  | 'oshi_reexperience'
  | 'relaxation_multisensory'
  | 'linked_video_recommendation'

export type MotionState = 'driving' | 'stopped'

export type EligibilityReasonCode =
  | 'screen_dependent_while_driving'
  | 'stopped_only_while_driving'
  | 'full_karaoke_requires_stopped'
  | 'missing_required_entity'
  | 'catalog_item_unavailable'
  | 'not_in_allowed_row'

export type ServiceCapabilityDoc = {
  service_id: ServiceId
  driving_capable: boolean
  screen_dependent: boolean
  stopped_only: boolean
  background_on_motion: boolean
  lighting_compatible: boolean | 'recipe'
  requires_entity: string | null
}

export type ServiceCapabilitiesDoc = {
  capabilities_version: string
  services: ServiceCapabilityDoc[]
}

export type EligibilityExclusion = { service_id: ServiceId; reason_codes: EligibilityReasonCode[] }
export type EligibilityResult = { eligible: ServiceId[]; excluded: EligibilityExclusion[] }

/** A `ServiceCapabilities.get(service_id)`-equivalent lookup. */
export type ServiceCapabilities = { get(serviceId: ServiceId): ServiceCapabilityDoc }

/**
 * Build a `ServiceCapabilities`-equivalent lookup from the raw committed
 * `service_capabilities.v1.json` shape (an ARRAY of per-service capability
 * facts) — mirrors `ServiceCapabilities.load()`'s array-to-dict conversion
 * (`{entry["service_id"]: ServiceCapability(**entry) for entry in
 * data["services"]}`), done once so `.get()` is an O(1) map lookup exactly
 * like the Python dict it mirrors.
 */
export function buildServiceCapabilities(doc: ServiceCapabilitiesDoc): ServiceCapabilities {
  const byId = new Map<ServiceId, ServiceCapabilityDoc>()
  for (const entry of doc.services) byId.set(entry.service_id, entry)
  return {
    get(serviceId: ServiceId): ServiceCapabilityDoc {
      const found = byId.get(serviceId)
      if (!found) throw new Error(`unknown service_id in capabilities: ${serviceId}`)
      return found
    },
  }
}

/**
 * Split `allowedServiceIds` into eligible / excluded-with-reasons.
 *
 * Rules (research.md D2/D5), evaluated in this fixed, deterministic order
 * per service (motion reason, then entity readiness, then catalog
 * availability) so multi-reason exclusions always list their codes in the
 * same order:
 *
 * 1. `motionState === 'driving'`:
 *    - `full_karaoke` -> `full_karaoke_requires_stopped` (special-cased
 *      ahead of the generic stopped-only rule).
 *    - else if `capability.stopped_only` -> `stopped_only_while_driving`.
 *    - else if `capability.screen_dependent` and not
 *      `capability.background_on_motion` -> `screen_dependent_while_driving`.
 *    - A `background_on_motion` screen-dependent service (`live_viewing`)
 *      is NEVER excluded for motion alone.
 * 2. `capability.requires_entity` set and not in `registeredEntities` ->
 *    `missing_required_entity`. A service may collect BOTH a motion reason
 *    and this one — one `EligibilityExclusion` with multiple `reason_codes`,
 *    never two separate exclusion records.
 * 3. `unavailableServiceIds.has(serviceId)` -> `catalog_item_unavailable`.
 * 4. No reason codes collected -> eligible.
 *
 * No score/fit/weight/utility is ever attached to an exclusion (FR-003/
 * FR-004) — `EligibilityExclusion` structurally has no such field.
 * `eligible` preserves the input order of `allowedServiceIds`.
 */
export function resolveEligibility(
  allowedServiceIds: ServiceId[],
  motionState: MotionState,
  capabilities: ServiceCapabilities,
  options: { registeredEntities: Set<string>; unavailableServiceIds?: Set<string> },
): EligibilityResult {
  const unavailableServiceIds = options.unavailableServiceIds ?? new Set<string>()
  const eligible: ServiceId[] = []
  const excluded: EligibilityExclusion[] = []

  for (const serviceId of allowedServiceIds) {
    const capability = capabilities.get(serviceId)
    const reasonCodes: EligibilityReasonCode[] = []

    // 1. Motion reason.
    if (motionState === 'driving') {
      if (serviceId === 'full_karaoke') {
        reasonCodes.push('full_karaoke_requires_stopped')
      } else if (capability.stopped_only) {
        reasonCodes.push('stopped_only_while_driving')
      } else if (capability.screen_dependent && !capability.background_on_motion) {
        reasonCodes.push('screen_dependent_while_driving')
      }
    }

    // 2. Entity readiness.
    if (capability.requires_entity && !options.registeredEntities.has(capability.requires_entity)) {
      reasonCodes.push('missing_required_entity')
    }

    // 3. Catalog availability.
    if (unavailableServiceIds.has(serviceId)) {
      reasonCodes.push('catalog_item_unavailable')
    }

    if (reasonCodes.length > 0) {
      excluded.push({ service_id: serviceId, reason_codes: reasonCodes })
    } else {
      eligible.push(serviceId)
    }
  }

  return { eligible, excluded }
}

/**
 * Derive the `registeredEntities` set from a run's world data (T017).
 *
 * Covers both back-compat shapes (research.md D8):
 *
 * - Typed-world path: `World.project()` places `oshi_registered` under
 *   `feature_snapshot.preference.oshi_registered` (the "Preference"
 *   disposition group).
 * - Legacy opaque `world_snapshot` path: callers may set a flat
 *   `feature_snapshot.oshi_registered` key directly.
 *
 * A missing/empty `feature_snapshot` (or `world_snapshot` itself) never
 * throws — it simply yields an empty set. Mirrors Python's `dict.get(...)`
 * returning `None` for BOTH a missing key and an explicit JSON `null` — so
 * an explicit `oshi_registered: false` at the flat/legacy level short-
 * circuits (never falls through to the `preference` lookup), while a
 * missing/`null` key does fall through.
 */
export function deriveRegisteredEntities(worldSnapshot: Record<string, unknown> | null | undefined): Set<string> {
  const rawFeatureSnapshot = worldSnapshot?.feature_snapshot
  const featureSnapshot: Record<string, unknown> =
    rawFeatureSnapshot && typeof rawFeatureSnapshot === 'object' && !Array.isArray(rawFeatureSnapshot)
      ? (rawFeatureSnapshot as Record<string, unknown>)
      : {}

  let oshiRegistered = featureSnapshot.oshi_registered
  if (oshiRegistered === undefined || oshiRegistered === null) {
    const preference = featureSnapshot.preference
    if (preference && typeof preference === 'object' && !Array.isArray(preference)) {
      oshiRegistered = (preference as Record<string, unknown>).oshi_registered
    }
  }

  return oshiRegistered ? new Set(['oshi']) : new Set()
}
