// app/frontend/src/lib/review/reviewMath.ts
/**
 * Presentation arithmetic over ALREADY-RECORDED decision chains.
 *
 * Nothing here invokes an algorithm or alters a score. Framework-free and
 * I/O-free by design so it stays unit-testable standalone.
 */
import type { MarginRow, ReviewChainRow, ReviewOption } from './types'

/** Readable axis steps, ascending within each decade. */
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]

/**
 * One shared bound across both comparison columns, rounded up to the first
 * readable value STRICTLY above the largest magnitude — 0.299 → 0.3,
 * 0.11 → 0.125. Strictness matters: a bar that exactly fills its track reads
 * as clipped rather than as the maximum.
 */
export function scaleBound(magnitudes: number[]): number {
  const peak = Math.max(0, ...magnitudes.map((m) => Math.abs(m)))
  if (peak === 0) return STEPS[0] / 100 // a visible, honest axis for an all-zero chain
  const decade = Math.pow(10, Math.floor(Math.log10(peak)))
  for (const step of STEPS) {
    // `step * decade` is not exact in IEEE-754 — 3 * 0.1 is 0.30000000000000004,
    // 1.5 * 0.1 is 0.15000000000000002. The bound is DISPLAYED ("±0.3"), so it
    // has to be the clean decimal a reader expects, not its float residue.
    const candidate = Number((step * decade).toPrecision(12))
    if (candidate > peak) return candidate
  }
  return Number((10 * decade).toPrecision(12))
}

/**
 * Per-feature contribution to the LEFT option minus to the RIGHT one — the
 * decomposition of the margin, not of either total. A feature can be the
 * largest contributor to the winner and contribute nothing to the gap.
 */
export function marginRows(left: ReviewOption, right: ReviewOption): MarginRow[] {
  const byId = (rows: ReviewChainRow[]) =>
    new Map(rows.map((r) => [r.featureId, r.contribution]))
  const l = byId(left.rows)
  const r = byId(right.rows)

  const featureIds = Array.from(new Set([...l.keys(), ...r.keys()]))
  return featureIds
    .map((featureId) => {
      const leftValue = l.get(featureId) ?? 0
      const rightValue = r.get(featureId) ?? 0
      const margin = leftValue - rightValue
      return {
        featureId,
        left: leftValue,
        right: rightValue,
        margin,
        lean: margin > 1e-9 ? 'left' : margin < -1e-9 ? 'right' : 'none',
      } as MarginRow
    })
    .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))
}

/** |contribution| / Σ|contribution| — the share a feature ACTUALLY took. */
export function realizedShares(rows: ReviewChainRow[]): Record<string, number> {
  const total = rows.reduce((sum, row) => sum + Math.abs(row.contribution), 0)
  const shares: Record<string, number> = {}
  for (const row of rows) {
    shares[row.featureId] = total === 0 ? 0 : Math.abs(row.contribution) / total
  }
  return shares
}

/** The INTENDED share of influence, normalized across the stage's weights. */
export function declaredShares(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((sum, w) => sum + Math.abs(w), 0)
  const shares: Record<string, number> = {}
  for (const [featureId, w] of Object.entries(weights)) {
    shares[featureId] = total === 0 ? 0 : Math.abs(w) / total
  }
  return shares
}

/** Deviation below this reads as agreement rather than as a finding. */
const EVEN_BAND = 0.15

/**
 * realized / declared. Algebraically this reduces to the feature's evidence
 * magnitude relative to the weighted average, so 'up' means *this feature's
 * evidence is unusually extreme here* — not that its weight is wrong.
 */
export function intentVsEffect(realized: number, declared: number): 'up' | 'down' | 'even' {
  if (declared === 0) return realized > 1e-9 ? 'up' : 'even'
  const ratio = realized / declared
  if (ratio > 1 + EVEN_BAND) return 'up'
  if (ratio < 1 - EVEN_BAND) return 'down'
  return 'even'
}

import { unavailable } from './types'
import type { Unavailable } from './types'

const total = (rows: ReviewChainRow[]) => rows.reduce((sum, r) => sum + r.contribution, 0)

/**
 * Mask one feature, redistribute its weight proportionally across the option's
 * remaining features, re-sum, and report who wins now.
 *
 * Redistribution — rather than simply deleting the term — keeps the option's
 * total declared weight constant, so the comparison stays like-for-like instead
 * of penalising whichever side the masked feature happened to sit on.
 */
export function necessity(
  left: ReviewOption,
  right: ReviewOption,
  featureId: string,
): { winnerId: string; changed: boolean } | Unavailable {
  const present = [left, right].some((o) => o.rows.some((r) => r.featureId === featureId))
  if (!present) return unavailable(`no recorded contribution for ${featureId}`)

  const masked = (option: ReviewOption): number | null => {
    const target = option.rows.find((r) => r.featureId === featureId)
    if (!target) return total(option.rows)
    const rest = option.rows.filter((r) => r.featureId !== featureId)
    const restWeight = rest.reduce((sum, r) => sum + Math.abs(r.w), 0)
    if (rest.length === 0 || restWeight === 0) return null
    const scale = (restWeight + Math.abs(target.w)) / restWeight
    return rest.reduce((sum, r) => sum + r.contribution * scale, 0)
  }

  const leftScore = masked(left)
  const rightScore = masked(right)
  if (leftScore === null || rightScore === null) {
    return unavailable('no other feature could absorb the redistributed weight')
  }

  const winnerId = leftScore >= rightScore ? left.id : right.id
  // The baseline winner comes from the RECORDED scores, never from re-summing
  // contributions: a clamped option's Σcontribution exceeds its reported score,
  // so the two can disagree about who actually won. Only the post-mask scores
  // are re-summed, because no recorded value exists for a hypothetical.
  const originalWinner = left.score >= right.score ? left.id : right.id
  return { winnerId, changed: winnerId !== originalWinner }
}

/** Bisection bounds for the weight multiplier, and the resolution we report to. */
const FLIP_MAX = 10
const FLIP_TOLERANCE = 1e-3

/**
 * The factor by which this feature's declared weight would have to change for
 * the outcome to flip. Bisects over the RECORDED chain — it never re-invokes
 * the algorithm. Returns null when no flip exists below FLIP_MAX.
 *
 * Both sides are re-scored, because a feature (env_load, monotony) can appear
 * in both options and scaling only one would report an impossible flip.
 */
export function flipDistance(
  left: ReviewOption,
  right: ReviewOption,
  featureId: string,
): { factor: number } | null | Unavailable {
  const present = [left, right].some((o) => o.rows.some((r) => r.featureId === featureId))
  if (!present) return unavailable(`no recorded contribution for ${featureId}`)

  const scoreAt = (option: ReviewOption, factor: number) =>
    option.rows.reduce(
      (sum, r) => sum + (r.featureId === featureId ? r.contribution * factor : r.contribution),
      0,
    )
  // Positive while the original winner still leads.
  const gapAt = (factor: number) => scoreAt(left, factor) - scoreAt(right, factor)

  const startsLeft = gapAt(1) >= 0
  const flipped = (factor: number) => (startsLeft ? gapAt(factor) < 0 : gapAt(factor) > 0)

  if (!flipped(FLIP_MAX)) return null

  let low = 1
  let high = FLIP_MAX
  while (high - low > FLIP_TOLERANCE) {
    const mid = (low + high) / 2
    if (flipped(mid)) high = mid
    else low = mid
  }
  return { factor: high }
}

/**
 * Inputs whose realized share is below the threshold. Their absence is often
 * the most reviewable fact on the screen — "the driver's registered favourite
 * artist played no part" may well be a bug.
 */
export function playedNoPart(rows: ReviewChainRow[], threshold = 0.02): string[] {
  const shares = realizedShares(rows)
  return rows.filter((r) => (shares[r.featureId] ?? 0) < threshold).map((r) => r.featureId)
}
