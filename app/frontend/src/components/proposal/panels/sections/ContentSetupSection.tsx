/**
 * ContentSetupSection — the STEP-2 content package's editable setup block
 * (Setting → Input preprocessing → Response coefficients → Weights → Advanced),
 * extracted VERBATIM from `ContentProposalPanel` (feature 020 extract-and-share)
 * so it can be reused on its own in the Combined Simulator's "Content package"
 * editor popup, without that panel's plan/preview machinery.
 *
 * Store-driven (useProposalStore): reads `contentHyperparameterOverrides`,
 * dispatches `SET_CONTENT_HYPERPARAMETER`. Takes the selected package `manifest`
 * as a prop (the parent owns package selection).
 */
import { t } from '../../../../i18n/t'
import { useProposalStore } from '../../../../state/proposalStore'
import type { ProposalPackageSummary } from '../../../../api/proposalClient'
import HyperparamMatrix from '../../HyperparamMatrix'
import ContentHierarchyTable from '../../ContentHierarchyTable'

const CONTENT_SETTING_KEYS = ['plan_item_count', 'fixed_humming_segment_sec', 'directional_hypothesis']
const CONTENT_PREPROCESSING_KEYS = ['norm_bounds', 'history_curves', 'age_era_affinity']
const CONTENT_RESPONSE_KEYS = ['trait_composition_matrix', 'context_response_matrix']
const CONTENT_WEIGHT_KEYS = ['content_category_weights', 'hierarchy_weights', 'purpose_multipliers']
const CONTENT_REMOVED_KEYS = ['parameter_set_version', 'formula_version', 'skip_exclusion_window_sec']

const LABELS = {
  settingSection: { ja: '設定', en: 'Setting' },
  preprocessingSection: { ja: '入力前処理・正規化', en: 'Input preprocessing / normalization' },
  responseSection: { ja: '応答係数', en: 'Response coefficients' },
  weightsSection: { ja: '重み', en: 'Weights' },
  advancedSection: { ja: '詳細設定', en: 'Advanced' },
}

export default function ContentSetupSection({ manifest }: { manifest: ProposalPackageSummary }) {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state

  const hpByKeys = (keys: string[]) => manifest.hyperparameters.filter((h) => keys.includes(h.key))
  const settingHps = hpByKeys(CONTENT_SETTING_KEYS)
  const preprocessingHps = hpByKeys(CONTENT_PREPROCESSING_KEYS)
  const responseHps = hpByKeys(CONTENT_RESPONSE_KEYS)
  const weightHps = hpByKeys(CONTENT_WEIGHT_KEYS)
  const groupedKeys = new Set([
    ...CONTENT_SETTING_KEYS,
    ...CONTENT_PREPROCESSING_KEYS,
    ...CONTENT_RESPONSE_KEYS,
    ...CONTENT_WEIGHT_KEYS,
    ...CONTENT_REMOVED_KEYS,
  ])
  const advancedHps = manifest.hyperparameters.filter((h) => !groupedKeys.has(h.key))

  const renderSubslabGroup = (hps: ProposalPackageSummary['hyperparameters']) =>
    hps.map((hp) => (
      <div key={hp.key} style={{ margin: '10px 0 4px' }}>
        <div style={subslabStyle}>
          <span data-testid="content-hp-kind-badge" style={kindBadgeStyle}>
            {hp.kind}
          </span>{' '}
          <code>{hp.key}</code> <span style={{ color: '#6b7280' }}>{t(hp.label, lang)}</span>
        </div>
        {hp.key === 'hierarchy_weights' ? (
          <ContentHierarchyTable
            value={
              (state.contentHyperparameterOverrides[hp.key] ?? hp.default) as Record<
                string,
                Record<string, { share?: number; leaves?: Record<string, { share?: number; mask?: number }> }>
              >
            }
            onChange={(value) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: hp.key, value })}
          />
        ) : (
          <HyperparamMatrix
            def={hp}
            value={state.contentHyperparameterOverrides[hp.key]}
            onChange={(value) => dispatch({ type: 'SET_CONTENT_HYPERPARAMETER', key: hp.key, value })}
            lang={lang}
            hideLabel
          />
        )}
      </div>
    ))

  return (
    <div data-testid="content-setup-section">
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

      {/* Advanced */}
      {advancedHps.length > 0 && (
        <details data-testid="content-advanced-hyperparameters" style={disclosureStyle}>
          <summary style={summaryStyle}>
            {t(LABELS.advancedSection, lang)} <span>{advancedHps.length}</span>
          </summary>
          <div style={{ padding: '4px 11px 11px' }}>{renderSubslabGroup(advancedHps)}</div>
        </details>
      )}
    </div>
  )
}

// ── Shared inline styles (copied from ContentProposalPanel) ──────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}
const grid2Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }
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
