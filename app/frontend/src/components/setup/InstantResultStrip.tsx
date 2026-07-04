import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
    contextOverrides,
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

      const planResp = await createRunPlan({
        packageId: selectedPackageId,
        scenarioId: selectedScenarioId,
        parameters: editedParameters,
        hyperparameters: editedHyperparameters,
        presets,
        runMode: 'standard',
        routeId,
        routeSource: resolvedRouteSource,
        routeFacts,
        displayRoute,
        runSeed,
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

// Road-band colors — the saturated road classes (highway / normal / mountain /
// scenic) match the Review-screen map (components/map/MapSurface.tsx ROAD_COLORS)
// so the same road reads the same color in both places; non-road bands stay neutral.
const SEGMENT_COLORS: Record<string, string> = {
  start: '#e5e7eb',
  urban: '#dbeafe',
  highway: '#06b6d4', // cyan — matches the map
  national: '#38bdf8',
  normal_road: '#22c55e', // green — matches the map
  residential: '#e5e7eb',
  mountain_road: '#f59e0b', // orange — matches the map
  sightseeing_road: '#16a34a', // scenic green (darker so it differs from normal_road)
  rest: '#c4b5fd',
  end: '#e5e7eb',
}
const DEFAULT_SEGMENT_COLOR = '#f3f4f6'
// Trigger + rest-spot marker colors — mirror the Review timeline (RouteTimeline):
// a red vertical line for each trigger, an orange dot for the auto rest spot.
const TRIGGER_COLOR = '#dc2626'
const REST_SPOT_COLOR = '#f59e0b'
// Anomaly-spike marker — a small pink caret at the top of the curve area. Pink
// keeps it distinct from the red rest-trigger line, teal monotony, and the amber
// rest-spot dot, so a reviewer can point at a spike and see the curve step up.
const SPIKE_COLOR = '#db2777'

// Human-readable road-band labels (segment `type` → label) for band text + legend.
const SEGMENT_LABELS: Record<string, string> = {
  start: 'start',
  urban: 'urban',
  highway: 'highway',
  national: 'national road',
  normal_road: 'normal road',
  residential: 'residential',
  mountain_road: 'mountain road',
  sightseeing_road: 'scenic road',
  rest: 'rest stop',
  end: 'end',
}
const segLabel = (type: string | null | undefined) => (type ? SEGMENT_LABELS[type] ?? type : '')

// Score-curve colors — rest-propose (blue) vs monotony-prevention (teal). Chosen
// to stay distinct from the red threshold and the pale amber/orange road bands.
const REST_COLOR = '#2563eb'
const MONOTONY_COLOR = '#0d9488'

// Fallback viewBox width (px) used before the container is measured / in tests
// where layout is unavailable. At runtime the SVG viewBox is sized to the real
// pixel width so 1 unit = 1px and text is never horizontally stretched.
const W_FALLBACK = 760
const H_FIXED = 92 // compact — keeps the strip thin like the Review progress bar

/** Measures an element's live pixel size via ResizeObserver. Returns {0,0} until
 *  measured (and in jsdom/tests where layout is unavailable) → callers fall back
 *  to W_FALLBACK for width. Guards against environments without ResizeObserver. */
function useMeasuredSize<T extends HTMLElement>(ref: React.RefObject<T>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function InstantResultTimeline({ result }: { result: InstantResult }) {
  const { score_series, segments, threshold, fire, fired, rest_option, completed_min, error } = result
  // Second (monotony) curve — present only for the hybrid; NRI leaves it empty.
  const monotony_series = result.monotony_series ?? []
  const monotony_threshold = result.monotony_threshold ?? null
  const hasMonotony = monotony_series.length > 0
  // Every trigger across the run (fall back to the single `fire` for old fixtures).
  const fires = fired ? (result.fires && result.fires.length > 0 ? result.fires : fire != null ? [fire] : []) : []
  // Rest stops taken — their recovery times (minutes). Prefer the full rest_options
  // list; fall back to the single rest_option (old fixtures). Positioned at the
  // recovery time, NOT the eta, so the dot lands where the rest actually happens.
  const restOptions = result.rest_options && result.rest_options.length > 0
    ? result.rest_options
    : rest_option != null ? [rest_option] : []
  const restStops = restOptions
    .map((o) => o.recovery_from_min)
    .filter((m): m is number => m != null)
  // Anomaly spikes — plotted by tick (xForTick) so each caret sits exactly under
  // its score-curve point. Empty for algorithms/scenarios without an anomaly signal.
  const spikes = result.spikes ?? []

  // Measure only the pixel WIDTH so the viewBox is 1 unit = 1px (text never
  // stretched). The height is a compact fixed value so the strip stays THIN like
  // the Review progress bar — a slim score curve above a thin road band.
  const containerRef = useRef<HTMLDivElement>(null)
  const measured = useMeasuredSize(containerRef)
  const W = measured.width > 0 ? measured.width : W_FALLBACK
  const H = H_FIXED

  // Thin fixed layout: a ~14px road band (like the progress bar) pinned to the
  // bottom, the score curve filling the space above it.
  const CURVE_TOP = 6
  const SEG_BOTTOM = H - 4
  const SEG_TOP = SEG_BOTTOM - 14
  const CURVE_BOTTOM = SEG_TOP - 8
  const BAND_MID = (SEG_TOP + SEG_BOTTOM) / 2

  // Distinct road-band types actually present, in first-appearance order — the
  // legend is built from THIS (not a hardcoded highway/normal-road pair), so it
  // always matches the bands drawn for the current route.
  const presentSegTypes = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const s of segments) {
      if (s.type && !seen.has(s.type)) {
        seen.add(s.type)
        order.push(s.type)
      }
    }
    return order
  }, [segments])

  // ── x-axis domains ────────────────────────────────────────────────────────
  const lastTick = Math.max(
    score_series.length > 0 ? score_series[score_series.length - 1].t : 1,
    monotony_series.length > 0 ? monotony_series[monotony_series.length - 1].t : 1,
  )
  const tickMax = Math.max(1, lastTick)
  const minMax = Math.max(
    1,
    completed_min ?? (segments.length > 0 ? segments[segments.length - 1].to_min : tickMax),
  )
  const xForTick = (t: number) => (Math.min(t, tickMax) / tickMax) * W
  const xForMin = (m: number) => (Math.min(m, minMax) / minMax) * W

  // ── y-axis: fit BOTH curves and BOTH thresholds (never hardcode 0–1) ───────
  const scoreValues = score_series.map((p: ScoreSeriesPoint) => p.score)
  for (const p of monotony_series) scoreValues.push(p.score)
  if (threshold != null) scoreValues.push(threshold)
  if (monotony_threshold != null) scoreValues.push(monotony_threshold)
  const rawMin = scoreValues.length > 0 ? Math.min(...scoreValues) : 0
  const rawMax = scoreValues.length > 0 ? Math.max(...scoreValues) : 1
  const pad = (rawMax - rawMin) * 0.1 || 0.1
  const yMin = rawMin - pad
  const yMax = rawMax + pad
  const yToPixel = (v: number) => CURVE_BOTTOM - ((v - yMin) / (yMax - yMin)) * (CURVE_BOTTOM - CURVE_TOP)

  const curvePoints = score_series.map((p) => `${xForTick(p.t).toFixed(1)},${yToPixel(p.score).toFixed(1)}`).join(' ')
  const monotonyPoints = monotony_series
    .map((p) => `${xForTick(p.t).toFixed(1)},${yToPixel(p.score).toFixed(1)}`)
    .join(' ')

  return (
    <div data-testid="instant-result-timeline" ref={containerRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
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
                <text x={(x1 + x2) / 2} y={BAND_MID + 3} fontSize="9" textAnchor="middle" fill="#1f2937">
                  {segLabel(seg.type)}
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

        {/* Monotony threshold line (hybrid only) — teal to match its curve */}
        {hasMonotony && monotony_threshold != null && (
          <g data-testid="instant-result-monotony-threshold">
            <line
              x1={0}
              x2={W}
              y1={yToPixel(monotony_threshold)}
              y2={yToPixel(monotony_threshold)}
              stroke={MONOTONY_COLOR}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text x={4} y={yToPixel(monotony_threshold) - 3} fontSize="8" textAnchor="start" fill={MONOTONY_COLOR}>
              monotony {formatNum(monotony_threshold)}
            </text>
          </g>
        )}

        {/* Score curve — rest-propose */}
        {score_series.length > 0 && (
          <polyline data-testid="instant-result-curve" points={curvePoints} fill="none" stroke={REST_COLOR} strokeWidth={2} />
        )}

        {/* Score curve — monotony-prevention (hybrid only) */}
        {hasMonotony && (
          <polyline
            data-testid="instant-result-monotony-curve"
            points={monotonyPoints}
            fill="none"
            stroke={MONOTONY_COLOR}
            strokeWidth={2}
          />
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

        {/* Anomaly-spike markers — a small pink caret at the top of the curve area
            at each Poisson spike, pointing down at the curve so the eye follows from
            the spike to where the rest-propose score steps up. Plotted by tick so it
            lands exactly under its score point. */}
        {spikes.length > 0 && (
          <g data-testid="instant-result-spike-marker">
            {spikes.map((s, i) => {
              const x = xForTick(s.t)
              return (
                <polygon
                  key={i}
                  data-testid="instant-result-spike"
                  points={`${(x - 3).toFixed(1)},${CURVE_TOP} ${(x + 3).toFixed(1)},${CURVE_TOP} ${x.toFixed(1)},${CURVE_TOP + 6}`}
                  fill={SPIKE_COLOR}
                />
              )
            })}
          </g>
        )}

        {/* Trigger markers — one vertical line per trigger episode, like the Review
            timeline. REST proposals are prominent solid red; MONOTONY reminders are
            secondary (thin amber) so the "take a rest" triggers stand out from the
            frequent monotony nudges on long monotonous routes. */}
        {fires.length > 0 && (
          <g data-testid="instant-result-fire-marker">
            {fires.map((f, i) => {
              const isRest = (f.category ?? '').startsWith('rest')
              return (
                <line
                  key={i}
                  data-testid={isRest ? 'instant-result-fire-line' : 'instant-result-monotony-fire-line'}
                  x1={xForMin(f.time_min)}
                  x2={xForMin(f.time_min)}
                  y1={CURVE_TOP}
                  y2={SEG_BOTTOM}
                  stroke={isRest ? TRIGGER_COLOR : MONOTONY_COLOR}
                  strokeWidth={isRest ? 2 : 1}
                  strokeDasharray={isRest ? undefined : '2 3'}
                  opacity={isRest ? 1 : 0.7}
                />
              )
            })}
          </g>
        )}

        {/* Auto-accepted rest stops — an orange dot on the road band per rest
            taken, positioned at its recovery time (matches the Review timeline). */}
        {restStops.length > 0 && (
          <g data-testid="instant-result-rest-spot-marker">
            {restStops.map((atMin, i) => (
              <circle
                key={i}
                data-testid="instant-result-rest-dot"
                cx={xForMin(atMin)}
                cy={BAND_MID}
                r={6}
                fill={REST_SPOT_COLOR}
                stroke="#fff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}

        {/* Recovery windows (kept for parity/tests) — a thin marker per rest. */}
        {restStops.length > 0 && (
          <g data-testid="instant-result-rest-option-marker">
            {restStops.map((atMin, i) => (
              <line
                key={i}
                x1={xForMin(atMin)}
                x2={xForMin(atMin)}
                y1={SEG_TOP}
                y2={SEG_BOTTOM}
                stroke="#7c3aed"
                strokeWidth={1.5}
              />
            ))}
          </g>
        )}

        {/* Route end — a thin gray line at completion. */}
        {completed_min != null && (
          <g data-testid="instant-result-completion-marker">
            <line
              x1={xForMin(completed_min)}
              x2={xForMin(completed_min)}
              y1={SEG_TOP}
              y2={SEG_BOTTOM}
              stroke="#9ca3af"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {/* Legend — score lines + the road-type bands ("highway / normal road"). */}
      <div
        data-testid="instant-result-legend"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 12px',
          fontSize: '0.72em',
          color: '#6b7280',
          margin: '2px 0 0',
        }}
      >
        <LegendLine color={REST_COLOR} label="rest-propose score" />
        {hasMonotony && <LegendLine color={MONOTONY_COLOR} label="monotony score" />}
        {spikes.length > 0 && <LegendSwatch color={SPIKE_COLOR} label="anomaly spike" />}
        {presentSegTypes.map((type) => (
          <LegendSwatch
            key={type}
            color={SEGMENT_COLORS[type] ?? DEFAULT_SEGMENT_COLOR}
            label={segLabel(type)}
          />
        ))}
      </div>

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

/** Legend entry for a score line (colored line + label). */
function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '16px', height: '2px', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

/** Legend entry for a road-type band (colored swatch + label). */
function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span
        style={{ width: '12px', height: '10px', background: color, display: 'inline-block', borderRadius: '2px' }}
      />
      {label}
    </span>
  )
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
