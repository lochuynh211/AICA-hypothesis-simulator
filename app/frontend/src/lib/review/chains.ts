// app/frontend/src/lib/review/chains.ts
/**
 * Build comparable `ReviewOption`s from RECORDED evidence.
 *
 * Nothing here recomputes a score: `score` is always the value the algorithm
 * reported, which can differ from Σcontribution when clamping bound. Where
 * evidence is absent these return `Unavailable` with a reason — never an
 * empty option list that would read as "nothing contributed".
 *
 * `serviceOptions`/`contentOptions` deliberately MIRROR the field mapping
 * `ServiceResultOverlay.tsx`'s `serviceRows()` and `ContentResultOverlay.tsx`'s
 * `contentRows()` already use to normalize `FeatureContribution` /
 * `ItemFeatureContribution` into the shared `ReasonRow` shape — a second,
 * independently-derived mapping here is precisely the drift this design
 * exists to prevent. See task-11-report.md for the line-by-line comparison.
 */
import type { MergedFirePoint } from '../../api/mergedClient'
import type { ProposalRunLog, ServiceSelectorOutput, CompletePlan, ItemFeatureContribution } from '../../api/proposalClient'
import { unavailable } from './types'
import type { ReviewOption, Unavailable } from './types'
import type { BilingualLabel } from './reviewVocabulary'

const CATEGORY_LABELS: Record<string, BilingualLabel> = {
  rest_required: { ja: '休憩の提案', en: 'Rest proposal' },
  monotony_prevention: { ja: '単調さへの介入', en: 'Monotony intervention' },
}

/**
 * The two trigger categories as comparable options.
 *
 * In V1 this is the COMPLETE category set, so the comparison is exhaustive
 * rather than a top-2 slice — and the runner-up's terms are read from the
 * record, never reconstructed from a weight table.
 */
export function triggerOptions(fire: MergedFirePoint): ReviewOption[] | Unavailable {
  const chains = fire?.feature_contributions
  if (!chains || Object.keys(chains).length === 0) {
    return unavailable('this trigger package recorded no per-feature contributions')
  }

  return Object.entries(chains).map(([category, chain]) => ({
    id: category,
    label: CATEGORY_LABELS[category] ?? { ja: category, en: category },
    score: chain.score,
    clamped: chain.clamped,
    rows: chain.rows.map((row) => ({
      featureId: row.feature_id,
      value: row.value,
      band: row.band,
      r: 1,          // the trigger is a plain weighted sum — no response coefficient
      w: row.weight,
      contribution: row.contribution,
    })),
  }))
}

/**
 * Find the LAST recorded evidence entry for `step` — mirrors
 * `MergedProposalPanel.tsx`'s `deriveProposalOverlay` (`proposalLog.evidence
 * .filter((ev) => ev.step === step).slice(-1)[0]`), the existing precedent
 * for reading "the current output" out of an append-only evidence array.
 */
function latestEvidence(proposal: ProposalRunLog, step: 'service' | 'content') {
  const matches = proposal.evidence.filter((ev) => ev.step === step)
  return matches[matches.length - 1]
}

/**
 * One option per ranked service candidate, ordered as recorded (rank 1
 * first). Mirrors `ServiceResultOverlay.tsx`'s `serviceRows()`:
 *
 *   featureId: fc.feature_id, value: fc.feature_value,
 *   r: fc.response_coefficient, w: fc.weight, contribution: fc.contribution
 *
 * A candidate whose `score` is `null` (the LLM-shaped-output case — out of
 * V1 review scope, see task-11-report.md) is left out rather than given a
 * fabricated numeric score, since `ReviewOption.score` is non-nullable by
 * design (Task 3). If EVERY recorded candidate is LLM-shaped, the filtered
 * result is empty — but "empty" here would silently read as "the algorithm
 * produced nothing", a different and false statement from "these could not
 * be compared". That case returns `Unavailable` instead.
 */
export function serviceOptions(proposal: ProposalRunLog | null): ReviewOption[] | Unavailable {
  if (!proposal) return unavailable('no proposal was recorded at this checkpoint')

  const serviceEv = latestEvidence(proposal, 'service')
  if (!serviceEv || serviceEv.output == null) {
    return unavailable('this proposal recorded no service-selector evidence')
  }

  const output = serviceEv.output as unknown as ServiceSelectorOutput
  const candidates = output.ranked_candidates ?? []

  const options = candidates
    .filter((candidate) => candidate.score !== null)
    .map((candidate) => ({
      id: candidate.candidate_id,
      label: { ja: candidate.candidate_id, en: candidate.candidate_id },
      score: candidate.score as number,
      rows: candidate.feature_contributions.map((fc) => ({
        featureId: fc.feature_id,
        value: fc.feature_value,
        band: null,
        r: fc.response_coefficient,
        w: fc.weight,
        contribution: fc.contribution,
      })),
    }))

  if (options.length === 0 && candidates.length > 0) {
    return unavailable('every recorded candidate was LLM-shaped (no numeric score)')
  }

  return options
}

function contentRow(fc: ItemFeatureContribution) {
  return {
    featureId: fc.feature_id,
    value: fc.e_i,
    band: null,
    r: fc.a_i,
    w: fc.effective_weight,
    contribution: fc.contribution,
  }
}

/** `contentOptions`'s success shape — `options` alone cannot say whether the
 * scored tail was capped, so `tailTruncated` (mirrors `CompletePlan.tail_truncated`,
 * Task 2's B2) travels alongside it rather than being silently dropped. */
export type ContentOptions = { options: ReviewOption[]; tailTruncated: boolean }

/**
 * The ordered plan items followed by the `scored_tail` entries (Task 2), so
 * every position below rank 1 has a real runner-up. Mirrors
 * `ContentResultOverlay.tsx`'s `contentRows()`:
 *
 *   featureId: fc.feature_id, value: fc.e_i, r: fc.a_i,
 *   w: fc.effective_weight, contribution: fc.contribution
 *
 * An `ordered_items` entry whose `item_fit` is `null` (the LLM-shaped-plan
 * case) is left out for the same non-nullable-`score` reason as
 * `serviceOptions`; `scored_tail`'s `item_fit` is never null. If every
 * recorded item was LLM-shaped, the filtered result is empty — but that
 * would silently read as "the algorithm produced nothing", so that case
 * returns `Unavailable` instead (same reasoning as `serviceOptions`).
 */
export function contentOptions(proposal: ProposalRunLog | null): ContentOptions | Unavailable {
  if (!proposal) return unavailable('no proposal was recorded at this checkpoint')

  const contentEv = latestEvidence(proposal, 'content')
  if (!contentEv || contentEv.output == null) {
    return unavailable('this proposal recorded no content-selector evidence')
  }

  const plan = contentEv.output as unknown as CompletePlan

  const orderedItems = plan.ordered_items ?? []
  const tail = plan.scored_tail ?? []

  const orderedOptions = orderedItems
    .filter((item) => item.item_fit !== null)
    .map((item) => ({
      id: item.item_id,
      label: { ja: item.item_id, en: item.item_id },
      score: item.item_fit as number,
      rows: item.feature_contributions.map(contentRow),
    }))

  const tailOptions = tail.map((item) => ({
    id: item.item_id,
    label: { ja: item.item_id, en: item.item_id },
    score: item.item_fit,
    rows: item.feature_contributions.map(contentRow),
  }))

  const options = [...orderedOptions, ...tailOptions]

  if (options.length === 0 && orderedItems.length + tail.length > 0) {
    return unavailable('every recorded item was LLM-shaped (no numeric item_fit)')
  }

  return { options, tailTruncated: plan.tail_truncated ?? false }
}
