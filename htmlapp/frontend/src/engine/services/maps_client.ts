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
 * `google.maps.places.Place.searchByText`/`.searchNearby`, the Places API
 * (New) browser classes) using the runtime BYO key, and normalizes the SDK's
 * (callback- or Promise-based) results into the SAME plain-dict
 * `RawRoute[]` / `RawPlace[]` contracts `route_analysis.ts`'s
 * `analyzeRouteMaps` already consumes (ported in S7.2).
 *
 * Preserved from the Python module:
 *   - The `MapsError` contract (`error_type` + `message`, both KEY-FREE —
 *     see `../../api/types`'s `MapsError`/`MapsErrorBody`).
 *   - The two-layer numeric boundary: this module only ever returns
 *     RawRoute/RawPlace plain-value dicts; ordinal binning happens strictly
 *     downstream (route_analysis.ts / binning.ts), never here.
 *   - The road-class inference heuristic (instruction keyword / long-step
 *     fallback / merge-ramp maneuver minus its ordinary-road exception) and
 *     the Places sample-point + dedupe + project-onto-route algorithm,
 *     translated 1:1 from the Python.
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
 * module moved to Places v1 (POST/JSON, separate Text/Nearby endpoints).
 *
 * Correction (fixbug-0806 follow-up, "Places API (New) migration"): the
 * browser SDK DOES have the same legacy-vs-New distinction as the REST API —
 * a prior version of this comment claimed otherwise, which was wrong and is
 * the reason this module still called the LEGACY `PlacesService.textSearch`
 * / `.nearbySearch` long after the Python side moved to Places v1. A BYO key
 * that only has "Places API (New)" enabled (and not the legacy "Places API")
 * gets REQUEST_DENIED from the legacy calls, which used to abort the whole
 * `placesRestStops` call and silently fall back to synthetic scenario data.
 * This module now calls the New-API browser classes instead —
 * `google.maps.places.Place.searchByText` / `.searchNearby` (loaded via
 * `google.maps.importLibrary('places')`) — mirroring the Python's
 * `_text_search_body`/`_nearby_search_body` -> `_places_v1_fetch` split as
 * closely as the browser SDK allows (see `textSearchRequest` /
 * `nearbySearchRequest` / `runTextSearch` / `runNearbySearch` below). Per-query
 * calls are now also individually try/caught inside `placesRestStops`'s
 * sampling loop — a single failed/denied query is treated as an empty result
 * (like ZERO_RESULTS) instead of aborting the whole search, so one transient
 * or misconfigured-key denial can no longer collapse the entire live search
 * to the synthetic fallback (defense in depth on top of the New-API switch
 * itself).
 *
 * What changed in the fixbug-0806 search algorithm itself, and is ported
 * below (unaffected by the New-API migration — same sampling/filter/dedupe/
 * projection pipeline, only the underlying search-call mechanism changed):
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

// Japanese designations for ORDINARY (non-expressway) public roads, as Google
// writes them in a step's instructions: 国道 (national route), 県道/府道/道道
// (prefectural), 市道 (municipal). A step whose text names one of these and
// carries NO highway/toll keyword is a surface road even when the maneuver is
// "merge" or "ramp" (fixbug-0806 — mirrors maps_client.py's
// _ORDINARY_ROAD_MARKERS).
const ORDINARY_ROAD_MARKERS = ['国道', '県道', '府道', '道道', '市道'] as const

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
 *
 * HIGHWAY when ANY holds:
 *   1. Keyword   — instructions contain a HIGHWAY_INSTRUCTION_KEYWORDS entry
 *                  (every tolled Japanese expressway step carries "Toll road").
 *   2. Long-step — distance >= HIGHWAY_MIN_STEP_M (8 km), the cross-language net.
 *   3. Maneuver  — "merge"/"ramp", UNLESS the instruction names an ordinary road
 *                  (ORDINARY_ROAD_MARKERS) and matched no keyword under rule 1.
 *                  Merging onto 名濃バイパス/国道41号 is a surface-road maneuver,
 *                  not an expressway one; scoping the exception to those Japanese
 *                  designations leaves "Merge onto I-5 N" HIGHWAY as before.
 *
 * Exported for tests only (mirrors `_resetMapsSdkForTests` above) — the
 * production callers are `directions()` below.
 */
export function inferRoadClass(step: google.maps.DirectionsStep): 'HIGHWAY' | 'LOCAL' {
  const maneuver = (step.maneuver ?? '').toLowerCase()
  const rawInstructions = step.instructions ?? ''
  const instructions = rawInstructions.toLowerCase()
  const distanceM = step.distance?.value ?? 0

  if (
    HIGHWAY_INSTRUCTION_KEYWORDS.some((kw) => instructions.includes(kw)) ||
    distanceM >= HIGHWAY_MIN_STEP_M
  ) {
    return 'HIGHWAY'
  }

  const namesOrdinaryRoad = ORDINARY_ROAD_MARKERS.some((m) => rawInstructions.includes(m))
  if ((maneuver.includes('merge') || maneuver.includes('ramp')) && !namesOrdinaryRoad) {
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
// _distance_along_route; needed here because the JS SDK's Places search
// (searchByText/searchNearby) returns POIs, not along-route offsets — this
// module still has to project them itself, exactly like the Python module did.)
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

// Places API (New) browser error codes that indicate a rejected/invalid key
// (mirrors maps_client.py's `_PLACES_V1_KEY_ERROR_STATUSES`). `Place.searchByText`
// / `.searchNearby` reject with a `MapsRequestError`/`MapsServerError` whose
// `.code` is drawn from the gRPC-style `RPCStatus` enum (PERMISSION_DENIED /
// UNAUTHENTICATED) rather than the legacy PlacesServiceStatus string
// (REQUEST_DENIED) — REQUEST_DENIED is kept too, defensively, in case a future
// SDK revision or a mixed error path still surfaces it.
const PLACES_KEY_ERROR_CODES = new Set(['PERMISSION_DENIED', 'REQUEST_DENIED', 'UNAUTHENTICATED'])
// Quota-exhaustion codes (mirrors `_PLACES_V1_QUOTA_ERROR_STATUSES`); legacy
// OVER_QUERY_LIMIT/OVER_DAILY_LIMIT kept defensively alongside the New-API
// RESOURCE_EXHAUSTED.
const PLACES_QUOTA_ERROR_CODES = new Set(['RESOURCE_EXHAUSTED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT'])

/** Best-effort extraction of a status/code string from an error thrown by
 * `Place.searchByText`/`.searchNearby` (a `MapsRequestError`/`MapsServerError`,
 * both of which carry a `.code`) or any other rejection shape. Never echoes
 * the API key — those error classes never carry it. */
function placesErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** Map a Places API (New) browser error (or a legacy PlacesServiceStatus
 * string, kept for back-compat) to a key-free MapsError. */
function placesStatusToError(status: string): MapsError {
  if (PLACES_KEY_ERROR_CODES.has(status)) {
    return new MapsError({
      error_type: 'invalid_key',
      message: `API key was rejected (${status})`,
      suggestion: 'Check your API key.',
    })
  }
  if (PLACES_QUOTA_ERROR_CODES.has(status)) {
    return new MapsError({
      error_type: 'quota',
      message: `Quota exceeded (${status})`,
      suggestion: 'Try again later.',
    })
  }
  return new MapsError({
    error_type: 'places_failure',
    message: `Places request failed (${status})`,
    suggestion: 'Check your network connection.',
  })
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

/**
 * Minimal internal candidate shape adapted from a Places API (New)
 * `google.maps.places.Place` result — mirrors the fields maps_client.py reads
 * off its Places v1 JSON dicts (`id` / `displayName.text` / `location.lat|lng`
 * / `types`). All the sampling/filter/dedupe/projection logic below is
 * written against THIS shape rather than the raw SDK class, so the New-API
 * migration only touches `toPlaceCandidate` and the two search-call
 * functions — see `runTextSearch`/`runNearbySearch` below.
 */
type PlaceCandidate = {
  id: string | null
  name: string
  lat: number
  lng: number
  types: string[]
}

/** Adapt a New-API `Place` result to the internal `PlaceCandidate` shape. */
function toPlaceCandidate(place: google.maps.places.Place): PlaceCandidate {
  return {
    id: place.id ?? null,
    name: place.displayName ?? '',
    lat: place.location?.lat() ?? 0,
    lng: place.location?.lng() ?? 0,
    types: place.types ?? [],
  }
}

type Bucketed = { place: PlaceCandidate; bucket: string }

/** Keep only same-carriageway (reachable) SA/PA facilities on a highway route. */
function filterReachableDirection(deduped: Bucketed[], routePoints: [number, number][]): Bucketed[] {
  if (routePoints.length < 2) return deduped

  const computed = deduped.map(({ place, bucket }) => {
    const lat = place.lat
    const lng = place.lng
    const name = place.name
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

// Minimal field mask for the New-API browser calls — mirrors maps_client.py's
// `_PLACES_FIELD_MASK` ("places.id,places.displayName,places.types,places.location"),
// requesting only what `toPlaceCandidate` reads.
const PLACES_NEW_API_FIELDS = ['id', 'displayName', 'location', 'types'] as const

/** Build a `Place.searchByText` request — mirrors maps_client.py's `_text_search_body`. */
function textSearchRequest(query: string, lat: number, lng: number): google.maps.places.SearchByTextRequest {
  return {
    textQuery: query,
    language: 'ja',
    fields: [...PLACES_NEW_API_FIELDS],
    maxResultCount: 20,
    locationBias: { center: { lat, lng }, radius: PLACES_RADIUS_M },
  }
}

/** Build a `Place.searchNearby` request — mirrors maps_client.py's `_nearby_search_body`. */
function nearbySearchRequest(includedType: string, lat: number, lng: number): google.maps.places.SearchNearbyRequest {
  return {
    includedTypes: [includedType],
    fields: [...PLACES_NEW_API_FIELDS],
    maxResultCount: 5,
    language: 'ja',
    locationRestriction: { center: { lat, lng }, radius: PLACES_RADIUS_M },
  }
}

/**
 * Run one `Place.searchByText` (New API) call and adapt the result to
 * `PlaceCandidate[]`. Mirrors maps_client.py's `_places_v1_fetch` against
 * `_PLACES_V1_TEXT_URL`: an empty `places` array (zero results) is NOT an
 * error and resolves to `[]`; any thrown `MapsRequestError`/`MapsServerError`
 * (or other rejection) is normalized to a key-free `MapsError` via
 * `placesStatusToError`. The caller (`placesRestStops`'s sampling loop) is
 * additionally responsible for catching that MapsError per-query so a single
 * denied/failed query cannot abort the whole search (fixbug-0806 New-API
 * migration) — this function itself still throws, by design, so a caller
 * that genuinely wants the old "abort on first failure" behaviour still can.
 */
async function runTextSearch(
  placeCtor: typeof google.maps.places.Place,
  request: google.maps.places.SearchByTextRequest,
): Promise<PlaceCandidate[]> {
  try {
    const { places } = await placeCtor.searchByText(request)
    return (places ?? []).map(toPlaceCandidate)
  } catch (err) {
    throw placesStatusToError(placesErrorCode(err))
  }
}

/** Run one `Place.searchNearby` (New API) call — see `runTextSearch` above
 * (mirrors maps_client.py's `_places_v1_fetch` against `_PLACES_V1_NEARBY_URL`). */
async function runNearbySearch(
  placeCtor: typeof google.maps.places.Place,
  request: google.maps.places.SearchNearbyRequest,
): Promise<PlaceCandidate[]> {
  try {
    const { places } = await placeCtor.searchNearby(request)
    return (places ?? []).map(toPlaceCandidate)
  } catch (err) {
    throw placesStatusToError(placesErrorCode(err))
  }
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

// SA/PA/道の駅 facility name markers — mirrors maps_client.py's
// _SA_PA_NAME_MARKERS / _MICHI_NAME_MARKER.
const SA_PA_NAME_MARKERS = ['サービスエリア', 'パーキングエリア', 'ＳＡ', 'ＰＡ', 'SA', 'PA'] as const
const MICHI_NAME_MARKER = '道の駅'

// Corporate-entity tokens. A name carrying one of these is a company (e.g.
// "株式会社RSP道の駅"), not a physical rest facility — real SA/PA/道の駅 display
// names never include them. Such a name must NOT qualify via the name-marker
// path (an explicit Google rest_stop/service_area type still does). Mirrors
// maps_client._COMPANY_NAME_MARKERS.
const COMPANY_NAME_MARKERS = ['株式会社', '有限会社', '㈱', '㈲', '(株)', '（株）', '(有)', '（有）'] as const

/**
 * True iff a Text Search hit is genuinely a rest facility — mirrors
 * maps_client.py's `_is_verified_rest_facility`. Google's own rest_stop/
 * service_area type always qualifies; otherwise the display name must carry a
 * facility marker AND must not be a corporate entity. Drops soft-locationBias
 * leakage — shops, antenna stores, tourist centers, "株式会社…道の駅" companies.
 */
function isVerifiedRestFacility(place: PlaceCandidate, nameMarkers: readonly string[]): boolean {
  const types = new Set(place.types)
  if (types.has('rest_stop') || types.has('service_area')) return true
  const name = place.name
  if (COMPANY_NAME_MARKERS.some((c) => name.includes(c))) return false
  return nameMarkers.some((m) => name.includes(m))
}

// A place and businesses inside it are separate Places v1 results (distinct
// id/name, coords a few tens of metres apart) — e.g. "野呂 パーキングエリア
// (下り)" and "YASMOCCA 野呂PA (下り)". They survive the id/name dedup, then snap
// to the same route vertex and stack on one distance_along_route_m. Two kept
// same-type places within this physical distance are treated as one stop.
// Mirrors maps_client._SAME_SPOT_RADIUS_M.
const SAME_SPOT_RADIUS_M = 300.0

/** Canonical-ness rank for a same-spot survivor pick — mirrors
 * maps_client._canonical_name_rank. Full-form marker (サービスエリア/
 * パーキングエリア/道の駅) > bare latin SA/PA > no marker. */
function canonicalNameRank(name: string): number {
  if (['サービスエリア', 'パーキングエリア', '道の駅'].some((m) => name.includes(m))) return 2
  if (['ＳＡ', 'ＰＡ', 'SA', 'PA'].some((m) => name.includes(m))) return 1
  return 0
}

// Tokens stripped to expose a facility name's proper-noun core — mirrors
// maps_client._CORE_STRIP_TOKENS.
const CORE_STRIP_TOKENS = [
  '(上り)', '（上り）', '(下り)', '（下り）', '上り', '下り',
  'サービスエリア', 'パーキングエリア', '道の駅', 'ＳＡ', 'ＰＡ', 'SA', 'PA',
] as const

/** Proper-noun core of a facility name — mirrors maps_client._facility_core. */
function facilityCore(name: string): string {
  let core = name
  for (const token of CORE_STRIP_TOKENS) core = core.split(token).join('')
  return core.replace(/^[ 　()（）]+|[ 　()（）]+$/g, '')
}

/** True iff two names denote the same facility — mirrors maps_client._same_facility.
 * Opposite carriageway labels are distinct; else one name's core must contain
 * the other's. */
function sameFacility(aName: string, bName: string): boolean {
  const la = extractDirectionLabel(aName)
  const lb = extractDirectionLabel(bName)
  if (la && lb && la !== lb) return false
  const ca = facilityCore(aName)
  const cb = facilityCore(bName)
  if (!ca || !cb) return false
  return ca.includes(cb) || cb.includes(ca)
}

/** Merge same-facility places within SAME_SPOT_RADIUS_M into one stop — mirrors
 * maps_client._collapse_same_spot. Same type + within radius + sameFacility;
 * survivor keeps the most canonical name, ties keep the first-seen. */
function collapseSameSpot(places: RawPlace[]): RawPlace[] {
  const kept: RawPlace[] = []
  for (const p of places) {
    let merged = false
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]
      if (p.type !== k.type) continue
      const d = haversineM(p.location.lat, p.location.lng, k.location.lat, k.location.lng)
      if (d < SAME_SPOT_RADIUS_M && sameFacility(p.name, k.name)) {
        if (canonicalNameRank(p.name) > canonicalNameRank(k.name)) kept[i] = p
        merged = true
        break
      }
    }
    if (!merged) kept.push(p)
  }
  return kept
}

// Rest-value ranking of a place type, for picking the survivor when several
// distinct places project to the SAME route vertex — mirrors
// maps_client._REST_TYPE_PRIORITY.
const REST_TYPE_PRIORITY: Record<string, number> = {
  service_area: 3,
  convenience_store: 2,
  gas_station: 1,
  other: 0,
}

/** Keep exactly one place per distinct distance_along_route_m vertex —
 * mirrors maps_client._collapse_same_distance. distance_along_route snaps every
 * POI to the nearest route vertex, so distinct places closest to the same
 * vertex share a byte-identical distance — including a facility and a business
 * inside it (e.g. 鮎沢PA (下り 左ルート) + 山小屋食堂（鮎沢PA下り）, or EXPASA海老名 (下り) +
 * SA STAR 2 海老名SA店) that collapseSameSpot's name test could not fuse. On real
 * dense polylines two genuinely distinct rest destinations never share a
 * vertex, so a same-vertex collision is always a duplicate view of one spot:
 * keep the single best (richer type > canonical name > first-seen).
 * service_area is treated like every other type — no exemption — so co-located
 * sub-businesses of one facility collapse to one entry. Exact-value equality
 * only merges same-vertex collisions. */
function collapseSameDistance(places: RawPlace[]): RawPlace[] {
  const groups = new Map<number, RawPlace[]>()
  const order: number[] = []
  for (const p of places) {
    const d = p.distance_along_route_m
    let g = groups.get(d)
    if (!g) {
      g = []
      groups.set(d, g)
      order.push(d)
    }
    g.push(p)
  }
  const better = (a: RawPlace, b: RawPlace): boolean => {
    const pa = REST_TYPE_PRIORITY[a.type ?? 'other'] ?? 0
    const pb = REST_TYPE_PRIORITY[b.type ?? 'other'] ?? 0
    if (pa !== pb) return pa > pb
    return canonicalNameRank(a.name) > canonicalNameRank(b.name)
  }
  const out: RawPlace[] = []
  for (const d of order) {
    const group = groups.get(d)!
    let best = group[0]
    for (const p of group.slice(1)) if (better(p, best)) best = p
    out.push(best)
  }
  return out
}

/**
 * Find rest POIs along a route (encoded polyline) using the Places API (New)
 * browser classes (`google.maps.places.Place.searchByText`/`.searchNearby`),
 * biased by context.route_type ("highway" | "urban" | ...) and, when
 * supplied, context.segments (per-step road_class + distance_m) — mirrors
 * maps_client.py's `places_rest_stops` (fixbug-0806). Returns [] when none
 * found — an empty result is NOT an error, and (fixbug-0806 New-API
 * migration) a single per-query search failure is now ALSO treated as an
 * empty result rather than aborting the whole function — see the per-query
 * try/catch around `runTextSearch`/`runNearbySearch` below. MapsError
 * (key-free) is only thrown for genuinely unrecoverable conditions, e.g. the
 * Maps SDK itself failing to load (`loadMapsSdk`, unchanged by this function).
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
  // Places API (New) browser class — loaded via importLibrary (idempotent;
  // the "places" library is already fetched by loadMapsSdk's
  // `&libraries=places` bootstrap param, so this resolves immediately without
  // a second network round-trip). Replaces the legacy
  // `new maps.places.PlacesService(div)` instance — searchByText/searchNearby
  // are static methods on `Place`, not instance methods on a service object.
  const { Place } = await maps.importLibrary('places')

  // ── Per-point searches (bucket- and source-tagged) ─────────────────────
  // Defense in depth (fixbug-0806 New-API migration): each per-query search
  // is individually try/caught here — a single failed/denied query is
  // treated as an empty result (like ZERO_RESULTS) and the loop continues,
  // instead of one query's rejection aborting the entire placesRestStops
  // call (which used to force the caller straight to the synthetic scenario
  // fallback; see routes.ts's routesAnalyze catch block).
  type Tagged = { place: PlaceCandidate; bucket: string; sourceHighway: boolean }
  const allResults: Tagged[] = []
  async function safeTextSearch(query: string, lat: number, lng: number): Promise<PlaceCandidate[]> {
    try {
      return await runTextSearch(Place, textSearchRequest(query, lat, lng))
    } catch {
      return []
    }
  }
  async function safeNearbySearch(includedType: string, lat: number, lng: number): Promise<PlaceCandidate[]> {
    try {
      return await runNearbySearch(Place, nearbySearchRequest(includedType, lat, lng))
    } catch {
      return []
    }
  }
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
        const found = await safeTextSearch(query, lat, lng)
        for (const place of found) {
          if (isVerifiedRestFacility(place, SA_PA_NAME_MARKERS)) {
            allResults.push({ place, bucket: 'service_area', sourceHighway: true })
          }
        }
      }
    } else {
      for (const query of LOCAL_TEXT_QUERIES) {
        // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
        const found = await safeTextSearch(query, lat, lng)
        for (const place of found) {
          if (isVerifiedRestFacility(place, [MICHI_NAME_MARKER])) {
            allResults.push({ place, bucket: 'service_area', sourceHighway: false })
          }
        }
      }
      for (const includedType of LOCAL_NEARBY_TYPES) {
        // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
        const found = await safeNearbySearch(includedType, lat, lng)
        for (const place of found) allResults.push({ place, bucket: includedType, sourceHighway: false })
      }
    }
  }

  // Highway-SOURCED results only: drop any leaked 道の駅 (roadside station —
  // unreachable from an expressway, fixbug-0806 michinoeki-leak fix). A 道の駅
  // sourced from a local-classified point is the intended target and is
  // never touched.
  const leakFiltered = allResults.filter(
    ({ place, sourceHighway }) => !(sourceHighway && place.name.includes('道の駅')),
  )

  if (leakFiltered.length === 0) return []

  // ── Dedupe by id (fall back to name + rounded coords) ──────────────────
  // First-seen bucket AND source_highway both win.
  const seen = new Set<string>()
  const deduped: Tagged[] = []
  for (const item of leakFiltered) {
    const { place } = item
    let dedupKey: string
    if (place.id) {
      dedupKey = `pid:${place.id}`
    } else {
      dedupKey = `name:${place.name}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`
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
    const plat = place.lat
    const plng = place.lng
    const types = place.types
    const name = place.name

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
  // Collapse a facility + businesses-inside-it into one stop (collapseSameSpot),
  // then collapse distinct places that snapped to the same route vertex — one
  // rest option per distance_along_route_m (collapseSameDistance). Re-sort as a
  // same-spot survivor may adopt slightly different coords/distance. Mirrors
  // maps_client.py's places_rest_stops tail.
  let result = collapseSameSpot(places)
  result = collapseSameDistance(result)
  result.sort((a, b) => a.distance_along_route_m - b.distance_along_route_m)
  return result
}
