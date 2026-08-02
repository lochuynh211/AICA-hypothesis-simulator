/**
 * explanation_builder — shared vocabulary + sentence machinery, port of the
 * NON-façade half of `services/explanation_builder.py` (905 LOC): `label_for`,
 * `feature_meaning`, `feature_family`, `situation_sentence`, `trigger_sentence`,
 * `preference_sentence`, `history_sentences`, `score_evidence`,
 * `category_readout`, and the internal display/factor helpers the three step
 * modules (`trigger.ts` / `service.ts` / `content.ts`, C3 tasks 2-3) build on
 * — mirroring how those Python modules import this one as `_k`.
 *
 * NOT ported here (façade — C3 task 4, after the step modules exist):
 * `build_explanation_prompt`, `template_rationale`, `parse_bilingual`,
 * `response_is_usable`, `strip_placeholder_artifacts`, `prompt_hash`, and the
 * output-parsing constants (`_EXAMPLE_JA`/`_EXAMPLE_EN`, the Japanese-script
 * and placeholder regexes) that ONLY those functions use.
 *
 * `CONTENT_REASON_SYSTEM` / `SERVICE_REASON_SYSTEM` / `REASON_CLOSING` /
 * `FORMAT_REMINDER` / `CONTENT_LANG_SEP` ARE ported here even though no
 * function in this file constructs an LLM prompt with them — Python defines
 * them in `explanation_builder.py` and the step modules read them off the
 * shared kernel (`_k.FORMAT_REMINDER` etc.), so mirroring Python's own
 * decomposition puts them here too rather than duplicating them into three
 * downstream files.
 *
 * Every function that can return Python `None` returns TypeScript `null`
 * here (never `undefined`) — the conformance tests diff captured Python
 * JSON, where `None` always serializes to `null`; leaving a field
 * `undefined` would make it vanish from `Object.keys()` and fail the
 * structural key-comparison in `expectParity` instead of the value
 * comparison, which would misreport a missing-field bug as something else.
 */

export interface FeatureLabel {
  ja: string
  en: string
}

/** One row of a candidate/item's `feature_contributions` — service
 * `FeatureContribution` (keyed by `feature_value`) or content
 * `ItemFeatureContribution` (keyed by `e_i`), whichever shape the caller has.
 * Deliberately as loose as Python's `dict[str, Any]` row access (`fc.get(...)`
 * everywhere) — every extra field either model carries (weights, provenance,
 * `alpha`/`beta`, ...) passes through untouched via the index signature. */
export interface FeatureContributionRow {
  feature_id?: unknown
  contribution?: unknown
  feature_value?: unknown
  e_i?: unknown
  [key: string]: unknown
}

/** A service `RankedCandidate` or content `OrderedItem`, read back out of
 * persisted evidence — as loose as Python's `dict[str, Any]` target. */
export interface ExplanationTarget {
  feature_contributions?: FeatureContributionRow[]
  situation_fit?: unknown
  preference_fit?: unknown
  history_fit?: unknown
  [key: string]: unknown
}

/** Run-level facts passed alongside a target — `trigger_purpose`,
 * `lifecycle_stage`, and (content step only) `song_name`/`song_artist`/
 * `oshi_artist`. `driver_profile`/`age_band` are read by `preferenceSentence`
 * but NOT populated by the one real call site today (see that function's
 * doc comment) — still ported so a future caller (or a direct call) gets the
 * same branch Python has. */
export interface ExplanationContext {
  trigger_purpose?: unknown
  lifecycle_stage?: unknown
  oshi_artist?: unknown
  driver_profile?: unknown
  age_band?: unknown
  song_name?: unknown
  song_artist?: unknown
  [key: string]: unknown
}

/** One extracted, labelled, ranked contribution — `factorsFromTarget`'s
 * output element, consumed by `scoreEvidence` and the step modules' prompt
 * builders. */
export interface Factor {
  feature_id: string
  label_ja: string
  label_en: string
  contribution: number
  value: unknown
  value_display: string
  meaning: string
}

/** `categoryReadout`'s "what dominated" readout — the signed trio plus the
 * dominant category's bilingual phrase. */
export interface CategoryReadout {
  situation: number
  preference: number
  history: number
  dominant: 'situation' | 'preference' | 'history'
  phrase_ja: string
  phrase_en: string
}

// ---------------------------------------------------------------------------
// Vocabulary tables — generated verbatim from a live run of
// `aica_api.services.explanation_builder` (never hand-transcribed, to keep
// every Japanese string byte-exact) — see task-1-report.md for the capture
// command. Do not hand-edit; regenerate from Python if the reference changes.
// ---------------------------------------------------------------------------

/**
 * Bilingual label for every feature id explanation_builder.py may need to
 * name — merged union of the service selector's full feature_id namespace
 * and the content selector's short-leaf + full-id namespaces (see the
 * Python module's own comment on this table). Unknown ids fall back to
 * the raw id string (see `labelFor`).
 */
export const FEATURE_LABELS: Record<string, FeatureLabel> = {
  "drowsiness_level": {
    "ja": "眠気",
    "en": "drowsiness"
  },
  "fatigue_level": {
    "ja": "疲労度",
    "en": "fatigue"
  },
  "traffic_state": {
    "ja": "渋滞",
    "en": "traffic"
  },
  "road_type": {
    "ja": "道路の種類",
    "en": "road type"
  },
  "night_state": {
    "ja": "夜間",
    "en": "night"
  },
  "monotony_level": {
    "ja": "道路の単調さ",
    "en": "monotony"
  },
  "route_tags": {
    "ja": "ルートの特性",
    "en": "route characteristics"
  },
  "destination_tags": {
    "ja": "目的地の特性",
    "en": "destination characteristics"
  },
  "child_present": {
    "ja": "子供の同乗",
    "en": "child present"
  },
  "multiple_passengers": {
    "ja": "複数人の同乗",
    "en": "multiple passengers"
  },
  "oshi_registered": {
    "ja": "推しの登録",
    "en": "oshi registered"
  },
  "oshi_mode": {
    "ja": "推し優先モード",
    "en": "oshi mode"
  },
  "service_recency_state": {
    "ja": "サービスの未利用期間",
    "en": "service recency"
  },
  "service_usage_level": {
    "ja": "サービスの利用頻度",
    "en": "overall service usage"
  },
  "scene_service_usage_level": {
    "ja": "場面別のサービス利用",
    "en": "scene-specific service usage"
  },
  "service_proposal_acceptance_rate": {
    "ja": "提案受諾率",
    "en": "proposal acceptance rate"
  },
  "service_recovery_rate": {
    "ja": "回復率",
    "en": "recovery rate"
  },
  "drowsiness": {
    "ja": "眠気",
    "en": "drowsiness"
  },
  "fatigue": {
    "ja": "疲労",
    "en": "fatigue"
  },
  "monotony": {
    "ja": "道路の単調さ",
    "en": "monotony"
  },
  "traffic": {
    "ja": "渋滞",
    "en": "traffic"
  },
  "road": {
    "ja": "道路の種類",
    "en": "road type"
  },
  "night": {
    "ja": "夜間",
    "en": "night"
  },
  "motion": {
    "ja": "走行状態",
    "en": "motion"
  },
  "service_ease": {
    "ja": "歌いやすさ",
    "en": "singability"
  },
  "oshi": {
    "ja": "推しとの一致",
    "en": "oshi match"
  },
  "age": {
    "ja": "年代の合致",
    "en": "era fit"
  },
  "item_usage": {
    "ja": "利用頻度",
    "en": "usage"
  },
  "played": {
    "ja": "再生履歴",
    "en": "recent play"
  },
  "skipped": {
    "ja": "スキップ履歴",
    "en": "skip history"
  },
  "changed": {
    "ja": "切替履歴",
    "en": "change history"
  },
  "acceptance": {
    "ja": "受諾率",
    "en": "acceptance rate"
  },
  "recovery": {
    "ja": "回復率",
    "en": "recovery rate"
  },
  "route": {
    "ja": "ルートの合致",
    "en": "route fit"
  },
  "destination": {
    "ja": "目的地の合致",
    "en": "destination fit"
  },
  "child": {
    "ja": "子供向け",
    "en": "child-friendly"
  },
  "hobbies": {
    "ja": "趣味の合致",
    "en": "hobby fit"
  },
  "genre_usage": {
    "ja": "ジャンルの利用",
    "en": "genre usage"
  },
  "scene_genre": {
    "ja": "場面別のジャンル",
    "en": "scene genre"
  },
  "oshi_artists": {
    "ja": "推しとの一致",
    "en": "oshi (favorite-artist) match"
  },
  "oshi_tags": {
    "ja": "推しタグとの一致",
    "en": "oshi-tag match"
  },
  "oshi_type": {
    "ja": "推しの種別",
    "en": "oshi type"
  },
  "song_singability": {
    "ja": "歌いやすさ",
    "en": "sing-along ease"
  },
  "catalog_item_usage_level": {
    "ja": "この曲の利用頻度",
    "en": "how often this song is played"
  },
  "catalog_item_recency_state": {
    "ja": "この曲の未再生期間",
    "en": "time since this song was played"
  },
  "content_tag_usage_level": {
    "ja": "ジャンルの利用頻度",
    "en": "genre/tag play frequency"
  },
  "content_tag_recency_state": {
    "ja": "ジャンルの未再生期間",
    "en": "genre/tag recency"
  },
  "scene_content_tag_usage_level": {
    "ja": "場面別のジャンル利用",
    "en": "scene-specific genre usage"
  },
  "usage_by_genre": {
    "ja": "ジャンル別の利用",
    "en": "usage by genre"
  },
  "scene_genre_usage": {
    "ja": "場面別のジャンル利用",
    "en": "scene genre usage"
  },
  "content_proposal_acceptance_rate": {
    "ja": "曲提案の受諾率",
    "en": "song-proposal acceptance rate"
  },
  "content_recovery_rate": {
    "ja": "曲による回復率",
    "en": "recovery rate from this song"
  },
  "played_items": {
    "ja": "再生履歴",
    "en": "recently played"
  },
  "skipped_items": {
    "ja": "スキップ履歴",
    "en": "recently skipped"
  },
  "changed_from_items": {
    "ja": "切替履歴",
    "en": "recently switched away from"
  },
  "repeated_items": {
    "ja": "繰り返し再生",
    "en": "repeated plays"
  },
  "completed_items": {
    "ja": "最後まで再生",
    "en": "played to completion"
  },
  "cancelled_content_plans": {
    "ja": "取り消し履歴",
    "en": "cancelled plans"
  },
  "manually_selected_items": {
    "ja": "手動選択",
    "en": "manually chosen"
  },
  "motion_state": {
    "ja": "走行状態",
    "en": "car motion"
  },
  "age_band": {
    "ja": "年代",
    "en": "driver age band"
  },
  "gender": {
    "ja": "性別",
    "en": "driver gender"
  },
  "hobby_interest_tags": {
    "ja": "趣味・関心",
    "en": "hobby interests"
  },
  "driving_anomaly": {
    "ja": "運転の乱れ",
    "en": "driving anomaly"
  },
  "driving_time": {
    "ja": "連続運転時間",
    "en": "driving time"
  },
  "env_load": {
    "ja": "走行環境の負荷",
    "en": "environment load"
  },
  "rest_window": {
    "ja": "休憩機会の近さ",
    "en": "rest window"
  },
  "rest_scarcity": {
    "ja": "休憩機会の少なさ",
    "en": "rest scarcity"
  },
  "familiar_route": {
    "ja": "ルートへの慣れ",
    "en": "familiar route"
  },
  "child_passenger": {
    "ja": "子供の同乗",
    "en": "child aboard"
  },
  "traffic_jam": {
    "ja": "渋滞",
    "en": "traffic jam"
  },
  "continuous_driving_min": {
    "ja": "連続運転時間",
    "en": "continuous driving time"
  },
  "night_amplification": {
    "ja": "夜間による増幅",
    "en": "night amplification"
  },
  "familiar_route_amplification": {
    "ja": "慣れたルートによる増幅",
    "en": "familiar-route amplification"
  },
  "long_highway": {
    "ja": "長時間の高速走行",
    "en": "extended highway driving"
  }
} as const

/**
 * Plain-English "what this feature is" — one line each, driver-facing and
 * step-agnostic. Missing -> "" (the label alone is shown). See `featureMeaning`.
 */
export const FEATURE_MEANINGS: Record<string, string> = {
  "drowsiness_level": "how sleepy the driver is (alert → very drowsy)",
  "fatigue_level": "how physically tired the driver is",
  "monotony_level": "how monotonous/boring the road feels",
  "traffic_state": "the current traffic level",
  "road_type": "the kind of road (e.g. highway vs local)",
  "night_state": "whether it is day or night",
  "route_tags": "characteristics of the route (e.g. highway)",
  "destination_tags": "characteristics of the destination",
  "child_present": "whether a child is in the car",
  "multiple_passengers": "whether there are several passengers",
  "motion_state": "whether the car is moving or stopped",
  "oshi_registered": "whether the driver has registered a favorite artist (oshi)",
  "oshi_mode": "whether oshi (favorite-artist) mode is turned on",
  "oshi_artists": "whether this song is by one of the driver's registered oshi (favorite artists)",
  "oshi_tags": "whether the song matches the driver's oshi tags",
  "song_singability": "how easy this song is to sing or hum along to",
  "service_recency_state": "how long since this service was last used",
  "service_usage_level": "how often the driver uses this service overall",
  "scene_service_usage_level": "how often the driver uses this service in this kind of scene",
  "service_proposal_acceptance_rate": "how often the driver accepts this service when offered",
  "service_recovery_rate": "how well this service has restored the driver's state before",
  "catalog_item_usage_level": "how often the driver plays this particular song",
  "catalog_item_recency_state": "how long since the driver last played this song",
  "content_tag_usage_level": "how much the driver plays this song's genre/tags",
  "content_tag_recency_state": "how long since the driver played this genre/tags",
  "content_proposal_acceptance_rate": "how often the driver accepts this song when proposed",
  "content_recovery_rate": "how well this song has restored the driver's state before",
  "played_items": "whether the driver played this song recently",
  "skipped_items": "whether the driver skipped this song recently",
  "changed_from_items": "whether the driver recently switched away from this song",
  "age_band": "the driver's age group",
  "hobby_interest_tags": "the driver's hobby interests"
} as const

/** Bilingual phrase for each §14 fit category, used by `categoryReadout`. */
export const CATEGORY_PHRASES: Record<'situation' | 'preference' | 'history', FeatureLabel> = {
  "situation": {
    "ja": "運転状況",
    "en": "the driving situation"
  },
  "preference": {
    "ja": "運転者の好み",
    "en": "the driver's taste"
  },
  "history": {
    "ja": "運転者の利用履歴",
    "en": "the driver's history"
  }
} as const

/** Lead sentence for a known `trigger_purpose`, used by `triggerSentence`. */
const TRIGGER_SENTENCES: Record<string, string> = {
  "rest_recommended": "A rest stop is now being recommended",
  "inattentive_driving_prevention_recovery": "The assistant is trying to keep the driver alert",
  "route_music": "This is routine in-drive music selection",
  "child_passenger_experience": "A child is aboard"
} as const

/** Genuinely-stopped `LifecycleStage` values ONLY (see the Python module's own
 * comment — a bare substring check on the stage name would wrongly catch
 * `before_rest_until_stop`, which is still-driving-toward-the-stop). */
const STOPPED_STAGES = new Set<string>([
  "after_rest_before_restart",
  "during_rest_stopped"
])

/** situation-family feature ids (full + short-leaf forms), used by `featureFamily`. */
const REASON_SITUATION_FEATURES = new Set<string>([
  "child",
  "child_present",
  "destination",
  "destination_tags",
  "drowsiness",
  "drowsiness_level",
  "fatigue",
  "fatigue_level",
  "monotony",
  "monotony_level",
  "multiple_passengers",
  "night",
  "night_state",
  "road",
  "road_type",
  "route",
  "route_tags",
  "traffic",
  "traffic_state"
])

/** preference-family feature ids (full + short-leaf forms), used by `featureFamily`. */
const REASON_PREFERENCE_FEATURES = new Set<string>([
  "age",
  "age_band",
  "gender",
  "genre_affinity",
  "genre_usage",
  "hobbies",
  "hobby_interest_tags",
  "oshi",
  "oshi_artists",
  "oshi_tags",
  "oshi_type",
  "scene_genre",
  "service_ease",
  "song_singability",
  "usage_by_genre"
])

/** history-family feature ids (full + short-leaf forms), used by `featureFamily`. */
const REASON_HISTORY_FEATURES = new Set<string>([
  "acceptance",
  "cancelled_content_plans",
  "catalog_item_recency_state",
  "catalog_item_usage_level",
  "changed",
  "changed_from_items",
  "completed_items",
  "content_proposal_acceptance_rate",
  "content_recovery_rate",
  "content_tag_recency_state",
  "content_tag_usage_level",
  "item_usage",
  "manually_selected_items",
  "played",
  "played_items",
  "recovery",
  "repeated_items",
  "scene_content_tag_usage_level",
  "scene_service_usage_level",
  "service_proposal_acceptance_rate",
  "service_recency_state",
  "service_recovery_rate",
  "service_usage_level",
  "skipped",
  "skipped_items"
])

/** Maximal grounding (feature 019): cap on `factorsFromTarget`'s output. */
export const MAX_FACTORS = 24

/** Contributions below this magnitude are dropped as noise by `factorsFromTarget`. */
export const MIN_ABS_CONTRIBUTION = 1e-06

/** Minimum |contribution| for a situation feature to count as actually having
 * driven a candidate — `situationSentence`'s `contributingOnly` gate. */
export const CONTRIBUTING_THRESHOLD = 0.005

/** Separator the content selector uses between the ja/en halves of a combined
 * rationale entry — needed by content.ts's `_legacy_join` port (task 3). */
export const CONTENT_LANG_SEP = " / "

/** Appended to the end of a reasoning-mode user message — needed by the step
 * modules' `buildPrompt` (tasks 2-3). Verbatim from Python. */
export const FORMAT_REMINDER = "Reply with exactly two lines and nothing else: a 'JA:' line in Japanese, then an 'EN:' line in English."

/** Shared closing paragraph appended to every reasoning-mode system prompt —
 * needed by the step modules' `buildPrompt` (tasks 2-3). Verbatim from Python. */
export const REASON_CLOSING = "Use ONLY the given facts; never invent features, numbers, songs, or driver preferences that are not listed. Do NOT copy the fact lines verbatim.\n\nReply with EXACTLY two lines and nothing else: a 'JA:' line in Japanese, then an 'EN:' line in English. Line 1 starts 'JA:', line 2 starts 'EN:', each one or two natural sentences.\n\nIMPORTANT: the facts above are written in English, but you MUST write Line 1 in JAPANESE (日本語で). Do NOT write Line 1 in English. Follow this shape (write your own words, do not copy):\nJA: 〔日本語で1〜2文の理由〕\nEN: 〔the same reason in English〕\n\nLANGUAGE REQUIREMENT (critical): Line 1 must use JAPANESE SCRIPT — hiragana, katakana and kanji, e.g. 「疲労がたまり、単調な走行が続いたため発火しました。」. It must NOT be Korean/Hangul, Chinese, or English. If you cannot write Japanese, write Line 1 in English rather than in any other language."

/** Content-step reasoning-mode system prompt template — `{kind}` is a literal
 * placeholder the CALLER substitutes (mirrors Python's `.format(kind=...)`,
 * done at the content.ts call site, not here). Verbatim from Python. */
export const CONTENT_REASON_SYSTEM = "You explain why an in-car assistant selected a {kind} for the driver — in BOTH Japanese and English. You are given the raw scoring facts; work out the causal story yourself. Do not just restate numbers.\n\nWHAT THE ALGORITHM DOES\nEach song is distilled into traits: arousal (energy — how lively the song is), valence (brightness/positivity of its mood), and sing-along ease. The driver's current situation CALLS FOR a certain kind of music, and a song scores well when its traits answer that call.\n\nWHAT EACH SITUATION CALLS FOR (the response model — apply this):\n- Drowsiness -> MORE energetic (higher arousal) AND brighter music (re-energize).\n- Monotony -> MORE energetic and brighter music (counter boredom).\n- Fatigue -> CALMER (lower arousal) but brighter music (soothe without dulling).\n- Heavy traffic -> CALMER but brighter music (de-stress).\n- Night -> CALMER, brighter music.\n- Winding/mountain road -> CALMER music (matches the heavier driving load).\n- Highway / local roads -> no particular energy demand.\n\nHOW A FACTOR SCORES\nA factor's contribution = how much the trigger purpose weights it TIMES how well the chosen {kind} answered what it calls for. So a POSITIVE contribution from, say, drowsiness means the song was energetic/bright enough to answer it. Factors group into three families: the driving SITUATION (above), the driver's TASTE (favorite artist, genre, era, singability), and the driver's HISTORY (past plays, skips, acceptance, recovery). The family with the largest subtotal drove the choice most.\n\nYOUR TASK\nReason the causal story: (1) which family dominated (compare the subtotals); (2) what its top factors called for; (3) how the {kind}'s actual character answered that; (4) how the other families reinforced or tempered it.\n\nUse ONLY the given facts; never invent features, numbers, songs, or driver preferences that are not listed. Do NOT copy the fact lines verbatim.\n\nReply with EXACTLY two lines and nothing else: a 'JA:' line in Japanese, then an 'EN:' line in English. Line 1 starts 'JA:', line 2 starts 'EN:', each one or two natural sentences.\n\nIMPORTANT: the facts above are written in English, but you MUST write Line 1 in JAPANESE (日本語で). Do NOT write Line 1 in English. Follow this shape (write your own words, do not copy):\nJA: 〔日本語で1〜2文の理由〕\nEN: 〔the same reason in English〕\n\nLANGUAGE REQUIREMENT (critical): Line 1 must use JAPANESE SCRIPT — hiragana, katakana and kanji, e.g. 「疲労がたまり、単調な走行が続いたため発火しました。」. It must NOT be Korean/Hangul, Chinese, or English. If you cannot write Japanese, write Line 1 in English rather than in any other language."

/** Service-step reasoning-mode system prompt. Verbatim from Python. */
export const SERVICE_REASON_SYSTEM = "You explain why an in-car assistant proposed a SERVICE (not a song) to the driver — in BOTH Japanese and English. Work out the causal story from the facts; do not just restate numbers.\n\nWHAT THE ALGORITHM DOES\nAfter a trigger decides a proposal is warranted, it ranks which service to offer. Each candidate service has a RESPONSE to the current situation — how well that service answers what the situation needs. A factor's contribution = how strong that situation signal is TIMES how well this service responds to it, shaped by the trigger purpose.\n\nWHAT EACH KIND OF SERVICE IS FOR (the response model — apply this):\n- Interactive / engaging services (humming karaoke, call-and-response, quiz, ranking) keep a drowsy or bored driver alert — they strongly respond to drowsiness, fatigue, monotony.\n- Background music (music playlist, radio) is a low-demand default — mainly driven by the route/music purpose, largely neutral to driver state.\n- Rest & recovery services (stretch video, full karaoke, live viewing, oshi re-experience) are for when the car is stopped or after a rest — they fit rest/stopped stages, not active driving.\nThe trigger purpose steers the emphasis: a rest recommendation favors rest bridging; inattentive-driving prevention favors engaging services; routine music favors the music services; a child aboard favors child-friendly ones.\n\nHOW A FACTOR SCORES\nFactors group into three families: the driving SITUATION (drowsiness, fatigue, traffic, road, night, monotony) plus the trigger and car state; the driver's service TASTE; and the driver's HISTORY with this service (past acceptance, recovery, usage). The family with the largest subtotal drove the choice most.\n\nYOUR TASK\nReason the causal story: (1) what the trigger + situation call for; (2) how the chosen service answers that; (3) how history/other factors reinforced or tempered it.\n\nExplain using the ranked reasons below; only cite a situation as a reason if it drove THIS service. Never argue that a different kind of service is needed than the one that was chosen.\n\nUse ONLY the given facts; never invent features, numbers, songs, or driver preferences that are not listed. Do NOT copy the fact lines verbatim.\n\nReply with EXACTLY two lines and nothing else: a 'JA:' line in Japanese, then an 'EN:' line in English. Line 1 starts 'JA:', line 2 starts 'EN:', each one or two natural sentences.\n\nIMPORTANT: the facts above are written in English, but you MUST write Line 1 in JAPANESE (日本語で). Do NOT write Line 1 in English. Follow this shape (write your own words, do not copy):\nJA: 〔日本語で1〜2文の理由〕\nEN: 〔the same reason in English〕\n\nLANGUAGE REQUIREMENT (critical): Line 1 must use JAPANESE SCRIPT — hiragana, katakana and kanji, e.g. 「疲労がたまり、単調な走行が続いたため発火しました。」. It must NOT be Korean/Hangul, Chinese, or English. If you cannot write Japanese, write Line 1 in English rather than in any other language."

// ---------------------------------------------------------------------------
// Vocabulary lookups (mechanical)
// ---------------------------------------------------------------------------

/** Bilingual label for a feature id, falling back to the raw id. */
export function labelFor(featureId: string): FeatureLabel {
  return FEATURE_LABELS[featureId] ?? { ja: featureId, en: featureId }
}

/** Plain-English meaning of a feature id (`""` when unknown). */
export function featureMeaning(featureId: string): string {
  return FEATURE_MEANINGS[featureId] ?? ''
}

// ---------------------------------------------------------------------------
// Display / factor helpers
// ---------------------------------------------------------------------------

/**
 * Qualitative band for a factor's raw value (FIX-SCALE).
 *
 * Numeric `e_i`/`feature_value` (0-1 normalized evidence) is banded into
 * "high"/"medium"/"low" so it reads consistently against the 0-100 style
 * meanings, instead of showing a raw fraction like `0.7` that looks low
 * against a 0-100 scale. Non-empty strings (service categoricals like
 * "heavy"/"high") pass through unchanged. Missing/blank -> "".
 *
 * A Python `bool` is a subtype of `int` but is checked FIRST in the Python
 * source (`isinstance(value, bool)` before the numeric branch), so a boolean
 * never reaches the numeric bands — mirrored here by checking `typeof
 * === 'boolean'` before `typeof === 'number'`.
 */
export function valueDisplay(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'high' : 'low'
  if (typeof value === 'number') {
    if (value >= 0.62) return 'high'
    if (value < 0.4) return 'low'
    return 'medium'
  }
  if (typeof value === 'string' && value) return value
  return ''
}

/**
 * Python's `isinstance(x, (int, float))` accepts `bool` — `bool` is a
 * subclass of `int` — so a boolean reaching one of these guards is NOT
 * rejected; it flows into arithmetic as `float(x)` (`True` -> `1.0`,
 * `False` -> `0.0`). A plain `typeof x === 'number'` TS guard misses this
 * and silently falls through to whatever the caller does for "not a
 * number" (a `null`/`0.0` fallback here), which is a *different sentence or
 * a dropped row* downstream, not a rounding difference (design doc
 * divergence hazard 8). This is the one shared coercion every affected
 * call site in this file needs — `contributionOr0`, `reasonRowValue`'s
 * `e_i` branch, `reasonRowContribution`, and `historySentences`' `e_i`/
 * `feature_value` guards all resolve to "accept and coerce", so they share
 * this helper rather than repeating the `typeof ... 'boolean'` branch four
 * times. Returns `null` for anything else, mirroring the Python guard's
 * negative branch (each caller supplies its own fallback for that case).
 */
function numericOrBool(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1.0 : 0.0
  return null
}

/** Mirrors Python's `float(fc.get("contribution", 0.0) or 0.0)` for the
 * `contribution` field specifically — missing/`null`/`0`/`False` all
 * normalize to `0.0`; `True` normalizes to `1.0` (see `numericOrBool`); any
 * other nonzero number passes through. Not a general-purpose `or 0.0`
 * helper (this file has exactly one such site). */
function contributionOr0(v: unknown): number {
  const n = numericOrBool(v)
  return n !== null && n !== 0 ? n : 0.0
}

/**
 * Extract, label, define, and rank the contributions of a candidate/item.
 *
 * Works for both shapes: service `FeatureContribution` (`feature_value`) and
 * content `ItemFeatureContribution` (`e_i`). Drops negligible (~0)
 * contributions, sorts by `|contribution|` descending, caps at `MAX_FACTORS`.
 *
 * The sort relies on `Array.prototype.sort`'s ES2019+ stability guarantee to
 * match Python's `list.sort(key=..., reverse=True)`, which is ALSO stable
 * (ties keep their original relative order, not reversed) — both preserve
 * `feature_contributions`' original row order among equal `|contribution|`s.
 */
export function factorsFromTarget(target: ExplanationTarget): Factor[] {
  const factors: Factor[] = []
  const rows = target.feature_contributions ?? []
  for (const fc of rows) {
    const contribution = contributionOr0(fc.contribution)
    if (Math.abs(contribution) < MIN_ABS_CONTRIBUTION) continue
    const fid = typeof fc.feature_id === 'string' ? fc.feature_id : String(fc.feature_id ?? '')
    const lab = labelFor(fid)
    let value: unknown = fc.feature_value
    if (value === null || value === undefined) value = fc.e_i
    factors.push({
      feature_id: fid,
      label_ja: lab.ja,
      label_en: lab.en,
      contribution,
      value: value === undefined ? null : value,
      value_display: valueDisplay(value),
      meaning: featureMeaning(fid),
    })
  }
  factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  return factors.slice(0, MAX_FACTORS)
}

// ---------------------------------------------------------------------------
// Shared natural-language fact translators (fact-rich reasoning prompts)
// ---------------------------------------------------------------------------

/** `"situation"` | `"preference"` | `"history"` | `null` for a feature id.
 *
 * Used ONLY by the fact-rich reasoning prompts (situation/preference/history
 * sentence builders below) — independent of `content_explanation`'s own
 * classifier (Task 3's `_family_of`, a private, near-identical-but-separate
 * table that stays local to `content.ts`; the Python module docstring is
 * explicit these must not be merged). */
export function featureFamily(featureId: string): 'situation' | 'preference' | 'history' | null {
  if (REASON_SITUATION_FEATURES.has(featureId)) return 'situation'
  if (REASON_PREFERENCE_FEATURES.has(featureId)) return 'preference'
  if (REASON_HISTORY_FEATURES.has(featureId)) return 'history'
  return null
}

/** Three-way ordinal band: `v < lo` -> `"low"`, `v >= hi` -> `"high"`,
 * else `"mid"`; `null`/`undefined` -> `null`. */
export function lvl3(v: number | null | undefined, lo: number, hi: number): 'low' | 'mid' | 'high' | null {
  if (v === null || v === undefined) return null
  return v < lo ? 'low' : v >= hi ? 'high' : 'mid'
}

/** Raw `feature_value` (preferred) or `e_i` scaled to 0-100 for the first
 * matching row among `featureIds` (full + short-leaf forms). A boolean
 * `e_i` is accepted (see `numericOrBool`) — `True`/`False` scale to
 * `100.0`/`0.0`, exactly as Python's `isinstance(e, (int, float))` guard
 * followed by `float(e) * 100.0` does. */
export function reasonRowValue(target: ExplanationTarget, ...featureIds: string[]): unknown {
  const rows = target.feature_contributions ?? []
  for (const fc of rows) {
    const fid = typeof fc.feature_id === 'string' ? fc.feature_id : String(fc.feature_id ?? '')
    if (featureIds.includes(fid)) {
      const v = fc.feature_value
      if (v !== null && v !== undefined) return v
      const e = numericOrBool(fc.e_i)
      if (e !== null) return e * 100.0
      return null
    }
  }
  return null
}

/** `contribution` float for the first matching row among `featureIds` (full
 * + short-leaf forms), or `null` when no such row is present. A boolean
 * `contribution` is accepted (see `numericOrBool`) — `True`/`False` become
 * `1.0`/`0.0`, exactly as Python's `isinstance(c, (int, float))` guard
 * followed by `float(c)` does. */
export function reasonRowContribution(target: ExplanationTarget, ...featureIds: string[]): number | null {
  const rows = target.feature_contributions ?? []
  for (const fc of rows) {
    const fid = typeof fc.feature_id === 'string' ? fc.feature_id : String(fc.feature_id ?? '')
    if (featureIds.includes(fid)) {
      return numericOrBool(fc.contribution)
    }
  }
  return null
}

/**
 * Plain-language driver/road state from the target's situation-family rows
 * (drowsiness/fatigue/monotony levels; traffic/night/road state). `null`
 * when no situation row is present at all.
 *
 * When `contributingOnly` is true (used by the SERVICE prompt), each
 * situation piece is gated independently on whether ITS row actually
 * contributed to this candidate (`|contribution| >= CONTRIBUTING_THRESHOLD`).
 * This stops a service that is NEUTRAL to drowsiness/monotony (e.g.
 * background music, contribution ~0) from being handed a prominent "the
 * driver is getting drowsy" fact that has nothing to do with why it was
 * picked. When nothing passes the gate, returns `null` (the caller omits the
 * whole SITUATION section) rather than the mild overclaim "the driver is in
 * a neutral state".
 *
 * `contributingOnly = false` (the default, used by the CONTENT prompt) is
 * unchanged: every situation row present is narrated regardless of its
 * contribution to this particular item.
 */
export function situationSentence(
  target: ExplanationTarget,
  // Unused — mirrors Python's own `situation_sentence(target, trigger_purpose,
  // contributing_only=False)`, which never reads `trigger_purpose` in its
  // body either (the rest-recommendation clause it once drove was extracted
  // into `triggerSentence`'s own section; the parameter stayed in the
  // signature so call sites — see `service.ts`/`content.ts`, tasks 2-3 —
  // still pass it positionally). Kept, not removed, to match Python's
  // signature exactly; `_`-prefixed so `noUnusedParameters` allows it.
  _triggerPurpose: string | null | undefined,
  contributingOnly = false,
): string | null {
  const d = reasonRowValue(target, 'drowsiness_level', 'drowsiness')
  const f = reasonRowValue(target, 'fatigue_level', 'fatigue')
  const m = reasonRowValue(target, 'monotony_level', 'monotony')
  const night = reasonRowValue(target, 'night_state', 'night')
  const traffic = reasonRowValue(target, 'traffic_state', 'traffic')
  const road = reasonRowValue(target, 'road_type', 'road')
  if (d === null && f === null && m === null && night === null && traffic === null && road === null) {
    return null
  }

  const passes = (...featureIds: string[]): boolean => {
    if (!contributingOnly) return true
    const c = reasonRowContribution(target, ...featureIds)
    return c !== null && Math.abs(c) >= CONTRIBUTING_THRESHOLD
  }

  const parts: string[] = []
  if (typeof d === 'number' && passes('drowsiness_level', 'drowsiness')) {
    parts.push(d < 30 ? 'alert and awake' : d >= 60 ? 'very drowsy' : 'getting drowsy')
  }
  if (typeof f === 'number' && f >= 55 && passes('fatigue_level', 'fatigue')) {
    parts.push('physically tired')
  }

  const env: string[] = []
  if (typeof m === 'number' && passes('monotony_level', 'monotony')) {
    env.push(
      m >= 60
        ? 'the road is very monotonous and boring'
        : m >= 35
          ? 'the road is a little monotonous'
          : 'the road is engaging',
    )
  }
  if (typeof night === 'string' && night === 'night' && passes('night_state', 'night')) {
    env.push('it is night')
  }
  if (typeof traffic === 'string' && traffic && traffic !== 'normal' && passes('traffic_state', 'traffic')) {
    env.push(`traffic is ${traffic}`)
  }
  if (typeof road === 'string' && road && passes('road_type', 'road')) {
    env.push(`they are on a ${road.replace(/_/g, ' ')}`)
  }

  if (contributingOnly && parts.length === 0 && env.length === 0) {
    // Nothing about the driver/road situation actually contributed to this
    // candidate — omit the section entirely rather than emit the mild
    // overclaim "the driver is in a neutral state" (contributingOnly mode
    // only; the default/content path never hits this branch).
    return null
  }

  const lead = 'The driver is ' + (parts.length > 0 ? parts.join(', ') : 'in a neutral state')
  // The rest-recommendation clause is carried by triggerSentence's "THE
  // TRIGGER & CAR STATE" section for service prompts — do not repeat it
  // here, or a rest_recommended service prompt shows it twice.
  const envS = env.length > 0 ? '; ' + env.join(', ') + '.' : '.'
  return lead + envS
}

/** Service-step fact: what the trigger is asking for + the car's motion
 * state (moving vs stopped). */
export function triggerSentence(
  triggerPurpose: string | null | undefined,
  target: ExplanationTarget,
  lifecycleStage: string | null | undefined,
): string {
  let lead: string | null = triggerPurpose ? (TRIGGER_SENTENCES[triggerPurpose] ?? null) : null
  if (lead === null) {
    lead = triggerPurpose ? `The trigger purpose is ${triggerPurpose}` : 'A proposal is being made'
  }

  const motion = reasonRowValue(target, 'motion_state', 'motion')
  let stopped: boolean
  if (typeof motion === 'string' && motion) {
    const m = motion.toLowerCase()
    stopped = m === 'stopped' || m === 'parked' || m === 'parking'
  } else {
    stopped = STOPPED_STAGES.has(lifecycleStage ?? '')
  }
  const car = stopped ? 'the car is stopped' : 'the car is moving (active driving)'
  return `${lead}; ${car}.`
}

/** Content-step fact: the driver's registered favorite artist (oshi) and,
 * when available, top genres / age band. Purely best-effort from `context`
 * — absent fields are silently skipped (never invented).
 *
 * `driver_profile`/`age_band` are read here exactly like Python, but the
 * ONE real call site (`routers/proposal.py`'s `explain_from_run_log`) never
 * populates `context.driver_profile` today — see that function's Python
 * source. These branches are reachable by direct construction (and are
 * covered that way below), not by the live app's current wiring. */
export function preferenceSentence(context: ExplanationContext): string | null {
  const oshiArtist = context.oshi_artist
  const dpRaw = context.driver_profile
  const dp: Record<string, unknown> =
    dpRaw && typeof dpRaw === 'object' && !Array.isArray(dpRaw) ? (dpRaw as Record<string, unknown>) : {}

  const parts: string[] = []
  if (oshiArtist) {
    parts.push(`Their favorite artist (oshi) is ${oshiArtist as string}`)
  } else if (dp.oshi_registered === false) {
    parts.push('They have no registered favorite artist')
  }

  const usageByGenreRaw = dp.usage_by_genre
  const usageByGenre: Record<string, unknown> =
    usageByGenreRaw && typeof usageByGenreRaw === 'object' && !Array.isArray(usageByGenreRaw)
      ? (usageByGenreRaw as Record<string, unknown>)
      : {}
  const genres = Object.entries(usageByGenre)
    .filter(([, lv]) => lv === 'high' || lv === 'mid')
    .map(([g]) => g)
  if (genres.length > 0) {
    parts.push('they often listen to ' + genres.join('/'))
  }

  const ageBand = dp.age_band || context.age_band
  if (ageBand) {
    parts.push(`they are in their ${ageBand as string}`)
  }

  if (parts.length === 0) return null
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '.'
}

/** Driver-history facts (recovery/usage/acceptance/played/skipped) for
 * either a content item or a service candidate, translated from the
 * history-family rows' evidence — never a raw number. */
export function historySentences(target: ExplanationTarget): string[] {
  const out: string[] = []
  const rows = target.feature_contributions ?? []
  for (const fc of rows) {
    const fid = typeof fc.feature_id === 'string' ? fc.feature_id : String(fc.feature_id ?? '')
    if (featureFamily(fid) !== 'history') continue

    // Both guards accept a boolean the same way Python's `isinstance(e,
    // (int, float))` does (`e_i`/`feature_value` are Pydantic-typed float
    // on real evidence, so this only matters for hand-constructed targets —
    // see design doc divergence hazard 8): `numericOrBool` turns True/False
    // into 1.0/0.0, which then flows through `lvl3`/the `>= 0.99` checks
    // below exactly like any other number.
    let e: number | null = numericOrBool(fc.e_i)
    if (e === null) {
      const fv = numericOrBool(fc.feature_value)
      if (fv !== null) {
        e = fv > 1 ? fv / 100.0 : fv
      }
    }
    const lvl = e !== null ? lvl3(e, 0.34, 0.66) : null

    if (fid === 'content_recovery_rate' && lvl === 'high') {
      out.push("this song has reliably restored the driver's state before")
    } else if (fid === 'service_recovery_rate' && lvl === 'high') {
      out.push("this service has reliably restored the driver's state before")
    } else if (fid === 'catalog_item_usage_level' && (lvl === 'high' || lvl === 'mid')) {
      out.push(`the driver plays this song ${lvl === 'high' ? 'often' : 'sometimes'}`)
    } else if (
      (fid === 'service_usage_level' || fid === 'scene_service_usage_level') &&
      (lvl === 'high' || lvl === 'mid')
    ) {
      out.push(`the driver uses this service ${lvl === 'high' ? 'often' : 'sometimes'}`)
    } else if (fid === 'content_proposal_acceptance_rate' && lvl === 'high') {
      out.push('the driver usually accepts song suggestions')
    } else if (fid === 'service_proposal_acceptance_rate' && lvl === 'high') {
      out.push('the driver usually accepts this service when offered')
    } else if (fid === 'played_items' && e !== null && e >= 0.99) {
      out.push('the driver played this song recently')
    } else if (fid === 'skipped_items' && e !== null && e >= 0.99) {
      out.push('the driver recently skipped this song')
    } else if (
      (fid === 'content_tag_usage_level' || fid === 'scene_content_tag_usage_level') &&
      (lvl === 'high' || lvl === 'mid')
    ) {
      out.push(`the driver ${lvl === 'high' ? 'often' : 'sometimes'} plays this song's genre`)
    } else if (fid === 'service_recency_state' && typeof fc.feature_value === 'string') {
      const fv = fc.feature_value
      if (fv && fv !== 'normal') {
        out.push(`it has been ${fv} since the driver last used this service`)
      }
    }
    // Any other history-family fid (e.g. `changed_from_items`,
    // `repeated_items`, `completed_items`, `cancelled_content_plans`,
    // `manually_selected_items`, `content_tag_recency_state`,
    // `catalog_item_recency_state`) falls through every branch above and
    // contributes nothing — Python has no `else` clause either, so this is
    // not a gap in the port; see task-1-report.md's branch table.
  }

  const seen = new Set<string>()
  const uniq: string[] = []
  for (const s of out) {
    if (!seen.has(s)) {
      seen.add(s)
      uniq.push(s)
    }
  }
  return uniq
}

export function scoreStrength(c: number): string {
  const a = Math.abs(c)
  if (c > 0) {
    return a >= 0.08 ? 'a major reason' : a >= 0.04 ? 'a significant reason' : a >= 0.015 ? 'a minor reason' : 'a slight factor'
  }
  // Negative contributions are magnitude-aware too (mirroring the positive
  // tiers), so a strong opposing factor doesn't collapse into the same
  // trivial phrase as a barely-there one. `c === 0` also lands here (Python:
  // `if c > 0` is false for `0`), reading as "pushed slightly against it"
  // even though a caller normally filters near-zero contributions out
  // before calling this (see `scoreEvidence`'s `< 0.008` guard) — direct
  // callers of `scoreStrength` do not get that guard for free.
  const tierWord = a >= 0.08 ? 'strongly' : a >= 0.04 ? 'moderately' : 'slightly'
  return `pushed ${tierWord} against it`
}

/** Top |contribution| factors (already extracted by `factorsFromTarget`) as
 * strength words — never the raw fraction. */
export function scoreEvidence(factors: Factor[], oshiArtist?: string | null): string[] {
  const lines: string[] = []
  for (const f of factors.slice(0, 6)) {
    const c = f.contribution
    if (Math.abs(c) < 0.008) continue
    let what: string
    if (f.feature_id === 'oshi_artists' && c > 0) {
      what = `it is by the driver's favorite artist${oshiArtist ? ` (${oshiArtist})` : ''}`
    } else {
      what = f.label_en
    }
    lines.push(`- ${what}: ${scoreStrength(c)}`)
  }
  return lines
}

// ---------------------------------------------------------------------------
// Shared category readout (§14 fit subtotals -> signed trio + dominant + phrase)
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: Array<'situation' | 'preference' | 'history'> = ['situation', 'preference', 'history']

/**
 * Bilingual 'what dominated' readout from the §14 fit subtotals.
 *
 * Returns `null` when the target carries no numeric situation/preference/
 * history subtotal (LLM-shaped plans, mock selector), so callers can skip
 * the line.
 *
 * Ties (equal `|value|` across categories) resolve to whichever category
 * comes first in `situation, preference, history` order — mirrors Python's
 * `max(nums, key=...)`, which keeps the FIRST-encountered maximum on a tie
 * (`nums` is built by iterating that same fixed tuple order), not the last.
 */
export function categoryReadout(target: ExplanationTarget): CategoryReadout | null {
  const nums: Partial<Record<'situation' | 'preference' | 'history', number>> = {}
  for (const cat of CATEGORY_ORDER) {
    const v = target[`${cat}_fit`]
    if (typeof v === 'number') nums[cat] = v
  }
  const present = CATEGORY_ORDER.filter((c) => nums[c] !== undefined)
  if (present.length === 0) return null

  let dominant = present[0]
  let dominantAbs = Math.abs(nums[dominant] as number)
  for (const cat of present.slice(1)) {
    const a = Math.abs(nums[cat] as number)
    if (a > dominantAbs) {
      dominant = cat
      dominantAbs = a
    }
  }

  const ph = CATEGORY_PHRASES[dominant]
  return {
    situation: nums.situation ?? 0.0,
    preference: nums.preference ?? 0.0,
    history: nums.history ?? 0.0,
    dominant,
    phrase_ja: `この選択は主に${ph.ja}によって決まりました。`,
    phrase_en: `This choice was driven mostly by ${ph.en}.`,
  }
}
