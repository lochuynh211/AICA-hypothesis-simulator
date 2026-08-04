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
import type { CompletePlan, EvidenceError, OrderedItem, ProposalRunLog } from '../../api/proposalClient'
import ReasonBreakdown, { type ReasonRow } from '../proposal/ReasonBreakdown'
import ContentExplainability, { hasContentExplainability } from '../proposal/ContentExplainability'
import { useExplanation, type ExplanationProvider } from '../proposal/useExplanation'

const LABELS = {
  orderedPlan: { ja: 'プラン（順序付き）', en: 'Ordered plan' },
  excluded: { ja: '除外例', en: 'Excluded examples' },
  // The backend's own message is still shown — an algorithm failure is
  // evidence (architecture §11), and hiding it would hide the only record of
  // what went wrong. Only the FRAMING is localised: the sentence reads in the
  // reviewer's language and the backend string is labelled as technical detail.
  algorithmErrorGeneric: {
    ja: 'アルゴリズムでエラーが発生しました。',
    en: 'The algorithm reported an error.',
  },
  technicalDetail: { ja: '技術的な詳細', en: 'Technical detail' },
  unsupported: { ja: '未対応サービス', en: 'Unsupported service' },
  noProposal: {
    ja: '提案できるコンテンツがありません（全候補が除外されました）。',
    en: 'No content proposal is possible (every candidate was excluded).',
  },
  insufficientEligibleItems: {
    ja: '適格な候補が要求件数に満たないため、プランを生成できません。',
    en: 'Not enough eligible candidates to fill the requested plan size.',
  },
  invalidCatalog: {
    ja: 'カタログが不正です。',
    en: 'The catalog is invalid for this request.',
  },
  invalidConfiguration: {
    ja: 'パッケージ設定が不正です。',
    en: 'The package configuration is invalid.',
  },
  fullKaraokeRequiresStopped: {
    ja: 'カラオケ（停車中コンテンツ）は停車中のみ利用できます。',
    en: 'Karaoke (a stopped-vehicle content) is only available while stopped.',
  },
  otherDecision: {
    ja: 'このリクエストに対するプランはありません。',
    en: 'No plan is available for this request.',
  },
  committedBadge: { ja: '確定済み', en: 'Committed' },
  resolvingTitle: { ja: '（曲名を取得中…）', en: '(Resolving title…)' },
  unknownItemName: { ja: '不明な項目', en: 'Unknown item' },
  metaMode: { ja: 'モード', en: 'Mode' },
  metaDuration: { ja: '想定時間', en: 'Duration' },
  metaLighting: { ja: 'ライト演出', en: 'Lighting' },
  metaApproval: { ja: '承認方法', en: 'Approval' },
  metaCompletion: { ja: '終了条件', en: 'Completion' },
  metaOn: { ja: 'あり', en: 'On' },
  metaOff: { ja: 'なし', en: 'Off' },
}

/** Content plan-item exclusion reason codes, in words — `ExcludedItem.reason_codes`
 *  are backend-internal snake_case strings (see
 *  `aica_transparent_content_selector_v1/algorithm.py`'s `eligibility_reasons`
 *  and the mock package's `mock_selection_boundary`). An unrecognised code
 *  (a future/unknown python_module reason) still renders — just not as its raw
 *  identifier. */
const REASON_CODE_LABELS: Record<string, { ja: string; en: string }> = {
  recent_skip: { ja: '直近でスキップ済み', en: 'recently skipped' },
  duplicate: { ja: '重複', en: 'duplicate' },
  not_playable: { ja: '再生不可', en: 'not playable' },
  market_unavailable: { ja: '配信地域外', en: 'unavailable in this market' },
  restricted: { ja: '再生制限あり', en: 'restricted' },
  explicit_under_child: { ja: '子供同乗のため不適切な表現を含む', en: 'explicit content with a child aboard' },
  identity_mismatch: { ja: 'カタログデータの不整合', en: 'catalog data mismatch' },
  humming_unavailable: { ja: '鼻歌カラオケ非対応', en: 'not available for humming karaoke' },
  full_karaoke_unavailable: { ja: 'カラオケ非対応', en: 'not available for karaoke' },
  platform_excluded: { ja: 'プラットフォームの制約', en: 'excluded by platform constraints' },
  mock_selection_boundary: { ja: '選定範囲外', en: 'outside the selection boundary' },
}
const UNKNOWN_REASON: { ja: string; en: string } = { ja: '除外理由不明', en: 'reason unknown' }

/** Content-plan metadata field values, in words — `plan.mode.mode_kind` /
 *  `approval_policy` / `completion_rule` are backend-internal strings (see
 *  `content_output.py`). An unrecognised value falls back to a generic
 *  "unknown" word rather than its raw identifier. */
const MODE_KIND_LABELS: Record<string, { ja: string; en: string }> = {
  playlist: { ja: 'プレイリスト再生', en: 'Playlist' },
  humming: { ja: '鼻歌カラオケ', en: 'Humming karaoke' },
  full_karaoke: { ja: 'カラオケ（フル）', en: 'Karaoke (full)' },
}
const APPROVAL_POLICY_LABELS: Record<string, { ja: string; en: string }> = {
  explicit_opt_in: { ja: '自動（明示的な同意あり）', en: 'Automatic (explicit opt-in)' },
}
const COMPLETION_RULE_LABELS: Record<string, { ja: string; en: string }> = {
  plan_exhausted: { ja: '自然終了（プラン消化）', en: 'Natural end (plan exhausted)' },
}
const UNKNOWN_META_VALUE: { ja: string; en: string } = { ja: '不明', en: 'Unknown' }

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
  /** `item_id → "Artist A, Artist B"`, rendered under the song name — issue #4.
   *  Optional: the standalone Proposal screen may not have it wired. */
  songArtists?: Record<string, string>
  runId?: string
  explanationProvider: ExplanationProvider
  /** An EPHEMERAL proposal (quickview/after-nap projection) to explain inline —
   * feature 020. Undefined for a persisted run (uses the run-id endpoint). */
  inlineProposal?: ProposalRunLog | null
  /** Clicking a song asks to COMPARE it (right column). Optional: the
   *  standalone Proposal screen has no review column and passes nothing. */
  onInspect?: (itemId: string) => void
  lang: 'ja' | 'en'
}) {
  const { plan, error, songNames, songArtists = {}, runId, explanationProvider, inlineProposal, onInspect, lang } = props

  return (
    <>
      {error && (
        <div role="alert">
          <p style={{ color: '#dc2626', fontSize: '0.82em', margin: 0 }}>
            {t(LABELS.algorithmErrorGeneric, lang)}
          </p>
          <p style={{ color: '#991b1b', fontSize: '0.7em', margin: '2px 0 0', fontFamily: 'ui-monospace, monospace' }}>
            {t(LABELS.technicalDetail, lang)}: {error.message}
          </p>
        </div>
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
              onClick={onInspect ? () => onInspect(item.item_id) : undefined}
              style={{
                border: '1px solid #e5e7eb', borderRadius: '9px', margin: '8px 0',
                overflow: 'hidden', cursor: onInspect ? 'pointer' : undefined,
              }}
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
                {/* Song name (+ artist names beneath) — the raw item_id never
                    reaches the screen. It is still reachable via this row's own
                    data-testid. */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.86em' }}>
                    {songNames[item.item_id] ?? t(LABELS.resolvingTitle, lang)}
                  </span>
                  {songArtists[item.item_id] && (
                    <span
                      data-testid={`plan-item-artist-${item.item_id}`}
                      style={{ fontWeight: 500, fontSize: '0.74em', color: '#6b7280' }}
                    >
                      {songArtists[item.item_id]}
                    </span>
                  )}
                </span>
                {item.item_fit !== null && (
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#7c3aed' }}>
                    {item.item_fit >= 0 ? '+' : ''}
                    {item.item_fit.toFixed(3)}
                  </span>
                )}
              </div>
              <ContentExplainability item={item} lang={lang} />
              <ContentReason item={item} runId={runId} provider={explanationProvider} lang={lang} inlineProposal={inlineProposal} />
            </div>
          ))}

          {plan.excluded_items.length > 0 && (
            <p data-testid="plan-excluded" style={{ fontSize: '0.76em', color: '#6b7280', marginTop: '8px' }}>
              <b>{t(LABELS.excluded, lang)}:</b>{' '}
              {plan.excluded_items
                .map((ex) => {
                  const name = songNames[ex.item_id] ?? t(LABELS.unknownItemName, lang)
                  const reasons = ex.reason_codes
                    .map((code) => t(REASON_CODE_LABELS[code] ?? UNKNOWN_REASON, lang))
                    .join(lang === 'ja' ? '、' : ', ')
                  return lang === 'ja' ? `『${name}』（${reasons}）` : `"${name}" (${reasons})`
                })
                .join(lang === 'ja' ? '、' : '; ')}
            </p>
          )}

          <div data-testid="plan-metadata" style={planMetadataStyle}>
            {(() => {
              const durationMin = Math.round(plan.expected_duration_sec / 60)
              const sep = lang === 'ja' ? ' ／ ' : ' / '
              const colon = lang === 'ja' ? '：' : ': '
              const durationText = lang === 'ja' ? `約${durationMin}分` : `about ${durationMin} min`
              const lightingText = t(plan.lighting_configuration?.enabled ? LABELS.metaOn : LABELS.metaOff, lang)
              return [
                `${t(LABELS.metaMode, lang)}${colon}${t(MODE_KIND_LABELS[plan.mode.mode_kind] ?? UNKNOWN_META_VALUE, lang)}`,
                `${t(LABELS.metaDuration, lang)}${colon}${durationText}`,
                `${t(LABELS.metaLighting, lang)}${colon}${lightingText}`,
                `${t(LABELS.metaApproval, lang)}${colon}${t(APPROVAL_POLICY_LABELS[plan.approval_policy] ?? UNKNOWN_META_VALUE, lang)}`,
                `${t(LABELS.metaCompletion, lang)}${colon}${t(COMPLETION_RULE_LABELS[plan.completion_rule] ?? UNKNOWN_META_VALUE, lang)}`,
              ].join(sep)
            })()}
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
