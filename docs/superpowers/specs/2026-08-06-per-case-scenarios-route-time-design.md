# Per-case scenarios with calibrated route time — Design

- **Date:** 2026-08-06
- **Branch (build):** `fixbug-0806`
- **Status:** design pending user approval
- **Scope this round:** `app/` (backend + frontend) ONLY. htmlapp mirror deferred
  until the owner reviews `app/`.

## 1. Purpose & scope

Three combined-screen test cases (`UC-01-01`, `UC-01-02`, `UC-04-01`) currently
all share the single scenario `uc01_fatigue_recovery_v0_1`. Give each its own
dedicated scenario:

1. **UC-01-01** — new scenario, a copy of the shared one, with highway speed
   slowed to **80 kph**, normal road to **40 kph**, plus authored traffic jams so
   the **simulated** overall route time is **~90 min**.
2. **UC-01-02** — new scenario, same speed edits (80 / 40), authored jams so the
   simulated route time is **~60 min**.
3. **UC-04-01** — new scenario that is a **pure copy + rename** of the shared one
   (coherent with the long night Tokyo→Osaka case), **no** speed or jam changes.

Then repoint each case's `journey.scenario_ref` to its new scenario.

**Out of scope:** any algorithm change (trigger / service / content); any route
re-extraction or Maps API call; any htmlapp edit (this round); any change to the
picker order or case titles (already done in a prior spec).

## 2. How "overall route time" is actually determined (the mechanism)

Confirmed by reading the runtime (`tick_engine.advance_tick`,
`route_analysis`, `route_presets.load_route_preset`, `event_plan.buildEventPlan`,
`merged_runs.createMergedPlan`):

- All three cases attach a **route preset**. With a preset attached, the tick
  engine's traversal uses:
  - **Total distance** = the preset's `raw_route.distance_m / 1000`
    (`total_route_distance_km`). The run completes when
    `distance_km >= total_route_distance_km`.
  - **Segment types** = the preset's per-step `road_class`, mapped by
    `_ROAD_CLASS_MAP` (`HIGHWAY → highway`, `LOCAL → normal_road`; anything else
    → `normal_road`). Both UC-01 presets contain **only** HIGHWAY and LOCAL
    steps — so only `highway` and `normal_road` segment types occur (no
    mountain / sightseeing).
  - **Per-tick speed** = the **scenario's** `speed_profile` for the active
    segment type, OR `speed_profile.traffic_jam_kph` when a **time-based** jam
    window is active at the current elapsed minute
    (`_active_traffic_jam(elapsed_min, event_plan)`).
- **Where jams come from:** `buildEventPlan` builds the event plan from
  `mergedPresets = {...scenario.presets, ...callerPresets}` (caller wins on
  conflict). Both cases send **no** `jam_range_km` and **no** `presets`, so
  authoring `traffic_events` into the **new scenario's `presets.traffic_events`**
  feeds the tick engine directly — **no case-file jam wiring needed.**
- **Displayed estimate is separate:** the combined screen also shows an
  "estimated route duration" that comes from the preset's baked
  `raw_route.duration_s / 60` (`estimated_route_duration_min`). Slowing the
  scenario speeds does **not** change that number. Per owner decision, we update
  the preset `duration_s` so the displayed estimate matches the simulated
  target (§5).

**Tick budget.** `total_duration_seconds / tick_seconds = 7200 / 180 = 40 ticks
= 120 min` cap — comfortably above the 90 / 60-min targets.

## 3. New scenario files

Each is a copy of `scenarios/uc01_fatigue_recovery_v0_1.json` with the file's
inner `id` matching the filename and `review_focus` set to the matching UC id.
Everything not listed below (persona, `route_intent`, `initial_state`,
`event_presets`, `driver_signal_params`, `anomaly_signal_params`,
`recovery_options`, `total_duration_seconds`, `tick_seconds`, `weather_risk`,
context flags) is copied **verbatim**.

| New scenario id (file) | For case | `speed_profile.highway_kph` | `speed_profile.normal_road_kph` | `presets.traffic_events` | Target sim time |
|---|---|---|---|---|---|
| `uc01_fatigue_recovery_oshikatsu_v0_1` | UC-01-01 | **80** | **40** | authored (§4) | **~90 min (±1 tick)** |
| `uc01_fatigue_recovery_commuter_v0_1` | UC-01-02 | **80** | **40** | authored (§4) | **~60 min (±1 tick)** |
| `uc04_night_longhaul_v0_1` | UC-04-01 | 100 (unchanged) | 60 (unchanged) | `[]` (none) | unchanged (pure copy) |

Other `speed_profile` fields (`mountain_road_kph`, `sightseeing_road_kph`,
`traffic_jam_kph=20`) are unchanged in all three — `traffic_jam_kph=20` is the
speed the jams run at.

Naming is **persona-coherent** (owner decision): oshikatsu (Ms. C) / commuter
(Mr. B) / night-longhaul (Mr. D).

## 4. Traffic-jam calibration (UC-01-01 & UC-01-02)

### 4.1 Segment split (computed from the preset files)

Merging consecutive same-class steps (as `_build_route_segments_maps` does):

- **UC-01-01** `uc01_01_minatomirai_odawara` — total **57.137 km**:
  highway ≈ **48.87 km**, normal_road ≈ **8.26 km**.
  Free-flow at 80 / 40: `48.87/80 + 8.26/40 ≈ 0.611 h + 0.207 h ≈ 49.0 min`.
  → jams must add **~41 min** to reach ~90.
- **UC-01-02** `uc01_02_nagoya_inuyama` — total **27.542 km**:
  highway ≈ **23.72 km**, normal_road ≈ **3.82 km**.
  Free-flow at 80 / 40: `23.72/80 + 3.82/40 ≈ 0.2965 h + 0.0955 h ≈ 23.5 min`.
  → jams must add **~36 min** to reach ~60.

### 4.2 Jam model

Each `traffic_event` is `{event_id, start_min, duration_min, ...}` (time-based,
matching `_active_traffic_jam` and the existing `TrafficEvent` shape used by
`jam_traffic_event`). While a window is active, effective speed drops to
`traffic_jam_kph = 20`. Total route time is governed purely by total jam-minutes
and placement (jam speed is a scenario constant, not a per-event field).

Added time per minute of jam vs free-flow:
- during a highway stretch: `(80 − 20)/80 = 0.75 min added per jam-min`;
- during a normal-road stretch: `(40 − 20)/40 = 0.50 min added per jam-min`.

### 4.3 Calibration method (implementation step, done by subagent)

Because time-based windows interact with distance-based segment boundaries, the
exact minutes are tuned with a **small simulation harness that mirrors
`advance_tick`'s distance loop** — step distance by `effective_speed *
tick_seconds/3600`, choose `traffic_jam_kph` when a window is active else the
segment's speed, stop at `distance >= total_km` — iterating the
`traffic_events` windows until the completion tick is within **±1 tick (±3 min)**
of target (owner tolerance). The harness runs under the project's local Python
(Anaconda 3.12.7, `PYTHONPATH=app/api`, `PYTHONIOENCODING=utf-8`) or Docker.

Jams are placed to (a) read as plausible congestion and (b) sit **before** the
rest-spot fire so the fatigue/rest story is preserved. Target: 2–3 windows each
(these short, highway-dominated routes need sustained congestion — avg ≈ 38 /
27.5 kph — to reach 90 / 60, consistent with "add some traffic jams"). Final
window values are recorded in the plan, not fixed here.

## 5. Route-preset displayed-duration sync (owner decision)

Update **only** `raw_route.duration_s` so the displayed estimate matches the
simulated target; `distance_m`, `segments`, `places`, polyline untouched
(distance drives completion + segment typing and must not move):

| Preset file | `duration_s` old → new |
|---|---|
| `routes/presets/uc01_01_minatomirai_odawara.json` | 4003 → **5400** (90 min) |
| `routes/presets/uc01_02_nagoya_inuyama.json` | 2328 → **3600** (60 min) |

`routes/presets/long_tokyo_osaka.json` (UC-04-01) is untouched.

## 6. Case-file edits (minimal)

Change **only** `journey.scenario_ref` in each case JSON; no other field:

| Case file | `scenario_ref` new value |
|---|---|
| `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` | `uc01_fatigue_recovery_oshikatsu_v0_1` |
| `combined_contracts/test_cases/case-uc01-02-commuter-b.json` | `uc01_fatigue_recovery_commuter_v0_1` |
| `combined_contracts/test_cases/case-uc04-01-longhaul-d.json` | `uc04_night_longhaul_v0_1` |

No `jam_range_km`, no `presets`, no title/persona changes. The case schema
(`additionalProperties: false`) is satisfied — only an existing string field's
value changes. UC-01-01's narrative already references Yokohane congestion, so
it stays accurate; UC-01-02's narrative doesn't mention traffic, so adding jams
doesn't contradict it (implementation may optionally add a one-line congestion
note — flagged as optional, not required).

## 7. Constraints honored

- **Backend is source of truth** — only inputs (scenario speeds/jams, preset
  duration, case ref) change; no decision/evidence logic touched.
- **Qualitative / boundary-binned trigger discipline** — unaffected; speeds/jams
  feed the deterministic traversal, not the trigger's binned inputs directly.
- **Deterministic tick engine** — event plan frozen at run start from
  `scenario.presets`; unchanged mechanism.
- **BYO Maps key** — no key touched; presets are pre-extracted and only their
  `duration_s` display value changes.
- **Presets-are-generated rule** — applies to the **proposal** presets
  (`scripts/preset_standalones.json`); route presets under `routes/presets/` are
  hand-maintained extraction artifacts and are edited directly (duration only).
- **No algorithm changes.**

## 8. Verification (app/ only this round)

Environment: Docker for the running app (`docker-start.bat`); local pytest via
Anaconda 3.12.7 with `PYTHONPATH=app/api`, `PYTHONIOENCODING=utf-8` (Docker/uv
unavailable locally, per project memory). Known: the full backend suite has ~26
pre-existing failures — judge against that baseline, don't claim "fully green."

1. **Scenario load/validation** — the 3 new scenario files parse as `ScenarioDef`
   and are served by `GET /api/scenarios`. Confirm whether any test asserts a
   scenario **count** (glob-based discovery expands automatically; a hard count
   literal, if present, is maintenance like the preset-count guards).
2. **Calibration** — harness output: UC-01-01 completes at ~90 min (±1 tick),
   UC-01-02 at ~60 min (±1 tick).
3. **Case schema validation** — the combined-case schema test still passes for
   all three edited case files.
4. **Backend + frontend tests** — run the suites; new failures (vs. the known
   baseline) must be explained and fixed.
5. **Docker app spot-check** — open the combined screen; for each case confirm
   (a) the displayed route duration reads ~90 / ~60 / unchanged, (b) the playback
   traversal length matches, (c) the rest proposal still fires and the case
   still tells its story.

## 9. Process

- **app/ first**, htmlapp deferred until owner review (owner instruction).
- **Every implementation and review task is executed in a subagent** (owner
  instruction). Brainstorming/clarification with the owner is done directly; all
  file edits, calibration runs, and review passes are delegated.

## 10. Artifacts summary

| Artifact | Path | New/edit |
|---|---|---|
| UC-01-01 scenario | `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json` | new (copy + speeds + jams) |
| UC-01-02 scenario | `scenarios/uc01_fatigue_recovery_commuter_v0_1.json` | new (copy + speeds + jams) |
| UC-04-01 scenario | `scenarios/uc04_night_longhaul_v0_1.json` | new (pure copy + rename) |
| UC-01-01 preset duration | `routes/presets/uc01_01_minatomirai_odawara.json` | edit `duration_s` 4003→5400 |
| UC-01-02 preset duration | `routes/presets/uc01_02_nagoya_inuyama.json` | edit `duration_s` 2328→3600 |
| UC-01-01 case ref | `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` | edit `scenario_ref` |
| UC-01-02 case ref | `combined_contracts/test_cases/case-uc01-02-commuter-b.json` | edit `scenario_ref` |
| UC-04-01 case ref | `combined_contracts/test_cases/case-uc04-01-longhaul-d.json` | edit `scenario_ref` |

## 11. Risks

1. **Calibration interaction.** Time-based jam windows vs. distance-based
   segment boundaries mean route time isn't a closed-form of jam-minutes; the
   harness resolves this empirically (±1 tick). Low risk — harness mirrors the
   real loop.
2. **Fire timing shift.** Slower speeds + jams lengthen the drive, which can move
   *when* the rest proposal fires. Acceptable (the fire still occurs within the
   longer drive); spot-check confirms each case still fires and reads coherently.
3. **Hidden scenario-count guard.** If a test pins the scenario file count, it's
   a one-line count-maintenance edit (like the preset-count guards) — surfaced in
   step 8.1, not assumed.
4. **htmlapp parity drift (deferred).** New scenarios + preset-duration changes
   must later be mirrored into the htmlapp data seam; out of scope this round and
   flagged for the follow-up.
