/**
 * MergedSetupPanel — left setup panel for the Combined Simulator (020 Task
 * 8, replacing the Task-6 stub).
 *
 * Six collapsed summary buttons, each opening a `Modal` (Task 6) popup.
 * Slice-1 keeps only three FUNCTIONAL: Route, Scenario, Packages (trigger +
 * service + content). Driver Profile / Situation / Run show read-only
 * summaries of the default `World` fetched from a feature-018 proposal
 * preset — no editing surface yet (a later 020 task upgrades them).
 *
 * "Start run" does three network round-trips in sequence:
 *   (a) `POST /api/run-plans` (`client.ts` `createRunPlan`) from the
 *       selected route preset + scenario + trigger package + a locally
 *       generated numeric run seed → `plan_id`.
 *   (b) a default typed `World`, resolved from `proposalClient` via
 *       `getPreset(DEFAULT_PRESET_ID)` (the feature-018 reference journey
 *       preset), falling back to the first preset returned by `getPresets()`
 *       when that id isn't present. Fetched once on mount (so the read-only
 *       popups have something to show before Start is ever clicked) and
 *       reused here rather than re-fetched.
 *   (c) `useMergedCoordinator().create({ trigger_plan_id, world,
 *       service_package_id, content_package_id, run_seed })`.
 *
 * Deliberately standalone: does NOT import `useRunStore` or
 * `useProposalStore` (020 isolation constraint — see CLAUDE.md), so the
 * existing `PackageSelector`/`ScenarioSelector`/`MapKeyAndRouteInput`
 * components (all hard-wired to `useRunStore`) don't drop in here; this
 * panel uses its own plain `<select>`s (bare-select CSS convention) fed by
 * the SAME `client.ts`/`proposalClient` fetch functions instead.
 */
import { useEffect, useState } from 'react'
import Modal from './Modal'
import ErrorNotice from '../common/ErrorNotice'
import RouteConditionsPainter, { type KmRange } from './RouteConditionsPainter'
import {
  listRoutePresets,
  loadRoutePreset,
  listScenarios,
  listPackages,
  createRunPlan,
} from '../../api/client'
import type { PackageSummary, ScenarioSummary, RoutePresetSummary, RouteEnvelope } from '../../api/types'
import { getPackages, getPresets, getPreset } from '../../api/proposalClient'
import type { ProposalPackageSummary, World } from '../../api/proposalClient'
import { buildMergedPlan } from '../../api/mergedClient'
import { useMergedCoordinator } from '../../state/mergedCoordinator'

/** The feature-018 reference "journey A, stage 1" preset — the default
 * world a merged run starts from when the reviewer hasn't picked one
 * explicitly (slice-1 has no world-editing surface yet). */
const DEFAULT_PRESET_ID = 'preset-journey-a-1-cruising-fresh-monotonous'

type ModalKey = 'route' | 'scenario' | 'packages' | 'profile' | 'situation' | 'run' | null

const groupButtonStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  marginBottom: '6px',
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8em',
  color: '#666',
  marginBottom: '2px',
  marginTop: '8px',
}

const summaryRowStyle: React.CSSProperties = { fontSize: '0.82em', margin: '4px 0' }

export default function MergedSetupPanel() {
  const coordinator = useMergedCoordinator()

  const [openModal, setOpenModal] = useState<ModalKey>(null)

  // Route
  const [routePresets, setRoutePresets] = useState<RoutePresetSummary[]>([])
  const [selectedRoutePresetId, setSelectedRoutePresetId] = useState<string | null>(null)
  const [routeEnvelope, setRouteEnvelope] = useState<RouteEnvelope | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)
  // Route-conditions painter (Slice-2b Task 4): null means "not painted" —
  // Start keeps the existing plain createRunPlan path when both stay null.
  const [mountainRange, setMountainRange] = useState<KmRange | null>(null)
  const [jamRange, setJamRange] = useState<KmRange | null>(null)

  // Scenario
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)

  // Packages
  const [triggerPackages, setTriggerPackages] = useState<PackageSummary[]>([])
  const [selectedTriggerPackageId, setSelectedTriggerPackageId] = useState<string | null>(null)
  const [servicePackages, setServicePackages] = useState<ProposalPackageSummary[]>([])
  const [selectedServicePackageId, setSelectedServicePackageId] = useState<string | null>(null)
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])
  const [selectedContentPackageId, setSelectedContentPackageId] = useState<string | null>(null)

  // Default World (feeds the read-only Driver Profile / Situation popups AND "Start run")
  const [defaultWorld, setDefaultWorld] = useState<World | null>(null)

  // A single run seed, generated once per panel mount and reused for both
  // the trigger run-plan (numeric) and the merged create call (its string form).
  const [runSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000))

  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Quickview (feature 020, Slice-2c Task 5) — a dedicated button rather than
  // folding into "Start run": it's an ephemeral, non-persisting projection,
  // independent of mergedRunId/create(), so it must work standalone without
  // entangling with the Start flow's own two-round-trip sequencing/tests.
  const [runningQuickview, setRunningQuickview] = useState(false)

  useEffect(() => {
    listRoutePresets()
      .then((res) => setRoutePresets(res.presets))
      .catch(() => setError('Failed to load route presets'))
    listScenarios()
      .then((res) => setScenarios(res.scenarios))
      .catch(() => setError('Failed to load scenarios'))
    listPackages()
      .then((res) => setTriggerPackages(res.packages))
      .catch(() => setError('Failed to load trigger packages'))
    getPackages()
      .then((res) => {
        setServicePackages(res.packages.filter((p) => p.family === 'service_selector'))
        setContentPackages(res.packages.filter((p) => p.family === 'content_selector'))
      })
      .catch(() => setError('Failed to load service/content packages'))
    loadDefaultWorld()
      .then((world) => setDefaultWorld(world))
      .catch(() => setError('Failed to load default world'))
    // Intentionally run once on mount — the registries don't change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Resolve the default World from the feature-018 reference preset,
   * falling back to the first preset returned by `getPresets()` when the
   * reference id isn't present in this deployment. */
  async function loadDefaultWorld(): Promise<World> {
    try {
      const preset = await getPreset(DEFAULT_PRESET_ID)
      return preset.world
    } catch {
      const { presets } = await getPresets()
      if (presets.length === 0) throw new Error('No proposal presets available')
      const preset = await getPreset(presets[0].preset_id)
      return preset.world
    }
  }

  async function handleSelectRoutePreset(presetId: string) {
    setSelectedRoutePresetId(presetId)
    setLoadingRoute(true)
    setError(null)
    try {
      const envelope = await loadRoutePreset(presetId)
      setRouteEnvelope(envelope)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load route preset')
    } finally {
      setLoadingRoute(false)
    }
  }

  const compatibleScenarios = (() => {
    const pkg = triggerPackages.find((p) => p.id === selectedTriggerPackageId)
    return pkg ? scenarios.filter((s) => pkg.compatible_scenario_types.includes(s.type)) : scenarios
  })()

  async function handleStart() {
    if (
      !routeEnvelope ||
      !selectedScenarioId ||
      !selectedTriggerPackageId ||
      !selectedServicePackageId ||
      !selectedContentPackageId
    ) {
      setError('Select a route, scenario, and all three packages before starting.')
      return
    }
    setStarting(true)
    setError(null)
    try {
      let planId: string
      if (mountainRange || jamRange) {
        // A painter range is set — build a "painted" plan (Slice-2b Task 2)
        // instead of the plain run-plan path below.
        const painted = await buildMergedPlan({
          package_id: selectedTriggerPackageId,
          scenario_id: selectedScenarioId,
          route_preset_id: selectedRoutePresetId,
          run_seed: runSeed,
          mountain_range_km: mountainRange,
          jam_range_km: jamRange,
        })
        planId = painted.plan_id
      } else {
        const alt = routeEnvelope.alternatives[0]
        const plan = await createRunPlan({
          packageId: selectedTriggerPackageId,
          scenarioId: selectedScenarioId,
          routeId: alt.route_id,
          routeSource: routeEnvelope.route_source,
          routeFacts: alt.route_facts,
          displayRoute: alt.display,
          runSeed,
        })
        planId = plan.plan_id
      }
      const world = defaultWorld ?? (await loadDefaultWorld())
      await coordinator.create(
        {
          trigger_plan_id: planId,
          world,
          service_package_id: selectedServicePackageId,
          content_package_id: selectedContentPackageId,
          run_seed: String(runSeed),
        },
        // Local-only bookkeeping (never sent to the backend — see
        // mergedCoordinator's `create()` docstring): lets MergedCenterPanel's
        // rest-accept affordance later resolve `recovery_options` via
        // `getScenario(scenarioId)`, the same client RecoveryPicker uses.
        selectedScenarioId,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run')
    } finally {
      setStarting(false)
    }
  }

  /** Runs `coordinator.quickview()` — an ephemeral whole-chain projection
   * (feature 020, Slice-2c Task 5). Reuses the SAME selected scenario/package
   * ids and default `World` "Start run" does, but never calls
   * `createRunPlan`/`buildMergedPlan`/`coordinator.create` — the quickview
   * endpoint resolves its own route server-side from `route_preset_id`
   * (falling back to the scenario's local route when none is selected), so
   * no `routeEnvelope` round-trip is needed first. */
  async function handleQuickview() {
    if (
      !selectedScenarioId ||
      !selectedTriggerPackageId ||
      !selectedServicePackageId ||
      !selectedContentPackageId
    ) {
      setError('Select a scenario and all three packages before running a quickview.')
      return
    }
    setRunningQuickview(true)
    setError(null)
    try {
      const world = defaultWorld ?? (await loadDefaultWorld())
      await coordinator.quickview({
        package_id: selectedTriggerPackageId,
        scenario_id: selectedScenarioId,
        route_preset_id: selectedRoutePresetId,
        run_seed: runSeed,
        mountain_range_km: mountainRange,
        jam_range_km: jamRange,
        world,
        service_package_id: selectedServicePackageId,
        content_package_id: selectedContentPackageId,
        run_seed_proposal: String(runSeed),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run quickview')
    } finally {
      setRunningQuickview(false)
    }
  }

  const selectedRoutePreset = routePresets.find((p) => p.id === selectedRoutePresetId) ?? null
  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId) ?? null
  const selectedTriggerPackage = triggerPackages.find((p) => p.id === selectedTriggerPackageId) ?? null
  const selectedServicePackage = servicePackages.find((p) => p.id === selectedServicePackageId) ?? null
  const selectedContentPackage = contentPackages.find((p) => p.id === selectedContentPackageId) ?? null

  return (
    <div data-testid="merged-setup-panel">
      <h2>Setup</h2>

      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('route')}>
        Route{selectedRoutePreset ? `: ${selectedRoutePreset.label.en}` : ''}
      </button>
      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('scenario')}>
        Scenario{selectedScenario ? `: ${selectedScenario.persona_label}` : ''}
      </button>
      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('packages')}>
        Packages
        {selectedTriggerPackage || selectedServicePackage || selectedContentPackage ? ': configured' : ''}
      </button>
      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('profile')}>
        Driver Profile
      </button>
      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('situation')}>
        Situation
      </button>
      <button type="button" style={groupButtonStyle} onClick={() => setOpenModal('run')}>
        Run
      </button>

      {error && <ErrorNotice testid="merged-setup-error" message={error} onDismiss={() => setError(null)} />}

      <button
        type="button"
        data-testid="merged-start-run"
        style={{ width: '100%', marginTop: '10px' }}
        disabled={starting}
        onClick={handleStart}
      >
        {starting ? 'Starting…' : 'Start run'}
      </button>

      <button
        type="button"
        data-testid="merged-quickview-button"
        style={{ width: '100%', marginTop: '6px' }}
        disabled={runningQuickview}
        onClick={() => void handleQuickview()}
      >
        {runningQuickview ? 'Running quickview…' : 'Quickview'}
      </button>

      {/* ── Route ─────────────────────────────────────────────────────── */}
      <Modal open={openModal === 'route'} title="Route" onClose={() => setOpenModal(null)}>
        <label htmlFor="merged-route-preset-select" style={fieldLabelStyle}>
          Route preset
        </label>
        <select
          id="merged-route-preset-select"
          value={selectedRoutePresetId ?? ''}
          onChange={(e) => handleSelectRoutePreset(e.target.value)}
          disabled={routePresets.length === 0 || loadingRoute}
        >
          <option value="" disabled>
            {routePresets.length === 0 ? 'Loading…' : 'Select a route preset'}
          </option>
          {routePresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label.en} ({p.distance_km} km, ~{p.duration_min} min)
            </option>
          ))}
        </select>
        {routeEnvelope && (
          <p style={summaryRowStyle}>
            {routeEnvelope.alternatives[0]?.summary} — {routeEnvelope.route_source}
          </p>
        )}
        <RouteConditionsPainter
          totalKm={routeEnvelope?.alternatives[0]?.route_facts.total_route_distance_km ?? 100}
          mountainRange={mountainRange}
          onMountainRangeChange={setMountainRange}
          jamRange={jamRange}
          onJamRangeChange={setJamRange}
        />
      </Modal>

      {/* ── Scenario ──────────────────────────────────────────────────── */}
      <Modal open={openModal === 'scenario'} title="Scenario" onClose={() => setOpenModal(null)}>
        <label htmlFor="merged-scenario-select" style={fieldLabelStyle}>
          Scenario
        </label>
        <select
          id="merged-scenario-select"
          value={selectedScenarioId ?? ''}
          onChange={(e) => setSelectedScenarioId(e.target.value)}
          disabled={compatibleScenarios.length === 0}
        >
          <option value="" disabled>
            {compatibleScenarios.length === 0 ? 'Loading…' : 'Select a scenario'}
          </option>
          {compatibleScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.persona_label} — {s.review_focus}
            </option>
          ))}
        </select>
      </Modal>

      {/* ── Packages ──────────────────────────────────────────────────── */}
      <Modal open={openModal === 'packages'} title="Packages" onClose={() => setOpenModal(null)}>
        <label htmlFor="merged-trigger-package-select" style={fieldLabelStyle}>
          Trigger package
        </label>
        <select
          id="merged-trigger-package-select"
          value={selectedTriggerPackageId ?? ''}
          onChange={(e) => setSelectedTriggerPackageId(e.target.value)}
          disabled={triggerPackages.length === 0}
        >
          <option value="" disabled>
            {triggerPackages.length === 0 ? 'Loading…' : 'Select a trigger package'}
          </option>
          {triggerPackages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label.en} ({p.version})
            </option>
          ))}
        </select>

        <label htmlFor="merged-service-package-select" style={fieldLabelStyle}>
          Service package
        </label>
        <select
          id="merged-service-package-select"
          value={selectedServicePackageId ?? ''}
          onChange={(e) => setSelectedServicePackageId(e.target.value)}
          disabled={servicePackages.length === 0}
        >
          <option value="" disabled>
            {servicePackages.length === 0 ? 'Loading…' : 'Select a service package'}
          </option>
          {servicePackages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label.en} ({p.version})
            </option>
          ))}
        </select>

        <label htmlFor="merged-content-package-select" style={fieldLabelStyle}>
          Content package
        </label>
        <select
          id="merged-content-package-select"
          value={selectedContentPackageId ?? ''}
          onChange={(e) => setSelectedContentPackageId(e.target.value)}
          disabled={contentPackages.length === 0}
        >
          <option value="" disabled>
            {contentPackages.length === 0 ? 'Loading…' : 'Select a content package'}
          </option>
          {contentPackages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label.en} ({p.version})
            </option>
          ))}
        </select>
      </Modal>

      {/* ── Driver Profile (read-only summary, slice-1) ──────────────────── */}
      <Modal open={openModal === 'profile'} title="Driver Profile" onClose={() => setOpenModal(null)}>
        {defaultWorld ? (
          <>
            <p style={summaryRowStyle}>Age band: {defaultWorld.driver_profile.age_band}</p>
            <p style={summaryRowStyle}>Gender: {defaultWorld.driver_profile.gender}</p>
            <p style={summaryRowStyle}>
              Oshi: {defaultWorld.driver_profile.oshi_registered ? defaultWorld.driver_profile.oshi_mode : 'not registered'}
            </p>
          </>
        ) : (
          <p style={summaryRowStyle}>Loading default driver profile…</p>
        )}
      </Modal>

      {/* ── Situation (read-only summary, slice-1) ───────────────────────── */}
      <Modal open={openModal === 'situation'} title="Situation" onClose={() => setOpenModal(null)}>
        {defaultWorld ? (
          <>
            <p style={summaryRowStyle}>Drowsiness: {defaultWorld.situation.drowsiness_level}</p>
            <p style={summaryRowStyle}>Fatigue: {defaultWorld.situation.fatigue_level}</p>
            <p style={summaryRowStyle}>Traffic: {defaultWorld.situation.traffic_state}</p>
            <p style={summaryRowStyle}>Road type: {defaultWorld.situation.road_type}</p>
          </>
        ) : (
          <p style={summaryRowStyle}>Loading default situation…</p>
        )}
      </Modal>

      {/* ── Run (read-only summary, slice-1) ─────────────────────────────── */}
      <Modal open={openModal === 'run'} title="Run" onClose={() => setOpenModal(null)}>
        <p style={summaryRowStyle}>Run seed: {runSeed}</p>
        <p style={summaryRowStyle}>Proposal mode: interactive</p>
      </Modal>
    </div>
  )
}
