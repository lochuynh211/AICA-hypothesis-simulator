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
import { useEffect, useState } from 'react'
import { t } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import {
  getPackages,
  createRun,
  selectService,
  type ProposalPackageSummary,
  type RankedCandidate,
} from '../../../api/proposalClient'
import HyperparamMatrix from '../HyperparamMatrix'
import ReasonBreakdown, { type ReasonRow } from '../ReasonBreakdown'

const LABELS = {
  title: { ja: 'サービス提案', en: 'Service proposal' },
  step1: 'STEP 1',
  packageMode: { ja: 'パッケージ・モード', en: 'Package · Mode' },
  servicePkg: { ja: 'サービスPKG', en: 'Service pkg' },
  mode: { ja: 'モード', en: 'Mode' },
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

export default function ServiceProposalPanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  const [servicePackages, setServicePackages] = useState<ProposalPackageSummary[]>([])
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])
  const [runSeed] = useState(() => `seed-${Math.random().toString(36).slice(2, 10)}`)
  const [running, setRunning] = useState(false)
  const [choosingId, setChoosingId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

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

  async function handleRun() {
    if (!manifest) return
    setRunning(true)
    setLocalError(null)
    try {
      const parameters: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(manifest.parameters)) {
        if (key === 'note') continue
        parameters[key] = state.serviceParameterOverrides[key] ?? value
      }
      const hyperparameters: Record<string, unknown> = {}
      for (const hp of manifest.hyperparameters) {
        hyperparameters[hp.key] = state.serviceHyperparameterOverrides[hp.key] ?? hp.default
      }

      const contentPackageId = state.contentPackageId ?? contentPackages[0]?.id
      if (!contentPackageId) {
        throw new Error('No content_selector package available')
      }

      const runLog = await createRun({
        trigger_purpose: state.triggerPurpose,
        lifecycle_stage: state.lifecycleStage,
        motion_state: state.motionState,
        world_snapshot: {
          feature_snapshot: state.featureSnapshot,
          profile_id: state.selectedProfileId,
        },
        service_package_id: manifest.id,
        content_package_id: contentPackageId,
        mode: state.mode,
        parameters,
        hyperparameters,
        run_seed: runSeed,
        simulation_time: new Date().toISOString(),
      })
      dispatch({ type: 'RUN_CREATED', runLog })
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function handleChoose(serviceId: string) {
    if (!state.runLog) return
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

      const runLog = await selectService(state.runLog.run_id, serviceId, {
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

  const serviceEvidence = state.runLog?.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
  const output = serviceEvidence?.output as
    | { decision_type: string; ranked_candidates: RankedCandidate[] }
    | undefined
  const activeServiceId = state.runLog?.journey_state.active_service_id ?? null

  return (
    <section
      data-testid="service-panel"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}
    >
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f8fafc',
          borderBottom: '1px solid #e5e7eb',
          color: '#1d4ed8',
        }}
      >
        {'②'} <span>{t(LABELS.title, lang)}</span>{' '}
        <span style={{ color: '#6b7280', fontWeight: 500 }}>— {LABELS.step1}</span>
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
          <label style={fieldLabelStyle}>
            {t(LABELS.mode, lang)}
            <select value={state.mode} onChange={(e) => dispatch({ type: 'SET_MODE', mode: e.target.value })}>
              <option value="interactive">interactive</option>
              <option value="quick">quick</option>
            </select>
          </label>
        </div>

        {manifest && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.parameters, lang)}</div>
            <div style={grid2Style}>
              {Object.entries(manifest.parameters)
                .filter(([key]) => key !== 'note')
                .map(([key, defaultValue]) => {
                  const value = state.serviceParameterOverrides[key] ?? defaultValue
                  return (
                    <label key={key} style={fieldLabelStyle}>
                      <code>{key}</code>
                      <input
                        type={typeof defaultValue === 'number' ? 'number' : 'text'}
                        value={String(value)}
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

        {output && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.recommended, lang)}</div>
            {output.decision_type === 'no_proposal' && (
              <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noProposal, lang)}</p>
            )}
            {output.ranked_candidates.slice(0, 3).map((candidate) => {
              const isActive = candidate.candidate_id === activeServiceId
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
                        {candidate.score}
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
                  />
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
                      disabled={choosingId === candidate.candidate_id}
                      onClick={() => handleChoose(candidate.candidate_id)}
                      style={{
                        fontSize: '0.8em',
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: '7px',
                        border: '1px solid #1d4ed8',
                        background: isActive ? '#fff' : '#1d4ed8',
                        color: isActive ? '#1d4ed8' : '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {choosingId === candidate.candidate_id ? '…' : t(LABELS.choose, lang)}
                    </button>
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
      </div>
    </section>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

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
