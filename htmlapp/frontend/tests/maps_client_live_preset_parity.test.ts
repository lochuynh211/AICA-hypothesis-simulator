import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureRegistry } from '../src/data/registry'
import { routePresets } from '../src/data/routes'
import type { RoutePresetPlace } from '../src/data/types'
import { routesAnalyze, loadRoutePreset } from '../src/api/client'
import { _resetMapsSdkForTests } from '../src/engine/services/maps_client'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

/**
 * Live-vs-preset parity for the fixbug-0806 Places API (New) migration.
 *
 * `maps_client.test.ts`'s `routesAnalyze` describe block only ever spies on
 * `maps.directions`/`maps.placesRestStops` at the module level — it stubs
 * `placesRestStops` out entirely, so it never actually runs the migrated
 * New-API code inside it (`google.maps.importLibrary('places')` ->
 * `Place.searchByText`/`.searchNearby`). This file mocks the Google Maps SDK
 * one layer deeper — the `google.maps` namespace itself — so the REAL,
 * unmodified `placesRestStops` (and everything it calls: sampling, the 道の駅
 * leak filter, dedupe, the road-class-match projection + 2km off-route cap,
 * the carriageway direction filter) executes against the fake SDK, and
 * compares its output against the baked preset for the SAME route.
 *
 * Reference preset: `uc03_01_funabashi_makuhari` (6.9km, `raw_route.segments`
 * are ALL `road_class: "LOCAL"` — no HIGHWAY stretch anywhere on this route).
 * That means, deterministically, for every sample point `placesRestStops`
 * generates on this route: `pointIsHighway` is always false, so only the
 * LOCAL branch ever runs (Text Search "道の駅" + Nearby Search
 * convenience_store) and the highway carriageway direction filter never
 * triggers (`highwaySourced` is always empty) — this preset was chosen
 * specifically because it is the simplest fixture that still exercises BOTH
 * New-API call shapes (searchByText AND searchNearby) with zero
 * direction-filter/highway-projection ambiguity, making an exact-value
 * parity assertion tractable to reason about by hand.
 *
 * The preset's baked `places` (7 total: 2 "service_area" — "PaSaR幕張 (上り)"
 * and "旬撰倶楽部 房総･村の駅 PaSaR幕張上り店" — and 5 "convenience_store") are the
 * FINAL, fully-filtered output of this exact search/filter/dedupe/projection
 * pipeline captured by `scripts/extract_route_presets.py` (a 1:1 Python
 * mirror) against the real Google APIs — see that script and
 * `app/api/aica_api/services/maps_client.py` for the shared algorithm this
 * mock exercises. The mock below hands the SAME facilities back to whichever
 * `Place.searchByText`/`.searchNearby` call asks for them, filtered only by
 * `type` (service_area -> searchByText, convenience_store -> searchNearby) —
 * not by request lat/lng — because this route is short enough (6.9km) that
 * the 5km search radius from its one/few sample point(s) covers the whole
 * route, so every real query that ran during the original capture could, in
 * principle, have surfaced any of these 7 places; the pipeline's own id-based
 * dedupe collapses any duplicate hits across sample points, so returning the
 * full matching set on every call is faithful, not permissive.
 */
describe('placesRestStops (live) vs. preset (baked) — Places API (New) parity', () => {
  const preset = routePresets().find((p) => p.id === 'uc03_01_funabashi_makuhari')
  if (!preset) throw new Error('fixture preset uc03_01_funabashi_makuhari not found in registry')

  const servicearea = preset.places.filter((p) => p.type === 'service_area')
  const convenience = preset.places.filter((p) => p.type === 'convenience_store')
  // Sanity-check the fixture's own shape so a future data change fails loudly
  // here (at collection time — a plain throw, since `expect()` outside an
  // `it`/`beforeEach` body is not meaningful in Vitest) instead of producing
  // a confusing downstream mismatch inside the tests below.
  if (servicearea.length !== 2 || convenience.length !== 5) {
    throw new Error(
      `fixture uc03_01_funabashi_makuhari places shape changed: expected 2 service_area + 5 convenience_store, got ${servicearea.length} + ${convenience.length}`,
    )
  }
  if (!preset.raw_route.segments?.every((s) => s.road_class === 'LOCAL')) {
    throw new Error('fixture uc03_01_funabashi_makuhari is no longer all-LOCAL — reference preset choice needs revisiting')
  }

  /** New-API `google.maps.places.Place`-shaped object, per `toPlaceCandidate`. */
  function toFakePlace(p: RoutePresetPlace): google.maps.places.Place {
    return {
      id: p.name,
      displayName: p.name,
      location: { lat: () => p.location.lat, lng: () => p.location.lng },
      types: p.type ? [p.type] : [],
    } as unknown as google.maps.places.Place
  }

  let searchByTextMock: ReturnType<typeof vi.fn>
  let searchNearbyMock: ReturnType<typeof vi.fn>
  let routeServiceMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    searchByTextMock = vi.fn(async (request: google.maps.places.SearchByTextRequest) => {
      // Only the local-branch text query ("道の駅") is ever issued on this
      // all-LOCAL route; anything else (e.g. a HIGHWAY_TEXT_QUERIES leak,
      // which would mean a regression in road-class sampling) gets no results.
      if (request.textQuery !== '道の駅') return { places: [] }
      return { places: servicearea.map(toFakePlace) }
    })
    searchNearbyMock = vi.fn(async (request: google.maps.places.SearchNearbyRequest) => {
      const types = request.includedTypes ?? []
      if (!types.includes('convenience_store')) return { places: [] }
      return { places: convenience.map(toFakePlace) }
    })

    const fakeDirectionsResult = {
      routes: [
        {
          summary: preset.raw_route.summary ?? '',
          overview_polyline: preset.raw_route.encoded_polyline ?? '',
          legs: [
            {
              distance: { value: preset.raw_route.distance_m },
              duration: { value: preset.raw_route.duration_s },
              steps: (preset.raw_route.segments ?? []).map((seg) => ({
                distance: { value: seg.distance_m },
                maneuver: seg.maneuver ?? '',
                instructions: '',
              })),
            },
          ],
        },
      ],
    }
    routeServiceMock = vi.fn(
      (
        _request: google.maps.DirectionsRequest,
        callback: (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => void,
      ) => {
        callback(fakeDirectionsResult as unknown as google.maps.DirectionsResult, 'OK' as google.maps.DirectionsStatus)
      },
    )

    class FakeDirectionsService {
      route = routeServiceMock
    }

    // Deliberately DOES NOT define `google.maps.places.PlacesService` — the
    // legacy class. If the migrated code in maps_client.ts ever regressed to
    // `new maps.places.PlacesService(div)`, that constructor lookup would
    // throw (undefined), placesRestStops would reject, routesAnalyze's
    // catch-and-degrade path would kick in (no scenario fallback supplied
    // below, so it degrades to an EMPTY rest-spot list), and the parity
    // assertions below — which expect 7 non-empty, name-matching rest spots —
    // would fail loudly instead of silently passing.
    const fakeMaps = {
      DirectionsService: FakeDirectionsService,
      DirectionsStatus: { OK: 'OK' },
      TravelMode: { DRIVING: 'DRIVING' },
      importLibrary: vi.fn(async (name: string) => {
        if (name !== 'places') throw new Error(`unexpected importLibrary(${name})`)
        return { Place: { searchByText: searchByTextMock, searchNearby: searchNearbyMock } }
      }),
    }

    ;(window as unknown as { google?: unknown }).google = { maps: fakeMaps }
  })

  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google
    _resetMapsSdkForTests()
  })

  it('exercises Place.searchByText/.searchNearby via importLibrary (New API), not the legacy PlacesService', async () => {
    await routesAnalyze({ mapsKey: 'TEST_KEY', start: preset.start, end: preset.end })

    expect(searchByTextMock).toHaveBeenCalled()
    expect(searchNearbyMock).toHaveBeenCalled()

    // Every searchByText call used the local "道の駅" query; the highway
    // queries (サービスエリア/パーキングエリア) were never issued — consistent
    // with this route's segments being 100% LOCAL.
    for (const [request] of searchByTextMock.mock.calls) {
      expect(request.textQuery).toBe('道の駅')
      expect(request.fields).toEqual(['id', 'displayName', 'location', 'types'])
    }
    for (const [request] of searchNearbyMock.mock.calls) {
      expect(request.includedTypes).toEqual(['convenience_store'])
      expect(request.fields).toEqual(['id', 'displayName', 'location', 'types'])
    }
  })

  it('live route_facts rest spots match the preset (baked) route_facts exactly', async () => {
    const liveEnv = await routesAnalyze({ mapsKey: 'TEST_KEY', start: preset.start, end: preset.end })
    const presetEnv = await loadRoutePreset(preset.id)

    expect(liveEnv.route_source).toBe('maps')
    expect(liveEnv.alternatives).toHaveLength(1)
    // A non-empty rest-spot list means placesRestStops did not degrade to the
    // empty/fallback path (which is what a legacy-PlacesService regression,
    // or any other silent failure, would produce).
    expect(liveEnv.alternatives[0].notices).toEqual([])

    const liveFacts = liveEnv.alternatives[0].route_facts
    const presetFacts = presetEnv.alternatives[0].route_facts

    // rest_spot_positions (km): both derived from the same haversine
    // nearest-vertex projection over the same decoded polyline (the live path
    // via `placesRestStops`, the preset via the identical Python mirror in
    // extract_route_presets.py against the real Google APIs) — compared with
    // a tight (sub-millimetre) numeric tolerance rather than strict equality
    // to allow for last-bit floating-point differences between JS's and
    // Python's trig implementations of the identical formula.
    expect(liveFacts.rest_spot_positions).toHaveLength(presetFacts.rest_spot_positions.length)
    liveFacts.rest_spot_positions.forEach((pos, i) => {
      expect(pos).toBeCloseTo(presetFacts.rest_spot_positions[i], 6)
    })

    const liveNamed = (liveFacts as unknown as { named_rest_spots: { name: string; position_km: number; lat: number | null; lng: number | null; synthetic: boolean }[] }).named_rest_spots
    const presetNamed = (presetFacts as unknown as { named_rest_spots: { name: string; position_km: number; lat: number | null; lng: number | null; synthetic: boolean }[] }).named_rest_spots

    expect(liveNamed).toHaveLength(7)
    expect(liveNamed).toHaveLength(presetNamed.length)
    liveNamed.forEach((spot, i) => {
      const expected = presetNamed[i]
      // name/lat/lng/synthetic pass through the pipeline unchanged (never
      // recomputed) — exact equality is the correct, non-weakened assertion.
      expect(spot.name).toBe(expected.name)
      expect(spot.lat).toBe(expected.lat)
      expect(spot.lng).toBe(expected.lng)
      expect(spot.synthetic).toBe(expected.synthetic)
      // position_km is distance-derived (see rest_spot_positions above).
      expect(spot.position_km).toBeCloseTo(expected.position_km, 6)
    })

    // Non-vacuous: confirms the expected facility names actually appear,
    // rather than the assertion above passing on two equally-wrong lists.
    expect(liveNamed.map((s) => s.name)).toContain('PaSaR幕張 (上り)')
    expect(liveNamed.map((s) => s.name)).toContain('旬撰倶楽部 房総･村の駅 PaSaR幕張上り店')
    expect(liveNamed.filter((s) => s.synthetic)).toEqual([])
  })
})
