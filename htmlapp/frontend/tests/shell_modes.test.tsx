/**
 * shell_modes — feature 026 slice C5 Task 4.
 *
 * Owner's requirement, verbatim: "we dont need trigger screen and proposal
 * anymore, but we dont want to change the structure of the code, so just
 * keep the tab structure, but we just export and show combine screen only."
 *
 * Covers: exactly one mode tab renders in the App-level tab bar, it is
 * Combined, the app boots directly into the Combined screen (no manual
 * mode switch needed), and there is no dead-end second tab anywhere in the
 * rendered document — not merely a disabled/hidden button, but genuinely
 * absent, matching `App.tsx`'s `ENABLED_MODES`-gated `AppModeToggle`.
 *
 * `App` mounts the real `MergedShell` (feature 026 slice C5 Task 3/3b), so
 * this is also the first test in the htmlapp suite to render it — resets the
 * same engine singletons `tests/merged_ops.test.ts` resets (dispatch state,
 * fake IndexedDB, the run/draft registries) so a case selected in one `it`
 * cannot leak into the next.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import App from '../src/App'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  clearDraftRegistry()
  clearRegistry()
})

describe('App shell — Combined only', () => {
  it('boots directly into the Combined screen with no manual mode switch', async () => {
    render(<App />)
    expect(await screen.findByTestId('merged-shell')).toBeInTheDocument()
  })

  it('renders exactly one mode tab, and it is Combined', async () => {
    render(<App />)
    await screen.findByTestId('merged-shell')

    // The App-level mode tab: exactly one exists, it is Combined, and it is
    // already the active tab (booted straight into it).
    const mergedTab = screen.getByTestId('app-mode-merged')
    expect(mergedTab).toBeInTheDocument()
    expect(mergedTab).toHaveAttribute('aria-current', 'page')

    // Not disabled-but-present, not hidden-but-mounted — genuinely absent.
    expect(screen.queryByTestId('app-mode-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('app-mode-proposal')).not.toBeInTheDocument()
  })

  it('has no dead-end path to Trigger or Proposal anywhere in the document', async () => {
    render(<App />)
    await screen.findByTestId('merged-shell')

    // No button carrying either screen's label exists, in either language —
    // there is no click target that could ever land on a broken/missing
    // screen. (JA labels: 発火判定 = Firing decision / Trigger, 提案 = Proposal.)
    expect(screen.queryByRole('button', { name: '発火判定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Firing decision' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提案' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Proposal' })).not.toBeInTheDocument()

    // The AppShell (trigger) surface never mounts.
    expect(screen.queryByText(/^Backend: /)).not.toBeInTheDocument()
  })
})
