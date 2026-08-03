/**
 * Proposal worker-RPC handlers — the four `proposal.*` ops this task wires.
 *
 * Each mirrors one endpoint in `routers/proposal.py`. Store methods
 * (`../../proposal/stores.ts`) return `null` on a miss, mirroring the Python
 * REGISTRY layer; the not-found -> thrown-error translation below mirrors
 * the Python ROUTER layer (`HTTPException(404, ...)`), matching how
 * `routers/proposal.py` itself splits the two concerns.
 */
import {
  presetStore,
  datasetCatalogRegistry,
  proposalPackageRegistry,
  type PresetDoc,
  type PresetSummary,
  type ProposalPackageSummary,
  type ProposalPackageSlot,
  type ProposalPackageError,
  type DatasetProvenanceView,
} from '../../proposal/stores'
import { getRun } from '../../proposal/run_manager'
import { explainFromRunLog, type ExplainStep, type ExplainResponse } from '../../proposal/orchestrator/explain'
import { ProposalHttpError } from '../../proposal/orchestrator/create_run'
import { pyReprQuoteOne } from '../../proposal/py_repr'

// ---------------------------------------------------------------------------
// proposal.presets.list — GET /api/proposal/presets
// ---------------------------------------------------------------------------

export async function proposalPresetsList(): Promise<{ presets: PresetSummary[] }> {
  return { presets: presetStore.listSummaries() }
}

// ---------------------------------------------------------------------------
// proposal.presets.get — GET /api/proposal/presets/{preset_id}
// ---------------------------------------------------------------------------

export async function proposalPresetsGet(params: { presetId: string }): Promise<PresetDoc> {
  const preset = presetStore.get(params.presetId)
  if (preset === null) {
    // Mirrors routers/proposal.py#get_preset: HTTPException(404, detail=f"preset not found: {preset_id}")
    throw new Error(`preset not found: ${params.presetId}`)
  }
  return preset
}

// ---------------------------------------------------------------------------
// proposal.packages.list — GET /api/proposal/packages
// ---------------------------------------------------------------------------

export async function proposalPackagesList(): Promise<{
  slots: ProposalPackageSlot[]
  packages: ProposalPackageSummary[]
  errors: ProposalPackageError[]
}> {
  // Mirrors routers/proposal.py#get_packages: the HIDDEN filter is the
  // router's job, not the registry's — proposalPackageRegistry.listSummaries()
  // itself returns every loaded package (hidden or not).
  const { packages, errors } = proposalPackageRegistry.listSummaries()
  return {
    slots: proposalPackageRegistry.listSlots(),
    packages: packages.filter((p) => !p.hidden),
    errors,
  }
}

// ---------------------------------------------------------------------------
// proposal.catalog.get — GET /api/proposal/datasets/{dataset_id}/catalog
// ---------------------------------------------------------------------------

export async function proposalCatalogGet(params: {
  datasetId: string
  offset?: number
  limit?: number
}): Promise<{ provenance: DatasetProvenanceView; total: number; songs: unknown[] }> {
  const offset = params.offset ?? 0
  const catalog = datasetCatalogRegistry.getCatalog(params.datasetId)
  if (catalog === null) {
    // Mirrors routers/proposal.py#get_dataset_catalog: HTTPException(404, detail=f"Unknown dataset_id: {dataset_id!r}")
    throw new Error(`Unknown dataset_id: '${params.datasetId}'`)
  }
  const provenance = datasetCatalogRegistry.getProvenance(params.datasetId)
  // A loaded catalog always has provenance (both come from the same
  // registry entry — mirrors the Python `assert provenance is not None`).
  if (provenance === null) throw new Error(`invariant violated: catalog loaded with no provenance for '${params.datasetId}'`)

  const end = params.limit == null ? undefined : offset + params.limit
  const songs = catalog.slice(offset, end)
  return { provenance, total: catalog.length, songs }
}

// ---------------------------------------------------------------------------
// proposal.runs.explain — POST /api/proposal/runs/{run_id}/explain
// (routers/proposal.py:2269-2274, `explain_run`)
// ---------------------------------------------------------------------------

/** Wire body for `proposal.runs.explain` — mirrors `ExplainRequestBody`
 * (routers/proposal.py:1950-1962) plus the offline-only `'off'` provider
 * widening `explainFromRunLog` itself already accepts (see that function's
 * own module doc, "The `off`/`browser`/`backend` design"; the SAME widening
 * `../../merged/explain.ts#MergedExplainBody` already carries for its own
 * `merged.explain` op — this is that precedent's second call site, not a
 * new decision). `step` stays `string` (not narrowed to `ExplainStep`) for
 * the same reason `mergedExplainEndpoint`'s own `step` field is: Python's
 * real `ExplainRequestBody.step` accepts `"trigger"` too — a real,
 * reachable value that simply never matches any `AlgorithmEvidence.step`
 * (`explainFromRunLog`'s own module doc, "Scope note") — so the cast below
 * is a compile-time convenience, not a narrowing of what can actually be
 * sent. Nested under its own `body` key (not flattened alongside `runId`)
 * per this port's own path-param+POST-body convention — see
 * `../handlers/feedback.ts#feedbackSubmit`'s identical `{ runId, body }`
 * shape, the precedent this mirrors. */
export type ProposalRunsExplainBody = {
  step: string
  target_id: string
  provider: 'backend' | 'browser' | 'off'
}

/**
 * Port of `explain_run` (routers/proposal.py:2269-2274) — a genuine 5-line
 * Python function: load the run, 404 if missing, delegate everything else
 * to `explain_from_run_log`. Mirrors the SAME `getRun` + 404 pattern
 * `orchestrator/select_service.ts#selectService` / `orchestrator/
 * journey_action.ts` / `orchestrator/recompute.ts` already establish for
 * their own run-id-addressed endpoints; kept as a direct handler function
 * here (not moved into a new `orchestrator/` file) because — like this
 * file's other three ops — it has no logic of its own beyond that pattern:
 * everything else is `explainFromRunLog`, already fully ported (C4a Task 7).
 *
 * NOTE (feature 026, htmlapp Combined export, slice C5 Task 2b): earlier
 * task docs (`../../proposal/orchestrator/explain.ts`'s own module doc;
 * this file's former sibling gap in `../../../api/proposalClient.ts`)
 * recorded `explain_run` as deliberately NOT ported ("Port function
 * bodies, not HTTP handlers"). That was accurate until this task: `explain
 * (runId, ...)` in `proposalClient.ts` is reachable on the ORDINARY
 * (non-"inspect") Combined explain path — `useExplanation.ts` calls it
 * whenever `inlineProposal` is unset, which `MergedProposalPanel.tsx` sets
 * for the LIVE (non-inspect) service/content panel — so the gap is closed
 * here, not left as a disclosed hole.
 *
 * UNLIKE `mergedExplainEndpoint` (`../../merged/explain.ts`), `persistRunId`
 * passed to `explainFromRunLog` is the run's OWN id (never `null`) — a real
 * on-disk run's explanation IS appended to its log, mirroring Python's own
 * `explain_from_run_log(run_log, body, persist_run_id=run_id)` exactly.
 * This is the one behavioral difference from the inline sibling
 * (`merged.explain`, which always passes `null` — see `explainFromRunLog`'s
 * own doc for why both call sites exist).
 *
 * @throws ProposalHttpError(404) — `runId` has no persisted run. Mirrors
 *   `HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not
 *   found")` byte-for-byte via `pyReprQuoteOne`.
 * @throws ExplanationProviderUnsupportedError — `body.provider === 'backend'`
 *   (thrown by `explainFromRunLog` itself, not duplicated here).
 * @throws ProposalHttpError(422, NoDecisionDetail | UnknownTargetDetail) —
 *   propagated from `explainFromRunLog` unchanged.
 */
export async function proposalRunsExplain(params: {
  runId: string
  body: ProposalRunsExplainBody
}): Promise<ExplainResponse> {
  const runLog = await getRun(params.runId)
  if (runLog === null) {
    // Mirrors explain_run: HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")
    throw new ProposalHttpError(404, `Proposal run ${pyReprQuoteOne(params.runId)} not found`)
  }
  return explainFromRunLog(
    runLog,
    { step: params.body.step as ExplainStep, target_id: params.body.target_id, provider: params.body.provider },
    params.runId,
  )
}
