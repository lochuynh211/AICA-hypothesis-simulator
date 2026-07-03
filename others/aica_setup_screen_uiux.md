# AICA Simulator — Setup Screen UX

**Goal.** A clean, balanced setup screen for choosing a scenario + algorithm, editing raw signals and
hyperparameters, and seeing the **effect of every change instantly** before opening the full animated
review. Replaces the old imbalanced 3-column (signals | algorithm | thin button).

**Companion doc:** the algorithm/raw-state re-design this UX presents (3 tiers, simulated signals,
compact Hybrid formulation) is in `others/aica_trigger_algorithms_math_comparison.md` (Part 2). Together
these two form the design input for the re-design feature.

## Layout — two editors + full-width instant-result strip

```
┌─ SCENARIO & SIGNALS ───────────────┬─ ALGORITHM  (formulation) ─────────────┐
│ Location  [Tokyo → Hakone ▾]       │ Package [Transparent Hybrid v0.1 ▾]    │
│ Preset    [Friend Drive ▾]         │                                        │
│                                    │ Features (← names link to signals)     │
│ ── FIXED ──                        │  drowsiness = drowsiness / 100         │
│  night          on                 │  driving_anomaly = anomaly_rate /[K 5] │
│  familiar route yes                │                                        │
│  child          yes            ✎   │ base_safety_risk =                     │
│ ── DYNAMIC ──                      │   [0.40]·drowsiness                     │
│  continuous drive   0 → …          │  +[0.25]·fatigue                       │
│  segment / motion / jam …          │  +[0.25]·driving_anomaly               │
│ ── SIMULATED (tier 3) ─── ⓘ        │  +[0.10]·env_load                      │
│  drowsiness   ~curve          ⓘ    │   → rest_required → suggest [0.60]      │
│  fatigue      ~curve          ⓘ    │                                        │
│  anomaly_rate seeded Poisson  ⓘ ✎  │ monotony_prevention = …                │
├────────────────────────────────────┴────────────────────────────────────────┤
│ INSTANT RESULT   ·  seed 42 🎲  ·  3 overrides            [ ▸ Open full run ] │
│  rest_required  ▁▂▃▄▅▆▇█▇▆   ┈┈┈┈ threshold 0.60 ┈┈┈┈                          │
│  ├── urban ──┼──── highway ────┼── rest ──┼──── highway ────┼── end ──┤        │
│              🔔 REST @29min          🅿️60km 💤nap+karaoke              🏁      │
│  → Fired: REST · gentle @ 29 min · peak 0.71 · auto-rest nap+karaoke · done 118m│
└──────────────────────────────────────────────────────────────────────────────┘
```

Two balanced editor panels on top; the instant-result timeline pinned across the bottom as a live,
static (no-animation) preview footer.

## Left panel — Scenario & Signals

- **Location → Preset → Scenario.** Choosing them fixes the raw signals for the run.
- **Signals grouped by tier** (matches the engine model):
  - **Fixed** — scenario constants (night, familiar route, child, weather, route).
  - **Dynamic** — observable dynamics (segment, motion, continuous-driving, speed, next-rest, jam).
  - **Simulated (tier 3)** — `drowsiness`, `fatigue`, `anomaly_rate`.
- **Show all signals, not just editable ones.** Editable signals carry a ✎ affordance; read-only ones
  are visible but muted (so the user sees the full input picture, not just the knobs).
- **Tier-3 explainers.** Each simulated signal has an **ⓘ** icon → popup explaining *how it is
  formulated*, in words. Examples:
  - `drowsiness` — *"accumulates over driving time; faster at night / on monotonous roads / in jams.
    Deterministic."*
  - `anomaly_rate` — *"rare lane-departure/steering-jerk events; fires more often as drowsiness rises.
    One seeded random stream — fully replayable from the run seed."*

## Right panel — Algorithm as *formulation* (not a knob list)

The panel **is the algorithm's math**, top-to-bottom — the transparent-hybrid philosophy made literal.

- **Features are shown as their definitions**, and feature names **cross-link to the left panel**
  (hover/click a name → highlights/scrolls to that signal). e.g. `drowsiness = drowsiness / 100`.
- **Hyperparameters are the editable coefficients inside the formulas** — inline `[0.40]` fields, not a
  detached slider list. You edit the number where it appears in the equation:
  `base_safety_risk = [0.40]·drowsiness + [0.25]·fatigue + …`.
- **Scores read down to their thresholds** (`→ rest_required → suggest [0.60]`), so the whole
  fire logic is legible in place.
- Sections collapse (base_safety_risk / rest_required / monotony_prevention / fire-control) to manage
  density.

## Bottom strip — Instant Result (live, static)

Runs the whole simulation headlessly on every edit (deterministic, ~ms for 240 ticks) and renders the
**outcome** — no animation, no cockpit.

- **Score curve + threshold line** — `rest_required_score` (smoothed) over time; you *see why* it fires
  where it does. Nudging a weight visibly lifts/lowers the curve and slides the crossing point.
- **Segment bands** — urban / highway / rest as the timeline background.
- **Markers** — 🔔 trigger fire point(s) (rest; monotony if it fires), 🅿️ rest spot(s), 💤 the
  **auto-chosen** rest option + recovery window, 🏁 completion.
- **Result line** — `Fired: REST · gentle @ 29 min · peak 0.71 · auto-rest nap+karaoke · done 118 min`,
  or the key negative case: **`No trigger — rest score peaked 0.48 (below 0.60)`**.
- **Config chip** — `seed 42 🎲` (re-roll re-draws the `anomaly_rate` events) · override count.
- **Open full run** — freezes exactly this and opens the detailed animated review screen.
- **Auto-chosen rest option** — the preview picks a default option so the run resolves end-to-end
  (recovery included) without input; the user changes it in the full review.

## Key interactions

| You change… | Updates |
|---|---|
| location / preset | left signals, timeline segments + events, whole result |
| a `[coefficient]` in the formulation | overrides chip, score curve, fire point on the timeline |
| an editable signal ✎ | affected features + result |
| the seed 🎲 | the `anomaly_rate` event pattern → `driving_anomaly` → result |

The loop: **edit → the bottom strip re-renders instantly → read the firing point → open full review only
for tick-by-tick detail.**
