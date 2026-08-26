# UC-05-01 Forecast-Jam Demo & Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purpose-built master preset UC-05-01 ("forecast-trigger early rest before a heavy jam", Ms. C) plus a calibration harness that proves the forecast ("new") vs non-forecast ("old") timing divergence and confirms the untouched htmlapp reproduces the old behavior tick-for-tick.

**Architecture:** Clone the four UC-01-01 artifacts (route/scenario/profile/master-preset), retarget the route to a real Minatomirai→Gotemba highway maps fetch, calibrate a position-native jam into a rest-spot gap. Old vs new is a **per-run hyperparameter set** (`NEW {threshold_forecast_rest:80, rest_spot_eta_filter_min:30}` vs `OLD {100, 90}`) applied programmatically by the harness — never baked into the preset (which carries no hyperparameters). The harness is both the calibration oracle and the source of the htmlapp OLD-side parity golden. htmlapp gets the data + catalog entry only; its algorithm stays byte-identical.

**Tech Stack:** Python 3.12 (FastAPI backend, pytest), TypeScript/React (Vite, vitest), Google Maps Directions+Places (BYO key, user-run), file-based JSON contracts.

**Spec:** `docs/superpowers/specs/2026-08-25-uc05-01-forecast-jam-demo-design.md`

## Global Constraints

- **No-commit rule IN FORCE.** Do NOT run `git add`, `git commit`, `git stash`, or delete the workspace. Every task ends at a **verify checkpoint**, not a commit. All work stays in the working tree until the user explicitly authorizes a commit.
- **No algorithm changes.** Do NOT modify `packages/nri_fatigue_score_v1/algorithm.py`, its manifest defaults, or any `app/api/aica_api/algorithms/**`. NRI manifest defaults stay `threshold_forecast_rest=80.0`, `rest_spot_eta_filter_min=30.0`, `threshold_fire=100.0`, `threshold_monotony=60.0`.
- **htmlapp algorithm is byte-untouched.** No forecast code enters `htmlapp/**`. Only data (`htmlapp/frontend/data/**`, rebuilt `aica-data.json`/`aica-data.js`), `htmlapp/frontend/src/lib/review/caseCatalog.ts`, and `htmlapp/frontend/tests/case_catalog_order.test.ts` may change. Do NOT change htmlapp's shared NRI manifest default for `rest_spot_eta_filter_min`.
- **BYO-key invariant.** The Google Maps key is entered at runtime by the user only; it is NEVER shipped, persisted, logged, printed, or committed. Only the baked route JSON (no key) is written to disk.
- **Old vs new hyperparameter sets (verbatim):** NEW `{"threshold_forecast_rest": 80.0, "rest_spot_eta_filter_min": 30.0}`; OLD `{"threshold_forecast_rest": 100.0, "rest_spot_eta_filter_min": 90.0}`.
- **Test runner (Docker is BROKEN — do not use it):**
  - Backend: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider <node> -v` (Anaconda Python 3.12.7).
  - App frontend: `cd app/frontend && npm test`. htmlapp frontend: `cd htmlapp/frontend && npm test`.
- **Case ids are immutable** and the combined-test-case schema is strict (`additionalProperties:false`): do not add fields to case JSON. Visibility/order live only in `caseCatalog.ts`.
- **UC-05-01 catalog sort position:** append LAST, after `case-uc04-01-longhaul-d` (both app and htmlapp), unless the user directs otherwise.

---

### Task 1: Clone the scenario and driver profile

**Files:**
- Create: `scenarios/uc05_01_forecast_jam_v0_1.json`
- Create: `proposal_contracts/presets/preset-uc05-01-forecast-c.json`
- Test: `app/api/tests/test_uc05_01_artifacts.py`

**Interfaces:**
- Produces: scenario id `uc05_01_forecast_jam_v0_1` (type `uc01_fatigue`); preset id `preset-uc05-01-forecast-c`. These ids are consumed by the master preset (Task 3) and the harness (Task 5).

- [ ] **Step 1: Write the failing test** — `app/api/tests/test_uc05_01_artifacts.py`

```python
import json, pathlib
import pytest
from aica_api.models.scenario import ScenarioDef

REPO = pathlib.Path(__file__).resolve().parents[3]

def test_scenario_loads_and_keeps_uc01_type():
    data = json.loads((REPO / "scenarios" / "uc05_01_forecast_jam_v0_1.json").read_text(encoding="utf-8"))
    scn = ScenarioDef(**data)
    assert scn.id == "uc05_01_forecast_jam_v0_1"
    # Keep the uc01_fatigue type so nri_fatigue_score_v1 stays compatible.
    assert scn.type == "uc01_fatigue"
    # A single position-native jam is present (calibrated later in Task 6).
    assert len(scn.presets.traffic_events) == 1

def test_driver_profile_is_ms_c_20s_female():
    data = json.loads((REPO / "proposal_contracts" / "presets" / "preset-uc05-01-forecast-c.json").read_text(encoding="utf-8"))
    assert data["preset_id"] == "preset-uc05-01-forecast-c"
    assert data["world"]["driver_profile"]["age_band"] == "20s"
    assert data["world"]["driver_profile"]["gender"] == "female"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_uc05_01_artifacts.py -v`
Expected: FAIL (files do not exist).

- [ ] **Step 3: Create the scenario clone**

Copy `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json` to `scenarios/uc05_01_forecast_jam_v0_1.json` verbatim, then change ONLY:
- `"id"` → `"uc05_01_forecast_jam_v0_1"`
- `persona.name` → `{"ja": "Cさん 御殿場アウトレットへ", "en": "Ms. C to Gotemba Outlets"}`; `persona.description` → `"uc-05-01"`
- `review_focus` → `"UC-05-01"`
- Leave `presets.traffic_events` as the single existing jam entry (id may stay `jam_yokohane` or rename to `jam_tomei`); its `start_km`/`end_km`/`speed_kph` and `presets.total_route_distance_km` are placeholders **calibrated in Task 6**. Keep `type: "uc01_fatigue"`, `speed_profile`, `driver_signal_params`, `recovery_options`, `tick_seconds`, `run_seed_default` unchanged.

- [ ] **Step 4: Create the driver profile clone**

Copy `proposal_contracts/presets/preset-uc01-01-oshikatsu-c.json` to `proposal_contracts/presets/preset-uc05-01-forecast-c.json` verbatim, then change ONLY:
- `"preset_id"` → `"preset-uc05-01-forecast-c"`
- `label` → `{"ja": "UC-05-01・渋滞前の早期休憩（Cさん）", "en": "UC-05-01 · Early rest before a jam (Ms. C)"}`
- `brief` → a one-line JA/EN description of the forecast-vs-jam story.
- Keep `world.driver_profile` (oshi, usage_by_genre) and `world.situation` unchanged; `situation.road_type` stays `"highway"`. Leave `algorithm_config_overrides: null` (old/new is applied at run time, not here).

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_uc05_01_artifacts.py -v`
Expected: PASS (both tests).

- [ ] **Step 6: Verify checkpoint (NO commit)**

Run the schema/registry suite to confirm the new files don't break loading:
`PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_models.py -v`
Expected: no NEW failures vs baseline. Do NOT commit.

---

### Task 2: Add the route definition and fetch the real maps route (USER-GATED)

**Files:**
- Modify: `scripts/extract_route_presets.py` (the `ROUTES` list, after line 99)
- Create (by the USER running the script): `routes/presets/uc05_01_minatomirai_gotemba.json`

**Interfaces:**
- Produces: route preset id `uc05_01_minatomirai_gotemba` (`route_source: "maps"`) with a real polyline and real SA/PA/道の駅/convenience `places`. Consumed by the master preset (Task 3) and the harness (Task 5).

- [ ] **Step 1: Add the ROUTES entry**

In `scripts/extract_route_presets.py`, add to the `ROUTES` list (after the `uc03_01_funabashi_makuhari` entry, before the "Verification variants" comment block):

```python
    {
        "id": "uc05_01_minatomirai_gotemba",
        "label": {"ja": "みなとみらい→御殿場アウトレット（UC-05-01）", "en": "Minatomirai → Gotemba Outlets (UC-05-01)"},
        "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
        "end": "御殿場プレミアム・アウトレット 静岡県御殿場市深沢1312",
        "avoid": None,
    },
```

- [ ] **Step 2: Static-check the edit**

Run: `python -c "import ast; ast.parse(open('scripts/extract_route_presets.py', encoding='utf-8').read()); print('ok')"`
Expected: prints `ok` (syntax valid). This is the only automatable check — the fetch itself needs the user's key.

- [ ] **Step 3: USER ACTION — run the keyed fetch**

**STOP and hand this to the user** (the executor has no Google key). The user runs, with their key present in `app/frontend/.env.local` as `VITE_GOOGLE_MAPS_KEY=...`:

```bash
python scripts/extract_route_presets.py --only uc05_01_minatomirai_gotemba
```

This writes `routes/presets/uc05_01_minatomirai_gotemba.json` (real polyline + real Tomei SA/PA places). The key is never printed or committed.

- [ ] **Step 4: Verify the baked route exists and has no key**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_uc05_01_artifacts.py -v` after adding this test to the file from Task 1:

```python
def test_route_preset_is_baked_maps_route_with_places():
    p = REPO / "routes" / "presets" / "uc05_01_minatomirai_gotemba.json"
    raw = p.read_text(encoding="utf-8")
    assert "AIza" not in raw and "key=" not in raw  # BYO-key: no key leaked
    data = json.loads(raw)
    assert data["id"] == "uc05_01_minatomirai_gotemba"
    assert data["route_source"] == "maps"
    # Real SA/PA places exist with distances (rest spots the algorithm can use).
    assert any("distance_along_route_m" in pl for pl in data["places"])
```

Expected: PASS once the user has run Step 3. If the route file is absent, this test fails — that is the gate telling you the user step is still pending.

- [ ] **Step 5: Verify checkpoint (NO commit)** — Do NOT commit. Note in the ledger that the route was fetched by the user.

---

### Task 3: Create the UC-05-01 master preset

**Files:**
- Create: `combined_contracts/test_cases/case-uc05-01-forecast-jam-c.json`
- Test: extend `app/api/tests/test_uc05_01_artifacts.py`

**Interfaces:**
- Consumes: scenario `uc05_01_forecast_jam_v0_1`, route `uc05_01_minatomirai_gotemba`, profile `preset-uc05-01-forecast-c` (Tasks 1–2).
- Produces: case id `case-uc05-01-forecast-jam-c`. Consumed by the catalog (Tasks 4, 8).

- [ ] **Step 1: Write the failing test** — add to `app/api/tests/test_uc05_01_artifacts.py`

```python
def test_master_preset_bundles_the_three_refs_and_nri_trigger():
    data = json.loads((REPO / "combined_contracts" / "test_cases" / "case-uc05-01-forecast-jam-c.json").read_text(encoding="utf-8"))
    assert data["case_id"] == "case-uc05-01-forecast-jam-c"
    assert data["journey"]["scenario_ref"] == "uc05_01_forecast_jam_v0_1"
    assert data["journey"]["route_preset_ref"] == "uc05_01_minatomirai_gotemba"
    assert data["persona"]["profile_ref"] == "preset-uc05-01-forecast-c"
    assert data["algorithm_defaults"]["trigger"] == "nri_fatigue_score_v1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_uc05_01_artifacts.py::test_master_preset_bundles_the_three_refs_and_nri_trigger -v`
Expected: FAIL (file missing).

- [ ] **Step 3: Create the master preset**

Copy `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` verbatim, then change:
- `case_id` → `case-uc05-01-forecast-jam-c`
- `title` → `{"ja": "UC-05-01 渋滞前の早期休憩提案（Cさん・20代前半女性）", "en": "UC-05-01 Early rest before a heavy jam (Ms. C, early-20s woman)"}`
- `brief`, `what_to_watch` → JA/EN text describing: forecast fires early before the jam while a pre-jam SA is reachable; the old algorithm fires late pointing at a spot ~60 min away.
- `persona.persona_id` → `persona-forecast-c`; `persona.profile_ref` → `preset-uc05-01-forecast-c`; keep the Ms. C narrative.
- `journey.scenario_ref` → `uc05_01_forecast_jam_v0_1`; `journey.route_preset_ref` → `uc05_01_minatomirai_gotemba`.
- `journey.fixed_overrides.initial_drowsiness`/`initial_fatigue` — start from `65`/`75` (UC-01-01 values); these are **calibration knobs adjusted in Task 6**. Keep `is_night:false`, `child_passenger:false`.
- Keep `algorithm_defaults` (`nri_fatigue_score_v1`, `aica_transparent_service_selector_v1`, `aica_transparent_content_selector_v1`) and `automatic_path` (`accept`) unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_uc05_01_artifacts.py -v`
Expected: PASS (all Task-1/2/3 tests).

- [ ] **Step 5: Verify checkpoint (NO commit)**

Run the combined-test-case schema validation (find the existing validator — likely `app/api/tests/test_combined_test_cases.py` or similar; grep for `combined_test_case.schema`):
`PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider -k "combined and (schema or test_case)" -v`
Expected: the new case validates against the strict schema. Do NOT commit.

---

### Task 4: Wire UC-05-01 into the app case catalog (4 → 5)

**Files:**
- Modify: `app/frontend/src/lib/review/caseCatalog.ts:85-90` (`VISIBLE_CASE_ORDER`)
- Modify: `app/frontend/tests/case_catalog_order.test.ts:15-25`

**Interfaces:**
- Consumes: case id `case-uc05-01-forecast-jam-c` (Task 3).
- Produces: `listCases()` returns 5 cases ending with UC-05-01.

- [ ] **Step 1: Update the order test first (failing)** — `app/frontend/tests/case_catalog_order.test.ts`

Change `UC_ORDER` and the description to five, appending UC-05-01:

```typescript
  const UC_ORDER = [
    'case-uc01-01-oshikatsu-c',
    'case-uc01-02-commuter-b',
    'case-uc03-01-monotony-a',
    'case-uc04-01-longhaul-d',
    'case-uc05-01-forecast-jam-c',
  ]

  it('lists EXACTLY the five UC demo cases, in the fixed sequence', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toEqual(UC_ORDER)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app/frontend && npm test -- case_catalog_order`
Expected: FAIL (`listCases()` still returns four; UC-05-01 not visible).

- [ ] **Step 3: Add UC-05-01 to the comparator** — `app/frontend/src/lib/review/caseCatalog.ts`

```typescript
const VISIBLE_CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
  'case-uc05-01-forecast-jam-c',
]
```

Update the comment above it (currently says "four UC demo cases") to "five".

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npm test -- case_catalog_order`
Expected: PASS (five cases in order; hidden-C-case assertions still pass).

- [ ] **Step 5: Verify checkpoint (NO commit)**

Run: `cd app/frontend && npm test` — confirm no new failures elsewhere. Do NOT commit.

---

### Task 5: Build the calibration harness (Part A — forecast on/off oracle)

**Files:**
- Create: `scripts/calibrate_forecast_demo.py`
- Test: `app/api/tests/test_calibrate_forecast_demo.py`

**Interfaces:**
- Consumes: the three UC-05-01 artifacts + baked route (Tasks 1–3).
- Produces: `run_uc05_01(hyperparameter_overrides: dict) -> list[TickRow]` where `TickRow` is a dict with keys `tick_index:int`, `elapsed_min:float`, `distance_km:float`, `rest_state:str|None` (the decision's `states.rest`), `fire_reason:str|None`, `proposed_spot_eta_min:float|None`. And `assert_divergence(new_rows, old_rows) -> None` (raises AssertionError with a readable message if the §2 invariants fail). Consumed by Task 6 (calibration) and Task 7 (golden capture).

**Implementation guidance:** model the tick loop on the existing in-process drivers — read `app/api/tests/test_forecast_parity.py` and `app/api/tests/test_run_manager_forecast.py` for the idiom that loads a scenario + route preset, builds the run plan, and ticks `run_manager` with a fixed seed and an `_choose_action` mirror. Reuse that machinery rather than reimplementing the tick engine. Pass `hyperparameter_overrides` into the same path the setup panel uses to override package hyperparameters.

- [ ] **Step 1: Write the failing test** — `app/api/tests/test_calibrate_forecast_demo.py`

```python
import importlib
import pytest

demo = importlib.import_module("scripts.calibrate_forecast_demo")  # ensure scripts/ is importable; else adjust sys.path in the test

NEW = {"threshold_forecast_rest": 80.0, "rest_spot_eta_filter_min": 30.0}
OLD = {"threshold_forecast_rest": 100.0, "rest_spot_eta_filter_min": 90.0}

def test_run_returns_tickrows_with_required_keys():
    rows = demo.run_uc05_01(NEW)
    assert rows, "expected a non-empty tick trace"
    r = rows[0]
    for key in ("tick_index", "elapsed_min", "distance_km", "rest_state", "fire_reason", "proposed_spot_eta_min"):
        assert key in r

def test_new_fires_forecast_and_old_fires_ordinary_late():
    new_rows = demo.run_uc05_01(NEW)
    old_rows = demo.run_uc05_01(OLD)
    new_fire = next((r for r in new_rows if r["rest_state"] == "REST_FORECAST_FIRE"), None)
    old_fire = next((r for r in old_rows if r["rest_state"] and r["rest_state"] != "REST_FORECAST_FIRE" and r["fire_reason"]), None)
    assert new_fire is not None, "NEW must produce a REST_FORECAST_FIRE"
    assert old_fire is not None, "OLD must produce an ordinary rest fire"
    # NEW fires strictly earlier than OLD (the whole point of the demo).
    assert new_fire["elapsed_min"] < old_fire["elapsed_min"]
    # OLD's proposed spot is far (~60 min); NEW's is reachable (<= its filter).
    assert old_fire["proposed_spot_eta_min"] is not None and old_fire["proposed_spot_eta_min"] > 30.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_calibrate_forecast_demo.py -v`
Expected: FAIL (module missing). NOTE: the two behavioral assertions may still fail after Step 3 until the jam is calibrated (Task 6) — that is expected; Step 4 only requires the harness to RUN and return well-formed rows.

- [ ] **Step 3: Implement the harness**

Create `scripts/calibrate_forecast_demo.py` with:
- `run_uc05_01(hyperparameter_overrides)` — loads `uc05_01_forecast_jam_v0_1` + `uc05_01_minatomirai_gotemba` + `preset-uc05-01-forecast-c`, builds the run plan with seed from the scenario default, applies `hyperparameter_overrides` to the NRI package hyperparameters, ticks to completion, and returns the `TickRow` list. For each tick, read the decision's `states.rest`, `fire_control.reason`, and the proposed rest spot's ETA (from the decision/evidence — mirror how `test_run_manager_forecast.py` reads the forecast block).
- `assert_divergence(new_rows, old_rows)` — encodes the two behavioral assertions from Step 1's `test_new_fires_forecast_and_old_fires_ordinary_late`.
- A `__main__` block: run NEW and OLD, print a compact side-by-side table (tick, min, km, rest_state, reason, spot ETA) for both, then call `assert_divergence` and print PASS/FAIL. Accept `--assert` to exit non-zero on failure (for Task 6's calibration loop).

- [ ] **Step 4: Run test to verify the harness runs and returns well-formed rows**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_calibrate_forecast_demo.py::test_run_returns_tickrows_with_required_keys -v`
Expected: PASS. (The behavioral test may still fail pending calibration — that is Task 6.)

- [ ] **Step 5: Verify checkpoint (NO commit)** — Do NOT commit.

---

### Task 6: Calibrate the jam so the divergence holds (empirical)

**Files:**
- Modify: `scenarios/uc05_01_forecast_jam_v0_1.json` (`presets.traffic_events[0].start_km`/`end_km`/`speed_kph`, `presets.total_route_distance_km`)
- Modify: `combined_contracts/test_cases/case-uc05-01-forecast-jam-c.json` (`journey.fixed_overrides.initial_drowsiness`/`initial_fatigue`)

**Interfaces:**
- Consumes: harness (Task 5), baked route places (Task 2).
- Produces: calibrated data such that `test_new_fires_forecast_and_old_fires_ordinary_late` passes.

- [ ] **Step 1: Inspect the real rest-spot layout**

Run the harness `__main__` (NEW) and note where along the route (km) the real SA/PA places sit and where the score enters the `(80,100)` band. Identify a rest-spot GAP where: a pre-jam SA is ≤30 min out while the score is in-band, and by the score-100 crossing the next spot is ~60 min out through the jam.

Run: `PYTHONPATH=app/api python scripts/calibrate_forecast_demo.py`

- [ ] **Step 2: Set the jam into that gap**

Edit `scenarios/uc05_01_forecast_jam_v0_1.json`: set `traffic_events[0].start_km`/`end_km` to place the 10 kph crawl in the gap so the post-jam spot is ~60 min away at the crossing; set `total_route_distance_km` to the real route distance (from the baked route's `raw_route.distance_m / 1000`). Adjust `initial_drowsiness`/`initial_fatigue` in the master preset if the band lands in the wrong place.

- [ ] **Step 3: Re-run the harness assertion until it passes**

Run: `PYTHONPATH=app/api python scripts/calibrate_forecast_demo.py --assert`
Expected: exit 0 and print PASS. Iterate Steps 2–3 (jam km/speed, then initial state) until it does. If no real gap yields a clean ~60-min divergence, widen the jam or shift initial state; if still impossible, STOP and report to the user (documented calibration risk in the spec §5).

- [ ] **Step 4: Lock the calibration with the behavioral test**

Run: `PYTHONPATH=app/api python -W ignore -m pytest -p no:cacheprovider app/api/tests/test_calibrate_forecast_demo.py -v`
Expected: PASS (both harness tests, including `test_new_fires_forecast_and_old_fires_ordinary_late`).

- [ ] **Step 5: Verify checkpoint (NO commit)** — record the final jam + initial-state values in the ledger. Do NOT commit.

---

### Task 7: Capture the OLD-side parity golden and add the htmlapp parity test (Part B)

**Files:**
- Modify: `htmlapp/frontend/scripts/gen/capture_all.py` (add a UC-05-01 OLD-params capture)
- Create: `htmlapp/frontend/src/engine/__fixtures__/parity/uc05_01_old_tick_by_tick.json` (generated)
- Create: `htmlapp/frontend/tests/uc05_01_old_parity.test.ts`

**Interfaces:**
- Consumes: calibrated UC-05-01 data (Task 6), OLD hyperparameters.
- Produces: a golden the htmlapp TS engine must reproduce under OLD hyperparameters.

- [ ] **Step 1: Extend the capture to emit the OLD golden**

In `htmlapp/frontend/scripts/gen/capture_all.py`, follow the existing `nri_tick_by_tick.json` capture idiom to add a UC-05-01 capture that runs the Python app on the UC-05-01 artifacts with OLD hyperparameters (`{threshold_forecast_rest:100, rest_spot_eta_filter_min:90}`) and writes per-tick `decision_result` to `uc05_01_old_tick_by_tick.json`. Reuse `scripts/calibrate_forecast_demo.run_uc05_01(OLD)` if convenient, but emit in the SAME fixture shape the existing parity fixtures use.

- [ ] **Step 2: Regenerate the golden**

Run: `PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_all.py`
Expected: `uc05_01_old_tick_by_tick.json` written with a non-empty per-tick trace containing an ordinary rest fire (NOT `REST_FORECAST_FIRE` — htmlapp has no forecast).

- [ ] **Step 3: Write the htmlapp parity test** — `htmlapp/frontend/tests/uc05_01_old_parity.test.ts`

Mirror the existing NRI tick-by-tick parity test (find it via `grep -rl nri_tick_by_tick htmlapp/frontend/tests`). Load `uc05_01_old_tick_by_tick.json`, drive htmlapp's TS engine over the UC-05-01 inputs with the OLD hyperparameters, and assert tick-for-tick equality of `states.rest` and `fire_control.reason`. Include a non-vacuous guard: assert the golden's fire list is non-empty before comparing, and assert no tick is `REST_FORECAST_FIRE`.

- [ ] **Step 4: Run the parity test**

Run: `cd htmlapp/frontend && npm test -- uc05_01_old_parity`
Expected: PASS — htmlapp reproduces Python-OLD tick-for-tick.

- [ ] **Step 5: Verify checkpoint (NO commit)** — Do NOT commit.

---

### Task 8: Mirror UC-05-01 data into htmlapp and wire its catalog (4 → 5)

**Files:**
- Copy into: `htmlapp/frontend/data/**` (the four UC-05-01 artifacts, in htmlapp's baked layout)
- Modify: `htmlapp/frontend/src/lib/review/caseCatalog.ts` (`VISIBLE_CASE_ORDER`)
- Modify: `htmlapp/frontend/tests/case_catalog_order.test.ts`
- Regenerate: `htmlapp/frontend/data/aica-data.json`, `htmlapp/frontend/public/aica-data.js`

**Interfaces:**
- Consumes: calibrated UC-05-01 artifacts (Task 6).
- Produces: UC-05-01 clickable in htmlapp; five-case catalog.

- [ ] **Step 1: Copy the artifacts into htmlapp's data layout**

Use the existing htmlapp sync path — inspect `htmlapp/frontend/scripts/*sync*` / `build-data.mjs` / `data.manifest.mjs` to learn where scenarios, presets, routes, and test_cases live under `htmlapp/frontend/data/`, and place the four calibrated UC-05-01 files accordingly.

- [ ] **Step 2: Update the htmlapp order test first (failing)** — `htmlapp/frontend/tests/case_catalog_order.test.ts`

Append `'case-uc05-01-forecast-jam-c'` to `UC_ORDER` and update the count wording (mirror Task 4, Step 1).

- [ ] **Step 3: Run it to verify it fails**

Run: `cd htmlapp/frontend && npm test -- case_catalog_order`
Expected: FAIL (four cases; UC-05-01 not yet visible or not yet in data).

- [ ] **Step 4: Add UC-05-01 to the htmlapp comparator** — `htmlapp/frontend/src/lib/review/caseCatalog.ts`

Append `'case-uc05-01-forecast-jam-c'` to `VISIBLE_CASE_ORDER` and update the "four"→"five" comment (mirror Task 4, Step 3).

- [ ] **Step 5: Rebuild the htmlapp data bundles**

Run the htmlapp data build (e.g. `cd htmlapp/frontend && node scripts/gen/build-data.mjs` or the documented build command — verify the exact script name) so `aica-data.json` and `public/aica-data.js` include UC-05-01.

- [ ] **Step 6: Run the htmlapp order test to verify it passes**

Run: `cd htmlapp/frontend && npm test -- case_catalog_order`
Expected: PASS (five cases).

- [ ] **Step 7: Verify checkpoint (NO commit)**

Run: `cd htmlapp/frontend && npm test` — confirm no new failures, and that Task 7's parity test still passes. Do NOT commit.

---

## Self-Review

**Spec coverage:**
- §1 goal / narrative → Tasks 1–6 (data + calibration).
- §2 old/new hyperparameter sets → Global Constraints + Task 5 (`NEW`/`OLD` dicts) + Task 6 (calibration).
- §3 four artifacts → Tasks 1 (scenario+profile), 2 (route), 3 (master preset).
- §4 real maps fetch, BYO-key → Task 2 (user-gated) + BYO-key assertion in Task 2 Step 4.
- §5 jam calibration knobs → Task 6.
- §6 harness Part A oracle → Task 5; Part B golden → Task 7.
- §7 htmlapp data mirror, no forecast code, no shared-default change → Task 8 + Global Constraints.
- §8 catalog + order tests (4→5) → Task 4 (app), Task 8 (htmlapp).
- §9 acceptance criteria → covered across Tasks 1–8 checkpoints.
- §10 out of scope (no algorithm/manifest change, no schema field, no commit) → Global Constraints.

**Placeholder scan:** No "TBD/TODO". Calibration values in Tasks 1/3/6 are explicitly empirical, gated by the fixed behavioral assertions in Task 5's test — the contract (fire types + ordering + ETA band), not magic numbers, is the acceptance criterion, so this is a deliberate empirical loop, not a placeholder.

**Type consistency:** `run_uc05_01(hyperparameter_overrides) -> list[TickRow]` and the `TickRow` keys (`tick_index`, `elapsed_min`, `distance_km`, `rest_state`, `fire_reason`, `proposed_spot_eta_min`) are defined in Task 5 and reused verbatim in Tasks 6–7. `NEW`/`OLD` dicts match the Global Constraints verbatim. Case id `case-uc05-01-forecast-jam-c`, scenario `uc05_01_forecast_jam_v0_1`, route `uc05_01_minatomirai_gotemba`, profile `preset-uc05-01-forecast-c` are consistent across all tasks.

**Open items carried from spec §11 (resolve with user during execution):** exact Gotemba destination string (Task 2 uses 御殿場プレミアム・アウトレット — confirm), catalog sort position (appended LAST per Global Constraints), and whether the app-UI OLD run stays a manual hyperparameter override (yes — no schema field).
