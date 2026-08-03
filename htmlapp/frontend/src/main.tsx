import React from 'react'
import ReactDOM from 'react-dom/client'
// Global 3-panel layout shell (grid columns, panel backgrounds, scrollbars).
// Without this import the .app-shell grid never applies and the panels stack.
import './styles/app.css'
import { ensureRegistry, DataRegistryError } from './data/registry'
import DataErrorScreen from './components/layout/DataErrorScreen'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// The registry must be installed before ANY module that reaches the engine is
// imported — `api/transport.ts` calls ensureRegistry() at module scope — so App
// is imported lazily, after this check.
//
// Wrapped in an async function rather than a top-level `await`: the
// production build's esbuild transform rejects top-level await under the
// configured target/output even though the dev server supports it.
async function boot() {
  try {
    ensureRegistry()
    const { default: App } = await import('./App')
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  } catch (e) {
    const err = e instanceof DataRegistryError ? e : new DataRegistryError([String(e)])
    root.render(<DataErrorScreen error={err} />)
  }
}
void boot()
