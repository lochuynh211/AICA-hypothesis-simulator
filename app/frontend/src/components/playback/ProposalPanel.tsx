import { useRunStore } from '../../state/runStore'
import { actRun } from '../../api/client'
import type { Proposal } from '../../api/types'

type Props = {
  proposal: Proposal
  runId: string
  reasonInputs: string[]
  explanation: string
  allowedActions?: string[]
}

export default function ProposalPanel({ proposal, runId, reasonInputs, explanation, allowedActions = [] }: Props) {
  const { dispatch } = useRunStore()

  async function handleAction(action: string) {
    try {
      const runState = await actRun(runId, action)
      dispatch({ type: 'ACTION_APPLIED', runState })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed'
      dispatch({ type: 'SET_RUN_ERROR', message })
    }
  }

  return (
    <div data-testid="proposal-overlay" style={{ padding: '16px', border: '2px solid #f0a500', borderRadius: '8px', background: '#fffbf0' }}>
      <h3 style={{ marginBottom: '8px' }}>{proposal.message.en}</h3>
      <p style={{ marginBottom: '8px', fontSize: '0.9em', color: '#555' }}>{explanation}</p>
      {reasonInputs.length > 0 && (
        <ul style={{ marginBottom: '12px', fontSize: '0.85em', color: '#666' }}>
          {reasonInputs.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => handleAction('accept_rest')}>Accept rest</button>
        <button onClick={() => handleAction('postpone')}>Postpone</button>
        {allowedActions.includes('decline') && (
          <button onClick={() => handleAction('decline')}>Decline</button>
        )}
      </div>
    </div>
  )
}
