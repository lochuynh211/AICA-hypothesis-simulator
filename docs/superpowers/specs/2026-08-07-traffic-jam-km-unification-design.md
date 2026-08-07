# Design: Unify all traffic jams on the km (position) axis

**Branch:** fixbug-0806
**Date:** 2026-08-07
**Scope:** `app/` (backend + frontend) only. `htmlapp/` port deferred until user review.
**Status:** approved (pending written-spec review)

## Problem

A traffic jam is fundamentally a *place* on the route, but the codebase models
it as a *time window* (`TrafficEvent.start_min` / `duration_min`). Routes are not
time-linear in distance (segment speeds vary; auto-rest stops the clock without
advancing distance), so any km↔time conversion via a uniform ratio distorts
where the jam actually bites.

This distortion was the root cause of the original fixbug-0806 bug: a jam painted
in km (RouteConditionsPainter) was forced through the time-native `TrafficEvent`
with a naive `(km/total_km) * est_duration_min` conversion, so it bit over the
wrong km stretch, producing a wrong preview chart and wrong trigger recompute.

That bug is already fixed for **painter-injected** jams (km fields added to
`TrafficEvent`, `_active_traffic_jam` gates on `distance_km`, preview emits
`from_frac`/`to_frac`). But the **scenario preset** jams in 4 JSON files are still
authored in minutes — the representation is now split-brained. This design makes
km the single source of truth for jams everywhere.

## The 4 affected scenarios (facts)

| Scenario | Jam window (min) | `affected_segment_id` | total_km |
|---|---|---|---|
| `uc03_01_monotony_daytime_jam` | 0–200 (whole drive) | `seg_jam` (5.4–174.6 km) | 180 |
| `uc02_monotony_v0_1` | 5–11 (early highway) | `seg_highway` (9.6–160 km) | 160 |
| `uc01_fatigue_recovery_commuter_v0_1` | 7–37 | `manual` (no anchor) | 120 |
| `uc01_fatigue_recovery_oshikatsu_v0_1` | 18–48 | `manual` (no anchor) | 120 |

The other two UC-01 scenarios have empty `traffic_events`. Two jams anchor to a
named segment; two are pure-minute with no geometric anchor — so conversion is
**not** a mechanical segment snap.

## Conversion basis (decided): preserve current behavior

Convert each existing minute-window to km via the **real** (jam-active, as-is-today)
progress curve, NOT the naive uniform ratio and NOT a segment re-anchor. This keeps
trigger/fire behavior ~identical — a coherence refactor, not a behavior change.

## Design

### 1. Schema — `TrafficEvent` (`app/api/aica_api/models/run.py`)

Make `start_min` and `duration_min` **optional** (`float | None = None`);
`start_km`/`end_km` already exist (optional). Both pairs retained: the
Maps/route-preset path and the painter's fallback still emit minutes, and a
Maps jam may have no km. A jam is valid with *either* a km pair or a time pair.
Gating already prefers km (`_active_traffic_jam`, done in the prior fix). No
change to `WeatherEvent` (still time-only — out of scope).

### 2. Scenario JSON conversion (behavior-preserved), via calibration script

Done once by a small dev script (follow the existing
`scripts/dev/calibrate_route_time.py` pattern):

1. For each of the 4 scenarios, run the preview **as it is today** (time-gated
   jam active).
2. Record `min`/`max` of `distance_km` over exactly the ticks where the jam is
   currently active (`_active_traffic_jam` True).
3. Bake those as `start_km`/`end_km` in the scenario preset; **remove**
   `start_min`/`duration_min` from that preset's `traffic_events` entry.
   `id`/`affected_segment_id`/`speed_kph` stay; `affected_segment_id` becomes a
   display label only.

Because the jam slows the car identically in both the old (time-gated) and new
(km-gated) models and distance is monotonic in time, km-gating reproduces the
same set of jammed ticks → same triggers/fires. Verified by snapshotting each
scenario's fire count/positions before and after.

### 3. Display — derive minutes from km (`app/api/aica_api/services/preview.py`)

The trigger-only setup chart is on a **minute** axis and today reads
`ev.start_min`. Once scenario jams carry no minute fields, extend the
`traffic_jams` builder: when `start_km`/`end_km` are present, derive **both**

- `from_frac`/`to_frac` — `km / route_total_km` (already implemented), and
- `from_min`/`to_min` — by inverse-interpolating the real per-tick `progress`
  map (`km → frac → min`, first-crossing / linear interp between samples).

When km is absent (Maps / painter time-fallback jams), keep today's
`start_min`/`start_min+duration_min` path. One code path, both axes, one
km source of truth. The `progress` list is already accumulated per tick in the
same function, so no new tick pass is needed.

### 4. `merged_painter.jam_traffic_event` — no change

Already emits `start_km`/`end_km`. Leaves the vestigial
`start_min`/`duration_min` naive-conversion fallback in place (km wins at the
gate and now at display, so the minutes are harmless and the diff stays small).

### 5. Tests

- Update `TrafficEvent`-constructing tests for the new optionality (a km-only
  jam must validate).
- Add a `preview.py` test: a km-only jam yields `from_min`/`to_min` derived from
  the progress curve (not zero/None), and they match the km→frac→min inversion.
- Keep the existing km-gating and time-fallback `_active_traffic_jam` tests.
- Behavior-preservation check: assert each of the 4 scenarios' fire count is
  unchanged vs. a pre-refactor snapshot.

## Non-goals

- No change to `htmlapp/` (deferred to the mirror step after user review).
- No change to `WeatherEvent`.
- No segment re-anchoring of jams.
- No commits until the user explicitly commands; all backend+frontend fixes
  (original jam fix + this refactor) land in ONE commit as the htmlapp mirror
  reference.

## Risk / rollback

Lowest-risk path: km fields are additive and already gated; the only removals are
`start_min`/`duration_min` from 4 scenario presets, reversible by re-adding them.
The behavior-preservation snapshot guards against silent trigger drift.
