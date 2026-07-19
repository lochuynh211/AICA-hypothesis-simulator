/**
 * ServiceProposalPanel (P1 T027) — panel ② Service proposal, STEP 1.
 *
 * Self-contained setup + run + explain:
 *   package + mode picker -> editable Parameters (2-up) -> collapsible
 *   "Hyperparameters (advanced)" (HyperparamMatrix per hyperparameter) ->
 *   Formulation callout -> Run -> up to 3 ranked candidate cards, each with
 *   a ReasonBreakdown. Choosing a candidate calls `selectService` (STEP 2)
 *   and hands off to ContentProposalPanel via the shared `proposalStore`.
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import type { World, ProposalRunLog } from '../../../api/proposalClient'
import {
  getPackages,
  getPreset,
  createRun,
  selectService,
  type ProposalPackageSummary,
  type RankedCandidate,
  type ExcludedCandidate,
} from '../../../api/proposalClient'

/** Preset auto-loaded on screen open when `autoInit` is set. The proposal panel
 * is preset-first (the old Seed/Profile pickers were removed), so the screen
 * opens on a complete, already-recommended plan for a representative preset. */
const AUTO_INIT_PRESET_ID = 'preset-journey-a-1-cruising-fresh'
import { ServiceResultOverlay } from '../../merged/ServiceResultOverlay'
import ServiceSetupSection from './sections/ServiceSetupSection'

const LABELS = {
  title: { ja: 'サービス提案', en: 'Service proposal' },
  step1: 'STEP 1',
  packageMode: { ja: 'パッケージ・モード', en: 'Package · Mode' },
  servicePkg: { ja: 'サービスPKG', en: 'Service pkg' },
  parameters: { ja: 'パラメータ（編集可）', en: 'Parameters (editable)' },
  maxCandidates: { ja: '最大候補数', en: 'max_candidates' },
  hyperparameters: { ja: 'ハイパーパラメータ', en: 'Hyperparameters' },
  settingSection: { ja: '設定', en: 'Setting' },
  preprocessingSection: { ja: '入力前処理（γ・正規化）', en: 'Input preprocessing (γ / normalization)' },
  weightsSection: { ja: '重み', en: 'Weights' },
  advancedSection: { ja: '詳細設定', en: 'Advanced' },
  responseCoeffs: { ja: '応答係数（§5.2）', en: 'Response coefficients (§5.2)' },
  responseByFeature: { ja: '特徴量 × サービス', en: 'feature × service' },
  responseByRoad: { ja: '道路種別 × サービス', en: 'road × service' },
  formulation: { ja: '数式・説明', en: 'Formulation' },
  formulationWhy: {
    ja: '各サービスの適合度は、重み wᵢ と応答 rᵢ（左の世界特徴量から算出）の重み付き総和。',
    en: "Each service's fit is the weighted sum of weight wᵢ and response rᵢ (derived from the world features at left).",
  },
  run: { ja: '実行', en: 'Run' },
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  // The service selector is still the P1 mock (real service ranking is a
  // later milestone) — P3c wires up the REAL content selector for STEP 2,
  // so this "mock data" marker is scoped to the service panel only; it no
  // longer applies to ContentProposalPanel (see ProposalShell — the badge
  // used to live in the shared header for both panels).
  mockBadge: { ja: 'モックデータ（P1土台）', en: 'MOCK DATA (P1 foundation)' },
}

/** The subset of the STEP-1 evidence `input_snapshot` this panel reads (P4
 * contracts/journey-api.md "Eligibility"). The full snapshot is a plain
 * `Record<string, unknown>` (frozen `SelectorInput` shape) — this panel
 * never computes eligibility itself, only renders what the backend put in
 * the snapshot (Constitution I). */
type ServiceInputSnapshot = {
  // The frozen SelectorInput lists eligible candidates as objects
  // (`{candidate_id}`), NOT bare strings — mirrors excluded_candidates and the
  // backend's `_build_service_context`. Rendering the object directly is what
  // blanked the panel (React: "Objects are not valid as a React child").
  eligible_candidates?: { candidate_id: string }[]
  excluded_candidates?: ExcludedCandidate[]
}

export default function ServiceProposalPanel({ autoInit = false }: { autoInit?: boolean }) {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  const [servicePackages, setServicePackages] = useState<ProposalPackageSummary[]>([])
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])
  const [runSeed] = useState(() => `seed-${Math.random().toString(36).slice(2, 10)}`)
  const [running, setRunning] = useState(false)
  const [choosingId, setChoosingId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const autoInitStarted = useRef(false)

  useEffect(() => {
    let cancelled = false
    getPackages()
      .then((resp) => {
        if (cancelled) return
        const services = resp.packages.filter((p) => p.family === 'service_selector')
        const contents = resp.packages.filter((p) => p.family === 'content_selector')
        setServicePackages(services)
        setContentPackages(contents)
        if (services.length > 0 && !state.servicePackageId) {
          dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: services[0].id })
        }
        if (contents.length > 0 && !state.contentPackageId) {
          dispatch({ type: 'SET_CONTENT_PACKAGE', packageId: contents[0].id })
        }
      })
      .catch((e) => {
        if (!cancelled) setLocalError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // Intentionally run once on mount — package list doesn't change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const manifest = servicePackages.find((p) => p.id === state.servicePackageId) ?? servicePackages[0]

  // Task 5 — scope-gate: Choose is only enabled for services the CONTENT
  // package can actually serve content for (its `supported_services`), read
  // from the already-fetched `contentPackages` state — never hardcoded.
  const contentManifestForScope =
    contentPackages.find((p) => p.id === state.contentPackageId) ?? contentPackages[0]
  const contentBackedServices = new Set<string>(contentManifestForScope?.supported_services ?? [])

  /** Create + STEP 1 with explicit world/package ids. Both the Run button and
   * `autoInit` call this — the latter passes the freshly-fetched seed world
   * directly, so it never races the async `LOAD_SEED` state update. */
  async function runWith(
    world: World,
    servicePackageId: string,
    contentPackageId: string,
    // Explicit origin overrides. Needed by autoInit: it dispatches LOAD_SEED and
    // calls runWith in the SAME tick, so the state.selected* values captured by
    // this closure are still the pre-dispatch (null) values — passing the seed
    // id explicitly keeps the persisted SetupSnapshot.origin accurate.
    origin?: { seedId?: string | null; cloneId?: string | null; profileId?: string | null; presetId?: string | null },
  ): Promise<ProposalRunLog | null> {
    const pkg = servicePackages.find((p) => p.id === servicePackageId) ?? manifest
    if (!pkg) return null
    setRunning(true)
    setLocalError(null)
    try {
      const parameters: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(pkg.parameters)) {
        if (key === 'note') continue
        parameters[key] = state.serviceParameterOverrides[key] ?? value
      }
      const hyperparameters: Record<string, unknown> = {}
      for (const hp of pkg.hyperparameters) {
        hyperparameters[hp.key] = state.serviceHyperparameterOverrides[hp.key] ?? hp.default
      }

      const runLog = await createRun({
        trigger_purpose: world.control_inputs.trigger_purpose,
        lifecycle_stage: world.control_inputs.lifecycle_stage,
        motion_state: world.control_inputs.motion_state,
        world,
        origin_seed_id: origin?.seedId !== undefined ? origin.seedId : state.selectedSeedId,
        // Contrast clones were removed — there is no longer any store-tracked
        // clone selection, so this is always the explicit override (or null).
        origin_clone_id: origin?.cloneId ?? null,
        origin_profile_id: origin?.profileId !== undefined ? origin.profileId : state.selectedProfileId,
        // feature 018 — preset provenance + its isolated service-config delta
        // (merged server-side over the resolved service hyperparameters
        // before STEP 1). `presetOverrides` is undefined-coalesced so a run
        // with no preset selected sends no override at all.
        origin_preset_id: origin?.presetId !== undefined ? origin.presetId : state.selectedPresetId,
        algorithm_config_overrides: state.presetOverrides ?? undefined,
        service_package_id: servicePackageId,
        content_package_id: contentPackageId,
        mode: 'interactive',
        parameters,
        hyperparameters,
        run_seed: runSeed,
        simulation_time: new Date().toISOString(),
      })
      dispatch({ type: 'RUN_CREATED', runLog })
      return runLog
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setRunning(false)
    }
  }

  async function handleRun() {
    if (!manifest) return
    const contentPackageId = state.contentPackageId ?? contentPackages[0]?.id
    if (!contentPackageId) {
      setLocalError('No content_selector package available')
      return
    }
    await runWith(state.world, manifest.id, contentPackageId)
  }

  /** Run STEP 1 (service) then auto-select the rank-1 service for STEP 2
   * (content) — the consecutive "STEP 1 → STEP 2" flow shared by the on-open
   * auto-init and every preset selection. The STEP 2 auto-choose is gated to
   * services the content package can actually serve (mirrors the manual Choose
   * gate); quick_check mode may already have selected content on create. */
  async function runServiceThenContent(world: World, presetId: string | null) {
    const log = await runWith(world, servicePackages[0].id, contentPackages[0].id, {
      seedId: null,
      cloneId: null,
      profileId: null,
      presetId,
    })
    if (log && log.status === 'service_selected') {
      const svcEv = log.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
      const out = svcEv?.output as { ranked_candidates?: { candidate_id: string }[] } | undefined
      const rank1 = out?.ranked_candidates?.[0]?.candidate_id
      const backedIds = new Set<string>(contentPackages[0]?.supported_services ?? [])
      if (rank1 && backedIds.has(rank1)) await chooseWith(log.run_id, rank1)
    }
  }

  // "Setup auto init": on open (real app only — `autoInit`), load the reference
  // preset and run the first STEP 1 → STEP 2 explicitly, so the screen opens on
  // a complete, already-recommended plan. Every later change (a new preset, or
  // any edited field/parameter) flows through the live-recompute effect below.
  useEffect(() => {
    if (!autoInit || autoInitStarted.current) return
    if (servicePackages.length === 0 || contentPackages.length === 0) return
    if (state.runLog) return
    autoInitStarted.current = true
    ;(async () => {
      try {
        const preset = await getPreset(AUTO_INIT_PRESET_ID)
        dispatch({
          type: 'LOAD_PRESET',
          presetId: preset.preset_id,
          world: preset.world,
          overrides: preset.algorithm_config_overrides,
        })
        await runServiceThenContent(preset.world, preset.preset_id)
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInit, servicePackages, contentPackages])

  // LIVE RECOMPUTE — once a run exists, the panel re-runs STEP 1 → STEP 2
  // (debounced ~400ms) whenever ANY editable input changes: world fields
  // (situation / driver profile / trigger signal), the service parameters +
  // hyperparameters, the content parameters + hyperparameters, or the selected
  // preset. The reviewer never clicks Run or Choose. The first run itself is
  // explicit (auto-init on open, or the Run button in isolated use).

  // Mirrors `running` in a ref so the debounce timer reads the CURRENT value at
  // fire time (not the value captured when the timer was scheduled).
  const runningRef = useRef(running)
  useEffect(() => {
    runningRef.current = running
  }, [running])

  // A signature over every editable input; the recompute effect below is keyed
  // on it, so it fires exactly when one of these changes (never merely because
  // a run was created — that does not change the signature).
  const editableSignature = JSON.stringify({
    preset: state.selectedPresetId,
    world: state.world,
    serviceParams: state.serviceParameterOverrides,
    serviceHyper: state.serviceHyperparameterOverrides,
    contentParams: state.contentParameterOverrides,
    contentHyper: state.contentHyperparameterOverrides,
  })
  const didInitialRun = useRef(false)
  useEffect(() => {
    if (state.runLog) didInitialRun.current = true
  }, [state.runLog])

  useEffect(() => {
    // Only recompute for edits AFTER the first run exists.
    if (!state.runLog) return
    if (!didInitialRun.current) {
      didInitialRun.current = true
      return
    }
    if (servicePackages.length === 0 || contentPackages.length === 0) return
    const handle = setTimeout(() => {
      // If a run is in flight at fire time, skip rather than firing a second
      // concurrent run (matches the prior top_k-recompute behavior).
      if (runningRef.current) return
      void runServiceThenContent(state.world, state.selectedPresetId)
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableSignature])

  /** STEP 2 with an explicit runId (auto-init passes the just-created run's id
   * directly, avoiding the async `state.runLog` update race). */
  async function chooseWith(runId: string, serviceId: string) {
    setChoosingId(serviceId)
    setLocalError(null)
    try {
      // Resolve the CONTENT package's setup-time overrides (FR-002a) exactly
      // like handleRun resolves the service package's — the reviewer's edits
      // in ContentProposalPanel must actually be sent, not silently dropped.
      const contentManifest =
        contentPackages.find((p) => p.id === state.contentPackageId) ?? contentPackages[0]
      const contentParameters: Record<string, unknown> = {}
      if (contentManifest) {
        for (const [key, value] of Object.entries(contentManifest.parameters)) {
          if (key === 'note') continue
          contentParameters[key] = state.contentParameterOverrides[key] ?? value
        }
      }
      const contentHyperparameters: Record<string, unknown> = {}
      if (contentManifest) {
        for (const hp of contentManifest.hyperparameters) {
          contentHyperparameters[hp.key] = state.contentHyperparameterOverrides[hp.key] ?? hp.default
        }
      }

      const runLog = await selectService(runId, serviceId, {
        parameters: contentParameters,
        hyperparameters: contentHyperparameters,
        // feature 018 — the selected preset's isolated content-config delta,
        // merged server-side over the resolved content hyperparameters
        // before this STEP-2 dispatch. Omitted (not sent) when no preset is
        // selected — see selectService()'s own undefined-key handling.
        algorithm_config_overrides: state.presetOverrides ?? undefined,
      })
      if (runLog) {
        dispatch({ type: 'CONTENT_SELECTED', runLog })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setLocalError(message)
      // Also surface the failure on the shared store (RUN_CREATED/
      // CONTENT_SELECTED both clear it): a failed choose() never updates
      // `runLog` (the request never reached STEP 2), so ContentProposalPanel
      // has no other way to learn the attempt failed — see
      // `proposal_content_panel.test.tsx` (unsupported-service handling).
      dispatch({ type: 'SET_ERROR', message })
    } finally {
      setChoosingId(null)
    }
  }

  async function handleChoose(serviceId: string) {
    if (!state.runLog) return
    await chooseWith(state.runLog.run_id, serviceId)
  }

  const serviceEvidence = state.runLog?.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
  const output = serviceEvidence?.output as
    | { decision_type: string; ranked_candidates: RankedCandidate[] }
    | undefined
  const activeServiceId = state.runLog?.journey_state.active_service_id ?? null

  // P4 (US5) — eligible/excluded candidate lists from the frozen
  // input_snapshot; the platform reason code is rendered verbatim and no
  // score is ever shown alongside an exclusion.
  const inputSnapshot = (serviceEvidence?.input_snapshot ?? {}) as ServiceInputSnapshot
  const eligibleCandidates = inputSnapshot.eligible_candidates ?? []
  const excludedCandidates = inputSnapshot.excluded_candidates ?? []

  return (
    <section data-testid="service-panel" style={panelSectionStyle}>
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f8fafc',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '10px 10px 0 0',
          color: '#1d4ed8',
        }}
      >
        {'②'} <span>{t(LABELS.title, lang)}</span>{' '}
        <span style={{ color: '#6b7280', fontWeight: 500 }}>— {LABELS.step1}</span>{' '}
        <span
          data-testid="service-mock-badge"
          style={{
            fontSize: '0.66em',
            fontWeight: 800,
            letterSpacing: '0.05em',
            background: '#fffbeb',
            color: '#b45309',
            border: '1px solid #fcd34d',
            borderRadius: '999px',
            padding: '2px 9px',
            marginLeft: '6px',
          }}
        >
          {t(LABELS.mockBadge, lang)}
        </span>
      </h3>
      <div style={{ padding: '12px 14px' }}>
        <div style={sectionLabelStyle}>{t(LABELS.packageMode, lang)}</div>
        <div style={grid2Style}>
          <label style={fieldLabelStyle}>
            {t(LABELS.servicePkg, lang)}
            <select
              value={manifest?.id ?? ''}
              onChange={(e) => dispatch({ type: 'SET_SERVICE_PACKAGE', packageId: e.target.value })}
            >
              {servicePackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          data-testid="service-run-button"
          disabled={running || !manifest}
          onClick={handleRun}
          style={runButtonStyle}
        >
          {running ? '…' : t(LABELS.run, lang)}
        </button>

        {localError && (
          <p role="alert" style={{ color: '#dc2626', fontSize: '0.8em' }}>
            {localError}
          </p>
        )}

        {serviceEvidence && (
          <ServiceResultOverlay
            output={output}
            eligibleCandidates={eligibleCandidates}
            excludedCandidates={excludedCandidates}
            activeServiceId={activeServiceId}
            choosingId={choosingId}
            onChoose={handleChoose}
            isBacked={(candidateId) => contentBackedServices.has(candidateId)}
            runId={state.runLog?.run_id}
            explanationProvider={state.explanationProvider}
            lang={lang}
          />
        )}

        {serviceEvidence?.error && (
          <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
            {t(LABELS.algorithmError, lang)}: {serviceEvidence.error.message}
          </p>
        )}

        {/* Setup (after the result, per owner request): the package dropdown +
            run result show first; the editable setup section (Setting →
            Preprocessing → Response coefficients → Weights → Advanced) follows.
            Extracted to `ServiceSetupSection` so the Combined Simulator reuses
            the identical editors (feature 020). */}
        {manifest && <ServiceSetupSection manifest={manifest} />}

        <div style={sectionLabelStyle}>{t(LABELS.formulation, lang)}</div>
        <div data-testid="service-formulation" style={formulaStyle}>
          service_fit = clamp( Σ wᵢ·rᵢ , −1, +1 )
        </div>
        <p style={whyStyle}>{t(LABELS.formulationWhy, lang)}</p>
      </div>
    </section>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

// No `overflow: hidden` here: as a grid item it would get an automatic
// min-size of 0, collapsing the ProposalScreen grid row to the viewport and
// clipping all content (nothing scrolled). Letting the section keep its
// content min-height lets the grid grow and the screen scroll. The header's
// own top border-radius handles the rounded top corners instead.
const panelSectionStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const grid2Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  fontSize: '0.82em',
  color: '#4b5563',
}

const formulaStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.82em',
  background: '#eef2ff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '9px 12px',
  margin: '8px 0',
  overflowX: 'auto',
  whiteSpace: 'nowrap',
}

const whyStyle: React.CSSProperties = {
  margin: '8px 0',
  padding: '9px 12px',
  background: '#f8fafc',
  borderLeft: '3px solid #1d4ed8',
  borderRadius: '0 7px 7px 0',
  fontSize: '0.8em',
  color: '#4b5563',
}

const runButtonStyle: React.CSSProperties = {
  width: '100%',
  margin: '12px 0 4px',
  padding: '8px',
  fontSize: '0.86em',
  fontWeight: 700,
  borderRadius: '7px',
  border: '1px solid #1d4ed8',
  background: '#1d4ed8',
  color: '#fff',
  cursor: 'pointer',
}
