import { useRunStore } from '../../state/runStore'
import PlaybackControls from '../playback/PlaybackControls'
import RouteTimeline from '../playback/RouteTimeline'
import MapSurface from '../map/MapSurface'
import CockpitView from '../playback/CockpitView'

/**
 * CenterPlaybackPanel — the middle column in the 3-panel layout.
 *
 * M4: route surface selection.
 * - When the selected route alternative has display data (Google Maps path),
 *   render MapSurface (real geographic polyline + DOM overlay markers).
 * - Otherwise render RouteTimeline (deterministic local progress bar).
 */
export default function CenterPlaybackPanel() {
  const { state } = useRunStore()
  const { alternatives, selectedRouteId } = state

  const selectedAlt = alternatives.find((a) => a.route_id === selectedRouteId) ?? null
  const useMapsView = selectedAlt?.display != null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      <PlaybackControls />
      {useMapsView ? <MapSurface /> : <RouteTimeline />}
      <div style={{ flex: 1 }}>
        <CockpitView />
      </div>
    </div>
  )
}
