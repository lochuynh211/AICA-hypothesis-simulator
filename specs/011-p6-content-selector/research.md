# Phase 0 Research — P6 Transparent Content-Selector

All Technical-Context unknowns are resolved (the Step 2 design + Step 3 clarifications settled
them). This file consolidates the decisions, rationale, and rejected alternatives.

## R1 — Evidence input form (driver/environment magnitudes)

- **Decision**: Numeric `[0,100]`, reduced to evidence by `/100`; categorical environment
  fields (`traffic_state`, `road_type`, `night_state`, `motion_state`) stay enum-valued with
  the per-enum evidence/response in content-algo §5.3.
- **Rationale**: Content-algo §5.3 and the authoritative world schema (data-spec §13,
  `drowsiness_level: 80`) both use numeric 0–100. This is the proposal simulator's own
  authoritative math, not an external-service route numeric.
- **Alternatives rejected**: Ordinal bands → magnitude map (contradicts data-spec §13; needs
  an undefined band table; the P0.5 ordinal fixtures were structural-only, never scored);
  accept-both (two evidence paths, more surface, no benefit).

## R2 — Parameter surface

- **Decision**: Externalize all algorithm tables (trait composition matrix, context response
  matrix, hierarchy weights, purpose multipliers, genre maps, age/era affinity, normalization
  bounds, history/operation curves, lighting lookup) as structured `package.json`
  hyperparameters with an extended manifest schema; a few scalar knobs (`plan_item_count`,
  `fixed_humming_segment_sec`, `directional_hypothesis`, `skip_exclusion_window`,
  `content_category_weights`, `parameter_set_version`, `formula_version`). Every resolved
  table is echoed into `CompletePlan.algorithm_provenance`.
- **Rationale**: Content-algo §12 lists these as "frozen per run, evidence-visible"; user
  explicitly chose full externalization. Editing any table bumps `parameter_set_version`.
- **Alternatives rejected**: In-package constants only (less faithful to "editable"); hybrid
  split (two homes to keep consistent).

## R3 — Package layout

- **Decision**: Single `algorithm.py` (+ `package.json` + `README.md`), organized into
  section-commented pure functions, exactly like `aica_transparent_hybrid_trigger_v1`.
- **Rationale**: Matches the repo convention; user rejected multi-module decomposition. Pure
  functions are still independently unit-testable by import.
- **Alternatives rejected**: Multi-file package (`traits.py`, `scoring.py`, …) — over-decomposed
  for this repo's convention.

## R4 — Service acceptance gating

- **Decision**: A present + supported `selected_service_id` is the authorization to score;
  `None`/missing → `invalid_request`; a valid non-music service → `unsupported_recipe`. No
  separate `lifecycle_state` input.
- **Rationale**: The frozen `SelectorInput` has no `lifecycle_state` field; P6 never re-opens
  the service decision (separation invariant). Yields the three required typed outcomes.
- **Alternatives rejected**: Require an explicit `lifecycle_state` (invents an unfrozen field);
  derive from `lifecycle_stage` (conflates driving phase with service acceptance — mis-gating
  risk).

## R5 — Catalog delivery + package purity

- **Decision**: The song database is one JSON file on disk (P6 fixture; P2 frozen dataset
  later). A test-support loader reads it and injects records into
  `context["feature_snapshot"]["catalog"]` (map keyed by Track ID). `eligible_candidates`
  (Track IDs) names which to rank. **The package `evaluate()` performs no file/network I/O.**
- **Rationale**: Keeps `evaluate()` pure/deterministic/replayable (trigger convention); keeps
  the frozen `SelectorInput` unchanged (`feature_snapshot` is an open dict).
- **Alternatives rejected**: `parameters.catalog` (mixes frozen data with tuning knobs); load
  by path inside `evaluate()` (breaks purity/replay).

## R6 — Reason/rationale form

- **Decision**: Per-item human-readable reasons are bilingual `{ja, en}` (JA default), like the
  trigger package; structured per-feature contribution numbers are always present.
- **Rationale**: Satisfies the JA/EN bilingual invariant at the evidence layer P6 produces;
  the P1 screen needs no text backfill.
- **Alternatives rejected**: Structured-codes-only (defers required bilingual text to P1);
  English-only (violates JA-default invariant, guarantees rework).

## R7 — Age/era affinity table (undefined in master docs)

- **Decision**: Freeze the default `age_era_affinity[band][era]` table added to content-algo
  §5.5: `age_band ∈ {teens,20s,30s,40s,50s,60plus}`, era from `album.release_date` year →
  `{pre1980,1980s,1990s,2000s,2010s,2020s}`, values in `[−1,+1]` peaking on the band's
  formative era; evidence `e=1` if band ∧ parseable year else `0` (`missing_neutral`).
- **Rationale**: The table was named-only (structural parameter); a loose, low-weight designed
  default is consistent with the genre maps' philosophy.
- **Alternatives rejected**: Leave undefined (blocks the age feature); learn from data (out of
  scope, no dataset in P6).

## R8 — ⚠ directional hypothesis (fatigue/traffic/night)

- **Decision**: Adopt the doc default **soothe/de-stress** as the `directional_hypothesis`
  hyperparameter default; `keep_alert` is the one-line sign-flip alternative.
- **Rationale**: Content-algo §5.6 adopts soothe/de-stress; versioned hyperparameter.
- **Alternatives rejected**: Hardcode without a knob (loses the versioned choice §5.6 requires).

## R9 — Test execution environment

- **Decision**: Canonical `docker compose exec api uv run pytest`; local fallback Anaconda
  3.12.7 `python -m pytest` (Docker/uv unreachable in the authoring shell; pydantic 2.8.2 vs
  container 2.13.4 — all used features stable across both).
- **Rationale**: Matches the P0.5 precedent; container remains the authoritative gate when
  available.
- **Alternatives rejected**: None (environment fact, not a design choice).
