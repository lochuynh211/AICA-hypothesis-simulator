# Quickstart — P1 Proposal Screen & Standalone Run Foundation

## Run the app

```bash
docker compose up            # then open the browser to the Vite dev/preview URL
# or, for local dev without containers:
cd app/api && uv run uvicorn aica_api.main:app --reload
cd app/frontend && npm run dev
```

## Demonstration flow (the milestone exit demo)

1. In the header, switch the **app toggle** from *Trigger* to **Proposal**. The 3-panel screen appears in
   **Japanese** (default), without creating any trigger run.
2. **① World panel** (top→bottom): pick a **Trigger signal** (e.g. `rest_recommended`), a **Car state**
   (e.g. *after spot* = `after_rest_before_restart`, `motion_state=stopped`), edit **World · situation**
   values, and choose a **Driver profile** (loads Preference & history).
3. **② Service proposal**: pick `mock_service_selector_v1` + mode; optionally edit its parameters and the
   matrix hyperparameters (under "Hyperparameters (advanced)"). Click **Run** → up to 3 ranked candidate
   services appear, each expandable to a **reason breakdown** (contribution table + supported/opposed +
   rationale). Allowed-service chips reflect the frozen matrix row (post-rest = 5).
4. **Choose** the rank-1 (or any) service → **③ Content proposal** runs the mock content selector for that
   service and shows **one ordered plan** (real song names from the frozen P2 catalog) with per-item
   reason breakdowns, plan mode/duration/lighting/policies, and excluded examples.
5. Open **Proposal → Runs**: the run is listed. **Reopen** it — the recorded evidence renders exactly (no
   recomputation). **Delete** it — it disappears from `proposal_runs/` and the list.
6. Toggle the language to **EN** — every panel/label switches; toggle back to JA. Switch the app toggle
   back to **Trigger** — Setup / Review / Runs are unchanged and functional.

## Verify (gates)

```bash
cd app/api && uv run pytest                     # backend: contract/unit/integration incl. tests/proposal/
cd app/frontend && npm test                     # frontend: Vitest
cd app/frontend && npm run build                # build gate
docker compose config                           # compose validity
```

## What to check by hand

- **Isolation**: after creating a proposal run, `runs/` is unchanged; a new file exists only under
  `proposal_runs/`. Editing proposal setup leaves the Trigger Setup untouched.
- **Failure visibility**: (dev) point the service package at a raising `evaluate` → the run shows an
  explicit `algorithm_error`, not a fabricated proposal.
- **Matrix freeze**: the reopened run records its `matrix_version`; the post-rest row shows 5 services
  including `call_response_stopped`.
- **No aggregate plan score**: the content result is one ordered plan; there is no `plan_score` anywhere.

## Key paths

- Backend contracts: `app/api/aica_api/models/proposal/` (isolated); frozen matrix
  `proposal_contracts/matrix/purpose_stage_matrix.v1.json`; mocks `packages/mock_*`.
- Frontend: `app/frontend/src/components/proposal/` + `state/proposalStore.ts` + `state/appMode.tsx`.
- Approved UI reference: `specs/013-proposal-p1-screen-foundation/ui-mockup.html`.
