import { useEffect, useMemo, useState } from 'react'
import { useRunStore, selectOverridesDiff } from '../../state/runStore'
import { getPackage, routesAnalyze, createRunPlan, createRun } from '../../api/client'
import type {
  InstantResult,
  PackageManifest,
  PreviewSegment,
  ScoreSeriesPoint,
  RouteFacts,
  DisplayRoute,
} from '../../api/types'
import ErrorNotice from '../common/ErrorNotice'

/**
 * InstantResultStrip (feature 009, FE4) — full-width bottom strip of the new
 * setup screen (others/aica_setup_screen_uiux.md "Bottom strip — Instant
 * Result"): a live, STATIC (no animation) timeline of the headless preview
 * outcome that recomputes as the user edits the setup.
 *
 * Contract (no props — store-driven, matching every other setup/* editor):
 *   Reads:
 *     - state.instantResult / previewLoading / previewError — populated by
 *       useRunPreview() (called once from SetupScreen); this component only
 *       renders that state, it never calls POST /runs/preview itself.
 *     - state.runSeed — the seed chip.
 *     - state.editedHyperparameters + its OWN getPackage(selectedPackageId)
 *       fetch (mirrors AlgorithmFormulationPanel's fetch pattern) — feeds
 *       selectOverridesDiff for a LIVE "N overrides" chip that updates the
 *       instant the user edits a coefficient, ahead of the debounced preview
 *       catching up (instantResult.overrides lags by the debounce window).
 *   Dispatches:
 *     - REROLL_SEED — the 🎲 affordance; useRunPreview reacts automatically.
 *   "Open full run" — freezes the current setup into a real run-plan + run
 *     (same createRunPlan → createRun flow PlanPreview.tsx uses on the local
 *     no-Maps-key path, since MapKeyAndRouteInput isn't wired into this
 *     screen — see FE1 report), then dispatches RUN_CREATED, which already
 *     auto-transitions viewMode → 'review'.
 *
 * Rendering notes:
 *   - Inline SVG only — no charting library, no new deps.
 *   - y-axis scale is derived PER RESULT from score_series + threshold
 *     together (never hardcoded 0–1): aica_transparent_hybrid_trigger_v1's
 *     scores are already 0–1, nri_fatigue_score_v1's are a raw points scale
 *     (see task-us1-report.md field notes) — score_series/threshold are
 *     always on the SAME scale as each other within one InstantResult, so
 *     computing the range from both together is sufficient (no cross-package
 *     normalization exists or is needed).
 *   - x-axis: score_series.t is a TICK index, while segments/rest_spot/
 *     rest_option/completed_min are in MINUTES. The tick engine runs on a
 *     fixed tick duration for the whole run, so the curve (plotted by tick,
 *     scaled to its own max tick) and the segment bands/markers (plotted by
 *     minute, scaled to completed_min) land at the same fractional position
 *     for the same instant — see xForTick/xForMin below.
 *   - The fire marker (and the "Fired: …" result line) is gated on
 *     `fired === true && fire != null` — never rendered from stale/error
 *     state, so an `error` result can never show a fabricated fire.
 */
export default function InstantResultStrip() {
  const { state, dispatch } = useRunStore()
  const {
    instantResult,
    previewLoading,
    previewError,
    runSeed,
    editedHyperparameters,
    selectedPackageId,
    selectedScenarioId,
    editedParameters,
    alternatives,
    selectedRouteId,
    routeSource,
    profileOverrides,
    tickSecondsOverride,
    initialDrowsiness,
    initialFatigue,
  } = state

  const [manifest, setManifest] = useState<PackageManifest | null>(null)
  const [openRunLoading, setOpenRunLoading] = useState(false)
  const [openRunError, setOpenRunError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPackageId) {
      setManifest(null)
      return
    }
    let cancelled = false
    getPackage(selectedPackageId)
      .then((pkg) => {
        if (!cancelled) setManifest(pkg)
      })
      .catch(() => {
        if (!cancelled) setManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPackageId])

  const overridesDiff = useMemo(() => {
    const defaults: Record<string, number | string | boolean> = {}
    for (const def of manifest?.hyperparameters ?? []) defaults[def.key] = def.default
    return selectOverridesDiff(editedHyperparameters, defaults)
  }, [manifest, editedHyperparameters])

  function handleReroll() {
    dispatch({ type: 'REROLL_SEED' })
  }

  async function handleOpenFullRun() {
    if (!selectedPackageId || !selectedScenarioId) return
    setOpenRunError(null)
    setOpenRunLoading(true)
    try {
      // Resolve the route alternative — mirrors PlanPreview.tsx's local path
      // (MapKeyAndRouteInput isn't wired into this screen, so `alternatives`
      // is normally empty here; the maps-selected-alt branch is kept for
      // forward-compat if that ever changes).
      let routeId: string
      let resolvedRouteSource: string
      let routeFacts: RouteFacts | null = null
      let displayRoute: DisplayRoute | null = null

      if (alternatives.length > 0 && selectedRouteId) {
        const alt = alternatives.find((a) => a.route_id === selectedRouteId)
        if (!alt) throw new Error(`Selected route "${selectedRouteId}" not found in alternatives`)
        routeId = alt.route_id
        resolvedRouteSource = routeSource
        routeFacts = alt.route_facts
        displayRoute = alt.display
      } else {
        const envelope = await routesAnalyze({ scenarioId: selectedScenarioId })
        if (envelope.alternatives.length === 0) {
          throw new Error('No route alternatives returned from analyze')
        }
        const alt = envelope.alternatives[0]
        routeId = alt.route_id
        resolvedRouteSource = envelope.route_source
        routeFacts = alt.route_facts
        displayRoute = alt.display
      }

      const presets: Record<string, unknown> = tickSecondsOverride != null ? { tick_seconds: tickSecondsOverride } : {}

      const initialState: { drowsiness_level?: number; fatigue_level?: number } = {}
      if (initialDrowsiness != null) initialState.drowsiness_level = initialDrowsiness
      if (initialFatigue != null) initialState.fatigue_level = initialFatigue

      const CONTEXT_KEYS = ['child_passenger', 'familiar_route'] as const
      const algParameters = Object.fromEntries(
        Object.entries(editedParameters).filter(([k]) => !CONTEXT_KEYS.includes(k as (typeof CONTEXT_KEYS)[number])),
      )
      const contextOverrides: { child_passenger?: boolean; familiar_route?: boolean } = {}
      for (const k of CONTEXT_KEYS) {
        if (k in editedParameters) contextOverrides[k] = Boolean(editedParameters[k])
      }

      const planResp = await createRunPlan({
        packageId: selectedPackageId,
        scenarioId: selectedScenarioId,
        parameters: algParameters,
        hyperparameters: editedHyperparameters,
        presets,
        runMode: 'standard',
        routeId,
        routeSource: resolvedRouteSource,
        routeFacts,
        displayRoute,
        ...(profileOverrides != null ? { profiles: profileOverrides } : {}),
        ...(Object.keys(initialState).length > 0 ? { initialState } : {}),
        ...(Object.keys(contextOverrides).length > 0 ? { contextOverrides } : {}),
      })

      const runState = await createRun(planResp.plan_id)
      dispatch({ type: 'RUN_CREATED', runState })
    } catch (err: unknown) {
      setOpenRunError(err instanceof Error ? err.message : 'Failed to open full run')
    } finally {
      setOpenRunLoading(false)
    }
  }

  const canOpenFullRun = Boolean(selectedPackageId && selectedScenarioId) && !openRunLoading

  return (
    <div data-testid="instant-result-strip">
      <div
        data-testid="instant-result-chips"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
          fontSize: '0.8em',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#374151' }}>
          <strong style={{ letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.85em', color: '#6b7280' }}>
            Instant Result
          </strong>
          <span data-testid="instant-result-seed-chip">
            seed {runSeed}{' '}
            <button
              type="button"
              data-testid="instant-result-reroll"
              aria-label="Re-roll seed"
              onClick={handleReroll}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1em' }}
            >
              🎲
            </button>
          </span>
          <span data-testid="instant-result-overrides-chip">
            {overridesDiff.length} override{overridesDiff.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          data-testid="instant-result-open-full-run"
          onClick={handleOpenFullRun}
          disabled={!canOpenFullRun}
          style={{ padding: '4px 10px', fontSize: '0.9em' }}
        >
          {openRunLoading ? 'Opening…' : '▸ Open full run'}
        </button>
      </div>

      {openRunError && <ErrorNotice testid="instant-result-open-run-error" message={openRunError} />}

      {previewLoading && (
        <div data-testid="instant-result-loading" style={{ fontSize: '0.85em', color: '#6b7280', padding: '8px 0' }}>
          Computing preview…
        </div>
      )}

      {!previewLoading && previewError && (
        <ErrorNotice testid="instant-result-preview-error" message={previewError} />
      )}

      {!previewLoading && !previewError && instantResult && <InstantResultTimeline result={instantResult} />}

      {!previewLoading && !previewError && !instantResult && (
        <div data-testid="instant-result-empty" style={{ fontSize: '0.85em', color: '#9ca3af', padding: '8px 0' }}>
          Select a package and scenario to see a preview.
        </div>
      )}
    </div>
  )
}

// ── Timeline rendering (inline SVG) ─────────────────────────────────────────

const SEGMENT_COLORS: Record<string, string> = {
  start: '#e5e7eb',
  urban: '#dbeafe',
  highway: '#fde68a',
  national: '#fed7aa',
  normal_road: '#fed7aa',
  residential: '#e5e7eb',
  mountain_road: '#d9f99d',
  sightseeing_road: '#bbf7d0',
  rest: '#bbf7d0',
  end: '#e5e7eb',
}
const DEFAULT_SEGMENT_COLOR = '#f3f4f6'

const W = 760
const CURVE_TOP = 6
const CURVE_BOTTOM = 58
const SEG_TOP = 64
const SEG_BOTTOM = 80
const MARK_Y = 100
const MARK_LABEL_Y = 116
const H = 128

function InstantResultTimeline({ result }: { result: InstantResult }) {
  const { score_series, segments, threshold, fire, fired, rest_spot, rest_option, completed_min, error } = result

  // ── x-axis domains ────────────────────────────────────────────────────────
  const tickMax = score_series.length > 0 ? Math.max(1, score_series[score_series.length - 1].t) : 1
  const minMax = Math.max(
    1,
    completed_min ?? (segments.length > 0 ? segments[segments.length - 1].to_min : tickMax),
  )
  const xForTick = (t: number) => (Math.min(t, tickMax) / tickMax) * W
  const xForMin = (m: number) => (Math.min(m, minMax) / minMax) * W

  // ── y-axis: fit BOTH score_series and threshold (never hardcode 0–1) ───────
  const scoreValues = score_series.map((p: ScoreSeriesPoint) => p.score)
  if (threshold != null) scoreValues.push(threshold)
  const rawMin = scoreValues.length > 0 ? Math.min(...scoreValues) : 0
  const rawMax = scoreValues.length > 0 ? Math.max(...scoreValues) : 1
  const pad = (rawMax - rawMin) * 0.1 || 0.1
  const yMin = rawMin - pad
  const yMax = rawMax + pad
  const yToPixel = (v: number) => CURVE_BOTTOM - ((v - yMin) / (yMax - yMin)) * (CURVE_BOTTOM - CURVE_TOP)

  const curvePoints = score_series.map((p) => `${xForTick(p.t).toFixed(1)},${yToPixel(p.score).toFixed(1)}`).join(' ')

  return (
    <div data-testid="instant-result-timeline">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        role="img"
        aria-label="Instant result timeline"
        data-testid="instant-result-svg"
      >
        {/* Segment bands (background) */}
        {segments.map((seg: PreviewSegment, idx: number) => {
          const x1 = xForMin(seg.from_min)
          const x2 = xForMin(seg.to_min)
          const color = (seg.type && SEGMENT_COLORS[seg.type]) || DEFAULT_SEGMENT_COLOR
          return (
            <g key={idx} data-testid={`instant-result-segment-${idx}`}>
              <rect x={x1} y={SEG_TOP} width={Math.max(0, x2 - x1)} height={SEG_BOTTOM - SEG_TOP} fill={color} />
              {x2 - x1 > 28 && (
                <text x={(x1 + x2) / 2} y={SEG_TOP + 11} fontSize="8" textAnchor="middle" fill="#4b5563">
                  {seg.type ?? ''}
                </text>
              )}
            </g>
          )
        })}

        {/* Threshold line */}
        {threshold != null && (
          <g data-testid="instant-result-threshold">
            <line
              x1={0}
              x2={W}
              y1={yToPixel(threshold)}
              y2={yToPixel(threshold)}
              stroke="#dc2626"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text x={W - 4} y={yToPixel(threshold) - 3} fontSize="8" textAnchor="end" fill="#dc2626">
              threshold {formatNum(threshold)}
            </text>
          </g>
        )}

        {/* Score curve */}
        {score_series.length > 0 && (
          <polyline data-testid="instant-result-curve" points={curvePoints} fill="none" stroke="#2563eb" strokeWidth={2} />
        )}

        {/* Recovery window band (from the auto-chosen rest option) */}
        {rest_option && rest_option.recovery_from_min != null && rest_option.to_min != null && (
          <rect
            data-testid="instant-result-recovery-window"
            x={xForMin(rest_option.recovery_from_min)}
            y={SEG_TOP}
            width={Math.max(0, xForMin(rest_option.to_min) - xForMin(rest_option.recovery_from_min))}
            height={SEG_BOTTOM - SEG_TOP}
            fill="#a78bfa"
            opacity={0.35}
          />
        )}

        {/* Markers row */}
        {fired && fire != null && (
          <g data-testid="instant-result-fire-marker">
            <text x={xForMin(fire.time_min)} y={MARK_Y} fontSize="14" textAnchor="middle">
              🔔
            </text>
            <text x={xForMin(fire.time_min)} y={MARK_LABEL_Y} fontSize="8" textAnchor="middle" fill="#374151">
              {(fire.category ?? '').split('_')[0].toUpperCase()} @{Math.round(fire.time_min)}m
            </text>
          </g>
        )}

        {rest_spot && rest_spot.eta_min != null && (
          <g data-testid="instant-result-rest-spot-marker">
            <text x={xForMin(rest_spot.eta_min)} y={MARK_Y} fontSize="14" textAnchor="middle">
              🅿️
            </text>
            <text x={xForMin(rest_spot.eta_min)} y={MARK_LABEL_Y} fontSize="8" textAnchor="middle" fill="#374151">
              {rest_spot.at_km.toFixed(0)}km
            </text>
          </g>
        )}

        {rest_option && rest_option.recovery_from_min != null && (
          <g data-testid="instant-result-rest-option-marker">
            <text x={xForMin(rest_option.recovery_from_min)} y={MARK_Y} fontSize="14" textAnchor="middle">
              💤
            </text>
            <text x={xForMin(rest_option.recovery_from_min)} y={MARK_LABEL_Y} fontSize="8" textAnchor="middle" fill="#374151">
              {rest_option.id}
            </text>
          </g>
        )}

        {completed_min != null && (
          <g data-testid="instant-result-completion-marker">
            <text x={xForMin(completed_min)} y={MARK_Y} fontSize="14" textAnchor="middle">
              🏁
            </text>
            <text x={xForMin(completed_min)} y={MARK_LABEL_Y} fontSize="8" textAnchor="middle" fill="#374151">
              {Math.round(completed_min)}m
            </text>
          </g>
        )}
      </svg>

      {error && (
        <ErrorNotice
          testid="instant-result-error"
          message={`Algorithm error @ tick ${error.tick_index} (${error.error_type}): ${error.message}`}
        />
      )}

      <p data-testid="instant-result-line" style={{ fontSize: '0.85em', color: '#374151', margin: '4px 0 0' }}>
        {buildResultLine(result)}
      </p>
    </div>
  )
}

function formatNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** Builds the "Fired: …" / "No trigger — …" result line (never a fabricated fire). */
function buildResultLine(result: InstantResult): string {
  const { fired, fire, peak_score, threshold, rest_option, completed_min, error } = result

  if (error) {
    return `Preview halted by an algorithm error (${error.error_type}) — no result to report.`
  }

  if (!fired || !fire) {
    const thresholdText = threshold != null ? formatNum(threshold) : '—'
    return `No trigger — peak ${formatNum(peak_score)} (threshold ${thresholdText})`
  }

  const category = fire.category ? fire.category.split('_')[0].toUpperCase() : 'TRIGGER'
  const strength = fire.strength ? ` · ${fire.strength}` : ''
  const restPart = rest_option ? ` · auto-rest ${rest_option.id}` : ''
  const donePart = completed_min != null ? ` · done ${Math.round(completed_min)} min` : ''
  return `Fired: ${category}${strength} @ ${Math.round(fire.time_min)} min · peak ${formatNum(peak_score)}${restPart}${donePart}`
}
