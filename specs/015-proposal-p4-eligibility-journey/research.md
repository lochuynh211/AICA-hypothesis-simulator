# Phase 0 Research — P4 Eligibility & Discrete Journey Engine

All material unknowns were resolved during the approved design (Step 2) and the clarify
session (`background_on_motion`). No open `NEEDS CLARIFICATION` remain. This file records
the decisions that shape the contracts and data model.

## D1 — Eligibility placement: orchestrator narrows before the selector

- **Decision**: Resolve `eligible/excluded` at STEP-1 create-run, *before* `dispatch_selector`,
  and pass only the eligible set as `eligible_candidates`; carry `excluded_candidates`
  (reason-coded) into the STEP-1 evidence.
- **Rationale**: Spec §6.1 and service-algo §7 make the platform (not the algorithm) construct
  `catalog ∩ purpose/stage ∩ motion/capability/readiness`. Keeping it outside the adapter means
  the mock selector — and later the real P5 selector — physically cannot return an out-of-row or
  ineligible service (SC-003, FR-005), and eligibility stays a pure, exhaustively testable
  function independent of any ranking.
- **Alternatives rejected**: (a) let the selector self-filter — violates §6.1 and couples
  eligibility to each package; (b) post-filter the ranked output — would let a package "see"
  ineligible candidates and risks reinstatement.

## D2 — Service-capability facts as a frozen versioned artifact

- **Decision**: Author `proposal_contracts/service_capabilities/service_capabilities.v1.json`
  (per `ServiceId`: `screen_dependent`, `stopped_only`, `background_on_motion`, `driving_capable`,
  `lighting_compatible`, `requires_entity`), loaded by a Pydantic model mirroring `matrix.py`.
- **Rationale**: Spec §7.1/§7.2 held these facts only in prose. A frozen, versioned artifact
  makes the motion/capability step data-driven, reviewable, and diffable like the matrix; a golden
  test binds it to §7.1/§7.2 so drift is caught.
- **Capability mapping (from §7.1/§7.2), golden-tested**:
  | Service | driving_capable | screen_dependent | stopped_only | background_on_motion | lighting_compatible | requires_entity |
  |---|:--:|:--:|:--:|:--:|:--:|---|
  | music_playlist | ✓ | – | – | – | ✓ | – |
  | humming_karaoke | ✓ | – | – | – | ✓ | – |
  | call_response_driving | ✓ | – | – | – | – | – |
  | quiz | ✓ | – | – | – | – | – |
  | ranking_creation | ✓ | – | – | – | – | – |
  | radio_style | ✓ | – | – | – | – | – |
  | conversation_audio | ✓ | – | – | – | – | – |
  | live_viewing | ✓ | ✓ | – | ✓ | ✓ | – |
  | stretch_video | – | ✓ | ✓ | – | – | – |
  | full_karaoke | – | ✓ | ✓ | – | ✓ | – |
  | call_response_stopped | – | ✓ | ✓ | – | ✓ | – |
  | oshi_reexperience | – | – | ✓ | – | – | oshi |
  | relaxation_multisensory | – | – | ✓ | – | recipe | – |
  | linked_video_recommendation | – | ✓ | ✓ | – | recipe | – |
- **Note**: `live_viewing` is the sole `background_on_motion` service (§7.2 "policy-controlled
  background on motion"). `lighting_compatible` values `recipe` for the two Slide-26-only services
  are carried but those services are never eligible under the default matrix (§7.4), so they are
  not exercised in V1 runs.

## D3 — Reason-code vocabulary (score-free platform codes)

- **Decision**: A fixed set of platform reason codes: `screen_dependent_while_driving`,
  `stopped_only_while_driving`, `full_karaoke_requires_stopped`, `missing_required_entity`,
  `catalog_item_unavailable`, `not_in_allowed_row` (defensive — a service outside the matrix row
  never reaches ranking). No numeric/score field on an exclusion.
- **Rationale**: FR-003/FR-004 require reasons shown independently of rationale and never as
  scores; a closed vocabulary keeps evidence and tests exact.

## D4 — Single pure journey engine with a data transition table

- **Decision**: `apply_action(run_log, action) → JourneyTransition{events[], new_journey_state,
  new_status}`; one transition table keyed by `(action_type, precondition)`. No I/O, no clock —
  the router mints timestamps/ids and persists via the append-only `proposal_run_manager`.
- **Rationale**: Matches the existing router/manager discipline (`_now_iso`/`_make_opportunity_id`
  are the only clock/random sources) and keeps the state machine a single, exhaustively
  table-testable unit (FR-008..FR-016, FR-019). An invalid precondition returns a structured
  rejection (FR-012), never a silent no-op.
- **Alternatives rejected**: per-action router handlers (state machine smeared across 12 handlers,
  harder to prove determinism/coverage).

## D5 — Motion-change semantics with `background_on_motion`

- **Decision**: On `motion_change` to `driving`: `background_on_motion` active plan → backgrounded
  (screen suppressed, playback continues); hard stopped-only / non-backgroundable screen-dependent
  active plan → stopped; re-run eligibility. On change to `stopped`: no forced stop; eligibility
  re-widens.
- **Rationale**: Clarify decision + §7.2; keeps "full-screen karaoke/stopped video not drivable"
  exact (SC-002) while honoring live_viewing's background policy.

## D6 — Preview is a non-persisting projection

- **Decision**: `GET /runs/{id}/journey/preview` returns a `binding:false` rolling-horizon chain
  derived from purpose/stage + the committed plan's policy; it invokes no selector and mutates
  nothing.
- **Rationale**: §3.2 (explanatory preview) + §17.4 ("editing must not create hidden partial
  decisions") + Principle III (replay collects no new actions). SC-007 asserts byte-unchanged run.

## D7 — Rest transitions without ranked rest actions (P4 depth)

- **Decision**: Support `rest_spot_arrived` / `rest_started` / `rest_completed` as journey events
  applying deterministic effects (motion/stage/explicit post-rest values, open new opportunity).
  The five named during-rest actions stay journey-orchestration events, never ranked candidates.
- **Rationale**: Milestone §6 + approved design D2; the full seeded pre-rest→rest→post-rest slice
  and any ranked rest actions are P7.

## D8 — Back-compat with legacy world-snapshot runs

- **Decision**: Eligibility runs for both typed-world (P3 `SetupSnapshot`) and legacy opaque
  `world_snapshot` runs. Entity-readiness for a legacy run with no resolvable catalog data
  excludes entity-dependent services (`missing_required_entity`) rather than crashing.
- **Rationale**: FR edge cases; preserves P1 back-compat without special-casing the engine.
