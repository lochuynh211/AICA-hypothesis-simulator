/**
 * Painter service — TS port of `app/api/aica_api/services/merged_painter.py`
 * (feature 026, htmlapp Combined export, slice C4 Task 2).
 *
 * Two pure functions used to compose ad-hoc merged scenarios without needing
 * new scenario JSON fixtures:
 *
 * - `injectMountainSegment` splits an ascending non-overlapping
 *   `RouteSegmentFact` list (POSITION-native — km extents) so a km range
 *   becomes a `mountain_road` run, preserving total route length.
 * - `jamTrafficEvent` converts a km range into a POSITION-native
 *   `TrafficEvent` preset (`start_km`/`end_km`, with `start_min`/
 *   `duration_min` retained as a time-axis fallback for consumers that don't
 *   read km), the only supported way to inject a traffic jam into a draft
 *   (there is no pre-built EventPlan parameter).
 *
 * Both functions are pure: no IO, no clock/random, no mutation of inputs.
 *
 * ── Reuse, not rewrite ──────────────────────────────────────────────────────
 * `RouteSegmentFact` comes from the already-shared `api/types.ts` (used by
 * `RouteFacts` throughout the trigger-side port, e.g. `engine/tick_engine.ts`);
 * `TrafficEvent`'s shape (`id`/`start_min`/`duration_min`/
 * `affected_segment_id`/`speed_kph`/`start_km`/`end_km`) is EXACTLY
 * `jamTrafficEvent`'s return shape, so this reuses `engine/event_plan.ts`'s
 * existing `TrafficEvent` type rather than declaring a near-duplicate.
 *
 * ── Divergence hazard pass (see task-2-report.md for the full table) ───────
 * - Hazards 1/2/6/7/8 (banker's rounding, `sorted()`, `neumaierSum`,
 *   `pyFixed`, `isinstance` bool-acceptance): none apply — the full 136-LOC
 *   Python source has zero `round()`, zero `sort`/`sorted`, zero `sum()`,
 *   zero `:.Nf` format specs, and zero `isinstance` calls (read in full,
 *   not sampled).
 * - Hazard 3 (`//`/`%` floor division): not present — `jam_traffic_event`
 *   uses plain `/` true division throughout (`start_km / total_km`, etc.),
 *   which is IEEE-754 double division in BOTH Python and JS — bit-identical
 *   for the same operands, not merely "usually agrees". The one REAL
 *   divergence at this exact call shape is unrelated to hazard 3: Python's
 *   `/` on `total_km == 0.0` raises `ZeroDivisionError`, while JS's `/`
 *   silently produces `Infinity`/`NaN`. `jamTrafficEvent` therefore GUARDS
 *   and throws, so the two agree on failing loudly.
 *
 *   This is REACHABLE, not theoretical — an earlier revision of this comment
 *   claimed otherwise and was wrong, so the correction is recorded here.
 *   No Pydantic validator constrains `total_route_distance_km` or
 *   `total_duration_seconds` to be positive, and two ordinary data-authoring
 *   paths reach zero: `analyze_route` derives `total_km` from
 *   `(total_duration_seconds / 3600) * speed` when no distance preset exists,
 *   so a scenario with `total_duration_seconds: 0` gives `0.0`; and
 *   `load_route_preset` computes `distance_m / 1000.0`, so a preset with
 *   `distance_m: 0` gives `0.0`.
 *
 *   Mirroring the crash rather than the arithmetic is the right reading of
 *   "the Python is the behaviour of record": Python's failure is an
 *   unhandled 500 (`main.py` registers no exception handler), whereas an
 *   unguarded JS `Infinity` serialises through `JSON.stringify` to `null`
 *   and reports success while returning corrupted data.
 * - Hazard 4 (dict/insertion order): `injectMountainSegment` builds a NEW
 *   list via ordered `result.append(...)` (Python) / `result.push(...)`
 *   (TS) in the SAME sequence per segment (before-piece, mid mountain
 *   piece, after-piece), iterating `segments` in the caller's given order —
 *   genuinely order-sensitive output, but via LIST push/append order, which
 *   both languages preserve identically for the same sequence of
 *   operations — not a dict-iteration-order risk (no dict/object is
 *   iterated to produce output order anywhere in this module). Proven
 *   structurally (not just "currently agrees") in
 *   `tests/merged_painter_port.test.ts` by asserting the exact
 *   `segment_type` sequence for a range spanning two real segments.
 * - Hazard 5 (bare `str(float)`/f-string float interpolation): none — no
 *   f-strings in this module.
 *
 * `RouteSegmentFact.model_config = {"extra": "allow"}` in Python (see
 * `models/run.py:134`) means a segment object may carry fields beyond
 * `segment_type`/`start_km`/`length_km`, and Python's actual behavior is
 * asymmetric: a segment with NO overlap is appended AS-IS (`result.append(seg)`
 * — the SAME object, extra fields and all), while a segment that IS split
 * has its before/mid/after pieces constructed via
 * `RouteSegmentFact(segment_type=..., start_km=..., length_km=...)` — ONLY
 * those 3 fields, silently DROPPING any extra fields the original segment
 * carried. This port mirrors that exact asymmetry: the no-overlap branch
 * pushes the original `seg` reference/object verbatim (preserving whatever
 * extra runtime properties it has, even though `RouteSegmentFact`'s
 * imported TS type only declares the 3 well-known fields); the split
 * branches construct fresh 3-key object literals. Covered explicitly in
 * the test file with a segment carrying a synthetic extra field.
 */
import type { RouteSegmentFact } from '../../api/types'
import type { TrafficEvent } from '../event_plan'

// ---------------------------------------------------------------------------
// injectMountainSegment
// ---------------------------------------------------------------------------

/**
 * Mirrors `inject_mountain_segment` (merged_painter.py:31-102).
 *
 * Splits `segments` so `[startKm, endKm)` becomes a `mountain_road` run.
 * `segments` is an ascending, non-overlapping, contiguous list — each seg
 * covers `[seg.start_km, seg.start_km + seg.length_km)`. The requested
 * range is clamped to `[0, total]` where `total` is the route's overall
 * length (end of the last segment). Any segment overlapped by the clamped
 * range is split into up to 3 pieces: a "before" piece keeping the
 * original type, the overlapped `[start,end)` slice retyped to
 * `mountain_road`, and an "after" piece keeping the original type —
 * zero-length before/after pieces are dropped. Segments with no overlap
 * are passed through unchanged (same object).
 *
 * Total length is preserved and the result stays ascending/non-overlapping.
 *
 * Returns a new array; never mutates `segments` or its elements. An empty
 * `segments` array, or an invalid/empty range (clamped `start >= end`),
 * returns a shallow copy of `segments` unchanged.
 */
export function injectMountainSegment(
  segments: RouteSegmentFact[],
  startKm: number,
  endKm: number,
): RouteSegmentFact[] {
  if (segments.length === 0) return [...segments]

  const last = segments[segments.length - 1]
  const totalKm = last.start_km + last.length_km
  const clampedStart = Math.max(0.0, Math.min(startKm, totalKm))
  const clampedEnd = Math.max(0.0, Math.min(endKm, totalKm))

  if (clampedStart >= clampedEnd) return [...segments]

  const result: RouteSegmentFact[] = []
  for (const seg of segments) {
    const segStart = seg.start_km
    const segEnd = seg.start_km + seg.length_km

    const overlapStart = Math.max(segStart, clampedStart)
    const overlapEnd = Math.min(segEnd, clampedEnd)

    if (overlapStart >= overlapEnd) {
      // No overlap with the mountain range — keep as-is (same object,
      // preserving any extra fields — see module doc comment).
      result.push(seg)
      continue
    }

    if (overlapStart > segStart) {
      result.push({ segment_type: seg.segment_type, start_km: segStart, length_km: overlapStart - segStart })
    }

    result.push({ segment_type: 'mountain_road', start_km: overlapStart, length_km: overlapEnd - overlapStart })

    if (segEnd > overlapEnd) {
      result.push({ segment_type: seg.segment_type, start_km: overlapEnd, length_km: segEnd - overlapEnd })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// jamTrafficEvent
// ---------------------------------------------------------------------------

export type JamTrafficEventOptions = {
  speedKph?: number
  eventId?: string
  affectedSegmentId?: string
}

/**
 * Mirrors `jam_traffic_event` (merged_painter.py:110-136) — Python's
 * `speed_kph`/`event_id`/`affected_segment_id` are keyword-only with
 * defaults; mirrored here as one optional trailing options object so no
 * positional call site is affected by adding a new option later.
 *
 * Converts a km range into a POSITION-native `TrafficEvent` preset.
 * `TrafficEvent` (the engine's fact model) now carries optional `start_km`/
 * `end_km` alongside its original TIME fields. Since routes are not
 * time-linear in distance (multiple segment speeds + auto-rest stops), the
 * km range is set directly on `start_km`/`end_km` so the tick engine
 * (`activeTrafficJam`) gates congestion on the actual route position the jam
 * was painted at. `start_min`/`duration_min` are still computed via the
 * naive uniform conversion (`start_min = (start_km/total_km) *
 * est_duration_min`, `duration_min = ((end_km-start_km)/total_km) *
 * est_duration_min`) and RETAINED as a time-axis fallback for consumers that
 * don't read km (e.g. legacy time-only jam handling). `affectedSegmentId` is
 * display-only (the tick engine never reads it to decide congestion).
 */
export function jamTrafficEvent(
  startKm: number,
  endKm: number,
  totalKm: number,
  estDurationMin: number,
  { speedKph = 15.0, eventId = 'manual_jam', affectedSegmentId = 'manual' }: JamTrafficEventOptions = {},
): TrafficEvent {
  // Mirrors Python's ZeroDivisionError on `total_km == 0`. Python's `/` raises;
  // JS's `/` yields Infinity/NaN, which `JSON.stringify` then serialises as
  // `null` — a call that reports SUCCESS while returning corrupted data. Worse,
  // NaN compares false against everything, so a NaN-cased TrafficEvent's
  // time-window checks never match and the injected jam silently never
  // activates. Throwing keeps the failure loud, as it is in the docker app.
  if (totalKm === 0) {
    throw new Error('jamTrafficEvent: total_km is 0 (float division by zero)')
  }
  return {
    id: eventId,
    start_min: (startKm / totalKm) * estDurationMin,
    duration_min: ((endKm - startKm) / totalKm) * estDurationMin,
    affected_segment_id: affectedSegmentId,
    speed_kph: speedKph,
    start_km: startKm,
    end_km: endKm,
  }
}
