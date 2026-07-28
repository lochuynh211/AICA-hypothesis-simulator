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

/** Plain phrasing. The identifier is shown separately in faint grey, never as the label. */
const PHRASES: Record<string, BilingualLabel> = {
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
  recent_play_penalty: { ja: '直近に再生したかどうか', en: 'how recently this was played' },
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
  full_karaoke_ease: { ja: 'フルカラオケ向きかどうか', en: 'how suited the song is to full karaoke' },
}

export const phrase = (featureId: string): BilingualLabel =>
  PHRASES[featureId] ?? { ja: featureId, en: featureId }

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
