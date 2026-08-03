import type { RouteEnvelope, RoutePresetSummary, RouteNotice } from '../../../api/types'
import { MapsError } from '../../../api/types'
import { routePresets } from '../../../data/routes'
import {
  analyzeRoute,
  analyzeRouteMaps,
  type RawRoute,
  type RawPlace,
  type RouteFactsFull,
} from '../../services/route_analysis'
import * as mapsClient from '../../services/maps_client'
import { settingsStore } from '../../../storage/settings_store'
import { scenarioRegistry } from '../../services/scenario_registry'
import type { ScenarioDefM2 } from '../../event_plan'

/** Loose stand-in for Python's `!r` repr formatting used in router error messages. */
function pyReprValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

/** Read the persisted Maps key from IndexedDB settings, or undefined if unset/empty. */
async function resolvePersistedMapsKey(): Promise<string | undefined> {
  const stored = await settingsStore.get('googleMapsApiKey')
  return typeof stored === 'string' && stored.length > 0 ? stored : undefined
}

/** Mirrors routes.py's `_derive_context`: highway if any segment road_class is HIGHWAY, else urban. */
function deriveMapsContext(raw: RawRoute): { route_type: string } {
  const segments = raw.segments ?? []
  return { route_type: segments.some((s) => s.road_class === 'HIGHWAY') ? 'highway' : 'urban' }
}

/** Mirrors routes.py's `_scale_scenario_rest_positions`: fallback for a Places failure. */
function scaleScenarioRestPositions(localFacts: RouteFactsFull, mapsTotalKm: number): RawPlace[] {
  const localTotal = localFacts.total_route_distance_km || 1.0
  return localFacts.rest_spot_positions.map((pos) => ({
    name: 'scenario_fallback_rest_stop',
    location: { lat: 0.0, lng: 0.0 },
    distance_along_route_m: (pos / localTotal) * mapsTotalKm * 1000.0,
    synthetic: true,
  }))
}

export async function routesPresetsList(): Promise<{ presets: RoutePresetSummary[] }> {
  const presets: RoutePresetSummary[] = routePresets().map((preset) => ({
    id: preset.id,
    label: preset.label,
    start: preset.start,
    end: preset.end,
    distance_km: Math.round((preset.raw_route.distance_m / 1000) * 10) / 10,
    duration_min: Math.round(preset.raw_route.duration_s / 60),
    summary: preset.raw_route.summary ?? '',
  }))
  return { presets }
}

export async function routesPresetsLoad(params: { presetId: string }): Promise<RouteEnvelope> {
  const preset = routePresets().find((p) => p.id === params.presetId)
  if (!preset) {
    throw new Error(`Preset ${pyReprValue(params.presetId)} not found`)
  }

  const [alternative] = analyzeRouteMaps(
    [preset.raw_route as unknown as RawRoute],
    { [preset.raw_route.route_id]: preset.places as unknown as RawPlace[] },
    preset.start,
    preset.end,
  )

  return {
    route_source: 'maps',
    alternatives: [
      {
        route_id: alternative.route_id,
        summary: alternative.summary,
        route_facts: alternative.route_facts,
        display: alternative.display,
        notices: [],
      },
    ],
  }
}

export async function routesAnalyze(params: {
  scenarioId?: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  const key = params.mapsKey || (await resolvePersistedMapsKey())
  const useMaps = !!key && !!params.start && !!params.end

  const scenario = params.scenarioId
    ? await scenarioRegistry.get(params.scenarioId)
    : null

  if (!useMaps) {
    if (scenario === null) {
      throw new Error(
        'No route source: provide a Maps key with start/end, or select a preset route / scenario to derive a local route.',
      )
    }
    const routeFacts = analyzeRoute(scenario as unknown as ScenarioDefM2)
    return {
      route_source: 'local',
      alternatives: [
        {
          route_id: 'local',
          summary: scenario.id,
          route_facts: routeFacts,
          display: null,
          notices: [],
        },
      ],
    }
  }

  const start = params.start as string
  const end = params.end as string

  let rawRoutes: RawRoute[]
  try {
    rawRoutes = await mapsClient.directions(key as string, start, end)
  } catch (exc) {
    if (exc instanceof MapsError) throw exc
    throw new MapsError({
      error_type: 'directions_failure',
      message: exc instanceof Error ? exc.message : 'Directions request failed',
      suggestion: 'Check your API key and network connection, or use the local route fallback.',
    })
  }

  const localFallbackFacts =
    scenario !== null ? analyzeRoute(scenario as unknown as ScenarioDefM2) : null

  const placesByRoute: Record<string, RawPlace[]> = {}
  const noticesByRoute: Record<string, RouteNotice[]> = {}
  for (const raw of rawRoutes) {
    const rid = raw.route_id
    const context = deriveMapsContext(raw)
    try {
      const places = await mapsClient.placesRestStops(key as string, raw.encoded_polyline ?? '', context)
      placesByRoute[rid] = places
      noticesByRoute[rid] = places.length === 0 ? ['no_rest_stops_found'] : []
    } catch {
      const scaled = localFallbackFacts
        ? scaleScenarioRestPositions(localFallbackFacts, raw.distance_m / 1000.0)
        : []
      placesByRoute[rid] = scaled
      noticesByRoute[rid] = scaled.length > 0 ? ['rest_data_degraded'] : ['rest_data_unavailable']
    }
  }

  const alternatives = analyzeRouteMaps(rawRoutes, placesByRoute, start, end)

  return {
    route_source: 'maps',
    alternatives: alternatives.map((alt) => ({
      route_id: alt.route_id,
      summary: alt.summary,
      route_facts: alt.route_facts,
      display: alt.display,
      notices: noticesByRoute[alt.route_id] ?? [],
    })),
  }
}
