# Implementation Plan: Signal-Tier Re-design & Clean Setup Screen

**Branch**: `009-signal-tier-redesign` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-signal-tier-redesign/spec.md`

## Summary

Re-plumb the simulator's raw-state model into three explicit tiers (Fixed / Dynamic / Simulated),
turn the fabricated driver/vehicle values into clearly-named **simulated signals** — keeping
`drowsiness`/`fatigue` (deterministic, context-derived) and replacing the four deterministic vehicle
sensors + `attention` with a single **seeded-Poisson `anomaly_rate`** event stream — and re-design the
Hybrid algorithm to a compact 8-feature form on the shared signal contract (NRI unchanged, now with a
live realtime term). Move all defaults into package manifests. On the frontend, replace the setup
screen with two editor panels (Scenario & Signals; Algorithm-as-formulation) plus a full-width
**ephemeral Instant-Result** timeline that recomputes headlessly on every edit. Backend + `app/frontend`
only; htmlapp deferred. Full target math and UX are in `others/aica_trigger_algorithms_math_comparison.md`
(Part 2) and `others/aica_setup_screen_uiux.md`.

## Technical Context

**Language/Version**: Python 3.12 (backend `app/api`), TypeScript 5 + React 18 + Vite (frontend `app/frontend`)

**Primary Dependencies**: FastAPI + Pydantic (backend); React + Zustand-style store + Vite (frontend). **No new dependencies.** Randomness uses the stdlib `random.Random(seed)` (deterministic per seed) via a per-channel derivation — no global RNG, no wall-clock seeding.

**Storage**: File-based — `packages/` (manifest + `algorithm.py`), `scenarios/` (JSON), `runs/` (append-only evidence). Instant-result preview writes **nothing**.

**Testing**: pytest (`app/api/tests`); Vitest (`app/frontend/tests`). Contract surfaces (algorithm outputs, decision trace, run logs, anomaly generator, ephemeral evaluate) get contract/integration tests first (Constitution workflow gate).

**Target Platform**: Local, single-user, containerized (`docker compose up`), Linux.

**Project Type**: Web application (backend API + React frontend).

**Performance Goals**: Instant-result recompute end-to-end < 1 s (SC-001); the deterministic tick engine runs a full ~240-tick scenario in a few ms, so the cost is dominated by request/serialize, not compute.

**Constraints**: Deterministic & replayable (Principle III); ephemeral preview never persists (FR-014a); setup-time mutation only; algorithm errors surface as `algorithm_error`, never a fake decision (Principle II).

**Scale/Scope**: 2 algorithm packages (Hybrid re-designed, NRI unchanged), ~2 rewritten scenarios, UC-01 fatigue/rest only. Single new frontend screen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Backend is source of truth | ✅ PASS | Instant-result is a **backend** evaluation; the frontend only renders it and computes display-only positions. No decision/evidence originates in the view. |
| II. Evidence append-only; failures never hidden | ✅ PASS | The ephemeral preview is not a run → append-only doesn't apply; only "Open full run" persists. Algorithm exceptions → `algorithm_error` events on both the persisted and ephemeral paths (FR-010). |
| III. Deterministic, replayable | ✅ PASS | `run_seed` frozen into the event plan at start; `anomaly_rate` uses a seeded PRNG keyed by `(run_seed, tick, channel)`. Same setup+seed → identical trace (FR-005). Replay still renders from the log without recompute. |
| IV. Qualitative trigger discipline | ✅ PASS (with note) | Compact Hybrid features consume **simulator-internal** values (drowsiness, anomaly_rate, accumulated minutes), not external-service route numerics. Any route-sourced value (e.g. `nextRestSpotMin` under M4 Maps) keeps the existing boundary-binning before the algorithm — see research.md. |
| V. One generic adapter contract | ✅ PASS | Both packages stay `python_module` through the single `evaluate(context)→result` adapter. The anomaly generator lives in the **simulator** (tick engine), not the adapter; the ephemeral path reuses adapter+engine and only skips persistence. Suppressed candidates preserved. |
| VI. Local-first simplicity (YAGNI) | ✅ PASS | No migration tool (scenarios rewritten in place, old-shape rejected); no new deps/services; htmlapp, attention+content-loop, richer sensors, route look-ahead all deferred. |

**Security & Safety**: BYO-key unaffected (local deterministic route for previews); algorithms remain local trusted `python_module`; setup-time-only mutation preserved (preview recomputes pre-run); invalid/old-shape scenarios block with visible errors. **No gate violations.**

## Project Structure

### Documentation (this feature)

```text
specs/009-signal-tier-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 — key decisions
├── data-model.md        # Phase 1 — tiered signals, scenario schema, run config, instant-result
├── quickstart.md        # Phase 1 — how to run & verify
├── contracts/           # Phase 1 — anomaly generator, tiered context, ephemeral evaluate
│   ├── anomaly-generator.md
│   ├── tiered-context.md
│   └── ephemeral-evaluate.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
app/api/aica_api/
├── models/
│   ├── scenario.py          # scenario schema: driver_signal_params, anomaly_signal_params, run_seed; reject old shape
│   ├── profile.py           # rename DriverModelProfile→DriverSignalParams; DELETE vehicle profiles; add AnomalySignalParams
│   ├── run.py               # RunConfig gains run_seed; TickState raw_state → tiered signals
│   └── decision.py          # unchanged §11 DecisionResult shape
├── services/
│   ├── tick_engine.py       # emit 3-tier signals; drop vehicle signals; call anomaly generator
│   ├── behavior/
│   │   ├── driver_signals.py # renamed from driver_model.py (drowsiness/fatigue only; attention removed)
│   │   ├── anomaly_signal.py # NEW: seeded-Poisson anomaly event → anomaly_rate (rolling count)
│   │   └── vehicle_model.py  # DELETED
│   ├── prng.py              # NEW: deterministic seeded PRNG keyed by (run_seed, tick, channel)
│   ├── binning.py           # feature_groups: keep route boundary-binning; drop steering/pedal derivations
│   ├── event_plan.py        # freeze run_seed alongside events
│   └── run_manager.py       # build tiered context; ephemeral (non-persisting) evaluate path
├── algorithms/
│   ├── adapter.py           # unchanged contract; inject manifest defaults (single source of truth)
│   └── python_module.py     # stop relying on algorithm-side hp.get(default)
└── routers/
    └── runs.py              # NEW ephemeral "preview" endpoint (no persistence)

packages/
├── aica_transparent_hybrid_trigger_v1/{package.json, algorithm.py}  # compact 8-feature re-design; manifest defaults
└── nri_fatigue_score_v1/{package.json, algorithm.py}                # unchanged behavior; manifest defaults

scenarios/*.json             # rewritten in place to tiered/param structure + run_seed default

app/frontend/src/
├── components/setup/        # NEW setup screen: SignalsPanel, AlgorithmFormulationPanel, InstantResultStrip, SignalInfoPopover
├── state/runStore.ts        # setup state, overrides diff, ephemeral-preview call, seed
└── api/                     # preview + run clients

app/api/tests/               # anomaly generator, tiered context, hybrid re-design, NRI live term, ephemeral path, scenario reject
app/frontend/tests/          # setup panels, formulation editing, instant-result rendering
```

**Structure Decision**: Existing web-app layout (`app/api` FastAPI backend + `app/frontend` React) is retained. Backend changes concentrate in `services/behavior` (signal simulators), `tick_engine`/`run_manager` (tiered context + ephemeral path), the two `packages/`, and `scenarios/`. Frontend changes are a new `components/setup/` tree + `runStore`. htmlapp untouched (deferred).

## Phase 0 — Research

See [research.md](./research.md). Key decisions: seeded-PRNG mechanism (stdlib `random.Random` per-channel derivation); anomaly point-process formulation & replay; ephemeral evaluate as a reuse of the tick loop without the recorder; scenario rewrite vs. migration; manifest-as-single-source-of-defaults; Principle IV route-binning preservation.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the tiered signal model, scenario schema (`driver_signal_params`, `anomaly_signal_params`, `run_seed`), `RunConfig`, the compact Hybrid feature/score definitions, NRI (unchanged), and the ephemeral `InstantResult` shape.
- [contracts/anomaly-generator.md](./contracts/anomaly-generator.md) — the seeded-Poisson generator interface + determinism guarantees.
- [contracts/tiered-context.md](./contracts/tiered-context.md) — the 3-tier context dict passed to `evaluate(context)`.
- [contracts/ephemeral-evaluate.md](./contracts/ephemeral-evaluate.md) — the non-persisting preview endpoint + `InstantResult`.
- [quickstart.md](./quickstart.md) — run & verify.

**Post-Design Constitution Re-Check**: no new violations introduced by the design artifacts (ephemeral path reuses the adapter/engine; determinism preserved by the seeded PRNG contract; defaults centralized in manifests). Gate remains **PASS**.
