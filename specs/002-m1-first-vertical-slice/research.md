# Phase 0 Research: M1 First Runnable Vertical Slice

Most decisions were resolved in the ADR and the two clarify questions. This file
records the remaining concrete choices so Phase 1 has no open unknowns.

## R1 — Tick advance model (clarified)

- **Decision**: Each `POST /api/runs/{id}/tick` advances simulation time by a fixed
  step (`tick_seconds`, scenario-provided, default e.g. 60 sim-seconds). Route
  position = `elapsed_seconds / total_duration_seconds` (clamped to 1.0). The run is
  bounded by total duration; ticking past the end returns a terminal "completed"
  state without advancing.
- **Rationale**: Matches the master runtime workflow's numeric tick model and the
  clarify answer; keeps determinism trivial (position is a pure function of tick
  count); qualitative bands are derived from this numeric state via `binning`.
- **Alternatives**: route-fraction step (rejected in clarify — chose sim-time);
  event-driven jumps (loses the per-tick trace richness).

## R2 — Rule-algorithm score (clarified)

- **Decision**: `declarative_rule` computes an **ordinal blend score** from the
  banded inputs (porting the functional skeleton's `blend`/`damped` formula over
  ordinal positions) and populates `score` on the `DecisionResult` and the firing
  candidate. The decision itself is first-match R1–R5 classification.
- **Rationale**: Gives a real value in the full §11 shape and a richer trace at no
  extra modeling cost; reuses the proven skeleton math.
- **Alternatives**: null score for rules (rejected in clarify).

## R3 — Run identifier scheme

- **Decision**: Run id = `run_<YYYYMMDD-HHMMSS>_<short-random>` where the timestamp
  is supplied by the request handler at creation (not inside deterministic code).
  Log file = `runs/<run_id>.json`. The id is **not** part of the deterministic
  decision path — determinism tests assert on the trace, not the id.
- **Rationale**: Human-sortable, collision-resistant, filesystem-safe; keeps
  determinism (decisions) separate from identity (run id). Timestamps/randomness are
  confined to the HTTP boundary so core engine code stays pure.
- **Alternatives**: bare UUID (less human-readable); monotonic counter (needs shared
  state, fragile across restarts).

## R4 — declarative_rule structure (ported from functional skeleton)

- **Decision**: Manifest `rules` express the first-match list R1–R5; the engine maps
  ordinal-band inputs through `ORD` positions, computes `blend` then `damped` (with
  persistence damping), derives cut-points (`reactionPoint`, `proposalCut`,
  `severeCut`) from hyperparameters, and classifies:
  - R1 SEVERE_INTERVENTION (drowsiness severe OR damped ≥ severeCut)
  - R2 NO_PRACTICAL_ACTION_FALLBACK (damped ≥ proposalCut AND rest not reachable)
  - R3 REST_PROPOSAL (damped ≥ proposalCut AND rest reachable)
  - R4 SOFT_WARNING (damped ≥ reactionPoint)
  - R5 NO_TRIGGER (catch-all)
  The selected category is `rest_required`; R3 emits the `rest_guidance` proposal.
- **Rationale**: Reuses the skeleton's tested rule semantics, including suppression
  via the actionability guard (R2 vs R3). Suppressed candidates are preserved.
- **Alternatives**: invent new rule semantics (needless; skeleton is the reference).

## R5 — Qualitative band catalog

- **Decision**: Reuse the functional skeleton's band vocabularies as the M1 enums —
  `drowsiness_level` (none|weak|moderate|strong|severe), `fatigue_level`
  (low|medium|high), `signal_duration` (transient|brief|sustained|persistent),
  `continuous_driving_time` (short|moderate|long), `rest_spot_eta` (none|near|far);
  hyperparameter bands (low|medium|high) and `require_actionable` boolean. Route
  segments carry `speed_band`/`length_band` ordinal labels and `at` fractions.
- **Rationale**: Proven, ordinal, no raw numbers; the binning seam maps any future
  numeric (M4 Maps) into these.

## R6 — Frontend run state without a new dependency

- **Decision**: `state/runStore.ts` = a React Context + `useReducer` exposing run
  state, latest decision, trace list, and pause flag; a typed `api/client.ts` wraps
  fetch. No Redux/Zustand/etc.
- **Rationale**: Security posture (no new deps after the httpx2 incident); the state
  shape is small enough for Context + reducer.
- **Alternatives**: a state library (rejected — unnecessary dependency surface).

## R7 — Determinism boundary

- **Decision**: The tick engine, event-plan freeze, binning, and adapter are **pure**
  given (frozen plan, tick index, history, runtime state). All non-determinism
  (timestamps, run id) lives at the HTTP/router boundary and is excluded from the
  decision trace. Determinism tests run the same plan twice and assert identical
  traces.
- **Rationale**: Satisfies constitution III and SC-003; mirrors the skeleton's
  `structuralSignature` discipline.

## Outcome

All Technical Context items are concrete. **No `NEEDS CLARIFICATION` remain.**
