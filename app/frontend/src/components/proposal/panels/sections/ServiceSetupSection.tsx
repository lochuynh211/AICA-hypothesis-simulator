/**
 * ServiceSetupSection — the STEP-1 service package's editable setup block
 * (Setting → Input preprocessing → Response coefficients → Weights → Advanced),
 * extracted VERBATIM from `ServiceProposalPanel` (feature 020 extract-and-share)
 * so it can be reused on its own in the Combined Simulator's "Service package"
 * editor popup, without that panel's run/Choose machinery.
 *
 * Store-driven (useProposalStore): reads `serviceParameterOverrides` /
 * `serviceHyperparameterOverrides`, dispatches `SET_SERVICE_PARAMETER` /
 * `SET_SERVICE_HYPERPARAMETER`. Takes the selected package `manifest` as a prop
 * (the parent owns package selection).
 */
import { t } from '../../../../i18n/t'
import { useProposalStore } from '../../../../state/proposalStore'
import type { ProposalPackageSummary } from '../../../../api/proposalClient'
import HyperparamMatrix from '../../HyperparamMatrix'
import ResponseMatrixTable from '../../ResponseMatrixTable'
import HierarchyWeightsTable from '../../HierarchyWeightsTable'
import ScalarTable from '../../ScalarTable'

const LABELS = {
  maxCandidates: { ja: '最大候補数', en: 'max_candidates' },
  settingSection: { ja: '設定', en: 'Setting' },
  preprocessingSection: { ja: '入力前処理（γ・正規化）', en: 'Input preprocessing (γ / normalization)' },
  weightsSection: { ja: '重み', en: 'Weights' },
  advancedSection: { ja: '詳細設定', en: 'Advanced' },
  responseCoeffs: { ja: '応答係数（§5.2）', en: 'Response coefficients (§5.2)' },
  responseByFeature: { ja: '特徴量 × サービス', en: 'feature × service' },
  responseByRoad: { ja: '道路種別 × サービス', en: 'road × service' },
}

const PREPROCESSING_KEYS = [
  'gamma_drowsiness',
  'gamma_fatigue',
  'gamma_monotony',
  'route_tag_saturation',
  'destination_tag_saturation',
  'monotony_medium_min',
  'monotony_high_min',
]
const WEIGHT_KEYS = ['hierarchy_weights', 'purpose_multipliers']

export default function ServiceSetupSection({ manifest }: { manifest: ProposalPackageSummary }) {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state

  const topKValue = state.serviceParameterOverrides['top_k'] ?? manifest.parameters['top_k'] ?? 3

  const preprocessingHps = manifest.hyperparameters.filter((h) => PREPROCESSING_KEYS.includes(h.key))
  const weightHps = manifest.hyperparameters.filter((h) => WEIGHT_KEYS.includes(h.key))
  const advancedHps = manifest.hyperparameters.filter(
    (h) =>
      !PREPROCESSING_KEYS.includes(h.key) &&
      !WEIGHT_KEYS.includes(h.key) &&
      h.key !== 'response_coefficient_overrides',
  )

  return (
    <div data-testid="service-setup-section">
      {/* 1. Setting */}
      <div style={sectionLabelStyle}>{t(LABELS.settingSection, lang)}</div>
      <div style={grid2Style}>
        <label style={fieldLabelStyle}>
          {t(LABELS.maxCandidates, lang)}
          <input
            aria-label="max_candidates"
            type="number"
            value={Number(topKValue)}
            onChange={(e) => dispatch({ type: 'SET_SERVICE_PARAMETER', key: 'top_k', value: Number(e.target.value) })}
          />
        </label>
      </div>

      {/* 2. Input preprocessing (γ / normalization) */}
      {preprocessingHps.length > 0 && (
        <>
          <div style={sectionLabelStyle}>{t(LABELS.preprocessingSection, lang)}</div>
          <ScalarTable
            fields={preprocessingHps.map((hp) => ({
              key: hp.key,
              label: hp.label,
              value: (state.serviceHyperparameterOverrides[hp.key] ?? hp.default) as number,
              min: hp.min as number | undefined,
              max: hp.max as number | undefined,
              step: hp.step as number | undefined,
            }))}
            onChange={(key, value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key, value })}
            lang={lang}
          />
        </>
      )}

      {/* 3. Response coefficients (§5.2) */}
      {(manifest.parameters['service_response_profiles'] || manifest.parameters['road_response_profiles']) && (
        <>
          <div style={sectionLabelStyle}>{t(LABELS.responseCoeffs, lang)}</div>
          {manifest.parameters['service_response_profiles'] && (
            <>
              <div style={subslabStyle}>
                <span style={kindBadgeStyle}>matrix</span> <code>service_response_profiles</code>{' '}
                <span style={{ color: '#6b7280' }}>{t(LABELS.responseByFeature, lang)}</span>
              </div>
              <ResponseMatrixTable
                value={
                  (state.serviceParameterOverrides['service_response_profiles'] ??
                    manifest.parameters['service_response_profiles']) as Record<
                    string,
                    Record<string, { coefficient?: number; provenance?: string; source_reference?: string }>
                  >
                }
                onChange={(next) =>
                  dispatch({ type: 'SET_SERVICE_PARAMETER', key: 'service_response_profiles', value: next })
                }
                cornerLabel={t(LABELS.responseByFeature, lang)}
              />
            </>
          )}
          {manifest.parameters['road_response_profiles'] && (
            <>
              <div style={subslabStyle}>
                <span style={kindBadgeStyle}>matrix</span> <code>road_response_profiles</code>{' '}
                <span style={{ color: '#6b7280' }}>{t(LABELS.responseByRoad, lang)}</span>
              </div>
              <ResponseMatrixTable
                value={
                  (state.serviceParameterOverrides['road_response_profiles'] ??
                    manifest.parameters['road_response_profiles']) as Record<
                    string,
                    Record<string, { coefficient?: number; provenance?: string; source_reference?: string }>
                  >
                }
                onChange={(next) =>
                  dispatch({ type: 'SET_SERVICE_PARAMETER', key: 'road_response_profiles', value: next })
                }
                cornerLabel={t(LABELS.responseByRoad, lang)}
              />
            </>
          )}
        </>
      )}

      {/* 4. Weights */}
      {weightHps.length > 0 && (
        <>
          <div style={sectionLabelStyle}>{t(LABELS.weightsSection, lang)}</div>
          {weightHps.map((hp) => (
            <div key={hp.key} style={{ margin: '10px 0 4px' }}>
              <div style={subslabStyle}>
                <span data-testid="hp-kind-badge" style={kindBadgeStyle}>
                  {hp.kind}
                </span>{' '}
                <code>{hp.key}</code> <span style={{ color: '#6b7280' }}>{t(hp.label, lang)}</span>
              </div>
              {hp.key === 'hierarchy_weights' ? (
                <HierarchyWeightsTable
                  value={
                    (state.serviceHyperparameterOverrides[hp.key] ?? hp.default) as Record<
                      string,
                      {
                        share?: number
                        subgroups?: Record<string, { share?: number; leaves?: Record<string, { share?: number }> }>
                      }
                    >
                  }
                  onChange={(value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: hp.key, value })}
                />
              ) : (
                <HyperparamMatrix
                  def={hp}
                  value={state.serviceHyperparameterOverrides[hp.key]}
                  onChange={(value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: hp.key, value })}
                  lang={lang}
                  hideLabel
                />
              )}
            </div>
          ))}
        </>
      )}

      {/* Advanced (rarely changed) */}
      {advancedHps.length > 0 && (
        <details data-testid="advanced-hyperparameters" style={disclosureStyle}>
          <summary style={summaryStyle}>
            {t(LABELS.advancedSection, lang)} <span>{advancedHps.length}</span>
          </summary>
          <div style={{ padding: '4px 11px 11px' }}>
            {advancedHps.map((hp) => (
              <div key={hp.key} style={{ margin: '10px 0 4px' }}>
                <div style={subslabStyle}>
                  <span data-testid="hp-kind-badge" style={kindBadgeStyle}>
                    {hp.kind}
                  </span>{' '}
                  <code>{hp.key}</code> <span style={{ color: '#6b7280' }}>{t(hp.label, lang)}</span>
                </div>
                <HyperparamMatrix
                  def={hp}
                  value={state.serviceHyperparameterOverrides[hp.key]}
                  onChange={(value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: hp.key, value })}
                  lang={lang}
                  hideLabel
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ── Shared inline styles (copied from ServiceProposalPanel) ──────────────────

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
const subslabStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
  fontSize: '0.78em', fontWeight: 700, color: '#4b5563',
  borderTop: '1px dashed #e5e7eb', paddingTop: '6px', marginBottom: '4px',
}
const kindBadgeStyle: React.CSSProperties = {
  fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
  background: '#eef2ff', color: '#1d4ed8', border: '1px solid #c7d2fe',
  borderRadius: '999px', padding: '1px 7px',
}
