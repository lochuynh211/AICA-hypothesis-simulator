/**
 * ProposalScreen (P1 T029) — the 3-column layout (~16/42/42) rendering
 * WorldPanel | ServiceProposalPanel | ContentProposalPanel.
 *
 * Full-bleed; collapses to a stacked single column below ~1180px (matches
 * ui-mockup.html's `.screen` breakpoint).
 */
import WorldPanel from './panels/WorldPanel'
import ServiceProposalPanel from './panels/ServiceProposalPanel'
import ContentProposalPanel from './panels/ContentProposalPanel'

export default function ProposalScreen() {
  return (
    <div
      data-testid="proposal-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 0.8fr) minmax(360px, 2.1fr) minmax(360px, 2.1fr)',
        gap: '12px',
        padding: '14px',
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
        height: '100%',
      }}
      className="proposal-screen-grid"
    >
      <WorldPanel />
      <ServiceProposalPanel />
      <ContentProposalPanel />
      <style>{`
        @media (max-width: 1180px) {
          .proposal-screen-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
