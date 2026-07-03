import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { ScenarioDef } from '../../api/types'
import { t } from '../../i18n/t'
import ScenarioSelector from './ScenarioSelector'
import SignalFormulationEditor from './SignalFormulationEditor'

/**
 * SignalsPanel (feature 009, FE2) — left editor panel of the new setup screen
 * (others/aica_setup_screen_uiux.md "Left panel — Scenario & Signals").
 *
 * Layout:
 *   1. Location/Preset — ScenarioSelector (the algorithm/package selector
 *      moved to the top of AlgorithmFormulationPanel — see UX-FE1 report).
 *   2. The selected scenario's signals, grouped under three tier headings:
 *      Fixed / Dynamic / Simulated (matches the engine's signal-tier model —
 *      see packages/nri_fatigue_score_v1/algorithm.py's signals.fixed /
 *      .dynamic / .simulated read).
 *
 * Editable vs read-only:
 *   - Fixed: familiarRoute/childPassenger/weatherRisk are scenario-editable
 *     (✎ checkbox / numeric input, dispatching SET_CONTEXT_OVERRIDE into
 *     `contextOverrides` — changed-from-scenario-default only, mirroring the
 *     editedHyperparameters/SET_HYPERPARAMETER convention). `contextOverrides`
 *     is sent as `context_overrides` to BOTH the instant preview and the real
 *     run-plan (see state/runStore.ts, api/client.ts). isNight is shown but
 *     NOT editable: the backend has no context-override key for it yet (see
 *     ScenarioDef.is_night doc in api/types.ts).
 *   - Dynamic: always read-only/muted — these are runtime-computed per tick;
 *     at setup time there is no run yet, so rows show a descriptive
 *     placeholder rather than a live value.
 *   - Simulated (tier 3): the "value" cell stays read-only/muted, but each
 *     carries an ⓘ (SignalFormulationEditor, UX-FE2) that expands into the
 *     signal's formula with its generator sub-params as editable inline
 *     fields. drowsiness/fatigue edit `driver_signal_params.{drowsiness_model,
 *     fatigue_model}`; anomaly_rate edits `anomaly_signal_params`. Edits are
 *     dispatched as `SET_PROFILE_OVERRIDES` (changed-from-scenario-default
 *     only, sparse `{driver?, anomaly?}`), which re-runs the instant preview
 *     the same way contextOverrides does (see SignalFormulationEditor.tsx).
 *
 * Cross-link highlight: hovering any signal row dispatches
 * SET_HIGHLIGHTED_SIGNAL so AlgorithmFormulationPanel (FE3) can mirror the
 * highlight on feature names that reference that signal; leaving dispatches
 * SET_HIGHLIGHTED_SIGNAL with key: null.
 */
export default function SignalsPanel() {
  const { state, dispatch } = useRunStore()
  const { selectedScenarioId, contextOverrides, highlightedSignalKey, uiLanguage, runSeed } = state
  const [scenario, setScenario] = useState<ScenarioDef | null>(null)

  useEffect(() => {
    if (!selectedScenarioId) {
      setScenario(null)
      return
    }
    let cancelled = false
    getScenario(selectedScenarioId)
      .then((def) => {
        if (!cancelled) setScenario(def)
      })
      .catch(() => {
        if (!cancelled) setScenario(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedScenarioId])

  function highlight(key: string) {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key })
  }
  function unhighlight() {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key: null })
  }

  const familiarRouteDefault = Boolean(scenario?.familiar_route ?? false)
  const familiarRouteValue = Boolean(contextOverrides.familiar_route ?? familiarRouteDefault)
  const childPassengerDefault = Boolean(scenario?.child_passenger ?? false)
  const childPassengerValue = Boolean(contextOverrides.child_passenger ?? childPassengerDefault)
  const weatherRiskDefault = scenario?.weather_risk ?? 0
  const weatherRiskValue = contextOverrides.weather_risk ?? weatherRiskDefault

  function handleWeatherRiskChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return
    dispatch({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: num, default: weatherRiskDefault })
  }

  return (
    <div data-testid="signals-panel">
      <ScenarioSelector />

      {scenario && (
        <>
          <SignalGroup title="Fixed" testid="signal-group-fixed">
            <SignalRow
              signalKey="isNight"
              label={t({ en: 'Night', ja: '夜間' }, uiLanguage)}
              value={scenario.is_night ? 'on' : 'off'}
              muted
              highlighted={highlightedSignalKey === 'isNight'}
              onHover={() => highlight('isNight')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="familiarRoute"
              label={t({ en: 'Familiar Route', ja: '慣れた道' }, uiLanguage)}
              value={familiarRouteValue ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'familiarRoute'}
              onHover={() => highlight('familiarRoute')}
              onLeave={unhighlight}
              editControl={
                <input
                  type="checkbox"
                  data-testid="signal-edit-familiarRoute"
                  aria-label={t({ en: 'Familiar Route', ja: '慣れた道' }, uiLanguage)}
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
              label={t({ en: 'Child Passenger', ja: '子供同乗' }, uiLanguage)}
              value={childPassengerValue ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'childPassenger'}
              onHover={() => highlight('childPassenger')}
              onLeave={unhighlight}
              editControl={
                <input
                  type="checkbox"
                  data-testid="signal-edit-childPassenger"
                  aria-label={t({ en: 'Child Passenger', ja: '子供同乗' }, uiLanguage)}
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
              label={t({ en: 'Weather Risk', ja: '天候リスク' }, uiLanguage)}
              value={String(weatherRiskValue)}
              highlighted={highlightedSignalKey === 'weatherRisk'}
              onHover={() => highlight('weatherRisk')}
              onLeave={unhighlight}
              editControl={
                <input
                  type="number"
                  data-testid="signal-edit-weatherRisk"
                  aria-label={t({ en: 'Weather Risk', ja: '天候リスク' }, uiLanguage)}
                  min={0}
                  max={100}
                  step={1}
                  value={weatherRiskValue}
                  onChange={handleWeatherRiskChange}
                  style={{ width: '52px' }}
                />
              }
            />
          </SignalGroup>

          <SignalGroup title="Dynamic" testid="signal-group-dynamic">
            <SignalRow
              signalKey="continuousDrivingMin"
              label={t({ en: 'Continuous Driving', ja: '連続運転時間' }, uiLanguage)}
              value="0 min → …"
              muted
              highlighted={highlightedSignalKey === 'continuousDrivingMin'}
              onHover={() => highlight('continuousDrivingMin')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="segmentMotionJam"
              label={t({ en: 'Segment / Motion / Jam', ja: '区間・走行状態・渋滞' }, uiLanguage)}
              value="computed during run"
              muted
              highlighted={highlightedSignalKey === 'segmentMotionJam'}
              onHover={() => highlight('segmentMotionJam')}
              onLeave={unhighlight}
            />
          </SignalGroup>

          <SignalGroup title="Simulated (tier 3)" testid="signal-group-simulated">
            <SignalRow
              signalKey="drowsiness"
              label={t({ en: 'Drowsiness', ja: '眠気' }, uiLanguage)}
              value="~curve"
              muted
              formulaEditor={
                <SignalFormulationEditor
                  signalKey="drowsiness"
                  label={t({ en: 'Drowsiness', ja: '眠気' }, uiLanguage)}
                  scenario={scenario}
                />
              }
              highlighted={highlightedSignalKey === 'drowsiness'}
              onHover={() => highlight('drowsiness')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="fatigue"
              label={t({ en: 'Fatigue', ja: '疲労' }, uiLanguage)}
              value="~curve"
              muted
              formulaEditor={
                <SignalFormulationEditor
                  signalKey="fatigue"
                  label={t({ en: 'Fatigue', ja: '疲労' }, uiLanguage)}
                  scenario={scenario}
                />
              }
              highlighted={highlightedSignalKey === 'fatigue'}
              onHover={() => highlight('fatigue')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="anomaly_rate"
              label={t({ en: 'Anomaly Rate', ja: '異常発生率' }, uiLanguage)}
              value={`seeded Poisson (seed ${runSeed})`}
              muted
              formulaEditor={
                <SignalFormulationEditor
                  signalKey="anomaly_rate"
                  label={t({ en: 'Anomaly Rate', ja: '異常発生率' }, uiLanguage)}
                  scenario={scenario}
                />
              }
              highlighted={highlightedSignalKey === 'anomaly_rate'}
              onHover={() => highlight('anomaly_rate')}
              onLeave={unhighlight}
            />
          </SignalGroup>
        </>
      )}
    </div>
  )
}

// ── Presentational helpers ──────────────────────────────────────────────────

function SignalGroup({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return (
    <div data-testid={testid} style={{ marginTop: '12px' }}>
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
        {title}
      </h3>
      {children}
    </div>
  )
}

function SignalRow({
  signalKey,
  label,
  value,
  muted = false,
  editControl,
  formulaEditor,
  highlighted = false,
  onHover,
  onLeave,
}: {
  signalKey: string
  label: string
  value: string
  /** Read-only rows (Dynamic + Simulated, and isNight within Fixed) render muted. */
  muted?: boolean
  /** Present only for editable Fixed signals (familiarRoute/childPassenger). */
  editControl?: ReactNode
  /** Present only for Simulated (tier-3) signals — renders the ⓘ formulation editor. */
  formulaEditor?: ReactNode
  highlighted?: boolean
  onHover?: () => void
  onLeave?: () => void
}) {
  return (
    <div
      data-testid={`signal-row-${signalKey}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        padding: '3px 4px',
        marginBottom: '2px',
        borderRadius: '4px',
        background: highlighted ? '#eef2ff' : 'transparent',
        fontSize: '0.8em',
      }}
    >
      <span style={{ color: muted ? '#9ca3af' : '#374151' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: muted ? '#9ca3af' : '#374151', fontStyle: muted ? 'italic' : 'normal' }}>
          {value}
        </span>
        {editControl}
        {formulaEditor}
      </span>
    </div>
  )
}
