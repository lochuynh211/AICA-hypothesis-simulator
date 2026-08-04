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
  type CompletePlan,
  type JourneyPreviewStep,
} from '../../../api/proposalClient'
import { ContentResultOverlay } from '../../merged/ContentResultOverlay'
import { useSongArtists } from '../useSongNames'
import ContentSetupSection from './sections/ContentSetupSection'

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
  selectUnsupported: {
    ja: '選択したサービス向けのコンテンツプランはありません（未対応のサービスです）。',
    en: 'No content plan is available for the selected service (unsupported service).',
  },
  selectFailed: { ja: 'サービス選択に失敗しました', en: 'Could not select this service' },
  // P7 (US4/US5, FR-017/FR-023) — committed action vs non-binding preview.
  previewSectionTitle: { ja: '先読み（非拘束）', en: 'Look-ahead (non-binding)' },
  previewButton: { ja: '次の内容をプレビュー', en: 'Preview next content' },
  previewBadge: {
    ja: '非拘束プレビュー（未確定・未コミット）',
    en: 'Non-binding preview — not committed',
  },
  previewEmpty: { ja: 'プレビューできる次のステップがありません。', en: 'No next step to preview.' },
};

export default function ContentProposalPanel() {
  const { state } = useProposalStore()
  const { uiLanguage: lang } = state
  const [contentPackages, setContentPackages] = useState<ProposalPackageSummary[]>([])
  const [previewSteps, setPreviewSteps] = useState<JourneyPreviewStep[] | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // item_id → song display name (issue #2). Fetched from the dataset catalog.
  const [songNames, setSongNames] = useState<Record<string, string>>({})

  const datasetId = state.world?.catalog_ref?.dataset_id
  // Artist names beneath each song name (issue #4) — shares the same
  // dataset-catalog fetch pattern as `songNames` above, via the shared hook.
  const songArtists = useSongArtists(datasetId)
  useEffect(() => {
    if (!datasetId) return
    let cancelled = false
    getDatasetCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const song of resp.songs) map[song.spotify_track.id] = song.spotify_track.name
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

        <ContentResultOverlay
          plan={plan}
          error={contentEvidence?.error ?? undefined}
          songNames={songNames}
          songArtists={songArtists}
          runId={state.runLog?.run_id}
          explanationProvider={state.explanationProvider}
          lang={lang}
        />

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
            show first; the editable setup section (Setting → Preprocessing →
            Response coefficients → Weights → Advanced) follows. Extracted to
            `ContentSetupSection` so the Combined Simulator reuses the identical
            editors (feature 020). */}
        {manifest && <ContentSetupSection manifest={manifest} />}

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
