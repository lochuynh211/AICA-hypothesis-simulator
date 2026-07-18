/**
 * feature 019 — proposalClient.explain posts the right path + body and parses.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { explain } from '../src/api/proposalClient'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('proposalClient.explain', () => {
  it('POSTs to /runs/{id}/explain with {step, target_id, provider} and returns the parsed body', async () => {
    const responseBody = {
      step: 'service',
      target_id: 'rest_stop',
      requested_provider: 'backend',
      rationale: ['あ', 'b'],
      provider_used: 'backend',
      model: 'qwen2.5:3b',
      fell_back: false,
      error: null,
      prompt: { messages: [], grounding: {} },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await explain('run-42', { step: 'service', targetId: 'rest_stop', provider: 'backend' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/proposal/runs/run-42/explain')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ step: 'service', target_id: 'rest_stop', provider: 'backend' })
    expect(out.rationale).toEqual(['あ', 'b'])
    expect(out.provider_used).toBe('backend')
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: { code: 'unknown_target' } }) }),
    )
    await expect(explain('run-1', { step: 'service', targetId: 'nope', provider: 'browser' })).rejects.toThrow()
  })
})
