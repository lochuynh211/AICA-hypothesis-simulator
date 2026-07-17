/**
 * ContentProposalPanel (P1 T028; wired to the REAL content selector in P3c
 * T035) — panel ③ Content proposal, STEP 2.
 *
 * Mirrors ServiceProposalPanel's structure for the chosen service: content
 * package + editable params/hyperparameters -> item_fit formulation -> the
 * SINGLE ordered plan (real P2 track ids; the real song title surfaces
 * inside each item's bilingual rationale sentence, not as a separate field)
 * with per-item ReasonBreakdown, plan metadata, and excluded examples. STEP 2
 * now dispatches the REAL `packages/aica_transparent_content_selector_v1`
 * package by default (routers/proposal.py T034) — a different driver
 * profile/situation therefore yields a visibly different plan; the P1 mock
 * package (`packages/mock_content_selector_v1`) remains selectable but is no
 * longer the default, and this panel renders whichever `CompletePlan` comes
 * back generically (it does not know or care which package produced it).
 *
 * CRITICAL INVARIANT (data-model.md): no aggregate plan score is ever
 * rendered here — exactly one ordered plan, never a ranked/scored plan list.
 * Every non-`complete_plan` outcome (`algorithm_error`, `unsupported_service`,
 * `no_proposal`, `insufficient_eligible_items`, ...) is rendered as an
 * explicit message — never a blank panel, never a fabricated plan.
 *
 * Purely reactive to `proposalStore.runLog` — STEP 2 is triggered by
 * ServiceProposalPanel's "Choose" action, not by a button in this panel.
 *
 * P7 (US4/US5, FR-017/FR-023) — also renders a "Preview next" control that
 * calls the read-only `GET /runs/{id}/journey/preview` and shows its steps
 * in a visually separate, clearly-labeled non-binding block: the preview
 * result is kept in LOCAL component state only (never dispatched into
 * `proposalStore`), so it can never be mistaken for — or accidentally
 * mutate — the run's actual committed state/record (FR-017).
 */
import { useEffect, useState } from 'react'
import { t } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import {
  getPackages,
  getDatasetCatalog,
  journeyPreview,
  type ProposalPackageSummary,
  type OrderedItem,
  type CompletePlan,
  type JourneyPreviewStep,
} from '../../../api/proposalClient'
import HyperparamMatrix from '../HyperparamMatrix'
import ReasonBreakdown, { type ReasonRow } from '../ReasonBreakdown'
import ContentExplainability, { hasContentExplainability } from '../ContentExplainability'

// Setup-section grouping (mirrors the service panel). Keys not listed anywhere
// fall to a collapsed "Advanced" disclosure; the removed keys are dropped.
const CONTENT_SETTING_KEYS = ['plan_item_count', 'fixed_humming_segment_sec', 'directional_hypothesis']
const CONTENT_PREPROCESSING_KEYS = ['norm_bounds', 'history_curves', 'age_era_affinity']
const CONTENT_RESPONSE_KEYS = ['trait_composition_matrix', 'context_response_matrix']
const CONTENT_WEIGHT_KEYS = ['content_category_weights', 'hierarchy_weights', 'purpose_multipliers']
const CONTENT_REMOVED_KEYS = ['parameter_set_version', 'formula_version', 'skip_exclusion_window_sec']

const LABELS = {
  title: { ja: 'コンテンツ提案', en: 'Content proposal' },
  step2: 'STEP 2',
  waiting: {
    ja: 'STEP 1 でサービスを選ぶとここにプランが表示されます。',
    en: 'Choose a service in STEP 1 to see its plan here.',
  },
  packageMode: { ja: 'パッケージ・モード', en: 'Package · Mode' },
  contentPkg: { ja: 'コンテンツPKG', en: 'Content pkg' },
  parameters: { ja: 'パラメータ（編集可）', en: 'Parameters (editable)' },
  hyperparameters: { ja: 'ハイパーパラメータ', en: 'Hyperparameters' },
  settingSection: { ja: '設定', en: 'Setting' },
  preprocessingSection: { ja: '入力前処理・正規化', en: 'Input preprocessing / normalization' },
  responseSection: { ja: '応答係数', en: 'Response coefficients' },
  weightsSection: { ja: '重み', en: 'Weights' },
  advancedSection: { ja: '詳細設定', en: 'Advanced' },
  formulation: { ja: '数式・説明', en: 'Formulation' },
  formulationWhy: {
    ja: '各曲の適合度は、証拠 eᵢ × 応答係数 aᵢ の重み付き総和。集計スコアや順位付きプランはありません——順序付きプラン1件のみ。',
    en: "Each song's fit is the weighted sum of evidence eᵢ × response aᵢ. No aggregate score, no ranked plans — exactly one ordered plan.",
  },
  orderedPlan: { ja: 'プラン（順序付き）', en: 'Ordered plan' },
  excluded: { ja: '除外例', en: 'Excluded examples' },
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  unsupported: { ja: '未対応サービス', en: 'Unsupported service' },
  selectUnsupported: {
    ja: '選択したサービス向けのコンテンツプランはありません（未対応のサービスです）。',
    en: 'No content plan is available for the selected service (unsupported service).',
  },
  selectFailed: { ja: 'サービス選択に失敗しました', en: 'Could not select this service' },
  // Honest non-complete_plan outcomes from the real transparent selector
  // (never a fabricated plan — Constitution II/V) — each decision_type is
  // shown as its own explicit, non-blank message instead of a silent gap.
  noProposal: {
    ja: '提案できるコンテンツがありません（no_proposal：全候補が除外されました）。',
    en: 'No content proposal is possible (no_proposal: every candidate was excluded).',
  },
  insufficientEligibleItems: {
    ja: '適格な候補が要求件数に満たないため、プランを生成できません。',
    en: 'Not enough eligible candidates to fill the requested plan size.',
  },
  invalidCatalog: {
    ja: 'カタログが不正です（invalid_catalog）。',
    en: 'The catalog is invalid for this request (invalid_catalog).',
  },
  invalidConfiguration: {
    ja: 'パッケージ設定が不正です（invalid_configuration）。',
    en: 'The package configuration is invalid (invalid_configuration).',
  },
  fullKaraokeRequiresStopped: {
    ja: 'フルカラオケは停止中のみ利用できます。',
    en: 'Full karaoke is only available while stopped.',
  },
  otherDecision: {
    ja: 'このリクエストに対するプランはありません。',
    en: 'No plan is available for this request.',
  },
  // P7 (US4/US5, FR-017/FR-023) — committed action vs non-binding preview.
  committedBadge: { ja: '確定済み', en: 'Committed' },
  previewSectionTitle: { ja: '先読み（非拘束）', en: 'Look-ahead (non-binding)' },
  previewButton: { ja: '次の内容をプレビュー', en: 'Preview next content' },
  previewBadge: {
    ja: '非拘束プレビュー（未確定・未コミット）',
    en: 'Non-binding preview — not committed',
  },
  previewEmpty: { ja: 'プレビューできる次のステップがありません。', en: 'No next step to preview.' },
};

const _NON_PLAN_DECISION_LABELS: Record<string, { ja: string; en: string }> = {
  no_proposal: LABELS.noProposal,
  insufficient_eligible_items: LABELS.insufficientEligibleItems,
  invalid_catalog: LABELS.invalidCatalog,
  invalid_configuration: LABELS.invalidConfiguration,
  full_karaoke_requires_stopped: LABELS.fullKaraokeRequiresStopped,
  invalid_request: LABELS.otherDecision,
  unsupported_recipe: LABELS.otherDecision,
}

function contentRows(item: OrderedItem): ReasonRow[] {
  return item.feature_contributions.map((fc) => ({
    featureId: fc.feature_id,
    value: fc.e_i,
    r: fc.a_i,
    w: fc.effective_weight,
    contribution: fc.contribution,
  }))
}

export default function ContentProposalPanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])
  const [previewSteps, setPreviewSteps] = useState<JourneyPreviewStep[] | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // item_id → song display name (issue #2). Fetched from the dataset catalog.
  const [songNames, setSongNames] = useState<Record<string, string>>({})

  const datasetId = state.world?.catalog_ref?.dataset_id
  useEffect(() => {
    if (!datasetId) return
    let cancelled = false
    getDatasetCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const song of resp.songs) map[song.id] = song.name
        setSongNames(map)
      })
      .catch(() => {
        if (!cancelled) setSongNames({})
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  async function handlePreview() {
    if (!state.runLog) return
    setPreviewPending(true)
    setPreviewError(null)
    try {
      // Read-only (FR-017): never touches `dispatch`/`proposalStore.runLog` —
      // the committed run is byte-identical before and after this call.
      const resp = await journeyPreview(state.runLog.run_id)
      setPreviewSteps(resp.steps)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewPending(false)
    }
  }

  // Clear any stale preview when the run itself changes (new run created, or
  // the committed state advanced via recompute/journey-action) — a preview
  // is only ever meaningful against the run state it was fetched against.
  useEffect(() => {
    setPreviewSteps(null)
    setPreviewError(null)
  }, [state.runLog?.run_id, state.runLog?.status, state.runLog?.opportunity.opportunity_id])

  useEffect(() => {
    let cancelled = false
    getPackages()
      .then((resp) => {
        if (!cancelled) setContentPackages(resp.packages.filter((p) => p.family === 'content_selector'))
      })
      .catch(() => {
        if (!cancelled) setContentPackages([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const manifest =
    contentPackages.find((p) => p.id === state.contentPackageId) ?? contentPackages[0]

  const contentEvidence = state.runLog?.evidence.filter((ev) => ev.step === 'content').slice(-1)[0]
  const plan = contentEvidence?.output as CompletePlan | undefined

  // Setup grouping (mirrors the service panel): Setting / Preprocessing /
  // Response coefficients / Weights, with an Advanced disclosure for the rest.
  const hpByKeys = (keys: string[]) => (manifest ? manifest.hyperparameters.filter((h) => keys.includes(h.key)) : [])
  const settingHps = hpByKeys(CONTENT_SETTING_KEYS)
  const preprocessingHps = hpByKeys(CONTENT_PREPROCESSING_KEYS)
  const responseHps = hpByKeys(CONTENT_RESPONSE_KEYS)
  const weightHps = hpByKeys(CONTENT_WEIGHT_KEYS)
  const _groupedKeys = new Set([
    ...CONTENT_SETTING_KEYS,
    ...CONTENT_PREPROCESSING_KEYS,
    ...CONTENT_RESPONSE_KEYS,
    ...CONTENT_WEIGHT_KEYS,
    ...CONTENT_REMOVED_KEYS,
  ])
  const advancedHps = manifest ? manifest.hyperparameters.filter((h) => !_groupedKeys.has(h.key)) : []

  const renderSubslabGroup = (hps: ProposalPackageSummary['hyperparameters']) =>
    hps.map((hp) => (
      <div key={hp.key} style={{ margin: '10px 0 4px' }}>
        <div style={subslabStyle}>
          <span data-testid="content-hp-kind-badge" style={kindBadgeStyle}>
            {hp.kind}
          </span>{' '}
          <code>{hp.key}</code> <span style={{ color: '#6b7280' }}>{t(hp.label, lang)}</span>
        </div>
        <HyperparamMatrix
          def={hp}
          value={state.contentHyperparameterOverrides[hp.key]}
          onChange={(value) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: hp.key, value })}
          lang={lang}
          hideLabel
        />
      </div>
    ))

  return (
    <section
      data-testid="content-panel"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px' }}
    >
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f5f3ff',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '10px 10px 0 0',
          color: '#7c3aed',
        }}
      >
        {'③'} <span>{t(LABELS.title, lang)}</span>{' '}
        <span style={{ color: '#6b7280', fontWeight: 500 }}>— {LABELS.step2}</span>
      </h3>
      <div style={{ padding: '12px 14px' }}>
        {manifest && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.packageMode, lang)}</div>
            <div style={grid2Style}>
              <label style={fieldLabelStyle}>
                {t(LABELS.contentPkg, lang)}
                <span style={rdonlyStyle}>{manifest.id}</span>
              </label>
              <label style={fieldLabelStyle}>
                {t({ ja: '方式', en: 'Approach' }, lang)}
                <span style={rdonlyStyle}>{manifest.approach}</span>
              </label>
            </div>
          </>
        )}

        {!state.runLog && (
          <p data-testid="content-waiting" style={{ fontSize: '0.82em', color: '#6b7280' }}>
            {t(LABELS.waiting, lang)}
          </p>
        )}

        {contentEvidence?.error && (
          <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
            {t(LABELS.algorithmError, lang)}: {contentEvidence.error.message}
          </p>
        )}

        {/* A STEP-2 select-service attempt that the backend rejected (e.g. HTTP
            422 unsupported_service, thrown before dispatch_selector ever runs —
            see routers/proposal.py's supported_services pre-check) never
            updates `runLog`, so this is surfaced via the shared store's
            `error` field (set by ServiceProposalPanel's handleChoose catch)
            rather than via `contentEvidence`. Rendered explicitly here so this
            panel never falls silent/blank on an unsupported-service request. */}
        {!contentEvidence?.error && state.error && (
          <p data-testid="content-select-error" role="alert" style={{ color: '#b45309', fontSize: '0.82em' }}>
            {state.error.toLowerCase().includes('unsupported_service')
              ? t(LABELS.selectUnsupported, lang)
              : `${t(LABELS.selectFailed, lang)}: ${state.error}`}
          </p>
        )}

        {plan && plan.decision_type === 'unsupported_service' && (
          <p data-testid="content-unsupported" style={{ fontSize: '0.82em', color: '#b45309' }}>
            {t(LABELS.unsupported, lang)}
          </p>
        )}

        {/* Every other honest non-complete_plan outcome (no_proposal,
            insufficient_eligible_items, invalid_catalog, invalid_configuration,
            full_karaoke_requires_stopped, ...) from the REAL content selector —
            never silently blank, never a fabricated plan. */}
        {plan && plan.decision_type !== 'unsupported_service' && plan.decision_type !== 'complete_plan' && (
          <p data-testid="content-no-plan" style={{ fontSize: '0.82em', color: '#b45309' }}>
            {t(_NON_PLAN_DECISION_LABELS[plan.decision_type] ?? LABELS.otherDecision, lang)}
          </p>
        )}

        {plan && plan.ordered_items.length > 0 && (
          <>
            <div style={sectionLabelStyle}>
              {t(LABELS.orderedPlan, lang)}{' '}
              <span data-testid="content-committed-badge" style={committedBadgeStyle}>
                {t(LABELS.committedBadge, lang)}
              </span>
            </div>
            {plan.ordered_items.map((item) => (
              <div
                key={item.item_id}
                data-testid={`plan-item-${item.item_id}`}
                style={{ border: '1px solid #e5e7eb', borderRadius: '9px', margin: '8px 0', overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px' }}>
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: '#7c3aed',
                      color: '#fff',
                      fontSize: '0.72em',
                      fontWeight: 800,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {item.position}
                  </span>
                  {/* Issue #2: song name first, id in brackets (id only when
                      the catalog hasn't resolved a name yet). */}
                  <span style={{ fontWeight: 700, fontSize: '0.86em' }}>
                    {songNames[item.item_id] ?? item.item_id}
                  </span>
                  {songNames[item.item_id] && (
                    <code style={{ fontSize: '0.72em', color: '#9ca3af' }}>({item.item_id})</code>
                  )}
                  {item.item_fit !== null && (
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#7c3aed' }}>
                      {item.item_fit >= 0 ? '+' : ''}
                      {item.item_fit}
                    </span>
                  )}
                </div>
                <ReasonBreakdown
                  rows={contentRows(item)}
                  supportingFeatureIds={[]}
                  opposingFeatureIds={[]}
                  rationale={item.rationale}
                  lang={lang}
                  variant="content"
                  showTable={!hasContentExplainability(item)}
                />
                <ContentExplainability item={item} lang={lang} />
              </div>
            ))}

            {plan.excluded_items.length > 0 && (
              <p data-testid="plan-excluded" style={{ fontSize: '0.76em', color: '#6b7280', marginTop: '8px' }}>
                <b>{t(LABELS.excluded, lang)}:</b>{' '}
                {plan.excluded_items.map((ex) => `${ex.item_id} (${ex.reason_codes.join(', ')})`).join('; ')}
              </p>
            )}

            <div data-testid="plan-metadata" style={planMetadataStyle}>
              mode={plan.mode.mode_kind} · duration≈{Math.round(plan.expected_duration_sec / 60)}min · lighting=
              {plan.lighting_configuration?.enabled ? plan.lighting_configuration.cue_basis ?? 'on' : 'n/a'} ·
              approval={plan.approval_policy} · completion_rule={plan.completion_rule}
            </div>
          </>
        )}

        {/* P7 (US4/US5, FR-017/FR-023) — the committed content (whatever was
            rendered above, from the persisted log) vs a non-binding preview
            of what would come next, kept visually + structurally separate:
            the preview is local-only state, never merged into the plan
            above and never dispatched into the shared run log. */}
        {state.runLog && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.previewSectionTitle, lang)}</div>
            <button
              type="button"
              data-testid="content-preview-button"
              disabled={previewPending}
              onClick={handlePreview}
              style={previewButtonStyle}
            >
              {previewPending ? '…' : t(LABELS.previewButton, lang)}
            </button>
            {previewError && (
              <p role="alert" data-testid="content-preview-error" style={{ color: '#dc2626', fontSize: '0.8em' }}>
                {previewError}
              </p>
            )}
            {previewSteps && (
              <div data-testid="content-preview-panel" style={previewPanelStyle}>
                <span data-testid="content-preview-badge" style={previewBadgeStyle}>
                  {t(LABELS.previewBadge, lang)}
                </span>
                {previewSteps.length === 0 ? (
                  <p style={{ fontSize: '0.78em', color: '#6b7280', margin: '6px 0 0' }}>
                    {t(LABELS.previewEmpty, lang)}
                  </p>
                ) : (
                  <ul style={{ margin: '6px 0 0', padding: '0 0 0 18px', fontSize: '0.78em', color: '#4b5563' }}>
                    {previewSteps.map((step, index) => (
                      <li key={`${step.label}-${index}`} data-testid={`content-preview-step-${index}`}>
                        {step.label} — {step.lifecycle_stage}
                        {step.note ? ` (${step.note})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {/* Setup (after the result, per owner request): package readout + plan
            show first; parameters → hyperparameters → formulation follow. */}
        {manifest && (
          <>
            {/* 1. Setting */}
            {settingHps.length > 0 && (
              <>
                <div style={sectionLabelStyle}>{t(LABELS.settingSection, lang)}</div>
                <div style={grid2Style}>
                  {settingHps.map((hp) => (
                    <HyperparamMatrix
                      key={hp.key}
                      def={hp}
                      value={state.contentHyperparameterOverrides[hp.key]}
                      onChange={(value) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: hp.key, value })}
                      lang={lang}
                    />
                  ))}
                </div>
              </>
            )}

            {/* 2. Input preprocessing / normalization */}
            {preprocessingHps.length > 0 && (
              <>
                <div style={sectionLabelStyle}>{t(LABELS.preprocessingSection, lang)}</div>
                {renderSubslabGroup(preprocessingHps)}
              </>
            )}

            {/* 3. Response coefficients */}
            {responseHps.length > 0 && (
              <>
                <div style={sectionLabelStyle}>{t(LABELS.responseSection, lang)}</div>
                {renderSubslabGroup(responseHps)}
              </>
            )}

            {/* 4. Weights */}
            {weightHps.length > 0 && (
              <>
                <div style={sectionLabelStyle}>{t(LABELS.weightsSection, lang)}</div>
                {renderSubslabGroup(weightHps)}
              </>
            )}

            {/* Advanced — leftover knobs (e.g. genre_affinity_maps, lighting_lookup);
                parameter_set_version / formula_version / skip_exclusion_window_sec dropped. */}
            {advancedHps.length > 0 && (
              <details data-testid="content-advanced-hyperparameters" style={disclosureStyle}>
                <summary style={summaryStyle}>
                  {t(LABELS.advancedSection, lang)} <span>{advancedHps.length}</span>
                </summary>
                <div style={{ padding: '4px 11px 11px' }}>{renderSubslabGroup(advancedHps)}</div>
              </details>
            )}
          </>
        )}

        <div style={sectionLabelStyle}>{t(LABELS.formulation, lang)}</div>
        <div data-testid="content-formulation" style={formulaStyle}>
          item_fit = clamp( Σ wᵢ·eᵢ·aᵢ , −1, +1 )
        </div>
        <p style={whyStyle}>{t(LABELS.formulationWhy, lang)}</p>
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

const rdonlyStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.9em',
  color: '#4b5563',
  background: '#f1f5f9',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '2px 8px',
}

const disclosureStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  margin: '8px 0',
  background: '#f5f3ff',
}

const subslabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexWrap: 'wrap',
  fontSize: '0.78em',
  fontWeight: 700,
  color: '#4b5563',
  borderTop: '1px dashed #e5e7eb',
  paddingTop: '6px',
  marginBottom: '4px',
}

const kindBadgeStyle: React.CSSProperties = {
  fontSize: '0.68em',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: '#f5f3ff',
  color: '#7c3aed',
  border: '1px solid #ddd6fe',
  borderRadius: '999px',
  padding: '1px 7px',
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
  background: '#f5f3ff',
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
  borderLeft: '3px solid #7c3aed',
  borderRadius: '0 7px 7px 0',
  fontSize: '0.8em',
  color: '#4b5563',
}

const planMetadataStyle: React.CSSProperties = {
  marginTop: '10px',
  fontFamily: 'monospace',
  fontSize: '0.78em',
  color: '#4b5563',
  background: '#f5f3ff',
  border: '1px solid #e5e7eb',
  borderRadius: '7px',
  padding: '6px 10px',
}

const committedBadgeStyle: React.CSSProperties = {
  fontSize: '0.66em',
  fontWeight: 800,
  letterSpacing: '0.05em',
  background: '#ecfdf5',
  color: '#059669',
  border: '1px solid #6ee7b7',
  borderRadius: '999px',
  padding: '2px 9px',
}

const previewButtonStyle: React.CSSProperties = {
  fontSize: '0.8em',
  fontWeight: 700,
  padding: '6px 13px',
  borderRadius: '7px',
  border: '1px dashed #7c3aed',
  background: '#fff',
  color: '#7c3aed',
  cursor: 'pointer',
}

const previewPanelStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '8px 11px',
  border: '1px dashed #a78bfa',
  borderRadius: '8px',
  background: '#faf5ff',
}

const previewBadgeStyle: React.CSSProperties = {
  fontSize: '0.66em',
  fontWeight: 800,
  letterSpacing: '0.05em',
  background: '#fef3c7',
  color: '#92400e',
  border: '1px solid #fcd34d',
  borderRadius: '999px',
  padding: '2px 9px',
}
