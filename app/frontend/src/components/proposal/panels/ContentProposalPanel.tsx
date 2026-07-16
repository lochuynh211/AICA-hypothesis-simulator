/**
 * ContentProposalPanel (P1 T028) — panel ③ Content proposal, STEP 2.
 *
 * Mirrors ServiceProposalPanel's structure for the chosen service: content
 * package + editable params/hyperparameters -> item_fit formulation -> the
 * SINGLE ordered plan (real P2 track ids; the real song title surfaces
 * inside each item's bilingual rationale sentence, not as a separate field
 * — see `packages/mock_content_selector_v1/algorithm.py`) with per-item
 * ReasonBreakdown, plan metadata, and excluded examples.
 *
 * CRITICAL INVARIANT (data-model.md): no aggregate plan score is ever
 * rendered here — exactly one ordered plan, never a ranked/scored plan list.
 *
 * Purely reactive to `proposalStore.runLog` — STEP 2 is triggered by
 * ServiceProposalPanel's "Choose" action, not by a button in this panel.
 */
import { useEffect, useState } from 'react'
import { t } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import { getPackages, type ProposalPackageSummary, type OrderedItem, type CompletePlan } from '../../../api/proposalClient'
import HyperparamMatrix from '../HyperparamMatrix'
import ReasonBreakdown, { type ReasonRow } from '../ReasonBreakdown'

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
};

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

  return (
    <section
      data-testid="content-panel"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}
    >
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f5f3ff',
          borderBottom: '1px solid #e5e7eb',
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

            <div style={sectionLabelStyle}>{t(LABELS.parameters, lang)}</div>
            <div style={grid2Style}>
              {Object.entries(manifest.parameters)
                .filter(([key]) => key !== 'note')
                .map(([key, defaultValue]) => {
                  if (typeof defaultValue === 'object') return null
                  const value = state.contentParameterOverrides[key] ?? defaultValue
                  return (
                    <label key={key} style={fieldLabelStyle}>
                      <code>{key}</code>
                      <input
                        type={typeof defaultValue === 'number' ? 'number' : 'text'}
                        value={String(value)}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_CONTENT_PARAMETER',
                            key,
                            value: typeof defaultValue === 'number' ? Number(e.target.value) : e.target.value,
                          })
                        }
                      />
                    </label>
                  )
                })}
            </div>

            {manifest.hyperparameters.length > 0 && (
              <details style={disclosureStyle}>
                <summary style={summaryStyle}>
                  {t(LABELS.hyperparameters, lang)} <span>{manifest.hyperparameters.length}</span>
                </summary>
                <div style={{ padding: '4px 11px 11px' }}>
                  {manifest.hyperparameters.map((hp) => (
                    <HyperparamMatrix
                      key={hp.key}
                      def={hp}
                      value={state.contentHyperparameterOverrides[hp.key]}
                      onChange={(value) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: hp.key, value })}
                      lang={lang}
                    />
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <div style={sectionLabelStyle}>{t(LABELS.formulation, lang)}</div>
        <div data-testid="content-formulation" style={formulaStyle}>
          item_fit = clamp( Σ wᵢ·eᵢ·aᵢ , −1, +1 )
        </div>
        <p style={whyStyle}>{t(LABELS.formulationWhy, lang)}</p>

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
          <p style={{ fontSize: '0.82em', color: '#b45309' }}>{t(LABELS.unsupported, lang)}</p>
        )}

        {plan && plan.ordered_items.length > 0 && (
          <>
            <div style={sectionLabelStyle}>{t(LABELS.orderedPlan, lang)}</div>
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
                  <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{item.item_id}</span>
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
                />
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
