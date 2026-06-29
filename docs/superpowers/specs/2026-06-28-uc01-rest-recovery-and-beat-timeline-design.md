# UC-01 Rest & Recovery + Scenario Beat Timeline — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Branch:** `008-uc01-rest-recovery`

## 1. Summary

Complete the UC-01 **post-rest recovery flow** — a V1 acceptance criterion
(spec §5.2, §10.5) that was never implemented — and redesign the **Scenario
Beat Timeline** so it reads as a realtime narrative of the drive (start → urban →
highway → traffic jam → AICA alert → AICA proposes → driver selects rest →
wakefulness → rest spot → nap → karaoke → resume → destination) rather than a
spam of driver-state band changes.

Today `accept_rest` ends the run immediately and `apply_rest_recovery()` (already
implemented in `driver_model.py`) is **never called**. This feature makes rest a
real, staged, recoverable experience and surfaces it both in the cockpit
(picker + karaoke/sleep visuals) and in the left-panel beat timeline.

This is **one feature**, implemented in a single milestone (no sub-slices).

## 2. Goals / Non-goals

**Goals**
- `accept_rest` enters a multi-stage recovery sequence instead of completing.
- Driver picks a **recovery option** (from a per-scenario menu) and a **rest spot**.
- Recovery runs over multiple ticks (wakefulness → arrive → nap → after-nap
  content → resume) with `apply_rest_recovery` actually lowering drowsiness/fatigue.
- After recovery the run **resumes** and drives to the destination, still
  evaluated by the trigger algorithm.
- Fire-control suppresses duplicate rest proposals while guidance is active.
- A redesigned **Scenario Beat Timeline** = a pure projection over the trace +
  recovery phases, emitting one beat per status change.
- Recovery **visualization** (karaoke EQ bars + scrolling lyrics + sleep/dim),
  gated by motion state.

**Non-goals**
- Real audio playback. Visuals are display-only stand-ins.
- New algorithm packages. Recovery is engine/run-state, not a trigger algorithm.
- Changing the qualitative/boundary-binned trigger discipline.

## 3. Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Recovery fidelity | **Full** prototype fidelity (multi-stage, content menu) |
| Recovery options source | **Per-scenario JSON** (`recovery_options`), data-driven |
| Rest-spot source | **Hybrid:** Google Places when a maps key is present; scenario/route-defined spots as fallback; chosen spot **frozen into the run log** for deterministic replay |
| Recovery timing | **Multi-tick staged dwell** with progressive `apply_rest_recovery` |
| Engine architecture | **Approach A** — recovery plan frozen at selection, advanced by the existing deterministic tick loop as phases (single tick path, replay-safe) |

## 4. End-to-end flow

```
Driving ──▶ AICA alert ──▶ AICA proposes rest ──▶ [driver picks option + rest spot]
  │                                                   │
  │                                          ┌────────┴─────────┐
  │                                     postpone/decline     accept
  │                                          │                  │
  │                                  continue (cooldown     freeze recovery plan
  │                                  suppresses repeats)    (spot + staged content)
  │                                          │                  │
  ▼                                          ▼                  ▼
  └──── continue driving ◀── resume (refreshed) ◀── nap → karaoke ◀── arrive/STOP ◀── wakefulness audio (MOVING en route)
                                                          │
                                      drowsiness/fatigue recover (apply_rest_recovery)
  ▼
Destination (run completes)
```

**Motion state** governs content: `MOVING` = audio-only (no lyrics/visual);
`STOPPED` = visual content (lyrics/video/sleep) permitted.

## 5. Scenario data model — `recovery_options`

Each scenario declares its recovery menu. Recovery magnitudes reuse
`driver_profile.recovery_model` (`short_/long_rest_drowsiness/fatigue_recovery`).

```jsonc
"recovery_options": [
  {
    "id": "nap_karaoke",
    "label": { "ja": "仮眠後にカラオケ", "en": "Brief nap, then karaoke" },
    "rest_type": "long",
    "stages": [
      { "phase": "wakefulness", "content": "audio_karaoke", "motion": "MOVING" },
      { "phase": "nap",         "content": "sleep",         "motion": "STOPPED", "ticks": 3 },
      { "phase": "content",     "content": "video_karaoke", "motion": "STOPPED", "ticks": 2 }
    ]
  },
  {
    "id": "convenience_stretch",
    "label": { "ja": "コンビニで軽いストレッチ", "en": "Quick stretch at a convenience store" },
    "rest_type": "short",
    "stages": [
      { "phase": "content", "content": "stretch", "motion": "STOPPED", "ticks": 1 }
    ]
  },
  { "id": "postpone", "label": { "ja": "今は見送る", "en": "Postpone for now" }, "postpone": true }
]
```

- `content` values are display kinds the frontend maps to a visualization
  (`audio_karaoke`, `sleep`, `video_karaoke`, `stretch`, …).
- `wakefulness` stage has no `ticks` — it lasts until the car reaches the rest spot.
- `postpone` is a no-stop continuation (no stages, no waypoint).
- Schema validated at package/scenario load; an invalid `recovery_options`
  surfaces as a registry/validation error (never a silent default).

## 6. Backend (Approach A)

### 6.1 RunState `recovery` block (persisted)
```
recovery: {
  active: bool,
  option_id: str | null,
  rest_spot: { id, label, lat?, lng?, route_fraction } | null,  # frozen at selection
  phase: "proposed" | "wakefulness" | "arriving" | "nap" | "content" | "resuming" | null,
  stage_index: int,
  stage_ticks_remaining: int,
}
```

### 6.2 Action endpoint
Extend the body from `{action}` to `{action, recovery_option_id?, rest_spot?}`.
- **accept_rest** (with `recovery_option_id` + `rest_spot`): validate the option
  is in the scenario's `recovery_options` and the spot is well-formed; freeze them
  into `recovery`; set `status=playing`, `phase=wakefulness`. The run **resumes**.
- **postpone / decline**: run continues; set a fire-control cooldown (reuses the
  existing proposal-cooldown mechanism).
- **Back-compat (single rule):** the scenario's `recovery_options` determines the
  contract. If the scenario **declares** `recovery_options`, `accept_rest` MUST
  include a valid `recovery_option_id` + `rest_spot` (missing/invalid → 400). If
  the scenario declares **no** `recovery_options`, `accept_rest` keeps the current
  behavior (run → completed), so existing scenarios/runs/tests are unaffected.
  This is the same rule stated in §11.

### 6.3 `advance_tick` recovery handling
While `recovery.active` and `phase != resuming`:
- **wakefulness** — car MOVING toward `rest_spot.route_fraction`; on arrival →
  `phase=arriving`→`nap` (STOPPED).
- **nap / content** — car STOPPED; decrement `stage_ticks_remaining`; call
  `apply_rest_recovery` progressively (recovery magnitude spread across the nap
  ticks); advance `stage_index` through the option's stages.
- After the last stage → `phase=resuming` → car MOVING with recovered state →
  normal driving to the destination (still evaluated by the algorithm).

### 6.4 Fire-control
While rest guidance is active (`recovery.active`) or during a postpone cooldown,
suppress duplicate `REST_PROPOSAL` (runtime_workflow §7.2). Implemented by
passing a `rest_guidance_active` flag into the adapter context / suppressing the
fired proposal in `run_manager`, recorded in the trace as suppression.

### 6.5 Tick response additions
Extend the tick response (already carrying `route_fraction`, `distance_km`,
`speed_kph`) with `motion_state` (`MOVING|STOPPED`), `recovery_phase`, and
`active_content`, sourced from the evaluated `TickState` / `recovery` block.

## 7. Rest-spot selection (Places hybrid)

On a fired `REST_PROPOSAL`, the frontend requests candidates:
- **Maps key present** → backend-proxied **Places** search near the upcoming
  route (reuses the M4 proxy; key in-memory only, never persisted/logged).
- **No key** → scenario/route spots (`rest_facility` segment +
  `route_facts.rest_spot_positions`).

Driver picks one. The chosen `{id, label, lat?, lng?, route_fraction}` is sent
with the recovery action and **frozen into `run_state.recovery.rest_spot` and the
run log**. Replay reads the frozen spot → deterministic, even though the offered
list came from a live Places call.

## 8. Frontend

- **Recovery picker** — replaces the bare accept/decline overlay when a rest
  proposal fires: renders the scenario's `recovery_options` as cards, the
  rest-spot candidate list (Places or fallback), and Postpone/Decline. On select
  → `actRun(runId, "accept_rest", { recovery_option_id, rest_spot })`.
- **Recovery visualization** (the prototype's `recovery-vis`), gated by
  `recovery_phase` + `motion_state`:
  - `wakefulness` (MOVING) → audio indicator "♪ wakefulness audio" (no lyrics).
  - `nap` (STOPPED) → dim overlay + moon + floating Z's.
  - `content` (STOPPED) → karaoke EQ bars + scrolling lyrics (or stretch/video).
  Rendered over the map/cockpit. Plus a **MOVING/STOPPED motion badge**.
- **Map** — rest-spot candidate markers; chosen spot highlighted; car drives to
  it, dwells, then resumes (using the authoritative `route_fraction`).
- The action/store layer records the applied action so the beat timeline and the
  recovery UI can reflect it live.

## 9. Scenario Beat Timeline (the redesigned view)

A realtime, chronological list emitted **on status change**, current beat marked
**▶ now**, each with an elapsed-time stamp. A **pure projection** over the trace +
recovery phases — no new persistence.

| Beat | Source |
|---|---|
| 🏁 Start | tick 0 |
| 🛣️ Entered Highway / 🏙️ Urban / … | active route-segment type change |
| 🚥 Traffic jam | `is_traffic_jam` becomes active (surfaced in tick response) |
| ⚠️ AICA alert | `SOFT_WARNING` decision |
| ☕ AICA proposes rest | `REST_PROPOSAL` fires |
| 👉 Driver selects "nap + karaoke" | recovery action |
| 🚗 Wakefulness audio en route | `recovery_phase=wakefulness` |
| 🅿️ Arrived at rest spot | `recovery_phase=arriving` |
| 😴 Resting (nap) | `recovery_phase=nap` |
| 🎤 Karaoke after nap | `recovery_phase=content` |
| 🚙 Resumed, refreshed | `recovery_phase=resuming` |
| 🏁 Destination | run completes |

**Explicitly NOT** drowsiness-band changes — those are driver state
(`DriverStatus`), not scenario beats. Beat model: `{ id, tick_index, kind, icon,
label }`.

## 10. Testing

**Backend**
- Recovery state machine: accept → wakefulness → arrive → nap → content →
  resume → complete; correct phase/motion per tick.
- `apply_rest_recovery` actually lowers drowsiness/fatigue (short vs long).
- Fire-control: duplicate `REST_PROPOSAL` suppressed while guidance active;
  postpone cooldown.
- Determinism: replay from the frozen log reproduces the same recovery timeline.
- Tick-response fields (`motion_state`, `recovery_phase`, `active_content`).
- `recovery_options` schema validation (valid + malformed).
- A UC-01 scenario gains `recovery_options`; end-to-end run test.

**Frontend**
- Recovery picker: option + spot selection produces the correct action payload.
- Visualization gating by `recovery_phase` + `motion_state`.
- Motion badge reflects `motion_state`.
- Beat-timeline derivation: one assertion per beat kind, including recovery beats;
  drowsiness-band changes do NOT produce beats.
- Map rest-spot markers + chosen-spot highlight.

## 11. Risks & mitigations

- **Engine complexity / regressions** — recovery phases add branches to the hot
  tick path. Mitigation: keep recovery state in a dedicated `recovery` block,
  cover with state-machine tests, and gate all new behavior behind
  `recovery.active`.
- **Places non-determinism** — offered spots vary. Mitigation: freeze the chosen
  spot into the log; replay never calls Places.
- **Scope creep on visuals** — karaoke/sleep animation can balloon. Mitigation:
  lightweight CSS/SVG stand-ins, no audio, no media engine.
- **Back-compat** — existing scenarios without `recovery_options`. Mitigation:
  absent menu ⇒ rest falls back to the current accept = complete behavior
  (documented), so existing runs/tests are unaffected.
