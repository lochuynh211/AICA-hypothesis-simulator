import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { routesAnalyze, listRoutePresets, loadRoutePreset } from '../../api/client'
import { MapsError } from '../../api/types'
import type { RouteAlternative, RouteNotice, RoutePresetSummary } from '../../api/types'
import { t } from '../../i18n/t'
import ErrorNotice from '../common/ErrorNotice'

/**
 * MapKeyAndRouteInput (T007 / M4) — BYO Maps API key + route input + alternative picker.
 *
 * - Key field: password-type input; value dispatched to SET_MAPS_KEY (in-memory only,
 *   never written to localStorage/sessionStorage/any persistence).
 * - Start/End: free-text fields for the Google Maps origin/destination.
 * - Analyze Route button: calls routesAnalyze with key + start + end when a scenario
 *   is selected; populates the store with the returned alternatives.
 * - Alternative picker: radio list showing summary, distance, and any notices.
 *   Selecting an alternative dispatches SELECT_ROUTE.
 * - 502 MapsError: surfaces the message and a "Use local route" button that clears
 *   the Maps error and falls back to the local path.
 */

const NOTICE_LABELS: Record<RouteNotice, { ja: string; en: string }> = {
  no_rest_stops_found: { ja: 'このルートには休憩ポイントが見つかりませんでした', en: 'No rest stops found on this route' },
  rest_data_degraded: { ja: '休憩ポイントデータが劣化しています（シナリオのフォールバックを使用）', en: 'Rest stop data is degraded (using scenario fallback)' },
  rest_data_unavailable: { ja: '休憩ポイントデータが利用できません', en: 'Rest stop data unavailable' },
}

const LABELS = {
  routeAnalysisFailed: { ja: 'ルート解析に失敗しました', en: 'Route analysis failed' },
  tryAgainOrLocalFallback: { ja: 'もう一度お試しいただくか、ローカルルートのフォールバックをご利用ください。', en: 'Try again or use the local route fallback.' },
  failedToLoadPreset: { ja: 'プリセットの読み込みに失敗しました', en: 'Failed to load preset' },
  tryAnotherPresetOrManual: { ja: '別のプリセットを試すか、手動でルートを入力してください。', en: 'Try another preset or use manual route input.' },
  presetRoutes: { ja: 'プリセットルート', en: 'Preset Routes' },
  selectPresetRoute: { ja: '— プリセットルートを選択 —', en: '— Select a preset route —' },
  loadingPreset: { ja: 'プリセットを読み込み中…', en: 'Loading preset…' },
  customRoute: { ja: 'カスタムルート', en: 'Custom Route' },
  mapsApiKey: { ja: 'Maps APIキー', en: 'Maps API Key' },
  enterMapsApiKey: { ja: 'Google Maps APIキーを入力してください', en: 'Enter Google Maps API key' },
  start: { ja: '出発地', en: 'Start' },
  egTokyoStation: { ja: '例: 東京駅', en: 'e.g. Tokyo Station' },
  end: { ja: '到着地', en: 'End' },
  egOsakaStation: { ja: '例: 大阪駅', en: 'e.g. Osaka Station' },
  analyzing: { ja: '解析中…', en: 'Analyzing…' },
  analyzeRoute: { ja: 'ルートを解析', en: 'Analyze Route' },
  useLocalRoute: { ja: 'ローカルルートを使用', en: 'Use local route' },
  selectARoute: { ja: 'ルートを選択:', en: 'Select a route:' },
}

export default function MapKeyAndRouteInput() {
  const { state, dispatch } = useRunStore()
  const {
    selectedScenarioId,
    mapsKey,
    mapsStart,
    mapsEnd,
    alternatives,
    selectedRouteId,
    mapsError,
    uiLanguage,
  } = state
  const lang = uiLanguage

  const [localKey, setLocalKey] = useState(mapsKey)
  const [analyzing, setAnalyzing] = useState(false)
  const [presets, setPresets] = useState<RoutePresetSummary[]>([])
  const [loadingPreset, setLoadingPreset] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)

  useEffect(() => {
    // Wrapped in Promise.resolve so a malformed/empty response (or a stubbed
    // client that returns nothing) degrades to "no presets" instead of throwing.
    Promise.resolve(listRoutePresets())
      .then(res => setPresets(res?.presets ?? []))
      .catch(() => {})
  }, [])

  // Sync the password field when the store's mapsKey is reset externally (e.g. RESET action).
  useEffect(() => {
    setLocalKey(mapsKey)
  }, [mapsKey])

  function handleKeyChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalKey(e.target.value)
    dispatch({ type: 'SET_MAPS_KEY', key: e.target.value })
  }

  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: e.target.value, end: mapsEnd })
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: mapsStart, end: e.target.value })
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    dispatch({ type: 'SET_MAPS_ERROR', error: null })
    try {
      const envelope = await routesAnalyze({
        // Route-first (feature 009): a scenario is no longer required to search.
        scenarioId: selectedScenarioId || undefined,
        mapsKey: mapsKey || undefined,
        start: mapsStart || undefined,
        end: mapsEnd || undefined,
      })
      dispatch({ type: 'SET_ALTERNATIVES', envelope })
      // Auto-select the first alternative so the route-first setup flow can
      // advance immediately; the radio list still lets reviewers switch.
      if (envelope.alternatives.length > 0) {
        dispatch({ type: 'SELECT_ROUTE', routeId: envelope.alternatives[0].route_id })
      }
    } catch (err: unknown) {
      if (err instanceof MapsError) {
        dispatch({ type: 'SET_MAPS_ERROR', error: err.body })
      } else {
        dispatch({
          type: 'SET_MAPS_ERROR',
          error: {
            error_type: 'UNKNOWN',
            message: err instanceof Error ? err.message : t(LABELS.routeAnalysisFailed, lang),
            suggestion: t(LABELS.tryAgainOrLocalFallback, lang),
          },
        })
      }
    } finally {
      setAnalyzing(false)
    }
  }

  function handleUseLocalRoute() {
    dispatch({ type: 'SET_MAPS_ERROR', error: null })
    // Clear key + inputs so the user can proceed with the local path via PlanPreview
    setLocalKey('')
    dispatch({ type: 'SET_MAPS_KEY', key: '' })
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: '', end: '' })
  }

  function handleSelectRoute(routeId: string) {
    dispatch({ type: 'SELECT_ROUTE', routeId })
  }

  async function handleLoadPreset(presetId: string) {
    setSelectedPresetId(presetId)
    setLoadingPreset(true)
    dispatch({ type: 'SET_MAPS_ERROR', error: null })
    try {
      const envelope = await loadRoutePreset(presetId)
      dispatch({ type: 'SET_ALTERNATIVES', envelope })
      if (envelope.alternatives.length === 1) {
        dispatch({ type: 'SELECT_ROUTE', routeId: envelope.alternatives[0].route_id })
      }
    } catch (err: unknown) {
      setSelectedPresetId(null)
      dispatch({
        type: 'SET_MAPS_ERROR',
        error: {
          error_type: 'PRESET_ERROR',
          message: err instanceof Error ? err.message : t(LABELS.failedToLoadPreset, lang),
          suggestion: t(LABELS.tryAnotherPresetOrManual, lang),
        },
      })
    } finally {
      setLoadingPreset(false)
    }
  }

  const manualDisabled = selectedPresetId !== null

  return (
    <div data-testid="map-key-route-input" style={{ marginBottom: '8px' }}>
      {/* Preset route selector */}
      {presets.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <label htmlFor="route-preset" style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '4px' }}>
            {t(LABELS.presetRoutes, lang)}
          </label>
          <select
            id="route-preset"
            value={selectedPresetId ?? ''}
            onChange={(e) => {
              const val = e.target.value
              if (val) {
                handleLoadPreset(val)
              } else {
                setSelectedPresetId(null)
              }
            }}
            disabled={loadingPreset}
            style={{ width: '100%', fontSize: '0.8em', padding: '6px' }}
          >
            <option value="">{t(LABELS.selectPresetRoute, lang)}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(preset.label, lang)} ({preset.distance_km} km, ~{preset.duration_min} min)
              </option>
            ))}
          </select>
          {loadingPreset && (
            <p style={{ fontSize: '0.75em', color: '#666', margin: '4px 0' }}>{t(LABELS.loadingPreset, lang)}</p>
          )}
        </div>
      )}

      {/* Manual / Customize route input */}
      <div style={{ opacity: manualDisabled ? 0.4 : 1, pointerEvents: manualDisabled ? 'none' : 'auto' }}>
        <p style={{ margin: '0 0 4px', fontSize: '0.8em', fontWeight: 'bold' }}>
          {t(LABELS.customRoute, lang)}
        </p>
        <div style={{ marginBottom: '4px' }}>
          <label htmlFor="maps-api-key" style={{ display: 'block', fontSize: '0.8em' }}>
            {t(LABELS.mapsApiKey, lang)}
          </label>
          <input
            id="maps-api-key"
            type="password"
            value={localKey}
            onChange={handleKeyChange}
            placeholder={t(LABELS.enterMapsApiKey, lang)}
            autoComplete="off"
            disabled={manualDisabled}
            style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
          />
        </div>

        <div style={{ marginBottom: '4px' }}>
          <label htmlFor="route-start" style={{ display: 'block', fontSize: '0.8em' }}>
            {t(LABELS.start, lang)}
          </label>
          <input
            id="route-start"
            type="text"
            value={mapsStart}
            onChange={handleStartChange}
            placeholder={t(LABELS.egTokyoStation, lang)}
            disabled={manualDisabled}
            style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
          />
        </div>

        <div style={{ marginBottom: '6px' }}>
          <label htmlFor="route-end" style={{ display: 'block', fontSize: '0.8em' }}>
            {t(LABELS.end, lang)}
          </label>
          <input
            id="route-end"
            type="text"
            value={mapsEnd}
            onChange={handleEndChange}
            placeholder={t(LABELS.egOsakaStation, lang)}
            disabled={manualDisabled}
            style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={analyzing || manualDisabled}
          style={{ width: '100%', padding: '6px', marginBottom: '6px' }}
        >
          {analyzing ? t(LABELS.analyzing, lang) : t(LABELS.analyzeRoute, lang)}
        </button>
      </div>

      {/* 502 Maps error */}
      {mapsError && (
        <ErrorNotice testid="maps-error" message={mapsError.message}>
          {mapsError.suggestion && (
            <p style={{ margin: '4px 0', fontSize: '0.9em', color: '#666' }}>{mapsError.suggestion}</p>
          )}
          <button onClick={handleUseLocalRoute} style={{ fontSize: '0.8em', padding: '4px 8px', marginTop: '4px' }}>
            {t(LABELS.useLocalRoute, lang)}
          </button>
        </ErrorNotice>
      )}

      {/* Alternatives list */}
      {alternatives.length > 1 && (
        <div data-testid="alternatives-list" style={{ marginTop: '6px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '0.75em', color: '#555' }}>
            {t(LABELS.selectARoute, lang)}
          </p>
          {alternatives.map((alt: RouteAlternative) => (
            <div
              key={alt.route_id}
              style={{
                border: selectedRouteId === alt.route_id ? '2px solid #2563eb' : '1px solid #ccc',
                borderRadius: '4px',
                padding: '6px',
                marginBottom: '4px',
                cursor: 'pointer',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="route-alternative"
                  value={alt.route_id}
                  checked={selectedRouteId === alt.route_id}
                  onChange={() => handleSelectRoute(alt.route_id)}
                  style={{ marginTop: '2px' }}
                />
                <span style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.85em' }}>{alt.summary}</strong>
                  {alt.route_facts.total_route_distance_km !== null && (
                    <span style={{ fontSize: '0.75em', color: '#666', marginLeft: '8px' }}>
                      {alt.route_facts.total_route_distance_km.toFixed(0)} km
                    </span>
                  )}
                  {alt.notices.length > 0 && (
                    <ul style={{ margin: '4px 0 0', padding: '0 0 0 16px', fontSize: '0.75em', color: '#92400e' }}>
                      {alt.notices.map((n) => (
                        <li key={n}>{NOTICE_LABELS[n] ? t(NOTICE_LABELS[n], lang) : n}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
