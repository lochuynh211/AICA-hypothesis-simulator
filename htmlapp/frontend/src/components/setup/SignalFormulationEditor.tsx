import { useState, type ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import type { DriverSignalParams, AnomalySignalParams, ProfileOverrides } from '../../api/types'
import { SIGNAL_LABELS } from './signalLabels'

/**
 * SignalFormulationEditor (feature 009, UX-FE2 → FE5 → FE6 recurrence) — the
 * Tier-3 (Simulated) signal's formulation on SignalsPanel.
 *
 * Shows the actual per-tick STATE-UPDATE recurrence
 *   drowsiness[t] = drowsiness[t−1] + growth·Δt − recovery
 * so the accumulation is explicit. The GROWTH terms are editable NAMED fields
 * here; the "− recovery" term is a fixed per-activity amount edited under the
 * separate Rest Options section (RestOptionsEditor) — recovery is keyed by rest
 * activity, not by this signal, so it lives there rather than in this block.
 * Δt is spelled out in words right under the equation (it confused users before).
 *
 * Params source: `scenario.driver_signal_params.{drowsiness_model,fatigue_model}`
 * / `scenario.anomaly_signal_params`.
 *
 * Dispatch contract (unchanged): `SET_PROFILE_OVERRIDES` REPLACES the whole
 * `profileOverrides` object. On every edit this component reads the CURRENT
 * `state.profileOverrides`, patches only the one field it owns
 * (driver.<subModel>.<field> or anomaly.<field>), drops the key once its value
 * reverts to the scenario default, and dispatches the recomputed object whole
 * (or `null` once nothing differs anywhere).
 */
export type FormulationSignalKey = 'drowsiness' | 'fatigue' | 'anomaly_rate'

type ScenarioSignalDefaults = {
  driver_signal_params?: DriverSignalParams | null
  anomaly_signal_params?: AnomalySignalParams | null
}

/** Which driver sub-model a field lives in (null → the anomaly params object). */
type SubModel = 'drowsiness_model' | 'fatigue_model'

type FieldSpec = {
  key: string
  label: BilingualLabel
  /** Driver sub-model this field belongs to; null for anomaly params. */
  subModel: SubModel | null
  /** Connective shown before the label to read as a running sum ("+"/"−"). */
  connective?: string
}

type FieldGroup = { title: BilingualLabel; fields: FieldSpec[] }

type SignalConfig = {
  /** Monospace state-update equation shown at the top (recurrence or rate).
   *  BILINGUAL: the equation names its own terms, and a formula reading
   *  `growth`/`recovery` inside a Japanese panel is the same leak as any
   *  other English label. The SYMBOLS (Δt, λ, θ) are language-neutral and
   *  stay identical in both. */
  equation: BilingualLabel
  /** Plain-language note under the equation (explains Δt / recovery / rate). */
  lead: BilingualLabel
  groups: FieldGroup[]
}

const DROWSINESS_CONFIG: SignalConfig = {
  equation: {
    en: 'drowsiness[t] = drowsiness[t−1] + growth·Δt − recovery',
    ja: '眠気[t] = 眠気[t−1] + 増加量・Δt − 回復量',
  },
  lead: {
    en: 'Δt = minutes since the previous step. "Growth" is the per-minute sum below. "Recovery" is a fixed amount subtracted once per rest activity — set it under Rest Options.',
    ja: 'Δt = 前ステップからの経過分数。「増加量」は下の1分あたりの合計。「回復量」は休憩アクティビティごとに1回引かれる固定量（下の「休憩オプション」で設定）。',
  },
  groups: [
    {
      title: { en: 'Growth — per minute of driving', ja: '増加 — 運転1分あたり' },
      fields: [
        { key: 'base_growth_per_min', label: SIGNAL_LABELS.base_growth_per_min, subModel: 'drowsiness_model' },
        { key: 'night_add_per_min', label: SIGNAL_LABELS.night_add_per_min, subModel: 'drowsiness_model', connective: '+' },
        { key: 'monotony_add_per_min', label: SIGNAL_LABELS.monotony_add_per_min, subModel: 'drowsiness_model', connective: '+' },
        { key: 'traffic_jam_add_per_min', label: SIGNAL_LABELS.traffic_jam_add_per_min, subModel: 'drowsiness_model', connective: '+' },
      ],
    },
  ],
}

const FATIGUE_CONFIG: SignalConfig = {
  equation: {
    en: 'fatigue[t] = fatigue[t−1] + growth·Δt − recovery',
    ja: '疲労度[t] = 疲労度[t−1] + 増加量・Δt − 回復量',
  },
  lead: {
    en: 'Δt = minutes since the previous step. "Growth" is the per-minute sum below. "Recovery" is a fixed amount subtracted once per rest activity — set it under Rest Options.',
    ja: 'Δt = 前ステップからの経過分数。「増加量」は下の1分あたりの合計。「回復量」は休憩アクティビティごとに1回引かれる固定量（下の「休憩オプション」で設定）。',
  },
  groups: [
    {
      title: { en: 'Growth — per minute of driving', ja: '増加 — 運転1分あたり' },
      fields: [
        { key: 'base_growth_per_min', label: SIGNAL_LABELS.base_growth_per_min, subModel: 'fatigue_model' },
        {
          key: 'continuous_driving_add_per_min_after_60_min',
          label: SIGNAL_LABELS.continuous_driving_add_per_min_after_60_min,
          subModel: 'fatigue_model',
          connective: '+',
        },
        { key: 'mountain_road_add_per_min', label: SIGNAL_LABELS.mountain_road_add_per_min, subModel: 'fatigue_model', connective: '+' },
        { key: 'traffic_jam_add_per_min', label: SIGNAL_LABELS.traffic_jam_add_per_min, subModel: 'fatigue_model', connective: '+' },
      ],
    },
  ],
}

const ANOMALY_CONFIG: SignalConfig = {
  equation: {
    en: 'λ = λ₀ + λ_gain·max(0, drowsiness − θ) / 100',
    ja: 'λ = λ₀ + λ_gain・max(0, 眠気 − θ) / 100',
  },
  lead: {
    en: 'Rare events (lane drifts, steering jerks) drawn from a seeded random stream — replayable from the run seed. The rate λ rises once drowsiness passes θ; the detected driving-anomaly count is tallied over the window.',
    ja: '稀な事象（車線のふらつき・急ハンドル）をシード付き乱数系列から生成（シードから再現可能）。眠気がθを超えると発生率λが上昇し、運転の乱れの検知件数はウィンドウ内で集計されます。',
  },
  groups: [
    {
      title: { en: 'Rate parameters', ja: 'レートのパラメータ' },
      fields: [
        { key: 'lambda_base', label: SIGNAL_LABELS.lambda_base, subModel: null },
        { key: 'lambda_gain', label: SIGNAL_LABELS.lambda_gain, subModel: null },
        { key: 'theta', label: SIGNAL_LABELS.theta, subModel: null },
        { key: 'window_min', label: SIGNAL_LABELS.window_min, subModel: null },
      ],
    },
  ],
}

const CONFIG_BY_SIGNAL: Record<FormulationSignalKey, SignalConfig> = {
  drowsiness: DROWSINESS_CONFIG,
  fatigue: FATIGUE_CONFIG,
  anomaly_rate: ANOMALY_CONFIG,
}

/** Brief, words-only "how it is formulated" note shown by the ⓘ icon. */
const EXPLAIN_TEXT: Record<FormulationSignalKey, BilingualLabel> = {
  drowsiness: {
    en: 'Accumulates over driving time; faster at night, on monotonous roads, and in jams. Drops at each rest. Deterministic.',
    ja: '運転時間とともに蓄積。夜間・単調な道・渋滞でより速く増加し、休憩ごとに減少。決定論的。',
  },
  fatigue: {
    en: 'Accumulates over driving time; faster after 60+ min of continuous driving, on mountain roads, and in jams. Drops at each rest. Deterministic.',
    ja: '運転時間とともに蓄積。60分以上の連続運転・山道・渋滞でより速く増加し、休憩ごとに減少。決定論的。',
  },
  anomaly_rate: {
    en: 'Rare lane-departure / steering-jerk events; fires more often as drowsiness rises. One seeded random stream — fully replayable from the run seed.',
    ja: '稀な車線逸脱・急ハンドル事象。眠気が上がるほど発生頻度が増加。シードから完全に再現可能な単一の乱数系列。',
  },
}

type Props = {
  signalKey: FormulationSignalKey
  /** Already-localized signal label, used for aria-labels. */
  label: string
  scenario: ScenarioSignalDefaults
}

/** Bilingual "About X" / "X について" aria-label — never a hardcoded English
 *  template glued onto a translated noun. */
function aboutLabel(label: string, lang: 'ja' | 'en'): string {
  return lang === 'ja' ? `${label}について` : `About ${label}`
}

export default function SignalFormulationEditor({ signalKey, label, scenario }: Props) {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, profileOverrides } = state
  const [explainOpen, setExplainOpen] = useState(false)

  const isAnomaly = signalKey === 'anomaly_rate'
  const config = CONFIG_BY_SIGNAL[signalKey]

  function defaultFor(spec: FieldSpec): number {
    if (spec.subModel === null) {
      return Number((scenario.anomaly_signal_params as unknown as Record<string, number>)?.[spec.key] ?? 0)
    }
    const sub = scenario.driver_signal_params?.[spec.subModel] as unknown as Record<string, number> | undefined
    return Number(sub?.[spec.key] ?? 0)
  }

  function currentOverrideValue(spec: FieldSpec): number | undefined {
    if (spec.subModel === null) {
      const anomaly = profileOverrides?.anomaly as Record<string, unknown> | undefined
      return anomaly?.[spec.key] as number | undefined
    }
    const driver = profileOverrides?.driver as Record<string, unknown> | undefined
    const sub = driver?.[spec.subModel] as Record<string, unknown> | undefined
    return sub?.[spec.key] as number | undefined
  }

  function handleFieldChange(spec: FieldSpec, defaultValue: number, raw: string) {
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return

    const next: ProfileOverrides = { ...(profileOverrides ?? {}) }

    if (spec.subModel === null) {
      const anomaly = { ...((next.anomaly as Record<string, unknown> | undefined) ?? {}) }
      if (num === defaultValue) delete anomaly[spec.key]
      else anomaly[spec.key] = num
      if (Object.keys(anomaly).length === 0) delete next.anomaly
      else next.anomaly = anomaly
    } else {
      const driver = { ...((next.driver as Record<string, unknown> | undefined) ?? {}) }
      const sub = { ...((driver[spec.subModel] as Record<string, unknown> | undefined) ?? {}) }
      if (num === defaultValue) delete sub[spec.key]
      else sub[spec.key] = num
      if (Object.keys(sub).length === 0) delete driver[spec.subModel]
      else driver[spec.subModel] = sub
      if (Object.keys(driver).length === 0) delete next.driver
      else next.driver = driver
    }

    const isEmpty = Object.keys(next).length === 0
    dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: isEmpty ? null : next })
  }

  return (
    <div data-testid={`signal-formulation-${signalKey}`} style={{ marginTop: '3px' }}>
      {/* State-update equation + plain-language note (with the ⓘ explainer). */}
      <div
        data-testid={`signal-formula-equation-${signalKey}`}
        style={{
          fontFamily: 'monospace',
          fontSize: '0.78em',
          color: '#1f2937',
          background: '#f3f4f6',
          borderRadius: '4px',
          padding: '4px 6px',
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
      >
        {t(config.equation, uiLanguage)}
      </div>
      <div
        data-testid={`signal-formula-lead-${signalKey}`}
        style={{ fontSize: '0.72em', color: '#6b7280', lineHeight: 1.4, margin: '4px 0 6px' }}
      >
        {t(config.lead, uiLanguage)}
        <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px' }}>
          <button
            type="button"
            data-testid={`signal-info-btn-${signalKey}`}
            aria-label={aboutLabel(label, uiLanguage)}
            aria-expanded={explainOpen}
            onClick={() => setExplainOpen((prev) => !prev)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#6b7280',
              fontSize: '1.05em',
              lineHeight: 1,
              padding: 0,
              verticalAlign: 'middle',
            }}
          >
            ⓘ
          </button>
          {explainOpen && (
            <div
              role="tooltip"
              data-testid={`signal-explain-${signalKey}`}
              style={{
                position: 'absolute',
                zIndex: 10,
                top: '100%',
                left: 0,
                marginTop: '4px',
                width: '240px',
                padding: '8px 10px',
                background: '#111827',
                color: '#f9fafb',
                fontSize: '1.05em',
                lineHeight: 1.45,
                borderRadius: '6px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              }}
            >
              {t(EXPLAIN_TEXT[signalKey], uiLanguage)}
            </div>
          )}
        </span>
      </div>

      {config.groups.map((group) => (
        <div key={t(group.title, 'en')} style={{ marginBottom: '5px' }}>
          {!isAnomaly && (
            <div
              style={{
                fontSize: '0.68em',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#9ca3af',
                marginBottom: '2px',
              }}
            >
              {t(group.title, uiLanguage)}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {group.fields.map((f) => {
              const defaultValue = defaultFor(f)
              const overrideValue = currentOverrideValue(f)
              const value = overrideValue !== undefined ? overrideValue : defaultValue
              const changed = overrideValue !== undefined && overrideValue !== defaultValue
              return (
                <div
                  key={f.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    fontSize: '0.76em',
                  }}
                >
                  <span style={{ color: '#374151' }}>
                    {f.connective && <span style={{ color: '#9ca3af', marginRight: '3px' }}>{f.connective}</span>}
                    {t(f.label, uiLanguage)}
                  </span>
                  <input
                    type="number"
                    data-testid={`signal-formula-field-${signalKey}-${f.key}`}
                    aria-label={`${label} ${t(f.label, uiLanguage)}`}
                    value={value}
                    step="any"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange(f, defaultValue, e.target.value)}
                    style={{
                      width: '60px',
                      fontSize: '1em',
                      textAlign: 'center',
                      border: `1px solid ${changed ? '#6366f1' : '#d1d5db'}`,
                      borderRadius: '3px',
                      background: changed ? '#eef2ff' : '#fff',
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
