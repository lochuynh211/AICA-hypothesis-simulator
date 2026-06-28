/**
 * RunsScreen — browse past runs (M6 three-view shell, T003).
 *
 * Placeholder for M6. A later unit adds the RunList + evidence replay here.
 * EvidencePanel (copy/download) will also be reachable from this screen.
 */
export default function RunsScreen() {
  return (
    <div
      data-testid="runs-screen"
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '24px 20px',
      }}
    >
      <h1
        style={{
          fontSize: '1em',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#374151',
          marginBottom: '20px',
          paddingBottom: '8px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        Past Runs
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.9em' }}>
        Past runs will appear here. Run log replay and evidence export coming soon.
      </p>
    </div>
  )
}
