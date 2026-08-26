# UC-05-01 — Forecast-trigger early rest before a heavy jam (Ms. C): demo & calibration design

- **Date:** 2026-08-25
- **Branch:** `nri-forecast-rest-0824`
- **Status:** DESIGN — awaiting user review before writing the implementation plan
- **Type:** Architectural (new master preset + data artifacts + calibration harness + htmlapp data mirror; no algorithm change)

---

## 1. Goal & intent

The `nri-forecast-rest-0824` branch adds **forecast-based early rest** to
`nri_fatigue_score_v1`: `REST_FORECAST_FIRE` fires in the `(threshold_forecast_rest,
threshold_fire)` band when the projected score-100 crossing has **no actionable rest
spot** but the **current** spot is still actionable. The feature is complete and its
live/preview seam (the `python_module.dispatch()` `nri_forecast` forward) is fixed, so a
real run now actually exercises the path.

We need a **purpose-built demo case** that makes the difference between the forecast
("new") and non-forecast ("old") algorithm visible and measurable, and we need to
**confirm the untouched `htmlapp` still reproduces the old behavior**. `htmlapp` has zero
forecast code, so it *is* the old algorithm by construction — that makes it the natural
control.

**Narrative (Ms. C, early-20s woman — the UC-01-01 persona, reused).** Driving
Minatomirai → Gotemba Premium Outlets, almost entirely on the Tomei expressway (rest
spots are sparse on a highway, which is what makes the timing bite). A heavy jam sits on
the expressway. In the **old** algorithm the rest proposal fires *after* she has already
passed the last comfortably reachable SA/PA, so the spot it points her at is ~60 minutes
away through the crawl. In the **new** algorithm the forecast fires *early*, while a
pre-jam SA/PA is still reachable, giving her a chance to rest before the jam.

**Success = the same route + scenario + driver, evaluated under two hyperparameter sets,
produces a clean, legible timing divergence, and htmlapp reproduces the old side
tick-for-tick.**

---

## 2. Old vs new — the mechanism (RESOLVED: "old fires late with a useless spot")

Old and new differ **only in hyperparameters** — same route, scenario, driver profile,
and package. Two named sets:

| Set | `threshold_forecast_rest` | `rest_spot_eta_filter_min` | Behavior |
|-----|---------------------------|----------------------------|----------|
| **NEW** | `65` | `30` | Forecast on (`order_valid`: `60 < 65 < 100`). Fires `REST_FORECAST_FIRE` early while the pre-jam SA/PA is ≤30 min (`spot_actionable`), because the projected 100-crossing has no actionable spot (`forecast_future_rest_unactionable`). These are the **current NRI manifest defaults.** |
| **OLD** | `100` | `90` | Forecast off (`threshold_forecast_rest == threshold_fire` → order invalid → classic ≥100 behavior). Filter relaxed to `90` so the ~60-min-away post-jam spot **passes** the `rest_spot_reachable` actionability guard, letting the ordinary rest fire land at the score-100 crossing **proposing a spot ~60 min out**. |

**Why the filter must move for OLD (the user's correction).** The `rest_spot_eta_filter_min`
gate (`algorithm.py:542`, read from `hp["rest_spot_eta_filter_min"]`) applies to *both*
paths. If OLD kept `eta=30`, the ordinary ≥100 fire would be **suppressed** at the crossing
(post-jam spot 60 min > 30), and OLD would say nothing until the crawl brings a spot within
30 min. To demonstrate "old fires, but the rest is 60 minutes away," OLD must relax the
filter so the far spot is considered reachable. Hence **two knobs differ**, and the demo
must label OLD honestly as "classic threshold fire + permissive spot search."

**Timing divergence the calibration targets:**

```
NEW (forecast=65, eta=30):  ~min N     REST_FORECAST_FIRE -> pre-jam SA (reachable, useful)
OLD (forecast=100, eta=90): ~min N+~15 REST fire          -> post-jam spot ~60 min away (useless)
```

**Where the sets are applied — NOT baked into the master preset.** `resolveCase`
(`app/frontend/src/lib/review/caseResolver.ts:45`) maps a master preset into
route + scenario + profile + package-**ids** + seed/tick + initial states + context +
painted jam range only. It touches **no trigger hyperparameters**; those come from the
package manifest defaults and are edited at setup via the `HyperparameterEditor`. So:

- **Calibration harness (oracle):** applies NEW and OLD programmatically as hyperparameter
  dicts to `adapter.evaluate(...)`. Fully automated, no UI, no preset field.
- **App UI:** a plain click on UC-05-01 uses manifest defaults = **NEW** (forecast early
  fire out of the box). To see OLD, the reviewer sets `threshold_forecast_rest=100`,
  `rest_spot_eta_filter_min=90` in the hyperparameter editor at setup (documented demo
  script step).
- **No new package, no schema change.** The master preset stays neutral.

---

## 3. Data artifacts (four new files, cloned from UC-01-01)

1. **Route preset** — `routes/presets/uc05_01_minatomirai_gotemba.json`
   `route_source: "maps"`; real baked polyline + real Tomei SA/PA `places` from a keyed
   Google Directions + Places fetch (see §4). Start = Minatomirai; end = 御殿場プレミアム・
   アウトレット (Gotemba Premium Outlets); highway-preferring.

2. **Scenario** — `scenarios/uc05_01_forecast_jam_v0_1.json`
   Clone of `uc01_fatigue_recovery_oshikatsu_v0_1.json`. Keep `type: "uc01_fatigue"` (so
   the NRI package's `compatible_scenario_types` still accepts it). Carries the calibrated
   jam in `presets.traffic_events` (`start_km`/`end_km`/`speed_kph`) and
   `presets.total_route_distance_km` set to the real route distance. `speed_profile`
   (`highway_kph 80`, `traffic_jam_kph 10`) unchanged unless calibration needs it.

3. **Driver profile** — `proposal_contracts/presets/preset-uc05-01-forecast-c.json`
   Clone of `preset-uc01-01-oshikatsu-c.json` (Ms. C, 20s female, oshi = Mrs. GREEN APPLE).
   Situation may be tuned so initial drowsiness/fatigue place the score in the pre-jam band
   at the right position.

4. **Master preset** — `combined_contracts/test_cases/case-uc05-01-forecast-jam-c.json`
   Bundles the three refs above + `algorithm_defaults` (`nri_fatigue_score_v1`,
   `aica_transparent_service_selector_v1`, `aica_transparent_content_selector_v1`).
   `journey.fixed_overrides` carries `initial_drowsiness`/`initial_fatigue` (calibrated) and
   `is_night:false`; `automatic_path` accepts the rest. New `case_id`, `persona_id`, JA/EN
   title/brief/what_to_watch describing the forecast-vs-jam story.

---

## 4. Route source — real maps fetch (BYO key)

Add a `uc05_01_minatomirai_gotemba` entry to the `ROUTES` list in
`scripts/extract_route_presets.py` (start = Minatomirai station coords; end = Gotemba
Premium Outlets coords; highway-preferring, `avoid=None`). The user runs
`python scripts/extract_route_presets.py --only uc05_01_minatomirai_gotemba` with their
Google key (read from `app/frontend/.env.local` `VITE_GOOGLE_MAPS_KEY=` or argv). The
script writes the real polyline + real SA/PA/道の駅/convenience `places` with
`distance_along_route_m`.

**BYO-key invariant:** the key is entered at runtime, **never shipped, persisted, logged,
or exported.** Only the resulting baked route JSON (no key) is committed. This is a
user-run step, not something the harness or CI does.

---

## 5. Jam calibration (the primary knob)

The demo hinges on the jam sitting in a **rest-spot gap** so that: (a) NEW's pre-jam SA/PA
is actionable (≤30 min) while the score is in the `(65,100)` band, and (b) by the score-100
crossing that spot is behind and the next spot is ~60 min away through the 10 kph crawl.

Free knobs, in order of preference:
1. **Jam `start_km`/`end_km`/`speed_kph`** in the scenario's `traffic_events` (position-native).
2. **Driver initial state** (`initial_drowsiness`/`initial_fatigue` in `fixed_overrides`) —
   moves *where along the route* the score enters the band and crosses 100.
3. `speed_profile` only if the real SA/PA spacing leaves no clean window.

Calibration is **empirical**, driven by the harness in §6: adjust knobs until the target
divergence in §2 holds, with the crossing landing in a genuine SA/PA gap on the real route.

**Risk:** the real Tomei SA/PA spacing may not offer a gap that yields a clean ~60-min
divergence at 10 kph. Mitigation: jam km/speed and driver initial state are all free; if no
real gap works, widen the jam or shift initial state. Documented as an open calibration
risk, resolved during implementation.

---

## 6. Calibration harness — `scripts/calibrate_forecast_demo.py`

A Python script (test-runner env: `PYTHONPATH=app/api python ...`) that is both the
**calibration oracle** and the **source of the htmlapp cross-check golden**.

**Part A — forecast on/off oracle (primary comparison).** Load the UC-05-01 route +
scenario + profile, run the deterministic tick loop (reusing `run_manager` / preview tick
machinery) twice against `nri_fatigue_score_v1`:
- NEW hyperparameters `{threshold_forecast_rest:65, rest_spot_eta_filter_min:30}`
- OLD hyperparameters `{threshold_forecast_rest:100, rest_spot_eta_filter_min:90}`

Emit, per run: the fire tick index, elapsed minutes, `states.rest`, `fire_control.reason`,
the proposed rest spot and its ETA. **Assert the §2 divergence** (NEW =
`REST_FORECAST_FIRE` before the jam with a reachable spot; OLD = ordinary rest fire at the
crossing with a ~60-min spot). This is the tick-by-tick calibration signal — iterate §5
knobs until it holds.

**Part B — Python↔htmlapp cross-check golden.** Capture the **OLD** run's per-tick
decision trace as a golden fixture in htmlapp's existing parity shape (the same shape
`capture_all.py` writes to `htmlapp/frontend/src/engine/__fixtures__/parity/`, e.g.
`nri_tick_by_tick.json`). htmlapp's vitest parity test replays its TS engine over the
UC-05-01 inputs **with the OLD hyperparameters** and must match the golden tick-for-tick.
Because htmlapp has no forecast code, it can only reproduce OLD faithfully — so the golden
is captured at OLD params, and the cross-check proves htmlapp == Python-OLD. (NEW/forecast
stays Python-only, covered by the oracle + existing forecast unit/parity tests.)

Prefer extending the existing `capture_all.py` mechanism over a bespoke node bridge.

---

## 7. htmlapp integration (data mirror only — algorithm byte-untouched)

Per the locked decision, UC-05-01 is **clickable in htmlapp too**, but htmlapp's algorithm
stays byte-identical (no forecast port):

- Copy the four UC-05-01 data artifacts into htmlapp's baked data
  (`htmlapp/frontend/data/**`) and rebuild `aica-data.json` / `aica-data.js` via the
  existing htmlapp build scripts (`build-data.mjs`, `data.manifest.mjs`,
  `sync-from-app.mjs` as appropriate).
- Add the UC-05-01 entry to `htmlapp/frontend/src/lib/review/caseCatalog.ts` (§8).
- A plain click in htmlapp uses the baked NRI manifest defaults (`eta=30`), so htmlapp's
  default click shows the *suppressed/late* old behavior; to reproduce the "old fires late
  with a 60-min spot" oracle exactly, the reviewer sets `eta=90` in htmlapp's hyperparameter
  editor. **Do not** change the shared htmlapp NRI manifest default (it would perturb
  UC-01-01 et al.). The faithful OLD reproduction is proven by the §6 golden parity test,
  which is hyperparameter-controlled and independent of UI defaults.

**Scope fence:** no forecast code enters `htmlapp/**`. Only data + caseCatalog + rebuilt
bundles.

---

## 8. Case catalog + order tests (4 → 5)

- Add the UC-05-01 entry to the comparator/catalog in **both**
  `app/frontend/src/lib/review/caseCatalog.ts` and
  `htmlapp/frontend/src/lib/review/caseCatalog.ts`, choosing its sort position among the
  existing four.
- Update **both** `case_catalog_order.test.ts` files (app + htmlapp) to assert the new
  five-case ordered list (currently they assert exactly four:
  `case-uc01-01-oshikatsu-c`, `case-uc01-02-commuter-b`, `case-uc03-01-monotony-a`,
  `case-uc04-01-longhaul-d`).

---

## 9. Acceptance criteria

1. Four UC-05-01 data artifacts exist and load without registry errors in the app.
2. `scripts/extract_route_presets.py --only uc05_01_minatomirai_gotemba` produces a real
   baked maps route (committed without any key).
3. `scripts/calibrate_forecast_demo.py` Part A asserts the §2 divergence and passes on the
   calibrated data.
4. The htmlapp parity golden (Part B, OLD params) is captured, and htmlapp's vitest parity
   test replays UC-05-01 under OLD hyperparameters and matches tick-for-tick.
5. UC-05-01 is clickable in both the app and htmlapp browsers; both catalog-order tests
   assert five cases and pass.
6. Clicking UC-05-01 in the app (manifest defaults) shows `REST_FORECAST_FIRE` before the
   jam; the documented OLD override reproduces the late useless fire.
7. No forecast/algorithm source changes; `htmlapp/**` algorithm bytes unchanged.

---

## 10. Out of scope / non-goals

- No change to `nri_fatigue_score_v1` algorithm or manifest defaults.
- No Hybrid package involvement; no forecast port to htmlapp.
- No new per-case hyperparameter schema field (old/new is applied at run time).
- Committing/merging the branch is a separate, user-authorized step (the branch remains
  uncommitted per the standing no-commit rule).

---

## 11. Open questions for user review

1. **Route endpoints/coords** for the keyed fetch — confirm Minatomirai start point and
   Gotemba Premium Outlets as destination, highway-preferring.
2. **Catalog sort position** of UC-05-01 among the existing four cases.
3. Whether the app-UI OLD run should be a **documented manual override** (current plan) or
   whether you'd rather I also expose a one-click "old" affordance (would require the
   per-case hyperparameter schema field this design otherwise avoids).
