import { useCallback, useEffect, useRef, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { tickRun } from '../../api/client'

type Speed = 1 | 2 | 4

export default function PlaybackControls() {
  const { state, dispatch } = useRunStore()
  const { runState, paused, completed } = state

  const [speed, setSpeed] = useState<Speed>(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const doTickRef = useRef<(() => Promise<void>) | null>(null)

  const doTick = useCallback(async () => {
    if (!runState) return
    const resp = await tickRun(runState.run_id)
    if ('error' in resp) {
      dispatch({
        type: 'ALGORITHM_ERROR_APPENDED',
        runState: resp.run_state,
        error: resp.error,
        paused: resp.paused,
      })
      // Stop playing when a blocking error halts the run (resp.paused === true).
      // For non_blocking errors the run continues and playback is uninterrupted.
      if (resp.paused) {
        setIsPlaying(false)
      }
    } else if (resp.decision !== null && resp.tick_index !== null) {
      // Normal evaluated tick: use resp.tick_index (pre-increment) so the
      // live trace label matches the persisted TickEvent.tick_index in the log.
      dispatch({
        type: 'TICK_APPENDED',
        runState: resp.run_state,
        decision: resp.decision,
        tickIndex: resp.tick_index,
        paused: resp.paused,
        completed: resp.completed,
        routeFraction: resp.route_fraction ?? null,
      })
      // A proposal pause is a temporary halt awaiting the driver's choice — keep
      // isPlaying so the interval (which is gated on `!paused`) auto-resumes once
      // the action clears `paused`. Only completion is terminal.
      if (resp.completed) {
        setIsPlaying(false)
      }
    } else {
      // Completed no-op (decision: null, tick_index: null) — just stop playing.
      if (resp.completed) {
        setIsPlaying(false)
      }
    }
  }, [runState, dispatch])

  // Keep ref in sync so interval can call the latest version
  useEffect(() => {
    doTickRef.current = doTick
  }, [doTick])

  // Stop playing on completion only. A proposal pause keeps isPlaying so the run
  // auto-resumes once the driver picks an option (paused → false).
  useEffect(() => {
    if (completed) {
      setIsPlaying(false)
    }
  }, [completed])

  // Manage interval
  useEffect(() => {
    if (isPlaying && runState && !paused && !completed) {
      intervalRef.current = setInterval(() => {
        doTickRef.current?.()
      }, 1000 / speed)
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isPlaying, speed, runState, paused, completed])

  const disabled = !runState || completed

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px' }}>
      {!isPlaying ? (
        <button
          disabled={disabled || paused}
          onClick={() => setIsPlaying(true)}
        >
          Play
        </button>
      ) : (
        <button
          disabled={disabled}
          onClick={() => setIsPlaying(false)}
        >
          Pause
        </button>
      )}
      <button
        disabled={disabled || isPlaying || paused}
        onClick={() => doTick()}
      >
        Step
      </button>
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        aria-label="Playback speed"
      >
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
    </div>
  )
}
