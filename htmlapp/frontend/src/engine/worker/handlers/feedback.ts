import type { FeedbackSchema, FeedbackSubmitBody, FeedbackEvent, RunLog, PackageManifest } from '../../../api/types'
import { FeedbackValidationError } from '../../../api/types'
import {
  effectiveSchema,
  validate as validateFeedback,
  appendFeedback as engineAppendFeedback,
  resolveEventRef,
} from '../../services/feedback'
import { resolveRunLog as engineResolveRunLog } from '../../run_manager'
import { packageRegistry } from '../../services/package_registry'

async function resolveFeedbackPackage(runId: string): Promise<{ log: RunLog; pkg: PackageManifest }> {
  const log = await engineResolveRunLog(runId)
  const pkg = await packageRegistry.get(log.snapshot.package.id)
  return { log, pkg }
}

export async function feedbackSchema(params: { runId: string }): Promise<FeedbackSchema> {
  const { pkg } = await resolveFeedbackPackage(params.runId)
  return { fields: effectiveSchema(pkg) }
}

export async function feedbackSubmit(params: { runId: string; body: FeedbackSubmitBody }): Promise<FeedbackEvent> {
  const { log, pkg } = await resolveFeedbackPackage(params.runId)
  const resolvedTarget = resolveEventRef(params.body.target, log)
  const resolvedBody: FeedbackSubmitBody = { ...params.body, target: resolvedTarget }
  const schema = effectiveSchema(pkg)
  const result = validateFeedback(schema, resolvedBody, log)
  if (!result.ok) {
    throw new FeedbackValidationError({ validation_errors: result.errors })
  }
  return engineAppendFeedback(params.runId, resolvedBody)
}
