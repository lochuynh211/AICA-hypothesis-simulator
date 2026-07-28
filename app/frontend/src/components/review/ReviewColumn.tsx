// app/frontend/src/components/review/ReviewColumn.tsx
/**
 * The review column — stage tabs (Trigger / Service / Content) driving
 * `WhatDecidedIt` → `ParameterRationale` → (Task 16) `DecisionAssessment`
 * from ONE checkpoint's recorded evidence.
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
import type { MergedInstantResult, MergedFirePoint } from '../../api/mergedClient'
import type { ReviewOption } from '../../lib/review/types'
import type { Unavailable } from '../../lib/review/types'
import type { Checkpoint, ReviewStage, ReviewableCategory } from '../../lib/review/checkpoints'
import { deriveCheckpoints } from '../../lib/review/checkpoints'
import { triggerOptions, serviceOptions, contentOptions } from '../../lib/review/chains'
import { getCase } from '../../lib/review/caseCatalog'
import WhatDecidedIt from './WhatDecidedIt'
import ParameterRationale from './ParameterRationale'
import { useReviewStore, judgmentKey } from '../../state/reviewStore'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../lib/review/reviewVocabulary'

const LABELS = {
  tabTrigger: { ja: 'トリガー', en: 'Trigger' },
  tabService: { ja: 'サービス', en: 'Service' },
  tabContent: { ja: 'コンテンツ', en: 'Content' },
  noRunTitle: { ja: 'レビューできる決定がありません', en: 'Nothing to review yet' },
  noRunBody: {
    ja: 'まだ実行結果がありません。シミュレーションを実行すると、ここにレビュー可能な決定ポイントが表示されます。',
    en: 'No run exists yet. Once a simulation runs, any reviewable decision point appears here.',
  },
  noCheckpointsTitle: { ja: '発火はありませんでした', en: 'No trigger fired' },
  noCheckpointsBody: {
    ja: 'この実行ではレビュー可能な決定ポイントが生成されませんでした。',
    en: 'This run produced no reviewable decision point.',
  },
  noCheckpointsCaseTitle: { ja: '想定どおりの結果です', en: 'This is the expected outcome' },
  noCheckpointsCaseBody: {
    ja: 'は発火しないことを想定した試験ケースです。決定ポイントが無いのは不具合ではなく、この結果そのものです。',
    en: 'is a test case designed to produce no trigger. The absence of a decision point is the outcome being tested, not a problem.',
  },
  unavailableTitle: { ja: 'この段階は比較できません', en: 'This stage cannot be compared' },
} satisfies Record<string, BilingualLabel>

// A raw English diagnostic literal from chains.ts (unavailable().reason) is
// NEVER shown verbatim in the default-JA UI — mirrors ParameterRationale's
// own `reasonSentence`. Anything unrecognised falls to a generic bilingual
// sentence rather than leaking English.
const REASON_TEXT: Record<string, BilingualLabel> = {
  'this trigger package recorded no per-feature contributions': {
    ja: 'このトリガーパッケージは特徴量ごとの寄与を記録していません。',
    en: 'This trigger package recorded no per-feature contributions.',
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
    ja: '記録された候補はすべてLLM生成であり、数値スコアがありません。',
    en: 'Every recorded candidate was LLM-shaped (no numeric score).',
  },
  'every recorded item was LLM-shaped (no numeric item_fit)': {
    ja: '記録された項目はすべてLLM生成であり、数値の適合度がありません。',
    en: 'Every recorded item was LLM-shaped (no numeric item_fit).',
  },
}

function reasonText(reason: string, lang: 'ja' | 'en'): string {
  const known = REASON_TEXT[reason]
  if (known) return t(known, lang)
  return lang === 'ja' ? `記録されたデータからは判定できません（${reason}）。` : reason
}

function isUnavailable(x: unknown): x is Unavailable {
  return typeof x === 'object' && x !== null && (x as { available?: unknown }).available === false
}

// The threshold in force for a category, read from whichever criteria key the
// backend actually recorded for it (mirrors `services/preview.py`'s own
// fallback chain for the score-strip threshold line) — never fabricated when
// none was recorded.
const THRESHOLD_CRITERIA_KEYS: Record<ReviewableCategory, string[]> = {
  rest_required: ['rest_required_threshold', 'threshold_suggest', 'threshold_fire'],
  monotony_prevention: ['monotony_prevention_threshold', 'monotony_suggest_threshold'],
}

function buildThresholdNote(
  fire: MergedFirePoint,
  category: ReviewableCategory,
  lang: 'ja' | 'en',
): string | null {
  const criteria = fire.criteria ?? {}
  const key = (THRESHOLD_CRITERIA_KEYS[category] ?? []).find((k) => criteria[k] !== undefined)
  if (!key) return null
  const value = criteria[key]
  return lang === 'ja' ? `発火しきい値: ${value.toFixed(2)}` : `Firing threshold: ${value.toFixed(2)}`
}

// `chains.ts#triggerOptions` hardcodes `ReviewOption.label` to the ENGLISH
// half of its category label regardless of UI language (chains.ts is owned
// by an earlier, already-committed task and out of scope here) — left as-is
// it would leak raw English ("Rest proposal") into WhatDecidedIt's JA
// verdict sentence and pickers, exactly the class of bug this feature's
// language-coverage tests exist to catch. Normalized at this integration
// boundary instead: `id` (what everything else matches on) is untouched.
const TRIGGER_CATEGORY_LABELS: Record<string, BilingualLabel> = {
  rest_required: { ja: '休憩の提案', en: 'Rest proposal' },
  monotony_prevention: { ja: '単調さへの介入', en: 'Monotony intervention' },
}

function localizeTriggerOption(option: ReviewOption, lang: 'ja' | 'en'): ReviewOption {
  const label = TRIGGER_CATEGORY_LABELS[option.id]
  return label ? { ...option, label: t(label, lang) } : option
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

export default function ReviewColumn({
  result,
}: {
  result: MergedInstantResult | null
}): JSX.Element {
  const { lang } = useLanguage()
  const { state, dispatch } = useReviewStore()

  const checkpoints = deriveCheckpoints(result)

  if (checkpoints.length === 0) {
    const selectedCase = state.selectedCaseId ? getCase(state.selectedCaseId) : null
    return (
      <div data-testid="review-column" style={{ padding: '12px' }}>
        <div data-testid="no-checkpoints" style={{ padding: '12px', color: '#64748b', fontSize: '0.86em' }}>
          {selectedCase ? (
            <>
              <p style={{ fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>
                {t(LABELS.noCheckpointsCaseTitle, lang)}
              </p>
              <p style={{ margin: 0 }}>
                「{t(selectedCase.title, lang)}」{t(LABELS.noCheckpointsCaseBody, lang)}
              </p>
            </>
          ) : result == null ? (
            <>
              <p style={{ fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>{t(LABELS.noRunTitle, lang)}</p>
              <p style={{ margin: 0 }}>{t(LABELS.noRunBody, lang)}</p>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>
                {t(LABELS.noCheckpointsTitle, lang)}
              </p>
              <p style={{ margin: 0 }}>{t(LABELS.noCheckpointsBody, lang)}</p>
            </>
          )}
        </div>
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

  const triggerOpts = (isUnavailable(triggerResult) ? [] : triggerResult).map((o) =>
    localizeTriggerOption(o, lang),
  )
  const serviceOpts = isUnavailable(serviceResult) ? [] : serviceResult
  const contentOpts = isUnavailable(contentResult) ? [] : contentResult.options

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

  const thresholdNote = stage === 'trigger' ? buildThresholdNote(fire, activeCheckpoint.category, lang) : null

  // `judgments` in the store is keyed by the full compound key so a
  // judgement made at one decision point never leaks into another; project
  // it back down to the bare-featureId map ParameterRationale expects,
  // scoped to the CURRENT case/checkpoint/stage/target.
  const caseId = state.selectedCaseId ?? ''
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
  }

  // Declared (setup-time) weight per feature is exactly what the LEFT
  // option's own chain recorded as `w` — realizedShares folds in the
  // observed value+response-coefficient via `contribution`; declaredShares
  // must NOT, or "intent vs effect" would always read "even".
  const declaredWeights: Record<string, number> = {}
  if (leftOption) {
    for (const row of leftOption.rows) declaredWeights[row.featureId] = row.w
  }

  const stageTab = (targetStage: ReviewStage, label: BilingualLabel, available: boolean, reason: string | null) => (
    <button
      type="button"
      data-testid={`stage-tab-${targetStage}`}
      disabled={!available}
      title={available ? '' : reasonText(reason ?? '', lang)}
      onClick={() => dispatch({ type: 'SELECT_STAGE', stage: targetStage })}
      style={{
        padding: '6px 12px',
        fontSize: '0.82em',
        fontWeight: 700,
        border: '1px solid #e2e8f0',
        borderBottom: stage === targetStage ? '2px solid #2563eb' : '1px solid #e2e8f0',
        background: stage === targetStage ? '#eff6ff' : '#f8fafc',
        color: available ? '#1e293b' : '#cbd5e1',
        cursor: available ? 'pointer' : 'not-allowed',
      }}
    >
      {t(label, lang)}
    </button>
  )

  return (
    <div data-testid="review-column">
      <div style={{ display: 'flex', gap: '4px', padding: '8px 8px 0' }}>
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
            thresholdNote={thresholdNote}
          />
          {leftOption && (
            <ParameterRationale
              stage={stage}
              left={leftOption}
              right={rightOption}
              declaredWeights={declaredWeights}
              judgments={scopedJudgments}
              onJudge={handleJudge}
            />
          )}
          {/* Task 16 mounts <DecisionAssessment> here. */}
        </>
      )}
    </div>
  )
}
