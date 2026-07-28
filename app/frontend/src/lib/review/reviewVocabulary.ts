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

const GROUP_MEMBERS: Record<Exclude<DomainGroup, 'other'>, string[]> = {
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
  recent_play_penalty: { ja: '直近再生による減点', en: 'how recently this was played' },
  song_arousal: { ja: '曲の高揚感', en: 'how energising the song is' },
  song_valence: { ja: '曲の明るさ', en: 'how bright the song is' },
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
