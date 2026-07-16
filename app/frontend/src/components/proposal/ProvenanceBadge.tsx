/**
 * ProvenanceBadge (P1 T025) — a small badge mapping a feature's provenance to
 * a short bilingual label.
 *
 * Covers the three `FeatureOriginProvenance` enum values
 * (`cdc_su_baseline` / `normalized_cdc_su_concept` / `proposed_addition`)
 * PLUS a fourth UI-only variant, `from_profile`, used by WorldPanel's
 * "Preference & history" section (values loaded from the selected driver
 * profile rather than typed directly by the reviewer).
 *
 * Pure/presentational — no store access.
 */
import { t, type UiLanguage } from '../../i18n/t'

export type ProvenanceKind =
  | 'cdc_su_baseline'
  | 'normalized_cdc_su_concept'
  | 'proposed_addition'
  | 'from_profile'

const LABELS: Record<ProvenanceKind, { ja: string; en: string }> = {
  cdc_su_baseline: { ja: 'CDC-SU', en: 'CDC-SU' },
  normalized_cdc_su_concept: { ja: '正規化', en: 'norm.' },
  proposed_addition: { ja: '追加提案', en: 'added' },
  from_profile: { ja: 'プロファイルから', en: 'from profile' },
}

const COLORS: Record<ProvenanceKind, { bg: string; fg: string; border: string }> = {
  cdc_su_baseline: { bg: '#eff6ff', fg: '#1d4ed8', border: '#c7d2fe' },
  normalized_cdc_su_concept: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  proposed_addition: { bg: '#f5f3ff', fg: '#7c3aed', border: '#ddd6fe' },
  from_profile: { bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db' },
}

type Props = {
  provenance: ProvenanceKind
  lang: UiLanguage
}

export default function ProvenanceBadge({ provenance, lang }: Props) {
  const label = LABELS[provenance]
  const color = COLORS[provenance]
  return (
    <span
      data-testid="provenance-badge"
      title={t(label, lang)}
      style={{
        display: 'inline-block',
        fontSize: '0.65em',
        fontWeight: 800,
        padding: '1px 6px',
        borderRadius: '999px',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        background: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
      }}
    >
      {t(label, lang)}
    </span>
  )
}
