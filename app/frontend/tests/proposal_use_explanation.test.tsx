/**
 * feature 019 — useExplanation hook: off no-op, backend passthrough, browser
 * (Nano) run+parse, failure → error, and module-cache hit avoids re-generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  useExplanation,
  parseBilingual,
  stripPlaceholders,
  responseIsUsable,
  __clearExplanationCache,
} from '../src/components/proposal/useExplanation'
import * as client from '../src/api/proposalClient'
import * as nano from '../src/lib/nano'

vi.mock('../src/api/proposalClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/proposalClient')>()
  return { ...actual, explain: vi.fn(), explainTrigger: vi.fn() }
})
vi.mock('../src/lib/nano', () => ({ nanoAvailable: vi.fn(), runNano: vi.fn() }))

const explainMock = client.explain as unknown as ReturnType<typeof vi.fn>
const explainTriggerMock = client.explainTrigger as unknown as ReturnType<typeof vi.fn>
const nanoAvailableMock = nano.nanoAvailable as unknown as ReturnType<typeof vi.fn>
const runNanoMock = nano.runNano as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  __clearExplanationCache()
  vi.clearAllMocks()
})

describe('parseBilingual', () => {
  it('parses JA:/EN: prefixes', () => {
    expect(parseBilingual('JA: にほんご\nEN: english')).toEqual(['にほんご', 'english'])
  })
  it('falls back to two plain lines, then a single line for both', () => {
    expect(parseBilingual('one\ntwo')).toEqual(['one', 'two'])
    expect(parseBilingual('solo')).toEqual(['solo', 'solo'])
  })
  it('strips code fences and handles empty', () => {
    expect(parseBilingual('```\nJA: あ\nEN: b\n```')).toEqual(['あ', 'b'])
    expect(parseBilingual('   ')).toEqual(['', ''])
  })
})

describe('parseBilingual', () => {
  it('splits inline "JA: … EN: …" on one line (Nano)', () => {
    expect(parseBilingual('JA: 眠気が強い。 EN: Drowsiness is strong.')).toEqual(['眠気が強い。', 'Drowsiness is strong.'])
  })
  it('still splits the normal two-line form', () => {
    expect(parseBilingual('JA: あ\nEN: b')).toEqual(['あ', 'b'])
  })
})

describe('stripPlaceholders', () => {
  it('removes leftover "(factor A)" / "要因A" tokens but keeps real words', () => {
    expect(stripPlaceholders('high acceptance rate of this song proposal (factor A).')).toBe(
      'high acceptance rate of this song proposal.',
    )
    expect(stripPlaceholders('推し一致「要因A」が寄与しました。')).toBe('推し一致が寄与しました。')
    expect(stripPlaceholders('The factor above mattered most.')).toBe('The factor above mattered most.')
  })
})

describe('responseIsUsable (browser Nano honesty guard)', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'Selected song "x" (fit +0.400).\n- 推し一致 / oshi: +0.096' },
  ]
  it('accepts a grounded reason', () => {
    expect(responseIsUsable(['推し一致が寄与', 'oshi match drove it'], msgs)).toBe(true)
  })
  it('rejects empty, example-parrot, and all-echo output', () => {
    expect(responseIsUsable(['', ''], msgs)).toBe(false)
    expect(
      responseIsUsable(['「要因A」と「要因B」が最も強く働いたため、この選択に至りました。', 'x'], msgs),
    ).toBe(false)
    expect(responseIsUsable(['Selected song "x" (fit +0.400).', '推し一致 / oshi: +0.096'], msgs)).toBe(false)
  })
})

describe('useExplanation', () => {
  it('provider=off is inert (no fetch, ai=null)', () => {
    const { result } = renderHook(() => useExplanation('run1', 'service', 'svc', 'off', 'en'))
    expect(result.current.ai).toBeNull()
    act(() => result.current.request())
    expect(explainMock).not.toHaveBeenCalled()
  })

  it('provider=backend uses the returned rationale, resolved by language', async () => {
    explainMock.mockResolvedValue({
      rationale: ['にほんご理由', 'english reason'],
      model: 'qwen2.5:3b',
      fell_back: false,
      provider_used: 'backend',
      prompt: { messages: [], grounding: {} },
    })
    const { result } = renderHook(() => useExplanation('run1', 'service', 'svc', 'backend', 'en'))
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    expect(result.current.ai).toMatchObject({ status: 'ready', text: 'english reason', model: 'qwen2.5:3b', fellBack: false })
  })

  it('provider=backend surfaces fell_back from a template fallback', async () => {
    explainMock.mockResolvedValue({
      rationale: ['テンプレ', 'template'],
      model: 'template',
      fell_back: true,
      provider_used: 'template',
      prompt: { messages: [], grounding: {} },
    })
    const { result } = renderHook(() => useExplanation('run1', 'service', 'svc', 'backend', 'en'))
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    expect(result.current.ai).toMatchObject({ status: 'ready', fellBack: true })
  })

  it('provider=browser fetches the prompt, runs Nano, and parses the output', async () => {
    explainMock.mockResolvedValue({
      rationale: [],
      model: 'gemini-nano',
      fell_back: false,
      provider_used: 'browser',
      prompt: { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], grounding: {} },
    })
    nanoAvailableMock.mockResolvedValue(true)
    runNanoMock.mockResolvedValue('JA: にほんご\nEN: english')

    const { result } = renderHook(() => useExplanation('run2', 'content', 'item', 'browser', 'ja'))
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    const ai = result.current.ai
    expect(ai?.status === 'ready' && ai.text).toBe('にほんご')
    expect(ai?.status === 'ready' && ai.model).toBe('gemini-nano')
    expect(runNanoMock).toHaveBeenCalledWith([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })

  it('provider=browser with unusable (example-parrot) Nano output → error → template fallback', async () => {
    explainMock.mockResolvedValue({
      rationale: [],
      model: 'gemini-nano',
      fell_back: false,
      provider_used: 'browser',
      prompt: { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'facts' }], grounding: {} },
    })
    nanoAvailableMock.mockResolvedValue(true)
    runNanoMock.mockResolvedValue(
      'JA: 「要因A」と「要因B」が最も強く働いたため、この選択に至りました。\nEN: Factor A and factor B contributed the most, which is why this choice was made.',
    )
    const { result } = renderHook(() => useExplanation('runU', 'service', 'svc', 'browser', 'en'))
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('error'))
  })

  it('provider=browser with no on-device model → error (panel will fall back)', async () => {
    explainMock.mockResolvedValue({
      rationale: [],
      model: 'gemini-nano',
      fell_back: false,
      provider_used: 'browser',
      prompt: { messages: [], grounding: {} },
    })
    nanoAvailableMock.mockResolvedValue(false)

    const { result } = renderHook(() => useExplanation('run3', 'service', 'svc', 'browser', 'en'))
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('error'))
    expect(runNanoMock).not.toHaveBeenCalled()
  })

  it('switching provider for an expanded slot regenerates (no cross-provider cache reuse)', async () => {
    explainMock.mockImplementation((_runId: string, args: { provider: string }) =>
      args.provider === 'backend'
        ? Promise.resolve({
            rationale: ['J', 'backend text'],
            model: 'qwen2.5:3b',
            fell_back: false,
            provider_used: 'backend',
            prompt: { messages: [], grounding: {} },
          })
        : Promise.resolve({
            rationale: [],
            model: 'gemini-nano',
            fell_back: false,
            provider_used: 'browser',
            prompt: { messages: [{ role: 'user', content: 'u' }], grounding: {} },
          }),
    )
    nanoAvailableMock.mockResolvedValue(true)
    runNanoMock.mockResolvedValue('JA: j\nEN: browser text')

    const { result, rerender } = renderHook(
      ({ provider }: { provider: 'backend' | 'browser' }) =>
        useExplanation('run1', 'service', 'svc', provider, 'en'),
      { initialProps: { provider: 'backend' } },
    )
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('backend text')

    // Switch provider: the key changes and the slot is already expanded, so it
    // auto-regenerates with the new provider rather than reverting to template.
    rerender({ provider: 'browser' })
    await waitFor(() =>
      expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('browser text'),
    )
    expect(explainMock).toHaveBeenCalledTimes(2)
    expect(runNanoMock).toHaveBeenCalledTimes(1)
  })

  it('caches by (run,step,target,provider): a second instance does not re-fetch', async () => {
    explainMock.mockResolvedValue({
      rationale: ['a', 'b'],
      model: 'qwen2.5:3b',
      fell_back: false,
      provider_used: 'backend',
      prompt: { messages: [], grounding: {} },
    })
    const a = renderHook(() => useExplanation('runX', 'service', 'svc', 'backend', 'en'))
    act(() => a.result.current.request())
    await waitFor(() => expect(a.result.current.ai?.status).toBe('ready'))

    const b = renderHook(() => useExplanation('runX', 'service', 'svc', 'backend', 'en'))
    act(() => b.result.current.request())
    expect(b.result.current.ai?.status).toBe('ready')
    expect(explainMock).toHaveBeenCalledTimes(1)
  })
})

// ── step='trigger' (feature 025, slice S7) ──────────────────────────────────
//
// Trigger evidence has no ProposalRunLog to key off (`inlineProposal` is
// irrelevant to it) — it always posts the fire itself, via the sibling
// `explainTrigger` client function, mirroring the `explainInline` branch's
// shape but through a THIRD endpoint. `explain`/`explainInline` must never be
// called for this step.
describe('useExplanation — step="trigger"', () => {
  const FIRE = { category: 'rest_required', tick: 20, time_min: 30, feature_contributions: {}, criteria: {} }

  it('calls explainTrigger(fire, {category, provider}) — never explain()/explainInline()', async () => {
    explainTriggerMock.mockResolvedValue({
      rationale: ['テンプレ理由', 'template rationale'],
      model: 'template',
      fell_back: true,
      provider_used: 'template',
      prompt: { messages: [], grounding: {} },
    })
    const { result } = renderHook(() =>
      useExplanation('trig-1', 'trigger', 'rest_required', 'backend', 'en', null, FIRE),
    )
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))

    expect(explainTriggerMock).toHaveBeenCalledWith(FIRE, { category: 'rest_required', provider: 'backend' })
    expect(explainMock).not.toHaveBeenCalled()
    expect(result.current.ai).toMatchObject({ status: 'ready', text: 'template rationale', fellBack: true })
  })

  // feature 025, slice S11 — trigger has no baked rationale of its own (see
  // `RankOneSummary`'s module docstring), so 'off' is NOT inert for it the way
  // it is for service/content above: `request()` still fetches, but via
  // `provider: 'template'` — the backend's deterministic sentence, never an
  // LLM — so the tab is never empty when the reviewer has AI off.
  it('provider=off still fetches for trigger, via provider="template" (never an LLM)', async () => {
    explainTriggerMock.mockResolvedValue({
      rationale: ['既定テンプレ理由', 'default template rationale'],
      model: 'template',
      fell_back: false,
      provider_used: 'template',
      prompt: { messages: [], grounding: {} },
    })
    const { result } = renderHook(() =>
      useExplanation('trig-1', 'trigger', 'rest_required', 'off', 'en', null, FIRE),
    )
    expect(result.current.ai).toBeNull() // nothing fetched yet — request() below is what triggers it
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))

    expect(explainTriggerMock).toHaveBeenCalledWith(FIRE, { category: 'rest_required', provider: 'template' })
    expect(explainMock).not.toHaveBeenCalled()
    expect(result.current.ai).toMatchObject({
      status: 'ready',
      text: 'default template rationale',
      fellBack: false,
    })
  })

  it('switching off→backend→off for trigger never serves the wrong cached sentence', async () => {
    // The 'off'/'template' and 'backend' provider values are DISTINCT cache
    // keys (`cacheKey` includes the hook's own `provider` param — 'off' or
    // 'backend' — not the `fetchProvider` actually sent over the wire), so
    // each slot fetches and caches independently; switching back to a
    // previously-fetched provider must replay ITS OWN sentence, not
    // whichever one happened to resolve most recently.
    explainTriggerMock.mockImplementation((_fire: unknown, args: { provider: string }) =>
      args.provider === 'template'
        ? Promise.resolve({
            rationale: ['テンプレ文', 'template sentence'],
            model: 'template',
            fell_back: false,
            provider_used: 'template',
            prompt: { messages: [], grounding: {} },
          })
        : Promise.resolve({
            rationale: ['LLM文', 'llm sentence'],
            model: 'qwen2.5:3b',
            fell_back: false,
            provider_used: 'backend',
            prompt: { messages: [], grounding: {} },
          }),
    )

    const { result, rerender } = renderHook(
      ({ provider }: { provider: 'off' | 'backend' }) =>
        useExplanation('trig-1', 'trigger', 'rest_required', provider, 'en', null, FIRE),
      { initialProps: { provider: 'off' as 'off' | 'backend' } },
    )
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('template sentence')

    rerender({ provider: 'backend' })
    await waitFor(() => expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('llm sentence'))

    rerender({ provider: 'off' })
    // The 'off' slot was already populated above — its sentence must reappear
    // immediately (synchronously, straight from the cache), never the LLM
    // text left over from the 'backend' slot.
    expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('template sentence')
    // One fetch per DISTINCT provider key ('off'→template, 'backend') — the
    // second visit to 'off' must be a cache hit, not a third fetch.
    expect(explainTriggerMock).toHaveBeenCalledTimes(2)
  })

  it('provider=browser fetches the trigger prompt and runs Nano, same as service/content', async () => {
    explainTriggerMock.mockResolvedValue({
      rationale: [],
      model: 'gemini-nano',
      fell_back: false,
      provider_used: 'browser',
      prompt: { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], grounding: {} },
    })
    nanoAvailableMock.mockResolvedValue(true)
    runNanoMock.mockResolvedValue('JA: にほんご\nEN: english')

    const { result } = renderHook(() =>
      useExplanation('trig-1', 'trigger', 'monotony_prevention', 'browser', 'en', null, FIRE),
    )
    act(() => result.current.request())
    await waitFor(() => expect(result.current.ai?.status).toBe('ready'))
    expect(explainTriggerMock).toHaveBeenCalledWith(FIRE, { category: 'monotony_prevention', provider: 'browser' })
    expect(result.current.ai?.status === 'ready' && result.current.ai.text).toBe('english')
  })
})
