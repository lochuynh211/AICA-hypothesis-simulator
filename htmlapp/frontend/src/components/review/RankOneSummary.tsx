// app/frontend/src/components/review/RankOneSummary.tsx
/**
 * RankOneSummary (feature 025, slice S7) — the RIGHT panel's "why the rank-1
 * option was chosen" sentence, for all three review tabs (trigger / service /
 * content). Sits under the stage tabs and above `WhatDecidedIt` in
 * `ReviewColumn.tsx`: the rationale sentence plus the AI-provenance badge
 * ONLY — no per-feature rows, `WhatDecidedIt` already draws those.
 *
 * The three tabs source their sentence identically (same `useExplanation` +
 * `RationaleText` wiring `ServiceReason`/`ContentReason` use in the centre
 * panel — "identical contract", per the S7 design note), differing only in
 * WHICH target and WHICH baseline `rationale` they carry:
 *
 *   - service/content already carry a DETERMINISTIC template sentence baked
 *     into their own recorded evidence (`RankedCandidate.rationale` /
 *     `OrderedItem.rationale`) — always shown, whether or not the AI overlay
 *     ever populates. When the explanation provider is 'off', `useExplanation`
 *     never fires (matches `ServiceReason`/`ContentReason` exactly — no
 *     network round-trip), and this baked sentence is what renders.
 *   - trigger carries NO such baked sentence of its own: no trigger package
 *     emits a `rationale` (chains.ts never invented one either —
 *     `ReviewOption` deliberately has no rationale field). It therefore fetches
 *     its base sentence from the backend's deterministic `template` provider
 *     via a SECOND `useExplanation` (see below) — never an LLM — so it has the
 *     same always-present base the other two get for free, and the LLM is a
 *     true overlay rather than the only source of text.
 *
 * In all three cases `aiOverlay` below is forced to `null` when the provider is
 * 'off', so the AI-provenance badge only ever appears over an ACTUAL LLM
 * sentence — never over a deterministic template.
 *
 * Always visible once a sentence exists (no separate expand/collapse chrome
 * here) but requests LAZILY, via the identical `onExpand`-style trigger
 * `ReasonBreakdown` uses for an always-open disclosure: the effect below
 * calls `request()` once per resolved target, and `useExplanation` itself is
 * the one that no-ops when the provider is 'off' (service/content only — see
 * above) — so switching stage tabs is what "expands" the next tab's summary,
 * never a prefetch of all three.
 */
import { useEffect } from 'react'
import type { MergedFirePoint } from '../../api/mergedClient'
import type { ReviewStage } from '../../lib/review/checkpoints'
import { rank1ServiceCandidate, rank1ContentItem, TRIGGER_THRESHOLD_OPTION_ID } from '../../lib/review/chains'
import RationaleText from '../proposal/RationaleText'
import { useExplanation, type ExplanationProvider } from '../proposal/useExplanation'
import { t } from '../../i18n/t'

const ACCENT: Record<ReviewStage, string> = {
  trigger: '#b45309',
  service: '#1d4ed8',
  content: '#7c3aed',
}

const LABELS = {
  title: { ja: '選ばれた理由', en: 'Why this was chosen' },
}

export default function RankOneSummary({
  stage,
  fire,
  targetCategory,
  explanationProvider,
  lang,
}: {
  stage: ReviewStage
  /** The active checkpoint's fire — always present once a checkpoint exists,
   *  independent of whether its paired proposal succeeded. */
  fire: MergedFirePoint
  /** Trigger tab ONLY: whatever `WhatDecidedIt` currently shows on the left
   *  (`effectiveLeftId` in `ReviewColumn.tsx`) — the fired category by
   *  default, or the reviewer's own re-pick. Ignored for service/content,
   *  which always explain the fixed RANK-1 candidate/item, not whatever the
   *  reviewer happens to be comparing. */
  targetCategory: string | null
  explanationProvider: ExplanationProvider
  lang: 'ja' | 'en'
}): JSX.Element | null {
  const proposal = fire.proposal

  const rank1Candidate = stage === 'service' ? rank1ServiceCandidate(proposal) : null
  const rank1Item = stage === 'content' ? rank1ContentItem(proposal) : null

  // TRIGGER has no proposal of its own to key a cache/gate id off — a fire
  // can carry feature_contributions with no paired proposal at all (its
  // auto-created proposal failed synchronously; see merged_runs.py's
  // `proposal_error` handling). Fall back to a fire-derived identity so the
  // trigger summary still works in that case. Service/content only ever
  // render once their proposal is confirmed present (`ReviewColumn` gates
  // this whole component on `activeAvailable`), so they always have a real
  // `run_id` from the proposal itself.
  const runId = proposal?.run_id ?? (stage === 'trigger' ? `trig-${fire.tick}-${fire.time_min}` : undefined)

  // A reviewer who has manually re-picked WhatDecidedIt's left side to the
  // synthetic "firing threshold" pseudo-option (chains.ts's NRI-tie
  // fallback) has picked something that is not a real category — there is
  // nothing for the backend to explain, so this falls through to "no target"
  // below rather than sending a bogus `category`.
  const triggerCategory =
    stage === 'trigger' && targetCategory !== TRIGGER_THRESHOLD_OPTION_ID ? targetCategory : null

  const targetId =
    stage === 'trigger'
      ? (triggerCategory ?? '')
      : stage === 'service'
        ? (rank1Candidate?.candidate_id ?? '')
        : (rank1Item?.item_id ?? '')

  const fireArg = stage === 'trigger' ? (fire as unknown as Record<string, unknown>) : null

  const { ai, request } = useExplanation(
    runId,
    stage,
    targetId,
    explanationProvider,
    lang,
    stage === 'trigger' ? null : proposal,
    fireArg,
  )

  // TRIGGER ONLY — its deterministic BASE sentence.
  //
  // Service/content read their base out of recorded evidence, so they always
  // have something to show and the LLM is a true overlay on top of it. Trigger
  // has no baked rationale anywhere, so it used to render the LLM slot AS the
  // sentence — which meant the whole card returned null while a generation was
  // in flight (~15-30s of the panel simply being empty) and stayed null forever
  // if the LLM errored, e.g. Gemini Nano unavailable on this machine. "Turn the
  // LLM on and the trigger reason disappears" is the opposite of the intent.
  //
  // Fetching it at provider 'off' resolves to the backend's `template` provider
  // (see `useExplanation`'s provider mapping) — no LLM, no Ollama call,
  // instant. When the reviewer's provider IS 'off' both hooks resolve the same
  // cache key, so this costs exactly one request, not two.
  const { ai: templateAi, request: requestTemplate } = useExplanation(
    runId, stage, targetId, 'off', lang, null, fireArg,
  )

  useEffect(() => {
    if (!targetId) return
    request()
    // Re-request whenever the resolved target changes (stage switch, a new
    // rank-1, or the reviewer re-picking the trigger comparison) — `request`
    // itself is `useExplanation`'s own stable, cache-aware callback.
    if (stage === 'trigger') requestTemplate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, requestTemplate, targetId, stage])

  if (!targetId) return null

  const rationale: string[] =
    stage === 'service'
      ? (rank1Candidate?.rationale ?? [])
      : stage === 'content'
        ? (rank1Item?.rationale ?? [])
        : templateAi?.status === 'ready'
          ? [templateAi.text, templateAi.text]
          : []

  // Nothing to show yet: service/content should never actually land here (a
  // real algorithm always emits SOME rationale); trigger does only for the
  // instant before its TEMPLATE fetch resolves — no longer for the 15-30s an
  // LLM generation takes, which is the whole point of sourcing the base
  // sentence separately from the overlay.
  if (rationale.every((s) => !s.trim())) return null

  // The AI-provenance badge/chrome is shown ONLY for an actual LLM sentence.
  // For trigger with the provider 'off', `ai` above is 'ready' too — but from
  // the backend's deterministic TEMPLATE (see the module docstring) — so it
  // is withheld here and `RationaleText` falls through to its plain branch,
  // rendering the same `rationale` text unbadged. Service/content never reach
  // this distinction at all: their `ai` is permanently `null` when 'off'
  // (`useExplanation` never fetches for them in that case), so `aiOverlay`
  // is simply `ai` unchanged for them.
  const aiOverlay = stage === 'trigger' && explanationProvider === 'off' ? null : ai

  return (
    <div data-testid={`rank-one-summary-${stage}`} className="review-card">
      <p className="review-card-h">{t(LABELS.title, lang)}</p>
      <RationaleText rationale={rationale} aiExplanation={aiOverlay} accent={ACCENT[stage]} lang={lang} />
    </div>
  )
}
