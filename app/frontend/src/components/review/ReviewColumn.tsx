// app/frontend/src/components/review/ReviewColumn.tsx
/**
 * The review column — a pinned `StageFeedbackPanel` (all three verdicts at
 * once) above stage tabs (Trigger / Service / Content) driving
 * `WhatDecidedIt` → `ParameterRationale` from ONE checkpoint's recorded
 * evidence.
 *
 * Checkpoints, options and the default comparison are all DERIVED from
 * `result` + the store on every render rather than pushed into the store by
 * an effect — a checkpoint/stage switch clears `compareLeftId`/
 * `compareRightId`/`targetId` in the reducer (task-14-brief), and the first
 * render after that clear must already show a sensible default without a
 * second pass, which a derived value gives for free and an effect cannot
 * guarantee synchronously.
 *
 * A stage whose options come back `Unavailable` renders its tab `disabled`
 * with the reason in `title`, and — if it is the ACTIVE stage — the body
 * shows the real recorded reason (`comparison-unavailable`) rather than
 * delegating to `WhatDecidedIt`'s generic "at least two options" fallback,
 * which would discard the specific evidence gap chains.ts already diagnosed.
 */
import { useState } from 'react'
import type { MergedInstantResult, ReviewFeedbackBody } from '../../api/mergedClient'
import { postReviewFeedback, getReviewFeedback } from '../../api/mergedClient'
import type { ReviewOption } from '../../lib/review/types'
import type { Unavailable } from '../../lib/review/types'
import type { Checkpoint, ReviewStage } from '../../lib/review/checkpoints'
import { deriveCheckpoints } from '../../lib/review/checkpoints'
import { triggerOptions, serviceOptions, contentOptions } from '../../lib/review/chains'
import { getCase } from '../../lib/review/caseCatalog'
import WhatDecidedIt from './WhatDecidedIt'
import ParameterRationale from './ParameterRationale'
import StageFeedbackPanel, { type StageFeedbackRow } from './StageFeedbackPanel'
import FeedbackSummaryModal from './FeedbackSummaryModal'
import { collectCaseFeedback, toMarkdown } from '../../lib/review/feedbackSummary'
import ErrorNotice from '../common/ErrorNotice'
import { useReviewStore, judgmentKey } from '../../state/reviewStore'
import { songDisplayName } from '../proposal/useSongNames'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../lib/review/reviewVocabulary'

const LABELS = {
  // The review STAGE/TAB (not the fired-decision noun itself — that stays
  // 発火/"Firing"; this is the reviewable JUDGEMENT of whether it fired).
  tabTrigger: { ja: '発火判定', en: 'Firing decision' },
  tabService: { ja: 'サービス', en: 'Service' },
  tabContent: { ja: 'コンテンツ', en: 'Content' },
  // Shown in place of a stage's verdict buttons when nothing fired. Deliberately
  // a bare FACT and nothing more: whether the absence of a fire was correct is
  // the reviewer's verdict to file, not a claim the app gets to make for them.
  noDecisionPoint: { ja: '決定ポイントなし', en: 'No decision point' },
  noRunYet: { ja: '実行がまだありません', en: 'No run yet' },
  unavailableTitle: { ja: 'この段階は比較できません', en: 'This stage cannot be compared' },
  persistFailed: {
    ja: '評価を保存できませんでした。もう一度お試しください。',
    en: 'Could not save your judgement. Please try again.',
  },
  exportFailed: {
    ja: 'エクスポートを取得できませんでした。もう一度お試しください。',
    en: 'Could not fetch the export. Please try again.',
  },
  noRunToExport: {
    ja: '実行がまだ作成されていないため、エクスポートするものがありません。',
    en: 'No run exists yet, so there is nothing to export.',
  },
} satisfies Record<string, BilingualLabel>

// A raw English diagnostic literal from chains.ts (unavailable().reason) is
// NEVER shown verbatim in the default-JA UI — mirrors ParameterRationale's
// own `reasonSentence`. Anything unrecognised falls to a generic bilingual
// sentence rather than leaking English.
const REASON_TEXT: Record<string, BilingualLabel> = {
  'this trigger package recorded no per-feature contributions': {
    ja: 'この発火判定パッケージは特徴量ごとの寄与を記録していません。',
    en: 'This firing-decision package recorded no per-feature contributions.',
  },
  'no proposal was recorded at this checkpoint': {
    ja: 'この決定ポイントでは提案が記録されていません。',
    en: 'No proposal was recorded at this checkpoint.',
  },
  'this proposal recorded no service-selector evidence': {
    ja: 'この提案にはサービス選定の記録がありません。',
    en: 'This proposal recorded no service-selector evidence.',
  },
  'this proposal recorded no content-selector evidence': {
    ja: 'この提案にはコンテンツ選定の記録がありません。',
    en: 'This proposal recorded no content-selector evidence.',
  },
  'every recorded candidate was LLM-shaped (no numeric score)': {
    ja: '記録された候補はすべて自動生成された内容であり、数値スコアがありません。',
    en: 'Every recorded candidate was LLM-shaped (no numeric score).',
  },
  'every recorded item was LLM-shaped (no numeric item_fit)': {
    ja: '記録された項目はすべて自動生成された内容であり、数値の適合度がありません。',
    en: 'Every recorded item was LLM-generated, with no numeric fit score.',
  },
}

// An unrecognised `reason` is an internal diagnostic string from chains.ts,
// never written for end users — the JA fallback degrades to a clean generic
// sentence rather than splicing the raw (English) diagnostic into Japanese
// prose. The EN fallback can show it as-is: it is already English, and this
// is a genuinely unmapped case a developer needs to see verbatim to add it
// to the table above.
function reasonText(reason: string, lang: 'ja' | 'en'): string {
  const known = REASON_TEXT[reason]
  if (known) return t(known, lang)
  return lang === 'ja' ? '記録されたデータからは判定できません。' : reason
}

function isUnavailable(x: unknown): x is Unavailable {
  return typeof x === 'object' && x !== null && (x as { available?: unknown }).available === false
}


type Comparison = { left: string | null; right: string | null }

/** Trigger stage: the fired category vs. the other one — exhaustive in V1. */
function defaultTriggerComparison(options: ReviewOption[], checkpoint: Checkpoint): Comparison {
  const primary = options.find((o) => o.id === checkpoint.category) ?? options[0] ?? null
  const other = options.find((o) => o.id !== primary?.id) ?? options.find((o) => o !== primary) ?? null
  return { left: primary?.id ?? null, right: other?.id ?? null }
}

/** Service stage: ranked 1 vs 2, as recorded (rank order). */
function defaultServiceComparison(options: ReviewOption[]): Comparison {
  return { left: options[0]?.id ?? null, right: options[1]?.id ?? null }
}

/**
 * Content stage: position 1 (rank 1) vs its runner-up; any OTHER selected
 * position compares against the item immediately ABOVE it in rank, so the
 * margin reads negative and the decomposition shows what the lower position
 * lacks relative to the one that beat it.
 */
function defaultContentComparison(options: ReviewOption[], targetId: string | null): Comparison {
  if (options.length === 0) return { left: null, right: null }
  const targetIndex = targetId ? options.findIndex((o) => o.id === targetId) : -1
  const leftIndex = targetIndex >= 0 ? targetIndex : 0
  const left = options[leftIndex].id
  const rightIndex = leftIndex === 0 ? 1 : leftIndex - 1
  const right = options[rightIndex]?.id ?? options[1]?.id ?? null
  return { left, right }
}

/** Decision-level key: the same compound shape `judgmentKey` uses minus the
 * feature — a decision is judged as a whole, not per-input. Kept as its own
 * tiny builder (rather than calling `judgmentKey` with a fake feature id) so
 * the two key shapes can never collide. */
const assessmentKey = (caseId: string, checkpointId: string, stage: string, targetId: string): string =>
  [caseId, checkpointId, stage, targetId].join('|')

/**
 * The decision point of a run that fired nothing.
 *
 * A no-fire run has no checkpoint and no candidate to anchor a verdict to, but
 * the verdict itself is real — "was it right NOT to fire?" is precisely what a
 * control case exists to have answered — so it is filed against this sentinel
 * rather than not filed at all. It can never collide with a real key: a real
 * checkpoint id is a `ReviewableCategory` (`rest_required` /
 * `monotony_prevention`), never this.
 */
const NO_FIRE = 'no_fire'

export default function ReviewColumn({
  result,
  mergedRunId = null,
  showParameterRationale = false,
  songNames = {},
  caseModified = false,
}: {
  result: MergedInstantResult | null
  /** The live merged run's id, when one exists. `null` before any run has
   * been created — judgements still land in the store, but nothing is
   * persisted server-side until this is set (07-27 §10). */
  mergedRunId?: string | null
  /**
   * The per-input parameter-rationale table. HIDDEN by default (owner review)
   * but deliberately kept as a switch rather than deleted: the component, the
   * judgement wiring and the exported judgement records are all still here and
   * still tested through this prop, so bringing the view back is flipping one
   * flag rather than restoring deleted code.
   */
  showParameterRationale?: boolean
  /** `item_id → song name`, so content options read as "Name (id)". Passed in
   *  rather than fetched here: `MergedShell` already resolves it for the
   *  content plan, and both must name songs from the SAME dataset. */
  songNames?: Record<string, string>
  /** The setup has been edited away from the case as authored — shown next to
   *  the case name so a verdict is never filed against a case the reviewer
   *  believes is verbatim when it is not. */
  caseModified?: boolean
}): JSX.Element {
  const { lang } = useLanguage()
  const { state, dispatch } = useReviewStore()
  const [persistError, setPersistError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const checkpoints = deriveCheckpoints(result)

  // ── Feedback wiring, shared by BOTH branches below ──────────────────────
  //
  // None of this depends on a checkpoint existing, so it is defined before
  // the empty-rail branch: a run that fired nothing is still reviewed, still
  // exported and still summarised through exactly the same store and the same
  // endpoint as one that fired.
  const caseId = state.selectedCaseId ?? ''

  // Persists one review-feedback record. Failures are surfaced (never
  // swallowed) — a judgement the reviewer believes was recorded but wasn't
  // is worse than one that was never offered. Before a live merged run
  // exists, the judgement already landed in the store; there is simply
  // nothing to persist to yet, which is not an error.
  const persist = async (body: ReviewFeedbackBody) => {
    if (mergedRunId == null) return
    try {
      await postReviewFeedback(mergedRunId, body)
      setPersistError(null)
    } catch {
      setPersistError(t(LABELS.persistFailed, lang))
    }
  }

  // Decision-level assessment, addressed by its full anchor. Both branches
  // reach the store through these three, differing only in WHICH decision
  // point they name — a real checkpoint/candidate, or `NO_FIRE`.
  const storedAssessment = (checkpointId: string, s: ReviewStage, target: string) =>
    state.assessments[assessmentKey(caseId, checkpointId, s, target)] ?? null

  const assessAt = (checkpointId: string, s: ReviewStage, target: string, assessment: string) => {
    if (!caseId) return
    const key = assessmentKey(caseId, checkpointId, s, target)
    const comment = state.assessments[key]?.comment ?? ''
    dispatch({ type: 'SET_ASSESSMENT', key, assessment, comment })
    void persist({
      scope: 'review_decision',
      case_id: caseId,
      checkpoint_id: checkpointId,
      stage: s,
      review_target: target,
      labels: { assessment },
      comment,
    })
  }

  const commentAt = (checkpointId: string, s: ReviewStage, target: string, comment: string) => {
    if (!caseId) return
    const key = assessmentKey(caseId, checkpointId, s, target)
    const assessment = state.assessments[key]?.assessment ?? ''
    dispatch({ type: 'SET_ASSESSMENT', key, assessment, comment })
  }

  const commitCommentAt = (checkpointId: string, s: ReviewStage, target: string, comment: string) => {
    if (!caseId) return
    const key = assessmentKey(caseId, checkpointId, s, target)
    // Deliberately '' (not skipped) when a comment is written before a verdict
    // is picked — the comment itself is evidence.
    const assessment = state.assessments[key]?.assessment ?? ''
    void persist({
      scope: 'review_decision',
      case_id: caseId,
      checkpoint_id: checkpointId,
      stage: s,
      review_target: target,
      labels: { assessment },
      comment,
    })
  }

  const caseFeedback = collectCaseFeedback(state.assessments, state.judgments)
  const selectedCaseTitleLabel = state.selectedCaseId ? (getCase(state.selectedCaseId)?.title ?? null) : null
  const selectedCaseTitle = selectedCaseTitleLabel ? t(selectedCaseTitleLabel, lang) : null

  /**
   * Edit a record the popup already lists, for ANY case — not just the selected
   * one. The record's own key names its case, checkpoint, stage and target, so
   * this re-files it exactly where it was; nothing about the decision point is
   * invented. A case with no record yet cannot be given one here, because there
   * would be no decision point to attach it to.
   */
  const handleEditRecord = (
    caseIdOfRecord: string,
    checkpointId: string,
    s2: string,
    targetId: string,
    next: { assessment?: string; comment?: string },
    opts?: { persist?: boolean },
  ) => {
    const key = [caseIdOfRecord, checkpointId, s2, targetId].join('|')
    const current = state.assessments[key] ?? { assessment: '', comment: '' }
    const assessment = next.assessment ?? current.assessment
    const comment = next.comment ?? current.comment
    dispatch({ type: 'SET_ASSESSMENT', key, assessment, comment })
    if (opts?.persist === false) return
    void persist({
      scope: 'review_decision',
      case_id: caseIdOfRecord,
      checkpoint_id: checkpointId,
      stage: s2 as ReviewStage,
      review_target: targetId,
      labels: { assessment },
      comment,
    })
  }

  const handleExportMarkdown = () => {
    const markdown = toMarkdown(caseFeedback, lang, new Date().toISOString())
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'aica-review-feedback.md'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExport = async () => {
    if (mergedRunId == null) {
      setPersistError(t(LABELS.noRunToExport, lang))
      return
    }
    try {
      const report = await getReviewFeedback(mergedRunId)
      setPersistError(null)
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `review-feedback-${mergedRunId}.json`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setPersistError(t(LABELS.exportFailed, lang))
    }
  }

  const feedbackPanelProps = {
    onExport: () => void handleExport(),
    onExportMarkdown: handleExportMarkdown,
    onOpenSummary: () => setSummaryOpen(true),
    caseName: selectedCaseTitle,
    caseModified,
    caseSelected: caseId !== '',
    hasRun: mergedRunId != null,
  }

  const summaryModal = (
    <FeedbackSummaryModal
      open={summaryOpen}
      cases={caseFeedback}
      onClose={() => setSummaryOpen(false)}
      onExportMarkdown={handleExportMarkdown}
      onEditRecord={handleEditRecord}
    />
  )

  const persistErrorNotice = persistError && (
    <div style={{ padding: '8px 12px 0' }}>
      <ErrorNotice testid="review-feedback-error" message={persistError} onDismiss={() => setPersistError(null)} />
    </div>
  )

  // ── Nothing fired ───────────────────────────────────────────────────────
  //
  // An empty rail is a legitimate outcome, not an error — and it is one the
  // reviewer still has a verdict to file on, because "AICA should not have
  // fired here" is the whole point of a control case. So this branch shows
  // the verdict card and NOTHING else:
  //
  //   * no evidence tabs — there is no decision to decompose, and an empty
  //     comparison would only invite the reviewer to look for one;
  //   * no sentence from the app about what the absence means. Whether not
  //     firing was correct is the judgement being collected here; stating the
  //     answer above the question would be the app reviewing itself.
  //
  // Only the firing decision is assessable: service and content never ran, so
  // there is genuinely nothing to judge about them. And with no run at all,
  // not even the firing decision is — an absent fire and a run that never
  // happened are different facts, and only the first was decided.
  if (checkpoints.length === 0) {
    const decided = result != null
    const noFireRows: StageFeedbackRow[] = (['trigger', 'service', 'content'] as ReviewStage[]).map((s) => {
      const stored = s === 'trigger' ? storedAssessment(NO_FIRE, s, NO_FIRE) : null
      return {
        stage: s,
        available: s === 'trigger' && decided,
        unavailableReason: t(s === 'trigger' ? LABELS.noRunYet : LABELS.noDecisionPoint, lang),
        assessment: stored?.assessment ?? null,
        comment: stored?.comment ?? '',
      }
    })

    return (
      <div data-testid="review-column">
        <StageFeedbackPanel
          rows={noFireRows}
          onAssess={(s, assessment) => assessAt(NO_FIRE, s, NO_FIRE, assessment)}
          onComment={(s, comment) => commentAt(NO_FIRE, s, NO_FIRE, comment)}
          onCommentCommit={(s, comment) => commitCommentAt(NO_FIRE, s, NO_FIRE, comment)}
          {...feedbackPanelProps}
        />
        {summaryModal}
        {persistErrorNotice}
      </div>
    )
  }

  const activeCheckpoint = checkpoints.find((c) => c.id === state.checkpointId) ?? checkpoints[0]
  const fire = result!.fires[activeCheckpoint.fireIndex]

  const triggerResult = triggerOptions(fire)
  const serviceResult = serviceOptions(fire.proposal)
  const contentResult = contentOptions(fire.proposal)

  const triggerAvailable = !isUnavailable(triggerResult)
  const serviceAvailable = !isUnavailable(serviceResult)
  const contentAvailable = !isUnavailable(contentResult)

  const triggerOpts = isUnavailable(triggerResult) ? [] : triggerResult
  const serviceOpts = isUnavailable(serviceResult) ? [] : serviceResult
  // Content options read as the song's NAME. A catalog track id tells the
  // reviewer nothing about what was proposed, so it never reaches the label —
  // the recorded evidence is still keyed by it, and `option.id` still carries
  // it for the store and the test hooks.
  const rawContentOpts = isUnavailable(contentResult) ? [] : contentResult.options
  const contentOpts = rawContentOpts.map((option) => ({
    ...option,
    label: {
      ja: songDisplayName(option.id, songNames, 'ja'),
      en: songDisplayName(option.id, songNames, 'en'),
    },
  }))

  const triggerReason = isUnavailable(triggerResult) ? triggerResult.reason : null
  const serviceReason = isUnavailable(serviceResult) ? serviceResult.reason : null
  const contentReason = isUnavailable(contentResult) ? contentResult.reason : null

  const stage = state.stage
  const activeOptions = stage === 'trigger' ? triggerOpts : stage === 'service' ? serviceOpts : contentOpts
  const activeAvailable = stage === 'trigger' ? triggerAvailable : stage === 'service' ? serviceAvailable : contentAvailable
  const activeReason = stage === 'trigger' ? triggerReason : stage === 'service' ? serviceReason : contentReason

  const defaultComparison =
    stage === 'trigger'
      ? defaultTriggerComparison(triggerOpts, activeCheckpoint)
      : stage === 'service'
        ? defaultServiceComparison(serviceOpts)
        : defaultContentComparison(contentOpts, state.targetId)

  const explicit = state.compareLeftId != null && state.compareRightId != null
  const effectiveLeftId = explicit ? state.compareLeftId : defaultComparison.left
  const effectiveRightId = explicit ? state.compareRightId : defaultComparison.right
  const effectiveTargetId = state.targetId ?? effectiveLeftId

  const findOption = (id: string | null): ReviewOption | null =>
    id == null ? null : activeOptions.find((o) => o.id === id) ?? null
  const leftOption = findOption(effectiveLeftId)
  const rightOption = findOption(effectiveRightId)

  const handleChangeLeft = (id: string) => {
    dispatch({ type: 'SELECT_TARGET', targetId: id })
    if (stage === 'content') {
      const { right } = defaultContentComparison(contentOpts, id)
      dispatch({ type: 'SET_COMPARISON', leftId: id, rightId: right ?? effectiveRightId })
    } else {
      dispatch({ type: 'SET_COMPARISON', leftId: id, rightId: effectiveRightId })
    }
  }

  const handleChangeRight = (id: string) => {
    dispatch({ type: 'SET_COMPARISON', leftId: effectiveLeftId, rightId: id })
  }

  // `judgments` in the store is keyed by the full compound key so a
  // judgement made at one decision point never leaks into another; project
  // it back down to the bare-featureId map ParameterRationale expects,
  // scoped to the CURRENT case/checkpoint/stage/target.
  const scopedJudgments: Record<string, string> = {}
  if (leftOption && effectiveTargetId != null) {
    for (const row of leftOption.rows) {
      const key = judgmentKey(caseId, activeCheckpoint.id, stage, effectiveTargetId, row.featureId)
      const value = state.judgments[key]
      if (value) scopedJudgments[row.featureId] = value
    }
  }

  const handleJudge = (featureId: string, judgment: string) => {
    if (effectiveTargetId == null) return
    const key = judgmentKey(caseId, activeCheckpoint.id, stage, effectiveTargetId, featureId)
    dispatch({ type: 'SET_JUDGMENT', key, judgment })
    void persist({
      scope: 'review_input',
      case_id: caseId,
      checkpoint_id: activeCheckpoint.id,
      stage,
      review_target: effectiveTargetId,
      feature_id: featureId,
      labels: { judgment },
    })
  }

  // Decision-level assessment (Task 16) — keyed the same way minus the
  // feature, since a decision is judged as a whole, not per-input.
  //
  // Every stage is assessable at once (owner review), so each one resolves its
  // OWN review target rather than borrowing the open tab's. For the active
  // stage that is whatever the reviewer is actually inspecting; for the others
  // it is that stage's default comparison target.
  const stageTargetId = (s: ReviewStage): string | null => {
    if (s === stage) return effectiveTargetId
    if (s === 'trigger') return defaultTriggerComparison(triggerOpts, activeCheckpoint).left
    if (s === 'service') return defaultServiceComparison(serviceOpts).left
    return defaultContentComparison(contentOpts, null).left
  }

  const stageAssessmentKey = (s: ReviewStage): string | null => {
    const target = stageTargetId(s)
    return target != null ? assessmentKey(caseId, activeCheckpoint.id, s, target) : null
  }

  // Thin wrappers over the shared `assessAt`/`commentAt`/`commitCommentAt`
  // above: at a real checkpoint the decision point is that checkpoint and the
  // stage's own review target, rather than the `NO_FIRE` sentinel.
  const handleAssessStage = (s: ReviewStage, assessment: string) => {
    const target = stageTargetId(s)
    if (target == null) return
    assessAt(activeCheckpoint.id, s, target, assessment)
  }

  const handleCommentStage = (s: ReviewStage, comment: string) => {
    const target = stageTargetId(s)
    if (target == null) return
    commentAt(activeCheckpoint.id, s, target, comment)
  }

  const handleCommentCommitStage = (s: ReviewStage, comment: string) => {
    const target = stageTargetId(s)
    if (target == null) return
    commitCommentAt(activeCheckpoint.id, s, target, comment)
  }

  // Declared (setup-time) weight per feature is exactly what the LEFT
  // option's own chain recorded as `w` — realizedShares folds in the
  // observed value+response-coefficient via `contribution`; declaredShares
  // must NOT, or "intent vs effect" would always read "even".
  const declaredWeights: Record<string, number> = {}
  if (leftOption) {
    for (const row of leftOption.rows) declaredWeights[row.featureId] = row.w
  }

  // One verdict row per stage. The judged/total summary is only meaningful for
  // the stage currently on screen — that is the only one whose per-input
  // judgements are projected into `scopedJudgments` — so the others carry no
  // count rather than a fabricated zero.
  const feedbackRows: StageFeedbackRow[] = (['trigger', 'service', 'content'] as ReviewStage[]).map((s) => {
    const key = stageAssessmentKey(s)
    const stored = key ? state.assessments[key] : null
    const available = s === 'trigger' ? triggerAvailable : s === 'service' ? serviceAvailable : contentAvailable
    const reason = s === 'trigger' ? triggerReason : s === 'service' ? serviceReason : contentReason
    return {
      stage: s,
      available: available && stageTargetId(s) != null,
      unavailableReason: reason ? reasonText(reason, lang) : null,
      assessment: stored?.assessment ?? null,
      comment: stored?.comment ?? '',
    }
  })

  const stageTab = (targetStage: ReviewStage, label: BilingualLabel, available: boolean, reason: string | null) => (
    <button
      type="button"
      data-testid={`stage-tab-${targetStage}`}
      className={stage === targetStage ? 'on' : undefined}
      disabled={!available}
      title={available ? '' : reasonText(reason ?? '', lang)}
      onClick={() => dispatch({ type: 'SELECT_STAGE', stage: targetStage })}
    >
      {t(label, lang)}
    </button>
  )

  return (
    <div data-testid="review-column">
      {/* Verdict FIRST and pinned (owner review): all three stages judged
          together, above the tabbed evidence rather than buried under
          whichever tab happens to be open. */}
      <StageFeedbackPanel
        rows={feedbackRows}
        onAssess={handleAssessStage}
        onComment={handleCommentStage}
        onCommentCommit={handleCommentCommitStage}
        {...feedbackPanelProps}
      />

      {summaryModal}

      {persistErrorNotice}

      <div className="stage-tabs" style={{ padding: '0 11px' }}>
        {stageTab('trigger', LABELS.tabTrigger, triggerAvailable, triggerReason)}
        {stageTab('service', LABELS.tabService, serviceAvailable, serviceReason)}
        {stageTab('content', LABELS.tabContent, contentAvailable, contentReason)}
      </div>

      {!activeAvailable ? (
        <div data-testid="comparison-unavailable" style={{ padding: '12px', color: '#64748b', fontSize: '0.86em' }}>
          <p style={{ fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>{t(LABELS.unavailableTitle, lang)}</p>
          <p style={{ margin: 0 }}>{reasonText(activeReason ?? '', lang)}</p>
        </div>
      ) : (
        <>
          <WhatDecidedIt
            options={activeOptions}
            leftId={effectiveLeftId ?? ''}
            rightId={effectiveRightId ?? ''}
            onChangeLeft={handleChangeLeft}
            onChangeRight={handleChangeRight}
          />
          {/* Off by default — see `showParameterRationale`. */}
          {showParameterRationale && leftOption && (
            <ParameterRationale
              stage={stage}
              left={leftOption}
              right={rightOption}
              declaredWeights={declaredWeights}
              judgments={scopedJudgments}
              onJudge={handleJudge}
            />
          )}
        </>
      )}
    </div>
  )
}
