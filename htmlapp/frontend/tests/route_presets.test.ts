import { describe, it, expect } from 'vitest'
import { listRoutePresets, loadRoutePreset } from '../src/api/client'
import { DEFAULT_ROUTE_PRESETS } from '../src/data/routes'

describe('route presets', () => {
  it('lists and loads a preset envelope', async () => {
    const { presets } = await listRoutePresets()
    expect(presets.length).toBeGreaterThan(0)
    const env = await loadRoutePreset(presets[0].id)
    expect(env).toHaveProperty('route_source')
  })

  it('bundles all 3 repo presets', () => {
    expect(DEFAULT_ROUTE_PRESETS.length).toBe(3)
    const ids = DEFAULT_ROUTE_PRESETS.map((p) => p.id).sort()
    expect(ids).toEqual(['long_tokyo_osaka', 'middle_tokyo_karuizawa', 'short_tokyo_chichibu'])
  })

  it('summary shape matches route_presets.py list_route_presets EXACTLY (key set)', async () => {
    const { presets } = await listRoutePresets()
    for (const summary of presets) {
      expect(Object.keys(summary).sort()).toEqual(
        ['distance_km', 'duration_min', 'end', 'id', 'label', 'start', 'summary'].sort(),
      )
      expect(typeof summary.id).toBe('string')
      expect(typeof summary.label).toBe('object')
      expect(typeof summary.label.ja).toBe('string')
      expect(typeof summary.label.en).toBe('string')
      expect(typeof summary.start).toBe('string')
      expect(typeof summary.end).toBe('string')
      expect(typeof summary.distance_km).toBe('number')
      expect(typeof summary.duration_min).toBe('number')
      expect(typeof summary.summary).toBe('string')
    }
  })

  it('envelope shape matches route_presets.py load_route_preset EXACTLY (route_facts + display fields)', async () => {
    const env = await loadRoutePreset('short_tokyo_chichibu')
    expect(env.route_source).toBe('maps')
    expect(env.alternatives.length).toBe(1)
    const alt = env.alternatives[0]
    expect(alt.notices).toEqual([])
    expect(typeof alt.route_id).toBe('string')
    expect(typeof alt.summary).toBe('string')

    const facts = alt.route_facts
    expect(typeof facts.total_route_distance_km).toBe('number')
    expect(typeof facts.estimated_route_duration_min).toBe('number')
    expect(Array.isArray(facts.route_segments)).toBe(true)
    expect(facts.route_segments.length).toBeGreaterThan(0)
    for (const seg of facts.route_segments) {
      expect(['highway', 'normal_road', 'mountain_road', 'sightseeing_road']).toContain(seg.segment_type)
      expect(typeof seg.start_km).toBe('number')
      expect(typeof seg.length_km).toBe('number')
    }
    expect(Array.isArray(facts.rest_spot_positions)).toBe(true)
    expect(facts.rest_spot_positions.length).toBeGreaterThan(0)
    expect(facts.route_progress_checkpoints.length).toBe(3)
    // route_source/named_rest_spots are M4/M8 fields absent from the synced
    // RouteFacts type but present on the actual object shaped by
    // analyzeRouteMaps — assert through an untyped view.
    const factsAny = facts as unknown as { route_source: string; named_rest_spots: unknown[] }
    expect(factsAny.route_source).toBe('maps')
    expect(Array.isArray(factsAny.named_rest_spots)).toBe(true)
    expect(factsAny.named_rest_spots.length).toBe(facts.rest_spot_positions.length)

    const display = alt.display
    expect(display).not.toBeNull()
    expect(typeof display?.summary).toBe('string')
    expect(typeof display?.encoded_polyline).toBe('string')
    expect(display?.start_label).toBe('Tokyo Station')
    expect(display?.end_label).toBe('Chichibu Station')
  })

  it('throws on an unknown preset id (not-found convention)', async () => {
    await expect(loadRoutePreset('does_not_exist')).rejects.toThrow()
  })
})
