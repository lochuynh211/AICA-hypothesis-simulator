# P5 — Transparent Service-Selector Package — Design

Date: 2026-07-16
Branch: `proposal-p5-transparent-service-selector`
Status: approved (Step 2 design checkpoint)

Authoritative math: `docs/master/aica_transparent_service_proposal_algorithm.md`
(this doc references it; it does not restate the full math).
Milestone: `docs/master/aica_proposal_simulator_milestones.md` §7 (P5).

---

## 1. Goal & customer-visible outcome

Replace the fixed **mock** service selector with the first **real transparent
service-selector `python_module` package**. The package ranks the eligible
service candidates with the fully inspectable expert scorecard (the §3–§6
symbol chain `xᵢ → eᵢ → aᵢ → rᵢ → wᵢ → kᵢ → service_fit`).

Customer-visible outcome: in Panel ③ (service proposal) a reviewer selects
`aica_transparent_service_selector_v1`, runs a typed-World seed, and sees up to
three ranked services each with a real `service_fit ∈ [−1,+1]`, the
Situation/Preference/History subtotals, the strongest supporting/opposing
features, the continuous dominance readout (~79 %), and an expandable
per-feature contribution table. Editing a weight / multiplier / response curve
re-runs the selection and visibly changes the explanation.

## 2. Scope

### 2.1 In scope

- New package `packages/aica_transparent_service_selector_v1/`
  (`package.json` + `algorithm.py` + `README.md`) — single-file, pure
  `evaluate(context: dict) -> dict`, no `aica_api` imports, no I/O / clock /
  randomness. Mirrors the P6 content-package layout.
- The full §5 feature wiring: 17 CDC-SU baseline features, §5.2.1 driving /
  §5.2.2 road / §5.2.3 during-rest / §5.2.4 post-rest response matrices
  (all 5 post-rest candidates incl. `call_response_stopped`), §5.7
  evidence-normalization functions, §5.4 direct candidate-specific features.
- §6 hierarchical weights (`base = category × subgroup × leaf`), §6.2 purpose
  multipliers, normalization to `Σw = 1`, and the §6.4 continuous dominance
  invariant (`W_D · material_safety_gap > 2·W_L`) with
  `default_dominance_preserved` / `dominance_not_guaranteed` recording and the
  `safety_share_warning_floor` non-blocking warning.
- Full parameter/hyperparameter externalization to `package.json`.
- **Extend** the neutral `ServiceSelectorOutput` / `RankedCandidate` /
  `FeatureContribution` contracts (Pydantic + TS) with the §14 explainability
  fields as **optional** additions (mock still validates unchanged).
- Panel ③ frontend enrichment to render the real trace (functional depth
  matching P6's content evidence).
- Opt-in `confidence_shrinkage_v1` extension (§7 below) — owner decision.
- The §16 test suite (math / features / response-matrix / eligibility /
  dominance / determinism / contrast-golden) + extension firewall.

### 2.2 Out of scope (deferred)

- Content selector (P6 — shipped), constrained-LLM service selector (P8),
  the full pre/rest/post-rest E2E vertical slice (P7).
- P4's eligibility resolver + journey engine internals — **consumed**, not
  modified. Motion / screen / readiness eligibility stays a platform fact
  computed **before** scoring.
- Probabilistic uncertainty-ranking package (algorithm §19) — remains deferred.

## 3. Key decisions

### 3.1 New package alongside the mock (approved)

Ship `aica_transparent_service_selector_v1` next to `mock_service_selector_v1`,
mirroring how P6 added `aica_transparent_content_selector_v1` next to
`mock_content_selector_v1`. Both remain selectable in the `service_selector`
slot; the mock stays a lightweight isolation/regression fixture. Rationale:
consistent with the established precedent, keeps the fixed mock as a regression
anchor, and avoids rewriting the mock-assertion tests.

### 3.2 Extend the output contract with optional fields (approved)

Add the §14 fields to the existing models as **optional** (defaulted
absent/None). The mock validates unchanged; the transparent package populates
them fully; the frontend degrades gracefully per field. Single shared contract,
single `dispatch_selector` path. Rationale: backward-compatible, no dispatch
branching, no duplicated contract.

Added fields:

- `FeatureContribution` (all new fields optional): `normalized_evidence` (eᵢ),
  `response_provenance`, `source_reference`, `normalization_function`,
  `hierarchy_path`, `base_weight`, `purpose_multiplier`, `effective_weight`,
  `status` (`used` / `neutral` / `zero_weight` / `missing` / `invalid`).
  (`response_coefficient`, `weight`, `contribution`, `feature_value` already
  exist.)
- `RankedCandidate` (new optional): `situation_fit`, `preference_fit`,
  `history_fit` subtotals; `strongest_support` / `strongest_oppose`
  (feature-id + contribution); `dominance` object.
- New optional `RankedCandidate.dominance` /
  `ServiceSelectorOutput`-level config block: `status`
  (`default_dominance_preserved` / `dominance_not_guaranteed`), `w_d`, `w_l`,
  `required_gap`, `safety_share`, `safety_share_warning` (bool).

### 3.3 Full parameter externalization to package.json (approved)

Every structural parameter and numeric hyperparameter lives in `package.json`
and is read by direct index in `algorithm.py`; a missing key raises
`invalid_configuration` — never a silent code default. Matches P6's discipline
and makes the hypothesis fully editable/inspectable.

### 3.4 Functional real trace in Panel ③ (approved)

Render `service_fit`, the three subtotals, strongest support/oppose, the
dominance readout, and an expandable per-feature contribution table — bilingual
(JA default), matching P6's content-evidence depth. No gold-plating (no charts /
animations). Enough to answer "why A above B?" from the UI.

### 3.5 Confidence shrinkage as an opt-in, off-by-default extension (owner decision)

See §7.

## 4. Package & I/O contract

`evaluate(context: dict) -> dict` — `SelectorInput`-shaped in,
`ServiceSelectorOutput`-shaped out. Purity as P6. The `feature_snapshot` already
carries every A.1 field from the typed World (verified against
`proposal_contracts/seeds/`).

Context fields consumed: `trigger_purpose`, `lifecycle_stage`,
`allowed_service_ids` (already the P4-**eligible** narrowed set),
`eligible_candidates`, `excluded_candidates` (copied through unchanged),
`feature_snapshot`, `feature_provenance`, `enabled_feature_extensions`,
`parameters`, `hyperparameters`. Stateless: returns `uncertainty=null` and
`next_package_runtime_state={}`.

Internal components (each independently testable): `InputValidator`,
`WeightResolver`, `FeatureNormalizer`, `SceneResolver`, `ResponseResolver`,
`CandidateScorer`, `Ranker`, `EvidenceBuilder` (§15).

## 5. Backend wiring (unchanged seam)

`create_proposal_run` and `select_service` (routers/proposal.py) already:
- resolve the frozen matrix row, run P4 `resolve_eligibility`, and pass the
  **eligible** `allowed_service_ids` into `_build_service_context`;
- call `dispatch_selector(..., allowed_service_ids=eligible)` which validates
  into `ServiceSelectorOutput` and downgrades any out-of-allowed-set candidate
  to `candidate_outside_allowed_set`.

P5 changes only **which package** the run selects. `dispatch_selector`,
`AlgorithmEvidence`, and the discrete-event emission (`SERVICE_SELECTED` /
`ALGORITHM_ERROR`) are reused unchanged. The P4 journey engine consumes
`ranked_candidates[0]` exactly as today.

## 6. Safety & eligibility

Eligibility (P4) runs before scoring and is never reversed by any score/weight.
`trigger_purpose` / `lifecycle_stage` are control inputs, never scored. The
§6.4 dominance invariant is recomputed after every config resolve; every
built-in profile must pass (property test) and a failing built-in profile
cannot ship without an explicit versioned decision. The selector is advisory:
low / negative `service_fit` never suppresses a proposal (the upstream trigger
already opened the opportunity); `no_proposal` only when the eligible list is
empty.

## 7. Confidence-shrinkage extension (reconciliation of a doc contradiction)

**Contradiction found.** Milestone §7 lists "confidence shrinkage" in scope and
an acceptance criterion "low-confidence rates have less effect than identical
high-confidence rates." The authoritative algorithm doc says the **baseline**
has no confidence feature (§5.4), lists the two confidence fields as
additional-simulator features the baseline **disables** (§5.6), and **defers**
confidence-weighted sparse history (§19).

**Resolution (owner-approved): add it now, as an opt-in extension that is OFF by
default**, mirroring the content selector's `genre_affinity_v1`:

- Extension id `confidence_shrinkage_v1`, surfaced via
  `enabled_feature_extensions`. Default **off**.
- **Off** ⇒ the two confidence fields stay `available_but_not_used`; the package
  reproduces the frozen doc **byte-for-byte** — the §10 worked example
  (`+0.772349`) and the §6.4 dominance table are unchanged.
- **On** ⇒ acceptance/recovery evidence is shrunk toward neutral by its
  confidence: `e_acceptance ← e_acceptance · confidence_acc[c]`,
  `e_recovery ← e_recovery · confidence_rec[c]` (a missing confidence entry ⇒
  `1.0`, disclosed in evidence). Shrinking a two-directional evidence value
  toward `0` weakens sparse rates relative to identical high-confidence rates,
  satisfying the milestone criterion. Response coefficient stays `+1.0`; the
  shrink is applied to the evidence step only and carries visible provenance
  (`confidence_shrinkage_v1`).
- A **firewall test** proves the off-state result equals the no-extension
  result exactly (mirrors the genre-extension firewall).

This keeps the baseline exactly as the doc freezes it while delivering the
requested feature. The algorithm doc (§5.4/§5.6/§19) and milestone §17 are
amended with this written rationale (§10 below).

## 8. Simulator state / discrete events

None added. Deterministic stateless selector; no runtime state carried between
calls; no new event types. Plugs into the existing P1/P4 event stream.

## 9. Test strategy & milestone exit demo

Full algorithm §16 suite plus:

- **Math:** effective weights sum to 1 for every default purpose; every
  `e, a, r ∈ [−1,+1]`; `k = w·r ∈ [−w,+w]`; all-neutral world → 0 for every
  candidate; **§10 reproduces `+0.772349` within `1e-12`**; scaling all sibling
  weights by a constant changes nothing; every built-in profile satisfies
  `W_D·1.00 > 2·W_L`; adversarial dominant-gap pair keeps the higher-safety
  candidate first; an invariant-violating customer profile stays evaluable but
  emits `dominance_not_guaranteed` + required gap.
- **Features:** boundaries `0`/`100`; γ at validation bounds; every ordinal/
  enum map; empty/duplicate/recognized/unknown route/destination tags; every
  scene predicate + multi-scene mean; oshi invalid-state rejection; missing
  candidate history → neutral disclosed; acceptance/recovery `0/50/100 →
  −1/0/+1`.
- **Response matrix:** Slide-67-preferred driving services `+1.0` activation;
  route supports music + humming; passengers support named shared services;
  mountain opposes high-interaction; `radio_style` responds only to oshi
  (strongly) and neutral elsewhere; oshi-mode-off opposes; direct features
  `+1.0`; every eligible candidate × feature cell has a coefficient +
  provenance + source/null.
- **Eligibility / ranking:** no excluded candidate scored; no candidate outside
  the purpose/stage row; empty eligibility → `no_proposal`; low/negative fit
  still ranked; full-precision rank; `candidate_id` tie-break; all 17 rows per
  scored candidate; subtotals reconcile to `service_fit` within tolerance;
  overrides + source provenance both present.
- **Extension firewall:** `confidence_shrinkage_v1` off == baseline exactly; on
  shrinks sparse acceptance/recovery.
- **Determinism:** identical frozen inputs + versions reproduce the ranking
  (`1e-12`); same-runtime canonical replay byte-equal.
- **Contrast goldens:** the §11 13 one-field contrasts on frozen fixture
  worlds.
- **Regression:** existing 838 proposal tests + trigger simulator stay green.

**Exit demo (E2E):** `docker compose up`; select the transparent service
package; run the inattentive② worked-example world; show Panel ③ real trace +
dominance readout; edit a weight and show the explanation change; confirm the
persisted evidence separates facts from any review.

## 10. Master-document reconciliations

- **Milestone `aica_proposal_simulator_milestones.md` §17** — add a resolved
  item: "Confidence shrinkage — RESOLVED P5: implemented now as the opt-in,
  off-by-default `confidence_shrinkage_v1` extension (owner decision), keeping
  the algorithm-doc baseline frozen; the off-state reproduces the no-extension
  result. Amends algorithm §5.4/§5.6/§19."
- **`aica_transparent_service_proposal_algorithm.md`** — note in §5.4 / §5.6
  that the two confidence fields, `available_but_not_used` in the baseline, are
  brought forward as the opt-in `confidence_shrinkage_v1` extension; update §19
  to record that the confidence-weighted sparse-history piece is partially
  delivered as this opt-in extension (the full probabilistic uncertainty
  package remains deferred). The baseline default is unchanged.
- No other master doc changes; the response matrices, weights, and dominance
  math are consumed verbatim.

## 11. Compatibility & isolation

- No `aica_api.models` (trigger) import from any proposal module (isolation
  invariant, carried from P1/P3/P4).
- Trigger simulator + its tests untouched (regression gate).
- htmlapp has **no** proposal-simulator code → no htmlapp sync (verified).
- Generated artifacts (dataset, matrix, capabilities) unchanged.

## 12. Acceptance-criterion → verification map (summary; full map in tasks.md)

Milestone §7 (8 criteria) and algorithm §17 (10 criteria) each map to ≥1 test in
§9. The single previously-unsatisfiable criterion (low-confidence < high) is met
by the §7 opt-in extension. Every contract row is marked `used` /
`available_but_not_used` in evidence (feature gate).

## 13. Risks / notes

- The extended contract must keep mock output valid — enforced by keeping every
  new field optional and by a test that loads the mock output through the model.
- The §10 worked-example golden is the anchor for the whole math implementation;
  build it first (TDD) so the weight/normalization/response wiring is pinned
  before the trace/evidence layer.
- Purpose-multiplier normalized-weight table (§6.2) is a golden fixture; a
  computed-vs-doc test guards drift.
