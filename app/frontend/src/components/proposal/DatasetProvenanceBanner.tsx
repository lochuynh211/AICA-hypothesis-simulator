/**
 * DatasetProvenanceBanner (P3 T026) — read-only banner showing which frozen
 * dataset the current world's catalog references are drawn from
 * (`dataset_id` / `dataset_version` / `dataset_hash` / `tier`).
 *
 * READ-ONLY BY DESIGN (constraint: "Catalog is READ-ONLY in the UI —
 * provenance shown, but no edit/import control anywhere"): this component
 * renders identity fields only and exposes no button/input/link that could
 * mutate or import the catalog. The ONLY interactive element it may ever
 * contain is a plain disclosure toggle for `CatalogView` (view, not edit).
 */
import { t, type UiLanguage } from '../../i18n/t'
import type { DatasetProvenance } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'データセット（読み取り専用）', en: 'Dataset (read-only)' },
  tier: { ja: '層', en: 'tier' },
  noEdit: { ja: '編集・インポート不可', en: 'no edit/import' },
}

export default function DatasetProvenanceBanner({
  provenance,
  lang,
}: {
  provenance: DatasetProvenance | null
  lang: UiLanguage
}) {
  if (!provenance) {
    return (
      <div data-testid="dataset-provenance-banner" style={{ fontSize: '0.78em', color: '#9ca3af', padding: '4px 0' }}>
        {t(LABELS.title, lang)}…
      </div>
    )
  }
  return (
    <div
      data-testid="dataset-provenance-banner"
      style={{
        fontSize: '0.76em',
        color: '#4b5563',
        background: '#f8fafc',
        border: '1px solid #e5e7eb',
        borderRadius: '7px',
        padding: '6px 9px',
        margin: '4px 0 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      <div style={{ fontWeight: 700, color: '#6b7280' }}>{t(LABELS.title, lang)}</div>
      <div data-testid="dataset-provenance-id">
        <code>{provenance.dataset_id}</code>
      </div>
      <div>
        v{provenance.dataset_version.schema_version} · {t(LABELS.tier, lang)}={provenance.tier}
      </div>
      <div data-testid="dataset-provenance-hash" style={{ wordBreak: 'break-all', color: '#9ca3af' }}>
        {provenance.dataset_hash}
      </div>
      <div style={{ fontStyle: 'italic', color: '#9ca3af' }}>{t(LABELS.noEdit, lang)}</div>
    </div>
  )
}
