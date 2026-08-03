# UC Demo Combined Test Cases — Design & htmlapp Increment

- **Date:** 2026-08-03
- **Author:** data-science review (customer demo prep)
- **Status:** design approved (approach), pending spec review
- **Branch (build):** `develop`
- **Downstream branch (consumes §11):** `026-htmlapp-combined-export`

## 1. Purpose & scope

Author **3 new combined test cases** for the merged/combined screen, derived
verbatim from 3 provided UC texts, to sit alongside the existing 6 (`case-c01`
… `case-c06`). These are the **primary customer-demo cases**.

Two deliverables:

1. **Build the data artifacts on `develop`** (Q4): 3 driver-profile presets, 3
   route presets, 3 combined test-case files, plus the authorized backend
   test-count edits — verified in the running app (Docker) with screenshots.
2. **This document** — which also carries the **htmlapp increment spec**
   (§11): what the (unfinished) combined-screen port on
   `026-htmlapp-combined-export` must add to render these 3 cases offline.

Out of scope: any change to the 3 algorithms; any app runtime code change
(the only code touched is 3 backend **test** files whose hard-coded preset
counts must move — explicitly authorized, §6).

## 2. Constraints honored

- **No algorithm changes.** Trigger (`nri_fatigue_score_v1`,
  `aica_transparent_hybrid_trigger_v1`), service
  (`aica_transparent_service_selector_v1`), content
  (`aica_transparent_content_selector_v1`) are used only as configured
  per-case (`algorithm_defaults`) and to calibrate inputs — never edited.
- **No app frontend/backend runtime code changes on `develop`.** New profiles
  are authored as **data specs** for the existing generator; new routes/cases
  are data files. The sole exception, pre-authorized, is the preset **count**
  assertions in 3 test files (§6).
- **BYO Google Maps key.** The key in `app/frontend/.env.local` is passed to
  the extraction script as a positional CLI argument only. It is never
  persisted, logged, printed, committed, or written into any output artifact.
- **Phase-1 discipline.** Combined test cases carry **no expected outcomes**;
  expectations come from human review. (The underlying *proposal presets* do
  carry machine-checked `expectation` contracts — that is a separate
  artifact, §5.)
- **Boundary-binned / qualitative trigger discipline** and **backend as source
  of truth** are unaffected — we only add inputs.

## 3. Catalog-fidelity decision (resolves Q1)

The content selector matches oshi by catalog `artist_id`. Verified against the
frozen catalog (`soundcharts-grounded-spotify-compatible-demonstration-seed-1042`,
300 tracks / 246 artists) with UTF-8-safe search:

| UC artist (text score /100) | In catalog? | `artist_id` / tracks |
|---|---|---|
| Snow Man (92 / 29) | **No** (nearest: "Brian Snow" 0 tracks, unrelated) | — |
| なにわ男子 (85) | **No** (no near match) | — |
| Mrs. GREEN APPLE (58) | Yes | `synthetic-artist-0120` / 4 |
| あいみょん / Aimyon (31) | Yes | `synthetic-artist-0176` / 3 |
| 松田聖子 / Seiko Matsuda (54) | Yes | `synthetic-artist-0136` / 3 |

**Rule:** register **only in-catalog favorites** as `oshi_artists`, converting
the 0–100 text score to `enthusiasm` (÷100, round to 0.1 step):

- Mrs. GREEN APPLE 58 → **0.6**; あいみょん 31 → **0.3** (UC-01-01)
- 松田聖子 54 → **0.5** (UC-03-01)

Absent idols (Snow Man, なにわ男子) are **display-only**: named in the persona
`narrative`/`preferences` of the combined case, never as `oshi_artists`. This
keeps the content proposal honest — every oshi shown as *driving* a
recommendation is one the algorithm can actually score.

## 4. The three cases — wiring

Case/preset/route ids are proposed; titles must be confirmed verbatim against
the source text (§12). Scenarios are **reused** (Q3) with `fixed_overrides`;
a new scenario is authored only if reuse cannot produce the intended
intervention (§8).

### 4.1 UC-01-01 / Cさん — oshi-katsu, hidden accumulated fatigue

- **case_id:** `case-uc01-01-oshikatsu-c`
- **Persona:** woman, early 20s; active oshi-katsu; sleep-deprived; low
  self-awareness of fatigue ("まだいける"). Display favorites: Snow Man (top,
  not scored), Mrs. GREEN APPLE, あいみょん.
- **profile_ref:** `preset-uc01-01-oshikatsu-c` (**new**, §5) — `age_band:20s`,
  `gender:female`, `oshi_mode:on`, oshi = Mrs. GREEN APPLE 0.6 + あいみょん 0.3,
  `usage_by_genre:{j-pop:high}`, light history on Mrs. GREEN APPLE tracks.
- **scenario_ref:** `uc01_fatigue_recovery_v0_1` (reuse)
- **route_preset_ref:** `uc01_01_minatomirai_odawara` (**new**) — Minatomirai
  Station 〒220-0012 → home near Odawara Castle 〒250-0014 (~1h30m, Sat).
- **fixed_overrides (committed; calibrated values in §12):** `initial_drowsiness:65`,
  `initial_fatigue:75`, `is_night:false`, `child_passenger:false`.
- **automatic_path:** `service_choice:rank_1`, `rest_response:accept`,
  `sleep_minutes` (nap) — she wants a nap + enjoyable oshi recovery content.
- **algorithm_defaults:** trigger `nri_fatigue_score_v1`, service/content as §2.
- **what_to_watch (bilingual):** does hidden high fatigue fire a rest proposal
  despite low self-awareness; is post-rest recovery content her oshi
  (Mrs. GREEN APPLE)?

### 4.2 UC-01-02 / Bさん — efficiency-focused night commuter

- **case_id:** `case-uc01-02-commuter-b`
- **Persona:** man, early 30s; solo; post-overtime night drive; strong
  fatigue; "休憩＝時間ロス"; dislikes detours; accepts a low-burden seated
  3-minute stretch; likes familiar up-tempo songs / light humming karaoke.
- **profile_ref:** `preset-uc01-02-commuter-b` (**new**, §5) — `age_band:30s`,
  `gender:male`, `oshi_mode:off`, `oshi_artists:[]`, `usage_by_genre:{j-pop:high}`
  with listening history on a few up-tempo j-pop tracks ("familiar songs").
- **scenario_ref:** `uc01_fatigue_recovery_v0_1` (reuse; recovery option
  `convenience_stretch`).
- **route_preset_ref:** `uc01_02_nagoya_inuyama` (**new**) — Midland Square
  Nagoya 〒450-0002 → home near Inuyama Station 〒484-0085 (~1h, shortest).
- **fixed_overrides (proposed):** `initial_fatigue≈72` (かなり高い),
  `initial_drowsiness≈40`, `is_night:true`, no jam. (Scenario `familiar_route`
  is already true.)
- **automatic_path:** `service_choice:rank_1`, `rest_response:accept`
  (the 3-minute convenience stretch).
- **algorithm_defaults:** trigger `nri_fatigue_score_v1`, service/content as §2.
- **what_to_watch:** is the proposed break low-burden and short (a convenience
  stretch, not a detour) for an efficiency-minded driver; is content familiar,
  low-effort (humming karaoke / up-tempo)?

### 4.3 UC-03-01 (1-1) / Aさん ＋ 娘Cさん — monotony in a daytime bay-area jam

- **case_id:** `case-uc03-01-monotony-a`
- **Persona:** woman, late 50s, driving with her adult daughter (C); monotony /
  漫然運転 in a Saturday-evening bay-area jam on a familiar monthly mall route.
  Display favorites: なにわ男子 (top, not scored), 松田聖子, Snow Man
  (daughter's influence, not scored).
- **profile_ref:** `preset-uc03-01-monotony-a` (**new**, §5) — `age_band:50s`,
  `gender:female`, `oshi_mode:on`, oshi = 松田聖子 0.5, `usage_by_genre:{j-pop:high}`,
  history on Seiko tracks. (Mirrors `preset-showa-nostalgia`'s Seiko oshi but
  at enthusiasm 0.5 per §3 and without its era/age override — see §5 note.)
- **scenario_ref:** `uc03_01_monotony_daytime_jam` (new — §8 fallback taken; `uc02_monotony_v0_1` reuse was insufficient, see §8).
- **route_preset_ref:** `uc03_01_funabashi_makuhari` (**new**) — LaLaport
  TOKYO-BAY 〒273-8530 → home near AEON Kaihin Makuhari 〒261-0021 (normally
  ~20min, ~45–50min in full 湾岸 congestion).
- **fixed_overrides (committed):** `is_night:false`, `child_passenger:false`,
  `multiple_passengers:true`. No `jam_range_km` override — the jam is embedded
  in the scenario (`bayshore_full_jam` event, start_min:0, duration_min:200).
  Initial fatigue ≈55 (light post-shopping fatigue, modelled in the scenario's
  `initial_state`); drowsiness stays low throughout.
- **automatic_path:** `service_choice:rank_1` only (no `rest_response` — the
  monotony proposal's acknowledge/decline action is not automated in this case).
- **algorithm_defaults:** trigger `nri_fatigue_score_v1` (same NRI trigger as
  the other 5 cases and UC-01-01/UC-01-02). The hybrid trigger was not needed:
  with `nri_fatigue_score_v1` the monotony+jam score accumulates to ~96 pts in
  [60,100) at ~36 min, firing `monotony_prevention` with monotony+jam ≈96% of
  the score and fatigue a light ~4% accelerant — never reaching the rest band
  (≥100). This achieves the monotony story cleanly. Using the same trigger as
  all other cases was a user-authorized calibration decision. Service/content as §2.
- **what_to_watch:** does monotony/漫然 fire in a *daytime* jam; does the
  proposal turn boredom into shared mother-daughter time; is content her
  in-catalog oshi (松田聖子)?

## 5. New proposal presets (data specs)

Presets are **generated, never hand-edited** — the source of truth is
`scripts/generate_presets.py`, which reads compact specs from
`scripts/preset_standalones.json` (standalones) and regenerates
`proposal_contracts/presets/*.json` idempotently (a golden test pins output).

**Plan:**

1. Add 3 standalone spec entries to `scripts/preset_standalones.json`
   (`preset-uc01-01-oshikatsu-c`, `preset-uc01-02-commuter-b`,
   `preset-uc03-01-monotony-a`), each with `situation`, `profile`, and an
   `expectation` contract. Set `contrast_with: null` (so the "exactly 4
   contrast pairs" test is untouched). The generator's `strong_oshi` /
   `rich_on` helpers resolve oshi tracks against the frozen catalog; the
   multi-oshi list for UC-01-01 (0.6 / 0.3) is authored explicitly rather than
   via `strong_oshi` (which assumes a single artist at 1.0).
2. Regenerate: `cd app/api && uv run python ../../scripts/generate_presets.py`
   (locally: Anaconda Python 3.12.7 with `PYTHONPATH=app/api`, since Docker/uv
   are unavailable in this environment — see §10).
3. **Calibrate** each `expectation` against the real selectors using
   `scripts/preset_eval.py` (`PE.load_presets()`, `PE.evaluate_all()`), the
   same evaluator `test_presets_expectations.py` asserts over. Iterate the spec
   until: the top content item is the intended oshi track, the declared
   `top_fit_min` is met, `expected_service.top_should_be_in` holds, and gradient
   is consistent.

**Note on UC-03-01 vs `preset-showa-nostalgia`:** the existing Seiko preset
raises the age/oshi hierarchy weight via a per-preset `algorithm_config_overrides`
to force an era flip. UC-03-01 does **not** need that (it is a monotony/oshi
demo, not an era-contrast), so the new preset omits the override and uses
enthusiasm 0.5. `override_required` in its expectation will be `false`.

These preset `driver_profile`s are what the combined cases consume via
`profile_ref` (resolved by `getPreset()` in `useCaseSelection.ts:95`); the
preset `expectation` blocks are for the standalone proposal-preset harness only.

## 6. Backend test-count edits (authorized)

Adding presets to the committed set trips these hard-coded guards. All are
count/id maintenance — the standard action when the preset set grows — and are
pre-authorized:

| File / line | Change |
|---|---|
| `app/api/tests/proposal/test_presets_expectations.py:32` | `assert len(_PRESETS) == 35` → `== 38` |
| `app/api/tests/proposal/test_ep_presets.py:31` | `assert len(presets) == 35` → `== 38` |
| `app/api/tests/proposal/test_preset_store.py:42` | `assert len(summaries) == 35` → `== 38` |

**`_EXPECTED_PRESET_IDS` needs no edit.** In both `test_ep_presets.py:18` and
`test_preset_store.py:25` it is a filesystem glob
(`{p.stem for p in _PRESETS_DIR.glob("preset-*.json")}`) that auto-expands when
the 3 new JSONs are committed; the `ids == _EXPECTED_PRESET_IDS` and
`parametrize` uses follow automatically. `test_preset_generation.py` (golden)
re-pins on regenerate. `test_contrast_pairs_declared` (`== 4`,
`test_presets_expectations.py:57`) stays valid because new presets set
`contrast_with: null`. The strong-fit set (`test_presets_expectations.py:76-79`)
is a hard-coded 4-id set the new presets are **not** added to. No production
code is edited — only the three count literals above (pre-authorized).

## 7. Route extraction (resolves Q2 — run now)

1. Append 3 entries to the `ROUTES` list in
   `scripts/extract_route_presets.py`:

   | id | start | end | avoid |
   |---|---|---|---|
   | `uc01_01_minatomirai_odawara` | みなとみらい駅 (〒220-0012 神奈川県横浜市西区みなとみらい３丁目５) | 小田原城 付近 (〒250-0014 神奈川県小田原市城内６１) | none |
   | `uc01_02_nagoya_inuyama` | ミッドランドスクエア (〒450-0002 愛知県名古屋市中村区名駅４丁目７１) | 犬山駅 付近 (〒484-0085 愛知県犬山市犬山西古券６０６０) | none |
   | `uc03_01_funabashi_makuhari` | ららぽーとTOKYO-BAY (〒273-8530 千葉県船橋市浜町２丁目１１) | イオン海浜幕張 付近 (〒261-0021 千葉県千葉市美浜区ひび野１丁目３) | none |

2. Run: `python scripts/extract_route_presets.py <KEY>` where `<KEY>` is read
   from `app/frontend/.env.local` at invocation time and passed as the CLI
   argument only. Output → `routes/presets/<id>.json` (Directions + Places
   Nearby, stdlib urllib).
3. **Key hygiene:** the key never appears in committed files, logs, or the
   document. Command is constructed so the key is not echoed.

## 8. Scenario reuse & fallback (resolves Q3)

Reuse first: `uc01_fatigue_recovery_v0_1` for UC-01-01 and UC-01-02;
`uc02_monotony_v0_1` was the candidate for UC-03-01. During in-app verification
(§10), confirm each case produces the intended intervention:

- UC-01-01 / UC-01-02 → REST_PROPOSAL (fatigue) with the right recovery option.
  Reuse confirmed: `uc01_fatigue_recovery_v0_1` works for both.
- UC-03-01 → MONOTONY_PROPOSAL in a **daytime** jam using `nri_fatigue_score_v1`.

**Fallback taken for UC-03-01:** `uc02_monotony_v0_1` reuse was insufficient.
The existing `uc02_monotony_v0_1` scenario's driver-signal parameters
(`traffic_jam_add_per_min=0.02`, normal fatigue start) could not produce a
monotony fire in [60,100) within the 6.9 km Funabashi-Makuhari route without
either reaching the rest band (≥100) or never firing at all, given the very
short drive time at the intended jam speed. A new scenario
`uc03_01_monotony_daytime_jam` was authored (scenarios/ root), tuned to:
`traffic_jam_add_per_min=0.10` (models jam-borne irritation), `initial_state.fatigue_level=55`
(light post-shopping fatigue), `traffic_jam_kph:8`, a full-route jam event
embedded in the scenario (eliminating the need for a `jam_range_km` override in
the test case). This fires `monotony_prevention` at ~tick 12 (~36 min) with
NRI score ≈96 pts, safely within [60,100). No fallback was needed for
UC-01-01/UC-01-02.

## 9. Combined test-case files

Write `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json`,
`…/case-uc01-02-commuter-b.json`, `…/case-uc03-01-monotony-a.json`, each
conforming to `combined_contracts/schema/combined_test_case.schema.json`
(pytest validates every committed file). Required blocks: bilingual
`title`/`brief`/`what_to_watch`, `persona` (with `profile_ref`), `journey`
(scenario/route/seed/tick_seconds/fixed_overrides/automatic_path),
`algorithm_defaults`. `seed`: 42; `tick_seconds`: 180 (matching existing
cases). No expected outcomes (§2). The combined screen auto-loads them via
`import.meta.glob('@contracts/test_cases/case-*.json')`.

## 10. Verification (on `develop`)

Environment (per project memory): Docker/uv unavailable for backend tests here;
use Anaconda Python 3.12.7 with `PYTHONPATH=app/api`. `pydantic 2.8.2` and the
proposal models import cleanly; `preset_eval.py` runs headlessly.

1. **Preset calibration** — `preset_eval.py` until each new preset's
   `expectation` passes.
2. **Backend tests** — `test_presets_expectations.py`, `test_ep_presets.py`,
   `test_preset_store.py`, `test_preset_generation.py`, and the combined
   test-case schema-validation test.
3. **App verification** — bring up the stack (`docker-start.bat`; stop with
   `docker-stop.bat`), open the combined screen at `http://localhost:5180`,
   select each of the 3 cases, and confirm the trigger/service/content
   behavior matches the story. Capture screenshots for the demo.

## 11. htmlapp increment (spec for `026-htmlapp-combined-export`)

The offline htmlapp ports the backend to TypeScript. Verified on disk: the
combined-screen layer is **wholesale absent** from htmlapp today — there is no
`caseCatalog`/`caseResolver`/`useCaseSelection`, no `getPreset`/proposal seam,
no `proposalStore`, no service/content selectors, no synthetic catalog, no
`@contracts` alias, and no `case-*.json` glob. Only the two **trigger** packages
(`nri_fatigue_score_v1`, `aica_transparent_hybrid_trigger_v1`, both TS-ported)
and the single `uc01_fatigue_recovery_v0_1` scenario are bundled. So this
increment is not "3 tweaks on a working combined screen" — it is the data +
seam list that branch `026-htmlapp-combined-export` must build for these cases
to render offline. Items marked *(shared)* are prerequisites the existing 6
cases also need, listed because they are not yet present.

The 3 new cases and their exact artifacts are:
- **Routes:** `routes/presets/uc01_01_minatomirai_odawara.json`,
  `routes/presets/uc01_02_nagoya_inuyama.json`,
  `routes/presets/uc03_01_funabashi_makuhari.json`
- **Presets (driver profiles):** `preset-uc01-01-oshikatsu-c`,
  `preset-uc01-02-commuter-b`, `preset-uc03-01-monotony-a`
- **Cases:** `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json`,
  `combined_contracts/test_cases/case-uc01-02-commuter-b.json`,
  `combined_contracts/test_cases/case-uc03-01-monotony-a.json`

1. **Routes.** Copy the 3 extracted route files (`uc01_01_minatomirai_odawara.json`,
   `uc01_02_nagoya_inuyama.json`, `uc03_01_funabashi_makuhari.json`) from
   `routes/presets/` into `htmlapp/frontend/src/data/routes/`, then register
   each in `htmlapp/frontend/src/data/routes/index.ts` (import + append to
   `DEFAULT_ROUTE_PRESETS`). The extracted JSON shape already matches the
   `RoutePreset` type there (`raw_route`, `places`, `route_source`). No
   auto-sync exists — this copy is manual.
2. **Scenarios.** UC-03-01 requires `uc03_01_monotony_daytime_jam.json`
   (new scenario, committed to `scenarios/`) bundled in
   `htmlapp/frontend/src/data/scenarios/` and registered in that dir's `index.ts`.
   Additionally, *(shared)*: the existing `case-c03` also needs
   `uc02_monotony_v0_1.json` bundled there — it is not present today.
   Both scenarios must be added. Only `uc01_fatigue_recovery_v0_1` is bundled today.
3. **Driver-profile resolution for combined cases.** The combined screen
   resolves `persona.profile_ref` via a `getPreset()`-equivalent returning
   `world.driver_profile`. The htmlapp `client.ts` seam has no preset/proposal
   method yet. The port must expose a preset lookup and bundle the 3 new
   presets' `driver_profile`s (and, *(shared)*, the presets the existing cases
   reference) so `LOAD_PROFILE` resolves offline.
4. **Combined case files.** Ensure the combined screen's
   `import.meta.glob('@contracts/test_cases/case-*.json')` (or the htmlapp
   equivalent) includes the 3 new case files (`case-uc01-01-oshikatsu-c.json`,
   `case-uc01-02-commuter-b.json`, `case-uc03-01-monotony-a.json`). If htmlapp
   bundles a copy rather than aliasing `combined_contracts/`, copy them in.
5. **Service + content selectors + catalog** *(shared)*. htmlapp currently
   bundles only the two trigger packages (`nri_fatigue_score_v1` and
   `aica_transparent_hybrid_trigger_v1`) under `data/packages/builtin/`. The
   combined port must also bundle the service selector
   (`aica_transparent_service_selector_v1`) and content selector
   (`aica_transparent_content_selector_v1`) logic plus the synthetic catalog +
   `genre_affinity_v1` so proposals score offline.
   **Trigger note:** all 3 new cases (`case-uc01-01-oshikatsu-c`,
   `case-uc01-02-commuter-b`, `case-uc03-01-monotony-a`) use
   `nri_fatigue_score_v1` — already TS-ported and bundled in htmlapp. No new
   trigger package is required for these 3 cases. The
   `aica_transparent_hybrid_trigger_v1` package remains bundled for the existing
   6 cases but is not used by any of the 3 new cases.
6. **No algorithm-logic changes.** The TS ports must remain byte-parity with
   the Python algorithms; this increment only adds data + wiring.

## 12. Open items to confirm

- **Exact case titles.** *(Resolved)* Committed titles: UC-01-01: `UC-01-01 Cさん（20代前半女性）`
  / `UC-01-01 Ms. C (woman, early 20s)`; UC-01-02: `UC-01-02 Bさん（30代前半男性）`
  / `UC-01-02 Mr. B (man, early 30s)`; UC-03-01: `UC-03-01（1-1） Aさん（50代後半女性）＋娘Cさん`
  / `UC-03-01 (1-1) Ms. A (woman, late 50s) with her daughter C`.
- **Final preset/case/route ids.** *(Resolved)* Ids as proposed in §4 are
  confirmed in the committed artifacts.
- **Proposed `fixed_overrides` numbers.** *(Resolved)* Final calibrated values
  are committed in the case JSONs: UC-01-01: `{initial_drowsiness:65, initial_fatigue:75, is_night:false, child_passenger:false}`;
  UC-01-02: `{initial_drowsiness:78, initial_fatigue:88, is_night:true, child_passenger:false}`;
  UC-03-01: `{is_night:false, child_passenger:false, multiple_passengers:true}`.
  UC-03-01's trigger choice is also resolved: `nri_fatigue_score_v1` (§4.3, §8).
```
