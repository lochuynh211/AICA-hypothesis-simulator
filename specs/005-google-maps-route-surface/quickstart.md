# Quickstart: M4 Google Maps Route Surface

## Start
```bash
docker compose up        # api :8137, frontend :5180
```
Open `http://localhost:5180`.

## Review over a real Google Maps route (UI)
1. Enter your **Google Maps key** (held in memory only — never saved) + a **start** and
   **end** (free-text place names/addresses).
2. The interactive Google map loads; request a route → up to **3 alternatives** appear,
   each with its derived route facts (distance, segment types, rest stops). Pick one.
3. Select a UC-01 package + scenario, generate the plan, start, and play. The car /
   progress / decision markers move along the **real** route; the trace is as before.
4. Reach a rest proposal → realistic rest stops (highway service area, else nearby
   convenience store). Inspect the persisted evidence: `route_source: "maps"`, a display
   route snapshot, bounded route facts — and **no key anywhere**.

## Without a key (local fallback)
Skip the key: the simulator uses the existing deterministic local route
(`route_source: "local"`); everything works exactly as before, no map required.

## Failure behavior
- Route service fails → error shown, **retry** + **use local route** offered; a run can't
  start without route facts.
- No rest stops found on a route → no fabrication; the rest trigger yields a non-actionable
  `NO_PRACTICAL_ACTION_FALLBACK` alert and the drive continues.
- Rest-stop lookup fails → falls back to the scenario's local rest pattern with a visible
  **degraded-data** notice.

## Backend-only (curl, mocked Maps in tests)
```bash
B=http://localhost:8137
# analyze with a key returns alternatives; without a key returns the local route.
# select route_id -> run-plans -> runs -> tick -> log. The key never appears in the log.
```

## Tests
```bash
cd app/api && uv run pytest    # maps_client (mocked), route_analysis maps path,
                               # key-safety guard, numeric boundary, determinism, fallback, e2e
cd app/frontend && npm test    # MapSurface markers from tick progress; key stays in-memory
```

## Not in M4
Route editing/drawing, saved routes, multi-key, offline tiles, Static-Maps path,
structured feedback (M5).
