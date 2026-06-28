# AICA Hypothesis Simulator

A local, single-user tool for reviewing AICA (AI Cockpit Assistant) trigger
algorithms by running driving scenarios and inspecting decision traces.

> **Status: M5 — Review Feedback & Evidence Completeness.** M5 adds structured
> reviewer feedback, a read-only evidence timeline, and a downloadable evidence report.
> M4 features (BYO-key Google Maps route surface) and all prior milestone features
> are still fully supported.

## Prerequisites

- Docker and Docker Compose.
- Host ports **8137** (backend) and **5180** (frontend) free.

## Start the application

From the repository root:

```bash
docker compose up
```

This starts two services with hot reload:

| Service    | URL                     | Purpose                          |
|------------|-------------------------|----------------------------------|
| `frontend` | http://localhost:5180   | App UI (open this in browser)    |
| `api`      | http://localhost:8137   | FastAPI backend                  |

Open **http://localhost:5180**.

### Changing the ports

If 8137 or 5180 is already in use on your machine, change them in two places:

- **`docker-compose.yml`** — the `ports:` mapping for the affected service
  (e.g. `"8137:8137"` → `"<new>:8137"`).
- **`app/frontend/vite.config.ts`** — if you change the frontend port, update
  `server.port`; if you change the backend port, update the proxy `target`
  (`http://api:8137`). The backend container port itself is set by the `--port`
  flag in `Dockerfile.api`.

> **Note on dependency changes:** the `.venv` and `node_modules` directories
> live in named Docker volumes that are seeded only when first created. If you
> change backend or frontend dependencies later, run `docker compose down -v`
> (to drop the stale volumes) before `docker compose up` so the rebuilt images'
> dependencies take effect.

## M2 review flow (UI)

1. **Select a package** — **Rest proposal (rule-based)** or
   **Rest proposal (weighted-score)** — and a **scenario** — **UC-01 friend drive**
   or **UC-01 overtime driver**.
2. **Edit parameters / hyperparameters** — defaults are pre-filled; invalid values
   show an inline error and block the plan.
3. **Generate plan** — the backend generates a draft plan summary (tick cadence,
   traffic/rest events). Tweak settings and press **Regenerate** as desired.
4. Press **Start** → the run is created and `runs/<run_id>.json` is written
   immediately by the backend.
5. Press **Play** (or **Step** one tick at a time). The left panel readouts update
   with drowsiness/fatigue bands and route position; the right panel trace fills
   with one row per tick. For the weighted-score package the trace shows
   per-category scores, candidate strength, and state.
6. When the fatigue decision point is reached the run pauses and the cockpit area
   shows the **rest proposal**. Press **Accept rest**, **Postpone**, or (for the
   overtime scenario) **Decline**.
7. Click **Load** in the **RUN LOG** section (bottom-right panel) to view the full
   persisted evidence — setup snapshot, frozen plan, driver+vehicle profiles,
   per-tick `raw_state`/`feature_groups`/driver+vehicle updates, and your action.

## M3 review flow — transparent hybrid (UI)

1. **Select** package **AICA Transparent Hybrid Trigger v1** and a UC-01 rest
   scenario (e.g. UC-01 friend drive). Optionally edit hyperparameters (28 tunable
   values: smoothing α, score weights, band thresholds, persistence counts, cooldowns).
2. **Generate plan → Start → Play** (or Step). The trace shows, per tick:
   - Per-category **features** (11 features, 0–1 normalised)
   - **Category scores** (base safety risk, rest required, monotony prevention) —
     computed from *smoothed* features (EMA α = 0.35)
   - **State labels** (`REST_NORMAL → REST_WATCH → REST_SUGGEST → REST_RECOMMEND →
     REST_URGENT`; `MONOTONY_NORMAL → MONOTONY_WATCH → MONOTONY_CONTENT_SUGGEST`)
   - All **candidates** (including suppressed ones) and **fire-control** outcome
   - A compact **runtime-state indicator** (smoothed scores + persistence counters)
     that visibly changes tick-to-tick — the M3 headline
3. The persistence gate is visible: the smoothed rest score crosses the threshold
   one tick before the proposal fires (→ SUPPRESSED, counter 0→1), then fires the
   next tick (counter 1→2). Both ticks are in the persisted evidence.
4. When the rest proposal arrives, press **Accept rest** or **Postpone**.
5. In the **RUN LOG** the per-tick `package_runtime_state` is non-empty for every
   tick and changes across the run — proving state is threaded forward, not reset.

## M5 review flow — feedback & evidence completeness (UI)

M5 adds structured reviewer feedback, a read-only evidence timeline, and a
downloadable evidence report separating simulator facts from human review.

### Recording feedback

1. **Run a scenario to a proposal** using any package.
2. In the cockpit area, open the **Proposal Feedback** form — it shows the V1
   review labels (proposal timing, safety impression, intrusiveness,
   understandability, rest-spot suitability, content suitability,
   acceptance/rejection reason, overall judgment) plus a free-text comment and any
   package-defined extra fields.
3. Submit the form.  The feedback is attached to that specific proposal tick and
   appended to the run log immediately — decisions are unchanged.
4. Take your action (Accept rest / Postpone / Decline).
5. When the run completes, the **Run Feedback** form in the right review panel lets
   you record an overall judgment and comment for the run as a whole.

Feedback can also be attached to individual decision ticks via the toggle in the
Decision Trace panel.  Feedback works on any persisted run — including on-disk runs
loaded after a backend restart — and is always evidence-only: it never alters prior
facts, re-runs any algorithm, or feeds back into the decision logic.

### Reviewing a persisted run (evidence timeline)

Open a finished run's log (click **Load** in the RUN LOG panel).  The recorded
events — ticks with decision trace, proposals, actions, algorithm errors, and
feedback — appear as an expandable read-only timeline in the order they occurred.
Feedback events are visually distinct from simulator facts.  No algorithm is
re-run during replay.

### Exporting the evidence

Press **Copy JSON** or **Download** in the evidence panel.  The downloaded file
(`evidence-<run_id>.json`) has two top-level sections:

- **`simulator_facts`** — route snapshot, route facts, frozen event plan, setup
  parameters and hyperparameters, driver and vehicle profiles, the full event
  timeline (ticks, proposals, actions, algorithm errors), decision trace, and
  proposal events.  No feedback values appear anywhere in this section.
- **`human_review`** — the structured review labels and free-text comments keyed
  by their targets (proposal, run, decision, or action).

The report carries enough to reproduce the run (package id+version, scenario
id+version, parameters, profiles, event plan, route facts) and never claims the
simulator independently judged the algorithm.

### Backend-only (curl — M5)

```bash
B=http://localhost:8137
RID=<run_id>   # from a completed run

# Get the effective feedback schema for a run
curl -s $B/api/runs/$RID/feedback-schema

# Record proposal feedback (after ticking to a REST_PROPOSAL)
curl -s -XPOST $B/api/runs/$RID/feedback \
  -H 'content-type: application/json' \
  -d '{"target":{"scope":"proposal","tick_index":5},"labels":{"proposal_timing":"appropriate","safety_impression":"safe"},"comment":"Felt natural"}'

# Record end-of-run feedback
curl -s -XPOST $B/api/runs/$RID/feedback \
  -H 'content-type: application/json' \
  -d '{"target":{"scope":"run"},"labels":{"overall_judgment":"good_trigger"},"comment":"Timely trigger"}'

# Export the §14.2 evidence report (simulator_facts / human_review)
curl -s $B/api/runs/$RID/evidence | python3 -m json.tool
```

Feedback also works on older on-disk runs (after a restart): the backend loads
the file, appends the event, and re-persists atomically.

### What is NOT in M5

| Feature | Deferred to |
|---------|-------------|
| Markdown evidence export | M6 |
| Visual scrubbable replay | M6 |
| UI language selector (`ui_language`) | M6 |
| Feedback edit / delete | post-M5 |
| Cross-run feedback analytics | post-M5 |
| Setup-change / comparison feedback scopes | post-M5 |
| Expert-override events | post-M3 |

> **No new dependencies in M5:** feedback and evidence use only the existing
> FastAPI + Pydantic stack.

## M4 review flow — Google Maps route surface (UI)

1. **Enter your Google Maps API key** in the route panel (held in browser memory only —
   never sent to the backend's persistent storage, never written to any log).  Add a
   **start** and **end** (free-text addresses or place names).
2. **Request route** → up to **three alternatives** appear, each with its derived route
   facts (distance, duration, segment types, rest-stop positions from Google Places).
   Pick one.  If Directions fails, an error is shown with **Retry** and
   **Use local route** options — a run cannot start without route facts.
3. **Select a package + scenario**, generate the plan, and press **Start**.  The car /
   progress / decision markers follow the real route; the trace is identical in structure
   to local runs.
4. When the rest proposal fires, press **Accept rest** or **Postpone**.
5. In the **RUN LOG** the persisted evidence shows `route_source: "maps"`, the
   `display_route` snapshot (encoded polyline for replay), bounded route facts — and
   **no API key anywhere**.

### Failure modes

- **Directions failure** → structured 502 error; the UI offers Retry and Use local route.
  A run cannot start without route facts.
- **No rest stops found** → no fabrication; the run continues and the rest trigger yields
  a non-actionable `NO_PRACTICAL_ACTION_FALLBACK` alert.
- **Rest-stop lookup fails** → the scenario's local rest pattern is scaled onto the Maps
  route distance and a visible **degraded-data** notice appears on the alternative.  If
  the scenario has no local rest pattern either, a **rest-data-unavailable** notice
  replaces it.

### Without a key (local fallback)

Skip the key field entirely: the simulator uses the existing deterministic local route
(`route_source: "local"`); everything works exactly as before.

### Key-safety and the two-layer boundary

The API key is a **request-scoped** parameter only — it reaches the backend in a single
POST body, is used to call Google APIs, and is immediately discarded.  It is never
stored in memory between requests, never written to disk, and never echoed in any
response or error body.

Route quantities from Google (raw distances, durations, encoded polyline) are bounded
before they reach the decision logic: distances and durations become ordinal bands (the
same boundary already used for local routes); the encoded polyline is kept only in the
`display_route` snapshot for frontend rendering and never enters the algorithm context.
No raw Google API value drives a trigger decision.

### Python algorithm errors

A `python_module` package whose `algorithm.py` lacks `evaluate`, raises an
exception, or returns an invalid result shape produces an `algorithm_error` event
in the trace (`missing_evaluate` / `algorithm_exception` / `invalid_result_shape`).
The error is shown in the UI trace and **pauses the run by default** (the run cannot
advance until the user acts), unless the package declares
`"error_mode": "non_blocking"` in its manifest. Errors are never disguised as
normal AICA decisions.

## Backend-only flow (curl)

```bash
B=http://localhost:8137

# List available packages
curl -s $B/api/packages | python3 -c \
  'import sys,json;print([p["id"] for p in json.load(sys.stdin)["packages"]])'

# ── Local route (no key required) ────────────────────────────────────────────

# Analyse local route (returns the single local alternative)
curl -s -XPOST $B/api/routes/analyze \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"uc01_fatigue_friend_drive_v0_1"}'

# ── Google Maps route (BYO key) ───────────────────────────────────────────────

# Analyse with a real key → up to 3 alternatives; key never appears in the response
ALTS=$(curl -s -XPOST $B/api/routes/analyze \
  -H 'content-type: application/json' \
  -d '{"scenario_id":"uc01_fatigue_friend_drive_v0_1",
       "maps_key":"YOUR_KEY_HERE",
       "start":"San Francisco, CA","end":"Sacramento, CA"}')
echo $ALTS | python3 -m json.tool  # inspect alternatives; key is absent

# Pick the first alternative and extract the fields needed by run-plans
ROUTE_ID=$(echo $ALTS | python3 -c \
  'import sys,json;d=json.load(sys.stdin);print(d["alternatives"][0]["route_id"])')
ROUTE_FACTS=$(echo $ALTS | python3 -c \
  'import sys,json;d=json.load(sys.stdin);print(json.dumps(d["alternatives"][0]["route_facts"]))')
DISPLAY=$(echo $ALTS | python3 -c \
  'import sys,json;d=json.load(sys.stdin);print(json.dumps(d["alternatives"][0]["display"]))')

# Create a draft run plan from the chosen maps alternative
PLAN=$(curl -s -XPOST $B/api/run-plans \
  -H 'content-type: application/json' \
  -d "{\"package_id\":\"aica_transparent_hybrid_trigger_v1\",
       \"scenario_id\":\"uc01_fatigue_friend_drive_v0_1\",
       \"route_id\":\"$ROUTE_ID\",\"route_source\":\"maps\",
       \"route_facts\":$ROUTE_FACTS,\"display_route\":$DISPLAY,
       \"parameters\":{},\"hyperparameters\":{},\"run_mode\":\"standard\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["plan_id"])')

# Create a run from the plan
RID=$(curl -s -XPOST $B/api/runs \
  -H 'content-type: application/json' \
  -d "{\"plan_id\":\"$PLAN\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')

# Tick until "paused": true
curl -s -XPOST $B/api/runs/$RID/tick

# Act on the proposal (accept_rest | postpone)
curl -s -XPOST $B/api/runs/$RID/actions \
  -H 'content-type: application/json' -d '{"action":"accept_rest"}'

# Read the full persisted evidence — route_source, display_route, and no key
curl -s $B/api/runs/$RID/log | python3 -m json.tool | grep -E '"route_source"|"encoded_polyline"'

# The file is also at:
ls runs/   # <run_id>.json
```

## Running the tests

Backend (pytest, via uv):

```bash
cd app/api && uv run pytest
```

This covers: tick engine, weighted-score algorithm, declarative-rule algorithm,
run-plan draft flow, all five pairings (rule-based + weighted-score × friend-drive
+ overtime, plus hybrid × friend-drive) via the plan_id flow, proposal strength
(gentle/clear, not strong), decline-with-no-pending → 409, full evidence persistence,
the `python_module` adapter (missing_evaluate / algorithm_exception /
invalid_result_shape error matrix), the transparent hybrid (smoothing, persistence,
state machines, fire-control, priority, determinism, runtime-state threading), the
M3 HTTP e2e (analyze → run-plans → runs → tick-loop → actions → log with evolving
per-tick `package_runtime_state`), M4 Maps coverage (maps_client Directions + Places
mocked at `_urlopen` — **no live network**, key-safety guard, numeric boundary,
rest empty/failure/degraded handling, Maps determinism, replay-no-refetch, and the
full mocked-maps e2e), and M5 feedback + evidence coverage: feedback schema (GET,
active + disk runs), feedback POST validation matrix (all scopes, event_ref
resolution, invalid key → 400, nothing appended), evidence §14.2 shape and
separation invariant (feedback absent from `simulator_facts`, present only under
`human_review`), and the full M5 HTTP e2e (tick to proposal → proposal feedback →
accept → run feedback → log trace-unchanged assertion → invalid POST idempotency →
evidence report with reproducibility fields verified).

Frontend (Vitest):

```bash
cd app/frontend && npm test
```

This covers: package/scenario selectors, parameter/hyperparameter editors,
plan preview, playback controls, cockpit proposal overlay, decline button
availability, route timeline, trace panel (incl. M3 state labels and runtime-state
indicator), run store, error display, M4 MapSurface (markers from tick progress,
key held in memory only), M5 FeedbackForm (all field types, submit, success +
validation-error display, no-runId guard, wired into cockpit/trace/review panels),
and EvidencePanel (copy JSON, download blob, separation scan, no-runId guard).

## M5 — what is NOT here yet

| Feature | Deferred to |
|---------|-------------|
| Markdown evidence export | M6 |
| Visual scrubbable replay | M6 |
| UI language selector (`ui_language`) | M6 |
| Feedback edit / delete | post-M5 |
| Cross-run feedback analytics | post-M5 |
| Setup-change / comparison feedback scopes | post-M5 |
| Route drawing / editing / saving | post-M4 |
| Saved / named routes (multi-key, multiple stored routes) | post-M4 |
| Offline map tiles (no-network mode for the map view) | post-M4 |
| Static Maps image path (screenshot-style route preview) | post-M4 |
| Full monotony-prevention UX scenario | M8 |
| Untrusted-upload sandboxing for `python_module` packages | post-M3 |
| `expert_override` mode | post-M3 |
| Run comparison | post-M3 |

> **No new dependencies in M4 or M5:** the Maps surface uses only stdlib `urllib`
> (already used by maps_client); feedback and evidence use only the existing FastAPI
> + Pydantic stack.  No Google Maps SDK or third-party HTTP client was added.

> **Local-trusted-code note:** `python_module` packages run in the same process as
> the backend with no sandboxing. Only use packages you trust. The AICA Hypothesis
> Simulator is a local, single-user development tool — not a multi-tenant or
> production system.

## Project layout

```
app/api/         FastAPI backend (aica_api package; tick engine, registries, evidence)
app/frontend/    React + TypeScript + Vite (3-panel UI)
packages/        hypothesis packages
  rest_rule_based_v0_1/               declarative_rule algorithm
  rest_weighted_score_v0_1/           weighted_score algorithm
  rest_python_v0_1/                   python_module parity package (M3)
  aica_transparent_hybrid_trigger_v1/ stateful transparent hybrid (M3)
scenarios/       driving scenarios   (uc01_fatigue_friend_drive_v0_1.json, uc01_overtime_driver_v0_1.json)
runs/            persisted run evidence — written at runtime, gitignored
docker-compose.yml, Dockerfile.api, Dockerfile.frontend
docs/master/     authoritative specification, architecture, and milestone plan
specs/           Spec Kit feature specs
```

See `docs/master/` for the full specification, architecture, and milestone plan.
