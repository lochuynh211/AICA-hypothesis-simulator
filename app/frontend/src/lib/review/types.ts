// app/frontend/src/lib/review/types.ts
/**
 * Shared review types.
 *
 * `ReviewChainRow` is deliberately the shape `ReasonRow` already uses
 * (see components/proposal/ReasonBreakdown.tsx) plus the ordinal `band`, so
 * service and content evidence needs no re-projection — the review reads the
 * chains where they already are.
 */

/** One feature's recorded link in a decision chain. */
export type ReviewChainRow = {
  featureId: string
  /**
   * The raw value the formula consumed. `string | number` to match `ReasonRow`
   * exactly — service and content features include categoricals (`road_type`
   * is "highway"), and narrowing to number would leave the service/content
   * mapping with nowhere to put them. A categorical carries no derived band.
   */
  value: string | number
  /** Ordinal band word for `value`, or null when none was recorded. */
  band: string | null
  /** Response coefficient. The trigger has none, so trigger rows use 1. */
  r: number
  /** Effective weight. */
  w: number
  /** Signed contribution as recorded — never recomputed here. */
  contribution: number
}

/** One comparable option: a trigger category, a service candidate, a plan item. */
export type ReviewOption = {
  id: string
  label: string
  /** The score as RECORDED, which may differ from Σcontribution when clamped. */
  score: number
  rows: ReviewChainRow[]
  /** True when clamping bound, so shares will not reconcile with `score`. */
  clamped?: boolean
}

export type MarginRow = {
  featureId: string
  left: number
  right: number
  /** left − right. Positive pulls toward the left option. */
  margin: number
  lean: 'left' | 'right' | 'none'
}

/** Returned wherever required evidence was not recorded. Never a zero. */
export type Unavailable = { available: false; reason: string }

export const unavailable = (reason: string): Unavailable => ({ available: false, reason })
