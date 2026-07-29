/**
 * FixedConditionsSection — the "Fixed conditions" signal group (is_night /
 * familiar_route / weather_risk / child_passenger), extracted VERBATIM from
 * `SignalsPanel` so the Trigger setup screen and the Combined Simulator's
 * Situation editor render the identical controls (feature 020 extract-and-share).
 *
 * Store-driven (useRunStore): reads `contextOverrides` + the scenario's own
 * defaults, dispatches `SET_CONTEXT_OVERRIDE`. The cross-link highlight/dim
 * behaviour is OPTIONAL — the Trigger screen passes its `isDimmed`/highlight
 * wiring so it stays byte-identical; the Combined screen omits them (no
 * right-hand formulation panel to cross-link to), so rows never dim.
 */
import { type ChangeEvent } from 'react'
import { useRunStore } from '../../../state/runStore'
import type { ScenarioDef } from '../../../api/types'
import { t } from '../../../i18n/t'
import { SIGNAL_LABELS } from '../signalLabels'
import { SignalGroup, SignalRow } from './signalPrimitives'
import { booleanLabel } from '../../../lib/review/reviewVocabulary'

const NOOP = () => {}
const NEVER_DIMMED = () => false

export default function FixedConditionsSection({
  scenario,
  isDimmed = NEVER_DIMMED,
  highlightedSignalKey = null,
  onHighlight = NOOP,
  onUnhighlight = NOOP,
  hideTitle = false,
}: {
  scenario: ScenarioDef
  isDimmed?: (signalKey: string) => boolean
  highlightedSignalKey?: string | null
  onHighlight?: (key: string) => void
  onUnhighlight?: () => void
  hideTitle?: boolean
}) {
  const { state, dispatch } = useRunStore()
  const { contextOverrides, uiLanguage } = state

  const isNightDefault = Boolean(scenario?.is_night ?? false)
  const isNightValue = Boolean(contextOverrides.is_night ?? isNightDefault)
  const familiarRouteDefault = Boolean(scenario?.familiar_route ?? false)
  const familiarRouteValue = Boolean(contextOverrides.familiar_route ?? familiarRouteDefault)
  const childPassengerDefault = Boolean(scenario?.child_passenger ?? false)
  const childPassengerValue = Boolean(contextOverrides.child_passenger ?? childPassengerDefault)
  // weather_risk is stored/validated on the backend as [0, 100] (env_load
  // divides by 100 → a 0..1 term). The user-facing control is a 0..1 slider;
  // we map fraction → stored (×100) on write and stored → fraction (÷100) on
  // read, so what the slider shows IS the exact weight the algorithm applies.
  const weatherRiskDefault = scenario?.weather_risk ?? 0
  const weatherRiskValue = contextOverrides.weather_risk ?? weatherRiskDefault
  const weatherRiskFraction = weatherRiskValue / 100

  function handleWeatherRiskChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') return
    const fraction = Number(raw)
    if (Number.isNaN(fraction)) return
    const stored = Math.round(fraction * 100)
    dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: stored, default: weatherRiskDefault })
  }

  return (
    <SignalGroup
      title={t({ en: 'Fixed conditions', ja: '固定条件' }, uiLanguage)}
      testid="signal-group-fixed"
      hideTitle={hideTitle}
      caption={t(
        {
          en: 'Set before the run and held constant throughout — edit these here.',
          ja: '走行前に設定し、走行中は一定に保たれる条件（ここで編集）。',
        },
        uiLanguage,
      )}
    >
      <SignalRow
        signalKey="isNight"
        label={t(SIGNAL_LABELS.isNight, uiLanguage)}
        value={t(booleanLabel(isNightValue), uiLanguage)}
        highlighted={highlightedSignalKey === 'isNight'}
        dimmed={isDimmed('isNight')}
        onHover={() => onHighlight('isNight')}
        onLeave={onUnhighlight}
        editControl={
          <input
            type="checkbox"
            data-testid="signal-edit-isNight"
            aria-label={t(SIGNAL_LABELS.isNight, uiLanguage)}
            checked={isNightValue}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONTEXT_OVERRIDE',
                key: 'is_night',
                value: e.target.checked,
                default: isNightDefault,
              })
            }
          />
        }
      />
      <SignalRow
        signalKey="familiarRoute"
        label={t(SIGNAL_LABELS.familiarRoute, uiLanguage)}
        value={t(booleanLabel(familiarRouteValue), uiLanguage)}
        highlighted={highlightedSignalKey === 'familiarRoute'}
        dimmed={isDimmed('familiarRoute')}
        onHover={() => onHighlight('familiarRoute')}
        onLeave={onUnhighlight}
        editControl={
          <input
            type="checkbox"
            data-testid="signal-edit-familiarRoute"
            aria-label={t(SIGNAL_LABELS.familiarRoute, uiLanguage)}
            checked={familiarRouteValue}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONTEXT_OVERRIDE',
                key: 'familiar_route',
                value: e.target.checked,
                default: familiarRouteDefault,
              })
            }
          />
        }
      />
      <SignalRow
        signalKey="childPassenger"
        label={t(SIGNAL_LABELS.childPassenger, uiLanguage)}
        value={t(booleanLabel(childPassengerValue), uiLanguage)}
        highlighted={highlightedSignalKey === 'childPassenger'}
        dimmed={isDimmed('childPassenger')}
        onHover={() => onHighlight('childPassenger')}
        onLeave={onUnhighlight}
        editControl={
          <input
            type="checkbox"
            data-testid="signal-edit-childPassenger"
            aria-label={t(SIGNAL_LABELS.childPassenger, uiLanguage)}
            checked={childPassengerValue}
            onChange={(e) =>
              dispatch({
                type: 'SET_CONTEXT_OVERRIDE',
                key: 'child_passenger',
                value: e.target.checked,
                default: childPassengerDefault,
              })
            }
          />
        }
      />
      <SignalRow
        signalKey="weatherRisk"
        label={t(SIGNAL_LABELS.weatherRisk, uiLanguage)}
        value={weatherRiskFraction.toFixed(2)}
        highlighted={highlightedSignalKey === 'weatherRisk'}
        dimmed={isDimmed('weatherRisk')}
        onHover={() => onHighlight('weatherRisk')}
        onLeave={onUnhighlight}
        editControl={
          <input
            type="range"
            data-testid="signal-edit-weatherRisk"
            aria-label={t(SIGNAL_LABELS.weatherRisk, uiLanguage)}
            min={0}
            max={1}
            step={0.05}
            value={weatherRiskFraction}
            onChange={handleWeatherRiskChange}
            style={{ width: '96px' }}
          />
        }
      />
    </SignalGroup>
  )
}
