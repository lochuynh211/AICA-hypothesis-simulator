import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'
import { RunStoreProvider } from './state/runStore'
import AppShell from './components/layout/AppShell'

type State =
  | { phase: 'loading' }
  | { phase: 'ok'; data: HealthStatus }
  | { phase: 'error' }

export default function App() {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    getHealth()
      .then((data) => setState({ phase: 'ok', data }))
      .catch(() => setState({ phase: 'error' }))
  }, [])

  if (state.phase === 'loading') {
    return <p>Checking backend…</p>
  }

  if (state.phase === 'error') {
    return <p>Backend unavailable</p>
  }

  const healthStatus = `Backend: ${state.data.status} — ${state.data.service}`

  return (
    <RunStoreProvider>
      <AppShell healthStatus={healthStatus} />
    </RunStoreProvider>
  )
}
