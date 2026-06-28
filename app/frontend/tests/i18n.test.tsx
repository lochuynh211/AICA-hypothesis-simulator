/**
 * TDD — i18n tests (T004, T005): t() helper, uiLanguage store field,
 * LanguageToggle component, representative bilingual render audit, and
 * getEvidence() uiLanguage parameter forwarding.
 *
 * Written RED before implementation — all tests must FAIL first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'

// ── Mock the API client so component tests don't make real network calls ──────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  tickRun: vi.fn(),
  actRun: vi.fn(),
  createRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
  getEvidence: vi.fn(),
}))

import * as client from '../src/api/client'

// ── t() helper ────────────────────────────────────────────────────────────────
import { t } from '../src/i18n/t'

describe('t() helper — bilingual label resolution', () => {
  it('returns the ja string when lang=ja', () => {
    expect(t({ ja: 'こんにちは', en: 'Hello' }, 'ja')).toBe('こんにちは')
  })

  it('returns the en string when lang=en', () => {
    expect(t({ ja: 'こんにちは', en: 'Hello' }, 'en')).toBe('Hello')
  })

  it('passes a plain string through unchanged for ja', () => {
    expect(t('plain text', 'ja')).toBe('plain text')
  })

  it('passes a plain string through unchanged for en', () => {
    expect(t('plain text', 'en')).toBe('plain text')
  })

  it('falls back to the other language when the requested key is an empty string', () => {
    expect(t({ ja: '', en: 'Fallback EN' }, 'ja')).toBe('Fallback EN')
    expect(t({ ja: 'フォールバック', en: '' }, 'en')).toBe('フォールバック')
  })

  it('returns empty string for null', () => {
    expect(t(null, 'ja')).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(t(undefined, 'en')).toBe('')
  })

  it('joins an array of mixed string and bilingual items with a space separator', () => {
    const items: Array<string | { ja: string; en: string }> = [
      'Prefix',
      { ja: '疲労', en: 'Fatigue' },
    ]
    expect(t(items, 'en')).toBe('Prefix Fatigue')
    expect(t(items, 'ja')).toBe('Prefix 疲労')
  })

  it('handles an array of plain strings', () => {
    expect(t(['a', 'b', 'c'], 'ja')).toBe('a b c')
  })

  it('handles an empty array', () => {
    expect(t([], 'ja')).toBe('')
  })
})

// ── uiLanguage store field (T004) ─────────────────────────────────────────────

describe('runStore — uiLanguage field and SET_LANGUAGE action (T004)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RunStoreProvider>{children}</RunStoreProvider>
  )

  it('defaults to en', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.uiLanguage).toBe('en')
  })

  it('SET_LANGUAGE switches to en', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })
    expect(result.current.state.uiLanguage).toBe('en')
  })

  it('SET_LANGUAGE switches back to ja', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })
    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'ja' })
    })
    expect(result.current.state.uiLanguage).toBe('ja')
  })

  it('RESET preserves uiLanguage (session-only preference, not cleared on run reset)', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })
    act(() => {
      result.current.dispatch({ type: 'RESET' })
    })
    // uiLanguage is NOT reset — it is a session-level preference, not run state
    expect(result.current.state.uiLanguage).toBe('en')
  })
})

// ── LanguageToggle component ──────────────────────────────────────────────────
import LanguageToggle from '../src/components/layout/LanguageToggle'

describe('LanguageToggle component', () => {
  it('renders JA and EN toggle buttons', () => {
    render(
      <RunStoreProvider>
        <LanguageToggle />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('lang-toggle-ja')).toBeInTheDocument()
    expect(screen.getByTestId('lang-toggle-en')).toBeInTheDocument()
  })

  it('EN button has aria-pressed=true by default (default lang is en)', () => {
    render(
      <RunStoreProvider>
        <LanguageToggle />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('lang-toggle-en')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('lang-toggle-ja')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking EN toggles aria-pressed to EN=true, JA=false', () => {
    render(
      <RunStoreProvider>
        <LanguageToggle />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-en'))
    expect(screen.getByTestId('lang-toggle-en')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('lang-toggle-ja')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking back to JA switches aria-pressed back', () => {
    render(
      <RunStoreProvider>
        <LanguageToggle />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-en'))
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    expect(screen.getByTestId('lang-toggle-ja')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('lang-toggle-en')).toHaveAttribute('aria-pressed', 'false')
  })
})

// ── Representative audit: PackageSelector renders one language at a time ──────
import PackageSelector from '../src/components/setup/PackageSelector'
import type { PackageSummary } from '../src/api/types'

const mockBilingualPkg: PackageSummary = {
  id: 'pkg-bilingual-test',
  version: '0.1.0',
  label: { ja: 'ルールパッケージ', en: 'Rule Package' },
  algorithm_type: 'declarative_rule',
  compatible_scenario_types: ['uc01_fatigue'],
}

/** Wrapper that renders LanguageToggle + the component-under-test in one provider. */
function WithToggle({ children }: { children: React.ReactNode }) {
  return (
    <RunStoreProvider>
      <LanguageToggle />
      {children}
    </RunStoreProvider>
  )
}

describe('PackageSelector — bilingual label audit (representative)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [mockBilingualPkg],
      errors: [],
    })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('shows the JA label when JA is selected (never shows EN or raw object)', async () => {
    render(
      <WithToggle>
        <PackageSelector />
      </WithToggle>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    await waitFor(() => {
      // JA label should appear in the select option
      expect(screen.getByRole('option', { name: /ルールパッケージ/ })).toBeInTheDocument()
    })
    // EN label must NOT be visible at the same time
    expect(screen.queryByText(/Rule Package/)).not.toBeInTheDocument()
    // Raw object must never be rendered
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })

  it('shows the EN label after toggling to EN (JA label disappears)', async () => {
    render(
      <WithToggle>
        <PackageSelector />
      </WithToggle>,
    )
    // Start from JA so the toggle-to-EN transition is observable
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /ルールパッケージ/ })).toBeInTheDocument()
    })

    // Toggle to EN
    fireEvent.click(screen.getByTestId('lang-toggle-en'))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Rule Package/ })).toBeInTheDocument()
    })
    // JA label must be gone
    expect(screen.queryByText(/ルールパッケージ/)).not.toBeInTheDocument()
  })
})

// ── Bilingual render regression: HyperparameterEditor (U3 audit fix) ──────────
import HyperparameterEditor from '../src/components/setup/HyperparameterEditor'
import type { PackageManifest } from '../src/api/types'

const mockHpManifest: PackageManifest = {
  id: 'test-pkg',
  version: '0.1.0',
  label: { ja: 'テストパッケージ', en: 'Test Package' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'weighted_score', entrypoint: 'builtin' },
  parameters: [],
  features: [],
  hyperparameters: [
    {
      key: 'w_drowsiness',
      label: { ja: '睡気重み', en: 'Drowsiness Weight' },
      kind: 'numeric',
      default: 0.4,
      min: 0.0,
      max: 1.0,
      step: 0.01,
    },
  ],
  trigger_categories: [],
  rules: [],
  fire_control: { threshold_source: 'x', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

describe('HyperparameterEditor — bilingual label audit (U3 fix regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getPackage).mockResolvedValue(mockHpManifest)
  })

  it('shows the JA label when JA is selected', async () => {
    // Seed package selection via dispatch — render inside store context
    // The WithToggle wrapper provides the store; we need to select a package first.
    const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }
    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef.current = dispatch
      return null
    }
    render(
      <RunStoreProvider>
        <LanguageToggle />
        <DispatchCapture />
        <HyperparameterEditor />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    act(() => {
      dispatchRef.current!({ type: 'SELECT_PACKAGE', id: 'test-pkg' })
    })
    // JA label renders once JA is selected
    expect(await screen.findByLabelText('睡気重み')).toBeInTheDocument()
    // EN label must NOT be visible
    expect(screen.queryByText('Drowsiness Weight')).not.toBeInTheDocument()
  })

  it('shows the EN label after toggling to EN (JA label disappears)', async () => {
    const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }
    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef.current = dispatch
      return null
    }
    render(
      <RunStoreProvider>
        <LanguageToggle />
        <DispatchCapture />
        <HyperparameterEditor />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    act(() => {
      dispatchRef.current!({ type: 'SELECT_PACKAGE', id: 'test-pkg' })
    })
    // Wait for JA label
    await screen.findByLabelText('睡気重み')

    // Toggle to EN
    fireEvent.click(screen.getByTestId('lang-toggle-en'))

    await waitFor(() => {
      expect(screen.getByLabelText('Drowsiness Weight')).toBeInTheDocument()
    })
    expect(screen.queryByText('睡気重み')).not.toBeInTheDocument()
  })
})

// ── Bilingual render regression: RouteSegmentList (U3 audit fix) ──────────────
import RouteSegmentList from '../src/components/context/RouteSegmentList'
import type { ScenarioDef } from '../src/api/types'

const mockScenarioDef: ScenarioDef = {
  id: 'test-scenario',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona: {},
  route_intent: {
    rest_facility: { label: 'SA' },
    segments: [
      {
        id: 'seg1',
        name: { ja: '東京出発', en: 'Tokyo Departure' },
        type: 'start',
        at: 0,
        speed_band: 'low',
        length_band: 'short',
        is_rest_facility: false,
      },
    ],
  },
  initial_state: {},
  event_presets: {
    drowsiness_schedule: [],
    signal_duration_at_trigger: 'short',
  },
  driver_profile: {},
  vehicle_profile: {},
  total_duration_seconds: 3600,
  tick_seconds: 60,
  allowed_actions: [],
  review_focus: 'Base trigger timing',
}

describe('RouteSegmentList — bilingual name audit (U3 fix regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getScenario).mockResolvedValue(mockScenarioDef)
  })

  it('shows the JA segment name when JA is selected', async () => {
    const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }
    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef.current = dispatch
      return null
    }
    render(
      <RunStoreProvider>
        <LanguageToggle />
        <DispatchCapture />
        <RouteSegmentList />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    act(() => {
      dispatchRef.current!({ type: 'SELECT_SCENARIO', id: 'test-scenario' })
    })
    // JA segment name renders once JA is selected
    expect(await screen.findByText('東京出発')).toBeInTheDocument()
    // EN name must NOT be visible
    expect(screen.queryByText('Tokyo Departure')).not.toBeInTheDocument()
  })

  it('shows the EN segment name after toggling to EN (JA name disappears)', async () => {
    const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }
    function DispatchCapture() {
      const { dispatch } = useRunStore()
      dispatchRef.current = dispatch
      return null
    }
    render(
      <RunStoreProvider>
        <LanguageToggle />
        <DispatchCapture />
        <RouteSegmentList />
      </RunStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))
    act(() => {
      dispatchRef.current!({ type: 'SELECT_SCENARIO', id: 'test-scenario' })
    })
    // Wait for JA name
    await screen.findByText('東京出発')

    // Toggle to EN
    fireEvent.click(screen.getByTestId('lang-toggle-en'))

    await waitFor(() => {
      expect(screen.getByText('Tokyo Departure')).toBeInTheDocument()
    })
    expect(screen.queryByText('東京出発')).not.toBeInTheDocument()
  })
})

// ── T005: getEvidence() passes uiLanguage to the backend ─────────────────────
import type { EvidenceReport, RunState } from '../src/api/types'
import EvidencePanel from '../src/components/evidence/EvidencePanel'

const mockRunState: RunState = {
  run_id: 'run-lang-test-001',
  status: 'completed',
  current_tick: 5,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const mockReport: EvidenceReport = {
  report_id: 'r1',
  run_id: 'run-lang-test-001',
  timestamp: '2026-06-28T00:00:00Z',
  ui_language: 'ja',
  simulator_version: '1.0.0',
  package: { id: 'pkg1', version: '0.1.0' },
  scenario: { id: 'sc1', version: '0.1.0' },
  simulator_facts: {
    route_snapshot: null,
    route_facts: {},
    event_plan: {},
    run_mode: 'standard',
    evidence_status: 'standard',
    initial_parameters: {},
    initial_hyperparameters: {},
    driver_profile: null,
    vehicle_profile: null,
    timeline_events: [],
    decision_trace: [],
    proposal_events: [],
    actions: [],
    algorithm_errors: [],
  },
  human_review: { feedback_labels: [], free_text_comments: [] },
}

function renderWithStore(
  ui: React.ReactElement,
  setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void,
) {
  const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }

  function DispatchCapture() {
    const { dispatch } = useRunStore()
    dispatchRef.current = dispatch
    return null
  }

  const result = render(
    <RunStoreProvider>
      <DispatchCapture />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return result
}

describe('EvidencePanel — getEvidence() passes current uiLanguage (T005)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })
    vi.mocked(client.getEvidence).mockResolvedValue(mockReport)
  })

  it('calls getEvidence with runId and the current uiLanguage (en by default)', async () => {
    renderWithStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: mockRunState })
    })

    fireEvent.click(screen.getByTestId('evidence-copy-btn'))

    await waitFor(() => {
      expect(client.getEvidence).toHaveBeenCalledWith('run-lang-test-001', 'en')
    })
  })

  it('calls getEvidence with uiLanguage=ja after switching to JA', async () => {
    renderWithStore(
      <>
        <LanguageToggle />
        <EvidencePanel />
      </>,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: mockRunState })
      },
    )

    // Switch to JA
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))

    // Trigger export
    fireEvent.click(screen.getByTestId('evidence-copy-btn'))

    await waitFor(() => {
      expect(client.getEvidence).toHaveBeenCalledWith('run-lang-test-001', 'ja')
    })
  })
})
