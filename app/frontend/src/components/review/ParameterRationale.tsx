// app/frontend/src/components/review/ParameterRationale.tsx
/**
 * "Parameter rationale" — the lower-half review panel.
 *
 * A table of every input the LEFT option's chain recorded, ordered by
 * REALIZED influence (not declared weight, not input order — see
 * `realizedShares`), with a per-row judgement the reviewer records directly.
 *
 * Necessity and flip distance are deliberately NOT columns: a reviewer cannot
 * interpret "necessity: true" or "flip: 1.35" as bare numbers. They only mean
 * something stated as a sentence naming the alternative option that would
 * have been chosen instead (07-27 §8) — so both live under "What a different
 * setting would do", rendered only when there IS a named alternative
 * (`right`) and the stage is not `trigger`, where no such alternative exists
 * in the sense these sentences require.
 *
 * `flipDistance` in particular has three distinct answers that must never be
 * collapsed into one rendering: a factor (a real flip point), `null` (no
 * setting of this input alone flips the outcome, within the bounded search),
 * and `Unavailable` (the evidence to answer was never recorded). Printing a
 * number for the latter two would fabricate precision that was never there.
 */
import type { ReviewOption, ReviewChainRow } from '../../lib/review/types'
import {
  realizedShares, declaredShares, intentVsEffect, necessity, flipDistance, playedNoPart,
} from '../../lib/review/reviewMath'
import { phrase, bandWord } from '../../lib/review/reviewVocabulary'
import type { BilingualLabel } from '../../lib/review/reviewVocabulary'
import type { ReviewStage } from '../../lib/review/checkpoints'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  title: { ja: 'パラメータの根拠', en: 'Parameter rationale' },
  colFeature: { ja: '入力', en: 'input' },
  colSituation: { ja: '状況', en: 'situation' },
  colDeclared: { ja: '設定上の重み', en: 'declared' },
  colRealized: { ja: '実際の寄与', en: 'realized' },
  colRatio: { ja: '意図どおりか', en: '↑↓≈' },
  colJudge: { ja: 'あなたの見解', en: 'your view' },
  differentSettingTitle: {
    ja: '設定が違えばどうなっていたか', en: 'What a different setting would do',
  },
  playedNoPartTitle: {
    ja: '影響しなかった入力', en: 'Played no part',
  },
  playedNoPartNone: {
    ja: 'すべての入力が最終判断に何らかの影響を与えました。',
    en: 'Every input had at least some effect on the final decision.',
  },
  judgeNotJudged: { ja: '— 未評価 —', en: '— not judged —' },
  judgeMakesSense: { ja: '妥当', en: 'Makes sense' },
  judgeTooStrong: { ja: '強すぎる', en: 'Too strong' },
  judgeTooWeak: { ja: '弱すぎる', en: 'Too weak' },
  judgeNotRelevant: { ja: 'ここでは無関係', en: 'Not relevant here' },
  judgeNotSure: { ja: 'わからない', en: 'Not sure' },
}

const JUDGEMENT_OPTIONS: { value: string; label: BilingualLabel }[] = [
  { value: '', label: LABELS.judgeNotJudged },
  { value: 'rational', label: LABELS.judgeMakesSense },
  { value: 'too_strong', label: LABELS.judgeTooStrong },
  { value: 'too_weak', label: LABELS.judgeTooWeak },
  { value: 'not_relevant_here', label: LABELS.judgeNotRelevant },
  { value: 'unsure', label: LABELS.judgeNotSure },
]

/**
 * `reviewMath.ts` reasons are raw English diagnostic literals, never
 * bilingual — they must NEVER be interpolated verbatim into a JA sentence.
 * There are exactly two reason shapes today; anything unrecognised (a future
 * third reason) falls to a generic bilingual sentence rather than leaking
 * English into the default-JA UI.
 */
const REASON_NO_CONTRIBUTION_PREFIX = 'no recorded contribution for'
const REASON_NO_REDISTRIBUTE = 'no other feature could absorb the redistributed weight'

function reasonSentence(reason: string, label: string, lang: 'ja' | 'en'): string {
  if (reason.startsWith(REASON_NO_CONTRIBUTION_PREFIX)) {
    return lang === 'ja'
      ? `「${label}」について記録された寄与がありません`
      : `no contribution was recorded for ${label}`
  }
  if (reason === REASON_NO_REDISTRIBUTE) {
    return lang === 'ja'
      ? '重みを再配分できる他の入力がありません'
      : 'no other input could absorb the redistributed weight'
  }
  return lang === 'ja'
    ? '記録されたデータからは判定できません'
    : 'this could not be determined from the recorded data'
}

/** `value · bandWord(band, value)` for a numeric row; the raw string for a categorical one. */
function situationText(row: ReviewChainRow, lang: 'ja' | 'en'): string {
  if (typeof row.value !== 'number') return String(row.value)
  return `${row.value} · ${t(bandWord(row.band, row.value), lang)}`
}

const RATIO_SYMBOL: Record<'up' | 'down' | 'even', string> = { up: '↑', down: '↓', even: '≈' }

/** "Remove X and this decision becomes Y" / holds / reason it cannot be told — never a number. */
function necessitySentence(
  featureId: string, left: ReviewOption, right: ReviewOption, lang: 'ja' | 'en',
): string {
  const label = t(phrase(featureId), lang)
  const result = necessity(left, right, featureId)
  if ('available' in result) {
    const reason = reasonSentence(result.reason, label, lang)
    return lang === 'ja'
      ? `「${label}」を取り除いた場合の影響は判定できません（${reason}）。`
      : `Whether ${label} was necessary cannot be told (${reason}).`
  }
  if (!result.changed) {
    return lang === 'ja'
      ? `「${label}」を取り除いても、この判断は変わりません。`
      : `Even without ${label}, the decision still holds.`
  }
  const winnerLabel = t(result.winnerId === left.id ? left.label : right.label, lang)
  return lang === 'ja'
    ? `「${label}」を取り除くと、この判断は「${winnerLabel}」になります。`
    : `Remove ${label} and this decision becomes ${winnerLabel}.`
}

/** "If X mattered N% more, Y would have been chosen instead" / no flip / reason — never a number for the latter two. */
function flipSentence(
  featureId: string, left: ReviewOption, right: ReviewOption, lang: 'ja' | 'en',
): string {
  const label = t(phrase(featureId), lang)
  const result = flipDistance(left, right, featureId)
  if (result === null) {
    return lang === 'ja'
      ? `「${label}」をどのように変えても、この判断は変わりません。`
      : `No setting of ${label} alone changes this decision.`
  }
  if ('available' in result) {
    const reason = reasonSentence(result.reason, label, lang)
    return lang === 'ja'
      ? `「${label}」がどれだけ変われば結果が変わるかは判定できません（${reason}）。`
      : `What would flip ${label} cannot be told (${reason}).`
  }
  const pct = Math.round((result.factor - 1) * 100)
  const rightLabel = t(right.label, lang)
  return lang === 'ja'
    ? `「${label}」の影響が約 ${pct}% 大きければ、「${rightLabel}」が選ばれていました。`
    : `If ${label} mattered about ${pct}% more, ${rightLabel} would have been chosen instead.`
}

export default function ParameterRationale({
  stage, left, right, declaredWeights, judgments, onJudge,
}: {
  stage: ReviewStage
  left: ReviewOption
  right: ReviewOption | null
  declaredWeights: Record<string, number>
  judgments: Record<string, string>
  onJudge: (featureId: string, judgment: string) => void
}): JSX.Element {
  const { lang } = useLanguage()

  const realized = realizedShares(left.rows)
  const declared = declaredShares(declaredWeights)
  const rows = [...left.rows].sort(
    (a, b) => (realized[b.featureId] ?? 0) - (realized[a.featureId] ?? 0),
  )

  // Both consequence sections only mean something against a NAMED
  // alternative — the trigger stage has none in the sense they require.
  const showConsequences = stage !== 'trigger' && right !== null

  const idColStyle: React.CSSProperties = { fontSize: '0.74em', color: '#1e293b' }
  const faintIdStyle: React.CSSProperties = { fontSize: '0.68em', color: '#cbd5e1', marginLeft: '4px' }

  return (
    <div data-testid="parameter-rationale" style={{ padding: '12px' }}>
      <p style={{ fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '0 0 8px' }}>
        {t(LABELS.title, lang)}
      </p>

      <div style={{ display: 'flex', fontSize: '0.68em', fontWeight: 700, color: '#64748b', padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ flex: 2 }}>{t(LABELS.colFeature, lang)}</span>
        <span style={{ flex: 2 }}>{t(LABELS.colSituation, lang)}</span>
        <span style={{ flex: 1 }}>{t(LABELS.colDeclared, lang)}</span>
        <span style={{ flex: 1 }}>{t(LABELS.colRealized, lang)}</span>
        <span style={{ flex: 1 }}>{t(LABELS.colRatio, lang)}</span>
        <span style={{ flex: 2 }}>{t(LABELS.colJudge, lang)}</span>
      </div>

      {rows.map((row) => {
        const ratio = intentVsEffect(realized[row.featureId] ?? 0, declared[row.featureId] ?? 0)
        return (
          <div
            key={row.featureId}
            style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.82em' }}
          >
            <span data-testid="rationale-feature" style={{ ...idColStyle, flex: 2 }}>
              {t(phrase(row.featureId), lang)}
              <span style={faintIdStyle}>{row.featureId}</span>
            </span>
            <span data-testid={`rationale-situation-${row.featureId}`} style={{ flex: 2, color: '#475569' }}>
              {situationText(row, lang)}
            </span>
            <span data-testid={`rationale-declared-${row.featureId}`} style={{ flex: 1, color: '#64748b' }}>
              {Math.round((declared[row.featureId] ?? 0) * 100)}%
            </span>
            <span data-testid={`rationale-realized-${row.featureId}`} style={{ flex: 1, color: '#64748b' }}>
              {Math.round((realized[row.featureId] ?? 0) * 100)}%
            </span>
            <span
              data-testid={`rationale-ratio-${row.featureId}`}
              style={{ flex: 1, fontWeight: 700, color: ratio === 'up' ? '#dc2626' : ratio === 'down' ? '#2563eb' : '#94a3b8' }}
            >
              {RATIO_SYMBOL[ratio]}
            </span>
            <span style={{ flex: 2 }}>
              <select
                id={`rationale-judge-${row.featureId}`}
                data-testid={`rationale-judge-${row.featureId}`}
                aria-label={t(phrase(row.featureId), lang)}
                value={judgments[row.featureId] ?? ''}
                onChange={(e) => onJudge(row.featureId, e.target.value)}
                style={{ width: '100%', fontSize: '0.92em', padding: '3px' }}
              >
                {JUDGEMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{t(opt.label, lang)}</option>
                ))}
              </select>
            </span>
          </div>
        )
      })}

      {showConsequences && right && (
        <div data-testid="different-setting" style={{ marginTop: '14px' }}>
          <p style={{ fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '0 0 8px' }}>
            {t(LABELS.differentSettingTitle, lang)}
          </p>
          {rows.slice(0, 3).map((row) => (
            <div key={row.featureId} style={{ marginBottom: '8px' }}>
              <p data-testid={`consequence-${row.featureId}-necessity`} style={{ fontSize: '0.84em', lineHeight: 1.6, color: '#1e293b', margin: '0 0 2px' }}>
                {necessitySentence(row.featureId, left, right, lang)}
              </p>
              <p data-testid={`consequence-${row.featureId}-flip`} style={{ fontSize: '0.84em', lineHeight: 1.6, color: '#1e293b', margin: 0 }}>
                {flipSentence(row.featureId, left, right, lang)}
              </p>
            </div>
          ))}
        </div>
      )}

      {showConsequences && (() => {
        const noPart = playedNoPart(left.rows)
        return (
          <div data-testid="played-no-part" style={{ marginTop: '14px' }}>
            <p style={{ fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '0 0 8px' }}>
              {t(LABELS.playedNoPartTitle, lang)}
            </p>
            {noPart.length === 0 ? (
              <p style={{ fontSize: '0.84em', color: '#64748b', margin: 0 }}>{t(LABELS.playedNoPartNone, lang)}</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {noPart.map((featureId) => (
                  <li key={featureId} style={{ fontSize: '0.84em', color: '#1e293b', lineHeight: 1.6 }}>
                    {t(phrase(featureId), lang)}
                    <span style={faintIdStyle}>{featureId}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })()}
    </div>
  )
}
