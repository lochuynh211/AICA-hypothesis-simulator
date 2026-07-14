# AICA Transparent Service-Proposal Algorithm — Detailed Design and Implementation Specification

**Document status:** Implementation-ready design for review
**Selected approach:** Approach 1 — deterministic normalized hierarchical weighted response
**Scope:** Service proposal only; concrete-content selection is a separate algorithm
**Feature policy:** CDC-SU baseline service features only
**Primary source:** <code>others/CDC-SU_specplan.md</code>, especially Slides 38–40 and 64–67
**Parent specification:** <code>docs/master/aica_proposal_simulator_specification.md</code>
**Date:** 2026-07-13

---

## 1. Purpose

This document defines the transparent algorithm that ranks AICA service proposals after a proposal opportunity already exists.

It is both:

1. the long-form explanation used to present the hypothesis to product, safety, UX, and customer reviewers; and
2. the detailed contract from which an implementation and its tests can be written.

The algorithm answers:

> Given the current trigger purpose, lifecycle stage, eligible services, and all CDC-SU baseline service features, which services best fit the current synthetic context under an explicit customer-editable hypothesis?

The output is up to three ranked services with complete feature-level arithmetic. The canonical <code>service_fit</code> is a signed normalized value in [-1, +1]; it is not a probability of acceptance, a measured recovery effect, or a safety certification.

---

## 2. Selected Design

The selected design is a deterministic normalized weighted response model.

For each eligible candidate service, the algorithm:

1. reads every CDC-SU baseline feature;
2. normalizes the observed feature into evidence;
3. resolves how the candidate responds to that evidence;
4. multiplies the normalized feature response by its effective feature weight to obtain a signed normalized feature contribution;
5. sums the feature contributions directly into <code>service_fit</code>;
6. ranks candidates by their signed normalized service fit.

There are no ranking bands and no minimum-fit threshold.

This is an intentional refinement of the parent specification’s initial
lexicographic-band proposal. In the selected Approach 1, absolute safety is
owned by hard eligibility; relative suitability is expressed by visible,
editable weights. The default weights also satisfy the continuous dominance
invariant in Section 4.3. Customer overrides are evaluation hypotheses and are
not silently prevented, but the evidence states whether the invariant remains
satisfied.

The only ordering keys are:

    service_fit descending
    stable candidate_id ascending for an exact numerical tie

Situation, Preference, and History fit subtotals are explanatory views of the
same normalized feature contributions. They are not additional sorting keys
and are never counted twice.

---

## 3. Source Intent Preserved by the Algorithm

### 3.1 Two decisions remain separate

Slides 64–66 distinguish:

1. selecting and ordering a service; and
2. selecting a concrete mode, genre, playlist, song, video, or plan within that service.

This document covers only the first decision. Service fit must not include
concrete catalog-item scores produced by the later content selector.

### 3.2 The trigger purpose is supplied, not inferred

The selector receives exactly one control value:

| Trigger purpose | Meaning |
|---|---|
| <code>rest_recommended</code> | A rest-support journey is active |
| <code>inattentive_driving_prevention_recovery</code> | Driving content should help prevent inattentive driving or support recovery |
| <code>route_music</code> | Route- or destination-relevant content is being proposed |
| <code>child_passenger_experience</code> | Child-compatible shared content is being proposed |

The algorithm must not reconstruct this purpose from drowsiness, route tags, passenger state, or a scenario name.

### 3.3 Lifecycle stage constrains the choice

The lifecycle stage selects the applicable service family. It is not a scoring feature.

| Trigger purpose | Lifecycle stage | Default candidates |
|---|---|---|
| <code>rest_recommended</code> | <code>before_rest_until_stop</code> | Music playlist, humming karaoke, quiz, ranking creation, radio style, driving call-and-response |
| <code>rest_recommended</code> | <code>during_rest_stopped</code> | Rest-duration suggestion, rest-method suggestion, seat adjustment, nap guidance, rest-extension check |
| <code>rest_recommended</code> | <code>after_rest_before_restart</code> | Live viewing, stretch video, full karaoke, oshi reexperience |
| <code>inattentive_driving_prevention_recovery</code> | <code>active_driving_content</code> | Music playlist, humming karaoke, quiz, ranking creation, radio style, driving call-and-response |
| <code>route_music</code> | <code>active_driving_content</code> | The same six driving services |
| <code>child_passenger_experience</code> | <code>active_driving_content</code> | The same six driving services |

V1 intentionally follows the parent’s versioned Slides 64–65 constraint
matrix. Slide 38/40 also describes stopped call-and-response, but the parent
post-rest row omits it; that source discrepancy is deferred to a future matrix
version rather than silently adding a fifth post-rest candidate here.

### 3.4 All baseline features are evaluated

The service selector evaluates these 17 baseline features:

1. drowsiness level;
2. fatigue level;
3. traffic state;
4. road type;
5. day/night state;
6. road monotony;
7. route characteristics;
8. destination characteristics;
9. child present;
10. multiple passengers;
11. oshi registered;
12. oshi mode;
13. service recency;
14. overall service usage;
15. scene-specific service usage;
16. service-proposal acceptance rate;
17. service recovery rate.

Simulator-proposed additions such as minutes until a rest spot, active service, recent rejection, confidence, and schedule are excluded from this package.

---

## 4. Safety-First Structure

Safety is implemented in two different layers.

### 4.1 Hard eligibility comes before scoring

The platform/orchestrator constructs:

    catalog services
    intersect purpose/stage allowed services
    intersect motion/capability/readiness eligibility
    equals candidates visible to the selector

Examples of hard exclusions include:

- screen-dependent full karaoke while driving;
- a stopped-only stretch video while driving;
- an oshi-specific action without the required catalog entity;
- disabled or unavailable service content;
- rest-extension checking before the journey engine says that check is applicable.

No weight can reverse a hard exclusion. Excluded services receive no service
fit and are reported with platform reasons.

Motion is not added as a ranking feature. It is a platform eligibility fact because the selected package is restricted to baseline ranking features.

### 4.2 Situation and recovery dominate the default service fit

Among eligible services, the initial hierarchy allocates:

- 80% to Situation;
- 12% to Preference;
- 8% to History.

Within History, recovery receives more weight than acceptance. Purpose multipliers further emphasize driver state and environment for rest and inattentive-driving purposes.

These weights are expert hypotheses, not safety proof. Customers may edit them to evaluate alternatives. Every run records the edited values and the effective normalized weights.

An implementation should display a non-blocking configuration warning when the combined effective share of Driver State, Driving Environment, and Recovery falls below 40%. This warning does not alter service fit. It tells the reviewer that the edited configuration no longer follows the default safety-first intent.

With the initial purpose profiles, that combined share is approximately:

| Purpose | Driver + environment + recovery share |
|---|---:|
| Rest recommended | .788 |
| Inattentive/recovery | .823 |
| Route music | .725 |
| Child experience | .729 |

This table defines its share as Driver State + Driving Environment + Recovery.
It is an explanatory safety-context indicator, distinct from the formal
dominance set below.

### 4.3 Continuous default dominance invariant

Approach 1 does not use bands, but the default configuration must still prove
that a material high-priority advantage cannot be overturned by all
lower-priority evidence.

Define the safety-response set:

    D = Driver State + Driving Environment + Recovery

and the lower-priority set:

    L = every remaining feature

Let:

    W_D = sum of effective weights in D
    W_L = 1 - W_D

    P(c) = sum_i_in_D(w_i * r_i(c)) / W_D
    Q(c) = sum_i_in_L(w_i * r_i(c)) / W_L

Both P and Q are bounded to -1 through +1. For two candidates A and B:

    service_fit(A) - service_fit(B)
      = W_D * (P(A) - P(B))
      + W_L * (Q(A) - Q(B))

The worst possible lower-priority reversal is:

    Q(A) - Q(B) = -2

The package defines a material dominant-context gap:

    material_safety_gap = 1.00

Therefore the default profile has a mathematical non-reversal guarantee when:

    W_D * material_safety_gap > 2 * W_L

Initial profiles:

| Purpose | W_D | W_L | Required gap 2W_L/W_D | Default 1.00 passes |
|---|---:|---:|---:|---|
| Rest recommended | .787939 | .212061 | .538266 | yes |
| Inattentive/recovery | .823048 | .176952 | .429991 | yes |
| Route music | .725407 | .274593 | .757073 | yes |
| Child experience | .729083 | .270917 | .743171 | yes |

This guarantee is continuous: it does not alter service fit and creates no
threshold in candidate ordering. It says only that when A’s normalized
Driver-State-plus-Driving-Environment-plus-Recovery response exceeds B’s by at
least 1.00, even the most adverse possible remaining evidence cannot rank B
above A.

The 1.00 value is an explicit expert definition of “material,” not an empirical
safety boundary or certification.

Customer edits remain permitted. After every edit, the resolver recalculates
the invariant:

- satisfied: record <code>default_dominance_preserved</code>;
- not satisfied: record <code>dominance_not_guaranteed</code> and show the
  required gap;
- never alter weights or candidate ranks silently.

The initial built-in profiles must satisfy the invariant. A package release
cannot change an initial profile to a failing configuration without an
explicit versioned design decision.

---

## 5. Inputs

### 5.1 Required controls and facts

These inputs constrain evaluation but do not contribute to service fit:

| Input | Use |
|---|---|
| <code>trigger_purpose</code> | Select the purpose multiplier profile |
| <code>lifecycle_stage</code> | Select the allowed service family |
| <code>allowed_service_ids</code> | Frozen purpose/stage constraint result |
| <code>eligible_candidates</code> | Platform-approved candidates |
| <code>excluded_candidates</code> | Platform exclusions and reasons |
| <code>catalog_version</code> | Reproduce candidate metadata |
| <code>parameter_version</code> | Reproduce mappings and response profiles |
| <code>hyperparameters</code> | Reproduce weights, multipliers, and curves |

### 5.2 Baseline feature snapshot

The input fields and value types are those in Section 8 of the parent specification.

Scalar situation fields should be present in a normal complete simulator run. Candidate-indexed maps may omit a candidate entry. Missing behavior is defined in Section 14.

Every lifecycle transition creates a fresh current snapshot:

- active-driving and before-rest opportunities use the current driving values;
- at <code>during_rest_stopped</code>, the world sets traffic to
  <code>normal</code>, road type to <code>parking</code>, and road monotony to
  0; drowsiness, fatigue, and day/night remain current values;
- at <code>after_rest_before_restart</code>, the world uses the explicit
  post-rest drowsiness/fatigue values and the same stopped environment
  semantics;
- route/destination and passenger composition remain current trip facts.

The selector must not retain pre-stop congestion, road, or monotony implicitly.
If a future design needs prior-road burden, it requires an explicit versioned
baseline change or proposed-addition feature.

### 5.3 Inputs that must not affect ranking

The following must never enter the service-fit arithmetic:

- candidate UI page or display position;
- previous selector ranking;
- another package score;
- LLM output;
- quick-mode versus interactive-mode selection;
- run identifier or random seed;
- proposal screen state;
- additional simulator features disabled by this package.

---

## 6. Core Mathematical Model

### 6.1 Scale contract and terms

For baseline feature <em>i</em> and candidate <em>c</em>:

| Symbol | Serialized name | Meaning | Unit/domain | Exact range |
|---|---|---|---|---:|
| <em>x</em><sub>i</sub> | <code>raw_value</code> | Raw baseline input | Feature-specific | Field-specific |
| <em>e</em><sub>i</sub>(c) | <code>normalized_evidence</code> | Normalized evidence | Normalized | [-1, +1] |
| <em>a</em><sub>i</sub>(c) | <code>response_coefficient</code> | Candidate response coefficient | Normalized | [-1, +1] |
| <em>r</em><sub>i</sub>(c) | <code>normalized_feature_response</code> | Candidate response to current evidence | Normalized | [-1, +1] |
| <em>w</em><sub>i</sub> | <code>effective_weight</code> | Effective normalized weight | Weight share | [0, 1], with sum = 1 |
| <em>k</em><sub>i</sub>(c) | <code>feature_contribution</code> | Weight-scaled signed feature response | Normalized | [-<em>w</em><sub>i</sub>, +<em>w</em><sub>i</sub>] |
| <em>F</em>(c) | <code>service_fit</code> | Sum of all feature contributions | Normalized | [-1, +1] |

The algorithm has one scoring domain: normalized signed values. It contains no
point conversion, percentage score, neutral-point offset, or score-specific
unit. The inherited common selector field <code>ranked_candidates[].score</code>
serializes <code>service_fit</code> directly and therefore also lies in
[-1, +1].

Raw source values may retain their natural input units. For example,
drowsiness, fatigue, and monotony arrive in [0, 100], but their normalized
evidence values are in [0, 1] before they enter the scoring formula. A
one-directional feature uses [0, 1], where 0 means no active evidence. A
two-directional feature may use the full [-1, +1] interval, where 0 is neutral.
Both are subsets of the same normalized scoring domain.

### 6.2 Feature response

For continuous, boolean, and ordinal evidence:

    r_i(c) = clamp(e_i(c) * a_i(c), -1, +1)

For categorical road type, the selected category already resolves a signed candidate response:

    e_road = 1
    a_road(c) = road_response[c][current_road_type]
    r_road(c) = e_road * a_road(c)

For route and destination tag collections, the evidence intensity is multiplied by the candidate’s route or destination adaptability:

    r_tags(c) = tag_evidence_intensity * a_tags(c)

### 6.3 Effective weight

The base weight is the product of normalized weights along the feature hierarchy:

    base_weight_i
      = category_weight
      * subgroup_weight
      * leaf_weight

The trigger purpose adjusts meaningful subgroups:

    effective_raw_weight_i(p)
      = base_weight_i
      * purpose_multiplier[p][subgroup(i)]

All adjusted weights are normalized:

    w_i(p)
      = effective_raw_weight_i(p)
      / sum_j(effective_raw_weight_j(p))

The implementation must reject a configuration in which the denominator is zero.

### 6.4 Feature contribution and service fit

Calculate each normalized signed feature contribution:

    k_i(c) = w_i(p) * r_i(c)

Then sum the contributions directly:

    service_fit(c)
      = F(c)
      = clamp(sum_i(k_i(c)), -1, +1)

Because the weights are non-negative and sum to one, <code>k_i(c)</code> is
bounded to [-<code>w_i</code>, +<code>w_i</code>] and the unclamped sum is
mathematically bounded to [-1, +1]. The final clamp protects only against
floating-point drift; it must not conceal an out-of-range intermediate value
caused by invalid input or an implementation error.

### 6.5 Interpretation

| Service fit | Interpretation |
|---:|---|
| +1 | Theoretical strongest support under the configured hypothesis |
| Between 0 and +1 | Supporting evidence outweighs opposing evidence |
| 0 | Overall neutral evidence |
| Between -1 and 0 | Opposing evidence outweighs supporting evidence |
| -1 | Theoretical strongest opposition under the configured hypothesis |

The number does not represent a probability.

### 6.6 Numeric and serialization semantics

- Arithmetic uses IEEE-754 binary64 values.
- Reject NaN, positive/negative infinity, and non-numeric configurable values.
- Evaluate features in the fixed 17-feature contract order.
- Sum sibling weights, effective weights, and normalized feature contributions
  in that same documented order.
- Use full binary64 values for ranking; round only in presentation.
- Normalize negative zero to positive zero before serialization.
- Exact numeric ties use binary64 equality after the prescribed evaluation
  order.
- Candidate arrays are sorted by the ranking rule; feature-contribution arrays
  stay in contract order.
- Canonical evidence export sorts object keys lexicographically and uses the
  platform’s shortest round-trip JSON representation for finite numbers.

Semantic cross-implementation tests use absolute tolerance 1e-12 for numeric
fields. Canonical byte equality is required only when replaying through the
same package/runtime version and canonical exporter.

---

## 7. Hierarchical Weight Model and Initial Values

### 7.1 Top-level categories

| Category | Initial weight | Rationale |
|---|---:|---|
| Situation | 0.80 | Current driver and road context receive dominant emphasis |
| Preference | 0.12 | Personalization remains useful but cannot dominate safety context |
| History | 0.08 | Synthetic history is useful but unvalidated; recovery is emphasized within it |

Top-level values must be non-negative and at least one must be positive. The evaluator normalizes siblings, so customers may enter ratios rather than values that sum exactly to one.

### 7.2 Situation subgroups

| Subgroup | Initial weight within Situation | Rationale |
|---|---:|---|
| Driver state | 0.50 | Drowsiness and fatigue are the most direct current-state inputs |
| Driving environment | 0.35 | Slide 67 links congestion, highway, night, and monotony to inattentive-driving risk |
| Route context | 0.075 | Route/destination relevance is raised by the route-purpose multiplier |
| Passenger composition | 0.075 | Child/group relevance is raised by the child-purpose multiplier |

Leaf weights:

| Subgroup | Feature | Initial sibling weight |
|---|---|---:|
| Driver state | Drowsiness | 0.55 |
| Driver state | Fatigue | 0.45 |
| Driving environment | Traffic | 0.20 |
| Driving environment | Road type | 0.20 |
| Driving environment | Night | 0.20 |
| Driving environment | Monotony | 0.40 |
| Route context | Route tags | 0.55 |
| Route context | Destination tags | 0.45 |
| Passenger composition | Child present | 0.65 |
| Passenger composition | Multiple passengers | 0.35 |

### 7.3 Preference subgroups

| Subgroup | Initial weight within Preference | Rationale |
|---|---:|---|
| Oshi preference | 0.25 | Explicit oshi settings can materially change personalization |
| Novelty | 0.10 | CDC-SU includes unused functions, but novelty remains weak |
| Overall usage | 0.25 | General service use is a direct preference signal |
| Scene preference | 0.40 | Same-scene behavior is more context-specific than global use |

Oshi leaf weights:

| Feature | Initial sibling weight | Rationale |
|---|---:|---|
| Oshi registered | 0.35 | Registration makes oshi adaptation possible |
| Oshi mode | 0.65 | Mode is an explicit current user setting |

The remaining Preference subgroups each contain one leaf and therefore have an internal leaf weight of 1.

### 7.4 History subgroups

| Feature | Initial weight within History | Rationale |
|---|---:|---|
| Proposal acceptance rate | 0.25 | Represents prior proposal receptiveness |
| Recovery rate | 0.75 | More directly reflects the stated recovery and safety purpose |

### 7.5 Flattened base weights

Before purpose multipliers, the hierarchy produces:

| Feature | Base effective weight |
|---|---:|
| Drowsiness | 0.220000 |
| Fatigue | 0.180000 |
| Traffic | 0.056000 |
| Road type | 0.056000 |
| Night | 0.056000 |
| Monotony | 0.112000 |
| Route tags | 0.033000 |
| Destination tags | 0.027000 |
| Child present | 0.039000 |
| Multiple passengers | 0.021000 |
| Oshi registered | 0.010500 |
| Oshi mode | 0.019500 |
| Service recency | 0.012000 |
| Overall service usage | 0.030000 |
| Scene/service usage | 0.048000 |
| Proposal acceptance | 0.020000 |
| Recovery | 0.060000 |

The values sum to 1.

---

## 8. Trigger-Purpose Multipliers

### 8.1 Why multipliers are used

The same six driving candidates appear for purposes ②–④. A single global weight profile would make route and child purposes too similar to inattentive-driving prevention.

The design therefore keeps one understandable global hierarchy and applies a small purpose-level multiplier table. It does not duplicate all 17 weights for every purpose.

Lifecycle stage does not select another weight set. Stage already controls the candidate family. Candidate response profiles are stable properties of explicit candidate IDs.

### 8.2 Initial multiplier values

| Subgroup | Rest recommended | Inattentive/recovery | Route music | Child experience |
|---|---:|---:|---:|---:|
| Driver state | 1.40 | 1.50 | 1.20 | 1.20 |
| Driving environment | 1.10 | 1.40 | 1.00 | 1.00 |
| Route context | 1.00 | 0.75 | 2.00 | 0.75 |
| Passenger composition | 1.00 | 0.85 | 0.80 | 2.00 |
| Oshi preference | 1.00 | 0.80 | 1.10 | 0.75 |
| Novelty | 0.80 | 0.80 | 0.80 | 0.80 |
| Overall usage | 0.90 | 0.90 | 0.90 | 1.00 |
| Scene preference | 1.00 | 1.10 | 1.10 | 1.20 |
| Proposal acceptance | 1.00 | 1.00 | 1.00 | 1.00 |
| Recovery | 1.30 | 1.25 | 1.00 | 1.00 |

Interpretation:

- a multiplier of 1 leaves the base importance unchanged;
- a value above 1 emphasizes that subgroup for the purpose;
- a value below 1 de-emphasizes it;
- a value of 0 disables its ranking influence but not its evidence trace.

### 8.3 Resulting normalized feature weights

The initial effective weights after multiplier application are:

| Feature | Rest | Inattentive | Route | Child |
|---|---:|---:|---:|---:|
| Drowsiness | .256538 | .254551 | .233546 | .234729 |
| Fatigue | .209895 | .208269 | .191083 | .192051 |
| Traffic | .051308 | .060475 | .049540 | .049791 |
| Road type | .051308 | .060475 | .049540 | .049791 |
| Night | .051308 | .060475 | .049540 | .049791 |
| Monotony | .102615 | .120950 | .099080 | .099582 |
| Route tags | .027486 | .019091 | .058386 | .022006 |
| Destination tags | .022489 | .015620 | .047771 | .018005 |
| Child present | .032484 | .025571 | .027601 | .069352 |
| Multiple passengers | .017491 | .013769 | .014862 | .037343 |
| Oshi registered | .008746 | .006479 | .010218 | .007002 |
| Oshi mode | .016242 | .012033 | .018976 | .013003 |
| Service recency | .007996 | .007405 | .008493 | .008536 |
| Overall service usage | .022489 | .020827 | .023885 | .026674 |
| Scene/service usage | .039980 | .040728 | .046709 | .051214 |
| Proposal acceptance | .016658 | .015427 | .017693 | .017783 |
| Recovery | .064968 | .057853 | .053079 | .053348 |

The implementation calculates these values; they should not be duplicated as independently editable configuration.

---

## 9. Candidate Response Coefficients

### 9.1 Meaning

The candidate response coefficient answers:

> When this evidence is present, does this candidate respond appropriately, remain neutral, or conflict with it?

It is not learned from driver data.

### 9.2 Response classes

Initial response classes are deliberately coarse:

| Class | Coefficient | Meaning |
|---|---:|---|
| <code>strongly_opposes</code> | -1.00 | Material mismatch among otherwise eligible candidates |
| <code>opposes</code> | -0.50 | Relative mismatch |
| <code>neutral</code> | 0.00 | No justified influence |
| <code>supports</code> | +0.50 | Useful response |
| <code>strongly_supports</code> | +1.00 | Explicitly preferred or strongly capable |

Neutral is the default when the source does not justify a direction. “Not listed as preferred” must not automatically become negative.

### 9.3 Provenance

Each response entry stores one provenance label:

| Label | Meaning |
|---|---|
| <code>cdc_su_explicit</code> | Directly supported by Slide 67 |
| <code>service_definition</code> | Derived from Slides 38–40 service behavior |
| <code>normalized_context_hypothesis</code> | Required for normalized simulator values such as mountain roads |
| <code>rest_action_hypothesis</code> | Expert default because Slide 67 does not detail during-rest actions |
| <code>neutral_source_silent</code> | Kept neutral because no direction is justified |

Customer edits retain the original provenance and add <code>customer_override</code> with the changed value.

---

## 10. Feature Normalization and Response Functions

This section defines how every baseline feature is evaluated. Raw values retain
their source units only at the input boundary; no raw numeric value enters the
service-fit formula. Every numeric, boolean, ordinal, or categorical feature is
first converted to normalized evidence in [0, 1] or [-1, +1].

### 10.1 Drowsiness level

Input:

    drowsiness_level in [0, 100]

Evidence:

    e_drowsiness = (drowsiness_level / 100) ^ gamma_drowsiness

Therefore:

    e_drowsiness in [0, 1]

Initial hyperparameter:

    gamma_drowsiness = 1.0

Meaning:

- zero drowsiness is absence of drowsiness evidence, not evidence against all activating services;
- increasing drowsiness strengthens the configured service response;
- gamma below 1 makes moderate values influential sooner;
- gamma above 1 reserves stronger influence for high values.

Recommended tuning range: 0.50–3.00. Implementation validation range: 0.25–4.00.

### 10.2 Fatigue level

Input:

    fatigue_level in [0, 100]

Evidence:

    e_fatigue = (fatigue_level / 100) ^ gamma_fatigue

Therefore:

    e_fatigue in [0, 1]

Initial hyperparameter:

    gamma_fatigue = 1.0

Recommended and validation ranges are the same as drowsiness.

### 10.3 Traffic state

Input:

    normal | congested

Evidence:

    normal    -> 0
    congested -> 1

The candidate coefficient states whether it responds to congestion-related inattentive-driving risk. Normal traffic is neutral rather than an opposing signal.

### 10.4 Road type

Input:

    highway | local | mountain | parking

Road type directly selects a signed response coefficient:

    e_road = 1
    a_road(c) = road_response[c][road_type]
    r_road(c) = e_road * a_road(c)

The evidence trace therefore records numeric normalized evidence 1, the
selected response class/coefficient, and the resulting response. There is no
additional intensity multiplier. This preserves the categorical meaning while
keeping the common evidence schema uniform.

Highway preferences follow Slide 67. Mountain-road defaults are explicitly labeled safety-oriented normalized-context hypotheses: low-interaction audio is mildly supported, while demanding interactive services are relatively opposed. Parking is neutral because driving/stopped permissibility belongs to eligibility.

### 10.5 Day/night state

Input:

    day | night

Evidence:

    day   -> 0
    night -> 1

Night activates the service’s night-response coefficient. Day is neutral.

### 10.6 Road monotony

Input:

    monotony_level in [0, 100]

Evidence:

    e_monotony = (monotony_level / 100) ^ gamma_monotony

Therefore:

    e_monotony in [0, 1]

Initial hyperparameter:

    gamma_monotony = 1.0

Recommended range: 0.50–3.00. Validation range: 0.25–4.00.

### 10.7 Route characteristics

Input:

    route_tags: string array

At service-selection level, the algorithm measures whether a distinctive route context exists and whether the service can adapt to it. Exact song/item matching remains the content selector’s responsibility.

    recognized_count = count(unique recognized route_tags)

    e_route
      = min(1, recognized_count / route_tag_saturation)

Initial hyperparameter:

    route_tag_saturation = 2

Then:

    r_route(c) = e_route * route_response(c)

Unknown tags are ignored in the calculation and reported. An empty or wholly unknown tag set is neutral.

Recommended saturation range: 1–4. Validation range: 1–10.

### 10.8 Destination characteristics

The destination function is equivalent:

    e_destination
      = min(1, recognized_unique_destination_tags
               / destination_tag_saturation)

    r_destination(c)
      = e_destination * destination_response(c)

Initial hyperparameter:

    destination_tag_saturation = 2

### 10.9 Child present

Input:

    child_present: boolean

Evidence:

    false -> 0
    true  -> 1

A false value is neutral. It does not imply that child-incompatible adult content should be preferred.

### 10.10 Multiple passengers

Input:

    multiple_passengers: boolean

Evidence:

    false -> 0
    true  -> 1

The response profile favors services suited to shared participation.

### 10.11 Oshi registered

Input:

    oshi_registered: boolean

Evidence:

    false -> 0
    true  -> 1

No registration is neutral for generic services. Catalog eligibility separately removes an oshi-only candidate when its required entity is unavailable.

### 10.12 Oshi mode

Input:

    on | off

Evidence:

    off -> -1
    on  -> +1

Unlike absence of registration, mode off is an explicit setting and therefore opposes oshi-focused adaptation.

The combination <code>oshi_registered=false</code> and <code>oshi_mode=on</code> is invalid input.

### 10.13 Service recency

The current candidate selects its map entry:

    service_recency_state[candidate_id]

Normalization:

    recent      -> 0.00
    long_unused -> 0.50
    never       -> 1.00

The coefficient is fixed to +1. Recency creates only a novelty bonus. Recent use is neutral, not a penalty. This preserves novelty as a weak P4 influence and avoids aggressively rotating away from preferred services.

### 10.14 Overall service usage

The current candidate selects:

    service_usage_level[candidate_id]

Normalization:

    never  -> -1.00
    low    -> -0.50
    medium -> +0.25
    high   -> +1.00

The coefficient is fixed to +1.

These values make high usage strong supporting preference evidence, low/never usage opposing preference evidence, and medium usage mildly supportive. Novelty remains independently represented by service recency.

### 10.15 Scene-specific service usage

The algorithm derives a set of current scene IDs from baseline situation features:

- <code>traffic:congested</code>;
- <code>road:highway</code>, <code>road:local</code>, <code>road:mountain</code>, or <code>road:parking</code>;
- <code>time:night</code>;
- <code>monotony:medium</code> for 34–66;
- <code>monotony:high</code> for 67–100;
- <code>passenger:child</code>;
- <code>passenger:group</code>;
- one <code>route:&lt;tag&gt;</code> entry per recognized route tag;
- one <code>destination:&lt;tag&gt;</code> entry per recognized destination tag.

For each matching scene with a candidate entry, normalize its usage level with the overall-usage mapping. The evidence is the arithmetic mean:

    e_scene(c)
      = mean(normalized scene usage values for candidate c)

If no matching scene has a candidate record, evidence is 0 and the field is reported as unavailable for that candidate.

The coefficient is fixed to +1.

The scene taxonomy and thresholds are versioned parameters. They are not hidden runtime inference.

### 10.16 Service-proposal acceptance rate

The current candidate selects:

    service_proposal_acceptance_rate[candidate_id]

Normalization:

    e_acceptance(c)
      = 2 * acceptance_rate(c) / 100 - 1

Examples:

| Rate | Evidence |
|---:|---:|
| 0 | -1.0 |
| 25 | -0.5 |
| 50 | 0.0 |
| 75 | +0.5 |
| 100 | +1.0 |

The coefficient is fixed to +1.

Because baseline-only mode contains no confidence/sample-count feature, the algorithm cannot shrink sparse rates. The input must therefore be described as a synthetic configured rate, not a reliable empirical estimate.

### 10.17 Service recovery rate

The current candidate selects:

    service_recovery_rate[candidate_id]

Normalization:

    e_recovery(c)
      = 2 * recovery_rate(c) / 100 - 1

The coefficient is fixed to +1.

The same no-confidence limitation applies. Recovery is synthetic evidence, not a clinical claim.

---

## 11. Initial Candidate Response Profiles

Abbreviations used in the following tables:

| Code | Coefficient |
|---|---:|
| <code>--</code> | -1.0 |
| <code>-</code> | -0.5 |
| <code>0</code> | 0.0 |
| <code>+</code> | +0.5 |
| <code>++</code> | +1.0 |

### 11.1 Driving services

These defaults follow Slide 67:

- high drowsiness/fatigue and risk-related environment favor humming karaoke, call-and-response, quiz, and ranking;
- distinctive route/destination favors music playlist and humming karaoke;
- child/group presence favors humming karaoke, call-and-response, quiz, and ranking;
- radio-style oshi support follows Slide 39; other oshi-aware service variants
  are explicitly labeled expert hypotheses.

The Slide-67 driver/environment preference is explicit for purposes ②–④.
When the same driving services are used before a recommended rest, the numeric
response profile is an expert generalization about keeping the driver engaged
until stopping, not a claim that Slide 67 explicitly prioritizes those services
for purpose ①. Humming karaoke additionally appears in the source rest journey.
The evidence provenance must therefore be context-sensitive even where the
numeric coefficient is shared.

| Candidate | Drowsy | Fatigue | Congested | Night | Monotony | Route | Destination | Child | Group | Oshi registered | Oshi mode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <code>music_playlist</code> | 0 | 0 | 0 | 0 | 0 | ++ | ++ | 0 | 0 | + | + |
| <code>humming_karaoke</code> | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | + | ++ |
| <code>call_response_driving</code> | ++ | ++ | ++ | ++ | ++ | 0 | 0 | ++ | ++ | + | + |
| <code>quiz</code> | ++ | ++ | ++ | ++ | ++ | 0 | 0 | ++ | ++ | + | + |
| <code>ranking_creation</code> | ++ | ++ | ++ | ++ | ++ | 0 | 0 | ++ | ++ | + | + |
| <code>radio_style</code> | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ++ | ++ |

Road-type response:

| Candidate | Highway | Local | Mountain | Parking |
|---|---:|---:|---:|---:|
| <code>music_playlist</code> | 0 | 0 | + | 0 |
| <code>humming_karaoke</code> | ++ | 0 | - | 0 |
| <code>call_response_driving</code> | ++ | 0 | - | 0 |
| <code>quiz</code> | ++ | 0 | -- | 0 |
| <code>ranking_creation</code> | ++ | 0 | -- | 0 |
| <code>radio_style</code> | 0 | 0 | + | 0 |

The mountain values are normalized-context safety hypotheses, not explicit CDC-SU judgments. They reduce interactive cognitive load on a demanding road while still leaving every platform-eligible service available for customer evaluation.

### 11.2 During-rest actions

Slide 67 does not provide an action-by-feature matrix for the during-rest stage. These defaults are explicitly labeled <code>rest_action_hypothesis</code>.

| Candidate | Drowsy | Fatigue | Congested | Night | Monotony | Route | Destination | Child | Group | Oshi registered | Oshi mode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <code>rest_duration_suggestion</code> | + | + | 0 | + | 0 | 0 | 0 | + | + | 0 | 0 |
| <code>rest_method_suggestion</code> | + | ++ | 0 | + | 0 | 0 | 0 | ++ | + | 0 | 0 |
| <code>seat_adjustment</code> | 0 | + | 0 | 0 | 0 | 0 | 0 | + | + | 0 | 0 |
| <code>nap_guidance</code> | ++ | ++ | 0 | ++ | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| <code>rest_extension_check</code> | ++ | ++ | 0 | ++ | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Traffic, road type, and monotony are neutral for all during-rest actions because
the stopped snapshot resets those current-environment fields as specified in
Section 5.2. Night remains current and can affect nap/rest suitability.

The journey engine must not offer <code>rest_extension_check</code> until it is applicable. That is eligibility, not service fit derived from baseline features.

### 11.3 Post-rest stopped services

| Candidate | Drowsy | Fatigue | Congested | Night | Monotony | Route | Destination | Child | Group | Oshi registered | Oshi mode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <code>live_viewing</code> | + | + | 0 | 0 | 0 | 0 | + | ++ | ++ | ++ | ++ |
| <code>stretch_video</code> | ++ | ++ | 0 | 0 | 0 | 0 | 0 | + | + | 0 | 0 |
| <code>full_karaoke</code> | + | + | 0 | 0 | 0 | + | + | ++ | ++ | + | ++ |
| <code>oshi_reexperience</code> | + | + | 0 | 0 | 0 | ++ | ++ | + | + | ++ | ++ |

Traffic, road type, and monotony are neutral for all post-rest stopped services.
Screen eligibility is enforced by the stopped stage.

### 11.4 Direct candidate-specific features

For all candidates in all stages:

| Feature | Candidate response coefficient |
|---|---:|
| Service recency | +1 |
| Overall service usage | +1 |
| Scene/service usage | +1 |
| Proposal acceptance rate | +1 |
| Recovery rate | +1 |

The candidate-specific raw value already contains the direction of evidence.

### 11.5 Machine-implementable per-cell provenance

The numeric tables above are presentation views. The serialized parameter
record must expand every candidate × feature × profile-context cell:

    response_cell:
      profile_context: string
      candidate_id: string
      feature_id: string
      enum_value: string-or-null
      response_class: string
      coefficient: number
      provenance_label: string
      source_reference: string-or-null
      rationale: string

There is no runtime guess based on surrounding prose. Package build validation
fails if an eligible candidate lacks any cell, including an explicit neutral
cell.

The default expansion rules are:

#### Active-driving purposes ②–④

| Cells | Provenance | Source |
|---|---|---|
| Positive drowsiness, fatigue, congestion, night, monotony, and highway responses for humming, driving call-and-response, quiz, and ranking | <code>cdc_su_explicit</code> | Slide 67 current-state/environment row |
| Positive route/destination responses for music and humming | <code>cdc_su_explicit</code> | Slide 67 route/destination row |
| Positive child/group responses for humming, driving call-and-response, quiz, and ranking | <code>cdc_su_explicit</code> | Slide 67 passenger row |
| Radio-style nonzero oshi responses | <code>service_definition</code> | Slide 39 explicitly describes recent oshi information |
| Other nonzero oshi responses | <code>active_oshi_hypothesis</code> | Expert assumption that the service can use an oshi-aware recipe |
| Mountain-road nonzero responses | <code>normalized_context_hypothesis</code> | Normalized simulator road context |
| Every remaining zero cell | <code>neutral_source_silent</code> | Source does not justify a direction |

#### Before-rest driving context

| Cells | Provenance | Source |
|---|---|---|
| Humming activation responses | <code>service_definition</code> | Pre-rest humming journey in Slides 1–7 and service definition |
| Other nonzero driver/environment responses copied from the driving matrix | <code>pre_rest_generalization_hypothesis</code> | Expert hypothesis; Slide 67 column ① is silent |
| Music/humming route/destination and shared-service passenger responses | <code>pre_rest_generalization_hypothesis</code> | Expert hypothesis for the constrained pre-rest candidate family |
| Radio-style nonzero oshi responses | <code>service_definition</code> | Slide 39 explicitly describes recent oshi information |
| Other nonzero oshi responses | <code>pre_rest_oshi_hypothesis</code> | Expert assumption for oshi-aware variants |
| Mountain-road nonzero responses | <code>normalized_context_hypothesis</code> | Normalized simulator road context |
| Every remaining zero cell | <code>neutral_source_silent</code> | Source does not justify a direction |

#### During-rest context

| Cells | Provenance | Source |
|---|---|---|
| Every nonzero response in Section 11.2 | <code>rest_action_hypothesis</code> | Expert interpretation of the rest flow |
| Every zero response | <code>neutral_source_silent</code> | No baseline-based direction is asserted |

#### Post-rest context

| Cells | Provenance | Source |
|---|---|---|
| Drowsiness, fatigue, and night nonzero responses | <code>post_rest_hypothesis</code> | Expert recovery-content hypothesis |
| Oshi-reexperience route/destination responses | <code>cdc_su_explicit</code> | Slide 67 purpose-① route row |
| Live/full-karaoke child/group responses | <code>cdc_su_explicit</code> | Slide 67 purpose-① passenger row |
| Live/full-karaoke/oshi oshi responses | <code>cdc_su_explicit</code> | Slide 67 purpose-① oshi row |
| Other nonzero route, destination, passenger, or oshi responses | <code>post_rest_hypothesis</code> | Expert interpretation; not directly stated by the service definitions |
| Every remaining zero cell | <code>neutral_source_silent</code> | Source does not justify a direction |

#### Direct candidate-specific baseline features

All coefficient-+1 cells for recency, usage, scene usage, acceptance, and
recovery use:

    provenance_label = cdc_su_direct_candidate_feature
    source_reference = Slides 66–67

The implementation repository should store the expanded records rather than
reimplementing these prose rules. The rules above define how the initial data
file is generated and reviewed.

---

## 12. Parameters and Hyperparameters

### 12.1 Distinction

In this package:

- a **parameter** defines the model’s structure, mappings, or service semantics and is versioned with the package/configuration;
- a **hyperparameter** is a customer-editable scalar used to tune the selected hypothesis without changing code.

Both are evidence-visible. Changing either creates a new decision configuration.

### 12.2 Structural parameters

| Parameter | Initial value | Meaning |
|---|---|---|
| <code>response_class_map</code> | -1, -.5, 0, .5, 1 | Coarse response semantics |
| <code>service_response_profiles</code> | Section 11 | Candidate capabilities and source assumptions |
| <code>road_response_profiles</code> | Section 11 | Road-category compatibility |
| <code>scene_taxonomy</code> | Section 10.15 | Current-scene derivation |
| <code>usage_ordinal_map</code> | -1, -.5, .25, 1 | Overall/scene usage normalization |
| <code>recency_ordinal_map</code> | 0, .5, 1 | Novelty normalization |
| <code>missing_numeric_evidence</code> | 0 | Neutral, disclosed |
| <code>missing_candidate_map_evidence</code> | 0 | Neutral, disclosed |
| <code>top_k</code> | 3 | Maximum returned candidates |
| <code>tie_breaker</code> | candidate ID ascending | Deterministic exact tie behavior |
| <code>material_safety_gap</code> | 1.00 | Safety-response gap used only to prove the continuous default dominance invariant |

### 12.3 Weight hyperparameters

All hierarchy values in Section 7 are editable finite, non-negative numeric
hyperparameters.

Recommended UI:

- Basic: edit top categories and subgroups.
- Advanced: edit leaf weights.
- Always show the resulting effective 17-feature weights.

Sibling values are ratios. They do not need to sum to one because the evaluator normalizes them. A sibling group containing only zeros is invalid.

### 12.4 Purpose multiplier hyperparameters

All values in Section 8.2 are editable in the range 0–5, with:

- initial values as specified;
- recommended customer range 0.5–3;
- step 0.05;
- all-zero effective configuration rejected.

The UI should include:

- reset purpose profile;
- set all multipliers to 1;
- clone a profile for comparison;
- show before/after effective weights.

### 12.5 Curve and saturation hyperparameters

| Hyperparameter | Initial | Validation range | Meaning |
|---|---:|---:|---|
| <code>gamma_drowsiness</code> | 1.0 | 0.25–4.0 | Shape of drowsiness evidence |
| <code>gamma_fatigue</code> | 1.0 | 0.25–4.0 | Shape of fatigue evidence |
| <code>gamma_monotony</code> | 1.0 | 0.25–4.0 | Shape of monotony evidence |
| <code>route_tag_saturation</code> | 2 | 1–10 | Recognized route tags required for full evidence |
| <code>destination_tag_saturation</code> | 2 | 1–10 | Recognized destination tags required for full evidence |
| <code>monotony_medium_min</code> | 34 | 0–100 | Scene taxonomy boundary |
| <code>monotony_high_min</code> | 67 | 0–100 | Scene taxonomy boundary |
| <code>safety_share_warning_floor</code> | 0.40 | 0–1 | Non-blocking configuration warning |

Required relations:

    monotony_medium_min < monotony_high_min

### 12.6 Response-profile editing

Response classes should be edited in an advanced matrix, not mixed with ordinary feature weights.

Continuous customer overrides of response coefficients must be finite and
within [-1, +1]. Values outside that range, NaN, and infinity are invalid
rather than silently clamped.

The distinction is important:

- weight asks “How important is this evidence?”;
- response asks “How does this service respond to the evidence?”

Changing a weight affects all candidates with non-neutral responses. Changing a response profile affects a particular candidate-feature relationship.

### 12.7 Conceptual configuration shape

The implementation may use a different serialization format, but it must
preserve these concepts:

    package:
      id: transparent_service_selector_baseline_v1
      version: string

    parameters:
      service_fit_scale:
        normalized_min: -1.0
        normalized_max: 1.0
        neutral: 0.0
      response_class_map:
        strongly_opposes: -1.0
        opposes: -0.5
        neutral: 0.0
        supports: 0.5
        strongly_supports: 1.0
      ordinal_maps:
        recency: object
        usage: object
      scene_taxonomy: object
      service_response_profiles: object
      road_response_profiles: object
      missing_policy: neutral_and_disclose
      top_k: 3
      tie_breaker: candidate_id_ascending
      material_safety_gap: 1.0

    hyperparameters:
      category_weights: object
      subgroup_weights: object
      leaf_weights: object
      purpose_multipliers: object
      gamma_drowsiness: 1.0
      gamma_fatigue: 1.0
      gamma_monotony: 1.0
      route_tag_saturation: 2
      destination_tag_saturation: 2
      monotony_medium_min: 34
      monotony_high_min: 67
      safety_share_warning_floor: 0.40

Configuration validation occurs before candidate scoring. The resolved,
normalized configuration is recorded beside the original customer-entered
values.

---

## 13. Detailed Evaluation Pipeline

### Step 1 — Validate the opportunity

Validate:

- contract and package versions;
- trigger purpose;
- compatible lifecycle stage;
- feature value types and ranges;
- oshi registration/mode consistency;
- hierarchy and multiplier values;
- response profile completeness for eligible candidates.

Invalid types, out-of-range values, incompatible purpose/stage pairs, or all-zero weights produce a blocking algorithm error. They do not produce a fabricated ranking.

### Step 2 — Confirm candidate constraints

Verify that every platform-eligible candidate belongs to the frozen allowed-service row. If not, reject the request as a contract error.

Copy platform exclusions into the output unchanged. The algorithm may not reinstate them.

### Step 3 — Resolve effective weights

1. Normalize sibling weights at every hierarchy node.
2. Multiply down the hierarchy to obtain 17 base leaf weights.
3. Apply the current trigger-purpose subgroup multipliers.
4. Normalize the resulting 17 values.
5. record base, multiplier, raw effective, and final normalized values.

### Step 4 — Build normalized evidence

Normalize scalar and common contextual features once.

Candidate-indexed features are normalized inside the candidate loop using that candidate’s map entry.

### Step 5 — Calculate service fit for each eligible candidate

Pseudocode:

    for candidate in eligible_candidates:
        service_fit_unclamped = 0
        feature_rows = []

        for feature in BASELINE_FEATURES_IN_CONTRACT_ORDER:
            raw = read_raw_value(feature, candidate)
            evidence = normalize(feature, raw)
            coefficient = resolve_response(feature, candidate, raw)
            normalized_feature_response = clamp(evidence * coefficient, -1, 1)

            if feature is road_type:
                evidence = 1
                coefficient = road_response[candidate][raw]
                normalized_feature_response = coefficient

            feature_contribution = (
                effective_weight[feature]
                * normalized_feature_response
            )
            service_fit_unclamped += feature_contribution

            feature_rows.append(full_evidence_record)

        assert service_fit_unclamped is in [-1, +1] within tolerance
        service_fit = clamp(service_fit_unclamped, -1, +1)
        emit candidate record

The baseline feature order is fixed for stable evidence export; it does not affect arithmetic.

### Step 6 — Build explanatory subtotals

Each subtotal is the sum of normalized feature contributions belonging to that hierarchy node:

    situation_fit = sum Situation feature_contribution
    preference_fit = sum Preference feature_contribution
    history_fit = sum History feature_contribution

The subtotals reconstruct the unclamped value:

    service_fit_unclamped = situation_fit
                          + preference_fit
                          + history_fit

    service_fit = clamp(service_fit_unclamped, -1, +1)

Each category subtotal is bounded by plus or minus that category's resolved
effective weight share. The subtotals are not separately rescaled and do not
change ranking.

### Step 7 — Rank

Sort:

    (-service_fit, candidate_id)

Use full-precision values for sorting. Round only for display.

Return the first three or all candidates when fewer than three exist.

### Step 8 — No-proposal behavior

Return <code>no_proposal</code> only when the eligible candidate list is empty.

A low or negative service fit does not suppress a proposal because the upstream trigger already established the proposal opportunity.

---

## 14. Missing, Unknown, and Invalid Data

### 14.1 Missing versus invalid

- **Missing** means the field or candidate map entry is absent.
- **Unknown** means a string tag is syntactically valid but not in the configured taxonomy.
- **Invalid** means a wrong type, out-of-range number, unsupported enum, or contradictory state.

### 14.2 Missing policy

Baseline-only mode has no missingness-confidence feature. It therefore uses neutral evidence:

    missing normalized evidence = 0
    normalized feature response = 0
    feature contribution = 0

The feature remains in the trace with status <code>missing_neutral</code>.

This policy avoids inventing either positive or negative evidence. A complete simulator seed should provide all scalar features and all candidate-indexed histories so missing values are normally exceptional.

### 14.3 Unknown tags

Unknown route/destination tags do not contribute to recognized tag count. They are listed in <code>unused_available_features</code> or a dedicated unknown-tag record.

### 14.4 Invalid policy

Invalid input blocks the evaluation. It must not silently become neutral.

---

## 15. Explainability Contract

### 15.1 Per-feature evidence row

For every candidate and every baseline feature, record:

| Field | Meaning |
|---|---|
| <code>feature_id</code> | Stable baseline feature ID |
| <code>source_reference</code> | CDC-SU slide reference |
| <code>raw_value</code> | Exact snapshot value or candidate map entry |
| <code>normalization_function</code> | Named function and version |
| <code>normalization_parameters</code> | Gamma, ordinal map, or saturation |
| <code>normalized_evidence</code> | <em>e</em> value |
| <code>response_class</code> | Candidate response class |
| <code>response_coefficient</code> | <em>a</em> value |
| <code>response_provenance</code> | Source/assumption/customer override |
| <code>normalized_feature_response</code> | <em>r</em> value in [-1, +1] |
| <code>hierarchy_path</code> | Category → subgroup → leaf |
| <code>base_weight</code> | Flattened hierarchy weight |
| <code>purpose_multiplier</code> | Applied multiplier |
| <code>effective_weight</code> | Final normalized weight |
| <code>feature_contribution</code> | <em>k</em> value in [-<em>w</em>, +<em>w</em>] |
| <code>status</code> | used, neutral, zero-weight, missing, or invalid |

### 15.2 Candidate explanation

The candidate view must show:

1. service fit in [-1, +1];
2. Situation, Preference, and History fit subtotals;
3. strongest supporting normalized contributions;
4. strongest opposing normalized contributions;
5. neutral and zero-weight features;
6. missing/unknown inputs;
7. response-profile provenance;
8. configuration versions.

Example:

    Humming karaoke: service fit +0.778

    Strongest support
    +0.204 Drowsiness: raw 80, normalized evidence 0.80
    +0.125 Fatigue: raw 60, normalized evidence 0.60
    +0.091 Monotony: raw 75, normalized evidence 0.75

    Opposition
    none

    Neutral
    none from the current road/purpose profile

### 15.3 Ranking explanation

For adjacent candidates, expose:

    service_fit(candidate A) - service_fit(candidate B)

and the normalized feature-contribution differences responsible for that gap.

This makes “why A above B?” answerable without reading the implementation.

### 15.4 Exact reproducibility

Persist:

- immutable input snapshot;
- candidate/exclusion lists;
- parameter and hyperparameter values;
- resolved effective weights;
- response profile versions;
- full-precision feature contributions and service fit;
- stable tie-break result.

Identical inputs and configuration must reproduce semantically identical
output. Canonical byte equality follows the narrower rule in Section 6.6.

### 15.5 Conceptual output shape

The package output extends the common selector contract with transparent
evidence:

    decision_type: ranked_candidates | no_proposal
    ranked_candidates:
      - rank: integer
        candidate_id: string
        score: number  # service_fit in [-1,+1]
        rationale: array
        uncertainty: null
        subtotals:
          situation_fit: number
          preference_fit: number
          history_fit: number
        supporting_feature_ids: array
        opposing_feature_ids: array
        neutral_feature_ids: array
        feature_contributions:
          - feature_id: string
            raw_value: any
            normalized_evidence: number
            response_class: string
            response_coefficient: number
            normalized_feature_response: number  # [-1,+1]
            base_weight: number
            purpose_multiplier: number
            effective_weight: number
            feature_contribution: number
            provenance: object
            status: string
    excluded_candidates: array
    effective_weights: object
    unused_available_features: array
    missing_features: array
    configuration_warnings: array
    next_package_runtime_state: {}
    algorithm_provenance: object

The common rationale field should contain concise presentation text generated
from the structured contribution rows. Structured evidence is authoritative;
localized prose must not introduce reasons that are absent from the arithmetic.

This deterministic stateless selector always returns
<code>uncertainty=null</code> and <code>next_package_runtime_state={}</code>.
It does not omit inherited common-contract fields.

---

## 16. Worked Example

### 16.1 Opportunity

    trigger_purpose = inattentive_driving_prevention_recovery
    lifecycle_stage = active_driving_content
    candidate = humming_karaoke

Baseline snapshot:

| Feature | Value | Normalized evidence |
|---|---|---:|
| Drowsiness | 80 | .80 |
| Fatigue | 60 | .60 |
| Traffic | congested | 1.00 |
| Road | highway | 1.00 |
| Night | night | 1.00 |
| Monotony | 75 | .75 |
| Route tags | two recognized | 1.00 |
| Destination tags | one recognized | .50 |
| Child present | true | 1.00 |
| Multiple passengers | true | 1.00 |
| Oshi registered | true | 1.00 |
| Oshi mode | on | 1.00 |
| Service recency | long_unused | .50 |
| Service usage | high | 1.00 |
| Scene/service usage | high | 1.00 |
| Acceptance rate | 75 | .50 |
| Recovery rate | 70 | .40 |

### 16.2 Contributions

Using the initial inattentive-purpose effective weights:

| Feature | Effective weight | Normalized feature response | Feature contribution |
|---|---:|---:|---:|
| Drowsiness | .254551 | .80 | +.203641 |
| Fatigue | .208269 | .60 | +.124961 |
| Traffic | .060475 | 1.00 | +.060475 |
| Road/highway | .060475 | 1.00 | +.060475 |
| Night | .060475 | 1.00 | +.060475 |
| Monotony | .120950 | .75 | +.090713 |
| Route | .019091 | 1.00 | +.019091 |
| Destination | .015620 | .50 | +.007810 |
| Child | .025571 | 1.00 | +.025571 |
| Group | .013769 | 1.00 | +.013769 |
| Oshi registered | .006479 | .50 | +.003240 |
| Oshi mode | .012033 | 1.00 | +.012033 |
| Recency | .007405 | .50 | +.003703 |
| Overall usage | .020827 | 1.00 | +.020827 |
| Scene usage | .040728 | 1.00 | +.040728 |
| Acceptance | .015427 | .50 | +.007714 |
| Recovery | .057853 | .40 | +.023141 |

The service fit is:

    sum(feature_contribution)
    = approximately +0.778365

The implementation retains full precision and may display +0.778.

### 16.3 Comparison behavior

For music playlist in the same snapshot:

- drowsiness, fatigue, congestion, highway, night, and monotony responses are mostly neutral;
- route/destination and personalized usage/history may support it;
- it can therefore rank well for route relevance without receiving the activation-response contributions assigned to humming karaoke.

For <code>route_music</code>, the route and destination weights rise automatically through the purpose multiplier profile. The exact same raw snapshot and service-response profiles can therefore produce a different, fully explained order.

---

## 17. Customer Tuning Guidance

### 17.1 Recommended tuning order

Customers should tune in this order:

1. inspect hard eligibility and purpose/stage candidate constraints;
2. validate candidate response classes against product intent;
3. tune top-level category weights;
4. tune subgroup weights;
5. tune purpose multipliers;
6. tune individual leaf weights;
7. tune continuous gamma and tag-saturation curves;
8. change ordinal mappings only when there is a clear product reason.

This order separates semantic disagreement from numeric tuning.

### 17.2 One-variable contrasts

Preferred evaluation method:

- clone a complete seed;
- change one feature, weight, multiplier, or response class;
- recompute;
- compare effective weights, normalized feature contributions, and rank movement.

Useful contrasts include:

- drowsiness 30 versus 80;
- normal versus congested;
- local versus mountain road;
- no child versus child present;
- route purpose versus inattentive purpose;
- oshi mode on versus off;
- high versus low scene usage;
- 50% versus 80% recovery.

### 17.3 Configuration warnings

Warn, but do not silently correct, when:

- safety-context effective share falls below 40%;
- novelty exceeds overall usage or scene preference;
- all response coefficients for a feature are neutral within the active candidate set;
- a purpose multiplier is unusually high, such as above 3;
- more than 25% of effective feature weight has missing evidence;
- an edited response contradicts a source-explicit preference.

Warnings are evidence for review, not algorithmic penalties.

### 17.4 Avoid false precision

Default response classes use coarse values. Customers may enter continuous coefficients, but the UI should label them as configured hypotheses. A change from .70 to .71 is not empirically meaningful without validation data.

---

## 18. Implementation Components

Recommended package-local components:

| Component | Responsibility |
|---|---|
| Input validator | Contract, range, enum, and consistency checks |
| Weight resolver | Hierarchical normalization and purpose multipliers |
| Feature normalizer | All 17 baseline normalization functions |
| Scene resolver | Versioned current-scene IDs and aggregation |
| Response resolver | Candidate and road response profiles |
| Candidate scorer | Contribution arithmetic and subtotals |
| Ranker | Full-precision service-fit ordering and tie break |
| Evidence builder | Complete feature/candidate/configuration trace |

The selector must not call the content selector or consume another algorithm package’s score.

---

## 19. Required Tests

### 19.1 Mathematical tests

- Effective weights sum to one for every default purpose profile.
- Every normalized evidence value and response coefficient is within [-1, +1].
- Every normalized feature response is within [-1, +1].
- Every feature contribution equals
  <code>effective_weight × normalized_feature_response</code> and is within
  [-<code>effective_weight</code>, +<code>effective_weight</code>].
- Unclamped service fit equals the ordered sum of all feature contributions;
  the published service fit is its floating-point-safety clamp to [-1, +1].
- All-neutral evidence produces service fit 0 for every candidate.
- Identical inputs produce semantically equal numeric output within tolerance
  1e-12; same-runtime canonical replay is byte-equivalent.
- Changing the common magnitude of all sibling weights does not change results.
- Every built-in purpose profile satisfies
  <code>W_D × 1.00 &gt; 2 × W_L</code>, where D is Driver State + Driving
  Environment + Recovery.
- For each purpose, construct an adversarial pair with dominant-context gap
  1.00 and maximally reversed lower-priority responses; the higher-safety
  candidate must still rank first.
- A customer profile that violates the invariant remains evaluable but emits
  <code>dominance_not_guaranteed</code> with the calculated required gap.

### 19.2 Feature tests

- Boundary values 0 and 100 for drowsiness, fatigue, and monotony.
- Gamma curves at validation boundaries.
- Every enum and ordinal mapping.
- Empty, duplicate, recognized, and unknown route/destination tags.
- Every scene predicate and multi-scene average.
- Oshi invalid-state rejection.
- Missing candidate history produces neutral disclosed evidence.
- Acceptance/recovery rates 0, 50, and 100 map to -1, 0, and +1.

### 19.3 Eligibility tests

- No excluded candidate is scored.
- No candidate outside the purpose/stage row is accepted.
- Empty eligibility returns <code>no_proposal</code>.
- Low or negative service-fit values with eligible candidates still return ranked proposals.
- Driving/stopped screen restrictions remain outside service-fit arithmetic.

### 19.4 Response-profile tests

- Slide-67-preferred driving services receive positive activation responses.
- Route evidence supports music playlist and humming karaoke.
- Passenger evidence supports the specified shared services.
- Mountain road opposes the default high-interaction candidates.
- Oshi mode off produces opposing evidence for oshi-responsive candidates.
- Direct candidate-specific features always use coefficient +1.

### 19.5 Ranking and evidence tests

- Rank uses full precision, not displayed rounding.
- Exact service-fit ties resolve by stable candidate ID.
- Top three are returned in service-fit order.
- All 17 feature rows exist for every scored candidate.
- Group fit subtotals reconcile to service fit within the Section 6.6 numeric
  tolerance.
- Customer overrides and source provenance are both present.
- Every eligible candidate × feature × context cell has coefficient,
  provenance label, source reference/null, and rationale.
- Non-finite weights/coefficients and coefficients outside [-1, +1] are
  rejected.

### 19.6 Hypothesis-validation and review protocol

Algorithm tests establish conformance, not real-world efficacy. Before a
built-in parameter/profile version is accepted, reviewers execute a versioned
scenario corpus.

Minimum corpus coverage:

| Context | Required cases |
|---|---|
| Rest / before stop | low and high driver state; highway and mountain; with/without passengers |
| Rest / during stopped | nap-oriented, fatigue-oriented, passenger-present, rest-extension eligible/ineligible |
| Rest / after rest | residual high/low driver state; route/oshi; child/group |
| Inattentive/recovery | each driving-environment factor independently and combined |
| Route music | no tags, one tag, saturated tags, destination-only tags |
| Child experience | child only, group only, both, neither |

For every case, the corpus stores:

- exact input/configuration;
- eligibility and expected exclusions;
- required ordering constraints, not an invented “correct probability”;
- expected dominant supporting/opposing reasons;
- expected invariant status;
- allowed service-fit tolerance;
- product, UX, and safety-review comments.

Required adversarial cases include:

- maximally favorable Preference/Acceptance evidence for a weaker
  dominant-context candidate;
- mountain-road interaction-load contrast;
- oshi mode off with strong historical oshi usage;
- novelty versus high recovery;
- missing critical situation values;
- customer overrides below the dominance guarantee.

Release procedure:

1. algorithm owner runs unit, property, golden, and adversarial fixtures;
2. product reviewer confirms CDC-SU service-priority interpretation;
3. safety reviewer confirms eligibility rules and reviews default
   dominant-context constraints;
4. UX reviewer confirms explanations do not overclaim;
5. all accepted overrides include owner, reason, date, and affected fixtures;
6. a profile version is frozen only after the above sign-offs are recorded.

Regression policy:

- any eligibility change requires explicit review;
- any built-in rank change updates a fixture only with written rationale;
- service-fit drift above 1e-12 with unchanged package/runtime is a failure;
- human review does not convert the hypothesis into a validated production
  effect claim.

---

## 20. Acceptance Criteria

The implementation is acceptable when:

1. only the 17 baseline features influence ranking;
2. purpose, stage, eligibility, and catalog facts remain non-scoring controls;
3. every eligible candidate receives one deterministic service fit in [-1, +1];
4. every normalized intermediate and every feature contribution can be reproduced from displayed arithmetic;
5. default weights and response profiles follow the safety-first and service-priority intent of the source;
6. every built-in default purpose profile passes the continuous dominance
   invariant in Section 4.3;
7. customer-edited weights, multipliers, curves, and response classes are frozen and evidence-visible;
8. all lifecycle-stage candidate families are supported;
9. no service fit or weight can reverse a hard exclusion;
10. no eligible candidate is suppressed merely for having low or negative service fit;
11. exact replay is deterministic under Section 6.6;
12. output never describes service fit as acceptance probability, recovery probability, or safety certification.

---

## 21. Deferred Improvement

A probabilistic uncertainty-ranking package is deferred.

A future independent package may sample configured ranges around weights and response coefficients and report expected service fit, a service-fit interval, and probability of ranking first. Such probabilities would describe rank stability under configured uncertainty, not user acceptance or recovery probability.

The probabilistic package must receive the same neutral baseline snapshot and must not consume this deterministic package’s score or runtime state.

---

## 22. Summary Formula

For each eligible service:

    base_weight_i
      = normalized category weight
      * normalized subgroup weight
      * normalized leaf weight

    effective_weight_i(p)
      = normalize(
          base_weight_i
          * purpose_multiplier[p][subgroup(i)]
        )

    evidence_i(c)
      = normalize_feature_i(raw_value_i, candidate c)

    normalized_feature_response_i(c)
      = clamp(
          evidence_i(c)
          * response_coefficient_i(c),
          -1,
          +1
        )

    feature_contribution_i(c)
      = effective_weight_i(p)
      * normalized_feature_response_i(c)

    service_fit(c)
      = clamp(
          sum_i(feature_contribution_i(c)),
          -1,
          +1
        )

Then:

    rank by service_fit descending
    break exact ties by candidate ID
    return up to three candidates

This is the complete selected Approach 1 service-proposal hypothesis.
