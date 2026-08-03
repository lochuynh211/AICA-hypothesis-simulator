/**
 * RationaleText (feature 025, slice S7) — the rationale sentence + AI-
 * provenance badge, extracted VERBATIM out of `ReasonBreakdown.tsx` so the
 * centre panel (`ReasonBreakdown`, inside `ServiceResultOverlay`/
 * `ContentResultOverlay`) and the right panel's new rank-1 summary
 * (`RankOneSummary.tsx`) render the SAME markup from one source instead of
 * drifting apart (S7 build note 1: "extract, don't duplicate").
 *
 * Three states, exactly as before the extraction:
 *   - `aiExplanation.status === 'ready'`   → the AI sentence + provenance
 *     badge (+ a "fell back to default" note when the requested provider
 *     failed and the deterministic template was used instead).
 *   - `aiExplanation.status === 'loading'` → a muted "generating…" line.
 *   - otherwise (`null`/`'error'`)         → the deterministic `rationale`
 *     pair (`pickRationale`), with an "AI unavailable" note appended only on
 *     a genuine `'error'`.
 *
 * `rationale` is a POSITIONAL bilingual pair (`[ja_text, en_text]`, per the
 * mock packages' contract) — resolved with `pickRationale()`, NOT `t()`.
 */
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import { pickRationale } from '../../api/proposalClient'
import type { AiExplanation } from './useExplanation'

const LABELS = {
  aiGenerating: { ja: 'AI生成中…', en: 'generating…' },
  aiFellBack: { ja: '（AI利用不可 — 既定の説明に戻りました）', en: '(AI unavailable — showing default rationale)' },
  aiError: { ja: '（AI説明を取得できませんでした — 既定の説明）', en: '(could not get AI explanation — default rationale)' },
  // WHICH model wrote the sentence is provenance a reviewer needs — an
  // explanation is only auditable if its source is named — so the model name
  // stays. It is a product name (like Ollama or Gemini Nano), not an internal
  // identifier, which is why it may sit inside Japanese text.
  aiProvenance: { ja: 'AI生成', en: 'AI-generated' },
}

export type RationaleTextProps = {
  /** Positional bilingual pair: `[ja_text, en_text]`. */
  rationale: string[]
  /** feature 019 — when an explanation provider is active, the resolved
   * AI-generated sentence (or its loading/error state). `null`/omitted shows
   * the deterministic templated `rationale` instead. Never replaces the
   * numeric trace elsewhere on the card, only this sentence. */
  aiExplanation?: AiExplanation | null
  /** Accent colour for the AI-provenance badge — callers pick per surface
   *  (service blue, content purple, trigger amber, …). */
  accent: string
  lang: UiLanguage
}

export default function RationaleText({ rationale, aiExplanation = null, accent, lang }: RationaleTextProps): JSX.Element {
  if (aiExplanation?.status === 'ready') {
    return (
      <p data-testid="ai-rationale" style={{ padding: '0 10px 9px', fontSize: '0.8em', color: '#4b5563', fontStyle: 'italic' }}>
        {aiExplanation.text}{' '}
        <span
          data-testid="ai-rationale-badge"
          style={{
            display: 'inline-block',
            fontSize: '0.86em',
            fontStyle: 'normal',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '999px',
            background: '#eef2ff',
            color: accent,
            border: `1px solid ${accent}33`,
          }}
        >
          {t(LABELS.aiProvenance, lang)}
          {aiExplanation.model ? ` · ${aiExplanation.model}` : ''}
        </span>
        {aiExplanation.fellBack && (
          <span data-testid="ai-fellback-note" style={{ fontStyle: 'normal', color: '#b45309' }}>
            {' '}
            {t(LABELS.aiFellBack, lang)}
          </span>
        )}
      </p>
    )
  }

  if (aiExplanation?.status === 'loading') {
    return (
      <p data-testid="ai-rationale-loading" style={{ padding: '0 10px 9px', fontSize: '0.8em', color: '#9ca3af', fontStyle: 'italic' }}>
        {t(LABELS.aiGenerating, lang)}
      </p>
    )
  }

  return (
    <p style={{ padding: '0 10px 9px', fontSize: '0.8em', color: '#4b5563', fontStyle: 'italic' }}>
      {pickRationale(rationale, lang)}
      {aiExplanation?.status === 'error' && (
        <span data-testid="ai-error-note" style={{ fontStyle: 'normal', color: '#b45309' }}>
          {' '}
          {t(LABELS.aiError, lang)}
        </span>
      )}
    </p>
  )
}
