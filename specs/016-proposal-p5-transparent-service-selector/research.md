# Phase 0 Research — P5 Transparent Service-Selector

No `NEEDS CLARIFICATION` remained after Step-2 brainstorming + Step-3 clarify.
This file records the resolved decisions and their rationale.

## D1 — New package alongside the mock (not in-place)

- **Decision**: Ship `packages/aica_transparent_service_selector_v1/` as a new
  `python_module` package; keep `mock_service_selector_v1` as a regression
  fixture. The transparent package is the default the screen offers.
- **Rationale**: Mirrors P6 (`aica_transparent_content_selector_v1` next to
  `mock_content_selector_v1`); keeps the fixed mock as a stable isolation anchor;
  avoids rewriting mock-assertion tests.
- **Alternatives**: Rewrite the mock in place — rejected (loses the fixture,
  diverges from P6, churns existing tests).

## D2 — Extend the neutral output contract with OPTIONAL §14 fields

- **Decision**: Add the §14 explainability fields to
  `FeatureContribution`/`RankedCandidate` and add subtotal + dominance objects,
  all **optional** (default absent/None). Single shared `ServiceSelectorOutput`;
  `dispatch_selector` unchanged.
- **Rationale**: Backward-compatible — the mock's lean output still validates;
  the frontend degrades per-field; no dispatch branching; one contract to test.
- **Alternatives**: A parallel richer model with `dispatch_selector` branching —
  rejected (duplication, complicates the shared evidence path).
- **Evidence**: mirrors how P6 added rich content-evidence fields without
  breaking the mock content package.

## D3 — Full parameter/hyperparameter externalization to package.json

- **Decision**: Every structural parameter (response matrices, road matrix,
  ordinal/recency/anchor maps, scene taxonomy, tie-breaker, `material_safety_gap`,
  `top_k`, `missing_policy`) and every numeric hyperparameter (§6.1 hierarchy
  weights as ratios, §6.2 purpose multipliers, γ's, tag saturations, monotony bin
  thresholds, `safety_share_warning_floor`, response-coefficient override slots,
  `confidence_shrinkage_v1`) lives in `package.json`; `algorithm.py` reads each by
  direct index; a missing key raises `invalid_configuration`.
- **Rationale**: The package exists to be tuned/inspected; matches P6's "no silent
  default" discipline (algorithm §12).
- **Alternatives**: Hard-coded defaults in code — rejected (not reviewer-editable,
  hides the hypothesis).

## D4 — Confidence shrinkage as an opt-in package HYPERPARAMETER, off by default

- **Decision**: `confidence_shrinkage_v1` is a boolean hyperparameter of the
  transparent service package (clarify 2026-07-16). **Off** ⇒ byte-identical to
  the frozen baseline; the two confidence fields are `available_but_not_used`.
  **On** ⇒ `e_acceptance ← e_acceptance · confidence_acc[c]`,
  `e_recovery ← e_recovery · confidence_rec[c]` (missing confidence ⇒ 1.0,
  disclosed). Response coefficient stays `+1.0`; the shrink is applied at the
  evidence step and carries provenance `confidence_shrinkage_v1`.
- **Rationale**: Resolves the milestone-vs-algorithm-doc contradiction (milestone
  §7 asked for it; algorithm §5.4/§5.6/§19 said the baseline has none). Modeling
  it as an algorithm setting (not a world/driver flag, not `enabled_feature_extensions`)
  matches its nature — it is how the algorithm treats sparse history, not a
  property of the world — and keeps the World/driver-profile contract unchanged.
  Off-by-default preserves the frozen worked example and dominance table.
- **Alternatives**: (a) driver-profile world flag — rejected (conflates algorithm
  behavior with the world model, violates the Panel-②/③ boundary); (b) run-level
  `enabled_feature_extensions` — rejected (reuses data/preference-extension
  machinery for an algorithm setting); (c) don't implement, defer per algorithm
  §19 — rejected by owner (milestone wants it now).
- **Firewall**: a test proves off-state == no-extension result exactly (mirrors
  the genre-extension firewall).

## D5 — Reuse the existing backend wiring unchanged

- **Decision**: `create_proposal_run` and `select_service` already run P4
  `resolve_eligibility`, narrow `allowed_service_ids` to the eligible set, build
  `_build_service_context` (which carries the full A.1 `feature_snapshot`), and
  call `dispatch_selector(..., allowed_service_ids=eligible)`. P5 changes only the
  selected package id.
- **Rationale**: Eligibility-before-ranking, out-of-allowed-set rejection, and
  evidence emission are already correct and tested (P4). Re-implementing them
  would duplicate P4 and risk drift.
- **Verification task**: confirm `_build_service_context`'s `feature_snapshot`
  actually contains every A.1 field the package scores (drowsiness … recovery,
  candidate-indexed maps). If a field is missing from the projection, extend the
  projection (small, additive) rather than the package.

## D6 — Frozen goldens as the implementation anchor

- **Decision**: Build the §10 worked example (`humming_karaoke ≈ +0.772349`) and
  the §6.2 normalized-weight table + §6.4 dominance table as golden fixtures
  first (TDD), before the trace/evidence layer.
- **Rationale**: These pin the weight-resolution, normalization, and response
  wiring numerically; everything else (subtotals, provenance, panel) layers on a
  verified core.
- **Contrast goldens**: the §11 13 one-field contrasts authored as frozen fixture
  worlds under `proposal_contracts/fixtures/service/` — each asserts a documented
  reorder direction (not an invented "correct probability").

## D7 — No htmlapp sync

- **Decision**: htmlapp has no proposal-simulator screen (verified: no
  `ServiceSelectorOutput`/`TriggerPurpose`/`allowed_service_ids` in `htmlapp/`).
  P5 is `app/` + `packages/` only.
- **Rationale**: Consistent with P1/P3/P4, all app-only.
