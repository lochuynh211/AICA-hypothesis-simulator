# Quickstart: Proposal Preset Test-Cases

How to build, run, and verify feature 018.

## Prerequisites
- Repo on branch `018-proposal-preset-testcases`.
- Backend venv at `app/api` (uv). Frontend deps installed in `app/frontend`.

## Generate the presets (source → committed JSON)
Presets are generated, never hand-edited (like seeds):
```bash
cd app/api && uv run python ../../scripts/generate_presets.py
# writes ~18 files to proposal_contracts/presets/preset-*.json + README.md
# idempotent: same author-specs + same frozen catalog => byte-identical output
```
To change a preset: edit its compact author-spec in `scripts/generate_presets.py`, re-run, review the diff, commit.

## Run the verification harness (the test-case guarantee)
```bash
cd app/api && uv run pytest tests/proposal/test_presets_expectations.py -q
# runs BOTH selectors through the production dispatch path for every preset,
# asserts each expectation contract + contrast-pair divergence,
# and writes docs/master/proposal_preset_analysis.md (expected vs real, pass/fail)
```
Green ⇒ every shipped preset behaves as its brief claims (SC-001). If a preset fails, tune its world / per-preset override in the author-spec, regenerate, re-run.

## Run the full backend + retune tests
```bash
cd app/api && uv run pytest tests/proposal -q
# includes: test_preset_store, test_ep_presets, test_preset_generation (golden),
# test_config_override_merge, test_norm_bounds_retune, and the updated content math tests
```
`test_norm_bounds_retune.py` asserts the recalibrated loudness bounds match the frozen catalog and that arousal separation widened vs. the pre-retune baseline (SC-006). `test_p5_service_math.py` should remain unchanged.

## Run the app and drive a preset
```bash
docker compose up   # or the project's frontend/back dev command
# open the proposal screen (default mode)
```
1. In the left World panel, the new **Preset** selector sits above the Seed section.
2. Pick e.g. *"Monotone highway — energize"*; confirm: the situation + driver profile both change in one action, the bilingual brief appears, and both the service and content panels re-rank.
3. Confirm each candidate shows a raw score **and** a 0–100 fit band `(raw+1)×50`.
4. Pick its contrast partner *"Late-night — wind-down"*; confirm the #1 content track changes.
5. Record a run; confirm the run log's setup provenance names the preset (`origin_preset_id`).

## Frontend unit tests
```bash
cd app/frontend && npx vitest run
# includes fitBand() helper test and PresetPicker / LOAD_PRESET reducer tests
```

## Acceptance mapping
- US1 → steps 1–3; `test_ep_presets`, `LOAD_PRESET` reducer test.
- US2 → step 4; `test_presets_expectations` contrast assertions.
- US3 → verification harness + `proposal_preset_analysis.md`.
- US4 → step 3; `test_norm_bounds_retune`, `fitBand` test.
