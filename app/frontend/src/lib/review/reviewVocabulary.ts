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
 * and is shown as explicitly unnamed, so a new feature shows up as unlabelled
 * rather than as quietly mislabelled.
 *
 * It is also never shown as its RAW IDENTIFIER. A reviewer reads product
 * vocabulary, never a variable name, so the fallbacks below say "this field has
 * no registered name" in words. The identifier is still reachable — every row
 * carries it in `data-testid` — it just does not reach the screen.
 */

export type BilingualLabel = { ja: string; en: string }

/**
 * What an id with no registered name renders as. One constant per kind, so the
 * three fallbacks below can never drift into three different phrasings.
 */
const UNNAMED_FEATURE: BilingualLabel = { ja: '名称未登録の特徴量', en: 'Unnamed feature' }
const UNNAMED_FIELD: BilingualLabel = { ja: '名称未登録の項目', en: 'Unnamed field' }
const UNNAMED_SERVICE: BilingualLabel = { ja: '名称未登録のサービス', en: 'Unnamed service' }

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
 * The two V1 reviewable checkpoint categories, labelled with the
 * specification's own 提案分類 wording (CDC-SU_specplan Slide 35): the rest
 * category is proposal class ①「危険運転防止向け提案」and the monotony category
 * is class ②「漫然運転予防・疲労回復向け提案」. The label states the PURPOSE
 * the spec assigns the category, not a paraphrase of the identifier.
 *
 * Single source of truth for BOTH `chains.ts` (comparable trigger options)
 * and `checkpoints.ts` (the derived rail) — this table used to be declared
 * byte-identically in both files, and this branch already had one incident
 * from exactly that copy-paste pattern. Loosely typed (`Record<string, ...>`)
 * rather than keyed on `ReviewableCategory` to avoid a circular import with
 * `checkpoints.ts`, which already imports `BilingualLabel` from here.
 */
export const CATEGORY_LABELS: Record<string, BilingualLabel> = {
  rest_required: {
    ja: '危険運転防止のため休憩推奨',
    en: 'Rest recommended to prevent dangerous driving',
  },
  monotony_prevention: {
    ja: '漫然運転予防のためサービス提案',
    en: 'Service proposed to prevent inattentive driving',
  },
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
  full_karaoke_ease: { ja: 'カラオケ（フル）への向き', en: 'how suited the song is to full karaoke' },
}

export const phrase = (featureId: string): BilingualLabel =>
  PHRASES[featureId] ?? UNNAMED_FEATURE

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
  full_karaoke_ease: { ja: 'カラオケ（フル）適性', en: 'Full-karaoke fit' },

  // ── Case fixed-override keys (`CaseFixedOverrides`, ExperienceCaseCard) ──
  //
  // Not evidence feature ids — these are the committed test cases' own
  // pinned-condition fields (`journey.fixed_overrides`). Named here too, in
  // the same table, so "conditions this case fixes" never falls back to an
  // unnamed field for a key every committed case actually uses. JA wording
  // matches the case narratives themselves (山道区間 / 渋滞区間 already appear
  // in case-c04 / case-c05's own narrative text).
  initial_drowsiness: { ja: '初期眠気', en: 'Initial drowsiness' },
  initial_fatigue: { ja: '初期疲労度', en: 'Initial fatigue' },
  is_night: { ja: '夜間', en: 'Night' },
  mountain_range_km: { ja: '山道区間', en: 'Mountain-road section' },
  jam_range_km: { ja: '渋滞区間', en: 'Traffic-jam section' },

  // ── Service/content-selector feature ids ─────────────────────────────────
  //
  // The proposal side reports its own identifiers, in three overlapping
  // namespaces (the service selector's `*_level`/`*_state` ids, the content
  // selector's short leaf ids, and the content selector's full ids). They are
  // listed HERE, in the same table as the trigger-side ids, because a feature
  // that appears on both sides must read the same on both — `眠気` in the
  // firing evidence and `眠気` in the service evidence, never `眠気` and
  // `drowsiness_level` side by side. The backend keeps a mirror of this table
  // for its explanation prompts (`services/explanation_builder.py`); the two
  // are the same vocabulary and must be changed together.
  drowsiness_level: { ja: '眠気', en: 'Drowsiness' },
  fatigue_level: { ja: '疲労度', en: 'Fatigue' },
  monotony_level: { ja: '道路の単調さ', en: 'Monotony' },
  traffic_state: { ja: '渋滞', en: 'Traffic' },
  route_tags: { ja: 'ルートの特性', en: 'Route characteristics' },
  destination_tags: { ja: '目的地の特性', en: 'Destination characteristics' },
  child_present: { ja: '子供の同乗', en: 'Child aboard' },
  multiple_passengers: { ja: '複数人の同乗', en: 'Multiple passengers' },
  oshi_registered: { ja: '推しの登録', en: 'Favourite artist registered' },
  oshi_id: { ja: '推しとの一致', en: 'Favourite-artist match' },
  oshi_tags: { ja: '推しタグとの一致', en: 'Favourite-artist tag match' },
  oshi_type: { ja: '推しの種別', en: 'Favourite-artist type' },
  age_band: { ja: '年代', en: 'Age band' },
  gender: { ja: '性別', en: 'Gender' },
  hobby_interest_tags: { ja: '趣味・関心', en: 'Hobbies and interests' },
  service_usage_level: { ja: 'サービスの利用頻度', en: 'Service usage' },
  service_recency_state: { ja: 'サービスの未利用期間', en: 'Time since the service was used' },
  scene_service_usage_level: { ja: '場面別のサービス利用', en: 'Scene-specific service usage' },
  service_proposal_acceptance_rate: { ja: '提案受諾率', en: 'Proposal acceptance rate' },
  service_recovery_rate: { ja: '回復率', en: 'Recovery rate' },
  catalog_item_usage_level: { ja: 'この曲の利用頻度', en: 'How often this song is played' },
  catalog_item_recency_state: { ja: 'この曲の未再生期間', en: 'Time since this song was played' },
  content_tag_usage_level: { ja: 'ジャンルの利用頻度', en: 'Genre play frequency' },
  content_tag_recency_state: { ja: 'ジャンルの未再生期間', en: 'Time since the genre was played' },
  scene_content_tag_usage_level: { ja: '場面別のジャンル利用', en: 'Scene-specific genre usage' },
  usage_by_genre: { ja: 'ジャンル別の利用', en: 'Usage by genre' },
  scene_genre_usage: { ja: '場面別のジャンル利用', en: 'Scene-specific genre usage' },
  content_proposal_acceptance_rate: { ja: '曲提案の受諾率', en: 'Song-proposal acceptance rate' },
  content_recovery_rate: { ja: '曲による回復率', en: 'Recovery rate from this song' },
  played_items: { ja: '再生履歴', en: 'Play history' },
  skipped_items: { ja: 'スキップ履歴', en: 'Skip history' },
  changed_from_items: { ja: '切替履歴', en: 'Switch-away history' },
  repeated_items: { ja: '繰り返し再生', en: 'Repeated plays' },
  completed_items: { ja: '最後まで再生', en: 'Played to completion' },
  cancelled_content_plans: { ja: '取り消し履歴', en: 'Cancelled plans' },
  manually_selected_items: { ja: '手動選択', en: 'Manually chosen' },

  // ── Trait-composition matrix (content package `trait_composition_matrix`) ──
  //
  // That hyperparameter builds four composite song traits out of the raw audio
  // features of the catalog. Its ROW and COLUMN keys are rendered directly by
  // the generic matrix editor in the content setup popup, so they need names
  // like anything else — without them the whole table reads as "Unnamed field".
  // `*_inv` columns are inverted features (1 − x), so they are named for what
  // the inverted value actually measures, not for the feature it came from.
  arousal: { ja: '高揚感', en: 'Arousal' },
  valence: { ja: '曲の明るさ', en: 'Brightness' },
  energy: { ja: 'エネルギー感', en: 'Energy' },
  norm_loudness: { ja: '音量感', en: 'Loudness' },
  norm_tempo: { ja: 'テンポ', en: 'Tempo' },
  danceability: { ja: 'ノリのよさ', en: 'Danceability' },
  acousticness_inv: { ja: '非アコースティック度', en: 'Non-acoustic character' },
  mode: { ja: '長調・短調', en: 'Major or minor key' },
  instrumentalness_inv: { ja: 'ボーカルの多さ', en: 'Vocal presence' },
  speech_ease: { ja: '歌詞の歌いやすさ', en: 'Ease of singing the words' },
  tempo_ease: { ja: 'テンポの歌いやすさ', en: 'Tempo singability' },
  duration_ease: { ja: '曲の長さの手ごろさ', en: 'Duration suitability' },

  // Content-selector SHORT leaf ids (same features, abbreviated namespace).
  traffic: { ja: '渋滞', en: 'Traffic' },
  road: { ja: '道路の種類', en: 'Road type' },
  night: { ja: '夜間', en: 'Night' },
  motion: { ja: '走行状態', en: 'Motion state' },
  service_ease: { ja: '歌いやすさ', en: 'Singability' },
  oshi: { ja: '推しとの一致', en: 'Favourite-artist match' },
  age: { ja: '年代の合致', en: 'Era fit' },
  item_usage: { ja: '利用頻度', en: 'Usage' },
  played: { ja: '再生履歴', en: 'Play history' },
  skipped: { ja: 'スキップ履歴', en: 'Skip history' },
  changed: { ja: '切替履歴', en: 'Switch-away history' },
  acceptance: { ja: '受諾率', en: 'Acceptance rate' },
  recovery: { ja: '回復率', en: 'Recovery rate' },
  route: { ja: 'ルートの合致', en: 'Route fit' },
  destination: { ja: '目的地の合致', en: 'Destination fit' },
  child: { ja: '子供向け', en: 'Child-friendly' },
  hobbies: { ja: '趣味の合致', en: 'Hobby fit' },
  genre_usage: { ja: 'ジャンルの利用', en: 'Genre usage' },
  scene_genre: { ja: '場面別のジャンル', en: 'Scene genre' },
  multiple: { ja: '複数人の同乗', en: 'Multiple passengers' },
  cancelled: { ja: '取り消し履歴', en: 'Cancellation history' },
  item_recency: { ja: 'この曲の未再生期間', en: 'Time since this song was played' },
  tag_recency: { ja: 'ジャンルの未再生期間', en: 'Time since the genre was played' },
  schedule: { ja: '直近の予定', en: 'Upcoming schedule' },

  // ── Content selector: `context_response_matrix` rows ──────────────────────
  // Each row is a CONTEXT CONDITION, not a feature: the matrix says how a
  // song's traits should respond when that condition holds. Named for the
  // condition, so a row reads as the situation it describes.
  traffic_congested: { ja: '渋滞している', en: 'Traffic is congested' },
  motion_driving: { ja: '走行中である', en: 'The car is moving' },
  highway: { ja: '高速道路', en: 'Highway' },
  local: { ja: '一般道', en: 'Local road' },
  mountain: { ja: '山道', en: 'Mountain road' },
  parking: { ja: '駐車場', en: 'Parking' },

  // The two coefficients of the context response: a song's response is
  // `alpha × 高揚感 + beta × 明るさ`, and `directional` flips alpha's sign when
  // the run is set to keep the driver alert rather than settle them
  // (algorithm.py `_mood`).
  alpha: { ja: '高揚感の係数', en: 'Arousal coefficient' },
  beta: { ja: '明るさの係数', en: 'Brightness coefficient' },
  directional: { ja: '覚醒重視で符号を反転', en: 'Flip sign when keeping alert' },

  // ── Content selector: `age_era_affinity` ─────────────────────────────────
  // Rows are the driver's age band, columns are the song's era. Same wording as
  // the `age_band` entries in OPTION_LABELS — one band, one name, wherever it
  // appears.
  teens: { ja: '10代', en: 'Teens' },
  '20s': { ja: '20代', en: '20s' },
  '30s': { ja: '30代', en: '30s' },
  '40s': { ja: '40代', en: '40s' },
  '50s': { ja: '50代', en: '50s' },
  '60plus': { ja: '60代以上', en: '60 and over' },

  pre1980: { ja: '1970年代以前', en: 'Pre-1980s' },
  '1980s': { ja: '1980年代', en: '1980s' },
  '1990s': { ja: '1990年代', en: '1990s' },
  '2000s': { ja: '2000年代', en: '2000s' },
  '2010s': { ja: '2010年代', en: '2010s' },
  '2020s': { ja: '2020年代', en: '2020s' },

  // ── Content selector: `norm_bounds` ───────────────────────────────────────
  // The raw-audio normalisation constants. Each names the quantity it bounds,
  // in words — `tempo_ease_center` is the tempo that is EASIEST to sing to,
  // and `*_span` is how far either side of it still counts as easy.
  loudness_min: { ja: '音量の下限', en: 'Loudness floor' },
  loudness_range: { ja: '音量の幅', en: 'Loudness range' },
  tempo_min: { ja: 'テンポの下限', en: 'Tempo floor' },
  tempo_range: { ja: 'テンポの幅', en: 'Tempo range' },
  tempo_ease_center: { ja: '最も歌いやすいテンポ', en: 'Easiest tempo to sing to' },
  tempo_ease_span: { ja: '歌いやすいテンポの許容幅', en: 'Tolerance around the easiest tempo' },
  speech_ease_threshold: { ja: '語り成分の許容上限', en: 'Spoken-word tolerance limit' },
  speech_ease_span: { ja: '語り成分の許容幅', en: 'Spoken-word tolerance range' },
  duration_ease_center: { ja: '最も適した曲の長さ', en: 'Most suitable song length' },
  duration_ease_span: { ja: '曲の長さの許容幅', en: 'Tolerance around that length' },

  // ── Content selector: `history_curves` ────────────────────────────────────
  changed_in_window: { ja: '直近に切り替えられた', en: 'Switched away from recently' },
  skipped_older: { ja: '以前にスキップされた', en: 'Skipped some time ago' },
  rate_scale: { ja: '比率の基準値', en: 'Rate scale' },
  le_30m: { ja: '30分以内', en: 'Within 30 minutes' },
  today: { ja: '当日中', en: 'Earlier today' },
  le_7d: { ja: '7日以内', en: 'Within 7 days' },
  else: { ja: 'それ以前', en: 'Longer ago' },

  // ── Content selector: `lighting_lookup` ───────────────────────────────────
  cue_basis: { ja: 'ライティングの判断基準', en: 'Lighting cue basis' },
  high_threshold: { ja: '強い演出のしきい値', en: 'Strong-cue threshold' },
  low_threshold: { ja: '弱い演出のしきい値', en: 'Soft-cue threshold' },
  high_cue: { ja: '強いときの演出', en: 'Strong cue' },
  mid_cue: { ja: '中程度のときの演出', en: 'Medium cue' },
  low_cue: { ja: '弱いときの演出', en: 'Soft cue' },

  // ── Content selector: `genre_affinity_maps` ───────────────────────────────
  // Top-level groups, then the route / destination / hobby keys that sit under
  // them. The route and destination names deliberately repeat the wording of
  // the matching `OPTION_LABELS` entries: the same tag must read the same
  // whether it is a value in a dropdown or a row in this map.
  hobby: { ja: '趣味', en: 'Hobby' },
  usage_curve: { ja: '利用頻度による重み', en: 'Weighting by usage' },
  vocabulary: { ja: '対象ジャンル一覧', en: 'Genre vocabulary' },
  coastal: { ja: '海沿い', en: 'Coastal' },
  urban: { ja: '都市部', en: 'Urban' },
  rural: { ja: '郊外', en: 'Rural' },
  scenic_byway: { ja: '景観ルート', en: 'Scenic byway' },
  coast: { ja: '海', en: 'Coast' },
  resort: { ja: 'リゾート', en: 'Resort' },
  nature: { ja: '自然', en: 'Nature' },
  event: { ja: 'イベント', en: 'Event' },
  oshi_venue: { ja: '推し関連スポット', en: 'Favourite-artist venue' },
  event_hall: { ja: 'イベント会場', en: 'Event hall' },
  home: { ja: '自宅', en: 'Home' },
  shopping: { ja: '買い物', en: 'Shopping' },
  'anime-fan': { ja: 'アニメ好き', en: 'Anime fan' },
  fitness: { ja: '運動・フィットネス', en: 'Fitness' },
  wellness: { ja: '健康・リラックス', en: 'Wellness' },
  'idol/live': { ja: 'アイドル・ライブ', en: 'Idols and live shows' },
  tradition: { ja: '伝統文化', en: 'Traditional culture' },

  // Ordinal usage bands, as they appear as KEYS of a weighting curve rather
  // than as a field's value. Same wording as the `OPTION_LABELS` usage bands.
  never: { ja: '未利用', en: 'Never used' },
  low: { ja: '低い', en: 'Low' },
  med: { ja: '中程度', en: 'Medium' },
  high: { ja: '高い', en: 'High' },
}

/** An unnamed feature is still SHOWN — a field we cannot name is still a field
 *  that contributed, and hiding the row would hide evidence — but it is shown
 *  as explicitly unnamed rather than as its raw identifier. */
export const fieldName = (featureId: string): BilingualLabel =>
  FIELD_NAMES[featureId] ?? UNNAMED_FIELD

/**
 * Readable names for the V1 service catalog (`service_capabilities.v1.json`).
 *
 * The Japanese column is the SPECIFICATION's own content name — Slides 26, 38,
 * 39, 40 and 70 of CDC-SU_specplan — not a translation of the identifier. The
 * English column is the equivalent of that Japanese name, so a reviewer reading
 * either language is reading the same catalog entry.
 */
export const SERVICE_LABELS: Record<string, BilingualLabel> = {
  music_playlist: { ja: 'プレイリスト再生', en: 'Playlist playback' },
  humming_karaoke: { ja: '鼻歌カラオケ', en: 'Humming karaoke' },
  // Slide 26 writes the two karaoke entries as カラオケ（鼻歌）/ カラオケ（フル）;
  // the parenthesised form is kept for the full one so a ranked list showing
  // both never reads as two unrelated services.
  full_karaoke: { ja: 'カラオケ（フル）', en: 'Karaoke (full)' },
  call_response_driving: { ja: '合いの手練習（走行中）', en: 'Call-and-response practice (driving)' },
  call_response_stopped: { ja: '合いの手練習（停車中）', en: 'Call-and-response practice (stopped)' },
  conversation_audio: { ja: 'おしゃべり', en: 'Chat' },
  linked_video_recommendation: { ja: '動画レコメンド', en: 'Video recommendation' },
  live_viewing: { ja: 'ライブビューイング', en: 'Live viewing' },
  oshi_reexperience: { ja: '推し追体験', en: 'Favourite-artist re-experience' },
  quiz: { ja: 'クイズ', en: 'Quiz' },
  radio_style: { ja: 'ラジオ風再生', en: 'Radio-style playback' },
  ranking_creation: { ja: 'ランキング作成', en: 'Ranking creation' },
  relaxation_multisensory: { ja: 'リラックス（多感覚連携）', en: 'Relaxation (multisensory)' },
  stretch_video: { ja: 'ストレッチ動画', en: 'Stretch video' },
}

export const serviceLabel = (serviceId: string): BilingualLabel =>
  SERVICE_LABELS[serviceId] ?? UNNAMED_SERVICE

/** Whether `serviceLabel` would return a real catalog name rather than the
 *  "unnamed" fallback — so a caller can tell a genuine service from an id it
 *  does not recognise without string-matching the fallback text. */
export const isKnownService = (serviceId: string): boolean =>
  Object.prototype.hasOwnProperty.call(SERVICE_LABELS, serviceId)

/**
 * Readable names for the driver-profile genre-affinity vocabulary
 * (`GENRE_VOCABULARY` in `api/proposalClient.ts`). The genre-affinity editors
 * used to print these raw lowercase catalogue literals ('city pop', "children's
 * music", ...) verbatim, in both languages.
 */
const UNNAMED_GENRE: BilingualLabel = { ja: '名称未登録のジャンル', en: 'Unnamed genre' }

export const GENRE_LABELS: Record<string, BilingualLabel> = {
  'j-pop': { ja: 'J-POP', en: 'J-Pop' },
  'j-rock': { ja: 'J-ROCK', en: 'J-Rock' },
  'city pop': { ja: 'シティポップ', en: 'City Pop' },
  anime: { ja: 'アニメ', en: 'Anime' },
  vocaloid: { ja: 'ボーカロイド', en: 'Vocaloid' },
  enka: { ja: '演歌', en: 'Enka' },
  "children's music": { ja: '童謡・キッズソング', en: "Children's Music" },
  classical: { ja: 'クラシック', en: 'Classical' },
  jazz: { ja: 'ジャズ', en: 'Jazz' },
  ambient: { ja: 'アンビエント', en: 'Ambient' },
  electronic: { ja: 'エレクトロニック', en: 'Electronic' },
  'japanese folk': { ja: '邦楽フォーク', en: 'Japanese Folk' },
}

export const genreLabel = (genre: string): BilingualLabel => GENRE_LABELS[genre] ?? UNNAMED_GENRE

/**
 * The four 提案分類 of CDC-SU_specplan Slide 35, keyed by the `trigger_purpose`
 * the backend records. Each label states the PURPOSE the specification assigns
 * the class, which is what a reviewer needs to judge the decision — the bare
 * word「休憩推奨」does not say why a rest is being recommended.
 *
 * The two categories the V1 review rail can select (`rest_required` /
 * `monotony_prevention`, in `CATEGORY_LABELS`) are the same two classes ① and
 * ② seen from the firing side, and are worded identically on purpose.
 */
export const PURPOSE_LABELS: Record<string, BilingualLabel> = {
  rest_recommended: {
    ja: '危険運転防止のため休憩推奨',
    en: 'Rest recommended to prevent dangerous driving',
  },
  inattentive_driving_prevention_recovery: {
    ja: '漫然運転予防のためサービス提案',
    en: 'Service proposed to prevent inattentive driving',
  },
  route_music: { ja: 'ルートに応じた音楽提案', en: 'Route-matched music proposal' },
  child_passenger_experience: {
    ja: '子供同乗時向け提案',
    en: 'Proposal for driving with a child aboard',
  },
}

const UNNAMED_PURPOSE: BilingualLabel = { ja: '名称未登録の提案分類', en: 'Unnamed proposal category' }

export const purposeLabel = (purposeId: string): BilingualLabel =>
  PURPOSE_LABELS[purposeId] ?? UNNAMED_PURPOSE

/**
 * The three judgement axes the content/service selectors weight by, and the
 * sub-nodes underneath them. The packages key these with capitalised English
 * JSON keys (`Situation` / `Preference` / `History`), which used to be printed
 * to the screen verbatim — an English word in a Japanese panel, and an
 * identifier either way. Slide 66–70 name the same three axes 状況 / 好み /
 * 過去実績.
 */
export const NODE_LABELS: Record<string, BilingualLabel> = {
  Situation: { ja: '状況', en: 'Situation' },
  Preference: { ja: '好み', en: 'Preference' },
  History: { ja: '過去実績', en: 'Past results' },
  driver_state: { ja: '現在のドライバー状態', en: 'Driver state' },
  environment: { ja: '走行環境', en: 'Driving environment' },
  // `driving_environment` is the literal `hierarchy_weights` / `purpose_multipliers`
  // subgroup key both real manifests use (aica_transparent_service_selector_v1 and
  // aica_transparent_content_selector_v1 package.json) — same concept as `environment`
  // above, just the longer key name the packages actually ship. Missing this entry
  // left the "Weights" editor's real Purpose Multipliers / Hierarchy Weights tables
  // showing "Unnamed field"/"Unnamed group" for this row in both packages.
  driving_environment: { ja: '走行環境', en: 'Driving environment' },
  route: { ja: 'ルートの特性', en: 'Route characteristics' },
  passengers: { ja: '同乗者構成', en: 'Passengers' },
  upro_oshi: { ja: '推し活の嗜好', en: 'Favourite-artist preference' },
  usage: { ja: '利用状況', en: 'Usage' },
  outcomes: { ja: '提案の結果', en: 'Proposal outcomes' },

  // ── The remaining subgroup keys the two real manifests actually ship ──────
  //
  // Every one of these is a row in the "Hierarchy weights" / "Purpose
  // multipliers" tables inside the service- and content-package setup popups.
  // They are grouped here in the order the spec's judgement axes run (Slide
  // 66–70: 状況 → 好み → 過去実績) so the table reads as the spec's own model
  // of how a proposal is weighted.
  //
  // 状況 (Situation)
  route_context: { ja: 'ルートの状況', en: 'Route context' },
  route_destination: { ja: 'ルートと目的地', en: 'Route and destination' },
  passenger_composition: { ja: '同乗者構成', en: 'Passenger composition' },
  driving_state: { ja: '走行状態', en: 'Driving state' },
  song_singability: { ja: '曲の歌いやすさ', en: 'Song singability' },
  // 好み (Preference)
  oshi_preference: { ja: '推し活の嗜好', en: 'Favourite-artist preference' },
  novelty: { ja: '目新しさ', en: 'Novelty' },
  overall_usage: { ja: '全体の利用頻度', en: 'Overall usage' },
  scene_preference: { ja: '場面別の好み', en: 'Scene-specific preference' },
  operations: { ja: 'ユーザー操作の履歴', en: 'User-operation history' },
  // 過去実績 (Past results)
  proposal_acceptance: { ja: '提案の受諾実績', en: 'Proposal acceptance' },
  content_acceptance: { ja: 'コンテンツの受諾実績', en: 'Content acceptance' },
  recovery: { ja: '回復の実績', en: 'Recovery outcomes' },
  content_recovery: { ja: 'コンテンツによる回復実績', en: 'Recovery from content' },
}

const UNNAMED_NODE: BilingualLabel = { ja: '名称未登録の区分', en: 'Unnamed group' }

/** A weight-tree node name. Falls back to the feature table first, because the
 *  leaves of these trees ARE feature ids. */
export const nodeLabel = (key: string): BilingualLabel =>
  NODE_LABELS[key] ?? FIELD_NAMES[key] ?? UNNAMED_NODE

/**
 * Categorical field VALUES, in words.
 *
 * The setup popups used to render these enum members raw — `congested`,
 * `scenic_byway`, `60plus`, `long_unused`, `true` — as dropdown options and as
 * recorded values in the evidence tables. They are identifiers, and half of
 * them are English words sitting in a Japanese panel.
 *
 * Keyed by FIELD first because the same token means different things in
 * different fields (`highway` is a road type and also a route tag; `never`
 * means "never used" for usage and "never played" for recency).
 */
export const OPTION_LABELS: Record<string, Record<string, BilingualLabel>> = {
  traffic_state: {
    normal: { ja: '通常', en: 'Normal' },
    congested: { ja: '渋滞', en: 'Congested' },
  },
  road_type: {
    highway: { ja: '高速道路', en: 'Highway' },
    local: { ja: '一般道', en: 'Local road' },
    normal_road: { ja: '一般道', en: 'Local road' },
    mountain: { ja: '山道', en: 'Mountain road' },
    mountain_road: { ja: '山道', en: 'Mountain road' },
    sightseeing_road: { ja: '観光道路', en: 'Scenic road' },
    parking: { ja: '駐車場', en: 'Parking' },
  },
  night_state: {
    night: { ja: '夜間', en: 'Night' },
    day: { ja: '昼間', en: 'Daytime' },
  },
  route_tags: {
    highway: { ja: '高速道路', en: 'Highway' },
    mountain: { ja: '山道', en: 'Mountain' },
    coastal: { ja: '海沿い', en: 'Coastal' },
    urban: { ja: '都市部', en: 'Urban' },
    scenic_byway: { ja: '景観ルート', en: 'Scenic byway' },
    rural: { ja: '郊外', en: 'Rural' },
  },
  destination_tags: {
    coast: { ja: '海', en: 'Coast' },
    resort: { ja: 'リゾート', en: 'Resort' },
    nature: { ja: '自然', en: 'Nature' },
    event: { ja: 'イベント', en: 'Event' },
    oshi_venue: { ja: '推し関連スポット', en: 'Favourite-artist venue' },
    event_hall: { ja: 'イベント会場', en: 'Event hall' },
    home: { ja: '自宅', en: 'Home' },
    shopping: { ja: '買い物', en: 'Shopping' },
  },
  oshi_mode: {
    on: { ja: 'オン', en: 'On' },
    off: { ja: 'オフ', en: 'Off' },
  },
  age_band: {
    teens: { ja: '10代', en: 'Teens' },
    '20s': { ja: '20代', en: '20s' },
    '30s': { ja: '30代', en: '30s' },
    '40s': { ja: '40代', en: '40s' },
    '50s': { ja: '50代', en: '50s' },
    '60plus': { ja: '60代以上', en: '60 and over' },
  },
  motion_state: {
    // The wire enum is `driving` / `stopped` (models/proposal/enums.py
    // MotionState). The other spellings are older//trigger-side tokens kept so
    // a value from either side still resolves.
    driving: { ja: '走行中', en: 'In motion' },
    in_motion: { ja: '走行中', en: 'In motion' },
    moving: { ja: '走行中', en: 'In motion' },
    stopped: { ja: '停車中', en: 'Stopped' },
    parked: { ja: '駐車中', en: 'Parked' },
    idle: { ja: 'アイドリング', en: 'Idling' },
  },
  // The Combined screen's rest-journey stage — shown in the read-only status
  // strip and the map/playback surfaces that report where the driver is in the
  // rest journey.
  lifecycle_stage: {
    before_rest_until_stop: { ja: '休憩場所へ向かう', en: 'Heading to the rest location' },
    during_rest_stopped: { ja: '休憩場所で停車中', en: 'Stopped at the rest location' },
    after_rest_before_restart: { ja: '休憩後・走行再開前', en: 'After the rest, before restarting' },
    active_driving_content: { ja: '走行中', en: 'Driving' },
  },
  // The content selector's `directional_hypothesis` hyperparameter (§5.6):
  // whether content should calm the driver down or keep them alert. Keyed by
  // the hyperparameter's OWN key (per this table's "keyed by field first"
  // convention) since these two enum values mean nothing outside that one
  // control's dropdown.
  directional_hypothesis: {
    soothe_destress: { ja: '沈静・ストレス緩和', en: 'Soothe & de-stress' },
    keep_alert: { ja: '覚醒維持', en: 'Keep alert' },
  },
}

/** Shared value vocabularies used by several fields at once. */
const USAGE_LEVEL_LABELS: Record<string, BilingualLabel> = {
  never: { ja: '未利用', en: 'Never used' },
  low: { ja: '低い', en: 'Low' },
  med: { ja: '中程度', en: 'Medium' },
  high: { ja: '高い', en: 'High' },
}

const RECENCY_LABELS: Record<string, BilingualLabel> = {
  never: { ja: '未利用', en: 'Never used' },
  long_unused: { ja: '長期間未利用', en: 'Long unused' },
  recent: { ja: '最近利用', en: 'Recently used' },
}

for (const key of ['service_usage_level', 'scene_service_usage_level', 'catalog_item_usage_level',
  'content_tag_usage_level', 'scene_content_tag_usage_level', 'usage_by_genre', 'scene_genre_usage']) {
  OPTION_LABELS[key] = USAGE_LEVEL_LABELS
}
for (const key of ['service_recency_state', 'catalog_item_recency_state', 'content_tag_recency_state']) {
  OPTION_LABELS[key] = RECENCY_LABELS
}

const YES: BilingualLabel = { ja: 'あり', en: 'Yes' }
const NO: BilingualLabel = { ja: 'なし', en: 'No' }

/** `true`/`false` as words. Booleans reach the screen from case overrides and
 *  from boolean world fields, where `true` is not an answer a reviewer reads. */
export const booleanLabel = (value: boolean): BilingualLabel => (value ? YES : NO)

/**
 * A categorical value in words, for `fieldKey`.
 *
 * Falls back to the shared usage/recency vocabularies, then to the value's own
 * meaning if one is registered under any field, and finally — for a genuinely
 * unknown token — to a statement that it is unrecognised. The raw token is
 * never returned, so a new enum member shows up as unlabelled rather than as an
 * identifier on screen.
 */
const UNNAMED_VALUE: BilingualLabel = { ja: '未登録の値', en: 'Unrecognised value' }

export function optionLabel(fieldKey: string, value: string | boolean): BilingualLabel {
  if (typeof value === 'boolean') return booleanLabel(value)
  if (value === 'true') return YES
  if (value === 'false') return NO
  return OPTION_LABELS[fieldKey]?.[value] ?? UNNAMED_VALUE
}

/** True when `optionLabel` can name this value — lets a caller keep a value it
 *  cannot name out of a dropdown rather than offering "未登録の値". */
export const isKnownOption = (fieldKey: string, value: string): boolean =>
  value === 'true' || value === 'false' || OPTION_LABELS[fieldKey]?.[value] !== undefined

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
