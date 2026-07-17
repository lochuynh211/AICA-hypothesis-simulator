/**
 * fitBand (feature 018 US4, FR — "scores that communicate strength
 * honestly") — a stable, friendlier 0-100 display band derived from a raw
 * signed selector score/fit in [-1, +1]:
 *
 *   fitBand(raw) = clamp((raw + 1) * 50, 0, 100)
 *
 * Endpoints: -1 -> 0, 0 -> 50, +1 -> 100. Purely a DISPLAY transform — it
 * never feeds back into any selector's scoring math, which stays
 * authoritative and is always rendered alongside this band, never replaced
 * by it (Constitution II — no fabricated/derived decision inputs).
 */
export function fitBand(raw: number): number {
  return Math.max(0, Math.min(100, (raw + 1) * 50))
}
