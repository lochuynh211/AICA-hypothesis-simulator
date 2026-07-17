# Implementation Plan: Proposal Preset Test-Cases + Grounded Retune + Relative-Fit Display

**Branch**: `018-proposal-preset-testcases` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-proposal-preset-testcases/spec.md`

**Authoritative design**: `docs/superpowers/specs/2026-07-17-proposal-preset-testcases-design.md`

## Summary

Add a **preset** layer to proposal mode: a committed, read-only artifact that binds one situation + one driver profile into a single documented test case (bilingual brief, machine-checkable expectation contract, optional isolated `algorithm_config_overrides`). Ship ~18 presets across 9 families with 7 contrast pairs, each anchored to real catalog artists/genres/eras. Presets are **generated** from compact author-specs into full `SeedWorld` JSON by a script mirroring `promote_seeds.py` (byte-identical, golden-pinned). A pytest **verification harness** runs both real selectors through the production dispatch path and asserts each preset's expectation contract (top track, per-preset `top_fit_min`, gradient, expected service set) and that contrast pairs diverge at the #1 track. The content scorer's `norm_bounds` loudness is recalibrated to the real catalog distribution (global; directional conflict preserved; pinned math tests updated). The frontend adds a `PresetPicker` above the Seed section with an atomic `LOAD_PRESET` action, a brief blurb, and a sync-guard fix, plus a display-only **fit band** `(raw+1)×50` shown next to the raw score in both proposal panels.

## Technical Context

**Language/Version**: Python 3.11 (backend, `app/api`), TypeScript 5 / React 18 + Vite (frontend, `app/frontend`)

**Primary Dependencies**: FastAPI + stdlib (no new backend deps — constitution/Security: no new PyPI packages; see project memory `supply-chain-httpx2-incident`); pydantic (already an `aica-api` dep); React + existing proposal state store

**Storage**: File-based. New committed dir `proposal_contracts/presets/*.json` (read-only, like `seeds/`/`profiles/`). No DB.

**Testing**: pytest (`app/api/tests/proposal/`), Vitest (`app/frontend`). Verification harness is pytest driving the production `dispatch_selector` path.

**Target Platform**: Local single-user container (`docker compose up`); offline-capable.

**Project Type**: Web application (FastAPI backend + React frontend), proposal mode only.

**Performance Goals**: N/A beyond interactive local use. Preset list/fetch is a small directory scan; the verification harness runs 18 presets × 2 selectors over a 300-song catalog in test time (seconds).

**Constraints**: No new runtime dependencies; `mdg` must never become an `aica-api` runtime dep (project memory `p3-editable-world-status`). Presets embed full `SeedWorld` completed from the `World` model defaults. Per-preset overrides apply only at dispatch and never mutate frozen `package.json`. Fit band is display-only and never feeds a recorded decision.

**Scale/Scope**: ~18 preset files, 1 schema, 1 pydantic model, 1 store, 2 endpoints, 1 config var, 1 generator script + golden test, 1 override-merge function, 1 verification harness + report, 1 norm_bounds retune + math-test updates, frontend `PresetPicker` + `LOAD_PRESET` + fit-band display.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Backend is source of truth** | Presets are backend-owned committed files; both selectors run backend; the fit band is a display-only transform of the authoritative raw score and never feeds a recorded decision (explicitly permitted). | ✅ Pass |
| **II. Evidence append-only, failures never hidden** | `preset_id` recorded in run setup provenance; per-preset overrides recorded in the run's resolved-config evidence (reuses the existing reviewer-entered-vs-resolved disclosure); a malformed preset is rejected on load with a visible error, never silently degrading a proposal. | ✅ Pass |
| **III. Deterministic, replayable** | No tick-engine change; selectors stay pure; replay renders from the log without recompute. Presets only set setup-time inputs. | ✅ Pass |
| **IV. Qualitative trigger discipline** | Proposal mode, not trigger. World situation values are authored ordinals/bands, not raw external-service numerics. The `norm_bounds` retune normalizes catalog **audio features** (not external route data), so this principle is not engaged. | ✅ Pass |
| **V. One generic adapter contract** | Both selectors remain `python_module` packages with `evaluate(context)->dict`. Per-preset overrides flow through the existing hyperparameter/parameter config surface, merged before `evaluate`; no new adapter type. Suppressed candidates stay disclosed. | ✅ Pass |
| **VI. Local-first simplicity (YAGNI)** | File-based presets, read-only, no in-app authoring, no DB/accounts/cloud. Smallest slice on top of existing seed/profile machinery. | ✅ Pass |
| **Security & Safety** | No map key involved. Presets are data (no new code execution). Overrides are setup-time only, immutable after run start (no `expert_override` needed). Invalid presets block visibly. **No new PyPI deps.** | ✅ Pass |
| **Workflow & Quality Gates** | SDD followed. Contract surfaces (preset schema, selector outputs, run provenance, verification harness) get contract/integration tests first (TDD). Generated preset JSON is produced by a generator, never hand-edited, and golden-pinned. Milestone stays runnable. | ✅ Pass |

**Result: PASS — no violations, Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/018-proposal-preset-testcases/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (preset schema + endpoint contracts)
│   ├── p1_preset.schema.json
│   └── preset_endpoints.md
├── checklists/
│   └── requirements.md   # from /speckit-specify
└── tasks.md             # /speckit-tasks output (later)
```

### Source Code (repository root)

```text
proposal_contracts/
├── presets/                              # NEW — committed, read-only, generated
│   ├── README.md                         # "generated by scripts/generate_presets.py; never hand-edit"
│   └── preset-<slug>.json                # ~18 files (full SeedWorld + brief + expectation + overrides)
└── schema/
    └── p1_preset.schema.json             # NEW — preset JSON schema

scripts/
└── generate_presets.py                   # NEW — mirrors promote_seeds.py: compact author-specs → full preset JSON

app/api/aica_api/
├── config.py                             # + proposal_presets_dir (AICA_PROPOSAL_PRESETS_DIR, default proposal_contracts/presets)
├── models/proposal/
│   └── preset.py                         # NEW — Preset, PresetSummary, ExpectationContract, AlgorithmConfigOverrides
├── services/
│   ├── preset_store.py                   # NEW — read-only scan (mirrors world_seed_store.py)
│   └── proposal_selector.py             # + apply per-preset overrides before evaluate (merge fn)
└── routers/
    └── proposal.py                       # + GET /api/proposal/presets and /presets/{id}

app/api/tests/proposal/
├── test_preset_store.py                  # NEW — store load/validation/rejection
├── test_ep_presets.py                    # NEW — endpoint contract
├── test_preset_generation.py             # NEW — golden: generator output == committed JSON (byte-for-byte)
├── test_presets_expectations.py          # NEW — the verification harness (both selectors, every preset)
├── test_config_override_merge.py         # NEW — override-merge purity/isolation
├── test_norm_bounds_retune.py            # NEW — catalog-grounded bounds + arousal-spread regression
├── test_p5_service_math.py               # UPDATED if service math shifts (expected: unchanged)
└── test_content_selector_*.py            # UPDATED pinned content math to recalibrated norm_bounds

packages/aica_transparent_content_selector_v1/
└── package.json                          # norm_bounds loudness recalibrated (global)

app/frontend/src/
├── components/proposal/panels/
│   ├── WorldPanel.tsx                    # + <PresetPicker/> section 0 above Seed
│   ├── ContentProposalPanel.tsx          # + fit-band column
│   └── ServiceProposalPanel.tsx          # + fit-band column
├── components/proposal/
│   ├── PresetPicker.tsx                  # NEW — clones SeedPicker pattern + brief blurb
│   └── SeedPicker.tsx / DriverProfilePicker.tsx  # sync-guard fix
├── state/proposalStore.ts                # + LOAD_PRESET action, presets slice, selectedPresetId
├── api/proposalClient.ts                 # + getPresets()/getPreset(), PresetSummary type
└── lib/ (or util)                        # fitBand(raw) = (raw+1)*50 display helper + unit test

docs/master/ (or build_reports/)
└── proposal_preset_analysis.md           # generated verification report (expected vs real, pass/fail)
```

**Structure Decision**: Extend the existing proposal-mode web app in place. Presets mirror the established `seeds/`/`profiles/` file+store+router+config pattern exactly (one source of truth, read-only, generated+golden-pinned like `promote_seeds.py`). No new top-level project or dependency.

## Phase 0 — Research

See `research.md`. All spec `[NEEDS CLARIFICATION]` were resolved during `/speckit-clarify`; research records the remaining design decisions (generation vs hand-authoring, override-merge mechanism, norm_bounds method, fit-band placement, harness structure, frontend sync).

## Phase 1 — Design & Contracts

See `data-model.md` (entities + validation), `contracts/` (preset schema + endpoint contracts), `quickstart.md` (run/verify walkthrough). Agent context (`CLAUDE.md` SPECKIT markers) updated to point at this plan.

## Complexity Tracking

No constitution violations — table intentionally empty.
