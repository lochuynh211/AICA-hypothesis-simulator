import type { ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { ProfileOverrides, ScenarioDef } from '../../api/types'
import { SIGNAL_LABELS } from './signalLabels'

/**
 * RestOptionsEditor (feature 009, UX-FE7) — edits the fixed recovery amounts of
 * each rest activity.
 *
 * A rest activity is a recovery-option stage's `content` performed while STOPPED
 * (e.g. sleep, audio_karaoke, stretch). Each activity carries a FIXED
 * drowsiness/fatigue recovery, granted once per activity in total — spread as
 * a per-tick curve across the stage's dwell (recovery-semantics refactor:
 * services/behavior/driver_signals.py::apply_stage_recovery_tick /
 * stage_recovery_total, keyed by content; retires the old one-shot
 * apply_rest_recovery).
 * Rates are NOT per-minute and there is no short/long rest distinction.
 *
 * Storage: the amounts live in `driver_signal_params.recovery_model` (a map
 * `content → {drowsiness, fatigue}`), so edits reuse the SAME `profiles.driver`
 * override channel as the tier-3 growth params — dispatched as
 * SET_PROFILE_OVERRIDES, patching `driver.recovery_model.<activity>.<field>`,
 * changed-from-scenario-default only (a key is dropped once it reverts).
 *
 * Activities are collected (deduped, in first-seen order) from the STOPPED
 * stages of `scenario.recovery_options`. Hidden when a scenario has none.
 */

type RecoveryField = 'drowsiness' | 'fatigue'

const RECOVERY_FIELDS: { key: RecoveryField; label: { en: string; ja: string } }[] = [
  { key: 'drowsiness', label: { en: 'Drowsiness −', ja: '眠気 −' } },
  { key: 'fatigue', label: { en: 'Fatigue −', ja: '疲労 −' } },
]

export default function RestOptionsEditor({ scenario }: { scenario: ScenarioDef }) {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, profileOverrides } = state

  // Unique STOPPED-stage activities, in first-seen order across all options.
  const activities: string[] = []
  for (const option of scenario.recovery_options ?? []) {
    for (const stage of option.stages ?? []) {
      if (stage.motion === 'STOPPED' && !activities.includes(stage.content)) {
        activities.push(stage.content)
      }
    }
  }
  if (activities.length === 0) return null

  const scenarioRecovery = (scenario.driver_signal_params?.recovery_model ?? {}) as Record<
    string,
    { drowsiness?: number; fatigue?: number }
  >

  function defaultFor(activity: string, field: RecoveryField): number {
    return Number(scenarioRecovery[activity]?.[field] ?? 0)
  }

  function overrideFor(activity: string, field: RecoveryField): number | undefined {
    const driver = profileOverrides?.driver as Record<string, unknown> | undefined
    const rm = driver?.recovery_model as Record<string, Record<string, unknown>> | undefined
    return rm?.[activity]?.[field] as number | undefined
  }

  function handleChange(activity: string, field: RecoveryField, defaultValue: number, raw: string) {
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return

    const next: ProfileOverrides = { ...(profileOverrides ?? {}) }
    const driver = { ...((next.driver as Record<string, unknown> | undefined) ?? {}) }
    const rm = { ...((driver.recovery_model as Record<string, unknown> | undefined) ?? {}) }
    const act = { ...((rm[activity] as Record<string, unknown> | undefined) ?? {}) }

    if (num === defaultValue) delete act[field]
    else act[field] = num

    if (Object.keys(act).length === 0) delete rm[activity]
    else rm[activity] = act
    if (Object.keys(rm).length === 0) delete driver.recovery_model
    else driver.recovery_model = rm
    if (Object.keys(driver).length === 0) delete next.driver
    else next.driver = driver

    const isEmpty = Object.keys(next).length === 0
    dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: isEmpty ? null : next })
  }

  return (
    <div data-testid="rest-options-section" style={{ marginTop: '12px' }}>
      <h3
        style={{
          fontSize: '0.72em',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#9ca3af',
          margin: '0 0 4px',
        }}
      >
        {t({ en: 'Rest options — recovery per activity', ja: '休憩オプション — アクティビティごとの回復' }, uiLanguage)}
      </h3>
      <p style={{ fontSize: '0.7em', color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.4 }}>
        {t(
          {
            en: 'Each activity subtracts a fixed amount once when performed at a rest.',
            ja: '各アクティビティは休憩時に1回、固定量を減算します。',
          },
          uiLanguage,
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {activities.map((activity) => {
          const label = SIGNAL_LABELS[activity] ? t(SIGNAL_LABELS[activity], uiLanguage) : activity
          return (
            <div key={activity} data-testid={`rest-activity-${activity}`}>
              <div style={{ fontSize: '0.78em', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>{label}</div>
              <div style={{ display: 'flex', gap: '12px', paddingLeft: '6px' }}>
                {RECOVERY_FIELDS.map((f) => {
                  const defaultValue = defaultFor(activity, f.key)
                  const override = overrideFor(activity, f.key)
                  const value = override !== undefined ? override : defaultValue
                  const changed = override !== undefined && override !== defaultValue
                  return (
                    <label
                      key={f.key}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74em', color: '#4b5563' }}
                    >
                      {t(f.label, uiLanguage)}
                      <input
                        type="number"
                        data-testid={`rest-recovery-field-${activity}-${f.key}`}
                        aria-label={`${label} ${t(f.label, uiLanguage)}`}
                        min={0}
                        step="any"
                        value={value}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleChange(activity, f.key, defaultValue, e.target.value)
                        }
                        style={{
                          width: '54px',
                          fontSize: '1em',
                          textAlign: 'center',
                          border: `1px solid ${changed ? '#6366f1' : '#d1d5db'}`,
                          borderRadius: '3px',
                          background: changed ? '#eef2ff' : '#fff',
                        }}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
