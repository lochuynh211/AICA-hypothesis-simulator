# Quickstart — Signal-Tier Re-design

## Run

```bash
docker compose up            # backend (app/api) + frontend (app/frontend)
# open the app → Setup screen
```

## Verify the feature end-to-end

**Setup screen (US1, US2)**
1. Pick a location/preset → the left **Scenario & Signals** panel lists signals grouped as
   **Fixed / Dynamic / Simulated**; read-only signals are muted; each Simulated signal has an ⓘ popover
   explaining its formulation.
2. The right **Algorithm** panel shows the algorithm as its formulation; hyperparameters are the editable
   `[coefficients]` inside the formulas; feature names link to their signal on the left.
3. Edit a weight (e.g. `w_drowsiness`) → the bottom **Instant Result** strip recomputes and the fire
   marker slides; try a value that suppresses firing → strip shows **"no trigger"** with peak vs threshold.
4. Click **Open full run** → the animated review opens with the identical config; `runs/` now has one new run.

**Reproducibility (US3)**
```bash
# same setup + same seed → identical trace
curl -s localhost:8000/runs/preview -d '{"package_id":"aica_transparent_hybrid_trigger_v1","scenario_id":"uc01_fatigue_recovery_v0_1","run_seed":42}' > a.json
curl -s localhost:8000/runs/preview -d '{"package_id":"aica_transparent_hybrid_trigger_v1","scenario_id":"uc01_fatigue_recovery_v0_1","run_seed":42}' > b.json
diff a.json b.json && echo "IDENTICAL"       # expect IDENTICAL
```
Confirm `runs/` file count is unchanged after `/preview` calls (ephemeral, FR-014a).

**Two algorithms, one contract (US4)**
Run Hybrid and NRI on the same scenario; both draw from the same tiered signal set; NRI's `S_realtime`
is non-zero (drowsiness/fatigue present).

## Backend tests

```bash
cd app/api && pytest tests/ -q
# key new/updated suites:
#  - anomaly generator determinism (contracts/anomaly-generator.md)
#  - tiered context shape + removed keys absent
#  - compact Hybrid features/scores; NRI live realtime term
#  - ephemeral /preview: no persistence, faithful to /runs, deterministic, errors surfaced
#  - scenario loader rejects old-shape files
#  - manifest single-source-of-defaults (no un-defaulted context access)
```

## Frontend tests

```bash
cd app/frontend && npm test
#  - Signals panel groups by tier; read-only vs editable; info popover content
#  - Algorithm formulation renders formulas with inline editable coefficients + signal cross-links
#  - Instant-result strip: score curve + threshold, fire marker, "no trigger" state, overrides chip
```

## Regenerated baselines

This is a **deliberately behavior-changing** re-design (FR-018). Backend behavioral baselines are
regenerated intentionally; the htmlapp parity fixtures are **not** touched here (htmlapp deferred, FR-020).
