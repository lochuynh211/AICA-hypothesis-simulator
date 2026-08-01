import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import {
  ensureRegistry,
  installRegistry,
  resetRegistryForTests,
  getPackageManifests,
} from '../src/data/registry'
import {
  presetStore,
  datasetCatalogRegistry,
  worldSeedStore,
  driverProfileStore,
  proposalPackageRegistry,
  DriverProfileConflictError,
  DriverProfileNotFoundError,
  DriverProfileValidationError,
} from '../src/engine/proposal/stores'
import { getDb } from '../src/storage/db'
import { resetDispatchState, dispatch } from '../src/engine/worker/dispatch'
import {
  proposalPresetsList,
  proposalPresetsGet,
  proposalPackagesList,
  proposalCatalogGet,
} from '../src/engine/worker/handlers/proposal'

const REAL = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  resetRegistryForTests()
  installRegistry(REAL)
})

// ---------------------------------------------------------------------------
// presetStore — services/preset_store.py
// ---------------------------------------------------------------------------

describe('presetStore', () => {
  it('listSummaries returns every committed preset, sorted by preset_id, with the PresetSummary shape', () => {
    const summaries = presetStore.listSummaries()
    expect(summaries.length).toBeGreaterThan(0)
    expect(summaries.map((s) => s.preset_id)).toEqual([...summaries.map((s) => s.preset_id)].sort())
    for (const s of summaries) {
      expect(s.label.ja && s.label.en).toBeTruthy()
      expect(s.brief.ja && s.brief.en).toBeTruthy()
      expect(typeof s.hypothesis).toBe('string')
      expect(s.hypothesis.length).toBeGreaterThan(0)
    }
  })

  it('listSummaries projects the SAME family/contrast_with/hypothesis as .get() for every preset', () => {
    for (const s of presetStore.listSummaries()) {
      const full = presetStore.get(s.preset_id)
      expect(full).not.toBeNull()
      expect(s.family).toBe((full as any).family)
      expect(s.contrast_with).toBe((full as any).contrast_with ?? null)
      expect(s.hypothesis).toBe((full as any).expectation.hypothesis)
    }
  })

  it('get returns the full preset (including the embedded world) for a known id', () => {
    const id = presetStore.listSummaries()[0].preset_id
    const preset = presetStore.get(id)
    expect(preset).not.toBeNull()
    expect((preset as any).preset_id).toBe(id)
    expect((preset as any).world).toBeTruthy()
  })

  it('get returns null for an unknown preset_id (mirrors PresetStore.get -> None)', () => {
    expect(presetStore.get('preset-does-not-exist')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// datasetCatalogRegistry — services/dataset_catalog_registry.py
// ---------------------------------------------------------------------------

describe('datasetCatalogRegistry', () => {
  it('listDatasets returns every dataset with song_count matching its catalog length', () => {
    const datasets = datasetCatalogRegistry.listDatasets()
    expect(datasets.length).toBeGreaterThan(0)
    for (const d of datasets) {
      const catalog = datasetCatalogRegistry.getCatalog(d.dataset_id)
      expect(catalog).not.toBeNull()
      expect(d.song_count).toBe((catalog as unknown[]).length)
      expect(typeof d.synthetic_only).toBe('boolean')
    }
  })

  it('getCatalog returns the full song array for a known dataset', () => {
    const id = datasetCatalogRegistry.listDatasets()[0].dataset_id
    const catalog = datasetCatalogRegistry.getCatalog(id)
    expect(Array.isArray(catalog)).toBe(true)
    expect((catalog as unknown[]).length).toBeGreaterThan(0)
  })

  it('getCatalog returns null for an unknown dataset_id', () => {
    expect(datasetCatalogRegistry.getCatalog('no-such-dataset')).toBeNull()
  })

  it('getProvenance returns the {dataset_id, dataset_version, dataset_hash, tier, provenance_note} projection (no synthetic_only/song_count)', () => {
    const id = datasetCatalogRegistry.listDatasets()[0].dataset_id
    const prov = datasetCatalogRegistry.getProvenance(id)
    expect(prov).not.toBeNull()
    expect(prov).toEqual({
      dataset_id: prov!.dataset_id,
      dataset_version: prov!.dataset_version,
      dataset_hash: prov!.dataset_hash,
      tier: prov!.tier,
      provenance_note: prov!.provenance_note,
    })
    expect('synthetic_only' in (prov as object)).toBe(false)
    expect('song_count' in (prov as object)).toBe(false)
  })

  it('getProvenance returns null for an unknown dataset_id', () => {
    expect(datasetCatalogRegistry.getProvenance('no-such-dataset')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// worldSeedStore — services/world_seed_store.py
// ---------------------------------------------------------------------------

describe('worldSeedStore', () => {
  it('listSeeds returns the {seed_id, label, description} summary for every committed seed', () => {
    const seeds = worldSeedStore.listSeeds()
    expect(seeds.length).toBeGreaterThan(0)
    for (const s of seeds) {
      expect(s.label.ja && s.label.en).toBeTruthy()
      expect(s.description.ja && s.description.en).toBeTruthy()
    }
  })

  it('getSeed returns the full SeedWorld (including the embedded world) for a known id', () => {
    const id = worldSeedStore.listSeeds()[0].seed_id
    const seed = worldSeedStore.getSeed(id)
    expect(seed).not.toBeNull()
    expect((seed as any).world).toBeTruthy()
  })

  it('getSeed returns null for an unknown seed_id', () => {
    expect(worldSeedStore.getSeed('seed-does-not-exist')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// driverProfileStore — services/driver_profile_store.py
// ---------------------------------------------------------------------------

function validProfile(overrides: Record<string, unknown> = {}) {
  return {
    oshi_registered: false,
    oshi_mode: 'off',
    age_band: '20s',
    gender: 'unspecified',
    hobby_interest_tags: ['custom-tag'],
    ...overrides,
  }
}

describe('driverProfileStore — builtins', () => {
  it('listProfiles includes at least 3 distinct built-in profiles', async () => {
    const summaries = await driverProfileStore.listProfiles()
    const builtins = summaries.filter((s) => s.builtin)
    expect(builtins.length).toBeGreaterThanOrEqual(3)
  })

  it('listProfiles summary shape is exactly {profile_id, label, builtin}', async () => {
    for (const s of await driverProfileStore.listProfiles()) {
      expect(Object.keys(s).sort()).toEqual(['builtin', 'label', 'profile_id'])
      expect(Object.keys(s.label).sort()).toEqual(['en', 'ja'])
    }
  })

  it('getProfile resolves a builtin by id with builtin=true and a full profile', async () => {
    const builtinId = (await driverProfileStore.listProfiles()).find((s) => s.builtin)!.profile_id
    const record = await driverProfileStore.getProfile(builtinId)
    expect(record).not.toBeNull()
    expect(record!.builtin).toBe(true)
    expect(record!.profile).toBeTruthy()
  })

  it('getProfile returns null for a completely unknown id', async () => {
    expect(await driverProfileStore.getProfile('no-such-profile-at-all')).toBeNull()
  })
})

describe('driverProfileStore — save/list/get round-trip (write path, NOT a pure adapter)', () => {
  it('saveProfile persists a NEW user profile (builtin=false) that appears in listProfiles', async () => {
    const record = await driverProfileStore.saveProfile({ ja: 'テスト', en: 'Test Profile' }, validProfile())
    expect(record.builtin).toBe(false)
    expect(record.profile_id).toBeTruthy()

    const ids = (await driverProfileStore.listProfiles()).map((s) => s.profile_id)
    expect(ids).toContain(record.profile_id)
  })

  it('saveProfile round-trips identically through getProfile', async () => {
    const record = await driverProfileStore.saveProfile({ ja: 'ラウンドトリップ', en: 'Round Trip' }, validProfile())
    const reloaded = await driverProfileStore.getProfile(record.profile_id)
    expect(reloaded).toEqual(record)
  })

  it('two saved profiles get distinct ids', async () => {
    const r1 = await driverProfileStore.saveProfile({ ja: 'A', en: 'A' }, validProfile())
    const r2 = await driverProfileStore.saveProfile({ ja: 'B', en: 'B' }, validProfile())
    expect(r1.profile_id).not.toBe(r2.profile_id)
  })

  it('deleteProfile removes a user profile', async () => {
    const record = await driverProfileStore.saveProfile({ ja: '削除対象', en: 'To Delete' }, validProfile())
    expect(await driverProfileStore.getProfile(record.profile_id)).not.toBeNull()

    await driverProfileStore.deleteProfile(record.profile_id)
    expect(await driverProfileStore.getProfile(record.profile_id)).toBeNull()
  })

  it('deleteProfile on an unknown user id throws DriverProfileNotFoundError (TS-logic)', async () => {
    await expect(driverProfileStore.deleteProfile('dprof_no-such-profile')).rejects.toThrow(
      DriverProfileNotFoundError,
    )
  })

  it('deleteProfile on a builtin id throws DriverProfileConflictError, and the builtin survives the failed delete (TS-logic)', async () => {
    const builtinId = (await driverProfileStore.listProfiles()).find((s) => s.builtin)!.profile_id
    await expect(driverProfileStore.deleteProfile(builtinId)).rejects.toThrow(DriverProfileConflictError)
    expect(await driverProfileStore.getProfile(builtinId)).not.toBeNull()
  })
})

describe('driverProfileStore — saveProfile validation (TS-logic, not full DriverProfile parity — see stores.ts doc)', () => {
  it('rejects a label missing "en" (DriverProfileValidationError, field label.en)', async () => {
    let caught: DriverProfileValidationError | undefined
    try {
      await driverProfileStore.saveProfile({ ja: 'missing-en' }, validProfile())
    } catch (e) {
      caught = e as DriverProfileValidationError
    }
    expect(caught).toBeInstanceOf(DriverProfileValidationError)
    expect(caught!.errors.some((e) => e.field === 'label.en')).toBe(true)
    // Nothing persisted for the invalid save.
    expect((await driverProfileStore.listProfiles()).every((s) => s.builtin)).toBe(true)
  })

  it('rejects an unknown age_band enum member (field profile.age_band)', async () => {
    let caught: DriverProfileValidationError | undefined
    try {
      await driverProfileStore.saveProfile({ ja: '無効', en: 'Invalid' }, validProfile({ age_band: 'not-a-real-age-band' }))
    } catch (e) {
      caught = e as DriverProfileValidationError
    }
    expect(caught).toBeInstanceOf(DriverProfileValidationError)
    expect(caught!.errors.some((e) => e.field === 'profile.age_band')).toBe(true)
  })

  it('rejects an unknown gender enum member (field profile.gender)', async () => {
    await expect(
      driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, validProfile({ gender: 'not-a-real-gender' })),
    ).rejects.toThrow(DriverProfileValidationError)
  })

  it('rejects an unknown oshi_mode enum member (field profile.oshi_mode)', async () => {
    await expect(
      driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, validProfile({ oshi_mode: 'maybe' })),
    ).rejects.toThrow(DriverProfileValidationError)
  })

  it('rejects a missing oshi_registered (required field, no default)', async () => {
    const p = validProfile() as Record<string, unknown>
    delete p.oshi_registered
    await expect(driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, p)).rejects.toThrow(
      DriverProfileValidationError,
    )
  })

  it('rejects duplicate oshi_artists ids (mirrors DriverProfile._oshi_artists_no_duplicate_ids)', async () => {
    const bad = validProfile({
      oshi_artists: [
        { artist_id: 'artist-1', enthusiasm: 0.5 },
        { artist_id: 'artist-1', enthusiasm: 1.0 },
      ],
    })
    let caught: DriverProfileValidationError | undefined
    try {
      await driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, bad)
    } catch (e) {
      caught = e as DriverProfileValidationError
    }
    expect(caught).toBeInstanceOf(DriverProfileValidationError)
    expect(caught!.errors.some((e) => e.message.includes('artist-1'))).toBe(true)
  })

  it('accepts distinct oshi_artists ids (branch neighbour: same code path, no error)', async () => {
    const ok = validProfile({
      oshi_artists: [
        { artist_id: 'artist-1', enthusiasm: 0.5 },
        { artist_id: 'artist-2', enthusiasm: 1.0 },
      ],
    })
    const record = await driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, ok)
    expect((record.profile as any).oshi_artists).toHaveLength(2)
  })

  it('rejects a label missing "ja" (field label.ja — structural neighbour of the label.en check above)', async () => {
    let caught: DriverProfileValidationError | undefined
    try {
      await driverProfileStore.saveProfile({ en: 'missing-ja' }, validProfile())
    } catch (e) {
      caught = e as DriverProfileValidationError
    }
    expect(caught).toBeInstanceOf(DriverProfileValidationError)
    expect(caught!.errors.some((e) => e.field === 'label.ja')).toBe(true)
  })

  it('rejects a non-array oshi_artists', async () => {
    await expect(
      driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, validProfile({ oshi_artists: 'not-an-array' })),
    ).rejects.toThrow(DriverProfileValidationError)
  })

  it('an oshi_artists entry with no artist_id is silently ignored by the duplicate check (documented gap: artist_id presence/type itself is not validated, unlike Python OshiArtist.artist_id: str)', async () => {
    const record = await driverProfileStore.saveProfile(
      { ja: 'x', en: 'x' },
      validProfile({ oshi_artists: [{ enthusiasm: 0.5 }] }),
    )
    expect((record.profile as any).oshi_artists).toEqual([{ enthusiasm: 0.5 }])
  })
})

// ---------------------------------------------------------------------------
// proposalPackageRegistry — services/proposal_package_registry.py
// ---------------------------------------------------------------------------

describe('proposalPackageRegistry — real committed packages/', () => {
  it('loads both mock packages', () => {
    const ids = new Set(proposalPackageRegistry.listSummaries().packages.map((p) => p.id))
    expect(ids.has('mock_service_selector_v1')).toBe(true)
    expect(ids.has('mock_content_selector_v1')).toBe(true)
  })

  it('reports no errors for the current committed data', () => {
    expect(proposalPackageRegistry.listSummaries().errors).toEqual([])
  })

  it('the real transparent packages (sorting before the mocks) win the transparent slots — first-scanned wins', () => {
    const bySlot = Object.fromEntries(
      proposalPackageRegistry.listSlots().map((s) => [`${s.family}/${s.approach}`, s.package_id]),
    )
    expect(bySlot['service_selector/transparent']).toBe('aica_transparent_service_selector_v1')
    expect(bySlot['content_selector/transparent']).toBe('aica_transparent_content_selector_v1')
  })

  it('the 2 constrained_llm slots are empty in the current committed data', () => {
    const bySlot = Object.fromEntries(
      proposalPackageRegistry.listSlots().map((s) => [`${s.family}/${s.approach}`, s.package_id]),
    )
    expect(bySlot['service_selector/constrained_llm']).toBeNull()
    expect(bySlot['content_selector/constrained_llm']).toBeNull()
  })

  it('list_slots always has exactly 4 entries, in family-then-approach declaration order', () => {
    const slots = proposalPackageRegistry.listSlots()
    expect(slots).toHaveLength(4)
    expect(slots.map((s) => `${s.family}/${s.approach}`)).toEqual([
      'service_selector/transparent',
      'service_selector/constrained_llm',
      'content_selector/transparent',
      'content_selector/constrained_llm',
    ])
  })

  it('get returns the full manifest for a known id, with its own family/approach', () => {
    const pkg = proposalPackageRegistry.get('mock_service_selector_v1')
    expect(pkg).not.toBeNull()
    expect((pkg as any).family).toBe('service_selector')
    expect((pkg as any).approach).toBe('transparent')
  })

  it('get returns null for an unknown package id', () => {
    expect(proposalPackageRegistry.get('does_not_exist')).toBeNull()
  })

  it('a content package never fills a service slot and vice versa', () => {
    const bySlot = Object.fromEntries(
      proposalPackageRegistry.listSlots().map((s) => [`${s.family}/${s.approach}`, s.package_id]),
    )
    expect(bySlot['service_selector/transparent']).not.toBe('mock_content_selector_v1')
    expect(bySlot['content_selector/transparent']).not.toBe('mock_service_selector_v1')
  })

  it('hidden fixture packages are still loaded (get/listSlots) but proposal.packages.list is the layer that filters them (see handlers/proposal.ts)', () => {
    const { packages } = proposalPackageRegistry.listSummaries()
    expect(packages.some((p) => p.id === 'mock_service_selector_v1' && p.hidden)).toBe(true)
  })

  it('the trigger-family registry never sees a proposal-family manifest (family routing is mutually exclusive)', () => {
    // Sanity cross-check on the shared isProposalFamilyManifest gate: every
    // manifest this registry loads carries family/kind; getPackageManifests()
    // itself returns the whole bundled set (both families).
    const proposalIds = new Set(proposalPackageRegistry.listSummaries().packages.map((p) => p.id))
    const allIds = new Set(getPackageManifests().map((m) => m.id))
    expect([...proposalIds].every((id) => allIds.has(id))).toBe(true)
    expect(proposalIds.has('nri_fatigue_score_v1')).toBe(false) // a trigger package
  })
})

describe('proposalPackageRegistry — fabricated manifests (TS-logic branch coverage, no Python golden reaches these)', () => {
  const validServiceManifest = (id: string, approach: 'transparent' | 'constrained_llm' = 'transparent') => ({
    id,
    version: '1.0.0',
    label: { ja: 'テスト', en: 'Test' },
    kind: 'service_selector',
    family: 'service_selector',
    approach,
    contract_version: '1.0.0',
    algorithm: { type: 'python_module', entrypoint: 'algorithm.py', error_mode: 'blocking' },
    supported_services: [],
    parameters: {},
    hyperparameters: [],
  })

  function withPatchedPackages(patch: Record<string, unknown>) {
    const clone = JSON.parse(JSON.stringify(REAL))
    Object.assign(clone.packageManifests, patch)
    resetRegistryForTests()
    installRegistry(clone)
  }

  it('a manifest with no kind/family at all is skipped silently — not loaded, not an error (trigger package)', () => {
    withPatchedPackages({
      fab_trigger_like: { id: 'fab_trigger_like', version: '1.0', label: 'x', algorithm: { type: 'python_module' } },
    })
    expect(proposalPackageRegistry.get('fab_trigger_like')).toBeNull()
    expect(proposalPackageRegistry.listSummaries().errors).toEqual([])
    expect(proposalPackageRegistry.listSummaries().packages.some((p) => p.id === 'fab_trigger_like')).toBe(false)
  })

  it('a family-bearing manifest missing required fields is reported as an error, never partially used', () => {
    withPatchedPackages({
      fab_bad_service: { id: 'fab_bad_service', family: 'service_selector', approach: 'transparent' },
    })
    const { packages, errors } = proposalPackageRegistry.listSummaries()
    expect(packages.some((p) => p.id === 'fab_bad_service')).toBe(false)
    expect(proposalPackageRegistry.get('fab_bad_service')).toBeNull()
    expect(errors.some((e) => e.package_dir === 'fab_bad_service')).toBe(true)
  })

  it('a content_selector manifest with an empty supported_services list is rejected (content_family_requires_supported_services)', () => {
    const bad = validServiceManifest('fab_bad_content')
    ;(bad as any).kind = 'content_selector'
    ;(bad as any).family = 'content_selector'
    // supported_services: [] (empty) — should be rejected for content family
    withPatchedPackages({ fab_bad_content: bad })
    const { errors } = proposalPackageRegistry.listSummaries()
    const err = errors.find((e) => e.package_dir === 'fab_bad_content')
    expect(err).toBeTruthy()
    expect(err!.error).toMatch(/non-empty supported_services/)
  })

  it('a service_selector manifest with an empty supported_services list is VALID (family-conditional requirement, branch neighbour)', () => {
    withPatchedPackages({ fab_ok_service: validServiceManifest('fab_ok_service') })
    expect(proposalPackageRegistry.get('fab_ok_service')).not.toBeNull()
    expect(proposalPackageRegistry.listSummaries().errors).toEqual([])
  })

  it('an invalid family enum value is rejected as an error, get() -> null', () => {
    const bad = validServiceManifest('fab_bad_family')
    ;(bad as any).family = 'not_a_real_family'
    withPatchedPackages({ fab_bad_family: bad })
    expect(proposalPackageRegistry.get('fab_bad_family')).toBeNull()
    expect(proposalPackageRegistry.listSummaries().errors.some((e) => e.package_dir === 'fab_bad_family')).toBe(true)
  })

  it('algorithm.type other than python_module is rejected', () => {
    const bad = validServiceManifest('fab_bad_algo')
    ;(bad as any).algorithm = { type: 'declarative_rule', entrypoint: 'x' }
    withPatchedPackages({ fab_bad_algo: bad })
    expect(proposalPackageRegistry.get('fab_bad_algo')).toBeNull()
  })

  it('an unknown hyperparameter kind is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_kind')
    ;(bad as any).hyperparameters = [{ key: 'x', kind: 'not_a_real_kind', label: { ja: 'x', en: 'x' }, default: 1 }]
    withPatchedPackages({ fab_bad_hp_kind: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_kind')).toBeNull()
  })

  it('an unknown supported_services entry is rejected', () => {
    const bad = validServiceManifest('fab_bad_service_id')
    ;(bad as any).supported_services = ['not_a_real_service']
    withPatchedPackages({ fab_bad_service_id: bad })
    expect(proposalPackageRegistry.get('fab_bad_service_id')).toBeNull()
  })

  it('a valid package is never contaminated by an invalid sibling in the same payload', () => {
    withPatchedPackages({
      fab_ok_sibling: validServiceManifest('fab_ok_sibling'),
      fab_bad_sibling: { id: 'fab_bad_sibling', family: 'service_selector' },
    })
    expect(proposalPackageRegistry.get('fab_ok_sibling')).not.toBeNull()
    expect(proposalPackageRegistry.listSummaries().errors).toHaveLength(1)
    expect(proposalPackageRegistry.listSummaries().errors[0].package_dir).toBe('fab_bad_sibling')
  })

  it('an invalid manifest with a missing/empty id falls back to a positional package_dir marker', () => {
    withPatchedPackages({
      '': { id: '', family: 'service_selector' },
    })
    const err = proposalPackageRegistry.listSummaries().errors.find((e) => e.package_dir.startsWith('<unknown manifest at payload index'))
    expect(err).toBeTruthy()
  })

  it('a fabricated constrained_llm-approach package fills the previously-empty constrained_llm slot', () => {
    withPatchedPackages({ fab_llm_service: validServiceManifest('fab_llm_service', 'constrained_llm') })
    const bySlot = Object.fromEntries(
      proposalPackageRegistry.listSlots().map((s) => [`${s.family}/${s.approach}`, s.package_id]),
    )
    expect(bySlot['service_selector/constrained_llm']).toBe('fab_llm_service')
    // the real transparent slots are untouched
    expect(bySlot['service_selector/transparent']).toBe('aica_transparent_service_selector_v1')
  })

  // -- Remaining proposalManifestValidationError branches, each isolated to
  // ONE bad field on an otherwise-valid manifest (validServiceManifest),
  // proving that specific check — not just "some earlier check" — is what
  // rejects it. --

  it('a malformed label ({ja} but no en) is rejected', () => {
    const bad = validServiceManifest('fab_bad_label')
    ;(bad as any).label = { ja: 'x' }
    withPatchedPackages({ fab_bad_label: bad })
    expect(proposalPackageRegistry.get('fab_bad_label')).toBeNull()
  })

  it('an invalid approach enum value is rejected', () => {
    const bad = validServiceManifest('fab_bad_approach')
    ;(bad as any).approach = 'not_a_real_approach'
    withPatchedPackages({ fab_bad_approach: bad })
    expect(proposalPackageRegistry.get('fab_bad_approach')).toBeNull()
  })

  it('a non-string contract_version is rejected', () => {
    const bad = validServiceManifest('fab_bad_contract_version')
    ;(bad as any).contract_version = 1
    withPatchedPackages({ fab_bad_contract_version: bad })
    expect(proposalPackageRegistry.get('fab_bad_contract_version')).toBeNull()
  })

  it('a non-string algorithm.entrypoint is rejected', () => {
    const bad = validServiceManifest('fab_bad_entrypoint')
    ;(bad as any).algorithm = { type: 'python_module', entrypoint: 42 }
    withPatchedPackages({ fab_bad_entrypoint: bad })
    expect(proposalPackageRegistry.get('fab_bad_entrypoint')).toBeNull()
  })

  it('an invalid algorithm.error_mode value is rejected', () => {
    const bad = validServiceManifest('fab_bad_error_mode')
    ;(bad as any).algorithm = { type: 'python_module', entrypoint: 'algorithm.py', error_mode: 'sometimes' }
    withPatchedPackages({ fab_bad_error_mode: bad })
    expect(proposalPackageRegistry.get('fab_bad_error_mode')).toBeNull()
  })

  it('an omitted algorithm.error_mode is VALID (optional field, branch neighbour of the invalid-value case above)', () => {
    const ok = validServiceManifest('fab_ok_no_error_mode')
    delete (ok as any).algorithm.error_mode
    withPatchedPackages({ fab_ok_no_error_mode: ok })
    expect(proposalPackageRegistry.get('fab_ok_no_error_mode')).not.toBeNull()
  })

  it('a non-object parameters field is rejected', () => {
    const bad = validServiceManifest('fab_bad_parameters')
    ;(bad as any).parameters = [1, 2, 3]
    withPatchedPackages({ fab_bad_parameters: bad })
    expect(proposalPackageRegistry.get('fab_bad_parameters')).toBeNull()
  })

  it('a non-array hyperparameters field is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_not_array')
    ;(bad as any).hyperparameters = {}
    withPatchedPackages({ fab_bad_hp_not_array: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_not_array')).toBeNull()
  })

  it('a hyperparameters entry that is not an object is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_entry_shape')
    ;(bad as any).hyperparameters = [42]
    withPatchedPackages({ fab_bad_hp_entry_shape: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_entry_shape')).toBeNull()
  })

  it('a hyperparameters entry with a non-string key is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_key')
    ;(bad as any).hyperparameters = [{ key: 42, kind: 'numeric', label: { ja: 'x', en: 'x' }, default: 1 }]
    withPatchedPackages({ fab_bad_hp_key: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_key')).toBeNull()
  })

  it('a hyperparameters entry with a malformed label is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_label')
    ;(bad as any).hyperparameters = [{ key: 'x', kind: 'numeric', label: { ja: 'x' }, default: 1 }]
    withPatchedPackages({ fab_bad_hp_label: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_label')).toBeNull()
  })

  it('a hyperparameters entry with no default is rejected', () => {
    const bad = validServiceManifest('fab_bad_hp_default')
    ;(bad as any).hyperparameters = [{ key: 'x', kind: 'numeric', label: { ja: 'x', en: 'x' } }]
    withPatchedPackages({ fab_bad_hp_default: bad })
    expect(proposalPackageRegistry.get('fab_bad_hp_default')).toBeNull()
  })

  it('a hyperparameters entry with default: null is VALID (key present with a null value, branch neighbour of "no default" above)', () => {
    const ok = validServiceManifest('fab_ok_hp_null_default')
    ;(ok as any).hyperparameters = [{ key: 'x', kind: 'numeric', label: { ja: 'x', en: 'x' }, default: null }]
    withPatchedPackages({ fab_ok_hp_null_default: ok })
    expect(proposalPackageRegistry.get('fab_ok_hp_null_default')).not.toBeNull()
  })

  it('a non-array supported_services is rejected', () => {
    const bad = validServiceManifest('fab_bad_supported_services_type')
    ;(bad as any).supported_services = 'music_playlist'
    withPatchedPackages({ fab_bad_supported_services_type: bad })
    expect(proposalPackageRegistry.get('fab_bad_supported_services_type')).toBeNull()
  })

  it('a non-boolean hidden field is rejected', () => {
    const bad = validServiceManifest('fab_bad_hidden')
    ;(bad as any).hidden = 'yes'
    withPatchedPackages({ fab_bad_hidden: bad })
    expect(proposalPackageRegistry.get('fab_bad_hidden')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// IndexedDB migration — DB_VERSION 1 -> 2 (driver_profiles added)
// ---------------------------------------------------------------------------

describe('storage/db.ts — v1 -> v2 upgrade adds driver_profiles without losing v1 data', () => {
  it('an existing v1 database (packages seeded) upgrades cleanly and gains driver_profiles', async () => {
    // Simulate a real returning user: open a bare v1 database directly
    // (bypassing db.ts, which only ever opens the CURRENT DB_VERSION) and
    // write a v1-shaped record.
    const v1 = await openDB('aica-hypothesis-simulator', 1, {
      upgrade(db) {
        db.createObjectStore('packages', { keyPath: 'id' })
        db.createObjectStore('scenarios', { keyPath: 'id' })
        db.createObjectStore('runs', { keyPath: 'id' })
        const ev = db.createObjectStore('run_events', { keyPath: ['runId', 'seq'] })
        ev.createIndex('runId', 'runId')
        const fb = db.createObjectStore('feedback', { keyPath: ['runId', 'seq'] })
        fb.createIndex('runId', 'runId')
        db.createObjectStore('settings')
      },
    })
    await v1.put('packages', { id: 'preexisting_pkg', manifest: { id: 'preexisting_pkg' }, origin: 'user' } as any)
    v1.close()

    // db.ts now opens at DB_VERSION 2 — the upgrade path must run and must
    // not touch (let alone drop) the v1 data already on disk.
    const v2 = await getDb()
    const preexisting = await v2.get('packages', 'preexisting_pkg')
    expect(preexisting).toBeTruthy()
    expect(v2.objectStoreNames.contains('driver_profiles')).toBe(true)

    // The new store is usable end-to-end through the public adapter.
    const record = await driverProfileStore.saveProfile({ ja: 'x', en: 'x' }, validProfile())
    expect(await driverProfileStore.getProfile(record.profile_id)).toEqual(record)
  })
})

// ---------------------------------------------------------------------------
// handlers/proposal.ts — the 4 op handlers, called directly
// (mirrors routers/proposal.py's response shapes, including the ROUTER-level
// hidden-package filter on proposal.packages.list — see handlers/proposal.ts doc)
// ---------------------------------------------------------------------------

describe('handlers/proposal.ts', () => {
  it('proposalPresetsList returns { presets } matching presetStore.listSummaries()', async () => {
    const result = await proposalPresetsList()
    expect(result).toEqual({ presets: presetStore.listSummaries() })
  })

  it('proposalPresetsGet returns the full preset for a known id', async () => {
    const id = presetStore.listSummaries()[0].preset_id
    const preset = await proposalPresetsGet({ presetId: id })
    expect((preset as any).preset_id).toBe(id)
  })

  it('proposalPresetsGet throws "preset not found: <id>" for an unknown id (mirrors the 404 detail text)', async () => {
    await expect(proposalPresetsGet({ presetId: 'preset-does-not-exist' })).rejects.toThrow(
      'preset not found: preset-does-not-exist',
    )
  })

  it('proposalPackagesList filters out hidden packages (the mocks) but keeps them in slots/get via the registry', async () => {
    const result = await proposalPackagesList()
    expect(result.packages.some((p) => p.id === 'mock_service_selector_v1')).toBe(false)
    expect(result.packages.some((p) => p.id === 'aica_transparent_service_selector_v1')).toBe(true)
    expect(result.slots).toHaveLength(4)
    expect(result.errors).toEqual([])
  })

  it('proposalCatalogGet returns {provenance, total, songs} for a known dataset, honouring offset/limit', async () => {
    const datasetId = datasetCatalogRegistry.listDatasets()[0].dataset_id
    const full = await proposalCatalogGet({ datasetId })
    expect(full.total).toBeGreaterThan(2)
    expect(full.songs).toHaveLength(full.total)

    const paged = await proposalCatalogGet({ datasetId, offset: 1, limit: 2 })
    expect(paged.total).toBe(full.total) // total is the FULL catalog length, unaffected by paging
    expect(paged.songs).toEqual(full.songs.slice(1, 3))
  })

  it('proposalCatalogGet with only offset (no limit) returns everything from offset onward (Python end=None)', async () => {
    const datasetId = datasetCatalogRegistry.listDatasets()[0].dataset_id
    const full = await proposalCatalogGet({ datasetId })
    const fromOffset = await proposalCatalogGet({ datasetId, offset: 2 })
    expect(fromOffset.songs).toEqual(full.songs.slice(2))
  })

  it('proposalCatalogGet throws "Unknown dataset_id: \'<id>\'" for an unknown dataset (mirrors the 404 detail text)', async () => {
    await expect(proposalCatalogGet({ datasetId: 'no-such-dataset' })).rejects.toThrow(
      "Unknown dataset_id: 'no-such-dataset'",
    )
  })
})

// ---------------------------------------------------------------------------
// RPC wiring — proposal.* ops resolve through api/rpc.ts's RpcOp type and
// engine/worker/router.ts's router map, end-to-end through dispatch()
// (the same envelope-building path a real worker/main-thread RPC call uses).
// ---------------------------------------------------------------------------

describe('RPC wiring — proposal.* ops', () => {
  it('proposal.presets.list resolves through dispatch() with the ok envelope', async () => {
    const res = await dispatch({ op: 'proposal.presets.list' })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as any).presets.length).toBeGreaterThan(0)
  })

  it('proposal.presets.get resolves a known preset through dispatch()', async () => {
    const id = presetStore.listSummaries()[0].preset_id
    const res = await dispatch({ op: 'proposal.presets.get', params: { presetId: id } })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as any).preset_id).toBe(id)
  })

  it('proposal.presets.get on an unknown id resolves the error envelope (not a hang/throw across the RPC boundary)', async () => {
    const res = await dispatch({ op: 'proposal.presets.get', params: { presetId: 'preset-does-not-exist' } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toBe('preset not found: preset-does-not-exist')
  })

  it('proposal.packages.list resolves through dispatch()', async () => {
    const res = await dispatch({ op: 'proposal.packages.list' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const result = res.result as any
      expect(result.slots).toHaveLength(4)
      expect(Array.isArray(result.packages)).toBe(true)
      expect(Array.isArray(result.errors)).toBe(true)
    }
  })

  it('proposal.catalog.get resolves through dispatch()', async () => {
    const datasetId = datasetCatalogRegistry.listDatasets()[0].dataset_id
    const res = await dispatch({ op: 'proposal.catalog.get', params: { datasetId } })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as any).provenance.dataset_id).toBe(datasetId)
  })
})
