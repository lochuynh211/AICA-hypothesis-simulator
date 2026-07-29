/**
 * The one place trigger-marker colors are defined.
 *
 * A fired proposal is drawn in three separate surfaces — the Google map
 * (`MapSurface`), the keyless route schematic (`FallbackRouteMap`), and the
 * quickview/playback strip (`ScoreTimeline`). Each used to hardcode its own
 * values, and they disagreed: the real map painted EVERY fire red regardless of
 * category, the schematic used red/violet, and the strip drew monotony fires in
 * the same teal as the monotony score curve (so they read as absent). One table,
 * imported by all three, is what keeps "red means rest" true everywhere.
 *
 * ## Why these two hues
 *
 * Rest and monotony triggers are a categorical pair the reviewer must tell apart
 * at a glance, so the pair was validated rather than eyeballed (the `dataviz`
 * skill's `validate_palette.js`, light surface):
 *
 *     #dc2626 (rest) ↔ #fb923c (monotony)
 *       normal-vision ΔE 21.0   (floor 15)   PASS
 *       CVD worst     ΔE 17.7 deutan / 15.7 tritan  (target ≥ 8)  PASS
 *
 * Warmer, more "obvious" oranges were rejected on measurement, not taste —
 * `#ea580c` sits at ΔE 8.7 from the red and `#f97316` at 14.9, both below the
 * normal-vision floor: a full-colour reader cannot reliably tell those apart
 * from the red rest marker, which is the entire job of the encoding.
 *
 * ## Why rest-spot markers are a different SHAPE, not a different hue
 *
 * `#fb923c` is only ΔE 4.2 from the amber `#f59e0b` of the rest-LOCATION
 * markers, which sit on the same route line — indistinguishable. Rather than
 * spend a third warm hue nobody can separate, the two are split on the channel
 * that actually has room: **shape encodes what kind of thing it is** (a circle
 * is an event that fired, a square is a place on the route), and **color
 * encodes which trigger** fired. Recoloring the long-standing amber
 * rest-location marker would have been the more disruptive fix for the same
 * result.
 */

/** Rest-required trigger — the established red. */
export const TRIGGER_REST_COLOR = '#dc2626'

/** Monotony-prevention trigger. See the module docstring for the validation. */
export const TRIGGER_MONOTONY_COLOR = '#fb923c'

/** Rest LOCATION markers (a place, not a fire) — drawn as a square, not a dot. */
export const REST_SPOT_COLOR = '#f59e0b'

/**
 * True for the rest-required category.
 *
 * Callers pass the backend's `selected_category` verbatim, which is
 * `"rest_required"` / `"monotony_prevention"` / null. The prefix test (rather
 * than equality) matches what the three call sites already did independently,
 * and keeps a null/unknown category on the monotony branch rather than
 * mislabeling it as a rest proposal.
 */
export function isRestCategory(category: string | null | undefined): boolean {
  return (category ?? '').startsWith('rest')
}

/** Marker/line color for a fired proposal of `category`. */
export function triggerColor(category: string | null | undefined): string {
  return isRestCategory(category) ? TRIGGER_REST_COLOR : TRIGGER_MONOTONY_COLOR
}
