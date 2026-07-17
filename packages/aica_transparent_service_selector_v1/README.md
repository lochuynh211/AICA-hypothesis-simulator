# aica_transparent_service_selector_v1 — Transparent Service Selector (P5)

The real, inspectable replacement for `mock_service_selector_v1`'s fixed
illustrative ranking. Scoring math is authoritative in
**[`docs/master/aica_transparent_service_proposal_algorithm.md`](../../docs/master/aica_transparent_service_proposal_algorithm.md)**;
the P5 milestone's own spec/plan/tasks live under
**[`specs/016-proposal-p5-transparent-service-selector/`](../../specs/016-proposal-p5-transparent-service-selector/)**.
This file documents the *shipped* implementation; where the two disagree,
the algorithm doc wins.

## Contract

```python
def evaluate(context: dict) -> dict: ...
```

`context` is `SelectorInput`-shaped (see `data-model.md`); the return value
is `ServiceSelectorOutput`-shaped. The module is a standalone
`python_module` package (`algorithm.type: "python_module"` in
`package.json`): **no file/network I/O, no clock, no randomness, and no
`aica_api` import of any kind** — it imports only the stdlib `math` module
(pinned by `app/api/tests/proposal/test_p5_isolation.py`). It is loaded by
file path exactly the way the runtime dispatcher loads any
`python_module` package (`aica_api.services.proposal_selector`); any raised
exception becomes an `algorithm_error` evidence event, never a fabricated
ranking.

## The symbol chain, end to end

Every one of the 17 baseline features (§5.3 of the algorithm doc) flows
through the same six-symbol pipeline, per candidate:

```text
x  →  e  →  a  →  r  →  w  →  k  →  Σk = service_fit
```

| Symbol | Meaning | Computed by |
|---|---|---|
| `x` | the raw world input (`feature_snapshot` value) | caller-supplied |
| `e` | normalized evidence, `[0,1]` one-directional or `[-1,+1]` two-directional | `resolve_scalar_evidence` / `resolve_road_evidence` / `resolve_direct_evidence` (`FeatureNormalizer` + `SceneResolver`) |
| `a` | the candidate's response coefficient for this feature (`[-1,+1]`) | `resolve_response` (`ResponseResolver`, reading `service_response_profiles` / `road_response_profiles` from `parameters`), then `_apply_response_override` |
| `r` | `r = clamp(e·a, -1, +1)` | inline in `evaluate()`'s scoring loop |
| `w` | this feature's effective weight (`Σw = 1` across all 17) | `resolve_weights` (`WeightResolver`: normalize siblings → base = category×subgroup×leaf → apply purpose multiplier → renormalize) |
| `k` | `k = w·r`, this feature's signed contribution | inline in `evaluate()`'s scoring loop |
| `service_fit` | `clamp(Σk, -1, +1)` per candidate | `evaluate()`, then `Ranker`: sort by `(service_fit desc, candidate_id asc)`, take `top_k` |

`situation_fit` / `preference_fit` / `history_fit` (per-candidate subtotals)
reconstruct the *unclamped* `Σk` by category — explanatory only, never a
sort key, never rescaled (SS9 step 6). `strongest_support` /
`strongest_oppose` pick the single largest positive/negative `k` row. The
SS6.4 `dominance` readout (`compute_dominance`) is a pure function of the
resolved weights alone — identical for every candidate scored in one
`evaluate()` call, attached both per-candidate and at the top level.

Road type (`road_type`) is the one categorical feature: `e_road = 1`
always, so `r_road = a_road(c)` — the road response *is* the evidence, no
intensity multiplier.

### Direct candidate-indexed features (SS5.4)

Five of the 17 features — `service_recency_state`, `service_usage_level`,
`scene_service_usage_level`, `service_proposal_acceptance_rate`,
`service_recovery_rate` — read a **per-candidate** raw value whose sign
already carries the direction of evidence, so their response coefficient is
fixed at `+1.0` for *every* candidate (`cdc_su_direct_candidate_feature`
provenance) rather than looked up in `service_response_profiles`. They are
still overridable via `response_coefficient_overrides` exactly like any
other cell (see `test_p5_service_math.py::test_editable_response_override_on_direct_feature`)
— the override branch just starts from an inline-constructed cell instead
of a `parameters`-table lookup.

## The 11 supported `ServiceId`s — and why during-rest is out of scope

`package.json`'s `supported_services` lists 11 of the platform's `ServiceId`
values, split across three lifecycle-stage response matrices (`§5.2`):

- **`before_rest_until_stop` / `active_driving_content`** (§5.2.1 + §5.2.2 road) — `music_playlist`, `humming_karaoke`, `call_response_driving`, `quiz`, `ranking_creation`, `radio_style`.
- **`after_rest_before_restart`** (§5.2.4) — `live_viewing`, `stretch_video`, `full_karaoke`, `call_response_stopped`, `oshi_reexperience`.

`package.json`'s `candidate_stage_family["during_rest_stopped"]` is
deliberately **`[]`** — an empty candidate family. Slide 67 (the sole
sourcing authority for this package's response coefficients, §5.5) gives
**no** during-rest action matrix; §5.2.3's "during-rest actions"
(`rest_duration_suggestion`, `rest_method_suggestion`, `seat_adjustment`,
`nap_guidance`, `rest_extension_check`) are not `ServiceId` members at all
in this contract. Consequently:

- An eligible-candidate list under `during_rest_stopped` is always empty in
  practice → `decision_type = "no_proposal"`.
- A caller that erroneously supplies a candidate for that stage is rejected
  **before scoring** by the `candidate_stage_family` check in `evaluate()`
  (raises `_CatalogError` → `invalid_catalog`, never a fabricated ranking).

This is a documented limitation carried from the package's first unit, not
an oversight — implementing §5.2.3 would require inventing `ServiceId`s the
platform contract does not define.

## Response-profile provenance

Every cell of `service_response_profiles` / `road_response_profiles`
carries `{coefficient, provenance, source_reference}`, never a bare number.
Provenance values used across the matrix:

| Provenance | Meaning |
|---|---|
| `cdc_su_explicit` | Slide 67 names this candidate in this row's column, verbatim |
| `neutral_source_silent` | Slide 67 names this candidate in *none* of the driver/environment/route/passenger/oshi rows → `0.0` |
| `normalized_context_hypothesis` | the road-type interaction-load hypothesis (§5.2.2 mountain ±0.5/±1.0) — a safety-motivated hypothesis, not a Slide-67-explicit judgment; never removes eligibility, only reorders |
| `rest_action_hypothesis` | §5.2.3 during-rest cells (not scored here — see above) |
| `post_rest_hypothesis` | §5.2.4 post-rest cells not directly named by Slide 67 §1's passenger/oshi/route rows (e.g. `call_response_stopped`'s child/group/drowsy/fatigue mild responses) |
| `cdc_su_direct_candidate_feature` | the 5 direct features (§5.4) — coefficient fixed `+1.0`, direction lives entirely in the evidence sign |
| `confidence_shrinkage_v1` | the opt-in extension's marker on the acceptance/recovery rows when the hyperparameter is `true` (see below) — replaces `cdc_su_direct_candidate_feature` on just those two rows |
| `customer_override` | not a provenance value itself — an *additional* field added beside the retained original provenance whenever `response_coefficient_overrides` supplies a value for that candidate × feature cell (§4.2/§12: "Customer edits retain the original provenance and add `customer_override` with the changed value") |

## Externalized configuration surface (`package.json`)

**Structural `parameters`** (versioned with the package, not customer-editable):
`service_response_profiles`, `road_response_profiles`, `candidate_stage_family`,
`recognized_route_tags` / `recognized_destination_tags`, `usage_ordinal_map`
(`never −1 / low −.5 / med +.25 / high +1`), `recency_ordinal_map`
(`recent 0 / long_unused .5 / never 1`), `top_k` (3), `material_safety_gap`
(1.00).

**Customer-editable `hyperparameters`** (frozen per run, recorded in
evidence both as entered and as resolved): `hierarchy_weights` (the §6.1
category/subgroup/leaf share tree — ratios, not required to sum to 1;
siblings are normalized by the `WeightResolver`), `purpose_multipliers`
(the §6.2 per-subgroup × per-purpose table), `gamma_drowsiness` /
`gamma_fatigue` / `gamma_monotony` (the `(x/100)^γ` exponent, default
`1.0`), `route_tag_saturation` / `destination_tag_saturation` (default
`2`), `monotony_medium_min` / `monotony_high_min` (scene-taxonomy
thresholds, §5.7), `safety_share_warning_floor` (`0.40`, a non-blocking
reviewer warning — see the dominance readout below),
`response_coefficient_overrides` (an optional
`{candidate_id: {feature_id: coefficient}}` map — finite, `[-1,+1]`,
never clamped; out-of-range/NaN/inf is rejected as `invalid_configuration`,
see `test_p5_service_math.py::test_override_rejected`), and
`confidence_shrinkage_v1` (below).

`evaluate()` records **both** sides of every configurable value: the
reviewer-entered `hierarchy_weights` / `purpose_multipliers` /
`response_coefficient_overrides` verbatim (`resolved_config_versions`) and
the `Σ=1`-normalized `effective_weights` actually used to score — "the
resolved normalized values are recorded beside the customer-entered ones"
(doc §12). The §6.4 dominance invariant (`W_D · material_safety_gap > 2·W_L`,
where `D` = Driver State + Driving Environment + Recovery) is recomputed
after every resolve and reported as `default_dominance_preserved` or
`dominance_not_guaranteed` — it never blocks scoring or silently reweights,
only discloses.

## The `confidence_shrinkage_v1` extension (opt-in, default `off`)

Declared as a boolean hyperparameter (`default: false`). Baseline-only
scoring has no confidence/sample-count feature for the two history rates
(`service_proposal_acceptance_rate`, `service_recovery_rate`) — sparse
rates cannot be shrunk, and the two confidence fields
(`service_proposal_acceptance_confidence`, `service_recovery_confidence`,
living under `feature_snapshot.additional_proposed`) sit inert, reported in
`unused_available_features` (§5.6 "features not used").

When a customer turns `confidence_shrinkage_v1` **on**, those two fields are
brought forward: `e ← e · clamp(confidence[c], 0, 1)` (missing confidence ⇒
`1.0`, i.e. no shrink, and the row's `normalization_function` discloses the
missing-confidence fact) — purely additive to the **evidence** step; the
response coefficient stays `+1.0` (still a direct feature), and the
affected rows' `response_provenance` switches to `confidence_shrinkage_v1`
so the trace shows exactly which rows the extension touched.

**Firewall**: with the hyperparameter `off` (the default), the package is
byte-for-byte identical to the pre-extension baseline across the worked
example and every contrast fixture, regardless of what confidence values
happen to be present in the world — see
`test_p5_confidence_shrinkage.py`'s `test_off_*` tests and
`test_p5_determinism.py`. This mirrors the content selector's
`genre_affinity_v1` opt-in pattern. The full probabilistic
uncertainty-ranking package this partially anticipates remains deferred
(algorithm doc §19).

## Golden fixtures & required-test coverage

`proposal_contracts/fixtures/service/`:

- `worked-example.json` — the doc's §10 inattentive② world; reproduces
  `humming_karaoke ≈ +0.772350` (see `worked-example.golden.md` for the
  documented ~1.4e-6 doc-rounding note) and ranks it above `music_playlist`.
- `contrast-01..13-*.json` — the doc's §11 13 one-field contrasts (drowsiness
  / fatigue / monotony / traffic / road / day-night / child / oshi-mode /
  recency / overall-usage / recovery-rate / purpose-switch / mountain
  interaction-drop), each freezing every field but one and asserting the
  documented reorder **direction** (never an invented number) — see
  `test_p5_contrast_golden.py`.

Cross-cutting guards: `test_p5_determinism.py` (identical frozen
input+config ⇒ byte-equal canonical output, `1e-12`-exact floats, no
`-0.0`), `test_p5_isolation.py` (this package's sole import is `math`;
`service_output.py` imports nothing from the trigger `aica_api.models`),
`test_p5_no_probability_claims.py` (the output never labels `service_fit`
as an acceptance/recovery probability or a safety certification).

## What this package deliberately does *not* score

§5.5/§5.6 of the algorithm doc: the content-selection slides (68–73,
including Slide 70) belong to the **separate** content selector
(`aica_transparent_content_selector_v1`) and play no role here — UPro
age/gender/hobbies, playback/operation history, schedule, and item-level
novelty. Motion state, minutes-to-a-rest-spot, the currently-active
service, and recent-rejection signals are additional-simulator features out
of scope for baseline V1. Nothing in this list may enter `service_fit`;
every excluded key still surfaces (by name) in `unused_available_features`
so nothing is silently dropped.
