# Quickstart: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

How to run and verify the P7 slice. Backend is the source of truth; the 4-panel screen drives and displays.

## Prerequisites

- Baseline green: `cd app/api && uv run pytest -q` (2061 passing before P7).
- Frozen `demonstration` dataset, matrix v1, service-capabilities v1, and the `seed-night-highway-oshi` seed are present under `proposal_contracts/` (all P2–P4 artifacts).

## Backend test commands

```bash
cd app/api
uv run pytest tests/proposal/test_p7_recompute.py -q
uv run pytest tests/proposal/test_p7_quick_check.py -q
uv run pytest tests/proposal/test_p7_advisory_safety.py -q
uv run pytest tests/proposal/test_p7_e2e_reference_journey.py -q
uv run pytest -q            # full suite — regression gate (must stay green)
```

## Frontend test / build commands

```bash
cd app/frontend
npm run test
npm run build              # tsc + vite build must be clean
```

## End-to-end reference journey (API walk-through)

The `seed-night-highway-oshi` seed is `rest_recommended` / `before_rest_until_stop` / `driving`, oshi on.

1. **Create run (interactive)** — `POST /api/proposal/runs` with the seed's `world`, `service_package_id=aica_transparent_service_selector_v1`, `content_package_id=aica_transparent_content_selector_v1`, `mode=interactive` → `service_selected`; rank-1 is a driving-content service (e.g. `humming_karaoke`).
2. **Select service + content** — `POST /runs/{id}/select-service {selected_service_id: humming_karaoke}` → `content_selected` with a concrete plan.
3. **Accept + drive** — `POST /runs/{id}/journey/action {accept}` → `content_started`; then `{complete}` → `content_completed` (arrival).
4. **Arrive / rest** — `{rest_spot_arrived}` (→ stopped, `during_rest_stopped`); `{rest_started}`.
5. **Rest completed with explicit post-rest state** — `{rest_completed, post_rest:{drowsiness_level:20, fatigue_level:30}}` → `after_rest_before_restart`.
6. **Recompute stopped-stage proposal** — `POST /runs/{id}/recompute {overrides:[{path:"situation.drowsiness_level",value:20},{path:"situation.fatigue_level",value:30}]}` → new decision point; rank-1 is an after-rest service (e.g. `full_karaoke`), a new frozen snapshot appended to history.
7. **Select full-karaoke content** — `POST /runs/{id}/select-service {selected_service_id: full_karaoke}` → concrete stopped-only plan + lighting.
8. **Return to driving** — `{accept}` then `{motion_change, motion_state: driving}` → stopped-only content is not left active as a driving experience; previous content restored per journey policy.

## Acceptance-criteria verification map

| Criterion | How to verify |
|---|---|
| AC-1 / SC-001 full journey | `test_p7_e2e_reference_journey.py` walks steps 1–8; asserts ordered events + final restored state. |
| AC-2 / SC-002 new frozen snapshot per recompute | `test_p7_recompute.py`: after step 6, `len(setup_snapshot_history)==1`, head snapshot differs, earlier evidence unchanged. |
| AC-3 / SC-003 post-rest changes proposal | `test_p7_recompute.py`: recompute with high vs low `{drowsiness,fatigue}` → different rank-1 service **or** different ordered content plan. |
| AC-4 / SC-004 preview not committed | `test_p7_advisory_safety.py`: `GET /journey/preview` leaves the on-disk run byte-identical. |
| AC-5 / SC-005 reject-all safe after recompute | `test_p7_advisory_safety.py`: reject each eligible service post-recompute → `NO_ELIGIBLE_CANDIDATE`, run reopenable. |
| AC-6 / SC-006 quick-check parity | `test_p7_quick_check.py`: same snapshot, quick_check auto rank-1 == interactive rank-1; quick_check reaches `content_selected`. |
| AC-7 / SC-007 no probabilistic outcome | `test_p7_quick_check.py`: assert no acceptance/recovery probability field anywhere; post-rest only from explicit input. |
| SC-008 regression | full `uv run pytest` green (incl. all trigger tests). |
| SC-009 deterministic replay | `test_p7_recompute.py`: identical overrides → byte-identical snapshot+ranking; reopen renders history without recompute. |

## Run the app

```bash
docker compose up            # open the browser → Proposal Simulator → load seed-night-highway-oshi
```

On the 4-panel screen: pick the mode (Panel ②), drive the journey via the journey actions, edit post-rest drowsiness/fatigue and click Recompute, and watch the event timeline show the multi-opportunity sequence with committed-vs-preview separation, in JA (default) or EN.
