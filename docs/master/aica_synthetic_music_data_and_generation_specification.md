# AICA Synthetic Spotify-Compatible Music Data and Generation Specification

Status: approved V1 design
Scope: shared simulator catalog data, generation, validation, editing, and replay
Last updated: 2026-07-15

## Related documents

- [AICA proposal simulator specification](./aica_proposal_simulator_specification.md)
- [AICA transparent content-proposal algorithm](./aica_transparent_content_proposal_algorithm.md)
- [AICA transparent service-proposal algorithm](./aica_transparent_service_proposal_algorithm.md)
- [Spotify Track reference](https://developer.spotify.com/documentation/web-api/reference/get-track)
- [Spotify Audio Features reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)

---

## 1. Purpose

This document defines the shared synthetic music dataset used by the AICA proposal simulator.

V1 has one deliberately narrow metadata contract:

1. a Spotify-compatible Track object;
2. a Spotify-compatible Audio Features object; and
3. two simulator-only karaoke availability flags.

It does not invent semantic, audience, route, destination, lyric, vocal-range, chorus, or musicological metadata. Those may become separately sourced extensions later, but they are not part of V1 and must not influence a V1 recommendation.

The contract supports three detailed music services:

- playlist;
- humming karaoke; and
- full karaoke.

Every generated V1 song is assumed to be available to both karaoke services. Availability is represented by explicit simulator flags defaulted to `1`; it is not presented as Spotify data.

The dataset is shared simulator infrastructure. It is not owned by the transparent content selector and may also be consumed by future selectors, screens, and experiments.

---

## 2. V1 boundary

### 2.1 Included song namespaces

Each song contains exactly these top-level namespaces:

```yaml
spotify_track: {}
spotify_audio_features: {}
simulation_flags:
  humming_karaoke_available: 1
  full_karaoke_available: 1
```

`spotify_track` and `spotify_audio_features` follow Spotify field names and value semantics. `simulation_flags` is an AICA simulator assumption and is kept visibly separate.

### 2.2 Excluded song metadata

V1 does not add any of the following:

- `enriched_metadata`;
- genre inferred by AICA or an LLM;
- route, destination, schedule, event, scene, mood, or audience tags;
- child appeal or group appeal;
- chorus start/end timestamps;
- lyric availability, lyric density, language difficulty, or profanity inferred from lyrics;
- vocal range, melody complexity, humming ease, or full-song singability as stored fields;
- composer, lyricist, arranger, featured-member, or detailed credit records not supplied by the selected Spotify objects;
- guide-vocal, microphone, display, or karaoke-asset capability claims; or
- LLM-generated descriptions presented as provider facts.

The content algorithm may calculate transparent numeric proxies from Spotify Audio Features at decision time. Derived values are formula outputs, not stored provider metadata.

The exclusion above is *AICA/LLM-inferred* genre. It is separate from Spotify's own artist-level `artist.genres` field (from the Artist object, `GET /artists`), which the content algorithm identifies as the sole real-provider path for its **genre-pending (`🔧`) features** — route, destination, child, hobbies, and per-genre usage (that document's §5.7). `artist.genres` is deliberately **not** in the V1 Track/Audio-Features contract; adding it is a separately specced, opt-in data-contract extension (§21, §25), not part of Spotify-only V1.

### 2.3 Separate world and history data

Driver state, road conditions, passengers, U-Pro settings, exact oshi artist identifiers, playback history, operations, acceptance, and recovery remain in the synthetic world fixture. They are not song metadata.

This separation prevents a synthetic song generator from pre-encoding the recommendation outcome.

---

## 3. Dataset envelope

A frozen dataset uses this envelope:

```yaml
dataset_manifest:
  dataset_id: synthetic-spotify-compatible-v1-seed-1042
  dataset_kind: synthetic_spotify_compatible
  schema_version: 1.0.0
  spotify_track_reference_version: pinned-2026-07-14
  spotify_audio_features_reference_version: pinned-2026-07-14
  generator_version: 1.0.0
  prompt_template_version: 1.0.0
  validation_rules_version: 1.0.0
  random_seed: 1042
  generated_at: 2026-07-14T00:00:00Z
  synthetic_only: true

songs: []
worlds: []
```

The manifest label is mandatory. A synthetic record must never be mistaken for a live Spotify response.

The Audio Features endpoint is marked deprecated in Spotify's current reference. V1 therefore uses a pinned schema fixture and does not assume that the endpoint will be available at simulator runtime.

---

## 4. Spotify Track schema

### 4.1 Stored object

The `spotify_track` namespace uses Spotify Track Object field names. The synthetic catalog stores the following V1 shape:

```yaml
spotify_track:
  album:
    album_type: album
    total_tracks: 10
    available_markets: [JP]
    external_urls:
      spotify: https://example.invalid/spotify/album/synthetic-album-0001
    href: https://example.invalid/spotify/v1/albums/synthetic-album-0001
    id: synthetic-album-0001
    images:
      - url: https://example.invalid/images/synthetic-album-0001-640.jpg
        height: 640
        width: 640
    name: Midnight Compass
    release_date: "2023-04-21"
    release_date_precision: day
    type: album
    uri: spotify:album:synthetic-album-0001
    artists:
      - external_urls:
          spotify: https://example.invalid/spotify/artist/synthetic-artist-0001
        href: https://example.invalid/spotify/v1/artists/synthetic-artist-0001
        id: synthetic-artist-0001
        name: Aoi Meridian
        type: artist
        uri: spotify:artist:synthetic-artist-0001
  artists:
    - external_urls:
        spotify: https://example.invalid/spotify/artist/synthetic-artist-0001
      href: https://example.invalid/spotify/v1/artists/synthetic-artist-0001
      id: synthetic-artist-0001
      name: Aoi Meridian
      type: artist
      uri: spotify:artist:synthetic-artist-0001
  available_markets: [JP]
  disc_number: 1
  duration_ms: 237040
  explicit: false
  external_ids:
    isrc: SYNTH0000001
  external_urls:
    spotify: https://example.invalid/spotify/track/synthetic-track-0001
  href: https://example.invalid/spotify/v1/tracks/synthetic-track-0001
  id: synthetic-track-0001
  is_local: false
  is_playable: true
  name: Afterglow Highway
  popularity: 56
  preview_url: null
  track_number: 3
  type: track
  uri: spotify:track:synthetic-track-0001
```

Fields that Spotify documents as nullable, such as `preview_url`, may be `null`. Conditionally returned properties such as `is_playable`, `linked_from`, and `restrictions` follow their documented presence rules; absent optional properties are omitted rather than filled with invented values. Standard simulator fixtures include `is_playable` because eligibility needs it.

The complete V1 Track field inventory is:

```text
album, artists, available_markets, disc_number, duration_ms, explicit,
external_ids, external_urls, href, id, is_local, is_playable, linked_from,
name, popularity, preview_url, restrictions, track_number, type, uri
```

Within `external_ids`, only identifiers actually represented by the fixture are present. V1 normally supplies a clearly synthetic `isrc`; it does not write null placeholders for absent `ean` or `upc` properties.

### 4.2 Identity and credits

The V1 display identity is:

```text
song title  = spotify_track.name
artists     = spotify_track.artists[*].name
album       = spotify_track.album.name
release     = spotify_track.album.release_date
```

Spotify's Track Object supplies performing artist references, not a guaranteed distinction between artist name and singer name. V1 therefore displays `artists` and does not invent separate `singer_name`, `composer`, `lyricist`, or `arranger` fields.

### 4.3 Track invariants

- `type` is `track`.
- `id` is unique within the dataset.
- every artist reference resolves consistently by `id` and `name`.
- `duration_ms` is a positive integer.
- `explicit`, `is_local`, and `is_playable` are Boolean.
- `popularity` is an integer from `0` through `100`.
- `disc_number` and `track_number` are positive integers.
- `release_date` matches its declared `release_date_precision`.
- `available_markets` contains valid market codes or is an empty list.
- a non-null restriction has a documented restriction reason.

---

## 5. Spotify Audio Features schema

### 5.1 Stored object

The `spotify_audio_features` namespace uses the exact Audio Features field names in the selected Spotify reference:

```yaml
spotify_audio_features:
  acousticness: 0.00242
  analysis_url: https://example.invalid/spotify/v1/audio-analysis/synthetic-track-0001
  danceability: 0.585
  duration_ms: 237040
  energy: 0.842
  id: synthetic-track-0001
  instrumentalness: 0.00686
  key: 9
  liveness: 0.0866
  loudness: -5.883
  mode: 0
  speechiness: 0.0556
  tempo: 118.211
  time_signature: 4
  track_href: https://example.invalid/spotify/v1/tracks/synthetic-track-0001
  type: audio_features
  uri: spotify:track:synthetic-track-0001
  valence: 0.428
```

### 5.2 Value contract

The scoring roles below match the content algorithm's **Trait Composition Matrix**
(that document's §4.2). The V1 selector distills each song into two signed audio
**traits** — **arousal** (how energetic) and **valence** (how bright) — plus two
karaoke **ease** proxies (`humming_ease`, `full_karaoke_ease`). "arousal proxy" and
"valence proxy" name the trait a field feeds; `(inv)` means the field is used
inverted.

| Field | Contract | V1 scoring role |
|---|---|---|
| `acousticness` | number in `[0,1]` | arousal proxy `(inv)` |
| `analysis_url` | synthetic reserved URL | identity/provenance only |
| `danceability` | number in `[0,1]` | arousal and karaoke-ease proxy |
| `duration_ms` | positive integer | full-karaoke-ease proxy and duration |
| `energy` | number in `[0,1]` | arousal proxy |
| `id` | exact Track ID match | identity/join |
| `instrumentalness` | number in `[0,1]` | karaoke-ease proxy `(inv)` (vocal presence) |
| `key` | integer `-1` or `0..11` | retained, not scored |
| `liveness` | number in `[0,1]` | retained, not scored |
| `loudness` | finite dB value | normalized arousal proxy |
| `mode` | integer `0` or `1` | valence proxy |
| `speechiness` | number in `[0,1]` | karaoke-ease proxy `(inv)` |
| `tempo` | positive BPM | arousal and karaoke-ease proxy |
| `time_signature` | integer `3..7` | retained, not scored |
| `track_href` | synthetic reserved URL | identity/provenance only |
| `type` | `audio_features` | schema discriminator |
| `uri` | exact Track URI match | identity/join |
| `valence` | number in `[0,1]` | valence proxy and presentation |

The dataset preserves `key`, `time_signature`, and `liveness` even though the V1
selector never scores them (they are the content algorithm's §4.3 non-scored list).
Storage does not imply scoring. Conversely, `valence`, `mode`, and `acousticness`
**are** scored in V1 — earlier drafts listed them as retained-not-scored, but the
two-axis trait model uses `valence`/`mode` for the valence axis and `acousticness`
(inverted) for the arousal axis.

### 5.3 Audio-feature invariants

- all `[0,1]` fields are finite and in range;
- `key` is `-1` when undetected or an integer from `0` through `11`;
- `mode` is `0` or `1`;
- `tempo` is finite and greater than `0`;
- `loudness` is finite; synthetic generation targets the realistic reference interval `[-60,0]` dB;
- `time_signature` is an integer from `3` through `7`;
- Audio Features `id`, `uri`, and `duration_ms` equal their Track counterparts; and
- `type` is `audio_features`.

The narrower loudness and time-signature intervals are synthetic-generation targets, not claims that every provider record must be inside them.

---

## 6. Simulator availability flags

Each song has:

```yaml
simulation_flags:
  humming_karaoke_available: 1
  full_karaoke_available: 1
```

Rules:

- both fields accept only integer `0` or `1`;
- both default to `1` for every generated song;
- `1` means the simulator permits the song in that detailed service;
- the flags are eligibility gates only and never increase an item score;
- a customer may change either default in simulator settings or edit an individual fixture; and
- the flags do not claim that Spotify supplies karaoke rights, lyrics, timing, guide vocals, or any karaoke asset.

An instrumental-leaning song may still have both flags set to `1`. `instrumentalness` influences transparent ease proxies but does not override the approved simulator availability assumption.

---

## 7. Field provenance

### 7.1 Synthetic fixture provenance

Synthetic provenance is stored once in `dataset_manifest`:

```yaml
dataset_manifest:
  dataset_kind: synthetic_spotify_compatible
  synthetic_only: true
  generator_pass: track_and_audio_features
  generator_version: 1.0.0
  prompt_template_version: 1.0.0
  random_seed: 1042
  validator_version: 1.0.0
  reviewed: true
```

It is not added as another song-metadata namespace. Every song in that frozen dataset inherits the manifest provenance.

Synthetic identifiers must contain a visible `synthetic-` marker. Synthetic web links must use the reserved `.invalid` domain. They must not imitate a working Spotify API endpoint or resolve to a real track.

### 7.2 Real provider data

If a later environment imports real Spotify payloads:

- the payload is stored as provider data;
- it is not sent to an LLM for enrichment, rewriting, embedding, training, or ingestion;
- licensing, policy, retention, and attribution are handled by that environment; and
- missing karaoke flags are added only in the separate simulator namespace.

Spotify's current documentation warns that Spotify content may not be used to train or otherwise ingest into an AI model. The simulator's LLM generator therefore receives only the public schema, documented value meanings, and fictional generation controls—not real Spotify content.

---

## 8. No V1 metadata-enrichment preprocessing

V1 has no song-enrichment stage.

The following flow is prohibited:

```text
provider track
  -> LLM guesses chorus, audience, route, oshi, or singing traits
  -> guessed fields treated as recommendation evidence
```

The permitted flow is:

```text
fictional generation controls
  -> synthetic Spotify-compatible Track object
  -> synthetic Spotify-compatible Audio Features object
  -> deterministic validation
  -> frozen dataset
```

At recommendation time, the transparent selector derives documented proxies from the stored Audio Features. It does not persist those proxies as provider facts.

Future enrichment is an extension boundary. Any future source must have its own namespace, provenance, availability policy, applicability review, and customer approval before it can affect scoring.

---

## 9. LLM synthetic-generation algorithm

### 9.1 Inputs

The LLM receives only:

- the V1 JSON Schema;
- Spotify-documented field definitions and ranges;
- the catalog coverage matrix in Section 10;
- fictional naming and locale instructions;
- fixed entity IDs allocated before generation;
- the random seed and generation pass ID; and
- explicit instructions that all people, artists, albums, tracks, IDs, and URLs are fictional.

It does not receive live Spotify payloads or recommendation results.

### 9.2 Pass 1: fictional Track objects

The generator creates the artist, album, and track identities first.

Requirements:

1. allocate stable synthetic artist, album, and track IDs;
2. create fictional names and release data;
3. use the same artist reference in album and track objects;
4. create Track fields with exact V1 names and types;
5. set playable synthetic records to `is_playable: true` unless the fixture intentionally tests exclusion;
6. set `is_local: false` for the standard catalog; and
7. use `.invalid` URLs and clearly synthetic IDs.

The output is parsed as structured data. Free-form prose is rejected.

### 9.3 Pass 2: Audio Features objects

For every Track, the generator creates one Audio Features object.

Generation is conditioned on an assigned audio-profile cell, not on a desired recommendation rank. Numeric fields should be mutually plausible without claiming scientific accuracy. Examples:

- high-energy cells should usually combine higher `energy` with stronger `loudness` and/or tempo;
- speech-forward cells should raise `speechiness`;
- instrumental-leaning cells should raise `instrumentalness`;
- danceable-vocal cells should raise `danceability` while retaining low instrumentalness; and
- the catalog must include exceptions so that no single field determines the outcome.

The generator must copy Track `id`, `uri`, and `duration_ms` exactly.

### 9.4 Pass 3: worlds and histories

After the catalog is frozen, a separate pass creates synthetic world and history fixtures. It references existing Track and Artist IDs but may not modify their metadata.

World generation includes:

- driver and environment states;
- passenger conditions;
- exact oshi artist references where relevant;
- direct item playback and operation histories;
- direct item acceptance and recovery evidence; and
- service lifecycle state.

Unsupported semantic inputs may be present as world context for UI demonstration, but they are marked `context_only` and must not affect Spotify-only V1 ranking.

### 9.5 Deterministic validator and repair loop

Each pass is followed by deterministic validation. On failure, the LLM receives only:

- the invalid record;
- machine-readable validation errors; and
- the original schema and cell assignment.

The repair prompt may change only invalid fields and directly dependent references. After two failed repairs, generation stops with `catalog_generation_failed`.

---

## 10. Demonstration catalog contract

### 10.1 Size and ordering

The default demonstration catalog contains 36 songs. The customer-visible recommendation plan still contains exactly five ordered songs by default; plan size is a selector setting, not a catalog property.

Catalog generation crosses:

- 3 energy bands: low, medium, high;
- 3 tempo bands: low, medium, high; and
- 4 audio-profile families: balanced vocal, danceable vocal, speech forward, and instrumental leaning.

This gives `3 × 3 × 4 = 36` primary coverage cells.

### 10.2 Coverage bands

Default generation bands are:

| Dimension | Low | Medium | High |
|---|---:|---:|---:|
| `energy` | `0.10..0.35` | `0.40..0.65` | `0.70..0.95` |
| `tempo` BPM | `60..95` | `96..130` | `131..180` |

Profile-family guidance is:

| Family | Primary constraints |
|---|---|
| balanced vocal | `instrumentalness <= 0.20`, moderate danceability and speechiness |
| danceable vocal | `instrumentalness <= 0.15`, `danceability >= 0.65` |
| speech forward | `speechiness >= 0.40`, low-to-medium instrumentalness |
| instrumental leaning | `instrumentalness >= 0.65` |

These are generation controls, not stored labels used by the recommendation algorithm.

Because the two-axis trait model scores **valence** (`valence`, `mode`) and the
**inverse-arousal** contribution of `acousticness`, the primary energy × tempo grid
is not enough on its own. Across the 36 cells, generation must also spread these
secondary dimensions so the catalog exercises both axes, not only energy/tempo:

- `valence` spans low, mid, and high, decorrelated from `energy` (so bright-calm and
  dark-energetic songs both exist);
- `mode` includes both minor (`0`) and major (`1`) at comparable valence, so the
  major/minor valence cue is testable in isolation; and
- `acousticness` spans acoustic-leaning and electric-leaning at comparable energy and
  tempo, so its inverse-arousal effect is observable independently.

### 10.3 Identity and releases

The default catalog has:

- 12 fictional Spotify artist identities;
- three tracks per primary artist;
- at least 12 fictional albums;
- releases covering at least three eras for age-affinity tests; and
- stable artist and track IDs for exact oshi and history fixtures.

No singer-versus-artist distinction or detailed contributor graph is generated.

### 10.4 Availability and audience policy

- all 36 standard songs have both karaoke availability flags equal to `1`;
- at least six songs have `explicit: true` to test child-present exclusion;
- at least four special negative fixtures have `is_playable: false` or a restriction and live outside the standard 36-song eligible catalog; and
- every standard Audio Features object is complete and valid.

### 10.5 Duration and signatures

- Track durations cover short, medium, and long songs;
- Track and Audio Features duration always agree;
- time signatures include common `3`, `4`, and at least one other value; and
- key includes at least one undetected `-1` fixture.

---

## 11. Deliberate trade-off fixtures

The catalog must contain candidate pairs that expose actual Spotify-only trade-offs
across **both** trait axes — arousal (energetic↔calm) and valence (bright↔dark) — not
only energy/tempo:

- clearly calm (low-arousal) versus clearly active (high-arousal) songs for
  arousal-response reversal tests in every detailed service;
- **bright versus dark at matched arousal** — high `valence` + major `mode` versus low
  `valence` + minor `mode` — so the valence axis reorders when a context demands
  brightness (fatigue, congestion, night);
- high energy with low valence versus moderate energy with high valence, so arousal
  and valence pull in opposite directions;
- **acoustic-leaning versus electric-leaning at matched energy and tempo** (high vs
  low `acousticness`), isolating acousticness's inverse-arousal contribution;
- minor-mode versus major-mode at otherwise matched features, isolating the `mode`
  valence cue;
- fast tempo with low danceability versus medium tempo with high danceability;
- strong arousal with high speechiness versus slightly lower arousal with an easy
  speech profile (karaoke-ease trade-off);
- a short moderate-energy song versus a long high-energy song for full karaoke;
- exact oshi-artist match versus non-oshi higher arousal;
- recently played exact track versus fresh track;
- accepted low-arousal track versus untested high-arousal track;
- instrumental-leaning track whose availability flags are still `1`; and
- explicit high-fit track excluded when a child is present.

The dataset must not contain a hidden `recommended`, `best_for_world`, or target-rank field.

It also does not store `normalized_evidence`, `response_coefficient`, or `normalized_feature_response` as song metadata. The content algorithm derives evidence from the world (a magnitude for driver/environment features, signed for exact-ID history) and the song response coefficient from the song's two audio traits (arousal, valence) and exact-ID metadata at decision time.

---

## 12. Dataset tiers

The simulator supports three tiers:

| Tier | Purpose | Required content |
|---|---|---|
| smoke | schema and pipeline checks | 5 valid songs plus negative fixtures |
| demonstration | stakeholder review | 36 balanced songs and approved worlds |
| stress | performance and determinism | configurable catalog size with the same distributions |

Every tier uses the same schema and validation rules.

---

## 13. Synthetic world and history schema

World data remains separate from songs:

```yaml
world:
  world_id: world-night-highway-01
  current_time: 2026-07-14T22:10:00Z
  trigger:
    trigger_purpose: inattentive_driving_prevention_recovery
    lifecycle_stage: active_driving_content

  driver:
    age_band: 30s
    drowsiness_level: 80
    fatigue_level: 70

  environment:
    traffic_state: congested
    road_type: highway
    night_state: night
    monotony_level: 90
    motion_state: driving
    route_tags: [highway]
    destination_tags: [coast]

  passengers:
    child_present: false
    multiple_passengers: false

  upro:
    oshi_registered: true
    oshi_mode: on
    oshi_id: synthetic-artist-0001
    oshi_type: artist
    oshi_tags: []

  direct_item_history:
    synthetic-track-0001:
      last_played_at: 2026-07-13T21:00:00Z
      play_count_30d: 3
      skipped_count_30d: 0
      changed_count_30d: 0
      cancelled_count_30d: 0
      acceptance_rate: 0.80
      recovery_rate: 0.70

  selected_service:
    selected_service_id: humming_karaoke
    lifecycle_state: active
```

`route_tags` and `destination_tags` may still be needed by other simulator packages. In Spotify-only V1 content ranking, they are context-only because songs have no matching fields.

History references exact synthetic Track IDs. Tag-level song histories are not generated for V1.

---

## 14. Base worlds

The demonstration tier includes at least these worlds:

1. ordinary daytime commute;
2. monotonous night highway with high drowsiness;
3. same state with low drowsiness;
4. otherwise-identical low/high fatigue pair;
5. otherwise-identical normal/congested traffic pair;
6. otherwise-identical highway/mountain-road pair;
7. otherwise-identical day/night pair;
8. otherwise-identical low/high monotony pair;
9. family journey with a child present;
10. exact oshi artist registered;
11. same world with oshi mode disabled;
12. recently played candidate;
13. previously accepted candidate;
14. previously skipped or cancelled candidate; and
15. stopped post-rest full-karaoke state.

A characteristic route/destination world may be retained to demonstrate the honest V1 limitation: changing route semantics alone does not change music rank because no Spotify song field supports that relation.

---

## 15. One-variable contrasts

Every contrast pair changes one controlled input while freezing the catalog, seed, trigger, and all other world fields.

Required pairs include:

- low versus high drowsiness, expecting calm/active response ordering to reverse;
- low versus high fatigue, expecting calm/active response ordering to reverse;
- normal versus congested traffic, expecting calm/active response ordering to reverse;
- highway versus mountain road, expecting active/calm response ordering to reverse;
- day versus night, expecting calm/active response ordering to reverse;
- low versus high monotony, expecting calm/active response ordering to reverse;
- moving versus stopped for full-karaoke eligibility;
- child absent versus present with an explicit candidate;
- exact oshi artist enabled versus disabled;
- recent play absent versus present;
- acceptance evidence absent versus strong; and
- route tag A versus route tag B, with an expected no-change assertion.

The final pair is a transparency test, not a recommendation-quality target.

---

## 16. Audio-feature fixture comparisons

To test preprocessing formulas without changing identity, the simulator may create versioned comparison fixtures for the same synthetic Track:

```text
same Track + Audio Features fixture A
same Track + Audio Features fixture B
same world + same algorithm version
```

Only explicitly listed Audio Features may differ. The expected trace must identify the derived **arousal**, **valence**, or karaoke-ease-proxy change responsible for any rank change.

For an arousal pair (calm/active), the fixture comparison asserts the signed response behavior: because evidence is a plain magnitude and direction lives in the feature's arousal demand `α`, a positive-`α` context (e.g. drowsiness, monotony) favors the higher-arousal song, a negative-`α` context (e.g. the soothe direction of fatigue) favors the lower-arousal song, and zero evidence makes the arousal contribution neutral. For a bright/dark pair (differing `valence`/`mode`), it asserts the valence behavior: because the valence demand `β` is one-sided, a stress context (fatigue, congestion, night) favors the brighter song and never rewards a darker one.

These are synthetic fixture variants. They are not live provider refreshes and are never silently swapped during a replay.

---

## 17. Deterministic validation

### 17.1 Schema and types

- exactly one Track object, one Audio Features object, and one flag object per song;
- no unknown top-level song namespace;
- required keys present;
- JSON types exact; and
- no `NaN`, infinity, or numeric string substitutions.

### 17.2 Cross-object identity

- Track ID equals Audio Features ID;
- Track URI equals Audio Features URI;
- Track duration equals Audio Features duration;
- artist references are internally consistent; and
- IDs are unique at the correct entity level.

### 17.3 URLs and synthetic identity

- every synthetic ID visibly begins with `synthetic-`;
- every HTTP(S) URL uses a `.invalid` host;
- no URL points to `api.spotify.com` or `open.spotify.com`; and
- no synthetic ISRC is represented as a real provider lookup result.

### 17.4 Spotify numeric fields

- all normalized fields in `[0,1]`;
- popularity in `0..100`;
- key in `{-1,0..11}`;
- mode in `{0,1}`;
- positive duration and tempo;
- finite loudness;
- time signature in `3..7`; and
- generation-cell constraints satisfied for the standard catalog.

### 17.5 Flags and policy

- flags are integers in `{0,1}`;
- all standard generated songs default to `1` for both flags;
- `explicit` is Boolean; and
- negative restriction fixtures are excluded from standard eligible counts.

### 17.6 Balance and recommendation independence

- all 36 coverage cells exist exactly once in the demonstration catalog;
- artist and era quotas pass;
- explicit and negative-fixture quotas pass;
- no recommendation score or target rank appears in generation input/output; and
- generation is completed before worlds are scored.

---

## 18. Repair policy

Repairs are deterministic where possible:

| Failure | Repair |
|---|---|
| decimal outside `[0,1]` by serialization noise | clamp only when within `1e-9`; otherwise regenerate |
| Track/Audio Features ID mismatch | copy the allocated canonical Track ID |
| duration mismatch | copy canonical Track duration |
| non-`.invalid` synthetic URL | rebuild from the canonical synthetic ID |
| missing default availability flag | set to `1` and record repair |
| duplicate ID | allocate a new ID and update dependent references |
| coverage quota failure | regenerate the failed coverage cell |
| malformed release date | regenerate the album release fields |

Every repair is recorded in the dataset build report. Silent manual edits are prohibited.

---

## 19. Versioning and reproducibility

Each simulation result records:

```yaml
dataset_id: synthetic-spotify-compatible-v1-seed-1042
dataset_hash: sha256:...
schema_version: 1.0.0
generator_version: 1.0.0
prompt_template_version: 1.0.0
validator_version: 1.0.0
random_seed: 1042
world_id: world-night-highway-01
world_hash: sha256:...
algorithm_version: transparent-content-v1.2-two-axis-trait
parameter_set_id: default-v1.2-two-axis-trait
```

The frozen, validated dataset—not an LLM rerun—is the replay boundary. Given the same dataset, world, algorithm version, parameters, and seed, the transparent result must be identical.

---

## 20. Customer editing

The settings UI exposes three clearly labeled groups:

1. Spotify-compatible Track fields;
2. Spotify-compatible Audio Features fields; and
3. simulator availability assumptions.

Customers may edit values only through schema-aware controls. Saving triggers full validation and produces a new dataset version and hash.

The default plan length is five songs. Customers may change plan length in selector settings; it is not stored per song.

Changing either karaoke flag to `0` removes that song from the corresponding service after re-evaluation. It does not change the song's score in other services.

---

## 21. Extension interface

Future metadata may be added only as a new, namespaced extension, for example:

```yaml
extensions:
  karaoke_provider_v1: {}
  licensed_lyrics_analysis_v1: {}
```

An extension must declare:

- authoritative source;
- field-level provenance;
- legal and policy basis;
- missing-data behavior;
- validation schema;
- applicable services and factors;
- scoring formulas and weights;
- explanation text; and
- fallback behavior when the extension is unavailable.

No extension may overwrite Spotify-compatible fields or `simulation_flags`.

---

## 22. Error categories

| Error | Meaning |
|---|---|
| `catalog_generation_failed` | structured generation or repair did not produce a valid catalog |
| `invalid_spotify_track_fixture` | Track object violates the pinned schema |
| `invalid_audio_features_fixture` | Audio Features object violates the pinned schema |
| `cross_object_identity_mismatch` | ID, URI, or duration does not agree |
| `invalid_simulation_flags` | a flag is absent or outside `{0,1}` after repair |
| `synthetic_identity_violation` | a synthetic record resembles or links to live provider data |
| `coverage_contract_failed` | demonstration quotas are incomplete |
| `world_reference_failed` | a world/history reference does not resolve |
| `policy_boundary_violation` | real Spotify content was sent to an LLM or treated as synthetic input |

---

## 23. Required tests

### 23.1 Track schema

- required Track fields and nested types;
- exact `track` discriminator;
- artist/album reference consistency;
- release date precision;
- popularity, duration, and index ranges; and
- conditional/null field behavior.

### 23.2 Audio Features schema

- all exact field names;
- normalized ranges;
- key, mode, tempo, loudness, and signature validation;
- exact `audio_features` discriminator; and
- Track ID, URI, and duration equality.

### 23.3 Simulation flags

- default both flags to `1`;
- accept explicit customer `0` or `1`;
- reject Boolean, string, negative, or greater-than-one values; and
- prove flags affect eligibility only.

### 23.4 Generation

- same seed and versions yield byte-identical frozen output;
- all names and identities are fictional;
- all URLs use `.invalid`;
- no real provider payload enters the LLM path;
- all 36 coverage cells are present; and
- generation inputs contain no target rank.

### 23.5 Worlds and contrasts

- every world reference resolves;
- direct history uses Track IDs;
- exact oshi uses Spotify-compatible Artist IDs;
- one-variable contrasts differ only in their declared field;
- low/high drowsiness and monotony reverse the arousal ordering of calm/active candidates;
- traffic, road, day/night, and fatigue contrasts follow their declared arousal/valence demand profiles (a bright-favoring context reorders the bright/dark pair);
- a bright/dark fixture pair exercises the valence axis (`valence`/`mode`) and an acoustic/electric pair exercises acousticness's inverse-arousal contribution; and
- route-only contrast produces no Spotify-only content-rank change.

### 23.6 Repair and replay

- each repair rule is deterministic and logged;
- repair exhaustion produces a typed error;
- edited data gets a new hash; and
- frozen replay is independent of LLM availability.

---

## 24. Acceptance criteria

This specification is satisfied when:

- every song contains only the two Spotify-compatible objects and the separate simulator flag object;
- all Spotify Audio Features fields listed in the selected reference are represented with exact names;
- Track title, performing artists, album, release, IDs, playback policy, and duration are provider-compatible fields;
- no AICA/LLM-enriched song traits participate in V1;
- all generated songs default both karaoke availability flags to `1`;
- synthetic records are unmistakably labeled and never use live Spotify links;
- the LLM receives schema and fictional controls, not real Spotify content;
- deterministic validators reject invalid or inconsistent objects;
- the 36-song catalog covers approved audio trade-offs across both trait axes;
- the catalog contains calm/active pairs for arousal-reversal tests **and** bright/dark (`valence`/`mode`) and acoustic/electric (`acousticness`) pairs for the valence and inverse-arousal contributions;
- worlds and histories remain separate from song metadata; and
- dataset, world, algorithm, and parameter versions are sufficient for exact replay.

---

## 25. Deferred production concerns

Before any production provider integration, separately resolve:

- Spotify endpoint availability and deprecation migration;
- current Spotify Developer Policy and platform terms;
- authorization, market, restriction, and relinking behavior;
- storage, caching, retention, display, and attribution requirements;
- whether Audio Features remain available to the intended application;
- karaoke catalog rights and asset availability;
- licensed lyrics and timing sources;
- contributor/credit sources beyond the Track Object;
- regional explicit-content policy; and
- audit and deletion obligations.

None of these are simulated as solved in V1.

---

## 26. Summary

V1 uses a simple, auditable song record:

```text
Spotify-compatible Track
+ Spotify-compatible Audio Features
+ two simulator karaoke availability flags, default 1
```

The LLM creates fictional Spotify-compatible fixtures from schema and coverage controls. Deterministic validation, explicit synthetic identity, frozen versions, and separate world/history data make the catalog reproducible and safe to use in the simulator.

The transparent content selector derives only documented proxies from these fields. It does not pretend Spotify supplies chorus, lyric, vocal, audience, route, destination, or semantic recommendation metadata.
