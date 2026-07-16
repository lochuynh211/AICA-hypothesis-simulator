/**
 * JourneyActionBar (P4 T032, US5) — buttons for the journey actions the
 * reviewer can apply to the current run: accept / reject / choose_another /
 * request_more / complete / continue / stop / motion_change.
 *
 * DISPLAY-ONLY: clicking a button POSTs `journeyAction(runId, actionType,
 * payload)` and refreshes the store with whatever `ProposalRunLog` the
 * backend returns (`JOURNEY_ACTION_APPLIED`) — this component never decides
 * whether an action is valid. The enable/disable heuristics below are
 * best-effort UX only; the backend is the real precondition gate, and a
 * rejected action (422) just surfaces its structured message inline
 * (Constitution I — never a silent no-op, never a fabricated transition).
 */
import { useState } from 'react'
import { t, type BilingualLabel } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { journeyAction } from '../../api/proposalClient'

const LABELS = {
  title: { ja: 'ジャーニー操作', en: 'Journey actions' },
  accept: { ja: '承認', en: 'Accept' },
  reject: { ja: '却下', en: 'Reject' },
  chooseAnother: { ja: '別のサービスを選ぶ', en: 'Choose another' },
  requestMore: { ja: 'もっと見る', en: 'Request more' },
  complete: { ja: '完了', en: 'Complete' },
  continue_: { ja: '継続', en: 'Continue' },
  stop: { ja: '停止', en: 'Stop' },
  motionChange: { ja: '走行状態を切替', en: 'Toggle motion' },
}

const ACTIONS: { actionType: string; label: BilingualLabel }[] = [
  { actionType: 'accept', label: LABELS.accept },
  { actionType: 'reject', label: LABELS.reject },
  { actionType: 'choose_another', label: LABELS.chooseAnother },
  { actionType: 'request_more', label: LABELS.requestMore },
  { actionType: 'complete', label: LABELS.complete },
  { actionType: 'continue', label: LABELS.continue_ },
  { actionType: 'stop', label: LABELS.stop },
  { actionType: 'motion_change', label: LABELS.motionChange },
]

export default function JourneyActionBar() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, runLog } = state
  const [pending, setPending] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const playbackState = runLog?.journey_state.playback_state ?? 'idle'

  function isEnabled(actionType: string): boolean {
    if (!runLog) return false
    switch (actionType) {
      case 'accept':
        return playbackState === 'idle'
      case 'complete':
        return playbackState === 'active' || playbackState === 'backgrounded'
      case 'continue':
        return playbackState === 'completed'
      case 'stop':
        return playbackState === 'active' || playbackState === 'backgrounded' || playbackState === 'paused'
      default:
        return true
    }
  }

  async function handleClick(actionType: string) {
    if (!runLog) return
    setPending(actionType)
    setLocalError(null)
    try {
      const payload: Record<string, unknown> =
        actionType === 'motion_change'
          ? { motion_state: runLog.journey_state.motion_state === 'driving' ? 'stopped' : 'driving' }
          : {}
      const updated = await journeyAction(runLog.run_id, actionType, payload)
      dispatch({ type: 'JOURNEY_ACTION_APPLIED', runLog: updated })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div data-testid="journey-action-bar">
      <div style={sectionLabelStyle}>{t(LABELS.title, lang)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {ACTIONS.map(({ actionType, label }) => (
          <button
            key={actionType}
            type="button"
            data-testid={`journey-action-${actionType}`}
            disabled={!isEnabled(actionType) || pending === actionType}
            onClick={() => handleClick(actionType)}
            style={actionButtonStyle}
          >
            {pending === actionType ? '…' : t(label, lang)}
          </button>
        ))}
      </div>
      {localError && (
        <p role="alert" data-testid="journey-action-error" style={{ color: '#dc2626', fontSize: '0.8em' }}>
          {localError}
        </p>
      )}
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const actionButtonStyle: React.CSSProperties = {
  fontSize: '0.78em',
  fontWeight: 700,
  padding: '5px 11px',
  borderRadius: '7px',
  border: '1px solid #1d4ed8',
  background: '#fff',
  color: '#1d4ed8',
  cursor: 'pointer',
}
