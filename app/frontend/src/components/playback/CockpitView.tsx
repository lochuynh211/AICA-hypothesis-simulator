import { useRunStore } from '../../state/runStore'
import ProposalPanel from './ProposalPanel'
import FeedbackForm from '../feedback/FeedbackForm'
import { t } from '../../i18n/t'
import type { LocalizedLabel } from '../../i18n/t'
import type { ReplayTick } from '../../replay/replaySource'

export default function CockpitView({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const { state } = useRunStore()
  const { paused, latestDecision, runState, uiLanguage } = state

  // ── REPLAY MODE — pure projection, no action buttons, no feedback form ──────
  if (replayTick != null) {
    const dr = replayTick.decision
    return (
      <div data-testid="replay-cockpit-view" style={{ padding: '16px' }}>
        <p
          style={{
            color: '#888',
            marginBottom: '8px',
            fontSize: '0.8em',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {t({ ja: '再生ビュー（読み取り専用）', en: 'Replay View (read-only)' }, uiLanguage)}
        </p>
        <div
          data-testid="replay-result-type"
          style={{
            fontWeight: 700,
            color: '#ffe066',
            fontFamily: 'monospace',
            fontSize: '1em',
            marginBottom: '6px',
          }}
        >
          {dr.result_type}
        </div>
        {dr.selected_category && (
          <div style={{ color: '#8f8', fontSize: '0.85em' }}>cat={dr.selected_category}</div>
        )}
        {dr.score != null && (
          <div style={{ color: '#fc9', fontSize: '0.85em' }}>score={dr.score}</div>
        )}
        <div
          style={{ color: '#ccc', marginTop: '8px', fontSize: '0.85em', fontStyle: 'italic' }}
        >
          {t(dr.explanation as LocalizedLabel, uiLanguage)}
        </div>
        {dr.proposal && (
          <div style={{ color: '#9fc', marginTop: '4px', fontSize: '0.85em' }}>
            {t({ ja: '提案: ', en: 'Proposal: ' }, uiLanguage)}
            {dr.proposal.id}
          </div>
        )}
      </div>
    )
  }

  // ── LIVE MODE — unchanged ───────────────────────────────────────────────────
  if (paused && latestDecision?.proposal && runState) {
    const proposalTarget = {
      scope: 'proposal' as const,
      tick_index: runState.current_tick,
      proposal_id: latestDecision.proposal.id,
    }
    return (
      <div>
        <ProposalPanel
          proposal={latestDecision.proposal}
          runId={runState.run_id}
          reasonInputs={latestDecision.reason_inputs}
          explanation={latestDecision.explanation as LocalizedLabel}
          allowedActions={runState.allowed_actions ?? []}
        />
        <div
          data-testid="proposal-feedback-section"
          style={{ marginTop: '12px', padding: '8px', border: '1px solid #333', borderRadius: '4px', background: '#0f0f0f' }}
        >
          <div style={{ fontSize: '0.75em', fontWeight: 700, color: '#aaa', marginBottom: '6px', letterSpacing: '0.05em' }}>
            PROPOSAL FEEDBACK
          </div>
          <FeedbackForm target={proposalTarget} />
        </div>
      </div>
    )
  }

  return (
    <div data-testid="nav-view" style={{ padding: '16px' }}>
      <p style={{ color: '#888', marginBottom: '8px' }}>Navigation view</p>
      {latestDecision && (
        <span data-testid="decision-explanation" style={{ fontSize: '0.9em' }}>
          {t(latestDecision.explanation as LocalizedLabel, uiLanguage)}
        </span>
      )}
    </div>
  )
}
