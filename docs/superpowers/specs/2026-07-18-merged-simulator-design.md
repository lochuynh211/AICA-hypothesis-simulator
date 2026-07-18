# Merged "Combined Simulator" Screen — Design (feature 020)

**Status:** Brainstorm design / ADR — approved in design discussion 2026-07-18, pending written-spec review
**Author:** design session (trigger + proposal merge)
**Feeds:** Spec Kit chain `speckit-specify → plan → tasks → implement` (specs/020-…)
**Related master docs:**
- `docs/master/aica_hypothesis_simulator_runtime_workflow.md` (trigger tick model, §4.3a signals, recovery)
- `docs/master/aica_proposal_simulator_specification.md` (§3 flow, §4.3 composition contract, §5 selector I/O, §7 matrix)
- `docs/master/aica_transparent_service_proposal_algorithm.md`, `aica_transparent_content_proposal_algorithm.md`

---

## 1. Purpose & framing

Add a **third screen** ("Combined Simulator") beside the existing Trigger and Proposal screens that runs one coherent drive: the deterministic **trigger tick engine** advances the drive; when it fires (or reaches a rest spot), the existing **proposal service + content selectors** produce the in-car proposal for that moment. The reviewer watches one animation and reads one merged log.

This is the realization of a boundary the codebase was *designed* for years ago. Proposal spec §4.3 defines:

```
StandaloneProposalWorld → ProposalOpportunity   (today: proposal screen)
TriggerTickAdapter       → ProposalOpportunity   (this feature)
```

and §20: *"Combined trigger/proposal tick behavior is deferred, but the neutral adapter boundary is mandatory now."* The proposal selectors only ever see a neutral `ProposalOpportunity` (`trigger_purpose`, `lifecycle_stage`, `allowed_service_ids`, `feature_snapshot`). **This feature builds the `TriggerTickAdapter` and a thin orchestrator around it. It rewrites no algorithm.**

### 1.1 Goals
- One 20:60:20 three-panel screen: **left** setup, **center** simulator (quickview + animation/map + proposal overlay), **right** merged log.
- Drive the existing trigger tick loop and, on fire/rest events, the existing proposal pipeline — from a **single run the reviewer controls**.
- Reuse the maximum of existing UI and API. Add/replicate where needed; **never change existing trigger or proposal API behavior.**
- Focus V1 on **rest** (`rest_recommended`) and **monotony / inattentive-driving** (`inattentive_driving_prevention_recovery`). Route-music and child-passenger are later.

### 1.2 Non-goals (V1)
- No `route_music` / `child_passenger_experience` proposal purposes (no trigger fire category produces them).
- No live-LLM narration in the core loop (existing optional `explain` endpoint remains orthogonal; wire later).
- No expert-override editing of live state (later slice).
- No merge of the two backends' registries/stores — they remain independent.

### 1.3 Scope decision
**One combined spec (this doc), implemented in vertical slices** (see §12). Each slice leaves the project runnable and testable, per the repo's M0–M7 / P-series convention.

---

## 2. Architecture — two coordinated runs, one thin orchestrator

The merged screen coordinates **two independently-persisted runs** — a trigger `RunState`/`RunLog` and a proposal `ProposalRun`/`ProposalRunLog` — through a new **coordination layer that calls the existing pipelines and reimplements none of them.**

### 2.1 New backend: `routers/merged_runs.py` (+ a coordination service)
- **`POST /api/merged-runs`** — builds a trigger run via the existing `run_plan.create_draft` + `run_manager.create_run`. Does **not** eagerly create a proposal run (a proposal run needs a `trigger_purpose`, which does not exist until the first fire).
- **`POST /api/merged-runs/{id}/tick`** — thin wrapper over `run_manager.tick(trigger_run_id)`. Inspects the tick response for the **rising edge** of a proposal (`paused && decision.proposal != null` — the same boolean the frontend already computes). On a fire it builds the `World`/opportunity via the mapping functions (§4) and calls the existing `create_proposal_run` (first fire) or `recompute_proposal_run` (subsequent fires on the same merged run). Returns `{ trigger, proposal | null, correlation: { trigger_tick_index, proposal_event_ids[] } }`.
- **`POST /api/merged-runs/{id}/proposal-action`** — passthrough to the existing `select_service` / `journey/action` / `recompute`, resolving the currently-active proposal run for this merged run.
- **`POST /api/merged-runs/{id}/quickview`** — headless `quick_check` projection of the whole chain (§7.1).

### 2.2 New persistence: `merged_runs/<id>.json` correlation record
A minimal, append-only record: `{ merged_run_id, trigger_run_id, proposal_run_ids: [...], current_proposal_run_id, correlation_log: [{ trigger_tick_index, proposal_run_id, proposal_event_ids }] }`. Enables merged replay without merging the underlying run files. It does **not** widen `run_manager._registry` or the proposal run-file model.

### 2.3 Isolation invariants (must stay green)
- The merged coordination module is the **only** module allowed to import both `run_manager`/`tick_engine` **and** `proposal_run_manager`/`proposal_selector`.
- Existing invariants unchanged: `routers/proposal.py` never imports `aica_api.algorithms`; `proposalStore` never imports `runStore`; existing isolation tests pass unmodified.
- **Eligibility-before-ranking** is preserved automatically **only** by calling the existing `create_proposal_run`/`recompute_proposal_run` service functions (which always run `resolve_eligibility` first) — never by calling `dispatch_selector` directly. This is the single biggest correctness risk; it is a hard rule.

### 2.4 Frontend
Mount both `RunStoreProvider` and `ProposalStoreProvider`, bridged by a new thin `MergedRunCoordinator` context. **No reducer merge** (would break tested isolation and is unnecessary). New screen registered via the existing `appMode` switch.

---

## 3. Situation merge map & inline-vs-generated

Full per-field table lives in the analysis synthesis (workflow `understand-trigger-proposal-merge`, §1). Summary of the operative rule:

### 3.1 GENERATED-BY-SIMULATION (tick engine drives; never a live setup control)
`trigger_purpose`, `lifecycle_stage`, `motion_state` (written to **both** `control_inputs.motion_state` **and** `situation.motion_state`), `drowsiness_level`, `fatigue_level` (raw 0–100, direct copy — both sides already raw post-009, **no scale conversion**), `traffic_state` (←`isTrafficJam`), `road_type` (←`segmentType`), `route_tags` (←route facts), `monotony_level` (new proxy, §6), `estimated_min_until_rest_spot`, `rest_spot_type`, `continuous_driving_min`, `route_fraction`, `speed_kph`, `active_service`, `recent_service_rejections`.

### 3.2 INLINE-SETUP (frozen at run start)
Route selection + **route conditions painter** (§5); scenario fixed context (`is_night`, `familiar_route`, `weather_risk`, `child_present`, `destination_tags`, `multiple_passengers`); initial drowsiness/fatigue + growth coefficients; speed profile; run seed; recovery config; the three packages + hyperparameters; and the entire **driver profile / preference / history / oshi / catalog / schedule** group (reused wholesale from the proposal screen — the trigger side has no equivalent).

### 3.3 Manual-override escape hatch
For standalone proposal tuning without a full drive, the merged screen keeps a manual World-override path — **available only when no trigger run is active.** Once a trigger run is playing, all §3.1 fields are engine-driven, mirroring the "params frozen once a run starts" convention.

### 3.4 The core seam — mapping functions (in the coordination service)
- `trigger_purpose`: `REST_PROPOSAL → rest_recommended`; `MONOTONY_PROPOSAL → inattentive_driving_prevention_recovery`; `SUPPRESSED`/`NO_PROPOSAL` → no opportunity.
- `lifecycle_stage`: not-fired & driving → `active_driving_content`; REST fired, pre-accept → `before_rest_until_stop`; recovery active (`recoveryPhase != null`) → `during_rest_stopped`; recovery just completed → `after_rest_before_restart`.
- `road_type` ← `segmentType` map (`highway→highway`, `normal_road→local`, `mountain_road→mountain`, rest/stopped-at-facility→`parking`).
- `traffic_state` ← `isTrafficJam ? congested : normal`.
- `night_state` ← `is_night ? night : day`.

---

## 4. TriggerTickAdapter — building the World at a fire

At each rising edge the coordination service:
1. Reads the tick response (`result_type`, `fire_control.fired`, `paused`, `motion_state`, `recoveryPhase`, tiered `signals`).
2. Derives `trigger_purpose`, `lifecycle_stage`, `motion_state` (§3.4).
3. Writes `motion_state` onto **both** `World.control_inputs.motion_state` **and** `World.situation.motion_state` (the documented 2-field sync gotcha — using the same `model_copy(update=…)` pattern `recompute_proposal_run` already uses).
4. Fills the rest of `World.situation` from tick state (drowsiness/fatigue direct copy; traffic/road/night/monotony/rest fields mapped).
5. Carries INLINE fields (profile, destination_tags, child_present, multiple_passengers, catalog, schedule) unchanged from setup.
6. Calls `create_proposal_run` (first fire) or `recompute_proposal_run` (subsequent). Subsequent fires default to recompute on the same proposal run so the append-only opportunity/snapshot history gives one audit trail — except when recompute's existing 422 guard (`playback_state ∈ {active, backgrounded}`) applies, in which case a fresh proposal run is created. (Confirm exact branch during implementation.)

---

## 5. Route conditions painter (mountain & traffic jam) — NEW

Google Directions cannot reliably label mountain roads or predict where a jam sits on a given route (route_analysis: mountain_road *"has no reliable Google signal in V1"*). Both are needed by the trigger (fatigue/speed) **and** the proposal (`road_type`, `traffic_state`). So the merged screen lets the reviewer **paint them onto the route manually.**

- In the **Route setup popup**, a horizontal **route bar** (reusing `RouteTimeline` visual vocabulary; axis = route position 0 → total km / fraction) carries **two dual-handle (2-dot) range sliders**:
  - **Mountain section** `[start, end]` → injects a `RouteSegmentFact(segment_type="mountain_road", start_km, end_km)` override into the route facts (splitting/overriding base segments in range).
  - **Traffic-jam section** `[start, end]` → produces a frozen `TrafficEvent`. Slider is position-keyed; the plan builder converts the range to the event's `start_min`/`duration_min` window at freeze time (see §13 open item).
- Each handle shows its position readout; the two painted bands use distinct colors.
- Both are **INLINE-SETUP** (frozen at run start) and drive the **GENERATED** `segmentType`/`road_type` and `isTrafficJam`/`traffic_state` per tick. This also removes the mountain/traffic vocab-mapping ambiguity by giving explicit control.
- V1: one mountain band + one jam band (multiple bands is a trivial later extension). Supersedes the trigger screen's enable/severity jam toggle within the merged screen only; the trigger screen is untouched.

---

## 6. Monotony proxy — NEW simulator signal (package-agnostic)

Today monotony exists only *inside* the packages (`mono_min` accumulator); the tick engine exposes only a per-tick `is_monotonous` boolean. To feed the proposal's `monotony_level` (and to make `MONOTONY_PROPOSAL` runs meaningful for both Hybrid and NRI), the **tick engine** gains a lightweight monotony accumulator (grow on highway/normal_road, decay otherwise, night factor) exposed as a derived Tier-2 signal `monotony_level` (0–100). It does **not** alter either package's internal monotony math; packages keep computing their own.

---

## 7. Center panel (60%) — quickview + animation + proposal overlay

Vertical composition: **quickview strip** (top) → **animation/map cockpit** (middle, dominant) → **proposal overlay** (bottom-docked, contextual).

### 7.1 Quickview (auto, on setup complete)
A **headless `quick_check` projection of the whole trigger+proposal chain**: extends the existing `InstantResult` preview (`POST /api/runs/preview`) so that at each trigger fire it also invokes the orchestrator in `quick_check` mode (auto-pick rank 1). Result: every fire/rest point on the `ScoreTimeline`/`MapSurface` already carries a default service→content proposal. **The reviewer can click any point to inspect its proposal without animating** — the explicit requirement that animation-implicit clicks cannot satisfy. The projection is the "if you accept the top proposal each time" path; it is ephemeral (no evidence written), consistent with `preview` semantics.

### 7.2 Animation (Play button)
Re-walks the same chain live. On a fire's rising edge the proposal overlay **auto-opens** (the "implicit click"); the reviewer may make real choices that diverge from the quick_check defaults → recompute. Rest-spot marker click walks the chain explicitly: `before_rest_until_stop` → accept → `during_rest_stopped` (sleep-minutes control, §8) → recovery completes → `after_rest_before_restart` (after-driving proposal via recompute). Clicking an already-passed marker reopens that overlay read-only (scrub/replay).

### 7.3 Reuse & new
- **Reused:** `ScoreTimeline` (extend `fires[]` with two marker kinds/colors: trigger-fire vs proposal-point), `MapSurface` (add a tick-index data attribute to its click handler), `PlaybackControls`, `MotionBadge`, `RouteTimeline`, `RecoveryVisualization`, `MusicOverlay` (repurposed as the generic "active service now-playing" badge), and the `useRouteProgress`/`useSmoothFraction`/`useLiveTimelineData` position/animation hooks.
- **New:** a slim bottom-docked **Proposal Overlay** rendering either ranked service candidates (`ReasonBreakdown` + `ServiceExplainability`) or the ordered content plan (`ContentExplainability`), **extracted from the *result* sections** of `ServiceProposalPanel`/`ContentProposalPanel` (their setup sections move to the left popups — this is a split of existing fused components, not new algorithm work).

---

## 8. Enriched recovery model — simulator-side, additive, packages untouched

**Verified:** recovery lives entirely in the simulator — `RecoveryOption`/`RecoveryStage` are scenario config; `tick_engine` applies it via `driver_signals.apply_rest_recovery(state, activity)`; the trigger package never reduces drowsiness/fatigue. So recovery can be enriched without touching any algorithm package.

Today's `ActivityRecovery{drowsiness, fatigue}` is a **fixed amount applied once**, duration-independent. The orchestrator **assembles a recovery plan from the reviewer's accepted proposals across the rest journey**, and the tick engine applies it. `ActivityRecovery` gains **optional** fields; a stage with only the plain amounts keeps **today's fixed-once behavior** (existing scenarios byte-identical, all tests green):

1. **En-route content while MOVING to the spot** (e.g. accept humming_karaoke) → small **per-minute rate** accrued each moving tick ⇒ total ∝ **time-until-spot**, capped. Short approach → little; long approach → more.
2. **Sleep at the spot (STOPPED)** → reviewer **sets minutes**; recovery is **duration-scaled** with diminishing returns: `recovery = cap · (1 − e^(−minutes/τ))` (linear-with-cap acceptable if preferred — §13). Replaces the fixed one-shot for sleep.
3. **After-rest stopped content** (full_karaoke/stretch) → modest freshen-up (small fixed or short rate).

The trigger's `continuousDrivingMin` rebaseline-on-recovery behavior is unchanged.

---

## 9. Left setup (20%) — six collapsed buttons → popups

| Group | Reused editors | Popup contents |
|---|---|---|
| **Route** | `MapKeyAndRouteInput`, route-preset dropdown, `routesAnalyze` alternatives, `RestCeilingEditor`, `RestSpacingEditor`, **+ route-conditions painter (§5)** | preset/Maps route → alternatives → rest ceiling/spacing → mountain & jam bands |
| **Situation / Scenario** | `ScenarioSelector` (authoritative container) + trimmed Fixed-tier toggles (`is_night`/`familiar_route`/`weather_risk`/unified `child_present`) + speed profile + proposal's INLINE situation fields (`destination_tags`, `multiple_passengers`) + initial drowsiness/fatigue + growth coeffs; `PresetPicker`/`SeedPicker` as a starting-world convenience loader | one scenario container, proposal Situation fields folded in as scenario properties (no rival "scenario" concept) |
| **Driver profile & history** | proposal `DriverProfilePicker` + `WorldPanel` oshi/usage/recency/playback-history/recovery-rate groups (S/C badges kept) + genre-extension toggle/tables | reused wholesale from proposal, unchanged |
| **Trigger package** | `PackageSelector` + `AlgorithmFormulationPanel` + `formulationTemplates` | package (Hybrid/NRI) + formula-annotated hyperparams; tick-duration + run-seed live here |
| **Service package** | `ServiceProposalPanel` **setup section** (mode, `max_candidates`, `ScalarTable`, `ResponseMatrixTable`×2, `HierarchyWeightsTable`/`HyperparamMatrix`, Advanced) | package + mode + hyperparams |
| **Content package** | `ContentProposalPanel` **setup section** (Setting → preprocessing → response coeffs → weights → Advanced) | package readout + hyperparams |

Each collapsed button shows a one-line summary + "N params modified" dot (reusing `run_plan.py`'s existing `original/modified_values` diff). **The popup/modal shell (portal, focus-trap, collapsible-summary button) is genuinely new frontend infra** — neither screen has it today.

---

## 10. Right panel (20%) — one merged log

Extend `DecisionTracePanel`'s existing merge-by-`tickIndex` union with proposal event kinds sourced from `ProposalRunLog.events[]`: `proposal_run_created`, `proposal_service_selected`, `proposal_content_dispatched`, `proposal_journey_action` (incl. rest_spot_arrived / rest_started / rest_completed / motion_change). Each new kind gets a Row styled like `RestChoiceRow`/`AlgorithmErrorRow` in the **proposal accent color** to preserve the blue-vs-purple "which subsystem produced this" convention. Correlation id: thread `trigger_tick_index` onto each proposal event so the two streams sort into one true timeline. `FeedbackForm`/`EvidencePanel` reused; extend `FeedbackTarget.scope` with `proposal_service`/`proposal_content`. `RunLogViewer` generalizes for merged persisted-run/replay view.

---

## 11. Backend API surface

**Reused as-is (zero change):** `GET /api/packages*`, `/api/scenarios*`, `POST /api/routes/analyze`, `GET/POST /api/routes/presets*`, `POST /api/run-plans*`, `POST /api/runs`, `/runs/{id}/tick`, `/actions`, `/rest-spots`, `/log`, `/feedback*`, `/evidence*`, `POST /api/runs/preview`; `GET /api/proposal/{matrix,packages,datasets,seeds,presets,profiles}`, `POST /api/proposal/worlds/validate`, `POST /api/proposal/runs`, `/select-service`, `/recompute`, `/journey/action`, `/journey/preview`, `/explain`.

**New (additive; `main.py` gains ~2 lines):** `POST /api/merged-runs`, `/merged-runs/{id}/tick`, `/merged-runs/{id}/proposal-action`, `/merged-runs/{id}/quickview`. No existing endpoint's behavior changes.

---

## 12. Implementation slices

1. **Slice 1 — skeleton + rest happy-path.** ✅ **DONE** (branch `020-merged-simulator`, commits `a820ec9..75c8f07`). Combined screen (3-panel, appMode, both stores + coordinator), `merged_runs` orchestrator + correlation record, six popup-setup shells, Play → trigger ticks → REST fire auto-opens service→content proposal → merged log. One preset route, one scenario, `rest_recommended` only. (Enriched recovery/quickview stubbed to today's fixed-once + trigger-only preview.) Backend 2293 tests / frontend 640 tests / build clean; whole-branch opus review passed after 2 fixes. Deferred to Slice 2: content-backed Choose gate + `songNames` in merged center, `build_world_from_tick` validator bypass (pydantic serialize warning), `fired` independent of `paused` (MONOTONY edge).
2. **Slice 2 — full rest journey.** CORE ✅ **DONE** (commits `2259946..00f4a14`): the before→during→after rest chain in one proposal run (orchestrator auto-drives `rest_spot_arrived`/`rest_completed(post_rest)`/`recompute`, pausing at the after-rest proposal); **enriched recovery (§8)** — additive duration-scaled sleep (nap-minutes → nap-stage ticks) + time-scaled en-route rate with aggregate cap, flat-only path byte-identical; accept-rest UI (recovery-option + sleep-minutes); merged-log rest narration + recovery phases; after-rest dock-by-evidence-recency fix. Backend 2332 / frontend 644 / build clean; whole-branch opus review passed (verified live) after 1 fix. **Slice 2b (painter + hardening) ✅ DONE** (commits `07bea56..8c4ba4e`): route-conditions painter (§5) — `merged_painter` mountain-split + jam-conversion, `POST /api/merged-runs/plan` applies it, `RouteConditionsPainter` 2-dot sliders; MOVING-recovery `grants_moving_recovery` explicit flag (§8 landmine closed). Backend 2350 / frontend 647 / build clean. **Still deferred (Slice 2c polish):** **quickview headless projection (§7.1)** + **correlation replay** — both need a preview-loop generator extraction + a non-persisting proposal path (seams mapped in scratchpad).
3. **Slice 3 — monotony.** `MONOTONY_PROPOSAL → inattentive_driving_prevention_recovery`; **monotony proxy signal (§6)**; `active_driving_content` flow.
4. **Later.** route_music, child_passenger, live-Maps animation polish, LLM narration in-loop, expert override.

Each slice leaves the project runnable + all tests green.

---

## 13. Open implementation-time decisions (settle in speckit-plan)
- **Jam position→time conversion.** `TrafficEvent` is time-keyed (`start_min`/`duration_min`); the painter is position-keyed. Either convert at freeze time via the nominal speed profile, or extend `TrafficEvent` with a position range and activate by route position. Prefer whichever keeps the frozen-plan determinism simplest.
- **Recovery curve shape (§8.2).** Saturating exponential vs linear-with-cap; exact coefficients are tuning-time (repo's generate→tune→verify loop).
- **First-fire vs subsequent-fire branch (§4.6)** — verify recompute's 422 guard interaction against the live rest journey.
- **Vocabulary extension** — optionally add `parking` to `segmentType` and richer `road_type` awareness rather than a permanently-lossy adapter.

## 14. Guardrails / determinism
- Determinism governed by the trigger seed (V1 proposal selectors are pure functions of World+config). Any future randomized proposal algorithm must consume the merged seed via the orchestrator, not mint its own.
- Existing 2277 backend / 616 frontend tests stay green; existing Trigger and Proposal screens and every existing API behavior are untouched.
- The coordination module is the sole cross-importer; isolation tests unmodified.
