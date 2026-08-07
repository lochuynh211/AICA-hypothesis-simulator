# Traffic Jam km-Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make km (position) the single source of truth for where a traffic jam bites, converting the 4 minute-authored scenario presets to km while preserving trigger behavior, and derive the minute-axis display from km.

**Architecture:** `TrafficEvent.start_min`/`duration_min` become optional; `start_km`/`end_km` (already added) become the authored form. Gating already prefers km. The preview's `traffic_jams` builder derives `from_min`/`to_min` from the real per-tick `progress` (min↔frac) curve when km is present, so both the minute-axis (trigger setup) and distance-axis (Combined) charts read one km source. The 4 scenario JSON jams are converted once via a dev calibration script that reads the real jammed-tick km range.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 (backend), pytest. Frontend TypeScript already handles frac (no change this plan). Test runner: `PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest` (Anaconda Python 3.12.7 — Docker not reachable from this shell).

## Global Constraints

- **`app/` only.** No `htmlapp/` changes in this plan (deferred to the mirror step after user review).
- **No commits until the user explicitly commands.** All backend+frontend fixes (the prior jam position-native fix already in the working tree + this refactor) land in ONE commit as the htmlapp mirror reference. The `git commit` steps below are therefore written as **"stage only — do NOT commit"**.
- **Behavior preservation is the acceptance bar.** Each of the 4 scenarios' preview fire count/positions must be unchanged after conversion.
- **No change to `WeatherEvent`** (stays time-only).
- **No segment re-anchoring** — km ranges come from the real jammed-tick distance range, not the `affected_segment_id` segment extent.
- Test invocation (verified working this session):
  `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/<file> -k <name> -v`

---

## File Structure

- **Modify** `app/api/aica_api/models/run.py` — `TrafficEvent.start_min`/`duration_min` → optional. (Prior fix already added `start_km`/`end_km` + `PreviewTrafficJam.from_frac`/`to_frac`.)
- **Modify** `app/api/aica_api/services/preview.py` — extend the `traffic_jams` builder to derive `from_min`/`to_min` from `progress` when km present; add a module-level helper `_km_to_min`.
- **Create** `scripts/dev/jam_km_from_scenario.py` — dev-only: print each scenario's real jammed-tick km range (behavior-preserving conversion source).
- **Modify** 4 scenario JSONs (`scenarios/uc03_01_monotony_daytime_jam.json`, `uc02_monotony_v0_1.json`, `uc01_fatigue_recovery_commuter_v0_1.json`, `uc01_fatigue_recovery_oshikatsu_v0_1.json`) — replace jam `start_min`/`duration_min` with `start_km`/`end_km`.
- **Modify** `app/api/tests/test_models.py` (or `test_tick_engine.py`) — km-only `TrafficEvent` validates.
- **Modify** `app/api/tests/test_iter_preview_ticks.py` — km-only jam yields derived `from_min`/`to_min`.
- **Create/Modify** `app/api/tests/test_scenario_jam_behavior.py` — behavior-preservation snapshot for the 4 scenarios.

---

## Task 1: Make `TrafficEvent` time fields optional

**Files:**
- Modify: `app/api/aica_api/models/run.py:48-69` (`TrafficEvent`)
- Test: `app/api/tests/test_models.py`

**Interfaces:**
- Produces: `TrafficEvent(id=str, affected_segment_id=str, speed_kph=float, start_km=float, end_km=float)` valid with NO `start_min`/`duration_min`. Existing time-only construction still valid.

- [ ] **Step 1: Write the failing test** (append to `app/api/tests/test_models.py`)

```python
def test_traffic_event_valid_with_km_only_no_time():
    from aica_api.models.run import TrafficEvent
    ev = TrafficEvent(
        id="jam_km",
        affected_segment_id="seg_jam",
        speed_kph=8.0,
        start_km=5.4,
        end_km=174.6,
    )
    assert ev.start_km == 5.4 and ev.end_km == 174.6
    assert ev.start_min is None and ev.duration_min is None


def test_traffic_event_still_valid_time_only():
    from aica_api.models.run import TrafficEvent
    ev = TrafficEvent(
        id="jam_time", start_min=0.0, duration_min=200.0,
        affected_segment_id="seg_jam", speed_kph=8.0,
    )
    assert ev.start_km is None and ev.end_km is None
    assert ev.start_min == 0.0 and ev.duration_min == 200.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_models.py -k "traffic_event_valid_with_km_only" -v`
Expected: FAIL — `ValidationError` (start_min/duration_min required).

- [ ] **Step 3: Edit the model**

In `app/api/aica_api/models/run.py`, change the two required lines:

```python
    start_min: float | None = None
    duration_min: float | None = None
```

and update the docstring's "required TIME-native fields" wording to "OPTIONAL TIME-native fields (Maps/route-preset path and painter fallback); a jam is authored in km (`start_km`/`end_km`) and gated on position." Keep `start_km`/`end_km` and `model_config`.

- [ ] **Step 4: Run to verify both pass**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_models.py -k "traffic_event" -v`
Expected: PASS.

- [ ] **Step 5: Regression — event_plan still builds km-only jams**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_event_plan.py tests/test_tick_engine.py -v`
Expected: PASS (no failures introduced; pre-existing failures per baseline memory are unrelated — confirm none are new in these two files).

- [ ] **Step 6: Stage only — do NOT commit**

```bash
git add app/api/aica_api/models/run.py app/api/tests/test_models.py
# NO git commit — bundled commit happens only on user command
```

---

## Task 2: Derive `from_min`/`to_min` from km via the progress curve

**Files:**
- Modify: `app/api/aica_api/services/preview.py:721-734` (`traffic_jams` builder; add `_km_to_min` helper just above it)
- Test: `app/api/tests/test_iter_preview_ticks.py`

**Interfaces:**
- Consumes: `progress: list[dict]` with keys `t`,`min`,`frac` (already built in the loop); `route_total_km: float`; `ev.start_km`/`ev.end_km`.
- Produces: each `traffic_jams` entry has `from_min`/`to_min` derived from km when km present, else the legacy `ev.start_min` path. `from_frac`/`to_frac` unchanged.

- [ ] **Step 1: Write the failing test** (append to `app/api/tests/test_iter_preview_ticks.py`)

Use an existing scenario/package that produces a jam. This test drives `evaluate_preview` (or `iter_preview_ticks` accumulation) for a km-only jam and asserts derived minutes. Concrete test:

```python
def test_km_jam_derives_minutes_from_progress():
    """A km-authored jam yields from_min/to_min derived from the real progress
    (min<->frac) curve, not None and not the naive uniform ratio."""
    from aica_api.services.preview import _km_to_min

    progress = [
        {"t": 0, "min": 0.0, "frac": 0.0},
        {"t": 1, "min": 3.0, "frac": 0.10},
        {"t": 2, "min": 6.0, "frac": 0.50},
        {"t": 3, "min": 9.0, "frac": 1.00},
    ]
    # frac 0.10 lands exactly on sample t=1 -> 3.0 min
    assert _km_to_min(0.10, progress) == 3.0
    # frac 0.30 is halfway between (0.10,3.0) and (0.50,6.0) -> 4.5 min
    assert abs(_km_to_min(0.30, progress) - 4.5) < 1e-9
    # frac beyond last sample clamps to last min
    assert _km_to_min(1.5, progress) == 9.0
    # empty progress -> None (nothing to interpolate)
    assert _km_to_min(0.3, []) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_iter_preview_ticks.py -k "km_jam_derives_minutes" -v`
Expected: FAIL — `ImportError`/`AttributeError` (`_km_to_min` not defined).

- [ ] **Step 3: Add the helper and wire the builder** in `app/api/aica_api/services/preview.py`

Add module-level helper (near `_pick_rest_spot`, top-level, so it is importable):

```python
def _km_to_min(frac: float, progress: list[dict]) -> float | None:
    """Map a route-fraction to elapsed minutes via the real per-tick progress
    curve (first-crossing linear interpolation).

    ``progress`` is the tick loop's list of {"t","min","frac"} samples, with
    non-decreasing ``frac`` (distance is monotonic; parked ticks repeat a frac).
    Returns None when ``progress`` is empty. A ``frac`` at/after the last sample
    clamps to the last sample's minute (the route completed).
    """
    if not progress:
        return None
    prev = progress[0]
    if frac <= prev["frac"]:
        return prev["min"]
    for cur in progress[1:]:
        if cur["frac"] >= frac:
            span = cur["frac"] - prev["frac"]
            if span <= 0:
                return cur["min"]
            ratio = (frac - prev["frac"]) / span
            return prev["min"] + ratio * (cur["min"] - prev["min"])
        prev = cur
    return progress[-1]["min"]
```

Replace the `traffic_jams` comprehension so km-present jams derive minutes:

```python
    def _jam_frac(km: float | None) -> float | None:
        if km is None:
            return None
        return max(0.0, min(1.0, km / route_total_km)) if route_total_km else None

    traffic_jams = []
    for ev in event_plan.traffic_events:
        from_frac = _jam_frac(ev.start_km)
        to_frac = _jam_frac(ev.end_km)
        if from_frac is not None and to_frac is not None:
            # km is the source of truth: derive the minute axis from the real
            # progress curve so the trigger setup strip (minute axis) and the
            # Combined chart (distance axis) agree, both grounded in km.
            from_min = _km_to_min(from_frac, progress)
            to_min = _km_to_min(to_frac, progress)
        else:
            # Legacy time-only jam (Maps/route-preset path, painter fallback).
            from_min = ev.start_min
            to_min = (
                (ev.start_min + ev.duration_min)
                if ev.start_min is not None and ev.duration_min is not None
                else None
            )
        traffic_jams.append({
            "from_min": from_min,
            "to_min": to_min,
            "from_frac": from_frac,
            "to_frac": to_frac,
        })
```

- [ ] **Step 4: Run to verify the unit test passes**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_iter_preview_ticks.py -k "km_jam_derives_minutes" -v`
Expected: PASS.

- [ ] **Step 5: Check `PreviewTrafficJam` tolerates None minutes**

Read `app/api/aica_api/models/run.py:465-490` (`PreviewTrafficJam`). If `from_min`/`to_min` are typed `float` (required), change them to `float | None = None` so a legacy time-only jam missing minutes and a km jam with empty progress both serialize. Add the same optionality in `PreviewTrafficJam` under `merged_run.py` if it re-declares them (grep first: `grep -rn "class PreviewTrafficJam" app/api`).

- [ ] **Step 6: Run the preview/quickview integration suite**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_iter_preview_ticks.py tests/test_merged_quickview.py -v`
Expected: PASS (no NEW failures vs. baseline).

- [ ] **Step 7: Stage only — do NOT commit**

```bash
git add app/api/aica_api/services/preview.py app/api/aica_api/models/run.py app/api/tests/test_iter_preview_ticks.py
# NO git commit
```

---

## Task 3: Dev script — compute each scenario's real jammed-tick km range

**Files:**
- Create: `scripts/dev/jam_km_from_scenario.py`

**Interfaces:**
- Produces: prints `scenario_id`, `jam_id`, `start_km`, `end_km` for each jam, computed as `[min, max]` of `distance_km` over the ticks where the CURRENT (time-gated) jam is active. This is the behavior-preserving km range to bake into the JSON in Task 4.

- [ ] **Step 1: Write the script**

```python
"""Dev-only: print the real jammed-tick km range for each scenario's traffic
jam, using the CURRENT (time-gated) tick simulation. The printed start_km/end_km
are the behavior-preserving conversion source for scenarios/*.json (feature:
traffic-jam km-unification). Run from repo root:

  PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/jam_km_from_scenario.py
"""
from __future__ import annotations

from aica_api.services.route_analysis import analyze_route
from aica_api.services.event_plan import build_event_plan
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import advance_tick, _active_traffic_jam
from aica_api.config import settings

SCENARIOS = [
    "uc03_01_monotony_daytime_jam",
    "uc02_monotony_v0_1",
    "uc01_fatigue_recovery_commuter_v0_1",
    "uc01_fatigue_recovery_oshikatsu_v0_1",
]
_MAX_TICKS = 2000


def jam_km_range(scenario_id: str):
    reg = ScenarioRegistry(settings.scenarios_dir)
    scenario = reg.get(scenario_id)
    if scenario is None:
        print(f"{scenario_id}: NOT FOUND/INVALID")
        return
    route_facts = analyze_route(scenario)
    event_plan = build_event_plan(route_facts, scenario)
    if not event_plan.traffic_events:
        print(f"{scenario_id}: no traffic_events")
        return

    lo = None
    hi = None
    prior = None
    for tick_index in range(_MAX_TICKS):
        ts = advance_tick(prior, tick_index, event_plan, route_facts, scenario,
                          recovery=None, run_seed=event_plan.run_seed)
        elapsed_min = ts.elapsed_seconds / 60.0
        dist = ts.distance_km or 0.0
        # PRE-advance distance is what the gate uses; here we sample this tick's
        # distance while its time-gated jam is active.
        if _active_traffic_jam(elapsed_min, dist, event_plan):
            lo = dist if lo is None else min(lo, dist)
            hi = dist if hi is None else max(hi, dist)
        prior = ts
        if ts.completed:
            break

    ev = event_plan.traffic_events[0]
    print(f"{scenario_id}: jam_id={ev.id} start_km={lo:.3f} end_km={hi:.3f} "
          f"total_km={route_facts.total_route_distance_km:.1f}")


if __name__ == "__main__":
    for s in SCENARIOS:
        jam_km_range(s)
```

- [ ] **Step 2: Run it and capture output**

Run: `cd "<repo root>" && PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/jam_km_from_scenario.py`
Expected: four lines with `start_km`/`end_km` per scenario. **Record these numbers** — they are the exact values for Task 4. (For uc03 the range should span nearly the whole route since the jam is active the entire drive; for uc02 a small early-highway slice; for uc01×2 an early slice.)

Note: the current time-gated jams have `start_km`/`end_km` = None on the scenario events, so `_active_traffic_jam` correctly falls back to the time gate here — this is why the script reads the ORIGINAL behavior. Do NOT run this after Task 4 edits the JSON (it would then read km and be circular).

- [ ] **Step 3: Stage only — do NOT commit**

```bash
git add scripts/dev/jam_km_from_scenario.py
# NO git commit
```

---

## Task 4: Convert the 4 scenario JSONs to km

**Files:**
- Modify: `scenarios/uc03_01_monotony_daytime_jam.json`
- Modify: `scenarios/uc02_monotony_v0_1.json`
- Modify: `scenarios/uc01_fatigue_recovery_commuter_v0_1.json`
- Modify: `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json`

**Interfaces:**
- Consumes: the `start_km`/`end_km` numbers printed by Task 3.
- Produces: each scenario's `presets.traffic_events[0]` carries `start_km`/`end_km` and NO `start_min`/`duration_min`.

- [ ] **Step 1: Snapshot pre-conversion behavior (baseline for Task 5)**

Run this and SAVE the output (used by Task 5's assertion):

```bash
cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -c "
from aica_api.services.route_analysis import analyze_route
from aica_api.services.event_plan import build_event_plan
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import advance_tick
from aica_api.config import settings
for sid in ['uc03_01_monotony_daytime_jam','uc02_monotony_v0_1','uc01_fatigue_recovery_commuter_v0_1','uc01_fatigue_recovery_oshikatsu_v0_1']:
    sc=ScenarioRegistry(settings.scenarios_dir).get(sid)
    rf=analyze_route(sc); ep=build_event_plan(rf,sc)
    prior=None; jam_ticks=0
    from aica_api.services.tick_engine import _active_traffic_jam
    for i in range(2000):
        ts=advance_tick(prior,i,ep,rf,sc,recovery=None,run_seed=ep.run_seed)
        if _active_traffic_jam(ts.elapsed_seconds/60.0, ts.distance_km or 0.0, ep): jam_ticks+=1
        prior=ts
        if ts.completed: break
    print(sid, 'completed_tick=',i,'jam_ticks=',jam_ticks)
"
```

- [ ] **Step 2: Edit each JSON's `presets.traffic_events[0]`**

For each file, replace the object so it has `start_km`/`end_km` from Task 3 and drops the time keys. Example shape (use the ACTUAL numbers from Task 3, not these placeholders — the exact values come from the script run):

```json
"traffic_events": [
  { "id": "bayshore_full_jam", "start_km": <lo>, "end_km": <hi>, "affected_segment_id": "seg_jam", "speed_kph": 8 }
]
```

Apply per file, keeping each jam's own `id`/`affected_segment_id`/`speed_kph`:
- `uc03_01_monotony_daytime_jam.json` → id `bayshore_full_jam`, seg `seg_jam`, speed 8
- `uc02_monotony_v0_1.json` → id `jam_early_highway`, seg `seg_highway`, speed 20
- `uc01_fatigue_recovery_commuter_v0_1.json` → id `jam_a`, seg `manual`, speed 10
- `uc01_fatigue_recovery_oshikatsu_v0_1.json` → id `jam_yokohane`, seg `manual`, speed 10

- [ ] **Step 3: Validate JSON + registry still loads all 4**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -c "
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.config import settings
r=ScenarioRegistry(settings.scenarios_dir)
for sid in ['uc03_01_monotony_daytime_jam','uc02_monotony_v0_1','uc01_fatigue_recovery_commuter_v0_1','uc01_fatigue_recovery_oshikatsu_v0_1']:
    sc=r.get(sid); assert sc is not None, sid
    ev=sc.presets['traffic_events'][0]
    assert ev.get('start_km') is not None and 'start_min' not in ev, (sid, ev)
    print(sid,'OK',ev.get('start_km'),ev.get('end_km'))
"`
Expected: 4 × OK.

- [ ] **Step 4: Stage only — do NOT commit**

```bash
git add scenarios/uc03_01_monotony_daytime_jam.json scenarios/uc02_monotony_v0_1.json scenarios/uc01_fatigue_recovery_commuter_v0_1.json scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json
# NO git commit
```

---

## Task 5: Behavior-preservation test for the 4 converted scenarios

**Files:**
- Create: `app/api/tests/test_scenario_jam_behavior.py`

**Interfaces:**
- Consumes: the converted scenarios (Task 4) + `advance_tick`/`_active_traffic_jam`.
- Produces: an asserting test that the jam is active for a comparable number of ticks and the run completes at the same tick as the pre-conversion baseline (Task 4 Step 1).

- [ ] **Step 1: Write the test** using the baseline numbers recorded in Task 4 Step 1

```python
"""Behavior preservation: converting the 4 scenario jams from minutes to km
(traffic-jam km-unification) must not change how many ticks the jam is active
or when the route completes. Baseline numbers captured pre-conversion (see the
plan's Task 4 Step 1)."""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.services.route_analysis import analyze_route
from aica_api.services.event_plan import build_event_plan
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import advance_tick, _active_traffic_jam

# (completed_tick, jam_ticks) recorded BEFORE conversion. FILL THESE from the
# Task 4 Step 1 run — they are the contract this test locks in.
BASELINE = {
    "uc03_01_monotony_daytime_jam": (None, None),
    "uc02_monotony_v0_1": (None, None),
    "uc01_fatigue_recovery_commuter_v0_1": (None, None),
    "uc01_fatigue_recovery_oshikatsu_v0_1": (None, None),
}


def _simulate(scenario_id):
    sc = ScenarioRegistry(settings.scenarios_dir).get(scenario_id)
    assert sc is not None, scenario_id
    rf = analyze_route(sc)
    ep = build_event_plan(rf, sc)
    prior = None
    jam_ticks = 0
    completed_tick = None
    for i in range(2000):
        ts = advance_tick(prior, i, ep, rf, sc, recovery=None, run_seed=ep.run_seed)
        if _active_traffic_jam(ts.elapsed_seconds / 60.0, ts.distance_km or 0.0, ep):
            jam_ticks += 1
        prior = ts
        if ts.completed:
            completed_tick = i
            break
    return completed_tick, jam_ticks


@pytest.mark.parametrize("scenario_id", list(BASELINE))
def test_jam_behavior_preserved_after_km_conversion(scenario_id):
    exp_completed, exp_jam = BASELINE[scenario_id]
    completed_tick, jam_ticks = _simulate(scenario_id)
    assert completed_tick == exp_completed, (scenario_id, completed_tick, exp_completed)
    # km-gating reproduces the same jammed span; allow +-1 tick for the
    # boundary tick where distance crosses end_km vs. the old time boundary.
    assert abs(jam_ticks - exp_jam) <= 1, (scenario_id, jam_ticks, exp_jam)
```

- [ ] **Step 2: Fill `BASELINE`** with the exact numbers from Task 4 Step 1, then run

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_scenario_jam_behavior.py -v`
Expected: PASS for all 4. If `jam_ticks` differs by more than 1 tick, STOP — the km range from Task 3 is wrong (do not widen the tolerance to force a pass); re-derive.

- [ ] **Step 3: Stage only — do NOT commit**

```bash
git add app/api/tests/test_scenario_jam_behavior.py
# NO git commit
```

---

## Task 6: Full regression sweep + hand back for commit

**Files:** none (verification only).

- [ ] **Step 1: Run the jam-relevant suite**

Run: `cd app/api && PYTHONPATH=. PYTHONIOENCODING=utf-8 python -m pytest tests/test_models.py tests/test_tick_engine.py tests/test_event_plan.py tests/test_iter_preview_ticks.py tests/test_merged_quickview.py tests/test_merged_painter.py tests/test_scenario_jam_behavior.py -v`
Expected: PASS. Any failure must be checked against the pre-existing baseline (~26 known failures per memory `backend-test-baseline-fixbug-0804`); confirm NONE are newly introduced by this work.

- [ ] **Step 2: Confirm working tree holds prior fix + this refactor, unstaged for the single bundled commit**

Run: `git status`
Expected: modified `models/run.py`, `services/preview.py`, `services/tick_engine.py`, `services/merged_painter.py`, `app/frontend/src/...` (prior fix), 4 scenario JSONs, new script + tests. **Do NOT commit.** Report readiness and wait for the user's explicit commit command.

---

## Self-Review

**Spec coverage:** §1 schema → Task 1. §2 conversion + calibration script → Tasks 3, 4. §3 derive minutes from km → Task 2. §4 painter no-change → honored (not a task). §5 tests → Tasks 1,2,5 + Task 6 sweep. All covered.

**Placeholder scan:** The only intentional fill-ins are the km values (Task 4) and `BASELINE` numbers (Task 5), which are DATA that must be measured at execution time by Task 3 / Task 4 Step 1 — the plan specifies exactly how to obtain them and forbids widening tolerances to fake a pass. No "TODO"/"handle edge cases" placeholders.

**Type consistency:** `_km_to_min(frac: float, progress: list[dict]) -> float | None` used consistently in Task 2 test and impl. `_active_traffic_jam(elapsed_min, distance_km, event_plan)` signature matches the current code (verified this session). `progress` sample keys `t`/`min`/`frac` match `preview.py:510`. `PreviewTrafficJam.from_min`/`to_min` optionality handled in Task 2 Step 5.
