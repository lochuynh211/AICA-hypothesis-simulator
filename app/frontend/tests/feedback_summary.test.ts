import { collectCaseFeedback, toMarkdown, verdictLabel } from '../src/lib/review/feedbackSummary'
import { listCases } from '../src/lib/review/caseCatalog'

const C1 = 'case-c01-alert-daytime-control'
const C3 = 'case-c03-monotonous-highway'

// assessmentKey = caseId|checkpointId|stage|targetId
const aKey = (caseId: string, stage: string, target = 'rest_required') =>
  [caseId, 'rest_required', stage, target].join('|')
// judgmentKey = the same, plus a featureId
const jKey = (caseId: string, stage: string, feature: string) =>
  [caseId, 'rest_required', stage, 'rest_required', feature].join('|')

describe('collectCaseFeedback', () => {
  it('lists EVERY catalog case, including ones with no feedback', () => {
    const rows = collectCaseFeedback({}, {})
    expect(rows).toHaveLength(listCases().length)
    // Uncovered cases must be visible as uncovered — omitting them would read
    // as "all reviewed" when nothing has been.
    expect(rows.every((r) => r.empty)).toBe(true)
  })

  it('groups verdicts under their own case', () => {
    const rows = collectCaseFeedback(
      {
        [aKey(C1, 'trigger')]: { assessment: 'appropriate', comment: '' },
        [aKey(C1, 'service')]: { assessment: 'not_appropriate', comment: 'wrong service' },
        [aKey(C3, 'trigger')]: { assessment: 'not_sure', comment: '' },
      },
      {},
    )
    const c1 = rows.find((r) => r.caseId === C1)!
    const c3 = rows.find((r) => r.caseId === C3)!

    expect(c1.verdicts).toHaveLength(2)
    expect(c1.empty).toBe(false)
    expect(c3.verdicts).toHaveLength(1)
    expect(c3.verdicts[0].assessment).toBe('not_sure')
    // No leakage between cases.
    expect(c3.verdicts.some((v) => v.comment === 'wrong service')).toBe(false)
  })

  it('counts per-input judgements per case', () => {
    const rows = collectCaseFeedback(
      {},
      {
        [jKey(C1, 'trigger', 'fatigue')]: 'too_strong',
        [jKey(C1, 'trigger', 'drowsiness')]: 'rational',
        [jKey(C3, 'trigger', 'monotony')]: 'too_weak',
      },
    )
    expect(rows.find((r) => r.caseId === C1)!.inputJudgements).toBe(2)
    expect(rows.find((r) => r.caseId === C3)!.inputJudgements).toBe(1)
  })

  it('is not fooled by an empty record into reporting feedback', () => {
    // A record can exist with neither verdict nor comment (the store writes one
    // as soon as a comment field is touched) — that is not feedback.
    const rows = collectCaseFeedback(
      { [aKey(C1, 'trigger')]: { assessment: '', comment: '   ' } },
      {},
    )
    expect(rows.find((r) => r.caseId === C1)!.empty).toBe(true)
  })

  it('keeps a comment written before a verdict was chosen', () => {
    const rows = collectCaseFeedback(
      { [aKey(C1, 'trigger')]: { assessment: '', comment: 'looks early' } },
      {},
    )
    const c1 = rows.find((r) => r.caseId === C1)!
    expect(c1.empty).toBe(false)
    expect(c1.verdicts[0].comment).toBe('looks early')
  })

  it('orders a case’s verdicts trigger → service → content', () => {
    const rows = collectCaseFeedback(
      {
        [aKey(C1, 'content')]: { assessment: 'appropriate', comment: '' },
        [aKey(C1, 'trigger')]: { assessment: 'appropriate', comment: '' },
        [aKey(C1, 'service')]: { assessment: 'appropriate', comment: '' },
      },
      {},
    )
    expect(rows.find((r) => r.caseId === C1)!.verdicts.map((v) => v.stage)).toEqual([
      'trigger', 'service', 'content',
    ])
  })
})

describe('toMarkdown', () => {
  const stamp = '2026-07-29T00:00:00.000Z'

  it('says so plainly when nothing has been recorded', () => {
    const md = toMarkdown(collectCaseFeedback({}, {}), 'en', stamp)
    expect(md).toContain('No feedback has been recorded yet')
    expect(md).toContain('0 / 6')
  })

  it('renders each case as a section with its verdicts and comments', () => {
    const rows = collectCaseFeedback(
      {
        [aKey(C1, 'trigger')]: { assessment: 'appropriate', comment: 'fires at the right point' },
        [aKey(C1, 'service')]: { assessment: 'not_appropriate', comment: '' },
      },
      {},
    )
    const md = toMarkdown(rows, 'en', stamp)

    expect(md).toContain('# AICA review feedback')
    // The raw case id is NOT printed — this report is read by a customer, and
    // an identifier is not something they can act on. The title names the case.
    expect(md).not.toContain(C1)
    expect(md).toContain('- **Firing decision**: Appropriate')
    expect(md).toContain('Comment: fires at the right point')
    expect(md).toContain('- **Service proposal**: Not appropriate')
    expect(md).toContain('1 / 6')
    // A case with nothing recorded is named as empty, not omitted.
    expect(md).toContain('No feedback recorded for this case')
  })

  it('renders Japanese verdicts in JA', () => {
    const rows = collectCaseFeedback(
      { [aKey(C1, 'trigger')]: { assessment: 'not_sure', comment: '' } },
      {},
    )
    const md = toMarkdown(rows, 'ja', stamp)
    expect(md).toContain('# AICA レビュー結果')
    expect(md).toContain('不明')
  })

  it('keeps a multi-line comment inside its bullet', () => {
    const rows = collectCaseFeedback(
      { [aKey(C1, 'trigger')]: { assessment: 'appropriate', comment: 'line one\nline two' } },
      {},
    )
    const md = toMarkdown(rows, 'en', stamp)
    expect(md).toContain('  - Comment: line one\n    line two')
  })
})

describe('verdictLabel', () => {
  it('translates the three stored values', () => {
    expect(verdictLabel('appropriate', 'ja')).toBe('妥当')
    expect(verdictLabel('not_appropriate', 'ja')).toBe('不適')
    expect(verdictLabel('not_sure', 'ja')).toBe('不明')
  })

  it('reports an unknown stored value in words rather than dropping it', () => {
    // A verdict we cannot name is still one the reviewer recorded — so it is
    // still reported. It is reported IN WORDS, though: printing the raw stored
    // token would put a variable name in a report a customer reads.
    expect(verdictLabel('some_future_value', 'en')).toBe('Unrecognised verdict')
    expect(verdictLabel('some_future_value', 'ja')).toBe('判定内容を判別できません')
    expect(verdictLabel('some_future_value', 'en')).not.toContain('some_future_value')
  })
})
