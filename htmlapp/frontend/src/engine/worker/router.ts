import type { RpcOp } from '../../api/rpc'
import { healthGet } from './handlers/health'
import { packagesList, packagesGet, packagesAddUser } from './handlers/packages'
import { scenariosList, scenariosGet } from './handlers/scenarios'
import { routesAnalyze, routesPresetsList, routesPresetsLoad } from './handlers/routes'
import { runPlansCreate, runPlansRegenerate } from './handlers/run_plans'
import {
  runsCreate, runsTick, runsAct, runsRestSpots, runsList, runsState, runsPreview, runsLog,
} from './handlers/runs'
import { evidenceGet, evidenceMd } from './handlers/evidence'
import { feedbackSchema, feedbackSubmit } from './handlers/feedback'
import { installData } from './handlers/data'
import { proposalPresetsList, proposalPresetsGet, proposalPackagesList, proposalCatalogGet } from './handlers/proposal'
import {
  mergedPlan, mergedQuickview, mergedAfterRestProposal, mergedExplain, mergedExplainTrigger,
  mergedCreate, mergedGet, mergedList, mergedAcceptRest, mergedDecline, mergedTick,
  mergedProposalAction, mergedReviewFeedbackPost, mergedReviewFeedbackGet,
} from './handlers/merged'

export const router: Record<RpcOp, (params: any) => Promise<unknown>> = {
  'health.get': healthGet,
  'packages.list': packagesList,
  'packages.get': packagesGet,
  'packages.addUser': packagesAddUser,
  'data.install': (params) => installData(params as { payload: unknown }),
  'scenarios.list': scenariosList,
  'scenarios.get': scenariosGet,
  'routes.analyze': routesAnalyze,
  'routes.presets.list': routesPresetsList,
  'routes.presets.load': routesPresetsLoad,
  'runPlans.create': runPlansCreate,
  'runPlans.regenerate': runPlansRegenerate,
  'runs.create': runsCreate,
  'runs.tick': runsTick,
  'runs.act': runsAct,
  'runs.restSpots': runsRestSpots,
  'runs.log': runsLog,
  'runs.list': runsList,
  'runs.state': runsState,
  'runs.preview': runsPreview,
  'evidence.get': evidenceGet,
  'evidence.md': evidenceMd,
  'feedback.submit': feedbackSubmit,
  'feedback.schema': feedbackSchema,
  'proposal.presets.list': proposalPresetsList,
  'proposal.presets.get': proposalPresetsGet,
  'proposal.packages.list': proposalPackagesList,
  'proposal.catalog.get': proposalCatalogGet,
  'merged.plan': mergedPlan,
  'merged.quickview': mergedQuickview,
  'merged.afterRestProposal': mergedAfterRestProposal,
  'merged.explain': mergedExplain,
  'merged.explainTrigger': mergedExplainTrigger,
  'merged.create': mergedCreate,
  'merged.get': mergedGet,
  'merged.list': mergedList,
  'merged.acceptRest': mergedAcceptRest,
  'merged.decline': mergedDecline,
  'merged.tick': mergedTick,
  'merged.proposalAction': mergedProposalAction,
  'merged.reviewFeedback.post': mergedReviewFeedbackPost,
  'merged.reviewFeedback.get': mergedReviewFeedbackGet,
}
