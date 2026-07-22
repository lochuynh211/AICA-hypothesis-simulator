import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario, getPackage } from '../../api/client'
import type { FeatureDef, ScenarioDef } from '../../api/types'
import { usedSignalKeys } from './signalUsage'
import { t } from '../../i18n/t'
import ScenarioSelector from './ScenarioSelector'
import MapKeyAndRouteInput from './MapKeyAndRouteInput'
import RestCeilingEditor from './RestCeilingEditor'
import RestSpacingEditor from './RestSpacingEditor'
import RestOptionsEditor from './RestOptionsEditor'
import { SIGNAL_LABELS } from './signalLabels'
import StepGate from './StepGate'
import { SignalGroup, SignalRow } from './situation/signalPrimitives'
import FixedConditionsSection from './situation/FixedConditionsSection'
import SpeedProfileSection from './situation/SpeedProfileSection'
import SimulatedSignalsSection from './situation/SimulatedSignalsSection'

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
 * The Fixed / Speed / Simulated groups are rendered by extracted, SHARED
 * components (`./situation/*`) so the Combined Simulator's Situation editor can
 * reuse the identical controls (feature 020 extract-and-share). SignalsPanel
 * passes its cross-link highlight/dim wiring into them so this screen stays
 * byte-identical; the Dynamic (read-only) group stays inline here.
 */
export default function SignalsPanel() {
  const { state, dispatch } = useRunStore()
  const {
    selectedScenarioId,
    selectedPackageId,
    selectedRouteId,
    highlightedSignalKey,
    uiLanguage,
    tickSecondsOverride,
  } = state
  // Forced setup order (feature 009): Route → Scenario → Package. The scenario
  // step stays locked until a route is selected.
  const routeSelected = selectedRouteId != null
  const [scenario, setScenario] = useState<ScenarioDef | null>(null)
  const [packageFeatures, setPackageFeatures] = useState<FeatureDef[] | undefined>(undefined)
  // The selected package may override the tick cadence via algorithm.tick_seconds
  // (the value the backend actually runs at). null when unset / no package.
  const [packageTickSeconds, setPackageTickSeconds] = useState<number | null>(null)

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

  // Load the selected package's feature list so we can dim signals it never uses
  // (see signalUsage.ts). Only `features` is needed here; the full manifest is
  // owned by AlgorithmFormulationPanel.
  useEffect(() => {
    if (!selectedPackageId) {
      setPackageFeatures(undefined)
      setPackageTickSeconds(null)
      return
    }
    let cancelled = false
    getPackage(selectedPackageId)
      .then((pkg) => {
        if (!cancelled) {
          setPackageFeatures(pkg.features)
          setPackageTickSeconds(pkg.algorithm?.tick_seconds ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPackageFeatures(undefined)
          setPackageTickSeconds(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedPackageId])

  // When the scenario step unlocks (a route is selected), bring it into view so
  // the user sees the next step without hunting for it.
  const scenarioSectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (routeSelected && typeof scenarioSectionRef.current?.scrollIntoView === 'function') {
      scenarioSectionRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [routeSelected])

  // Signals the selected package consumes; everything else renders dimmed. When
  // no package is selected this is the full set, so nothing dims.
  const usedSignals = usedSignalKeys(selectedPackageId, packageFeatures)
  const isDimmed = (signalKey: string) => !usedSignals.has(signalKey as never)

  function highlight(key: string) {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key })
  }
  function unhighlight() {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key: null })
  }

  // Tick duration (seconds per simulation step). The default must match the
  // cadence the backend actually runs at: the package's algorithm.tick_seconds
  // override wins (run_plan.py precedence), then the scenario's tick_seconds,
  // then a hardcoded fallback. An explicit edit is sent as presets.tick_seconds
  // on the full run (see InstantResultStrip); null once reverted to default.
  const tickDefault = packageTickSeconds ?? scenario?.tick_seconds ?? 60
  const tickValue = tickSecondsOverride ?? tickDefault

  function handleTickChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') return
    const num = Math.round(Number(raw))
    if (Number.isNaN(num) || num < 1) return
    dispatch({ type: 'SET_TICK_SECONDS', seconds: num === tickDefault ? null : num })
  }

  return (
    <div data-testid="signals-panel">
      <div data-testid="route-section">
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
          {t(
            { en: 'Step 1 · Route (preset or Google Maps)', ja: 'ステップ1 · ルート（プリセット / Google マップ）' },
            uiLanguage,
          )}
        </h3>
        <MapKeyAndRouteInput />
        {/* Rest-spot review controls: the reachability ceiling used to mark spots
            reachable, and the minimum spacing between returned spots. Both feed
            GET /rest-spots via the recovery picker. */}
        <RestCeilingEditor />
        <RestSpacingEditor />
      </div>

      <div data-testid="tick-section" style={{ marginTop: '12px' }}>
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
          {t({ en: 'Tick duration', ja: 'ティック時間' }, uiLanguage)}
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '0.8em',
            color: '#374151',
          }}
        >
          <span>{t({ en: 'Seconds per tick', ja: '1ティックあたりの秒数' }, uiLanguage)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="number"
              data-testid="tick-seconds-input"
              aria-label={t({ en: 'Seconds per tick', ja: '1ティックあたりの秒数' }, uiLanguage)}
              min={1}
              step={1}
              value={tickValue}
              onChange={handleTickChange}
              style={{
                width: '56px',
                fontSize: '1em',
                textAlign: 'center',
                border: `1px solid ${tickSecondsOverride != null ? '#6366f1' : '#d1d5db'}`,
                borderRadius: '3px',
                background: tickSecondsOverride != null ? '#eef2ff' : '#fff',
              }}
            />
            <span style={{ color: '#9ca3af' }}>s</span>
          </span>
        </div>
      </div>

      <div ref={scenarioSectionRef} data-testid="scenario-section" style={{ marginTop: '12px' }}>
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
          {t({ en: 'Step 2 · Scenario', ja: 'ステップ2 · シナリオ' }, uiLanguage)}
        </h3>
        <StepGate
          locked={!routeSelected}
          hint={t({ en: 'Select a route first', ja: '先にルートを選択してください' }, uiLanguage)}
          testid="scenario-gate"
        >
          <ScenarioSelector />
        </StepGate>
      </div>

      {scenario && (
        <>
          <FixedConditionsSection
            scenario={scenario}
            isDimmed={isDimmed}
            highlightedSignalKey={highlightedSignalKey}
            onHighlight={highlight}
            onUnhighlight={unhighlight}
          />

          <SignalGroup
            title={t({ en: 'Live route values', ja: 'ルート実測値' }, uiLanguage)}
            testid="signal-group-dynamic"
            caption={t(
              {
                en: 'Computed live each tick as the drive plays out — read-only here.',
                ja: '走行の進行に合わせてティックごとに算出される値（ここでは編集不可）。',
              },
              uiLanguage,
            )}
          >
            <SignalRow
              signalKey="continuousDrivingMin"
              label={t(SIGNAL_LABELS.continuousDrivingMin, uiLanguage)}
              value={t({ en: 'grows while moving; resets after a rest', ja: '走行中に増加し、休憩後にリセット' }, uiLanguage)}
              muted
              highlighted={highlightedSignalKey === 'continuousDrivingMin'}
              dimmed={isDimmed('continuousDrivingMin')}
              onHover={() => highlight('continuousDrivingMin')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="segmentType"
              label={t(SIGNAL_LABELS.segmentType, uiLanguage)}
              value={t({ en: 'urban / highway / mountain / sightseeing', ja: '市街地／高速／山道／観光道路' }, uiLanguage)}
              muted
              highlighted={highlightedSignalKey === 'segmentType'}
              dimmed={isDimmed('segmentType')}
              onHover={() => highlight('segmentType')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="isTrafficJam"
              label={t(SIGNAL_LABELS.isTrafficJam, uiLanguage)}
              value={t({ en: 'on inside congested stretches', ja: '渋滞区間でオン' }, uiLanguage)}
              muted
              highlighted={highlightedSignalKey === 'isTrafficJam'}
              dimmed={isDimmed('isTrafficJam')}
              onHover={() => highlight('isTrafficJam')}
              onLeave={unhighlight}
            />
            <SignalRow
              signalKey="nextRestSpotMin"
              label={t(SIGNAL_LABELS.nextRestSpotMin, uiLanguage)}
              value={t({ en: 'minutes to the next rest opportunity', ja: '次の休憩機会までの分数' }, uiLanguage)}
              muted
              highlighted={highlightedSignalKey === 'nextRestSpotMin'}
              dimmed={isDimmed('nextRestSpotMin')}
              onHover={() => highlight('nextRestSpotMin')}
              onLeave={unhighlight}
            />
          </SignalGroup>

          <SpeedProfileSection scenario={scenario} />

          <SimulatedSignalsSection
            scenario={scenario}
            isDimmed={isDimmed}
            highlightedSignalKey={highlightedSignalKey}
            onHighlight={highlight}
            onUnhighlight={unhighlight}
          />

          <RestOptionsEditor scenario={scenario} />
        </>
      )}
    </div>
  )
}
