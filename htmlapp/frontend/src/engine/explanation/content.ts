/**
 * content_explanation — port of `services/content_explanation.py` (521 LOC):
 * the causal-bridge machinery (`_effective_alpha_beta`, `demand_phrase`,
 * `_arousal_band`, `_axis_satisfaction`, `_axis_trait_words`, `_axis_choice`,
 * `_axis_bridge`, `causal_bridge_lines`), `_song_facts_lines`, `build_prompt`,
 * `_legacy_join`, the feature-family classifier (`_family_of`), the two
 * competing opening-sentence builders (`_dominant_family_sentence1` /
 * `_situation_led_sentence1`), and `template`. Uses the shared kernel
 * `./builder` for labels, factor extraction, and the shared fact-translator
 * sentences — mirroring how the Python module imports it as `_k`.
 *
 * Ported together with `service.ts` (C3 task 3). `build_prompt` IS in scope
 * here (unlike `trigger.ts`'s C3 task 2 exclusion) — see `service.ts`'s own
 * module doc comment for why.
 *
 * HAZARD 8 (bool-as-int): every numeric `isinstance(x, (int, float))` guard
 * in `content_explanation.py` ACCEPTS bool (11 sites, verified individually
 * — none carries the `and not isinstance(x, bool)` exclusion; see
 * task-3-report.md's table) — the OPPOSITE asymmetry from `trigger.ts`
 * (10 sites, only 1 accepts bool). Mirrored throughout via `numericOrBool`
 * (from `./builder`), EXCEPT `_situation_led_sentence1`'s `value` guard,
 * which must preserve the ORIGINAL bool/number type (not a coerced plain
 * number) because it is later handed to `valueDisplay`, whose OWN explicit
 * `typeof === 'boolean'` branch depends on seeing the real type — see that
 * function's own comment.
 *
 * HAZARD 7: one `:.Nf`-equivalent site (`causal_bridge_lines`'s
 * `f"...{contribution:+.3f}"`, a SIGNED 3-decimal spec) — `pyFixed` plus an
 * explicit `+` prefix (`signedFixed3` below), since `pyFixed` itself only
 * emits `-` for negative values, never `+` for non-negative ones.
 *
 * HAZARD 5: zero bare-float f-string interpolations (19 f-string lines
 * total, 18 interpolate only strings/labels, 1 is the `:+.3f` site above) —
 * `pyFloatRepr` is not needed and is not imported (checked, not assumed).
 */

import {
  type CategoryReadout,
  type ExplainMessage,
  type ExplanationContext,
  type ExplanationPrompt,
  type ExplanationTarget,
  type FeatureLabel,
  CONTENT_LANG_SEP,
  CONTENT_REASON_SYSTEM,
  FORMAT_REMINDER,
  categoryReadout,
  contributionOr0,
  factorsFromTarget,
  historySentences,
  labelFor,
  numericOrBool,
  preferenceSentence,
  scoreEvidence,
  situationSentence,
  valueDisplay,
} from './builder'
import { pyFixed } from '../../data/packages/builtin/mathUtils'

// FIX-D3: motion_state/motion is not a causal, demand-bearing situation
// feature — narrating it produces nonsense like "car motion is high, so the
// situation calls for calm music". Never treat it as a bridge anchor.
const NON_BRIDGE_FEATURES = new Set<string>(['motion_state', 'motion'])

// ---------------------------------------------------------------------------
// Small local mirrors (per-module copy convention — see `py_repr.ts`'s own
// doc comment on this codebase's established convention for trivial,
// independently-reviewable Python-mirroring one-liners).
// ---------------------------------------------------------------------------

/** `str(v)` — Python's `str(None) == "None"`, not JS's `String(null) ==
 * "null"`. Number/float int-vs-float `repr` divergence (Task 2's
 * `featureIdStr` precedent) is a DOCUMENTED, accepted limitation here too:
 * every real caller of `pyStr` in this module passes a string, `None`, or a
 * bool (never a bare Python float) — `item_id`/`song_name`/`song_artist`/
 * rationale-list entries are all Pydantic `str`-typed on real evidence. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

/** Mirrors Python's `str.capitalize()`: uppercase the first character,
 * lowercase the rest — see `trigger.ts`'s own `pyCapitalize` for the same
 * mirror at an analogous site (small per-module copy, not shared). */
function pyCapitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** `str(row.get("feature_id", ""))` — Python's `.get(key, default)` only
 * substitutes the default when the KEY IS ABSENT; an explicit `None` value
 * still goes through `str()`, printing `"None"` (see `trigger.ts`'s
 * `featureIdStr` for the same mirror at an analogous site). */
function featureIdStr(fc: Record<string, unknown>): string {
  if (!('feature_id' in fc)) return ''
  const v = fc.feature_id
  if (v === null) return 'None'
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

/** Mirrors Python's `f"{x:+.3f}"` — `pyFixed`'s magnitude formatting
 * (hazard 7: banker's-rounding ties) plus an explicit `+` for non-negative
 * values, since `pyFixed` itself only ever emits the `-` sign (never `+`). */
function signedFixed3(x: number): string {
  const s = pyFixed(x, 3)
  return s.startsWith('-') ? s : `+${s}`
}

/** `numericOrBool` over a fixed pair, dropping non-numeric/non-bool
 * entries — the shared shape both `_song_facts_lines`' and `build_prompt`'s
 * `eases` list comprehensions use. */
function numericOrBoolPair(a: unknown, b: unknown): number[] {
  const out: number[] = []
  const na = numericOrBool(a)
  if (na !== null) out.push(na)
  const nb = numericOrBool(b)
  if (nb !== null) out.push(nb)
  return out
}

// ---------------------------------------------------------------------------
// _song_facts_lines
// ---------------------------------------------------------------------------

/**
 * Semantic facts about the chosen song (content step) — derived from the
 * item's decision-time trait values + its oshi-match contribution, so the
 * model can tell the real story (energy, mood, sing-along ease, oshi match)
 * instead of guessing from opaque feature ids. `song_name` is optional
 * (resolved from the catalog by the caller when available).
 */
export function songFactsLines(target: ExplanationTarget, context: ExplanationContext): string[] {
  const out: string[] = []
  const name = context.song_name
  if (name) out.push(`- Title: "${pyStr(name)}"`)

  const tv = asRecord(target.trait_values)
  const arousal = numericOrBool(tv.arousal)
  if (arousal !== null) {
    const band = arousal >= 0.62 ? 'high (energetic/upbeat)' : arousal < 0.40 ? 'low (calm/relaxed)' : 'medium'
    out.push(`- Energy/arousal: ${band}`)
  }
  const valence = numericOrBool(tv.valence)
  if (valence !== null) {
    const mood = valence >= 0.55 ? 'bright/positive' : valence < 0.40 ? 'darker/melancholic' : 'neutral'
    out.push(`- Mood/valence: ${mood}`)
  }
  const eases = numericOrBoolPair(tv.humming_ease, tv.full_karaoke_ease)
  if (eases.length > 0) {
    const ease = Math.max(...eases)
    out.push(`- Sing-along ease: ${ease >= 0.66 ? 'high' : ease < 0.40 ? 'low' : 'medium'}`)
  }

  const rows = Array.isArray(target.feature_contributions) ? target.feature_contributions : []
  for (const fcRaw of rows) {
    const fc = fcRaw as unknown as Record<string, unknown>
    if (fc.feature_id === 'oshi_artists') {
      // `bool(fc.get("exact_match")) or fc.get("e_i") == 1.0` — the `== 1.0`
      // is a Python cross-type numeric equality: a bool `e_i` of `True`
      // equals `1.0` in Python (hazard 8). `numericOrBool(...) === 1.0`
      // mirrors that; a bare `fc.e_i === 1.0` would NOT (JS `true === 1.0`
      // is `false`, unlike Python).
      const isOshi = Boolean(fc.exact_match) || numericOrBool(fc.e_i) === 1.0
      out.push(`- By the driver's oshi (favorite artist): ${isOshi ? 'yes' : 'no'}`)
      break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// _effective_alpha_beta / demand_phrase / _arousal_band
// ---------------------------------------------------------------------------

/** Static Context Response Matrix demand (content algorithm §5.2), used when
 * a contribution row does not carry alpha/beta. Values are illustrative
 * sign/intent only — only the SIGN is consumed by `_axis_bridge`/`_axis_choice`. */
const STATIC_DEMAND: Record<string, readonly [number, number]> = {
  drowsiness_level: [0.8, 0.2],
  drowsiness: [0.8, 0.2],
  fatigue_level: [-0.5, 0.5],
  fatigue: [-0.5, 0.5],
  monotony_level: [0.9, 0.1],
  monotony: [0.9, 0.1],
  traffic_state: [-0.4, 0.6],
  traffic: [-0.4, 0.6],
  night_state: [-0.5, 0.5],
  night: [-0.5, 0.5],
}

/** Directional features whose demand sign depends on the run's
 * `directional_hypothesis` hyperparameter. When a row for one of these
 * carries no alpha/beta we cannot know which hypothesis produced it, so we
 * stay silent rather than risk an inverted causal claim. */
const DIRECTIONAL_STATIC_UNSAFE = new Set<string>([
  'fatigue_level',
  'fatigue',
  'traffic_state',
  'traffic',
  'night_state',
  'night',
])

/**
 * Resolve usable (alpha, beta) floats for a feature, falling back to the
 * static Context Response Matrix demand when the row carries neither.
 *
 * Returns `null` when there is no usable demand at all (both ~0 / absent and
 * no static entry, or a directional feature with no row alpha/beta) — the
 * feature is then not a causal bridge.
 */
export function effectiveAlphaBeta(alphaIn: unknown, betaIn: unknown, featureId: string): [number, number] | null {
  const isNone = (v: unknown): boolean => v === null || v === undefined
  let alpha = alphaIn
  let beta = betaIn
  if (isNone(alpha) && isNone(beta)) {
    if (DIRECTIONAL_STATIC_UNSAFE.has(featureId)) return null
    const pair = STATIC_DEMAND[featureId]
    if (pair) {
      alpha = pair[0]
      beta = pair[1]
    } else {
      alpha = null
      beta = null
    }
  }
  if (isNone(alpha) && isNone(beta)) return null
  const a = contributionOr0(alpha)
  const b = contributionOr0(beta)
  if (Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6) return null
  return [a, b]
}

/**
 * Bilingual 'what this situation calls for' from arousal/valence demand.
 *
 * Returns `null` when there is no usable demand. Kept as the AROUSAL-led
 * legacy phrasing helper (still importable with this exact contract, and
 * exercised directly by Python's own unit tests); the axis-aware,
 * satisfaction-honest logic used by `causalBridgeLines`/`template` lives in
 * `axisBridge` below. NOT called from anywhere else in this module (verified
 * — `grep -n "demand_phrase(" content_explanation.py` matches only its own
 * `def` line; see task-3-report.md).
 */
export function demandPhrase(alpha: unknown, beta: unknown, featureId: string): FeatureLabel | null {
  const resolved = effectiveAlphaBeta(alpha, beta, featureId)
  if (resolved === null) return null
  const [a, b] = resolved
  let en: string
  let ja: string
  if (a > 0) {
    en = 'energetic, upbeat music'
    ja = '活発で高揚感のある曲'
  } else if (a < 0) {
    en = 'calm, soothing music'
    ja = '穏やかで落ち着いた曲'
  } else {
    en = 'brighter, more positive music'
    ja = 'より明るくポジティブな曲'
  }
  if (a !== 0 && b > 0) {
    en += ' (and a bit brighter)'
    ja += '（やや明るめ）'
  }
  return { en, ja }
}

export function arousalBand(v: number): 'high' | 'medium' | 'low' {
  return v >= 0.62 ? 'high' : v < 0.4 ? 'low' : 'medium'
}

// ── FIX-D2: axis-consistent demand + satisfaction (arousal vs valence) ──────

type Axis = 'arousal' | 'valence'
type Direction = 'energize' | 'soothe' | 'bright' | 'darker'

const AXIS_PHRASES: Record<string, FeatureLabel> = {
  'arousal:energize': { en: 'energetic, upbeat music', ja: '活発で高揚感のある曲' },
  'arousal:soothe': { en: 'calm, soothing music', ja: '穏やかで落ち着いた曲' },
  'valence:bright': { en: 'brighter, more positive music', ja: 'より明るくポジティブな曲' },
  'valence:darker': { en: 'more subdued, mellow music', ja: 'より落ち着いた雰囲気の曲' },
}

export function axisSatisfaction(
  axis: Axis,
  direction: Direction,
  arousalBandVal: 'high' | 'medium' | 'low' | null,
  valence: number | null,
): boolean {
  if (axis === 'arousal') {
    return direction === 'energize' ? arousalBandVal === 'high' : arousalBandVal === 'low'
  }
  if (valence === null) return false
  return direction === 'bright' ? valence >= 0.55 : valence < 0.4
}

/** Bilingual description of the song's ACTUAL trait on the given axis. */
export function axisTraitWords(
  axis: Axis,
  arousalBandVal: 'high' | 'medium' | 'low' | null,
  valence: number | null,
): [string, string] {
  if (axis === 'arousal') {
    const band = arousalBandVal || 'medium'
    const en = { high: 'high-energy', medium: 'medium-energy', low: 'calm, low-energy' }[band]
    const ja = { high: 'ハイエネルギー', medium: '中程度のエネルギー', low: '落ち着いた低めのエネルギー' }[band]
    return [en, ja]
  }
  if (valence === null) return ['neutral in mood', '中立的な雰囲気']
  if (valence >= 0.55) return ['bright', '明るい雰囲気']
  if (valence < 0.4) return ['darker, more subdued', 'より落ち着いた雰囲気']
  return ['neutral in mood', '中立的な雰囲気']
}

/**
 * Pick the (axis, direction, satisfied) the row's demand should be narrated
 * with: prefer a SATISFIED axis; if both/neither axis is satisfied, pick the
 * larger |coefficient| (tie -> arousal). `null` when neither coefficient
 * carries a demand.
 */
export function axisChoice(
  a: number,
  b: number,
  arousalBandVal: 'high' | 'medium' | 'low' | null,
  valence: number | null,
): [Axis, Direction, boolean] | null {
  const candidates: Array<[Axis, Direction, number]> = []
  if (Math.abs(a) > 1e-9) candidates.push(['arousal', a > 0 ? 'energize' : 'soothe', Math.abs(a)])
  if (Math.abs(b) > 1e-9) candidates.push(['valence', b > 0 ? 'bright' : 'darker', Math.abs(b)])
  if (candidates.length === 0) return null

  const scored: Array<[Axis, Direction, number, boolean]> = candidates.map(([axis, direction, coeff]) => [
    axis,
    direction,
    coeff,
    axisSatisfaction(axis, direction, arousalBandVal, valence),
  ])
  const satisfied = scored.filter((c) => c[3])
  const pool = satisfied.length > 0 ? satisfied : scored
  // Python: sorted(key=lambda c: (-c[2], 0 if c[0]=="arousal" else 1)) —
  // coeff DESCENDING, arousal-before-valence tiebreak. At most 2 candidates
  // exist (one per axis), so this total order needs no stability guarantee
  // beyond the explicit tiebreak already covering every tie.
  const sorted = [...pool].sort((x, y) => {
    if (x[2] !== y[2]) return y[2] - x[2]
    const tx = x[0] === 'arousal' ? 0 : 1
    const ty = y[0] === 'arousal' ? 0 : 1
    return tx - ty
  })
  const [axis, direction, , isSatisfied] = sorted[0]
  return [axis, direction, isSatisfied]
}

export interface AxisBridgeInfo {
  demand_en: string
  demand_ja: string
  trait_en: string
  trait_ja: string
  satisfied: boolean
}

/** Full bilingual axis-consistent bridge facts for a row, or `null`.
 *
 * NOTE (documented, provably unreachable branch): the `choice === null`
 * early-return below can NEVER fire when `a`/`b` originate from
 * `effectiveAlphaBeta` (both this module's real call sites) — that function
 * already rejects the pair unless at least one of `|a|`/`|b|` is `>= 1e-6`,
 * which is strictly greater than `axisChoice`'s own `1e-9` candidate floor,
 * so a resolved pair ALWAYS yields at least one candidate. Ported anyway
 * (defensive, matches Python's own defensive `if choice is None: return
 * None`), not removed — see task-3-report.md's branch-coverage table. */
export function axisBridge(
  a: number,
  b: number,
  arousalBandVal: 'high' | 'medium' | 'low' | null,
  valence: number | null,
): AxisBridgeInfo | null {
  const choice = axisChoice(a, b, arousalBandVal, valence)
  if (choice === null) return null
  const [axis, direction, satisfied] = choice
  const phrase = AXIS_PHRASES[`${axis}:${direction}`]
  const [traitEn, traitJa] = axisTraitWords(axis, arousalBandVal, valence)
  return { demand_en: phrase.en, demand_ja: phrase.ja, trait_en: traitEn, trait_ja: traitJa, satisfied }
}

/**
 * One line per situation feature that carries a demand, narrating the AXIS
 * (arousal or valence) the song actually satisfies and only claiming a
 * match when it truly does (FIX-D2) — the situation->trait causal arrow.
 */
export function causalBridgeLines(target: ExplanationTarget): string[] {
  const tv = asRecord(target.trait_values)
  const arousalNum = numericOrBool(tv.arousal)
  const arousalBandVal = arousalNum !== null ? arousalBand(arousalNum) : null
  const valenceNum = numericOrBool(tv.valence)

  const out: string[] = []
  const rows = Array.isArray(target.feature_contributions) ? target.feature_contributions : []
  for (const fcRaw of rows) {
    const fc = fcRaw as unknown as Record<string, unknown>
    const fid = featureIdStr(fc)
    if (NON_BRIDGE_FEATURES.has(fid)) continue
    const resolved = effectiveAlphaBeta(fc.alpha, fc.beta, fid)
    if (resolved === null) continue
    const [a, b] = resolved
    const info = axisBridge(a, b, arousalBandVal, valenceNum)
    if (info === null) continue
    const lab = labelFor(fid)
    const contribution = contributionOr0(fc.contribution)
    const verdict = info.satisfied
      ? `; this song is ${info.trait_en}, which matches`
      : `, though this song leans ${info.trait_en}`
    out.push(
      `- ${lab.ja} / ${lab.en}: the situation calls for ${info.demand_en}` +
        `${verdict} (contribution ${signedFixed3(contribution)}).`,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// build_prompt
// ---------------------------------------------------------------------------

/**
 * Content branch — fact-rich reasoning-mode prompt. Hands the model
 * natural-language FACTS (the song's character, the driver's
 * situation/taste/history) plus the response matrix in the system prompt,
 * and lets it reason the causal story itself.
 */
export function buildPrompt(target: ExplanationTarget, context: ExplanationContext): ExplanationPrompt {
  const kindEn = 'song'
  // `str(target.get("item_id") or "")` — WITH an `or ""` guard, unlike
  // service.ts's bare `str(target.get("candidate_id"))` (no guard there).
  // Two genuinely different Python fallback policies at two different call
  // sites — mirrored as-is, not unified.
  const rawItemId = target.item_id
  const targetId = rawItemId ? pyStr(rawItemId) : ''
  const rank = target.position ?? null
  const fit = target.item_fit ?? null

  const factors = factorsFromTarget(target)
  let supporting = (Array.isArray(target.supporting_feature_ids) ? target.supporting_feature_ids : []).map(pyStr)
  let opposing = (Array.isArray(target.opposing_feature_ids) ? target.opposing_feature_ids : []).map(pyStr)
  if (supporting.length === 0) {
    const ss = target.strongest_support
    if (ss && typeof ss === 'object' && !Array.isArray(ss) && (ss as Record<string, unknown>).feature_id) {
      supporting = [pyStr((ss as Record<string, unknown>).feature_id)]
    }
  }
  if (opposing.length === 0) {
    const so = target.strongest_oppose
    if (so && typeof so === 'object' && !Array.isArray(so) && (so as Record<string, unknown>).feature_id) {
      opposing = [pyStr((so as Record<string, unknown>).feature_id)]
    }
  }

  const songFacts = songFactsLines(target, context)
  const bridge = causalBridgeLines(target)
  const readout = categoryReadout(target)

  const grounding: Record<string, unknown> = {
    step: 'content',
    target_id: targetId,
    kind: kindEn,
    rank,
    fit,
    trigger_purpose: context.trigger_purpose ?? null,
    lifecycle_stage: context.lifecycle_stage ?? null,
    song_facts: songFacts,
    factors,
    supporting,
    opposing,
    causal_bridge: bridge,
    category_readout: readout,
  }

  // ── User message: natural-language facts, no scores-only, no verdict ────
  const songNameRaw = context.song_name
  const name = songNameRaw ? pyStr(songNameRaw) : targetId
  const songArtist = context.song_artist
  const oshiArtist = context.oshi_artist
  const tv = asRecord(target.trait_values)

  const L: string[] = []
  L.push(
    `The assistant selected the song "${name}"` +
      (songArtist ? ` by ${pyStr(songArtist)}` : '') +
      ' for the driver.',
  )

  const arousalNum = numericOrBool(tv.arousal)
  const valenceNum = numericOrBool(tv.valence)
  const eases = numericOrBoolPair(tv.humming_ease, tv.full_karaoke_ease)
  const desc: string[] = []
  if (arousalNum !== null) {
    desc.push(arousalNum >= 0.62 ? 'energetic and lively' : arousalNum < 0.4 ? 'calm and low-energy' : 'moderate-energy')
  }
  if (valenceNum !== null) {
    desc.push(
      valenceNum >= 0.55 ? 'bright and positive in mood' : valenceNum < 0.4 ? 'darker in mood' : 'neutral in mood',
    )
  }
  if (eases.length > 0 && Math.max(...eases) >= 0.66) {
    desc.push('easy to sing along to')
  }
  L.push('')
  L.push('THE SONG: ' + (desc.length > 0 ? 'a song that is ' + desc.join(', ') + '.' : 'the chosen song.'))

  const triggerPurpose = context.trigger_purpose
  const situation = situationSentence(target, typeof triggerPurpose === 'string' ? triggerPurpose : null)
  if (situation) {
    L.push('')
    L.push('THE SITUATION RIGHT NOW: ' + situation)
  }

  const preference = preferenceSentence(context)
  if (preference) {
    L.push('')
    L.push("THE DRIVER'S TASTE: " + preference)
  }

  const history = historySentences(target)
  if (history.length > 0) {
    L.push('')
    L.push("THE DRIVER'S HISTORY WITH THIS SONG/GENRE: " + history.join('; ') + '.')
  }

  const evidence = scoreEvidence(factors, typeof oshiArtist === 'string' ? oshiArtist : null)
  if (evidence.length > 0) {
    L.push('')
    L.push('WHY THE ALGORITHM RANKED IT TOP (strongest reasons first):')
    L.push(...evidence)
  }

  L.push('')
  L.push(FORMAT_REMINDER)

  const messages: ExplainMessage[] = [
    // `.split(...).join(...)` — a replace-all with no regex/escaping hazard,
    // since the target lib is ES2020 (no `String.prototype.replaceAll`).
    // Mirrors Python's `.format(kind=kind_en)` substituting every `{kind}`
    // placeholder in the template.
    { role: 'system', content: CONTENT_REASON_SYSTEM.split('{kind}').join(kindEn) },
    { role: 'user', content: L.join('\n') },
  ]
  return { messages, grounding }
}

// ---------------------------------------------------------------------------
// _legacy_join
// ---------------------------------------------------------------------------

/**
 * Former behavior: variable-length '<ja> / <en>' list -> clean [ja, en].
 *
 * REACHABILITY (per the brief's explicit instruction to confirm this):
 * NOT reachable from any REAL evidence produced by either real content
 * package. `OrderedItem.trait_values` is `SongTraitValues | None`
 * (`app/api/aica_api/models/proposal/content_output.py`), and
 * `SongTraitValues.arousal` is a REQUIRED, non-nullable `float` — so
 * whenever `trait_values` is present at all, `arousal` is guaranteed
 * numeric. BOTH real producers (`aica_transparent_content_selector_v1` and
 * `mock_content_selector_v1`) always populate a full `trait_values` dict
 * with numeric `arousal` (verified: neither's `algorithm.py` has a code
 * path that omits it) — so `template()`'s `arousal_band` is never `null` on
 * real evidence, and `_situation_led_sentence1` finds a real situation-family
 * row with alpha/beta on every real item this task's captured goldens
 * exercise (34 real items scanned, zero reaching `_legacy_join` — see
 * task-3-report.md). Python's own test suite (`test_content_explanation.py`)
 * reaches this function ONLY via hand-constructed dicts that omit
 * `trait_values` entirely. Ported for completeness/parity with Python's
 * public surface, exercised here with the SAME kind of hand-built,
 * `trait_values`-omitting target Python's own tests use — labelled synthetic
 * in the branch-coverage table, not presented as real-reachable.
 */
export function legacyJoin(target: ExplanationTarget): [string, string] {
  const rationale = target.rationale
  const list = Array.isArray(rationale) ? rationale : []
  if (list.length === 0) return ['', '']
  const jaParts: string[] = []
  const enParts: string[] = []
  for (const entry of list) {
    const s = pyStr(entry)
    const idx = s.indexOf(CONTENT_LANG_SEP)
    if (idx >= 0) {
      const left = s.slice(0, idx)
      const right = s.slice(idx + CONTENT_LANG_SEP.length)
      jaParts.push(left.trim())
      enParts.push(right.trim())
    } else {
      jaParts.push(s.trim())
      enParts.push(s.trim())
    }
  }
  return [jaParts.join('、'), enParts.join('; ')]
}

// ── FIX-D1/D5: feature-family classifier (situation vs preference vs history)

/** This module's OWN family classifier — deliberately SEPARATE from
 * `builder.ts`'s `featureFamily` (used only by the fact-rich reasoning
 * prompts' situation/preference/history sentence builders). The two tables
 * are near-identical but NOT byte-identical (e.g. this one includes
 * `genre_affinity`/`scene_genre_usage`, which `builder.ts`'s does not) — the
 * Python module docstring is explicit these must not be merged; verified by
 * diffing the two Python source tables directly. */
const PREFERENCE_FEATURES = new Set<string>([
  'oshi_artists',
  'oshi_tags',
  'oshi_type',
  'oshi',
  'song_singability',
  'service_ease',
  'age_band',
  'age',
  'gender',
  'hobby_interest_tags',
  'hobbies',
  'usage_by_genre',
  'content_tag_usage_level',
  'scene_content_tag_usage_level',
  'genre_usage',
  'scene_genre',
  'genre_affinity',
])
const HISTORY_FEATURES = new Set<string>([
  'catalog_item_usage_level',
  'item_usage',
  'catalog_item_recency_state',
  'content_proposal_acceptance_rate',
  'acceptance',
  'content_recovery_rate',
  'recovery',
  'played_items',
  'played',
  'skipped_items',
  'skipped',
  'changed_from_items',
  'changed',
  'repeated_items',
  'completed_items',
  'cancelled_content_plans',
  'manually_selected_items',
  'content_tag_recency_state',
])
const SITUATION_FEATURES = new Set<string>([
  'drowsiness_level',
  'drowsiness',
  'fatigue_level',
  'fatigue',
  'monotony_level',
  'monotony',
  'traffic_state',
  'traffic',
  'night_state',
  'night',
  'road_type',
  'road',
  'route_tags',
  'route',
  'destination_tags',
  'destination',
  'child_present',
  'child',
  'multiple_passengers',
])

export function familyOf(featureId: string): 'situation' | 'preference' | 'history' | null {
  if (SITUATION_FEATURES.has(featureId)) return 'situation'
  if (PREFERENCE_FEATURES.has(featureId)) return 'preference'
  if (HISTORY_FEATURES.has(featureId)) return 'history'
  return null
}

interface FamPhrase {
  ja: string
  en: string
  short_ja: string
  short_en: string
}

const LEVEL_WORDS_EN: Record<'high' | 'medium' | 'low', string> = { high: 'high', medium: 'elevated', low: 'low' }
// Pre-conjugated so it drops directly in front of "、状況は…" (i-adjective
// renyoukei for high/low; "やや高めで" reads naturally as the medium band).
const LEVEL_WORDS_JA: Record<'high' | 'medium' | 'low', string> = {
  high: '高く',
  medium: 'やや高めで',
  low: '低く',
}

/** This table is content_explanation.py's OWN local dict — NOT
 * `builder.ts`'s `CATEGORY_PHRASES`. The `history` entry genuinely DIFFERS:
 * this table's ja is "利用履歴" (no "運転者の" prefix), while
 * `CATEGORY_PHRASES.history.ja` is "運転者の利用履歴" (WITH the prefix) —
 * confirmed by reading both Python sources side by side. See `service.ts`'s
 * near-identical `DOM_JA`/`DOM_EN` comment for the same trap, independently
 * confirmed in this file too. */
const FAM_PHRASE: Record<'preference' | 'history', FamPhrase> = {
  preference: { ja: '運転者の好み', en: "the driver's taste", short_ja: '好み', short_en: 'your taste' },
  history: { ja: '利用履歴', en: "the driver's history", short_ja: '利用履歴', short_en: 'your history' },
}

/** FIX-D4: only claim taste/history "also reinforced" the choice on a real
 * signal — a blank-profile default (tiny preference_fit) must not invent it. */
const REINFORCE_MIN_ABS = 0.05

/**
 * FIX-D5: when preference/history dominates, lead with that family + its
 * strongest POSITIVE supporting feature. `null` if no such feature (falls
 * through to the situation branch).
 */
export function dominantFamilySentence1(target: ExplanationTarget, dom: 'preference' | 'history'): [string, string] | null {
  let best: [number, Record<string, unknown>] | null = null
  const rows = Array.isArray(target.feature_contributions) ? target.feature_contributions : []
  for (const fcRaw of rows) {
    const fc = fcRaw as unknown as Record<string, unknown>
    const fid = featureIdStr(fc)
    if (familyOf(fid) !== dom) continue
    const c = contributionOr0(fc.contribution)
    if (c <= 0) continue
    if (best === null || c > best[0]) best = [c, fc]
  }
  if (best === null) return null
  const [, fc] = best
  const lab = labelFor(featureIdStr(fc))
  const ph = FAM_PHRASE[dom]
  const ja = `この選択は主に${ph.ja}、特に${lab.ja}によって決まりました。`
  const en = `This choice was led mainly by ${ph.en}, especially ${lab.en}.`
  return [ja, en]
}

/**
 * FIX-D1/D2: strongest demand-bearing SITUATION feature, narrated with its
 * REAL value band and the axis the song actually satisfies. `null`
 * (-> legacy join) when there is no such feature or no numeric arousal.
 */
export function situationLedSentence1(
  target: ExplanationTarget,
  arousalBandVal: 'high' | 'medium' | 'low' | null,
  valence: number | null,
): [string, string] | null {
  let best: [number, Record<string, unknown>, [number, number], unknown] | null = null
  const rows = Array.isArray(target.feature_contributions) ? target.feature_contributions : []
  for (const fcRaw of rows) {
    const fc = fcRaw as unknown as Record<string, unknown>
    const fid = featureIdStr(fc)
    if (NON_BRIDGE_FEATURES.has(fid) || familyOf(fid) !== 'situation') continue
    const resolved = effectiveAlphaBeta(fc.alpha, fc.beta, fid)
    if (resolved === null) continue
    let value: unknown = fc.e_i
    if (value === null || value === undefined) value = fc.feature_value
    // Hazard 8: ACCEPT bool, and — unlike every OTHER numeric coercion in
    // this file — do NOT collapse it to a plain number here. `value` is
    // handed to `valueDisplay` below unchanged, and THAT function's own
    // `typeof === 'boolean'` branch (checked before its numeric branch)
    // needs to see the real type to match Python's `isinstance(value, bool)`
    // check (which also runs BEFORE the numeric check in `_value_display`).
    if (typeof value !== 'number' && typeof value !== 'boolean') continue
    const c = Math.abs(contributionOr0(fc.contribution))
    if (best === null || c > best[0]) best = [c, fc, resolved, value]
  }
  if (best === null || arousalBandVal === null) return null
  const [, fc, [a, b], value] = best
  const info = axisBridge(a, b, arousalBandVal, valence)
  if (info === null) return null
  const lab = labelFor(featureIdStr(fc))
  const level = valueDisplay(value) as 'high' | 'medium' | 'low'
  const levelEn = LEVEL_WORDS_EN[level]
  const levelJa = LEVEL_WORDS_JA[level]
  const [clauseEn, clauseJa] = info.satisfied
    ? [', which matches.', '、それに合致します。']
    : [' — a partial match.', '、部分的な一致です。']
  const ja =
    `${lab.ja}は${levelJa}、状況は${info.demand_ja}を必要とします。` + `この曲は${info.trait_ja}で${clauseJa}`
  const en =
    `${pyCapitalize(lab.en)} is ${levelEn}, so the situation calls for ${info.demand_en}; ` +
    `this song is ${info.trait_en}${clauseEn}`
  return [ja, en]
}

// ---------------------------------------------------------------------------
// template()
// ---------------------------------------------------------------------------

export function template(target: ExplanationTarget): [string, string] {
  const readout: CategoryReadout | null = categoryReadout(target)
  const tv = asRecord(target.trait_values)
  const arousalNum = numericOrBool(tv.arousal)
  const arousalBandVal = arousalNum !== null ? arousalBand(arousalNum) : null
  const valenceNum = numericOrBool(tv.valence)

  const dom = readout ? readout.dominant : null
  let leadFamily: 'preference' | 'history' | null = null
  let sentence1: [string, string] | null = null

  if (dom === 'preference' || dom === 'history') {
    sentence1 = dominantFamilySentence1(target, dom)
    if (sentence1 !== null) leadFamily = dom
  }

  if (sentence1 === null) {
    sentence1 = situationLedSentence1(target, arousalBandVal, valenceNum)
  }

  if (sentence1 === null) {
    return legacyJoin(target)
  }

  let [ja, en] = sentence1

  // Sentence 2 (FIX-D4) — taste/history reinforcement, only when that family
  // is NOT already the sentence-1 lead and it carries a real (>=0.05) signal.
  if (readout) {
    for (const fam of ['preference', 'history'] as const) {
      if (fam === leadFamily) continue
      const val = readout[fam]
      if (Math.abs(val) >= REINFORCE_MIN_ABS) {
        const ph = FAM_PHRASE[fam]
        const verbJa = val > 0 ? 'も後押ししました' : 'は反対に働きました'
        const verbEn = val > 0 ? 'reinforced the choice' : 'pushed against it'
        ja += ` さらに${ph.short_ja}${verbJa}。`
        en += ` ${pyCapitalize(ph.short_en)} also ${verbEn}.`
        break
      }
    }
  }
  return [ja, en]
}
