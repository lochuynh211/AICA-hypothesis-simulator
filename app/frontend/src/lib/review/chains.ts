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
import type {
  ProposalRunLog,
  ServiceSelectorOutput,
  CompletePlan,
  ItemFeatureContribution,
  RankedCandidate,
  OrderedItem,
} from '../../api/proposalClient'
import { unavailable } from './types'
import type { ReviewOption, Unavailable } from './types'
import type { BilingualLabel } from './reviewVocabulary'
import { CATEGORY_LABELS, TRIGGER_THRESHOLD_LABEL, serviceLabel } from './reviewVocabulary'

/**
 * Labels for records this pure layer cannot name.
 *
 * A CONTENT option is a catalog item; only a caller holding the song catalog
 * can name it (`ReviewColumn` resolves every label through `songDisplayName`).
 * Until it does, the option is labelled as unnamed rather than as its raw
 * catalog id — this module must never emit an identifier as a display label,
 * because a caller that forgot to resolve would then leak one to the screen
 * instead of failing visibly.
 */
const UNNAMED_CATEGORY: BilingualLabel = { ja: '名称未登録の提案分類', en: 'Unnamed proposal category' }
const UNNAMED_ITEM: BilingualLabel = { ja: '名称未登録の楽曲', en: 'Unnamed track' }

/**
 * Synthetic id for the NRI degenerate-tie pseudo option below — never
 * collides with a real category id (`rest_required`/`monotony_prevention`
 * are the complete V1 set; see `checkpoints.ts`).
 */
export const TRIGGER_THRESHOLD_OPTION_ID = 'trigger_threshold'

/**
 * The threshold key(s) a category's score is banded against, IN PRIORITY
 * ORDER — mirrors the backend's `trigger_explanation._CATEGORY_THRESHOLD_KEYS`
 * EXACTLY (see that module's docstring for the full reasoning): the two
 * trigger packages disagree on both the NAME and the SCALE of "the threshold
 * this category's score is compared against" —
 *
 *   - NRI (packages/nri_fatigue_score_v1/algorithm.py) publishes ONE raw
 *     `s_total` score banded by TWO raw-scale thresholds: `threshold_fire`
 *     (rest_required) / `threshold_monotony` (monotony_prevention). Its
 *     `criteria` dict also carries a `monotony_suggest_threshold` key
 *     normalized to the 0-1 top-level `score` — a DIFFERENT scale than the
 *     chain's raw `score` read here — so the raw-scale key must be tried
 *     FIRST, or a monotony fire would compare a ~100-scale score against a
 *     ~0.6-scale "threshold".
 *   - The hybrid (packages/aica_transparent_hybrid_trigger_v1/algorithm.py)
 *     publishes two independent CLAMPED 0-1 scores, each with its own 0-1
 *     threshold: `threshold_suggest` (rest_required) /
 *     `monotony_suggest_threshold` (monotony_prevention).
 */
const CATEGORY_THRESHOLD_KEYS: Record<string, string[]> = {
  rest_required: ['threshold_fire', 'threshold_suggest'],
  monotony_prevention: ['threshold_monotony', 'monotony_suggest_threshold'],
}

function thresholdFor(category: string | null | undefined, criteria: Record<string, number>): number | null {
  for (const key of CATEGORY_THRESHOLD_KEYS[category ?? ''] ?? []) {
    const v = criteria[key]
    if (typeof v === 'number') return v
  }
  return null
}

/**
 * The two trigger categories as comparable options.
 *
 * In V1 this is the COMPLETE category set, so the comparison is exhaustive
 * rather than a top-2 slice — and the runner-up's terms are read from the
 * record, never reconstructed from a weight table.
 *
 * NRI publishes ONE score banded by TWO thresholds (see `CATEGORY_THRESHOLD_
 * KEYS` above), so its `rest_required`/`monotony_prevention` chains always
 * carry the IDENTICAL score — a real category-vs-category margin is then all
 * zeroes: true, but useless (feature 025, slice S7 build note 4). When that
 * happens, a synthetic THRESHOLD option is appended (score = the fired
 * category's own firing line, read from the fire's `criteria`, rows = []
 * since a threshold decomposes into no features of its own) so the caller's
 * default comparison can compare "how far past the line, and what put it
 * there" instead of a category against its own vacuous twin. The hybrid
 * package's two categories genuinely differ in score, so this never
 * triggers for it — its category-vs-category comparison is untouched.
 */
export function triggerOptions(fire: MergedFirePoint): ReviewOption[] | Unavailable {
  const chains = fire?.feature_contributions
  if (!chains || Object.keys(chains).length === 0) {
    return unavailable('this trigger package recorded no per-feature contributions')
  }

  const options = Object.entries(chains).map(([category, chain]) => ({
    id: category,
    // A category with no registered name is named as unregistered, never
    // printed as its raw identifier — the reviewer reads product vocabulary.
    label: CATEGORY_LABELS[category] ?? UNNAMED_CATEGORY,
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

  const rest = options.find((o) => o.id === 'rest_required')
  const monotony = options.find((o) => o.id === 'monotony_prevention')
  if (rest && monotony && rest.score === monotony.score) {
    const threshold = thresholdFor(fire.category, fire.criteria ?? {})
    if (threshold != null) {
      options.push({
        id: TRIGGER_THRESHOLD_OPTION_ID,
        label: TRIGGER_THRESHOLD_LABEL,
        score: threshold,
        clamped: false,
        rows: [],
      })
    }
  }

  return options
}

/**
 * Find the LAST recorded evidence entry for `step` — mirrors
 * `MergedProposalPanel.tsx`'s `deriveProposalOverlay` (`proposalLog.evidence
 * .filter((ev) => ev.step === step).slice(-1)[0]`), the existing precedent
 * for reading "the current output" out of an append-only evidence array.
 * Exported so the review column's rank-1 summary (`rank1ServiceCandidate`/
 * `rank1ContentItem` below) can share this lookup rather than re-deriving it.
 */
export function latestEvidence(proposal: ProposalRunLog, step: 'service' | 'content') {
  const matches = proposal.evidence.filter((ev) => ev.step === step)
  return matches[matches.length - 1]
}

/**
 * The RAW rank-1 `RankedCandidate`/`OrderedItem`, straight off the proposal's
 * own recorded evidence — used by the review column's rank-1 summary
 * sentence (feature 025, slice S7), which needs the EMBEDDED `.rationale`
 * field a `ReviewOption` deliberately drops (this module builds COMPARABLE
 * options, not explanation payloads). `null` when there is no such rank-1 —
 * no proposal, no recorded evidence for that step, or an empty plan/candidate
 * list — never a fabricated stand-in.
 */
export function rank1ServiceCandidate(proposal: ProposalRunLog | null): RankedCandidate | null {
  if (!proposal) return null
  const output = latestEvidence(proposal, 'service')?.output as unknown as ServiceSelectorOutput | undefined
  return output?.ranked_candidates?.[0] ?? null
}

export function rank1ContentItem(proposal: ProposalRunLog | null): OrderedItem | null {
  if (!proposal) return null
  const output = latestEvidence(proposal, 'content')?.output as unknown as CompletePlan | undefined
  return output?.ordered_items?.[0] ?? null
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
      label: serviceLabel(candidate.candidate_id),
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
      label: UNNAMED_ITEM,
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
