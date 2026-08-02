/**
 * service_explanation — port of `services/service_explanation.py` (186 LOC):
 * `_service_label`, `build_prompt`, `_passthrough`, `template`. Uses the
 * shared kernel `./builder` for labels, factor extraction, and the shared
 * fact-translator sentences — mirroring how the Python module imports it
 * as `_k`.
 *
 * Ported together with `content.ts` (C3 task 3) — both step modules share
 * the same `build_prompt` / `template` shape and both consume Task 1's
 * builder. Unlike `trigger.ts` (C3 task 2), `build_prompt` IS in scope here
 * (the task brief's own framing: "both are step modules with the same
 * `build_prompt` / `template` shape").
 *
 * This module has ZERO `isinstance(x, (int, float))` numeric guards (the
 * Python file's only `isinstance` calls check `dict`/`list`, never a number
 * — see task-3-report.md's hazard-8 accounting) and ZERO `:.Nf` format-spec
 * sites, so neither `pyFixed` nor `pyFloatRepr` is imported here (checked,
 * not assumed — see the report).
 */

import {
  type ExplainMessage,
  type ExplanationContext,
  type ExplanationPrompt,
  type ExplanationTarget,
  type FeatureLabel,
  FORMAT_REMINDER,
  SERVICE_REASON_SYSTEM,
  categoryReadout,
  factorsFromTarget,
  historySentences,
  labelFor,
  scoreEvidence,
  situationSentence,
  triggerSentence,
} from './builder'

// ---------------------------------------------------------------------------
// str() mirror — Python's `str(None) == "None"`, not JS's `String(null) ==
// "null"` and not `String(undefined) == "undefined"`. Needed at this
// module's ONE bare `str(target.get("candidate_id"))` call site (no `or ""`
// guard there, unlike content.ts's `item_id` site — see build_prompt below).
// Small per-module copy, following this codebase's established convention
// for trivial Python-mirroring helpers (see `py_repr.ts`'s own doc comment
// on that convention, and `builder.ts`'s `featureIdStr` for the same
// str(None) mirror at an analogous site).
// ---------------------------------------------------------------------------

function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

// ---------------------------------------------------------------------------
// Vocabulary tables — verbatim from service_explanation.py.
// ---------------------------------------------------------------------------

/** Plain-English "what this service is" — one line each, driver-facing.
 * Unlisted ids fall back to the raw candidate id (see `buildPrompt`'s own
 * `desc` fallback — deliberately the RAW id, not the neutral label
 * `serviceLabel` uses; these are two different fallback policies at two
 * different call sites, mirrored exactly, not unified). */
const SERVICE_DESC: Record<string, string> = {
  music_playlist: 'a background music playlist',
  humming_karaoke: 'an interactive sing-along that keeps the driver engaged',
  call_response_driving: 'a hands-free call-and-response game',
  call_response_stopped: 'a call-and-response game for when the car is stopped',
  quiz: 'a driving quiz game',
  ranking_creation: 'a music ranking/creation activity',
  radio_style: 'a radio-style stream',
  conversation_audio: 'an audio conversation/chat companion',
  live_viewing: 'a live concert/performance viewing experience',
  stretch_video: 'a guided stretch/rest video',
  full_karaoke: 'a full karaoke session',
  oshi_reexperience: 'a favorite-artist re-experience',
  relaxation_multisensory: 'a multisensory relaxation experience',
  linked_video_recommendation: 'a linked video recommendation',
}

/** Bilingual display names for the V1 service catalog (all 14 `ServiceId`
 * members — see `app/api/aica_api/models/proposal/enums.py`'s `ServiceId`).
 * Used so `template()`'s deterministic fallback never splices the raw
 * snake_case candidate id into the displayed rationale (rule 2: no
 * identifier ever reaches the screen) — see `serviceLabel`. */
export const SERVICE_LABELS: Record<string, FeatureLabel> = {
  music_playlist: { ja: 'プレイリスト再生', en: 'playlist playback' },
  humming_karaoke: { ja: '鼻歌カラオケ', en: 'humming karaoke' },
  full_karaoke: { ja: 'カラオケ（フル）', en: 'karaoke (full)' },
  call_response_driving: { ja: '合いの手練習（走行中）', en: 'call-and-response practice (driving)' },
  call_response_stopped: { ja: '合いの手練習（停車中）', en: 'call-and-response practice (stopped)' },
  conversation_audio: { ja: 'おしゃべり', en: 'chat' },
  linked_video_recommendation: { ja: '動画レコメンド', en: 'video recommendation' },
  live_viewing: { ja: 'ライブビューイング', en: 'live viewing' },
  oshi_reexperience: { ja: '推し追体験', en: 'favourite-artist re-experience' },
  quiz: { ja: 'クイズ', en: 'quiz' },
  radio_style: { ja: 'ラジオ風再生', en: 'radio-style playback' },
  ranking_creation: { ja: 'ランキング作成', en: 'ranking creation' },
  relaxation_multisensory: { ja: 'リラックス（多感覚連携）', en: 'relaxation (multisensory)' },
  stretch_video: { ja: 'ストレッチ動画', en: 'stretch video' },
}

/** Bilingual display name for a service candidate id, falling back to a
 * neutral "unnamed service" phrase rather than the raw id (rule 2). This
 * fallback DIFFERS from `buildPrompt`'s `desc` lookup (which falls back to
 * the raw id itself) — two distinct fallback policies at two distinct call
 * sites in the Python source, mirrored as-is. */
export function serviceLabel(candidateId: string): FeatureLabel {
  return SERVICE_LABELS[candidateId] ?? { ja: '名称未登録のサービス', en: 'an unnamed service' }
}

// ---------------------------------------------------------------------------
// build_prompt
// ---------------------------------------------------------------------------

/**
 * Service branch — fact-rich reasoning-mode prompt. Hands the model
 * natural-language FACTS (what the service is, the trigger + car state, the
 * situation, history with this service) plus the service response matrix in
 * the system prompt, and lets it reason the causal story itself — no
 * pre-baked verdict, no raw numbers in the user text (grounding still keeps
 * the numeric factors/readout for auditability).
 */
export function buildPrompt(target: ExplanationTarget, context: ExplanationContext): ExplanationPrompt {
  const kindEn = 'service'
  // `str(target.get("candidate_id"))` — NO `or ""` guard (unlike content.ts's
  // item_id site below): a missing/null candidate_id stringifies to the
  // literal "None", mirroring Python's str(None) exactly (hazard-5-adjacent,
  // hand-constructed-only — real RankedCandidate.candidate_id is a
  // non-empty ServiceId string by Pydantic construction).
  const targetId = pyStr(target.candidate_id)
  // `?? null`, not a bare pass-through — a `RankedCandidate` dict-access
  // hazard, NOT a numeric one: a missing key reads as JS `undefined`, and an
  // object literal field explicitly set to `undefined` still shows up in
  // `Object.keys()` (unlike a truly absent key), so `expectParity`'s
  // structural key-comparison would see the key present but with the wrong
  // sentinel (`undefined` vs. Python's serialized `null`) and fail the VALUE
  // compare instead of cleanly reporting a missing field — see this file's
  // own `builder.ts` header comment on the same convention.
  const rank = target.rank ?? null
  const fit = target.score ?? null

  const factors = factorsFromTarget(target)
  // RankedCandidate carries supporting_/opposing_feature_ids lists; content's
  // OrderedItem instead carries single strongest_support/oppose dicts
  // ({feature_id, contribution}). Fall back to those so BOTH shapes
  // contribute equivalent "factors in favor/against" grounding.
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

  const songFacts: string[] = []
  const readout = categoryReadout(target)

  const grounding: Record<string, unknown> = {
    step: 'service',
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
    category_readout: readout,
  }

  // ── User message: natural-language facts, no scores-only, no verdict ────
  const triggerPurpose = context.trigger_purpose
  const lifecycleStage = context.lifecycle_stage
  const desc = typeof targetId === 'string' && SERVICE_DESC[targetId] !== undefined ? SERVICE_DESC[targetId] : targetId

  const L: string[] = []
  L.push(`The assistant is considering offering the service "${targetId}" to the driver.`)
  L.push('')
  L.push('THE SERVICE: ' + desc + '.')

  L.push('')
  L.push(
    'THE TRIGGER & CAR STATE: ' +
      triggerSentence(
        typeof triggerPurpose === 'string' ? triggerPurpose : null,
        target,
        typeof lifecycleStage === 'string' ? lifecycleStage : null,
      ),
  )

  const situation = situationSentence(target, typeof triggerPurpose === 'string' ? triggerPurpose : null, true)
  if (situation) {
    L.push('')
    L.push('THE SITUATION RIGHT NOW: ' + situation)
  }

  const history = historySentences(target)
  if (history.length > 0) {
    L.push('')
    L.push("THE DRIVER'S HISTORY WITH THIS SERVICE: " + history.join('; ') + '.')
  }

  const evidence = scoreEvidence(factors)
  if (evidence.length > 0) {
    L.push('')
    L.push('WHY THE ALGORITHM RANKED IT TOP (strongest reasons first):')
    L.push(...evidence)
  }

  L.push('')
  L.push(FORMAT_REMINDER)

  const messages: ExplainMessage[] = [
    { role: 'system', content: SERVICE_REASON_SYSTEM },
    { role: 'user', content: L.join('\n') },
  ]
  return { messages, grounding }
}

// ---------------------------------------------------------------------------
// template()
// ---------------------------------------------------------------------------

/** Former behavior: already-positional [ja, en] pair, pad/truncate to 2.
 * REAL-reachable (not merely synthetic): `mock_service_selector_v1` never
 * sets `situation_fit`/`preference_fit`/`history_fit` on its
 * `RankedCandidate`s (see `app/api/aica_api/models/proposal/service_output.py`'s
 * own docstring), so `categoryReadout` returns `null` for any mock-package
 * output and `template()` below falls through to this passthrough on every
 * real mock-package run — verified directly against a real
 * `mock_service_selector_v1.evaluate()` call (see the capture rig). */
function passthrough(target: ExplanationTarget): [string, string] {
  const rationale = target.rationale
  if (!Array.isArray(rationale) || rationale.length === 0) return ['', '']
  const ja = rationale.length >= 1 ? pyStr(rationale[0]) : ''
  const en = rationale.length >= 2 ? pyStr(rationale[1]) : ja
  return [ja, en]
}

/** This category-phrase table is service_explanation.py's OWN local dict
 * (line 174-176) — it is NOT `builder.ts`'s `CATEGORY_PHRASES`, despite two
 * of the three entries reading identically. The `history` entry genuinely
 * DIFFERS: this table's ja is "利用履歴" (no "運転者の" prefix), while
 * `CATEGORY_PHRASES.history.ja` is "運転者の利用履歴" (WITH the prefix) —
 * confirmed by reading both Python sources side by side (service_explanation.py
 * line 174 vs explanation_builder.py's own `_CATEGORY_PHRASES`). Reusing
 * `CATEGORY_PHRASES` here would be a real, silent divergence from Python —
 * a near-duplicate-vocabulary trap, not a refactor opportunity. */
const DOM_JA: Record<'situation' | 'preference' | 'history', string> = {
  situation: '運転状況',
  preference: '運転者の好み',
  history: '利用履歴',
}
const DOM_EN: Record<'situation' | 'preference' | 'history', string> = {
  situation: 'the driving situation',
  preference: "the driver's taste",
  history: "the driver's history",
}

/**
 * Deterministic category-level causal composer, degrading to the former
 * positional [ja, en] passthrough when subtotals or `strongest_support` are
 * absent (service response has no arousal/valence, so its causal story is
 * category-level: dominant family + `strongest_support` label).
 */
export function template(target: ExplanationTarget): [string, string] {
  const readout = categoryReadout(target)
  const ss = target.strongest_support
  const cid = pyStr(target.candidate_id || '')
  const ssIsDict = ss !== null && typeof ss === 'object' && !Array.isArray(ss)
  const ssFeatureId = ssIsDict ? (ss as Record<string, unknown>).feature_id : undefined
  if (!readout || !ssIsDict || !ssFeatureId || !cid) {
    return passthrough(target)
  }
  const dom = readout.dominant
  const domJa = DOM_JA[dom]
  const domEn = DOM_EN[dom]
  const sup = labelFor(pyStr(ssFeatureId))
  const svc = serviceLabel(cid)
  let ja = `主に${domJa}（特に${sup.ja}）により、${svc.ja}が選ばれました。`
  let en = `Mainly ${domEn}, chiefly ${sup.en}, drove selecting ${svc.en}.`
  const so = target.strongest_oppose
  const soIsDict = so !== null && typeof so === 'object' && !Array.isArray(so)
  const soFeatureId = soIsDict ? (so as Record<string, unknown>).feature_id : undefined
  if (soIsDict && soFeatureId) {
    const opp = labelFor(pyStr(soFeatureId))
    ja += ` 一方で${opp.ja}は反対に働きました。`
    en += ` ${pyCapitalize(opp.en)} pushed against it.`
  }
  return [ja, en]
}

/** Mirrors Python's `str.capitalize()`: uppercase the first character,
 * lowercase the rest — see `trigger.ts`'s own `pyCapitalize` for the same
 * mirror at an analogous site (small per-module copy, not shared, following
 * this codebase's established convention for trivial helpers). */
function pyCapitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
