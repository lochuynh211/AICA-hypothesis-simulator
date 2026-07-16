/**
 * ProposalRunsScreen (P1 T036) — the [Screen | Runs] sub-nav's "Runs" view.
 *
 * Lists persisted proposal runs (`GET /api/proposal/runs`), with a per-run
 * Reopen action that loads the full record (`GET /api/proposal/runs/{id}`)
 * and renders its recorded opportunity / service-result / content-plan
 * READ-ONLY — straight from the stored `ProposalRunLog`, with no selector
 * recomputation — and a Delete action (`DELETE /api/proposal/runs/{id}`)
 * that removes it from both the backend and this list.
 *
 * Deliberately self-contained (does not reuse the interactive
 * ServiceProposalPanel/ContentProposalPanel, which are wired to the live
 * setup/editing state in `proposalStore` — reopening a past run must never
 * feed into a NEW run's setup).
 */
import { useEffect, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import {
  listRuns,
  getRun,
  deleteRun,
  pickRationale,
  type ProposalRunSummary,
  type ProposalRunLog,
  type RankedCandidate,
  type CompletePlan,
} from '../../api/proposalClient'

const LABELS = {
  title: { ja: '実行履歴', en: 'Run history' },
  empty: { ja: '保存された実行はありません。', en: 'No persisted runs yet.' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  reopen: { ja: '再表示', en: 'Reopen' },
  delete: { ja: '削除', en: 'Delete' },
  close: { ja: '閉じる', en: 'Close' },
  colRunId: { ja: '実行ID', en: 'Run ID' },
  colStatus: { ja: '状態', en: 'Status' },
  colCreated: { ja: '作成日時', en: 'Created' },
  colServicePkg: { ja: 'サービスPKG', en: 'Service pkg' },
  colContentPkg: { ja: 'コンテンツPKG', en: 'Content pkg' },
  colActions: { ja: '操作', en: 'Actions' },
  detailTitle: { ja: '再表示（読み取り専用・再計算なし）', en: 'Reopened (read-only, no recompute)' },
  opportunity: { ja: '機会', en: 'Opportunity' },
  serviceResult: { ja: 'サービス結果', en: 'Service result' },
  contentPlan: { ja: 'コンテンツプラン', en: 'Content plan' },
  noServiceResult: { ja: 'サービス結果なし', en: 'No service result' },
  noContentPlan: { ja: 'コンテンツプランなし', en: 'No content plan (not yet selected)' },
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
}

function serviceEvidenceOf(run: ProposalRunLog) {
  return run.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
}

function contentEvidenceOf(run: ProposalRunLog) {
  return run.evidence.filter((ev) => ev.step === 'content').slice(-1)[0]
}

export default function ProposalRunsScreen() {
  const { state } = useProposalStore()
  const { uiLanguage: lang } = state

  const [runs, setRuns] = useState<ProposalRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reopened, setReopened] = useState<ProposalRunLog | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)

  function refresh() {
    setLoading(true)
    setError(null)
    listRuns()
      .then((list) => setRuns(list))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // Load once on mount — this screen owns its own data, independent of
    // the live setup state in proposalStore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleReopen(runId: string) {
    setBusyRunId(runId)
    setError(null)
    try {
      const runLog = await getRun(runId)
      setReopened(runLog)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyRunId(null)
    }
  }

  async function handleDelete(runId: string) {
    setBusyRunId(runId)
    setError(null)
    try {
      await deleteRun(runId)
      setRuns((prev) => prev.filter((r) => r.run_id !== runId))
      setReopened((prev) => (prev?.run_id === runId ? null : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyRunId(null)
    }
  }

  const serviceEvidence = reopened ? serviceEvidenceOf(reopened) : undefined
  const serviceOutput = serviceEvidence?.output as
    | { decision_type: string; ranked_candidates: RankedCandidate[] }
    | undefined
  const contentEvidence = reopened ? contentEvidenceOf(reopened) : undefined
  const plan = contentEvidence?.output as CompletePlan | undefined

  return (
    <div data-testid="proposal-runs-screen" style={{ padding: '16px', overflow: 'auto', height: '100%' }}>
      <h3 style={{ margin: '0 0 10px' }}>{t(LABELS.title, lang)}</h3>

      {error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.85em' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p data-testid="runs-loading" style={{ color: '#6b7280' }}>
          {t(LABELS.loading, lang)}
        </p>
      ) : runs.length === 0 ? (
        <p data-testid="runs-empty" style={{ color: '#6b7280' }}>
          {t(LABELS.empty, lang)}
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={thStyle}>{t(LABELS.colRunId, lang)}</th>
              <th style={thStyle}>{t(LABELS.colStatus, lang)}</th>
              <th style={thStyle}>{t(LABELS.colCreated, lang)}</th>
              <th style={thStyle}>{t(LABELS.colServicePkg, lang)}</th>
              <th style={thStyle}>{t(LABELS.colContentPkg, lang)}</th>
              <th style={thStyle}>{t(LABELS.colActions, lang)}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.run_id} data-testid={`run-row-${run.run_id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={tdStyle}>
                  <code>{run.run_id}</code>
                </td>
                <td style={tdStyle}>{run.status}</td>
                <td style={tdStyle}>{run.created_at}</td>
                <td style={tdStyle}>{run.service_package_id}</td>
                <td style={tdStyle}>{run.content_package_id ?? '—'}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    data-testid={`reopen-run-${run.run_id}`}
                    disabled={busyRunId === run.run_id}
                    onClick={() => handleReopen(run.run_id)}
                    style={actionBtnStyle('#1d4ed8')}
                  >
                    {t(LABELS.reopen, lang)}
                  </button>
                  <button
                    type="button"
                    data-testid={`delete-run-${run.run_id}`}
                    disabled={busyRunId === run.run_id}
                    onClick={() => handleDelete(run.run_id)}
                    style={actionBtnStyle('#dc2626')}
                  >
                    {t(LABELS.delete, lang)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reopened && (
        <section
          data-testid="run-detail"
          style={{ marginTop: '18px', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: '#f8fafc',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <strong>
              {t(LABELS.detailTitle, lang)} — <code>{reopened.run_id}</code>
            </strong>
            <button
              type="button"
              data-testid="close-run-detail"
              onClick={() => setReopened(null)}
              style={actionBtnStyle('#6b7280')}
            >
              {t(LABELS.close, lang)}
            </button>
          </div>

          <div style={{ padding: '12px 14px' }}>
            <div style={sectionLabelStyle}>{t(LABELS.opportunity, lang)}</div>
            <div data-testid="detail-opportunity" style={monoBoxStyle}>
              opportunity_id={reopened.opportunity.opportunity_id} · trigger_purpose=
              {reopened.opportunity.trigger_purpose} · lifecycle_stage={reopened.opportunity.lifecycle_stage} ·
              allowed_service_ids=[{reopened.opportunity.allowed_service_ids.join(', ')}]
            </div>

            <div style={sectionLabelStyle}>{t(LABELS.serviceResult, lang)}</div>
            {serviceEvidence?.error ? (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
                {t(LABELS.algorithmError, lang)}: {serviceEvidence.error.message}
              </p>
            ) : serviceOutput && serviceOutput.ranked_candidates?.length > 0 ? (
              <ul data-testid="detail-service-result" style={listStyle}>
                {serviceOutput.ranked_candidates.map((cand) => (
                  <li key={cand.candidate_id} data-testid={`detail-candidate-${cand.candidate_id}`}>
                    #{cand.rank} <strong>{cand.candidate_id}</strong>
                    {cand.score !== null ? ` (${cand.score})` : ''}
                    {cand.rationale?.length ? ` — ${pickRationale(cand.rationale, lang)}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noServiceResult, lang)}</p>
            )}

            <div style={sectionLabelStyle}>{t(LABELS.contentPlan, lang)}</div>
            {contentEvidence?.error ? (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
                {t(LABELS.algorithmError, lang)}: {contentEvidence.error.message}
              </p>
            ) : plan && plan.ordered_items?.length > 0 ? (
              <ul data-testid="detail-content-plan" style={listStyle}>
                {plan.ordered_items.map((item) => (
                  <li key={item.item_id} data-testid={`detail-plan-item-${item.item_id}`}>
                    #{item.position} <strong>{item.item_id}</strong>
                    {item.item_fit !== null ? ` (${item.item_fit})` : ''}
                    {item.rationale?.length ? ` — ${pickRationale(item.rationale, lang)}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noContentPlan, lang)}</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const thStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.78em', color: '#6b7280' }
const tdStyle: React.CSSProperties = { padding: '6px 10px' }

const actionBtnStyle = (color: string): React.CSSProperties => ({
  fontSize: '0.78em',
  fontWeight: 700,
  padding: '3px 10px',
  marginRight: '6px',
  borderRadius: '6px',
  border: `1px solid ${color}`,
  background: '#fff',
  color,
  cursor: 'pointer',
})

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const monoBoxStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.8em',
  background: '#f8fafc',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '9px 12px',
  overflowX: 'auto',
}

const listStyle: React.CSSProperties = { margin: '4px 0', paddingLeft: '20px', fontSize: '0.84em' }
