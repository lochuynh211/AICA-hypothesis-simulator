/**
 * ErrorNotice — shared error/notice presentational component (T014).
 *
 * A single consistent role="alert" wrapper used across all error surfaces.
 * Consolidates PRESENTATION only — does NOT change where errors appear
 * or their data flow (each call site keeps its own data-testid).
 *
 * Usage:
 *   <ErrorNotice message={errorMsg} testid="setup-error" />
 *   <ErrorNotice testid="maps-error" message={mapsError.message}>
 *     {suggestion && <p ...>{suggestion}</p>}
 *     <button onClick={handleFallback}>Use local route</button>
 *   </ErrorNotice>
 */
import React from 'react'

type Props = {
  message?: string
  testid?: string
  onDismiss?: () => void
  children?: React.ReactNode
  /** Visual variant. Default 'error'. */
  variant?: 'error' | 'warning'
}

const STYLES: Record<NonNullable<Props['variant']>, React.CSSProperties> = {
  error: {
    background: '#fff3f3',
    border: '1px solid #fca5a5',
    color: '#b91c1c',
  },
  warning: {
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    color: '#92400e',
  },
}

export default function ErrorNotice({ message, testid, onDismiss, children, variant = 'error' }: Props) {
  return (
    <div
      role="alert"
      data-testid={testid}
      style={{
        ...STYLES[variant],
        borderRadius: '4px',
        padding: '8px 10px',
        fontSize: '0.8em',
        position: 'relative',
      }}
    >
      {message && <p style={{ margin: '0 0 4px' }}>{message}</p>}
      {children}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute',
            top: '4px',
            right: '6px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.85em',
            color: 'inherit',
            opacity: 0.7,
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
