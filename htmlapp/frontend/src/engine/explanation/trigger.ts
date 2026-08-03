/**
 * trigger_explanation — trigger-fire rank-1 rationale, port of the
 * target-building/template half of `services/trigger_explanation.py` (593
 * LOC): `resolve_category`, `build_target`, `template`, and the display
 * helpers `_num`, `_threshold_for`, `_ranked_rows`, `_fmt_num`,
 * `_score_display`, `_signed_score_display`, `_unit_kind_for`,
 * `_fmt_multiplier`, `_row_value_display`, `_row_phrase`,
 * `_dead_band_reason_applies`.
 *
 * `build_prompt` and `_TRIGGER_REASON_SYSTEM` (the LLM prompt builder) were
 * explicitly out of Task 2's scope (deferred to Task 4's façade, per the
 * brief's own file listing) and are added below by C3 Task 4, alongside the
 * façade functions in `./builder`.
 *
 * TRIGGER evidence is structurally different from service/content: there is
 * no persisted candidate/item to read a "target" out of. It lives on a
 * `FirePoint`/`MergedFirePoint` (`app/api/aica_api/models/run.py` /
 * `merged_run.py`) — one `category` fired, and the fire carries a
 * `feature_contributions` dict of BOTH categories' recorded chains
 * (score/clamped/rows/gates) plus the `criteria` dict (thresholds in force
 * at that tick). `resolveCategory` decides which chain is the review
 * target; `buildTarget` flattens the fire + resolved category into the
 * shape `template()` consumes — the recorded chain's own data, NEVER the
 * sibling category's (see the Python module's own docstring for why: NRI
 * publishes ONE score banded by TWO thresholds, so a "beat the other
 * category" claim would be vacuous and is never made here by construction).
 *
 * Every `:.Nf` format-spec site (`_fmt_num`, `_fmt_multiplier`,
 * `_row_value_display`'s minutes branch) uses `pyFixed` — hazard 7 is this
 * module's primary risk (see task-2-report.md's reconciliation table).
 * There are ZERO bare-float f-string interpolations in the ported scope
 * (every f-string here interpolates only strings/labels), so `pyFloatRepr`
 * is not needed and is not imported.
 */

import { pyFixed } from '../../data/packages/builtin/mathUtils'
import {
  type ExplainMessage,
  type ExplanationContext,
  type ExplanationPrompt,
  type FeatureLabel,
  FORMAT_REMINDER,
  REASON_CLOSING,
  featureIdStr,
  labelFor,
  MIN_ABS_CONTRIBUTION,
  numericOrBool,
  valueDisplay,
} from './builder'

// ---------------------------------------------------------------------------
// Shapes — as loose as Python's `dict[str, Any]` access throughout the
// reference module (no Pydantic model backs `feature_contributions`/
// `criteria`/a row — see task-2-report.md's model survey).
// ---------------------------------------------------------------------------

/** One row of a chain's `rows` — as recorded by either trigger package's
 * `_row` helper (`feature_id`, `value`, `band`, `weight`, `contribution`). */
export interface TriggerRow {
  feature_id?: unknown
  value?: unknown
  band?: unknown
  weight?: unknown
  contribution?: unknown
  [key: string]: unknown
}

/** A `FirePoint`/`MergedFirePoint`, read back out of a quickview/live tick —
 * `category`, `strength`, `tick`, `time_min`, `feature_contributions` (a
 * dict of BOTH categories' chains), `criteria`. */
export interface TriggerFire {
  category?: unknown
  strength?: unknown
  tick?: unknown
  time_min?: unknown
  feature_contributions?: unknown
  criteria?: unknown
  [key: string]: unknown
}

/** `build_target`'s flattened output — the shape `template()` consumes. */
export interface TriggerTarget {
  category: string | null
  score: unknown
  clamped: unknown
  rows: unknown[]
  gates: unknown[]
  criteria: Record<string, unknown>
  tick: unknown
  time_min: unknown
  strength: unknown
}

// ---------------------------------------------------------------------------
// Vocabulary tables — verbatim from trigger_explanation.py.
// ---------------------------------------------------------------------------

/** Bilingual short-noun label for a trigger category (deliberately NOT the
 * long descriptive sentences in reviewVocabulary.ts — see the Python
 * module's own comment on why). */
export const CATEGORY_LABELS: Record<string, FeatureLabel> = {
  rest_required: { ja: '休憩', en: 'rest' },
  monotony_prevention: { ja: '単調運転防止', en: 'monotony prevention' },
}

/** The threshold key(s) to cite for a category, IN PRIORITY ORDER — NRI's
 * raw-scale key tried first, falling back to the hybrid's own 0-1-scale key.
 * See the Python module's module-level comment for the full per-package
 * scale rationale. */
const CATEGORY_THRESHOLD_KEYS: Record<string, readonly string[]> = {
  rest_required: ['threshold_fire', 'threshold_suggest'],
  monotony_prevention: ['threshold_monotony', 'monotony_suggest_threshold'],
}

// A row's |contribution| below this reads as "contributed nothing" — same
// epsilon `explanation_builder` uses (`MIN_ABS_CONTRIBUTION`, imported
// above), referenced DIRECTLY at every use site below (never aliased into
// a local top-level `const ZeroContribution = MIN_ABS_CONTRIBUTION`, Task
// 2's original shape).
//
// This is deliberate, not a style choice: C3 Task 4 made `./builder` import
// THIS module (for the façade's step dispatch), so `./builder` and
// `./trigger` now form a circular ES-module dependency. A top-level
// `const X = MIN_ABS_CONTRIBUTION` computed at THIS module's own top level
// can observe `MIN_ABS_CONTRIBUTION` as `undefined`, depending on which
// side of the cycle the bundler happens to evaluate first — confirmed
// empirically: it silently produced `undefined` (not a thrown TDZ error),
// which made every `>= X` / `< X` comparison below false regardless of the
// real contribution, silently dropping BOTH the "WHAT DROVE IT" and
// "NOTABLY ABSENT" sections of `buildPrompt`'s prompt (see
// task-4-report.md's circular-import hazard). Reading `MIN_ABS_CONTRIBUTION`
// directly INSIDE a function body is safe — every use site below is inside
// `deadBandReasonApplies`/`template`/`buildPrompt`, called only after the
// whole module graph has finished loading — mirroring Python's own fix for
// the identical problem: `explanation_builder.py` defers its
// `from aica_api.services import trigger_explanation, ...` to INSIDE
// `build_explanation_prompt`'s function body specifically to avoid this.

// ---------------------------------------------------------------------------
// resolve_category / build_target
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** `resolve_category`'s inner `_chain_score` — the ONE site in this whole
 * module whose Python guard (`isinstance(score, (int, float))`, line 117)
 * does NOT exclude bool, so a bool `score` IS accepted here (via
 * `numericOrBool`, imported from `./builder`) unlike every other numeric
 * guard in this file (hazard 8 — see the module doc comment). `or
 * float("-inf")` would treat a genuine `0.0` score as falsy and wrongly
 * lose a tie-break; `numericOrBool` returning `null` only for genuinely
 * non-numeric values (never for `0`) avoids that trap the same way
 * Python's explicit `score is not None`-shaped guard does. */
function chainScore(chains: Record<string, unknown>, cat: string): number {
  const chain = asRecord(chains[cat])
  const n = numericOrBool(chain.score)
  return n !== null ? n : -Infinity
}

/**
 * Which of a fire's `feature_contributions` chains is the review target.
 *
 * Priority: the explicit `category` argument (a reviewer's own choice)
 * wins; else the fire's OWN recorded `category`; else — both absent — the
 * highest-scoring recorded chain (first-encountered on a tie, mirroring
 * Python's `max(chains, key=...)`, which iterates `chains`' own key/
 * insertion order and only replaces the incumbent on a STRICTLY greater
 * score). `null` only when the fire carries no chains at all.
 */
export function resolveCategory(fire: TriggerFire, category: string | null | undefined): string | null {
  if (typeof category === 'string' && category) return category
  const fireCategory = fire.category
  if (typeof fireCategory === 'string' && fireCategory) return fireCategory

  const chains = asRecord(fire.feature_contributions)
  const keys = Object.keys(chains)
  if (keys.length === 0) return null

  let best = keys[0]
  let bestScore = chainScore(chains, best)
  for (const k of keys.slice(1)) {
    const s = chainScore(chains, k)
    if (s > bestScore) {
      best = k
      bestScore = s
    }
  }
  return best
}

/**
 * Flatten a fire + resolved category into the `target` shape `template()`
 * below consumes: the recorded chain's own score/clamped/rows/gates, the
 * criteria dict, the category id, and a few fire-level facts (tick/
 * time_min/strength).
 *
 * Degrades to an EMPTY chain (never throws) when `category` is `null` or
 * missing from `fire.feature_contributions` — this function only ever
 * produces an honestly-empty target, never an error (a caller needing a
 * hard error for an unknown category checks that itself first, mirroring
 * `routers/merged_runs.py::explain_trigger_endpoint`, which is out of this
 * port's scope).
 */
export function buildTarget(fire: TriggerFire, category: string | null | undefined): TriggerTarget {
  const chains = asRecord(fire.feature_contributions)
  const chain = category ? asRecord(chains[category]) : {}
  const rowsRaw = chain.rows
  const gatesRaw = chain.gates
  return {
    category: typeof category === 'string' ? category : null,
    score: chain.score ?? null,
    clamped: chain.clamped ?? null,
    rows: Array.isArray(rowsRaw) ? rowsRaw : [],
    gates: Array.isArray(gatesRaw) ? gatesRaw : [],
    criteria: asRecord(fire.criteria),
    tick: fire.tick ?? null,
    time_min: fire.time_min ?? null,
    strength: fire.strength ?? null,
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Mirrors `_num`: unlike `numericOrBool` (./builder), this EXCLUDES bool —
 * Python's own guard here is `isinstance(v, (int, float)) and not
 * isinstance(v, bool)`. `typeof v === 'number'` already rejects booleans in
 * TS, so this is a direct, no-coercion-needed mirror (hazard 8 site,
 * EXCLUDE side — see the module doc comment's site-by-site accounting). */
export function num(v: unknown): number {
  return typeof v === 'number' ? v : 0.0
}

/** The threshold this category's score is banded against, or `null` when
 * the criteria dict carries none of the candidate keys. Bool-excluding,
 * same as `_num` (Python: `isinstance(v, (int, float)) and not
 * isinstance(v, bool)`). */
export function thresholdFor(category: string | null | undefined, criteria: Record<string, unknown>): number | null {
  const keys = CATEGORY_THRESHOLD_KEYS[category || ''] ?? []
  for (const key of keys) {
    const v = criteria[key]
    if (typeof v === 'number') return v
  }
  return null
}

function isPlainDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Rows sorted by |contribution| descending; drops anything malformed (not
 * a plain object) rather than throwing. `Array.prototype.sort`'s ES2019+
 * stability guarantee matches Python's `sorted(..., reverse=True)`, which
 * is ALSO stable — both preserve original row order among equal
 * |contribution|s. */
export function rankedRows(rows: unknown): TriggerRow[] {
  const arr = Array.isArray(rows) ? rows : []
  const safe = arr.filter(isPlainDict) as TriggerRow[]
  return [...safe].sort((a, b) => Math.abs(num(b.contribution)) - Math.abs(num(a.contribution)))
}

/** Plain numeric text, adaptive to the two packages' very different scales
 * (NRI's raw ~0-150 range vs. the hybrid's clamped 0-1 fraction) — see the
 * Python docstring for the full rationale. `pyFixed` (not `toFixed`) at
 * BOTH format-spec sites: Python's `:.Nf` rounds half-to-even,
 * `toFixed` rounds ties away from zero (hazard 7). */
export function fmtNum(v: number): string {
  return Math.abs(v) > 1.5 ? pyFixed(v, 0) : pyFixed(v, 2)
}

/** Bilingual display for a score/threshold: NRI's raw scale reads as
 * "points"; the hybrid's 0-1 scale reads as a plain fraction. */
export function scoreDisplay(v: number): [string, string] {
  const n = fmtNum(v)
  if (Math.abs(v) > 1.5) return [`${n}点`, `${n} pts`]
  return [n, n]
}

/** `scoreDisplay` with an explicit +/- sign, for the clearance clause. */
export function signedScoreDisplay(v: number): [string, string] {
  const [ja, en] = scoreDisplay(Math.abs(v))
  const sign = v >= 0 ? '+' : '-'
  return [`${sign}${ja}`, `${sign}${en}`]
}

/** feature_id -> row-value unit — see the Python module's `_UNIT_KIND`
 * comment for the full per-feature_id rationale (why each one is a
 * duration/level/boolean/multiplier, and why `monotony` is deliberately
 * left out, resolved separately by `unitKindFor` below). */
const UNIT_KIND: Record<string, string> = {
  continuous_driving_min: 'minutes',
  traffic_jam: 'minutes',
  long_highway: 'minutes',
  drowsiness: 'level',
  fatigue: 'level',
  child_passenger: 'boolean',
  night_amplification: 'multiplier',
  familiar_route_amplification: 'multiplier',
}

/** `monotony` disambiguation floor — hybrid's clamped feature can never
 * exceed `1.0`; a value strictly above it can only be NRI's raw-minutes
 * accumulator. At or below it the two are genuinely indistinguishable from
 * the row alone, so it renders bare rather than guessing (see
 * `_MONOTONY_MINUTES_FLOOR`'s Python comment). */
const MONOTONY_MINUTES_FLOOR = 1.0

/** The unit `rowValueDisplay` should use for this row, or `null` for
 * "render bare". Bool-excluding on the `monotony` branch (Python:
 * `isinstance(value, (int, float)) and not isinstance(value, bool)`) —
 * moot in practice (a bool value is 0/1, never `> 1.0`), but mirrored
 * exactly rather than assumed, per this module's hazard-8 discipline. */
export function unitKindFor(featureId: string, value: unknown): string | null {
  const kind = UNIT_KIND[featureId]
  if (kind !== undefined) return kind
  if (featureId === 'monotony' && typeof value === 'number' && Math.abs(value) > MONOTONY_MINUTES_FLOOR) {
    return 'minutes'
  }
  return null
}

/** `×1.2`-style display for an amplification row's `value`. Trims the
 * trailing zero `pyFixed(v, 2)` would otherwise always add (`1.20` ->
 * `1.2`) but keeps at least one decimal place (`1.00` -> `1.0`, not the
 * bare integer `1`). */
export function fmtMultiplier(v: number): string {
  let s = pyFixed(v, 2)
  s = s.replace(/0+$/, '')
  s = s.replace(/\.+$/, '')
  if (!s.includes('.')) s += '.0'
  return `×${s}`
}

/** Bilingual raw-value display for one row, in THAT ROW'S OWN unit. A
 * RECORDED `band` word always wins. Otherwise the unit is looked up by
 * `feature_id`; a `feature_id` NOT in the table (or genuinely ambiguous,
 * like `monotony` below its disambiguation floor) renders as a bare
 * number — never with a guessed unit. */
export function rowValueDisplay(row: TriggerRow): [string, string] {
  const band = row.band
  if (typeof band === 'string' && band) return [band, band]

  const featureId = featureIdStr(row)
  const value = row.value
  const kind = unitKindFor(featureId, value)

  if (kind === 'boolean') {
    const isTrue = typeof value === 'boolean' ? value : typeof value === 'number' && value !== 0.0
    return [isTrue ? 'あり' : 'なし', isTrue ? 'aboard' : 'not aboard']
  }

  if (typeof value === 'boolean') {
    // A row not in the boolean unit table but whose recorded `value` IS a
    // genuine bool (defensive only — no current package's rows do this)
    // still reads as yes/no, never as the numeric 1.00/0.00 a bare
    // `Number(value)` would print.
    return [value ? 'あり' : 'なし', value ? 'yes' : 'no']
  }

  if (typeof value !== 'number') {
    return ['—', '—']
  }

  const v = value
  if (kind === 'minutes') {
    return [`${pyFixed(v, 0)}分`, `${pyFixed(v, 0)} min`]
  }
  if (kind === 'multiplier') {
    const disp = fmtMultiplier(v)
    return [disp, disp]
  }
  // kind in {"level", null}: a 0-100/0-1 score or an unrecognized
  // feature_id — EITHER WAY, no unit suffix.
  const n = fmtNum(v)
  return [n, n]
}

/** Bilingual "<label>（<value>）" phrase for one row, value/band leading. */
export function rowPhrase(row: TriggerRow): [string, string] {
  const lab = labelFor(featureIdStr(row))
  const [dispJa, dispEn] = rowValueDisplay(row)
  return [`${lab.ja}（${dispJa}）`, `${lab.en} (${dispEn})`]
}

/** Feature ids whose NRI row formula subtracts a θ dead-band before
 * weighting (`max(0, value - theta) * weight`). Hybrid's rows of the SAME
 * feature_ids use a plain linear `weight * value` term instead — no
 * dead-band concept at all. */
const DEAD_BAND_FEATURE_IDS = new Set(['drowsiness', 'fatigue'])

/**
 * True when a drowsiness/fatigue row's OWN recorded value/weight/
 * contribution triple can ONLY be explained by a θ dead-band, never by a
 * plain linear `weight * value` term: a linear term with a strictly
 * positive weight and a strictly positive value can never land at EXACTLY
 * zero — only NRI's `max(0, value - theta) * weight` subtraction can
 * produce that combination. Uses this module's own `num` (bool-excluding),
 * not `numericOrBool` — a bool `weight`/`value`/`contribution` here mirrors
 * Python's own exclusion at this site.
 */
export function deadBandReasonApplies(row: TriggerRow): boolean {
  if (!DEAD_BAND_FEATURE_IDS.has(featureIdStr(row))) return false
  const value = num(row.value)
  const weight = num(row.weight)
  const contribution = num(row.contribution)
  return value > 0.0 && weight > 0.0 && Math.abs(contribution) < MIN_ABS_CONTRIBUTION
}

// ---------------------------------------------------------------------------
// template()
// ---------------------------------------------------------------------------

/** Mirrors Python's `str.capitalize()`: uppercase the first character,
 * lowercase the rest (not merely "uppercase the first character" — every
 * label this is applied to happens to already be all-lowercase, so the two
 * behave identically on today's vocabulary, but this mirrors the actual
 * semantics rather than relying on that coincidence). */
function pyCapitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * Deterministic `[ja, en]` rationale for a trigger fire, built ONLY from
 * RECORDED evidence (`target`'s chain score/rows + criteria — see
 * `buildTarget`) — never re-derives or re-scores anything. Names which
 * category fired, the score and the threshold it crossed (plus clearance),
 * the two strongest contributing rows, and the strongest row that
 * contributed ~nothing (when one exists).
 *
 * Degrades gracefully (never throws) on missing/null fields: an empty rows
 * list, a missing criteria dict, `target.category` being `null`, or an
 * unrecognized category string (not in `CATEGORY_LABELS`) each fall through
 * to an honest, shorter sentence instead.
 */
export function template(target: TriggerTarget): [string, string] {
  const categoryRaw = target.category
  const category = typeof categoryRaw === 'string' && categoryRaw ? categoryRaw : ''
  const cat = CATEGORY_LABELS[category] ?? null
  if (cat === null) {
    return ['この記録には発火した分類がありません。', 'No fired category is recorded for this evidence.']
  }

  const score = target.score
  const criteria = asRecord(target.criteria)
  const threshold = thresholdFor(category, criteria)
  const hasScore = typeof score === 'number'
  const hasThreshold = typeof threshold === 'number'

  let ja: string
  let en: string

  if (hasThreshold) {
    const [thresholdJa, thresholdEn] = scoreDisplay(threshold)
    ja = `${cat.ja}しきい値（${thresholdJa}）を超えて発火`
    en = `Fired above the ${cat.en} threshold (${thresholdEn})`
    if (hasScore) {
      const [scoreJa, scoreEn] = scoreDisplay(score)
      ja += `（スコア${scoreJa}`
      en += ` (score ${scoreEn}`
      const clearance = score - threshold
      const [clearanceJa, clearanceEn] = signedScoreDisplay(clearance)
      ja += `・余裕${clearanceJa}）`
      en += `, clearance ${clearanceEn})`
    }
    ja += '。'
    en += '.'
  } else {
    // No recorded threshold — still name what fired, just without the
    // numeric clearance clause the review can't back with evidence.
    ja = `${cat.ja}が発火。`
    en = `${pyCapitalize(cat.en)} fired.`
  }

  const rows = rankedRows(target.rows)
  const contributing = rows.filter((r) => Math.abs(num(r.contribution)) >= MIN_ABS_CONTRIBUTION)
  const top2 = contributing.slice(0, 2)
  if (top2.length > 0) {
    const phrases = top2.map((r) => rowPhrase(r))
    ja += '主因は' + phrases.map((p) => p[0]).join('と') + '。'
    en += ' Chiefly ' + phrases.map((p) => p[1]).join(' and ') + '.'
  }

  // The strongest row that carries a real recorded value but contributed
  // ~nothing — its ABSENCE is often the most reviewable fact.
  const zeroRows = rows.filter(
    (r) => Math.abs(num(r.contribution)) < MIN_ABS_CONTRIBUTION && r.value !== null && r.value !== undefined,
  )
  const sortedZero = [...zeroRows].sort((a, b) => Math.abs(num(b.value)) - Math.abs(num(a.value)))
  if (sortedZero.length > 0) {
    const topZero = sortedZero[0]
    const lab = labelFor(featureIdStr(topZero))
    if (deadBandReasonApplies(topZero)) {
      ja += `${lab.ja}は不感帯（しきい値以下）のため寄与なし。`
      en += ` ${pyCapitalize(lab.en)} stayed at or below its own dead-band, so it contributed nothing.`
    } else {
      ja += `${lab.ja}は寄与なし。`
      en += ` ${pyCapitalize(lab.en)} contributed nothing.`
    }
  }

  return [ja, en]
}

// ---------------------------------------------------------------------------
// build_prompt (C3 task 4 — deferred out of Task 2's scope; see this file's
// own header comment)
// ---------------------------------------------------------------------------

/** Trigger-step reasoning-mode system prompt PREFIX. Verbatim from Python
 * (`_TRIGGER_REASON_SYSTEM`, `trigger_explanation.py`) minus its trailing
 * `+ _k._REASON_CLOSING` — this module's OWN text (unlike
 * `SERVICE_REASON_SYSTEM`/`CONTENT_REASON_SYSTEM`, which live fully
 * pre-concatenated in `./builder` because Python defines THEM in
 * `explanation_builder.py` itself).
 *
 * Deliberately kept as a PREFIX-only constant, concatenated with the shared
 * kernel's `REASON_CLOSING` INSIDE `buildPrompt`'s body below (not eagerly
 * at this module's own top level) — for the same circular-import reason
 * `MIN_ABS_CONTRIBUTION` above is read directly at each use site instead of
 * through a top-level alias: `./builder` now imports THIS module, so a
 * top-level `const X = "..." + REASON_CLOSING` computed here can capture
 * `REASON_CLOSING` as `undefined` (confirmed empirically — JS string
 * concatenation with `undefined` silently produces the literal text
 * `"...undefined"` appended, not a thrown error) depending on which side of
 * the cycle evaluates first. See task-4-report.md's circular-import hazard
 * for the full writeup. */
const TRIGGER_REASON_SYSTEM_PREFIX =
  "You explain WHY an in-car assistant's trigger algorithm fired a proposal for the driver — in BOTH Japanese and English. You are given the raw scoring facts; work out the causal story yourself. Do not just restate numbers.\n\nWHAT THE ALGORITHM DOES\nThe trigger continuously scores the driving situation (drowsiness, fatigue, monotony, driving time, traffic, night, and similar signals) into ONE category score. It FIRES the moment that score crosses the threshold set for that category — a REST proposal (the driver should stop and recover) or a MONOTONY-PREVENTION proposal (something to keep an under-stimulated driver engaged). A fire belongs to exactly one category; never argue a different category should have fired instead — only explain the one given.\n\nHOW A FACTOR SCORES\nEach contributing signal adds (its weight × how much of that signal is present) to the total score. A signal can be PRESENT yet contribute EXACTLY ZERO — e.g. it has not yet crossed its own sensitivity floor, or the condition it represents (a passenger, a special route) simply is not true right now. That is a real, reviewable fact, not an omission.\n\nYOUR TASK\nReason the causal story: (1) how far the score cleared the threshold (the clearance); (2) which one or two signals actually drove it there; (3) any notable signal that, despite being present, contributed nothing.\n\n"

/**
 * Trigger branch — fact-rich reasoning-mode prompt (mirrors
 * `service.ts`'s/`content.ts`'s `buildPrompt` shape and grounding
 * discipline: natural-language FACTS only in the user message, never a raw
 * fraction or a pre-baked verdict).
 *
 * `context` is accepted for interface parity with the other two branches
 * (`buildExplanationPrompt`, added to `./builder` alongside this function,
 * dispatches all three identically) but unused — everything this prompt
 * needs already lives in `target` (see `buildTarget`); a trigger fire
 * carries no run-level `trigger_purpose`/`lifecycle_stage` of its own the
 * way a service/content candidate does.
 *
 * Hazard 8 (divergence within THIS SAME MODULE, not just across modules):
 * both numeric checks below (`isinstance(score, (int, float))` at Python
 * lines 536 and 569) carry NO `and not isinstance(score, bool)` exclusion —
 * UNLIKE `template()`'s `has_score` (line 429), which DOES exclude bool, on
 * the exact same `target.score` field. A bool score is therefore ACCEPTED
 * here (via `numericOrBool`) and REJECTED there (via `typeof === 'number'`)
 * — audited independently against each Python line, not assumed uniform;
 * see task-4-report.md's hazard-8 table. `threshold` itself can never be a
 * bool (`thresholdFor`'s own guard already excludes it), so only `score`
 * needs the accept-bool treatment here.
 */
export function buildPrompt(target: TriggerTarget, _context: ExplanationContext): ExplanationPrompt {
  const category = target.category
  const cat = category !== null ? CATEGORY_LABELS[category] : undefined
  const catLabel: FeatureLabel = cat ?? { ja: category || '不明', en: category || 'unknown' }

  const scoreN = numericOrBool(target.score)
  const criteria = asRecord(target.criteria)
  const threshold = thresholdFor(category, criteria)
  const rows = rankedRows(target.rows)
  const clearance = scoreN !== null && threshold !== null ? scoreN - threshold : null

  const contributing = rows.filter((r) => Math.abs(num(r.contribution)) >= MIN_ABS_CONTRIBUTION)
  const zeroRows = rows.filter(
    (r) => Math.abs(num(r.contribution)) < MIN_ABS_CONTRIBUTION && r.value !== null && r.value !== undefined,
  )
  const sortedZero = [...zeroRows].sort((a, b) => Math.abs(num(b.value)) - Math.abs(num(a.value)))

  const factLine = (row: TriggerRow): string => {
    const lab = labelFor(featureIdStr(row))
    const band = row.band
    const disp = typeof band === 'string' && band ? band : valueDisplay(row.value)
    return disp ? `- ${lab.en}: ${disp}` : `- ${lab.en}`
  }

  const topFacts = contributing.slice(0, 6).map(factLine)
  const absentFact = sortedZero.length > 0 ? factLine(sortedZero[0]) : null

  const grounding: Record<string, unknown> = {
    step: 'trigger',
    category: category ?? null,
    score: target.score ?? null,
    threshold,
    clearance,
    rows,
    criteria,
  }

  const L: string[] = []
  L.push(`The assistant's trigger algorithm just fired a "${catLabel.en}" proposal for the driver.`)
  L.push('')
  if (threshold !== null && scoreN !== null) {
    const span = Math.abs(threshold) > 1e-9 ? Math.abs(threshold) : 1.0
    const margin = clearance !== null && Math.abs(clearance) / span < 0.05 ? 'just barely' : 'clearly'
    L.push(`THE FIRING: the score ${margin} cleared the ${catLabel.en} threshold for this category.`)
  } else {
    L.push(`THE FIRING: a ${catLabel.en} proposal fired; the recorded threshold is unavailable.`)
  }

  if (topFacts.length > 0) {
    L.push('')
    L.push('WHAT DROVE IT (strongest signals first):')
    L.push(...topFacts)
  }

  if (absentFact) {
    L.push('')
    L.push('NOTABLY ABSENT (present, but contributed nothing):')
    L.push(absentFact)
  }

  L.push('')
  L.push(FORMAT_REMINDER)

  const messages: ExplainMessage[] = [
    { role: 'system', content: TRIGGER_REASON_SYSTEM_PREFIX + REASON_CLOSING },
    { role: 'user', content: L.join('\n') },
  ]
  return { messages, grounding }
}
