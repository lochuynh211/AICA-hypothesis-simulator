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
 * ## Rest LOCATIONS share the rest hue; shape is what separates them
 *
 * A rest-location marker is drawn in the SAME red as a rest-required fire, and
 * the two are told apart by **shape**: a circle is an event that fired, a square
 * is a place on the route. So colour answers *"what is this about?"* (red =
 * rest, orange = monotony) and shape answers *"is this a decision or a place?"*
 *
 * This replaced an amber `#f59e0b` for rest locations (owner request: make the
 * rest-spot square coherent with the red rest circle). The swap is also a
 * measured improvement, not just a preference:
 *
 *   - **Removed:** amber `#f59e0b` sat ΔE 4.2 from the monotony orange
 *     `#fb923c`, on markers that share the same route line. That is far below
 *     any usable floor — a full-colour reader could not reliably separate a
 *     rest LOCATION from a monotony FIRE. That collision no longer exists.
 *   - **Now load-bearing:** a red circle and a red square are separated by
 *     shape ALONE, with no colour difference to fall back on. Any surface
 *     drawing both must keep them visibly different shapes; drawing a rest
 *     location as a dot would make it unreadable as anything but a rest fire.
 *   - **Unchanged:** the only pair that still has to survive on colour is
 *     `#dc2626` ↔ `#fb923c`, which is the validated pair measured above.
 */

/** Rest-required trigger — the established red. */
export const TRIGGER_REST_COLOR = '#dc2626'

/** Monotony-prevention trigger. See the module docstring for the validation. */
export const TRIGGER_MONOTONY_COLOR = '#fb923c'

/**
 * Rest LOCATION markers (a place, not a fire) — drawn as a SQUARE, not a dot.
 *
 * Deliberately an alias rather than a repeated literal: the point of the colour
 * is "this is about rest", so if the rest hue is ever retuned the location
 * marker must move with it, not drift away from the fire it belongs to.
 */
export const REST_SPOT_COLOR = TRIGGER_REST_COLOR

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
