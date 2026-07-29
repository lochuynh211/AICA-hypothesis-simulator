// app/frontend/src/lib/review/reviewVocabulary.ts
/**
 * Plain phrasing and domain grouping for review features.
 *
 * The GROUP MAP IS A PRODUCT DECISION, not a technical one. `driving_time` and
 * `familiar_route` in particular are arguable, and they belong to whoever owns
 * the specification — so the whole assignment lives in one table here rather
 * than scattered through components, to stay easy to challenge and change.
 *
 * An unrecognised feature is NEVER given invented prose. It falls to `other`
 * and keeps its raw identifier, so a new feature shows up as unlabelled rather
 * than as quietly mislabelled.
 */

export type BilingualLabel = { ja: string; en: string }

export type DomainGroup =
  | 'driver_state'
  | 'road_environment'
  | 'preferences_history'
  | 'content_properties'
  | 'other'

export const GROUP_MEMBERS: Record<Exclude<DomainGroup, 'other'>, string[]> = {
  driver_state: ['drowsiness', 'fatigue', 'driving_anomaly', 'driving_time', 'child_passenger'],
  road_environment: [
    'monotony', 'env_load', 'rest_window', 'rest_scarcity',
    'road_type', 'traffic_jam', 'night_state', 'weather_risk', 'motion_state',
  ],
  preferences_history: [
    'familiar_route', 'oshi_affinity', 'oshi_mode', 'recent_play_penalty',
    'genre_affinity', 'skip_penalty', 'changed_penalty',
  ],
  content_properties: [
    'song_arousal', 'song_valence', 'song_tempo', 'song_loudness',
    'song_singability', 'song_era', 'humming_ease', 'full_karaoke_ease',
  ],
}

const GROUP_OF = new Map<string, DomainGroup>(
  Object.entries(GROUP_MEMBERS).flatMap(([group, members]) =>
    members.map((m) => [m, group as DomainGroup] as const),
  ),
)

export function domainGroup(featureId: string): DomainGroup {
  return GROUP_OF.get(featureId) ?? 'other'
}

const GROUP_LABELS: Record<DomainGroup, BilingualLabel> = {
  driver_state: { ja: 'ドライバーの状態', en: 'Driver state' },
  road_environment: { ja: '道路と環境', en: 'Road & environment' },
  preferences_history: { ja: '嗜好と履歴', en: 'Preferences & history' },
  content_properties: { ja: 'コンテンツの性質', en: 'Content properties' },
  other: { ja: 'その他', en: 'Other' },
}

export const groupLabel = (group: DomainGroup): BilingualLabel => GROUP_LABELS[group]

/**
 * The two V1 reviewable checkpoint categories, labelled.
 *
 * Single source of truth for BOTH `chains.ts` (comparable trigger options)
 * and `checkpoints.ts` (the derived rail) — this table used to be declared
 * byte-identically in both files, and this branch already had one incident
 * from exactly that copy-paste pattern. Loosely typed (`Record<string, ...>`)
 * rather than keyed on `ReviewableCategory` to avoid a circular import with
 * `checkpoints.ts`, which already imports `BilingualLabel` from here.
 */
export const CATEGORY_LABELS: Record<string, BilingualLabel> = {
  rest_required: { ja: '休憩の提案', en: 'Rest proposal' },
  monotony_prevention: { ja: '単調さへの介入', en: 'Monotony intervention' },
}

/**
 * Plain phrasing. The identifier is shown separately in faint grey, never as
 * the label.
 *
 * Exported (not just `phrase()`) so a test can scan every entry for a class
 * of mismatch, not just spot-check individual ids: an English phrase framed
 * by DEGREE ("how X the thing is") must not pair with a Japanese phrase
 * framed by YES/NO (ending in かどうか) — `bandWord()` renders a strength
 * word ("非常に高い" / "very high") after both, and "whether recently played:
 * very high" reads as nonsense in a way "recency of play: very high" does
 * not.
 */
export const PHRASES: Record<string, BilingualLabel> = {
  drowsiness: { ja: 'ドライバーの眠気', en: 'how drowsy the driver is' },
  fatigue: { ja: 'ドライバーの疲労', en: 'how tired the driver is' },
  driving_anomaly: { ja: '運転の乱れ', en: 'how erratic the driving is' },
  driving_time: { ja: '連続運転時間の長さ', en: 'how long they have been driving' },
  env_load: { ja: '走行環境の負荷', en: 'how demanding the environment is' },
  monotony: { ja: '道路の単調さ', en: 'how monotonous the road is' },
  rest_window: { ja: '休憩機会の近さ', en: 'how soon a rest stop is available' },
  rest_scarcity: { ja: '休憩機会の少なさ', en: 'how scarce rest stops are' },
  familiar_route: { ja: 'ルートへの慣れ', en: 'how familiar the route is' },
  child_passenger: { ja: '子供の同乗', en: 'whether a child is aboard' },
  oshi_affinity: { ja: '推しアーティストとの一致', en: 'the match to their favourite artist' },
  oshi_mode: { ja: '推し優先モードの有無', en: 'whether favourite-artist mode is on' },
  genre_affinity: { ja: '好みのジャンルとの一致', en: 'how well the genre matches their taste' },
  // History phrases stay FACTUAL in both languages. Naming the scoring effect
  // ("…による減点") in JA while EN names the fact would describe two different
  // things to two reviewers looking at the same row.
  recent_play_penalty: { ja: '再生の新しさ', en: 'how recently this was played' },
  skip_penalty: { ja: '過去にスキップした頻度', en: 'how often they skipped this before' },
  changed_penalty: { ja: '過去に切り替えた頻度', en: 'how often they switched away from this' },
  road_type: { ja: '走っている道路の種類', en: 'what kind of road they are on' },
  traffic_jam: { ja: '渋滞の程度', en: 'how congested the traffic is' },
  night_state: { ja: '夜間かどうか', en: 'whether it is night' },
  weather_risk: { ja: '天候によるリスク', en: 'how risky the weather is' },
  motion_state: { ja: '車が走行中か停車中か', en: 'whether the car is moving or stopped' },
  song_arousal: { ja: '曲の高揚感', en: 'how energising the song is' },
  song_valence: { ja: '曲の明るさ', en: 'how bright the song is' },
  song_tempo: { ja: '曲のテンポ', en: 'how fast the song is' },
  song_loudness: { ja: '曲の音量感', en: 'how loud the song is' },
  song_singability: { ja: '曲の歌いやすさ', en: 'how easy the song is to sing' },
  song_era: { ja: '曲の年代', en: 'what era the song is from' },
  humming_ease: { ja: 'ハミングのしやすさ', en: 'how easy the song is to hum' },
  full_karaoke_ease: { ja: 'フルカラオケ適性', en: 'how suited the song is to full karaoke' },
}

export const phrase = (featureId: string): BilingualLabel =>
  PHRASES[featureId] ?? { ja: featureId, en: featureId }

/**
 * Short NOUN names for the comparison table (owner review) — `PHRASES` above
 * are sentence fragments ("how drowsy the driver is") built for prose, which
 * read badly as a column of labels.
 */
export const FIELD_NAMES: Record<string, BilingualLabel> = {
  drowsiness: { ja: '眠気', en: 'Drowsiness' },
  fatigue: { ja: '疲労', en: 'Fatigue' },
  driving_anomaly: { ja: '運転の乱れ', en: 'Driving anomaly' },
  driving_time: { ja: '連続運転時間', en: 'Driving time' },
  env_load: { ja: '走行環境の負荷', en: 'Environment load' },
  monotony: { ja: '道路の単調さ', en: 'Monotony' },
  rest_window: { ja: '休憩機会の近さ', en: 'Rest window' },
  rest_scarcity: { ja: '休憩機会の少なさ', en: 'Rest scarcity' },
  familiar_route: { ja: 'ルートへの慣れ', en: 'Familiar route' },
  child_passenger: { ja: '子供の同乗', en: 'Child aboard' },
  oshi_affinity: { ja: '推しとの一致', en: 'Favourite-artist match' },
  oshi_mode: { ja: '推し優先モード', en: 'Favourite-artist mode' },
  genre_affinity: { ja: 'ジャンルの一致', en: 'Genre match' },
  recent_play_penalty: { ja: '再生の新しさ', en: 'Recently played' },
  skip_penalty: { ja: 'スキップ履歴', en: 'Skip history' },
  changed_penalty: { ja: '切替履歴', en: 'Switch-away history' },
  road_type: { ja: '道路の種類', en: 'Road type' },
  traffic_jam: { ja: '渋滞', en: 'Traffic jam' },
  night_state: { ja: '夜間', en: 'Night' },
  weather_risk: { ja: '天候リスク', en: 'Weather risk' },
  motion_state: { ja: '走行状態', en: 'Motion state' },
  song_arousal: { ja: '曲の高揚感', en: 'Song energy' },
  song_valence: { ja: '曲の明るさ', en: 'Song brightness' },
  song_tempo: { ja: '曲のテンポ', en: 'Song tempo' },
  song_loudness: { ja: '曲の音量感', en: 'Song loudness' },
  song_singability: { ja: '歌いやすさ', en: 'Singability' },
  song_era: { ja: '曲の年代', en: 'Song era' },
  humming_ease: { ja: 'ハミングのしやすさ', en: 'Humming ease' },
  full_karaoke_ease: { ja: 'フルカラオケ適性', en: 'Full-karaoke fit' },
}

/** An unnamed feature falls back to its raw id — a field we cannot name is
 *  still a field that contributed, and hiding it would hide evidence. */
export const fieldName = (featureId: string): BilingualLabel =>
  FIELD_NAMES[featureId] ?? { ja: featureId, en: featureId }

/** Readable names for the V1 service catalog (`service_capabilities.v1.json`). */
export const SERVICE_LABELS: Record<string, BilingualLabel> = {
  music_playlist: { ja: '音楽プレイリスト', en: 'Music playlist' },
  humming_karaoke: { ja: 'ハミングカラオケ', en: 'Humming karaoke' },
  full_karaoke: { ja: 'フルカラオケ', en: 'Full karaoke' },
  call_response_driving: { ja: 'コール&レスポンス（走行中）', en: 'Call & response (driving)' },
  call_response_stopped: { ja: 'コール&レスポンス（停車中）', en: 'Call & response (stopped)' },
  conversation_audio: { ja: '会話・音声コンテンツ', en: 'Conversation audio' },
  linked_video_recommendation: { ja: '関連動画レコメンド', en: 'Linked video recommendation' },
  live_viewing: { ja: 'ライブ視聴', en: 'Live viewing' },
  oshi_reexperience: { ja: '推し再体験', en: 'Favourite-artist re-experience' },
  quiz: { ja: 'クイズ', en: 'Quiz' },
  radio_style: { ja: 'ラジオ風', en: 'Radio style' },
  ranking_creation: { ja: 'ランキング作成', en: 'Ranking creation' },
  relaxation_multisensory: { ja: 'リラクゼーション（多感覚）', en: 'Relaxation (multisensory)' },
  stretch_video: { ja: 'ストレッチ動画', en: 'Stretch video' },
}

export const serviceLabel = (serviceId: string): BilingualLabel =>
  SERVICE_LABELS[serviceId] ?? { ja: serviceId, en: serviceId }

const BAND_LABELS: Record<string, BilingualLabel> = {
  very_high: { ja: '非常に高い', en: 'very high' },
  high: { ja: '高い', en: 'high' },
  moderate: { ja: '中程度', en: 'moderate' },
  low: { ja: '低い', en: 'low' },
  very_low: { ja: '非常に低い', en: 'very low' },
}

/**
 * The strength word for a raw value. A RECORDED band always wins — the derived
 * fallback exists only so a chain without ordinal data still reads in words,
 * and it must never override what the algorithm actually binned.
 */
export function bandWord(band: string | null, value: number): BilingualLabel {
  if (band && BAND_LABELS[band]) return BAND_LABELS[band]
  const key =
    value >= 0.8 ? 'very_high'
    : value >= 0.6 ? 'high'
    : value >= 0.4 ? 'moderate'
    : value >= 0.2 ? 'low'
    : 'very_low'
  return BAND_LABELS[key]
}
