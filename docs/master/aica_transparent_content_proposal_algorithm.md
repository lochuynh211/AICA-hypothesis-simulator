# AICA Transparent Content-Proposal Algorithm

**Document status:** Detailed design and implementation specification, approved in design discussion<br>
**Primary audience:** Product, algorithm, simulation, data, UX, and engineering reviewers<br>
**Scope:** Baseline-only transparent concrete-content selection, with detailed V1 recipes for music playlist, humming karaoke, and full karaoke<br>
**Source basis:** CDC-SU Slides 38–40 and 64–82<br>
**Date:** 2026-07-14

## Related documents

- [Consolidated proposal simulator specification](aica_proposal_simulator_specification.md)
- [Synthetic music data and generation specification](aica_synthetic_music_data_and_generation_specification.md)
- [Transparent service-proposal algorithm](aica_transparent_service_proposal_algorithm.md)
- [Proposal design reference](aica_proposal_design_reference_draft.md)
- [CDC-SU source transcription](../../others/CDC-SU_specplan.md)

---

## 1. Purpose

This document defines the transparent algorithm that answers:

> After a service has been selected, which concrete content items should AICA place in the executable plan, and why?

The algorithm is an expert-authored, customer-editable hypothesis. It is not:

- a trained recommendation model;
- a probability of acceptance or recovery;
- a production safety certification;
- a catalog enrichment algorithm;
- an LLM content generator.

The detailed V1 implementation covers:

1. music playlist (`music_playlist`);
2. humming karaoke (`humming_karaoke`);
3. full karaoke (`full_karaoke`).

The shared recipe interface allows the other CDC-SU services to be added later without changing the scoring core.

---

## 2. Selected design

The selected design is a hierarchical normalized compatibility score.

For every eligible catalog item:

~~~text
baseline context and history
→ normalized evidence
→ compatibility with frozen catalog metadata
→ normalized effective weight
→ signed feature contribution
→ item_fit in [-1,+1]
~~~

The algorithm then sorts items deterministically and creates one ordered plan.

V1 does not:

- produce competing plan candidates;
- calculate an aggregate plan score;
- optimize playlist diversity or musical flow;
- call an LLM during evaluation;
- use simulator-proposed feature extensions.

The default music plan contains five ordered songs. The customer may edit the structural parameter plan_item_count.

---

## 3. Relationship to the service selector

Service selection and content selection remain independent algorithms.

The content selector receives:

- trigger purpose;
- lifecycle stage;
- selected service ID;
- the complete content baseline snapshot;
- platform eligibility facts;
- a frozen catalog snapshot;
- its own parameters and hyperparameters.

It must not consume:

- service_fit;
- service rank;
- service contribution rows;
- service-selector runtime state;
- service-selector weights or response coefficients.

The two transparent algorithms deliberately use the same mathematical grammar:

~~~text
normalized evidence
→ candidate-specific response
→ normalized weight
→ signed contribution
→ fit in [-1,+1]
~~~

Their configurations and scores are nevertheless package-local.

The service selector uses a configured service-response coefficient. The content selector instead compares current evidence with item metadata through a recipe-specific compatibility function.

---

## 4. Decision boundary

### 4.1 Required controls

The following are required controls, not ranking features:

| Field | Meaning |
|---|---|
| trigger_purpose | One of the four explicit CDC-SU proposal purposes |
| lifecycle_stage | Current journey stage |
| selected_service_id | Service already selected by the user or service selector |
| allowed_service_ids | Frozen purpose/stage constraint row |
| recipe_registry_version | Frozen recipe registry |
| catalog_snapshot_id | Frozen source/enriched catalog snapshot |
| plan_item_count | Requested music item count; default 5 |
| simulation_time | Reference time for history windows |
| algorithm_version | Transparent content-selector package version |
| configuration_version | Frozen parameters and hyperparameters |

### 4.2 Ranking evidence

Baseline-only V1 uses the CDC-SU-derived content feature contract from Slides 68–80.

The approved contract includes normalized oshi identity and tags as UPro/oshi information. This corrects the earlier draft classification that treated detailed oshi identity as a simulator-only addition. Without identity or tags, concrete song-to-oshi matching cannot be explained.

### 4.3 Catalog metadata

Catalog metadata is not a user/context feature. It describes the candidate being evaluated.

The data model, generation process, provenance, and validation rules belong to the shared synthetic music specification. This algorithm consumes only a frozen validated snapshot.

### 4.4 Lifecycle execution

Slides 81–82 define completion, continuation, restoration, and motion-transition behavior. The journey/playback engine owns those transitions.

The content selector supplies:

- the ordered items;
- presentation mode;
- expected duration;
- lighting compatibility;
- completion and transition policy identifiers.

It does not advance playback while ranking.

---

## 5. Detailed-service applicability

Slide 70 is the broad applicability matrix. Slides 71–80 are the detailed service contracts.

When they conflict, the detailed service slide controls that service recipe. The discrepancy remains visible in recipe provenance.

### 5.1 Ranking applicability and eligibility roles

Every baseline field has exactly one ranking-applicability status per recipe:

| Status | Meaning |
|---|---|
| scored | Produces an item-specific response and contribution |
| context_only | Recorded and explained but cannot distinguish items |
| not_applicable | The source recipe does not use the field |

Hard eligibility is a separate boolean role. A field can feed one or more named
eligibility rules regardless of its ranking status. Eligibility never produces a
score contribution. This separation lets, for example, an older skip contribute
a negative response while a recent skip triggers a hard exclusion.

### 5.2 Detailed music mapping

Abbreviations:

- P = music playlist, Slide 71;
- H = humming karaoke, Slide 72;
- F = full karaoke, Slide 79.

| Baseline field | P | H | F | Treatment |
|---|---|---|---|---|
| drowsiness_level | scored | scored | scored | Activation compatibility |
| fatigue_level | scored | scored | scored | Activation compatibility |
| traffic_state | scored | scored | scored | Environment activation need |
| road_type | scored | scored | scored | Environment activation need |
| night_state | scored | scored | scored | Environment activation need |
| monotony_level | scored | scored | scored | Activation compatibility |
| route_tags | scored | not_applicable | not_applicable | Route affinity |
| destination_tags | scored | scored | scored | Detailed Slides 72/79 override broad Slide 70 |
| child_present | scored; E | scored; E | scored; E | Audience policy and child appeal |
| multiple_passengers | scored | scored | scored | Group appeal |
| motion_state | context_only; E | context_only; E | context_only; E | Presentation/mode policy; detailed Slide 71 overrides broad Slide 70 for playlist |
| oshi_registered | scored | scored | scored | Gates oshi matching |
| oshi_mode | scored | scored | scored | Gates oshi matching |
| oshi_id | scored | scored | scored | Exact entity relation |
| oshi_type | scored | scored | scored | Entity relationship interpretation |
| oshi_tags | scored | scored | scored | Controlled related-tag matching |
| service_recency_state[selected service] | context_only | context_only | context_only | Constant after service selection |
| service_usage_level[selected service] | context_only | context_only | context_only | Constant after service selection |
| scene_service_usage_level[selected service] | context_only | context_only | context_only | Constant after service selection |
| age_band | scored | scored | scored | Configured age/era affinity |
| gender | context_only | context_only | context_only | Source-visible; default weight zero |
| hobby_interest_tags | scored | scored | scored | Genre/theme affinity |
| catalog_item_recency_state[item] | scored | not_applicable | not_applicable | Playlist novelty |
| content_tag_recency_state[tag] | scored | not_applicable | not_applicable | Playlist tag novelty |
| content_tag_usage_level[tag] | scored | scored | scored | General tag preference |
| catalog_item_usage_level[item] | scored | scored | scored | Direct item preference |
| scene_content_tag_usage_level[scene][tag] | scored | scored | scored | Comparable-scene preference |
| played_items | scored | scored | scored | Repetition response |
| skipped_items | scored; E | scored; E | scored; E | Recent exclusion and older negative response |
| cancelled_content_plans | scored | scored | scored | Recent cancellation response |
| changed_from_items | scored | scored | scored | Explicit replacement response |
| service_proposal_acceptance_rate[selected service] | context_only | context_only | context_only | Constant after service selection |
| service_recovery_rate[selected service] | context_only | context_only | context_only | Constant after service selection |
| scheduled_event_type | scored | scored | scored | Part of schedule relevance |
| scheduled_event_timing | scored | scored | scored | Part of schedule relevance |
| scheduled_event_tags | scored | scored | scored | Part of schedule relevance |
| content_proposal_acceptance_rate[key] | scored | scored | scored | Item/tag performance; detailed Slide 71 overrides broad Slide 70 for playlist |
| content_recovery_rate[key] | scored | scored | scored | Item/tag recovery history |

`E` marks an independent hard-eligibility role. Child policy, motion state, and skip history are the V1 baseline-field examples. Catalog capability and availability also drive eligibility but are non-feature metadata.

---

## 6. Core mathematical model

### 6.1 Scale contract

For baseline factor i, catalog item j, selected service s, and purpose p:

| Symbol | Serialized name | Meaning | Range |
|---|---|---|---:|
| x_i | raw_value | Raw baseline input | Field-specific |
| e_i | normalized_evidence | Normalized context/history evidence | [-1,+1] |
| r_i(j,s) | normalized_feature_response | Item compatibility under the recipe | [-1,+1] |
| B_i | base_weight | Flattened hierarchy weight | [0,1] |
| q_i(p,s) | effective_raw_weight | Adjusted unnormalized weight | [0,+∞) |
| w_i(p,s) | effective_weight | Normalized active weight | [0,1], sum = 1 |
| k_i(j,s) | feature_contribution | Signed weighted response | [-w_i,+w_i] |
| F(j,s) | item_fit | Final item fit | [-1,+1] |

The algorithm uses one signed normalized scoring domain. There is no point conversion, percentage score, midpoint offset, plan score, or probability interpretation.

### 6.2 Compatibility response

The general interface is:

~~~text
r_i(item, service)
  = compatibility_i(
      normalized evidence,
      item source metadata,
      item enriched metadata,
      service recipe
    )
~~~

Every compatibility function must:

- return a finite value in [-1,+1];
- name every catalog field it reads;
- expose its formula, lookup, or taxonomy relation;
- return zero when evidence is neutral or missing;
- never read a disabled extension.

### 6.3 Effective weight

Base leaf weight:

~~~text
B_i
  = category_weight
  × subgroup_weight
  × leaf_weight
~~~

Purpose and recipe adjustment:

~~~text
q_i(p,s)
  = B_i
  × purpose_multiplier[p][subgroup(i)]
  × scoring_applicability[i][s]
~~~

For a scored field, `scoring_applicability` is 1. For context-only and not-applicable fields, it is 0. The independent eligibility role is evaluated before this calculation and never changes a weight.

Normalize active weights:

~~~text
w_i(p,s) = q_i(p,s) / sum(q_active)
~~~

The package rejects a configuration with a zero or non-finite denominator.

Missing scored evidence remains active with response zero. It does not cause weight redistribution.

### 6.4 Contribution and item fit

~~~text
k_i(j,s) = w_i(p,s) × r_i(j,s)

item_fit(j,s)
  = clamp(sum(k_i(j,s)), -1, +1)
~~~

Because weights are non-negative and sum to one, the unclamped result is mathematically bounded. The clamp protects only against floating-point drift.

### 6.5 Interpretation

| item_fit | Meaning |
|---:|---|
| +1 | Theoretical strongest fit under the configured hypothesis |
| 0 to +1 | Supporting evidence outweighs opposing evidence |
| 0 | Overall neutral |
| -1 to 0 | Opposing evidence outweighs supporting evidence |
| -1 | Theoretical strongest opposition |

The value is not acceptance probability, recovery probability, or safety assurance.

### 6.6 Numeric semantics

- Use IEEE-754 binary64 arithmetic.
- Reject NaN, infinity, and invalid numeric configuration.
- Evaluate factors in the fixed contract order.
- Rank with full precision.
- Round only for presentation.
- Normalize negative zero to positive zero before serialization.
- Resolve exact numeric ties by stable item ID.
- Preserve contribution arrays in contract order.
- Use an absolute tolerance of 1e-12 for cross-runtime semantic tests.

---

## 7. Hierarchical base weights

### 7.1 Top-level categories

| Category | Initial weight |
|---|---:|
| Situation | 0.55 |
| Preference | 0.30 |
| History | 0.15 |

### 7.2 Situation

| Subgroup | Share within Situation |
|---|---:|
| Driver state | 0.35 |
| Driving environment | 0.30 |
| Route/destination | 0.20 |
| Passengers | 0.15 |

Initial leaves:

| Subgroup | Leaf | Share |
|---|---|---:|
| Driver state | Drowsiness | 0.55 |
| Driver state | Fatigue | 0.45 |
| Environment | Traffic | 0.15 |
| Environment | Road | 0.15 |
| Environment | Night | 0.20 |
| Environment | Monotony | 0.50 |
| Route/destination | Route | 0.50 |
| Route/destination | Destination | 0.50 |
| Passengers | Child | 0.60 |
| Passengers | Multiple passengers | 0.40 |

### 7.3 Preference

| Subgroup | Share within Preference |
|---|---:|
| UPro/oshi | 0.35 |
| Novelty | 0.10 |
| Overall and scene usage | 0.35 |
| Playback/operations | 0.20 |

Important leaf defaults:

| Subgroup | Leaf | Share |
|---|---|---:|
| UPro/oshi | Age | 0.10 |
| UPro/oshi | Hobbies/interests | 0.30 |
| UPro/oshi | Oshi relation | 0.60 |
| UPro/oshi | Gender | 0.00 |
| Novelty | Item recency | 0.60 |
| Novelty | Tag recency | 0.40 |
| Usage | Item usage | 0.40 |
| Usage | Tag usage | 0.30 |
| Usage | Scene/tag usage | 0.30 |
| Operations | Played | 0.25 |
| Operations | Skipped | 0.35 |
| Operations | Changed-from | 0.20 |
| Operations | Cancelled plan | 0.20 |

### 7.4 History

| Subgroup | Share within History |
|---|---:|
| Schedule | 0.30 |
| Content acceptance | 0.30 |
| Content recovery | 0.40 |

---

## 8. Trigger-purpose multipliers

| Subgroup | Rest recommended | Inattentive/recovery | Route music | Child experience |
|---|---:|---:|---:|---:|
| Driver state | 1.50 | 1.50 | 0.90 | 0.90 |
| Environment | 1.25 | 1.40 | 0.80 | 0.80 |
| Route/destination | 0.75 | 0.60 | 2.00 | 0.70 |
| Passengers | 0.75 | 0.80 | 0.90 | 2.00 |
| UPro/oshi | 0.90 | 0.80 | 1.10 | 1.10 |
| Novelty | 0.60 | 0.60 | 1.00 | 0.80 |
| Usage | 0.80 | 0.75 | 1.10 | 1.00 |
| Operations | 1.00 | 1.00 | 1.00 | 1.00 |
| Schedule | 0.75 | 0.50 | 1.00 | 0.80 |
| Acceptance | 0.80 | 0.75 | 1.00 | 1.00 |
| Recovery | 1.40 | 1.50 | 0.80 | 0.80 |

For the fully applicable playlist recipe, the initial normalized category shares are approximately:

| Purpose | Situation | Preference | History |
|---|---:|---:|---:|
| Rest recommended | 0.609 | 0.244 | 0.146 |
| Inattentive/recovery | 0.627 | 0.232 | 0.141 |
| Route music | 0.566 | 0.303 | 0.130 |
| Child experience | 0.558 | 0.310 | 0.132 |

Small displayed reconciliation differences are rounding only.

Customers may set all purpose multipliers to 1.0 to evaluate a purely global model.

Hard eligibility never changes when weights change.

---

## 9. Catalog-derived activation capability

The catalog stores source-like acoustic and karaoke components, not an opaque universal singability value.

The algorithm derives service-specific activation capability:

~~~text
A(item, service)
  = alpha_service × energy
  + beta_service × normalized_tempo
  + delta_service × derived_service_singability
~~~

Coefficients are non-negative and sum to one.

Initial coefficients:

| Recipe | Energy | Tempo | Singability |
|---|---:|---:|---:|
| Playlist | 0.60 | 0.40 | 0.00 |
| Humming | 0.40 | 0.25 | 0.35 chorus singability |
| Full karaoke | 0.35 | 0.20 | 0.45 full-song singability |

Signed activation capability:

~~~text
a_activation = 2 × A - 1
~~~

### 9.1 Tempo normalization

The catalog retains tempo_bpm in natural units. Initial normalization:

~~~text
normalized_tempo
  = clamp((tempo_bpm - 60) / (180 - 60), 0, 1)
~~~

The bounds are editable preprocessing/algorithm parameters and remain visible.

### 9.2 Karaoke difficulty components

The data specification supplies:

- chorus boundaries;
- vocal low and high MIDI pitch;
- lyric density;
- melody complexity;
- guide-vocal availability;
- user-independent capability metadata.

Initial transparent normalizations are:

~~~text
vocal_span_semitones = vocal_high_midi - vocal_low_midi
range_ease   = 1 - clamp((vocal_span_semitones - 8) / (24 - 8), 0, 1)
density_ease = 1 - clamp((lyric_density_words_per_sec - 1) / (4 - 1), 0, 1)
melody_ease  = 1 - clamp(melody_complexity, 0, 1)
chorus_sec   = (chorus_end_ms - chorus_start_ms) / 1000
chorus_length_ease = 1 - clamp((chorus_sec - 20) / (60 - 20), 0, 1)
~~~

Item-usage familiarity is mapped independently to [0,1]:

| Item usage | Familiarity |
|---|---:|
| never | 0.00 |
| low | 0.33 |
| medium | 0.67 |
| high | 1.00 |

The derived service values are:

~~~text
chorus_singability
  = 0.25 × range_ease
  + 0.20 × density_ease
  + 0.20 × melody_ease
  + 0.25 × chorus_length_ease
  + 0.10 × familiarity

full_song_singability
  = 0.30 × range_ease
  + 0.30 × density_ease
  + 0.30 × melody_ease
  + 0.10 × familiarity
~~~

All component bounds and coefficients are versioned algorithm parameters. The
coefficients are non-negative and sum to one. Familiarity is intentionally a
small interaction inside karaoke capability and also remains visible as direct
usage evidence; customers can set its coefficient to zero when testing a model
without that interaction.

Every component remains visible. No unexplained singability scalar is accepted as source truth, and neither derived value is persisted as provider metadata.

---

## 10. Situation compatibility functions

### 10.1 Drowsiness, fatigue, and monotony

~~~text
z_drowsiness = clamp(drowsiness_level / 100, 0, 1)
z_fatigue    = clamp(fatigue_level / 100, 0, 1)
z_monotony   = clamp(monotony_level / 100, 0, 1)

e = z ^ gamma
r = e × a_activation
~~~

Initial gamma values are 1.0.

Zero severity is neutral. It does not penalize high-energy content.

### 10.2 Environment

Initial stimulation-need evidence:

| Input | Evidence |
|---|---:|
| Normal traffic | 0.00 |
| Congested traffic | 0.70 |
| Day | 0.00 |
| Night | 0.70 |
| Highway | 0.60 |
| Local road | 0.20 |
| Mountain road | 0.40 |
| Parking | 0.00 |

For traffic, night, and road:

~~~text
r_environment = environment_evidence × a_activation
~~~

These values are hypotheses, not measured safety effects.

### 10.3 Route and destination

Catalog relations use a controlled taxonomy.

| Relationship | Initial affinity |
|---|---:|
| Exact tag/entity relation | +1.00 |
| Configured related taxonomy | +0.50 |
| No recognized relation | 0.00 |
| Explicit configured conflict | -1.00 |

Multiple recognized relationships use a deterministic mean. Unknown tags do not contribute and are reported.

Playlist uses route and destination. Humming and full karaoke use destination only.

### 10.4 Passenger suitability

When child_present is false, child response is zero.

When child_present is true:

- explicit/adult-only content is hard-excluded;
- eligible content with at least one approved child-interest tag has child_appeal 1.0;
- other eligible content has child_appeal 0.5 (neutral rather than presumed unsuitable);
- child response is 2 × child_appeal - 1.

When multiple_passengers is false, group response is zero.

When true:

~~~text
group_appeal = 1.0 when group_singalong is present
             = 0.5 otherwise
r_group = 2 × group_appeal - 1
~~~

Both values are derived at evaluation time from frozen policy/interest tags; they
are not opaque stored scores. Audience eligibility and passenger preference
remain separate evidence.

---

## 11. Preference compatibility functions

### 11.1 Age, hobbies, and gender

- Age uses a versioned age/era affinity table.
- Hobby and interest tags use the controlled genre/theme taxonomy.
- Gender remains source-visible but has default weight zero.

Tag affinities use the relationship table in Section 10.3.

### 11.2 Oshi

Oshi response is active only when:

- oshi_registered is true; and
- oshi_mode is on.

Initial relations:

| Relationship | Response |
|---|---:|
| Exact registered oshi entity | +1.00 |
| Member/group/character relation | +0.75 |
| Shared approved oshi tag | +0.25 |
| No relation | 0.00 |

Oshi mode off produces zero, not negative evidence, and does not delete the profile.

### 11.3 Usage

| Usage level | Response |
|---|---:|
| never | 0.00 |
| low | -0.50 |
| medium | +0.25 |
| high | +1.00 |

Direct item usage, tag usage, and scene/tag usage remain separate factors.

### 11.4 Playlist novelty

Only the playlist recipe activates novelty:

| Recency state | Response |
|---|---:|
| never | +1.00 |
| long_unused | +0.50 |
| recent | 0.00 |

Humming and full karaoke mark item and tag novelty not_applicable.

### 11.5 Playback and operations

Initial played-item response:

| Last played | Response |
|---|---:|
| Within 30 minutes | -1.00 |
| Earlier today | -0.50 |
| Within seven days | -0.25 |
| Older or never | 0.00 |

Recent explicit skip:

~~~text
inside skip_exclusion_window → hard exclusion
older recorded skip          → -0.50
~~~

Initial changed-from response inside its configured window is -0.75.

Initial response for an item in a recently cancelled plan is -0.50.

All windows and mappings are editable and evidence-visible.

---

## 12. History compatibility functions

### 12.1 Schedule

~~~text
schedule_response
  = timing_intensity × item_event_affinity
~~~

| Timing | Intensity |
|---|---:|
| now | 1.00 |
| soon | 0.75 |
| later | 0.25 |
| unknown or none | 0.00 |

The item relation must resolve to a frozen event/entity/tag.

### 12.2 Acceptance and recovery

Rate resolution order:

~~~text
item-specific rate
→ otherwise mean recognized item-tag rates
→ otherwise missing-neutral
~~~

Normalize:

~~~text
r_rate = 2 × rate / 100 - 1
~~~

Examples:

| Rate | Response |
|---:|---:|
| 80 | +0.60 |
| 50 | 0.00 |
| 20 | -0.60 |

Acceptance and recovery are separate factors.

Baseline-only V1 has no evidence-confidence feature. The UI must label these as editable synthetic histories rather than reliable statistical estimates.

---

## 13. Hard eligibility

Hard exclusions occur before scoring.

### 13.1 Common item exclusions

- Item is disabled or unplayable.
- Required provider or rights capability is unavailable.
- Content rating violates passenger policy.
- A recent explicit skip lies inside the exclusion window.
- Required service capability is absent.

### 13.2 Playlist

Requires ordinary playable audio.

### 13.3 Humming karaoke

Requires:

- chorus availability;
- valid chorus boundaries;
- driving-safe presentation;
- guide-vocal policy compatibility;
- no required lyrics screen while driving.

### 13.4 Full karaoke

Requires:

- full-karaoke asset availability;
- lyrics/presentation capability;
- stopped motion for active screen/lyrics mode.

Motion transition after selection is handled by the journey policy, not by score.

### 13.5 Exclusion evidence

Every exclusion has:

- item ID;
- rule ID;
- source fact;
- expected condition;
- actual value;
- recipe and policy version.

No exclusion is represented as a large negative score.

---

## 14. Detailed evaluation pipeline

1. Validate trigger purpose and lifecycle stage.
2. Confirm selected_service_id is in the frozen purpose/stage row.
3. Resolve the selected transparent content recipe.
4. Return unsupported_recipe if no recipe is registered.
5. Validate the complete baseline snapshot.
6. Load and validate the frozen catalog snapshot.
7. Classify every baseline field by ranking applicability and eligibility role.
8. Apply common and recipe-specific hard eligibility.
9. Normalize all scored evidence.
10. Resolve base weights, purpose multipliers, and the recipe mask.
11. Normalize effective weights.
12. Evaluate every eligible item in fixed feature order.
13. Sum contributions into item_fit.
14. Sort by item_fit descending and stable item ID.
15. Select the first plan_item_count unique items.
16. Preserve score order as playback order.
17. Build service-specific mode and presentation fields.
18. Return complete_plan, partial_plan, or no_proposal.
19. Serialize evidence and provenance.

---

## 15. Plan construction

### 15.1 Simple deterministic policy

V1 deliberately uses:

~~~text
sorted eligible items
→ first N unique item IDs
→ same order in the plan
~~~

It does not add:

- diversity bonuses;
- artist quotas;
- plan-level optimization;
- energy-flow sequencing;
- randomization;
- a plan score.

These may be introduced later as separately reviewable plan-composition policies.

### 15.2 Cardinality

Default plan_item_count is 5 for all three detailed music recipes.

This matches fixed-count playlist and humming behavior. For AI-initiated full karaoke, it deliberately overrides Slide 81's single-song default and is labeled as a customer-editable simulator hypothesis.

Result behavior:

| Eligible count | Result |
|---:|---|
| At least requested count | complete_plan |
| 1 to requested count - 1 | partial_plan |
| 0 | no_proposal |

### 15.3 Duration

Expected duration is the sum of selected full-song or chorus durations.

Duration is displayed but does not affect baseline-only ranking because time-to-rest and journey-window fields are simulator additions and are disabled.

### 15.4 Lighting

Lighting is an output modifier, not a score factor.

A versioned lookup may map item energy/mood to a compatible pattern. Platform policy controls availability and intensity.

---

## 16. Detailed recipe outputs

### 16.1 Playlist

~~~yaml
mode: full_song_playlist
requested_item_count: 5
lighting_allowed: true
~~~

### 16.2 Humming karaoke

~~~yaml
mode: chorus_only
requested_item_count: 5
guide_vocal_enabled: true
lyrics_screen_enabled: false
lighting_allowed: true
~~~

### 16.3 Full karaoke

~~~yaml
mode: full_karaoke
requested_item_count: 5
lyrics_screen_enabled: true
requires_stopped_motion: true
lighting_allowed: true
~~~

---

## 17. Recipe extension interface

Only the three music recipes are implemented in V1. Other CDC-SU services remain extension points.

Conceptual recipe definition:

~~~yaml
recipe_id: string
version: string
supported_service_ids: []
source_references: []
catalog_item_schema: string
ranking_applicability:
  feature_id: scored | context_only | not_applicable
eligibility_rule_ids: []
compatibility_function_ids: {}
plan_builder_id: string
output_policy_id: string
~~~

Each recipe implementation must:

- validate its catalog item;
- evaluate hard eligibility;
- calculate every active feature response;
- construct one service-specific plan;
- validate the finished plan;
- produce standard evidence.

The shared core owns:

- input validation;
- purpose multipliers;
- weight normalization;
- item_fit calculation;
- deterministic ordering;
- missing/invalid behavior;
- common evidence and serialization.

No registered recipe:

~~~yaml
decision_type: unsupported_recipe
reason: no_enabled_transparent_content_recipe
~~~

Future recipes must classify every baseline field, cite their CDC-SU source, use frozen data, remain deterministic, and expose every exclusion.

---

## 18. Missing, unknown, and invalid data

### 18.1 Missing

Missing valid baseline evidence becomes neutral:

~~~text
normalized evidence = 0
feature response = 0
contribution = 0
~~~

The factor stays in the trace as missing_neutral.

Complete simulator worlds should normally supply every field.

### 18.2 Unknown taxonomy values

Unknown tags:

- do not contribute to recognized affinity;
- are recorded in unknown_tags;
- do not block evaluation unless a required identity reference is unresolved.

### 18.3 Invalid

Invalid values block evaluation:

- wrong type;
- out-of-range number;
- unsupported enum;
- broken catalog reference;
- contradictory capability;
- unapproved enrichment used where approval is mandatory.

Invalid data must never be silently coerced to neutral.

---

## 19. Result and error categories

| decision_type | Meaning |
|---|---|
| complete_plan | Requested eligible items returned |
| partial_plan | Some but fewer than requested items returned |
| no_proposal | Supported recipe has no eligible item |
| unsupported_recipe | Selected service has no registered recipe |
| invalid_request | Invalid controls or baseline input |
| invalid_catalog | Invalid frozen catalog snapshot |
| invalid_configuration | Invalid weights, mappings, or denominator |

unsupported_recipe is not no_proposal. It identifies missing implementation capability rather than a valid evaluation with no candidate.

---

## 20. Explainability contract

### 20.1 Per-item trace

For every included item:

- item ID and plan position;
- source metadata fields used;
- enriched metadata fields used;
- per-field metadata provenance;
- raw baseline value;
- normalized evidence;
- compatibility function and parameters;
- normalized response;
- effective weight;
- signed contribution;
- item_fit;
- principal supporting and opposing reasons.

### 20.2 Plan-level trace

The plan records:

- trigger purpose;
- lifecycle stage;
- selected service;
- recipe and registry versions;
- requested and returned count;
- expected duration;
- source and enriched catalog snapshot hashes;
- ranking-applicability status and eligibility role for every baseline field;
- context-only fields;
- missing and unknown fields;
- exclusions and reason codes;
- effective weights;
- deterministic tie-break decisions;
- algorithm/configuration provenance.

### 20.3 Conceptual output

~~~yaml
decision_type: complete_plan
selected_service_id: humming_karaoke
recipe_version: content_recipe_humming_v1
requested_item_count: 5
returned_item_count: 5
expected_duration_sec: 425
items:
  - position: 1
    item_id: song_017
    item_fit: 0.53298329371
    mode:
      chorus_start_ms: 52000
      chorus_end_ms: 81000
      guide_vocal: true
    principal_reasons:
      - high activation match
      - destination match
      - hobby and tag preference
    contributions: []
context_only_evidence: []
excluded_item_summary: []
effective_weights: {}
catalog_provenance: {}
algorithm_provenance: {}
~~~

The normal customer view shows included-item scores and the strongest contributions. A detailed audit view may expose all evaluated-item traces. Neither view presents alternative plan candidates or an aggregate plan score.

---

## 21. Worked humming example

### 21.1 Context

~~~yaml
trigger_purpose: inattentive_driving_prevention_recovery
selected_service_id: humming_karaoke
drowsiness_level: 80
fatigue_level: 70
traffic_state: congested
road_type: highway
night_state: night
monotony_level: 90
destination_tags: [seaside]
child_present: false
multiple_passengers: false
oshi_registered: true
oshi_mode: on
oshi_id: oshi_01
scheduled_event_timing: soon
scheduled_event_tags: [summer_live]
~~~

Candidate song_017 has:

- activation capability 0.90, so signed activation is +0.80;
- exact seaside destination relation;
- related oshi membership relation;
- high tag usage;
- a play earlier in the week;
- 80 acceptance rate;
- 70 recovery rate.

For the humming scoring-applicability mask and inattentive-purpose profile, the active effective weights are:

| Factor | Weight |
|---|---:|
| Drowsiness | 0.160782080 |
| Fatigue | 0.131548975 |
| Traffic | 0.035079727 |
| Road | 0.035079727 |
| Night | 0.046772969 |
| Monotony | 0.116932422 |
| Destination | 0.033409263 |
| Child | 0.040091116 |
| Multiple passengers | 0.026727411 |
| Age | 0.008504176 |
| Hobbies | 0.025512528 |
| Oshi | 0.051025057 |
| Item usage | 0.031890661 |
| Tag usage | 0.023917995 |
| Scene usage | 0.023917995 |
| Played | 0.015186029 |
| Skipped | 0.021260440 |
| Changed-from | 0.012148823 |
| Cancelled | 0.012148823 |
| Schedule | 0.022779043 |
| Acceptance | 0.034168565 |
| Recovery | 0.091116173 |

The unrounded weights sum to 1.

Contributions:

| Factor | Response | Contribution |
|---|---:|---:|
| Drowsiness | +0.64 | +0.102901 |
| Fatigue | +0.56 | +0.073667 |
| Traffic | +0.56 | +0.019645 |
| Road | +0.48 | +0.016838 |
| Night | +0.56 | +0.026193 |
| Monotony | +0.72 | +0.084191 |
| Destination | +1.00 | +0.033409 |
| Child | 0.00 | 0.000000 |
| Multiple passengers | 0.00 | 0.000000 |
| Age | +0.50 | +0.004252 |
| Hobbies | +1.00 | +0.025513 |
| Oshi | +0.75 | +0.038269 |
| Item usage | +0.25 | +0.007973 |
| Tag usage | +1.00 | +0.023918 |
| Scene usage | +0.25 | +0.005979 |
| Played | -0.25 | -0.003797 |
| Skipped | 0.00 | 0.000000 |
| Changed-from | 0.00 | 0.000000 |
| Cancelled | 0.00 | 0.000000 |
| Schedule | +0.75 | +0.017084 |
| Acceptance | +0.60 | +0.020501 |
| Recovery | +0.40 | +0.036446 |

Using unrounded values:

~~~text
item_fit(song_017, humming_karaoke)
  = 0.53298329371
~~~

The displayed rounded rows may sum to a slightly different final decimal. Ranking uses the unrounded value.

---

## 22. Contrast behavior

World comparisons use:

- the same catalog snapshot;
- the same recipe and configuration;
- one explicitly changed baseline field.

The comparison reports:

- changed input;
- items entering or leaving the plan;
- position changes;
- item_fit deltas;
- feature-contribution deltas;
- eligibility changes.

Metadata preprocessing comparisons instead freeze the world and change only the enriched catalog snapshot/version. They are labeled separately.

Required initial contrasts:

1. low versus high drowsiness;
2. day versus night;
3. ordinary versus monotonous road;
4. child absent versus present;
5. ordinary versus characteristic destination;
6. oshi mode off versus on;
7. no event versus upcoming event;
8. no skip versus recent skip;
9. low versus high item/tag usage;
10. low versus high content recovery;
11. driving versus stopped motion.

---

## 23. Parameters and hyperparameters

### 23.1 Structural parameters

- plan_item_count;
- recipe registry;
- feature contract order;
- taxonomy version;
- age/era affinity table;
- route/destination relation table;
- oshi entity relation graph;
- schedule timing categories;
- history resolution precedence;
- eligibility policy IDs;
- presentation and transition policies.

### 23.2 Hyperparameters

- category, subgroup, and leaf weights;
- trigger-purpose multipliers;
- drowsiness/fatigue/monotony gamma values;
- activation mixture coefficients;
- tempo normalization bounds;
- karaoke ease bounds, component coefficients, and familiarity mapping;
- environment evidence values;
- child/group audience mappings;
- usage and novelty mappings;
- playback, skip, change, and cancellation windows/responses;
- schedule timing intensities;
- tag relation affinities;
- lighting lookup and intensity policy.

All editable configuration is frozen per run and shown in evidence.

---

## 24. Implementation components

Recommended units:

1. ContentInputValidator
2. RecipeRegistry
3. CatalogSnapshotValidator
4. EligibilityEvaluator
5. EvidenceNormalizer
6. CatalogCompatibilityEvaluator
7. HierarchicalWeightResolver
8. ItemScorer
9. DeterministicPlanBuilder
10. ContentEvidenceBuilder
11. ContrastComparator
12. CanonicalContentResultSerializer

The shared scoring core must not import a specific music recipe. Recipes register through the extension contract.

---

## 25. Required tests

### 25.1 Mathematics

- Every response is finite and in [-1,+1].
- Every effective weight is finite and non-negative.
- Active effective weights sum to one within 1e-12.
- Contributions reconstruct item_fit within 1e-12.
- item_fit stays in [-1,+1].
- Karaoke ease components and derived singability stay in [0,1].
- Activation and singability coefficient sets each sum to one.
- Presentation rounding never changes ordering.
- Stable item ID resolves exact ties.

### 25.2 Applicability

- Every baseline field has exactly one ranking-applicability status per recipe.
- Eligibility roles are represented independently from ranking applicability.
- Slides 71, 72, and 79 mappings are encoded.
- Detailed slides override Slide 70 where documented.
- Context-only fields cannot change item ordering.
- Not-applicable fields cannot change response or weight.
- Disabled extensions never appear in evaluation.

### 25.3 Eligibility

- Disabled/unplayable items are excluded.
- Child policy excludes explicit/adult-only items.
- Humming requires valid chorus capability.
- Humming driving plans do not require a lyrics screen.
- Full karaoke active presentation requires stopped motion.
- Recent skips apply the configured exclusion.
- Every exclusion contains complete evidence.

### 25.4 Preference and history

- Oshi mode off produces zero oshi response without deleting identity.
- Child/group appeal is derived from frozen audience tags, not read as an opaque catalog score.
- Usage mappings match configuration.
- Playlist novelty does not affect humming/full karaoke.
- Playback windows produce the configured responses.
- Item-specific performance overrides tag fallback.
- Missing performance is neutral.

### 25.5 Plan construction

- Items are ordered by full-precision item_fit.
- The plan has unique item IDs.
- Complete, partial, and no-proposal behavior matches cardinality.
- No aggregate plan score exists.
- Expected duration equals selected item/chorus duration sum.
- Lighting appears only when compatible.

### 25.6 Extension interface

- Missing recipe returns unsupported_recipe.
- A recipe cannot omit a baseline-field classification.
- A recipe cannot emit out-of-range responses.
- A recipe cannot bypass common eligibility evidence.
- Registry conflicts are rejected.

### 25.7 Determinism and evidence

- Identical frozen inputs reproduce identical ordering and evidence.
- Same-runtime canonical serialization is byte-identical.
- Every included score is reproducible from its evidence.
- LLM generation is never invoked during evaluation.

### 25.8 Contrast tests

- High drowsiness increases high-activation contributions.
- Destination changes affect only applicable recipes/items.
- Child presence changes eligibility and child response only.
- Oshi mode changes oshi response only.
- Schedule changes affect related items only.
- Skip, usage, acceptance, and recovery contrasts affect their declared factors.
- A one-variable clone differs in exactly its declared world fields.

---

## 26. Acceptance criteria

The design is satisfied when:

1. The content selector is independent of service-selector scores and state.
2. Only CDC-SU baseline inputs affect baseline-mode scoring.
3. Oshi identity/tags are source-traceable UPro baseline data.
4. The three detailed recipes classify every baseline field.
5. Every catalog value used by scoring comes from a frozen validated snapshot.
6. Every included song has a reproducible item_fit and contribution trace.
7. One ordered plan is returned; no plan candidates or plan score exist.
8. Default music plans request five items and report partial/no-proposal behavior explicitly.
9. Humming and full-karaoke presentation constraints are enforced before scoring.
10. Source versus enriched metadata provenance is visible.
11. The shared extension interface can register future service recipes.
12. Customer contrasts show plan and contribution changes from controlled input changes.
13. Identical inputs are deterministic.
14. No output claims probability, measured recovery, or production safety.

---

## 27. Deferred improvements

- Plan diversity and artist caps;
- energy-flow or musical-transition sequencing;
- duration/journey feasibility using simulator extension fields;
- evidence-confidence shrinkage;
- probabilistic uncertainty ranking;
- empirical calibration from production behavior;
- detailed recipes for quiz, ranking, radio, video, stretch, call-and-response, and oshi reexperience;
- production metadata acquisition and privacy policy;
- separately versioned catalog-enrichment algorithms.

Each deferred capability must be introduced explicitly. None may silently alter the V1 scoring contract.

---

## 28. Summary

For eligible item j, selected service s, and purpose p:

~~~text
r_i(j,s)
  = compatibility_i(
      normalized baseline evidence,
      frozen source metadata,
      frozen enriched metadata,
      recipe_s
    )

q_i(p,s)
  = base_weight_i
  × purpose_multiplier[p][subgroup(i)]
  × scoring_applicability[i][s]

w_i(p,s)
  = q_i(p,s) / sum(q_active)

item_fit(j,s)
  = clamp(sum_i(w_i(p,s) × r_i(j,s)), -1, +1)

plan
  = first plan_item_count unique items
    after sorting by item_fit descending
    then stable item ID
~~~

The algorithm returns one explainable ordered plan. The data-generation system that supplies its catalog is separate, versioned, and shared by the whole simulator.
