import { useState, type ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import type { DriverSignalParams, AnomalySignalParams, ProfileOverrides } from '../../api/types'

/**
 * SignalFormulationEditor (feature 009, UX-FE2) — the ⓘ explainer for a
 * Tier-3 (Simulated) signal on SignalsPanel, upgraded from a static
 * explanation (SignalInfoPopover) into a formulation editor: it shows the
 * signal's formula (data-model.md §3) with its generator sub-params as
 * inline editable number fields, mirroring how AlgorithmFormulationPanel's
 * CoefField exposes hyperparameters as inline `[coefficient]` fields.
 *
 * Params source: `scenario.driver_signal_params.{drowsiness_model,fatigue_model}`
 * / `scenario.anomaly_signal_params` (api/types.ts). Only the field the
 * user narrows to (see caller's Pick<>) is required, so callers can pass
 * either the full ScenarioDef or a minimal fixture.
 *
 * Dispatch contract (see task-uxfe1-report.md "Store shape for the next
 * unit"): `SET_PROFILE_OVERRIDES` REPLACES the whole `profileOverrides`
 * object — there is no per-key reducer logic for nested paths. So on every
 * edit this component reads the CURRENT `state.profileOverrides`, patches
 * only the one field it owns (leaving any override the other two
 * signals' editors set untouched), drops the key entirely once its value
 * reverts to the scenario default (changed-from-default discipline, same
 * as SET_HYPERPARAMETER / SET_CONTEXT_OVERRIDE), and dispatches the
 * recomputed object whole (or `null` once nothing differs anywhere).
 */
export type FormulationSignalKey = 'drowsiness' | 'fatigue' | 'anomaly_rate'

type ScenarioSignalDefaults = {
  driver_signal_params?: DriverSignalParams | null
  anomaly_signal_params?: AnomalySignalParams | null
}

type FieldSpec = {
  /** Field name within the sub-model object (or top-level for anomaly). */
  key: string
  label: BilingualLabel
}

const DROWSINESS_FIELDS: FieldSpec[] = [
  { key: 'base_growth_per_min', label: { en: 'base', ja: '基本上昇' } },
  { key: 'night_add_per_min', label: { en: 'night', ja: '夜間加算' } },
  { key: 'monotony_add_per_min', label: { en: 'monotony', ja: '単調道路加算' } },
  { key: 'traffic_jam_add_per_min', label: { en: 'jam', ja: '渋滞加算' } },
]

const FATIGUE_FIELDS: FieldSpec[] = [
  { key: 'base_growth_per_min', label: { en: 'base', ja: '基本上昇' } },
  { key: 'continuous_driving_add_per_min_after_60_min', label: { en: 'continuous (>60min)', ja: '継続運転(60分超)加算' } },
  { key: 'mountain_road_add_per_min', label: { en: 'mountain', ja: '山道加算' } },
  { key: 'traffic_jam_add_per_min', label: { en: 'jam', ja: '渋滞加算' } },
]

const ANOMALY_FIELDS: FieldSpec[] = [
  { key: 'lambda_base', label: { en: 'lambda_base', ja: 'lambda_base' } },
  { key: 'lambda_gain', label: { en: 'lambda_gain', ja: 'lambda_gain' } },
  { key: 'theta', label: { en: 'theta', ja: 'theta' } },
  { key: 'window_min', label: { en: 'window_min', ja: 'window_min' } },
]

const FORMULA_TEXT: Record<FormulationSignalKey, BilingualLabel> = {
  drowsiness: {
    en: 'drowsiness += (base + night·isNight + monotony·isMonotonous + jam·isTrafficJam) · Δt/60',
    ja: '眠気 += (base + night・夜間 + monotony・単調道路 + jam・渋滞) · Δt/60',
  },
  fatigue: {
    en: 'fatigue += (base + continuous·[continuousMin≥60] + mountain·isMountain + jam·isTrafficJam) · Δt/60',
    ja: '疲労 += (base + continuous・[連続運転≥60分] + mountain・山道 + jam・渋滞) · Δt/60',
  },
  anomaly_rate: {
    en: 'λ = lambda_base + lambda_gain·max(0, drowsiness−theta)/100 → rare events over window_min',
    ja: 'λ = lambda_base + lambda_gain・max(0, 眠気−theta)/100 → window_min内の稀なイベント',
  },
}

type SubModel = 'drowsiness_model' | 'fatigue_model'

const SUB_MODEL_BY_SIGNAL: Record<'drowsiness' | 'fatigue', SubModel> = {
  drowsiness: 'drowsiness_model',
  fatigue: 'fatigue_model',
}

type Props = {
  signalKey: FormulationSignalKey
  /** Already-localized signal label, used for the button's aria-label. */
  label: string
  scenario: ScenarioSignalDefaults
}

export default function SignalFormulationEditor({ signalKey, label, scenario }: Props) {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, profileOverrides } = state
  const [open, setOpen] = useState(false)

  const isAnomaly = signalKey === 'anomaly_rate'
  const fields = signalKey === 'drowsiness' ? DROWSINESS_FIELDS : signalKey === 'fatigue' ? FATIGUE_FIELDS : ANOMALY_FIELDS
  const subModel = isAnomaly ? null : SUB_MODEL_BY_SIGNAL[signalKey]

  const defaults: Record<string, number> = isAnomaly
    ? ((scenario.anomaly_signal_params as unknown as Record<string, number>) ?? {})
    : ((scenario.driver_signal_params?.[subModel as SubModel] as unknown as Record<string, number>) ?? {})

  function currentOverrideValue(fieldKey: string): number | undefined {
    if (isAnomaly) {
      const anomaly = profileOverrides?.anomaly as Record<string, unknown> | undefined
      return anomaly?.[fieldKey] as number | undefined
    }
    const driver = profileOverrides?.driver as Record<string, unknown> | undefined
    const sub = driver?.[subModel as SubModel] as Record<string, unknown> | undefined
    return sub?.[fieldKey] as number | undefined
  }

  function handleFieldChange(fieldKey: string, defaultValue: number, raw: string) {
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return

    const next: ProfileOverrides = { ...(profileOverrides ?? {}) }

    if (isAnomaly) {
      const anomaly = { ...((next.anomaly as Record<string, unknown> | undefined) ?? {}) }
      if (num === defaultValue) delete anomaly[fieldKey]
      else anomaly[fieldKey] = num
      if (Object.keys(anomaly).length === 0) delete next.anomaly
      else next.anomaly = anomaly
    } else {
      const driver = { ...((next.driver as Record<string, unknown> | undefined) ?? {}) }
      const sub = { ...((driver[subModel as SubModel] as Record<string, unknown> | undefined) ?? {}) }
      if (num === defaultValue) delete sub[fieldKey]
      else sub[fieldKey] = num
      if (Object.keys(sub).length === 0) delete driver[subModel as SubModel]
      else driver[subModel as SubModel] = sub
      if (Object.keys(driver).length === 0) delete next.driver
      else next.driver = driver
    }

    const isEmpty = Object.keys(next).length === 0
    dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: isEmpty ? null : next })
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px' }}>
      <button
        type="button"
        data-testid={`signal-info-btn-${signalKey}`}
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: '#6b7280',
          fontSize: '0.9em',
          lineHeight: 1,
          padding: 0,
        }}
      >
        ⓘ
      </button>
      {open && (
        <div
          role="tooltip"
          data-testid={`signal-formulation-${signalKey}`}
          style={{
            position: 'absolute',
            zIndex: 10,
            top: '100%',
            right: 0,
            marginTop: '4px',
            width: '260px',
            padding: '10px 12px',
            background: '#111827',
            color: '#f9fafb',
            fontSize: '0.75em',
            lineHeight: 1.4,
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <div
            data-testid={`signal-formula-text-${signalKey}`}
            style={{ fontFamily: 'monospace', color: '#e5e7eb', marginBottom: '8px', wordBreak: 'break-word' }}
          >
            {t(FORMULA_TEXT[signalKey], uiLanguage)}
          </div>
          {fields.map((f) => {
            const defaultValue = Number(defaults[f.key] ?? 0)
            const overrideValue = currentOverrideValue(f.key)
            const value = overrideValue !== undefined ? overrideValue : defaultValue
            return (
              <div
                key={f.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                  marginBottom: '4px',
                }}
              >
                <span>{t(f.label, uiLanguage)}</span>
                <input
                  type="number"
                  data-testid={`signal-formula-field-${signalKey}-${f.key}`}
                  aria-label={`${label} ${t(f.label, uiLanguage)}`}
                  value={value}
                  step="any"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange(f.key, defaultValue, e.target.value)}
                  style={{
                    width: '64px',
                    fontSize: '0.95em',
                    textAlign: 'center',
                    border: '1px solid #374151',
                    borderRadius: '3px',
                    background: '#1f2937',
                    color: '#f9fafb',
                  }}
                />
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
