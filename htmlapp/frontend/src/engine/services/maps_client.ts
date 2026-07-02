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
 */

import { MapsError } from '../../api/types'
import type { RawRoute, RawSegment, RawPlace } from './route_analysis'

// ---------------------------------------------------------------------------
// Constants (mirror maps_client.py's module-level constants)
// ---------------------------------------------------------------------------

const MAX_ALTERNATIVES = 3
const PLACES_SAMPLE_POINTS = 6
const PLACES_RADIUS_M = 25_000
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

function distanceAlongRoute(poi: [number, number], routePoints: [number, number][], cumDist: number[]): number {
  if (routePoints.length === 0) return 0.0
  let bestIdx = 0
  let bestD = haversineM(poi[0], poi[1], routePoints[0][0], routePoints[0][1])
  for (let i = 1; i < routePoints.length; i++) {
    const d = haversineM(poi[0], poi[1], routePoints[i][0], routePoints[i][1])
    if (d < bestD) {
      bestD = d
      bestIdx = i
    }
  }
  return cumDist[bestIdx]
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

/**
 * Find rest POIs along a route (encoded polyline) using the JS SDK's
 * PlacesService, biased by context.route_type ("highway" | "urban" | ...).
 * Returns [] when none found — an empty result is NOT an error (mirrors
 * maps_client.py's places_rest_stops). Throws MapsError (key-free) on
 * transport/quota/key failure.
 */
export async function placesRestStops(
  key: string,
  polyline: string,
  context: { route_type?: string },
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

  const maps = await loadMapsSdk(key)

  // Pick PLACES_SAMPLE_POINTS interior fractions of the route, exactly like
  // the Python sample-point selection (1/(n+1) ... n/(n+1)).
  const samplePoints: [number, number][] = []
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
    samplePoints.push(routePoints[bestIdx])
  }

  // A detached, never-attached div — PlacesService requires a Map or
  // HTMLDivElement owner but never renders into it for nearbySearch.
  const service = new maps.places.PlacesService(document.createElement('div'))

  const allResults: google.maps.places.PlaceResult[] = []
  for (const [sLat, sLng] of samplePoints) {
    const request: google.maps.places.PlaceSearchRequest = {
      location: new maps.LatLng(sLat, sLng),
      radius: PLACES_RADIUS_M,
      keyword: 'service area rest area',
    }
    if (routeType === 'highway') request.type = 'gas_station'

    // eslint-disable-next-line no-await-in-loop -- sequential per-point search mirrors the Python loop
    const results = await new Promise<google.maps.places.PlaceResult[]>((resolve, reject) => {
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
    allResults.push(...results)
  }

  if (allResults.length === 0) return []

  // Dedupe by place_id (fall back to name + rounded coords if absent).
  const seen = new Set<string>()
  const deduped: google.maps.places.PlaceResult[] = []
  for (const r of allResults) {
    let dedupKey: string
    if (r.place_id) {
      dedupKey = `pid:${r.place_id}`
    } else {
      const lat = r.geometry?.location?.lat() ?? 0
      const lng = r.geometry?.location?.lng() ?? 0
      dedupKey = `name:${r.name ?? ''}:${lat.toFixed(4)}:${lng.toFixed(4)}`
    }
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    deduped.push(r)
  }

  const places: RawPlace[] = deduped.map((r) => {
    const lat = r.geometry?.location?.lat() ?? 0
    const lng = r.geometry?.location?.lng() ?? 0
    return {
      name: r.name ?? '',
      location: { lat, lng },
      distance_along_route_m: distanceAlongRoute([lat, lng], routePoints, cumDist),
    }
  })

  places.sort((a, b) => a.distance_along_route_m - b.distance_along_route_m)
  return places
}
