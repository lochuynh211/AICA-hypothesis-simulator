import PlaybackControls from '../playback/PlaybackControls'
import RouteTimeline from '../playback/RouteTimeline'
import CockpitView from '../playback/CockpitView'

export default function CenterPlaybackPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      <PlaybackControls />
      <RouteTimeline />
      <div style={{ flex: 1 }}>
        <CockpitView />
      </div>
    </div>
  )
}
