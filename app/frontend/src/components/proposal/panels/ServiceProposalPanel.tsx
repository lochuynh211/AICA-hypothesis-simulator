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
  getSeed,
  createRun,
  selectService,
  type ProposalPackageSummary,
  type RankedCandidate,
  type ExcludedCandidate,
} from '../../../api/proposalClient'

/** Seed auto-loaded on screen open when `autoInit` is set (the P7 reference
 * journey). Selecting it, the two transparent packages, and auto-running
 * STEP 1 is what "Setup auto init" means (owner request 2026-07-17). */
const AUTO_INIT_SEED_ID = 'seed-night-highway-oshi'
import HyperparamMatrix from '../HyperparamMatrix'
import ReasonBreakdown, { type ReasonRow } from '../ReasonBreakdown'
import ServiceExplainability, { hasFeatureTrace } from '../ServiceExplainability'
import JourneyActionBar from '../JourneyActionBar'
import EventTimeline from '../EventTimeline'
import ModeToggle from '../ModeToggle'
import RecomputePanel from '../RecomputePanel'

const LABELS = {
  title: { ja: 'サービス提案', en: 'Service proposal' },
  step1: 'STEP 1',
  packageMode: { ja: 'パッケージ・モード', en: 'Package · Mode' },
  servicePkg: { ja: 'サービスPKG', en: 'Service pkg' },
  parameters: { ja: 'パラメータ（編集可）', en: 'Parameters (editable)' },
  hyperparameters: { ja: 'ハイパーパラメータ', en: 'Hyperparameters' },
  formulation: { ja: '数式・説明', en: 'Formulation' },
  formulationWhy: {
    ja: '各サービスの適合度は、重み wᵢ と応答 rᵢ（左の世界特徴量から算出）の重み付き総和。',
    en: "Each service's fit is the weighted sum of weight wᵢ and response rᵢ (derived from the world features at left).",
  },
  recommended: { ja: '推奨サービス（最大3件）', en: 'Recommended (≤3)' },
  run: { ja: '実行', en: 'Run' },
  choose: { ja: 'これを選ぶ', en: 'Choose' },
  selected: { ja: '選択中 → STEP 2 へ', en: 'Selected → to STEP 2' },
  noProposal: { ja: '候補なし（no_proposal）', en: 'No candidates (no_proposal)' },
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  // Task 5 — Choose is gated to content-backed services (CONTENT package's
  // `supported_services`); non-backed candidates get this note instead.
  outOfScope: { ja: 'V1対象外', en: 'Out of V1 scope' },
  // The service selector is still the P1 mock (real service ranking is a
  // later milestone) — P3c wires up the REAL content selector for STEP 2,
  // so this "mock data" marker is scoped to the service panel only; it no
  // longer applies to ContentProposalPanel (see ProposalShell — the badge
  // used to live in the shared header for both panels).
  mockBadge: { ja: 'モックデータ（P1土台）', en: 'MOCK DATA (P1 foundation)' },
  // P4 (US5, FR-022) — eligibility lists from the STEP-1 input_snapshot.
  eligibleTitle: { ja: '適格サービス', en: 'Eligible services' },
  excludedTitle: { ja: '除外サービス（理由コード）', en: 'Excluded services (reason codes)' },
  noneExcluded: { ja: 'なし', en: 'None' },
  // P7 (US5, FR-022) — current journey readout.
  journeyReadoutTitle: { ja: '現在のジャーニー状態', en: 'Current journey state' },
  lifecycleStage: { ja: 'ライフサイクル段階', en: 'Lifecycle stage' },
  motionState: { ja: '走行状態', en: 'Motion state' },
  allowedServices: { ja: '許可サービス', en: 'Allowed services' },
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

function serviceRows(candidate: RankedCandidate): ReasonRow[] {
  return candidate.feature_contributions.map((fc) => ({
    featureId: fc.feature_id,
    value: fc.feature_value,
    r: fc.response_coefficient,
    w: fc.weight,
    contribution: fc.contribution,
  }))
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
    origin?: { seedId?: string | null; cloneId?: string | null; profileId?: string | null },
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
        service_package_id: servicePackageId,
        content_package_id: contentPackageId,
        mode: state.mode,
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

  // "Setup auto init" (owner request): once the packages have loaded, load the
  // reference seed and auto-run STEP 1 AND STEP 2 exactly once — only in the
  // real app (`autoInit`), never in isolated panel tests (which omit the prop).
  // STEP 2 auto-selects the rank-1 service so the screen opens on a complete,
  // already-recommended plan.
  useEffect(() => {
    if (!autoInit || autoInitStarted.current) return
    if (servicePackages.length === 0 || contentPackages.length === 0) return
    if (state.runLog) return
    autoInitStarted.current = true
    ;(async () => {
      try {
        const seed = await getSeed(AUTO_INIT_SEED_ID)
        dispatch({ type: 'LOAD_SEED', seedId: AUTO_INIT_SEED_ID, world: seed.world })
        const log = await runWith(seed.world, servicePackages[0].id, contentPackages[0].id, {
          seedId: AUTO_INIT_SEED_ID,
          cloneId: null,
          profileId: null,
        })
        // Auto-run STEP 2 with the rank-1 service (unless quick_check mode
        // already selected content server-side on create).
        if (log && log.status === 'service_selected') {
          const svcEv = log.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
          const out = svcEv?.output as { ranked_candidates?: { candidate_id: string }[] } | undefined
          const rank1 = out?.ranked_candidates?.[0]?.candidate_id
          // Task 5 — never auto-choose a candidate the content package can't
          // actually serve (mirrors the manual Choose gate above).
          const backedIds = new Set<string>(contentPackages[0]?.supported_services ?? [])
          if (rank1 && backedIds.has(rank1)) await chooseWith(log.run_id, rank1)
        }
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInit, servicePackages, contentPackages])

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
        {/* P7 (US3/US5, FR-011) — interactive/quick_check, frozen for the run once created. */}
        <ModeToggle />

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
          <>
            <div style={sectionLabelStyle}>{t(LABELS.eligibleTitle, lang)}</div>
            <ul data-testid="eligible-list" style={eligibilityListStyle}>
              {eligibleCandidates.map(({ candidate_id }) => (
                <li key={candidate_id} data-testid={`eligible-${candidate_id}`}>
                  {candidate_id}
                </li>
              ))}
            </ul>

            <div style={sectionLabelStyle}>{t(LABELS.excludedTitle, lang)}</div>
            {excludedCandidates.length === 0 ? (
              <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noneExcluded, lang)}</p>
            ) : (
              <ul data-testid="excluded-list" style={eligibilityListStyle}>
                {excludedCandidates.map((excluded) => (
                  <li key={excluded.candidate_id} data-testid={`excluded-${excluded.candidate_id}`}>
                    {excluded.candidate_id} — <code>{excluded.platform_reason}</code>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {output && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.recommended, lang)}</div>
            {output.decision_type === 'no_proposal' && (
              <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noProposal, lang)}</p>
            )}
            {output.ranked_candidates.slice(0, 3).map((candidate) => {
              const isActive = candidate.candidate_id === activeServiceId
              const backed = contentBackedServices.has(candidate.candidate_id)
              return (
                <div
                  key={candidate.candidate_id}
                  data-testid={`candidate-card-${candidate.candidate_id}`}
                  style={{
                    border: isActive ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
                    borderRadius: '9px',
                    margin: '8px 0',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px' }}>
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '6px',
                        background: '#1d4ed8',
                        color: '#fff',
                        fontSize: '0.72em',
                        fontWeight: 800,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {candidate.rank}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{candidate.candidate_id}</span>
                    {candidate.score !== null && (
                      <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#1d4ed8' }}>
                        {candidate.score >= 0 ? '+' : ''}
                        {candidate.score.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <ReasonBreakdown
                    rows={serviceRows(candidate)}
                    supportingFeatureIds={candidate.supporting_feature_ids}
                    opposingFeatureIds={candidate.opposing_feature_ids}
                    rationale={candidate.rationale}
                    lang={lang}
                    variant="service"
                    showTable={!hasFeatureTrace(candidate)}
                  />
                  <ServiceExplainability candidate={candidate} lang={lang} />
                  <div
                    style={{
                      display: 'flex',
                      gap: '7px',
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderTop: '1px solid #e5e7eb',
                      background: '#f8fafc',
                    }}
                  >
                    {isActive ? (
                      <span
                        style={{
                          fontSize: '0.78em',
                          padding: '2px 9px',
                          borderRadius: '999px',
                          background: '#1d4ed8',
                          color: '#fff',
                        }}
                      >
                        {t(LABELS.selected, lang)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-testid={`choose-candidate-${candidate.candidate_id}`}
                      disabled={!backed || choosingId === candidate.candidate_id}
                      onClick={() => handleChoose(candidate.candidate_id)}
                      style={{
                        fontSize: '0.8em',
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: '7px',
                        border: '1px solid #1d4ed8',
                        background: !backed ? '#f1f5f9' : isActive ? '#fff' : '#1d4ed8',
                        color: !backed ? '#9ca3af' : isActive ? '#1d4ed8' : '#fff',
                        cursor: backed ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {choosingId === candidate.candidate_id ? '…' : t(LABELS.choose, lang)}
                    </button>
                    {!backed && (
                      <span
                        data-testid={`out-of-scope-${candidate.candidate_id}`}
                        style={{ fontSize: '0.72em', color: '#9ca3af' }}
                      >
                        {t(LABELS.outOfScope, lang)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {serviceEvidence?.error && (
          <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
            {t(LABELS.algorithmError, lang)}: {serviceEvidence.error.message}
          </p>
        )}

        {/* P7 (US5, FR-022) — the current lifecycle stage, motion state, and
            currently-allowed services, sourced straight from the backend's
            journey_state + head opportunity (never re-derived here). */}
        {state.runLog && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.journeyReadoutTitle, lang)}</div>
            <div data-testid="journey-readout" style={readoutRowStyle}>
              <span>
                {t(LABELS.lifecycleStage, lang)}:{' '}
                <b data-testid="readout-lifecycle-stage">{state.runLog.journey_state.lifecycle_stage}</b>
              </span>
              <span>
                {t(LABELS.motionState, lang)}:{' '}
                <b data-testid="readout-motion-state">{state.runLog.journey_state.motion_state}</b>
              </span>
              <span>
                {t(LABELS.allowedServices, lang)}:{' '}
                <b data-testid="readout-allowed-services">
                  {state.runLog.opportunity.allowed_service_ids.join(', ')}
                </b>
              </span>
            </div>
          </>
        )}

        {/* P4 (US5, FR-022) — the journey action bar + discrete-event
            timeline render the whole run's journey state/events, not just
            the STEP-1 candidates above; shown once a run exists. */}
        {state.runLog && (
          <>
            <JourneyActionBar />
            <RecomputePanel />
            <EventTimeline />
          </>
        )}

        {/* Setup (after the result, per owner request): the package dropdown +
            run result show first; parameters → hyperparameters → formulation
            follow below. */}
        {manifest && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.parameters, lang)}</div>
            <div style={grid2Style}>
              {Object.entries(manifest.parameters)
                .filter(([key]) => key !== 'note')
                // Object/array-valued params (the response-profile config maps)
                // are not text-editable fields — skip them so they never render
                // as "[object Object]" (mirrors ContentProposalPanel's guard).
                .filter(([, defaultValue]) => typeof defaultValue !== 'object' || defaultValue === null)
                .map(([key, defaultValue]) => {
                  const value = state.serviceParameterOverrides[key] ?? defaultValue
                  return (
                    <label key={key} style={fieldLabelStyle}>
                      <code>{key}</code>
                      <input
                        type={typeof defaultValue === 'number' ? 'number' : 'text'}
                        value={String(value ?? '')}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_SERVICE_PARAMETER',
                            key,
                            value: typeof defaultValue === 'number' ? Number(e.target.value) : e.target.value,
                          })
                        }
                      />
                    </label>
                  )
                })}
            </div>

            <details data-testid="hyperparameters-disclosure" style={disclosureStyle}>
              <summary style={summaryStyle}>
                {t(LABELS.hyperparameters, lang)} <span>{manifest.hyperparameters.length}</span>
              </summary>
              <div style={{ padding: '4px 11px 11px' }}>
                {manifest.hyperparameters.map((hp) => (
                  <HyperparamMatrix
                    key={hp.key}
                    def={hp}
                    value={state.serviceHyperparameterOverrides[hp.key]}
                    onChange={(value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: hp.key, value })}
                    lang={lang}
                  />
                ))}
              </div>
            </details>
          </>
        )}

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

const readoutRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  fontSize: '0.82em',
  color: '#4b5563',
  background: '#f8fafc',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '8px 11px',
  margin: '4px 0 8px',
}

const eligibilityListStyle: React.CSSProperties = {
  margin: '0 0 8px',
  padding: '0 0 0 18px',
  fontSize: '0.82em',
  color: '#4b5563',
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  fontSize: '0.82em',
  color: '#4b5563',
}

const disclosureStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  margin: '8px 0',
  background: '#f8fafc',
}

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  padding: '7px 11px',
  fontSize: '0.8em',
  fontWeight: 700,
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
