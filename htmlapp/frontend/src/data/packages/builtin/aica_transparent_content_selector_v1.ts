/**
 * aica_transparent_content_selector_v1 — TS port of the `python_module`
 * package `packages/aica_transparent_content_selector_v1/algorithm.py`
 * (behavior-of-record, 932 LoC; P6, `docs/master/
 * aica_transparent_content_proposal_algorithm.md`).
 *
 * PROPOSAL-family package (`package.json`: `kind`/`family` ==
 * `"content_selector"`), NOT a trigger package, and NEVER previously ported —
 * mirrors `../../../src/data/packages/builtin/aica_transparent_service_selector_v1.ts`
 * (C1 Task 4) in method: nothing in this codebase dispatches this package yet
 * (`../index.ts#triggerFamilyManifests()` routes every proposal-family
 * manifest away from the trigger adapter before `BUILTIN_EVALUATORS` is ever
 * consulted for it — see that file and `../../builtinEvaluators.ts`'s doc
 * comment), so `evaluate()` here is verified standalone: direct conformance
 * against a captured golden (`../../../engine/__fixtures__/parity/
 * content_selector.json`, `tests/content_selector_port.test.ts`).
 *
 * Contract: `evaluate(context: ContentSelectorInput) -> CompletePlan`,
 * mirroring algorithm.py's own `evaluate(context: dict) -> dict` exactly.
 * Ranks songs for an already-selected music *service* (`music_playlist` /
 * `humming_karaoke` / `full_karaoke`) and returns ONE ordered plan — no
 * aggregate plan score (§ "Purity" in algorithm.py's own module doc).
 *
 * ---------------------------------------------------------------------------
 * Three-tier error model — IMPORTANT, differs from the service-selector port
 * ---------------------------------------------------------------------------
 *
 * Unlike `aica_transparent_service_selector_v1`, where every validation
 * failure raises an exception that propagates uncaught out of `evaluate()`,
 * content_selector's `evaluate()` internally CATCHES its own two custom
 * exception classes (`_ConfigError`/`_CatalogError`, algorithm.py:58-64) at
 * two `try/except` sites and converts them into a structured `_error(...)`
 * result dict (`decision_type` in `{"invalid_configuration",
 * "invalid_catalog", ...}`) — these ARE golden-capturable "success" (i.e.
 * non-throwing) cases, unlike the service selector's raise paths. See the
 * task report's per-branch table for which golden cases hit which
 * `decision_type`.
 *
 * However, algorithm.py's docstring claim ("a missing [hyperparameter] key
 * is a real configuration bug surfaced as invalid_configuration") is only
 * true for the FEW explicit `raise _ConfigError(...)` / `raise
 * _CatalogError(...)` call sites. Every OTHER hyperparameter access in the
 * file is a BARE `hp["key"]` dict index (grepped and enumerated exhaustively
 * while porting — see the task report) — in Python, a missing key there
 * raises a bare, UNCAUGHT `KeyError` that propagates straight out of
 * `evaluate()` (neither `try/except` clause matches `KeyError`). This port
 * therefore uses THREE distinct thrown-error classes, not two:
 *   - `ContentConfigError`  — mirrors `_ConfigError`. Thrown ONLY at the one
 *     site Python does (zero/non-finite active-weight denominator,
 *     algorithm.py:162-163). CAUGHT by `evaluate()`'s two try/catch blocks →
 *     `decision_type: "invalid_configuration"`.
 *   - `ContentCatalogError` — mirrors `_CatalogError`. Thrown ONLY at the two
 *     sites Python does (candidate not present in catalog, algorithm.py:690;
 *     a required `spotify_audio_features` field missing/None/non-finite,
 *     algorithm.py:76-80). CAUGHT by the per-candidate loop's try/catch →
 *     `decision_type: "invalid_catalog"`.
 *   - `ContentMissingKeyError` — mirrors a bare Python `KeyError` from any
 *     OTHER `hp["..."]` (or nested `b["..."]`/`crm["..."]`/`curves["..."]`/
 *     `maps["..."]`/`cat_w[...]`/`sub["..."]`/`leaf_def["..."]`) index. Used
 *     via the `req()` helper below at every such site. Deliberately NEVER
 *     caught anywhere in this file — it propagates all the way out of
 *     `evaluate()`, exactly like Python's own uncaught `KeyError` would. A
 *     future caller sees a real thrown error, never a silently-wrong
 *     `invalid_configuration` result (which would be WRONG: Python itself
 *     does not produce a graceful result for these — it crashes).
 * Every `.get(key, default)` call in algorithm.py (also enumerated
 * exhaustively) is a genuinely SAFE, defaulted read — ported as a plain `??`/
 * ternary fallback, never `req()`.
 *
 * ---------------------------------------------------------------------------
 * Divergence hazards checked against algorithm.py (932 LoC) while porting —
 * see the task report for the full per-hazard evidence (grep counts,
 * empirical divergence measurements) and the per-branch coverage table.
 * ---------------------------------------------------------------------------
 *
 * 1/5. `round()` / float→string formatting: `round()` itself has zero hits.
 *    `_build_rationale`'s two `:.3f` format specs (algorithm.py:569-570,
 *    575-576) DO need Python-exact fixed-decimal formatting — ported via
 *    `pyFixed(x, 3)` (imported from `./mathUtils`, already built for the
 *    service-selector port; `:.3f` here vs. that port's `:.4f`, same
 *    underlying hazard). No bare float-interpolation f-strings exist on the
 *    success path (unlike the service selector's confidence-shrinkage
 *    disclosure) — the three OTHER `f"...` sites in this file
 *    (algorithm.py:77, 80, 690) are exception messages on the `_CatalogError`
 *    raise/catch path, not part of the byte-exact parity boundary.
 * 2. `sorted()` on tuples: **present, load-bearing** —
 *    `scored_songs.sort(key=lambda s: (-s["item_fit"], s["track"]["id"]))`
 *    (algorithm.py:774), item_fit descending then track_id ascending as the
 *    tie-break. Ported as an explicit two-branch comparator (see
 *    `rankSongs()` below), never a bare `.sort((a,b)=>b.item_fit-a.item_fit)`.
 *    Golden-exercised by the `tie_break_item_fit_clone` capture case (two
 *    songs with bit-for-bit identical evidence, differing only by track id).
 *    `_build_reasons`' `sorted(contributions, key=lambda c: c["contribution"],
 *    reverse=True)` (algorithm.py:562) is a plain single-key descending sort
 *    — safe as `.slice().sort((a,b) => b.contribution - a.contribution)`
 *    (`Array.prototype.sort` is stable since ES2019, matching Python's
 *    guaranteed-stable `sorted()`). The three `sorted(...)` calls at
 *    algorithm.py:859/887/888/889 sort plain ASCII feature-id string sets —
 *    ported as `Array.from(set).sort()`.
 * 3. `//` / `%` floor semantics: ONE hit — `sum(...) // 1000`
 *    (algorithm.py:825, `expected_duration_sec` for non-humming services).
 *    The dividend is a `sum()` of `int(track.duration_ms)` values (always
 *    non-negative integers) and the divisor is the positive literal `1000`
 *    — floor and truncating division are IDENTICAL for two non-negative
 *    operands, so this is technically a non-issue, but ported via
 *    `Math.floor(...)` anyway (never `Math.trunc`/`|0`) to stay honest about
 *    which semantics is intended rather than relying on the sign coincidence.
 *    No bare `%` operator anywhere (grepped).
 * 4. Dict/set iteration order feeding ordered output: **present, handled
 *    carefully, and DEAD-CODE-ADJACENT** — `FORMULA_ORDER` (algorithm.py:
 *    33-38) LOOKS like the intended feature-iteration order but is **never
 *    referenced anywhere else in the file** (grepped: only its own
 *    definition matches) — confirmed dead. The REAL order every per-item
 *    `feature_contributions` array is built in comes from `resolve_weights`'s
 *    nested `hierarchy_weights` iteration (category → subgroup → leaf, in
 *    the hyperparameter's own JSON key order — which does NOT match
 *    `FORMULA_ORDER`, e.g. `monotony` sorts after `traffic`/`road`/`night` in
 *    the real hierarchy but before them in the dead constant). `resolveWeights`
 *    below builds its `Record<string, WeightEntry>` via the IDENTICAL nested
 *    `for (const k of Object.keys(...))` structure (never a hardcoded order
 *    list) so both the entries object's insertion order and the later
 *    `scoredLeaves`/`contributions` array order match Python's dict order
 *    property-for-property. `feature_dispositions`' `report_ids` ordering
 *    (registry order, then any added-construct feature ids in SORTED order —
 *    algorithm.py:858-861) is mirrored the same way.
 * 6. **CPython 3.12's Neumaier-compensated `sum()`**: exactly TWO `sum()`
 *    call sites (grepped — see report). `derive_traits`'s
 *    `sum(w * comp[field] for field, w in weights.items())` (algorithm.py:109,
 *    up to 5 positive terms per trait) is a genuine float `sum()` and DOES
 *    diverge from a naive left-to-right accumulator — empirically confirmed
 *    (20,000 random trials against the package's own `trait_composition_matrix`
 *    weights: ~92% of trials diverge from a naive accumulator at the ULP
 *    level) — ported via `neumaierSum`. Note: because every term is
 *    non-negative and the four traits' weights each sum to ~1, the observed
 *    divergence magnitude is ~1e-16, well under `expectParity`'s 1e-9
 *    tolerance and does not flip any discrete branch in this port's golden
 *    (unlike the hybrid/service-selector ports' `clamped`/`preserved`
 *    boolean-flip findings) — `neumaierSum` is still used here, matching the
 *    established "match every real `sum()` call site 1:1" discipline rather
 *    than only where currently observable. The SECOND `sum()`
 *    (`sum(int(s["track"]["duration_ms"]) for s in chosen) // 1000`,
 *    algorithm.py:825) sums Python `int`s — exact regardless of accumulation
 *    order (no floating-point compensation possible or needed) — ported as a
 *    plain `.reduce()`, deliberately NOT `neumaierSum` (matches the "only use
 *    it where the Python actually calls `sum()` over floats AND it's
 *    load-bearing" rule the hybrid/service-selector ports established).
 *
 * ---------------------------------------------------------------------------
 * Registry-typing note
 * ---------------------------------------------------------------------------
 * Same widening as the service-selector port: `evaluate()`'s
 * `ContentSelectorInput -> CompletePlan` shape does not fit
 * `BuiltinEvaluateFn` at all — see `../../builtinEvaluators.ts`'s
 * `ContentSelectorEvaluateFn` and the further-widened `BUILTIN_EVALUATORS`
 * value type.
 */

import { neumaierSum, pyFixed } from './mathUtils'

// ---------------------------------------------------------------------------
// Public input/output types — mirror the shape algorithm.py's evaluate()
// itself reads/returns (not the full Pydantic SelectorInput/CompletePlan
// schema — see the module doc's precedent in the service-selector port for
// why: algorithm.py works on plain dicts, direct-indexed).
// ---------------------------------------------------------------------------

export type ContentArtist = { id?: string | null; name?: string; [k: string]: unknown }

export type ContentTrack = {
  id: string
  uri?: string | null
  duration_ms: number
  is_playable?: boolean | null
  available_markets?: string[] | null
  restrictions?: Record<string, unknown> | null
  explicit?: boolean | null
  artists?: ContentArtist[] | null
  album?: { release_date?: string | null; [k: string]: unknown } | null
  [k: string]: unknown
}

export type ContentAudioFeatures = {
  id?: string | null
  uri?: string | null
  duration_ms?: number | null
  energy?: number | null
  loudness?: number | null
  tempo?: number | null
  danceability?: number | null
  acousticness?: number | null
  valence?: number | null
  mode?: number | null
  instrumentalness?: number | null
  speechiness?: number | null
  [k: string]: unknown
}

export type ContentSong = {
  spotify_track: ContentTrack
  spotify_audio_features: ContentAudioFeatures
  simulation_flags?: { humming_karaoke_available?: number; full_karaoke_available?: number } | null
}

export type OshiArtistEntry = { artist_id?: string | null; enthusiasm?: number | null; oshi_type?: string }

export type ContentFeatureSnapshot = {
  catalog?: Record<string, ContentSong>
  situation?: Record<string, unknown>
  preference?: Record<string, unknown>
  history?: Record<string, unknown>
  market?: string | null
  current_scene?: string | null
  genre_affinity_v1?: {
    artist_genres?: Record<string, string[]>
    usage_by_genre?: Record<string, string> | null
    scene_genre_usage?: Record<string, Record<string, string>> | null
  } | null
  [k: string]: unknown
}

export type ContentSelectorInput = {
  contract_version?: string | null
  opportunity_id?: string
  simulation_time?: string | number | null
  trigger_purpose?: string | null
  lifecycle_stage?: string | null
  allowed_service_ids?: string[]
  selected_service_id?: string | null
  feature_snapshot?: ContentFeatureSnapshot | null
  feature_provenance?: Record<string, unknown>
  enabled_feature_extensions?: string[] | null
  eligible_candidates?: Array<{ candidate_id: string }> | null
  excluded_candidates?: Array<{ candidate_id: string; platform_reason?: string }> | null
  parameters?: Record<string, unknown> | null
  hyperparameters: Record<string, unknown>
  package_runtime_state?: Record<string, unknown>
  feature_dispositions?: Array<Record<string, unknown>> | null
  catalog_version?: string
  run_seed?: string
}

export type ContentFeatureContribution = {
  feature_id: string
  e_i: number
  a_i: number
  alpha: number | null
  beta: number | null
  exact_match: boolean | null
  matched_artist_ids: string[] | null
  response_provenance: string | null
  r_i: number
  base_weight: number
  purpose_multiplier: number
  mask: number
  effective_weight: number
  contribution: number
  formula_version: unknown
}

export type StrongestContribution = { feature_id: string; contribution: number } | null

export type TraitValues = {
  arousal: number
  valence: number
  humming_ease: number
  full_karaoke_ease: number
  arousal_signed: number
  valence_signed: number
}

export type OrderedItem = {
  position: number
  item_id: string
  item_fit: number
  trait_values: TraitValues
  feature_contributions: ContentFeatureContribution[]
  rationale: string[]
  situation_fit: number
  preference_fit: number
  history_fit: number
  strongest_support: StrongestContribution
  strongest_oppose: StrongestContribution
}

export type ScoredTailItem = {
  item_id: string
  rank: number
  item_fit: number
  feature_contributions: ContentFeatureContribution[]
}

export type PlanMode = {
  service_id: string
  mode_kind: string
  chorus_only: boolean | null
  guide_vocal: boolean | null
  driving_lyrics: boolean | null
  fixed_segment_sec: number | null
  stopped_only: boolean | null
  simulated_queue: boolean | null
}

export type LightingConfiguration = { enabled: boolean; cue_basis: unknown; notes: unknown } | null

export type ExcludedItem = { item_id: string; reason_codes: string[] }

export type CompletePlan = {
  decision_type: string
  selected_service_id: string
  requested_item_count: number
  returned_item_count: number
  ordered_items: OrderedItem[]
  mode: PlanMode
  expected_duration_sec: number
  lighting_configuration: LightingConfiguration
  approval_policy: string
  completion_rule: string
  next_transition_policy: string
  excluded_items: ExcludedItem[]
  scored_tail?: ScoredTailItem[]
  cut_margin?: number | null
  tail_truncated?: boolean
  unused_available_features: string[]
  missing_features: string[]
  algorithm_provenance: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Errors — see the module doc's "three-tier error model" section above.
// ---------------------------------------------------------------------------

export class ContentConfigError extends Error {}
export class ContentCatalogError extends Error {}
export class ContentMissingKeyError extends Error {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KARAOKE_SERVICES = new Set(['humming_karaoke', 'full_karaoke'])
const MUSIC_SERVICES = new Set(['music_playlist', 'humming_karaoke', 'full_karaoke'])

const FEATURE_LABELS: Record<string, { ja: string; en: string }> = {
  drowsiness: { ja: '眠気', en: 'drowsiness' },
  fatigue: { ja: '疲労', en: 'fatigue' },
  monotony: { ja: '単調性', en: 'monotony' },
  traffic: { ja: '渋滞', en: 'traffic' },
  road: { ja: '道路種別', en: 'road type' },
  night: { ja: '夜間', en: 'night' },
  motion: { ja: '走行状態', en: 'motion' },
  service_ease: { ja: '歌いやすさ', en: 'singability' },
  oshi: { ja: '推し一致', en: 'oshi match' },
  age: { ja: '年代適合', en: 'era fit' },
  item_usage: { ja: '利用頻度', en: 'usage' },
  played: { ja: '再生履歴', en: 'recent play' },
  skipped: { ja: 'スキップ履歴', en: 'skip history' },
  changed: { ja: '変更履歴', en: 'change history' },
  acceptance: { ja: '受容率', en: 'acceptance rate' },
  recovery: { ja: '回復率', en: 'recovery rate' },
  route: { ja: 'ルート適合', en: 'route fit' },
  destination: { ja: '目的地適合', en: 'destination fit' },
  child: { ja: '子供向け', en: 'child-friendly' },
  hobbies: { ja: '趣味適合', en: 'hobby fit' },
  genre_usage: { ja: 'ジャンル利用', en: 'genre usage' },
  scene_genre: { ja: 'シーン別ジャンル', en: 'scene genre' },
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo = 0.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Normalize -0 to +0 for deterministic serialization (mirrors _norm0). */
function norm0(v: number): number {
  return v === 0 ? v + 0.0 : v
}

/**
 * Mirrors a bare Python `obj["key"]` dict index: throws `ContentMissingKeyError`
 * (NEVER caught anywhere in this file — see the module doc's "three-tier
 * error model") if `key` is absent. Used at every bare-index site
 * algorithm.py itself uses (grepped and enumerated exhaustively — see the
 * task report). Every `.get(key, default)` site in algorithm.py is instead
 * ported as a plain `??`/ternary fallback, never this helper.
 */
function req<T>(obj: Record<string, unknown> | null | undefined, key: string, context: string): T {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) {
    throw new ContentMissingKeyError(`missing required key '${key}' in ${context}`)
  }
  return obj[key] as T
}

// ---------------------------------------------------------------------------
// Trait derivation (§4.4, Table 1)
// ---------------------------------------------------------------------------

type AudioComponents = {
  energy: number
  norm_loudness: number
  norm_tempo: number
  danceability: number
  acousticness_inv: number
  valence: number
  mode: number
  instrumentalness_inv: number
  speech_ease: number
  tempo_ease: number
  duration_ease: number
}

const REQUIRED_AUDIO_FIELDS = [
  'energy',
  'loudness',
  'tempo',
  'danceability',
  'acousticness',
  'valence',
  'mode',
  'instrumentalness',
  'speechiness',
  'duration_ms',
] as const

/** Mirrors `_audio_components`. Computes trait input components from Audio Features + bounds. */
function audioComponents(af: ContentAudioFeatures, b: Record<string, unknown>): AudioComponents {
  for (const key of REQUIRED_AUDIO_FIELDS) {
    const val = af[key]
    if (val === undefined || val === null) {
      throw new ContentCatalogError(`audio_features missing required field '${key}'`)
    }
    if (typeof val === 'number' && !Number.isFinite(val)) {
      throw new ContentCatalogError(`audio_features '${key}' not finite`)
    }
  }

  const loudnessMin = req<number>(b, 'loudness_min', 'norm_bounds')
  const loudnessRange = req<number>(b, 'loudness_range', 'norm_bounds')
  const tempoMin = req<number>(b, 'tempo_min', 'norm_bounds')
  const tempoRange = req<number>(b, 'tempo_range', 'norm_bounds')
  const tempoEaseCenter = req<number>(b, 'tempo_ease_center', 'norm_bounds')
  const tempoEaseSpan = req<number>(b, 'tempo_ease_span', 'norm_bounds')
  const speechEaseThreshold = req<number>(b, 'speech_ease_threshold', 'norm_bounds')
  const speechEaseSpan = req<number>(b, 'speech_ease_span', 'norm_bounds')
  const durationEaseCenter = req<number>(b, 'duration_ease_center', 'norm_bounds')
  const durationEaseSpan = req<number>(b, 'duration_ease_span', 'norm_bounds')

  const normLoudness = clamp((Number(af.loudness) - loudnessMin) / loudnessRange)
  const normTempo = clamp((Number(af.tempo) - tempoMin) / tempoRange)
  const tempoEase = 1.0 - clamp(Math.abs(Number(af.tempo) - tempoEaseCenter) / tempoEaseSpan)
  const speechEase = 1.0 - clamp((Number(af.speechiness) - speechEaseThreshold) / speechEaseSpan)
  const durationEase = 1.0 - clamp((Number(af.duration_ms) - durationEaseCenter) / durationEaseSpan)

  return {
    energy: Number(af.energy),
    norm_loudness: normLoudness,
    norm_tempo: normTempo,
    danceability: Number(af.danceability),
    acousticness_inv: 1.0 - Number(af.acousticness),
    valence: Number(af.valence),
    mode: Number(af.mode),
    instrumentalness_inv: 1.0 - Number(af.instrumentalness),
    speech_ease: speechEase,
    tempo_ease: tempoEase,
    duration_ease: durationEase,
  }
}

/**
 * Mirrors `derive_traits`. `sum()` over each trait's weighted components
 * (algorithm.py:109) is Neumaier-compensated in CPython 3.12 and DOES diverge
 * from a naive accumulator for this package's own `trait_composition_matrix`
 * — see hazard 6 in the module doc.
 */
function deriveTraits(af: ContentAudioFeatures, hp: Record<string, unknown>): TraitValues {
  const matrix = req<Record<string, Record<string, number>>>(hp, 'trait_composition_matrix', 'hyperparameters')
  const bounds = req<Record<string, unknown>>(hp, 'norm_bounds', 'hyperparameters')
  const comp = audioComponents(af, bounds)

  const compRecord = comp as unknown as Record<string, number>
  const traits: Record<string, number> = {}
  for (const traitName of Object.keys(matrix)) {
    const weights = matrix[traitName]
    const terms = Object.keys(weights).map((field) => weights[field] * req<number>(compRecord, field, `trait_composition_matrix['${traitName}'] component`))
    traits[traitName] = clamp(neumaierSum(terms))
  }

  return {
    arousal: traits.arousal,
    valence: traits.valence,
    humming_ease: traits.humming_ease,
    full_karaoke_ease: traits.full_karaoke_ease,
    arousal_signed: 2.0 * traits.arousal - 1.0,
    valence_signed: 2.0 * traits.valence - 1.0,
  }
}

// ---------------------------------------------------------------------------
// Effective weights (§6)
// ---------------------------------------------------------------------------

type WeightEntry = {
  feature_id: string
  category: string
  subgroup: string
  base_weight: number
  purpose_multiplier: number
  mask: number
  raw: number
  genre_gated: boolean
  karaoke_only: boolean
  effective_weight: number
}

/**
 * Mirrors `resolve_weights`. Built via the SAME nested (category -> subgroup
 * -> leaf) iteration Python's dict uses (never a hardcoded order list, even
 * though a `FORMULA_ORDER` constant exists in algorithm.py — it is DEAD CODE,
 * see hazard 4 in the module doc) — the resulting object's insertion order is
 * load-bearing for the `feature_contributions` ARRAY order downstream.
 */
function resolveWeights(
  hp: Record<string, unknown>,
  serviceId: string,
  purpose: string,
  genreOn: boolean,
): Record<string, WeightEntry> {
  const catW = req<Record<string, number>>(hp, 'content_category_weights', 'hyperparameters')
  const hierarchy = req<Record<string, Record<string, any>>>(hp, 'hierarchy_weights', 'hyperparameters')
  const multipliers = req<Record<string, Record<string, number>>>(hp, 'purpose_multipliers', 'hyperparameters')

  const entries: Record<string, WeightEntry> = {}
  let rawTotal = 0.0

  for (const category of Object.keys(hierarchy)) {
    const subgroups = hierarchy[category]
    for (const subgroup of Object.keys(subgroups)) {
      const sub = subgroups[subgroup]
      const leaves = req<Record<string, any>>(sub, 'leaves', `hierarchy_weights['${category}']['${subgroup}']`)
      for (const leaf of Object.keys(leaves)) {
        const leafDef = leaves[leaf]
        let mask = Number(leafDef.mask ?? 0)
        if (leafDef.karaoke_only) {
          mask = KARAOKE_SERVICES.has(serviceId) ? 1 : 0
        }
        if (leafDef.genre_gated) {
          mask = genreOn ? 1 : 0
        }
        const catShare = req<number>(catW, category, 'content_category_weights')
        const subShare = req<number>(sub, 'share', `hierarchy_weights['${category}']['${subgroup}']`)
        const leafShare = req<number>(leafDef, 'share', `hierarchy_weights['${category}']['${subgroup}']['${leaf}']`)
        const base = catShare * subShare * leafShare
        const subMultipliers = multipliers[subgroup] as Record<string, number> | undefined
        const pmult = subMultipliers && Object.prototype.hasOwnProperty.call(subMultipliers, purpose) ? subMultipliers[purpose] : 1.0
        const raw = base * pmult * mask
        rawTotal += raw
        entries[leaf] = {
          feature_id: req<string>(leafDef, 'feature_id', `hierarchy_weights['${category}']['${subgroup}']['${leaf}']`),
          category,
          subgroup,
          base_weight: base,
          purpose_multiplier: pmult,
          mask,
          raw,
          genre_gated: Boolean(leafDef.genre_gated ?? false),
          karaoke_only: Boolean(leafDef.karaoke_only ?? false),
          effective_weight: 0.0,
        }
      }
    }
  }

  if (!(rawTotal > 0) || !Number.isFinite(rawTotal)) {
    throw new ContentConfigError('zero or non-finite active-weight denominator')
  }
  for (const e of Object.values(entries)) e.effective_weight = e.raw / rawTotal
  return entries
}

// ---------------------------------------------------------------------------
// Evidence + response per feature (§5)
// ---------------------------------------------------------------------------

/** Mirrors `_parse_dt`. Returns epoch milliseconds, or null. */
function parseDt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return value * 1000
  }
  const s = String(value).replace('Z', '+00:00')
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  return ms
}

/** Mirrors `_era_bucket`. */
function eraBucket(releaseDate: unknown): string | null {
  if (!releaseDate) return null
  const yearStr = String(releaseDate).slice(0, 4)
  const year = parseInt(yearStr, 10)
  if (Number.isNaN(year)) return null
  if (year < 1980) return 'pre1980'
  if (year < 1990) return '1980s'
  if (year < 2000) return '1990s'
  if (year < 2010) return '2000s'
  if (year < 2020) return '2010s'
  return '2020s'
}

/** Mirrors `_mood`. Returns [a_i, alpha_used, beta_used]. */
function mood(
  alpha: number,
  beta: number,
  directional: boolean,
  As: number,
  Vs: number,
  hp: Record<string, unknown>,
): [number, number, number] {
  let aUsed = alpha
  if (directional && req<string>(hp, 'directional_hypothesis', 'hyperparameters') === 'keep_alert') {
    aUsed = -alpha
  }
  return [aUsed * As + beta * Vs, aUsed, beta]
}

/** Mirrors `_genre_set`. */
function genreSet(track: ContentTrack, gav1: ContentFeatureSnapshot['genre_affinity_v1']): Set<string> {
  const artistGenres = (gav1 && gav1.artist_genres) || {}
  const genres = new Set<string>()
  for (const artist of track.artists || []) {
    for (const g of artistGenres[artist.id as string] || []) genres.add(g)
  }
  return genres
}

/** Mirrors `_best_match`. */
function bestMatch(gSong: Set<string>, gTarget: Record<string, number>): number | null {
  const vals: number[] = []
  for (const g of gSong) {
    if (g in gTarget) vals.push(gTarget[g])
  }
  if (vals.length === 0) return null
  return clamp(Math.max(...vals), -1.0, 1.0)
}

/** Mirrors `_usage_curve`. */
function usageCurve(level: unknown, curve: Record<string, number>): number {
  if (level === null || level === undefined) return 0.0
  return curve[level as string] ?? 0.0
}

type FeatureMeta = {
  alpha: number | null
  beta: number | null
  exact_match: boolean | null
  matched_artist_ids?: string[] | null
  provenance: string | null
}

type FeatureEA = { e: number; a: number; meta: FeatureMeta }

/**
 * Mirrors `_feature_e_a`. Computes (e_i, a_i, meta) for a scored leaf.
 * `snap`/`hp` reads follow the SAME bare-vs-`.get()` split as algorithm.py —
 * see the module doc's "three-tier error model" and the task report's
 * exhaustive site-by-site enumeration.
 */
function featureEA(
  leaf: string,
  // Mirrors algorithm.py's own `entry` parameter (`_feature_e_a(leaf, entry,
  // ...)`) — Python computes `fid = entry["feature_id"]` at the top of the
  // function but never actually uses `fid` anywhere in the body (verified by
  // grep: dead code in the Python source itself). Kept as a parameter here
  // only to mirror the call signature; intentionally unused.
  _entry: WeightEntry,
  snap: ContentFeatureSnapshot,
  serviceId: string | null | undefined,
  track: ContentTrack,
  traits: TraitValues,
  hp: Record<string, unknown>,
  simDt: number | null,
  genreOn: boolean,
  gav1: ContentFeatureSnapshot['genre_affinity_v1'],
  scene: string | null | undefined,
): FeatureEA {
  const situation = (snap.situation as Record<string, unknown>) || {}
  const preference = (snap.preference as Record<string, unknown>) || {}
  const history = (snap.history as Record<string, unknown>) || {}
  const As = traits.arousal_signed
  const Vs = traits.valence_signed
  const crm = req<Record<string, any>>(hp, 'context_response_matrix', 'hyperparameters')
  const curves = req<Record<string, any>>(hp, 'history_curves', 'hyperparameters')
  const tid = track.id

  const moodMeta = (alpha: number | null, beta: number | null): FeatureMeta => ({
    alpha,
    beta,
    exact_match: null,
    provenance: 'normalized_context_hypothesis',
  })

  // --- six driver/environment mood features ---
  if (leaf === 'drowsiness') {
    const e = clamp(Number(situation.drowsiness_level ?? 0) / 100.0)
    const drowsinessCfg = req<{ alpha: number; beta: number }>(crm, 'drowsiness', 'context_response_matrix')
    const [a, al, be] = mood(drowsinessCfg.alpha, drowsinessCfg.beta, false, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }
  if (leaf === 'fatigue') {
    const e = clamp(Number(situation.fatigue_level ?? 0) / 100.0)
    const fatigueCfg = req<{ alpha: number; beta: number }>(crm, 'fatigue', 'context_response_matrix')
    const [a, al, be] = mood(fatigueCfg.alpha, fatigueCfg.beta, true, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }
  if (leaf === 'monotony') {
    const e = clamp(Number(situation.monotony_level ?? 0) / 100.0)
    const monotonyCfg = req<{ alpha: number; beta: number }>(crm, 'monotony', 'context_response_matrix')
    const [a, al, be] = mood(monotonyCfg.alpha, monotonyCfg.beta, false, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }
  if (leaf === 'traffic') {
    const congested = situation.traffic_state === 'congested'
    const e = congested ? 1.0 : 0.0
    const trafficCfg = req<{ alpha: number; beta: number }>(crm, 'traffic_congested', 'context_response_matrix')
    const [a, al, be] = mood(trafficCfg.alpha, trafficCfg.beta, true, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }
  if (leaf === 'road') {
    const rtype = (situation.road_type as string) ?? 'local'
    const roadTable = req<Record<string, { alpha: number; beta: number }>>(crm, 'road', 'context_response_matrix')
    const roadCfg = roadTable[rtype] ?? { alpha: 0.0, beta: 0.0 }
    const e = 1.0
    const a = roadCfg.alpha * As + roadCfg.beta * Vs
    return { e, a, meta: moodMeta(roadCfg.alpha, roadCfg.beta) }
  }
  if (leaf === 'night') {
    const night = situation.night_state === 'night'
    const e = night ? 1.0 : 0.0
    const nightCfg = req<{ alpha: number; beta: number }>(crm, 'night', 'context_response_matrix')
    const [a, al, be] = mood(nightCfg.alpha, nightCfg.beta, true, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }
  if (leaf === 'motion') {
    const driving = situation.motion_state === 'driving'
    const e = driving ? 1.0 : 0.0
    const motionCfg = req<{ alpha: number; beta: number }>(crm, 'motion_driving', 'context_response_matrix')
    const [a, al, be] = mood(motionCfg.alpha, motionCfg.beta, false, As, Vs, hp)
    return { e, a, meta: moodMeta(al, be) }
  }

  // --- song singability (added construct, karaoke only) ---
  if (leaf === 'service_ease') {
    const ease = serviceId === 'humming_karaoke' ? traits.humming_ease : traits.full_karaoke_ease
    const e = 1.0
    const a = 2.0 * ease - 1.0
    return { e, a, meta: { alpha: null, beta: null, exact_match: null, provenance: 'service_definition' } }
  }

  // --- genre-gated features (only meaningful when extension on) ---
  if (leaf === 'route' || leaf === 'destination' || leaf === 'child' || leaf === 'hobbies' || leaf === 'genre_usage' || leaf === 'scene_genre') {
    if (!genreOn) {
      return { e: 0.0, a: 0.0, meta: { alpha: null, beta: null, exact_match: null, provenance: 'normalized_context_hypothesis' } }
    }
    const maps = req<Record<string, any>>(hp, 'genre_affinity_maps', 'hyperparameters')
    const gSong = genreSet(track, gav1)
    let gTarget: Record<string, number> = {}
    let e = 0.0

    if (leaf === 'route') {
      const routeMap = req<Record<string, Record<string, number>>>(maps, 'route', 'genre_affinity_maps')
      const tags = ((situation.route_tags as string[] | undefined) || []).filter(Boolean)
      const recog = tags.filter((t) => t in routeMap)
      for (const t of recog) {
        for (const [g, w] of Object.entries(routeMap[t])) gTarget[g] = Math.max(gTarget[g] ?? -2.0, w)
      }
      e = recog.length > 0 ? 1.0 : 0.0
    } else if (leaf === 'destination') {
      const destMap = req<Record<string, Record<string, number>>>(maps, 'destination', 'genre_affinity_maps')
      const tags = ((situation.destination_tags as string[] | undefined) || []).filter(Boolean)
      const recog = tags.filter((t) => t in destMap)
      for (const t of recog) {
        for (const [g, w] of Object.entries(destMap[t])) gTarget[g] = Math.max(gTarget[g] ?? -2.0, w)
      }
      e = recog.length > 0 ? 1.0 : 0.0
    } else if (leaf === 'child') {
      if (situation.child_present) {
        const childMap = req<Record<string, number>>(maps, 'child', 'genre_affinity_maps')
        gTarget = { ...childMap }
        e = 1.0
      }
    } else if (leaf === 'hobbies') {
      const hobbyMap = req<Record<string, Record<string, number>>>(maps, 'hobby', 'genre_affinity_maps')
      const tags = ((preference.hobby_interest_tags as string[] | undefined) || []).filter(Boolean)
      const recog = tags.filter((t) => t in hobbyMap)
      for (const t of recog) {
        for (const [g, w] of Object.entries(hobbyMap[t])) gTarget[g] = Math.max(gTarget[g] ?? -2.0, w)
      }
      e = recog.length > 0 ? 1.0 : 0.0
    } else if (leaf === 'genre_usage') {
      const usage = gav1 && gav1.usage_by_genre
      if (usage) {
        const usageCurveMap = req<Record<string, number>>(maps, 'usage_curve', 'genre_affinity_maps')
        gTarget = {}
        for (const [g, lvl] of Object.entries(usage)) gTarget[g] = usageCurve(lvl, usageCurveMap)
        e = 1.0
      }
    } else if (leaf === 'scene_genre') {
      const sceneUsage = (gav1 && gav1.scene_genre_usage) || {}
      const cur = scene ? sceneUsage[scene] : null
      if (cur) {
        const usageCurveMap = req<Record<string, number>>(maps, 'usage_curve', 'genre_affinity_maps')
        gTarget = {}
        for (const [g, lvl] of Object.entries(cur)) gTarget[g] = usageCurve(lvl, usageCurveMap)
        e = 1.0
      }
    }

    let a = bestMatch(gSong, gTarget)
    if (a === null) a = 0.0
    return { e, a, meta: { alpha: null, beta: null, exact_match: null, provenance: 'normalized_context_hypothesis' } }
  }

  // --- oshi (gate + max-enthusiasm match across the driver's registered
  // oshi artists; feature 025 slice S2 — a list of OshiArtist entries, each
  // carrying its own 熱狂度/enthusiasm in [0,1]) ---
  if (leaf === 'oshi') {
    const registered = Boolean(preference.oshi_registered)
    const modeOn = preference.oshi_mode === 'on'
    const oshiEntries = (preference.oshi_artists as OshiArtistEntry[] | undefined) || []
    const byId: Record<string, number> = {}
    for (const e of oshiEntries) {
      const aid = e && e.artist_id
      if (aid) byId[aid] = Number((e && e.enthusiasm) ?? 1.0)
    }
    const gate = registered && modeOn && Object.keys(byId).length > 0 ? 1.0 : 0.0
    const matched: Array<[string, number]> = []
    for (const a of track.artists || []) {
      if (a.id && Object.prototype.hasOwnProperty.call(byId, a.id)) matched.push([a.id, byId[a.id]])
    }
    // Two oshi credited on the same song deliberately do NOT stack (MAX, not
    // sum) — see algorithm.py:366-372's own comment.
    const affinity = matched.length > 0 ? Math.max(...matched.map(([, v]) => v)) : 0.0
    return {
      e: gate,
      a: affinity,
      meta: {
        alpha: null,
        beta: null,
        exact_match: matched.length > 0,
        matched_artist_ids: matched.map(([i]) => i),
        provenance: 'cdc_su_explicit',
      },
    }
  }

  // --- age/era affinity ---
  if (leaf === 'age') {
    const band = preference.age_band as string | undefined
    const album = track.album || {}
    const era = eraBucket(album.release_date)
    let e: number
    let a: number
    if (band && era) {
      e = 1.0
      const ageEraAffinity = req<Record<string, Record<string, number>>>(hp, 'age_era_affinity', 'hyperparameters')
      a = clamp((ageEraAffinity[band] || {})[era] ?? 0.0, -1.0, 1.0)
    } else {
      e = 0.0
      a = 0.0
    }
    return { e, a, meta: { alpha: null, beta: null, exact_match: null, provenance: 'normalized_context_hypothesis' } }
  }

  // --- exact-ID history features (e signed, a = +1 on own id) ---
  if (leaf === 'item_usage') {
    const levels = (preference.catalog_item_usage_level as Record<string, unknown>) || {}
    const itemUsageCurve = req<Record<string, number>>(curves, 'item_usage', 'history_curves')
    const e = usageCurve(levels[tid], itemUsageCurve)
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }
  if (leaf === 'played') {
    const playedCurve = req<Record<string, number>>(curves, 'played', 'history_curves')
    const e = playedEvidence((preference.played_items as Array<Record<string, unknown>>) || [], tid, simDt, playedCurve)
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }
  if (leaf === 'skipped') {
    const skippedOlder = req<number>(curves, 'skipped_older', 'history_curves')
    const e = olderSkipEvidence((preference.skipped_items as Array<Record<string, unknown>>) || [], tid, simDt, hp, skippedOlder)
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }
  if (leaf === 'changed') {
    const changedInWindow = req<number>(curves, 'changed_in_window', 'history_curves')
    const e = changedEvidence((preference.changed_from_items as Array<Record<string, unknown>>) || [], tid, simDt, hp, changedInWindow)
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }
  if (leaf === 'acceptance') {
    const rates = (history.content_proposal_acceptance_rate as Record<string, number>) || {}
    const rateScale = req<number>(curves, 'rate_scale', 'history_curves')
    const e = tid in rates ? (2.0 * Number(rates[tid])) / rateScale - 1.0 : 0.0
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }
  if (leaf === 'recovery') {
    const rates = (history.content_recovery_rate as Record<string, number>) || {}
    const rateScale = req<number>(curves, 'rate_scale', 'history_curves')
    const e = tid in rates ? (2.0 * Number(rates[tid])) / rateScale - 1.0 : 0.0
    return { e, a: 1.0, meta: { alpha: null, beta: null, exact_match: true, provenance: 'cdc_su_explicit' } }
  }

  // Unknown leaf => neutral
  return { e: 0.0, a: 0.0, meta: { alpha: null, beta: null, exact_match: null, provenance: null } }
}

function secondsSince(eventsDt: number | null, simDt: number | null): number | null {
  if (simDt === null || eventsDt === null) return null
  return (simDt - eventsDt) / 1000
}

/** Mirrors `_played_evidence`. */
function playedEvidence(
  playedItems: Array<Record<string, unknown>>,
  tid: string,
  simDt: number | null,
  curve: Record<string, number>,
): number {
  let best: number | null = null
  for (const item of playedItems) {
    if (item.track_id !== tid) continue
    const dt = parseDt(item.last_played_at)
    const delta = secondsSince(dt, simDt)
    let val: number
    if (delta === null) val = 0.0
    else if (delta <= 1800) val = curve.le_30m
    else if (delta <= 86400) val = curve.today
    else if (delta <= 604800) val = curve.le_7d
    else val = curve.else
    best = best === null ? val : Math.min(best, val)
  }
  return best !== null ? best : 0.0
}

/** Mirrors `_older_skip_evidence`. */
function olderSkipEvidence(
  skippedItems: Array<Record<string, unknown>>,
  tid: string,
  simDt: number | null,
  hp: Record<string, unknown>,
  olderVal: number,
): number {
  const window = req<number>(hp, 'skip_exclusion_window_sec', 'hyperparameters')
  for (const item of skippedItems) {
    if (item.track_id !== tid) continue
    const dt = parseDt(item.skipped_at)
    const delta = secondsSince(dt, simDt)
    if (delta !== null && delta > window) return olderVal
  }
  return 0.0
}

/** Mirrors `_changed_evidence`. */
function changedEvidence(
  changedItems: Array<Record<string, unknown>>,
  tid: string,
  simDt: number | null,
  hp: Record<string, unknown>,
  changedVal: number,
): number {
  const window = req<number>(hp, 'skip_exclusion_window_sec', 'hyperparameters')
  for (const item of changedItems) {
    if (item.track_id !== tid) continue
    const dt = parseDt(item.changed_at)
    const delta = secondsSince(dt, simDt)
    if (delta === null || delta <= window) return changedVal
  }
  return 0.0
}

// ---------------------------------------------------------------------------
// Eligibility (§7)
// ---------------------------------------------------------------------------

/** Mirrors `eligibility_reasons`. Returns a list of reason codes; empty means eligible. */
function eligibilityReasons(
  song: ContentSong,
  snap: ContentFeatureSnapshot,
  serviceId: string,
  simDt: number | null,
  hp: Record<string, unknown>,
  seenIds: Set<string>,
): string[] {
  const reasons: string[] = []
  const track = song.spotify_track || ({} as ContentTrack)
  const af = song.spotify_audio_features || ({} as ContentAudioFeatures)
  const flags = song.simulation_flags || {}
  const tid = track.id

  if (track.id !== af.id || track.uri !== af.uri || track.duration_ms !== af.duration_ms) {
    reasons.push('identity_mismatch')
  }
  if (track.is_playable === false) reasons.push('not_playable')
  const market = snap.market
  if (market !== null && market !== undefined) {
    const markets = track.available_markets
    if (markets !== null && markets !== undefined && !markets.includes(market)) {
      reasons.push('market_unavailable')
    }
  }
  if (track.restrictions) reasons.push('restricted')
  const situation = (snap.situation as Record<string, unknown>) || {}
  if (track.explicit && situation.child_present) reasons.push('explicit_under_child')

  const window = req<number>(hp, 'skip_exclusion_window_sec', 'hyperparameters')
  const preference = (snap.preference as Record<string, unknown>) || {}
  const skippedItems = (preference.skipped_items as Array<Record<string, unknown>>) || []
  for (const item of skippedItems) {
    if (item.track_id === tid) {
      const delta = secondsSince(parseDt(item.skipped_at), simDt)
      if (delta !== null && delta <= window) {
        reasons.push('recent_skip')
        break
      }
    }
  }
  if (seenIds.has(tid)) reasons.push('duplicate')
  if (serviceId === 'humming_karaoke' && Number(flags.humming_karaoke_available ?? 1) !== 1) {
    reasons.push('humming_unavailable')
  }
  if (serviceId === 'full_karaoke') {
    if (Number(flags.full_karaoke_available ?? 1) !== 1) reasons.push('full_karaoke_unavailable')
  }
  return reasons
}

// ---------------------------------------------------------------------------
// Reasons (bilingual)
// ---------------------------------------------------------------------------

/**
 * Mirrors `_build_reasons`. `:.3f` format specs (algorithm.py:569-570,
 * 575-576) are Python-exact via `pyFixed(x, 3)` — see hazard 1/5 in the
 * module doc.
 */
function buildReasons(contributions: Array<ContentFeatureContribution & { leaf: string }>): string[] {
  // Single numeric key, descending — safe as a stable .sort() (see hazard 2).
  const ranked = contributions.slice().sort((a, b) => b.contribution - a.contribution)
  const pos = ranked.filter((c) => c.contribution > 1e-9).slice(0, 2)
  const neg = ranked.filter((c) => c.contribution < -1e-9).slice(-2)

  const reasons: string[] = []
  for (const c of pos) {
    const lab = FEATURE_LABELS[c.leaf] ?? { ja: c.leaf, en: c.leaf }
    reasons.push(`${lab.ja}が推薦に寄与（+${pyFixed(c.contribution, 3)}） / ${lab.en} supports this pick (+${pyFixed(c.contribution, 3)})`)
  }
  for (const c of neg) {
    const lab = FEATURE_LABELS[c.leaf] ?? { ja: c.leaf, en: c.leaf }
    reasons.push(`${lab.ja}がマイナスに作用（${pyFixed(c.contribution, 3)}） / ${lab.en} weighs against it (${pyFixed(c.contribution, 3)})`)
  }
  if (reasons.length === 0) {
    reasons.push('中立的なスコア。 / Neutral score.')
  }
  return reasons
}

// ---------------------------------------------------------------------------
// Plan mode / duration / lighting
// ---------------------------------------------------------------------------

/** Mirrors `_plan_mode`. */
function planMode(serviceId: string): PlanMode {
  if (serviceId === 'humming_karaoke') {
    return {
      service_id: serviceId,
      mode_kind: 'humming',
      chorus_only: true,
      guide_vocal: true,
      driving_lyrics: false,
      fixed_segment_sec: null,
      stopped_only: null,
      simulated_queue: null,
    }
  }
  if (serviceId === 'full_karaoke') {
    return {
      service_id: serviceId,
      mode_kind: 'full_karaoke',
      chorus_only: null,
      guide_vocal: null,
      driving_lyrics: null,
      fixed_segment_sec: null,
      stopped_only: true,
      simulated_queue: true,
    }
  }
  return {
    service_id: serviceId,
    mode_kind: 'playlist',
    chorus_only: null,
    guide_vocal: null,
    driving_lyrics: null,
    fixed_segment_sec: null,
    stopped_only: null,
    simulated_queue: null,
  }
}

/** Mirrors `_lighting`. `params` (not `hp`) is read here — the only `parameters` read in the whole file. */
function lighting(
  serviceId: string,
  hp: Record<string, unknown>,
  params: Record<string, unknown>,
  topValence: number,
): LightingConfiguration {
  const compatible = (params.lighting_compatible_services as string[] | undefined) ?? []
  if (!compatible.includes(serviceId)) return null
  const lut = req<Record<string, unknown>>(hp, 'lighting_lookup', 'hyperparameters')
  let cue: unknown
  if (topValence >= (lut.high_threshold as number)) cue = lut.high_cue
  else if (topValence <= (lut.low_threshold as number)) cue = lut.low_cue
  else cue = lut.mid_cue
  return { enabled: true, cue_basis: lut.cue_basis, notes: cue }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors `_error`. Deliberately OMITS `scored_tail`/`cut_margin`/
 * `tail_truncated` entirely (not even `null`) — algorithm.py's own `_error()`
 * dict never has those 3 keys, only the `complete_plan` success path does.
 * `expectParity` compares object KEY SETS exactly, so including them here
 * (even as `null`/`[]`) would be a real divergence from every captured
 * error-path golden case.
 */
function errorResult(decisionType: string, serviceId: string | null | undefined, hp: Record<string, unknown> | null | undefined, reason: string): CompletePlan {
  const resolvedServiceId = serviceId && MUSIC_SERVICES.has(serviceId) ? serviceId : 'music_playlist'
  const hasPlanCount = hp && typeof hp === 'object' && Object.prototype.hasOwnProperty.call(hp, 'plan_item_count')
  const requestedItemCount = hp && typeof hp === 'object' ? (hasPlanCount ? Number((hp as any).plan_item_count) : 5) : 5
  return {
    decision_type: decisionType,
    selected_service_id: resolvedServiceId,
    requested_item_count: requestedItemCount,
    returned_item_count: 0,
    ordered_items: [],
    mode: planMode(resolvedServiceId),
    expected_duration_sec: 0,
    lighting_configuration: null,
    approval_policy: 'explicit_opt_in',
    completion_rule: 'plan_exhausted',
    next_transition_policy: 'await_user',
    excluded_items: [],
    unused_available_features: [],
    missing_features: [],
    algorithm_provenance: { error_reason: reason },
  }
}

/**
 * Mirrors `_error(...) | {"excluded_items": excluded_items}` (Python dict
 * union) used by the `no_proposal` and `insufficient_eligible_items` paths —
 * same 16-key shape as `errorResult`, with `excluded_items` replaced by the
 * REAL accumulated list instead of the hardcoded `[]`.
 */
function errorResultWithExcluded(
  decisionType: string,
  serviceId: string | null | undefined,
  hp: Record<string, unknown> | null | undefined,
  reason: string,
  excludedItems: ExcludedItem[],
): CompletePlan {
  return { ...errorResult(decisionType, serviceId, hp, reason), excluded_items: excludedItems }
}

// ---------------------------------------------------------------------------
// Public API — the algorithm.py evaluate() port.
// ---------------------------------------------------------------------------

export function evaluate(context: ContentSelectorInput): CompletePlan {
  const hp = context.hyperparameters
  const params = context.parameters || {}
  const serviceId = context.selected_service_id
  const purpose = context.trigger_purpose
  const extensions = context.enabled_feature_extensions || []
  const genreOn = extensions.includes('genre_affinity_v1')
  const snap: ContentFeatureSnapshot = { ...(context.feature_snapshot || {}) }
  const catalog = snap.catalog || {}
  const situation = (snap.situation as Record<string, unknown>) || {}
  const scene = snap.current_scene
  const gav1 = genreOn ? snap.genre_affinity_v1 : null
  const simDt = parseDt(context.simulation_time)

  // 1. service gating (FR-003a)
  if (!serviceId) {
    return errorResult('invalid_request', serviceId, hp, 'missing_selected_service_id')
  }
  if (!MUSIC_SERVICES.has(serviceId)) {
    return errorResult('unsupported_recipe', serviceId, hp, 'service_not_a_music_recipe')
  }

  // full-karaoke stopped-motion gate (before scoring)
  if (serviceId === 'full_karaoke' && situation.motion_state === 'driving') {
    return errorResult('full_karaoke_requires_stopped', serviceId, hp, 'full_karaoke_while_moving')
  }

  // 2. resolve effective weights once
  let weights: Record<string, WeightEntry>
  try {
    weights = resolveWeights(hp, serviceId, purpose ?? '', genreOn)
  } catch (exc) {
    if (exc instanceof ContentConfigError) {
      return errorResult('invalid_configuration', serviceId, hp, exc.message)
    }
    throw exc
  }

  const scoredLeaves: Record<string, WeightEntry> = {}
  for (const [k, e] of Object.entries(weights)) {
    if (e.mask === 1) scoredLeaves[k] = e
  }

  // 3-5. per candidate: eligibility, traits, scoring
  const eligibleIds = (context.eligible_candidates || []).map((c) => c.candidate_id)
  const excludedItems: ExcludedItem[] = (context.excluded_candidates || []).map((c) => ({
    item_id: c.candidate_id,
    reason_codes: [c.platform_reason ?? 'platform_excluded'],
  }))

  type ScoredSong = {
    track: ContentTrack
    traits: TraitValues
    item_fit: number
    contributions: Array<ContentFeatureContribution & { leaf: string }>
    situation_fit: number
    preference_fit: number
    history_fit: number
    strongest_support: StrongestContribution
    strongest_oppose: StrongestContribution
  }

  const seen = new Set<string>()
  const scoredSongs: ScoredSong[] = []

  try {
    for (const cid of eligibleIds) {
      if (!Object.prototype.hasOwnProperty.call(catalog, cid)) {
        throw new ContentCatalogError(`candidate '${cid}' not present in catalog`)
      }
      const song = catalog[cid]
      const reasons = eligibilityReasons(song, snap, serviceId, simDt, hp, seen)
      if (reasons.length > 0) {
        excludedItems.push({ item_id: cid, reason_codes: reasons })
        continue
      }
      seen.add(cid)
      const track = song.spotify_track
      const af = song.spotify_audio_features
      const traits = deriveTraits(af, hp)
      const contributions: Array<ContentFeatureContribution & { leaf: string }> = []
      let itemFitSum = 0.0
      const catSubtotals: Record<string, number> = { situation: 0.0, preference: 0.0, history: 0.0 }

      for (const [leaf, entry] of Object.entries(scoredLeaves)) {
        const { e: eI, a: aI, meta } = featureEA(leaf, entry, snap, serviceId, track, traits, hp, simDt, genreOn, gav1, scene)
        const rI = eI * aI
        const contribution = entry.effective_weight * rI
        itemFitSum += contribution
        const cat = String(entry.category || '').toLowerCase()
        if (cat in catSubtotals) catSubtotals[cat] += contribution
        contributions.push({
          leaf,
          feature_id: entry.feature_id,
          e_i: norm0(eI),
          a_i: norm0(aI),
          alpha: meta.alpha,
          beta: meta.beta,
          exact_match: meta.exact_match,
          matched_artist_ids: meta.matched_artist_ids ?? null,
          response_provenance: meta.provenance,
          r_i: norm0(rI),
          base_weight: entry.base_weight,
          purpose_multiplier: entry.purpose_multiplier,
          mask: entry.mask,
          effective_weight: entry.effective_weight,
          contribution: norm0(contribution),
          formula_version: req(hp, 'formula_version', 'hyperparameters'),
        })
      }

      const itemFit = norm0(clamp(itemFitSum, -1.0, 1.0))
      let support: (ContentFeatureContribution & { leaf: string }) | null = null
      let oppose: (ContentFeatureContribution & { leaf: string }) | null = null
      for (const c of contributions) {
        if (support === null || c.contribution > support.contribution) support = c
        if (oppose === null || c.contribution < oppose.contribution) oppose = c
      }
      const strongestSupport: StrongestContribution = support !== null && support.contribution > 0 ? { feature_id: support.feature_id, contribution: support.contribution } : null
      const strongestOppose: StrongestContribution = oppose !== null && oppose.contribution < 0 ? { feature_id: oppose.feature_id, contribution: oppose.contribution } : null

      scoredSongs.push({
        track,
        traits,
        item_fit: itemFit,
        contributions,
        situation_fit: norm0(catSubtotals.situation),
        preference_fit: norm0(catSubtotals.preference),
        history_fit: norm0(catSubtotals.history),
        strongest_support: strongestSupport,
        strongest_oppose: strongestOppose,
      })
    }
  } catch (exc) {
    if (exc instanceof ContentCatalogError) {
      return errorResult('invalid_catalog', serviceId, hp, exc.message)
    }
    if (exc instanceof ContentConfigError) {
      return errorResult('invalid_configuration', serviceId, hp, exc.message)
    }
    throw exc
  }

  const planCount = Math.trunc(Number(req(hp, 'plan_item_count', 'hyperparameters')))

  if (scoredSongs.length === 0) {
    return errorResultWithExcluded('no_proposal', serviceId, hp, 'all_candidates_excluded', excludedItems)
  }
  if (scoredSongs.length < planCount) {
    return errorResultWithExcluded('insufficient_eligible_items', serviceId, hp, 'fewer_eligible_than_count', excludedItems)
  }

  // sort (item_fit desc, id asc), take N. Explicit tuple comparator — see
  // hazard 2 in the module doc.
  scoredSongs.sort((a, b) => {
    if (a.item_fit !== b.item_fit) return b.item_fit - a.item_fit
    if (a.track.id < b.track.id) return -1
    if (a.track.id > b.track.id) return 1
    return 0
  })
  const chosen = scoredSongs.slice(0, planCount)

  // ---- scored tail (B2) ----------------------------------------------------
  const TAIL_CAP = 20
  const dropped = scoredSongs.slice(planCount)
  const scoredTail: ScoredTailItem[] = dropped.slice(0, TAIL_CAP).map((s, offset) => ({
    item_id: s.track.id,
    rank: planCount + offset + 1,
    item_fit: s.item_fit,
    feature_contributions: s.contributions.map(({ leaf, ...rest }) => rest),
  }))
  const cutMargin = dropped.length > 0 ? chosen[chosen.length - 1].item_fit - dropped[0].item_fit : null
  const tailTruncated = dropped.length > TAIL_CAP

  // 6. build plan
  const orderedItems: OrderedItem[] = chosen.map((s, idx) => {
    const t = s.traits
    return {
      position: idx + 1,
      item_id: s.track.id,
      item_fit: s.item_fit,
      trait_values: {
        arousal: t.arousal,
        valence: t.valence,
        humming_ease: t.humming_ease,
        full_karaoke_ease: t.full_karaoke_ease,
        arousal_signed: t.arousal_signed,
        valence_signed: t.valence_signed,
      },
      feature_contributions: s.contributions.map(({ leaf, ...rest }) => rest),
      rationale: buildReasons(s.contributions),
      situation_fit: s.situation_fit,
      preference_fit: s.preference_fit,
      history_fit: s.history_fit,
      strongest_support: s.strongest_support,
      strongest_oppose: s.strongest_oppose,
    }
  })

  const mode = planMode(serviceId)
  let expectedDuration: number
  let durationBasis: string
  if (serviceId === 'humming_karaoke') {
    const fixedSegmentSec = Math.trunc(Number(req(hp, 'fixed_humming_segment_sec', 'hyperparameters')))
    mode.fixed_segment_sec = fixedSegmentSec
    expectedDuration = planCount * fixedSegmentSec
    durationBasis = 'simulated_fixed_segment'
  } else {
    const totalMs = chosen.reduce((sum, s) => sum + Math.trunc(Number(s.track.duration_ms)), 0)
    expectedDuration = Math.floor(totalMs / 1000)
    durationBasis = 'summed_track_durations'
  }

  const topValence = chosen[0].traits.valence
  const lightingConfiguration = lighting(serviceId, hp, params, topValence)

  // ---- disposition-driven provenance over the full frozen registry (§9 / A.2) ----
  const registry = context.feature_dispositions || []
  const regById: Record<string, Record<string, unknown>> = {}
  for (const r of registry) regById[r.feature_id as string] = r

  const scoredFids = new Set(Object.values(scoredLeaves).map((e) => e.feature_id))
  const allLeafFids = new Set(Object.values(weights).map((e) => e.feature_id))

  const presentFids = new Set<string>()
  const respProvByFid: Record<string, unknown> = {}
  for (const s of chosen) {
    for (const c of s.contributions) {
      const fid = c.feature_id
      if (!(fid in respProvByFid)) respProvByFid[fid] = c.response_provenance
      if (c.e_i !== 0.0 || c.a_i !== 0.0) presentFids.add(fid)
    }
  }

  const effWeightByFid: Record<string, number> = {}
  for (const e of Object.values(scoredLeaves)) effWeightByFid[e.feature_id] = e.effective_weight

  const effective = (fid: string): 'active' | 'missing_neutral' | 'context_only' => {
    if (scoredFids.has(fid)) return presentFids.has(fid) ? 'active' : 'missing_neutral'
    return 'context_only'
  }

  const reportIds = Object.keys(regById)
  for (const fid of Array.from(allLeafFids).sort()) {
    if (!(fid in regById)) reportIds.push(fid)
  }

  const featureDispositions: Array<Record<string, unknown>> = []
  const activeFeatures: string[] = []
  const contextOnlyFeatures: string[] = []
  const missingFeaturesList: string[] = []
  for (const fid of reportIds) {
    const reg = regById[fid]
    const eff = effective(fid)
    featureDispositions.push({
      feature_id: fid,
      category: reg ? reg.category : 'Added construct',
      feature_origin: reg ? reg.feature_origin : 'added_construct',
      registry_disposition: reg ? reg.disposition : 'scored',
      response_provenance: respProvByFid[fid] ?? (reg ? (reg.response_provenance ?? null) : null) ?? 'context_only',
      effective_disposition: eff,
      effective_weight: effWeightByFid[fid] ?? null,
    })
    if (eff === 'active') activeFeatures.push(fid)
    else if (eff === 'missing_neutral') missingFeaturesList.push(fid)
    else contextOnlyFeatures.push(fid)
  }

  const activeFeaturesSorted = Array.from(new Set(activeFeatures)).sort()
  const contextOnlyFeaturesSorted = Array.from(new Set(contextOnlyFeatures)).sort()
  const missingFeaturesSorted = Array.from(new Set(missingFeaturesList)).sort()
  const unusedAvailable = contextOnlyFeaturesSorted

  const normalizedEffectiveWeights: Record<string, number> = {}
  for (const e of Object.values(scoredLeaves)) normalizedEffectiveWeights[e.feature_id] = e.effective_weight

  const provenance: Record<string, unknown> = {
    selected_service_id: serviceId,
    trigger_purpose: purpose ?? null,
    lifecycle_stage: context.lifecycle_stage ?? null,
    plan_item_count: planCount,
    contract_version: context.contract_version ?? null,
    catalog_version: context.catalog_version ?? null,
    parameter_set_version: req(hp, 'parameter_set_version', 'hyperparameters'),
    formula_version: req(hp, 'formula_version', 'hyperparameters'),
    genre_affinity_v1_enabled: genreOn,
    directional_hypothesis: req(hp, 'directional_hypothesis', 'hyperparameters'),
    active_features: activeFeaturesSorted,
    context_only_features: contextOnlyFeaturesSorted,
    missing_features: missingFeaturesSorted,
    feature_dispositions: featureDispositions,
    normalized_effective_weights: normalizedEffectiveWeights,
    sort_rule: 'item_fit desc, track_id asc',
    duration_basis: durationBasis,
    ordered_track_ids: orderedItems.map((it) => it.item_id),
  }

  return {
    decision_type: 'complete_plan',
    selected_service_id: serviceId,
    requested_item_count: planCount,
    returned_item_count: orderedItems.length,
    ordered_items: orderedItems,
    mode,
    expected_duration_sec: expectedDuration,
    lighting_configuration: lightingConfiguration,
    approval_policy: 'explicit_opt_in',
    completion_rule: 'plan_exhausted',
    next_transition_policy: 'await_user',
    excluded_items: excludedItems,
    scored_tail: scoredTail,
    cut_margin: cutMargin,
    tail_truncated: tailTruncated,
    unused_available_features: unusedAvailable,
    missing_features: missingFeaturesSorted,
    algorithm_provenance: provenance,
  }
}
