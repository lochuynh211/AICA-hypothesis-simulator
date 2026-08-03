/**
 * Shown when the generated data payload is missing or invalid.
 *
 * Deliberately styled inline and importing nothing but React: a data failure
 * may precede the stylesheet, and this screen must never itself fail to render.
 */
import type { DataRegistryError } from '../../data/registry'

export default function DataErrorScreen({ error }: { error: DataRegistryError }) {
  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e6e6f0', background: '#0f0f1e', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Simulator data could not be loaded</h1>
      <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
        {error.problems.map((p, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{p}</li>
        ))}
      </ul>
      <p style={{ opacity: 0.75 }}>
        Regenerate the data bundle with <code>npm run build:data</code>, then reload.
      </p>
    </div>
  )
}
