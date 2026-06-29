import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import PlaybackControls from '../playback/PlaybackControls'
import RouteTimeline from '../playback/RouteTimeline'
import StateCards from '../playback/StateCards'
import MapSurface from '../map/MapSurface'
import MusicOverlay from '../playback/MusicOverlay'
import CockpitView from '../playback/CockpitView'
import RecoveryPicker from '../playback/RecoveryPicker'
import RecoveryVisualization from '../playback/RecoveryVisualization'
import MotionBadge from '../playback/MotionBadge'
import { getScenario } from '../../api/client'

/**
 * CenterPlaybackPanel — the wide cockpit column (2fr in the 1:2:1 layout).
 *
 * Top-to-bottom:
 *   - PlaybackControls + MotionBadge  — play/pause/speed + vehicle motion state
 *   - RouteTimeline                   — progress track (car + fire marker)
 *   - StateCards                      — in-car status + driving environment
 *   - Cockpit surface                 — big Google Map (when a maps route is selected)
 *     with layered overlays:
 *       · MusicOverlay          — now-playing at rest
 *       · RecoveryVisualization — karaoke / sleep / wakefulness during active recovery
 *       · RecoveryPicker        — option + rest-spot selector (M7 scenarios only, paused on proposal)
 *       · CockpitView           — fallback proposal overlay (non-M7 / no recovery_options)
 *     Falls back to CockpitView inline when no map route is selected.
 *
 * Back-compat guarantee: RecoveryPicker is shown ONLY when the selected scenario
 * has `recovery_options` (fetched once per scenario selection).  When there are
 * no recovery_options (pre-M7 scenarios) the existing CockpitView/ProposalPanel
 * proposal overlay continues to render, preserving all pre-M7 test behaviour.
 */
export default function CenterPlaybackPanel() {
  const { state } = useRunStore()
  const { alternatives, selectedRouteId, paused, latestDecision, runState, selectedScenarioId } =
    state

  // ── Gate: does the selected scenario have recovery_options? ─────────────────
  // Fetched once per scenario selection. Stays false (→ CockpitView back-compat)
  // when selectedScenarioId is null or the scenario has no recovery_options.
  const [hasRecoveryOptions, setHasRecoveryOptions] = useState(false)

  useEffect(() => {
    if (!selectedScenarioId) {
      setHasRecoveryOptions(false)
      return
    }
    let cancelled = false
    getScenario(selectedScenarioId)
      .then((s) => {
        if (!cancelled) setHasRecoveryOptions((s.recovery_options?.length ?? 0) > 0)
      })
      .catch(() => {
        if (!cancelled) setHasRecoveryOptions(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedScenarioId])

  const selectedAlt = alternatives.find((a) => a.route_id === selectedRouteId) ?? null
  const useMapsView = selectedAlt?.display != null
  // Show proposal UI only when paused on an active REST_PROPOSAL.
  const showProposal = Boolean(paused && latestDecision?.proposal)
  // Show recovery visualization only when recovery is actively running.
  const recoveryActive = Boolean(runState?.recovery?.active)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '12px',
        minHeight: 0,
      }}
    >
      {/* Controls row: playback buttons + motion state badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <PlaybackControls />
        </div>
        <MotionBadge />
      </div>

      <RouteTimeline />
      <StateCards />

      {/* Cockpit surface — map (when available) with layered overlays. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {useMapsView && <MapSurface />}
        <MusicOverlay />

        {/* Recovery visualization: overlays the map/surface during an active rest stop. */}
        {recoveryActive && <RecoveryVisualization />}

        {/* Map view: proposal overlay pinned to map bottom.
            RecoveryPicker for M7 scenarios; CockpitView/ProposalPanel for back-compat. */}
        {showProposal && useMapsView && (
          <div
            style={{
              position: 'absolute',
              left: '8px',
              right: '8px',
              bottom: '8px',
              zIndex: 15,
            }}
          >
            {hasRecoveryOptions ? <RecoveryPicker /> : <CockpitView />}
          </div>
        )}

        {/* No map (local fallback): RecoveryPicker for M7 scenarios on proposal;
            CockpitView for back-compat (nav-view or ProposalPanel). */}
        {!useMapsView && (showProposal && hasRecoveryOptions ? <RecoveryPicker /> : <CockpitView />)}
      </div>
    </div>
  )
}
