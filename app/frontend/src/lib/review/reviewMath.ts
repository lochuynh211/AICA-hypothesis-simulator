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
