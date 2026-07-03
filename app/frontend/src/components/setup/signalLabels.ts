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

  // ── Tier-3 anomaly generator params ────────────────────────────────────
  lambda_base: { en: 'Base Event Rate', ja: '基本発生率' },
  lambda_gain: { en: 'Anomaly Gain', ja: '異常上昇係数' },
  theta: { en: 'Drowsiness Threshold (θ)', ja: '眠気しきい値（θ）' },
  window_min: { en: 'Window (min)', ja: '集計ウィンドウ（分）' },
}

/** Resolve a signal/param key to its localized label, falling back to the raw key. */
export function signalLabel(key: string, lang: 'ja' | 'en'): string {
  const entry = SIGNAL_LABELS[key]
  if (!entry) return key
  return entry[lang] || entry[lang === 'ja' ? 'en' : 'ja'] || key
}
