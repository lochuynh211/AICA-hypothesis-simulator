import { useRunStore } from '../../state/runStore'
import PlaybackControls from '../playback/PlaybackControls'
import RouteTimeline from '../playback/RouteTimeline'
import StateCards from '../playback/StateCards'
import MapSurface from '../map/MapSurface'
import MusicOverlay from '../playback/MusicOverlay'
import CockpitView from '../playback/CockpitView'

/**
 * CenterPlaybackPanel — the wide cockpit column (2fr in the 1:2:1 layout).
 *
 * Top-to-bottom:
 *   - PlaybackControls           — play/pause/speed
 *   - RouteTimeline              — progress track (car + fire marker)
 *   - StateCards                 — in-car status + driving environment
 *   - Cockpit surface            — big Google Map (when a maps route is selected)
 *     with on-map overlays: MusicOverlay (now-playing at rest) and the
 *     proposal/nav cockpit (CockpitView) pinned to the map bottom so AICA's
 *     proposal + option buttons appear over the map. Falls back to the cockpit
 *     nav view in flow when no map route is selected (deterministic local path).
 */
export default function CenterPlaybackPanel() {
  const { state } = useRunStore()
  const { alternatives, selectedRouteId, paused, latestDecision } = state

  const selectedAlt = alternatives.find((a) => a.route_id === selectedRouteId) ?? null
  const useMapsView = selectedAlt?.display != null
  // Only the proposal cockpit overlays the map — no standalone "navigation view".
  const showProposal = Boolean(paused && latestDecision?.proposal)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', minHeight: 0 }}>
      <PlaybackControls />
      <RouteTimeline />
      <StateCards />

      {/* Cockpit surface — map (when available) with layered overlays. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {useMapsView && <MapSurface />}
        <MusicOverlay />

        {/* Proposal overlay (option buttons) pinned to the map bottom — only when a
            proposal is awaiting a choice. The redundant "navigation view" is gone. */}
        {showProposal && (
          <div style={{ position: 'absolute', left: '8px', right: '8px', bottom: '8px', zIndex: 15 }}>
            <CockpitView />
          </div>
        )}

        {/* No map (local fallback): show the cockpit decision view inline. */}
        {!useMapsView && <CockpitView />}
      </div>
    </div>
  )
}
