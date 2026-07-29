/**
 * Roll the review store's per-decision records up per TEST CASE, and render
 * them as a report a person can read.
 *
 * Both the summary popup and the Markdown export read from here, so the two can
 * never disagree about what was recorded. This is pure arithmetic + formatting
 * over what the reviewer actually entered — it never infers a verdict, never
 * fills a gap, and a case with nothing recorded is reported as such rather than
 * as "appropriate" by omission.
 */
import type { BilingualLabel } from '../../i18n/t'
import { t } from '../../i18n/t'
import { listCases, getCase } from './caseCatalog'
import { CATEGORY_LABELS, isKnownService, serviceLabel } from './reviewVocabulary'

/** `assessmentKey` / `judgmentKey` share this delimiter convention. */
const SEP = '|'

export type StageVerdict = {
  checkpointId: string
  stage: string
  targetId: string
  assessment: string
  comment: string
}

export type CaseFeedback = {
  caseId: string
  title: BilingualLabel
  /** Every decision-level verdict recorded under this case. */
  verdicts: StageVerdict[]
  /** How many per-input judgements were recorded under this case. */
  inputJudgements: number
  /** True when the reviewer recorded nothing at all here. */
  empty: boolean
}

const VERDICT_LABEL: Record<string, BilingualLabel> = {
  appropriate: { ja: '妥当', en: 'Appropriate' },
  not_appropriate: { ja: '不適', en: 'Not appropriate' },
  not_sure: { ja: '不明', en: 'Not sure' },
}

/** The three review stages. `発火判定` is the specification's word for the
 *  first one (CDC-SU_specplan Slide 29「トリガー検知・発火」) — the UI never
 *  says「トリガー」. */
const STAGE_LABEL: Record<string, BilingualLabel> = {
  trigger: { ja: '発火判定', en: 'Firing decision' },
  service: { ja: 'サービス提案', en: 'Service proposal' },
  content: { ja: 'コンテンツ提案', en: 'Content proposal' },
}

/** A stored value with no registered label is reported as unrecognised IN
 *  WORDS. Printing the raw stored token would put a variable name in a report
 *  a customer reads. */
const UNRECOGNISED_VERDICT: BilingualLabel = { ja: '判定内容を判別できません', en: 'Unrecognised verdict' }
const UNRECOGNISED_STAGE: BilingualLabel = { ja: '段階を判別できません', en: 'Unrecognised stage' }
const UNRECOGNISED_POINT: BilingualLabel = { ja: '決定ポイントを判別できません', en: 'Unrecognised decision point' }
const UNTITLED_CASE: BilingualLabel = { ja: '名称未登録のテストケース', en: 'Untitled test case' }

const STAGE_ORDER = ['trigger', 'service', 'content']

export function verdictLabel(value: string, lang: 'ja' | 'en'): string {
  const label = VERDICT_LABEL[value]
  // An unrecognised stored value is still REPORTED rather than dropped — a
  // verdict we cannot name is still a verdict the reviewer recorded — but it is
  // reported in words, never as the raw stored token.
  return t(label ?? UNRECOGNISED_VERDICT, lang)
}

export function stageLabel(value: string, lang: 'ja' | 'en'): string {
  return t(STAGE_LABEL[value] ?? UNRECOGNISED_STAGE, lang)
}

/**
 * The decision point and the reviewed option, IN WORDS.
 *
 * `checkpointId` is a proposal category and `targetId` is whatever that stage
 * compared — a category, a service, or a catalog item. The first two have
 * registered names; a catalog item does not (the song catalog is not loaded
 * here), so it is named by its KIND rather than by its id. Either way the raw
 * identifier never reaches the exported report, which is a document a customer
 * reads.
 */
const CONTENT_TARGET: BilingualLabel = { ja: 'コンテンツ候補', en: 'a content candidate' }
const UNNAMED_TARGET: BilingualLabel = { ja: '対象を判別できません', en: 'Unrecognised target' }

export function targetLabel(stage: string, targetId: string, lang: 'ja' | 'en'): string {
  if (!targetId) return ''
  if (stage === 'content') return t(CONTENT_TARGET, lang)
  const category = CATEGORY_LABELS[targetId]
  if (category) return t(category, lang)
  if (isKnownService(targetId)) return t(serviceLabel(targetId), lang)
  return t(UNNAMED_TARGET, lang)
}

/**
 * One entry per case in the catalog, in catalog order, whether or not it has
 * feedback — the reviewer needs to see which cases they have NOT covered as
 * much as which they have.
 */
export function collectCaseFeedback(
  assessments: Record<string, { assessment: string; comment: string }>,
  judgments: Record<string, string>,
): CaseFeedback[] {
  const byCase = new Map<string, StageVerdict[]>()
  for (const [key, value] of Object.entries(assessments)) {
    const [caseId, checkpointId, stage, targetId] = key.split(SEP)
    if (!caseId) continue
    // A record with neither a verdict nor a comment is not feedback.
    if (!value.assessment && !value.comment.trim()) continue
    const list = byCase.get(caseId) ?? []
    list.push({
      checkpointId: checkpointId ?? '',
      stage: stage ?? '',
      targetId: targetId ?? '',
      assessment: value.assessment,
      comment: value.comment,
    })
    byCase.set(caseId, list)
  }

  const judgementCounts = new Map<string, number>()
  for (const [key, judgment] of Object.entries(judgments)) {
    if (!judgment) continue
    const caseId = key.split(SEP)[0]
    if (!caseId) continue
    judgementCounts.set(caseId, (judgementCounts.get(caseId) ?? 0) + 1)
  }

  return listCases().map((testCase) => {
    const verdicts = (byCase.get(testCase.case_id) ?? []).slice().sort(
      (a, b) =>
        a.checkpointId.localeCompare(b.checkpointId) ||
        STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
        a.targetId.localeCompare(b.targetId),
    )
    const inputJudgements = judgementCounts.get(testCase.case_id) ?? 0
    return {
      caseId: testCase.case_id,
      title: testCase.title,
      verdicts,
      inputJudgements,
      empty: verdicts.length === 0 && inputJudgements === 0,
    }
  })
}

/** ISO-ish stamp for the report header. Passed in, never read from a clock
 *  here, so the output is a pure function of its inputs. */
export function toMarkdown(
  cases: CaseFeedback[],
  lang: 'ja' | 'en',
  generatedAt: string,
): string {
  const L = {
    title: { ja: '# AICA レビュー結果', en: '# AICA review feedback' },
    generated: { ja: '生成日時', en: 'Generated' },
    covered: { ja: 'フィードバックのあるケース', en: 'Cases with feedback' },
    noneAtAll: {
      ja: '_まだフィードバックは記録されていません。_',
      en: '_No feedback has been recorded yet._',
    },
    noFeedback: { ja: '_このケースにはフィードバックがありません。_', en: '_No feedback recorded for this case._' },
    comment: { ja: 'コメント', en: 'Comment' },
    inputs: { ja: '個別入力の評価', en: 'Per-input judgements' },
    decisionPoint: { ja: '決定ポイント', en: 'Decision point' },
    reviewedTarget: { ja: 'レビュー対象', en: 'Reviewed option' },
  } satisfies Record<string, BilingualLabel>

  const withFeedback = cases.filter((c) => !c.empty)
  const out: string[] = []
  out.push(t(L.title, lang))
  out.push('')
  out.push(`${t(L.generated, lang)}: ${generatedAt}`)
  out.push(`${t(L.covered, lang)}: ${withFeedback.length} / ${cases.length}`)
  out.push('')

  if (withFeedback.length === 0) {
    out.push(t(L.noneAtAll, lang))
    out.push('')
    return out.join('\n')
  }

  for (const c of cases) {
    // The heading is the case TITLE only. The raw case id used to be printed
    // underneath it; this report is read by a customer, and an identifier is
    // not something they can act on.
    out.push(`## ${t(c.title, lang)}`)
    out.push('')
    if (c.empty) {
      out.push(t(L.noFeedback, lang))
      out.push('')
      continue
    }
    for (const v of c.verdicts) {
      const verdict = v.assessment ? verdictLabel(v.assessment, lang) : '—'
      out.push(`- **${stageLabel(v.stage, lang)}**: ${verdict}`)
      if (v.checkpointId) {
        const point = t(CATEGORY_LABELS[v.checkpointId] ?? UNRECOGNISED_POINT, lang)
        out.push(`  - ${t(L.decisionPoint, lang)}: ${point}`)
        const target = targetLabel(v.stage, v.targetId, lang)
        if (target) out.push(`  - ${t(L.reviewedTarget, lang)}: ${target}`)
      }
      if (v.comment.trim()) {
        // Indent every line so a multi-line comment stays inside the bullet.
        const body = v.comment.trim().split('\n').join('\n    ')
        out.push(`  - ${t(L.comment, lang)}: ${body}`)
      }
    }
    if (c.inputJudgements > 0) {
      out.push(`- ${t(L.inputs, lang)}: ${c.inputJudgements}`)
    }
    out.push('')
  }

  return out.join('\n')
}

/** Convenience for callers that only have a case id. An id with no committed
 *  case is named as untitled rather than printed raw. */
export function caseTitle(caseId: string, lang: 'ja' | 'en'): string {
  const testCase = getCase(caseId)
  return testCase ? t(testCase.title, lang) : t(UNTITLED_CASE, lang)
}
