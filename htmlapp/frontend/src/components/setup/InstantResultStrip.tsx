import { useEffect, useMemo, useState } from 'react'
import { useRunStore, selectOverridesDiff } from '../../state/runStore'
import { getPackage, routesAnalyze, createRunPlan, createRun } from '../../api/client'
import type { InstantResult, PackageManifest, RouteFacts, DisplayRoute } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice'
import ScoreTimeline, { type ScoreTimelineTestIds, segLabel } from '../playback/ScoreTimeline'
import { instantResultToTimeline } from '../playback/timelineData'
import { t, type UiLanguage } from '../../i18n/t'

const LABELS = {
  openFullRunFailed: { en: 'Failed to open full run', ja: 'フル実行を開けませんでした' },
  triggerFallback: { en: 'TRIGGER', ja: 'トリガー' },
}

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
 *   - The timeline itself is the shared `ScoreTimeline` component (also used
 *     by the Review screen's RouteTimeline) — no duplicated SVG drawing code
 *     here. `instantResultToTimeline()` (components/playback/timelineData.ts)
 *     normalizes an `InstantResult` (whole-run, tick/minute domains, a raw
 *     0–1 or points-scale score axis) into the resolution-independent
 *     `TimelineData` shape ScoreTimeline consumes; see that module's doc
 *     comment for the tick-vs-minute and y-axis normalization details this
 *     strip used to do inline. This component owns only: the testid mapping
 *     (`STRIP_TEST_IDS`, preserving every legacy `instant-result-*` testid),
 *     the threshold text labels, the legend, the error notice, and the
 *     "Fired: …" result line.
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
    uiLanguage,
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
      setOpenRunError(err instanceof Error ? err.message : t(LABELS.openFullRunFailed, uiLanguage))
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
            {t({ en: 'Instant Result', ja: '即時結果' }, uiLanguage)}
          </strong>
          <span data-testid="instant-result-seed-chip">
            {t({ en: 'seed', ja: 'シード' }, uiLanguage)} {runSeed}{' '}
            <button
              type="button"
              data-testid="instant-result-reroll"
              aria-label={t({ en: 'Re-roll seed', ja: 'シード再生成' }, uiLanguage)}
              onClick={handleReroll}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1em' }}
            >
              🎲
            </button>
          </span>
          <span data-testid="instant-result-overrides-chip">
            {t(
              {
                en: `${overridesDiff.length} override${overridesDiff.length === 1 ? '' : 's'}`,
                ja: `${overridesDiff.length} 件の変更`,
              },
              uiLanguage,
            )}
          </span>
        </div>
        <button
          type="button"
          data-testid="instant-result-open-full-run"
          onClick={handleOpenFullRun}
          disabled={!canOpenFullRun}
          style={{ padding: '4px 10px', fontSize: '0.9em' }}
        >
          {openRunLoading
            ? t({ en: 'Opening…', ja: '開いています…' }, uiLanguage)
            : t({ en: '▸ Open full run', ja: '▸ フル実行を開く' }, uiLanguage)}
        </button>
      </div>

      {openRunError && <ErrorNotice testid="instant-result-open-run-error" message={openRunError} />}

      {previewLoading && (
        <div data-testid="instant-result-loading" style={{ fontSize: '0.85em', color: '#6b7280', padding: '8px 0' }}>
          {t({ en: 'Computing preview…', ja: 'プレビューを計算中…' }, uiLanguage)}
        </div>
      )}

      {!previewLoading && previewError && (
        <ErrorNotice testid="instant-result-preview-error" message={previewError} />
      )}

      {!previewLoading && !previewError && instantResult && (
        <InstantResultTimeline result={instantResult} lang={uiLanguage} />
      )}

      {!previewLoading && !previewError && !instantResult && (
        <div data-testid="instant-result-empty" style={{ fontSize: '0.85em', color: '#9ca3af', padding: '8px 0' }}>
          {t({ en: 'Select a package and scenario to see a preview.', ja: 'パッケージとシナリオを選択するとプレビューが表示されます。' }, uiLanguage)}
        </div>
      )}
    </div>
  )
}

// ── Timeline rendering (shared ScoreTimeline component) ─────────────────────

// Road-band colors — the saturated road classes (highway / normal / mountain /
// scenic) match the Review-screen map (components/map/MapSurface.tsx ROAD_COLORS)
// so the same road reads the same color in both places; non-road bands stay neutral.
// (Kept here only for the legend swatches — ScoreTimeline owns the drawing colors.)
// Copied verbatim from MapSurface ROAD_COLORS (see ScoreTimeline) so band + legend
// colors read identically to the Google map.
const SEGMENT_COLORS: Record<string, string> = {
  highway: '#06b6d4', // cyan
  normal_road: '#2563eb', // blue
  mountain_road: '#f59e0b', // orange
  sightseeing_road: '#22c55e', // green
  urban: '#22c55e', // green (scenario route_intent type)
  national: '#38bdf8',
  residential: '#e5e7eb',
  rest: '#c4b5fd',
}
// start / end are route endpoints, not road classes — no legend entry.
const HIDDEN_SEGMENT_TYPES = new Set(['start', 'end'])
const DEFAULT_SEGMENT_COLOR = '#f3f4f6'
// Anomaly-spike marker — a small pink caret at the top of the curve area. Pink
// keeps it distinct from the red rest-trigger line, teal monotony, and the amber
// rest-spot dot, so a reviewer can point at a spike and see the curve step up.
const SPIKE_COLOR = '#db2777'

// Road-band labels are shared with the Review timeline via ScoreTimeline.segLabel
// (bilingual), so preview + review read identically in both languages.

// Score-curve colors — rest-propose (blue) vs monotony-prevention (teal). Chosen
// to stay distinct from the red threshold and the pale amber/orange road bands.
// (Legend swatches only — ScoreTimeline draws the actual curves.)
const REST_COLOR = '#2563eb'
const MONOTONY_COLOR = '#0d9488'

// Maps every `instant-result-*` testid the strip's tests assert onto the
// generic ScoreTimelineTestIds contract, so the shared component renders
// under the SAME testids the strip always has (dedup, not a rename).
const STRIP_TEST_IDS: ScoreTimelineTestIds = {
  svg: 'instant-result-svg',
  curve: 'instant-result-curve',
  monotonyCurve: 'instant-result-monotony-curve',
  threshold: 'instant-result-threshold',
  monotonyThreshold: 'instant-result-monotony-threshold',
  fireGroup: 'instant-result-fire-marker',
  fire: 'instant-result-fire-line',
  monotonyFire: 'instant-result-monotony-fire-line',
  spikeGroup: 'instant-result-spike-marker',
  spike: 'instant-result-spike',
  restSpotGroup: 'instant-result-rest-spot-marker',
  restDot: 'instant-result-rest-dot',
  restOptionGroup: 'instant-result-rest-option-marker',
  recoveryWindow: 'instant-result-recovery-window',
  completion: 'instant-result-completion-marker',
  segment: (i) => `instant-result-segment-${i}`,
}

function InstantResultTimeline({ result, lang }: { result: InstantResult; lang: UiLanguage }) {
  const { segments, threshold, error } = result
  // Second (monotony) curve — present only for the hybrid; NRI leaves it empty.
  const monotony_series = result.monotony_series ?? []
  const monotony_threshold = result.monotony_threshold ?? null
  const hasMonotony = monotony_series.length > 0
  // Anomaly spikes — empty for algorithms/scenarios without an anomaly signal.
  const spikes = result.spikes ?? []

  // Distinct road-band types actually present, in first-appearance order — the
  // legend is built from THIS (not a hardcoded highway/normal-road pair), so it
  // always matches the bands drawn for the current route.
  const presentSegTypes = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const s of segments) {
      if (s.type && !HIDDEN_SEGMENT_TYPES.has(s.type) && !seen.has(s.type)) {
        seen.add(s.type)
        order.push(s.type)
      }
    }
    return order
  }, [segments])

  const timeline = useMemo(() => instantResultToTimeline(result), [result])

  return (
    <div data-testid="instant-result-timeline">
      <ScoreTimeline
        data={timeline}
        revealFraction={1}
        ghostAhead={false}
        animated={false}
        showPlayhead={false}
        height={92}
        testIds={STRIP_TEST_IDS}
        lang={lang}
        thresholdLabel={
          threshold != null
            ? t({ en: `threshold ${formatNum(threshold)}`, ja: `しきい値 ${formatNum(threshold)}` }, lang)
            : undefined
        }
        monotonyThresholdLabel={
          hasMonotony && monotony_threshold != null
            ? t({ en: `monotony ${formatNum(monotony_threshold)}`, ja: `単調性 ${formatNum(monotony_threshold)}` }, lang)
            : undefined
        }
      />

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
        <LegendLine color={REST_COLOR} label={t({ en: 'rest-propose score', ja: '休憩提案スコア' }, lang)} />
        {hasMonotony && <LegendLine color={MONOTONY_COLOR} label={t({ en: 'monotony score', ja: '単調性スコア' }, lang)} />}
        {spikes.length > 0 && <LegendSwatch color={SPIKE_COLOR} label={t({ en: 'anomaly spike', ja: '異常スパイク' }, lang)} />}
        {presentSegTypes.map((type) => (
          <LegendSwatch
            key={type}
            color={SEGMENT_COLORS[type] ?? DEFAULT_SEGMENT_COLOR}
            label={segLabel(type, lang)}
          />
        ))}
      </div>

      {error && (
        <ErrorNotice
          testid="instant-result-error"
          message={t(
            {
              en: `Algorithm error @ tick ${error.tick_index} (${error.error_type}): ${error.message}`,
              ja: `アルゴリズムエラー @ tick ${error.tick_index}（${error.error_type}）: ${error.message}`,
            },
            lang,
          )}
        />
      )}

      <p data-testid="instant-result-line" style={{ fontSize: '0.85em', color: '#374151', margin: '4px 0 0' }}>
        {buildResultLine(result, lang)}
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
function buildResultLine(result: InstantResult, lang: UiLanguage): string {
  const { fired, fire, peak_score, threshold, rest_option, completed_min, error } = result

  if (error) {
    return t(
      {
        en: `Preview halted by an algorithm error (${error.error_type}) — no result to report.`,
        ja: `アルゴリズムエラーによりプレビューが中断されました（${error.error_type}）— 結果はありません。`,
      },
      lang,
    )
  }

  if (!fired || !fire) {
    const thresholdText = threshold != null ? formatNum(threshold) : '—'
    return t(
      {
        en: `No trigger — peak ${formatNum(peak_score)} (threshold ${thresholdText})`,
        ja: `発火なし — ピーク ${formatNum(peak_score)}（しきい値 ${thresholdText}）`,
      },
      lang,
    )
  }

  const category = fire.category ? fire.category.split('_')[0].toUpperCase() : t(LABELS.triggerFallback, lang)
  const strength = fire.strength ? ` · ${fire.strength}` : ''
  const restPart = rest_option ? ` · auto-rest ${rest_option.id}` : ''
  const donePart = completed_min != null ? ` · done ${Math.round(completed_min)} min` : ''
  const restPartJa = rest_option ? ` · 自動休憩 ${rest_option.id}` : ''
  const donePartJa = completed_min != null ? ` · 完了 ${Math.round(completed_min)}分` : ''
  return t(
    {
      en: `Fired: ${category}${strength} @ ${Math.round(fire.time_min)} min · peak ${formatNum(peak_score)}${restPart}${donePart}`,
      ja: `発火: ${category}${strength} @ ${Math.round(fire.time_min)}分 · ピーク ${formatNum(peak_score)}${restPartJa}${donePartJa}`,
    },
    lang,
  )
}
