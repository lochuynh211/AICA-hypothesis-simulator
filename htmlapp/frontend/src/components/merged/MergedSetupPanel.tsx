/**
 * MergedSetupPanel — left setup panel for the Combined Simulator (feature 020,
 * owner-review redesign: EXACT reuse of the Trigger + Proposal setup editors).
 *
 * The panel is a column of INLINE dropdowns, each with an "Edit" button that
 * opens a WIDE editor popup mounting the *identical* component the Trigger /
 * Proposal screens use — not a reimplementation:
 *   - Route:            preset dropdown + Google-Maps (BYO key) disclosure.
 *   - Situation:        scenario dropdown; Edit popup = the merged A/B/C fields —
 *                       trigger FixedConditions / Speed / Simulated signals
 *                       (`setup/situation/*`) + proposal route/destination tags &
 *                       passenger flag (`SituationFieldRows`) + the mountain/jam
 *                       PAINT bands. Drowsiness/fatigue/monotony/traffic/road are
 *                       computed LIVE by the tick engine — not set here.
 *   - Driver profile:   dropdown over the 16 DISTINCT driver profiles embedded in
 *                       the 32 committed presets (NOT the old 4-profile store);
 *                       Edit popup = `PreferenceHistorySection` (editable
 *                       preference + history).
 *   - Trigger package:  Edit popup = `AlgorithmFormulationPanel` (verbatim).
 *   - Service/Content package: Edit popup = `Service/ContentSetupSection`
 *                       (the proposal panels' setup blocks, verbatim).
 *
 * The editors are store-driven, so the panel mounts a SCOPED `RunStoreProvider`
 * + `ProposalStoreProvider` (see `MergedShell`) and seeds/reads them: the
 * dropdowns dispatch selection; the popups read/write the same scoped stores;
 * Play/quickview read the stores to build the run. This relaxes the earlier
 * "no store" isolation of this panel — the owner explicitly required exact reuse
 * of the store-driven editors. The center/log panels stay coordinator-only.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import ErrorNotice from '../common/ErrorNotice'
import RouteConditionsPainter, { type KmRange } from './RouteConditionsPainter'
import AlgorithmFormulationPanel from '../setup/AlgorithmFormulationPanel'
import FixedConditionsSection from '../setup/situation/FixedConditionsSection'
import SpeedProfileSection from '../setup/situation/SpeedProfileSection'
import SimulatedSignalsSection from '../setup/situation/SimulatedSignalsSection'
import SituationFieldRows from '../proposal/panels/sections/SituationFieldRows'
import PreferenceHistorySection from '../proposal/panels/sections/PreferenceHistorySection'
import ServiceSetupSection from '../proposal/panels/sections/ServiceSetupSection'
import ContentSetupSection from '../proposal/panels/sections/ContentSetupSection'
import HyperparamMatrix from '../proposal/HyperparamMatrix'
import { SITUATION_FIELDS } from '../proposal/panels/sections/worldFields'
import {
  listRoutePresets, loadRoutePreset, routesAnalyze, listScenarios, listPackages, getScenario,
  createRunPlan, getPackage,
} from '../../api/client'
import { MapsError } from '../../api/types'
import type {
  PackageSummary, ScenarioSummary, RoutePresetSummary, RouteAlternative, RouteEnvelope, ScenarioDef, SetupValue,
  PackageManifest, HyperparameterDef,
} from '../../api/types'
import { getPackages, getPreset, getPresets } from '../../api/proposalClient'
import { mergedInstantResultToTimeline } from '../playback/timelineData'
import { useCatalogLoader } from '../proposal/useCatalogLoader'
import type { ProposalPackageSummary, DriverProfile, Situation } from '../../api/proposalClient'
import { buildMergedPlan } from '../../api/mergedClient'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useRunStore, type RunStoreState, type RunStoreAction } from '../../state/runStore'
import { useProposalStore, type ProposalStoreState, type ProposalStoreAction } from '../../state/proposalStore'
import { useLanguage } from '../../state/language'
import { t, type BilingualLabel } from '../../i18n/t'
import RestCeilingEditor from '../setup/RestCeilingEditor'
import RestSpacingEditor from '../setup/RestSpacingEditor'
import { differsFromCase, CASE_OVERRIDE_SENTINEL_DEFAULT, type ResolvedCaseSetup, type LiveSetupSnapshot } from '../../lib/review/caseResolver'
import type { CombinedTestCase } from '../../lib/review/caseCatalog'
import { nodeLabel } from '../../lib/review/reviewVocabulary'
import { SIGNAL_LABELS } from '../setup/signalLabels'

const DEFAULT_PRESET_ID = 'preset-journey-a-1-cruising-fresh'
type EditKey = 'situation' | 'profile' | 'trigger' | 'service' | 'content' | null

const LABELS = {
  setup: { ja: 'セットアップ', en: 'Setup' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  selectPreset: { ja: '— プリセットルートを選択 —', en: '— Select a preset route —' },
  select: { ja: '— 選択 —', en: '— Select —' },
  routePreset: { ja: 'ルートプリセット', en: 'Route preset' },
  customRoute: { ja: 'カスタムルート（Google マップ）', en: 'Custom route (Google Maps)' },
  mapsKey: { ja: 'Google マップ APIキー', en: 'Google Maps API key' },
  fromEnv: { ja: '· 環境変数から', en: '· from environment' },
  mapsKeyPlaceholder: { ja: 'Google マップ APIキー', en: 'Google Maps API key' },
  start: { ja: '出発地', en: 'Start' },
  end: { ja: '目的地', en: 'End' },
  startPlaceholder: { ja: '例: 東京駅', en: 'e.g. Tokyo Station' },
  endPlaceholder: { ja: '例: 大阪駅', en: 'e.g. Osaka Station' },
  analyzing: { ja: '解析中…', en: 'Analyzing…' },
  analyzeRoute: { ja: 'ルートを解析', en: 'Analyze Route' },
  tickDuration: { ja: 'ティック長（秒）', en: 'Tick duration (seconds)' },
  situationScenario: { ja: '状況とシナリオ', en: 'Situation & Scenario' },
  selectScenario: { ja: '— シナリオを選択 —', en: '— Select a scenario —' },
  edit: { ja: '編集', en: 'Edit' },
  driverProfile: { ja: 'ドライバープロファイル', en: 'Driver profile' },
  editedProfile: { ja: '（編集済み — プリセットと不一致）', en: '(Edited — no preset match)' },
  triggerPackage: { ja: '発火判定パッケージ', en: 'Firing-decision package' },
  servicePackage: { ja: 'サービス提案パッケージ', en: 'Service proposal package' },
  contentPackage: { ja: 'コンテンツ提案パッケージ', en: 'Content proposal package' },
  ready: { ja: '準備完了 — 中央パネルの「再生」を押してください。', en: 'Ready — press Play in the center panel.' },
  incomplete: { ja: 'ルート・シナリオ・3つのパッケージをすべて選択してください。', en: 'Select a route, scenario, and all three packages.' },
  situationTitle: { ja: '状況', en: 'Situation' },
  situationNote: {
    ja: '眠気・疲労・単調さ・渋滞・道路はティックエンジンがライブで計算します（ここでは設定しません）。',
    en: 'Drowsiness, fatigue, monotony, traffic & road are computed LIVE by the tick engine — not set here.',
  },
  groupFixed: { ja: 'A · 固定条件', en: 'A · Fixed conditions' },
  routeConditions: { ja: 'ルート条件（{km} km のルートに描画）', en: 'Route conditions (painted onto the {km} km route)' },
  jamSpeedNote: {
    ja: '渋滞速度は下の「B · 道路種別ごとのライブ速度 → 渋滞」で設定します（{kph} km/h）。',
    en: 'Traffic-jam speed is set below in "B · Live speed by road type → Traffic jam" ({kph} km/h).',
  },
  groupSpeed: { ja: 'B · 道路種別ごとのライブ速度', en: 'B · Live speed by road type' },
  groupSimulated: { ja: 'C · シミュレートされたドライバー状態', en: 'C · Simulated driver state' },
  selectScenarioToEdit: { ja: 'シナリオを選ぶと状況を編集できます。', en: 'Select a scenario to edit its situation.' },
  profileTitle: { ja: 'ドライバープロファイル — 嗜好と履歴', en: 'Driver profile — preference & history' },
  triggerAlgorithm: { ja: '発火判定アルゴリズム', en: 'Firing-decision algorithm' },
  selectServiceFirst: { ja: 'まずサービスパッケージを選択してください。', en: 'Select a service package first.' },
  selectContentFirst: { ja: 'まずコンテンツパッケージを選択してください。', en: 'Select a content package first.' },
  explanationSource: { ja: '説明の生成元', en: 'Explanation source' },
  explOff: { ja: 'オフ（定型文）', en: 'Off (template)' },
  explBackend: { ja: 'サーバー側の生成AI（Ollama）', en: 'Server-side generative AI (Ollama)' },
  explBrowser: { ja: 'ブラウザ内蔵の生成AI（Gemini Nano）', en: 'In-browser generative AI (Gemini Nano)' },

  // ── Two-tier basic/detailed editors (task 18) ─────────────────────────────
  badgeSituation: {
    ja: '🚗 状況 — 変更すると同じアルゴリズムを別の状況でレビューすることになります',
    en: '🚗 Situation — changing this reviews the same algorithm somewhere else',
  },
  badgeAlgorithm: {
    ja: '⚙ アルゴリズム — 変更すると同じ状況を別の設定でレビューすることになります',
    en: '⚙ Algorithm — changing this reviews the same situation under a different configuration',
  },
  detailedToggleShow: { ja: '▸ 詳細設定 — すべてのパラメータ', en: '▸ Detailed setup — every parameter' },
  detailedToggleHide: { ja: '▾ 基本設定に戻る', en: '▾ Back to basic setup' },
  pinsNothing: { ja: 'このケースはこの項目を固定していません。', en: 'This case pins nothing in this area.' },
  caseFixesHere: { ja: 'このケースが固定する項目', en: 'What this case fixes' },
  driverStateAtDeparture: { ja: '出発時のドライバー状態', en: 'Driver state at departure' },
  initialDrowsinessLabel: { ja: '初期眠気レベル', en: 'Initial drowsiness level' },
  initialFatigueLabel: { ja: '初期疲労度', en: 'Initial fatigue level' },
  definingPreferences: { ja: 'このペルソナを特徴づける嗜好', en: "The persona's defining preferences" },
  noPersonaPreferences: {
    ja: 'このペルソナには記載された嗜好がありません。',
    en: 'This persona has no authored preferences.',
  },
  casePinsProfile: { ja: 'このケースが固定するプロファイル', en: 'The profile this case pins' },
  maxCandidatesBasic: { ja: '最大候補数', en: 'Max candidates' },
  routeSourceMaps: { ja: 'Google マップ', en: 'Google Maps' },
  routeSourceLocal: { ja: 'ローカル・フォールバック', en: 'Local fallback' },
  errLoadRoutePresets: { ja: 'ルートプリセットの読み込みに失敗しました。', en: 'Failed to load route presets.' },
  errLoadScenarios: { ja: 'シナリオの読み込みに失敗しました。', en: 'Failed to load scenarios.' },
  errLoadTriggerPackages: { ja: '発火判定パッケージの読み込みに失敗しました。', en: 'Failed to load firing-decision packages.' },
  errLoadServiceContentPackages: { ja: 'サービス・コンテンツ提案パッケージの読み込みに失敗しました。', en: 'Failed to load service/content proposal packages.' },
  errLoadDefaultPreset: { ja: '既定のプリセットの読み込みに失敗しました。', en: 'Failed to load the default preset.' },
  errLoadRoutePreset: { ja: '選択したルートプリセットの読み込みに失敗しました。', en: 'Failed to load the selected route preset.' },
  errRouteAnalysisFailed: { ja: 'ルート解析に失敗しました。', en: 'Route analysis failed.' },
  errStartRunFailed: { ja: '実行の開始に失敗しました。', en: 'Failed to start the run.' },
}

// Scenarios hidden from the Combined scenario picker (owner review): the uc02
// "Aoi Sato" monotony scenario is kept on disk (the monotony path + its backend
// tests depend on it) but is not offered here.
const HIDDEN_SCENARIO_IDS = new Set(['uc02_monotony_v0_1'])

/** One distinct driver profile sourced from a committed preset (feature 020). */
type ProfileOption = { key: string; label: BilingualLabel; profile: DriverProfile }

// The setup-time proposal situation fields shown in the merged Situation popup —
// the SCORED fields that are NOT computed live by the tick engine (drowsiness /
// fatigue / monotony / traffic / road / night / child come from the trigger side
// or the live engine). See worldFields.SITUATION_FIELDS.
const MERGED_SITUATION_KEYS = ['route_tags', 'destination_tags', 'multiple_passengers']

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '0.8em', fontWeight: 700, color: '#334155', margin: '10px 0 3px' }
const selectStyle: React.CSSProperties = { width: '100%', fontSize: '0.82em', padding: '5px' }
const rowStyle: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center' }
const editBtnStyle: React.CSSProperties = { flexShrink: 0, fontSize: '0.78em', padding: '4px 8px' }
const summaryRow: React.CSSProperties = { fontSize: '0.82em', margin: '4px 0' }
const inputStyle: React.CSSProperties = { width: '100%', fontSize: '0.8em', padding: '4px' }
const groupLabel: React.CSSProperties = { fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', margin: '14px 0 4px' }

/** Stable-ish dedup key for a driver profile object (schema key order is
 * consistent across presets, so JSON.stringify is sufficient here). */
const profileKey = (p: DriverProfile): string => JSON.stringify(p)

/** Sentinel `value` for the driver-profile dropdown when the profile in the
 *  store matches none of the preset profiles (the reviewer edited fields in the
 *  Edit popup). Not a real key, and deliberately not a valid `profileKey`
 *  output, so `handleSelectProfile` finds no option and does nothing if it is
 *  ever selected. */
const EDITED_PROFILE_KEY = '__edited__'

const UNKNOWN_FIELD_LABEL: BilingualLabel = { ja: '(不明)', en: '(Unknown)' }

/** Bilingual label for a runStore context-override key (`is_night`,
 * `child_passenger`, …), shared with the trigger-side signal registry so the
 * two screens never name the same field differently. Never falls back to the
 * raw key — an unrecognised key still reads as a labelled field, not an
 * identifier (owner rule). */
const contextOverrideLabel = (key: string): BilingualLabel => SIGNAL_LABELS[key] ?? UNKNOWN_FIELD_LABEL

/** Bilingual label for a proposal-side situation field (`multiple_passengers`,
 * `route_tags`, `destination_tags`, …), read from the same `SITUATION_FIELDS`
 * table the detailed editor (`SituationFieldRows`) renders — so the basic and
 * detailed tiers of the same popup always agree on wording. */
const situationFieldLabel = (key: string): BilingualLabel =>
  SITUATION_FIELDS.find((f) => f.key === key)?.label ?? UNKNOWN_FIELD_LABEL

type Lang = 'ja' | 'en'

// ── Two-tier basic/detailed editors (task 18) ───────────────────────────────
//
// Every editor's DETAILED tier stays exactly what it was before this task —
// the existing setup/proposal components, mounted verbatim, untouched below.
// The BASIC tier is net-new: small, purpose-built controls (not a re-styling
// of the detailed components) covering only the handful of fields a reviewer
// routinely turns (07-27 §9.1). These are module-level components (not
// declared inside MergedSetupPanel) so their identity is stable across
// re-renders — an inline component definition would remount on every parent
// render and drop focus/mid-edit state.

/** 🚗 situation / ⚙ algorithm — a LABEL only; nothing it's attached to is
 * ever disabled (owner rule: badges never lock a control). */
function SetupBadge({ kind, lang }: { kind: 'situation' | 'algorithm'; lang: Lang }) {
  const label = kind === 'situation' ? LABELS.badgeSituation : LABELS.badgeAlgorithm
  return (
    <span
      data-testid="setup-badge"
      role="img"
      aria-label={t(label, lang)}
      title={t(label, lang)}
      style={{ fontSize: '0.85em', marginLeft: '5px', cursor: 'help' }}
    >
      {kind === 'situation' ? '🚗' : '⚙'}
    </span>
  )
}

function DetailedToggle({ detailed, onToggle, lang }: { detailed: boolean; onToggle: () => void; lang: Lang }) {
  return (
    <button
      type="button"
      data-testid="setup-detailed-toggle"
      onClick={onToggle}
      style={{
        fontSize: '0.75em', margin: '0 0 12px', background: '#f8fafc', border: '1px solid #cbd5e1',
        borderRadius: '4px', padding: '5px 9px', cursor: 'pointer', color: '#334155',
      }}
    >
      {t(detailed ? LABELS.detailedToggleHide : LABELS.detailedToggleShow, lang)}
    </button>
  )
}

// Exported (alongside `BasicSituationView` below) so component tests can
// mount these basic-tier views directly with props, rather than driving the
// whole panel + its network mocks just to reach a Modal's contents.
export function BasicTriggerView({
  manifest, edited, dispatch, lang,
}: {
  manifest: PackageManifest | null
  edited: Record<string, SetupValue>
  dispatch: (action: RunStoreAction) => void
  lang: Lang
}) {
  const defsByKey: Record<string, HyperparameterDef> = {}
  for (const def of manifest?.hyperparameters ?? []) defsByKey[def.key] = def
  // Manifest-driven, NOT hardcoded (bug 2): the two basic-tier thresholds are
  // whichever hyperparameter keys THIS package's own `fire_control` names —
  // `threshold_suggest`/`monotony_suggest_threshold` only happened to be right
  // for one package (aica_transparent_hybrid_trigger_v1); nri_fatigue_score_v1
  // names `threshold_fire`/`threshold_monotony` instead. `filter(Boolean)`
  // degrades gracefully when a manifest lacks `monotony_threshold_source`.
  const restKey = manifest?.fire_control?.threshold_source
  const monoKey = manifest?.fire_control?.monotony_threshold_source
  const keys = [restKey, monoKey].filter((k): k is string => typeof k === 'string' && k.length > 0)

  return (
    <div data-testid="setup-basic-trigger">
      {keys.map((key) => {
        const def = defsByKey[key]
        const fallback = def ? Number(def.default) : 0
        const value = edited[key] !== undefined ? Number(edited[key]) : fallback
        return (
          <div key={key} style={{ margin: '8px 0' }}>
            <label htmlFor={`basic-input-${key}`} style={fieldLabel}>
              {def ? t(def.label, lang) : key}
              <SetupBadge kind="algorithm" lang={lang} />
            </label>
            <input
              id={`basic-input-${key}`}
              data-testid={`basic-${key}`}
              type="number"
              min={def?.min as number | undefined}
              max={def?.max as number | undefined}
              step={(def?.step as number | undefined) ?? 0.01}
              value={value}
              style={inputStyle}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isNaN(n)) return
                dispatch({ type: 'SET_HYPERPARAMETER', key, value: n, default: def ? Number(def.default) : undefined })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

function BasicServiceView({
  manifest, overrides, parameterOverrides, dispatch, lang,
}: {
  manifest: ProposalPackageSummary | null
  overrides: Record<string, unknown>
  parameterOverrides: Record<string, unknown>
  dispatch: (action: ProposalStoreAction) => void
  lang: Lang
}) {
  if (!manifest) return <p style={summaryRow}>{t(LABELS.selectServiceFirst, lang)}</p>
  const topK = Number(parameterOverrides['top_k'] ?? manifest.parameters['top_k'] ?? 3)
  const hwDef = manifest.hyperparameters.find((h) => h.key === 'hierarchy_weights')
  const weights = (overrides['hierarchy_weights'] ?? hwDef?.default ?? {}) as Record<string, { share?: number; [k: string]: unknown }>

  return (
    <div data-testid="setup-basic-service">
      <label htmlFor="basic-top_k" style={fieldLabel}>
        {t(LABELS.maxCandidatesBasic, lang)}
        <SetupBadge kind="algorithm" lang={lang} />
      </label>
      <input
        id="basic-top_k" data-testid="basic-top_k" type="number" min={1} value={topK} style={inputStyle}
        onChange={(e) => dispatch({ type: 'SET_SERVICE_PARAMETER', key: 'top_k', value: Number(e.target.value) })}
      />
      {hwDef && (
        <>
          <div style={groupLabel}>
            {t(hwDef.label, lang)}
            <SetupBadge kind="algorithm" lang={lang} />
          </div>
          {Object.entries(weights).map(([key, node]) => (
            <div key={key} style={{ margin: '6px 0' }}>
              <label htmlFor={`basic-hw-${key}`} style={fieldLabel}>{t(nodeLabel(key), lang)}</label>
              <input
                id={`basic-hw-${key}`} data-testid={`basic-hierarchy-${key}`} type="number" step={0.01} min={0} max={1}
                value={Number(node?.share ?? 0)} style={inputStyle}
                onChange={(e) => {
                  const share = Number(e.target.value)
                  if (Number.isNaN(share)) return
                  const next = { ...weights, [key]: { ...(weights[key] ?? {}), share } }
                  dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: 'hierarchy_weights', value: next })
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function BasicContentView({
  manifest, overrides, dispatch, lang,
}: {
  manifest: ProposalPackageSummary | null
  overrides: Record<string, unknown>
  dispatch: (action: ProposalStoreAction) => void
  lang: Lang
}) {
  if (!manifest) return <p style={summaryRow}>{t(LABELS.selectContentFirst, lang)}</p>
  const ccwDef = manifest.hyperparameters.find((h) => h.key === 'content_category_weights')
  const weights = (overrides['content_category_weights'] ?? ccwDef?.default ?? {}) as Record<string, number>
  const planDef = manifest.hyperparameters.find((h) => h.key === 'plan_item_count')
  const matrixDef = manifest.hyperparameters.find((h) => h.key === 'context_response_matrix')

  return (
    <div data-testid="setup-basic-content">
      {ccwDef && (
        <>
          <div style={groupLabel}>
            {t(ccwDef.label, lang)}
            <SetupBadge kind="algorithm" lang={lang} />
          </div>
          {Object.entries(weights).map(([cat, val]) => (
            <div key={cat} style={{ margin: '6px 0' }}>
              <label htmlFor={`basic-ccw-${cat}`} style={fieldLabel}>{t(nodeLabel(cat), lang)}</label>
              <input
                id={`basic-ccw-${cat}`} data-testid={`basic-category-${cat}`} type="number" step={0.01} min={0} max={1}
                value={Number(val)} style={inputStyle}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isNaN(n)) return
                  dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: 'content_category_weights', value: { ...weights, [cat]: n } })
                }}
              />
            </div>
          ))}
        </>
      )}
      {planDef && (
        <div style={{ margin: '10px 0' }}>
          <HyperparamMatrix
            def={planDef} value={overrides[planDef.key]} lang={lang}
            onChange={(v) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: planDef.key, value: v })}
          />
        </div>
      )}
      {matrixDef && (
        <div style={{ margin: '10px 0' }}>
          <div style={groupLabel}>
            {t(matrixDef.label, lang)}
            <SetupBadge kind="algorithm" lang={lang} />
          </div>
          <HyperparamMatrix
            def={matrixDef} value={overrides[matrixDef.key]} lang={lang} hideLabel
            onChange={(v) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: matrixDef.key, value: v })}
          />
        </div>
      )}
    </div>
  )
}

export function BasicSituationView({
  caseSetup, rs, ps, scenarioDef, dispatchRun, dispatchProposal, lang,
}: {
  caseSetup: ResolvedCaseSetup | null
  rs: RunStoreState
  ps: ProposalStoreState
  /** The DETAILED tier's own source of truth (`FixedConditionsSection` reads
   * `contextOverrides[key] ?? scenarioDef[key] ?? false`) — the basic tier's
   * checkboxes and initial-state inputs fall back to this SAME scenario
   * default rather than the case's pinned value, so the two tiers never
   * disagree (bug 3). */
  scenarioDef: ScenarioDef | null
  dispatchRun: (action: RunStoreAction) => void
  dispatchProposal: (action: ProposalStoreAction) => void
  lang: Lang
}) {
  const contextKeys = caseSetup ? Object.keys(caseSetup.contextOverrides) : []
  const situationKeys = caseSetup ? Object.keys(caseSetup.situationFields) : []
  const hasPins = contextKeys.length > 0 || situationKeys.length > 0

  // `buildTriggerPlan` OMITS `initial_state.drowsiness_level`/`fatigue_level`
  // entirely when the override is null — the backend then applies the
  // SCENARIO's own initial_state default. Showing 0 in that case (the old
  // behaviour) displayed a value the run never actually uses; these mirror
  // the same scenario fallback the run itself falls back to. `initial_state`
  // values may be numbers or strings on the wire, so coerce with Number() —
  // and a still-NaN result (no scenario loaded yet) reads as 0.
  const scenarioDrowsiness = Number(scenarioDef?.initial_state?.drowsiness_level ?? NaN)
  const initialDrowsinessDisplay = rs.initialDrowsiness ?? (Number.isNaN(scenarioDrowsiness) ? 0 : scenarioDrowsiness)
  const scenarioFatigue = Number(scenarioDef?.initial_state?.fatigue_level ?? NaN)
  const initialFatigueDisplay = rs.initialFatigue ?? (Number.isNaN(scenarioFatigue) ? 0 : scenarioFatigue)

  return (
    <div data-testid="setup-basic-situation">
      <div style={groupLabel}>{t(LABELS.caseFixesHere, lang)}</div>
      {!caseSetup || !hasPins ? (
        <p data-testid="basic-pins-nothing" style={summaryRow}>{t(LABELS.pinsNothing, lang)}</p>
      ) : (
        <>
          {contextKeys.map((key) => {
            const contextOverridesLoose = rs.contextOverrides as unknown as Record<string, unknown>
            // The SAME source of truth the DETAILED tier reads
            // (`FixedConditionsSection`: `contextOverrides[key] ?? scenario[key]
            // ?? false`) — NOT the case's pinned value. Falling back to the
            // case pin here caused a is_night=true(basic)/false(detail)
            // mismatch after a scenario change clears `contextOverrides` (the
            // case still names the field, but the scenario's own default has
            // moved on).
            const value = Boolean(contextOverridesLoose[key] ?? (scenarioDef as unknown as Record<string, unknown> | null)?.[key] ?? false)
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', fontSize: '0.82em' }}>
                <input
                  type="checkbox" id={`basic-ctx-${key}`} data-testid={`basic-${key}`} checked={value}
                  onChange={(e) => dispatchRun({
                    // The SENTINEL default (never equal to a real boolean),
                    // NOT the case's own pinned value (review Finding 1): the
                    // reducer deletes the override when value === default, so
                    // passing the case's value here meant toggling a pin off
                    // then back to the SAME value the case pins (e.g. off,
                    // then back on to restore) silently deleted the override
                    // instead of re-storing it — the checkbox kept showing
                    // checked (display falls back to the case's value when no
                    // override is present) while the dispatched state, and
                    // therefore the built run, had reverted to the scenario
                    // default. See `CASE_OVERRIDE_SENTINEL_DEFAULT`'s doc.
                    type: 'SET_CONTEXT_OVERRIDE', key: key as keyof typeof rs.contextOverrides, value: e.target.checked,
                    default: CASE_OVERRIDE_SENTINEL_DEFAULT,
                  })}
                />
                {t(contextOverrideLabel(key), lang)}
                <SetupBadge kind="situation" lang={lang} />
              </label>
            )
          })}
          {situationKeys.map((key) => {
            const raw = (ps.world.situation as unknown as Record<string, unknown>)[key] ?? caseSetup.situationFields[key]
            if (typeof raw === 'boolean') {
              return (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0', fontSize: '0.82em' }}>
                  <input
                    type="checkbox" id={`basic-sit-${key}`} data-testid={`basic-${key}`} checked={raw}
                    onChange={(e) => dispatchProposal({ type: 'SET_SITUATION_FIELD', key: key as keyof Situation, value: e.target.checked })}
                  />
                  {t(situationFieldLabel(key), lang)}
                  <SetupBadge kind="situation" lang={lang} />
                </label>
              )
            }
            const arr = Array.isArray(raw) ? (raw as string[]) : []
            return (
              <div key={key} style={{ margin: '6px 0' }}>
                <label htmlFor={`basic-sit-${key}`} style={fieldLabel}>
                  {t(situationFieldLabel(key), lang)}
                  <SetupBadge kind="situation" lang={lang} />
                </label>
                <input
                  id={`basic-sit-${key}`} data-testid={`basic-${key}`} type="text" style={inputStyle}
                  value={arr.join(', ')}
                  onChange={(e) => dispatchProposal({
                    type: 'SET_SITUATION_FIELD', key: key as keyof Situation,
                    value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })}
                />
              </div>
            )
          })}
        </>
      )}

      <div style={{ ...groupLabel, marginTop: '14px' }}>{t(LABELS.driverStateAtDeparture, lang)}</div>
      <label htmlFor="basic-initial-drowsiness" style={fieldLabel}>
        {t(LABELS.initialDrowsinessLabel, lang)}
        <SetupBadge kind="situation" lang={lang} />
      </label>
      <input
        id="basic-initial-drowsiness" data-testid="basic-initial_drowsiness" type="number" min={0} max={100} style={inputStyle}
        value={initialDrowsinessDisplay}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) dispatchRun({ type: 'SET_INITIAL_DROWSINESS', value: n })
        }}
      />
      <label htmlFor="basic-initial-fatigue" style={fieldLabel}>
        {t(LABELS.initialFatigueLabel, lang)}
        <SetupBadge kind="situation" lang={lang} />
      </label>
      <input
        id="basic-initial-fatigue" data-testid="basic-initial_fatigue" type="number" min={0} max={100} style={inputStyle}
        value={initialFatigueDisplay}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) dispatchRun({ type: 'SET_INITIAL_FATIGUE', value: n })
        }}
      />
    </div>
  )
}

/**
 * "The persona's defining preferences" (07-27 §9.1) reads the CASE's
 * authored `persona.preferences` (task-18 review Finding 3) — the resolved
 * profile's own scoring inputs (oshi/hobby tags/age band) tell a reviewer
 * nothing they couldn't already infer from the profile reference; a
 * reviewer judging whether a proposal suits the persona needs the persona's
 * STATED preferences to judge the proposal against.
 */
function BasicProfileView({
  caseSetup, selectedCase, presetLabelsById, lang,
}: {
  caseSetup: ResolvedCaseSetup | null
  selectedCase: CombinedTestCase | null
  /** preset id → the preset's own bilingual display label (feature 020 review
   * finding): `caseSetup.profileRef` is the raw kebab-case preset id, which
   * must never reach the screen — the resolved display label stands in for
   * it, with the id itself reachable only as a fallback if it is somehow
   * unregistered. */
  presetLabelsById: Record<string, BilingualLabel>
  lang: Lang
}) {
  if (!caseSetup) {
    return (
      <div data-testid="setup-basic-profile">
        <div style={groupLabel}>{t(LABELS.caseFixesHere, lang)}</div>
        <p data-testid="basic-pins-nothing" style={summaryRow}>{t(LABELS.pinsNothing, lang)}</p>
      </div>
    )
  }
  const preferences = selectedCase?.persona.preferences ?? []
  const profileLabel = presetLabelsById[caseSetup.profileRef] ?? UNKNOWN_FIELD_LABEL
  return (
    <div data-testid="setup-basic-profile">
      <div style={groupLabel}>{t(LABELS.caseFixesHere, lang)}</div>
      <p style={summaryRow}>
        {t(LABELS.casePinsProfile, lang)}: <strong>{t(profileLabel, lang)}</strong>
        <SetupBadge kind="situation" lang={lang} />
      </p>
      <div style={{ ...groupLabel, marginTop: '14px' }}>{t(LABELS.definingPreferences, lang)}</div>
      {preferences.length > 0 ? (
        <ul data-testid="basic-persona-preferences" style={{ fontSize: '0.82em', margin: '4px 0', paddingLeft: '18px', lineHeight: 1.7 }}>
          {preferences.map((pref, i) => <li key={i}>{t(pref, lang)}</li>)}
        </ul>
      ) : (
        <p data-testid="basic-no-persona-preferences" style={summaryRow}>{t(LABELS.noPersonaPreferences, lang)}</p>
      )}
    </div>
  )
}

export default function MergedSetupPanel({
  caseSetup = null,
  selectedCase = null,
  caseModified = false,
  onCaseDrift,
}: {
  caseSetup?: ResolvedCaseSetup | null
  /** The case's own authored persona bullets (task-18 review Finding 3) — a
   * second prop alongside `caseSetup` because "the persona's defining
   * preferences" (07-27 §9.1) means the CASE's stated preferences, not the
   * resolved profile's scoring inputs. */
  selectedCase?: CombinedTestCase | null
  /** Already-known drift, so a remount does not re-announce it. */
  caseModified?: boolean
  /**
   * Called when the live setup no longer matches the selected case. The parent
   * (`MergedShell`) wires this to `useCaseSelection().clearCase`, dropping the
   * picker back to "no test case" — an edited setup is not that case any more.
   */
  onCaseDrift?: () => void
} = {}) {
  const coordinator = useMergedCoordinator()
  const runStore = useRunStore()
  const proposalStore = useProposalStore()
  const { lang } = useLanguage()
  const rs = runStore.state
  const ps = proposalStore.state

  // S5b bug 1: this panel reuses `PreferenceHistorySection` verbatim (its
  // oshi-artist rows read `state.catalog`) but never mounted `WorldPanel` —
  // the ONLY place `SET_CATALOG` used to be dispatched from — so on this
  // panel's SCOPED proposal store `state.catalog` stayed at its initial `[]`
  // forever and the artist picker had nothing to offer. `useCatalogLoader`
  // (extracted out of `WorldPanel`) carries that same dispatch here too.
  useCatalogLoader(ps.world.control_inputs.dataset_id)

  // S5b bug 2: mirrors `rs.selectedPackageId`, updated every render (NOT in an
  // effect) so the registry-load effect below can read the CURRENT value from
  // inside `listPackages().then(...)` — a microtask that only runs once every
  // synchronous mount-effect dispatch has already landed. Reading `rs.selectedPackageId`
  // directly from that closure would see the value as of the effect's OWN mount
  // (always null, since it fires on first render), even after a case's own
  // SELECT_PACKAGE dispatch — from `useCaseSelection`, a PARENT component's
  // effect — has since landed synchronously and re-rendered this one.
  const selectedPackageIdRef = useRef(rs.selectedPackageId)
  selectedPackageIdRef.current = rs.selectedPackageId

  // Same race, driver-profile edition (first-load bug): `loadDefaultPresetWorld`
  // below awaits `getPreset(DEFAULT_PRESET_ID)` then dispatches LOAD_PRESET — a
  // full world replacement. The default case's own LOAD_CASE_WORLD (dispatched
  // by `useCaseSelection`, a PARENT effect, after ITS getPreset resolves) sets a
  // non-null `selectedProfileId`. Over real HTTP the generic default preset can
  // resolve LAST and clobber the case's driver_profile with the generic one.
  // Mirror the package guard: this ref lets the deferred seed re-read the CURRENT
  // selection at dispatch time and bail if a case has already claimed a profile.
  const selectedProfileIdRef = useRef(ps.selectedProfileId)
  selectedProfileIdRef.current = ps.selectedProfileId

  // Panel-local registries + selection bookkeeping (the stores hold the edits).
  // The ROUTE stays panel-local (NOT in runStore): SELECT_SCENARIO clears a
  // local-source route as a per-scenario reset, which would wipe a chosen route
  // preset whenever the scenario is (re)selected. The route is only read here to
  // build the trigger plan, so keeping it local avoids that interaction.
  const [routePresets, setRoutePresets] = useState<RoutePresetSummary[]>([])
  const [selectedRoutePresetId, setSelectedRoutePresetId] = useState<string | null>(null)
  const [routeEnvelope, setRouteEnvelope] = useState<RouteEnvelope | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  // Maps API key lives in the scoped runStore (pre-filled from
  // VITE_GOOGLE_MAPS_KEY in its initialState, exactly like the Trigger screen)
  // so the zero-prop <MapSurface/> reads the same key. Start/end stay local.
  const [mapsStart, setMapsStart] = useState('')
  const [mapsEnd, setMapsEnd] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [mapsErrorMsg, setMapsErrorMsg] = useState<string | null>(null)

  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [triggerPackages, setTriggerPackages] = useState<PackageSummary[]>([])
  const [servicePackages, setServicePackages] = useState<ProposalPackageSummary[]>([])
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])

  // Driver-profile options: the 16 DISTINCT profiles embedded in the 32 presets.
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([])
  // NOT local state. The selected profile is DERIVED from the store, because
  // `world.driver_profile` has three writers and only one of them is this
  // panel: `handleSelectProfile` (this dropdown), `LOAD_PROFILE` from
  // `useCaseSelection` when the reviewer switches test case, and
  // `SET_DRIVER_PROFILE_FIELD` from the Edit popup. A local `selectedProfileKey`
  // tracked only the first, so switching case after picking a profile left the
  // control naming a profile the run no longer used — and a reviewer files a
  // verdict against the setup the panel SHOWS them, which makes a stale label
  // wrong evidence rather than a cosmetic slip.
  const storeProfileKey = profileKey(ps.world.driver_profile)
  const profileIsAnOption = profileOptions.some((o) => o.key === storeProfileKey)
  // preset id → the preset's own bilingual label, so a pinned case's
  // `profileRef` (a raw preset id) can be shown as words, never as the id.
  const [presetLabelsById, setPresetLabelsById] = useState<Record<string, BilingualLabel>>({})

  // The resolved ScenarioDef (for the trigger situation sections' defaults).
  const [scenarioDef, setScenarioDef] = useState<ScenarioDef | null>(null)

  // Situation paint bands (mountain / jam) — merged-screen-local (there is no
  // scenario JSON for these; painted onto the resolved route at build time).
  const [mountainRange, setMountainRange] = useState<KmRange | null>(null)
  const [jamRange, setJamRange] = useState<KmRange | null>(null)

  const [openEdit, setOpenEdit] = useState<EditKey>(null)
  const [error, setError] = useState<string | null>(null)

  // Two-tier basic/detailed (task 18): every popup opens BASIC — reset to
  // `false` whenever a different editor opens (or the same one re-opens).
  const [detailed, setDetailed] = useState(false)
  useEffect(() => { setDetailed(false) }, [openEdit])

  // The trigger package's full manifest, fetched independently of
  // AlgorithmFormulationPanel's own internal fetch (that component has no
  // prop to hand its manifest back up) — needed for the basic trigger view's
  // two thresholds (label/default/min/max).
  const [triggerManifest, setTriggerManifest] = useState<PackageManifest | null>(null)
  useEffect(() => {
    if (!rs.selectedPackageId) { setTriggerManifest(null); return }
    let cancelled = false
    getPackage(rs.selectedPackageId)
      .then((m) => { if (!cancelled) setTriggerManifest(m) })
      .catch(() => { if (!cancelled) setTriggerManifest(null) })
    return () => { cancelled = true }
  }, [rs.selectedPackageId])

  // Wire the case's route preset / painted mountain-jam ranges into this
  // panel's LOCAL state (task 18) — resolveCase/caseDispatches (task 17)
  // already seed the run/proposal stores; the route+paint fields were left
  // inert because they live here, not in a store. `caseSetup` is a stable
  // object per selected case (the parent memoizes it), so this only re-fires
  // on an actual case change, not every render.
  useEffect(() => {
    if (!caseSetup) return
    setMountainRange(caseSetup.mountainRangeKm)
    setJamRange(caseSetup.jamRangeKm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSetup])

  // SINGLE OWNER of the selected route preset. Having one effect decide removes
  // the race that let a stale default overwrite the case's route depending on
  // which fetch resolved last.
  //
  // A selected case's route is a standing requirement — it re-applies whenever
  // the case changes. The registry default is NOT: it only seeds the very first
  // selection. Making the default standing too would fight the reviewer, since
  // dropping back to "no test case" would then yank their manually chosen route
  // back to the first registry entry.
  const caseRoutePresetId = caseSetup?.routePresetId ?? null
  useEffect(() => {
    if (!caseRoutePresetId) return
    if (caseRoutePresetId === selectedRoutePresetId) return
    void handleSelectRoutePreset(caseRoutePresetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseRoutePresetId])

  useEffect(() => {
    if (selectedRoutePresetId || caseRoutePresetId) return
    const seed = routePresets[0]?.id
    if (seed) void handleSelectRoutePreset(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePresets, caseRoutePresetId])

  // ── Load registries + seed both scoped stores (auto-select first of each) ───
  useEffect(() => {
    listRoutePresets()
      // Load the LIST only. Selection is owned by the single effect below —
      // auto-selecting here raced the case's own route: both are async, so the
      // default could land after the case's and silently replace it (a C-01 run
      // showing the Tokyo-Osaka route).
      .then((r) => { setRoutePresets(r.presets) })
      .catch(() => setError(t(LABELS.errLoadRoutePresets, lang)))
    listScenarios()
      .then((r) => { setScenarios(r.scenarios); runStore.dispatch({ type: 'LOAD_SCENARIOS', scenarios: r.scenarios }) })
      .catch(() => setError(t(LABELS.errLoadScenarios, lang)))
    listPackages()
      .then((r) => {
        setTriggerPackages(r.packages)
        runStore.dispatch({ type: 'LOAD_PACKAGES', packages: r.packages })
        // The packages[0] fallback is a SEED for when nothing has selected a
        // package yet — it must never overwrite a case's own pick. A case's
        // SELECT_PACKAGE (dispatched synchronously by `useCaseSelection`, a
        // parent effect) can land before this promise resolves; without this
        // guard the alphabetically-first registry entry would silently win
        // the race and swap the case's algorithm out from under the reviewer.
        if (r.packages[0] && !selectedPackageIdRef.current) {
          runStore.dispatch({ type: 'SELECT_PACKAGE', id: r.packages[0].id })
        }
      })
      .catch(() => setError(t(LABELS.errLoadTriggerPackages, lang)))
    getPackages()
      .then((r) => {
        const svc = r.packages.filter((p) => p.family === 'service_selector')
        const cnt = r.packages.filter((p) => p.family === 'content_selector')
        setServicePackages(svc); if (svc[0]) proposalStore.dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: svc[0].id })
        setContentPackages(cnt); if (cnt[0]) proposalStore.dispatch({ type: 'SET_CONTENT_PACKAGE', packageId: cnt[0].id })
      })
      .catch(() => setError(t(LABELS.errLoadServiceContentPackages, lang)))
    // Seed the world (situation + driver_profile) from the default preset.
    loadDefaultPresetWorld().catch(() => setError(t(LABELS.errLoadDefaultPreset, lang)))
    // Build the distinct-driver-profile dropdown from the 32 presets.
    loadPresetProfiles().catch(() => { /* profiles optional */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select the first COMPATIBLE scenario once scenarios + trigger pkg known.
  useEffect(() => {
    if (scenarios.length === 0) return
    const compatible = compatibleScenarios
    if (compatible.length > 0 && !compatible.some((s) => s.id === rs.selectedScenarioId)) {
      runStore.dispatch({ type: 'SELECT_SCENARIO', id: compatible[0].id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, rs.selectedPackageId])

  // Resolve the ScenarioDef whenever the selected scenario changes (the trigger
  // situation sections need it for their defaults).
  useEffect(() => {
    if (!rs.selectedScenarioId) { setScenarioDef(null); return }
    let cancelled = false
    getScenario(rs.selectedScenarioId)
      .then((def) => { if (!cancelled) setScenarioDef(def) })
      .catch(() => { if (!cancelled) setScenarioDef(null) })
    return () => { cancelled = true }
  }, [rs.selectedScenarioId])

  async function loadDefaultPresetWorld() {
    let preset
    try { preset = await getPreset(DEFAULT_PRESET_ID) } catch {
      const { presets } = await getPresets()
      if (presets.length === 0) throw new Error('No proposal presets available')
      preset = await getPreset(presets[0].preset_id)
    }
    // Re-read the selection AFTER the await: a case's LOAD_CASE_WORLD (from
    // `useCaseSelection`, a parent effect) may have landed while this default
    // preset was in flight. The default preset is only a first-load SEED — it
    // must never overwrite a case's own driver_profile/situation. Bailing here
    // (rather than at effect-start) is what closes the race, since the case's
    // dispatch can arrive during this fetch.
    if (selectedProfileIdRef.current) return
    proposalStore.dispatch({ type: 'LOAD_PRESET', presetId: preset.preset_id, world: preset.world, overrides: preset.algorithm_config_overrides })
    // No separate "remember which profile this was" write — LOAD_PRESET already
    // put this preset's driver_profile in the store, and the dropdown reads it
    // from there.
  }

  async function loadPresetProfiles() {
    const { presets } = await getPresets()
    setPresetLabelsById(Object.fromEntries(presets.map((p) => [p.preset_id, p.label])))
    const details = await Promise.all(presets.map((p) => getPreset(p.preset_id).catch(() => null)))
    const seen = new Map<string, ProfileOption>()
    for (const d of details) {
      if (!d) continue
      const key = profileKey(d.world.driver_profile)
      if (!seen.has(key)) seen.set(key, { key, label: d.label, profile: d.world.driver_profile })
    }
    setProfileOptions(Array.from(seen.values()))
  }

  async function handleSelectRoutePreset(presetId: string) {
    setSelectedRoutePresetId(presetId); setMapsErrorMsg(null)
    if (!presetId) { setRouteEnvelope(null); setSelectedRouteId(null); return }
    setLoadingRoute(true)
    try {
      const env = await loadRoutePreset(presetId)
      setRouteEnvelope(env); setSelectedRouteId(env.alternatives[0]?.route_id ?? null)
    } catch (e) { setError(e instanceof Error ? e.message : t(LABELS.errLoadRoutePreset, lang)) } finally { setLoadingRoute(false) }
  }

  async function handleAnalyzeMaps() {
    setAnalyzing(true); setMapsErrorMsg(null)
    try {
      const env = await routesAnalyze({ scenarioId: rs.selectedScenarioId || undefined, mapsKey: rs.mapsKey || undefined, start: mapsStart || undefined, end: mapsEnd || undefined })
      setSelectedRoutePresetId(null); setRouteEnvelope(env); setSelectedRouteId(env.alternatives[0]?.route_id ?? null)
    } catch (err) { setMapsErrorMsg(err instanceof MapsError ? err.body.message : err instanceof Error ? err.message : t(LABELS.errRouteAnalysisFailed, lang)) } finally { setAnalyzing(false) }
  }

  // Mirror the panel-local route into the scoped runStore so the zero-prop
  // <MapSurface/> (useRunStore-driven) can render the selected route's map.
  // Re-runs after SELECT_SCENARIO (which clears a runStore route) to re-sync;
  // real preset/maps routes are route_source 'maps', so this stays stable.
  useEffect(() => {
    if (!routeEnvelope) return
    runStore.dispatch({ type: 'SET_ALTERNATIVES', envelope: routeEnvelope })
    if (selectedRouteId) runStore.dispatch({ type: 'SELECT_ROUTE', routeId: selectedRouteId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeEnvelope, selectedRouteId, rs.selectedScenarioId])

  function handleSelectProfile(key: string) {
    const opt = profileOptions.find((o) => o.key === key)
    // Also the guard for the synthetic "edited" entry below: it is not in
    // `profileOptions`, so selecting it is a no-op rather than a crash.
    if (!opt) return
    // LOAD_PROFILE replaces ONLY world.driver_profile — the user's situation
    // edits are preserved (unlike LOAD_PRESET, which replaces the whole world).
    proposalStore.dispatch({ type: 'LOAD_PROFILE', profileId: opt.key, profile: opt.profile })
  }

  const compatibleScenarios = useMemo(() => {
    const visible = scenarios.filter((s) => !HIDDEN_SCENARIO_IDS.has(s.id))
    const pkg = triggerPackages.find((p) => p.id === rs.selectedPackageId)
    return pkg ? visible.filter((s) => pkg.compatible_scenario_types.includes(s.type)) : visible
  }, [triggerPackages, rs.selectedPackageId, scenarios])

  const chosenAlt: RouteAlternative | null =
    routeEnvelope?.alternatives.find((a) => a.route_id === selectedRouteId) ?? routeEnvelope?.alternatives[0] ?? null
  const totalKm = chosenAlt?.route_facts.total_route_distance_km ?? 100

  // Traffic-jam speed for a painted jam comes from the Situation editor's speed
  // profile (B · Live speed by road type → "Traffic jam"), NOT a second control
  // (owner review — the duplicate input was removed). Falls back to 15 km/h when
  // the scenario has no speed profile.
  const jamSpeedKph = useMemo(() => {
    const override = (rs.profileOverrides?.speed as Record<string, number> | undefined)?.traffic_jam_kph
    if (override != null) return override
    const fromScenario = (scenarioDef?.speed_profile as Record<string, number> | undefined)?.traffic_jam_kph
    return fromScenario ?? 15
  }, [rs.profileOverrides, scenarioDef])

  // Physical km spans, sourced from the quickview's traversal-accurate jam
  // fractions (same math the quickview bar uses) so the map overlay and the
  // setup-popup slider agree with the quickview instead of assuming the car
  // crosses a jam at the route's average speed.
  const scenarioJamRangesKm: [number, number][] = useMemo(() => {
    if (totalKm <= 0) return []
    const qv = coordinator.state.quickviewResult
    if (qv && (qv.progress?.length ?? 0) > 0 && (qv.traffic_jams?.length ?? 0) > 0) {
      const td = mergedInstantResultToTimeline(qv)
      const ranges: [number, number][] = []
      for (const j of td.trafficJams) {
        const startKm = Math.min(Math.max(j.fromX * totalKm, 0), totalKm)
        const endKm = Math.min(Math.max(j.toX * totalKm, 0), totalKm)
        if (endKm > startKm) ranges.push([startKm, endKm])
      }
      return ranges
    }
    // Fallback (quickview not yet loaded / no progress map): the previous
    // time-proportional inversion, so the overlay is not empty while the
    // debounced quickview is in flight.
    const estDurationMin = chosenAlt?.route_facts.estimated_route_duration_min ?? null
    const events = ((scenarioDef as unknown as Record<string, unknown> | null)?.presets as
      { traffic_events?: Array<{ start_min?: number; duration_min?: number }> } | undefined)?.traffic_events ?? []
    if (!estDurationMin || estDurationMin <= 0) return []
    const clamp = (v: number) => Math.min(Math.max(v, 0), totalKm)
    const ranges: [number, number][] = []
    for (const ev of events) {
      if (typeof ev.start_min !== 'number' || typeof ev.duration_min !== 'number') continue
      const startKm = clamp((ev.start_min / estDurationMin) * totalKm)
      const endKm = clamp(((ev.start_min + ev.duration_min) / estDurationMin) * totalKm)
      if (endKm > startKm) ranges.push([startKm, endKm])
    }
    return ranges
  }, [scenarioDef, chosenAlt, totalKm, coordinator.state.quickviewResult])

  // Effective world = the edited proposal world with night/child SYNCED from the
  // trigger fixed-conditions (the "merge from both screens" the owner asked for);
  // an absent context override keeps the preset's own value.
  const effectiveWorld = useMemo(() => {
    const s = { ...ps.world.situation }
    if (rs.contextOverrides.is_night !== undefined) s.night_state = rs.contextOverrides.is_night ? 'night' : 'day'
    if (rs.contextOverrides.child_passenger !== undefined) s.child_present = Boolean(rs.contextOverrides.child_passenger)
    return { ...ps.world, situation: s }
  }, [ps.world, rs.contextOverrides])

  const isComplete =
    rs.selectedPackageId != null && rs.selectedScenarioId != null && chosenAlt != null &&
    ps.servicePackageId != null && ps.contentPackageId != null

  // Build the trigger run-plan from the scoped runStore (mirrors
  // InstantResultStrip.handleOpenFullRun), painting mountain/jam when set.
  async function buildTriggerPlan(): Promise<string> {
    const presets: Record<string, unknown> = rs.tickSecondsOverride != null ? { tick_seconds: rs.tickSecondsOverride } : {}
    const initialState: { drowsiness_level?: number; fatigue_level?: number } = {}
    if (rs.initialDrowsiness != null) initialState.drowsiness_level = rs.initialDrowsiness
    if (rs.initialFatigue != null) initialState.fatigue_level = rs.initialFatigue

    if (mountainRange || jamRange) {
      const painted = await buildMergedPlan({
        package_id: rs.selectedPackageId!, scenario_id: rs.selectedScenarioId!, route_preset_id: selectedRoutePresetId,
        run_seed: rs.runSeed, mountain_range_km: mountainRange, jam_range_km: jamRange, jam_speed_kph: jamSpeedKph,
        presets, parameters: rs.editedParameters, hyperparameters: rs.editedHyperparameters,
        profiles: rs.profileOverrides ?? undefined,
        initial_state: Object.keys(initialState).length > 0 ? initialState : undefined,
        context_overrides: Object.keys(rs.contextOverrides).length > 0 ? rs.contextOverrides : undefined,
      })
      return painted.plan_id
    }
    const alt = chosenAlt!
    const plan = await createRunPlan({
      packageId: rs.selectedPackageId!, scenarioId: rs.selectedScenarioId!, routeId: alt.route_id,
      routeSource: routeEnvelope!.route_source, routeFacts: alt.route_facts, displayRoute: alt.display, runSeed: rs.runSeed,
      parameters: rs.editedParameters as Record<string, SetupValue>, hyperparameters: rs.editedHyperparameters as Record<string, SetupValue>,
      presets, runMode: 'standard',
      ...(rs.profileOverrides != null ? { profiles: rs.profileOverrides } : {}),
      ...(Object.keys(initialState).length > 0 ? { initialState } : {}),
      ...(Object.keys(rs.contextOverrides).length > 0 ? { contextOverrides: rs.contextOverrides } : {}),
    })
    return plan.plan_id
  }

  // Register the start fn for the center Play button (re-registers on any change).
  useEffect(() => {
    if (!isComplete) { coordinator.prepareStart(null); return }
    coordinator.prepareStart(async (): Promise<boolean> => {
      setError(null)
      try {
        const planId = await buildTriggerPlan()
        await coordinator.create({
          trigger_plan_id: planId, world: effectiveWorld,
          service_package_id: ps.servicePackageId!, content_package_id: ps.contentPackageId!,
          run_seed: String(rs.runSeed),
          service_parameters: ps.serviceParameterOverrides, service_hyperparameters: ps.serviceHyperparameterOverrides,
          content_parameters: ps.contentParameterOverrides, content_hyperparameters: ps.contentHyperparameterOverrides,
        }, rs.selectedScenarioId!)
        return true
      } catch (e) { setError(e instanceof Error ? e.message : t(LABELS.errStartRunFailed, lang)); return false }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, rs, ps, effectiveWorld, selectedRoutePresetId, routeEnvelope, selectedRouteId, mountainRange, jamRange, jamSpeedKph, lang])

  // Mirrors buildTriggerPlan's initialState assembly so the projection and the
  // run are fed identically.
  const quickviewInitialState = useMemo(() => {
    const init: { drowsiness_level?: number; fatigue_level?: number } = {}
    if (rs.initialDrowsiness != null) init.drowsiness_level = rs.initialDrowsiness
    if (rs.initialFatigue != null) init.fatigue_level = rs.initialFatigue
    return init
  }, [rs.initialDrowsiness, rs.initialFatigue])

  // Auto-quickview (debounced) on ANY setup change, before a run exists.
  const hasRun = coordinator.state.mergedRunId != null
  useEffect(() => {
    // Suppress recompute while an Edit popup is open (fixbug-0806): fields still
    // write to the store live (map overlays / drift note stay accurate), but the
    // projection is NOT recomputed until the popup closes. When `openEdit` returns
    // to null this effect re-runs and fires exactly one quickview against the
    // final edited values — closing the popup IS the "apply" action (no Confirm
    // button). This is what stops rapid in-popup edits from firing overlapping
    // quickview requests that resolve out of order.
    if (!isComplete || hasRun || openEdit !== null) return
    const timer = setTimeout(() => {
      void coordinator.quickview({
        package_id: rs.selectedPackageId!, scenario_id: rs.selectedScenarioId!, route_preset_id: selectedRoutePresetId,
        run_seed: rs.runSeed, mountain_range_km: mountainRange, jam_range_km: jamRange, jam_speed_kph: jamSpeedKph,
        hyperparameter_overrides: rs.editedHyperparameters,
        // The SAME pins buildTriggerPlan sends on Play. Without them the
        // projection starts from the scenario's own defaults while the run
        // starts from these values, and the two disagree visibly on screen.
        ...(Object.keys(quickviewInitialState).length > 0 ? { initial_state: quickviewInitialState } : {}),
        ...(Object.keys(rs.contextOverrides).length > 0 ? { context_overrides: rs.contextOverrides } : {}),
        ...(rs.profileOverrides != null ? { profiles: rs.profileOverrides } : {}),
        ...(rs.tickSecondsOverride != null ? { tick_seconds: rs.tickSecondsOverride } : {}),
        world: effectiveWorld, service_package_id: ps.servicePackageId!, content_package_id: ps.contentPackageId!,
        run_seed_proposal: String(rs.runSeed),
        service_parameters: ps.serviceParameterOverrides, service_hyperparameters: ps.serviceHyperparameterOverrides,
        content_parameters: ps.contentParameterOverrides, content_hyperparameters: ps.contentHyperparameterOverrides,
      })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, hasRun, rs.selectedPackageId, rs.selectedScenarioId, rs.editedHyperparameters, selectedRoutePresetId,
      mountainRange, jamRange, jamSpeedKph, effectiveWorld, ps.servicePackageId, ps.contentPackageId,
      ps.serviceParameterOverrides, ps.serviceHyperparameterOverrides, ps.contentParameterOverrides, ps.contentHyperparameterOverrides,
      // The pins must be dependencies too, or editing initial drowsiness leaves
      // the projection showing the previous value.
      quickviewInitialState, rs.contextOverrides, rs.profileOverrides, rs.tickSecondsOverride, openEdit])

  // Issue 1: bridge the painted traffic-jam range (km) into the runStore so the
  // center panel's <MapSurface/> can draw it in red over the route. A zero-width
  // or unpainted range clears the overlay.
  useEffect(() => {
    const painted: [number, number][] = jamRange && jamRange[1] > jamRange[0] ? [jamRange] : []
    // A painted jam REPLACES the scenario's own preset jam on the map, matching
    // the backend (caller presets win over scenario.presets in build_event_plan,
    // and the quickview forwards the same replaced presets). Unioning left the
    // scenario-wide jam drawn under the painted one, so the painted start/end
    // never appeared to update. With nothing painted, show the scenario-derived jam(s).
    const ranges = painted.length > 0 ? painted : scenarioJamRangesKm
    runStore.dispatch({ type: 'SET_MERGED_JAM_RANGES', ranges })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jamRange, scenarioJamRangesKm])

  // Same bridge for the painted mountain range. It closes a wider gap than the
  // jam one: the mountain range is spliced into `route_facts.route_segments`
  // SERVER-side (`buildMergedPlan` → `inject_mountain_segment`), so the map —
  // which colours segments from the UNPAINTED route alternative in the runStore
  // — had no way to know about it. C-04 showed its mountain stretch in the
  // quickview and nowhere on the map.
  useEffect(() => {
    const ranges: [number, number][] =
      mountainRange && mountainRange[1] > mountainRange[0] ? [mountainRange] : []
    runStore.dispatch({ type: 'SET_MERGED_MOUNTAIN_RANGES', ranges })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountainRange])

  // Issue 2: editing ANY setup field after a live run has been created (or while
  // it is running) resets the simulator — the reviewer must Play again against
  // the new setup. A signature of every setup input is compared against the last
  // one so this fires ONLY on a real change (never on unrelated re-renders, and
  // never on mount). After reset, the auto-quickview effect above re-projects the
  // new setup (hasRun is false again).
  const setupSignature = JSON.stringify({
    pkg: rs.selectedPackageId, scn: rs.selectedScenarioId,
    hp: rs.editedHyperparameters, pm: rs.editedParameters,
    routePreset: selectedRoutePresetId, routeId: selectedRouteId,
    mountain: mountainRange, jam: jamRange, jamSpeed: jamSpeedKph,
    svc: ps.servicePackageId, cnt: ps.contentPackageId,
    svcP: ps.serviceParameterOverrides, svcHp: ps.serviceHyperparameterOverrides,
    cntP: ps.contentParameterOverrides, cntHp: ps.contentHyperparameterOverrides,
    seed: rs.runSeed, tick: rs.tickSecondsOverride,
    profile: rs.profileOverrides, ctx: rs.contextOverrides,
    initD: rs.initialDrowsiness, initF: rs.initialFatigue,
    world: effectiveWorld,
  })
  const prevSetupSig = useRef(setupSignature)
  useEffect(() => {
    // Don't reset a live run on every keystroke inside an open popup
    // (fixbug-0806) — defer until the popup closes. `prevSetupSig` is NOT
    // updated while suppressed, so the accumulated change is still detected on
    // close and triggers a single reset.
    if (openEdit !== null) return
    if (prevSetupSig.current === setupSignature) return
    prevSetupSig.current = setupSignature
    if (coordinator.state.mergedRunId != null || coordinator.state.running) {
      coordinator.reset()
    }
  }, [setupSignature, coordinator, openEdit])

  const selService = servicePackages.find((p) => p.id === ps.servicePackageId) ?? null
  const selContent = contentPackages.find((p) => p.id === ps.contentPackageId) ?? null

  // ── Differs-from-case note + Reset (task 18; race fix per review Finding 2) ─
  // Selecting a case SEEDS the setup; it does not lock it (caseResolver.ts).
  // This compares the live setup against the case as defined and — when it
  // has drifted — offers a Reset.
  //
  // Reset does the route/mountain/jam part itself (synchronous, panel-local
  // state, no store race possible — and even a stale write here is
  // self-correcting: the `[caseSetup]` effect above re-applies whichever
  // case is CURRENTLY selected the moment `caseSetup` next changes). The
  // run/proposal part is delegated to `onResetToCase` — the SAME
  // `useCaseSelection().handleSelectCase` the case picker uses — rather than
  // re-dispatching `caseDispatches(caseSetup)` locally with a second,
  // unguarded `getPreset` fetch. A bespoke local copy was tried first and
  // reviewed: Reset(case A) then picking case B in the picker before A's
  // fetch resolves would let A's stale SET_SERVICE_PACKAGE/SET_CONTENT_PACKAGE/
  // LOAD_PROFILE dispatches land on top of B's — the exact cross-store
  // corruption `handleSelectCase`'s `selectionRef` guard exists to prevent,
  // just reachable through a different button. Sharing the guarded function
  // closes it for both entry points at once.
  // Scoped to exactly the keys the CASE pins — not the whole store — so a
  // context override / situation field the case never mentions can't read as
  // drift, and a pinned key with no live override yet still reads as "not
  // drifted" (falls back to the case's own pinned value, mirroring
  // `BasicSituationView`'s own fallback just above).
  const liveContextOverrides: Record<string, unknown> = {}
  if (caseSetup) {
    const overrides = rs.contextOverrides as unknown as Record<string, unknown>
    for (const key of Object.keys(caseSetup.contextOverrides)) {
      liveContextOverrides[key] = key in overrides ? overrides[key] : caseSetup.contextOverrides[key]
    }
  }
  const liveSituationFields: Record<string, unknown> = {}
  if (caseSetup) {
    const situation = ps.world.situation as unknown as Record<string, unknown>
    for (const key of Object.keys(caseSetup.situationFields)) {
      liveSituationFields[key] = key in situation ? situation[key] : caseSetup.situationFields[key]
    }
  }
  const liveSnapshot: LiveSetupSnapshot = {
    scenarioId: rs.selectedScenarioId ?? '',
    routePresetId: selectedRoutePresetId ?? '',
    triggerPackageId: rs.selectedPackageId ?? '',
    servicePackageId: ps.servicePackageId ?? '',
    contentPackageId: ps.contentPackageId ?? '',
    seed: rs.runSeed,
    tickSeconds: rs.tickSecondsOverride ?? 180,
    initialDrowsiness: rs.initialDrowsiness,
    initialFatigue: rs.initialFatigue,
    profileRef: ps.selectedProfileId ?? '',
    contextOverrides: liveContextOverrides,
    situationFields: liveSituationFields,
    mountainRangeKm: mountainRange,
    jamRangeKm: jamRange,
  }
  const driftFields = caseSetup ? differsFromCase(caseSetup, liveSnapshot) : []

  // A test case DEFINES a setup. The moment the reviewer changes any part of
  // it, what is on screen is no longer that case, so the selection drops back
  // to "no test case" rather than mislabelling an edited setup with a case id.
  //
  // This is EDGE-triggered: matched-then-differs, never merely differs.
  // Applying a case is not atomic — the scenario, driver profile and route all
  // land separately — so a partially applied case reads exactly like an edited
  // one. Clearing on that would cancel the selection the reviewer just made,
  // and a case that could never fully apply would be marked modified the
  // moment it was picked. Requiring a clean match first makes the failure mode
  // "the case reads as unedited" rather than "every case reads as edited".
  const appliedCaseRef = useRef<string | null>(null)
  useEffect(() => {
    const caseId = selectedCase?.case_id ?? null
    if (!caseSetup || !caseId) { appliedCaseRef.current = null; return }
    if (driftFields.length === 0) { appliedCaseRef.current = caseId; return }
    if (appliedCaseRef.current !== caseId) return // still landing, not an edit
    if (caseModified) return // the parent already knows
    onCaseDrift?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSetup, selectedCase, driftFields.length, caseModified])

  // NOTE: there is no "Reset to case" action any more. Editing the setup now
  // clears the case selection outright, so re-picking the case from the picker
  // IS the reset — a second path would only duplicate `handleSelectCase`.

  return (
    <div data-testid="merged-setup-panel" className="setup-panel">
      <h2>{t(LABELS.setup, lang)}</h2>

      {/* ── Route ─────────────────────────────────────────────────────────── */}
      <label htmlFor="merged-route-preset-select" style={fieldLabel}>{t(LABELS.routePreset, lang)}</label>
      <select id="merged-route-preset-select" data-testid="merged-route-preset-select" style={selectStyle}
        value={selectedRoutePresetId ?? ''} onChange={(e) => handleSelectRoutePreset(e.target.value)}
        disabled={routePresets.length === 0 || loadingRoute}>
        <option value="">{routePresets.length === 0 ? t(LABELS.loading, lang) : t(LABELS.selectPreset, lang)}</option>
        {routePresets.map((p) => (
          <option key={p.id} value={p.id}>
            {t(p.label, lang)} {lang === 'ja' ? `（${p.distance_km} km）` : `(${p.distance_km} km)`}
          </option>
        ))}
      </select>
      <details style={{ marginTop: '6px' }} open={rs.mapsKey !== ''}>
        <summary style={{ fontSize: '0.8em', color: '#475569', cursor: 'pointer' }}>{t(LABELS.customRoute, lang)}</summary>
        <label htmlFor="merged-maps-key" style={fieldLabel}>{t(LABELS.mapsKey, lang)} {rs.mapsKey !== '' && <span style={{ color: '#16a34a', fontWeight: 400 }}>{t(LABELS.fromEnv, lang)}</span>}</label>
        <input id="merged-maps-key" data-testid="merged-maps-key" type="password" autoComplete="off" style={inputStyle} value={rs.mapsKey} onChange={(e) => runStore.dispatch({ type: 'SET_MAPS_KEY', key: e.target.value })} placeholder={t(LABELS.mapsKeyPlaceholder, lang)} />
        <label htmlFor="merged-maps-start" style={fieldLabel}>{t(LABELS.start, lang)}</label>
        <input id="merged-maps-start" type="text" style={inputStyle} value={mapsStart} onChange={(e) => setMapsStart(e.target.value)} placeholder={t(LABELS.startPlaceholder, lang)} />
        <label htmlFor="merged-maps-end" style={fieldLabel}>{t(LABELS.end, lang)}</label>
        <input id="merged-maps-end" type="text" style={inputStyle} value={mapsEnd} onChange={(e) => setMapsEnd(e.target.value)} placeholder={t(LABELS.endPlaceholder, lang)} />
        <button type="button" data-testid="merged-analyze-route" style={{ width: '100%', marginTop: '6px' }} disabled={analyzing} onClick={() => void handleAnalyzeMaps()}>
          {analyzing ? t(LABELS.analyzing, lang) : t(LABELS.analyzeRoute, lang)}
        </button>
        {mapsErrorMsg && <p role="alert" style={{ color: '#dc2626', fontSize: '0.8em' }}>{mapsErrorMsg}</p>}
      </details>
      {routeEnvelope && routeEnvelope.alternatives.length > 1 && (
        <div data-testid="merged-route-alternatives" style={{ marginTop: '6px' }}>
          {routeEnvelope.alternatives.map((alt) => (
            <label key={alt.route_id} style={{ display: 'flex', gap: '6px', fontSize: '0.8em', margin: '3px 0' }}>
              <input type="radio" name="merged-route-alt" checked={selectedRouteId === alt.route_id} onChange={() => setSelectedRouteId(alt.route_id)} />
              <span>{alt.summary}</span>
            </label>
          ))}
        </div>
      )}
      {chosenAlt && (
        <p style={summaryRow}>
          {chosenAlt.summary} — {t(routeEnvelope!.route_source === 'maps' ? LABELS.routeSourceMaps : LABELS.routeSourceLocal, lang)} · {totalKm.toFixed(0)} km
        </p>
      )}
      {/* The route is mirrored into the scoped runStore (above) so the CENTER
          panel's <MapSurface/> renders this route's map — the map is no longer
          shown in this left panel (owner layout). */}

      {/* Rest-spot filters + tick duration — the SAME controls as the Trigger
          screen (reused verbatim), reading/writing the scoped runStore that the
          center panel's rest-spot fetch + this panel's run-plan build read. */}
      <RestCeilingEditor />
      <RestSpacingEditor />
      <label htmlFor="merged-tick-seconds" style={fieldLabel}>{t(LABELS.tickDuration, lang)}</label>
      <input
        id="merged-tick-seconds"
        data-testid="merged-tick-seconds-input"
        type="number"
        min={1}
        step={1}
        style={inputStyle}
        value={rs.tickSecondsOverride ?? 180}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value))
          if (!Number.isNaN(n) && n >= 1) runStore.dispatch({ type: 'SET_TICK_SECONDS', seconds: n === 180 ? null : n })
        }}
      />

      {/* ── Situation & Scenario ──────────────────────────────────────────── */}
      <label htmlFor="merged-scenario-select" style={fieldLabel}>{t(LABELS.situationScenario, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-scenario-select" data-testid="merged-scenario-select" style={selectStyle} value={rs.selectedScenarioId ?? ''}
          onChange={(e) => e.target.value && runStore.dispatch({ type: 'SELECT_SCENARIO', id: e.target.value })} disabled={compatibleScenarios.length === 0}>
          <option value="">{compatibleScenarios.length === 0 ? t(LABELS.loading, lang) : t(LABELS.selectScenario, lang)}</option>
          {compatibleScenarios.map((s) => <option key={s.id} value={s.id}>{s.persona_label} — {s.review_focus}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-situation" onClick={() => setOpenEdit('situation')}>{t(LABELS.edit, lang)}</button>
        <SetupBadge kind="situation" lang={lang} />
      </div>

      {/* ── Driver profile (from the 32 presets) ──────────────────────────── */}
      <label htmlFor="merged-profile-select" style={fieldLabel}>{t(LABELS.driverProfile, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-profile-select" data-testid="merged-profile-select" style={selectStyle}
          value={profileOptions.length === 0 ? '' : profileIsAnOption ? storeProfileKey : EDITED_PROFILE_KEY}
          onChange={(e) => handleSelectProfile(e.target.value)} disabled={profileOptions.length === 0}>
          {profileOptions.length === 0 && <option value="">{t(LABELS.loading, lang)}</option>}
          {/* Field-editing the profile in the Edit popup makes it stop matching
              any of the 16 preset profiles. Naming it as edited is the honest
              readout; without this entry the browser falls back to displaying
              the FIRST option, i.e. it would name a profile that is not the one
              in force. */}
          {profileOptions.length > 0 && !profileIsAnOption && (
            <option value={EDITED_PROFILE_KEY}>{t(LABELS.editedProfile, lang)}</option>
          )}
          {profileOptions.map((o) => <option key={o.key} value={o.key}>{t(o.label, lang)}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-profile" onClick={() => setOpenEdit('profile')}>{t(LABELS.edit, lang)}</button>
        <SetupBadge kind="situation" lang={lang} />
      </div>

      {/* ── Trigger / Service / Content packages ──────────────────────────── */}
      <label htmlFor="merged-trigger-package-select" style={fieldLabel}>{t(LABELS.triggerPackage, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-trigger-package-select" data-testid="merged-trigger-package-select" style={selectStyle} value={rs.selectedPackageId ?? ''}
          onChange={(e) => e.target.value && runStore.dispatch({ type: 'SELECT_PACKAGE', id: e.target.value })} disabled={triggerPackages.length === 0}>
          <option value="">{triggerPackages.length === 0 ? t(LABELS.loading, lang) : t(LABELS.select, lang)}</option>
          {triggerPackages.map((p) => <option key={p.id} value={p.id}>{t(p.label, lang)} ({p.version})</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-trigger" onClick={() => setOpenEdit('trigger')}>{t(LABELS.edit, lang)}</button>
        <SetupBadge kind="algorithm" lang={lang} />
      </div>

      <label htmlFor="merged-service-package-select" style={fieldLabel}>{t(LABELS.servicePackage, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-service-package-select" data-testid="merged-service-package-select" style={selectStyle} value={ps.servicePackageId ?? ''}
          onChange={(e) => e.target.value && proposalStore.dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: e.target.value })} disabled={servicePackages.length === 0}>
          <option value="">{servicePackages.length === 0 ? t(LABELS.loading, lang) : t(LABELS.select, lang)}</option>
          {servicePackages.map((p) => <option key={p.id} value={p.id}>{t(p.label, lang)}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-service" onClick={() => setOpenEdit('service')}>{t(LABELS.edit, lang)}</button>
        <SetupBadge kind="algorithm" lang={lang} />
      </div>

      <label htmlFor="merged-content-package-select" style={fieldLabel}>{t(LABELS.contentPackage, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-content-package-select" data-testid="merged-content-package-select" style={selectStyle} value={ps.contentPackageId ?? ''}
          onChange={(e) => e.target.value && proposalStore.dispatch({ type: 'SET_CONTENT_PACKAGE', packageId: e.target.value })} disabled={contentPackages.length === 0}>
          <option value="">{contentPackages.length === 0 ? t(LABELS.loading, lang) : t(LABELS.select, lang)}</option>
          {contentPackages.map((p) => <option key={p.id} value={p.id}>{t(p.label, lang)}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-content" onClick={() => setOpenEdit('content')}>{t(LABELS.edit, lang)}</button>
        <SetupBadge kind="algorithm" lang={lang} />
      </div>

      {/* Explanation source (feature 019). Lives here rather than over the
          proposal output: it configures HOW the rationale sentence is produced,
          which is a setup choice, and the centre column is for what the product
          did. It drives both the service and content reasons. */}
      <label htmlFor="merged-explanation-provider-select" style={fieldLabel}>
        {t(LABELS.explanationSource, lang)}
      </label>
      <div style={rowStyle}>
        <select
          id="merged-explanation-provider-select"
          data-testid="merged-explanation-provider-select"
          style={selectStyle}
          value={ps.explanationProvider}
          onChange={(e) =>
            proposalStore.dispatch({
              type: 'SET_EXPLANATION_PROVIDER',
              provider: e.target.value as 'off' | 'backend' | 'browser',
            })
          }
        >
          <option value="off">{t(LABELS.explOff, lang)}</option>
          <option value="backend">{t(LABELS.explBackend, lang)}</option>
          <option value="browser">{t(LABELS.explBrowser, lang)}</option>
        </select>
        <SetupBadge kind="algorithm" lang={lang} />
      </div>

      {error && <ErrorNotice testid="merged-setup-error" message={error} onDismiss={() => setError(null)} />}
      <p style={{ fontSize: '0.72em', color: '#94a3b8', marginTop: '10px' }}>
        {isComplete ? t(LABELS.ready, lang) : t(LABELS.incomplete, lang)}
      </p>

      {/* ── Situation Edit popup (merged A/B/C fields, reused verbatim) ─────── */}
      <Modal open={openEdit === 'situation'} title={t(LABELS.situationTitle, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <DetailedToggle detailed={detailed} onToggle={() => setDetailed((d) => !d)} lang={lang} />
        {!detailed ? (
          <BasicSituationView
            caseSetup={caseSetup} rs={rs} ps={ps} scenarioDef={scenarioDef}
            dispatchRun={runStore.dispatch} dispatchProposal={proposalStore.dispatch} lang={lang}
          />
        ) : (
          <>
            <p style={{ ...summaryRow, color: '#64748b' }}>
              {t(LABELS.situationNote, lang)}
            </p>
            {scenarioDef ? (
              <>
                <div style={groupLabel}>{t(LABELS.groupFixed, lang)}</div>
                <FixedConditionsSection scenario={scenarioDef} hideTitle />
                <SituationFieldRows fields={SITUATION_FIELDS.filter((f) => MERGED_SITUATION_KEYS.includes(f.key))} />
                <p style={{ ...fieldLabel, marginTop: '14px' }}>{t(LABELS.routeConditions, lang).replace('{km}', totalKm.toFixed(0))}</p>
                <RouteConditionsPainter totalKm={totalKm} mountainRange={mountainRange} onMountainRangeChange={setMountainRange} jamRange={jamRange} onJamRangeChange={setJamRange} jamRangeFallback={scenarioJamRangesKm[0] ?? null} />
                <p style={{ fontSize: '0.72em', color: '#94a3b8', margin: '4px 0 0' }}>
                  {t(LABELS.jamSpeedNote, lang).replace('{kph}', String(jamSpeedKph))}
                </p>

                <div style={groupLabel}>{t(LABELS.groupSpeed, lang)}</div>
                <SpeedProfileSection scenario={scenarioDef} hideTitle />

                <div style={groupLabel}>{t(LABELS.groupSimulated, lang)}</div>
                <SimulatedSignalsSection scenario={scenarioDef} hideTitle />
              </>
            ) : <p style={summaryRow}>{t(LABELS.selectScenarioToEdit, lang)}</p>}
          </>
        )}
      </Modal>

      {/* ── Driver profile Edit popup (preference + history, reused verbatim) ── */}
      <Modal open={openEdit === 'profile'} title={t(LABELS.profileTitle, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <DetailedToggle detailed={detailed} onToggle={() => setDetailed((d) => !d)} lang={lang} />
        {!detailed
          ? <BasicProfileView caseSetup={caseSetup} selectedCase={selectedCase} presetLabelsById={presetLabelsById} lang={lang} />
          : <PreferenceHistorySection />}
      </Modal>

      {/* ── Package Edit popups (reused verbatim from Trigger / Proposal) ───── */}
      <Modal open={openEdit === 'trigger'} title={t(LABELS.triggerAlgorithm, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <DetailedToggle detailed={detailed} onToggle={() => setDetailed((d) => !d)} lang={lang} />
        {!detailed
          ? <BasicTriggerView manifest={triggerManifest} edited={rs.editedHyperparameters} dispatch={runStore.dispatch} lang={lang} />
          : <AlgorithmFormulationPanel />}
      </Modal>
      <Modal open={openEdit === 'service'} title={t(LABELS.servicePackage, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <DetailedToggle detailed={detailed} onToggle={() => setDetailed((d) => !d)} lang={lang} />
        {!detailed ? (
          <BasicServiceView
            manifest={selService} overrides={ps.serviceHyperparameterOverrides}
            parameterOverrides={ps.serviceParameterOverrides} dispatch={proposalStore.dispatch} lang={lang}
          />
        ) : selService ? <ServiceSetupSection manifest={selService} /> : <p style={summaryRow}>{t(LABELS.selectServiceFirst, lang)}</p>}
      </Modal>
      <Modal open={openEdit === 'content'} title={t(LABELS.contentPackage, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <DetailedToggle detailed={detailed} onToggle={() => setDetailed((d) => !d)} lang={lang} />
        {!detailed ? (
          <BasicContentView manifest={selContent} overrides={ps.contentHyperparameterOverrides} dispatch={proposalStore.dispatch} lang={lang} />
        ) : selContent ? <ContentSetupSection manifest={selContent} /> : <p style={summaryRow}>{t(LABELS.selectContentFirst, lang)}</p>}
      </Modal>
    </div>
  )
}
