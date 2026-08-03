/**
 * ReasonBreakdown (P1 T025) — the shared "why this candidate/item" table.
 *
 * Same grammar for both the service selector (`service_fit`) and the content
 * selector (`item_fit`) per design decision D9: a per-feature row of
 * `feature -> value -> response(a) -> weight(w) -> signed contribution`,
 * plus supporting/opposing feature chips and a bilingual rationale.
 *
 * Callers normalize their differently-named contribution fields
 * (`FeatureContribution` for the service side, `ItemFeatureContribution` for
 * the content side) into `ReasonRow[]` before rendering — this component
 * itself has no knowledge of either shape, only the shared "reason" grammar.
 *
 * `rationale` is a POSITIONAL bilingual pair (`[ja_text, en_text]`, per the
 * mock packages' contract) — resolved with `pickRationale()`, NOT `t()`.
 */
import { useEffect } from 'react'
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import type { AiExplanation } from './useExplanation'
import RationaleText from './RationaleText'
import { booleanLabel, fieldName, isKnownOption, optionLabel } from '../../lib/review/reviewVocabulary'

export type ReasonRow = {
  featureId: string
  value: string | number
  /** Response coefficient — `response_coefficient` (service) or `a_i` (content). */
  r: number
  /** Weight — `weight` (service) or `effective_weight` (content). */
  w: number
  contribution: number
}

export type ReasonBreakdownProps = {
  rows: ReasonRow[]
  supportingFeatureIds: string[]
  opposingFeatureIds: string[]
  /** Positional bilingual pair: `[ja_text, en_text]`. */
  rationale: string[]
  lang: UiLanguage
  /** Whether the <details> disclosure starts open. Default: closed. */
  defaultOpen?: boolean
  /** Purely cosmetic — content panel uses the "mono" accent color. */
  variant?: 'service' | 'content'
  /** When false, omit the per-feature score table (chips + rationale stay). */
  showTable?: boolean
  /** feature 019 — when an explanation provider is active, the resolved
   * AI-generated sentence (or its loading/error state). `null`/omitted keeps
   * the deterministic templated `rationale`. Never replaces the numeric trace,
   * only the italic sentence at the bottom. */
  aiExplanation?: AiExplanation | null
  /** feature 019 — fired when the disclosure is first opened, so the caller can
   * lazily request the explanation (on-demand generation). */
  onExpand?: () => void
}

const LABELS = {
  summary: { ja: 'この候補の理由（スコア内訳）', en: 'Why this candidate (score breakdown)' },
  feature: { ja: '特徴量', en: 'Feature' },
  value: { ja: '値', en: 'Value' },
  responseCoefficient: { ja: '応答係数', en: 'Response coefficient' },
  weight: { ja: '重み', en: 'Weight' },
  contribution: { ja: '寄与', en: 'Contribution' },
  supportedBy: { ja: '支持:', en: 'Supported by:' },
  opposedBy: { ja: '反対:', en: 'Opposed by:' },
}

function fmt(n: number): string {
  return n.toFixed(3)
}

/** A row's "value" cell carries either a formatted number or a categorical/
 * boolean world value (`night`, `congested`, or an actual boolean) — the
 * latter must render as words, never the enum literal or a JS boolean's
 * `true`/`false` string form. */
function fmtRowValue(featureId: string, value: unknown, lang: UiLanguage): string {
  if (typeof value === 'boolean') return t(booleanLabel(value), lang)
  if (typeof value === 'string' && isKnownOption(featureId, value)) return t(optionLabel(featureId, value), lang)
  return String(value)
}

export default function ReasonBreakdown({
  rows,
  supportingFeatureIds,
  opposingFeatureIds,
  rationale,
  lang,
  defaultOpen = false,
  variant = 'service',
  showTable = true,
  aiExplanation = null,
  onExpand,
}: ReasonBreakdownProps) {
  const accent = variant === 'content' ? '#7c3aed' : '#1d4ed8'

  // If the disclosure starts open, the browser fires no toggle event, so
  // request the explanation on mount for that case (idempotent in the caller).
  useEffect(() => {
    if (defaultOpen) onExpand?.()
    // Only on mount / when defaultOpen flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen])

  return (
    <details
      data-testid="reason-breakdown"
      open={defaultOpen}
      style={{ borderTop: '1px solid #e5e7eb' }}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) onExpand?.()
      }}
    >
      <summary
        data-testid="reason-summary"
        style={{ cursor: 'pointer', padding: '6px 10px', fontSize: '0.8em', fontWeight: 700, color: accent }}
      >
        {t(LABELS.summary, lang)}
      </summary>

      {showTable && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8em' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                  {t(LABELS.feature, lang)}
                </th>
                <th style={{ textAlign: 'right', padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                  {t(LABELS.value, lang)}
                </th>
                <th style={{ textAlign: 'right', padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                  {t(LABELS.responseCoefficient, lang)}
                </th>
                <th style={{ textAlign: 'right', padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                  {t(LABELS.weight, lang)}
                </th>
                <th style={{ textAlign: 'right', padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                  {t(LABELS.contribution, lang)}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.featureId}>
                  <td style={{ padding: '3px 8px', borderBottom: '1px solid #f1f5f9' }}>
                    {t(fieldName(row.featureId), lang)}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>
                    {fmtRowValue(row.featureId, row.value, lang)}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>
                    {fmt(row.r)}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace' }}>
                    {fmt(row.w)}
                  </td>
                  <td
                    style={{
                      padding: '3px 8px',
                      textAlign: 'right',
                      borderBottom: '1px solid #f1f5f9',
                      fontFamily: 'monospace',
                      color: row.contribution >= 0 ? '#047857' : '#dc2626',
                    }}
                  >
                    {fmt(row.contribution)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding: '2px 10px 8px', fontSize: '0.78em', color: '#6b7280' }}>
        <b>{t(LABELS.supportedBy, lang)}</b>{' '}
        <span data-testid="reason-supporting">
          {supportingFeatureIds.length > 0
            ? supportingFeatureIds.map((id) => (
                <span
                  key={id}
                  style={{
                    display: 'inline-block',
                    fontSize: '0.92em',
                    padding: '1px 7px',
                    borderRadius: '999px',
                    margin: '2px 3px 0 0',
                    background: '#ecfdf5',
                    color: '#047857',
                    border: '1px solid #a7f3d0',
                  }}
                >
                  {t(fieldName(id), lang)}
                </span>
              ))
            : '—'}
        </span>{' '}
        <b>{t(LABELS.opposedBy, lang)}</b>{' '}
        <span data-testid="reason-opposing">
          {opposingFeatureIds.length > 0
            ? opposingFeatureIds.map((id) => (
                <span
                  key={id}
                  style={{
                    display: 'inline-block',
                    fontSize: '0.92em',
                    padding: '1px 7px',
                    borderRadius: '999px',
                    margin: '2px 3px 0 0',
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fecaca',
                  }}
                >
                  {t(fieldName(id), lang)}
                </span>
              ))
            : '—'}
        </span>
      </div>

      <RationaleText rationale={rationale} aiExplanation={aiExplanation} accent={accent} lang={lang} />
    </details>
  )
}
