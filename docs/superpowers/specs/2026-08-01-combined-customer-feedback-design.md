# Combined screen — customer feedback round 1

Branch: `025-combined-customer-feedback` (off `develop`)
Date: 2026-08-01

Three pieces of customer feedback on the Combined Simulator, plus one coupling
between them that the feedback did not name but that decides whether two of the
three requests can coexist.

---

## 1. Oshi artists — fix the setup, then make it a list with 熱狂度

### 1.1 The bug

The oshi-artist dropdown in the Combined screen's driver-profile editor cannot be
used: it renders, its `onChange` is correctly wired, and it has **no options**.

`PreferenceHistorySection` derives its artist list client-side from
`state.catalog` (`PreferenceHistorySection.tsx:41-49`), de-duplicated by artist
id. `state.catalog` is filled by exactly one dispatch site in the codebase —
`SET_CATALOG`, fired from the effect at `WorldPanel.tsx:130-140`.

`MergedShell` mounts its **own** scoped `ProposalStoreProvider`
(`MergedShell.tsx:196`) and reuses `PreferenceHistorySection` verbatim
(`MergedSetupPanel.tsx:1271-1276`), but never mounts `WorldPanel`. Nothing in the
merged tree calls `getCatalog()` or dispatches `SET_CATALOG`, so on that store
`state.catalog` stays at its initial `[]` (`proposalStore.ts:226`) forever.
`artists` memoizes to `[]`, and `worldFields.tsx:290-304`'s `artist_select` case
maps over nothing — leaving only the blank `—` placeholder.

This is a missing-wiring defect from the 020 exact-reuse extraction: the
component was extracted, its upstream data dependency was not.

**Fix.** Give the merged tree an effect equivalent to `WorldPanel.tsx:130-140`,
firing `getCatalog(dataset_id)` → `SET_CATALOG` on the scoped store once the
dataset id is known. This is a prerequisite for everything else in §1 — without
it the new editor has nothing to offer either.

### 1.2 Model

`DriverProfile.oshi_id` / `oshi_type` are replaced by a list. `oshi_registered`
and `oshi_mode` stay as the global on/off gate.

```python
class OshiArtist(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artist_id: str
    oshi_type: OshiType = OshiType.artist
    enthusiasm: float          # 0.0–1.0, step 0.1

oshi_artists: list[OshiArtist] = Field(default_factory=list)
```

- `enthusiasm` is validated to `[0.0, 1.0]` and to a 0.1 grid, matching the UI
  control exactly — a value the slider cannot produce must not be loadable from
  JSON either.
- Duplicate `artist_id` within one profile is a validation error.
- `oshi_type` moves inside each entry (it describes *that* oshi, and V1 only
  ever scores `artist`). `oshi_tags` stays top-level; it is context-only.

### 1.3 Scoring

`packages/aica_transparent_content_selector_v1/algorithm.py:350-357`, the `oshi`
leaf. The evidence gate `e` is unchanged in meaning:

```
e = 1.0 if (oshi_registered and oshi_mode == "on" and oshi_artists) else 0.0
a = max(enthusiasm of the driver's oshi credited on this track), else 0.0
```

`a` stays in `[0, 1]`, so no weight anywhere in the hierarchy needs retuning and
a single artist at 熱狂度 1.0 reproduces today's numbers **exactly**. Two oshi
credited on the same song do not stack — the strongest one decides, which keeps
"how much does this driver love this artist" the only thing 熱狂度 means.

The per-leaf trace entry keeps `exact_match` (now `bool(matched)`) and gains
`matched_artist_ids` and `enthusiasm`, so the review panel can say *which* oshi
matched and at what degree rather than just that one did.

### 1.4 UI

A new `oshi_artists` field kind in `worldFields.tsx` replaces the single
`artist_select` row: repeatable rows of *artist dropdown · 熱狂度 slider
(0–1.0, step 0.1, value shown) · remove*, plus an **add artist** button. It is
defined in `PreferenceHistorySection`, so the standalone Proposal panel and the
Combined setup popup both pick it up from one edit and the exact-reuse invariant
from 020 holds.

### 1.5 Migration — hard, no compatibility shim

`oshi_id` is deleted outright. 102 files reference it:

| group | what changes |
|---|---|
| 32 presets, 4 profiles, 5 seeds, world fixtures | `"oshi_id": "X"` → `"oshi_artists": [{"artist_id": "X", "enthusiasm": 1.0}]`; `null` → `[]` |
| `world.schema.json`, `p1_proposal_run_log.schema.json` | new array shape |
| `world_validation.py` | issue path becomes `driver_profile.oshi_artists[i].artist_id` |
| `World.project()` | projects the list into `feature_snapshot["preference"]` |
| `dispositions.py` + `content_feature_dispositions.v1.json` | scored `feature_id` renames `oshi_id` → `oshi_artists` |
| `_resolve_oshi_artist` (router) | resolves names for every entry; narration leads with the highest 熱狂度 |
| `explanation_builder.FEATURE_LABELS`, `content_explanation`, explanation kernel, `reviewVocabulary.ts` | label + family tables follow the rename |
| `scripts/generate_presets.py`, `mdg/worlds.py`, `mdg/p6_adapter.py` | generators emit the new shape |
| ~30 backend + frontend test files | assertions follow |

Two or three of the six combined cases get a genuinely multi-artist profile with
differing 熱狂度, so the feature is visible in the shipped catalogue rather than
merely supported.

---

## 2. Rank-1 summary in the right panel, for all three tabs

### 2.1 Where the prose lives today

Not in the right panel. The Combined screen is three columns; the template and
LLM rationale sentences render in the **centre** panel, inside
`ServiceResultOverlay` / `ContentResultOverlay` via `ReasonBreakdown`. The
**right** panel (`ReviewColumn`) carries the trigger/service/content tabs and
shows only `WhatDecidedIt`'s mirrored margin bars — no prose at all, for any of
the three stages.

### 2.2 What is added

A summary block under the stage tabs, above `WhatDecidedIt`: the sentence plus
the AI-provenance badge only. The rows are not repeated, because `WhatDecidedIt`
already draws them.

The sentence/badge sub-block is extracted out of `ReasonBreakdown` into a shared
component, so the centre panel and the right panel render from one source rather
than drifting apart. `MergedShell` threads `explanationProvider` and the inline
ephemeral proposal into `ReviewColumn`; `mergedRunId` is already passed.

- **Service tab** — existing template + LLM rationale, target = rank-1 candidate.
- **Content tab** — same, target = rank-1 plan item.
- **Trigger tab** — net-new (§2.3).

### 2.3 Trigger rationale is built from scratch

No trigger package emits a `rationale`; unlike service and content there is no
baseline sentence for the LLM path to degrade into, so both the template and the
prompt are new.

- `ExplainStep` widens to include `"trigger"` (frontend and backend).
- A new `trigger_explanation.py` joins `service_explanation` /
  `content_explanation` in the `explanation_builder` dispatch, with the same
  `template(target)` / `build_prompt(target, context)` pair.
- Trigger evidence is **not** in a `ProposalRunLog` — it lives on
  `MergedInstantResult.fires` (`MergedFirePoint`). `/api/merged-runs/explain`
  therefore takes the fire point inline, mirroring how the ephemeral proposal is
  already passed, instead of looking it up in a run log.
- The template composes from recorded evidence only: the fired category in the
  発火 vocabulary, the score and the threshold it crossed with its clearance
  (from `FirePoint.criteria`), the two strongest contributing rows with their
  band words, and the strongest input that contributed nothing. Bilingual.

  > 休憩しきい値(100点)を超えて発火。主因は連続運転時間（142分）と単調な道（96分）。眠気は不感帯以下で寄与なし。

- The LLM branch reuses the Ollama / Gemini-Nano plumbing verbatim, with the
  template as the fallback — identical contract to service and content.

### 2.4 Two things the build changed

**A `"template"` provider.** Service and content get their template sentence for
free, because their packages bake a `rationale` into the evidence. Trigger's only
lives on the server, so gating the trigger summary on "an LLM provider is
selected" left the tab blank by default (`explanationProvider` defaults to
`'off'`) — exactly the gap the customer reported. `provider: "template"` on the
trigger explain path returns the deterministic sentence with no Ollama call, and
the panel requests it whenever no LLM is selected. Trigger now behaves like the
other two: template by default, LLM-with-badge when one is on.

**Units, not just numbers.** The first working version emitted "drowsiness
(86 min)" and "fatigue (87 min)" — both are 0–100 levels — and rendered the
boolean `child_passenger` as a quantity. A confidently wrong fact is worse than
an absent one, so each row now renders in its own unit from an explicit table,
defaulting to **no unit** for an unrecognised feature rather than a guessed one.
Where a drowsiness/fatigue row contributes zero *because* its value sits under
θ, the sentence now says so — that dead-band is the most reviewable thing NRI
produces.

---

## 3. NRI as the default trigger, thresholds 100 / 60

- `nri_fatigue_score_v1` manifest: `threshold_fire` 80 → **100**,
  `threshold_monotony` 55 → **60**. Nothing else about the scale changes; both
  values are inside the declared min/max already.
- All six `combined_contracts/test_cases/case-c0*.json` switch
  `algorithm_defaults.trigger` to `nri_fatigue_score_v1`.
- `MergedSetupPanel.tsx:710-716` unconditionally selects `packages[0]` on mount —
  alphabetically the hybrid — which would fight the case's own default. That
  dispatch is corrected to respect the case.

### 3.1 The coupling: NRI must emit `feature_contributions`

Only `aica_transparent_hybrid_trigger_v1` emits trigger `feature_contributions`.
NRI emits none, and `chains.ts:44-52` returns *"this trigger package recorded no
per-feature contributions"* when the map is empty. Switching the cases to NRI
without this would make the trigger tab **go dark** — issues 2 and 3 would cancel
each other out.

NRI is a pure additive sum, so its decomposition is exact rather than
attributed-by-approximation. Rows, summing to `s_total` with `clamped: false`:

| feature_id | value | contribution |
|---|---|---|
| `continuous_driving_min` | `T_drive` | `T_drive · W_base` |
| `night_amplification` | `M_night` | `T_drive · W_base · (M_night − 1)` |
| `familiar_route_amplification` | `M_familiar` | `T_drive · W_base · M_night · (M_familiar − 1)` |
| `child_passenger` | 0/1 | `W_child` when aboard |
| `traffic_jam` | `T_jam` | `T_jam · W_jam` |
| `long_highway` | `T_hw` | `T_hw · W_highway` |
| `monotony` | `T_mono` | `T_mono · W_monotonous` |
| `drowsiness` | `V_sleep` | `max(0, V_sleep − θ_sleep) · W_sleep` |
| `fatigue` | `V_fatigue` | `max(0, V_fatigue − θ_fatigue) · W_fatigue` |

The two multipliers are split out as their own additive rows rather than being
folded invisibly into the driving-time term; the sequential attribution above is
exact (`T·W·M_n·M_f` reconstructs from the three rows) and the convention is
documented in the algorithm.

`gates` carries the rest band's `rest_spot_eta_filter_min` (inputs
`{nextRestSpotMin}`, threshold, passed, `allow`/`suppress`) and the monotony
band's `superseded_by_rest_required`.

### 3.2 One score, two categories

NRI scores both categories with the same `s_total`, so the mirrored-bar
comparison of rest-vs-monotony would show a zero margin on every row — true, and
useless. When the two options' scores are identical, the trigger tab compares the
fired category against **the firing threshold** instead: *how far over the line,
and what put it there* — which is the actual NRI question. The hybrid, whose two
categories genuinely differ, keeps the existing category-vs-category comparison.

### 3.3 Consequences — what the re-run actually found

Both of these were measured, not assumed, and both changed the plan above.

**C-01 can no longer be a silent control.** Its "short" Tokyo–Chichibu route is
really 112 km / 111 min, and the scenario's drowsiness model grows 1.2/min from
10 → 85.6, so NRI's θ = 60 dead-band alone contributes 38.4 of the 105.3 points
at the rest fire. NRI has no decay, so the score crosses 60 regardless of tuning.
A control asserting silence would be asserting that NRI is wrong.

Owner's decision: **redefine C-01 as the mildest case.** Among the five cases
sharing the UC-01 fatigue scenario it verifiably has the latest first fire
(48 min, tying C-04), the lowest peak score (0.814) and the fewest fires (2):

| case | scenario | 1st fire | score | peak | fires |
|---|---|---|---|---|---|
| C-01 | uc01_fatigue_recovery | 48 min | 61.80 | 0.814 | 2 |
| C-02 | uc01_fatigue_recovery | 21 min | 70.23 | 0.912 | 10 |
| C-03 | uc02_monotony | 54 min | 61.80 | 0.676 | 2 |
| C-04 | uc01_fatigue_recovery | 48 min | 60.00 | 1.000 | 3 |
| C-05 | uc01_fatigue_recovery | 24 min | 63.84 | 0.986 | 10 |
| C-06 | uc01_fatigue_recovery | 15 min | 65.85 | 1.000 | 10 |

C-03 is outside the comparison on a principled basis, not to rescue the claim:
it deliberately runs `uc02_monotony_v0_1`, whose drowsiness model grows ~9× slower
(0.1 vs 0.9 pts/min) so that it isolates monotony from fatigue. Comparing C-01's
timing against it compares two fatigue models, not two situations.

**The briefs' "not reflected in the firing decision" claim was false.** Not
because of NRI, but because the *integration test* was under-building its request:
`MergedQuickviewBody` accepts `context_overrides` / `initial_state` / `profiles` /
`tick_seconds`, and the real `MergedSetupPanel` sends them, but
`_build_quickview_body` sent none of them despite a docstring claiming it
"mirrors MergedSetupPanel". The tests were exercising a body the app never sends.
Fixing the helper moves every case's timings:

| case | monotony before → after | rest before → after |
|---|---|---|
| C-01 | 36 → 48 | 51 → 63 |
| C-02 | 36 → 21 | 51 → 36 |
| C-03 | 48 → 54 | 81 → 90 |
| C-04 | 42 → 48 | 63 → 63 |
| C-05 | 36 → 24 | 48 → 36 |
| C-06 | 36 → 15 | 51 → 27 |

The four affected briefs are rewritten in both languages to describe the real
dead-band behaviour: `max(0, value − 60) × weight`, so a value at or below 60
contributes exactly nothing — which is why a "moderately drowsy" driver reads as
no different from an alert one.

---

## 4. Testing — result

Test-driven per slice, each slice adversarially verified by a second agent that
re-ran the tests and tried to refute the first agent's report.

| | branch point | end |
|---|---|---|
| backend (`pytest`) | 2580 passed, 9 skipped | **2655 passed, 9 skipped, 0 failed** |
| frontend (`vitest`) | 1040 passed, 102 files | **1072 passed, 106 files** |

`vite build` succeeds. Adversarial verification caught, among other things: a
6th undisclosed regression from the threshold raise, two `resolve_category` code
paths that survived mutation, and a false root-cause claim about
`MergedQuickviewBody` that two separate agents made.

**The live browser walkthrough was not performed** — the Chrome extension was not
connected. In its place the three asks were exercised against the running backend:
the catalog endpoint returns 300 songs / 246 artists (it returned nothing before
the fix); 熱狂度 1.0 puts two Ado tracks in the plan while 0.3 drops both below
the cut; and the trigger template renders correctly-united bilingual sentences on
real fires. A rendered-UI pass is still worth doing.

## 5. Risks

1. The 102-file oshi migration is mechanical but wide; a missed reference is a
   runtime `extra="forbid"` rejection rather than a type error.
2. The threshold raise may silence cases the catalogue documents as firing.
3. The trigger explain path is net-new plumbing across a boundary
   (`MergedFirePoint`) that the explain endpoint was not built for.

## 6. Known follow-ups (not blockers)

- `_dead_band_reason_applies` can claim a dead-band on a **hybrid** row whose
  contribution is merely within 1e-6 of zero, and the hybrid has no dead-band
  mechanism. Needs a drowsiness/fatigue signal below ~0.00033 to reach; no real
  fire in the six-case catalogue comes close.
- `explainTrigger` has no direct fetch-level test — its callers mock at the module
  boundary, so URL/method/body are unverified the way `explain()`'s are.
- `npx tsc --noEmit` reports 173 pre-existing errors across 32 files (mostly
  `Cannot find name 'global'` in tests). Byte-identical before and after this
  branch; untouched here.
