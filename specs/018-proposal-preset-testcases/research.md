# Research: Proposal Preset Test-Cases + Grounded Retune + Relative-Fit Display

All spec `[NEEDS CLARIFICATION]` were resolved in `/speckit-clarify` (fit-band = absolute remap; contrast = top-track differs; per-preset `top_fit_min`). This document records the remaining design decisions and their rationale, plus the empirical grounding from the data-science pass.

---

## R1. Preset storage: generated full-SeedWorld JSON vs. hand-authored vs. seed+profile pointers

**Decision**: Presets are **committed full-`SeedWorld` JSON files** in `proposal_contracts/presets/`, **generated** from compact author-specs by `scripts/generate_presets.py` (mirroring `scripts/promote_seeds.py`), and **golden-pinned** by `test_preset_generation.py` (generator output == committed bytes).

**Rationale**:
- A preset must set both situation and driver profile coherently; embedding a full `SeedWorld` lets it reuse the existing `LOAD_SEED` machinery and preserves the `control_inputs.motion_state`/`situation.motion_state` double-write (project memory `p7-e2e-vertical-slice-status`).
- A `SeedWorld` has ~35 `driver_profile` fields + situation + control_inputs; hand-authoring 18 of them is error-prone and drifts from the `World` model. The `seeds/` precedent solved exactly this by generating and completing every field from `World` defaults, pinned byte-for-byte (`test_seed_promotion.py`). Following it satisfies the constitution's "generated artifacts are never hand-edited."
- The compact author-spec (situation deltas + profile deltas + oshi/track selections + `expectation` + `overrides`) is where the data-science intent lives — readable and re-tunable. Regenerate → review diff → commit.

**Alternatives rejected**:
- *Hand-authored full JSON*: violates the generated-artifact rule and is unmaintainable at 18×full-World.
- *Frontend-only seed_id+profile_id pointers*: rejected by the user (D2); can't cleanly carry per-preset overrides or run-evidence provenance, and existing seeds already bake in a profile (so a pointer pair is ambiguous).

---

## R2. Per-preset `algorithm_config_overrides` mechanism

**Decision**: A pure function `merge_algorithm_config(defaults, overrides) -> config` deep-merges a preset's override dict over the package `hyperparameters`/`parameters` **at dispatch time**, producing the config passed into `evaluate(context)`. Defaults in `package.json` are never mutated. The resolved (merged) config is recorded in the run's resolved-config evidence alongside the un-merged defaults (reusing the selector output's existing `resolved_config_versions` disclosure).

**Rationale**: Keeps the adapter generic (Principle V) — overrides ride the existing config surface, not a new code path. Isolation (a preset's override never leaks to another seed/preset) is guaranteed by merging into a fresh copy per dispatch. Recording both defaults and resolved config keeps evidence honest (Principle II).

**Alternatives rejected**: Editing `package.json` per preset (global leak); a second "override package" (adapter-type proliferation).

**Scope of overrides actually needed** (measured, see R4/harness): structurally-weak lenses only — `era/age-band` (bump `upro_oshi.age` leaf share so the era signal is legible) and possibly a `directional_hypothesis` flip for the keep-alert contrast. The harness decides necessity; unused override slots stay empty.

---

## R3. Content-scorer `norm_bounds` recalibration (global retune)

**Decision**: Recalibrate the content selector's loudness normalization to the real catalog: `loudness_min: -60 → -33`, `loudness_range: 60 → 33` (final values pinned to the measured catalog min/range by `test_norm_bounds_retune.py`). Sanity-check tempo bounds against observed 63–200 BPM; adjust only if it widens discrimination. **Preserve** the `context_response_matrix` directional (soothe/energize) conflict — it is a documented transparency behavior. Coherence for demos comes from preset world design + per-preset overrides, not global flattening.

**Empirical grounding** (data-science pass over the 300-song catalog):
- Real loudness spans **-32…0 dB**; the old `-60` floor squashed `norm_loudness` into `[0.46, 1.0]` (median 0.887), killing discrimination and biasing arousal high.
- Cold-start best song = **0.206** (mean 0.068), confirming 0.2–0.3 is the structural ceiling without personalization, not a bug.
- `A_s` signed arousal currently spans only `[-0.541, +0.798]`; recalibration widens usable separation.

**Test debt**: Update pinned content math (`test_content_selector_scoring.py`, `test_content_selector_traits.py`, `test_content_selector_response_weights.py`, and any §10-worked-example assertion) to the recalibrated values; add `test_norm_bounds_retune.py` asserting the bounds match the catalog and the arousal spread widened vs. the pre-retune baseline. Service math (`test_p5_service_math.py`) is expected **unchanged** (service selector doesn't use content `norm_bounds`).

**Alternatives rejected**: Redistributing missing weight (semantic change, forbidden by FR-018); globally softening the directional α/β (erases the transparency story); percentile display instead of retune (doesn't fix the real discrimination problem).

---

## R4. Verification harness structure (the test-case guarantee)

**Decision**: `test_presets_expectations.py` loads every committed preset, runs BOTH selectors via the production `dispatch_selector` path (merging any overrides), and asserts each `expectation`:
- content: top candidate matches `expected_top` intent (by track id where pinned, else by genre/arousal-band predicate), `top_fit >= top_fit_min`, `gradient` direction holds across the ranked set, and `should_rank_below` respected;
- service: top service ∈ `expected_service.top_should_be_in`;
- contrast: for each pair, the two presets' #1 content **track ids differ**.
It also emits `docs/master/proposal_preset_analysis.md` (or `build_reports/`) tabulating hypothesis · expected · real-measured · pass/fail, with any applied override disclosed.

**Rationale**: Runs the real algorithms (no re-implementation) so the "test case works" guarantee is genuine (Principle: contract surfaces tested first). The report makes "seeds vs. parameters" an evidence question. TDD: harness is written against the expectation contracts before the presets are finalized; presets/overrides are tuned until green.

**Alternatives rejected**: Asserting against a re-implemented scorer (drifts from truth); manual spot-checks (not repeatable, the exact failure the feature exists to prevent).

---

## R5. Fit band display

**Decision**: `fitBand(raw) = (raw + 1) * 50`, clamped to `[0,100]`, a pure display helper (frontend `lib/` + unit test) shown as a labeled column next to the raw score in both `ContentProposalPanel` and `ServiceProposalPanel`. Raw stays authoritative; math unchanged.

**Rationale** (from clarify Q1): absolute remap is **stable across proposals** (a 0.20 always shows 60) and comparable between presets — directly answers "0.2 reads as low" without the misleading set-relativity of min-max/percentile (where the same song shows different numbers in different proposals). Display-only ⇒ Principle I satisfied.

**Alternatives rejected**: min-max within ranked set (top always 100, not comparable); percentile (hides magnitude gaps).

---

## R6. Frontend selection flow (`LOAD_PRESET` + sync guard)

**Decision**: New atomic reducer action `LOAD_PRESET` sets `world.situation` + `world.driver_profile` + `control_inputs` and `selectedSeedId`/`selectedProfileId`/`selectedPresetId` in one update, and stashes `algorithm_config_overrides` into run state for dispatch. `PresetPicker` (clone of `SeedPicker`) sits as "section 0" above the Seed section; on selection it renders the bilingual `brief`. Loosen the `if (!selected)` reflect-guard in `SeedPicker`/`DriverProfilePicker` so a preset-driven load updates both child dropdowns.

**Rationale**: One atomic action avoids the ordering hazard where `LOAD_SEED` clears `selectedProfileId` (synthesis §3). The sync-guard fix is required so the child selectors don't show stale placeholders after a preset load (synthesis §3/§4). Reuses `DatasetProvenanceBanner` styling for the blurb.

**Edge cases**: selecting a preset after manual edits overwrites atomically; a later manual field edit keeps `selectedPresetId` but the run evidence records both the preset origin and that fields were edited (honest provenance). Auto-init (`ServiceProposalPanel` `AUTO_INIT_SEED_ID`) and preset load must not fight — preset selection supersedes auto-init for that session.

---

## R7. Catalog anchors (real, from the profiling pass)

- **Genres present**: j-pop (112), j-rock (63), electronic (40), jazz (27), classical (21), anime (20); folk/enka/children's near-empty (2–3) → child preset targets **anime**, wellness leans **jazz/classical** (no `ambient` songs exist).
- **Oshi anchors** (artist id · mean arousal): upbeat → Ado (a0122, 0.82), Official HIGE DANdism (a0107, 0.79), King Gnu (a0162); calm → Hiroshi Yoshimura (a0209, 0.29), Ichiko Aoba (a0197, 0.45), Joe Hisaishi (a0090), Jobim (a0004).
- **Era anchors**: Seiko Matsuda (1980s, a0136), Kenshi Yonezu (2010s, a0157), Fujii Kaze/Ado (2020s). The `age` leaf is only 0.10 of its subgroup ⇒ era presets reinforce with an era-matched oshi and/or a per-preset age-share override (R2).
- Profiling saved to `scratchpad/catalog_profile.json`; the generator will re-derive track selections from the frozen catalog so committed presets reference only real ids.

---

## Open items deferred to implementation (non-blocking)

- Exact recalibrated `loudness_min/range` numbers (pinned to measured catalog in the retune task).
- Which specific tracks each history/recovery preset (#9/#10) names (selected by the generator from the profiler).
- Whether the verification report lives under `docs/master/` or `build_reports/` (cosmetic; either satisfies FR-016).
