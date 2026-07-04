import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
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
import InitialSignalValue from './InitialSignalValue'
import SignalFormulationEditor, { type FormulationSignalKey } from './SignalFormulationEditor'
import { SIGNAL_LABELS } from './signalLabels'
import { HIGHLIGHT_BG } from './highlight'
import StepGate from './StepGate'

/** Faded opacity for a signal row the selected package doesn't consume. */
const DIMMED_OPACITY = 0.35
const UNUSED_SIGNAL_TITLE = 'Not used by the selected algorithm'

/**
 * Auto-scroll a cross-link source row into view when it becomes highlighted.
 * The highlight is usually triggered from the *right* panel (hovering a feature
 * name in AlgorithmFormulationPanel), and the source signal it points at may be
 * scrolled out of view in this left panel — so bring it back. `block: 'nearest'`
 * makes it a no-op when the row is already visible (e.g. when the hover
 * originates on the row itself), so it never jumps for no reason.
 */
function useHighlightScroll(highlighted: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Guarded: jsdom (test env) leaves scrollIntoView unimplemented.
    if (highlighted && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlighted])
  return ref
}

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
 *   - Fixed: isNight/familiarRoute/childPassenger/weatherRisk are scenario-
 *     editable (✎ checkbox / numeric input, dispatching SET_CONTEXT_OVERRIDE
 *     into `contextOverrides` — changed-from-scenario-default only, mirroring
 *     the editedHyperparameters/SET_HYPERPARAMETER convention). `is_night` is a
 *     boolean context-override key like child_passenger/familiar_route (see
 *     services/run_plan._VALID_CONTEXT_OVERRIDE_KEYS). `contextOverrides` is
 *     sent as `context_overrides` to BOTH the instant preview and the real
 *     run-plan (see state/runStore.ts, api/client.ts).
 *   - Dynamic: always read-only/muted — these are runtime-computed per tick;
 *     at setup time there is no run yet, so rows show a descriptive
 *     placeholder rather than a live value.
 *   - Simulated (tier 3): rendered by SimulatedSignal — the signal name above
 *     its formula shown INLINE (SignalFormulationEditor, UX-FE4) with the
 *     generator sub-params as editable inline `[coefficient]` fields, mirroring
 *     the right panel's formula-as-UI. The ⓘ is demoted to a brief words-only
 *     explanation. drowsiness/fatigue edit `driver_signal_params.{drowsiness_
 *     model,fatigue_model}`; anomaly_rate edits `anomaly_signal_params`. Edits
 *     are dispatched as `SET_PROFILE_OVERRIDES` (changed-from-scenario-default
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
  const {
    selectedScenarioId,
    selectedPackageId,
    selectedRouteId,
    contextOverrides,
    highlightedSignalKey,
    uiLanguage,
    runSeed,
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
          <SignalGroup title="Fixed" testid="signal-group-fixed">
            <SignalRow
              signalKey="isNight"
              label={t(SIGNAL_LABELS.isNight, uiLanguage)}
              value={isNightValue ? 'on' : 'off'}
              highlighted={highlightedSignalKey === 'isNight'}
              dimmed={isDimmed('isNight')}
              onHover={() => highlight('isNight')}
              onLeave={unhighlight}
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
              value={familiarRouteValue ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'familiarRoute'}
              dimmed={isDimmed('familiarRoute')}
              onHover={() => highlight('familiarRoute')}
              onLeave={unhighlight}
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
              value={childPassengerValue ? 'yes' : 'no'}
              highlighted={highlightedSignalKey === 'childPassenger'}
              dimmed={isDimmed('childPassenger')}
              onHover={() => highlight('childPassenger')}
              onLeave={unhighlight}
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
              onHover={() => highlight('weatherRisk')}
              onLeave={unhighlight}
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

          <SignalGroup
            title="Dynamic"
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

          <SignalGroup title="Simulated (tier 3)" testid="signal-group-simulated">
            <SimulatedSignal
              signalKey="drowsiness"
              label={t(SIGNAL_LABELS.drowsiness, uiLanguage)}
              scenario={scenario}
              highlighted={highlightedSignalKey === 'drowsiness'}
              dimmed={isDimmed('drowsiness')}
              onHover={() => highlight('drowsiness')}
              onLeave={unhighlight}
              initialControl={<InitialSignalValue signalKey="drowsiness" scenario={scenario} />}
            />
            <SimulatedSignal
              signalKey="fatigue"
              label={t(SIGNAL_LABELS.fatigue, uiLanguage)}
              scenario={scenario}
              highlighted={highlightedSignalKey === 'fatigue'}
              dimmed={isDimmed('fatigue')}
              onHover={() => highlight('fatigue')}
              onLeave={unhighlight}
              initialControl={<InitialSignalValue signalKey="fatigue" scenario={scenario} />}
            />
            <SimulatedSignal
              signalKey="anomaly_rate"
              label={`${t(SIGNAL_LABELS.anomaly_rate, uiLanguage)} · seed ${runSeed}`}
              scenario={scenario}
              highlighted={highlightedSignalKey === 'anomaly_rate'}
              dimmed={isDimmed('anomaly_rate')}
              onHover={() => highlight('anomaly_rate')}
              onLeave={unhighlight}
            />
          </SignalGroup>

          <RestOptionsEditor scenario={scenario} />
        </>
      )}
    </div>
  )
}

// ── Presentational helpers ──────────────────────────────────────────────────

function SignalGroup({
  title,
  testid,
  caption,
  children,
}: {
  title: string
  testid: string
  caption?: string
  children: ReactNode
}) {
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
      {caption && (
        <p style={{ fontSize: '0.7em', color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.4 }}>{caption}</p>
      )}
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
  highlighted = false,
  dimmed = false,
  onHover,
  onLeave,
}: {
  signalKey: string
  label: string
  value: string
  /** Read-only rows (Dynamic) render muted. */
  muted?: boolean
  /** Present only for editable Fixed signals (isNight/familiarRoute/childPassenger/weatherRisk). */
  editControl?: ReactNode
  highlighted?: boolean
  /** The selected package doesn't consume this signal — render faded (see signalUsage.ts). */
  dimmed?: boolean
  onHover?: () => void
  onLeave?: () => void
}) {
  const rowRef = useHighlightScroll(highlighted)
  return (
    <div
      ref={rowRef}
      data-testid={`signal-row-${signalKey}`}
      data-dimmed={dimmed ? 'true' : 'false'}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={dimmed ? UNUSED_SIGNAL_TITLE : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        padding: '3px 4px',
        marginBottom: '2px',
        borderRadius: '4px',
        opacity: dimmed ? DIMMED_OPACITY : 1,
        background: highlighted ? HIGHLIGHT_BG : 'transparent',
        fontSize: '0.8em',
      }}
    >
      <span style={{ color: muted ? '#9ca3af' : '#374151' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: muted ? '#9ca3af' : '#374151', fontStyle: muted ? 'italic' : 'normal' }}>
          {value}
        </span>
        {editControl}
      </span>
    </div>
  )
}

/**
 * A Simulated (tier-3) signal: its name (a cross-link, same hover-highlight as
 * SignalRow) stacked above its inline formulation — the formula shown in place
 * with editable `[param]` fields, mirroring the right panel's formula-as-UI
 * (AlgorithmFormulationPanel). The old ⓘ-popover-only presentation is gone; the
 * ⓘ (inside SignalFormulationEditor) now carries just a brief word-explanation.
 */
function SimulatedSignal({
  signalKey,
  label,
  scenario,
  highlighted,
  dimmed = false,
  onHover,
  onLeave,
  initialControl,
}: {
  signalKey: FormulationSignalKey
  label: string
  scenario: ScenarioDef
  highlighted: boolean
  /** The selected package doesn't consume this signal — render faded (see signalUsage.ts). */
  dimmed?: boolean
  onHover: () => void
  onLeave: () => void
  /** Optional setup-time "starting value" control (drowsiness/fatigue), rendered
      below the formula so the initial value lives inside this signal's section. */
  initialControl?: ReactNode
}) {
  const rowRef = useHighlightScroll(highlighted)
  return (
    <div
      ref={rowRef}
      data-testid={`signal-row-${signalKey}`}
      data-dimmed={dimmed ? 'true' : 'false'}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={dimmed ? UNUSED_SIGNAL_TITLE : undefined}
      style={{
        padding: '4px',
        marginBottom: '4px',
        borderRadius: '4px',
        opacity: dimmed ? DIMMED_OPACITY : 1,
        background: highlighted ? HIGHLIGHT_BG : 'transparent',
      }}
    >
      <span style={{ fontSize: '0.8em', fontWeight: 600, color: '#374151' }}>{label}</span>
      <SignalFormulationEditor signalKey={signalKey} label={label} scenario={scenario} />
      {initialControl}
    </div>
  )
}

const SPEED_FIELDS = [
  'normal_road_kph',
  'highway_kph',
  'mountain_road_kph',
  'sightseeing_road_kph',
  'traffic_jam_kph',
] as const

/**
 * SpeedProfileSection (UX-FE5) — restores the "speed setup" dropped by the 009
 * redesign. Edits the scenario's `speed_profile` (kph per road-segment type),
 * which drives the Dynamic `speedKph` signal (and thus how long each segment
 * takes). Edits are dispatched as `SET_PROFILE_OVERRIDES` into
 * `profileOverrides.speed` — changed-from-scenario-default only, same sparse-
 * patch discipline as the tier-3 SignalFormulationEditor. The backend deep-
 * merges this onto the scenario's own speed_profile and validates the whole
 * against SpeedProfile (see services/run_plan._apply_profile_overrides).
 *
 * Hidden when the scenario carries no speed_profile (older scenarios) — a
 * partial override would fail SpeedProfile's required-fields validation.
 */
function SpeedProfileSection({ scenario }: { scenario: ScenarioDef }) {
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
