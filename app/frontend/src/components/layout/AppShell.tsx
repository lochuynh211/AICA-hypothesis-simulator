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
import SetupScreen from '../screens/SetupScreen'
import RunsScreen from '../screens/RunsScreen'
import LeftContextPanel from './LeftContextPanel'
import CenterPlaybackPanel from './CenterPlaybackPanel'
import RightReviewPanel from './RightReviewPanel'

type Props = {
  /** Health status string from the backend — shown in the header when available. */
  healthStatus?: string
}

export default function AppShell({ healthStatus }: Props) {
  const { state, dispatch } = useRunStore()
  const { viewMode } = state

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
            {/* ← New run / Setup affordance — clears run state and returns to Setup */}
            <div
              style={{
                padding: '4px 12px',
                background: '#f8fafc',
                borderBottom: '1px solid #e5e7eb',
                flexShrink: 0,
              }}
            >
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
