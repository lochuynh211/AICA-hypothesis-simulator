/**
 * RecomputePanel (P7 T030/T033/T035, US1/US5) — edits post-rest context
 * (drowsiness/fatigue today; structured as a small field-config list so
 * other overridable `situation.*` fields can be added later without
 * reshaping the component) and, on "Recompute", calls
 * `recompute(runId, overrides)` and dispatches the returned log as
 * `RECOMPUTED` (P7 contracts/recompute-api.md).
 *
 * DISPLAY-ONLY: this never decides a proposal — it only submits the
 * reviewer's explicit overrides and renders whatever `ProposalRunLog` the
 * backend computed. A 422 (invalid override, or `playback_state` active/
 * backgrounded — FR-006a) surfaces inline via `role="alert"`, mirroring
 * `JourneyActionBar`'s error handling: never a silent no-op.
 */
import { useState } from 'react'
import { t, type BilingualLabel } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { recompute, type FieldOverride } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'コンテキスト編集 & 再計算', en: 'Edit context & recompute' },
  drowsiness: { ja: '眠気レベル', en: 'Drowsiness level' },
  fatigue: { ja: '疲労レベル', en: 'Fatigue level' },
  hint: {
    ja: '空欄の項目は変更されません（現在のシミュレーション条件のまま再計算されます）。',
    en: 'Blank fields are left unchanged — recomputed against the current simulation conditions.',
  },
  recompute: { ja: '再計算', en: 'Recompute' },
}

/** One editable `situation.*` field. Add more entries here to extend the
 * panel to other overridable context fields without touching the render
 * logic below. */
type EditableField = { key: string; path: string; label: BilingualLabel }

const EDITABLE_FIELDS: EditableField[] = [
  { key: 'drowsiness_level', path: 'situation.drowsiness_level', label: LABELS.drowsiness },
  { key: 'fatigue_level', path: 'situation.fatigue_level', label: LABELS.fatigue },
]

export default function RecomputePanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, runLog } = state
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  if (!runLog) return null

  async function handleRecompute() {
    if (!runLog) return
    setPending(true)
    setLocalError(null)
    try {
      const overrides: FieldOverride[] = []
      for (const field of EDITABLE_FIELDS) {
        const raw = values[field.key]
        if (raw === undefined || raw === '') continue
        overrides.push({ path: field.path, value: Number(raw) })
      }
      const updated = await recompute(runLog.run_id, overrides)
      dispatch({ type: 'RECOMPUTED', runLog: updated })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div data-testid="recompute-panel">
      <div style={sectionLabelStyle}>{t(LABELS.title, lang)}</div>
      <div style={grid2Style}>
        {EDITABLE_FIELDS.map((field) => (
          <label key={field.key} style={fieldLabelStyle}>
            {t(field.label, lang)}
            <input
              type="number"
              data-testid={`recompute-field-${field.key}`}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p style={hintStyle}>{t(LABELS.hint, lang)}</p>
      <button
        type="button"
        data-testid="recompute-button"
        disabled={pending}
        onClick={handleRecompute}
        style={recomputeButtonStyle}
      >
        {pending ? '…' : t(LABELS.recompute, lang)}
      </button>
      {localError && (
        <p role="alert" data-testid="recompute-error" style={{ color: '#dc2626', fontSize: '0.8em' }}>
          {localError}
        </p>
      )}
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const grid2Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  fontSize: '0.82em',
  color: '#4b5563',
}

const hintStyle: React.CSSProperties = {
  margin: '6px 0',
  fontSize: '0.74em',
  color: '#6b7280',
}

const recomputeButtonStyle: React.CSSProperties = {
  fontSize: '0.8em',
  fontWeight: 700,
  padding: '6px 13px',
  borderRadius: '7px',
  border: '1px solid #7c3aed',
  background: '#7c3aed',
  color: '#fff',
  cursor: 'pointer',
}
