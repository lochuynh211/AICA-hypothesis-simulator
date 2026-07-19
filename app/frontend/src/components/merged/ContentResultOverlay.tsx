/**
 * ContentResultOverlay (020 Task 10) — the docked STEP-2 result view for the
 * Combined Simulator: the algorithm-error / unsupported-service / other
 * non-plan-decision messages, and — on a `complete_plan` — the ordered plan
 * (per-item ReasonBreakdown, ContentExplainability, excluded examples, plan
 * metadata). Extracted verbatim from ContentProposalPanel's RESULT region so
 * BOTH the original proposal-screen panel AND the merged center dock render
 * the identical markup from one source (true DRY — see 020 Task 10 brief).
 *
 * CRITICAL INVARIANT (data-model.md): no aggregate plan score is ever
 * rendered here — exactly one ordered plan, never a ranked/scored plan list.
 *
 * Pure presentational: props only, no store coupling.
 */
import { t } from '../../i18n/t'
import { fitBand } from '../../lib/fitBand'
import type { CompletePlan, EvidenceError, OrderedItem, ProposalRunLog } from '../../api/proposalClient'
import ReasonBreakdown, { type ReasonRow } from '../proposal/ReasonBreakdown'
import ContentExplainability, { hasContentExplainability } from '../proposal/ContentExplainability'
import { useExplanation, type ExplanationProvider } from '../proposal/useExplanation'

const LABELS = {
  orderedPlan: { ja: 'プラン（順序付き）', en: 'Ordered plan' },
  excluded: { ja: '除外例', en: 'Excluded examples' },
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  unsupported: { ja: '未対応サービス', en: 'Unsupported service' },
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
  committedBadge: { ja: '確定済み', en: 'Committed' },
  fitBand: { ja: '適合', en: 'fit' },
  fitBandTitle: {
    ja: '0〜100の目安スコア = (raw + 1) × 50。生スコアの表示用変換であり、判定には使用しません。',
    en: 'A friendlier 0-100 band = (raw + 1) × 50. A display transform of the raw score only — never used in scoring.',
  },
}

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

/** One plan item's ReasonBreakdown, wired to the explanation hook (own
 * component so the per-item hook obeys the rules of hooks inside the `.map()`).
 * Provider 'off' → inert hook, deterministic template shows. */
function ContentReason({
  item,
  runId,
  provider,
  lang,
  inlineProposal,
}: {
  item: OrderedItem
  runId: string | undefined
  provider: ExplanationProvider
  lang: 'ja' | 'en'
  inlineProposal?: ProposalRunLog | null
}) {
  const { ai, request } = useExplanation(runId, 'content', item.item_id, provider, lang, inlineProposal)
  return (
    <ReasonBreakdown
      rows={contentRows(item)}
      supportingFeatureIds={[]}
      opposingFeatureIds={[]}
      rationale={item.rationale}
      lang={lang}
      variant="content"
      showTable={!hasContentExplainability(item)}
      aiExplanation={ai}
      onExpand={request}
    />
  )
}

export function ContentResultOverlay(props: {
  plan?: CompletePlan
  error?: EvidenceError
  songNames: Record<string, string>
  runId?: string
  explanationProvider: ExplanationProvider
  /** An EPHEMERAL proposal (quickview/after-nap projection) to explain inline —
   * feature 020. Undefined for a persisted run (uses the run-id endpoint). */
  inlineProposal?: ProposalRunLog | null
  lang: 'ja' | 'en'
}) {
  const { plan, error, songNames, runId, explanationProvider, inlineProposal, lang } = props

  return (
    <>
      {error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {t(LABELS.algorithmError, lang)}: {error.message}
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
                {/* song name first, id in brackets (id only when the catalog
                    hasn't resolved a name yet). */}
                <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{songNames[item.item_id] ?? item.item_id}</span>
                {songNames[item.item_id] && (
                  <code style={{ fontSize: '0.72em', color: '#9ca3af' }}>({item.item_id})</code>
                )}
                {item.item_fit !== null && (
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#7c3aed' }}>
                    {item.item_fit >= 0 ? '+' : ''}
                    {item.item_fit}
                  </span>
                )}
                {item.item_fit !== null && (
                  <span
                    data-testid={`fit-band-${item.item_id}`}
                    title={t(LABELS.fitBandTitle, lang)}
                    style={fitBandBadgeStyle}
                  >
                    {t(LABELS.fitBand, lang)} {Math.round(fitBand(item.item_fit))}/100
                  </span>
                )}
              </div>
              <ContentReason item={item} runId={runId} provider={explanationProvider} lang={lang} inlineProposal={inlineProposal} />
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
    </>
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

// feature 018 (US4) — the friendlier 0-100 fit-band badge, rendered next to
// (never instead of) the raw item_fit.
const fitBandBadgeStyle: React.CSSProperties = {
  fontSize: '0.68em',
  fontWeight: 700,
  color: '#7c3aed',
  background: '#f5f3ff',
  border: '1px solid #ddd6fe',
  borderRadius: '999px',
  padding: '2px 8px',
  fontFamily: 'monospace',
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
