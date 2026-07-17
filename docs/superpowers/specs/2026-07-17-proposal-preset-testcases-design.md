# Design: Proposal Preset Test-Cases + Grounded Retune + Relative-Fit Display

**Date:** 2026-07-17
**Status:** Approved (brainstorming), pending written-spec review → Spec Kit chain
**Author:** data-science pass (Claude, ultracode)
**Scope:** Proposal mode only (`aica_transparent_service_selector_v1` + `aica_transparent_content_selector_v1`). No change to trigger mode.

---

## 1. Problem & motivation

We need a **customer-facing demonstration layer** that shows, on demand, that both the service-proposal and content-proposal algorithms behave sensibly and transparently. Today a reviewer must hand-pick a *situation* seed and a *driver-profile* seed **separately** from the left panel, with no guidance on what the combination is supposed to demonstrate, and content scores routinely land at **0.2–0.3**, which reads as "the algorithm barely likes anything."

Two things are missing:

1. A **parent "preset"** — one pick that coherently sets *both* situation and driver profile — packaged as a documented **test case** (what it tests · expected outcome · real measured outcome).
2. A principled answer to **"why are the scores so low, and is that seeds or parameters?"**

## 2. Root-cause analysis (the data-science finding)

Running the **real** `content/algorithm.py` against the **real** 300-song catalog under a realistic cold-start `rest_recommended` world (drowsiness 75, fatigue 65, monotony 80, highway, night, driving; **no oshi, no history**):

> **Best song in the entire catalog = 0.206.** mean 0.068 · median 0.084 · min −0.167.

So 0.2–0.3 is **near the structural ceiling for a cold-start driver**, not a random bad seed. Three compounding causes, in order of leverage:

1. **~34 % of the content weight budget is dead on a cold-start driver.** oshi, age, item-usage, played/skipped/changed, acceptance, recovery all require an oshi match or *per-track* history to fire, and the documented rule is **"missing weight is never redistributed"** (`content` doc §8). Empty-history seeds leave a third of the score pinned at 0 for *every* song.
2. **Categorical dead zones** — `traffic_state`, `night_state`, `road_type` contribute exactly 0 unless the world is in their one matching enum state.
3. **Deliberate directional conflict** — under the default `soothe_destress` hypothesis, drowsiness (α +0.80) and monotony (α +0.90) reward *high-arousal* songs while fatigue (α −0.50), night (α −0.50), traffic-congested (α −0.40), motion-driving (α −0.30) reward *low-arousal* songs. Maxing all of them at once (exactly the current `night-highway-oshi` seed) makes the mood block self-cancel — the spec's own §10 worked example nets only **+0.187** for the 6-feature mood block.

**Catalog-grounded miscalibration found:** `norm_bounds.loudness_min = −60` is far below any real song (catalog loudness spans **−32…0 dB**), so `norm_loudness` is squashed into `[0.46, 1.0]` (median 0.887) and adds almost no discrimination while biasing arousal upward.

**Conclusion.** The dominant lever for *legitimately* high scores is **preset data that activates the dead personalization weight** (an in-catalog oshi + real history) combined with **coherent (non-conflicting) situation worlds**. A modest, catalog-grounded `norm_bounds` fix helps at the margin. The directional conflict is a *transparency feature* and is preserved, not flattened.

## 3. Decisions (locked with user)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Tuning blast radius | **Retune global package defaults** (norm_bounds, and response-coeffs only where justified) **and** rich presets **and** optional per-preset overrides. Pinned math tests updated. |
| D2 | Preset storage | **Backend committed files** — `proposal_contracts/presets/*.json` + schema + `PresetStore` + endpoints, mirroring `seeds/`/`profiles/`. |
| D3 | Score display | **Add a relative-fit view alongside the raw score** (raw stays authoritative). |
| D4 | Retune philosophy | **Surgical** — catalog-grounded `norm_bounds`; keep the directional soothe/energize conflict intact; use coherent worlds + per-preset overrides instead of global flattening. |
| D5 | Catalog size | **≈18 presets in 9 families, 7 contrast pairs.** |

## 4. Preset data model (D2)

New frozen contract directory, mirroring the existing seed/profile pattern:

```
proposal_contracts/presets/preset-<slug>.json
proposal_contracts/schema/p1_preset.schema.json
app/api/aica_api/services/preset_store.py            # read-only scan (cf. world_seed_store.py)
app/api/aica_api/models/proposal/preset.py           # pydantic Preset / PresetSummary
app/api/aica_api/routers/proposal.py                 # GET /api/proposal/presets[/{id}]
app/api/aica_api/config.py                           # AICA_PROPOSAL_PRESETS_DIR
```

```jsonc
{
  "preset_id": "preset-monotone-highway-energize",
  "label":  { "en": "…", "ja": "…" },
  "brief":  { "en": "one-paragraph what & why, shown on selection", "ja": "…" },
  "family": "mood_coherence",
  "contrast_with": "preset-late-night-winddown",     // nullable; marks a contrast pair
  "world":  { "control_inputs": {…}, "situation": {…}, "driver_profile": {…}, "catalog_ref": {…} },
  "algorithm_config_overrides": {                    // nullable; isolated, applied only for this preset
    "content": { /* e.g. norm_bounds / directional_hypothesis / hierarchy age share */ },
    "service": { /* rare */ }
  },
  "expectation": {
    "hypothesis":       "boredom without fatigue → energizing oshi track should top content",
    "expected_content": { "top_should_be": "high-arousal j-rock oshi track",
                          "top_fit_min": 0.40, "gradient": "arousal_up_implies_fit_up",
                          "should_rank_below": ["low-arousal ballad"] },
    "expected_service": { "top_should_be_in": ["humming_karaoke", "music_playlist"] },
    "mechanism":        "coherent high-arousal signals + oshi match + genre highway→j-rock + item_usage high"
  }
}
```

- `world` is a **full `SeedWorld`** so it reuses the existing `LOAD_SEED` machinery and preserves the `control_inputs.motion_state` / `situation.motion_state` double-write.
- `algorithm_config_overrides` are **applied only when that preset is run** (merged over the package defaults at dispatch), never mutating the frozen `package.json`. This is the isolation lever for weak-signal families.
- Selecting a preset records `preset_id` into `SetupSnapshot.origin` for run evidence.

## 5. The preset catalog (D5) — 18 presets, 9 families, 7 contrast pairs

Real anchors from `catalog_profile.json` (genre means: j-pop a0.70/v0.63 · j-rock 0.69/0.61 · anime 0.76/0.61 · electronic 0.51/0.37 · jazz 0.52/0.44 · classical 0.41/0.39; oshi artists cited by synthetic id). Only fields that *differ from the neutral baseline* are listed; everything else inherits `profile-neutral-default` / an ordinary daytime world.

### Family A — Mood coherence (Situation block) · **contrast pair 1a⇄1b**
- **1a `preset-monotone-highway-energize`** — situation: monotony 85, drowsiness 55, fatigue 20, traffic free_flow, night day, road highway, motion driving. profile: oshi Official HIGE DANdism (a0107), genre ext on, usage_by_genre {j-rock: high}, item_usage high on oshi tracks. **Expect:** high-arousal j-rock/j-pop tops (~0.45+); calm ballads low. Service: humming_karaoke / music_playlist.
- **1b `preset-late-night-winddown`** — situation: fatigue 85, night night, traffic congested, monotony 20, drowsiness 30, road highway. profile: oshi Hiroshi Yoshimura (a0209, ambient-electronic), usage_by_genre {ambient/jazz: high}, content_recovery_rate high on calm tracks. **Expect:** low-arousal ambient/jazz tops (~0.40+); high-energy negative. Service: music_playlist / radio_style.

### Family B — Directional hypothesis toggle (same world, flipped reward) · **contrast pair 2a⇄2b**
- **2a `preset-drowsy-soothe`** — situation: drowsiness 90, monotony 70, fatigue 40, day, highway. purpose inattentive_driving_prevention_recovery. default `soothe_destress`. **Expect:** calm-leaning winner.
- **2b `preset-drowsy-keepalert`** — identical world; `algorithm_config_overrides.content.directional_hypothesis = "keep_alert"`. **Expect:** energetic-leaning winner, *demonstrating the hypothesis flip on one fixed world.*

### Family C — Oshi personalization · **contrast pair 3a⇄3b**
- **3a `preset-oshi-superfan`** — situation: neutral daytime (quiet Situation block). profile: oshi Ado (a0122), registered/on, acceptance 95 + recovery 90 + item_usage high on Ado tracks, genre ext on. **Expect:** Ado tracks ~0.5+, field clustered near 0 — *shows the formerly-dead 34 % weight doing the work.*
- **3b `preset-oshi-off`** — same driver & world, `oshi_mode = "off"`. **Expect:** Ado tracks collapse into the field — *isolates the oshi gate's contribution.*

### Family D — Genre usage (`usage_by_genre`) · **contrast pair 4a⇄4b**
- **4a `preset-jrock-enthusiast`** — situation: ordinary highway day. profile: genre ext on, usage_by_genre {j-rock: high, electronic: med}. **Expect:** j-rock cluster rises via genre_usage + scene_genre leaves.
- **4b `preset-jazz-calm-listener`** — same world. profile: usage_by_genre {jazz: high, classical: high}. **Expect:** jazz/classical rises — *same situation, different taste, different winners.*

### Family E — Route→genre gating + negative response · **contrast pair 5a⇄5b**
- **5a `preset-coastal-cruise`** — situation: road local, route_tags [coastal], destination_tags [coast], monotony 40, day. profile: genre ext on. **Expect:** bright city-pop/jazz rises (coastal→city pop 0.8/jazz 0.5).
- **5b `preset-mountain-pass`** — situation: road mountain, route_tags [mountain], destination_tags [nature]. profile: genre ext on. **Expect:** high-arousal songs go **negative** (road mountain α=−1.0), folk/classical/enka rises — *shows real negative scores are explainable, contrasting the coastal cruise.*

### Family F — Era / age-band affinity · **contrast pair 6a⇄6b**
- **6a `preset-showa-nostalgia`** — situation: neutral. profile: age_band 50s, oshi Seiko Matsuda (a0136, 1980s). `algorithm_config_overrides.content` boosts the `upro_oshi.age` leaf share (0.10→~0.30, renormalized) so the era signal is legible. **Expect:** 1980s tracks win.
- **6b `preset-genz-now`** — situation: neutral. profile: age_band teens, oshi Ado (a0122, 2020s), same age-share override. **Expect:** 2020s tracks win — *same situation, opposite era wins on age-band alone.*

### Family G — Passenger + genre gate
- **7 `preset-child-family-drive`** — situation: child_present true, multiple_passengers true, road local, day. purpose child_passenger_experience. profile: genre ext on. **Expect:** anime rises (child→anime 1.0), j-rock penalized (child→j-rock −0.4). Service: quiz / ranking_creation family per stage.

### Family H — Singability + service link
- **8 `preset-reststop-full-karaoke`** — control_inputs: lifecycle_stage after_rest_before_restart, motion_state stopped, purpose rest_recommended. eligible service `full_karaoke`. profile: neutral+oshi. **Expect:** high-`full_karaoke_ease` songs rise (song_singability leaf activates for karaoke service); links content ranking to the selected service.

### Family I — History mechanics
- **9 `preset-high-recovery-regular`** — situation: rest_recommended, mild. profile: content_recovery_rate 90 + acceptance 85 on **3 named catalog tracks** (chosen via profiler). **Expect:** those 3 tracks lifted above equally-matched peers — *isolates the recovery leaf (largest History lever, ~0.084 weight at rest_recommended).*
- **10 `preset-recently-played-fatigue`** — situation: rest_recommended. profile: played_items with `last_played_at` ≤30 min on 3 tracks that would otherwise score high. **Expect:** those tracks demoted (played le_30m = −1.0) — *shows the novelty/operations penalty.*

### Family J — Baseline & combo
- **11 `preset-coldstart-neutral`** *(control)* — neutral-default profile, ordinary daytime, genre ext off. **Expect:** winner ~0.15–0.20; `brief` documents *why* low (no personalization) — the honest reference that makes A–I's lift meaningful.
- **12 `preset-anime-fan-event-night`** *(multi-lever combo)* — situation: night, destination_tags [event, oshi_venue], monotony 60. profile: oshi Hatsune Miku (a0115), hobby anime-fan, genre ext on, usage_by_genre {anime: high, vocaloid: high}. **Expect:** anime/vocaloid strongly top via oshi + hobby + destination + usage stacking.

> **Weak-signal honesty:** families **F (era)**, **D/E (pure genre)** move small weight shares. Each such preset carries an `algorithm_config_overrides` to make the contrast legible, and **the verification harness measures whether the override is actually needed** — we do not guess.

## 6. Retune plan (D1, D4) — *superseded by measurement; see `docs/master/proposal_preset_analysis.md`*

**What actually shipped (evidence-driven):** the `norm_bounds` loudness recalibration below was measured against the real catalog and moved top scores by ≤0.005 — **rejected**. The adopted global retune is instead `content_category_weights: {Situation 0.55, Preference 0.30, History 0.15} → {0.45, 0.35, 0.20}`, which lifts known-driver scores (strong presets 0.37–0.43) while *lowering* cold-start (0.11→0.10) and leaves all 1061 existing tests green (it does not touch the §10 mood-block anchor). The rest of §6 (keep the directional conflict; per-preset overrides for weak lenses) held.

1. ~~**`norm_bounds` (catalog-grounded).** `loudness_min: −60 → ≈ −33`~~ — *tested and rejected (negligible effect).*
2. **Directional conflict — unchanged** (`context_response_matrix` α/β kept). Coherence handled by preset world design + per-preset `directional_hypothesis`.
3. **Per-preset overrides only** where a family's signal is structurally weak (era age-share; possibly a genre subgroup multiplier). Never global.
4. **Service selector** — no global change anticipated; `road_response_profiles`/hierarchy already produce healthy positive service scores (§10 worked example humming_karaoke = +0.772). Re-verify via harness; only touch if a preset's expected service fails.
5. **Test debt.** Update the pinned `test_p6` / §10 golden math values to the recalibrated `norm_bounds`; add a `norm_bounds` regression test asserting the catalog arousal spread; keep `test_p5` (service) green.

## 7. Verification harness (the "check the test case works" loop)

`app/api/tests/proposal/test_presets_expectations.py` — for **every** preset, load its world (+ overrides), run **both** real selectors via the production dispatch path, and assert the `expectation` contract:
- content: top candidate matches `top_should_be` intent (by genre/arousal band/oshi), `top_fit >= top_fit_min`, `gradient` direction holds across the ranked set, `should_rank_below` respected;
- service: top service ∈ `expected_service.top_should_be_in`;
- contrast pairs: the two presets produce *materially different* top candidates.

Plus a generated **analysis report** `docs/master/proposal_preset_analysis.md` (or `build_reports/`) tabulating per preset: hypothesis · expected · **real measured** top/fit/spread · pass·fail. I iterate `norm_bounds` and per-preset overrides until the table passes, so the answer to "seeds or parameters?" is evidence, not opinion.

## 8. Relative-fit display (D3)

In `ContentProposalPanel.tsx` (and analogously the service panel), keep the raw signed `item_fit` and **add a 0–100 relative band** = each candidate's fit rescaled within the *current ranked set* (min→0, max→100, or percentile rank), clearly labeled "relative fit within this proposal." No scoring-math change; raw value stays visible and authoritative. This directly addresses "0.2 reads as low" for a demo without misrepresenting the number.

## 9. Frontend wiring

- **`PresetPicker.tsx`** — new "section 0. Preset" directly above the Seed section in `WorldPanel.tsx` (~line 698), cloning the `SeedPicker`/`DriverProfilePicker` fetch-on-mount pattern.
- **`LOAD_PRESET`** — new atomic reducer action in `proposalStore.ts`: sets `world.situation` + `world.driver_profile` (+ `control_inputs`) and `selectedSeedId`/`selectedProfileId`/`selectedPresetId` in **one** update; carries any `algorithm_config_overrides` into run state.
- **Brief blurb** — bilingual info-box (reusing `DatasetProvenanceBanner` styling) rendered on selection from `preset.brief` + `expectation.hypothesis`.
- **Sync-guard fix** — loosen the `if (!selected)` guard in `SeedPicker`/`DriverProfilePicker` so a preset-driven load reflects in both child dropdowns.
- **API** — `getPresets()` / `getPreset(id)` + `PresetSummary` type in `proposalClient.ts`.

## 10. Isolation / units (for testability)

- `preset_store.py` — pure read-only directory scan → `Preset` objects; no dependency on selectors.
- `preset.py` model — validation only; `additionalProperties:false`.
- override merge — a single pure function `merge_algorithm_config(defaults, overrides)` used by dispatch; unit-tested independently of any preset.
- harness — reads committed presets, calls the same `dispatch_selector` the app uses (no re-implementation of scoring).

## 11. Non-goals / YAGNI

- No user-authored presets in-app (read-only committed set, like seeds).
- No change to trigger mode, evidence schema semantics, or the missing-weight-never-redistributed rule.
- No global flattening of the directional hypothesis.
- No new genres/songs in the dataset; presets use what the frozen catalog provides.

## 12. Risks

- **Golden-test churn** — recalibrating `norm_bounds` shifts many pinned values; mitigated by updating them in the same change and adding an explicit `norm_bounds` rationale test.
- **Weak-signal presets over-relying on overrides** — mitigated by the harness measuring necessity and the `brief` disclosing any override.
- **Sync-guard regression** — the existing `ServiceProposalPanel` auto-init also dispatches `LOAD_SEED`; verify preset load and auto-init don't fight.

## 13. Open follow-ups (not blocking)

- Whether the relative band should be percentile vs min-max (decide during implementation from what reads best on real preset outputs).
- Whether to surface the `expectation` contract in-app (e.g., a "vs expected" badge) or keep it test-only. Default: test-only for V1.
