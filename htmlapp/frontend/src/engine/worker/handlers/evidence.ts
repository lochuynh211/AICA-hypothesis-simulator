import type { EvidenceReport } from '../../../api/types'
import { buildEvidenceReport } from '../../services/evidence'
import { renderEvidenceMarkdown } from '../../services/evidence_markdown'

export async function evidenceGet(params: { runId: string; uiLanguage?: string }): Promise<EvidenceReport> {
  return buildEvidenceReport(params.runId, params.uiLanguage ?? 'bilingual')
}

export async function evidenceMd(params: { runId: string; uiLanguage?: string }): Promise<string> {
  const report = await buildEvidenceReport(params.runId, params.uiLanguage ?? 'bilingual')
  return renderEvidenceMarkdown(report)
}
