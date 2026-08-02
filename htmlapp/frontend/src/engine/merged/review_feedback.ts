/**
 * Merged-run review-feedback endpoints — TS port of
 * `routers/merged_runs.py`'s `post_review_feedback_endpoint` (1327-1366) and
 * `get_review_feedback_endpoint` (1366-1415) — feature 026 (htmlapp Combined
 * export), slice C4 Task 8.
 *
 * Both endpoints port the endpoint BODY as a plain function; HTTP framing
 * (status codes, path params, FastAPI `Depends`) is Task 9's job, not this
 * file's. There is exactly ONE feedback store in this app (M5) — this file
 * appends into the SAME trigger-run event log every other feedback record
 * lives in, via `handle.trigger_run_id`, never a second parallel store.
 * Feedback is evidence only: it is never read by, nor alters, any algorithm
 * or recorded simulator decision (same invariant `../services/feedback.ts`
 * already documents for the non-merged feedback endpoint).
 *
 * ── Step 1: control flow, enumerated before any code below ─────────────────
 *
 * `postReviewFeedbackEndpoint(mergedRunId, body)` (mirrors
 * `post_review_feedback_endpoint`):
 *   1. `get_handle(merged_run_id)` — `None` -> 404 `Merged run {id!r} not found`.
 *   2. Build a `FeedbackEvent(kind="feedback", target=FeedbackTarget(scope=
 *      body.scope, case_id=body.case_id, checkpoint_id=body.checkpoint_id,
 *      stage=body.stage, review_target=body.review_target,
 *      feature_id=body.feature_id), labels=body.labels, comment=body.comment)`.
 *   3. `append_feedback(handle.trigger_run_id, event, settings.runs_dir)` —
 *      `services/feedback.py`'s TWO-TIER version (active registry, else
 *      on-disk fallback) — `RunNotFoundError` -> 404
 *      `Trigger run {id!r} not found`.
 *   4. Return the event (`.model_dump(mode="json")`).
 *
 * `getReviewFeedbackEndpoint(mergedRunId)` (mirrors
 * `get_review_feedback_endpoint`):
 *   1. `get_handle(merged_run_id)` — `None` -> 404 `Merged run {id!r} not found`.
 *   2. Read the trigger run's log — Python does a RAW on-disk JSON read
 *      (`json.loads(trigger_log_path.read_text())` if the file exists, else
 *      `None`) — a MISSING trigger log is NOT a 404 here, unlike step 1 —
 *      degrades to `events: []` / all-`None` package_versions instead.
 *   3. Filter `events` to `kind == "feedback"` AND
 *      `target.scope` starts with `"review_"`.
 *   4. `package_versions`: trigger — read straight off the log's own
 *      `snapshot.package` (no registry lookup — the log already recorded
 *      what produced it); service/content — `ProposalPackageRegistry.get(id)`
 *      (id from `handle.*_package_id`, version `None` if the package can no
 *      longer be found).
 *
 * ── Step 3: append-only discipline ──────────────────────────────────────
 *
 * `postReviewFeedbackEndpoint` NEVER overwrites a prior judgement — two
 * judgements on the same feature append twice, exactly like every other M5
 * feedback record (see `appendFeedbackAnyRun`'s own doc comment: both of
 * its tiers are pure appends, never a rewrite). `getReviewFeedbackEndpoint`
 * is READ-ONLY (never calls `saveHandle`/appends anything).
 *
 * ── A small unported helper this task needed: `append_feedback`'s two-tier
 * resolution (`services/feedback.py:348-395`) ────────────────────────────
 *
 * `../services/feedback.ts#appendFeedback` (the ALREADY-shipped M5 port,
 * used by the run-id-addressed `/api/runs/{id}/feedback` endpoint) only
 * wraps `../run_manager.ts#appendFeedback` — the ACTIVE-REGISTRY-ONLY
 * `run_manager.py::append_feedback`, ONE of Python's TWO tiers. Python's
 * `post_review_feedback_endpoint` imports the WIDER `services.feedback
 * .append_feedback` (see `routers/merged_runs.py:85`), which tries the
 * active registry FIRST and, on `RunNotFoundError`, falls back to reading
 * the on-disk `runs/{run_id}.json`, appending, and writing it back — a
 * genuinely different, wider function than the one `../services/
 * feedback.ts` already ported (a small, pre-existing, out-of-scope
 * divergence in THAT file, not touched here). This gap is REACHABLE, not
 * merely defensive, in THIS offline SPA: a page reload empties the
 * in-memory `_registry` `Map` entirely while every previously created run's
 * data stays in IndexedDB (every event is written straight through on
 * append — see `../run_manager.ts`'s own module doc) — so posting review
 * feedback on a run created in an earlier page load ALWAYS needs the
 * fallback tier. Ported here as the small local helper
 * `appendFeedbackAnyRun` — see its own doc comment for the mechanism.
 *
 * ── `dict.get(key, default)` / `or` / truthiness audit (per-site, full) ────
 *
 * `sed -n '1327,1415p' routers/merged_runs.py | grep -o '\.get(' | wc -l` ->
 * `11` occurrences across 9 lines (`grep -c` on the same range -> `9`
 * lines — the two counts differ because two lines each carry two `.get(`
 * calls; reported as occurrences, not lines, per this task's own
 * "grep -c counts LINES, grep -o | wc -l counts OCCURRENCES" instruction).
 * Of the 11: ONE (line 1366, `@router.get("/api/merged-runs/...")`) is the
 * FastAPI route decorator, not a dict method at all — excluded. TWO (lines
 * 1396/1397, `proposal_pkg_reg.get(handle.service_package_id)` /
 * `...get(handle.content_package_id)`) are `ProposalPackageRegistry.get()`
 * — a DOMAIN METHOD this module already reads (`self._packages.get(...)`
 * internally, a real 1-arg dict `.get` ONE LEVEL DOWN, inside a class this
 * port already mirrors as `proposalPackageRegistry.get()`,
 * `../proposal/stores.ts`) — NOT itself one of the three dict-get idioms
 * this audit classifies; excluded from the count below for that reason,
 * disclosed rather than silently folded in as if it were a plain dict
 * `.get`. The remaining EIGHT are genuine dict `.get()` calls, classified
 * individually against their own Python line (not generalised):
 *
 *   | Line | Expression | Idiom |
 *   |---|---|---|
 *   | 1386 | `.get("events", [])` (on `trigger_log or {}`) | 2-arg `.get(key,default)` -> `pyGetDefault` |
 *   | 1390 | `e.get("kind")` | 1-arg `.get`, NO `or` — compared directly via `==` |
 *   | 1391 | `e.get("target")` | 1-arg `.get` THEN `or {}` -> `pyOr(pyGetDefault(...), {})` |
 *   | 1391 | `.get("scope", "")` (on the previous result) | 2-arg `.get(key,default)` -> `pyGetDefault` |
 *   | 1394 | `.get("snapshot")` (on `trigger_log or {}`) | 1-arg `.get` THEN `or {}` — see NOTE |
 *   | 1394 | `.get("package")` (on the previous result) | 1-arg `.get` THEN `or {}` — see NOTE |
 *
 *   NOTE (corrected): the code does NOT call `pyOr(pyGetDefault(...))` for
 *   these two, and an earlier revision of this table implied it did. Python
 *   collapses the whole chain to a dict at the CHAIN
 *   (`((trigger_log or {}).get("snapshot") or {}).get("package") or {}` is
 *   ALWAYS a dict, never `None`); the port instead writes
 *   `runLog?.snapshot?.package ?? null` and restores the `{}` at the USE
 *   SITE (`pyGetDefault((triggerPkg ?? {}), 'id', null)`, and likewise for
 *   `'version'`). Same observable result — `null` intermediate plus `?? {}`
 *   at use is equivalent to Python's `{}` intermediate — but the guard lives
 *   one step later. Recorded because the difference is real even though the
 *   output is not: a future edit that reads `triggerPkg` WITHOUT its own
 *   `?? {}` would diverge from Python, where the chain has already
 *   guaranteed a dict.
 *   | 1403 | `trigger_pkg.get("id")` | 1-arg `.get`, NO `or` — used directly as a dict value (`None` on miss is the WANTED output) |
 *   | 1404 | `trigger_pkg.get("version")` | 1-arg `.get`, NO `or` — same as above |
 *
 * PLUS two occurrences of the bare `x or default` idiom that are NOT
 * chained off a `.get()` at all — `trigger_log or {}` (lines 1386 and 1394,
 * the BASE value each line's own `.get()` chain then operates on) — a
 * FOURTH pattern distinct from all three named idioms (it precedes rather
 * than follows a `.get`), mirrored the same way `pyOr` mirrors any other
 * bare Python `or`. The THIRD named idiom (bare `if x:` truthiness)
 * appears ZERO times in this task's own two ported spans (confirmed:
 * `sed -n '1327,1415p' routers/merged_runs.py | grep -n '    if [a-z]'`
 * matches only the list-comprehension `if e.get("kind") == "feedback"`
 * clause already classified above, never a bare `if <dict-or-list>:`).
 *
 * ── Hazard 8 (`isinstance(x, (int, float))` accepting `bool`) ──────────────
 *
 * `sed -n '1327,1415p' routers/merged_runs.py | grep -c isinstance` -> `0`.
 * N/A — no numeric/bool ambiguity anywhere in this task's own two ported
 * spans.
 *
 * ── Hazards 1/2/3/4/6/7 ───────────────────────────────────────────────────
 *
 * All N/A for this task's own two ported spans — `sed -n '1327,1415p'
 * routers/merged_runs.py | grep -n 'round(\|sorted(\|sum(\|//\|%'` matches
 * nothing (no banker's rounding, no `sorted()`/`sum()`, no floor-div/mod).
 * Hazard 4 (dict/insertion order): the events FILTER (`[e for e in events
 * if ...]`) preserves `events`' own array order — mirrored with `.filter`,
 * which never reorders; there is no separate sort/tie-break in either
 * ported function.
 *
 * ── Hazard 5 (bare `str(float)` vs `:.Nf`) ──────────────────────────────
 *
 * The ONE `str(...)` call in scope (`str((e.get("target") or {}).get
 * ("scope", "")).startswith(...)`, line 1391) wraps a value whose EXPECTED
 * type is already a string (a dict `scope` field) — genuinely defensive
 * coercion for malformed/legacy data, not a float-formatting site. Mirrored
 * `pyStr` (this file's own local copy — `str(None) == "None"`, not
 * `String(undefined) == "undefined"`) rather than `pyFloatRepr`/`pyFixed`,
 * which would be the wrong tool here (no numeric value is ever formatted in
 * either of this task's two ported spans).
 */
import type { FeedbackEvent, FeedbackTarget, RunLogEvent } from '../../api/types'
import { getHandle } from '../../storage/merged_runs_store'
import { runsStore } from '../../storage/runs_store'
import type { EvidenceEvent } from '../../storage/db'
import {
  appendFeedback as runManagerAppendFeedback,
  resolveRunLog,
  RunNotFoundError,
  type RunLogM2,
} from '../run_manager'
import { proposalPackageRegistry } from '../proposal/stores'
import { ProposalHttpError } from '../proposal/orchestrator/create_run'
import { pyReprQuoteOne } from '../proposal/py_repr'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers — per-module-copy convention (see
// `../proposal/orchestrator/create_run.ts`'s own module doc for why each
// module keeps its own copy rather than importing one).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` only when `key` is
 * ABSENT; a present `null`/`undefined` value passes through unchanged. */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Mirrors Python truthiness for `if x:` / `x or default`. */
function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

/** Mirrors Python's `x or default`. */
function pyOr(value: unknown, fallback: unknown): unknown {
  return pyTruthy(value) ? value : fallback
}

/** Mirrors `str()` on a value that may be Python `None` — `str(None) ==
 * "None"`, NOT `String(undefined) == "undefined"`. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

// ---------------------------------------------------------------------------
// appendFeedbackAnyRun — small unported helper: `services/feedback.py
// ::append_feedback`'s two-tier resolution (348-395). See the module doc's
// own section on why this task needed it.
// ---------------------------------------------------------------------------

/**
 * Append `event` to `runId`'s trigger-run log, active-registry-first, with
 * an on-disk (IndexedDB-persisted) fallback for a run that is not currently
 * active. Mirrors `services/feedback.py::append_feedback`'s two-tier
 * resolution:
 *   1. Active run (`../run_manager.ts#appendFeedback`, already ported M5,
 *      itself the TS mirror of `run_manager.py::append_feedback`) —
 *      appends via the SAME `EvidenceRecorder` path every tick/action event
 *      already uses.
 *   2. Not active: confirm a persisted header exists
 *      (`runsStore.getHeader`), then append directly to the `run_events`
 *      store at the next sequence index (`runsStore.getEvents(runId)
 *      .length`) — the storage-substrate equivalent of Python's "load the
 *      on-disk RunLog, append, write atomically" (there is no whole-file
 *      rewrite here: IndexedDB's own `add()`-at-next-seq IS this port's
 *      atomic-append primitive, the same one `EvidenceRecorder.append`
 *      itself uses for an active run — see that class's own doc comment).
 *   3. Neither: `RunNotFoundError` (mirrors Python's own raise from either
 *      tier — `run_id!r} not found: not in the active registry and no
 *      on-disk log`).
 *
 * NON-ALGORITHMIC: only ever appends; never touches a prior event, the
 * adapter, or the tick engine.
 */
async function appendFeedbackAnyRun(runId: string, event: FeedbackEvent): Promise<void> {
  try {
    await runManagerAppendFeedback(runId, event)
    return
  } catch (exc) {
    if (!(exc instanceof RunNotFoundError)) throw exc
  }

  const header = await runsStore.getHeader(runId)
  if (header === undefined) {
    throw new RunNotFoundError(`Unknown run_id: '${runId}'`)
  }
  const events = await runsStore.getEvents(runId)
  await runsStore.appendEvent(runId, events.length, event as unknown as EvidenceEvent)
}

/** Best-effort read of a run's full log, active-then-persisted, `null` when
 * neither exists — mirrors Python's OWN degrade-to-`None` behavior for a
 * missing trigger log file in `get_review_feedback_endpoint` (a MISSING
 * trigger log is NOT a 404 there, unlike an unknown `merged_run_id`).
 * Reuses `../run_manager.ts#resolveRunLog` (already ported, active-then-
 * disk) rather than re-deriving its header+events assembly — only the
 * not-found OUTCOME (throw vs. `null`) differs from that function's own
 * contract, so this is a thin catch wrapper, not a parallel implementation. */
async function tryResolveRunLog(runId: string): Promise<RunLogM2 | null> {
  try {
    return await resolveRunLog(runId)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// post_review_feedback_endpoint -> postReviewFeedbackEndpoint
// (routers/merged_runs.py:1327-1366)
// ---------------------------------------------------------------------------

/** Mirrors `ReviewFeedbackBody` (routers/merged_runs.py:1307-1321).
 * `feature_id` only applies to `scope="review_input"`; `labels`/`comment`
 * default to `{}`/`None` exactly like Python's own field defaults. */
export type ReviewFeedbackBody = {
  scope: 'review_input' | 'review_decision'
  case_id: string
  checkpoint_id: string
  stage: string
  review_target: string
  feature_id?: string | null
  labels?: Record<string, unknown>
  comment?: string | null
}

/**
 * Port of `post_review_feedback_endpoint` (routers/merged_runs.py:1327-1366).
 * See the module doc for the full control-flow enumeration.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`, or the paired
 *   trigger run has since gone missing (neither active nor persisted).
 */
export async function postReviewFeedbackEndpoint(
  mergedRunId: string,
  body: ReviewFeedbackBody,
): Promise<FeedbackEvent> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }

  const target: FeedbackTarget = {
    scope: body.scope,
    // Pydantic's `FeedbackTarget.model_dump()` always emits every field
    // (defaulted to `None` when absent) — these four are the "decision"/
    // "proposal"/"action"-scope anchors, always `null` for a review_input/
    // review_decision judgement, but still present in the dumped shape so a
    // byte-parity comparison against the real Python response has the SAME
    // key set, not merely the same review-anchor subset.
    event_ref: null,
    tick_index: null,
    proposal_id: null,
    action: null,
    case_id: body.case_id,
    checkpoint_id: body.checkpoint_id,
    stage: body.stage,
    review_target: body.review_target,
    feature_id: body.feature_id ?? null,
  }
  const event: FeedbackEvent = {
    kind: 'feedback',
    target,
    labels: body.labels ?? {},
    comment: body.comment ?? null,
  }

  try {
    await appendFeedbackAnyRun(handle.trigger_run_id, event)
  } catch (exc) {
    if (exc instanceof RunNotFoundError) {
      throw new ProposalHttpError(404, `Trigger run ${pyReprQuoteOne(handle.trigger_run_id)} not found`)
    }
    throw exc
  }

  return event
}

// ---------------------------------------------------------------------------
// get_review_feedback_endpoint -> getReviewFeedbackEndpoint
// (routers/merged_runs.py:1366-1415)
// ---------------------------------------------------------------------------

/** One `{id, version}` pair — always both-`null` or both-populated for
 * "package genuinely unknown" (trigger), but service/content can carry a
 * non-null `id` (from `handle.*_package_id`, always present) alongside a
 * `null` `version` (the package can no longer be found in the registry) —
 * mirrors Python's own independent `.get("id")`/`"version" if ... else None`
 * construction, which never couples the two fields' nullability together. */
export type PackageVersionInfo = { id: string | null; version: string | null }

export type ReviewFeedbackListResponse = {
  events: FeedbackEvent[]
  package_versions: {
    trigger: PackageVersionInfo
    service: PackageVersionInfo
    content: PackageVersionInfo
  }
}

/** `e.get("kind") == "feedback" and str((e.get("target") or {}).get
 * ("scope", "")).startswith("review_")` — mirrored against the RAW,
 * untyped shape Python itself reads here (a plain `json.loads(...)` dict,
 * never re-validated against any pydantic model — see the module doc's own
 * note on why this endpoint reads the log this way). `e`/`target` are cast
 * to `Record<string, unknown>` for exactly that reason: this function must
 * tolerate the SAME "any shape, even malformed" input Python's own raw
 * dict access does, not assume the caller's events are well-typed
 * `RunLogEvent`s. */
function isReviewFeedbackEvent(e: RunLogEvent): boolean {
  const raw = e as unknown as Record<string, unknown>
  if (pyGetDefault(raw, 'kind', null) !== 'feedback') return false
  const target = pyOr(pyGetDefault(raw, 'target', null), {}) as Record<string, unknown>
  const scope = pyStr(pyGetDefault(target, 'scope', ''))
  return scope.startsWith('review_')
}

/**
 * Port of `get_review_feedback_endpoint` (routers/merged_runs.py:1366-1415).
 * Pure disk (IndexedDB) read — nothing is recomputed, nothing is written.
 * See the module doc for the full control-flow enumeration.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`. (A missing
 *   trigger log is NOT a 404 — see `tryResolveRunLog`'s own doc comment.)
 */
export async function getReviewFeedbackEndpoint(mergedRunId: string): Promise<ReviewFeedbackListResponse> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }

  const runLog = await tryResolveRunLog(handle.trigger_run_id)
  const events = runLog?.events ?? []
  const reviewEvents = events.filter(isReviewFeedbackEvent) as FeedbackEvent[]

  const triggerPkg = runLog?.snapshot?.package ?? null
  const servicePkg = proposalPackageRegistry.get(handle.service_package_id)
  const contentPkg = proposalPackageRegistry.get(handle.content_package_id)

  return {
    events: reviewEvents,
    package_versions: {
      trigger: {
        id: (pyGetDefault((triggerPkg ?? {}) as Record<string, unknown>, 'id', null) as string | null),
        version: (pyGetDefault((triggerPkg ?? {}) as Record<string, unknown>, 'version', null) as string | null),
      },
      service: {
        id: handle.service_package_id,
        version: servicePkg ? ((servicePkg['version'] as string | undefined) ?? null) : null,
      },
      content: {
        id: handle.content_package_id,
        version: contentPkg ? ((contentPkg['version'] as string | undefined) ?? null) : null,
      },
    },
  }
}
