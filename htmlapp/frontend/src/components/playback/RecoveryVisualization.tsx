/**
 * RecoveryVisualization — in-car entertainment overlay during UC-01 rest recovery.
 *
 * Reads `recovery_phase` and `motion_state` from the latest trace entry in the
 * store and renders the appropriate visual, or null when recovery is not in a
 * recognised display state.
 *
 * Phase + motion → visual:
 *   nap        + STOPPED → recovery-sleep      (dim overlay + 🌙 + floating Z's)
 *   content    + STOPPED → recovery-karaoke    (EQ bars + scrolling lyrics)
 *   wakefulness + MOVING  → recovery-wakefulness (♪ audio badge, no lyrics)
 *   otherwise             → null
 *
 * Lightweight CSS/SVG only — no audio engine, no media dependencies, no new npm deps.
 */

import { useRunStore } from '../../state/runStore'

export default function RecoveryVisualization() {
  const { state } = useRunStore()
  const { trace } = state

  const latest = trace[trace.length - 1]
  const phase = latest?.recovery_phase ?? null
  const motionState = latest?.motion_state ?? null

  // ── Nap: dim sleep overlay ─────────────────────────────────────────────────
  if (phase === 'nap' && motionState === 'STOPPED') {
    return (
      <div
        data-testid="recovery-sleep"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(8, 8, 24, 0.88)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#c8d8ff',
          zIndex: 25,
        }}
      >
        <div style={{ fontSize: '3em', marginBottom: '16px' }}>🌙</div>
        <div style={{ display: 'flex', gap: '14px', fontSize: '1.6em', letterSpacing: '0.2em' }}>
          <span style={{ animation: 'rvFloatZ 2.4s ease-in-out 0s infinite' }}>Z</span>
          <span style={{ animation: 'rvFloatZ 2.4s ease-in-out 0.5s infinite' }}>Z</span>
          <span style={{ animation: 'rvFloatZ 2.4s ease-in-out 1.0s infinite' }}>Z</span>
        </div>
        <style>{`
          @keyframes rvFloatZ {
            0%, 100% { opacity: 0.25; transform: translateY(0); }
            50% { opacity: 1; transform: translateY(-12px); }
          }
        `}</style>
      </div>
    )
  }

  // ── Content: karaoke EQ bars + scrolling lyrics ────────────────────────────
  if (phase === 'content' && motionState === 'STOPPED') {
    return (
      <div
        data-testid="recovery-karaoke"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(8, 4, 28, 0.90)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          zIndex: 25,
          overflow: 'hidden',
        }}
      >
        {/* EQ bars */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '5px',
            height: '52px',
            marginBottom: '28px',
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              style={{
                width: '9px',
                background: `hsl(${260 + i * 14}, 80%, 65%)`,
                borderRadius: '3px 3px 0 0',
                animation: `rvEq${i % 3} ${0.38 + (i % 3) * 0.14}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>

        {/* Scrolling lyrics marquee */}
        <div
          style={{
            width: '100%',
            overflow: 'hidden',
            textAlign: 'center',
            fontSize: '1.05em',
            fontWeight: 700,
            color: '#ffe066',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              animation: 'rvScrollLyrics 14s linear infinite',
            }}
          >
            ♪ お疲れ様でした — Take a well-earned rest — もう少し眠ろう — Rest and recover ♪
          </span>
        </div>

        <style>{`
          @keyframes rvEq0 { from { height: 10px; } to { height: 38px; } }
          @keyframes rvEq1 { from { height: 18px; } to { height: 48px; } }
          @keyframes rvEq2 { from { height: 6px; } to { height: 30px; } }
          @keyframes rvScrollLyrics {
            0%   { transform: translateX(110%); }
            100% { transform: translateX(-110%); }
          }
        `}</style>
      </div>
    )
  }

  // ── Wakefulness: small audio badge (car is moving, no lyrics) ─────────────
  if (phase === 'wakefulness' && motionState === 'MOVING') {
    return (
      <div
        data-testid="recovery-wakefulness"
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          background: 'rgba(0, 0, 0, 0.62)',
          borderRadius: '20px',
          padding: '7px 16px',
          color: '#ffe066',
          fontSize: '0.95em',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 25,
        }}
      >
        <span style={{ fontSize: '1.15em' }}>♪</span>
        <span>Wake-up audio</span>
      </div>
    )
  }

  return null
}
