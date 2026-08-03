import { describe, expect, it } from 'vitest'
import { injectMountainSegment, jamTrafficEvent } from '../src/engine/merged/painter'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import type { RouteSegmentFact } from '../src/api/types'

/**
 * Conformance test for `src/engine/merged/painter.ts` — the port of
 * `app/api/aica_api/services/merged_painter.py` (feature 026, htmlapp
 * Combined export, slice C4 Task 2).
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_painter.json`, captured by
 * `scripts/gen/capture_all.py#_capture_merged_painter` — REAL route facts
 * from `route_analysis.json`'s own committed `analyze_route()` output (4
 * segments: normal_road[0,24), normal_road[24,60), normal_road[60,90),
 * highway[90,120), total 120km), fed through the REAL Python
 * `inject_mountain_segment`/`jam_traffic_event`.
 *
 * ── Branch coverage table ────────────────────────────────────────────────
 *
 * `injectMountainSegment`:
 *   - fully-inside-one-segment 3-piece split: REAL (`real_fully_inside_first_segment`).
 *   - spanning-two-segments split (both halves distinct pieces): REAL
 *     (`real_spanning_normal_road_highway_boundary` — spans the real
 *     normal_road/highway boundary at km 90, so the two resulting adjacent
 *     `mountain_road` pieces sit between segments of DIFFERENT original
 *     types, going further than the Python unit test's own two-segment
 *     case, which uses highway+normal_road — here it's normal_road+highway,
 *     complementary real coverage).
 *   - invalid range (clamped start >= end) returns unchanged: REAL
 *     (`real_invalid_range_start_gte_end`).
 *   - range clamped to total extent (whole route retyped): REAL
 *     (`real_range_clamped_to_total_extent` — notably each of the 4 real
 *     segments becomes its OWN single mountain_road piece, no before/after
 *     splits, since each is fully overlapped).
 *   - empty `segments` input: real call, but on a hand-built `[]` (there is
 *     no "real committed empty route" to source this from — an empty route
 *     is not a shape `analyze_route` ever produces for a real scenario;
 *     labeled synthetic for that reason, though the FUNCTION call itself is
 *     the real Python `inject_mountain_segment([], ...)`).
 *   - a segment carrying an extra field (`RouteSegmentFact`'s
 *     `extra="allow"` asymmetry: preserved on pass-through, dropped on a
 *     split piece): NOT reachable from real captured data (real route
 *     facts never carry extra fields) — synthetic, hand-built below,
 *     mirroring the Python model's own `extra="allow"` config directly.
 *
 * `jamTrafficEvent`: default-kwargs and keyword-override paths both real,
 * against the real route's total_km (120.0) and estimated duration
 * (108.0min). The `total_km == 0` division-by-zero divergence (Python
 * raises `ZeroDivisionError`; JS silently produces `NaN`) is NOT covered —
 * a real route's total_km is never 0 in practice; see painter.ts's own doc
 * comment for why this is disclosed rather than test-covered.
 */

type MergedPainterFixture = {
  input: {
    real_segments: RouteSegmentFact[]
    real_total_km: number
    real_duration_min: number
  }
  output: {
    mountain_cases: Record<string, { start_km: number; end_km: number; result: RouteSegmentFact[] }>
    jam_cases: Record<string, { id: string; start_min: number; duration_min: number; affected_segment_id: string; speed_kph: number }>
  }
}

const { input, output } = loadFixture('merged_painter') as MergedPainterFixture

describe('merged/painter.ts parity (C4 Task 2)', () => {
  it('injectMountainSegment reproduces inject_mountain_segment over every real committed mountain_cases entry', () => {
    for (const [name, c] of Object.entries(output.mountain_cases)) {
      const segments = name === 'empty_segments_list' ? [] : input.real_segments
      const actual = injectMountainSegment(segments, c.start_km, c.end_km)
      expectParity(actual, c.result, name)
    }
  })

  it('injectMountainSegment: spanning-two-differently-typed-segments case, checked structurally (hazard 4 — list order)', () => {
    const c = output.mountain_cases.real_spanning_normal_road_highway_boundary
    const actual = injectMountainSegment(input.real_segments, c.start_km, c.end_km)
    expect(actual.map((s) => s.segment_type)).toEqual([
      'normal_road',
      'normal_road',
      'normal_road',
      'mountain_road',
      'mountain_road',
      'highway',
    ])
    // Total length preserved.
    const total = actual.reduce((sum, s) => sum + s.length_km, 0)
    expect(total).toBeCloseTo(120.0, 9)
    // Ascending, non-overlapping, contiguous.
    let expectedStart = 0
    for (const seg of actual) {
      expect(seg.start_km).toBeCloseTo(expectedStart, 9)
      expectedStart += seg.length_km
    }
  })

  it('injectMountainSegment: never mutates the input array or its elements', () => {
    const original = input.real_segments.map((s) => ({ ...s }))
    injectMountainSegment(input.real_segments, 5.0, 15.0)
    expect(input.real_segments).toEqual(original)
  })

  it('injectMountainSegment: returns a NEW array reference, never the same array', () => {
    const result = injectMountainSegment(input.real_segments, 5.0, 15.0)
    expect(result).not.toBe(input.real_segments)
  })

  it('jamTrafficEvent reproduces jam_traffic_event over both real committed jam_cases entries', () => {
    const defaultCase = output.jam_cases.real_default_kwargs
    expectParity(jamTrafficEvent(30.0, 50.0, input.real_total_km, input.real_duration_min), defaultCase, 'real_default_kwargs')

    const overrideCase = output.jam_cases.real_keyword_overrides
    expectParity(
      jamTrafficEvent(0.0, 10.0, input.real_total_km, input.real_duration_min, {
        speedKph: 5.0,
        eventId: 'jam-2',
        affectedSegmentId: 'seg-7',
      }),
      overrideCase,
      'real_keyword_overrides',
    )
  })

  // ── Synthetic branch coverage — labeled, with justification ────────────
  describe('synthetic branch coverage (labeled — no real committed golden reaches these)', () => {
    it('injectMountainSegment: empty segments list returns an empty array (real routes are never empty)', () => {
      expect(injectMountainSegment([], 10.0, 20.0)).toEqual([])
    })

    it('injectMountainSegment: extra="allow" asymmetry — the per-segment no-overlap pass-through KEEPS an extra field, a split piece DROPS it (real route facts never carry extra fields, so this is exercised only on hand-built segments)', () => {
      const segA = { segment_type: 'highway', start_km: 0.0, length_km: 50.0, custom_id: 'seg-alpha' } as RouteSegmentFact & { custom_id: string }
      const segB = { segment_type: 'normal_road', start_km: 50.0, length_km: 50.0, custom_id: 'seg-beta' } as RouteSegmentFact & { custom_id: string }
      // Range [60,80) overlaps ONLY segB — segA takes the per-segment
      // "no overlap -> continue" branch (distinct from the top-level
      // invalid-range early return), so its extra field must survive.
      const result = injectMountainSegment([segA, segB], 60.0, 80.0)
      expect(result[0]).toBe(segA)
      expect((result[0] as unknown as { custom_id: string }).custom_id).toBe('seg-alpha')

      // segB DOES overlap and splits into 3 pieces — none may carry custom_id.
      const segBPieces = result.slice(1)
      expect(segBPieces).toHaveLength(3)
      expect(segBPieces.map((s) => s.segment_type)).toEqual(['normal_road', 'mountain_road', 'normal_road'])
      for (const piece of segBPieces) {
        expect('custom_id' in piece, JSON.stringify(piece)).toBe(false)
      }
    })

    it('jamTrafficEvent: default keyword values (speedKph=15.0, eventId="manual_jam", affectedSegmentId="manual") when options are omitted entirely', () => {
      const result = jamTrafficEvent(10.0, 20.0, 100.0, 60.0)
      expect(result.id).toBe('manual_jam')
      expect(result.affected_segment_id).toBe('manual')
      expect(result.speed_kph).toBe(15.0)
    })

    // Python's `/` raises ZeroDivisionError here; JS's `/` yields Infinity/NaN.
    // Verified against the real Python:
    //   $ PYTHONPATH=app/api app/api/.venv/bin/python3 -c \
    //       "from aica_api.services.merged_painter import jam_traffic_event; \
    //        jam_traffic_event(30.0, 50.0, 0.0, 100.0)"
    //   ZeroDivisionError: float division by zero
    //
    // Reachable through ordinary data authoring, not contrived input: nothing
    // constrains total_route_distance_km or total_duration_seconds to be
    // positive, and analyze_route derives total_km from
    // (total_duration_seconds / 3600) * speed when no distance preset exists.
    it('jamTrafficEvent: totalKm === 0 throws, mirroring Python ZeroDivisionError', () => {
      expect(() => jamTrafficEvent(30.0, 50.0, 0.0, 100.0)).toThrow(/division by zero/)
    })

    // The guard must be loud, not merely non-crashing. Without it JS returns
    // Infinity, which JSON.stringify serialises as null — a call that reports
    // success while returning corrupted data. This asserts the failure never
    // takes that silent shape.
    it('jamTrafficEvent: totalKm === 0 never yields a non-finite or null-serialising result', () => {
      let result: unknown
      try {
        result = jamTrafficEvent(30.0, 50.0, 0.0, 100.0)
      } catch {
        return // threw, as required
      }
      throw new Error(
        `expected a throw; got ${JSON.stringify(result)} (JSON.stringify hides Infinity as null)`,
      )
    })
  })
})
