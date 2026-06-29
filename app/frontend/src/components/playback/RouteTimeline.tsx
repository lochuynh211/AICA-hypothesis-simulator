import { useRouteProgress } from './useRouteProgress'
import { useSmoothFraction } from './useSmoothFraction'
import type { ReplayTick } from '../../replay/replaySource'
import { useRunStore } from '../../state/runStore'

/**
 * RouteTimeline — animated progress track (FR-016 display-only).
 *
 * A growing blue fill, segment divider ticks, start / chosen-rest-spot / fire markers, and a
 * car icon that glides between tick positions via useSmoothFraction. The car
 * aria-label always reports the EXACT evaluated route_fraction (not the eased
 * display value) so it matches the evidence log; only the on-screen position is
 * smoothed. No store writes — animation is purely visual.
 */
export default function RouteTimeline({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const progress = useRouteProgress()
  const { state } = useRunStore()
  // Persistent gold markers for every accepted rest — sourced from restHistory
  // (captured at accept time) so they survive after recovery ends, instead of
  // the transient recovery.rest_spot which clears the moment the driver resumes.
  const restSpots = state.restHistory.map((r) => r.spot)

  // Target fraction: recorded value in replay, else the live evaluated tick.
  const targetFraction = replayTick != null ? replayTick.route_fraction : progress.currentFraction
  const shown = useSmoothFraction(targetFraction)

  // Replay proposal marker: only when the recorded decision fired a proposal.
  const replayProposalFraction =
    replayTick != null &&
    replayTick.decision.fire_control.fired &&
    replayTick.decision.proposal != null
      ? replayTick.route_fraction
      : null

  const proposalFraction = replayTick != null ? replayProposalFraction : progress.proposalFraction
  const boundaries = replayTick != null ? [] : progress.boundaries

  const targetPct = Math.round(targetFraction * 100)
  const shownPct = shown * 100

  return (
    <div data-testid="route-timeline" style={{ position: 'relative', height: '40px', margin: '12px 0' }}>
      {/* Track */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          transform: 'translateY(-50%)',
          height: '14px',
          background: '#e2e8f0',
          borderRadius: '7px',
          overflow: 'hidden',
        }}
      >
        {/* Growing fill */}
        <div
          data-testid="progress-fill"
          style={{
            height: '100%',
            width: `${shownPct}%`,
            background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
            transition: 'width 0.12s linear',
          }}
        />
      </div>

      {/* Segment divider ticks */}
      {boundaries.map((at, i) =>
        at > 0 && at < 1 ? (
          <div
            key={`seg-${i}`}
            style={{
              position: 'absolute',
              top: '50%',
              left: `${at * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '2px',
              height: '14px',
              background: '#fff',
              opacity: 0.8,
            }}
          />
        ) : null,
      )}

      {/* Start marker */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '0%',
          transform: 'translate(-50%, -50%)',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: '#fff',
          border: '2px solid #94a3b8',
        }}
        aria-hidden
      />

      {/* Chosen rest-spot markers (gold) — one per accepted rest; persist as history */}
      {restSpots.map((spot, i) => (
        <div
          key={`rest-${i}-${spot.id}`}
          data-testid="progress-rest-spot-marker"
          aria-label={`Chosen rest spot: ${spot.label?.en ?? spot.id}`}
          style={{
            position: 'absolute',
            top: '50%',
            left: `${Math.round(spot.route_fraction * 100)}%`,
            transform: 'translate(-50%, -50%)',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: '#f0c000',
            border: '2px solid #fff',
          }}
        />
      ))}

      {/* Fire / proposal marker */}
      {proposalFraction !== null && (
        <div
          data-testid="fire-marker"
          aria-label="Proposal position"
          style={{
            position: 'absolute',
            top: '0',
            left: `${Math.round(proposalFraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '4px',
            height: '100%',
            background: '#dc2626',
          }}
        />
      )}

      {/* Car icon — smoothed position, exact aria-label */}
      <div
        data-testid="car-marker"
        aria-label={`Route position: ${targetPct}%`}
        style={{
          position: 'absolute',
          top: '50%',
          left: `${shownPct}%`,
          transform: 'translate(-50%, -50%) scaleX(-1)',
          fontSize: '20px',
          transition: 'left 0.12s linear',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
          zIndex: 5,
        }}
      >
        🚗
      </div>
    </div>
  )
}
