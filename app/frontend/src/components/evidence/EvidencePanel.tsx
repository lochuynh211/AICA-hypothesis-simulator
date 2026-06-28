/**
 * EvidencePanel (T012) — Copy to clipboard + Download buttons for the §14.2 evidence report.
 *
 * Fetches GET /api/runs/{id}/evidence on demand (not on mount) so it always
 * reflects the latest run state.  Visible whenever a run_id is available.
 *
 * Separation visible from frontend: the fetched JSON has `simulator_facts` (machine
 * outputs) cleanly separated from `human_review` (reviewer feedback).
 *
 * No Markdown (deferred to M6).  No new deps.
 */

import { useState } from 'react'
import { getEvidence } from '../../api/client'
import { useRunStore } from '../../state/runStore'

const C = {
  bg: '#1a1a1a',
  header: '#0f0f0f',
  muted: '#888',
  faint: '#555',
  border: '1px solid #2a2a2a',
  btnBg: '#2a2a2a',
  btnColor: '#ccc',
  btnBgDisabled: '#1f1f1f',
  btnColorDisabled: '#444',
  success: '#4a4',
  error: '#c44',
}

export default function EvidencePanel() {
  const { state } = useRunStore()
  const runId = state.runState?.run_id ?? null

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'ok' | 'error'>('idle')
  const [dlStatus, setDlStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')

  const handleCopy = async () => {
    if (!runId) return
    setCopyStatus('copying')
    try {
      const report = await getEvidence(runId)
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopyStatus('ok')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      setCopyStatus('error')
      setTimeout(() => setCopyStatus('idle'), 3000)
    }
  }

  const handleDownload = async () => {
    if (!runId) return
    setDlStatus('fetching')
    try {
      const report = await getEvidence(runId)
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `evidence-${runId}.json`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDlStatus('ok')
      setTimeout(() => setDlStatus('idle'), 2000)
    } catch {
      setDlStatus('error')
      setTimeout(() => setDlStatus('idle'), 3000)
    }
  }

  if (!runId) {
    return null
  }

  return (
    <div
      data-testid="evidence-panel"
      style={{
        fontFamily: 'monospace',
        fontSize: '0.82em',
        background: C.bg,
        border: C.border,
        borderRadius: '3px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '4px 8px',
          background: C.header,
          fontWeight: 700,
          fontSize: '0.8em',
          letterSpacing: '0.05em',
          color: C.muted,
          borderBottom: C.border,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>EVIDENCE EXPORT</span>
        <span style={{ color: C.faint, fontWeight: 400 }}>§14.2 — simulator facts + human review</span>
      </div>

      {/* Buttons */}
      <div style={{ padding: '6px 8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          data-testid="evidence-copy-btn"
          onClick={handleCopy}
          disabled={copyStatus === 'copying'}
          style={{
            padding: '3px 10px',
            fontSize: '0.88em',
            cursor: copyStatus === 'copying' ? 'not-allowed' : 'pointer',
            background: C.btnBg,
            color: copyStatus === 'ok' ? C.success : copyStatus === 'error' ? C.error : C.btnColor,
            border: '1px solid #444',
            borderRadius: '3px',
          }}
        >
          {copyStatus === 'copying'
            ? 'Copying…'
            : copyStatus === 'ok'
              ? 'Copied!'
              : copyStatus === 'error'
                ? 'Error'
                : 'Copy JSON'}
        </button>

        <button
          data-testid="evidence-download-btn"
          onClick={handleDownload}
          disabled={dlStatus === 'fetching'}
          style={{
            padding: '3px 10px',
            fontSize: '0.88em',
            cursor: dlStatus === 'fetching' ? 'not-allowed' : 'pointer',
            background: C.btnBg,
            color: dlStatus === 'ok' ? C.success : dlStatus === 'error' ? C.error : C.btnColor,
            border: '1px solid #444',
            borderRadius: '3px',
          }}
        >
          {dlStatus === 'fetching'
            ? 'Fetching…'
            : dlStatus === 'ok'
              ? 'Downloaded!'
              : dlStatus === 'error'
                ? 'Error'
                : `Download evidence-${runId}.json`}
        </button>
      </div>
    </div>
  )
}
