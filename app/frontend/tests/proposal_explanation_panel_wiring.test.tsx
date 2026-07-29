/**
 * feature 019 — integration: ServiceProposalPanel's ServiceReason wrapper wires
 * useExplanation + ReasonBreakdown together. With provider='backend' and a
 * seeded run, expanding a candidate's breakdown calls explain() with the right
 * (runId, step, target_id) and renders the resolved AI sentence + badge.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'

vi.mock('../src/api/proposalClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/proposalClient')>()
  return {
    ...actual,
    getPackages: vi.fn().mockResolvedValue({
      packages: [
        { id: 'svc_pkg', family: 'service_selector', approach: 'transparent', parameters: { top_k: 3 }, hyperparameters: [], supported_services: [] },
        { id: 'content_pkg', family: 'content_selector', approach: 'transparent', parameters: {}, hyperparameters: [], supported_services: ['rest_stop'] },
      ],
    }),
    createRun: vi.fn(),
    selectService: vi.fn(),
    getPreset: vi.fn(),
    explain: vi.fn(),
  }
})

import { explain } from '../src/api/proposalClient'
const explainMock = explain as unknown as ReturnType<typeof vi.fn>

const CANDIDATE = {
  rank: 1,
  candidate_id: 'rest_stop',
  score: 0.42,
  rationale: ['テンプレ理由', 'template rationale'],
  supporting_feature_ids: ['drowsiness_level'],
  opposing_feature_ids: [],
  uncertainty: null,
  feature_contributions: [
    { feature_id: 'drowsiness_level', feature_value: 'high', response_coefficient: 0.8, weight: 0.3, contribution: 0.24 },
  ],
}

const RUN_LOG = {
  run_id: 'run-test',
  status: 'service_proposed',
  journey_state: { active_service_id: null },
  evidence: [
    {
      step: 'service',
      output: { decision_type: 'proposal', ranked_candidates: [CANDIDATE] },
      input_snapshot: {
        trigger_purpose: 'rest_recommended',
        lifecycle_stage: 'after_rest_before_restart',
        eligible_candidates: [{ candidate_id: 'rest_stop' }],
        excluded_candidates: [],
      },
    },
  ],
}

function Seed() {
  const { dispatch } = useProposalStore()
  React.useEffect(() => {
    dispatch({ type: 'SET_EXPLANATION_PROVIDER', provider: 'backend' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatch({ type: 'RUN_CREATED', runLog: RUN_LOG as any })
  }, [dispatch])
  return null
}

describe('ServiceProposalPanel — explanation wiring (ServiceReason)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expanding a candidate calls explain(run, service, candidate) and renders the AI sentence', async () => {
    explainMock.mockResolvedValue({
      step: 'service',
      target_id: 'rest_stop',
      requested_provider: 'backend',
      rationale: ['日本語のAI理由', 'AI reason for rest stop'],
      provider_used: 'backend',
      model: 'qwen2.5:3b',
      fell_back: false,
      error: null,
      prompt: { messages: [], grounding: {} },
    })

    render(
      <ProposalStoreProvider initialLanguage="en">
        <Seed />
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )

    // Candidate card renders from the seeded run.
    await screen.findByTestId('candidate-card-rest_stop')

    // Before expanding, no explanation was requested (lazy).
    expect(explainMock).not.toHaveBeenCalled()

    // Expand the candidate's reason breakdown → onExpand → request().
    const details = screen.getByTestId('reason-breakdown') as HTMLDetailsElement
    act(() => {
      details.open = true
      fireEvent(details, new Event('toggle'))
    })

    await waitFor(() =>
      expect(explainMock).toHaveBeenCalledWith('run-test', {
        step: 'service',
        targetId: 'rest_stop',
        provider: 'backend',
      }),
    )
    // The resolved AI sentence + badge render (English resolved from the pair).
    expect(await screen.findByTestId('ai-rationale')).toHaveTextContent('AI reason for rest stop')
    expect(screen.getByTestId('ai-rationale-badge')).toHaveTextContent('AI-generated · qwen2.5:3b')
  })
})
