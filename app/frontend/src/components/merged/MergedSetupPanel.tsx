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
import { SITUATION_FIELDS } from '../proposal/panels/sections/worldFields'
import {
  listRoutePresets, loadRoutePreset, routesAnalyze, listScenarios, listPackages, getScenario,
  createRunPlan,
} from '../../api/client'
import { MapsError } from '../../api/types'
import type {
  PackageSummary, ScenarioSummary, RoutePresetSummary, RouteAlternative, RouteEnvelope, ScenarioDef, SetupValue,
} from '../../api/types'
import { getPackages, getPreset, getPresets } from '../../api/proposalClient'
import type { ProposalPackageSummary, DriverProfile } from '../../api/proposalClient'
import { buildMergedPlan } from '../../api/mergedClient'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useRunStore } from '../../state/runStore'
import { useProposalStore } from '../../state/proposalStore'
import { useLanguage } from '../../state/language'
import { t, type BilingualLabel } from '../../i18n/t'
import RestCeilingEditor from '../setup/RestCeilingEditor'
import RestSpacingEditor from '../setup/RestSpacingEditor'

const DEFAULT_PRESET_ID = 'preset-journey-a-1-cruising-fresh'
type EditKey = 'situation' | 'profile' | 'trigger' | 'service' | 'content' | null

const LABELS = {
  setup: { ja: 'セットアップ', en: 'Setup' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  selectPreset: { ja: '— プリセットルートを選択 —', en: '— Select a preset route —' },
  select: { ja: '— 選択 —', en: '— Select —' },
  routePreset: { ja: 'ルートプリセット', en: 'Route preset' },
  customRoute: { ja: 'カスタムルート（Google マップ）', en: 'Custom route (Google Maps)' },
  mapsKey: { ja: 'マップ API キー', en: 'Maps API key' },
  fromEnv: { ja: '· 環境変数から', en: '· from environment' },
  mapsKeyPlaceholder: { ja: 'Google マップ API キー', en: 'Google Maps API key' },
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
  triggerPackage: { ja: 'トリガーパッケージ', en: 'Trigger package' },
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
  triggerAlgorithm: { ja: 'トリガーアルゴリズム', en: 'Trigger algorithm' },
  selectServiceFirst: { ja: 'まずサービスパッケージを選択してください。', en: 'Select a service package first.' },
  selectContentFirst: { ja: 'まずコンテンツパッケージを選択してください。', en: 'Select a content package first.' },
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

export default function MergedSetupPanel() {
  const coordinator = useMergedCoordinator()
  const runStore = useRunStore()
  const proposalStore = useProposalStore()
  const { lang } = useLanguage()
  const rs = runStore.state
  const ps = proposalStore.state

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
  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null)

  // The resolved ScenarioDef (for the trigger situation sections' defaults).
  const [scenarioDef, setScenarioDef] = useState<ScenarioDef | null>(null)

  // Situation paint bands (mountain / jam) — merged-screen-local (there is no
  // scenario JSON for these; painted onto the resolved route at build time).
  const [mountainRange, setMountainRange] = useState<KmRange | null>(null)
  const [jamRange, setJamRange] = useState<KmRange | null>(null)

  const [openEdit, setOpenEdit] = useState<EditKey>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load registries + seed both scoped stores (auto-select first of each) ───
  useEffect(() => {
    listRoutePresets()
      .then((r) => { setRoutePresets(r.presets); if (r.presets[0]) void handleSelectRoutePreset(r.presets[0].id) })
      .catch(() => setError('Failed to load route presets'))
    listScenarios()
      .then((r) => { setScenarios(r.scenarios); runStore.dispatch({ type: 'LOAD_SCENARIOS', scenarios: r.scenarios }) })
      .catch(() => setError('Failed to load scenarios'))
    listPackages()
      .then((r) => {
        setTriggerPackages(r.packages)
        runStore.dispatch({ type: 'LOAD_PACKAGES', packages: r.packages })
        if (r.packages[0]) runStore.dispatch({ type: 'SELECT_PACKAGE', id: r.packages[0].id })
      })
      .catch(() => setError('Failed to load trigger packages'))
    getPackages()
      .then((r) => {
        const svc = r.packages.filter((p) => p.family === 'service_selector')
        const cnt = r.packages.filter((p) => p.family === 'content_selector')
        setServicePackages(svc); if (svc[0]) proposalStore.dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: svc[0].id })
        setContentPackages(cnt); if (cnt[0]) proposalStore.dispatch({ type: 'SET_CONTENT_PACKAGE', packageId: cnt[0].id })
      })
      .catch(() => setError('Failed to load service/content packages'))
    // Seed the world (situation + driver_profile) from the default preset.
    loadDefaultPresetWorld().catch(() => setError('Failed to load default preset'))
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
    proposalStore.dispatch({ type: 'LOAD_PRESET', presetId: preset.preset_id, world: preset.world, overrides: preset.algorithm_config_overrides })
    setSelectedProfileKey(profileKey(preset.world.driver_profile))
  }

  async function loadPresetProfiles() {
    const { presets } = await getPresets()
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load route preset') } finally { setLoadingRoute(false) }
  }

  async function handleAnalyzeMaps() {
    setAnalyzing(true); setMapsErrorMsg(null)
    try {
      const env = await routesAnalyze({ scenarioId: rs.selectedScenarioId || undefined, mapsKey: rs.mapsKey || undefined, start: mapsStart || undefined, end: mapsEnd || undefined })
      setSelectedRoutePresetId(null); setRouteEnvelope(env); setSelectedRouteId(env.alternatives[0]?.route_id ?? null)
    } catch (err) { setMapsErrorMsg(err instanceof MapsError ? err.body.message : err instanceof Error ? err.message : 'Route analysis failed') } finally { setAnalyzing(false) }
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
    if (!opt) return
    setSelectedProfileKey(key)
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
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to start run'); return false }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, rs, ps, effectiveWorld, selectedRoutePresetId, routeEnvelope, selectedRouteId, mountainRange, jamRange, jamSpeedKph])

  // Auto-quickview (debounced) on ANY setup change, before a run exists.
  const hasRun = coordinator.state.mergedRunId != null
  useEffect(() => {
    if (!isComplete || hasRun) return
    const timer = setTimeout(() => {
      void coordinator.quickview({
        package_id: rs.selectedPackageId!, scenario_id: rs.selectedScenarioId!, route_preset_id: selectedRoutePresetId,
        run_seed: rs.runSeed, mountain_range_km: mountainRange, jam_range_km: jamRange, jam_speed_kph: jamSpeedKph,
        hyperparameter_overrides: rs.editedHyperparameters,
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
      ps.serviceParameterOverrides, ps.serviceHyperparameterOverrides, ps.contentParameterOverrides, ps.contentHyperparameterOverrides])

  // Issue 1: bridge the painted traffic-jam range (km) into the runStore so the
  // center panel's <MapSurface/> can draw it in red over the route. A zero-width
  // or unpainted range clears the overlay.
  useEffect(() => {
    const ranges: [number, number][] = jamRange && jamRange[1] > jamRange[0] ? [jamRange] : []
    runStore.dispatch({ type: 'SET_MERGED_JAM_RANGES', ranges })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jamRange])

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
    if (prevSetupSig.current === setupSignature) return
    prevSetupSig.current = setupSignature
    if (coordinator.state.mergedRunId != null || coordinator.state.running) {
      coordinator.reset()
    }
  }, [setupSignature, coordinator])

  const selService = servicePackages.find((p) => p.id === ps.servicePackageId) ?? null
  const selContent = contentPackages.find((p) => p.id === ps.contentPackageId) ?? null

  return (
    <div data-testid="merged-setup-panel" className="setup-panel">
      <h2>{t(LABELS.setup, lang)}</h2>

      {/* ── Route ─────────────────────────────────────────────────────────── */}
      <label htmlFor="merged-route-preset-select" style={fieldLabel}>{t(LABELS.routePreset, lang)}</label>
      <select id="merged-route-preset-select" data-testid="merged-route-preset-select" style={selectStyle}
        value={selectedRoutePresetId ?? ''} onChange={(e) => handleSelectRoutePreset(e.target.value)}
        disabled={routePresets.length === 0 || loadingRoute}>
        <option value="">{routePresets.length === 0 ? t(LABELS.loading, lang) : t(LABELS.selectPreset, lang)}</option>
        {routePresets.map((p) => <option key={p.id} value={p.id}>{t(p.label, lang)} ({p.distance_km} km, ~{p.duration_min} min)</option>)}
      </select>
      <details style={{ marginTop: '6px' }} open={rs.mapsKey !== ''}>
        <summary style={{ fontSize: '0.8em', color: '#475569', cursor: 'pointer' }}>{t(LABELS.customRoute, lang)}</summary>
        <label htmlFor="merged-maps-key" style={fieldLabel}>{t(LABELS.mapsKey, lang)} {rs.mapsKey !== '' && <span style={{ color: '#16a34a', fontWeight: 400 }}>{t(LABELS.fromEnv, lang)}</span>}</label>
        <input id="merged-maps-key" type="password" autoComplete="off" style={inputStyle} value={rs.mapsKey} onChange={(e) => runStore.dispatch({ type: 'SET_MAPS_KEY', key: e.target.value })} placeholder={t(LABELS.mapsKeyPlaceholder, lang)} />
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
      {chosenAlt && <p style={summaryRow}>{chosenAlt.summary} — {routeEnvelope!.route_source} · {totalKm.toFixed(0)} km</p>}
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
      </div>

      {/* ── Driver profile (from the 32 presets) ──────────────────────────── */}
      <label htmlFor="merged-profile-select" style={fieldLabel}>{t(LABELS.driverProfile, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-profile-select" data-testid="merged-profile-select" style={selectStyle} value={selectedProfileKey ?? ''}
          onChange={(e) => handleSelectProfile(e.target.value)} disabled={profileOptions.length === 0}>
          {profileOptions.length === 0 && <option value="">{t(LABELS.loading, lang)}</option>}
          {profileOptions.map((o) => <option key={o.key} value={o.key}>{t(o.label, lang)}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-profile" onClick={() => setOpenEdit('profile')}>{t(LABELS.edit, lang)}</button>
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
      </div>

      <label htmlFor="merged-service-package-select" style={fieldLabel}>{t(LABELS.servicePackage, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-service-package-select" data-testid="merged-service-package-select" style={selectStyle} value={ps.servicePackageId ?? ''}
          onChange={(e) => e.target.value && proposalStore.dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: e.target.value })} disabled={servicePackages.length === 0}>
          <option value="">{servicePackages.length === 0 ? t(LABELS.loading, lang) : t(LABELS.select, lang)}</option>
          {servicePackages.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-service" onClick={() => setOpenEdit('service')}>{t(LABELS.edit, lang)}</button>
      </div>

      <label htmlFor="merged-content-package-select" style={fieldLabel}>{t(LABELS.contentPackage, lang)}</label>
      <div style={rowStyle}>
        <select id="merged-content-package-select" data-testid="merged-content-package-select" style={selectStyle} value={ps.contentPackageId ?? ''}
          onChange={(e) => e.target.value && proposalStore.dispatch({ type: 'SET_CONTENT_PACKAGE', packageId: e.target.value })} disabled={contentPackages.length === 0}>
          <option value="">{contentPackages.length === 0 ? t(LABELS.loading, lang) : t(LABELS.select, lang)}</option>
          {contentPackages.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        <button type="button" style={editBtnStyle} data-testid="edit-content" onClick={() => setOpenEdit('content')}>{t(LABELS.edit, lang)}</button>
      </div>

      {error && <ErrorNotice testid="merged-setup-error" message={error} onDismiss={() => setError(null)} />}
      <p style={{ fontSize: '0.72em', color: '#94a3b8', marginTop: '10px' }}>
        {isComplete ? t(LABELS.ready, lang) : t(LABELS.incomplete, lang)}
      </p>

      {/* ── Situation Edit popup (merged A/B/C fields, reused verbatim) ─────── */}
      <Modal open={openEdit === 'situation'} title={t(LABELS.situationTitle, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <p style={{ ...summaryRow, color: '#64748b' }}>
          {t(LABELS.situationNote, lang)}
        </p>
        {scenarioDef ? (
          <>
            <div style={groupLabel}>{t(LABELS.groupFixed, lang)}</div>
            <FixedConditionsSection scenario={scenarioDef} hideTitle />
            <SituationFieldRows fields={SITUATION_FIELDS.filter((f) => MERGED_SITUATION_KEYS.includes(f.key))} />
            <p style={{ ...fieldLabel, marginTop: '14px' }}>{t(LABELS.routeConditions, lang).replace('{km}', totalKm.toFixed(0))}</p>
            <RouteConditionsPainter totalKm={totalKm} mountainRange={mountainRange} onMountainRangeChange={setMountainRange} jamRange={jamRange} onJamRangeChange={setJamRange} />
            <p style={{ fontSize: '0.72em', color: '#94a3b8', margin: '4px 0 0' }}>
              {t(LABELS.jamSpeedNote, lang).replace('{kph}', String(jamSpeedKph))}
            </p>

            <div style={groupLabel}>{t(LABELS.groupSpeed, lang)}</div>
            <SpeedProfileSection scenario={scenarioDef} hideTitle />

            <div style={groupLabel}>{t(LABELS.groupSimulated, lang)}</div>
            <SimulatedSignalsSection scenario={scenarioDef} hideTitle />
          </>
        ) : <p style={summaryRow}>{t(LABELS.selectScenarioToEdit, lang)}</p>}
      </Modal>

      {/* ── Driver profile Edit popup (preference + history, reused verbatim) ── */}
      <Modal open={openEdit === 'profile'} title={t(LABELS.profileTitle, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <PreferenceHistorySection />
      </Modal>

      {/* ── Package Edit popups (reused verbatim from Trigger / Proposal) ───── */}
      <Modal open={openEdit === 'trigger'} title={t(LABELS.triggerAlgorithm, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        <AlgorithmFormulationPanel />
      </Modal>
      <Modal open={openEdit === 'service'} title={t(LABELS.servicePackage, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        {selService ? <ServiceSetupSection manifest={selService} /> : <p style={summaryRow}>{t(LABELS.selectServiceFirst, lang)}</p>}
      </Modal>
      <Modal open={openEdit === 'content'} title={t(LABELS.contentPackage, lang)} size="wide" onClose={() => setOpenEdit(null)}>
        {selContent ? <ContentSetupSection manifest={selContent} /> : <p style={summaryRow}>{t(LABELS.selectContentFirst, lang)}</p>}
      </Modal>
    </div>
  )
}
