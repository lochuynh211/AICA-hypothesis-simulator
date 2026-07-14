# AICA Transparent Content-Proposal Algorithm

Status: approved Spotify-only V1 design
Scope: baseline-feature transparent selector for detailed music content
Last updated: 2026-07-14

## Related documents

- [AICA proposal simulator specification](./aica_proposal_simulator_specification.md)
- [AICA synthetic Spotify-compatible music data and generation specification](./aica_synthetic_music_data_and_generation_specification.md)
- [AICA transparent service-proposal algorithm](./aica_transparent_service_proposal_algorithm.md)
- [Spotify Track reference](https://developer.spotify.com/documentation/web-api/reference/get-track)
- [Spotify Audio Features reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)

---

## 1. Purpose

This document defines the transparent algorithm that selects concrete songs after the service-proposal algorithm has selected one detailed music service:

- playlist;
- humming karaoke; or
- full karaoke.

It produces one complete, ordered plan of five songs by default. The customer may change the plan length in settings.

The plan shows the selection score for each chosen song. The primary representation does not need to show scores for every rejected candidate, although full candidate traces may be retained for audit and testing.

V1 is intentionally limited to:

- baseline context, preference, and history inputs;
- Spotify-compatible Track fields;
- Spotify-compatible Audio Features fields; and
- two simulator availability flags for karaoke eligibility.

It does not use AICA/LLM-enriched song tags or inferred karaoke metadata.

---

## 2. Selected design

The selector uses one deterministic pipeline:

```text
selected detailed service
  -> validate world and frozen song catalog
  -> apply hard eligibility
  -> derive transparent Spotify audio proxies
  -> calculate effective baseline-feature weights
  -> score every eligible song
  -> sort deterministically
  -> return the first configured N songs
```

Initial `N = 5`.

The design has these properties:

- the service selector decides the service; the content selector does not reopen that decision;
- the same signed evidence × candidate-response model, hierarchical weights, purpose multipliers, and contribution conventions are used as the transparent service selector;
- service candidate responses are human-configured profiles, while song candidate responses are derived continuously from the selected service's activation score;
- provider metadata is never confused with simulator assumptions;
- unsupported semantic relations are neutral, not guessed;
- eligibility is evaluated independently from ranking;
- karaoke flags default to `1` but never increase ranking score;
- all arithmetic and tie-breaking are deterministic; and
- every selected item carries a reconstructable contribution trace.

---

## 3. Relationship to the service selector

The two transparent algorithms are coherent but operate at different levels:

| Concern | Service proposal | Content proposal |
|---|---|---|
| Decision | Which service to propose | Which songs to place in the selected service |
| Candidate | Service | Spotify-compatible Track |
| Safety | Service-level driving/stopped restrictions | Item playability, explicit policy, skip policy, and karaoke flags |
| Ranking evidence | Baseline context against service behavior | Baseline context/history against song audio and identity |
| Output | Service proposal and lifecycle state | Ordered five-song plan by default |

The content selector requires an accepted or active detailed service input:

```yaml
selected_service:
  selected_service_id: music_playlist | humming_karaoke | full_karaoke
  lifecycle_state: accepted | active
```

If this control is missing, rejected, or unsupported, content selection returns a typed error. It never substitutes another service.

---

## 4. Decision boundary

### 4.1 Required control inputs

- `selected_service.selected_service_id`;
- `selected_service.lifecycle_state`;
- `trigger.purpose`;
- `trigger.stage`;
- current time and market;
- current motion state;
- frozen world snapshot;
- frozen song catalog;
- algorithm and parameter versions; and
- `plan_item_count`, default `5`.

### 4.2 Ranking evidence

Ranking may use only baseline fields marked `scored` in Section 5 and the catalog fields named by their response formulas.

### 4.3 Catalog metadata

Each V1 candidate contains:

```yaml
spotify_track: {}
spotify_audio_features: {}
simulation_flags:
  humming_karaoke_available: 1
  full_karaoke_available: 1
```

There is no `enriched_metadata` input.

### 4.4 Non-ranking controls

These may affect eligibility, execution, or presentation without receiving score weight:

- motion state;
- child-present explicit-content policy;
- market, restrictions, and playability;
- simulator karaoke availability flags;
- configured skip exclusion window;
- item count;
- fixed humming-segment duration;
- lighting presentation; and
- transition policy.

### 4.5 Lifecycle execution

The selector creates a plan only after service acceptance or activation. Rejection and service change invalidate the plan. A new catalog version, relevant world change, or customer setting change triggers re-evaluation and produces a new evidence record.

---

## 5. Detailed-service applicability

### 5.1 Operational interpretation

The CDC-SU baseline table expresses the intended evidence breadth. The Spotify-only V1 catalog cannot operationalize every intended relation.

Each service cell uses:

- `S`: scored;
- `C`: retained as context but score mask is zero;
- `E`: hard-eligibility role;
- `—`: not applicable.

Combined values such as `C+E` mean the field is visible and affects eligibility but not ranking.

An unsupported field is never mapped to a convenient but undocumented Spotify property. Its base weight remains defined for traceability and future extension, while its active scoring mask is `0` in V1.

### 5.2 Baseline detailed-music mapping

| Baseline feature | Playlist | Humming karaoke | Full karaoke | Spotify-only V1 reason |
|---|---:|---:|---:|---|
| Drowsiness level | S | S | S | Signed evidence makes calm songs support low drowsiness and active songs support high drowsiness. |
| Fatigue level | S | S | S | Uses the same initial signed calm-to-active hypothesis as drowsiness. |
| Traffic state | S | S | S | Normal and congested resolve opposite signed activation evidence under the initial profile. |
| Road type | S | S | S | Category-specific signed evidence selects calm, neutral, or active song response; it is not matched to a tag. |
| Day/night state | S | S | S | Day and night resolve opposite signed activation evidence under the initial profile. |
| Road monotony | S | S | S | Calm songs support low monotony and active songs support high monotony. |
| Route characteristics | C | C | C | Track and Audio Features contain no route relation. |
| Destination characteristics | C | C | C | Track and Audio Features contain no destination relation. |
| Child present | C+E | C+E | C+E | Excludes `explicit: true`; no child-appeal ranking field exists. |
| Multiple passengers | C | C | C | No supported group-appeal field exists. |
| Driving/stopped state | C | C | C+E | Full karaoke requires stopped state. |
| Oshi registered | S gate | S gate | S gate | Enables exact artist-ID response. |
| Oshi mode | S gate | S gate | S gate | Enables exact artist-ID response. |
| Oshi ID | S | S | S | Exact match against `spotify_track.artists[*].id`. |
| Oshi type | C | C | C | V1 implements only Spotify Artist identity. |
| Oshi tags | C | C | C | No song semantic tags exist. |
| Service recency | C | C | C | Same selected-service value for every candidate. |
| Service usage level | C | C | C | Same selected-service value for every candidate. |
| Scene/service usage level | C | C | C | Same selected-service value for every candidate. |
| Age band | S | S | S | Versioned era affinity uses album release date. |
| Gender | C | C | C | Preserved with default zero weight. |
| Hobbies and interests | C | C | C | No provider genre/theme field in the selected V1 Track contract. |
| Catalog item recency | S | — | — | Weak direct-track novelty is playlist-specific. |
| Content-tag recency | C | — | — | No content tags exist. |
| Content-tag usage level | C | C | C | No content tags exist. |
| Catalog item usage level | S | S | S | Exact Track ID history is available. |
| Scene/content-tag usage | C | C | C | No content tags exist. |
| Played items | S | S | S | Exact Track ID and timestamp. |
| Skipped items | S+E | S+E | S+E | Recent skip may exclude; older skip may penalize. |
| Cancelled content plans | S | S | S | Exact Track IDs from cancelled plans. |
| Changed-from items | S | S | S | Exact Track ID and timestamp. |
| Service proposal acceptance rate | C | C | C | Same selected-service context for every candidate. |
| Service recovery rate | C | C | C | Same selected-service context for every candidate. |
| Scheduled event type | C | C | C | No song event relation exists. |
| Scheduled event timing | C | C | C | Timing alone cannot establish item affinity. |
| Scheduled event tags | C | C | C | No song event tags exist. |
| Content proposal acceptance rate | S | S | S | Exact Track ID rate only. |
| Content recovery rate | S | S | S | Exact Track ID rate only. |

The source feature is not deleted when marked `C`; the trace records that it was present but operationally unavailable for Spotify-only song comparison.

---

## 6. Core mathematical model

### 6.1 Scale contract

For baseline factor `i`, song `j`, selected service `s`, and purpose `p`:

| Symbol | Serialized name | Meaning | Range |
|---|---|---|---:|
| `x_i` | `raw_value` | Raw baseline input | field-specific |
| `e_i` | `normalized_evidence` | Normalized context/history evidence | `[-1,+1]` |
| `a_i(j,s)` | `response_coefficient` | Candidate response profile; activation-derived for activation factors | `[-1,+1]` |
| `r_i(j,s)` | `normalized_feature_response` | Evidence × candidate response | `[-1,+1]` |
| `B_i` | `base_weight` | Flattened hierarchy weight | `[0,1]` |
| `q_i(p,s)` | `effective_raw_weight` | Adjusted unnormalized active weight | `[0,+∞)` |
| `w_i(p,s)` | `effective_weight` | Normalized active weight | `[0,1]`, sum `1` |
| `k_i(j,s)` | `feature_contribution` | Signed weighted response | `[-w_i,+w_i]` |
| `F(j,s)` | `item_fit` | Final selection score shown in the plan | `[-1,+1]` |

`item_fit` is a comparative hypothesis score. It is not a probability, safety assurance, or predicted acceptance percentage.

### 6.2 Compatibility interface

For every active factor, content scoring follows the same interface as service scoring:

```text
r_i(song, service)
  = clamp(
      e_i
      × a_i(song, service),
      -1,
      +1
    )
```

For activation-responsive factors:

```text
a_i(song, service)
  = activation_response_coefficient(song, service)
  = 2 × service_activation(song) - 1
```

For identity, affinity, and history factors, the feature section explicitly defines which value is evidence and which is the response coefficient.

Every function must:

- return a finite number in `[-1,+1]`;
- name every input field;
- expose its formula or lookup version;
- return zero for missing-neutral evidence; and
- never read an undeclared extension.

### 6.3 Effective weight

```text
B_i
  = category_weight
  × subgroup_weight
  × leaf_weight

q_i(p,s)
  = B_i
  × purpose_multiplier[p][subgroup(i)]
  × scoring_applicability[i][s]

w_i(p,s)
  = q_i(p,s) / sum(q_active)
```

`scoring_applicability` is `1` only for scored factors. It is `0` for context-only and not-applicable factors. Eligibility never changes a weight.

Missing scored evidence remains active with response zero; it does not cause weight redistribution. A zero or non-finite active-weight denominator is an invalid configuration.

### 6.4 Contribution and score

```text
k_i(j,s) = w_i(p,s) × r_i(j,s)

item_fit(j,s)
  = clamp(sum(k_i(j,s)), -1, +1)
```

The unclamped result is already bounded because all active weights are non-negative and sum to one. The clamp protects against floating-point drift.

### 6.5 Numeric semantics

- IEEE-754 binary64 arithmetic;
- fixed factor evaluation order;
- full-precision ranking;
- presentation rounding only;
- negative zero serialized as positive zero;
- exact score ties resolved by ascending Track ID; and
- absolute cross-runtime test tolerance `1e-12`.

---

## 7. Hierarchical base weights

The hierarchy is retained from the transparent service proposal so cross-algorithm review remains coherent. Spotify-only applicability masks unsupported leaves and renormalizes the remaining active leaves.

### 7.1 Top level

| Category | Weight |
|---|---:|
| Situation | 0.55 |
| Preference | 0.30 |
| History | 0.15 |

### 7.2 Situation

| Subgroup | Share | Leaves and shares |
|---|---:|---|
| Driver state | 0.35 | drowsiness `0.55`, fatigue `0.45` |
| Driving environment | 0.30 | traffic `0.15`, road `0.15`, night `0.20`, monotony `0.50` |
| Route/destination | 0.20 | route `0.50`, destination `0.50` |
| Passengers | 0.15 | child `0.60`, multiple passengers `0.40` |

Route/destination and passenger ranking leaves are masked in Spotify-only V1. Child and motion policy remain eligibility controls outside scoring.

### 7.3 Preference

| Subgroup | Share | Leaves and shares |
|---|---:|---|
| UPro/oshi | 0.35 | age `0.10`, hobbies `0.30`, oshi `0.60`, gender `0.00` |
| Novelty | 0.10 | item recency `0.60`, tag recency `0.40` |
| Usage | 0.35 | item usage `0.40`, tag usage `0.30`, scene/tag usage `0.30` |
| Operations | 0.20 | played `0.25`, skipped `0.35`, changed-from `0.20`, cancelled `0.20` |

Hobbies, tag factors, and scene/tag factors are masked. Novelty is active only for playlist item recency.

### 7.4 History

| Subgroup | Share | Leaf |
|---|---:|---|
| Schedule | 0.30 | schedule relation `1.00` |
| Content acceptance | 0.30 | exact Track ID rate `1.00` |
| Content recovery | 0.40 | exact Track ID rate `1.00` |

Schedule is masked in Spotify-only V1.

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

A multiplier on a masked subgroup still produces zero active weight. For example, the route-music multiplier cannot create a route match without route-compatible song metadata. This is an explicit V1 limitation.

Customers may set every multiplier to `1.0` for a global model. Hard eligibility remains unchanged.

---

## 9. Spotify-derived service activation

### 9.1 Field roles

| Spotify Audio Features field | Derived use |
|---|---|
| `energy` | primary activation |
| `tempo` | normalized activation and tempo-ease proxy |
| `danceability` | activation and karaoke-ease proxies |
| `loudness` | normalized activation |
| `valence` | small activation contribution and optional lighting presentation |
| `instrumentalness` | vocal-presence proxy |
| `speechiness` | speech-ease proxy |
| `duration_ms` | full-karaoke ease proxy and plan duration |

`key`, `mode`, `time_signature`, `acousticness`, and `liveness` are preserved but not scored in V1. `analysis_url`, `track_href`, `type`, `uri`, and IDs are identity/provenance fields only.

### 9.2 Normalization

```text
clamp(x) = min(max(x, 0), 1)

normalized_tempo
  = clamp((tempo - 60) / 120)

normalized_loudness
  = clamp((loudness + 60) / 60)
```

Tempo at or below `60 BPM` maps to `0`; tempo at or above `180 BPM` maps to `1`. Loudness at or below `-60 dB` maps to `0`; loudness at or above `0 dB` maps to `1`.

### 9.3 Common audio activation

```text
audio_activation
  = 0.50 × energy
  + 0.20 × normalized_tempo
  + 0.15 × danceability
  + 0.10 × normalized_loudness
  + 0.05 × valence
```

### 9.4 Transparent karaoke proxies

Spotify does not provide chorus singability or full-song singability. V1 derives limited proxies instead:

```text
vocal_presence
  = 1 - instrumentalness

speech_ease
  = 1 - clamp((speechiness - 0.33) / (0.66 - 0.33))

tempo_ease
  = 1 - clamp(abs(tempo - 110) / 90)

duration_ease
  = 1 - clamp((duration_ms - 180000) / 180000)

humming_ease
  = 0.35 × vocal_presence
  + 0.25 × speech_ease
  + 0.25 × danceability
  + 0.15 × tempo_ease

full_karaoke_ease
  = 0.30 × vocal_presence
  + 0.25 × speech_ease
  + 0.15 × danceability
  + 0.15 × tempo_ease
  + 0.15 × duration_ease
```

These formulas estimate relative suitability only. They do not prove that lyrics, melody, a chorus segment, or karaoke assets exist.

### 9.5 Service activation

```text
playlist_activation
  = audio_activation

humming_activation
  = 0.75 × audio_activation
  + 0.25 × humming_ease

full_karaoke_activation
  = 0.65 × audio_activation
  + 0.35 × full_karaoke_ease
```

All activation and ease results are in `[0,1]`. Convert the selected service activation into the song candidate's signed response coefficient:

```text
a_activation(song, service)
  = activation_response_coefficient(song, service)
  = 2 × service_activation(song) - 1
```

Interpretation:

| `a_activation` | Candidate response profile |
|---:|---|
| `-1` | very calm song |
| `-0.5` | relatively calm song |
| `0` | activation-neutral song |
| `+0.5` | relatively active song |
| `+1` | very active song |

Unlike the service selector's human-configured candidate coefficients, this coefficient is calculated from the frozen Spotify-derived service activation. It is still evidence-visible and versioned.

`simulation_flags` do not appear in these formulas.

---

## 10. Compatibility functions

### 10.1 Driver state and environment

#### 10.1.1 Signed continuous evidence

Drowsiness, fatigue, and monotony are two-directional content evidence:

```text
signed_level(value)
  = clamp(2 × (value / 100) - 1, -1, +1)

e_drowsiness = signed_level(drowsiness_level)
e_fatigue    = signed_level(fatigue_level)
e_monotony   = signed_level(monotony_level)
```

| Raw level | Normalized evidence | Meaning for activation response |
|---:|---:|---|
| `0` | `-1.0` | strongly favors calm songs |
| `25` | `-0.5` | mildly favors calm songs |
| `50` | `0.0` | activation-neutral |
| `75` | `+0.5` | mildly favors active songs |
| `100` | `+1.0` | strongly favors active songs |

A present value of `0` is valid negative evidence, not missing data. A missing field is recorded as `missing_neutral` and resolves to evidence `0` without pretending the raw value was `50`.

#### 10.1.2 Signed categorical evidence

Initial categorical activation-evidence profiles are:

| Feature state | Normalized evidence | Meaning |
|---|---:|---|
| traffic normal | `-1.0` | calm-song direction |
| traffic congested | `+1.0` | active-song direction |
| road highway | `+1.0` | active-song direction |
| road local | `0.0` | activation-neutral |
| road mountain | `-1.0` | calm-song direction to reduce load |
| road parking | `0.0` | activation-neutral; motion eligibility is separate |
| day | `-1.0` | calm-song direction |
| night | `+1.0` | active-song direction |

These mappings are editable content-response hypotheses. They are not Spotify metadata, empirical safety claims, or eligibility rules. They mirror the service selector's categorical candidate-response-profile pattern while deriving the song side from audio activation.

#### 10.1.3 Candidate response and feature response

For all six activation-responsive factors, the same service-specific song coefficient is reused:

```text
a_i(song, service)
  = a_activation(song, service)
  = 2 × service_activation(song) - 1

r_i(song, service)
  = clamp(e_i × a_i(song, service), -1, +1)
```

The sign agreement determines compatibility:

| Evidence sign | Song coefficient sign | Response |
|---:|---:|---|
| negative/calm | negative/calm | positive match |
| negative/calm | positive/active | negative mismatch |
| positive/active | positive/active | positive match |
| positive/active | negative/calm | negative mismatch |
| either value | zero | neutral |

Thus low drowsiness gives a calm song a larger response than an active song, while high drowsiness reverses that ordering. The same response structure applies to the approved signed mappings for fatigue, monotony, traffic, road, and day/night.

### 10.2 Route, destination, and passengers

Route, destination, multiple-passenger, and group-suitability ranking responses are `0` in Spotify-only V1. No matching song metadata exists.

Child presence also has ranking response `0`. It independently excludes explicit tracks under the configured child policy.

### 10.3 Age and release era

Age uses only:

- `world.driver.age_band`; and
- the year derived from `spotify_track.album.release_date`.

A versioned age/era affinity table returns the candidate response coefficient:

```text
e_age = 1  when age band and usable release year are present
      = 0  otherwise

a_age(song) = age_era_affinity[age_band][release_era]

r_age(song) = e_age × a_age(song)
```

The coefficient lies in `[-1,+1]`; the table and rationale are evidence-visible. Missing or year-precision-incompatible data produces missing-neutral evidence `0`.

Gender has zero weight. Hobbies and interests are context-only because the selected V1 Track contract contains no matching genre or theme field.

### 10.4 Exact oshi artist

Oshi response is active only when:

```text
oshi_registered = true
and oshi_mode = on
and at least one oshi Spotify Artist ID exists
```

```text
e_oshi = 1  when registration, mode, and Artist ID are present
       = 0  otherwise

a_oshi(song)
  = +1  if any spotify_track.artists[*].id exactly matches
  =  0  otherwise

r_oshi(song) = e_oshi × a_oshi(song)
```

Oshi mode off or an unregistered oshi produces evidence `0`; the leaf remains active and neutral so runtime evidence absence does not redistribute weight. V1 does not infer member, group, character, franchise, theme, or shared-tag relations.

### 10.5 Direct item usage

Only exact Track ID usage is scored. The lookup produces signed evidence; the candidate coefficient is `+1` because the history already belongs to the candidate Track:

| Usage level | Normalized evidence |
|---|---:|
| never | 0.00 |
| low | -0.50 |
| medium | +0.25 |
| high | +1.00 |

```text
a_item_usage(song) = +1
r_item_usage(song) = e_item_usage(song) × a_item_usage(song)
```

Tag and scene/tag usage are context-only.

### 10.6 Playlist item novelty

Only playlist activates direct item novelty. The lookup produces signed evidence and uses coefficient `+1`:

| Catalog item recency | Normalized evidence |
|---|---:|
| never | +1.00 |
| long_unused | +0.50 |
| recent | 0.00 |

```text
a_item_novelty(song) = +1
r_item_novelty(song) = e_item_novelty(song) × a_item_novelty(song)
```

Humming and full karaoke mark novelty not applicable. No tag-recency fallback exists.

### 10.7 Playback and operations

Played-item history resolves signed evidence:

| Last played | Normalized evidence |
|---|---:|
| within 30 minutes | -1.00 |
| earlier today | -0.50 |
| within seven days | -0.25 |
| older or never | 0.00 |

Recent explicit skip:

```text
inside skip_exclusion_window -> hard exclusion
older recorded skip          -> -0.50
```

Changed-from inside its configured penalty window returns `-0.75`. A Track in a recently cancelled plan returns `-0.50`. Otherwise each response is `0`.

For played, skipped, changed-from, and cancelled-plan factors:

```text
a_operation(song) = +1
r_operation(song) = e_operation(song) × a_operation(song)
```

### 10.8 Content acceptance and recovery

Only exact Track ID rates are accepted. There is no tag, genre, artist, or plan-average fallback. The normalized rate is evidence and uses coefficient `+1`:

```text
rate_response
  = 2 × rate / 100 - 1

e_rate(song) = rate_response
a_rate(song) = +1
r_rate(song) = e_rate(song) × a_rate(song)
```

| Rate | Normalized evidence/response |
|---:|---:|
| 80 | +0.60 |
| 50 | 0.00 |
| 20 | -0.60 |

Missing rate is neutral `0`. Acceptance and recovery remain separate factors.

### 10.9 Schedule and service-level history

Schedule type, timing, and tags are context-only because Spotify-only songs have no event relation. Service-level usage, acceptance, and recovery are also context-only because their value is identical across every candidate in the already selected service.

---

## 11. Hard eligibility

Eligibility executes before scoring and returns explicit reason codes.

### 11.1 Common exclusions

A song is excluded when any of these is true:

- Track or Audio Features schema is invalid;
- Track ID, URI, or duration does not agree across the two objects;
- `spotify_track.is_playable` is not `true`;
- current market is absent from `spotify_track.available_markets` (including an empty list);
- a Track restriction blocks playback in the current context;
- `spotify_track.explicit` is `true` while the child-present policy prohibits explicit content;
- the Track was skipped inside `skip_exclusion_window`; or
- the same Track ID already occupies another plan position.

### 11.2 Playlist

No karaoke flag is required. The common exclusions are sufficient.

### 11.3 Humming karaoke

In addition to common eligibility:

```text
simulation_flags.humming_karaoke_available = 1
```

No chorus boundary, lyric, or guide-vocal field is required because V1 does not claim to execute a real karaoke asset.

### 11.4 Full karaoke

In addition to common eligibility:

```text
simulation_flags.full_karaoke_available = 1
and motion_state = stopped
```

Full karaoke is unavailable while driving. The content selector returns the exclusion; it does not switch to humming or playlist.

### 11.5 Approved default assumption

Every generated standard song has both karaoke flags set to `1`. Customers can change the defaults or individual values in settings. Flags are gates only; `1` contributes no score.

High `instrumentalness` is not a hard exclusion. It lowers the vocal-presence proxy while preserving the approved availability assumption.

---

## 12. Evaluation pipeline

For one active service:

1. validate control inputs and lifecycle state;
2. load the frozen Spotify-compatible catalog and manifest;
3. validate every song object and cross-object identity;
4. apply common and service-specific eligibility;
5. calculate normalized tempo and loudness;
6. calculate common audio activation;
7. calculate the selected service ease and activation;
8. normalize world features into signed evidence and resolve active leaves;
9. calculate and normalize effective weights once for the run;
10. resolve each candidate's direct identity/history evidence;
11. derive each song's selected-service activation response coefficient;
12. calculate `normalized_feature_response = evidence × response_coefficient` for every active factor;
13. calculate contributions and `item_fit` in contract order;
14. sort eligible candidates by full-precision score and stable ID;
15. take the first configured `plan_item_count` candidates;
16. build service-specific presentation fields; and
17. persist plan-level and selected-item evidence.

The ranking result must not feed back into the synthetic catalog or world snapshot.

---

## 13. Plan construction

### 13.1 Deterministic policy

```text
ordered_candidates
  = eligible candidates sorted by:
      1. item_fit descending
      2. spotify_track.id ascending

plan
  = first plan_item_count candidates
```

There is no hidden diversity reranker, artist cap, random shuffle, or LLM reorder in V1. If such a constraint is added later, it must be a visible plan-construction rule with evidence.

### 13.2 Cardinality

- default `plan_item_count = 5`;
- customer may change it in settings;
- success returns exactly that many unique songs; and
- too few eligible songs returns `insufficient_eligible_items`, not a silently shortened complete plan.

### 13.3 Score display

Each chosen plan item displays:

- order;
- title;
- artist names;
- album/release information when desired;
- selected-service score `item_fit`; and
- concise positive and negative reasons.

The main plan view does not need a table of rejected candidates. Audit mode may expose their traces.

### 13.4 Duration

Playlist and full karaoke use provider duration:

```text
expected_plan_duration_ms
  = sum(spotify_track.duration_ms)
```

Spotify supplies no chorus boundary. Humming karaoke therefore uses a plan-level simulator parameter rather than invented song metadata:

```text
fixed_humming_segment_sec = 30  # initial default

expected_plan_duration_sec
  = plan_item_count × fixed_humming_segment_sec
```

The output labels this as `simulated_fixed_segment`, not provider duration or detected chorus duration.

### 13.5 Lighting presentation

Optional lighting may use `valence` as a presentation cue. Lighting never changes score or order. The exact lookup is versioned and may be disabled independently.

---

## 14. Detailed recipe outputs

### 14.1 Playlist

```yaml
recipe: music_playlist
playback_unit: full_track
plan_item_count: 5
duration_basis: spotify_track.duration_ms
```

### 14.2 Humming karaoke

```yaml
recipe: humming_karaoke
interaction_unit: simulated_humming_segment
plan_item_count: 5
segment_duration_sec: 30
duration_basis: simulated_fixed_segment
```

The output does not claim a detected chorus, synchronized lyrics, or karaoke asset.

### 14.3 Full karaoke

```yaml
recipe: full_karaoke
interaction_unit: simulated_full_track_karaoke
required_motion_state: stopped
plan_item_count: 5
duration_basis: spotify_track.duration_ms
```

The service is a simulator behavior. The availability flag is not evidence of commercial rights or real asset availability.

---

## 15. Recipe extension interface

A future recipe registers:

```yaml
recipe_id: string
accepted_service_types: [string]
required_catalog_namespaces: [string]
eligibility_rules: [versioned_rule_id]
scored_baseline_features: [field_id]
evidence_normalizers: [versioned_function_id]
response_coefficient_functions: [versioned_function_id]
feature_response_function: signed_evidence_times_candidate_response_v1
activation_function: versioned_function_id
plan_item_count_default: integer
duration_policy: versioned_policy_id
presentation_policy: versioned_policy_id
```

New metadata namespaces default to disabled. A recipe cannot read them until source, provenance, validation, missing-data behavior, applicability, and scoring are all approved.

The Spotify Audio Features endpoint is marked deprecated in the selected reference. The implementation depends on a pinned fixture schema, not live endpoint availability. A future provider migration must register a new catalog adapter/version without silently changing this algorithm.

---

## 16. Missing, unknown, and invalid data

### 16.1 Missing baseline evidence

A missing scored baseline field:

- remains active;
- has normalized evidence and response `0`;
- retains its effective weight; and
- is listed as `missing_neutral`.

This prevents evidence absence from quietly redistributing influence.

For signed 0–100 features, a present raw `0` maps to evidence `-1`; it is not treated as missing. The trace always distinguishes `missing_neutral` from a valid low endpoint.

### 16.2 Unsupported semantic evidence

Route, destination, hobby, oshi-tag, content-tag, and schedule semantics are not “missing song data” in V1. They are declared `context_only_unsupported` and have scoring mask `0`.

### 16.3 Missing Spotify score fields

A candidate missing any Track or Audio Features field required by eligibility or an active formula is `invalid_catalog` and excluded. V1 does not impute provider values.

Nullable provider fields that are not required by an active rule remain valid when their schema permits null.

### 16.4 Invalid data

Reject or exclude as appropriate:

- NaN or infinity;
- out-of-range normalized audio fields;
- invalid key, mode, duration, tempo, or time signature;
- mismatched Track and Audio Features identity;
- availability flags outside integer `{0,1}`;
- signed evidence, response coefficient, or normalized feature response outside `[-1,+1]`;
- unknown selected service;
- invalid purpose or parameter version; and
- zero active-weight denominator.

---

## 17. Result and error categories

| Result | Meaning |
|---|---|
| `complete_plan` | exactly the configured number of songs selected |
| `invalid_request` | service lifecycle, purpose, stage, or count invalid |
| `unsupported_service` | no registered detailed recipe |
| `invalid_catalog` | catalog or song schema invalid |
| `no_proposal` | every candidate excluded |
| `insufficient_eligible_items` | fewer eligible songs than configured plan count |
| `invalid_configuration` | weights, multipliers, formulas, or versions invalid |
| `full_karaoke_requires_stopped` | active full-karaoke service cannot run while moving |

Typed errors include evidence and never trigger an undeclared fallback service.

---

## 18. Explainability contract

### 18.1 Selected-item trace

Each chosen song records:

```yaml
position: 1
track_id: synthetic-track-0001
title: Afterglow Highway
artists:
  - id: synthetic-artist-0001
    name: Aoi Meridian
item_fit: 0.37576713988095228
eligible: true
derived_audio:
  normalized_tempo: 0.48509166666666664
  normalized_loudness: 0.90195
  audio_activation: 0.7173633333333334
  humming_ease: 0.880164
  humming_activation: 0.7580635
  activation_response_coefficient: 0.516127
contributions: []
top_positive_reasons: []
top_negative_reasons: []
```

Every contribution includes factor ID, raw evidence, normalized evidence, catalog fields read, formula version, response coefficient and its provenance, base weight, purpose multiplier, applicability mask, effective weight, normalized feature response, and contribution.

### 18.2 Exclusion trace

An excluded item records only what is needed to explain exclusion:

```yaml
track_id: synthetic-track-0099
eligible: false
reason_codes:
  - explicit_blocked_child_present
```

### 18.3 Plan-level trace

The plan records:

- selected service and lifecycle;
- trigger purpose and stage;
- plan count setting;
- catalog, world, algorithm, schema, and parameter hashes/versions;
- active and context-only feature lists;
- signed-evidence profile and activation-response formula versions;
- normalized effective weights;
- deterministic sort and tie-break rules;
- expected duration and basis;
- lighting policy version if enabled; and
- selected Track IDs in order.

---

## 19. Worked humming example

This example shows how a song's Spotify fields and world evidence produce the score shown inside the five-song plan.

### 19.1 Context

```yaml
service: humming_karaoke
trigger_purpose: inattentive_driving_prevention_recovery
drowsiness_level: 80
fatigue_level: 70
traffic_state: congested
road_type: highway
night_state: night
monotony_level: 90
age_era_affinity: 0.50
oshi_mode: on
oshi_artist_exact_match: true
item_usage: medium
last_played: within_7_days
skip: none
changed_from: none
cancelled_plan: none
content_acceptance_rate: 80
content_recovery_rate: 70
```

Route and destination may be present in the world but are context-only and do not enter the score.

Candidate Audio Features:

```yaml
energy: 0.842
tempo: 118.211
danceability: 0.585
loudness: -5.883
valence: 0.428
instrumentalness: 0.00686
speechiness: 0.0556
duration_ms: 237040
```

Both karaoke flags are `1`, so the song is eligible for the selected service.

### 19.2 Derived audio values

```text
normalized_tempo       = 0.48509166666666664
normalized_loudness    = 0.90195
audio_activation       = 0.7173633333333334
vocal_presence         = 0.99314
speech_ease            = 1.0
tempo_ease             = 0.9087666666666667
duration_ease          = 0.6831111111111111
humming_ease           = 0.880164
humming_activation     = 0.7580635
activation_response_coefficient = 0.516127
```

`duration_ease` is calculated for trace consistency but is not used by the humming formula.

Activation-responsive evidence is:

```text
e_drowsiness = 2 × 0.80 - 1 = 0.60
e_fatigue    = 2 × 0.70 - 1 = 0.40
e_traffic    = congested     = 1.00
e_road       = highway       = 1.00
e_night      = night         = 1.00
e_monotony   = 2 × 0.90 - 1 = 0.80
```

### 19.3 Active weights

After Spotify-only applicability and the inattentive/recovery purpose multipliers, the raw active-weight sum is `0.7938`.

| Factor | Effective weight | Evidence `e` | Coefficient `a` | Response `r=e×a` | Contribution |
|---|---:|---:|---:|---:|---:|
| Drowsiness | 0.200066 | 0.600000 | 0.516127 | 0.309676 | 0.061956 |
| Fatigue | 0.163690 | 0.400000 | 0.516127 | 0.206451 | 0.033794 |
| Traffic | 0.043651 | 1.000000 | 0.516127 | 0.516127 | 0.022529 |
| Road | 0.043651 | 1.000000 | 0.516127 | 0.516127 | 0.022529 |
| Night | 0.058201 | 1.000000 | 0.516127 | 0.516127 | 0.030039 |
| Monotony | 0.145503 | 0.800000 | 0.516127 | 0.412902 | 0.060078 |
| Age/era | 0.010582 | 1.000000 | 0.500000 | 0.500000 | 0.005291 |
| Exact oshi artist | 0.063492 | 1.000000 | 1.000000 | 1.000000 | 0.063492 |
| Direct item usage | 0.039683 | 0.250000 | 1.000000 | 0.250000 | 0.009921 |
| Played | 0.018896 | -0.250000 | 1.000000 | -0.250000 | -0.004724 |
| Skipped | 0.026455 | 0.000000 | 1.000000 | 0.000000 | 0.000000 |
| Changed-from | 0.015117 | 0.000000 | 1.000000 | 0.000000 | 0.000000 |
| Cancelled plan | 0.015117 | 0.000000 | 1.000000 | 0.000000 | 0.000000 |
| Content acceptance | 0.042517 | 0.600000 | 1.000000 | 0.600000 | 0.025510 |
| Content recovery | 0.113379 | 0.400000 | 1.000000 | 0.400000 | 0.045351 |

Using full-precision values:

```text
item_fit = sum(contributions)
         = 0.37576713988095228
```

This is the score shown for the chosen song in the plan. Its main positive reasons are exact oshi match, sign agreement between the active song and the high drowsiness/fatigue/monotony evidence, and positive recovery evidence. Recent playback contributes a small repetition penalty.

---

## 20. Contrast behavior

World contrasts use the same frozen catalog, selected service, configuration, and seed while changing one declared input.

The comparison reports:

- changed input;
- eligibility changes;
- songs entering or leaving the five-item plan;
- position and `item_fit` changes; and
- contribution deltas.

Required V1 contrasts:

1. low versus high drowsiness, with calm/active song ordering reversed;
2. low versus high fatigue, with calm/active song ordering reversed;
3. normal versus congested traffic, with calm/active song ordering reversed;
4. highway versus mountain road, with active/calm song ordering reversed;
5. day versus night, with calm/active song ordering reversed;
6. low versus high monotony, with calm/active song ordering reversed;
7. child absent versus present with an explicit candidate;
8. exact oshi artist mode off versus on;
9. no prior play versus recent play;
10. low versus high direct item usage;
11. low versus high exact-item recovery;
12. driving versus stopped for full karaoke; and
13. route A versus route B with an expected no-rank-change result.

Audio fixture contrasts freeze the world and change only declared Spotify Audio Features. Useful pairs include high energy/low valence, medium energy/high danceability, speech-forward, and instrumental-leaning variants.

The route no-change case demonstrates transparent restraint: V1 does not manufacture a route-song relationship.

---

## 21. Parameters and hyperparameters

### 21.1 Structural parameters

- `plan_item_count`, default `5`;
- recipe registry;
- feature contract order;
- age/era affinity table version;
- exact oshi Artist-ID matching rule;
- history resolution precedence;
- eligibility policy IDs;
- fixed humming segment duration;
- duration policy; and
- presentation/lighting policy.

### 21.2 Numeric hyperparameters

- category, subgroup, and leaf weights;
- trigger-purpose multipliers;
- signed continuous-evidence transform;
- categorical signed-evidence profiles for traffic, road, and day/night;
- activation-to-response-coefficient transform;
- tempo normalization bounds;
- loudness normalization bounds;
- audio-activation coefficients;
- humming/full-karaoke ease coefficients;
- tempo-ease center and span;
- speech-ease thresholds;
- duration-ease bounds;
- usage and novelty mappings;
- playback, skip, changed-from, and cancellation windows/responses; and
- lighting lookup if enabled.

All configuration is frozen per run and included in evidence. Editing coefficients produces a new parameter-set version.

---

## 22. Implementation components

Recommended units:

1. `ContentInputValidator`
2. `SpotifyFixtureValidator`
3. `RecipeRegistry`
4. `EligibilityEvaluator`
5. `AudioFeatureDeriver`
6. `SignedEvidenceNormalizer`
7. `ActivationResponseProfileDeriver`
8. `ApplicabilityResolver`
9. `EffectiveWeightCalculator`
10. `DirectHistoryResolver`
11. `CompatibilityCalculator`
12. `ItemScoreCalculator`
13. `DeterministicPlanBuilder`
14. `DurationPolicy`
15. `PresentationPolicy`
16. `EvidenceBuilder`
17. `ContrastRunner`

The implementation should keep data validation, eligibility, derived audio, ranking, plan construction, and presentation independently testable.

---

## 23. Required tests

### 23.1 Mathematics

- normalization boundary tests;
- every coefficient family sums to `1`;
- derived values remain in `[0,1]`;
- signed evidence and response coefficients remain in `[-1,+1]`;
- `normalized_feature_response` equals evidence × response coefficient;
- responses remain in `[-1,+1]`;
- effective weights sum to `1` within tolerance;
- contributions sum to `item_fit`; and
- worked example reproduces `0.37576713988095228`.

### 23.2 Applicability

- route, destination, passenger, hobby, tag, and schedule leaves have mask `0`;
- item novelty is active only for playlist;
- exact oshi Artist ID is active only with registration and mode on;
- service-level context never changes candidate ordering; and
- masked purpose multipliers cannot create active weight.

### 23.3 Spotify formula fields

- every active formula reads only declared Audio Features;
- each service activation in `[0,1]` maps to coefficient `2A-1` in `[-1,+1]`;
- the same song may have different coefficients for playlist, humming, and full karaoke;
- key, mode, time signature, acousticness, and liveness do not affect V1 score;
- URL and identity fields do not affect score;
- valence affects audio activation at exactly `0.05` coefficient;
- duration affects full-karaoke ease but not playlist or humming activation; and
- instrumentalness affects proxies but never hard eligibility.

### 23.4 Eligibility

- playability, market, restriction, explicit/child, and recent-skip exclusions;
- humming flag `0` versus `1`;
- full-karaoke flag `0` versus `1`;
- full karaoke moving versus stopped;
- both generated defaults equal `1`; and
- flags do not alter score when eligibility remains true.

### 23.5 Preference and history

- age uses album release year only;
- exact oshi Artist ID match and non-match;
- no member/tag oshi inference;
- direct Track usage and novelty mappings;
- played, skip, changed-from, and cancelled windows;
- exact Track acceptance/recovery rates; and
- missing direct rate is neutral with no tag fallback.

### 23.6 Plan construction

- exactly five songs by default;
- customer-configured count;
- descending full-precision score order;
- Track-ID tie-break;
- unique Track IDs;
- insufficient eligible candidate error; and
- selected plan displays score for each song.

### 23.7 Duration and presentation

- playlist/full duration sums Track durations;
- humming duration uses configured fixed segments;
- no chorus timestamp is read;
- lighting does not change order; and
- presentation does not mutate evidence.

### 23.8 Determinism and contrast

- same inputs, versions, and seed produce byte-equivalent result;
- every selected score is reconstructable;
- each one-variable contrast changes only its declared field;
- low/high drowsiness reverses calm/active response ordering;
- normal/congested, highway/mountain, day/night, and low/high monotony produce their declared signed-profile reversals;
- expected rank/eligibility deltas occur; and
- route-only contrast causes no rank change.

---

## 24. Acceptance criteria

The algorithm is accepted when:

- it ranks concrete songs only after one detailed music service is active;
- the default result is one ordered five-song plan;
- every selected song shows its `item_fit` score;
- all song scoring uses only Spotify-compatible Track/Audio Features and exact-ID histories;
- no enriched, semantic, audience, chorus, lyric, or vocal-analysis metadata is required;
- the approved Spotify-derived formulas are implemented exactly;
- activation-responsive factors follow `normalized_evidence × activation-derived response_coefficient`, matching the service selector's candidate-response structure;
- low signed evidence favors calm songs and high signed evidence favors active songs;
- both karaoke flags default to `1`, affect eligibility only, and are customer-editable;
- explicit child policy and full-karaoke stopped policy are deterministic;
- unsupported baseline relations are visibly context-only with zero scoring mask;
- ranking uses the same transparent weight/contribution conventions as the service selector;
- exact oshi matching uses Spotify Artist IDs only;
- all selected scores and reasons are reconstructable from frozen evidence; and
- same frozen inputs and versions reproduce the same plan.

---

## 25. Deferred improvements

Not part of Spotify-only V1:

- licensed karaoke-catalog integration;
- lyrics and lyric timing;
- chorus/section boundaries;
- vocal range and melody analysis;
- composer, lyricist, arranger, and richer credit sources;
- child/group suitability metadata;
- route, destination, event, scene, theme, genre, and hobby relations;
- member/group/character/franchise oshi graph;
- provider-independent replacement for deprecated Audio Features;
- learned ranking or LLM ranking;
- confidence-weighted sparse history;
- diversity constraints and artist caps; and
- probabilistic acceptance or recovery prediction.

Each requires a separate source and provenance review before it can enter the algorithm.

---

## 26. Summary

The Spotify-only V1 transparent content selector:

1. receives one selected detailed music service;
2. validates Spotify-compatible Track and Audio Features data;
3. applies playability, policy, and simulator availability gates;
4. derives service activation from explicit Spotify fields;
5. converts activation into a signed song candidate-response coefficient;
6. multiplies signed feature evidence by that coefficient, matching the service-proposal response structure;
7. scores only operational baseline evidence and direct Track/Artist-ID history;
8. leaves unsupported semantic inputs neutral and visible;
9. orders candidates by a reconstructable signed score; and
10. returns five songs by default, each with its score and reasons.

This remains structurally coherent with the transparent service-proposal algorithm while being honest about what Spotify metadata can—and cannot—support.
