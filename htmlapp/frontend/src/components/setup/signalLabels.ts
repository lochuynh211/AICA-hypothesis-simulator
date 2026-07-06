import type { BilingualLabel } from '../../i18n/t'

/**
 * signalLabels (feature 009, UX-FE3) — single localized {ja,en} label
 * registry for every signal / scenario-param / tier-3 generator-param key
 * shown on the setup screen (SignalsPanel, SignalFormulationEditor).
 *
 * Hyperparameters are NOT duplicated here: they already carry their own
 * `label: {ja,en}` on the package manifest (see each package's package.json),
 * and AlgorithmFormulationPanel reads that directly via `t(def.label, lang)`.
 * This registry exists for keys that have no manifest-carried label —
 * scenario fixed/dynamic/simulated signals and their tier-3 sub-params.
 *
 * Lookup is via `signalLabel(key, lang)`, which falls back to the raw key
 * itself if it isn't registered (defensive — never crashes, never renders
 * `undefined`), so an unregistered key degrades to today's behavior rather
 * than blowing up.
 */

export const SIGNAL_LABELS: Record<string, BilingualLabel> = {
  // ── Fixed signals ──────────────────────────────────────────────────────
  isNight: { en: 'Night', ja: '夜間' },
  is_night: { en: 'Night', ja: '夜間' },
  familiarRoute: { en: 'Familiar Route', ja: '慣れた道' },
  familiar_route: { en: 'Familiar Route', ja: '慣れた道' },
  childPassenger: { en: 'Child Passenger', ja: '子供同乗' },
  child_passenger: { en: 'Child Passenger', ja: '子供同乗' },
  weatherRisk: { en: 'Weather Risk', ja: '天候リスク' },
  weatherRiskLevel: { en: 'Weather Risk', ja: '天候リスク' },
  weather_risk: { en: 'Weather Risk', ja: '天候リスク' },
  restFacility: { en: 'Rest Facility', ja: '休憩施設' },
  restOptions: { en: 'Rest Options', ja: '休憩オプション' },

  // ── Dynamic signals ────────────────────────────────────────────────────
  segmentType: { en: 'Segment Type', ja: '区間種別' },
  motionState: { en: 'Motion State', ja: '走行状態' },
  continuousDrivingMin: { en: 'Continuous Driving (min)', ja: '連続運転時間（分）' },
  continuous_driving_min: { en: 'Continuous Driving (min)', ja: '連続運転時間（分）' },
  speedKph: { en: 'Speed (km/h)', ja: '速度（km/h）' },
  routeFraction: { en: 'Route Fraction', ja: 'ルート進捗率' },
  nextRestSpotMin: { en: 'Next Rest Spot (min)', ja: '次の休憩地点（分）' },
  isTrafficJam: { en: 'Traffic Jam', ja: '渋滞' },
  traffic_jam: { en: 'Traffic Jam', ja: '渋滞' },
  long_highway: { en: 'Long Highway', ja: '長距離高速道路' },
  recoveryPhase: { en: 'Recovery Phase', ja: '回復フェーズ' },
  segmentMotionJam: { en: 'Segment / Motion / Jam', ja: '区間・走行状態・渋滞' },

  // ── Accumulated-minutes route quantities (env_load / S_env formula terms) ─
  // Cumulative minutes spent in each condition while moving — derived from the
  // isTrafficJam / segmentType signals; shown as minutes, not bare var names.
  jam_minutes: { en: 'Traffic-Jam Minutes', ja: '渋滞時間（分）' },
  highway_minutes: { en: 'Highway Minutes', ja: '高速道路時間（分）' },
  monotonous_minutes: { en: 'Monotonous-Road Minutes', ja: '単調道路時間（分）' },

  // ── Simulated (tier 3) signals ─────────────────────────────────────────
  drowsiness: { en: 'Drowsiness', ja: '眠気' },
  fatigue: { en: 'Fatigue', ja: '疲労' },
  anomaly_rate: { en: 'Anomaly Rate', ja: '異常発生率' },

  // ── Tier-3 drowsiness/fatigue growth sub-params ────────────────────────
  base_growth_per_min: { en: 'Base Growth (per min)', ja: '基本上昇（分あたり）' },
  night_add_per_min: { en: 'Night Add-on (per min)', ja: '夜間加算（分あたり）' },
  monotony_add_per_min: { en: 'Monotony Add-on (per min)', ja: '単調道路加算（分あたり）' },
  traffic_jam_add_per_min: { en: 'Traffic Jam Add-on (per min)', ja: '渋滞加算（分あたり）' },
  continuous_driving_add_per_min_after_60_min: {
    en: 'Continuous Driving Add-on (>60min, per min)',
    ja: '継続運転加算（60分超・分あたり）',
  },
  mountain_road_add_per_min: { en: 'Mountain Road Add-on (per min)', ja: '山道加算（分あたり）' },

  // ── Rest activities (recovery keyed by a recovery-option stage content) ─
  sleep: { en: 'Sleep / nap', ja: '睡眠・仮眠' },
  audio_karaoke: { en: 'Karaoke (audio)', ja: 'カラオケ（音声）' },
  video_karaoke: { en: 'Karaoke (video)', ja: 'カラオケ（映像）' },
  karaoke: { en: 'Karaoke', ja: 'カラオケ' },
  stretch: { en: 'Stretch', ja: 'ストレッチ' },

  // ── Speed profile (kph by road-segment type) ───────────────────────────
  speed_profile: { en: 'Speed (km/h by road type)', ja: '速度（道路種別ごと・km/h）' },
  normal_road_kph: { en: 'Urban road', ja: '一般道' },
  highway_kph: { en: 'Highway', ja: '高速道路' },
  mountain_road_kph: { en: 'Mountain road', ja: '山道' },
  sightseeing_road_kph: { en: 'Sightseeing road', ja: '観光道路' },
  traffic_jam_kph: { en: 'Traffic jam', ja: '渋滞' },

  // ── Tier-3 anomaly generator params ────────────────────────────────────
  lambda_base: { en: 'Base Event Rate', ja: '基本発生率' },
  lambda_gain: { en: 'Anomaly Gain', ja: '異常上昇係数' },
  theta: { en: 'Drowsiness Threshold (θ)', ja: '眠気しきい値（θ）' },
  window_min: { en: 'Window (min)', ja: '集計ウィンドウ（分）' },
}

/**
 * FEATURE_LABELS — localized {ja,en} names for the *computed* quantities in a
 * package formulation (features and composite scores), as opposed to the raw
 * signals in SIGNAL_LABELS. Used by AlgorithmFormulationPanel so every formula
 * term renders as text in both languages instead of a bare variable name.
 */
export const FEATURE_LABELS: Record<string, BilingualLabel> = {
  // Hybrid features
  driving_anomaly: { en: 'Driving Anomaly', ja: '運転異常度' },
  driving_time: { en: 'Time-on-Task', ja: '連続運転度' },
  env_load: { en: 'Environmental Load', ja: '環境負荷' },
  monotony: { en: 'Monotony', ja: '単調度' },
  rest_window: { en: 'Rest Window', ja: '休憩タイミング' },
  rest_scarcity: { en: 'Rest Scarcity', ja: '休憩の希少性' },
  // Hybrid composite scores
  base_safety_risk: { en: 'Base Safety Risk', ja: '基礎安全リスク' },
  rest_required_score: { en: 'Rest-Required Score', ja: '休憩必要度' },
  monotony_prevention_score: { en: 'Monotony-Prevention Score', ja: '単調性抑止度' },
  // NRI composite scores
  S_base: { en: 'Base Score', ja: '基礎スコア' },
  S_env: { en: 'Environment Score', ja: '環境スコア' },
  S_realtime: { en: 'Realtime Score', ja: 'リアルタイムスコア' },
  S_total: { en: 'Total Score', ja: '合計スコア' },
}

/**
 * Output-line label overrides: where a feature's LHS name must differ from the
 * underlying signal it normalizes — the 0-1 feature vs the 0-100 raw signal.
 */
export const FEATURE_OUTPUT_LABELS: Record<string, BilingualLabel> = {
  drowsiness: { en: 'Normalized Drowsiness', ja: '正規化した眠気' },
  fatigue: { en: 'Normalized Fatigue', ja: '正規化した疲労' },
}

/** Resolve a signal/param key to its localized label, falling back to the raw key. */
export function signalLabel(key: string, lang: 'ja' | 'en'): string {
  const entry = SIGNAL_LABELS[key]
  if (!entry) return key
  return entry[lang] || entry[lang === 'ja' ? 'en' : 'ja'] || key
}

/**
 * Label for a formula *token* (a feature/signal reference). Raw signals win
 * (so `drowsiness` shows "Drowsiness", not the feature label), then computed
 * features, then the raw key.
 */
export function formulaTokenLabel(key: string, lang: 'ja' | 'en'): string {
  const entry = SIGNAL_LABELS[key] ?? FEATURE_LABELS[key]
  if (!entry) return key
  return entry[lang] || entry[lang === 'ja' ? 'en' : 'ja'] || key
}

/**
 * Label for a formula *output* (the LHS name). Output overrides win (normalized
 * feature names), then computed-feature labels, then signals, then the raw key.
 */
export function formulaOutputLabel(key: string, lang: 'ja' | 'en'): string {
  const entry = FEATURE_OUTPUT_LABELS[key] ?? FEATURE_LABELS[key] ?? SIGNAL_LABELS[key]
  if (!entry) return key
  return entry[lang] || entry[lang === 'ja' ? 'en' : 'ja'] || key
}
