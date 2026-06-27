import { useEffect, useState } from 'react'
import { getHealth, HealthStatus } from './api/client'

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

  if (state.phase === 'ok') {
    return <p>{`Backend: ${state.data.status} — ${state.data.service}`}</p>
  }

  return <p>Backend unavailable</p>
}
