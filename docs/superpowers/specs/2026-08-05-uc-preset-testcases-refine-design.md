# Refine combined-screen preset test cases — Design

- **Date:** 2026-08-05
- **Author:** data-science review (combined-screen preset refinement)
- **Branch (build):** `refine-preset-testcase`
- **Status:** design approved (user), pending spec review

## 1. Purpose & scope

Three refinements to the combined-screen experience test cases, requested by the
owner:

1. **Retitle** the 3 already-approved UC cases (`UC-01-01`, `UC-01-02`,
   `UC-03-01`) so their picker labels are self-explanatory.
2. **Author a new case `UC-04-01`**, derived from the existing `C-02`
   (long-distance night highway) but with an **oshi-mode driver**, refining its
   semantic detail into a coherent persona/story like the other 3 UC cases.
3. **Reorder** the picker so the four UC cases appear first, in the order
   `UC-01-01 → UC-01-02 → UC-03-01 → UC-04-01`, with the existing 6 `C-0x`
   cases below.

Out of scope: any change to the 3 algorithms (trigger / service / content); any
new route extraction (`UC-04-01` reuses `long_tokyo_osaka`).

## 2. Constraints honored

- **No algorithm changes.** Trigger (`nri_fatigue_score_v1`), service
  (`aica_transparent_service_selector_v1`), content
  (`aica_transparent_content_selector_v1`) are used only as configured and to
  calibrate inputs — never edited.
- **Frontend/backend edit protocol.** The one runtime code change (the picker
  reorder, §5) is made in `app/frontend` **first** for owner review, then
  mirrored into `htmlapp/frontend`. When mirroring, **parity-fixture
  regeneration is skipped** (owner instruction); some fixture tests may fail and
  are noted rather than chased.
- **BYO Google Maps key.** No route extraction is performed for this work; the
  key is not touched.
- **Phase-1 discipline.** Combined test cases carry **no expected outcomes**;
  the underlying proposal preset carries the machine-checked `expectation`
  contract (§4).
- **Boundary-binned / qualitative trigger discipline** and **backend as source
  of truth** are unaffected — we only add/relabel inputs.
- **Presets are generated, never hand-edited** — source of truth is
  `scripts/preset_standalones.json` + `scripts/generate_presets.py` (§4).

## 3. Retitle the 3 approved cases (+ the new one)

**Style:** situation descriptor + `（persona・demographic）`. Only the `title`
field of each case JSON changes; no other data.

| Case | JA | EN |
|---|---|---|
| UC-01-01 | `UC-01-01 推し活帰りの隠れ疲労（Cさん・20代前半女性）` | `UC-01-01 Hidden fatigue after a fan event (Ms. C, early-20s woman)` |
| UC-01-02 | `UC-01-02 夜間通勤・効率重視の短時間休憩（Bさん・30代前半男性）` | `UC-01-02 Night commute, an efficient short break (Mr. B, early-30s man)` |
| UC-03-01 | `UC-03-01（1-1） 日中の渋滞・親子の漫然運転（Aさん・50代後半女性＋娘Cさん）` | `UC-03-01 (1-1) Daytime jam, mother-daughter monotony (Ms. A, late-50s woman, + daughter C)` |
| UC-04-01 | `UC-04-01 夜間長距離・注意力低下と推しでの回復（Dさん・40代男性）` | `UC-04-01 Long night drive, attention decline & oshi recovery (Mr. D, 40s man)` |

Files touched: `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json`,
`…/case-uc01-02-commuter-b.json`, `…/case-uc03-01-monotony-a.json`, and the new
`…/case-uc04-01-longhaul-d.json` (§4).

## 4. UC-04-01 — the new case

**Concept.** Same situation as `C-02` — a long night Tokyo→Osaka highway drive
with drowsiness already elevated at departure and climbing as the monotonous
night drive wears on (this is how UC-04's "attention decline" theme is expressed
with the V1 signal set — see the honesty note below). The rest proposal fires
from that decline. The **difference from C-02** is that this driver has **oshi
mode ON**, so the *content* side changes: post-rest recovery content is his oshi
(Ado). It reads as "C-02, but oshi-ON changes what gets played."

**Honesty note.** The V1 algorithms have no dedicated "attention-decline"
signal. UC-04's spec theme (`docs/master`: gentle tone, cognitive-load-aware
dialogue) is expressed through rising **drowsiness** on a long monotonous night
highway — no algorithm change, and consistent with C-02's own mechanic. The
case is a demonstration of oshi-driven recovery content under a fatigue/rest
fire, not a claim that the algorithm models attention decline directly.

### 4.1 Driver-profile preset — `preset-uc04-01-longhaul-d` (new)

Generated from a new standalone spec in `scripts/preset_standalones.json`, then
`generate_presets.py`. Profile shape (mirrors the other UC oshi presets):

- `age_band: 40s`, `gender: male`, `oshi_mode: on`, `oshi_registered: true`
- `oshi_artists: [{ artist_id: synthetic-artist-0122 (Ado), oshi_type: artist,
  enthusiasm: ~0.7 }]` — **calibrated** (raised if needed, as the existing UC
  presets did — e.g. Mrs. GREEN APPLE landed at 0.9) so his oshi tops the
  ranking. Ado has **4 in-catalog tracks** — `synthetic-track-0121` (ギラギラ),
  `-0122` (踊), `-0130` (New Genesis), `-0135` (Show) — all high-energy /
  high-arousal, a natural "energize a fading driver" recovery pick.
- listening history on 2–3 Ado tracks: `catalog_item_usage_level: high`,
  `content_proposal_acceptance_rate` ≈95, `content_recovery_rate` ≈90.
- `usage_by_genre: { j-pop: high }`, `genre_affinity_v1_enabled: true`.
- neutral situation baseline (`drowsiness 40 / fatigue 28 / monotony 40`), same
  as the other UC presets — the combined case overrides it.

`expectation` contract (standalone proposal-preset harness only):
`expected_top.must_be_oshi: true`, `arousal_band: high`, top track credited to
Ado, `top_fit_min` calibrated via `preset_eval.py`, `gradient: none`,
`contrast_with: null`, `override_required: false`,
`expected_service.top_should_be_in: [music_playlist, humming_karaoke, radio_style]`.

**Note re: `synthetic-track-0130`.** Ado's New Genesis is `synthetic-track-0130`,
which is also one of the three "recently played" demotion tracks in
`preset-recently-played-fatigue` (C-02's profile). That coupling lives only in
that other preset's `played_items`; UC-04-01's profile is independent and does
not set `played_items`, so there is no recency penalty here. Left as history if
calibration prefers a different Ado track to top.

### 4.2 Combined case file — `case-uc04-01-longhaul-d.json` (new)

Conforms to `combined_contracts/schema/combined_test_case.schema.json` (pytest
validates every committed file). Blocks:

- `case_id: case-uc04-01-longhaul-d`, `schema_version: 1.0.0`, `version: 1.0.0`
- bilingual `title` (§3), `brief`, `what_to_watch`
- `persona`: Dさん — 40s male long-haul night driver, Ado fan;
  `profile_ref: preset-uc04-01-longhaul-d`
- `journey`:
  - `scenario_ref: uc01_fatigue_recovery_v0_1` (same fatigue/rest scenario as C-02)
  - `route_preset_ref: long_tokyo_osaka` (**reused**, already bundled)
  - `seed: 42`, `tick_seconds: 180`
  - `fixed_overrides: { initial_drowsiness: 60, initial_fatigue: 35,
    is_night: true, child_passenger: false }` — **identical to C-02**, so the
    only meaningful difference is the oshi profile
  - `automatic_path: { service_choice: rank_1, rest_response: accept,
    sleep_minutes: 20 }` — accepts the rest so post-rest oshi recovery content is
    exercised (C-02 only did `service_choice`)
- `algorithm_defaults: { trigger: nri_fatigue_score_v1,
  service: aica_transparent_service_selector_v1,
  content: aica_transparent_content_selector_v1 }`

`what_to_watch` (bilingual, draft): (1) long night drive で注意力が低下し休憩提案が
発火するか / whether attention declines on the long night drive and a rest proposal
fires; (2) 休憩後の回復コンテンツが推し（Ado）になるか / whether post-rest recovery
content is his oshi (Ado); (3) C-02（推しOFF）との対比でコンテンツ側がどう変わるか /
how the content side differs versus C-02 (oshi OFF) in the same situation.

### 4.3 Route

None authored — reuses `routes/presets/long_tokyo_osaka.json` (already used by
C-02 / C-05 / C-06, already bundled in htmlapp). No Maps API call.

## 5. Display ordering (the one runtime code change)

**Mechanism today.** The picker orders cases purely by
`case_id.localeCompare()` (`app/frontend/src/lib/review/caseCatalog.ts:78-80`;
htmlapp mirror at `caseCatalog.ts:150-154`). So `case-c01…c06` sort **above**
`case-uc*` because `'c' < 'u'`. The case JSON schema is strict
(`additionalProperties: false`), so an `order` field cannot be added to the JSON
— ordering must live in the comparator.

**Change (recommended).** Add an explicit priority list and sort by it, with the
existing `localeCompare` as the tiebreaker for everything not listed:

```ts
// Picker order: the four UC demo cases first, in this exact sequence; every
// other case (C-01…C-06) falls below, keeping case_id order among themselves.
const CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
]
const orderRank = (id: string): number => {
  const i = CASE_ORDER.indexOf(id)
  return i === -1 ? CASE_ORDER.length : i
}
// comparator: orderRank first, then localeCompare tiebreak
(a, b) => orderRank(a.case_id) - orderRank(b.case_id) || a.case_id.localeCompare(b.case_id)
```

**Rejected alternatives.** Renaming `case_id`s to force alpha order is
destructive — ids are referenced by tests, run/feedback logs, and the htmlapp
registry. A JSON `order` field is forbidden by the schema.

**Side effects (checked, no change needed).**
- Default case on mount is a hardcoded constant
  (`MergedShell.tsx:52 DEFAULT_CASE_ID = 'case-c01-alert-daytime-control'`),
  **independent of list order** — reordering does not change which case opens.
- No test asserts the current picker order (`use_case_selection.test.tsx` and
  `feedback_summary.test.ts` reference `case-c01` by id, not by position).

**Edit protocol.** Change `app/frontend/src/lib/review/caseCatalog.ts` first for
owner review. Then mirror the identical comparator into
`htmlapp/frontend/src/lib/review/caseCatalog.ts` — a PROTECTED, hand-maintained
re-implementation (its exported signatures/semantics must stay identical to
upstream; guarded by `RESTORE_FROM_GIT` in `scripts/sync-from-app.mjs`).

## 6. Backend test-count edit (authorized maintenance)

Adding one preset moves the committed count 38 → 39, tripping three hard-coded
guards. These are count maintenance, the standard action when the preset set
grows:

| File / line | Change |
|---|---|
| `app/api/tests/proposal/test_presets_expectations.py:32` | `== 38` → `== 39` |
| `app/api/tests/proposal/test_ep_presets.py:31` | `== 38` → `== 39` |
| `app/api/tests/proposal/test_preset_store.py:42` | `== 38` → `== 39` |

`_EXPECTED_PRESET_IDS` needs no edit (filesystem glob, auto-expands).
`test_contrast_pairs_declared` stays valid (`contrast_with: null`). The
golden generation test re-pins on regenerate. No production code is edited —
only the three count literals.

## 7. Verification

Environment (per project memory): Docker/uv unavailable for local pytest; use
Anaconda Python 3.12.7 with `PYTHONPATH=app/api`. Docker **is** available for the
running app via `docker-start.bat` / `docker-stop.bat`.

1. **Preset calibration** — regenerate presets
   (`generate_presets.py`); calibrate with `preset_eval.py` until UC-04-01's
   `expectation` passes (Ado tops, `must_be_oshi`, `top_fit_min`).
2. **Backend tests** — `test_presets_expectations.py`, `test_ep_presets.py`,
   `test_preset_store.py`, `test_preset_generation.py` (golden), and the
   combined test-case schema-validation test.
3. **Frontend** — the `app/frontend` picker-order change; run
   `use_case_selection` / `feedback_summary` / `review_case_card` tests.
4. **App verification (Docker)** — bring up the stack, open the combined screen,
   confirm: the picker order is `UC-01-01 → UC-01-02 → UC-03-01 → UC-04-01 →
   C-01…C-06`; the 4 retitled labels render correctly (JA/EN); UC-04-01 fires a
   rest and serves Ado recovery content, visibly contrasting C-02. Capture
   screenshots.
5. **htmlapp mirror** — after owner review of `app/`: mirror the comparator;
   bundle UC-04-01's case + preset `driver_profile` into the htmlapp data seam;
   `npm run build:data`. **Skip parity-fixture regeneration** (owner
   instruction); note any resulting fixture-test failures rather than chasing
   them.

## 8. Artifacts summary

| Artifact | Path | New/edit |
|---|---|---|
| UC-01-01 title | `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` | edit `title` |
| UC-01-02 title | `combined_contracts/test_cases/case-uc01-02-commuter-b.json` | edit `title` |
| UC-03-01 title | `combined_contracts/test_cases/case-uc03-01-monotony-a.json` | edit `title` |
| UC-04-01 case | `combined_contracts/test_cases/case-uc04-01-longhaul-d.json` | new |
| UC-04-01 preset spec | `scripts/preset_standalones.json` (entry) | edit |
| UC-04-01 preset | `proposal_contracts/presets/preset-uc04-01-longhaul-d.json` | new (generated) |
| Picker order | `app/frontend/src/lib/review/caseCatalog.ts` | edit (then mirror to htmlapp) |
| Preset counts | 3 backend test files (§6) | edit `38`→`39` |

## 9. Risks

1. **Preset calibration.** Ado at ~0.7 may not top without a small enthusiasm or
   history bump; iterate with `preset_eval.py` before committing (same loop the
   existing UC presets used).
2. **htmlapp comparator drift.** The mirror must stay byte-identical in
   semantics to upstream; the file is PROTECTED and restored from git on sync, so
   the mirror edit must be committed, not left to sync.
3. **Skipped parity fixtures.** Per instruction, fixture regeneration is
   deferred; some htmlapp parity tests may go red until a later full regenerate.
