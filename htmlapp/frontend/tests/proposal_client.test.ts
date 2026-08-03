import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import { ExplanationProviderUnsupportedError } from '../src/api/errors'
import { mergedQuickview, afterRestProposal } from '../src/api/mergedClient'
import {
  getPackages,
  getPreset,
  getPresets,
  getCatalog,
  getDatasetCatalog,
  explain,
  explainInline,
  explainTrigger,
  pickRationale,
  ExplainByRunIdUnsupportedError,
  SERVICE_ID_OPTIONS,
  GENRE_VOCABULARY,
  type ProposalRunLog,
} from '../src/api/proposalClient'

/**
 * Task 2 coverage — every one of the eleven real value exports
 * (`getPackages`/`getPreset`/`getPresets`/`getCatalog`/`getDatasetCatalog`/
 * `explainInline`/`explainTrigger`/`pickRationale`/`SERVICE_ID_OPTIONS`/
 * `GENRE_VOCABULARY`) round-tripped through the REAL worker RPC seam (this
 * module's own `call()` -> `transport` -> `dispatch` -> `router` -> the
 * `proposal.*`/`merged.*` handler), never a direct handler call — plus the
 * twelfth export, `explain()`, which this file's own module doc documents
 * has NO backing op and always throws `ExplainByRunIdUnsupportedError`.
 *
 * Every RPC-backed export gets a happy path AND an error path.
 * `getPackages`/`getPresets` have no error path in the engine either (no
 * params, nothing to reject on) — disclosed, not faked, mirroring
 * `merged_client.test.ts`'s own precedent for `listMergedRuns`.
 */

ensureRegistry()

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
})

const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'
const SEED_ID = 'seed-night-highway-oshi'
const PRESET_ID = 'preset-journey-a-1-cruising-fresh'
const DATASET_ID = 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042'
const PACKAGE_ID = 'nri_fatigue_score_v1'
const SCENARIO_ID = 'uc01_fatigue_recovery_v0_1'

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function realWorld(): Promise<Record<string, unknown>> {
  const preset = await getPreset(PRESET_ID)
  return deepCopy(preset.world as unknown as Record<string, unknown>)
}

/** A real, ephemeral `ProposalRunLog` with both service+content evidence
 * (quick-check auto-dispatches content) — built through the real
 * `merged.afterRestProposal` op, not fabricated. Used as `explainInline`'s
 * happy-path input, exactly as the Combined screen's after-nap inspect
 * popup uses it. No cast needed: `mergedClient.ts` now sources
 * `ProposalRunLog` from THIS module (this task's own mergedClient.ts fix —
 * see its module doc), so `afterRestProposal`'s return type already IS
 * `proposalClient.ProposalRunLog`, not just structurally close to it. */
async function realProposal(): Promise<ProposalRunLog> {
  const world = await realWorld()
  return afterRestProposal({
    world,
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed_proposal: 'seed-proposal-client-test',
  })
}

async function expectRejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (exc) {
    return exc
  }
  expect.unreachable('expected the promise to reject')
}

// ---------------------------------------------------------------------------
// zero network calls (static regression guard; the manual grep this task's
// report also pastes is the authoritative measurement).
// ---------------------------------------------------------------------------

describe('zero network calls', () => {
  it('src/api/proposalClient.ts contains no fetch(/XMLHttpRequest/WebSocket/EventSource call', () => {
    const path = resolve(__dirname, '..', 'src', 'api', 'proposalClient.ts')
    const src = readFileSync(path, 'utf8')
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/XMLHttpRequest|new WebSocket|EventSource/)
  })
})

// ---------------------------------------------------------------------------
// getPackages -> proposal.packages.list
// ---------------------------------------------------------------------------

describe('getPackages', () => {
  it('happy path: real slots/packages/errors shape, both known packages present', async () => {
    const result = await getPackages()
    expect(result.errors).toEqual([])
    const ids = new Set(result.packages.map((p) => p.id))
    expect(ids.has(SERVICE_PKG_ID)).toBe(true)
    expect(ids.has(CONTENT_PKG_ID)).toBe(true)
    expect(result.slots.length).toBe(4)
    const svc = result.packages.find((p) => p.id === SERVICE_PKG_ID)!
    expect(svc.family).toBe('service_selector')
    expect(svc.approach).toBe('transparent')
    expect(Array.isArray(svc.hyperparameters)).toBe(true)
  })

  it('no error path exists in the engine either (no params, nothing to reject on) — disclosed, not tested for a failure shape', async () => {
    const result = await getPackages()
    expect(Array.isArray(result.packages)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getPresets / getPreset -> proposal.presets.list / proposal.presets.get
// ---------------------------------------------------------------------------

describe('getPresets', () => {
  it('happy path: real preset summaries, sorted by preset_id, includes the journey preset', async () => {
    const { presets } = await getPresets()
    expect(presets.length).toBeGreaterThan(0)
    expect(presets.map((p) => p.preset_id)).toEqual([...presets.map((p) => p.preset_id)].sort())
    const row = presets.find((p) => p.preset_id === PRESET_ID)
    expect(row).toBeDefined()
    expect(row?.category).toBe('situation')
    expect(row?.journey?.id).toBeTruthy()
  })

  it('no error path exists in the engine either (no params) — disclosed, not tested for a failure shape', async () => {
    const { presets } = await getPresets()
    expect(Array.isArray(presets)).toBe(true)
  })
})

describe('getPreset', () => {
  it('happy path: full preset with embedded world/expectation', async () => {
    const preset = await getPreset(PRESET_ID)
    expect(preset.preset_id).toBe(PRESET_ID)
    expect(preset.world.control_inputs).toBeDefined()
    expect(preset.expectation.hypothesis.length).toBeGreaterThan(0)
  })

  it('error path: unknown preset_id -> plain Error (not ProposalHttpError — the store throws a bare Error), exact message', async () => {
    const exc = await expectRejects(getPreset('preset-does-not-exist'))
    expect(exc).toBeInstanceOf(Error)
    expect(exc).not.toBeInstanceOf(ProposalHttpError)
    expect((exc as Error).message).toBe('preset not found: preset-does-not-exist')
  })
})

// ---------------------------------------------------------------------------
// getCatalog / getDatasetCatalog -> proposal.catalog.get
// ---------------------------------------------------------------------------

describe('getCatalog', () => {
  it('happy path: paged (offset/limit) — provenance + exact page size', async () => {
    const result = await getCatalog(DATASET_ID, 10, 5)
    expect(result.provenance.dataset_id).toBe(DATASET_ID)
    expect(result.provenance.tier).toBeTruthy()
    expect(result.total).toBeGreaterThan(15)
    expect(result.songs.length).toBe(5)
    for (const song of result.songs) {
      expect(typeof song.spotify_track.id).toBe('string')
      expect(typeof song.spotify_track.name).toBe('string')
    }
  })

  it('default offset: omitting offset behaves as offset=0 (first page starts at the first song)', async () => {
    const first = await getCatalog(DATASET_ID, 0, 1)
    const defaulted = await getCatalog(DATASET_ID, undefined as unknown as number, 1)
    expect(defaulted.songs[0].spotify_track.id).toBe(first.songs[0].spotify_track.id)
  })

  it('offset actually shifts the window (guards against an offset param that is silently ignored)', async () => {
    const atZero = await getCatalog(DATASET_ID, 0, 1)
    const atTen = await getCatalog(DATASET_ID, 10, 1)
    expect(atTen.songs[0].spotify_track.id).not.toBe(atZero.songs[0].spotify_track.id)
  })

  it('error path: unknown dataset_id -> plain Error, exact message', async () => {
    const exc = await expectRejects(getCatalog('no-such-dataset'))
    expect(exc).toBeInstanceOf(Error)
    expect((exc as Error).message).toBe("Unknown dataset_id: 'no-such-dataset'")
  })
})

describe('getDatasetCatalog', () => {
  it('happy path: unpaged — returns the WHOLE catalog (no offset/limit sent)', async () => {
    const paged = await getCatalog(DATASET_ID, 0, 5)
    const whole = await getDatasetCatalog(DATASET_ID)
    expect(whole.total).toBe(paged.total)
    expect(whole.songs.length).toBe(paged.total)
    expect(whole.songs[0].spotify_track.id).toBe(paged.songs[0].spotify_track.id)
  })

  it('error path: unknown dataset_id -> plain Error, exact message', async () => {
    const exc = await expectRejects(getDatasetCatalog('no-such-dataset'))
    expect(exc).toBeInstanceOf(Error)
    expect((exc as Error).message).toBe("Unknown dataset_id: 'no-such-dataset'")
  })
})

// ---------------------------------------------------------------------------
// explain — no backing op, always throws (see proposalClient.ts's own
// module doc, "The explain() gap"). No happy path exists — disclosed.
// ---------------------------------------------------------------------------

describe('explain (run-id-addressed) — disclosed unsupported path', () => {
  it('always throws ExplainByRunIdUnsupportedError, carrying runId/step/targetId', async () => {
    const exc = await expectRejects(
      explain('prun_whatever', { step: 'service', targetId: 'candidate_x', provider: 'backend' }),
    )
    expect(exc).toBeInstanceOf(ExplainByRunIdUnsupportedError)
    const err = exc as ExplainByRunIdUnsupportedError
    expect(err.runId).toBe('prun_whatever')
    expect(err.step).toBe('service')
    expect(err.targetId).toBe('candidate_x')
    expect(err.message).toContain('prun_whatever')
    expect(err.message).toContain('not supported in this offline build')
  })

  it('throws regardless of provider — never attempts a call for ANY provider value', async () => {
    for (const provider of ['backend', 'browser'] as const) {
      const exc = await expectRejects(explain('prun_x', { step: 'content', targetId: 'item_x', provider }))
      expect(exc).toBeInstanceOf(ExplainByRunIdUnsupportedError)
    }
  })
})

// ---------------------------------------------------------------------------
// explainInline -> merged.explain
// ---------------------------------------------------------------------------

describe('explainInline', () => {
  it('happy path: real ephemeral proposal, provider=browser -> real ExplainResponse shape', async () => {
    const proposal = await realProposal()
    const serviceEvidence = proposal.evidence.find((e) => e.step === 'service' && e.error === null)
    const candidateId = (
      serviceEvidence?.output as { ranked_candidates?: { candidate_id: string }[] } | null
    )?.ranked_candidates?.[0]?.candidate_id
    expect(candidateId).toBeTruthy()

    const result = await explainInline(proposal, { step: 'service', targetId: candidateId!, provider: 'browser' })
    expect(result.rationale).toEqual([]) // browser provider: rationale is empty, client runs Nano itself
    expect(result.provider_used).toBe('browser')
    expect(result.fell_back).toBe(false)
    expect(result.prompt.messages.length).toBeGreaterThan(0)
  })

  it('error path: provider=backend -> ExplanationProviderUnsupportedError (the offline capability gap, not this file\'s own gap)', async () => {
    const proposal = await realProposal()
    const serviceEvidence = proposal.evidence.find((e) => e.step === 'service' && e.error === null)
    const candidateId = (
      serviceEvidence?.output as { ranked_candidates?: { candidate_id: string }[] } | null
    )?.ranked_candidates?.[0]?.candidate_id
    const exc = await expectRejects(
      explainInline(proposal, { step: 'service', targetId: candidateId!, provider: 'backend' }),
    )
    expect(exc).toBeInstanceOf(ExplanationProviderUnsupportedError)
  })

  it('error path: malformed proposal -> ProposalHttpError(422), "N validation error(s) for ProposalRunLog"', async () => {
    const exc = await expectRejects(
      explainInline({} as unknown as ProposalRunLog, { step: 'service', targetId: 'x', provider: 'browser' }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    expect((exc as ProposalHttpError).message).toContain('validation error(s) for ProposalRunLog')
    expect((exc as ProposalHttpError).message).toContain('run_id\n  Field required and must be a string')
  })

  it('error path: real proposal but unknown target_id -> ProposalHttpError(422), unknown_target detail', async () => {
    const proposal = await realProposal()
    const exc = await expectRejects(
      explainInline(proposal, { step: 'service', targetId: 'candidate_does_not_exist', provider: 'browser' }),
    )
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    const detail = (exc as ProposalHttpError).detail as { code: string; message: string }
    expect(detail.code).toBe('unknown_target')
  })
})

// ---------------------------------------------------------------------------
// explainTrigger -> merged.explainTrigger
// ---------------------------------------------------------------------------

describe('explainTrigger', () => {
  async function realFire(): Promise<Record<string, unknown>> {
    const world = await realWorld()
    const result = await mergedQuickview({
      package_id: PACKAGE_ID,
      scenario_id: SCENARIO_ID,
      run_seed: 42,
      world,
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      run_seed_proposal: 'seed-explain-trigger-client-test',
    })
    expect(result.fires.length).toBeGreaterThan(0)
    return result.fires[0] as unknown as Record<string, unknown>
  }

  it('happy path: real fire, provider=template -> deterministic rationale, never an LLM', async () => {
    const fire = await realFire()
    const result = await explainTrigger(fire, { provider: 'template' })
    expect(result.provider_used).toBe('template')
    expect(result.requested_provider).toBe('template')
    expect(result.model).toBe('template')
    expect(result.fell_back).toBe(false)
    expect(result.rationale.length).toBeGreaterThan(0)
  })

  it('happy path: provider=browser -> empty rationale (client runs Nano), real prompt', async () => {
    const fire = await realFire()
    const result = await explainTrigger(fire, { provider: 'browser' })
    expect(result.provider_used).toBe('browser')
    expect(result.rationale).toEqual([])
    expect(result.prompt.messages.length).toBeGreaterThan(0)
  })

  it('error path: provider=backend -> ExplanationProviderUnsupportedError (default gate, before FirePoint validation)', async () => {
    const exc = await expectRejects(explainTrigger({}, { provider: 'backend' }))
    expect(exc).toBeInstanceOf(ExplanationProviderUnsupportedError)
  })

  it('error path: malformed fire -> ProposalHttpError(422), "N validation error(s) for FirePoint"', async () => {
    const exc = await expectRejects(explainTrigger({ bogus: true }, { provider: 'browser' }))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    expect((exc as ProposalHttpError).message).toContain('validation error(s) for FirePoint')
    expect((exc as ProposalHttpError).message).toContain('tick\n  Field required and must be an integer')
  })

  it('error path: explicit unknown category -> ProposalHttpError(422), unknown_target detail', async () => {
    const fire = await realFire()
    const exc = await expectRejects(explainTrigger(fire, { category: 'not_a_real_category', provider: 'browser' }))
    expect(exc).toBeInstanceOf(ProposalHttpError)
    expect((exc as ProposalHttpError).status).toBe(422)
    const detail = (exc as ProposalHttpError).detail as { code: string }
    expect(detail.code).toBe('unknown_target')
  })
})

// ---------------------------------------------------------------------------
// pickRationale — pure helper, no RPC involved
// ---------------------------------------------------------------------------

describe('pickRationale', () => {
  it('picks index 0 for ja, index 1 for en', () => {
    expect(pickRationale(['理由', 'reason'], 'ja')).toBe('理由')
    expect(pickRationale(['理由', 'reason'], 'en')).toBe('reason')
  })

  it('falls back to index 0 when the requested index is missing', () => {
    expect(pickRationale(['only one'], 'en')).toBe('only one')
  })

  it('returns "" for undefined/empty input', () => {
    expect(pickRationale(undefined, 'ja')).toBe('')
    expect(pickRationale([], 'en')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Static data ported verbatim (SERVICE_ID_OPTIONS / GENRE_VOCABULARY)
// ---------------------------------------------------------------------------

describe('SERVICE_ID_OPTIONS / GENRE_VOCABULARY — static vocab ported verbatim', () => {
  it('SERVICE_ID_OPTIONS has all 14 catalog service ids, no duplicates', () => {
    expect(SERVICE_ID_OPTIONS.length).toBe(14)
    expect(new Set(SERVICE_ID_OPTIONS).size).toBe(14)
    expect(SERVICE_ID_OPTIONS).toContain('music_playlist')
    expect(SERVICE_ID_OPTIONS).toContain('linked_video_recommendation')
  })

  it('GENRE_VOCABULARY has all 12 genres, no duplicates', () => {
    expect(GENRE_VOCABULARY.length).toBe(12)
    expect(new Set(GENRE_VOCABULARY).size).toBe(12)
    expect(GENRE_VOCABULARY).toContain('j-pop')
    expect(GENRE_VOCABULARY).toContain('japanese folk')
  })
})
