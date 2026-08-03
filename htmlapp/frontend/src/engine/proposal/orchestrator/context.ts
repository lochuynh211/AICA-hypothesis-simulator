/**
 * Orchestrator context builders — TS port of the SelectorInput-shaped
 * context-assembly helpers in `app/api/aica_api/routers/proposal.py`:
 * `_build_service_context` (44 LOC), `_build_content_context` (56),
 * `_build_real_content_context` (76), `_resolve_oshi_artist` (31),
 * `_genre_affinity_artist_genres` (20), `_resolve_song_name` (19),
 * `_resolve_song_artist` (19), `_dataset_id_for_run` (17),
 * `_catalog_map_for_dataset` (14), `_redact_catalog_for_evidence` (35) —
 * feature 026 (htmlapp Combined export), slice C4a Task 2.
 *
 * These turn a run's setup plus the song/service catalogs into the context
 * dict the selectors consume. Port functions, not endpoints — HTTP framing
 * (status codes, the actual `dispatch_selector` call, the real/mock package
 * choice at `_dispatch_content_for_service`'s call site) is a LATER C4a
 * task; nothing here dispatches a selector or touches HTTP.
 *
 * ── Step 1: which of these read the catalog, and how that maps onto the
 * data registry ──────────────────────────────────────────────────────────
 *
 * `_catalog_map_for_dataset` and `_genre_affinity_artist_genres` are the two
 * functions that read the frozen dataset catalog; every other function here
 * either builds a plain context dict from already-resolved arguments or
 * calls one of those two. Per Task 1's note, `_get_dataset_registry()` maps
 * onto `datasetCatalogRegistry` (`../stores.ts`) — reused here, not
 * re-derived:
 *
 *   _catalog_map_for_dataset(dataset_id)
 *     Python: `_get_dataset_registry().get_catalog(dataset_id)` -> build
 *     `{track_id: Song.model_dump(mode="json")}`.
 *     TS: `datasetCatalogRegistry.getCatalog(datasetId)` (`../stores.ts`,
 *     already bound to the same committed `proposal_contracts/dataset/**`
 *     data) -> build `{track_id: song}` from the RAW parsed catalog entry,
 *     not a re-serialized "Song" model — htmlapp has no Song-schema pydantic
 *     port to round-trip through (see "KNOWN PRE-EXISTING DIVERGENCE" below
 *     for exactly what that costs).
 *
 *   _genre_affinity_artist_genres(dataset_id)
 *     Python: reads `<dataset_dir>/<dataset_id>/genre_affinity_v1.json`
 *     straight off disk (`path.exists()` + `read_json`) — this module's ONE
 *     direct filesystem read among these 10 functions.
 *     TS: no filesystem — `collect-data.mjs` already parses this exact file
 *     at BUILD time into `DatasetEntry.genreAffinity` (`null` when the file
 *     doesn't exist for that dataset, same as Python's `path.exists()`
 *     check), so this reads `getDataset(datasetId)?.genreAffinity`
 *     (`../../../data/registry.ts`) directly — the same "no filesystem,
 *     already-scanned-at-boot" substitution `context_base.ts`'s own module
 *     doc documents for `_get_registry`/`_get_dataset_registry`. Note this
 *     goes around `datasetCatalogRegistry` (which has no `genreAffinity`
 *     accessor) straight to the registry, exactly as `context_base.ts`
 *     itself does for `_get_service_capabilities`/`_matrix_path`.
 *
 * KNOWN PRE-EXISTING DIVERGENCE (not introduced by this task): Python's
 * `_catalog_map_for_dataset` round-trips every song through
 * `Song.model_validate(...).model_dump(mode="json")` — pydantic's
 * `extra="ignore"` config on `SpotifyTrack` DROPS an undeclared
 * `spotify_track.language` field the raw committed `catalog.json` actually
 * carries, ADDS `linked_from`/`preview_url`/`restrictions` (declared,
 * defaulted-to-null fields absent from the raw JSON), and reorders both the
 * top-level `{simulation_flags, spotify_audio_features, spotify_track}` keys
 * and `spotify_track`'s own keys to the Song model's field-declaration
 * order (verified directly: `Song.model_validate(catalog.json[i]).model_
 * dump_json()` differs from the raw entry in exactly these three ways, for
 * all 300 committed songs). htmlapp has no Song-schema pydantic port to
 * reproduce that round-trip, and porting one is out of this task's ~331-LOC
 * scope — `datasetCatalogRegistry.getCatalog()` already returns the RAW
 * parsed `catalog.json` entries (a decision this task inherits, not makes:
 * `collect-data.mjs` captures them raw, and the already-ported content-
 * selector algorithm — `../../../data/packages/builtin/
 * aica_transparent_content_selector_v1.ts` — already reads directly off that
 * raw shape via a permissive `ContentSong` type with an index-signature
 * fallback for anything else). This function's own OBSERVABLE behavior
 * (`_resolve_song_name`/`_resolve_song_artist`/`_resolve_oshi_artist` below,
 * and the real content selector's own field reads) is unaffected — every
 * field any of them touch (`spotify_track.{id,name,artists[].{id,name}}`)
 * is byte-identical between the raw and model-dumped shapes; only the
 * dropped/added/reordered fields nothing in this port reads are affected. A
 * byte-for-byte diff of `feature_snapshot.catalog` between a docker run and
 * an htmlapp run would show this — but `_redact_catalog_for_evidence` (see
 * below) strips `catalog` down to a `{dataset_id, song_count}` marker before
 * anything persists it, so this divergence never reaches the evidence log
 * either app actually keeps.
 *
 * ── Step 2: the `.get(key, default)` / `x or default` idiom ────────────
 *
 * Python's `dict.get(key, default)` returns `default` ONLY when `key` is
 * ABSENT — a key present with value `None` is returned as `None`, not
 * `default`. `pyGetDefault` below mirrors that exactly (`catalog_version`,
 * `artist_genres`); every OTHER `x or default` site in these functions
 * (`world_snapshot.get("feature_snapshot") or {}`, `ev.output.get(...) or
 * {}`, etc.) is a Python TRUTHINESS check, where an empty dict/list is
 * falsy — `pyTruthy`/`pyOr` below mirror THAT instead (plain `??`/`||` would
 * both be wrong: `??` treats a present empty dict as defined-and-kept, `||`
 * treats any falsy JS value including `0`/`""` as absent). The one place
 * this is directly observable rather than incidental: `_build_content_context`
 * /`_build_real_content_context`'s `package_runtime_state` loop skips a
 * "service" evidence entry whose `output` is a Python-falsy EMPTY dict
 * (`{}`, truthy in JS) to find a LATER entry with real content — a naive
 * `if (ev.output)` port would stop at the empty one instead. See the
 * `package_runtime_state_skips_wrong_step_and_falsy_empty_output` golden
 * case, which specifically encodes this ordering.
 *
 * ── Hazard pass ──────────────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` in any of the 10 functions —
 *   N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): THREE sites, each reproduced via a
 *   construct whose order is structurally guaranteed, not incidental:
 *     1. `_catalog_map_for_dataset`'s `{track_id: song}` map — built with a
 *        `for` loop over `datasetCatalogRegistry.getCatalog()`'s array (the
 *        catalog's own committed list order), assigning one key per
 *        iteration; JS object insertion order for non-array-index string
 *        keys (`"synthetic-track-0001"`, never numeric) is guaranteed
 *        insertion order, matching Python's dict-comprehension order over
 *        the same list.
 *     2. `_build_content_context`/`_build_real_content_context`'s
 *        `eligible_candidates = [{"candidate_id": tid} for tid in
 *        catalog]` — `Object.keys(catalog).map(...)`, which walks the SAME
 *        object whose insertion order was itself fixed at (1).
 *     3. `_build_real_content_context`'s `gav1.update(_genre_affinity_
 *        artist_genres(...))` — Python's `dict.update()` keeps a
 *        pre-existing key's ORIGINAL position when overwriting its value,
 *        and appends brand-new keys at the end. `{ ...gav1Base,
 *        ...genreAffinityResult }` (object spread) has the identical
 *        semantics for the same reason: a key already present in `gav1Base`
 *        keeps its first-assigned position when `genreAffinityResult`
 *        overwrites its value; a key only in `genreAffinityResult`
 *        (`artist_genres`, always — World-owned `genre_affinity_v1` never
 *        sets that key itself) is appended. Verified directly against the
 *        real interpreter: `usage_by_genre`, `scene_genre_usage` (World-set,
 *        in that order), then `artist_genres` (appended) — see the
 *        `genre_extension_on_merges_artist_genres_and_picks_real_runtime_state`
 *        golden case's `feature_snapshot.genre_affinity_v1` key order.
 * - Hazard 5 (bare `str(float)`): no float fields read/written by these
 *   functions (they pass `feature_snapshot`/`hyperparameters`/etc through
 *   opaquely) — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): audited PER
 *   SITE, per the brief. Only TWO `isinstance` calls exist in any of these
 *   10 functions, both in `_redact_catalog_for_evidence`:
 *   `isinstance(feature_snapshot, dict)` and `isinstance(catalog, dict)`.
 *   Neither is the `(int, float)` pattern hazard 8 names — a `dict` check
 *   has no bool-subclasses-int interaction at all (a Python `bool` is never
 *   an instance of `dict`). `isPlainObject` below (`typeof x === 'object' &&
 *   x !== null && !Array.isArray(x)`) is the direct, unambiguous TS
 *   equivalent of `isinstance(x, dict)` — no hazard-8-shaped divergence
 *   exists at either site. Zero OTHER `isinstance`/type-narrowing calls
 *   exist anywhere else in the ~331-LOC span (confirmed by reading the full
 *   source, not by a keyword grep alone) — N/A everywhere else.
 *
 * ── `_resolve_oshi_artist`'s collapsed-output guards (disclosed, not
 * silently counted as ordinary branch coverage) ─────────────────────────
 *
 * SIX distinct code paths inside `_resolve_oshi_artist` all return the exact
 * same value, `None`: (1) `run_log.world` is `None`, (2) `driver_profile.
 * oshi_registered` is `False`, (3) `oshi_mode !== "on"`, (4) `oshi_artists`
 * is empty, (5) a caught exception, (6) the nested catalog/artist loop
 * exhausts with no id match. A golden fixture asserting only "the result is
 * `None`" cannot distinguish any of these from each other or from a
 * TS implementation bug that collapses two of these guards into one (e.g.
 * a `dp.oshi_registered !== true` typo'd in place of `!dp.oshi_registered`
 * would still return `None` for most real inputs, masking the bug). This
 * port's golden (`resolve_oshi_artist_cases`) exercises guards 1-4 and 6
 * with DISTINCT inputs anyway (real legacy run for 1; a real profile with
 * both 2 and 3 false TOGETHER — no committed profile has only one of them
 * false, see below; a synthetic mode-off-only profile for 3 alone; a
 * synthetic emptied-artists profile for 4; a synthetic unknown-artist-id
 * profile for 6) so the IMPLEMENTATION's control flow is genuinely
 * independently reached case-by-case even though the fixture's OWN output
 * column cannot discriminate them — this is disclosed here and in the task
 * report rather than counted as six independent coverage points. Guard 5
 * (the bare `except`) is NOT exercised at all: no realistic JSON-shaped
 * input was found that trips it without tripping an earlier guard first
 * (every `run_log.world`/`driver_profile` field this function reads is
 * either absent, in which case guards 1-4 already return `None` first, or
 * present-and-malformed in a way that would throw during JSON parsing
 * itself, never inside this function's own body) — left genuinely
 * unreached, not faked.
 *
 * `real_oshi_registered_false_and_mode_off_together`'s own note: EVERY
 * committed profile with `oshi_mode: "off"` also has `oshi_registered:
 * false` (and vice versa) — `profile-neutral-default`/`profile-wellness-
 * calm` are the only two committed profiles with either field false, and
 * both have BOTH false. Guards 2 and 3 are therefore never independently
 * reachable from real committed data; the `oshi_registered_true_mode_off_
 * alone_SYNTHETIC` case (a real profile with `oshi_mode` alone flipped) is
 * what actually isolates guard 3.
 */
import { datasetCatalogRegistry } from '../stores'
import { getDataset } from '../../../data/registry'
import type { ServiceId } from '../eligibility'
import type { ProposalOpportunity, ProposalRunLog } from '../run_manager'
import type { AlgorithmEvidence } from '../selector'

// ---------------------------------------------------------------------------
// Small private helpers (see module doc's "Step 2" for pyGetDefault vs.
// pyTruthy/pyOr; see run_manager.ts's own module doc for why this file
// keeps its OWN private deepCopy rather than importing one — no exported
// deepCopy exists anywhere in this port, each module that needs one keeps
// its own local copy, the same established convention).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` is returned ONLY
 * when `key` is absent; a present `null`/`undefined` value is returned
 * as-is (matching Python returning a present `None`). */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Mirrors Python truthiness for the `if x:` / `x or default` idioms in
 * these ported functions — an empty dict/list is FALSY in Python but
 * truthy in JS, so a bare `if (x)` would diverge for a present-but-empty
 * object/array. */
function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

/** Mirrors Python's `x or default`. */
function pyOr(value: unknown, fallback: unknown): unknown {
  return pyTruthy(value) ? value : fallback
}

/** Mirrors `isinstance(x, dict)` — see the module doc's hazard-8 audit for
 * why this is NOT a hazard-8 site (no `(int, float)`/bool interaction). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Mirrors Python's `copy.deepcopy` for the plain JSON-shaped values these
 * functions handle — local copy, not shared/exported; see module doc. */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as T
  }
  return value
}

/** Whatever `proposalPackageRegistry.get(id)` (`../stores.ts`) returns — a
 * plain manifest dict; only `contract_version` is read here. Mirrors the
 * "cast fields at the read site" convention `../selector.ts#dispatchSelector`
 * already established for this same untyped registry payload. */
export type PackageManifestLike = Record<string, unknown> & { contract_version: string }

/** `_build_content_context`/`_build_real_content_context` (routers/
 * proposal.py:264-270, 373-381) inline this EXACT loop twice, byte-
 * identically — factored into one shared helper here (not a behavior
 * change, both Python copies are the same code). Finds the FIRST "service"
 * evidence entry with a Python-truthy `output` and returns its
 * `next_package_runtime_state` (or `{}` if that key is itself falsy/absent);
 * `{}` if no such entry exists. */
function firstServicePackageRuntimeState(evidence: AlgorithmEvidence[]): Record<string, unknown> {
  for (const ev of evidence) {
    if (ev.step === 'service' && pyTruthy(ev.output)) {
      const output = ev.output as Record<string, unknown>
      return pyOr(output.next_package_runtime_state, {}) as Record<string, unknown>
    }
  }
  return {}
}

// ---------------------------------------------------------------------------
// _build_service_context (routers/proposal.py:194-235)
// ---------------------------------------------------------------------------

export type BuildServiceContextArgs = {
  package: PackageManifestLike
  opportunity: ProposalOpportunity
  worldSnapshot: Record<string, unknown>
  enabledFeatureExtensions: string[]
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  eligibleServiceIds: ServiceId[]
  excludedCandidates: Array<Record<string, unknown>>
}

/**
 * Assemble a SelectorInput-shaped context dict for the SERVICE selector.
 * Mirrors `_build_service_context` (routers/proposal.py:194-235) exactly,
 * including its per-field copy-vs-reference pattern: `allowed_service_ids`/
 * `eligible_candidates`/`enabled_feature_extensions`/`feature_snapshot`/
 * `feature_provenance` are all FRESH copies (Python: list/dict
 * comprehensions or `dict(...)`); `excluded_candidates`/`parameters`/
 * `hyperparameters` are passed through BY REFERENCE (Python: no `list(...)`/
 * `dict(...)` wrap) — this has no test-observable effect under structural
 * equality, but is preserved for byte-exact port fidelity.
 */
export function buildServiceContext(args: BuildServiceContextArgs): Record<string, unknown> {
  const featureSnapshot = {
    ...((pyOr(args.worldSnapshot.feature_snapshot, {}) as Record<string, unknown>)),
  }
  const featureProvenance = {
    ...((pyOr(args.worldSnapshot.feature_provenance, {}) as Record<string, unknown>)),
  }
  return {
    contract_version: args.package.contract_version,
    opportunity_id: args.opportunity.opportunity_id,
    simulation_time: args.opportunity.simulation_time,
    trigger_purpose: args.opportunity.trigger_purpose,
    lifecycle_stage: args.opportunity.lifecycle_stage,
    allowed_service_ids: [...args.eligibleServiceIds],
    feature_snapshot: featureSnapshot,
    feature_provenance: featureProvenance,
    enabled_feature_extensions: [...args.enabledFeatureExtensions],
    selected_service_id: null,
    eligible_candidates: args.eligibleServiceIds.map((s) => ({ candidate_id: s })),
    excluded_candidates: args.excludedCandidates,
    parameters: args.parameters,
    hyperparameters: args.hyperparameters,
    package_runtime_state: {},
    catalog_version: pyGetDefault(args.worldSnapshot, 'catalog_version', 'n/a'),
    run_seed: args.opportunity.run_seed,
  }
}

// ---------------------------------------------------------------------------
// _build_content_context (routers/proposal.py:238-291)
// ---------------------------------------------------------------------------

export type BuildContentContextArgs = {
  package: PackageManifestLike
  runLog: ProposalRunLog
  selectedServiceId: ServiceId
  contentParameters: Record<string, unknown>
  contentHyperparameters: Record<string, unknown>
}

/**
 * Assemble a SelectorInput-shaped context dict for the CONTENT selector —
 * the P1 mock/legacy path (mirrors `_build_content_context`, routers/
 * proposal.py:238-291). `enabled_feature_extensions`/`excluded_candidates`
 * are always `[]` here (hardcoded, unlike `buildServiceContext` — this
 * function takes no `enabledFeatureExtensions` parameter at all, matching
 * Python's own signature).
 */
export function buildContentContext(args: BuildContentContextArgs): Record<string, unknown> {
  const worldSnapshot = pyOr(args.runLog.world_snapshot, {}) as Record<string, unknown>
  const featureSnapshot = { ...((pyOr(worldSnapshot.feature_snapshot, {}) as Record<string, unknown>)) }
  const featureProvenance = { ...((pyOr(worldSnapshot.feature_provenance, {}) as Record<string, unknown>)) }
  const catalog = (pyGetDefault(featureSnapshot, 'catalog', {}) ?? {}) as Record<string, unknown>
  const eligibleCandidates = pyTruthy(catalog)
    ? Object.keys(catalog).map((tid) => ({ candidate_id: tid }))
    : []

  const packageRuntimeState = firstServicePackageRuntimeState(args.runLog.evidence)

  return {
    contract_version: args.package.contract_version,
    opportunity_id: args.runLog.opportunity.opportunity_id,
    simulation_time: args.runLog.opportunity.simulation_time,
    trigger_purpose: args.runLog.opportunity.trigger_purpose,
    lifecycle_stage: args.runLog.opportunity.lifecycle_stage,
    allowed_service_ids: [...args.runLog.opportunity.allowed_service_ids],
    selected_service_id: args.selectedServiceId,
    feature_snapshot: featureSnapshot,
    feature_provenance: featureProvenance,
    enabled_feature_extensions: [],
    eligible_candidates: eligibleCandidates,
    excluded_candidates: [],
    parameters: args.contentParameters,
    hyperparameters: args.contentHyperparameters,
    package_runtime_state: packageRuntimeState,
    catalog_version: pyGetDefault(worldSnapshot, 'catalog_version', 'n/a'),
    run_seed: args.runLog.opportunity.run_seed,
  }
}

// ---------------------------------------------------------------------------
// _catalog_map_for_dataset (routers/proposal.py:294-305)
// ---------------------------------------------------------------------------

/**
 * Build the `{track_id: Song-dict}` map the real content selector's
 * `feature_snapshot["catalog"]` expects. Mirrors `_catalog_map_for_dataset`
 * (routers/proposal.py:294-305) — see the module doc's Step 1 for the
 * `datasetCatalogRegistry` binding and the KNOWN PRE-EXISTING DIVERGENCE
 * from Python's `Song.model_dump(mode="json")` round-trip. Returns `null`
 * if `datasetId` is unknown/quarantined — never throws.
 */
export function catalogMapForDataset(datasetId: string): Record<string, Record<string, unknown>> | null {
  const songs = datasetCatalogRegistry.getCatalog(datasetId)
  if (songs === null) return null
  const map: Record<string, Record<string, unknown>> = {}
  for (const raw of songs) {
    const song = raw as Record<string, unknown>
    const spotifyTrack = (pyOr(song.spotify_track, {}) as Record<string, unknown>)
    const trackId = spotifyTrack.id as string
    map[trackId] = song
  }
  return map
}

// ---------------------------------------------------------------------------
// _genre_affinity_artist_genres (routers/proposal.py:308-325)
// ---------------------------------------------------------------------------

/**
 * Read-only load of the dataset's catalog-derived `artist_genres` map.
 * Mirrors `_genre_affinity_artist_genres` (routers/proposal.py:308-325) —
 * see the module doc's Step 1 for the filesystem -> `getDataset(...)?.
 * genreAffinity` substitution. Both of Python's "file missing" causes
 * (dataset id entirely unknown, or the one real dataset's own
 * `genre_affinity_v1.json` absent) collapse to the exact same
 * `path.exists()` check in Python too — not a porting-introduced collapse,
 * see `getDataset`'s own `DatasetEntry.genreAffinity: unknown | null`
 * contract. Never throws — a read/parse failure at the ORIGINAL Python
 * runtime-file-read step has no TS equivalent at all, since
 * `collect-data.mjs` already parsed this file once at BUILD time
 * (`installRegistry()` would have failed the whole boot if it were
 * malformed) — there is no "file read that can fail here" step left to
 * port a try/except around.
 */
export function genreAffinityArtistGenres(datasetId: string): Record<string, unknown> {
  const entry = getDataset(datasetId)
  const genreAffinity = entry?.genreAffinity as Record<string, unknown> | null | undefined
  if (genreAffinity == null) return {}
  return { artist_genres: pyGetDefault(genreAffinity, 'artist_genres', {}) }
}

// ---------------------------------------------------------------------------
// _build_real_content_context (routers/proposal.py:328-401)
// ---------------------------------------------------------------------------

export type BuildRealContentContextArgs = {
  package: PackageManifestLike
  runLog: ProposalRunLog
  selectedServiceId: ServiceId
  contentParameters: Record<string, unknown>
  contentHyperparameters: Record<string, unknown>
}

/**
 * Assemble the CONTENT context for the REAL transparent content selector
 * (`aica_transparent_content_selector_v1`). Mirrors `_build_real_content_
 * context` (routers/proposal.py:328-401) — merges in the FULL frozen
 * dataset catalog (no eligibility narrowing, per FR-021) and, when the
 * genre extension is on, the dataset's catalog-derived `artist_genres`
 * alongside the World-owned `usage_by_genre`/`scene_genre_usage` (see the
 * module doc's hazard-4 item 3 for the exact merge-order proof).
 *
 * @throws Error — mirrors Python's `assert setup_snapshot is not None`
 *   (an INVARIANT check, not a user-facing `HTTPException` — only invoked
 *   for typed-world runs, per the caller's own gate at the future
 *   `_dispatch_content_for_service` call site).
 */
export function buildRealContentContext(args: BuildRealContentContextArgs): Record<string, unknown> {
  const setupSnapshot = args.runLog.setup_snapshot
  if (setupSnapshot == null) {
    throw new Error(
      'buildRealContentContext: run_log.setup_snapshot must not be null (only invoked for typed-world runs)',
    )
  }
  const setup = setupSnapshot as Record<string, unknown>

  const worldSnapshot = pyOr(args.runLog.world_snapshot, {}) as Record<string, unknown>
  const featureSnapshot = { ...((pyOr(worldSnapshot.feature_snapshot, {}) as Record<string, unknown>)) }
  const featureProvenance = { ...((pyOr(worldSnapshot.feature_provenance, {}) as Record<string, unknown>)) }

  const catalogMap = catalogMapForDataset(setup.dataset_id as string) ?? {}

  const enabledFeatureExtensions: string[] = []
  if (pyTruthy(featureSnapshot._genre_extension_enabled)) {
    enabledFeatureExtensions.push('genre_affinity_v1')
    const gav1Base = { ...((pyOr(featureSnapshot.genre_affinity_v1, {}) as Record<string, unknown>)) }
    // Hazard 4 (dict/insertion order) — see module doc item 3: object
    // spread preserves dict.update()'s exact key-position semantics here.
    featureSnapshot.genre_affinity_v1 = { ...gav1Base, ...genreAffinityArtistGenres(setup.dataset_id as string) }
  }

  featureSnapshot.catalog = catalogMap
  featureSnapshot._service_id = args.selectedServiceId

  const eligibleCandidates = Object.keys(catalogMap).map((tid) => ({ candidate_id: tid }))
  const packageRuntimeState = firstServicePackageRuntimeState(args.runLog.evidence)

  return {
    contract_version: args.package.contract_version,
    opportunity_id: args.runLog.opportunity.opportunity_id,
    simulation_time: args.runLog.opportunity.simulation_time,
    trigger_purpose: args.runLog.opportunity.trigger_purpose,
    lifecycle_stage: args.runLog.opportunity.lifecycle_stage,
    allowed_service_ids: [...args.runLog.opportunity.allowed_service_ids],
    selected_service_id: args.selectedServiceId,
    feature_snapshot: featureSnapshot,
    feature_provenance: featureProvenance,
    enabled_feature_extensions: enabledFeatureExtensions,
    eligible_candidates: eligibleCandidates,
    excluded_candidates: [],
    parameters: args.contentParameters,
    hyperparameters: args.contentHyperparameters,
    package_runtime_state: packageRuntimeState,
    catalog_version: setup.dataset_hash,
    run_seed: args.runLog.opportunity.run_seed,
  }
}

// ---------------------------------------------------------------------------
// _redact_catalog_for_evidence (routers/proposal.py:404-430)
// ---------------------------------------------------------------------------

/**
 * Return a deep-copied `context` with `feature_snapshot.catalog` replaced by
 * a compact dataset-reference marker — MF2 / P3 POLISH unit. Mirrors
 * `_redact_catalog_for_evidence` (routers/proposal.py:404-430) exactly,
 * including its guard ORDER (hazard 4: check `feature_snapshot` is a plain
 * object BEFORE reading `catalog` off it, then check `catalog` is itself a
 * plain object before replacing it — both guards no-op silently, never
 * throw, when the shape doesn't match) and the fact that `context` itself
 * is NEVER mutated (only the deep-copied `redacted` is) — see the
 * `real_full_catalog_redacted_original_untouched` golden case, which
 * asserts the ORIGINAL context's catalog is still the full 300-song map
 * after the call.
 *
 * ONLY used to build the value recorded as evidence's `input_snapshot` — a
 * LATER C4a task's job to actually call this at the `dispatch_selector`
 * call site; `evaluate()` itself always receives the full, un-redacted
 * context regardless.
 */
export function redactCatalogForEvidence(
  context: Record<string, unknown>,
  datasetId: string,
): Record<string, unknown> {
  const redacted = deepCopy(context)
  const featureSnapshot = redacted.feature_snapshot
  if (isPlainObject(featureSnapshot)) {
    const catalog = featureSnapshot.catalog
    if (isPlainObject(catalog)) {
      featureSnapshot.catalog = {
        _redacted_catalog: { dataset_id: datasetId, song_count: Object.keys(catalog).length },
      }
    }
  }
  return redacted
}

// ---------------------------------------------------------------------------
// _dataset_id_for_run (routers/proposal.py:1982-1996)
// ---------------------------------------------------------------------------

/**
 * Best-effort dataset id for a run's catalog, or `null`. Mirrors
 * `_dataset_id_for_run` (routers/proposal.py:1982-1996) — fully defensive,
 * any failure returns `null`. The `world.catalog_ref`-missing sub-check
 * (Python's `run_log.world.catalog_ref is not None`) is provably
 * unreachable for any pydantic-validated `World` (`catalog_ref: CatalogRef`
 * is a REQUIRED field with no default — pydantic itself would reject
 * constructing a `World` without one), so no golden case targets it
 * specifically; the `try`/`catch` here mirrors Python's defensive intent
 * (same reasoning, not the same concrete trigger condition — a plain
 * property read on a JS object/null can throw only when reading OFF
 * `null`/`undefined` itself, never merely a wrong-shaped-but-present value,
 * unlike Python's broader `except Exception`).
 */
export function datasetIdForRun(runLog: ProposalRunLog): string | null {
  let datasetId: string | null = null
  try {
    const world = runLog.world as Record<string, unknown> | null
    if (world != null) {
      const catalogRef = world.catalog_ref as Record<string, unknown> | null | undefined
      if (catalogRef != null) {
        datasetId = (catalogRef.dataset_id as string | undefined) ?? null
      }
    }
  } catch {
    datasetId = null
  }
  if (!datasetId && runLog.setup_snapshot != null) {
    const setupSnapshot = runLog.setup_snapshot as Record<string, unknown>
    datasetId = (setupSnapshot.dataset_id as string | undefined) ?? null
  }
  return datasetId
}

// ---------------------------------------------------------------------------
// _resolve_song_name (routers/proposal.py:1999-2015)
// ---------------------------------------------------------------------------

/**
 * Best-effort catalog lookup of a song's display title. Mirrors
 * `_resolve_song_name` (routers/proposal.py:1999-2015) — fully defensive,
 * any failure (legacy run without a dataset, quarantined catalog, unknown
 * id) simply returns `null`.
 */
export function resolveSongName(runLog: ProposalRunLog, trackId: string): string | null {
  const datasetId = datasetIdForRun(runLog)
  if (!datasetId) return null
  try {
    const catalogMap = catalogMapForDataset(datasetId) ?? {}
    const song = catalogMap[trackId]
    if (pyTruthy(song)) {
      const spotifyTrack = pyOr(song.spotify_track, {}) as Record<string, unknown>
      return (spotifyTrack.name as string | undefined) ?? null
    }
  } catch {
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// _resolve_song_artist (routers/proposal.py:2018-2034)
// ---------------------------------------------------------------------------

/**
 * Best-effort catalog lookup of a song's primary artist name. Mirrors
 * `_resolve_song_artist` (routers/proposal.py:2018-2034) — fully defensive,
 * any failure simply omits the artist name (returns `null`).
 */
export function resolveSongArtist(runLog: ProposalRunLog, trackId: string): string | null {
  const datasetId = datasetIdForRun(runLog)
  if (!datasetId) return null
  try {
    const catalogMap = catalogMapForDataset(datasetId) ?? {}
    const song = catalogMap[trackId]
    if (pyTruthy(song)) {
      const spotifyTrack = pyOr(song.spotify_track, {}) as Record<string, unknown>
      const artists = pyOr(spotifyTrack.artists, []) as Array<Record<string, unknown>>
      if (pyTruthy(artists)) {
        return (artists[0].name as string | undefined) ?? null
      }
    }
  } catch {
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// _resolve_oshi_artist (routers/proposal.py:2037-2065)
// ---------------------------------------------------------------------------

/**
 * Best-effort artist name for the driver's registered oshi — leads with the
 * single artist the driver is most enthusiastic about (highest
 * `enthusiasm`; ties broken by list order, i.e. the FIRST entry at that
 * enthusiasm wins, mirroring Python's `max(..., key=...)` first-occurrence
 * tie-break). Mirrors `_resolve_oshi_artist` (routers/proposal.py:2037-2065)
 * — see the module doc's dedicated section for the six code paths that all
 * collapse to the same `null` output, and which are exercised by real vs.
 * synthetic golden cases.
 */
export function resolveOshiArtist(runLog: ProposalRunLog): string | null {
  try {
    const world = runLog.world as Record<string, unknown> | null
    const dp = world != null ? (world.driver_profile as Record<string, unknown> | null | undefined) : null
    const oshiArtists = dp?.oshi_artists as Array<Record<string, unknown>> | undefined
    if (dp == null || !dp.oshi_registered || dp.oshi_mode !== 'on' || !pyTruthy(oshiArtists)) {
      return null
    }
    const artists = oshiArtists as Array<Record<string, unknown>>

    // Python's max(dp.oshi_artists, key=lambda a: a.enthusiasm): first
    // element wins on ties — a STRICT `>` update preserves that (only
    // updates on a strictly-greater enthusiasm, never on `>=`).
    let topArtist = artists[0]
    let topEnthusiasm = topArtist.enthusiasm as number
    for (let i = 1; i < artists.length; i++) {
      const enthusiasm = artists[i].enthusiasm as number
      if (enthusiasm > topEnthusiasm) {
        topArtist = artists[i]
        topEnthusiasm = enthusiasm
      }
    }

    const datasetId = datasetIdForRun(runLog)
    if (!datasetId) return null
    const catalogMap = catalogMapForDataset(datasetId) ?? {}
    for (const song of Object.values(catalogMap)) {
      const spotifyTrack = pyOr(song.spotify_track, {}) as Record<string, unknown>
      const songArtists = pyOr(spotifyTrack.artists, []) as Array<Record<string, unknown>>
      for (const artist of songArtists) {
        if (artist.id === topArtist.artist_id) {
          return (artist.name as string | undefined) ?? null
        }
      }
    }
  } catch {
    return null
  }
  return null
}
