import type { ReactNode } from 'react'

/**
 * StepGate (feature 009 UX — forced setup order) — wraps a setup step so it is
 * visibly locked until the previous step is done. The setup flow is
 * Route → Scenario → Package: the scenario step is gated behind a selected
 * route, the package step behind a selected scenario.
 *
 * When `locked`, the children render dimmed + non-interactive (so the user still
 * sees what's coming) with a short hint saying what to do first. When unlocked,
 * children render untouched.
 */
export default function StepGate({
  locked,
  hint,
  testid,
  children,
}: {
  locked: boolean
  /** Short instruction shown while locked, e.g. "Select a route first". */
  hint: string
  testid?: string
  children: ReactNode
}) {
  if (!locked) return <>{children}</>
  return (
    <div data-testid={testid} data-locked="true" aria-disabled="true">
      <div
        style={{
          fontSize: '0.72em',
          color: '#9ca3af',
          fontStyle: 'italic',
          margin: '0 0 6px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span aria-hidden>🔒</span>
        {hint}
      </div>
      <div style={{ opacity: 0.4, pointerEvents: 'none', userSelect: 'none' }}>{children}</div>
    </div>
  )
}
