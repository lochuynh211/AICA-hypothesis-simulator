import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PROPOSAL_API_BASE,
  getMatrix,
  getPackages,
  createRun,
  selectService,
  pickRationale,
} from '../src/api/proposalClient'

describe('proposalClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('exports a base-URL helper for the /api/proposal namespace', () => {
    expect(PROPOSAL_API_BASE).toBe('/api/proposal')
  })

  it('getMatrix() calls GET /api/proposal/matrix and returns the parsed body', async () => {
    const body = { matrix_version: 'v1', rows: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body })

    const result = await getMatrix()

    expect(global.fetch).toHaveBeenCalledWith('/api/proposal/matrix', { method: 'GET' })
    expect(result).toEqual(body)
  })

  it('getPackages() calls GET /api/proposal/packages', async () => {
    const body = { slots: [], packages: [], errors: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body })

    const result = await getPackages()

    expect(global.fetch).toHaveBeenCalledWith('/api/proposal/packages', { method: 'GET' })
    expect(result).toEqual(body)
  })

  it('createRun() POSTs the body to /api/proposal/runs and returns the run log', async () => {
    const runLog = { run_id: 'prun_x', status: 'service_selected' }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => runLog })

    const requestBody = {
      trigger_purpose: 'rest_recommended' as const,
      lifecycle_stage: 'after_rest_before_restart' as const,
      motion_state: 'stopped' as const,
      service_package_id: 'mock_service_selector_v1',
      content_package_id: 'mock_content_selector_v1',
      run_seed: 'seed-1',
      simulation_time: '2026-07-16T00:00:00Z',
    }
    const result = await createRun(requestBody)

    expect(global.fetch).toHaveBeenCalledWith('/api/proposal/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(result).toEqual(runLog)
  })

  it('selectService() POSTs selected_service_id to /runs/{id}/select-service', async () => {
    const runLog = { run_id: 'prun_x', status: 'content_selected' }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => runLog })

    const result = await selectService('prun_x', 'music_playlist')

    expect(global.fetch).toHaveBeenCalledWith('/api/proposal/runs/prun_x/select-service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_service_id: 'music_playlist' }),
    })
    expect(result).toEqual(runLog)
  })

  it('throws a descriptive error (including the response detail) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'incompatible purpose/stage' }),
    })

    await expect(getMatrix()).rejects.toThrow(/422/)
    await expect(getMatrix()).rejects.toThrow(/incompatible purpose\/stage/)
  })

  it('pickRationale() resolves the positional [ja, en] pair by language', () => {
    const rationale = ['日本語の説明', 'English rationale']
    expect(pickRationale(rationale, 'ja')).toBe('日本語の説明')
    expect(pickRationale(rationale, 'en')).toBe('English rationale')
  })

  it('pickRationale() falls back gracefully on a missing/short array', () => {
    expect(pickRationale(undefined, 'ja')).toBe('')
    expect(pickRationale([], 'en')).toBe('')
    expect(pickRationale(['only-one'], 'en')).toBe('only-one')
  })
})
