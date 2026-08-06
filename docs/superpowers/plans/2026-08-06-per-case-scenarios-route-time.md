# Per-case scenarios with calibrated route time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give combined-screen cases UC-01-01, UC-01-02, and UC-04-01 their own dedicated scenarios — two with slowed speeds (highway 80 / normal 40) and calibrated traffic jams so the simulated route time is ~90 min and ~60 min respectively, one a pure copy+rename — and repoint each case at its new scenario.

**Architecture:** New scenario JSON files are copies of `scenarios/uc01_fatigue_recovery_v0_1.json`. Traffic jams are authored directly into each new scenario's `presets.traffic_events` (time-based windows), which `event_plan.buildEventPlan` merges into the frozen event plan; no case-level jam wiring is needed. Route time is calibrated with a Python harness that mirrors `tick_engine.advance_tick`'s distance/jam loop against the real route preset. Route-preset `duration_s` is bumped so the displayed estimate matches the simulated target.

**Tech Stack:** Python 3.12 (FastAPI backend, pydantic models), JSON data files, React/TS frontend (read-only consumers here). Local test env: Anaconda Python 3.12.7 with `PYTHONPATH=app/api` and `PYTHONIOENCODING=utf-8` (Docker/uv unavailable locally per project memory); Docker available for the running app via `docker-start.bat`.

## Global Constraints

- **Scope this round is `app/` (backend + frontend) + repo-root data (`scenarios/`, `routes/presets/`, `combined_contracts/`) ONLY.** No `htmlapp/` edits — deferred until owner reviews `app/`.
- **No algorithm changes** (trigger `nri_fatigue_score_v1`, service, content) and **no route re-extraction / Maps API calls.**
- **Every implementation and review task is executed in a subagent** (owner instruction).
- **Route time = simulated traversal time** (ticks × tick_seconds until `distance_km ≥ total_route_distance_km`), governed by the scenario `speed_profile` + `presets.traffic_events` and the attached route preset's `distance_m`. Tolerance: **±1 tick (±3 min)**.
- **Traffic-jam speed is the scenario constant `speed_profile.traffic_jam_kph = 20`** — jams are timed windows, not per-event speeds.
- **Scenario naming is persona-coherent:** `uc01_fatigue_recovery_oshikatsu_v0_1`, `uc01_fatigue_recovery_commuter_v0_1`, `uc04_night_longhaul_v0_1`. The inner `id` field must equal the filename stem.
- **Copy verbatim** all fields not explicitly changed (persona, route_intent, initial_state, event_presets, driver_signal_params, anomaly_signal_params, recovery_options, total_duration_seconds=7200, tick_seconds=180, weather_risk, context flags). `presets.total_route_distance_km: 120` stays as-is (unused when a route preset is attached; harmless).
- **Route presets are hand-maintained extraction artifacts** — edit `duration_s` ONLY; never touch `distance_m`, `segments`, `places`, or the polyline. (The "presets are generated" rule applies to *proposal* presets in `scripts/`, not `routes/presets/`.)
- **Case files change only `journey.scenario_ref`** — no other field (schema is `additionalProperties: false`).
- Known baseline: the full backend suite has ~26 pre-existing failures; judge new work against that baseline, never claim "fully green."

---

## File structure

| File | Responsibility | New/edit |
|---|---|---|
| `scripts/dev/calibrate_route_time.py` | Standalone harness mirroring `advance_tick` distance/jam loop; prints completion minutes for a given preset + speed_profile + traffic_events | new |
| `scenarios/uc04_night_longhaul_v0_1.json` | UC-04-01 scenario: pure copy + rename | new |
| `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json` | UC-01-01 scenario: hwy 80 / normal 40 + calibrated jams (~90 min) | new |
| `scenarios/uc01_fatigue_recovery_commuter_v0_1.json` | UC-01-02 scenario: hwy 80 / normal 40 + calibrated jams (~60 min) | new |
| `routes/presets/uc01_01_minatomirai_odawara.json` | `duration_s` 4003→5400 | edit |
| `routes/presets/uc01_02_nagoya_inuyama.json` | `duration_s` 2328→3600 | edit |
| `combined_contracts/test_cases/case-uc04-01-longhaul-d.json` | `scenario_ref` → `uc04_night_longhaul_v0_1` | edit |
| `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` | `scenario_ref` → `uc01_fatigue_recovery_oshikatsu_v0_1` | edit |
| `combined_contracts/test_cases/case-uc01-02-commuter-b.json` | `scenario_ref` → `uc01_fatigue_recovery_commuter_v0_1` | edit |

---

## Task 1: UC-04-01 dedicated scenario (pure copy + rename) + repoint case

**Files:**
- Create: `scenarios/uc04_night_longhaul_v0_1.json`
- Modify: `combined_contracts/test_cases/case-uc04-01-longhaul-d.json` (line 46, `scenario_ref`)

**Interfaces:**
- Consumes: nothing.
- Produces: scenario id `uc04_night_longhaul_v0_1` (served by `GET /api/scenarios`, resolved by `resolvePaintedRoute`/`scenario_registry`).

- [ ] **Step 1: Create the new scenario file as a verbatim copy of `scenarios/uc01_fatigue_recovery_v0_1.json`, changing ONLY `id` and `review_focus`.**

Copy `scenarios/uc01_fatigue_recovery_v0_1.json` to `scenarios/uc04_night_longhaul_v0_1.json`. In the copy set:
- `"id": "uc04_night_longhaul_v0_1"` (was `uc01_fatigue_recovery_v0_1`)
- `"review_focus": "UC-04-01"` (was `UC-01-01`)

Leave every other field byte-identical (including `speed_profile` at 100/60, empty `traffic_events`, `type: uc01_fatigue`). The `_comment` block may stay as-is.

- [ ] **Step 2: Verify the file parses as a ScenarioDef.**

Run (from repo root, Windows bash):
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -c "import json; from aica_api.models.scenario import ScenarioDef; d=json.load(open('scenarios/uc04_night_longhaul_v0_1.json',encoding='utf-8')); s=ScenarioDef.model_validate(d); print('OK', s.id, s.review_focus)"
```
Expected: `OK uc04_night_longhaul_v0_1 UC-04-01`

- [ ] **Step 3: Repoint the case's `scenario_ref`.**

In `combined_contracts/test_cases/case-uc04-01-longhaul-d.json`, change:
```json
"scenario_ref": "uc01_fatigue_recovery_v0_1",
```
to:
```json
"scenario_ref": "uc04_night_longhaul_v0_1",
```
(No other field changes.)

- [ ] **Step 4: Verify the case still validates against the combined-case schema.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -k "combined and (schema or case)" -q
```
Expected: PASS (or unchanged vs. baseline). If no such test matches, run the broader combined suite: `PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -k combined -q` and confirm no NEW failures reference `case-uc04-01`.

- [ ] **Step 5: Commit.**

```bash
git add scenarios/uc04_night_longhaul_v0_1.json combined_contracts/test_cases/case-uc04-01-longhaul-d.json
git commit -m "feat(scenarios): dedicated UC-04-01 night-longhaul scenario (copy+rename)"
```

---

## Task 2: Route-time calibration harness

**Files:**
- Create: `scripts/dev/calibrate_route_time.py`

**Interfaces:**
- Consumes: `aica_api.services.route_analysis._build_route_segments_maps` (classifies preset `raw_route.segments` into ordered `RouteSegmentFact`s the same way the runtime does), the route-preset JSON files, and `tick_engine`-equivalent constants.
- Produces: a CLI + importable `simulate_completion_minutes(preset_path, speed_profile, traffic_events, tick_seconds=180, total_duration_seconds=7200) -> float` used by Tasks 3 and 4.

- [ ] **Step 1: Write the harness.**

Create `scripts/dev/calibrate_route_time.py`:
```python
"""Dev-only harness: predict a merged-run's simulated completion time.

Mirrors the distance/jam loop of aica_api.services.tick_engine.advance_tick for
a route-preset-backed merged run: per tick, pick traffic_jam_kph while a
time-based traffic-event window is active, else the segment's speed_profile
speed; advance distance; complete when distance >= the preset's total km. Used
to calibrate scenarios/*.json presets.traffic_events to a target route time.

Run from repo root with:
  PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/calibrate_route_time.py <preset_id> [--hwy 80] [--normal 40]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from aica_api.services.route_analysis import _build_route_segments_maps

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_preset(preset_id: str) -> dict:
    path = REPO_ROOT / "routes" / "presets" / f"{preset_id}.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _segment_type_at(distance_km: float, segments) -> str:
    current = "normal_road"
    for seg in segments:
        if seg.start_km <= distance_km:
            current = seg.segment_type
    return current


def _active_jam(elapsed_min: float, traffic_events) -> bool:
    for e in traffic_events:
        if e["start_min"] <= elapsed_min < e["start_min"] + e["duration_min"]:
            return True
    return False


def simulate_completion_minutes(
    preset_id: str,
    speed_profile: dict,
    traffic_events: list[dict],
    tick_seconds: int = 180,
    total_duration_seconds: int = 7200,
) -> float:
    preset = load_preset(preset_id)
    raw = preset["raw_route"]
    total_km = raw["distance_m"] / 1000.0
    segments = _build_route_segments_maps(raw.get("segments", []))
    max_ticks = total_duration_seconds // tick_seconds

    distance_km = 0.0
    for tick_index in range(max_ticks):
        seg_type = _segment_type_at(distance_km, segments)
        elapsed_min = tick_index * tick_seconds / 60.0
        if _active_jam(elapsed_min, traffic_events):
            eff = float(speed_profile["traffic_jam_kph"])
        else:
            speed_map = {
                "normal_road": float(speed_profile["normal_road_kph"]),
                "highway": float(speed_profile["highway_kph"]),
                "mountain_road": float(speed_profile["mountain_road_kph"]),
                "sightseeing_road": float(speed_profile["sightseeing_road_kph"]),
            }
            eff = speed_map.get(seg_type, 60.0)
        distance_km += eff * tick_seconds / 3600.0
        if distance_km >= total_km:
            return (tick_index + 1) * tick_seconds / 60.0
    return max_ticks * tick_seconds / 60.0


def _print_segments(preset_id: str) -> None:
    preset = load_preset(preset_id)
    raw = preset["raw_route"]
    segs = _build_route_segments_maps(raw.get("segments", []))
    total_km = raw["distance_m"] / 1000.0
    hwy = sum(s.length_km for s in segs if s.segment_type == "highway")
    nrm = sum(s.length_km for s in segs if s.segment_type == "normal_road")
    print(f"preset={preset_id} total_km={total_km:.3f} highway={hwy:.3f} normal_road={nrm:.3f}")
    for s in segs:
        print(f"  start={s.start_km:7.3f} len={s.length_km:7.3f} type={s.segment_type}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("preset_id")
    ap.add_argument("--hwy", type=float, default=80.0)
    ap.add_argument("--normal", type=float, default=40.0)
    ap.add_argument("--jam", type=float, default=20.0)
    args = ap.parse_args()
    _print_segments(args.preset_id)
    sp = {
        "highway_kph": args.hwy,
        "normal_road_kph": args.normal,
        "mountain_road_kph": 40.0,
        "sightseeing_road_kph": 30.0,
        "traffic_jam_kph": args.jam,
    }
    free = simulate_completion_minutes(args.preset_id, sp, [])
    print(f"free-flow completion: {free:.1f} min")
```

- [ ] **Step 2: Run it against both presets to confirm free-flow baselines.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/calibrate_route_time.py uc01_01_minatomirai_odawara
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/calibrate_route_time.py uc01_02_nagoya_inuyama
```
Expected (approx — confirms the harness matches the §4 hand-calc): UC-01-01 total_km≈57.137, highway≈48.87, normal≈8.26, free-flow ≈ 48–51 min; UC-01-02 total_km≈27.542, highway≈23.72, normal≈3.82, free-flow ≈ 21–24 min. (Small differences from the hand-calc are expected because completion snaps to a whole tick; that is exactly what we calibrate against.)

- [ ] **Step 3: Commit.**

```bash
git add scripts/dev/calibrate_route_time.py
git commit -m "chore(dev): route-time calibration harness (mirrors advance_tick loop)"
```

---

## Task 3: UC-01-01 scenario (80/40 + jams → ~90 min) + preset duration + case repoint

**Files:**
- Create: `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json`
- Modify: `routes/presets/uc01_01_minatomirai_odawara.json` (`raw_route.duration_s`)
- Modify: `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` (line 45, `scenario_ref`)

**Interfaces:**
- Consumes: `simulate_completion_minutes(...)` from Task 2.
- Produces: scenario id `uc01_fatigue_recovery_oshikatsu_v0_1`.

- [ ] **Step 1: Create the scenario as a verbatim copy of `scenarios/uc01_fatigue_recovery_v0_1.json`, changing `id`, `review_focus`, and `speed_profile` speeds.**

Copy to `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json`, then set:
- `"id": "uc01_fatigue_recovery_oshikatsu_v0_1"`
- `"review_focus": "UC-01-01"` (unchanged value, keep it)
- `speed_profile.highway_kph`: `100` → `80`
- `speed_profile.normal_road_kph`: `60` → `40`
- leave `mountain_road_kph: 40`, `sightseeing_road_kph: 30`, `traffic_jam_kph: 20` unchanged.
- `presets.traffic_events`: leave `[]` for now (calibrated in Step 2).

- [ ] **Step 2: Calibrate the jam windows to ~90 min (±1 tick) with the harness.**

Write a short throwaway calibration snippet (run inline, not committed) that imports the harness and searches jam windows. Starting estimate (highway jams add 0.75 min per jam-min; ~55 jam-min needed on top of ~49 free-flow):
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -c "
from scripts.dev.calibrate_route_time import simulate_completion_minutes as sim
sp={'highway_kph':80.,'normal_road_kph':40.,'mountain_road_kph':40.,'sightseeing_road_kph':30.,'traffic_jam_kph':20.}
events=[
  {'event_id':'jam_yokohane','start_min':6,'duration_min':21,'affected_segment_id':'manual'},
  {'event_id':'jam_midroute','start_min':39,'duration_min':21,'affected_segment_id':'manual'},
  {'event_id':'jam_late','start_min':69,'duration_min':15,'affected_segment_id':'manual'},
]
print(sim('uc01_01_minatomirai_odawara', sp, events))
"
```
Adjust the three `duration_min` (and `start_min` spacing so windows don't overlap and land on highway stretches) until the printed value is in **[87.0, 93.0]** min. Record the final `traffic_events` list. Each event must have keys `event_id` (str), `start_min` (number), `duration_min` (number); include `affected_segment_id: "manual"` to match the `TrafficEvent` shape used elsewhere. Place jams so the last one ends before the route's rest facility fire region (roughly first ~60% of distance) where practical, so the fatigue story still reads.

- [ ] **Step 3: Write the calibrated `traffic_events` into the scenario file's `presets.traffic_events`.**

Replace the empty `"traffic_events": []` in `presets` with the calibrated list from Step 2.

- [ ] **Step 4: Verify the scenario parses AND the harness (reading the file's own values) reports ~90 min.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -c "
import json
from aica_api.models.scenario import ScenarioDef
from scripts.dev.calibrate_route_time import simulate_completion_minutes as sim
d=json.load(open('scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json',encoding='utf-8'))
s=ScenarioDef.model_validate(d)  # must not raise
sp=d['speed_profile']; ev=d['presets']['traffic_events']
m=sim('uc01_01_minatomirai_odawara', sp, ev)
print('parse OK', s.id, 'route_min=%.1f'%m)
assert 87.0 <= m <= 93.0, m
print('CALIBRATION OK')
"
```
Expected: prints `parse OK uc01_fatigue_recovery_oshikatsu_v0_1 route_min=~90.0` then `CALIBRATION OK`.

- [ ] **Step 5: Bump the route preset's displayed duration.**

In `routes/presets/uc01_01_minatomirai_odawara.json`, change `raw_route.duration_s` from `4003` to `5400` (90 min). Do NOT change `distance_m` or anything else.

- [ ] **Step 6: Repoint the case's `scenario_ref`.**

In `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json`, change `"scenario_ref": "uc01_fatigue_recovery_v0_1"` to `"scenario_ref": "uc01_fatigue_recovery_oshikatsu_v0_1"`.

- [ ] **Step 7: Verify the case schema + preset list endpoint still validate.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -k "combined or route_preset or presets" -q
```
Expected: no NEW failures vs. baseline referencing `case-uc01-01` or `uc01_01_minatomirai_odawara`.

- [ ] **Step 8: Commit.**

```bash
git add scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json routes/presets/uc01_01_minatomirai_odawara.json combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json
git commit -m "feat(scenarios): UC-01-01 oshikatsu scenario, 80/40 + jams (~90 min)"
```

---

## Task 4: UC-01-02 scenario (80/40 + jams → ~60 min) + preset duration + case repoint

**Files:**
- Create: `scenarios/uc01_fatigue_recovery_commuter_v0_1.json`
- Modify: `routes/presets/uc01_02_nagoya_inuyama.json` (`raw_route.duration_s`)
- Modify: `combined_contracts/test_cases/case-uc01-02-commuter-b.json` (line 47, `scenario_ref`)

**Interfaces:**
- Consumes: `simulate_completion_minutes(...)` from Task 2.
- Produces: scenario id `uc01_fatigue_recovery_commuter_v0_1`.

- [ ] **Step 1: Create the scenario as a verbatim copy of `scenarios/uc01_fatigue_recovery_v0_1.json`, changing `id`, `review_focus`, and `speed_profile` speeds.**

Copy to `scenarios/uc01_fatigue_recovery_commuter_v0_1.json`, then set:
- `"id": "uc01_fatigue_recovery_commuter_v0_1"`
- `"review_focus": "UC-01-02"`
- `speed_profile.highway_kph`: `100` → `80`
- `speed_profile.normal_road_kph`: `60` → `40`
- others unchanged; `presets.traffic_events`: `[]` for now.

- [ ] **Step 2: Calibrate jam windows to ~60 min (±1 tick).**

Starting estimate (~49 highway jam-min on top of ~23.5 free-flow → ~60):
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -c "
from scripts.dev.calibrate_route_time import simulate_completion_minutes as sim
sp={'highway_kph':80.,'normal_road_kph':40.,'mountain_road_kph':40.,'sightseeing_road_kph':30.,'traffic_jam_kph':20.}
events=[
  {'event_id':'jam_nagoya_exit','start_min':4,'duration_min':24,'affected_segment_id':'manual'},
  {'event_id':'jam_midroute','start_min':32,'duration_min':24,'affected_segment_id':'manual'},
]
print(sim('uc01_02_nagoya_inuyama', sp, events))
"
```
Adjust durations/spacing until the value is in **[57.0, 63.0]** min. Record the final list (same key shape as Task 3 Step 2). Note this route is only 27.5 km, so completion may land within 20 ticks; keep windows non-overlapping and within the drive.

- [ ] **Step 3: Write the calibrated `traffic_events` into `presets.traffic_events`.**

- [ ] **Step 4: Verify parse + calibration.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -c "
import json
from aica_api.models.scenario import ScenarioDef
from scripts.dev.calibrate_route_time import simulate_completion_minutes as sim
d=json.load(open('scenarios/uc01_fatigue_recovery_commuter_v0_1.json',encoding='utf-8'))
s=ScenarioDef.model_validate(d)
m=sim('uc01_02_nagoya_inuyama', d['speed_profile'], d['presets']['traffic_events'])
print('parse OK', s.id, 'route_min=%.1f'%m)
assert 57.0 <= m <= 63.0, m
print('CALIBRATION OK')
"
```
Expected: `parse OK uc01_fatigue_recovery_commuter_v0_1 route_min=~60.0` then `CALIBRATION OK`.

- [ ] **Step 5: Bump the preset's displayed duration.**

In `routes/presets/uc01_02_nagoya_inuyama.json`, change `raw_route.duration_s` from `2328` to `3600` (60 min). Nothing else.

- [ ] **Step 6: Repoint the case's `scenario_ref`.**

In `combined_contracts/test_cases/case-uc01-02-commuter-b.json`, change `"scenario_ref": "uc01_fatigue_recovery_v0_1"` to `"scenario_ref": "uc01_fatigue_recovery_commuter_v0_1"`.

- [ ] **Step 7: Verify case schema + preset endpoints.**

```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -k "combined or route_preset or presets" -q
```
Expected: no NEW failures referencing `case-uc01-02` or `uc01_02_nagoya_inuyama`.

- [ ] **Step 8: Commit.**

```bash
git add scenarios/uc01_fatigue_recovery_commuter_v0_1.json routes/presets/uc01_02_nagoya_inuyama.json combined_contracts/test_cases/case-uc01-02-commuter-b.json
git commit -m "feat(scenarios): UC-01-02 commuter scenario, 80/40 + jams (~60 min)"
```

---

## Task 5: Full verification (backend + frontend + scenario-count guard) and baseline diff

**Files:** none (verification only; a count-guard fix, if any, is the sole possible edit).

**Interfaces:**
- Consumes: all three new scenarios + edited presets/cases.
- Produces: a documented pass/fail delta vs. the ~26-failure backend baseline.

- [ ] **Step 1: Check for a hard-coded scenario-count guard.**

Run:
```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -k scenario -q
```
If a test fails because it asserts a fixed number of scenario files (count now +3), update that single count literal to the new value (this is count maintenance, like the preset-count guards). If it fails for any other reason, STOP and report. If no count test exists, proceed.

- [ ] **Step 2: Run the full backend suite and diff against baseline.**

```bash
PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python -m pytest app/api/tests -q
```
Expected: failure set is a SUBSET of the known ~26 pre-existing failures (cp932/schema-drift/in-flight dedup per project memory). Any NEW failure that names one of the new scenario ids, the two edited presets, or the three cases must be fixed. Record the pass/fail counts.

- [ ] **Step 3: Run the frontend test suite (read-only consumers; confirm no regression).**

```bash
cd app/frontend && npm test -- --run 2>&1 | tail -40; cd ../..
```
Expected: no NEW failures attributable to the scenario/preset/case changes. (These are data files; frontend tests should be unaffected. Note any pre-existing reds.)

- [ ] **Step 4: Docker app spot-check (manual, scripted where possible).**

With the stack up (`docker-start.bat`), for each of the three cases in the combined screen confirm:
- the displayed route duration reads ~90 / ~60 / unchanged (UC-04-01);
- playback traversal length matches the displayed estimate;
- the rest proposal still fires and the case still reads coherently.

If a browser/API automation is available, hit `GET /api/scenarios` and confirm the three new ids are listed; otherwise record a manual check. Capture the outcome in the final report.

- [ ] **Step 5: Final commit (only if Step 1 required a count edit).**

```bash
git add -A
git commit -m "test: bump scenario-count guard for 3 new per-case scenarios"
```

---

## Self-review

**Spec coverage:** §3 new scenarios → Tasks 1/3/4; §4 jam calibration → harness (Task 2) used in Tasks 3/4 with ±1-tick acceptance asserts; §5 preset duration sync → Task 3 Step 5, Task 4 Step 5; §6 case repoints → Tasks 1/3/4; §8 verification → Task 5. UC-04-01 pure-copy scope (§1) → Task 1. All covered.

**Placeholder scan:** No TBD/TODO. Jam windows are calibrated by a concrete harness with explicit numeric acceptance ranges ([87,93] / [57,63]) and starting estimates — not left open. Harness code is given in full.

**Type consistency:** `simulate_completion_minutes(preset_id, speed_profile, traffic_events, tick_seconds=180, total_duration_seconds=7200)` defined in Task 2, called identically in Tasks 3/4. `traffic_events` element shape (`event_id`/`start_min`/`duration_min`/`affected_segment_id`) is consistent across Tasks 3/4 and matches the `_active_traffic_jam` fields (`start_min`, `duration_min`). Scenario ids are consistent between creation, verification, and case repoints.
