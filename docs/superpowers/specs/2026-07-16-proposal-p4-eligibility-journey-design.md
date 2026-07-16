# P4 — Eligibility And Discrete Journey Engine — Design

**Milestone:** P4 (`docs/master/aica_proposal_simulator_milestones.md` §6)
**Date:** 2026-07-16
**Branch:** `proposal-p4-eligibility-journey-engine`
**Status:** Approved (brainstorming Step 2)

---

## 1. Goal

Implement deterministic motion/service **eligibility constraints** and **lifecycle/journey
transitions** *before* adding real ranking logic (which is P5 service / P6 content).
The customer-visible outcome: on the proposal screen the reviewer sees the
purpose/stage-allowed service set **narrowed by platform eligibility** (with per-candidate
reason codes and no utility scores), can **accept / reject / postpone / choose-another /
request-more / stop / continue** a mocked accepted plan, watch it advance through
**start → completion → continuation → restoration**, and see a **motion change**
deterministically apply screen/background/stop behavior — all recorded as discrete events
in the append-only run log.

The selectors stay **mock** in P4. P4 supplies the *orchestration layer* (eligibility +
journey engine) that sits around the selector dispatch, not the ranking itself.

## 2. Approved decisions

- **D1 — Journey API shape:** a single action endpoint
  `POST /api/proposal/runs/{run_id}/journey/action` with `{action_type, payload}`, routed
  through one **pure** journey-engine function (transition table). Motion-change and the
  rest-stage transitions are `action_type`s; preview is a separate read-only `GET`.
- **D2 — Rest-journey depth:** transitions only. The engine emits and applies
  `REST_SPOT_ARRIVED` / `REST_STARTED` / `REST_COMPLETED` (motion→stopped, lifecycle-stage
  change, explicit post-rest feature values, open a new opportunity). The five named
  during-rest actions (`nap_guidance` etc.) stay **journey-orchestration events, never
  scored/ranked candidates**. The full seeded pre-rest→rest→post-rest demo remains **P7**.
- **D3 — Frontend scope:** backend engine + eligibility fully built and tested, PLUS a
  minimal run-area UI (eligible/excluded-with-reason lists, action buttons, journey state +
  event timeline). Display-only; backend stays the authority.
- **D4 — Eligibility placement:** narrow `eligible_candidates` at STEP-1 create-run,
  **before** the mock selector runs; excluded candidates are retained with reason codes.
- **D5 — Service-capability contract:** a new frozen versioned artifact
  `proposal_contracts/service_capabilities/service_capabilities.v1.json` is the
  machine-readable source of screen-dependence / stopped-only / lighting / required-entity.

## 3. Authoritative sources reconciled

- Spec §6 (Safety & Eligibility), §7.1–7.5 (catalog + matrix), §16 (Discrete Event
  Simulation), §19.3/§19.4 (safety & journey acceptance).
- Service algorithm doc §7 (Hard eligibility) — the platform constructs
  `candidates = catalog ∩ purpose/stage ∩ motion/capability/readiness`; motion is a
  platform eligibility fact, **not** a ranking feature; excluded services get no
  `service_fit` and cannot be reinstated by the algorithm.
- Milestone §6 scope + acceptance criteria + verification focus; Cross-Milestone Quality
  Gates §16 (boundary, feature, safety, determinism, grounding, evidence, regression,
  human-judgment).

### Stale-guidance notes (carried into the spec)
- Spec §16.1 uses `PROPOSAL_OPPORTUNITY_OPENED`; the enum uses `OPPORTUNITY_OPENED`. P4
  keeps the enum name and treats the doc name as an alias (a docs-naming test records this).
- Several §16.1 events have **no enum member yet** — P4 adds:
  `SERVICE_REJECTED`, `CONTENT_STARTED`, `MOTION_CHANGED`, `CONTINUE_REQUESTED`,
  `RETURN_TO_PREVIOUS_CONTENT`, `REST_STARTED`, plus `POSTPONED`, `CHOOSE_ANOTHER`,
  `REQUEST_MORE` for the advisory actions.
- No machine-readable service-capability table existed; D5 introduces it. §7.1/§7.2 is the
  data source (lighting column, driving vs stopped tables, `full_karaoke` stopped-only).

## 4. Architecture — new/changed units

All under the isolated `proposal` namespace. **No** import of `aica_api.models` (trigger)
or `aica_api.algorithms`. No `Date.now()`-equivalent in pure engines — the router mints
timestamps/ids (existing `_now_iso`/`_make_opportunity_id` discipline).

| Unit | Kind | Purpose |
|---|---|---|
| `proposal_contracts/service_capabilities/service_capabilities.v1.json` | frozen artifact | per-`ServiceId`: `screen_dependent`, `stopped_only`, `driving_capable`, `lighting_compatible`, `requires_entity` (nullable), plus `capabilities_version`. |
| `models/proposal/service_capabilities.py` | model | loader/model mirroring `matrix.py` (`ServiceCapabilities.load(path)`). |
| `models/proposal/eligibility.py` | model | `EligibilityExclusion{service_id, reason_codes[]}`, `EligibilityResult{eligible[], excluded[]}`. Score-free by construction. |
| `services/proposal_eligibility.py` | pure service | `resolve_eligibility(allowed_service_ids, motion_state, capabilities, catalog_readiness) → EligibilityResult`. |
| `models/proposal/journey.py` | model (extend) | add `playback_state`, `previous_content`, `current_plan_ref`, `rejected_service_ids[]`; keep existing fields for back-compat. |
| `models/proposal/enums.py` | extend | add the new `DiscreteEventType` members + a `JourneyActionType` enum + `PlaybackState` enum + `ProposalRunStatus` additions if needed (`content_started`, `content_completed`, `stopped`). |
| `services/proposal_journey.py` | pure engine | `apply_action(run_log, action) → JourneyTransition{events[], new_journey_state, new_status}`; one transition table, no I/O. |
| `services/proposal_journey_preview.py` | pure | `preview(run_log) → PreviewChain{binding:false, steps[]}` — projection only, no selector, no persistence. |
| `routers/proposal.py` | extend | wire eligibility into STEP-1; add `POST /runs/{id}/journey/action` and `GET /runs/{id}/journey/preview`. |
| frontend run area | extend | eligible/excluded lists, action buttons, journey state + event timeline (bilingual, JA default). |

## 5. Eligibility resolver (before ranking)

```
eligible / excluded = for each s in allowed_service_ids:
    exclude if capabilities[s].screen_dependent and motion == driving
    exclude if capabilities[s].stopped_only     and motion == driving
    exclude if s == full_karaoke and motion == driving   (full_karaoke_requires_stopped)
    exclude if capabilities[s].requires_entity and entity not present in catalog/world
    exclude if catalog readiness marks s unavailable/disabled
    else eligible
```

- **Reason codes** (platform, score-free): `screen_dependent_while_driving`,
  `stopped_only_while_driving`, `full_karaoke_requires_stopped`, `missing_required_entity`,
  `catalog_item_unavailable`. Shown independently of algorithm rationale (§6.2).
- Excluded candidates are **retained** in the record (Constitution V — suppressed
  candidates remain, not dropped) and flow into the STEP-1 `AlgorithmEvidence`'s
  `excluded_candidates`. The mock selector only ever ranks `eligible`.
- Pure function of `(allowed set, motion_state, capabilities artifact, catalog readiness)`
  → exhaustively table-testable, deterministic.

## 6. Journey engine — action → event table

Single endpoint; `apply_action` is pure. Preconditions gate each action; an invalid
precondition returns a structured 422 (never a silent no-op).

| `action_type` | Precondition | Effect / event(s) |
|---|---|---|
| `accept` | status content_selected | commit plan → `CONTENT_STARTED`, playback=active |
| `reject` (service) | status service_selected | `SERVICE_REJECTED`; record in `rejected_service_ids`; if another eligible candidate exists, it remains offerable (no dead-end) |
| `postpone` | offered | `POSTPONED`; return to opportunity-open |
| `choose_another` | service_selected | next eligible ranked candidate not in `rejected_service_ids` → `CHOOSE_ANOTHER` + `SERVICE_SELECTED` |
| `request_more` | service_selected | surface remaining eligible candidates (already ranked; no new score) → `REQUEST_MORE` |
| `complete` | playback active | `CONTENT_COMPLETED`, playback=completed |
| `continue` | playback completed | apply committed plan's `next_transition_policy` → `CONTINUE_REQUESTED` |
| `stop` | playback active | `RETURN_TO_PREVIOUS_CONTENT`; restore `previous_content`; playback=stopped |
| `motion_change` | any | `MOTION_CHANGED`; deterministically apply screen/background/stop per plan `mode.stopped_only`/screen-dependence; re-run eligibility; may invalidate active plan |
| `rest_spot_arrived` | purpose rest_recommended | `REST_SPOT_ARRIVED`; motion=stopped, stage=during_rest_stopped |
| `rest_started` | during_rest_stopped | `REST_STARTED` |
| `rest_completed` | during_rest_stopped | `REST_COMPLETED`; apply explicit post-rest feature values (from payload); stage=after_rest_before_restart; open new opportunity |

The mocked accepted plan advances via `accept → complete → continue → stop(restore)`. The
committed `CompletePlan` (from whichever content package ran at STEP 2) supplies
`completion_rule` / `next_transition_policy`; no new mock is invented.

**Control-input invariant:** `trigger_purpose` and `lifecycle_stage` are read as control
facts to route/gate transitions — they are never turned into preference/utility scores
(re-asserted by an evidence test).

## 7. Preview (non-binding)

`GET /api/proposal/runs/{run_id}/journey/preview` returns a rolling-horizon chain (§3.2):
purpose/stage-derived projection of upcoming boundaries + the committed plan's policy.
`binding: false`. It **never** invokes a selector, **never** persists, **never** mutates
the run — so "editing must not create hidden partial decisions" (§17.4) holds. Reopen /
replay renders the log without recompute (Principle III).

## 8. Persistence & evidence

- Each action appends its event(s) via the existing append-only `proposal_run_manager`
  (`append_event`, `update_state`); no recompute on reopen.
- STEP-1 `AlgorithmEvidence` carries `excluded_candidates` (reason-coded) alongside
  `eligible_candidates`.
- Selector/journey failures remain `ALGORITHM_ERROR` events — never disguised as normal
  decisions (Principle II).
- Isolation: only `settings.proposal_runs_dir` / `settings.packages_dir` /
  `settings.proposal_contracts_dir` are touched; trigger `runs/` is never read/written.

## 9. Test strategy (TDD) → P4 verification focus

- **Eligibility-matrix tests** — every (purpose, stage, motion) → expected eligible/excluded
  + reason codes; full-screen karaoke & stopped video excluded while driving; lighting is a
  presentation modifier and never appears as a candidate.
- **State-transition table tests** — each action from each valid/invalid precondition,
  driven from the transition table as data.
- **Motion-change tests** — deterministic screen/background/stop; re-eligibility on flip.
- **Completion/restoration tests** — accept→complete→continue→stop(restore) advances a
  mocked plan; `previous_content` restored.
- **Advisory-action tests** — reject does not dead-end when another eligible candidate
  exists; purpose/stage never become feature scores.
- **Determinism** — identical inputs → identical eligibility + transitions.
- **Regression** — trigger suite + the existing 702 proposal tests stay green.
- **Artifact test** — `service_capabilities.v1.json` round-trips, covers all 14 `ServiceId`s,
  and matches spec §7.1/§7.2 (lighting + driving/stopped classification).

## 10. Acceptance-criterion → coverage map

| P4 acceptance criterion | Covered by |
|---|---|
| Full-screen karaoke & stopped video not activatable as driving experiences | eligibility resolver §5 + eligibility-matrix tests |
| Lighting only on compatible services; never a ranked candidate | capabilities artifact + eligibility/plan tests |
| Eligibility explanations without utility scores | `EligibilityExclusion` (score-free) + evidence test |
| Mocked accepted plan advances start→completion→continuation→restoration | journey engine §6 + completion/restoration tests |
| Motion change applies background/stop deterministically | `motion_change` action + motion-change tests |
| Purpose/stage as control inputs, never preference/utility scores | control-input invariant test |
| Package cannot return a service outside frozen row | eligible set ⊆ matrix row + selector-boundary test |
| Rejection does not dead-end when another eligible candidate exists | advisory-action tests |

## 11. Out of scope (P4)

Real ranking (P5/P6), full seeded rest vertical slice (P7), ranked during-rest actions,
catalog editing (deferred), tick-engine composition (Post-V1), htmlapp sync (htmlapp is
trigger-only — no proposal code). No new external dependency.

## 12. Exit demonstration

`docker compose up` → create a `rest_recommended` run → see the narrowed eligible set +
excluded reason codes → accept the plan → advance start→complete→continue → flip motion to
see stop/background applied → reject a service and pick another — every step visible as a
discrete event, replayable without recompute.
