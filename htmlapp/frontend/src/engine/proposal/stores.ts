/**
 * Proposal-domain stores — thin adapters over C0's data registry.
 *
 * Ported from five Python directory-scanning registries (behavior-of-record):
 *   services/preset_store.py               -> presetStore
 *   services/dataset_catalog_registry.py    -> datasetCatalogRegistry
 *   services/driver_profile_store.py        -> driverProfileStore
 *   services/world_seed_store.py            -> worldSeedStore
 *   services/proposal_package_registry.py   -> proposalPackageRegistry
 *
 * Each Python class scans a directory (`presets_dir`, `dataset_dir`, ...) at
 * construction time. htmlapp has no filesystem: the SAME data is already
 * loaded and validated by C0's data seam (`../../data/registry.ts`) from the
 * identical committed `proposal_contracts/**`/`packages/**` sources. These
 * stores therefore never scan or re-validate that data — they map each
 * Python public method onto the matching registry accessor. Re-implementing
 * directory scanning here would create a second source of truth for data the
 * registry already owns.
 *
 * Full method mapping (see task-1-report.md for the complete table):
 *   PresetStore.list_summaries/get               -> presetStore.listSummaries/get
 *   DatasetCatalogRegistry.list_datasets/
 *     get_catalog/get_provenance                 -> datasetCatalogRegistry.listDatasets/getCatalog/getProvenance
 *   WorldSeedStore.list_seeds/get_seed            -> worldSeedStore.listSeeds/getSeed
 *   DriverProfileStore.list_profiles/get_profile/
 *     save_profile/delete_profile                -> driverProfileStore.listProfiles/getProfile/saveProfile/deleteProfile
 *   ProposalPackageRegistry.list_summaries/get/
 *     list_slots                                 -> proposalPackageRegistry.listSummaries/get/listSlots
 *
 * `list_errors()` is NOT ported for presetStore/datasetCatalogRegistry/
 * worldSeedStore/driverProfileStore(builtins): those Python methods report
 * quarantined/malformed files from the directory scan this module never
 * performs — the C0 registry's own boot-time `installRegistry()` validation
 * (`../../data/registry.ts`) is the equivalent integrity gate for this data,
 * and no op in this task surfaces per-file load errors. `PresetStore` has no
 * `list_errors()` at all in Python (it raises `PresetLoadError` instead —
 * also moot here for the same reason).
 *
 * Two places this is NOT a pure adapter (see module docs below for detail):
 *   1. driverProfileStore.saveProfile/deleteProfile WRITE, via IndexedDB
 *      (`../../storage/driver_profiles_store.ts`) — C0's registry is read-only.
 *   2. proposalPackageRegistry selects the INVERSE manifest set to the
 *      trigger `packageRegistry` (manifests that DO declare kind/family) and
 *      re-validates them against ProposalPackageManifest's own required
 *      fields, distinct from the trigger PackageManifest's.
 *
 * Layering convention (mirrors each Python module's own layering): every
 * `get*`/`getCatalog`/`getProvenance`/`getProfile`/`getSeed` accessor here
 * returns `null` on a miss, exactly like the Python registry method it
 * ports — none of them raises. The not-found -> thrown-error translation
 * (Python's router 404/422) happens one layer up, in
 * `../worker/handlers/proposal.ts`, for the two ops that need it
 * (`proposal.presets.get`, `proposal.catalog.get`). This differs from the
 * TRIGGER-side `package_registry.ts`/`scenario_registry.ts` adapters (whose
 * `.get()` throws directly) because in Python, the trigger routers 404
 * differently than `routers/proposal.py` does — this module follows ITS OWN
 * source of record rather than an unrelated sibling's convention.
 */
import {
  getPresets,
  getPreset,
  getProfiles,
  getProfile as getRegistryProfile,
  getSeeds,
  getSeed,
  getPackageManifests,
  getDatasetIds,
  getDataset,
} from '../../data/registry'
import { isProposalFamilyManifest } from '../../data/packages/validate'
import { driverProfilesStore } from '../../storage/driver_profiles_store'
import type { DriverProfileRecord as StoredDriverProfileRecord } from '../../storage/db'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type BilingualLabel = { ja: string; en: string }

// ---------------------------------------------------------------------------
// presetStore — services/preset_store.py
// ---------------------------------------------------------------------------

export type PresetDoc = Record<string, unknown> & { preset_id: string }

export type PresetSummary = {
  preset_id: string
  label: BilingualLabel
  brief: BilingualLabel
  category: string
  family: string
  journey: unknown | null
  contrast_with: string | null
  hypothesis: string
}

export const presetStore = {
  /**
   * PresetStore.list_summaries() -> list[PresetSummary], sorted by
   * preset_id. `getPresets()` (`../../data/registry.ts#values`) already
   * returns entries sorted by their object key, and
   * `installRegistry`/`validate()` guarantees every preset's own
   * `preset_id` field equals that key — so this is the same ordering
   * Python's `sorted(..., key=lambda p: p.preset_id)` produces, not a
   * coincidence.
   */
  listSummaries(): PresetSummary[] {
    return (getPresets() as PresetDoc[]).map((doc) => {
      const expectation = (doc.expectation as Record<string, unknown> | undefined) ?? {}
      return {
        preset_id: doc.preset_id,
        label: doc.label as BilingualLabel,
        brief: doc.brief as BilingualLabel,
        category: doc.category as string,
        family: doc.family as string,
        journey: (doc.journey as unknown) ?? null,
        contrast_with: (doc.contrast_with as string | undefined) ?? null,
        hypothesis: expectation.hypothesis as string,
      }
    })
  },

  /** PresetStore.get(preset_id) -> Preset | None. */
  get(presetId: string): PresetDoc | null {
    return getPreset(presetId) as PresetDoc | null
  },
}

// ---------------------------------------------------------------------------
// datasetCatalogRegistry — services/dataset_catalog_registry.py
// ---------------------------------------------------------------------------

export type DatasetVersion = {
  schema_version: string
  spotify_track_reference_version: string
  spotify_audio_features_reference_version: string
}

export type DatasetListEntry = {
  dataset_id: string
  dataset_version: DatasetVersion
  dataset_hash: string
  tier: string
  synthetic_only: boolean
  song_count: number
}

/** Matches the inline `provenance` dict `routers/proposal.py#get_dataset_catalog`
 * returns — a DIFFERENT projection than `DatasetListEntry` above (no
 * synthetic_only/song_count; adds provenance_note). */
export type DatasetProvenanceView = {
  dataset_id: string
  dataset_version: DatasetVersion
  dataset_hash: string
  tier: string
  provenance_note: string
}

function datasetVersion(manifest: Record<string, unknown>): DatasetVersion {
  return {
    schema_version: manifest.schema_version as string,
    spotify_track_reference_version: manifest.spotify_track_reference_version as string,
    spotify_audio_features_reference_version: manifest.spotify_audio_features_reference_version as string,
  }
}

export const datasetCatalogRegistry = {
  /**
   * DatasetCatalogRegistry.list_datasets() -> list[dict] (provenance
   * summaries + song_count). `getDatasetIds()` returns ids sorted
   * lexicographically, matching Python's `self._provenance.items()`
   * insertion order (scan order = `sorted(dataset_dir.iterdir())`) because
   * `collect-data.mjs` sorts by the same `dataset_id` key when building the
   * payload — confirmed the committed dataset directory name equals its
   * `dataset_id` field, so the two orderings are the same sort key, not a
   * coincidence.
   */
  listDatasets(): DatasetListEntry[] {
    return getDatasetIds().map((id) => {
      const entry = getDataset(id)!
      const manifest = entry.manifest as unknown as Record<string, unknown>
      const catalog = entry.catalog as unknown[]
      return {
        dataset_id: manifest.dataset_id as string,
        dataset_version: datasetVersion(manifest),
        dataset_hash: manifest.dataset_hash as string,
        tier: manifest.tier as string,
        synthetic_only: manifest.synthetic_only as boolean,
        song_count: Array.isArray(catalog) ? catalog.length : 0,
      }
    })
  },

  /** DatasetCatalogRegistry.get_catalog(dataset_id) -> list[Song] | None. */
  getCatalog(datasetId: string): unknown[] | null {
    const entry = getDataset(datasetId)
    if (!entry) return null
    return entry.catalog as unknown[]
  },

  /** DatasetCatalogRegistry.get_provenance(dataset_id) -> DatasetProvenance | None. */
  getProvenance(datasetId: string): DatasetProvenanceView | null {
    const entry = getDataset(datasetId)
    if (!entry) return null
    const manifest = entry.manifest as unknown as Record<string, unknown>
    return {
      dataset_id: manifest.dataset_id as string,
      dataset_version: datasetVersion(manifest),
      dataset_hash: manifest.dataset_hash as string,
      tier: manifest.tier as string,
      provenance_note: manifest.provenance_note as string,
    }
  },
}

// ---------------------------------------------------------------------------
// worldSeedStore — services/world_seed_store.py
// ---------------------------------------------------------------------------

export type SeedDoc = Record<string, unknown> & { seed_id: string }

export type SeedSummary = { seed_id: string; label: BilingualLabel; description: BilingualLabel }

export const worldSeedStore = {
  /** WorldSeedStore.list_seeds() -> list[dict] ({seed_id, label, description}). */
  listSeeds(): SeedSummary[] {
    return (getSeeds() as SeedDoc[]).map((doc) => ({
      seed_id: doc.seed_id,
      label: doc.label as BilingualLabel,
      description: doc.description as BilingualLabel,
    }))
  },

  /** WorldSeedStore.get_seed(seed_id) -> SeedWorld | None. */
  getSeed(seedId: string): SeedDoc | null {
    return getSeed(seedId) as SeedDoc | null
  },
}

// ---------------------------------------------------------------------------
// driverProfileStore — services/driver_profile_store.py
// ---------------------------------------------------------------------------
//
// NOT a pure adapter (task hazard #1): save_profile/delete_profile WRITE.
// Built-ins come from the read-only C0 registry (getProfiles/getProfile);
// user profiles persist to IndexedDB (`../../storage/driver_profiles_store.ts`)
// alongside the existing package/scenario stores. Built-in profiles are
// never deletable — mirrors Python's DriverProfileConflictError exactly.

export type DriverProfileDoc = {
  profile_id: string
  label: BilingualLabel
  builtin: boolean
  profile: Record<string, unknown>
}

export type DriverProfileSummary = { profile_id: string; label: BilingualLabel; builtin: boolean }

export type FieldValidationError = { field: string; message: string }

/** Mirrors DriverProfileNotFoundError (services/driver_profile_store.py). */
export class DriverProfileNotFoundError extends Error {
  constructor(profileId: string) {
    super(`Unknown driver profile_id: '${profileId}'`)
    this.name = 'DriverProfileNotFoundError'
  }
}

/** Mirrors DriverProfileConflictError (services/driver_profile_store.py). */
export class DriverProfileConflictError extends Error {
  constructor(profileId: string) {
    super(`Cannot delete built-in driver profile: '${profileId}'`)
    this.name = 'DriverProfileConflictError'
  }
}

/**
 * Mirrors `pydantic.ValidationError` raised by `DriverProfileStore.save_profile`
 * (label -> BilingualLabel, profile -> DriverProfile). NOT a full port of
 * DriverProfile's field-level pydantic validators (percent/unit-interval
 * range maps, the 0.1 enthusiasm grid, etc.) — that surface belongs to
 * world/profile validation (Task 2's `world_validation.ts` territory per the
 * C2 plan), not this foundation task. This checks only DriverProfile's
 * REQUIRED (no-default) fields — `oshi_registered`, `oshi_mode`, `age_band`,
 * `gender` — plus the one explicit `@model_validator`
 * (`_oshi_artists_no_duplicate_ids`). See task-1-report.md for the concern
 * this leaves open.
 */
export class DriverProfileValidationError extends Error {
  readonly errors: FieldValidationError[]
  constructor(errors: FieldValidationError[]) {
    super(`invalid driver profile: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`)
    this.name = 'DriverProfileValidationError'
    this.errors = errors
  }
}

const OSHI_MODES = new Set(['on', 'off'])
const AGE_BANDS = new Set(['teens', '20s', '30s', '40s', '50s', '60plus'])
const GENDERS = new Set(['male', 'female', 'non_binary', 'unspecified'])

function validateBilingualLabel(value: unknown): BilingualLabel {
  const errors: FieldValidationError[] = []
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (typeof v.ja !== 'string') errors.push({ field: 'label.ja', message: 'field required, must be a string' })
  if (typeof v.en !== 'string') errors.push({ field: 'label.en', message: 'field required, must be a string' })
  if (errors.length) throw new DriverProfileValidationError(errors)
  return { ja: v.ja as string, en: v.en as string }
}

function validateDriverProfileShape(value: unknown): Record<string, unknown> {
  const errors: FieldValidationError[] = []
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>

  if (typeof v.oshi_registered !== 'boolean') {
    errors.push({ field: 'profile.oshi_registered', message: 'field required, must be a boolean' })
  }
  if (typeof v.oshi_mode !== 'string' || !OSHI_MODES.has(v.oshi_mode)) {
    errors.push({ field: 'profile.oshi_mode', message: "must be one of 'on', 'off'" })
  }
  if (typeof v.age_band !== 'string' || !AGE_BANDS.has(v.age_band)) {
    errors.push({ field: 'profile.age_band', message: `must be one of ${[...AGE_BANDS].join(', ')}` })
  }
  if (typeof v.gender !== 'string' || !GENDERS.has(v.gender)) {
    errors.push({ field: 'profile.gender', message: `must be one of ${[...GENDERS].join(', ')}` })
  }

  const oshiArtists = v.oshi_artists
  if (oshiArtists !== undefined) {
    if (!Array.isArray(oshiArtists)) {
      errors.push({ field: 'profile.oshi_artists', message: 'must be an array' })
    } else {
      const seen = new Set<string>()
      for (const artist of oshiArtists) {
        const artistId = (artist as Record<string, unknown> | null)?.artist_id
        if (typeof artistId === 'string') {
          if (seen.has(artistId)) {
            errors.push({
              field: 'profile.oshi_artists',
              message: `Duplicate oshi artist_id '${artistId}' in oshi_artists`,
            })
          }
          seen.add(artistId)
        }
      }
    }
  }

  if (errors.length) throw new DriverProfileValidationError(errors)
  return v
}

// Collision-resistant id; mirrors Python's dprof_<ts>_<hex>. Runs ONCE per
// save, outside any deterministic loop — same technique as
// `../worker/handlers/runs.ts#makeRunId`.
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}
function makeProfileId(): string {
  return `dprof_${Date.now().toString(36)}_${randHex(6)}`
}

function summarizeProfile(doc: { profile_id: string; label: BilingualLabel; builtin: boolean }): DriverProfileSummary {
  return { profile_id: doc.profile_id, label: doc.label, builtin: doc.builtin }
}

export const driverProfileStore = {
  /**
   * DriverProfileStore.list_profiles() -> built-ins then user profiles.
   * Builtins: `getProfiles()` (sorted by profile_id, same reasoning as
   * `presetStore.listSummaries`). User profiles: IndexedDB `getAll()` over a
   * `profile_id`-keyed store walks in ascending key order by default,
   * matching Python's `sorted(profiles_dir.glob("*.json"))` (filename stem
   * == profile_id).
   */
  async listProfiles(): Promise<DriverProfileSummary[]> {
    const builtins = (getProfiles() as DriverProfileDoc[]).map(summarizeProfile)
    const userRecords = await driverProfilesStore.list()
    const users = userRecords.map(summarizeProfile)
    return [...builtins, ...users]
  },

  /** DriverProfileStore.get_profile(profile_id) -> DriverProfileRecord | None. Built-ins checked first. */
  async getProfile(profileId: string): Promise<DriverProfileDoc | null> {
    const builtin = getRegistryProfile(profileId) as DriverProfileDoc | null
    if (builtin) return builtin
    const rec = await driverProfilesStore.get(profileId)
    return rec ?? null
  },

  /**
   * DriverProfileStore.save_profile(label, profile) -> DriverProfileRecord.
   * Validates then persists a NEW user profile (builtin=false).
   * Throws DriverProfileValidationError on an invalid label/profile.
   */
  async saveProfile(label: unknown, profile: unknown): Promise<DriverProfileDoc> {
    const validatedLabel = validateBilingualLabel(label)
    const validatedProfile = validateDriverProfileShape(profile)
    const record: StoredDriverProfileRecord = {
      profile_id: makeProfileId(),
      label: validatedLabel,
      builtin: false,
      profile: validatedProfile,
    }
    await driverProfilesStore.put(record)
    return record
  },

  /**
   * DriverProfileStore.delete_profile(profile_id) -> None.
   * Throws DriverProfileConflictError for a built-in id,
   * DriverProfileNotFoundError for an unknown user id.
   */
  async deleteProfile(profileId: string): Promise<void> {
    const builtin = getRegistryProfile(profileId)
    if (builtin) throw new DriverProfileConflictError(profileId)
    const existing = await driverProfilesStore.get(profileId)
    if (!existing) throw new DriverProfileNotFoundError(profileId)
    await driverProfilesStore.delete(profileId)
  },
}

// ---------------------------------------------------------------------------
// proposalPackageRegistry — services/proposal_package_registry.py
// ---------------------------------------------------------------------------
//
// NOT a pure adapter (task hazard #2): selects the INVERSE manifest set to
// the trigger `packageRegistry` (`../services/package_registry.ts`) —
// manifests that DO declare kind/family (`isProposalFamilyManifest`,
// `../../data/packages/validate.ts`) — and validates them against
// ProposalPackageManifest's OWN required fields (family/approach/
// contract_version/algorithm.type=='python_module'/parameters/
// hyperparameters[], and content_selector requiring non-empty
// supported_services), which is a different model from the trigger
// PackageManifest `isProposalFamilyManifest`'s sibling
// `builtinManifestValidationError` checks.

export type HyperparameterDefDoc = {
  key: string
  kind: string
  label: BilingualLabel
  default: unknown
  [k: string]: unknown
}

export type ProposalPackageSummary = {
  id: string
  family: string
  approach: string
  label: BilingualLabel
  supported_services: string[]
  parameters: Record<string, unknown>
  hyperparameters: HyperparameterDefDoc[]
  hidden: boolean
}

/** Mirrors the {package_dir, error} shape `ProposalPackageRegistry._scan`
 * appends to `self._errors` — NOT the trigger side's {source, message}
 * `RegistryError` shape (`../../api/types.ts`). htmlapp has no package
 * directory path, so `package_dir` carries the manifest's own id (or a
 * positional fallback), mirroring `../../data/packages/index.ts#errorSource`. */
export type ProposalPackageError = { package_dir: string; error: string }

export type ProposalPackageSlot = { family: string; approach: string; package_id: string | null }

const PROPOSAL_FAMILIES = ['service_selector', 'content_selector'] as const
const PROPOSAL_APPROACHES = ['transparent', 'constrained_llm'] as const
const HYPERPARAM_KINDS = new Set(['matrix', 'table', 'map', 'numeric', 'enum', 'string'])
// The 14 ServiceId members (aica_api.models.proposal.enums.ServiceId).
const SERVICE_IDS = new Set([
  'music_playlist', 'humming_karaoke', 'call_response_driving', 'quiz', 'ranking_creation',
  'radio_style', 'conversation_audio', 'live_viewing', 'stretch_video', 'full_karaoke',
  'call_response_stopped', 'oshi_reexperience', 'relaxation_multisensory', 'linked_video_recommendation',
])

/**
 * ALL_FAMILY_SLOTS (hazard #2/#4 — Python's `tuple(product(ProposalPackageFamily,
 * ProposalPackageApproach))`): itertools.product iterates the OUTER iterable
 * (family) slowest, the INNER (approach) fastest, both in enum declaration
 * order. Declared explicitly here rather than derived from any iteration
 * order this module controls, so the 4-slot order can never drift from
 * Python's regardless of how PROPOSAL_FAMILIES/PROPOSAL_APPROACHES above are
 * later edited.
 */
const ALL_FAMILY_SLOTS: ReadonlyArray<{ family: string; approach: string }> = [
  { family: 'service_selector', approach: 'transparent' },
  { family: 'service_selector', approach: 'constrained_llm' },
  { family: 'content_selector', approach: 'transparent' },
  { family: 'content_selector', approach: 'constrained_llm' },
]

/**
 * Required-field validation for a PROPOSAL-family manifest, mirroring
 * `ProposalPackageManifest` (`app/api/aica_api/models/proposal/package_manifest.py`)
 * exactly: id/version/contract_version strings, label + every hyperparameter
 * label a {ja,en} BilingualLabel, family/approach enum membership,
 * algorithm.type literally 'python_module', parameters an object,
 * hyperparameters a well-shaped array, supported_services (if present) only
 * known ServiceIds, and the `content_family_requires_supported_services`
 * model_validator (family=='content_selector' -> non-empty
 * supported_services). Returns null when the manifest is usable, or a
 * human-readable reason otherwise — callers must run
 * `isProposalFamilyManifest` first (a manifest with no kind/family at all is
 * a trigger package, skipped silently, never validated against this model).
 */
function proposalManifestValidationError(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return 'manifest is not an object'
  const m = manifest as Record<string, unknown>

  if (typeof m.id !== 'string') return "'id' must be a string"
  if (typeof m.version !== 'string') return "'version' must be a string"

  const label = m.label as Record<string, unknown> | undefined
  if (!label || typeof label.ja !== 'string' || typeof label.en !== 'string') {
    return "'label' must be an object with string 'ja' and 'en' fields"
  }

  if (typeof m.family !== 'string' || !(PROPOSAL_FAMILIES as readonly string[]).includes(m.family)) {
    return `'family' must be one of ${PROPOSAL_FAMILIES.join(', ')}`
  }
  if (typeof m.approach !== 'string' || !(PROPOSAL_APPROACHES as readonly string[]).includes(m.approach)) {
    return `'approach' must be one of ${PROPOSAL_APPROACHES.join(', ')}`
  }
  if (typeof m.contract_version !== 'string') return "'contract_version' must be a string"

  const algorithm = m.algorithm as Record<string, unknown> | undefined
  if (!algorithm || algorithm.type !== 'python_module') return "'algorithm.type' must be 'python_module'"
  if (typeof algorithm.entrypoint !== 'string') return "'algorithm.entrypoint' must be a string"
  if (
    algorithm.error_mode !== undefined &&
    algorithm.error_mode !== 'blocking' &&
    algorithm.error_mode !== 'non_blocking'
  ) {
    return "'algorithm.error_mode' must be 'blocking' or 'non_blocking'"
  }

  const parameters = m.parameters
  if (parameters === undefined || parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return "'parameters' must be an object"
  }

  const hyperparameters = m.hyperparameters
  if (!Array.isArray(hyperparameters)) return "'hyperparameters' must be an array"
  for (const hp of hyperparameters) {
    if (!hp || typeof hp !== 'object') return "every 'hyperparameters' entry must be an object"
    const h = hp as Record<string, unknown>
    if (typeof h.key !== 'string') return "hyperparameter 'key' must be a string"
    if (typeof h.kind !== 'string' || !HYPERPARAM_KINDS.has(h.kind)) {
      return `hyperparameter 'kind' must be one of ${[...HYPERPARAM_KINDS].join(', ')}`
    }
    const hLabel = h.label as Record<string, unknown> | undefined
    if (!hLabel || typeof hLabel.ja !== 'string' || typeof hLabel.en !== 'string') {
      return "hyperparameter 'label' must be an object with string 'ja' and 'en' fields"
    }
    if (!('default' in h)) return "hyperparameter 'default' is required"
  }

  const supportedServices = m.supported_services
  if (supportedServices !== undefined) {
    if (!Array.isArray(supportedServices)) return "'supported_services' must be an array"
    for (const s of supportedServices) {
      if (typeof s !== 'string' || !SERVICE_IDS.has(s)) {
        return `'supported_services' contains an unknown service id: ${JSON.stringify(s)}`
      }
    }
  }

  if (m.family === 'content_selector' && (!Array.isArray(supportedServices) || supportedServices.length === 0)) {
    return 'A content_selector manifest requires a non-empty supported_services list.'
  }

  if (m.hidden !== undefined && typeof m.hidden !== 'boolean') return "'hidden' must be a boolean"

  return null
}

function toProposalSummary(manifest: Record<string, unknown>): ProposalPackageSummary {
  return {
    id: manifest.id as string,
    family: manifest.family as string,
    approach: manifest.approach as string,
    label: manifest.label as BilingualLabel,
    supported_services: (manifest.supported_services as string[] | undefined) ?? [],
    parameters: manifest.parameters as Record<string, unknown>,
    hyperparameters: manifest.hyperparameters as HyperparameterDefDoc[],
    hidden: (manifest.hidden as boolean | undefined) ?? false,
  }
}

/**
 * Family-routes + validates every bundled manifest, once per call (mirrors
 * `_scan` running once at Python construction time — this module has no
 * persistent instance to construct, so it re-derives from the registry on
 * every call instead; the registry itself is already memoized). Manifests
 * with no kind/family at all are trigger packages and are never even
 * candidates (skipped silently, matching Python's `data.get("family") is
 * None: continue`) — never reported as errors, unlike a family-bearing
 * manifest that fails ProposalPackageManifest validation.
 */
function loadValidProposalPackages(): { valid: Record<string, unknown>[]; errors: ProposalPackageError[] } {
  const candidates = (getPackageManifests() as unknown as Record<string, unknown>[]).filter(isProposalFamilyManifest)
  const valid: Record<string, unknown>[] = []
  const errors: ProposalPackageError[] = []
  candidates.forEach((manifest, index) => {
    const problem = proposalManifestValidationError(manifest)
    if (problem === null) {
      valid.push(manifest)
    } else {
      const id = typeof manifest.id === 'string' && manifest.id.length > 0
        ? manifest.id
        : `<unknown manifest at payload index ${index}>`
      errors.push({ package_dir: id, error: problem })
    }
  })
  return { valid, errors }
}

export const proposalPackageRegistry = {
  /** ProposalPackageRegistry.list_summaries() -> list[dict], PLUS `errors`
   * bundled into one call (mirrors the trigger `packageRegistry.listSummaries()`
   * convention, `../services/package_registry.ts`) rather than Python's
   * separate `list_errors()` method. */
  listSummaries(): { packages: ProposalPackageSummary[]; errors: ProposalPackageError[] } {
    const { valid, errors } = loadValidProposalPackages()
    return { packages: valid.map(toProposalSummary), errors }
  },

  /** ProposalPackageRegistry.get(package_id) -> ProposalPackageManifest | None. */
  get(packageId: string): Record<string, unknown> | null {
    const { valid } = loadValidProposalPackages()
    return valid.find((m) => m.id === packageId) ?? null
  },

  /**
   * ProposalPackageRegistry.list_slots() -> the 4 canonical (family,
   * approach) slots + which package_id (if any) fills each. First-package-
   * per-slot wins (Python's `by_slot.setdefault`) over packages in ascending
   * id order (`getPackageManifests()` — see module doc for why that order
   * equals Python's directory-scan order). Always exactly 4 entries, even
   * with zero packages loaded.
   */
  listSlots(): ProposalPackageSlot[] {
    const { valid } = loadValidProposalPackages()
    const bySlot = new Map<string, string>()
    for (const pkg of valid) {
      const slotKey = `${pkg.family as string}/${pkg.approach as string}`
      if (!bySlot.has(slotKey)) bySlot.set(slotKey, pkg.id as string)
    }
    return ALL_FAMILY_SLOTS.map(({ family, approach }) => ({
      family,
      approach,
      package_id: bySlot.get(`${family}/${approach}`) ?? null,
    }))
  },
}
