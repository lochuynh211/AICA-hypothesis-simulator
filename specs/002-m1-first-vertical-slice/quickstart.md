# Quickstart: M1 First Runnable Vertical Slice

How to run and verify the M1 loop once implemented (mirrors what M6's README will
expand).

## Start

```bash
docker compose up        # backend :8137, frontend :5180 (from M0)
```

Open `http://localhost:5180`.

## Review a UC-01 fatigue drive (UI)

1. Left panel: select package **休憩提案（ルール）/ Rest proposal (rule-based)** and
   scenario **UC-01 fatigue friend drive** (the only options in M1).
2. Press **Start** → a run is created (a `runs/<run_id>.json` appears immediately).
3. Press **Play** (or **Step**). The car advances; the left readouts show the
   drowsiness/fatigue **bands** and position; the trace panel fills per tick.
4. At the fatigue decision point the cockpit switches to the **rest proposal**; the
   run pauses. The trace shows `result_type: REST_PROPOSAL`, the `rest_required`
   candidate, fire-control, reasons, and explanation.
5. Click **Accept rest** or **Postpone** → the action is recorded and playback
   resumes to completion.
6. Open the **log view** (right panel) → the persisted evidence JSON for the run,
   including the trace and your action.

## Verify backend-only (no frontend)

```bash
# create
curl -s -XPOST :8137/api/runs -H 'content-type: application/json' \
  -d '{"package_id":"rest_rule_based_v0_1","scenario_id":"uc01_fatigue_friend_drive_v0_1"}'
# tick until "paused": true (the rest proposal)
curl -s -XPOST :8137/api/runs/<run_id>/tick
# act
curl -s -XPOST :8137/api/runs/<run_id>/actions -H 'content-type: application/json' -d '{"action":"accept_rest"}'
# read evidence
curl -s :8137/api/runs/<run_id>/log
ls runs/                  # <run_id>.json present
```

## Run the tests

```bash
cd app/api && uv run pytest          # registries, declarative_rule, adapter, binning,
                                     # tick engine, evidence recorder, run manager, API loop
cd app/frontend && npm test          # panels, client, run store, proposal actions
```

## What M1 does NOT do

No Google Maps, no second package/scenario, no weighted-score/Python algorithm, no
editable setup/run-plan flow, no structured feedback, no evidence replay playback
(the log view is a static JSON display). Those are M2–M5.
