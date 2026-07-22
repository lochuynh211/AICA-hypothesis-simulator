/**
 * EvidencePanel (T012 + S8/T013) — Copy/Download buttons for the §14.2 evidence report.
 *
 * Fetches on demand (not on mount) so it always reflects the latest run state.
 * Visible whenever a run_id is available (active run or past run via runId prop).
 *
 * Separation visible from frontend: the fetched report has `simulator_facts`
 * (machine outputs) cleanly separated from `human_review` (reviewer feedback).
 *
 * S8 additions: "Copy .md" + "Download .md" alongside the JSON buttons.
 * getEvidenceMarkdown fetches GET /api/runs/{id}/evidence.md — same facts as JSON,
 * formatted as human-readable Markdown. No new deps.
 */

import { useState } from 'react'
import { getEvidence, getEvidenceMarkdown } from '../../api/client'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'

const LABELS = {
  title: { ja: 'EVIDENCE EXPORT', en: 'EVIDENCE EXPORT' },
  subtitle: { ja: '§14.2 — シミュレーター事実 + 人によるレビュー', en: '§14.2 — simulator facts + human review' },
  copying: { ja: 'コピー中…', en: 'Copying…' },
  copied: { ja: 'コピーしました！', en: 'Copied!' },
  error: { ja: 'エラー', en: 'Error' },
  copyJson: { ja: 'JSONをコピー', en: 'Copy JSON' },
  fetching: { ja: '取得中…', en: 'Fetching…' },
  downloaded: { ja: 'ダウンロードしました！', en: 'Downloaded!' },
  copyMd: { ja: '.mdをコピー', en: 'Copy .md' },
}

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

type EvidencePanelProps = {
  /** Explicit run_id to load — overrides the active run from the store.
   *  Pass this when viewing a past run from the Runs screen. */
  runId?: string
}

export default function EvidencePanel({ runId: runIdProp }: EvidencePanelProps = {}) {
  const { state } = useRunStore()
  const runId = runIdProp ?? state.runState?.run_id ?? null
  const { uiLanguage } = state

  // JSON copy/download state
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'ok' | 'error'>('idle')
  const [dlStatus, setDlStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')

  // Markdown copy/download state (S8)
  const [copyMdStatus, setCopyMdStatus] = useState<'idle' | 'copying' | 'ok' | 'error'>('idle')
  const [dlMdStatus, setDlMdStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')

  // ── JSON handlers ──────────────────────────────────────────────────────────

  const handleCopy = async () => {
    if (!runId) return
    setCopyStatus('copying')
    try {
      const report = await getEvidence(runId, uiLanguage)
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
      const report = await getEvidence(runId, uiLanguage)
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

  // ── Markdown handlers (S8) ─────────────────────────────────────────────────

  const handleCopyMd = async () => {
    if (!runId) return
    setCopyMdStatus('copying')
    try {
      const md = await getEvidenceMarkdown(runId, uiLanguage)
      await navigator.clipboard.writeText(md)
      setCopyMdStatus('ok')
      setTimeout(() => setCopyMdStatus('idle'), 2000)
    } catch {
      setCopyMdStatus('error')
      setTimeout(() => setCopyMdStatus('idle'), 3000)
    }
  }

  const handleDownloadMd = async () => {
    if (!runId) return
    setDlMdStatus('fetching')
    try {
      const md = await getEvidenceMarkdown(runId, uiLanguage)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `evidence-${runId}.md`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDlMdStatus('ok')
      setTimeout(() => setDlMdStatus('idle'), 2000)
    } catch {
      setDlMdStatus('error')
      setTimeout(() => setDlMdStatus('idle'), 3000)
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
        <span>{t(LABELS.title, uiLanguage)}</span>
        <span style={{ color: C.faint, fontWeight: 400 }}>{t(LABELS.subtitle, uiLanguage)}</span>
      </div>

      {/* Buttons */}
      <div style={{ padding: '6px 8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* JSON copy */}
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
            ? t(LABELS.copying, uiLanguage)
            : copyStatus === 'ok'
              ? t(LABELS.copied, uiLanguage)
              : copyStatus === 'error'
                ? t(LABELS.error, uiLanguage)
                : t(LABELS.copyJson, uiLanguage)}
        </button>

        {/* JSON download */}
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
            ? t(LABELS.fetching, uiLanguage)
            : dlStatus === 'ok'
              ? t(LABELS.downloaded, uiLanguage)
              : dlStatus === 'error'
                ? t(LABELS.error, uiLanguage)
                : `Download evidence-${runId}.json`}
        </button>

        {/* Markdown copy (S8) */}
        <button
          data-testid="evidence-copy-md-btn"
          onClick={handleCopyMd}
          disabled={copyMdStatus === 'copying'}
          style={{
            padding: '3px 10px',
            fontSize: '0.88em',
            cursor: copyMdStatus === 'copying' ? 'not-allowed' : 'pointer',
            background: C.btnBg,
            color: copyMdStatus === 'ok' ? C.success : copyMdStatus === 'error' ? C.error : C.btnColor,
            border: '1px solid #444',
            borderRadius: '3px',
          }}
        >
          {copyMdStatus === 'copying'
            ? t(LABELS.copying, uiLanguage)
            : copyMdStatus === 'ok'
              ? t(LABELS.copied, uiLanguage)
              : copyMdStatus === 'error'
                ? t(LABELS.error, uiLanguage)
                : t(LABELS.copyMd, uiLanguage)}
        </button>

        {/* Markdown download (S8) */}
        <button
          data-testid="evidence-download-md-btn"
          onClick={handleDownloadMd}
          disabled={dlMdStatus === 'fetching'}
          style={{
            padding: '3px 10px',
            fontSize: '0.88em',
            cursor: dlMdStatus === 'fetching' ? 'not-allowed' : 'pointer',
            background: C.btnBg,
            color: dlMdStatus === 'ok' ? C.success : dlMdStatus === 'error' ? C.error : C.btnColor,
            border: '1px solid #444',
            borderRadius: '3px',
          }}
        >
          {dlMdStatus === 'fetching'
            ? t(LABELS.fetching, uiLanguage)
            : dlMdStatus === 'ok'
              ? t(LABELS.downloaded, uiLanguage)
              : dlMdStatus === 'error'
                ? t(LABELS.error, uiLanguage)
                : `Download evidence-${runId}.md`}
        </button>
      </div>
    </div>
  )
}
