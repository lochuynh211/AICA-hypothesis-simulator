# Quickstart: M3 Python Algorithm Support

## Start
```bash
docker compose up        # api :8137, frontend :5180
```
Open `http://localhost:5180`.

## Run the transparent hybrid (UI)
1. Select package **aica_transparent_hybrid_trigger_v1** and a UC-01 rest scenario.
2. (Optionally edit hyperparameters.) Generate plan → Start → play/step.
3. The trace shows, per tick: features, category scores, **state labels**
   (rest/monotony), candidates (incl. suppressed), fire-control, and a compact
   **runtime-state indicator** (smoothed scores + persistence counters) — watch them
   evolve across ticks.
4. Reach the rest proposal → act → inspect the persisted evidence (the per-tick
   `package_runtime_state` is non-empty and changes over the run).

## Backend-only (curl)
```bash
B=http://localhost:8137
curl -s $B/api/packages | python3 -c 'import sys,json;print([p["id"] for p in json.load(sys.stdin)["packages"]])'
# -> includes rest_python_v0_1 and aica_transparent_hybrid_trigger_v1
# then: routes/analyze -> run-plans (package_id=aica_transparent_hybrid_trigger_v1) -> runs{plan_id} -> tick -> log
```

## Python errors are evidence (paused by default)
A package whose `algorithm.py` lacks `evaluate`, raises, or returns junk → the tick
records an `algorithm_error` (missing_evaluate / algorithm_exception /
invalid_result_shape), shows it in the trace, and **pauses the run** (unless the
package declares `error_mode: non_blocking`). Never a fabricated decision.

## Tests
```bash
cd app/api && uv run pytest        # python_module adapter, rest_python parity, hybrid, error matrix
cd app/frontend && npm test        # trace state labels + runtime-state indicator
```

## Not in M3
Google Maps (M4), structured feedback + evidence replay (M5), expert_override,
untrusted-upload sandboxing, full monotony-prevention UX scenario (M8).
