# AICA Synthetic Music Data and Generation Specification

**Document status:** Shared simulator data design and generation specification, approved in design discussion<br>
**Primary audience:** Product, simulation, data, algorithm, UX, and engineering reviewers<br>
**Scope:** Synthetic source metadata, enriched metadata, entity catalogs, LLM preprocessing, histories, contrast worlds, validation, and versioning<br>
**Date:** 2026-07-14

## Related documents

- [Consolidated proposal simulator specification](aica_proposal_simulator_specification.md)
- [Transparent content-proposal algorithm](aica_transparent_content_proposal_algorithm.md)
- [Transparent service-proposal algorithm](aica_transparent_service_proposal_algorithm.md)
- [Proposal simulator milestones](aica_proposal_simulator_milestones.md)
- [CDC-SU source transcription](../../others/CDC-SU_specplan.md)

---

## 1. Purpose

This document defines the shared synthetic music data used across the AICA proposal simulator.

It belongs to the simulator rather than to one content-selection algorithm because the same frozen data must support:

- transparent content selection;
- constrained LLM content selection;
- future catalog-enrichment comparisons;
- setup editing;
- deterministic replay;
- customer contrast experiments;
- future service recipes.

The document answers:

1. What provider-like source data exists?
2. What AICA-enriched metadata exists?
3. How are fictional artists, songs, credits, capabilities, and histories generated?
4. How is LLM-generated data constrained and validated?
5. How are complete worlds and one-variable contrasts built?
6. What is frozen and versioned for a simulation run?

This specification does not define item_fit, content weights, or recommendation ordering. Those belong to the selected content algorithm.

---

## 2. Core boundary

The catalog has two metadata categories:

1. source_metadata;
2. enriched_metadata.

Their names describe their production role, not which tool created them.

In the simulator, both categories may be authored by an LLM. In production:

- source_metadata would normally be supplied by a music, karaoke, rights, or entity provider;
- enriched_metadata would normally be produced by audio analysis, deterministic joins, controlled LLMs, editorial review, or manual overrides.

The full flow is:

~~~text
generation specification
→ synthetic provider/entity generation
→ source_metadata validation
→ enrichment preprocessing
→ enriched_metadata validation and review
→ user/world/history generation
→ cross-reference and contrast validation
→ immutable catalog/world snapshot
→ proposal algorithms
~~~

Proposal algorithms never call the generator during a run.

---

## 3. Data namespaces

### 3.1 Source metadata

Source metadata preserves provider-like identity, credits, availability, and capability fields without changing their meaning.

Examples:

- stable provider item ID;
- title;
- credited artist text;
- artist/person IDs and roles;
- album and release information;
- genre names supplied by the source;
- language;
- duration;
- content rating;
- lyrics availability;
- market/playability;
- karaoke asset availability;
- guide-vocal and lyrics-screen capabilities.

### 3.2 Enriched metadata

Enriched metadata adds values created after source ingestion.

Examples:

- BPM and audio descriptors;
- normalized genre taxonomy;
- mood/theme tags;
- chorus boundaries;
- vocal range;
- lyric density;
- melody complexity;
- audience-policy tags;
- route/destination relations;
- oshi and event relations;
- enrichment explanations and evidence.

### 3.3 World and history data

User, context, schedule, and history are not catalog metadata. They live in a separate world snapshot and refer to catalog/entity IDs.

Examples:

- driver state;
- road/environment;
- UPro and oshi profile;
- item/tag usage;
- item/tag recency;
- playback and operation history;
- acceptance/recovery histories;
- destination and schedule.

---

## 4. Entity model

### 4.1 Why entities are explicit

Artist name alone is insufficient for:

- group versus member oshi relations;
- featured vocalist matching;
- character, voice actor, virtual artist, and franchise relations;
- composer/lyricist preferences;
- event participation;
- correct customer explanations.

All references use stable fictional IDs.

### 4.2 Artist

~~~yaml
artist_id: artist_aoi_horizon
display_name: Aoi Horizon
aliases: []
artist_type: group
member_person_ids:
  - person_aoi
  - person_ren
source_genres:
  - j_pop
  - electronic
oshi_entity_ids:
  - oshi_aoi_horizon
enabled: true
~~~

Allowed artist types:

- solo;
- group;
- band;
- virtual_artist;
- character_unit;
- instrumental_act;
- other.

### 4.3 Person/contributor

~~~yaml
person_id: person_aoi
display_name: Aoi
aliases: []
credited_roles:
  - vocalist
enabled: true
~~~

Supported credit roles include:

- primary_artist;
- vocalist;
- featured_artist;
- composer;
- lyricist;
- arranger;
- performer;
- producer;
- voice_actor;
- character_performer.

### 4.4 Album/release

~~~yaml
album_id: album_blue_horizon
album_name: Blue Horizon
primary_artist_ids:
  - artist_aoi_horizon
release_date: 2024-06-18
label_id: label_02
release_type: album
enabled: true
~~~

### 4.5 Oshi entity

~~~yaml
oshi_id: oshi_aoi
display_name: Aoi
oshi_type: artist_member
linked_entity_ids:
  - person_aoi
  - artist_aoi_horizon
tags:
  - summer
  - coastal
enabled: true
~~~

Oshi types include:

- artist;
- artist_member;
- group;
- character;
- voice_actor;
- franchise;
- creator;
- other.

### 4.6 Event

~~~yaml
event_id: event_summer_live_01
event_type: live_show
display_name: Blue Horizon Summer Live
participant_entity_ids:
  - artist_aoi_horizon
tags:
  - summer_live
  - seaside
timing_class: soon
enabled: true
~~~

---

## 5. Song source schema

Conceptual record:

~~~yaml
item_id: song_017
content_type: song

source_metadata:
  provider: synthetic_music_provider_v1
  provider_item_id: provider_song_017
  title: Coastal Signal

  release:
    album_id: album_blue_horizon
    album_name: Blue Horizon
    release_date: 2024-06-18
    label_id: label_02

  credits:
    credited_artist_text: Aoi Horizon feat. Miku Sora
    primary_artist_ids:
      - artist_aoi_horizon
    vocalist_ids:
      - person_aoi
      - person_miku
    featured_artist_ids:
      - artist_miku_sora
    composer_ids:
      - person_ren
    lyricist_ids:
      - person_hana
    arranger_ids:
      - person_kai

  language_tags:
    - ja
  genre_names:
    - pop
    - electronic
  duration_ms: 214000
  content_rating: clean
  has_lyrics: true
  playable: true
  enabled: true

  availability:
    markets:
      - JP
    playlist_available: true
    chorus_available: true
    full_karaoke_available: false
    guide_vocal_available: true
    lyrics_screen_available: true
    lighting_compatible: true
~~~

### 5.1 Source invariants

- item_id and provider_item_id are stable and unique in their namespace.
- Every referenced artist, person, album, label, and entity exists.
- duration_ms is positive.
- content_rating is clean, explicit, unrated, or unknown.
- Disabled items are never eligible.
- full_karaoke_available requires has_lyrics and lyrics_screen_available.
- Capability fields are provider/catalog facts, not recommendation scores.

At combined-snapshot publication, `chorus_available` additionally requires a
valid enriched chorus structure. Pass 1 preserves the provider-like capability
fact; Pass 2 supplies and validates its structural counterpart.

---

## 6. Enriched song schema

~~~yaml
enriched_metadata:
  acoustic:
    tempo_bpm: 160
    energy: 0.80
    valence: 0.70
    key: A
    mode: major

  structure:
    chorus_start_ms: 52000
    chorus_end_ms: 81000
    lyric_density_words_per_sec: 1.6

  karaoke_difficulty:
    vocal_low_midi: 58
    vocal_high_midi: 71
    melody_complexity: 0.30

  semantic:
    genre_tags:
      - j_pop
      - electronic_pop
    mood_tags:
      - uplifting
      - energetic
    theme_tags:
      - summer
      - travel

  audience:
    policy_tags:
      - family_safe
      - group_singalong
    child_interest_tags:
      - dance
      - animation_style

  relations:
    route_tags:
      - coastal
    destination_tags:
      - seaside
      - festival
    oshi_ids:
      - oshi_aoi
    event_ids:
      - event_summer_live_01
    event_tags:
      - summer_live
~~~

### 6.1 Natural units first

Store source-like values in their useful units:

- tempo as BPM;
- duration and boundaries as milliseconds;
- vocal limits as MIDI pitch;
- lyric density as words/second;
- source ratings as their source enums.

Recommendation algorithms normalize them through versioned formulas.

### 6.2 No opaque universal singability

The catalog must not supply an unexplained singability value as truth.

It supplies components:

- vocal range;
- melody complexity;
- lyric density;
- chorus length;
- karaoke asset/capability.

A content recipe may combine these with user familiarity to calculate a service-specific compatibility.

### 6.3 Audience fields

Audience policy distinguishes:

- hard policy eligibility;
- child interest;
- group participation.

content_rating plus approved policy tags controls eligibility. Child/group-interest tags may support item ordering.

LLM-generated policy-sensitive labels require approval before publication.

---

## 7. Field-level provenance

Every source and enriched field has provenance.

Conceptual record:

~~~yaml
field_path: enriched_metadata.semantic.theme_tags
value_origin: synthetic_fixture
method: llm
pipeline_id: synthetic_music_enrichment_v1
model_or_rule_version: model-and-prompt-version
input_hash: sha256
generated_at: 2026-07-14T00:00:00Z
review_status: approved
evidence_refs:
  - source_metadata.title
  - source_metadata.genre_names
explanation: Controlled taxonomy assignment from supplied fictional profile.
~~~

Allowed method values:

- provider;
- llm;
- audio_analysis;
- deterministic_rule;
- catalog_join;
- editorial;
- manual_override.

Allowed review states:

- unreviewed;
- approved;
- rejected.

LLM confidence is provenance. In baseline-only transparent selection it is not a ranking feature.

Unreviewed or rejected policy-sensitive values are unavailable to proposal algorithms.

---

## 8. Enrichment preprocessing families

### 8.1 Acoustic enrichment

Appropriate methods:

- audio signal analysis;
- provider descriptors;
- deterministic synthetic fixture generation.

Fields:

- BPM;
- energy;
- loudness or related descriptors;
- key/mode;
- other approved acoustic descriptors.

An LLM may author synthetic values under constraints, but production acoustic values should not be inferred from a title or artist name alone.

### 8.2 Structural enrichment

Fields:

- chorus boundaries;
- lyric density;
- vocal range;
- melody complexity.

Appropriate methods:

- karaoke provider;
- lyrics/audio structure analysis;
- constrained synthetic generation;
- editorial review.

### 8.3 Semantic enrichment

Fields:

- normalized genre;
- mood;
- theme;
- audience-interest tags.

The LLM receives a closed taxonomy and returns only allowed identifiers.

### 8.4 Relation enrichment

Fields:

- route/destination relations;
- oshi relations;
- event relations;
- group/member/character relationships.

Prefer deterministic catalog joins for exact entity relations. An LLM may propose a relation candidate but cannot create an unknown entity ID.

### 8.5 Policy enrichment

Fields:

- family-safe;
- child-interest;
- group-singalong;
- presentation warnings.

Provider content rating is preserved. Policy enrichment requires deterministic validation and review.

---

## 9. LLM synthetic-generation algorithm

### 9.1 Why generation is staged

A single prompt that creates source metadata, enriched metadata, and user histories together risks:

- circular data tailored to one recommendation result;
- broken entity references;
- implausible perfect correlations;
- unclear source/enrichment provenance;
- difficult comparison of enrichment versions.

Generation is therefore split into three passes.

### 9.2 Pass 1: source catalog and entity graph

Inputs:

- strict JSON schema;
- fictional-only naming requirement;
- entity counts;
- role/capability quotas;
- allowed enums;
- uniqueness constraints;
- catalog balance contract.

Outputs:

- artists;
- people/contributors;
- albums/releases;
- labels;
- oshi entities;
- events;
- song source_metadata.

The pass must not output enriched fields.

### 9.3 Source validation

Deterministic validation checks:

- schema;
- types and enums;
- ID uniqueness;
- all references;
- capability consistency;
- quotas;
- fictional identity rules;
- absence of enriched fields.

Invalid output is rejected or passed to a constrained repair request containing only validation errors and the invalid record set.

### 9.4 Pass 2: enrichment

Inputs:

- validated source snapshot;
- linked entity profiles;
- controlled taxonomies;
- enrichment schema;
- field methods and evidence requirements;
- balance/counterexample requirements.

Outputs:

- acoustic fixture values;
- structural values;
- semantic tags;
- audience tags;
- route/destination relations;
- oshi/event relations;
- field-level provenance.

The enrichment pass cannot:

- add or rename source identities;
- change credits;
- change provider availability;
- invent an entity ID;
- mark rights/capability without source support;
- omit provenance.

### 9.5 Enrichment validation and review

Deterministic checks run first. Policy-sensitive and semantic outputs then receive review_status.

An optional LLM critic may identify semantic inconsistencies, but it cannot approve data by itself. Publication requires the configured approval workflow.

### 9.6 Pass 3: worlds and histories

Inputs:

- validated catalog/entity snapshots;
- complete baseline world schema;
- base-world definitions;
- one-variable contrast declarations;
- history distribution rules.

Outputs:

- complete UPro/oshi profiles;
- driver/environment/passenger contexts;
- item/tag usage and recency;
- operation histories;
- acceptance/recovery histories;
- schedules/destinations;
- contrast clones referencing valid IDs.

The world generator cannot create catalog items or entities.

### 9.7 Strict structured output

Every pass uses:

- versioned JSON Schema;
- constrained structured output where supported;
- no Markdown wrapper;
- finite lists bounded by the generation contract;
- explicit generation provenance.

---

## 10. Demonstration catalog contract

### 10.1 Size and balance

The main demonstration catalog contains 36 fictional songs:

~~~text
3 energy bands
× 3 tempo bands
× 4 semantic relation families
= 36 songs
~~~

Initial bands:

| Axis | Values |
|---|---|
| Energy | 0.20, 0.50, 0.80 |
| Tempo | 80, 120, 160 BPM |
| Relation family | general, family/group, route/destination, oshi/event |

This intentionally includes unusual but valid combinations such as high energy with slow tempo and low energy with fast tempo. Energy and tempo therefore do not become hidden proxies for each other.

### 10.2 Identity and credit quotas

- 12 fictional credited artists;
- three songs per primary artist;
- six solo vocalists;
- three groups with explicit members;
- two virtual/character units;
- one instrumental act;
- separate fictional composers, lyricists, and arrangers;
- several featured collaborations;
- group, member, character, and voice-actor oshi relationships;
- consistent event participation.

### 10.3 Genre and era

- Six normalized genre families;
- three release-era bands;
- each genre appears across energy and tempo bands;
- each era appears across multiple genres and relation families.

### 10.4 Capabilities

- all 36 are ordinary-playlist capable;
- 24 are chorus capable;
- 24 are full-karaoke capable;
- 12 support both karaoke modes;
- at least five normally eligible items remain for each implemented recipe after standard policy filtering.

### 10.5 Audience

- six explicit/adult-only items outside the family relation family;
- family-safe items at multiple energy/tempo levels;
- child-interest and group-singalong tags are independently varied;
- policy eligibility and preference appeal are separate.

### 10.6 Semantic relations

- route/destination relations across multiple genres and activation bands;
- oshi/event relations across multiple genres and activation bands;
- unrelated controls within every energy/tempo band.

### 10.7 Duration

Songs include short, medium, and long durations. Duration is not perfectly correlated with genre, energy, tempo, artist, or karaoke availability.

---

## 11. Deliberate trade-offs

The catalog must contain records where evidence conflicts:

| Archetype | Supporting evidence | Opposing evidence |
|---|---|---|
| Familiar favorite | High usage and acceptance | Recently played |
| Oshi anthem | Exact oshi/event relation | Low recovery history |
| New energizing song | High energy and playlist novelty | No preference history |
| Family song | Strong child/group relation | Low personal genre affinity |
| Easy humming song | Short chorus and low difficulty | Low activation |
| Challenging favorite | Strong preference | Wide vocal range/high complexity |
| Route-theme song | Exact destination relation | Recent skip |

No catalog item may be intentionally configured to dominate every dimension.

---

## 12. Dataset tiers

| Dataset | Purpose | Size |
|---|---|---:|
| Focused fixtures | Unit tests for one formula, rule, or filter | 8–12 items per fixture |
| Demonstration catalog | Customer-facing worlds and contrasts | 36 songs |
| Stress catalog | Performance and deterministic-stability tests | At least 500 generated items |

Focused fixtures may deliberately omit unrelated diversity but must state their test purpose.

The stress catalog is generated offline, validated, frozen, and versioned. Runtime generation is prohibited.

---

## 13. Synthetic world schema

Catalog metadata and world evidence remain separate.

Conceptual content-related world:

~~~yaml
world_id: world_night_highway_v1

driver:
  drowsiness_level: 80
  fatigue_level: 70

environment:
  traffic_state: congested
  road_type: highway
  night_state: night
  monotony_level: 90
  motion_state: driving

route:
  route_tags:
    - coastal
  destination_tags:
    - seaside

passengers:
  child_present: false
  multiple_passengers: false

upro:
  age_band: adult_30s
  gender: unknown
  hobby_interest_tags:
    - electronic_pop
    - travel
  oshi_registered: true
  oshi_mode: on
  oshi_id: oshi_aoi
  oshi_type: artist_member
  oshi_tags:
    - summer
    - coastal

service_context:
  service_recency_state: {}
  service_usage_level: {}
  scene_service_usage_level: {}
  service_proposal_acceptance_rate: {}
  service_recovery_rate: {}

content_preferences:
  catalog_item_recency_state: {}
  content_tag_recency_state: {}
  catalog_item_usage_level: {}
  content_tag_usage_level: {}
  scene_content_tag_usage_level: {}

operation_history:
  played_items: []
  skipped_items: []
  changed_from_items: []
  cancelled_content_plans: []

content_history:
  content_proposal_acceptance_rate: {}
  content_recovery_rate: {}

schedule:
  scheduled_event_type: live_show
  scheduled_event_timing: soon
  scheduled_event_tags:
    - summer_live
~~~

Every demonstration world supplies every scalar and map entry needed by the enabled baseline contract. Missing-data tests are separate focused fixtures.

---

## 14. Base worlds

### 14.1 Ordinary daytime commute

- Low drowsiness/fatigue/monotony;
- normal local road;
- no special destination/event;
- no child;
- ordinary familiar genre and item histories.

Purpose: show preference/history behavior without strong situation evidence.

### 14.2 Monotonous night highway

- High drowsiness and fatigue;
- night highway;
- congestion and high monotony;
- driving motion.

Purpose: show high-activation ordering for playlist/humming.

### 14.3 Characteristic coastal destination

- Ordinary driver state;
- coastal route and seaside/festival destination;
- matching and unrelated content.

Purpose: isolate route/destination contributions.

### 14.4 Family group journey

- Child present;
- multiple passengers;
- family/group and adult-only catalog alternatives.

Purpose: show audience eligibility and passenger compatibility.

### 14.5 Upcoming oshi event

- Oshi registered and mode on;
- linked event soon;
- exact, related, and unrelated songs.

Purpose: show entity and schedule relations.

### 14.6 Post-rest stopped karaoke

- Stopped motion;
- full-karaoke service selected;
- several vocal difficulty, preference, and recovery trade-offs.

Purpose: show full-karaoke capability and item scoring.

---

## 15. One-variable contrasts

| Contrast | Only changed input | Expected evidence surface |
|---|---|---|
| Low/high drowsiness | drowsiness_level | Activation contribution |
| Day/night | night_state | Environment contribution |
| Ordinary/monotonous | monotony_level | Activation contribution |
| Child absent/present | child_present | Eligibility and child response |
| Ordinary/special destination | destination_tags | Destination relation |
| Oshi off/on | oshi_mode | Oshi response |
| No event/upcoming event | schedule fields | Event response |
| No skip/recent skip | skipped_items | Eligibility or skip response |
| Low/high usage | one item/tag usage value | Preference response |
| Low/high recovery | one item/tag recovery value | Recovery response |
| Driving/stopped | motion_state | Recipe/presentation eligibility |

Contrast validation asserts that cloned worlds differ only in their declared fields and identity/version fields.

---

## 16. Metadata preprocessing comparisons

A metadata comparison is different from a world contrast.

It uses:

- the same world;
- the same source_metadata snapshot;
- the same proposal algorithm/configuration;
- two frozen enriched_metadata snapshots.

Examples:

- energy descriptor changed by enrichment pipeline version;
- new route relation approved;
- chorus boundary corrected;
- child policy tag rejected during review.

The simulator labels the result as a preprocessing comparison so the customer does not confuse it with a context change.

---

## 17. Deterministic validation

### 17.1 Schema and type

- All required objects and fields exist.
- Values match types and enums.
- Numeric values are finite and in range.
- No unknown property is accepted where the schema is closed.

### 17.2 References

- Every entity ID resolves.
- Every history item/tag resolves.
- Every album/credit/event/oshi relation resolves.
- Deleted or disabled entities are not referenced by enabled records.

### 17.3 Time and structure

- Chorus start is non-negative.
- Chorus end is greater than start.
- Chorus end is not greater than duration.
- Schedule timing and event state are consistent.
- History timestamps are valid relative to the world reference time.

### 17.4 Karaoke and presentation

- Chorus capability has valid chorus structure.
- Full karaoke has lyrics and required asset capability.
- Guide vocal is not enabled where unavailable.
- Instrumental items are not full lyric karaoke unless an explicit special asset says so.

### 17.5 Audience

- Explicit/adult-only cannot also be approved family_safe.
- Child-interest tags cannot bypass content-rating policy.
- Unreviewed/rejected policy fields are not publishable.

### 17.6 Balance and coverage

- Catalog counts match the generation contract.
- Controlled axes meet their quotas.
- Capabilities remain sufficient for normal complete plans.
- Relation families span energy/tempo/genre.
- No intended one-variable contrast changes additional world fields.

### 17.7 Recommendation independence

Data validation must not call the transparent or LLM content selector to label a dataset good.

It checks structural and declared coverage properties, not whether a particular recommendation wins.

---

## 18. Repair policy

Repair is explicit and bounded.

1. Validator produces machine-readable errors.
2. Repair request receives only invalid records, relevant schema, and errors.
3. Repair may change only fields named by the error dependency set.
4. Re-run the complete validation suite.
5. Preserve pre-repair and post-repair hashes.
6. Reject after the configured maximum repair attempts.

Manual overrides record:

- previous value;
- new value;
- reason;
- reviewer;
- timestamp;
- parent snapshot.

No silent auto-correction is allowed.

---

## 19. Versioning and reproducibility

### 19.1 Generation provenance

~~~yaml
generator_id: synthetic_music_generator_v1
source_schema_version: synthetic_source_schema_v1
enrichment_schema_version: synthetic_enrichment_schema_v1
world_schema_version: proposal_world_schema_v1
source_prompt_version: source_prompt_v1
enrichment_prompt_version: enrichment_prompt_v1
world_prompt_version: world_prompt_v1
model_id: string
generation_parameters: {}
source_output_hash: sha256
enrichment_output_hash: sha256
world_output_hash: sha256
validation_report_hash: sha256
approved_dataset_version: synthetic_music_catalog_v1
~~~

### 19.2 Frozen output is the replay boundary

An LLM seed does not guarantee exact regeneration. Reproducibility comes from preserving the generated and validated artifacts.

A simulation run records:

- source snapshot ID/hash;
- enriched snapshot ID/hash;
- entity/event snapshot IDs;
- world snapshot ID/hash;
- generator and validation provenance.

Regeneration creates a new dataset version. It never mutates a prior run's snapshot.

---

## 20. Customer editing

The simulator shows source and enriched metadata separately.

Recommended editing behavior:

- Source fields are grouped as provider/catalog facts.
- Enriched fields are grouped by acoustic, structural, semantic, audience, and relations.
- Provenance and review state appear beside enriched fields.
- Edits create a derived snapshot.
- Revalidation is mandatory.
- Comparison shows exactly which metadata fields changed.

Customer edits do not overwrite the original generated dataset.

---

## 21. Extension to future services

The shared base entity and catalog model supports future recipe-specific item schemas.

Possible extensions:

- quiz sets and questions;
- ranking topics/templates;
- radio episode outlines;
- live/stopped videos;
- stretch routines;
- call-and-response practice tracks;
- oshi reexperience episodes and destinations.

Each extension:

- reuses stable entity/provenance/version contracts;
- defines a service-specific source/enriched schema;
- defines its own generation quotas and validators;
- does not change the music schema implicitly.

The transparent content algorithm's recipe registry consumes these schemas when implementations are added.

---

## 22. Error categories

| Error | Meaning |
|---|---|
| generation_schema_error | LLM output violates structured schema |
| unresolved_reference | ID does not resolve |
| invalid_capability | Source capabilities contradict required fields |
| invalid_enrichment | Enriched field invalid or inconsistent |
| unapproved_policy_metadata | Policy-sensitive value is not approved |
| balance_contract_failure | Required coverage/quota missing |
| contrast_integrity_failure | Contrast changes undeclared fields |
| repair_exhausted | Bounded repair attempts failed |
| snapshot_hash_mismatch | Persisted artifact differs from recorded hash |

Errors block publication of the affected snapshot.

---

## 23. Required tests

### 23.1 Source schema

- Unique song/provider/entity IDs.
- Complete role/credit references.
- Valid albums/releases.
- Valid content ratings and durations.
- Valid provider/capability enums.
- No enriched fields in source-only generation output.

### 23.2 Enrichment schema

- Valid acoustic ranges.
- Valid chorus/duration relationships.
- Valid vocal ranges and density.
- Controlled taxonomy only.
- Existing IDs only for relations.
- Complete provenance.
- Policy review gates enforced.

### 23.3 Generation contract

- Exactly 36 demonstration songs.
- Energy, tempo, relation-family quotas.
- Artist and credit quotas.
- Genre/era distribution.
- Karaoke capability counts.
- Audience-policy distribution.
- Deliberate trade-off coverage.

### 23.4 Worlds and histories

- Every demonstration world is complete.
- Every history reference resolves.
- Rate and usage ranges are valid.
- Oshi/event relations resolve.
- Contrast clones change only declared fields.

### 23.5 Snapshot behavior

- Same artifact hashes consistently.
- Frozen snapshots are immutable.
- Derived edits preserve parent links.
- Old runs continue to resolve their exact snapshots.
- Proposal evaluation performs no generation call.

### 23.6 Repair

- Repair receives only permitted fields.
- Pre/post hashes are retained.
- Invalid repair is rejected.
- Attempt limit is enforced.

---

## 24. Acceptance criteria

The design is satisfied when:

1. Source and enriched metadata are separate namespaces.
2. Both may be LLM-generated in the simulator without losing their production-role distinction.
3. Artist, singer, contributor, group/member, oshi, and event identities are explicit and stable.
4. Source metadata preserves provider-like facts and capabilities.
5. Enriched metadata has method, version, evidence, and review provenance.
6. No opaque universal singability value is required.
7. Generation uses staged source, enrichment, and world/history passes.
8. Deterministic validators—not the LLM—decide structural validity.
9. The 36-song catalog satisfies its balance and capability contract.
10. Complete worlds and one-variable contrasts reference only existing data.
11. Frozen output artifacts, not LLM seeds, provide reproducibility.
12. Proposal algorithms never invoke generation during evaluation.
13. Metadata preprocessing comparisons are distinguishable from world contrasts.
14. Future service schemas can extend the shared entity/provenance model.

---

## 25. Deferred production concerns

- Real provider selection and contracts;
- media/lyrics rights;
- production audio-analysis pipeline;
- privacy and retention for user histories;
- empirical distribution calibration;
- bias/fairness review of personalization taxonomies;
- production human-review workflow;
- multilingual semantic enrichment evaluation;
- catalog import and synchronization;
- model monitoring for enrichment drift.

These concerns are not represented as solved by synthetic generation.

---

## 26. Summary

~~~text
LLM-generated fictional provider/entity records
→ validated source_metadata
→ separately generated/derived enrichment
→ validated and reviewed enriched_metadata
→ separately generated complete worlds and histories
→ cross-reference, balance, and contrast validation
→ immutable versioned snapshots
→ independent proposal algorithms
~~~

The synthetic data is designed to be plausible, coherent, balanced, inspectable, and reproducible. LLM generation supplies breadth and semantic consistency; schemas, quotas, validators, review, and frozen artifacts supply trustworthiness for simulation.
