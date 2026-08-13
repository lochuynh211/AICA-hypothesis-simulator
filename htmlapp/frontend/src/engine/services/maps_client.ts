/// <reference types="google.maps" />
/**
 * maps_client — direct Google Maps JavaScript API (browser SDK) Directions +
 * Places edge module (S7.3).
 *
 * Ported (as a REWRITE, not a line port) from
 * `app/api/aica_api/services/maps_client.py` (596 LoC, backend-proxied
 * urllib). The offline app has no backend, so instead of building signed
 * REST URLs and fetching them with urllib, this module loads the Google
 * Maps JS API directly in the browser (`google.maps.DirectionsService` /
 * `google.maps.places.PlacesService`) using the runtime BYO key, and
 * normalizes the SDK's callback-based results into the SAME plain-dict
 * `RawRoute[]` / `RawPlace[]` contracts `route_analysis.ts`'s
 * `analyzeRouteMaps` already consumes (ported in S7.2).
 *
 * Preserved from the Python module:
 *   - The `MapsError` contract (`error_type` + `message`, both KEY-FREE —
 *     see `../../api/types`'s `MapsError`/`MapsErrorBody`).
 *   - The two-layer numeric boundary: this module only ever returns
 *     RawRoute/RawPlace plain-value dicts; ordinal binning happens strictly
 *     downstream (route_analysis.ts / binning.ts), never here.
 *   - The road-class inference heuristic (maneuver keyword / instruction
 *     keyword / long-step fallback) and the Places sample-point + dedupe +
 *     project-onto-route algorithm, translated 1:1 from the Python.
 *
 * KEY SAFETY (master invariant): `key` is a parameter only, on every
 * exported function. It is embedded in the injected `<script src>` URL
 * (unavoidable — that's how the browser JS API authenticates; the key is
 * already runtime-visible to the page, same as the docker app's BYO-key
 * model), but it is NEVER logged via console.*, NEVER stored on this
 * module, and NEVER echoed into a `MapsError` or any other thrown/returned
 * object. Every error path below builds its message from a fixed string or
 * the SDK's status enum value only.
 *
 * fixbug-0806 ("honest road-class rest-facility search"): ported from
 * `app/api/aica_api/services/maps_client.py` commit a94b89a. The Python
 * module moved to Places v1 (POST/JSON, separate Text/Nearby endpoints); the
 * browser SDK has no such distinction to migrate — `PlacesService.textSearch`
 * / `.nearbySearch` already existed here. What DID change, and is ported
 * below:
 *   - `PLACES_RADIUS_M` 25km -> 5km (a large radius let searches leak
 *     facilities many km perpendicular from the route).
 *   - Highway sample points now run TWO Text Searches (サービスエリア /
 *     パーキングエリア) instead of one keyword Nearby Search; local/urban
 *     points run one Text Search (道の駅) plus one Nearby Search
 *     (convenience_store only — gas_station is no longer searched at all).
 *   - Per-run midpoint sampling: when `context.segments` is supplied, every
 *     contiguous road_class run gets its own sample point(s) instead of a
 *     purely evenly-spaced whole-route split, so a short LOCAL stretch
 *     flanked by HIGHWAY isn't skipped.
 *   - 道の駅 leak exclusion: a leaked roadside-station result sourced from a
 *     highway-classified point is dropped (道の駅 have no expressway ramp).
 *   - Road-class-match projection + a 2km off-route cap: a place is only
 *     projected onto (and kept reachable from) a route vertex of ITS OWN
 *     road class, and dropped outright if that projection exceeds the cap —
 *     fixes a convenience store near, but not on, the highway being offered
 *     as a highway rest stop.
 *   - Carriageway (up/down) direction filter for highway-sourced SA/PA
 *     results — Japanese expressway rest facilities are direction-specific
 *     and unreachable from the opposite carriageway.
 */

import { MapsError } from '../../api/types'
import type { RawRoute, RawSegment, RawPlace } from './route_analysis'

// ---------------------------------------------------------------------------
// Constants (mirror maps_client.py's module-level constants)
// ---------------------------------------------------------------------------

const MAX_ALTERNATIVES = 3
const PLACES_SAMPLE_POINTS = 6
// fixbug-0806: 25km -> 5km — paired with PLACES_OFFROUTE_MAX_M below so a
// soft locationBias search can no longer surface (and silently project
// onto the route) a facility many km perpendicular from it.
const PLACES_RADIUS_M = 5_000
const HIGHWAY_MIN_STEP_M = 8_000
const HIGHWAY_INSTRUCTION_KEYWORDS = [
  'highway',
  'motorway',
  'freeway',
  'expressway',
  'expwy',
  'interstate',
  'toll',
] as const

// Japanese-language search terms (mirrors maps_client.py's _HIGHWAY_TEXT_QUERIES
// / _LOCAL_TEXT_QUERIES / _LOCAL_NEARBY_TYPES). Highway routes search Text
// Search only; local/urban routes search Text Search (道の駅) plus Nearby
// Search (convenience_store only — gas_station is not a rest facility and is
// never searched, fixbug-0806).
const HIGHWAY_TEXT_QUERIES = ['サービスエリア', 'パーキングエリア'] as const
const LOCAL_TEXT_QUERIES = ['道の駅'] as const
const LOCAL_NEARBY_TYPES = ['convenience_store'] as const

// Sample spacing (metres) for per-run midpoint sampling — mirrors
// maps_client.py's _PLACES_SAMPLE_STEP_M.
const PLACES_SAMPLE_STEP_M = 8_000
// Runaway backstop only (mirrors _PLACES_MAX_SAMPLE_POINTS) — not meant to
// bind for any real preset route.
const PLACES_MAX_SAMPLE_POINTS = 80
// Two sample points closer than this (metres) collapse to one (mirrors
// _PLACES_DEDUP_RADIUS_M).
const PLACES_DEDUP_RADIUS_M = 1_500
// A place farther than this (metres) from its nearest matching-class route
// vertex is dropped as unreachable (mirrors _PLACES_OFFROUTE_MAX_M).
const PLACES_OFFROUTE_MAX_M = 2_000

// Carriageway (up/down) direction filter constants — mirror
// _DIRECTION_SIDE_MAX_DIST_M / _DIRECTION_VOTE_MIN_SIDE_M.
const DIRECTION_SIDE_MAX_DIST_M = 5_000.0
const DIRECTION_VOTE_MIN_SIDE_M = 3.0
const EARTH_RADIUS_M = 6_371_000.0

// ---------------------------------------------------------------------------
// SDK loader — idempotent dynamic <script> inject
// ---------------------------------------------------------------------------

let _sdkPromise: Promise<typeof google.maps> | null = null

/** Reset the cached SDK-load promise. Test-only (isolates test cases). */
export function _resetMapsSdkForTests(): void {
  _sdkPromise = null
}

/**
 * Load the Google Maps JS API (idempotent — injects the `<script>` tag at
 * most once per page load) and resolve with the `google.maps` namespace.
 *
 * This is the ONLY function in the offline app permitted to reach the
 * network unconditionally when called — every caller here only calls it
 * when a key has been explicitly supplied by the reviewer (never on the
 * local path).
 */
export function loadMapsSdk(key: string): Promise<typeof google.maps> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new MapsError({
        error_type: 'directions_failure',
        message: 'Google Maps JS API is only available in a browser context',
        suggestion: 'Run the offline app in a browser, or use the local route fallback.',
      }),
    )
  }

  const w = window as unknown as { google?: typeof google }
  if (w.google?.maps) return Promise.resolve(w.google.maps)
  if (_sdkPromise) return _sdkPromise

  _sdkPromise = new Promise((resolve, reject) => {
    const callbackName = `__aicaMapsSdkReady_${Math.random().toString(36).slice(2)}`
    ;(window as unknown as Record<string, () => void>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName]
      const g = (window as unknown as { google?: typeof google }).google
      if (g?.maps) {
        resolve(g.maps)
      } else {
        _sdkPromise = null
        reject(
          new MapsError({
            error_type: 'directions_failure',
            message: 'Google Maps JS API failed to initialize',
            suggestion: 'Check your API key and network connection, or use the local route fallback.',
          }),
        )
      }
    }

    const script = document.createElement('script')
    script.async = true
    script.defer = true
    // The key is embedded in this URL only — never logged, never stored
    // beyond the browser's own request, never echoed in any error below.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${callbackName}`
    script.onerror = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName]
      _sdkPromise = null
      reject(
        new MapsError({
          error_type: 'directions_failure',
          message: 'Failed to load the Google Maps JS API script',
          suggestion: 'Check your network connection, or use the local route fallback.',
        }),
      )
    }
    document.head.appendChild(script)
  })

  return _sdkPromise
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

/** Map a google.maps.DirectionsStatus (or any string) to a key-free MapsError. */
function directionsStatusToError(status: string): MapsError {
  switch (status) {
    case 'REQUEST_DENIED':
      return new MapsError({
        error_type: 'invalid_key',
        message: 'API key was rejected (REQUEST_DENIED)',
        suggestion: 'Check your API key.',
      })
    case 'OVER_QUERY_LIMIT':
      return new MapsError({
        error_type: 'quota',
        message: `Quota exceeded (${status})`,
        suggestion: 'Try again later.',
      })
    case 'ZERO_RESULTS':
      return new MapsError({
        error_type: 'directions_failure',
        message: 'No results found (ZERO_RESULTS)',
        suggestion: 'Check the start/end addresses, or use the local route fallback.',
      })
    default:
      return new MapsError({
        error_type: 'directions_failure',
        message: `Directions request failed (${status})`,
        suggestion: 'Check your network connection, or use the local route fallback.',
      })
  }
}

/**
 * Infer a simplified road class from a raw google.maps.DirectionsStep.
 * Translated 1:1 from maps_client.py's `_infer_road_class`.
 */
function inferRoadClass(step: google.maps.DirectionsStep): 'HIGHWAY' | 'LOCAL' {
  const maneuver = (step.maneuver ?? '').toLowerCase()
  const instructions = (step.instructions ?? '').toLowerCase()
  const distanceM = step.distance?.value ?? 0

  if (
    maneuver.includes('merge') ||
    maneuver.includes('ramp') ||
    HIGHWAY_INSTRUCTION_KEYWORDS.some((kw) => instructions.includes(kw)) ||
    distanceM >= HIGHWAY_MIN_STEP_M
  ) {
    return 'HIGHWAY'
  }
  return 'LOCAL'
}

/**
 * Call the Google Maps JS API DirectionsService and return up to 3 RawRoute
 * alternatives. Throws MapsError (key-free) on any failure.
 */
export async function directions(key: string, start: string, end: string): Promise<RawRoute[]> {
  const maps = await loadMapsSdk(key)
  const service = new maps.DirectionsService()

  const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
    service.route(
      {
        origin: start,
        destination: end,
        travelMode: maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
      },
      (response, status) => {
        if (status !== maps.DirectionsStatus.OK || !response) {
          reject(directionsStatusToError(String(status)))
          return
        }
        resolve(response)
      },
    )
  })

  return result.routes.slice(0, MAX_ALTERNATIVES).map((route, i) => {
    const leg = route.legs[0]
    const segments: RawSegment[] = (leg?.steps ?? []).map((step) => ({
      road_class: inferRoadClass(step),
      distance_m: step.distance?.value ?? 0,
    }))
    return {
      route_id: `route-${i}`,
      summary: route.summary ?? '',
      distance_m: leg?.distance?.value ?? 0,
      duration_s: leg?.duration?.value ?? 0,
      encoded_polyline: route.overview_polyline ?? '',
      segments,
    }
  })
}

// ---------------------------------------------------------------------------
// Places — polyline decode + haversine projection (translated from
// maps_client.py's _decode_polyline / _haversine_m / _cumulative_distances /
// _distance_along_route; needed here because the JS SDK's PlacesService
// returns POIs, not along-route offsets — this module still has to project
// them itself, exactly like the Python module did.)
// ---------------------------------------------------------------------------

/** Decode a Google encoded polyline string to a list of [lat, lng] pairs. */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let b: number
    do {
      if (index >= encoded.length) throw new Error('Truncated encoded polyline')
      b = encoded.charCodeAt(index) - 63
      index += 1
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      if (index >= encoded.length) throw new Error('Truncated encoded polyline')
      b = encoded.charCodeAt(index) - 63
      index += 1
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push([lat / 1e5, lng / 1e5])
  }

  return points
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000.0
  const toRad = (d: number) => (d * Math.PI) / 180
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLam = toRad(lng2 - lng1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return 2.0 * R * Math.asin(Math.sqrt(a))
}

function cumulativeDistances(points: [number, number][]): number[] {
  const cum: number[] = [0.0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[cum.length - 1] + haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))
  }
  return cum
}

/** Index of the polyline vertex nearest (great-circle) to *poi*. Mirrors
 * maps_client.py's `_nearest_vertex_index` — shared by the legacy
 * (no-segment-data) projection fallback and the direction filter below. */
function nearestVertexIndex(poi: [number, number], routePoints: [number, number][]): number {
  let bestIdx = 0
  let bestD = haversineM(poi[0], poi[1], routePoints[0][0], routePoints[0][1])
  for (let i = 1; i < routePoints.length; i++) {
    const d = haversineM(poi[0], poi[1], routePoints[i][0], routePoints[i][1])
    if (d < bestD) {
      bestD = d
      bestIdx = i
    }
  }
  return bestIdx
}

/** Map a google.maps.places.PlacesServiceStatus to a key-free MapsError. */
function placesStatusToError(status: string): MapsError {
  switch (status) {
    case 'REQUEST_DENIED':
      return new MapsError({
        error_type: 'invalid_key',
        message: 'API key was rejected (REQUEST_DENIED)',
        suggestion: 'Check your API key.',
      })
    case 'OVER_QUERY_LIMIT':
      return new MapsError({
        error_type: 'quota',
        message: `Quota exceeded (${status})`,
        suggestion: 'Try again later.',
      })
    default:
      return new MapsError({
        error_type: 'places_failure',
        message: `Places request failed (${status})`,
        suggestion: 'Check your network connection.',
      })
  }
}

// ---------------------------------------------------------------------------
// Places — per-segment sampling (translated from maps_client.py's
// _segment_bounds / _road_class_at / _collapse_segment_runs /
// _run_midpoint_targets, fixbug-0806)
// ---------------------------------------------------------------------------

/** `[start_m, end_m, road_class]` cumulative-distance bounds, one per step. */
type SegBound = [start_m: number, end_m: number, roadClass: string]

function segmentBounds(segments: RawSegment[]): SegBound[] {
  const bounds: SegBound[] = []
  let cursor = 0.0
  for (const seg of segments) {
    const dist = seg.distance_m || 0
    const roadClass = seg.road_class || 'LOCAL'
    bounds.push([cursor, cursor + dist, roadClass])
    cursor += dist
  }
  return bounds
}

function roadClassAt(segTarget: number, segBounds: SegBound[]): string {
  for (const [startM, endM, roadClass] of segBounds) {
    if (startM <= segTarget && segTarget < endM) return roadClass
  }
  if (segBounds.length > 0) return segBounds[segBounds.length - 1][2]
  return 'LOCAL'
}

/** Merge adjacent `[start_m, end_m, road_class]` bounds into contiguous runs. */
function collapseSegmentRuns(segBounds: SegBound[]): SegBound[] {
  const runs: SegBound[] = []
  for (const [startM, endM, roadClass] of segBounds) {
    const prev = runs[runs.length - 1]
    if (prev && prev[2] === roadClass) {
      runs[runs.length - 1] = [prev[0], endM, roadClass]
    } else {
      runs.push([startM, endM, roadClass])
    }
  }
  return runs
}

type SampleTarget = { segMid: number; roadClass: string; protected: boolean; runLength: number }

/**
 * Pick sample targets that guarantee every road_class run gets sampled.
 * Mirrors maps_client.py's `_run_midpoint_targets` exactly (see that
 * docstring for the full rationale) — every contiguous run gets at least
 * one point at its own midpoint; long runs get extra evenly-spaced points;
 * if the total exceeds `maxPoints`, non-protected (interior) points are
 * dropped first, starting with the longest runs.
 */
function runMidpointTargets(
  segBounds: SegBound[],
  stepM: number = PLACES_SAMPLE_STEP_M,
  maxPoints: number = PLACES_MAX_SAMPLE_POINTS,
): SampleTarget[] {
  let candidates: SampleTarget[] = []
  for (const [runStart, runEnd, roadClass] of collapseSegmentRuns(segBounds)) {
    const length = runEnd - runStart
    if (length <= 0) continue
    const nInRun = Math.max(1, Math.round(length / stepM))
    const midIdx = Math.floor(nInRun / 2)
    for (let k = 0; k < nInRun; k++) {
      const segMid = runStart + ((k + 0.5) / nInRun) * length
      candidates.push({ segMid, roadClass, protected: k === midIdx, runLength: length })
    }
  }

  if (candidates.length > maxPoints) {
    const droppable = candidates
      .map((_, i) => i)
      .filter((i) => !candidates[i].protected)
      .sort((a, b) => candidates[b].runLength - candidates[a].runLength)
    const excess = candidates.length - maxPoints
    const drop = new Set(droppable.slice(0, excess))
    candidates = candidates.filter((_, i) => !drop.has(i))
  }

  return candidates
}

// ---------------------------------------------------------------------------
// Places — highway carriageway (up/down) direction filter (translated from
// maps_client.py's _local_xy / _facility_side_distance / _extract_direction_
// label / _filter_reachable_direction, fixbug-0806). See the Python
// docstrings for the full rationale: Japanese expressway SA/PA are
// direction-specific and a soft locationBias search returns both carriageways
// indiscriminately.
// ---------------------------------------------------------------------------

/** Convert (lat, lng) to local (east, north) metres relative to an origin. */
function localXY(lat: number, lng: number, olat: number, olng: number): [number, number] {
  const toRad = (d: number) => (d * Math.PI) / 180
  const x = toRad(lng - olng) * Math.cos(toRad(olat)) * EARTH_RADIUS_M
  const y = toRad(lat - olat) * EARTH_RADIUS_M
  return [x, y]
}

/** Signed perpendicular distance (metres) of *poi* from the route heading at
 * vertex *idx* (> 0 = LEFT/reachable under left-hand traffic, < 0 = RIGHT). */
function facilitySideDistance(poi: [number, number], idx: number, routePoints: [number, number][]): number {
  const n = routePoints.length
  const i0 = Math.max(0, idx - 2)
  const i1 = Math.min(n - 1, idx + 2)
  if (i1 <= i0) return 0.0
  const [olat, olng] = routePoints[idx]
  const [hx0, hy0] = localXY(routePoints[i0][0], routePoints[i0][1], olat, olng)
  const [hx1, hy1] = localXY(routePoints[i1][0], routePoints[i1][1], olat, olng)
  const hx = hx1 - hx0
  const hy = hy1 - hy0
  const hMag = Math.hypot(hx, hy)
  if (hMag === 0.0) return 0.0
  const [dx, dy] = localXY(poi[0], poi[1], olat, olng)
  return (hx * dy - hy * dx) / hMag
}

type DirectionLabel = 'up' | 'down'

function oppositeLabel(label: DirectionLabel): DirectionLabel {
  return label === 'up' ? 'down' : 'up'
}

/** Extract a carriageway direction label from a facility display name (上り/下り). */
function extractDirectionLabel(name: string): DirectionLabel | null {
  if (name.includes('上り')) return 'up'
  if (name.includes('下り')) return 'down'
  return null
}

type Bucketed = { place: google.maps.places.PlaceResult; bucket: string }

/** Keep only same-carriageway (reachable) SA/PA facilities on a highway route. */
function filterReachableDirection(deduped: Bucketed[], routePoints: [number, number][]): Bucketed[] {
  if (routePoints.length < 2) return deduped

  const computed = deduped.map(({ place, bucket }) => {
    const lat = place.geometry?.location?.lat() ?? 0
    const lng = place.geometry?.location?.lng() ?? 0
    const name = place.name ?? ''
    const idx = nearestVertexIndex([lat, lng], routePoints)
    const nearestDist = haversineM(lat, lng, routePoints[idx][0], routePoints[idx][1])
    const sideM = nearestDist > DIRECTION_SIDE_MAX_DIST_M ? 0.0 : facilitySideDistance([lat, lng], idx, routePoints)
    const label = extractDirectionLabel(name)
    return { place, bucket, sideM, label }
  })

  // Bidirectional weighted vote for route_dir.
  const votes = { up: 0, down: 0 }
  for (const { sideM, label } of computed) {
    if (label === null || Math.abs(sideM) <= DIRECTION_VOTE_MIN_SIDE_M) continue
    const votedLabel = sideM > 0 ? label : oppositeLabel(label)
    votes[votedLabel] += 1
  }
  let routeDir: DirectionLabel | null = null
  if (votes.up > votes.down) routeDir = 'up'
  else if (votes.down > votes.up) routeDir = 'down'

  const kept: Bucketed[] = []
  for (const { place, bucket, sideM, label } of computed) {
    const keep = label !== null && routeDir !== null ? label === routeDir : sideM >= 0
    if (keep) kept.push({ place, bucket })
  }
  return kept
}

// ---------------------------------------------------------------------------
// Places — main search
// ---------------------------------------------------------------------------

function textSearchRequest(query: string, lat: number, lng: number, maps: typeof google.maps): google.maps.places.TextSearchRequest {
  return {
    query,
    language: 'ja',
    location: new maps.LatLng(lat, lng),
    radius: PLACES_RADIUS_M,
  }
}

function nearbySearchRequest(
  type: string,
  lat: number,
  lng: number,
  maps: typeof google.maps,
): google.maps.places.PlaceSearchRequest {
  return {
    type,
    location: new maps.LatLng(lat, lng),
    radius: PLACES_RADIUS_M,
  }
}

function runTextSearch(
  service: google.maps.places.PlacesService,
  maps: typeof google.maps,
  request: google.maps.places.TextSearchRequest,
): Promise<google.maps.places.PlaceResult[]> {
  return new Promise((resolve, reject) => {
    service.textSearch(request, (res, status) => {
      if (status === maps.places.PlacesServiceStatus.OK && res) {
        resolve(res)
        return
      }
      if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([])
        return
      }
      reject(placesStatusToError(String(status)))
    })
  })
}

function runNearbySearch(
  service: google.maps.places.PlacesService,
  maps: typeof google.maps,
  request: google.maps.places.PlaceSearchRequest,
): Promise<google.maps.places.PlaceResult[]> {
  return new Promise((resolve, reject) => {
    service.nearbySearch(request, (res, status) => {
      if (status === maps.places.PlacesServiceStatus.OK && res) {
        resolve(res)
        return
      }
      if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([])
        return
      }
      reject(placesStatusToError(String(status)))
    })
  })
}

/** Map a Places v1-style bucket + Google `types` to the RawPlace type literal
 * (mirrors maps_client.py's `_classify_place_type`: bucket-first, Google
 * `types` as a cross-check/override). */
function classifyPlaceType(types: string[], bucket: string): string {
  const typeSet = new Set(types)
  if (typeSet.has('rest_stop') || typeSet.has('service_area')) return 'service_area'
  if (bucket) return bucket
  if (typeSet.has('convenience_store')) return 'convenience_store'
  if (typeSet.has('gas_station')) return 'gas_station'
  return 'other'
}

/**
 * Find rest POIs along a route (encoded polyline) using the JS SDK's
 * PlacesService, biased by context.route_type ("highway" | "urban" | ...)
 * and, when supplied, context.segments (per-step road_class + distance_m) —
 * mirrors maps_client.py's `places_rest_stops` (fixbug-0806). Returns []
 * when none found — an empty result is NOT an error. Throws MapsError
 * (key-free) on transport/quota/key failure.
 */
export async function placesRestStops(
  key: string,
  polyline: string,
  context: { route_type?: string; segments?: RawSegment[] },
): Promise<RawPlace[]> {
  let routePoints: [number, number][]
  try {
    routePoints = decodePolyline(polyline)
  } catch {
    // Invalid/empty polyline — cannot search; return graceful empty (mirrors Python).
    return []
  }
  if (routePoints.length === 0) return []

  const cumDist = cumulativeDistances(routePoints)
  const totalDist = cumDist[cumDist.length - 1]
  const routeType = context.route_type ?? 'urban'
  const segments = context.segments ?? []
  const segBounds = segments.length > 0 ? segmentBounds(segments) : []
  const totalSegM = segBounds.length > 0 ? segBounds[segBounds.length - 1][1] : 0.0

  // ── Sample point selection ─────────────────────────────────────────────
  // When segment data is available, every contiguous road_class run gets at
  // least one sample point at its own midpoint (fixbug-0806) — this lets a
  // short LOCAL stretch flanked by HIGHWAY still get searched. Falls back to
  // the legacy evenly-spaced whole-route split when no segment data exists.
  type SamplePoint = { lat: number; lng: number; target: number }
  const samplePoints: SamplePoint[] = []
  if (segBounds.length > 0 && totalSegM > 0) {
    const usedVertexIdx = new Set<number>()
    const addedCoords: [number, number][] = []
    for (const { segMid } of runMidpointTargets(segBounds)) {
      const target = (segMid / totalSegM) * totalDist
      let bestIdx = 0
      let bestDiff = Infinity
      for (let j = 0; j < cumDist.length; j++) {
        const diff = Math.abs(cumDist[j] - target)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = j
        }
      }
      if (usedVertexIdx.has(bestIdx)) continue
      const [lat, lng] = routePoints[bestIdx]
      if (addedCoords.some(([alat, alng]) => haversineM(lat, lng, alat, alng) < PLACES_DEDUP_RADIUS_M)) continue
      usedVertexIdx.add(bestIdx)
      addedCoords.push([lat, lng])
      samplePoints.push({ lat, lng, target })
    }
  } else {
    // Legacy fallback: PLACES_SAMPLE_POINTS interior fractions of the route
    // (1/(n+1) ... n/(n+1)), exactly like the Python fallback.
    for (let i = 1; i <= PLACES_SAMPLE_POINTS; i++) {
      const target = (totalDist * i) / (PLACES_SAMPLE_POINTS + 1)
      let bestIdx = 0
      let bestDiff = Infinity
      for (let j = 0; j < cumDist.length; j++) {
        const diff = Math.abs(cumDist[j] - target)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = j
        }
      }
      const [lat, lng] = routePoints[bestIdx]
      samplePoints.push({ lat, lng, target })
    }
  }

  const maps = await loadMapsSdk(key)
  // A detached, never-attached div — PlacesService requires a Map or
  // HTMLDivElement owner but never renders into it for textSearch/nearbySearch.
  const service = new maps.places.PlacesService(document.createElement('div'))

  // ── Per-point searches (bucket- and source-tagged) ─────────────────────
  type Tagged = { place: google.maps.places.PlaceResult; bucket: string; sourceHighway: boolean }
  const allResults: Tagged[] = []
  for (const { lat, lng, target } of samplePoints) {
    let pointIsHighway: boolean
    if (segBounds.length > 0 && totalSegM > 0 && totalDist > 0) {
      const segTarget = (target / totalDist) * totalSegM
      pointIsHighway = roadClassAt(segTarget, segBounds) === 'HIGHWAY'
    } else {
      // No usable segment data for this point — fall back to the
      // whole-route verdict (the only option when the caller never
      // supplied segments).
      pointIsHighway = routeType === 'highway'
    }

    if (pointIsHighway) {
      for (const query of HIGHWAY_TEXT_QUERIES) {
        // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
        const found = await runTextSearch(service, maps, textSearchRequest(query, lat, lng, maps))
        for (const place of found) allResults.push({ place, bucket: 'service_area', sourceHighway: true })
      }
    } else {
      for (const query of LOCAL_TEXT_QUERIES) {
        // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
        const found = await runTextSearch(service, maps, textSearchRequest(query, lat, lng, maps))
        for (const place of found) allResults.push({ place, bucket: 'service_area', sourceHighway: false })
      }
      for (const includedType of LOCAL_NEARBY_TYPES) {
        // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
        const found = await runNearbySearch(service, maps, nearbySearchRequest(includedType, lat, lng, maps))
        for (const place of found) allResults.push({ place, bucket: includedType, sourceHighway: false })
      }
    }
  }

  // Highway-SOURCED results only: drop any leaked 道の駅 (roadside station —
  // unreachable from an expressway, fixbug-0806 michinoeki-leak fix). A 道の駅
  // sourced from a local-classified point is the intended target and is
  // never touched.
  const leakFiltered = allResults.filter(
    ({ place, sourceHighway }) => !(sourceHighway && (place.name ?? '').includes('道の駅')),
  )

  if (leakFiltered.length === 0) return []

  // ── Dedupe by place_id (fall back to name + rounded coords) ────────────
  // First-seen bucket AND source_highway both win.
  const seen = new Set<string>()
  const deduped: Tagged[] = []
  for (const item of leakFiltered) {
    const { place } = item
    let dedupKey: string
    if (place.place_id) {
      dedupKey = `pid:${place.place_id}`
    } else {
      const lat = place.geometry?.location?.lat() ?? 0
      const lng = place.geometry?.location?.lng() ?? 0
      dedupKey = `name:${place.name ?? ''}:${lat.toFixed(4)}:${lng.toFixed(4)}`
    }
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    deduped.push(item)
  }

  // Highway-SOURCED results only: SA/PA are carriageway-direction-specific —
  // drop the opposite-direction half. Local-sourced (道の駅/convenience)
  // results have no up/down carriageway concept and are never filtered.
  const highwaySourced: Bucketed[] = deduped
    .filter((d) => d.sourceHighway)
    .map(({ place, bucket }) => ({ place, bucket }))
  const localSourced: Bucketed[] = deduped
    .filter((d) => !d.sourceHighway)
    .map(({ place, bucket }) => ({ place, bucket }))
  const filteredHighway = highwaySourced.length > 0 ? filterReachableDirection(highwaySourced, routePoints) : highwaySourced

  const combined: Tagged[] = [
    ...filteredHighway.map(({ place, bucket }) => ({ place, bucket, sourceHighway: true })),
    ...localSourced.map(({ place, bucket }) => ({ place, bucket, sourceHighway: false })),
  ]

  // ── Per-vertex road-class index (fixbug-0806 "7-Eleven on the highway") ─
  // Only built when segment data is available; when absent, both lists stay
  // empty and the projection loop below falls back to the legacy
  // nearest-vertex-of-any-class behaviour unchanged.
  const hwVertexIdx: number[] = []
  const localVertexIdx: number[] = []
  const hasVertexClassIndex = segBounds.length > 0 && totalSegM > 0 && totalDist > 0
  if (hasVertexClassIndex) {
    for (let i = 0; i < cumDist.length; i++) {
      const segTargetI = (cumDist[i] / totalDist) * totalSegM
      if (roadClassAt(segTargetI, segBounds) === 'HIGHWAY') hwVertexIdx.push(i)
      else localVertexIdx.push(i)
    }
  }

  // ── Project onto route, build RawPlace list, sort ascending ────────────
  // Road-class-match projection: a highway-sourced place (SA/PA) must sit on
  // a HIGHWAY stretch; a local-sourced place (道の駅/convenience) must sit on
  // a LOCAL stretch. A place whose own class doesn't occur anywhere on the
  // route is dropped. An off-route cap then drops any place whose distance
  // to that (matching-class) nearest vertex exceeds PLACES_OFFROUTE_MAX_M —
  // applies to every place regardless of type/source.
  const places: RawPlace[] = []
  for (const { place, bucket, sourceHighway } of combined) {
    const plat = place.geometry?.location?.lat() ?? 0
    const plng = place.geometry?.location?.lng() ?? 0
    const types = place.types ?? []
    const name = place.name ?? ''

    let nearestIdx: number
    if (hasVertexClassIndex) {
      const candIdx = sourceHighway ? hwVertexIdx : localVertexIdx
      if (candIdx.length === 0) continue
      nearestIdx = candIdx[0]
      let bestD = haversineM(plat, plng, routePoints[nearestIdx][0], routePoints[nearestIdx][1])
      for (const i of candIdx) {
        const d = haversineM(plat, plng, routePoints[i][0], routePoints[i][1])
        if (d < bestD) {
          bestD = d
          nearestIdx = i
        }
      }
    } else {
      // Legacy fallback: no segment data at all — no per-vertex road class
      // to match against, so keep the original nearest-vertex-of-any-class
      // behaviour unchanged.
      nearestIdx = nearestVertexIndex([plat, plng], routePoints)
    }

    const offRouteM = haversineM(plat, plng, routePoints[nearestIdx][0], routePoints[nearestIdx][1])
    if (offRouteM > PLACES_OFFROUTE_MAX_M) continue

    places.push({
      name,
      type: classifyPlaceType(types, bucket),
      location: { lat: plat, lng: plng },
      distance_along_route_m: cumDist[nearestIdx],
    })
  }

  places.sort((a, b) => a.distance_along_route_m - b.distance_along_route_m)
  return places
}
