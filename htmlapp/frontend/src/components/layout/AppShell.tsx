/**
 * AppShell — top-level application shell (M6 three-view restructure, T003).
 *
 * Reads `viewMode` from the store and renders the matching screen:
 *   'setup'  → SetupScreen  (setup editors; default)
 *   'review' → 3-panel Review layout (left context / center playback / right trace+feedback)
 *   'runs'   → RunsScreen   (placeholder; RunList + replay added by a later unit)
 *
 * A persistent header nav (Setup / Review / Runs) allows free navigation; the
 * "← New run / Setup" affordance in the Review bar dispatches RESET (clears run
 * and returns to Setup) rather than just SET_VIEW_MODE.
 *
 * NO router dependency — viewMode is a plain store field.
 */

import { useRunStore } from '../../state/runStore'
import { createRun } from '../../api/client'
import SetupScreen from '../screens/SetupScreen'
import RunsScreen from '../screens/RunsScreen'
import LeftContextPanel from './LeftContextPanel'
import CenterPlaybackPanel from './CenterPlaybackPanel'
import RightReviewPanel from './RightReviewPanel'
import ErrorNotice from '../common/ErrorNotice'

type Props = {
  /** Health status string from the backend — shown in the header when available. */
  healthStatus?: string
}

export default function AppShell({ healthStatus }: Props) {
  const { state, dispatch } = useRunStore()
  const { viewMode, planId, runError } = state

  /** Restart — re-run the current frozen plan from tick 0 (session-scoped).
   *  Requires a planId from PLAN_DRAFTED; unavailable if no plan has been drafted.
   *  Does NOT return to Setup — stays on Review with a fresh run. */
  async function handleRestart() {
    if (!planId) return
    dispatch({ type: 'SET_RUN_ERROR', message: null })
    try {
      const rs = await createRun(planId)
      dispatch({ type: 'RUN_CREATED', runState: rs })
    } catch (e) {
      dispatch({ type: 'SET_RUN_ERROR', message: e instanceof Error ? e.message : 'Restart failed' })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ── Persistent header nav ─────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          background: '#1a1a2e',
          borderBottom: '1px solid #2a2a4a',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <nav style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'setup' })}
            aria-current={viewMode === 'setup' ? 'page' : undefined}
            style={{
              padding: '4px 14px',
              fontSize: '0.82em',
              fontWeight: viewMode === 'setup' ? 700 : 400,
              background: viewMode === 'setup' ? '#2563eb' : 'transparent',
              color: viewMode === 'setup' ? '#fff' : '#94a3b8',
              border: viewMode === 'setup' ? '1px solid #1d4ed8' : '1px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Setup
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'review' })}
            aria-current={viewMode === 'review' ? 'page' : undefined}
            style={{
              padding: '4px 14px',
              fontSize: '0.82em',
              fontWeight: viewMode === 'review' ? 700 : 400,
              background: viewMode === 'review' ? '#2563eb' : 'transparent',
              color: viewMode === 'review' ? '#fff' : '#94a3b8',
              border: viewMode === 'review' ? '1px solid #1d4ed8' : '1px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Review
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'runs' })}
            aria-current={viewMode === 'runs' ? 'page' : undefined}
            style={{
              padding: '4px 14px',
              fontSize: '0.82em',
              fontWeight: viewMode === 'runs' ? 700 : 400,
              background: viewMode === 'runs' ? '#2563eb' : 'transparent',
              color: viewMode === 'runs' ? '#fff' : '#94a3b8',
              border: viewMode === 'runs' ? '1px solid #1d4ed8' : '1px solid transparent',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Runs
          </button>
        </nav>

        {healthStatus && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.72em',
              color: '#64748b',
              fontFamily: 'monospace',
            }}
          >
            {healthStatus}
          </span>
        )}
      </header>

      {/* ── View content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {viewMode === 'setup' && <SetupScreen />}

        {viewMode === 'review' && (
          <div
            data-testid="review-screen"
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            {/* Review affordance bar — Reset + Restart controls */}
            <div
              style={{
                padding: '4px 12px',
                background: '#f8fafc',
                borderBottom: '1px solid #e5e7eb',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* RESET — clears run state and returns to Setup */}
              <button
                onClick={() => dispatch({ type: 'RESET' })}
                style={{
                  fontSize: '0.78em',
                  padding: '3px 10px',
                  background: 'transparent',
                  border: '1px solid #d0d5dd',
                  color: '#374151',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ← New run / Setup
              </button>

              {/* Restart — re-runs the current frozen plan from tick 0 (session-scoped).
                  Disabled when no planId is set (nothing to restart from). */}
              <button
                data-testid="restart-run-btn"
                onClick={handleRestart}
                disabled={!planId}
                title={planId ? `Restart from plan ${planId}` : 'No plan to restart from'}
                style={{
                  fontSize: '0.78em',
                  padding: '3px 10px',
                  background: planId ? '#2563eb' : 'transparent',
                  border: planId ? '1px solid #1d4ed8' : '1px solid #d0d5dd',
                  color: planId ? '#fff' : '#9ca3af',
                  borderRadius: '4px',
                  cursor: planId ? 'pointer' : 'not-allowed',
                  opacity: planId ? 1 : 0.6,
                }}
              >
                ↺ Restart
              </button>

              {/* Inline restart error — shown in the affordance bar so it is visible
                  on the Review screen. runError is also rendered in PlanPreview (Setup
                  screen) but would be invisible to the user here without this surface. */}
              {runError && (
                <ErrorNotice testid="restart-error" message={runError} />
              )}
            </div>

            {/* 3-panel grid — left: context only; center: playback; right: trace+feedback */}
            <div className="app-shell" style={{ flex: 1, minHeight: 0 }}>
              <div className="left-panel">
                <LeftContextPanel />
              </div>
              <div className="center-panel">
                <CenterPlaybackPanel />
              </div>
              <div className="right-panel">
                <RightReviewPanel />
              </div>
            </div>
          </div>
        )}

        {viewMode === 'runs' && <RunsScreen />}
      </div>
    </div>
  )
}
