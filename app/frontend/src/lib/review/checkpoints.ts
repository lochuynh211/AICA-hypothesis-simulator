// app/frontend/src/lib/review/checkpoints.ts
/**
 * Derive the reviewable decision points from a run.
 *
 * Checkpoints are DERIVED, never authored — the design's Phase 1 authors no
 * expectations, so there is nothing to anchor an authored checkpoint to.
 *
 * V1 scope is exactly the FIRST `rest_required` fire and the FIRST
 * `monotony_prevention` fire, each with the proposal made at that moment.
 * Rest acceptance, the stopped stage and after-nap proposals still animate on
 * the timeline and stay visible in the centre — they are simply not selectable
 * as a review target.
 *
 * An EMPTY rail is a legitimate, informative outcome (the alert-daytime control
 * case exists to produce exactly that), never an error state.
 */
import type { MergedInstantResult } from '../../api/mergedClient'
import type { BilingualLabel } from './reviewVocabulary'
import { CATEGORY_LABELS } from './reviewVocabulary'

export type ReviewStage = 'trigger' | 'service' | 'content'

export type ReviewableCategory = 'rest_required' | 'monotony_prevention'

const IN_SCOPE: ReviewableCategory[] = ['rest_required', 'monotony_prevention']

export type Checkpoint = {
  /** Stable within a run — the category is unique because we take only the first. */
  id: ReviewableCategory
  category: ReviewableCategory
  /** Index into `result.fires`, so the proposal at this moment can be found. */
  fireIndex: number
  tick: number
  timeMin: number
  label: BilingualLabel
}

export function deriveCheckpoints(result: MergedInstantResult | null): Checkpoint[] {
  if (!result?.fires?.length) return []

  const seen = new Set<string>()
  const checkpoints: Checkpoint[] = []

  result.fires.forEach((fire, fireIndex) => {
    const category = fire.category as ReviewableCategory | null
    if (!category || !IN_SCOPE.includes(category) || seen.has(category)) return
    seen.add(category)
    checkpoints.push({
      id: category,
      category,
      fireIndex,
      tick: fire.tick,
      timeMin: fire.time_min,
      label: CATEGORY_LABELS[category],
    })
  })

  // Journey order, not category order — the rail reads as a timeline.
  return checkpoints.sort((a, b) => a.timeMin - b.timeMin)
}
