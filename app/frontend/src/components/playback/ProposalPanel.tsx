import { useRunStore } from '../../state/runStore'
import { actRun } from '../../api/client'
import type { Proposal } from '../../api/types'
import { t, type LocalizedLabel } from '../../i18n/t'

type Props = {
  proposal: Proposal
  runId: string
  reasonInputs: string[]
  /** Explanation from the decision result — may be string, {ja,en}, or a list. */
  explanation: LocalizedLabel
  allowedActions?: string[]
}

const LABELS = {
  actionFailed: { ja: '操作に失敗しました', en: 'Action failed' },
  acceptRest: { ja: '休憩を受け入れる', en: 'Accept rest' },
  postpone: { ja: '延期', en: 'Postpone' },
  decline: { ja: '断る', en: 'Decline' },
}

export default function ProposalPanel({ proposal, runId, reasonInputs, explanation, allowedActions = [] }: Props) {
  const { dispatch, state } = useRunStore()
  const { uiLanguage } = state

  async function handleAction(action: string) {
    try {
      const runState = await actRun(runId, action)
      dispatch({ type: 'ACTION_APPLIED', runState, action })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t(LABELS.actionFailed, uiLanguage)
      dispatch({ type: 'SET_RUN_ERROR', message })
    }
  }

  return (
    <div data-testid="proposal-overlay" style={{ padding: '16px', border: '2px solid #f0a500', borderRadius: '8px', background: '#fffbf0' }}>
      <h3 style={{ marginBottom: '8px' }}>{t(proposal.message, uiLanguage)}</h3>
      <p style={{ marginBottom: '8px', fontSize: '0.9em', color: '#555' }}>{t(explanation, uiLanguage)}</p>
      {reasonInputs.length > 0 && (
        <ul style={{ marginBottom: '12px', fontSize: '0.85em', color: '#666' }}>
          {reasonInputs.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => handleAction('accept_rest')}>{t(LABELS.acceptRest, uiLanguage)}</button>
        <button onClick={() => handleAction('postpone')}>{t(LABELS.postpone, uiLanguage)}</button>
        {allowedActions.includes('decline') && (
          <button onClick={() => handleAction('decline')}>{t(LABELS.decline, uiLanguage)}</button>
        )}
      </div>
    </div>
  )
}
