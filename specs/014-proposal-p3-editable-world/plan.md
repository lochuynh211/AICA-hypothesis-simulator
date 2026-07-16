# Implementation Plan: Editable Synthetic World, Driver Profiles & Contrast (P3)

**Branch**: `proposal-p3-editable-world` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-proposal-p3-editable-world/spec.md`; approved design
`docs/superpowers/specs/2026-07-16-proposal-p3-editable-world-design.md` (+ Scope Revision).

## Summary

Turn the P1 mock proposal world into a **real, typed, validated, editable world** —
`ControlInputs + Situation + DriverProfile` over the **read-only** frozen P2 catalog — with **base seeds**,
a **first-class driver-profile store**, **contrast clones** (field-level diff), and the **real transparent
content selector wired into STEP 2** so a different driver profile yields a visibly different, deterministic
content proposal. The service selector stays the P1 mock; no eligibility narrowing or journey engine is
added. Delivered in three vertical slices: **P3a** (world + profile store + read-only catalog loader +
seeds + validation + setup snapshot) → **P3b** (contrast clones + diff) → **P3c** (wire the real content
selector). Approach anchored to the shape the P6 package was already tested against (P0.5 world fixtures)
so the frozen selector contract is untouched.

## Technical Context

**Language/Version**: Python 3.12 (backend), TypeScript 5 / React 18 + Vite (frontend).
**Primary Dependencies**: FastAPI + Pydantic v2 (backend), React + `useReducer` store (frontend); reuse
`music_dataset_generator` (`mdg`) validation/reference helpers; the existing
`aica_transparent_content_selector_v1` package (unchanged scoring).
**Storage**: file-based JSON. Committed: `proposal_contracts/seeds/`. Git-ignored/local:
`proposal_profiles/`, `proposal_worlds/`, existing `proposal_runs/`. Catalog: frozen
`proposal_contracts/dataset/…` (read-only).
**Testing**: `pytest` (backend contract/integration/unit), Vitest (frontend), `docker compose` E2E.
**Target Platform**: local single-user container.
**Project Type**: web application (backend `app/api` + frontend `app/frontend`), proposal module isolated
from the trigger module.
**Performance Goals**: interactive review; content selection deterministic over a 300-song catalog (well
under a second); no network/LLM at runtime.
**Constraints**: backend is the authority; frontend display-only; setup-time mutation only; frozen dataset
immutable and is the replay boundary; proposal isolated from trigger; JA default, full EN.
**Scale/Scope**: 1 frozen dataset (300 songs), 5 base seeds, §5 contrast presets, ~80 editable feature
fields, a handful of built-in profiles.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Status | How P3 complies |
|---|---|---|
| I. Backend is source of truth | PASS | World validation, projection, selection, and setup snapshot all backend-owned; frontend edits/display only. |
| II. Append-only evidence; failures never hidden | PASS | Run persists after each step; content-selector raise/invalid → `algorithm_error` event (never a faked plan); explicit `no_proposal`. |
| III. Deterministic, replayable | PASS | Frozen catalog is the replay boundary; pure content selector ⇒ identical output for identical world; reopen renders from log without recompute. |
| IV. Qualitative trigger discipline | PASS (n/a-new) | No raw external quantities introduced; catalog audio values are frozen dataset data, not live route numbers. |
| V. One generic adapter contract | PASS | The real content package is a `python_module` invoked via the existing `dispatch_selector` → `CompletePlan`; no algorithm specifics leak into the adapter. |
| VI. Local-first simplicity (YAGNI) | PASS | File-based seeds/profiles/clones; no DB/cloud/multi-user; catalog editing explicitly cut. |
| Security & Safety | PASS | No keys; local trusted package; setup-time mutation only; invalid worlds/datasets blocked with visible errors; no network. |

**Result: PASS** (initial). No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)
```text
specs/014-proposal-p3-editable-world/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/proposal-p3-api.md
└── checklists/requirements.md
```

### Source code (repository root)
```text
app/api/aica_api/
├── models/proposal/
│   ├── world.py          # World, ControlInputs, Situation, DriverProfile, SeedWorld, WorldClone, SetupSnapshot, project()
│   └── dataset.py        # read-only catalog ref + provenance
├── services/
│   ├── dataset_catalog_registry.py   # read-only loader + Song validation + provenance
│   ├── world_seed_store.py           # base seeds (committed) load
│   ├── driver_profile_store.py       # built-in + user profiles CRUD
│   └── world_validation.py           # enum/range/purpose-stage/reference issues
├── routers/proposal.py   # + datasets/catalog(read-only), seeds, profiles, worlds/clone+validate; typed World + SetupSnapshot on run-create; STEP2 → real content selector
└── config.py             # + proposal_profiles_dir, proposal_worlds_dir

packages/aica_transparent_content_selector_v1/package.json   # + family, approach
proposal_contracts/seeds/*.json                              # 5 promoted+completed base seeds
scripts/ (or mdg CLI) promote_seeds.py                       # one-time authoring, tested
proposal_contracts/schema/{world,dataset}.schema.json        # generated via export_schema

app/frontend/src/
├── state/proposalStore.ts            # world/profiles/seeds/clones/catalog slices (replaces flat featureSnapshot)
├── api/proposalClient.ts             # + datasets/seeds/profiles/clone/validate
└── components/proposal/
    ├── panels/WorldPanel.tsx         # real editor (control/situation/driver-profile groups, genre toggle)
    └── {SeedPicker,DriverProfilePicker,WorldDiffView,DatasetProvenanceBanner,CatalogView}.tsx
```

**Structure Decision**: Web application, extending the isolated proposal module only. Backend owns models,
services, routes; frontend owns the editor UI. Fully additive — no trigger files change.

## Phase sequencing (vertical slices, TDD)

- **P3a** — `dataset.py` + `dataset_catalog_registry` (read-only load/provenance/Song-validate) →
  `world.py` (types + `project()` golden-tested to the P0.5 shape + cross-checked against the real
  selector) → `world_seed_store` + promote 5 seeds (golden round-trip) → `driver_profile_store` (built-in +
  save/list/delete) → `world_validation` (field-level messages) → typed `World` + `SetupSnapshot` on
  run-create → frontend WorldPanel (all groups editable, seed/profile pickers, read-only catalog banner,
  genre toggle) + store/client. Both selectors still mock at this point.
- **P3b** — `WorldClone` + clone route + deterministic diff → frontend clone-and-change + DiffView.
- **P3c** — add `family`/`approach` to the real content manifest; STEP 2 routes to the real content
  selector via `dispatch_selector` (catalog candidates, `_service_id`); algorithm-error + unsupported-
  service + no-proposal paths; frontend renders the real plan + reasoning. Contrast test (two worlds →
  different plans) is the milestone-exit demonstration.

## Constitution re-check (post-design)

Design introduces no new violations: catalog read-only (III/VI), real selector via the single adapter
(V), failures surfaced (II), isolation preserved (I/VI), no network/keys (Security). **PASS.**

## Complexity Tracking

None — no constitution violations to justify.
