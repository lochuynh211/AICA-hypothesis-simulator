# Quickstart: M2 Package & Schema Hardening

How to run and verify M2 once implemented.

## Start
```bash
docker compose up        # api :8137, frontend :5180
```
Open `http://localhost:5180`.

## Review flow (UI)
1. Select a **package** (rule-based or weighted-score) and a **scenario**
   (friend-drive or overtime).
2. **Edit** parameters/hyperparameters (defaults pre-filled); invalid values show an
   inline error.
3. **Generate plan** → draft plan summary (tick cadence, traffic/rest events); tweak
   and **Regenerate** as desired.
4. **Start** → play/step to the proposal. The trace shows (for weighted-score)
   per-category scores, candidates incl. suppressed/non-selected, and the selected
   category. Live readouts show evolving driver bands.
5. **Act** — accept_rest / postpone / (overtime: **decline**).
6. **Load log** → persisted evidence incl. setup snapshot, frozen plan, profiles,
   per-tick `raw_state`/`feature_groups`/driver+vehicle updates, and
   original/modified values.

## Backend-only flow (curl)
```bash
B=http://localhost:8137
curl -s -XPOST $B/api/routes/analyze -H 'content-type: application/json' \
  -d '{"scenario_id":"uc01_overtime_driver_v0_1"}'
PLAN=$(curl -s -XPOST $B/api/run-plans -H 'content-type: application/json' \
  -d '{"package_id":"rest_weighted_score_v0_1","scenario_id":"uc01_overtime_driver_v0_1",
       "presets":{},"parameters":{},"hyperparameters":{},"run_mode":"standard"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["plan_id"])')
RID=$(curl -s -XPOST $B/api/runs -H 'content-type: application/json' \
  -d "{\"plan_id\":\"$PLAN\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')
# tick until paused, then:
curl -s -XPOST $B/api/runs/$RID/actions -H 'content-type: application/json' -d '{"action":"decline"}'
curl -s $B/api/runs/$RID/log        # full per-tick evidence
```

## Tests
```bash
cd app/api && uv run pytest        # engine, weighted_score, run-plan, persistence, both pairings
cd app/frontend && npm test        # selectors, editors, plan preview, decline
```

## Not in M2
Google Maps (M4), Python/transparent-hybrid logic (M3), structured feedback +
evidence replay (M5), `expert_override`, run comparison.
