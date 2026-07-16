# Quickstart — P4 Eligibility & Discrete Journey Engine

## Run the tests (backend)

```bash
cd app/api
./.venv/bin/python -m pytest tests/proposal -q            # P4 + existing proposal suite
./.venv/bin/python -m pytest -q                           # full backend incl. trigger regression
```

Frontend:

```bash
cd app/frontend
npm run test                                              # Vitest (proposal run-area additions)
```

## End-to-end demo (docker compose)

```bash
docker compose up --build
# open the printed frontend URL → Proposal Simulator
```

1. Pick a `rest_recommended` seed, stage `after_rest_before_restart`, motion `driving`, create a run.
2. **Eligibility**: the run area shows `full_karaoke`, `stretch_video`, `call_response_stopped`
   in the **Excluded** list with reason codes, and `live_viewing` in **Eligible** (screen
   suppressed) — no scores on any exclusion.
3. Select a service → content plan (mock/real). **Accept** → `CONTENT_STARTED`; **Complete** →
   `CONTENT_COMPLETED`; **Continue** → `CONTINUE_REQUESTED`; **Stop** → `RETURN_TO_PREVIOUS_CONTENT`.
4. **Motion → stopped then driving**: an active `live_viewing` plan is backgrounded (not stopped);
   an active `full_karaoke` plan would be stopped.
5. **Reject** the offered service with ≥2 eligible → not dead-ended; **Choose another** advances.
6. **Preview** shows a non-binding future chain; the run log is unchanged afterward.

## Key acceptance checks (map to spec SC-001..SC-008)

| Check | Where |
|---|---|
| Eligible/excluded + reason codes, no scores | run area + STEP-1 evidence `excluded_candidates` |
| Full-screen karaoke / stopped video never drivable | eligibility resolver + matrix tests |
| 100% ranked candidates in the frozen row | selector-boundary test |
| Mocked plan start→complete→continue→restore | journey action endpoint + completion tests |
| Reject never dead-ends when another eligible exists | advisory-action tests |
| Deterministic motion change | motion-change tests |
| Preview never alters the run | preview test (log byte-identical) |
| Trigger + prior proposal suites still pass | full pytest run |

## New/changed surfaces

- Artifact: `proposal_contracts/service_capabilities/service_capabilities.v1.json`
- Backend: `services/proposal_eligibility.py`, `services/proposal_journey.py`,
  `services/proposal_journey_preview.py`, `models/proposal/{service_capabilities,eligibility}.py`,
  extended `models/proposal/{enums,journey}.py`, extended `routers/proposal.py`.
- Frontend: extended `ServiceProposalPanel.tsx` + new `JourneyActionBar.tsx`/`EventTimeline.tsx`,
  extended `proposalClient.ts`/`proposalStore.ts`.
