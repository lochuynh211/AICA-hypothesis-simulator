/**
 * Route analysis service — derive RouteFacts from a ScenarioDef or Google Maps data.
 *
 * Ported from `app/api/aica_api/services/route_analysis.py` (behavior-of-record).
 *
 * Two entry points, both pure, deterministic, side-effect-free:
 *
 *   analyzeRoute(scenario)  — LOCAL path (T012)
 *       Converts the qualitative scenario structure (route_intent.segments with
 *       at-fractions, type labels, speed_band) into M2 RouteFacts.
 *
 *   analyzeRouteMaps(rawRoutes, placesByRoute, startLabel, endLabel)  — MAPS path
 *   (T004/U3)
 *       Normalises already-fetched Google Directions + Places data into
 *       RouteFacts + DisplayRoute per alternative. Does NOT call maps_client
 *       or the network. NOTE: the Python function returns a plain
 *       `list[RouteAlternative]` (route_id/summary/route_facts/display dicts) —
 *       NOT a `RouteEnvelope` (that {route_source, alternatives} wrapper is
 *       built one layer up, by the API router, which is out of scope here).
 *       This port mirrors the Python return shape exactly; see
 *       `RouteAlternativeRaw` below. Parity-tested by a later task (S7.3).
 *
 * Segment type mapping for the LOCAL path
 *   (M1 RouteSegment.type -> M2 segment_type vocabulary):
 *   highway               -> highway
 *   start / urban / national / residential / rest / end -> normal_road
 *   (mountain / sightseeing not in M1 Literal; reserved for future scenarios)
 *
 * Segment type mapping for the MAPS path (V1 classification):
 *   HIGHWAY               -> highway
 *   LOCAL                 -> normal_road
 *   anything else         -> normal_road  (mountain/sightseeing have no reliable
 *                                          Google signal in V1)
 *
 * Total route distance for the LOCAL path is taken from
 * scenario.presets["total_route_distance_km"] when present; otherwise estimated
 * as: total_km = (total_duration_seconds / 3600) * default_speed_kph
 * where default_speed_kph = 60.
 *
 * Only the exported function identifiers (analyzeRoute, analyzeRouteMaps) are
 * camelCased. All object keys and every segment-type/band string value are
 * preserved byte-for-byte from the Python (snake_case) because they cross the
 * parity boundary. `analyzeRoute` does NOT call `../binning` — the Python
 * `analyze_route` returns `bands={}` (bands are filled later by
 * `run_plan.ts`'s `buildDraft` from `package.features`, mirroring
 * `app/api/aica_api/services/run_plan.py`'s `_build_draft`), so there is no
 * raw-to-band conversion in this module. The two-layer numeric boundary is
 * still preserved end-to-end: this module never hands a raw quantity to
 * decision logic — it only produces RouteFacts, which are banded downstream.
 */

import type { RouteFacts, RouteSegment, RouteSegmentFact } from '../../api/types'
import type { ScenarioDefM2 } from '../event_plan'

// ---------------------------------------------------------------------------
// Public types (mirror aica_api.models.run — genuinely absent from api/types.ts)
// ---------------------------------------------------------------------------

/**
 * NamedRestSpot (M8) — mirrors aica_api.models.run.NamedRestSpot, which is
 * absent from the synced `../../api/types.ts`.
 */
export type NamedRestSpot = {
  name: string
  position_km: number
  lat: number | null
  lng: number | null
  synthetic: boolean
}

/**
 * Full RouteFacts shape returned by analyzeRoute — extends the synced
 * `../../api/types.ts` RouteFacts (which lags the Python model: it is
 * missing `route_source` and `named_rest_spots`, both M4/M8 additions) with
 * those two fields declared locally. `types.ts` itself is never edited.
 */
export type RouteFactsFull = RouteFacts & {
  route_source: 'maps' | 'local'
  named_rest_spots: NamedRestSpot[]
}

/** DisplayRoute (mirrors aica_api.models.run.DisplayRoute; not in api/types.ts). */
export type DisplayRoute = {
  summary: string
  encoded_polyline: string
  start_label: string
  end_label: string
}

/**
 * The actual return element shape of Python's `analyze_route_maps` — a plain
 * dict `{route_id, summary, route_facts, display}`. Deliberately NOT the
 * synced `RouteAlternative` type (which also carries a `notices` field that
 * `analyze_route_maps` never populates; notices are added by the API router,
 * out of scope here).
 */
export type RouteAlternativeRaw = {
  route_id: string
  summary: string
  route_facts: RouteFactsFull
  display: DisplayRoute
}

/** SpeedProfile (mirrors aica_api.models.profile.SpeedProfile; not in api/types.ts). */
export type SpeedProfileM2 = {
  normal_road_kph: number
  highway_kph: number
  mountain_road_kph: number
  sightseeing_road_kph: number
  traffic_jam_kph: number
}

/** A raw Google Directions route (plain dict, mirrors maps_client's RawRoute). */
export type RawRoute = {
  route_id: string
  distance_m: number
  duration_s: number
  segments?: RawSegment[]
  summary?: string
  encoded_polyline?: string
}

/** A raw Directions step (mirrors maps_client's per-step segment dict). */
export type RawSegment = {
  road_class: string
  distance_m: number
}

/** A raw Google Places result (plain dict, mirrors maps_client's RawPlace). */
export type RawPlace = {
  distance_along_route_m: number
  name: string
  location: { lat: number; lng: number }
  synthetic?: boolean
}

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Default speed used to estimate total route distance when not specified in presets. */
const DEFAULT_SPEED_KPH = 60.0

/** Mapping from M1 RouteSegment.type to M2 segment_type vocabulary. */
const SEGMENT_TYPE_MAP: Record<string, RouteSegmentFact['segment_type']> = {
  start: 'normal_road',
  urban: 'normal_road',
  national: 'normal_road',
  residential: 'normal_road',
  rest: 'normal_road',
  end: 'normal_road',
  highway: 'highway',
  mountain: 'mountain_road',
  sightseeing: 'sightseeing_road',
}

/** Maximum alternatives to return (maps_client already caps; enforce here too). */
const MAX_ALTERNATIVES = 3

/**
 * V1 road-class mapping: Google step road_class -> simulator segment_type.
 * mountain_road / sightseeing_road have no reliable Google signal in V1 ->
 * default to normal_road for anything not explicitly HIGHWAY.
 */
const ROAD_CLASS_MAP: Record<string, RouteSegmentFact['segment_type']> = {
  HIGHWAY: 'highway',
  LOCAL: 'normal_road',
}

// ---------------------------------------------------------------------------
// Public API — LOCAL path
// ---------------------------------------------------------------------------

/**
 * Derive physical route facts from a ScenarioDef.
 *
 * Returns RouteFacts with M2 physical fields populated and M1 backward-compat
 * fields (segments, bands) also set.
 */
export function analyzeRoute(scenario: ScenarioDefM2): RouteFactsFull {
  // ── Total route distance ──────────────────────────────────────────────
  const presets = scenario.presets ?? {}
  const totalKm: number =
    'total_route_distance_km' in presets && presets['total_route_distance_km'] != null
      ? Number(presets['total_route_distance_km'])
      : (scenario.total_duration_seconds / 3600.0) * DEFAULT_SPEED_KPH

  // ── Route segments ──────────────────────────────────────────────────────
  const segments: RouteSegment[] = scenario.route_intent.segments
  const routeSegments: RouteSegmentFact[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    // The segment starts at seg.at and ends at the next segment's at (or 1.0).
    const nextAt = i + 1 < segments.length ? segments[i + 1].at : 1.0
    const fraction = nextAt - seg.at
    const lengthKm = fraction * totalKm
    const startKm = seg.at * totalKm
    const segType = SEGMENT_TYPE_MAP[seg.type] ?? 'normal_road'

    // Skip zero-length terminal segments (e.g., an end segment at 1.0 that
    // has no following segment; length_km would be 0.0).
    if (lengthKm > 0) {
      routeSegments.push({ segment_type: segType, start_km: startKm, length_km: lengthKm })
    }
  }

  // ── Rest spot positions (km from start) ─────────────────────────────────
  const restSpotPositions: number[] = segments.filter((seg) => seg.is_rest_facility).map((seg) => seg.at * totalKm)

  // ── Named rest spots (M8) — same segments, but with human name ─────────
  // Uses the segment's EN name; falls back to the route_intent.rest_facility
  // label (EN) if the segment name is blank. lat/lng not available on the
  // local path.
  //
  // NOTE: `../../api/types.ts`'s `RouteIntent.rest_facility` is mistyped as
  // `{ label: string }` (it lags the Python model, where `RestFacilityRef.label`
  // is a `dict[str, str]` — the same `{ja, en}` shape used everywhere else for
  // labels, confirmed by the bundled scenario JSON). Read via a loose cast
  // rather than editing types.ts.
  const rfLabel = scenario.route_intent.rest_facility.label as unknown as Record<string, string>
  const rfLabelEn: string = rfLabel['en'] ?? 'Rest Stop'
  const namedRestSpots: NamedRestSpot[] = segments
    .filter((seg) => seg.is_rest_facility)
    .map((seg) => ({
      name: seg.name['en'] || rfLabelEn,
      position_km: seg.at * totalKm,
      lat: null,
      lng: null,
      synthetic: false,
    }))

  // ── Route progress checkpoints (25%, 50%, 75% of total km) ────────────
  const routeProgressCheckpoints: number[] = [0.25 * totalKm, 0.5 * totalKm, 0.75 * totalKm]

  // ── Estimated route duration ────────────────────────────────────────────
  // Derived from speed profile if available, else from total_duration_seconds.
  const speedProfile = scenario.speed_profile as unknown as SpeedProfileM2 | null | undefined
  const estimatedMin: number =
    speedProfile != null
      ? estimateDurationMin(routeSegments, speedProfile)
      : scenario.total_duration_seconds / 60.0

  return {
    // M1 backward-compat fields
    segments,
    bands: {}, // Populated by run_plan.ts's buildDraft from package.features

    // M2 physical fields
    total_route_distance_km: totalKm,
    estimated_route_duration_min: estimatedMin,
    route_segments: routeSegments,
    rest_spot_positions: restSpotPositions,
    route_progress_checkpoints: routeProgressCheckpoints,

    // M4: route provenance
    route_source: 'local',

    // M8: named rest facilities (local path — lat/lng not available)
    named_rest_spots: namedRestSpots,
  }
}

// ---------------------------------------------------------------------------
// Public API — MAPS normalizer (T004 / U3)
// ---------------------------------------------------------------------------

/**
 * Normalise already-fetched Google data into simulator route facts.
 *
 * Pure, deterministic — does NOT call maps_client or the network.
 *
 * @param rawRoutes       Up to 3 RawRoute dicts from maps_client.directions().
 * @param placesByRoute   RawPlace lists keyed by route_id; missing keys are
 *                        treated as an empty list (no fabrication).
 * @param startLabel      Human-readable origin label for DisplayRoute.
 * @param endLabel        Human-readable destination label for DisplayRoute.
 * @returns list of RouteAlternativeRaw — one per raw route, capped at 3.
 */
export function analyzeRouteMaps(
  rawRoutes: RawRoute[],
  placesByRoute: Record<string, RawPlace[]>,
  startLabel: string,
  endLabel: string,
): RouteAlternativeRaw[] {
  const alternatives: RouteAlternativeRaw[] = []

  for (const raw of rawRoutes.slice(0, MAX_ALTERNATIVES)) {
    const routeId: string = raw.route_id
    const totalKm: number = raw.distance_m / 1000.0
    const durationMin: number = raw.duration_s / 60.0

    // ── Route segments — classify + merge consecutive same-type ───────────
    const routeSegments = buildRouteSegmentsMaps(raw.segments ?? [])

    // ── Rest spot positions (km) — sorted ascending, empty-safe ──────────
    const places: RawPlace[] = placesByRoute[routeId] ?? []
    // Sort places once by along-route distance to keep both lists in sync.
    const placesSorted = [...places].sort((a, b) => a.distance_along_route_m - b.distance_along_route_m)
    const restSpotPositions: number[] = placesSorted.map((p) => p.distance_along_route_m / 1000.0)

    // ── Named rest spots (M8) — preserve facility names from Places ───────
    const namedRestSpots: NamedRestSpot[] = placesSorted.map((p) => ({
      name: p.name,
      position_km: p.distance_along_route_m / 1000.0,
      lat: p.location.lat,
      lng: p.location.lng,
      synthetic: p.synthetic ?? false,
    }))

    // ── Route progress checkpoints (25%, 50%, 75% of total km) ────────────
    const routeProgressCheckpoints: number[] = [0.25 * totalKm, 0.5 * totalKm, 0.75 * totalKm]

    const routeFacts: RouteFactsFull = {
      segments: [],
      bands: {},
      total_route_distance_km: totalKm,
      estimated_route_duration_min: durationMin,
      route_segments: routeSegments,
      rest_spot_positions: restSpotPositions,
      route_progress_checkpoints: routeProgressCheckpoints,
      route_source: 'maps',
      named_rest_spots: namedRestSpots,
    }

    const display: DisplayRoute = {
      summary: raw.summary ?? '',
      encoded_polyline: raw.encoded_polyline ?? '',
      start_label: startLabel,
      end_label: endLabel,
    }

    alternatives.push({
      route_id: routeId,
      summary: raw.summary ?? '',
      route_facts: routeFacts,
      display,
    })
  }

  return alternatives
}

/**
 * Convert raw step dicts into RouteSegmentFact list, merging consecutive same-type.
 * Accumulates start_km as we walk; merges adjacent segments of identical type.
 *
 * Exported (feature 026, htmlapp Combined export, slice C4 Task 5) so
 * `../merged/run_setup.ts#loadRoutePreset` — a small unported helper mirroring
 * `routers/route_presets.py::load_route_preset` — can reuse this EXACT
 * classify+merge logic (`_build_route_segments_maps` in Python is a shared
 * import both `services/route_analysis.py` and `routers/route_presets.py`
 * call) instead of duplicating it. No behavior change — purely a visibility
 * widening.
 */
export function buildRouteSegmentsMaps(rawSegments: RawSegment[]): RouteSegmentFact[] {
  if (rawSegments.length === 0) {
    return []
  }

  const result: RouteSegmentFact[] = []

  // Initialise with the first step
  const first = rawSegments[0]
  let currentType = ROAD_CLASS_MAP[first.road_class] ?? 'normal_road'
  let currentLengthKm = first.distance_m / 1000.0
  let currentStartKm = 0.0

  for (let i = 1; i < rawSegments.length; i++) {
    const step = rawSegments[i]
    const stepType = ROAD_CLASS_MAP[step.road_class] ?? 'normal_road'
    const stepLengthKm = step.distance_m / 1000.0

    if (stepType === currentType) {
      // Merge: extend the current segment
      currentLengthKm += stepLengthKm
    } else {
      // Emit the current segment and start a new one
      result.push({ segment_type: currentType, start_km: currentStartKm, length_km: currentLengthKm })
      currentStartKm += currentLengthKm
      currentType = stepType
      currentLengthKm = stepLengthKm
    }
  }

  // Emit the final (possibly only) segment
  result.push({ segment_type: currentType, start_km: currentStartKm, length_km: currentLengthKm })

  return result
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Estimate driving duration in minutes given segment km extents and speed profile. */
function estimateDurationMin(routeSegments: RouteSegmentFact[], speedProfile: SpeedProfileM2): number {
  const speedMap: Record<string, number> = {
    normal_road: speedProfile.normal_road_kph,
    highway: speedProfile.highway_kph,
    mountain_road: speedProfile.mountain_road_kph,
    sightseeing_road: speedProfile.sightseeing_road_kph,
  }
  let totalMinutes = 0.0
  for (const seg of routeSegments) {
    const kph = speedMap[seg.segment_type] ?? speedProfile.normal_road_kph
    if (kph > 0) {
      totalMinutes += (seg.length_km / kph) * 60.0
    }
  }
  return totalMinutes
}
