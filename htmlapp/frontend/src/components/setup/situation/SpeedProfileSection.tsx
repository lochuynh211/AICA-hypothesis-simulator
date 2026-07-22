/**
 * SpeedProfileSection (UX-FE5) — "speed setup": kph per road-segment type. Edits
 * the scenario's `speed_profile`, which drives the Dynamic `speedKph` signal (and
 * thus how long each segment takes). Edits are dispatched as `SET_PROFILE_OVERRIDES`
 * into `profileOverrides.speed` — changed-from-scenario-default only, same sparse-
 * patch discipline as the tier-3 SignalFormulationEditor. The backend deep-merges
 * this onto the scenario's own speed_profile and validates the whole against
 * SpeedProfile (see services/run_plan._apply_profile_overrides).
 *
 * Hidden when the scenario carries no speed_profile (older scenarios) — a partial
 * override would fail SpeedProfile's required-fields validation.
 *
 * Extracted VERBATIM from `SignalsPanel` (was a private sub-function) so the
 * Trigger setup screen and the Combined Simulator's Situation editor render the
 * identical control (feature 020 extract-and-share).
 */
import { useRunStore } from '../../../state/runStore'
import type { ScenarioDef } from '../../../api/types'
import { t } from '../../../i18n/t'
import { SIGNAL_LABELS } from '../signalLabels'
import { SignalGroup } from './signalPrimitives'

const SPEED_FIELDS = [
  'normal_road_kph',
  'highway_kph',
  'mountain_road_kph',
  'sightseeing_road_kph',
  'traffic_jam_kph',
] as const

export default function SpeedProfileSection({ scenario, hideTitle = false }: { scenario: ScenarioDef; hideTitle?: boolean }) {
  const { state, dispatch } = useRunStore()
  const { uiLanguage, profileOverrides } = state

  const defaults = (scenario.speed_profile ?? {}) as Record<string, number>
  if (Object.keys(defaults).length === 0) return null

  const speedOverrides = (profileOverrides?.speed as Record<string, unknown> | undefined) ?? {}

  function handleChange(fieldKey: string, defaultValue: number, raw: string) {
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return

    const next = { ...(profileOverrides ?? {}) }
    const speed = { ...((next.speed as Record<string, unknown> | undefined) ?? {}) }
    if (num === defaultValue) delete speed[fieldKey]
    else speed[fieldKey] = num
    if (Object.keys(speed).length === 0) delete next.speed
    else next.speed = speed

    const isEmpty = Object.keys(next).length === 0
    dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: isEmpty ? null : next })
  }

  return (
    <SignalGroup
      title={t(SIGNAL_LABELS.speed_profile, uiLanguage)}
      testid="speed-profile-section"
      hideTitle={hideTitle}
      caption={t(
        { en: 'Travel speed for each road type — sets how fast the drive covers each segment.', ja: '道路種別ごとの走行速度。各区間の所要時間を決めます。' },
        uiLanguage,
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {SPEED_FIELDS.map((key) => {
          const defaultValue = Number(defaults[key] ?? 0)
          const override = speedOverrides[key] as number | undefined
          const value = override !== undefined ? override : defaultValue
          const changed = override !== undefined && override !== defaultValue
          const label = t(SIGNAL_LABELS[key], uiLanguage)
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '0.78em',
              }}
            >
              <span style={{ color: '#374151' }}>{label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <input
                  type="number"
                  data-testid={`speed-field-${key}`}
                  aria-label={label}
                  min={0}
                  step={1}
                  value={value}
                  onChange={(e) => handleChange(key, defaultValue, e.target.value)}
                  style={{
                    width: '56px',
                    fontSize: '1em',
                    textAlign: 'center',
                    border: `1px solid ${changed ? '#6366f1' : '#d1d5db'}`,
                    borderRadius: '3px',
                    background: changed ? '#eef2ff' : '#fff',
                  }}
                />
                <span style={{ color: '#9ca3af', fontSize: '0.85em' }}>km/h</span>
              </span>
            </div>
          )
        })}
      </div>
    </SignalGroup>
  )
}
