/**
 * `tick_merged_run_endpoint` / `_serialize_trigger_tick` /
 * `_override_nap_stage_ticks` — TS port of
 * `app/api/aica_api/routers/merged_runs.py` lines 934-1203 (the tick
 * endpoint BODY, 269 real LOC of the stated 272-line span — the trailing 3
 * lines are the next decorator), plus lines 183-210
 * (`_serialize_trigger_tick`) and 784-821 (`_override_nap_stage_ticks`) —
 * feature 026 (htmlapp Combined export), slice C4 Task 6.
 *
 * This is the single largest function in the C4 slice, the only
 * stateful-across-calls endpoint, and the one whose `CorrelationEntry`
 * output is the product claim of the whole Combined screen: it must point
 * at the proposal run THIS tick actually created or updated, never a
 * different one.
 *
 * `_override_nap_stage_ticks` is ported HERE (not in a later Task 7
 * `actions.ts`) per this task's own brief, which lists it as in-scope
 * reference material and requires its branch ("the nap-stage override
 * path") in Step 5's coverage list. It has NO caller within this file —
 * Python's own only caller is `accept_rest_endpoint` (merged_runs.py:824,
 * out of this task's endpoint range) — ported now as a small, independently
 * testable pure function for Task 7 to import rather than re-port.
 *
 * ── Recovery-semantics refactor (fixbug-0806) ─────────────────────────────
 * `_derive_content_context`/`_committed_plan_duration_sec` and their call
 * sites in `tickMergedRun` are ported below in full, INCLUDING threading
 * the derived `ContentContext` into the tick engine itself: Python's
 * `run_manager.tick` gained a `content_context` keyword this same refactor,
 * and this port's `../run_manager.ts#tick` (owned by a PARALLEL port task,
 * out of this file's scope) gained the matching `TickOpts.contentContext`
 * field — landed during this same porting pass, so `tickMergedRun` below
 * calls `triggerTick(handle.trigger_run_id, { contentContext: contentCtx })`
 * directly, no bridging needed.
 *
 * ── Step 1 — control-flow enumeration (written BEFORE any code below) ──────
 *
 * `tickMergedRun(mergedRunId)`:
 *   1. `getHandle(mergedRunId)` — 404 (`ProposalHttpError`) if absent:
 *      "Merged run {id!r} not found".
 *   2. `triggerTick(handle.trigger_run_id)` — catches a thrown
 *      `TriggerRunNotFoundError` -> 404: "Trigger run {id!r} not found".
 *      Any OTHER thrown error propagates uncaught (mirrors Python's
 *      `except run_manager.RunNotFoundError` — narrowly scoped).
 *   3. `serializeTriggerTick(outcome)` -> `triggerDict` (fully
 *      deterministic — no ids). `resp = {trigger: triggerDict, proposal:
 *      null, correlation: null}`.
 *   4. `d = outcome.decision`; `fired = Boolean(d && d.fire_control.fired &&
 *      d.proposal !== null)`; `purpose = d ? mapTriggerPurpose(d.result_type)
 *      : null`.
 *
 *   BRANCH A — new-fire create/replace (runs when `fired && outcome.paused
 *   && purpose !== null` AND (no current proposal OR the current rest
 *   journey just finished OR this fire's category differs from the current
 *   proposal's)). `outcome.paused` gates on run_manager.tick()'s
 *   post-suppression signal (fixbug-0804) so a fire the 30-minute
 *   post-response de-dup gate has suppressed — e.g. a declined rest
 *   proposal's still-`fired` cooldown re-fire — never re-spawns a fresh
 *   proposal run; see the guard's own inline comment for the full
 *   rationale:
 *     A1. Build `stage`/`world` via `mapLifecycleStage`/`buildWorldFromTick`.
 *     A2. Validate `handle.proposal_mode` is `'interactive'|'quick_check'`
 *         — HARD FAILURE (uncaught `ProposalHttpError(422)`) if not; mirrors
 *         Python's `CreateProposalRunBody(...)` pydantic construction
 *         raising `ValidationError`, caught ONLY by the (different, wider)
 *         FastAPI request-validation layer OUTSIDE this function — i.e.
 *         this exception is NOT caught by anything inside
 *         `tick_merged_run_endpoint` itself, so it propagates all the way
 *         out. See "Mode validation" below for the exact shape decision.
 *     A3. `createProposalRun(proposalBody)` — SOFT FAILURE: a thrown
 *         `ProposalHttpError` here IS caught -> `triggerDict.proposal_error
 *         = readableErrorText(...)`, and the function RETURNS EARLY (no
 *         correlation, no handle mutation, no save — `resp` as built so
 *         far, unchanged otherwise).
 *     A4. On success: `handle.proposal_run_ids.push(...)`,
 *         `current_proposal_run_id`/`current_proposal_category` updated,
 *         `rest_stage_synced` reset to `null`, a `CorrelationEntry` built
 *         and appended to `handle.correlation_log`, `saveHandle(handle)`.
 *         `resp.proposal`/`resp.correlation` set.
 *
 *   Branch A does NOT `return` after a success (only after the soft-fail in
 *   A3) — control falls through to Branch B. This is safe: A4 always sets
 *   `rest_stage_synced = null`, and Branch B's own OUTER guard requires
 *   `rest_stage_synced !== null` — so Branch B's guard is always FALSE on
 *   the very tick Branch A just created a run. Structurally, not just by
 *   convention, mutually exclusive per tick (verified by reading both
 *   guards together, not assumed).
 *
 *   BRANCH B — rest-journey auto-drive (runs when `handle
 *   .current_proposal_run_id !== null && handle.rest_stage_synced !== null
 *   && outcome.tickState !== null`):
 *     `runId = handle.current_proposal_run_id`; `dynamic =
 *     pyGetDefault(outcome.tickState.signals ?? {}, 'dynamic', {})`;
 *     `journeyPlog = null` (tracks whether EITHER sub-branch below actually
 *     mutated the proposal run this tick).
 *
 *     B1. `rest_stage_synced === 'before' && dynamic.motionState ===
 *         'STOPPED'` (recovery has reached the rest spot):
 *       - self-healing re-read: `current = getProposalRun(runId)`; if its
 *         `journey_state.lifecycle_stage === 'before_rest_until_stop'` ->
 *         `applyJourneyAction(runId, {action_type: 'rest_spot_arrived'})`;
 *         ELSE (an earlier partial attempt already advanced it) ->
 *         `journeyPlog = current` (no re-issue — its own precondition does
 *         not check lifecycle_stage, so re-issuing here would silently
 *         duplicate a REST_SPOT_ARRIVED event).
 *       - `alreadyStarted = journeyPlog.events.some(e => e.event_type ===
 *         'REST_STARTED')`; if not -> `applyJourneyAction(runId,
 *         {action_type: 'rest_started'})`.
 *       - `handle.rest_stage_synced = 'during'`.
 *       - any `ProposalHttpError` anywhere in B1 -> `triggerDict
 *         .proposal_error = readableErrorText(...)`; `rest_stage_synced`
 *         stays `'before'` (retried next tick). NOTE: if the FIRST
 *         `applyJourneyAction` call (rest_spot_arrived) succeeds but the
 *         SECOND (rest_started) then throws, `journeyPlog` is NOT `null`
 *         (it holds the first call's result) — so the post-branch
 *         `journeyPlog !== null` check below STILL fires a correlation
 *         entry for the partial progress, even though `proposal_error` is
 *         ALSO set this same tick (two different fields — no contradiction:
 *         `resp.trigger.proposal_error` vs `resp.proposal`/`resp
 *         .correlation`).
 *
 *     B2. `rest_stage_synced === 'during' && outcome.runState.recovery ==
 *         null` (the tick engine just collapsed `recovery` back to `null` —
 *         the "resuming" tick):
 *       - self-healing re-read: `current = getProposalRun(runId)`; if
 *         `lifecycle_stage === 'during_rest_stopped'` -> derive
 *         drowsiness/fatigue from THIS tick's `simulated` signals
 *         (`pyRound`), `applyJourneyAction(runId, {action_type:
 *         'rest_completed', payload: {post_rest: {...}}})`; ELSE (already
 *         advanced past that stage on an earlier partial attempt) ->
 *         `journeyPlog = current`, drowsiness/fatigue instead RECOVERED
 *         from the run's own LAST `REST_COMPLETED` event's payload (never
 *         re-derived from a later, already-advanced tick).
 *       - `if (journeyPlog.journey_state.playback_state === 'active')` ->
 *         `applyJourneyAction(runId, {action_type: 'complete'})`.
 *       - `if (['active','backgrounded'].includes(journeyPlog
 *         .journey_state.playback_state))` -> `applyJourneyAction(runId,
 *         {action_type: 'stop'})` (reads `journeyPlog` FRESH — may have
 *         just changed above).
 *       - `recomputeProposalRun(runId, {overrides: [...2 FieldOverrides]})`.
 *       - `handle.rest_stage_synced = 'after'`; `triggerDict.paused = true`
 *         (RESPONSE-ONLY mutation — does not touch the trigger `RunState`
 *         server-side; the next `/tick` call resumes normally).
 *       - any `ProposalHttpError` anywhere in B2 -> `triggerDict
 *         .proposal_error = readableErrorText(...)`; `rest_stage_synced`
 *         stays `'during'` (retried next tick; whatever step already
 *         succeeded before the throw is NOT re-issued next time, since the
 *         re-read at the top of B2 sees the run's ACTUAL current state).
 *         VERIFIED-NOT-ASSUMED NUANCE (found by a spy-forced test, not by
 *         reading the code alone): `applyJourneyAction(..., 'rest_completed'
 *         )`'s own journey-engine handler ALREADY transitions
 *         `journey_state.lifecycle_stage` to `'after_rest_before_restart'`
 *         as PART OF `rest_completed` itself — a step BEFORE `recompute` in
 *         this same B2 body — so a `resp.proposal` returned on a tick where
 *         ONLY `recompute` failed (rest_completed already succeeded) STILL
 *         reports `lifecycle_stage === 'after_rest_before_restart'`, even
 *         though `handle.rest_stage_synced` is still `'during'` and
 *         `triggerDict.paused` was NEVER set `true` for that tick. A caller
 *         (or a test) that treats `lifecycle_stage` alone as "the after-rest
 *         transition fully completed" is wrong on exactly this partial-
 *         failure tick — `triggerDict.paused === true` is the correct
 *         signal (matches Python's OWN regression test's choice,
 *         `test_rest_journey_recovers_after_transient_post_completion_
 *         failure`: `assert body["trigger"]["paused"] is True`).
 *
 *     Neither B1 nor B2's outer condition may hold (e.g. still driving
 *     toward the rest spot with `rest_stage_synced === 'before'`, or mid-nap
 *     with `rest_stage_synced === 'during'` and `recovery` still active) —
 *     `journeyPlog` stays `null`, nothing below fires: no proposal, no
 *     correlation, no ADDITIONAL `handle` mutation beyond whatever the
 *     content-episode-lifetime step (below) already did. NOTE (recovery-
 *     semantics refactor, fixbug-0806): this doc comment previously said
 *     such a tick calls `saveHandle` ZERO times — no longer true, since
 *     `saveHandle` is now called unconditionally once per tick regardless
 *     of Branch A/B (see the new step below) — but this branch itself still
 *     never triggers a SECOND `saveHandle` call of its own.
 *
 *     If `journeyPlog !== null` (either B1 or B2 progressed the run this
 *     tick): build a `CorrelationEntry` (`trigger_tick_index`,
 *     `proposal_run_id: runId`, `proposal_event_ids` from `journeyPlog
 *     .events`), append to `handle.correlation_log`, `saveHandle(handle)`
 *     (a SECOND call this tick, on top of the unconditional one below —
 *     mirrors Python's own two independent `save_handle` call sites),
 *     set `resp.proposal`/`resp.correlation`.
 *
 *   5. Return `resp`.
 *
 * ── Recovery-semantics refactor (fixbug-0806), Task 9 — inserted between
 *    step 2 (tick) and the old step 3/4 numbering above ─────────────────
 * BEFORE calling `triggerTickWithContent`: read the CURRENT proposal run
 * (`getProposalRun`, `null` on 404/unreadable — caught narrowly, same
 * `ProposalHttpError`-only convention as everywhere else in this file) and
 * derive its `ContentContext` (`deriveContentContext`) — the episode
 * ACTUALLY playing right now, threaded into the tick call so the engine's
 * relief/freeze math matches what the driver really has on. AFTER ticking,
 * BEFORE Branch A: the content-episode-lifetime step — `null` content
 * context clears `handle.content_started_elapsed_sec`; a non-null one seeds
 * it (first tick of a new episode) and, once the plan's own
 * `committedPlanDurationSec` has elapsed, drives a `'complete'`
 * `applyJourneyAction` (a caught `ProposalHttpError` here becomes
 * `triggerDict.proposal_error`, exactly like every other soft-fail site in
 * this file) — then `saveHandle(handle)` UNCONDITIONALLY, once, every
 * single tick (a new call site independent of Branch A/B's own two).
 *
 * `overrideNapStageTicks(scenario, recoveryOptionId, napMinutes)` — PURE,
 * never mutates `scenario` (or anything reachable from it) in place; always
 * returns a NEW `ScenarioDefM2`. `newTicks = pyRound((napMinutes * 60) /
 * scenario.tick_seconds)` applied to ONLY the matched option's `phase ===
 * 'nap' && motion === 'STOPPED'` stage; every other stage/option passes
 * through by VALUE (Python: by reference — `else: stage`/`else: option`;
 * here: same object reference, since nothing rebuilds it — see "Hazard 4"
 * below for why this is the right mirror, not merely convenient).
 *
 * ── Reuse, not rewrite ──────────────────────────────────────────────────
 * `mapTriggerPurpose`/`mapLifecycleStage`/`buildWorldFromTick` (`./adapter`,
 * C4 Task 2); `triggerTick`/`TriggerRunNotFoundError`/`TickOutcome`
 * (`../run_manager`, already-reviewed trigger engine); `createProposalRun`/
 * `ProposalHttpError`/`ProposalHttpDetail` (`../proposal/orchestrator
 * /create_run`, C4a Task 3); `getProposalRun`/`applyJourneyAction`
 * (`../proposal/orchestrator/journey_action`, C4a Task 6);
 * `recomputeProposalRun`/`RecomputeRequest` (`../proposal/orchestrator
 * /recompute`, C4a Task 5); `FieldOverride` (`../proposal/world_overrides`);
 * `readableErrorText` (`./run_setup`, C4 Task 5 — that file's own doc
 * comment explicitly anticipated this task importing it rather than
 * re-deriving a FOURTH copy: "ported now anyway ... ready for that later
 * task to import"); `getHandle`/`saveHandle` (`../../storage
 * /merged_runs_store`, C4 Task 3).
 *
 * ── Mode validation (Branch A2) — a shape decision, disclosed ──────────────
 * Python's `CreateProposalRunBody(..., mode=handle.proposal_mode, ...)`
 * constructs a REAL pydantic model; `mode: ProposalRunMode` is the ONLY
 * field on that construction call genuinely reachable-invalid from THIS
 * call site (verified directly: `world` is already a validated `World`
 * instance from `buildWorldFromTick`, so passing it through triggers no
 * nested re-validation errors — confirmed empirically against a real
 * `World.model_validate(...)` instance, not assumed; `trigger_purpose`/
 * `lifecycle_stage` come from `mapTriggerPurpose`/`mapLifecycleStage`,
 * which only ever return known-good enum literals; every other field is a
 * plain `str`/`int`/`dict` that pydantic accepts unconditionally). A
 * failing `mode` produces EXACTLY one pydantic error entry — verified with
 * a real interpreter: `{"type": "enum", "loc": ["mode"], "msg": "Input
 * should be 'interactive' or 'quick_check'", "input": <value>, "ctx":
 * {...}, "url": "https://errors.pydantic.dev/2.13/..."}`. This function
 * throws a BARE-STRING `ProposalHttpError(422, ...)` embedding the same
 * `msg` text, rather than reproducing pydantic's full `.errors()` array
 * (type/loc/ctx/a pydantic-version-tied `url`) — matching THIS SAME FILE's
 * own established precedent for a caught pydantic `ValidationError`
 * (`../proposal/orchestrator/create_run.ts`'s `buildProposalOpportunity`
 * doc comment: "a clean single-line message rather than pydantic's
 * multi-line dump ... since nothing in this port's call sites depends on
 * that formatting"). `handle.proposal_mode` is reachable-invalid via the
 * PUBLIC API (`CreateMergedRunBody.proposal_mode` is an unconstrained
 * `str` on both sides — verified: `create_merged_run_endpoint` forwards
 * `body.proposal_mode` to `create_handle` with zero validation), so this
 * is a real, not merely theoretical, branch — covered by a direct test,
 * not skipped.
 *
 * ── Hazard pass (all eight) ─────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): THREE `round()` sites — the two
 *   drowsiness/fatigue roundings in Branch B2 (`round(simulated.get(
 *   "drowsiness", 0.0))`/`...fatigue...`) and `_override_nap_stage_ticks`'s
 *   own `new_ticks`. All three use the local `pyRound` below (floor-based,
 *   correct for negative inputs — see Hazard 3 for why negative inputs are
 *   real here, not merely theoretical).
 * - Hazard 2 (`sorted()`/`.sort()`): none in any of the three ported
 *   functions (all three read in full) — N/A.
 * - Hazard 3 (`//`/`%` floor division): **ZERO** `//`/`%` operators
 *   anywhere in the three ported spans — verified directly, not assumed:
 *   `sed -n '934,1203p;784,821p;183,210p' routers/merged_runs.py | grep -n
 *   '//'` and the same piped to `grep -n '%'` BOTH return no output. The
 *   task brief predicted hazard 3 as "the likely biter" here (tick↔minute
 *   conversion, nap-stage override) — checked directly and the prediction
 *   does NOT hold for this function: `_override_nap_stage_ticks`'s
 *   `nap_minutes * 60 / scenario.tick_seconds` is Python TRUE division
 *   (`/`), immediately wrapped in `round()` — hazard 1 (banker's rounding),
 *   not hazard 3. Reported honestly rather than silently reclassified.
 *   The NEGATIVE-OPERAND question the brief asks still applies to this
 *   `round()` site, though: `AcceptRestBody.nap_minutes: int | None` carries
 *   NO positivity constraint in Pydantic (verified: `models/merged_run.py`
 *   read directly, no `gt=`/`ge=` on the field) — so `nap_minutes` CAN be
 *   negative through the public API, and `pyRound` (unlike `Math.round`) is
 *   verified correct for negative inputs by a direct test with
 *   `nap_minutes=-8` against a real Python capture (`round(-8*60/180) ==
 *   round(-2.666...) == -3`).
 * - Hazard 3b (a SECOND, adjacent divide-by-zero hazard, not `//`/`%` but
 *   found while auditing this site): `scenario.tick_seconds: int` ALSO
 *   carries no positivity constraint in Pydantic (`models/scenario.py`,
 *   read directly). Both real committed scenarios
 *   (`uc01_fatigue_recovery_v0_1`/`uc02_monotony_v0_1`) use `180` — verified
 *   by reading both JSON files directly, not assumed — so this is
 *   unreachable via real committed scenario data, but a malformed/hand-
 *   edited scenario with `tick_seconds: 0` would make Python raise a loud
 *   `ZeroDivisionError` (uncaught by either `except` clause in
 *   `accept_rest_endpoint`, so it surfaces as an unhandled 500 — same
 *   "main.py has no exception_handler" fact Task 2's report established
 *   for the analogous `total_km === 0` finding) while a naive JS port would
 *   silently produce `Infinity`/`NaN` instead. Guarded explicitly here
 *   (`overrideNapStageTicks` throws a plain `Error` on `tickSeconds === 0`)
 *   to match Python's LOUD failure rather than disguise it — the same
 *   divergence CLASS Task 2's review flagged as Important, fixed
 *   preemptively here rather than left for a future review round.
 * - Hazard 4 (dict/insertion order): the `proposal_event_ids` arrays built
 *   from `plog.events`/`journeyPlog.events` (a plain `.map()` over an
 *   already-ordered array — order is a structural property of the array,
 *   not incidental) is the ONE ordering-sensitive site the RESPONSE
 *   exposes. `overrideNapStageTicks`'s `stages`/`recovery_options` arrays
 *   are built via `.map()` preserving each array's own existing order too
 *   (never re-sorted). No dict/object-key-order site in either function
 *   (no object literal here is ever iterated for its OWN key order to
 *   produce an array — `MergedTickResponse`'s three top-level keys are a
 *   fixed object literal, not order-sensitive per `../merged/types.ts`'s
 *   own module doc).
 * - Hazard 5 (bare `str(float)`): no float is ever interpolated into a
 *   user-facing message string in either of the three functions (the ONE
 *   string-interpolation site, Branch A2's mode-validation message, embeds
 *   the REJECTED STRING value only, via `pyRepr`-equivalent quoting — no
 *   float ever reaches that slot, `proposal_mode` is always a `str`).
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats anywhere — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): **ZERO**
 *   `isinstance` calls anywhere in the three ported spans — verified:
 *   `sed -n '934,1203p;784,821p;183,210p' routers/merged_runs.py | grep -n
 *   isinstance` -> no output. N/A, no site to audit for this hazard in
 *   this file.
 *
 * ── The three-way `.get` distinction — full audit, with commands ─────────
 * ```
 * $ F=app/api/aica_api/routers/merged_runs.py
 * $ sed -n '183,210p' "$F" | grep -n '\.get('
 * 13:    dynamic = signals.get("dynamic", {})
 * 23:        "speed_kph": dynamic.get("speedKph"),
 * 24:        "motion_state": dynamic.get("motionState"),
 * 25:        "recovery_phase": dynamic.get("recoveryPhase"),
 * 26:        "is_traffic_jam": dynamic.get("isTrafficJam"),
 * 27:        "segment_type": dynamic.get("segmentType"),
 * $ sed -n '934,1203p' "$F" | grep -n '\.get('
 * 149:        dynamic = (outcome.tick_state.signals or {}).get("dynamic", {})
 * 152:        if handle.rest_stage_synced == "before" and dynamic.get("motionState") == "STOPPED":
 * 190:                    simulated = (outcome.tick_state.signals or {}).get("simulated", {})
 * 191:                    drowsiness = round(simulated.get("drowsiness", 0.0))
 * 192:                    fatigue = round(simulated.get("fatigue", 0.0))
 * 219:                    drowsiness = post_rest.get("drowsiness_level", 0)
 * 220:                    fatigue = post_rest.get("fatigue_level", 0)
 * $ sed -n '784,821p' "$F" | grep -n '\.get('
 * (no output)
 * ```
 * 13 real `.get()` hits total (0 false positives — no `@router.get`/registry
 * `.get()` calls fall inside these three spans), classified as 7 two-arg +
 * 6 one-arg = 13. (The `or`-guarded-receiver bullet below re-describes two
 * of the 7 from a different angle; it is not a third disjoint bucket, and
 * an earlier revision's 5 + 6 + 2 only reached 13 by double-counting them.)
 *   - **`pyGetDefault` (two-arg `.get(key, default)`) — 7 sites**:
 *     `signals.get("dynamic", {})` (×2, `_serialize_trigger_tick` +
 *     Branch B's own top-of-block read), `(...).get("simulated", {})`,
 *     `simulated.get("drowsiness", 0.0)`, `simulated.get("fatigue", 0.0)`,
 *     `post_rest.get("drowsiness_level", 0)`, `post_rest.get(
 *     "fatigue_level", 0)`.
 *
 *     CORRECTED: an earlier revision said 5 and excluded the two
 *     `simulated.get(...)` calls on the grounds that they are `round()`
 *     sites and therefore "not a `.get()` site". That reasoning is wrong —
 *     being wrapped in `round()` and being a two-arg `.get(key, default)`
 *     are not mutually exclusive, and both facts hold. `tick.ts` already
 *     implemented them correctly with `pyGetDefault` (see the `drowsiness`/
 *     `fatigue` reads in Branch B2); only this classification was off.
 *   - **Plain one-arg `.get(key)`, no default, no `or` → property read with
 *     `?? null`/`?? undefined` normalization — 6 sites**: the five
 *     `dynamic.get(...)` reads in `_serialize_trigger_tick`, plus Branch
 *     B1's own `dynamic.get("motionState")` (compared directly to a string
 *     literal, so no explicit `?? null` is even needed — `undefined ===
 *     'STOPPED'` is already `false`, matching Python's `None == "STOPPED"`
 *     -> `False`).
 *   - **`or`-guarded RECEIVER (not an `or` on the `.get()` result) — the
 *     same 2 sites already counted above**: `(outcome
 *     .tick_state.signals or {})` appears TWICE (Branch B1's `dynamic =`
 *     line, Branch B2's `simulated =` line) — verified DEAD by Pydantic
 *     field typing (`TickState.signals: dict[str, Any] = {}`, never
 *     `Optional` — read directly in `models/run.py`, not assumed), so this
 *     `or {}` never actually substitutes for real data; mirrored with a
 *     plain `?? {}` (behaviourally identical for an always-non-null field,
 *     disclosed rather than silently treated as a true `pyTruthy` site).
 *   - **`round()` — see Hazard 1.** The two `round(simulated.get(...))`
 *     calls are counted above as the two-arg `.get()` sites they are; they
 *     ALSO carry hazard-1 (banker's-rounding) exposure. Listed twice on
 *     purpose, under two different audits, not double-counted within one.
 * `outcome.evaluated_tick_index or 0` (×3: Branch A's `simulation_time=`
 * and BOTH `CorrelationEntry.trigger_tick_index=` sites) is Python
 * truthiness `or`, NOT `.get()` — but resolved here rather than via
 * `pyTruthy` because the substituted default (`0`) is OBSERVABLY IDENTICAL
 * to what `?? 0` already produces for every possible `evaluated_tick_index`
 * value: `null`/`undefined` -> `0` either way, and a real `0` -> `0` either
 * way (the ONE value `or` would additionally treat as falsy). No other
 * `number` value is falsy in either language. Mirrored with plain `?? 0`,
 * not `pyTruthy(...) ? ... : 0` — a genuine equivalence, not an
 * unexamined shortcut (see `evaluatedTickIndexOrZero` below).
 * `d && d.fire_control.fired && d.proposal is not None` (`bool(...)`):
 * `d` is `None` or a `DecisionResult` pydantic instance; a non-`None`
 * pydantic `BaseModel` has NO custom `__bool__`/`__len__`, so it is ALWAYS
 * truthy — `d and X` collapses to `(d !== null) && X` exactly, mirrored
 * with `Boolean(d !== null && ...)`, not `pyTruthy(d) && ...` (would be
 * over-general for a value that can never legitimately be a Python-falsy
 * non-`None` object here).
 *
 * ── A singular/plural pair, checked ──────────────────────────────────────
 * No `X`/`Xs[0]`-shaped aliasing anywhere in this file's own scope (the
 * three `MergedInstantResult` pairs the plan calls out —
 * `fire`/`fires`, `rest_spot`/`rest_spots`, `rest_option`/`rest_options` —
 * belong to `./quickview.ts`, a different C4 task; this file's own
 * `MergedTickResponse` has no analogous pair — `proposal`/`correlation`
 * are two independently-nullable fields, not a singular/plural pair).
 */
import type { CorrelationEntry, MergedRunHandle, MergedTickResponse } from './types'
import { getHandle, saveHandle } from '../../storage/merged_runs_store'
import {
  tick as triggerTick,
  getScenario,
  RunNotFoundError as TriggerRunNotFoundError,
  type TickOutcome,
} from '../run_manager'
import type { ContentContext, RecoveryOption, RecoveryStage } from '../../api/types'
import { mapTriggerPurpose, mapLifecycleStage, buildWorldFromTick, type World } from './adapter'
import type { ScenarioDefM2 } from '../event_plan'
import { ProposalHttpError, createProposalRun, type CreateProposalRunBody } from '../proposal/orchestrator/create_run'
import { getProposalRun, applyJourneyAction } from '../proposal/orchestrator/journey_action'
import { recomputeProposalRun, type RecomputeRequest } from '../proposal/orchestrator/recompute'
import type { FieldOverride } from '../proposal/world_overrides'
import type { ProposalRunLog } from '../proposal/run_manager'
import { readableErrorText } from './run_setup'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers (per-module-copy convention — see
// e.g. `./run_setup.ts`'s own identical `pyGetDefault`/`pyTruthy` pair).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` only when `key` is
 * ABSENT; a present `null`/`undefined` value passes through unchanged. */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Python `round()` — round HALF TO EVEN (banker's rounding), NOT
 * `Math.round`'s half-up. Floor-based (not `x - 0.5`), so correct for
 * negative inputs too — see this module's own doc comment, Hazard 1/3, for
 * why a negative input is a REAL case here, not merely theoretical. Same
 * per-module-copy convention as `./adapter.ts`'s own `pyRound`. */
function pyRound(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

// ---------------------------------------------------------------------------
// _serialize_trigger_tick -> serializeTriggerTick (merged_runs.py:183-210)
// ---------------------------------------------------------------------------

/**
 * Mirrors `_serialize_trigger_tick` exactly: the authoritative display
 * position (`route_fraction`/`distance_km`) from the evaluated `TickState`,
 * the per-tick dynamic-tier display signals, plus `paused`/`completed`/
 * `decision`/`error`. Fully deterministic — no ids, no clock reads — the
 * ONE piece of this task's output safe to `expectParity` byte-exact against
 * a real Python capture on every single tick, not just the "interesting"
 * ones.
 *
 * Recovery-semantics refactor (fixbug-0806, Task 9): also surfaces the
 * content-episode dynamic signals (`contentActive`/`stimulusFrozen`/
 * `continuousDrivingMin`, published by `../tick_engine.ts#advanceTick` onto
 * `signals.dynamic`) as `content_active`/`stimulus_frozen`/
 * `continuous_driving_min` — additive, snake_case, matching this
 * function's existing field convention — so a caller can observe the
 * episode `deriveContentContext` below derives actually reaching the
 * engine, without threading the whole nested `TickState.signals` dict
 * through the API.
 *
 * Live driver-signal chart (fixbug-0806): also surfaces the three
 * DRIVER-STATE signals the projection's `signal_series` carries
 * (`./preview.ts`) — simulated `drowsiness`/`fatigue` and the dynamic
 * `monotonyLevel`, flattened as `drowsiness`/`fatigue`/`monotony_level`.
 * Same three quantities, same 0-100 scale, so the live chart under the
 * projection plots what the driver ACTUALLY did (given the reviewer's
 * accept/decline answers) against what the projection predicted. Additive;
 * `null` when a tick has no evaluated state.
 */
export function serializeTriggerTick(outcome: TickOutcome): Record<string, unknown> {
  const ts = outcome.tickState
  const routeFraction = ts !== null ? ts.route_fraction : null
  const distanceKm = ts !== null ? ts.distance_km : null
  // Mirrors `(ts.signals or {}) if ts is not None else {}` — the `or {}`
  // half is DEAD by Pydantic field typing (`TickState.signals: dict = {}`,
  // never Optional — see this module's own `.get` audit above), so a plain
  // `?? {}` is an exact, not merely convenient, mirror.
  const signals = (ts !== null ? ts.signals : {}) as Record<string, unknown>
  const dynamic = pyGetDefault(signals ?? {}, 'dynamic', {}) as Record<string, unknown>
  const simulated = pyGetDefault(signals ?? {}, 'simulated', {}) as Record<string, unknown>

  return {
    decision: outcome.decision,
    error: outcome.algorithmError,
    paused: outcome.paused,
    completed: outcome.completed,
    tick_index: outcome.evaluatedTickIndex,
    route_fraction: routeFraction,
    distance_km: distanceKm,
    // One-arg `.get(key)`, no default — `undefined` (absent) normalizes to
    // `null`, matching Python's `None` default; a present value (including
    // an explicit `null`) passes through unchanged either way.
    speed_kph: (dynamic.speedKph as unknown) ?? null,
    motion_state: (dynamic.motionState as unknown) ?? null,
    recovery_phase: (dynamic.recoveryPhase as unknown) ?? null,
    is_traffic_jam: (dynamic.isTrafficJam as unknown) ?? null,
    segment_type: (dynamic.segmentType as unknown) ?? null,
    content_active: (dynamic.contentActive as unknown) ?? null,
    stimulus_frozen: (dynamic.stimulusFrozen as unknown) ?? null,
    continuous_driving_min: (dynamic.continuousDrivingMin as unknown) ?? null,
    drowsiness: (simulated.drowsiness as unknown) ?? null,
    fatigue: (simulated.fatigue as unknown) ?? null,
    monotony_level: (dynamic.monotonyLevel as unknown) ?? null,
  }
}

// ---------------------------------------------------------------------------
// _override_nap_stage_ticks -> overrideNapStageTicks (merged_runs.py:784-821)
// ---------------------------------------------------------------------------

/**
 * Mirrors `_override_nap_stage_ticks` exactly. See this module's own doc
 * comment (Hazard 1/3/3b) for the banker's-rounding + divide-by-zero-guard
 * reasoning, and for why a negative `napMinutes` is a real, not merely
 * theoretical, input.
 *
 * NEVER mutates `scenario` (or any option/stage reachable from it) — always
 * returns a NEW `ScenarioDefM2` with NEW `recovery_options`/`stages`
 * arrays. Options/stages that are NOT the match pass through by the SAME
 * VALUE Python's own `else: option`/`else: stage` branches keep (a plain
 * reference here, since nothing reconstructs them) — verified by a
 * dedicated mutation-safety test asserting the ORIGINAL scenario's nested
 * arrays/objects are unchanged after a real call, not merely inferred from
 * reading the code.
 *
 * `grants_moving_recovery` — this doc comment previously flagged it as "a
 * Pydantic-materialized `RecoveryStage` default, `= False`, absent from the
 * raw scenario JSON both source trees ship" and a pre-existing gap in this
 * port's `RecoveryStage` type. STALE as of the recovery-semantics refactor
 * (fixbug-0806): the field was DELETED from the Python `RecoveryStage`
 * model entirely (`models/scenario.py`, see this port's own diff set,
 * `01-models.diff`) — MOVING-state recovery is no longer gated by a
 * per-stage opt-in flag at all (superseded by the refactor's own relief/
 * freeze mechanics, `../tick_engine.ts`). So there is no longer any
 * divergence to disclose here, staleness or otherwise: `RecoveryStage`
 * (`../../api/types.ts`) already has no such field, matching current
 * Python exactly. The spread `{...stage, ticks: newTicks}` below still
 * preserves whatever runtime fields `stage` actually carries regardless of
 * the static type, same as before this correction.
 *
 * @throws Error — `scenario.tick_seconds === 0` (mirrors Python's loud,
 *   unhandled `ZeroDivisionError` rather than a silently-produced
 *   `Infinity`/`NaN` — see Hazard 3b).
 */
export function overrideNapStageTicks(
  scenario: ScenarioDefM2,
  recoveryOptionId: string,
  napMinutes: number,
): ScenarioDefM2 {
  if (scenario.tick_seconds === 0) {
    throw new Error(
      'overrideNapStageTicks: scenario.tick_seconds is 0 — division by zero (Python raises ZeroDivisionError here; mirrored as a loud failure rather than a silent Infinity/NaN)',
    )
  }
  const newTicks = pyRound((napMinutes * 60) / scenario.tick_seconds)
  const newRecoveryOptions: RecoveryOption[] = (scenario.recovery_options ?? []).map((option) => {
    if (option.id !== recoveryOptionId) return option
    const newStages: RecoveryStage[] = (option.stages ?? []).map((stage) =>
      stage.phase === 'nap' && stage.motion === 'STOPPED' ? { ...stage, ticks: newTicks } : stage,
    )
    return { ...option, stages: newStages }
  })
  return { ...scenario, recovery_options: newRecoveryOptions }
}

// ---------------------------------------------------------------------------
// _derive_content_context -> deriveContentContext (merged_runs.py:946-978)
// Recovery-semantics refactor (fixbug-0806), Task 9.
// ---------------------------------------------------------------------------

/** Mirrors `_PURPOSE_BY_CATEGORY` (merged_runs.py:946-949). */
const PURPOSE_BY_CATEGORY: Record<string, ContentContext['purpose']> = {
  monotony_prevention: 'monotony',
  rest_required: 'pre_rest',
}

/**
 * Mirrors `_derive_content_context` exactly. The content episode playing on
 * the merged run's CURRENT proposal, if any — recovery design §4.
 * `contentActive` is true exactly while the proposal's plan is `active` or
 * `backgrounded`; the purpose comes from the opportunity the content
 * answers, and flips to `post_rest` once the journey has passed the rest
 * (lifecycle_stage `after_rest_before_restart`).
 *
 * Returns `null` when nothing is playing, or `plog` itself is `null` (no
 * current proposal, or it was unreadable — see `tickMergedRun`'s own
 * `try/catch` around `getProposalRun`, mirroring Python's `except
 * HTTPException: current_plog = None`). The episode-length EXPIRY
 * (CDC-SU slide 81 一定曲数再生完了 / 1セット完了) is applied by the CALLER
 * (`tickMergedRun`), not here — this function is a pure read of the
 * proposal run's CURRENT state.
 *
 * `handle.current_proposal_category or ""` (Python) then `.get(key,
 * "monotony")` collapses to a single object-index lookup here: whether the
 * category is `null`, an empty string, or simply not one of the two keys
 * `PURPOSE_BY_CATEGORY` declares, indexing with it yields `undefined`
 * either way, so `?? 'monotony'` reproduces Python's two-step
 * or-then-.get(default) exactly — a genuine equivalence, not an unexamined
 * shortcut (mirrors this module's own `evaluatedTickIndexOrZero`
 * reasoning for the analogous `or 0` case).
 */
export function deriveContentContext(
  handle: Pick<MergedRunHandle, 'current_proposal_category'>,
  plog: ProposalRunLog | null,
): ContentContext | null {
  if (plog === null) return null
  const js = plog.journey_state
  if (js.playback_state !== 'active' && js.playback_state !== 'backgrounded') return null
  if (js.active_service_id === null) return null

  const purpose: ContentContext['purpose'] =
    js.lifecycle_stage === 'after_rest_before_restart'
      ? 'post_rest'
      : (PURPOSE_BY_CATEGORY[handle.current_proposal_category ?? ''] ?? 'monotony')

  return { service_id: js.active_service_id, purpose }
}

// ---------------------------------------------------------------------------
// _committed_plan_duration_sec -> committedPlanDurationSec (merged_runs.py:981-991)
// Recovery-semantics refactor (fixbug-0806), Task 9.
// ---------------------------------------------------------------------------

/**
 * Mirrors `_committed_plan_duration_sec` exactly. The playing plan's own
 * `expected_duration_sec`, read off the LAST successful CONTENT-step
 * evidence entry (`step === 'content' && error === null`) — never
 * fabricated, never a constant of our own invention. Index-based REVERSE
 * iteration (Hazard 4 — never `.reverse()`, which would mutate `plog
 * .evidence`'s own append-only order in place), mirroring this port's own
 * established convention for `reversed(...)` (`../merged/actions.ts`'s
 * correlation-log refresh loop).
 *
 * `(evidence.output or {}).get("expected_duration_sec")` (Python) is a
 * one-arg `.get()` (no default -> `None` if absent) over an `or`-guarded
 * receiver; `evidence.output` is genuinely `dict | None` here (unlike this
 * file's other `or {}` receivers, which are dead by Pydantic typing — see
 * this module's own `.get` audit — unset content-step evidence is a REAL
 * possibility), so `evidence.output ?? {}` is the exact mirror (both `None`
 * and an empty dict already read the same missing-key `None`/`undefined`
 * either way).
 */
export function committedPlanDurationSec(plog: ProposalRunLog): number | null {
  for (let i = plog.evidence.length - 1; i >= 0; i--) {
    const evidence = plog.evidence[i]
    if (evidence.step === 'content' && evidence.error === null) {
      const value = (evidence.output ?? {})['expected_duration_sec']
      return value !== null && value !== undefined ? Math.trunc(value as number) : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// _content_episode_limit_sec -> contentEpisodeLimitSec (fixbug-0806)
// ---------------------------------------------------------------------------

/**
 * Mirrors `_content_episode_limit_sec`. How long an ACCEPTED content episode
 * keeps relieving the driver: the SCENARIO's `default_content_episode_min`
 * (15.0 in every shipped scenario), NOT the committed plan's
 * `expected_duration_sec`.
 *
 * The two answer different questions, and only one is about the driver.
 * `expected_duration_sec` is the CONTENT PACKAGE's description of the plan it
 * built — for `humming_karaoke` a modelling artifact, `plan_item_count *
 * fixed_humming_segment_sec` = 5 x 30s = 150s (`duration_basis =
 * "simulated_fixed_segment"`) — routinely SHORTER THAN A SINGLE TICK (the
 * UC-04-01 preset runs 180s ticks), which expired an accepted episode on the
 * tick after it started. `default_content_episode_min` is the SCENARIO's
 * statement about how long a driver stays engaged, which is what the
 * physiological model needs.
 *
 * Invisible on the monotony path until now: its episode died after one tick
 * too, and `runManager`'s `acknowledge`-keyed synthetic 15-minute timer
 * silently carried the rest (substituting the fallback's
 * `default_content_service_id` for the driver's actual choice). REST
 * opportunities are excluded from that acknowledge, so pre-rest had no such
 * rescue and was the only place the defect surfaced.
 *
 * A pre-rest episode is additionally cut short by ARRIVAL (CDC-SU slide 46 ⑤),
 * driven by the rest-journey auto-drive below — so pre-rest ends at 15 minutes
 * or at the spot, whichever comes first.
 *
 * Falls back to the plan's own duration when a scenario configures no episode
 * length, so such a scenario keeps its previous behaviour rather than gaining
 * an episode that never ends. `null` = no known limit; the caller applies none.
 */
export function contentEpisodeLimitSec(triggerRunId: string, plog: ProposalRunLog): number | null {
  const scenario = getScenario(triggerRunId)
  const episodeMin = scenario?.default_content_episode_min ?? null
  if (episodeMin !== null && episodeMin !== undefined) return Number(episodeMin) * 60.0
  const durationSec = committedPlanDurationSec(plog)
  return durationSec !== null ? Number(durationSec) : null
}

// ---------------------------------------------------------------------------
// tick_merged_run_endpoint -> tickMergedRun (merged_runs.py:934-1203)
// ---------------------------------------------------------------------------

/** Mode validation for Branch A2 — see this module's own "Mode validation"
 * doc section for the exact-shape decision (bare string, not a byte-exact
 * pydantic `.errors()` reproduction).
 * @throws ProposalHttpError(422) — `mode` is neither `'interactive'` nor
 *   `'quick_check'`. */
function validateProposalMode(mode: string): asserts mode is 'interactive' | 'quick_check' {
  if (mode !== 'interactive' && mode !== 'quick_check') {
    throw new ProposalHttpError(422, `mode: Input should be 'interactive' or 'quick_check' (got ${JSON.stringify(mode)})`)
  }
}

/** Mirrors `outcome.evaluated_tick_index or 0` — see this module's own doc
 * comment for why `?? 0` is an exact, not merely convenient, mirror. */
function evaluatedTickIndexOrZero(outcome: TickOutcome): number {
  return outcome.evaluatedTickIndex ?? 0
}

/**
 * Mirrors `f"{e.event_type}@{e.at}"` — see this module's own doc comment
 * for a GENUINE, interpreter-VERIFIED (not assumed) quirk this reproduces:
 * `DiscreteEventType` is `class DiscreteEventType(str, Enum)` (a mixin, not
 * `StrEnum`), and under Python 3.11+ an f-string's `{member}` slot for a
 * mixed-in `Enum` uses `Enum.__format__` (`"ClassName.MEMBER"`) rather than
 * the mixed-in `str.__format__` (the bare value) UNLESS the class also
 * defines its own `__str__` (it does not — read `models/proposal/enums.py`
 * directly). So EVERY real `proposal_event_ids` entry is actually
 * `"DiscreteEventType.OPPORTUNITY_OPENED@..."`, never the bare
 * `"OPPORTUNITY_OPENED@..."` a pydantic `model_dump()` of the SAME event's
 * `event_type` field would produce (pydantic serializes an enum FIELD to
 * its `.value`, not this f-string path — the two representations
 * genuinely differ for the identical underlying event). Verified directly
 * against a live interpreter (`f"{DiscreteEventType.OPPORTUNITY_OPENED}"`
 * -> `'DiscreteEventType.OPPORTUNITY_OPENED'`), not assumed from reading
 * the enum declaration alone.
 *
 * WHAT THE GOLDEN ACTUALLY PINS, precisely: `merged_tick.json` stores
 * `proposal_event_types` — NOT `proposal_event_ids`, which appears nowhere
 * in the file. The capture reshapes the field on purpose, because a full id
 * is `f"{event_type}@{at}"` and that `@{at}` embeds a wall-clock timestamp,
 * which would make the fixture non-deterministic. So the golden pins the
 * PREFIX (its entries really are `'DiscreteEventType.OPPORTUNITY_OPENED'`,
 * checked) but does NOT pin the `@{at}` id-assembly format. That half rests
 * on the unit tests below plus this reading of the Python, not on parity.
 * Stated explicitly so a later reader does not over-trust the golden — and
 * because an earlier revision of this comment cited `proposal_event_ids` in
 * `merged_tick.json`, a key that does not exist there. */
const DISCRETE_EVENT_TYPE_PY_PREFIX = 'DiscreteEventType.'

function eventIds(events: ProposalRunLog['events']): string[] {
  return events.map((e) => `${DISCRETE_EVENT_TYPE_PY_PREFIX}${e.event_type}@${e.at}`)
}

/**
 * Port of `tick_merged_run_endpoint`. See this module's own doc comment for
 * the full control-flow enumeration (Step 1), the hazard pass, and the
 * `.get()` audit.
 *
 * @throws ProposalHttpError(404) — unknown `mergedRunId`, or the paired
 *   trigger run is unknown.
 * @throws ProposalHttpError(422) — Branch A2's mode validation (a HARD
 *   failure — propagates out of this function entirely, unlike Branch A3's
 *   `createProposalRun` failure, which is caught and downgraded to a soft
 *   `trigger.proposal_error`).
 */
export async function tickMergedRun(mergedRunId: string): Promise<MergedTickResponse> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${JSON.stringify(mergedRunId)} not found`)
  }

  // ── Derive this tick's real content episode from the proposal's own
  //    playback_state (recovery design §11 / Task 9) — BEFORE ticking, so
  //    the engine relieves/freezes for the episode that is ACTUALLY
  //    playing right now, not last tick's. `null` when no proposal is
  //    current, the proposal is unreadable, or nothing is playing — the
  //    tick engine falls back to the trigger-only synthetic fallback in
  //    that case (mirrors `run_manager.tick`'s own docstring).
  let currentPlog: ProposalRunLog | null = null
  if (handle.current_proposal_run_id !== null) {
    try {
      currentPlog = await getProposalRun(handle.current_proposal_run_id)
    } catch (exc) {
      if (exc instanceof ProposalHttpError) {
        currentPlog = null
      } else {
        throw exc
      }
    }
  }
  const contentCtx = deriveContentContext(handle, currentPlog)

  let outcome: TickOutcome
  try {
    outcome = await triggerTick(handle.trigger_run_id, { contentContext: contentCtx })
  } catch (exc) {
    if (exc instanceof TriggerRunNotFoundError) {
      throw new ProposalHttpError(404, `Trigger run ${JSON.stringify(handle.trigger_run_id)} not found`)
    }
    throw exc
  }

  const triggerDict = serializeTriggerTick(outcome)
  const resp: MergedTickResponse = { trigger: triggerDict, proposal: null, correlation: null }

  // ── Content-episode lifetime (CDC-SU slide 81) ──────────────────────────
  // An episode has a finite natural length. Without this it would never end
  // and driving-content relief would run for the whole rest of the run.
  //
  // That length is the SCENARIO's `default_content_episode_min`, not the
  // content package's `expected_duration_sec` — see `contentEpisodeLimitSec`
  // for why the two are different questions (fixbug-0806). A PRE-REST episode
  // is additionally cut short by ARRIVAL (CDC-SU slide 46 ⑤), applied by the
  // rest-journey auto-drive below, so it needs no special case here.
  const nowSec = outcome.tickState !== null ? Number(outcome.tickState.elapsed_seconds) : 0.0
  if (contentCtx === null) {
    handle.content_started_elapsed_sec = null
  } else {
    if (handle.content_started_elapsed_sec === null) {
      // The episode began at the START of this tick, not at its end.
      // `elapsed_seconds` stamps a tick with the clock at its END
      // (`advanceTick`), and this tick's relief has already been applied by
      // the `triggerTick` call above — so recording `nowSec` would date the
      // episode one whole tick late and grant it one tick too much relief.
      // `runManager`'s synthetic fallback measures from the same start
      // boundary (its acknowledge's `(tick_index + 1) * tick_seconds`), so
      // anchoring here keeps a real and a synthetic episode the same length,
      // which is what keeps the live animation and the projection on one curve.
      handle.content_started_elapsed_sec =
        nowSec - Number((outcome.runState.event_plan as { tick_seconds: number }).tick_seconds)
    }
    // `currentPlog` is asserted non-null, not defensively re-checked:
    // `deriveContentContext` only returns non-null when `plog` (i.e.
    // `currentPlog`) itself was non-null (see its own doc comment) —
    // mirrors Python's `_committed_plan_duration_sec(current_plog)` call,
    // which passes `current_plog` through with no `is None` guard of its
    // own either, trusting the SAME invariant.
    const limitSec = contentEpisodeLimitSec(handle.trigger_run_id, currentPlog!)
    if (limitSec !== null && nowSec - handle.content_started_elapsed_sec >= limitSec) {
      try {
        await applyJourneyAction(handle.current_proposal_run_id!, { action_type: 'complete', payload: {} })
        handle.content_started_elapsed_sec = null
      } catch (exc) {
        if (exc instanceof ProposalHttpError) {
          triggerDict.proposal_error = readableErrorText(exc.detail)
        } else {
          throw exc
        }
      }
    }
  }
  await saveHandle(handle)

  const d = outcome.decision
  const fired = Boolean(d !== null && d.fire_control.fired && d.proposal !== null)
  const purpose = d !== null ? mapTriggerPurpose(d.result_type) : null

  // ── Branch A — new-fire create/replace ──────────────────────────────────
  if (
    fired &&
    // `outcome.paused` is `run_manager.tick()`'s post-suppression signal:
    // actionable AFTER BOTH the recovery-active gate and the 30-minute
    // post-response de-dup gate (`deriveResponseSuppression`, fixbug-0804).
    // A fire that IS actionable always leaves the run paused, so this never
    // excludes a fire that should spawn a proposal — it only excludes a
    // fire the trigger evidence log still records but which must NOT
    // re-open an interactive proposal. Gating on raw `fired` instead let a
    // DECLINED rest proposal's cooldown-suppressed re-fire (same category,
    // still within the 30-minute window) spawn a brand-new proposal run on
    // the very next tick — the decline re-arms `current_proposal_run_id` to
    // null, so the overlay reappeared immediately with a fresh (possibly
    // stale) rest spot.
    outcome.paused &&
    purpose !== null &&
    d !== null &&
    (handle.current_proposal_run_id === null ||
      handle.rest_stage_synced === 'after' ||
      handle.current_proposal_category !== d.selected_category)
  ) {
    const stage = mapLifecycleStage({ fired: true, resultType: d.result_type, recoveryPhase: null })
    // `outcome.tickState` is asserted non-null, not defensively defaulted:
    // `run_manager.tick()`'s own contract (see this module's doc comment,
    // Step 1) guarantees tick_state is populated on every path that also
    // populates `decision` — and Branch A's guard already requires `d !==
    // null` (via `fired`). Python's own call site (`build_world_from_tick(
    // ..., outcome.tick_state, ...)`) does not guard this either — it
    // relies on the identical invariant, and would raise AttributeError
    // (loud) rather than silently substitute empty signals if the
    // invariant were ever violated. A defensive `?? {signals: {}}` fallback
    // here would instead silently feed buildWorldFromTick all-default
    // values — hiding a real bug rather than surfacing it. Mirrored with a
    // loud non-null assertion instead.
    const world: World = buildWorldFromTick(handle.world_template as World, outcome.tickState!, {
      triggerPurpose: purpose,
      lifecycleStage: stage,
    })

    // Branch A2 — HARD failure, propagates out of tickMergedRun entirely
    // (mirrors Python's uncaught `ValidationError` -> `HTTPException(422)`;
    // NOT caught by the `except HTTPException` below, which only wraps the
    // `createProposalRun` call in A3).
    validateProposalMode(handle.proposal_mode)

    const proposalBody: CreateProposalRunBody = {
      world: world as unknown as CreateProposalRunBody['world'],
      trigger_purpose: purpose,
      lifecycle_stage: stage,
      motion_state: (world.control_inputs as Record<string, unknown>).motion_state as CreateProposalRunBody['motion_state'],
      service_package_id: handle.service_package_id,
      content_package_id: handle.content_package_id,
      mode: handle.proposal_mode,
      run_seed: handle.run_seed,
      simulation_time: evaluatedTickIndexOrZero(outcome),
      parameters: handle.service_parameters,
      hyperparameters: handle.service_hyperparameters,
    }

    let plog: ProposalRunLog
    try {
      plog = await createProposalRun(proposalBody)
    } catch (exc) {
      // Branch A3 — SOFT failure: caught, downgraded, EARLY RETURN (no
      // correlation, no handle mutation, no save).
      if (exc instanceof ProposalHttpError) {
        triggerDict.proposal_error = readableErrorText(exc.detail)
        return resp
      }
      throw exc
    }

    handle.proposal_run_ids.push(plog.run_id)
    handle.current_proposal_run_id = plog.run_id
    handle.current_proposal_category = d.selected_category
    handle.rest_stage_synced = null
    const corr: CorrelationEntry = {
      trigger_tick_index: evaluatedTickIndexOrZero(outcome),
      proposal_run_id: plog.run_id,
      proposal_event_ids: eventIds(plog.events),
    }
    handle.correlation_log.push(corr)
    await saveHandle(handle)

    resp.proposal = plog as unknown as Record<string, unknown>
    resp.correlation = corr
  }

  // ── Branch B — rest-journey auto-drive ──────────────────────────────────
  // Structurally mutually exclusive with Branch A's success path on the
  // SAME tick — see this module's own doc comment for why (A4 always resets
  // rest_stage_synced to null; B's own outer guard requires it non-null).
  if (handle.current_proposal_run_id !== null && handle.rest_stage_synced !== null && outcome.tickState !== null) {
    const runId = handle.current_proposal_run_id
    const signals = (outcome.tickState.signals ?? {}) as Record<string, unknown>
    const dynamic = pyGetDefault(signals, 'dynamic', {}) as Record<string, unknown>
    let journeyPlog: ProposalRunLog | null = null

    if (handle.rest_stage_synced === 'before' && dynamic.motionState === 'STOPPED') {
      try {
        const current = await getProposalRun(runId)
        if (current.journey_state.lifecycle_stage === 'before_rest_until_stop') {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'rest_spot_arrived', payload: {} })
        } else {
          journeyPlog = current
        }
        const alreadyStarted = journeyPlog.events.some((e) => e.event_type === 'REST_STARTED')
        if (!alreadyStarted) {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'rest_started', payload: {} })
        }

        // Recovery-semantics refactor (fixbug-0806): CDC-SU slide 46 ⑤ —
        // 選択コンテンツを開始し、休憩所に到着したら終了 (start the chosen
        // content, end it on arrival at the rest spot). The en-route
        // 覚醒支援 episode ends AT ARRIVAL — this used to happen only in
        // the `during` branch below, after the nap, so the pre-rest
        // content kept "playing" through the whole dwell. The identical
        // guard remains in the `during` branch too (FR-006a: it also
        // protects `recomputeProposalRun` from a still-active/backgrounded
        // plan on retry) — this addition just makes teardown happen at the
        // earlier, correct moment on the normal path.
        if (journeyPlog.journey_state.playback_state === 'active') {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'complete', payload: {} })
        }
        if (['active', 'backgrounded'].includes(journeyPlog.journey_state.playback_state as string)) {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'stop', payload: {} })
        }

        handle.rest_stage_synced = 'during'
      } catch (exc) {
        if (exc instanceof ProposalHttpError) {
          triggerDict.proposal_error = readableErrorText(exc.detail)
        } else {
          throw exc
        }
      }
    } else if (handle.rest_stage_synced === 'during' && outcome.runState.recovery == null) {
      try {
        const current = await getProposalRun(runId)
        let drowsiness: number
        let fatigue: number
        if (current.journey_state.lifecycle_stage === 'during_rest_stopped') {
          const simulated = pyGetDefault(signals, 'simulated', {}) as Record<string, unknown>
          drowsiness = pyRound((pyGetDefault(simulated, 'drowsiness', 0.0) as number) ?? 0.0)
          fatigue = pyRound((pyGetDefault(simulated, 'fatigue', 0.0) as number) ?? 0.0)
          journeyPlog = await applyJourneyAction(runId, {
            action_type: 'rest_completed',
            payload: { post_rest: { drowsiness_level: drowsiness, fatigue_level: fatigue } },
          })
        } else {
          journeyPlog = current
          const completedEvents = current.events.filter((e) => e.event_type === 'REST_COMPLETED')
          const postRest =
            completedEvents.length > 0
              ? ((completedEvents[completedEvents.length - 1].payload ?? {}) as Record<string, unknown>)
              : {}
          drowsiness = (pyGetDefault(postRest, 'drowsiness_level', 0) as number) ?? 0
          fatigue = (pyGetDefault(postRest, 'fatigue_level', 0) as number) ?? 0
        }

        if (journeyPlog.journey_state.playback_state === 'active') {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'complete', payload: {} })
        }
        if (['active', 'backgrounded'].includes(journeyPlog.journey_state.playback_state as string)) {
          journeyPlog = await applyJourneyAction(runId, { action_type: 'stop', payload: {} })
        }

        const overrides: FieldOverride[] = [
          { path: 'situation.drowsiness_level', value: drowsiness },
          { path: 'situation.fatigue_level', value: fatigue },
        ]
        const recomputeBody: RecomputeRequest = { overrides }
        journeyPlog = await recomputeProposalRun(runId, recomputeBody)
        handle.rest_stage_synced = 'after'
        // Response-only mutation — see this module's own doc comment.
        triggerDict.paused = true
      } catch (exc) {
        if (exc instanceof ProposalHttpError) {
          triggerDict.proposal_error = readableErrorText(exc.detail)
        } else {
          throw exc
        }
      }
    }

    if (journeyPlog !== null) {
      const corr: CorrelationEntry = {
        trigger_tick_index: evaluatedTickIndexOrZero(outcome),
        proposal_run_id: runId,
        proposal_event_ids: eventIds(journeyPlog.events),
      }
      handle.correlation_log.push(corr)
      await saveHandle(handle)

      resp.proposal = journeyPlog as unknown as Record<string, unknown>
      resp.correlation = corr
    }
  }

  return resp
}
