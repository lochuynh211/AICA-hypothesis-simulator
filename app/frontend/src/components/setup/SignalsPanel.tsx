import { useEffect, useState, type ReactNode } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { ScenarioDef } from '../../api/types'
import { t } from '../../i18n/t'
import PackageSelector from './PackageSelector'
import ScenarioSelector from './ScenarioSelector'
import SignalInfoPopover, { type SignalInfoKey } from './SignalInfoPopover'

/**
 * SignalsPanel (feature 009, FE2) — left editor panel of the new setup screen
 * (others/aica_setup_screen_uiux.md "Left panel — Scenario & Signals").
 *
 * Layout:
 *   1. Location/Preset — PackageSelector + ScenarioSelector, reused as-is.
 *   2. The selected scenario's signals, grouped under three tier headings:
 *      Fixed / Dynamic / Simulated (matches the engine's signal-tier model —
 *      see packages/nri_fatigue_score_v1/algorithm.py's signals.fixed /
 *      .dynamic / .simulated read).
 *
 * Editable vs read-only:
 *   - Fixed: familiarRoute/childPassenger are scenario-editable (✎ checkbox,
 *     dispatches SET_PARAMETER with keys 'familiar_route'/'child_passenger' —
 *     the same keys PlanPreview.tsx already splits into contextOverrides for
 *     the real run-plan flow, and the only two keys the backend's
 *     _VALID_CONTEXT_KEYS accepts). isNight is shown but NOT editable: the
 *     backend has no context-override key for it yet (see ScenarioDef.is_night
 *     doc in api/types.ts) — sending it through SET_PARAMETER would either be
 *     silently dropped or misrouted as an unknown algorithm parameter by
 *     PlanPreview's CONTEXT_KEYS split, so it is intentionally left read-only
 *     until a backend follow-up adds the context key.
 *   - Dynamic: always read-only/muted — these are runtime-computed per tick;
 *     at setup time there is no run yet, so rows show a descriptive
 *     placeholder rather than a live value.
 *   - Simulated (tier 3): always read-only/muted; each carries an ⓘ
 *     (SignalInfoPopover) explaining how it's formulated. drowsiness/fatigue
 *     are deterministic curves off driver_signal_params; anomaly_rate is the
 *     seeded-Poisson generator off anomaly_signal_params (see
 *     SignalInfoPopover's explanation map).
 *
 * Cross-link highlight: hovering any signal row dispatches
 * SET_HIGHLIGHTED_SIGNAL so AlgorithmFormulationPanel (FE3) can mirror the
 * highlight on feature names that reference that signal; leaving dispatches
 * SET_HIGHLIGHTED_SIGNAL with key: null.
 */
export default function SignalsPanel() {
  const { state, dispatch } = useRunStore()
  const { selectedScenarioId, editedParameters, highlightedSignalKey, uiLanguage, runSeed } = state
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

  return (
    <div data-testid="signals-panel">
      <PackageSelector />
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
              value={Boolean(editedParameters.familiar_route ?? scenario.familiar_route ?? false) ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'familiarRoute'}
              onHover={() => highlight('familiarRoute')}
              onLeave={unhighlight}
              editControl={
                <input
                  type="checkbox"
                  data-testid="signal-edit-familiarRoute"
                  aria-label={t({ en: 'Familiar Route', ja: '慣れた道' }, uiLanguage)}
                  checked={Boolean(editedParameters.familiar_route ?? scenario.familiar_route ?? false)}
                  onChange={(e) =>
                    dispatch({ type: 'SET_PARAMETER', key: 'familiar_route', value: e.target.checked })
                  }
                />
              }
            />
            <SignalRow
              signalKey="childPassenger"
              label={t({ en: 'Child Passenger', ja: '子供同乗' }, uiLanguage)}
              value={Boolean(editedParameters.child_passenger ?? scenario.child_passenger ?? false) ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'childPassenger'}
              onHover={() => highlight('childPassenger')}
              onLeave={unhighlight}
              editControl={
                <input
                  type="checkbox"
                  data-testid="signal-edit-childPassenger"
                  aria-label={t({ en: 'Child Passenger', ja: '子供同乗' }, uiLanguage)}
                  checked={Boolean(editedParameters.child_passenger ?? scenario.child_passenger ?? false)}
                  onChange={(e) =>
                    dispatch({ type: 'SET_PARAMETER', key: 'child_passenger', value: e.target.checked })
                  }
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
              info="drowsiness"
              highlighted={highlightedSignalKey === 'drowsiness'}
              onHover={() => highlight('drowsiness')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="fatigue"
              label={t({ en: 'Fatigue', ja: '疲労' }, uiLanguage)}
              value="~curve"
              muted
              info="fatigue"
              highlighted={highlightedSignalKey === 'fatigue'}
              onHover={() => highlight('fatigue')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="anomaly_rate"
              label={t({ en: 'Anomaly Rate', ja: '異常発生率' }, uiLanguage)}
              value={`seeded Poisson (seed ${runSeed})`}
              muted
              info="anomaly_rate"
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
  info,
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
  /** Present only for Simulated (tier-3) signals — renders the ⓘ explainer. */
  info?: SignalInfoKey
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
        {info && <SignalInfoPopover signalKey={info} label={label} />}
      </span>
    </div>
  )
}
