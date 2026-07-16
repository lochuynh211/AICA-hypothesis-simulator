# AICA Synthetic Spotify-Compatible Music Data and Generation Specification

Status: approved V1 design
Scope: shared simulator catalog data, generation, validation, editing, and replay
Last updated: 2026-07-16

## 0. Data source: Soundcharts-grounded generation

The catalog is produced by grounding it in real song data harvested from the
**Soundcharts API** (the customer has no Spotify access) and mapping that data into
the schema defined below. The full pipeline and rationale are in
`docs/master/p2-soundcharts-grounded-data-generation-design.md`.

What is real and what is synthetic:

- **Real, kept for reviewer trust:** song and artist **names**, all
  `spotify_audio_features` **values** (copied verbatim; `timeSignature` is renamed to
  `time_signature`), release data, and the **ISRC**.
- **Synthetic, always:** every ID (`synthetic-` prefix) and every URL (`.invalid`
  host), enforced by the validator (§17.3).
- **Manifest:** `dataset_kind: soundcharts_grounded_spotify_compatible`,
  `synthetic_only: false`, with a provenance/licensing note. A record is honestly
  labeled real-grounded and must never be mistaken for a *live* Spotify response.

Genre uses two representations: the real Soundcharts genre text `{root, sub[]}` (for
search, display, and lineage) and a deterministic **sub-first** `real → controlled-vocabulary`
map that feeds only the `genre_affinity_v1` scoring extension (§21.1); an unmapped genre
yields `genre_unmappable_to_vocabulary` and scores `missing_neutral`. The controlled
vocabulary is **unchanged** (the frozen 12 terms of §21.1); the map is sub-aware because
several vocab terms are Soundcharts *subs* under generic roots (full table in P2 design
§13).

**Candidate-acquisition strategies (selectable by a `candidate_source` flag).** Real
songs reach the harvester by one of two interchangeable front-halves; both terminate at
the same raw-response cache + lineage, and everything downstream (bin → select → map →
validate → freeze) is strategy-agnostic:

- `soundcharts_search` — the generator LLM plans Soundcharts searches and narrows
  candidates to conserve quota (the original approach; **unavailable on the current
  Soundcharts subscription**, retained as a fallback).
- `isrc_resolved` — a **web-search-grounded LLM names real songs** per coverage cell
  (existence-verified, never emitting an ISRC or audio number); a deterministic resolver
  turns each `(title, artist, year)` into an **ordered candidate-ISRC list via
  MusicBrainz + Deezer** (reconciled); the harvester fetches `/api/v2.25/song/by-isrc/{isrc}`
  down that list until one returns a populated `audio` block.

Under both, the LLM only *proposes*; the real audio + deterministic binning decide the
cell, and the real `languageCode` decides language. The LLM also judges expected
**test-case labels** blind (with the P6 algorithm score as a cross-check). It never
enriches stored song fields and never selects catalog songs by score.

**Language priority.** Catalog composition targets **Japanese as the primary language**
(JA-market product focus), English as fallback, other languages edge-only — enforced by
weighted coverage quotas and confirmed deterministically against the real `languageCode`
returned by Soundcharts (a song whose real language disagrees with its cell is discarded,
never relabeled). `language` and `era` (from `releaseDate`) are first-class, reported
coverage dimensions.

**Integrity.** Catalog selection is coverage-driven — a song enters because its real
audio bins into a needed coverage cell, never because of any score or rank — and the
frozen catalog carries no `recommended` / `best_for_world` / `target_rank` field
(§11, §17.6). A separate labeled **test-case set** `(world, candidate, expected
label)` is produced alongside the label-free catalog.

**Loopable, resumable, additive generation.** Generation runs as a sequence of loops:
each loop is a full pass, the operator inspects the output, and later loops **continue
without redoing prior work**. A persistent, generation-side **carry-over ledger**
(gitignored) records every song identity ever touched — by ISRC, Soundcharts UUID, and
normalized `(title, artist)` — with its outcome, so no name is re-proposed and no
ISRC/UUID is re-resolved or re-fetched, and known misses are never retried. Loops never
remove; they fill still-empty cells **and may add further songs to already-covered cells
to enrich them** (multiple songs per cell, still admitted purely by coverage pigeonhole).
The ledger keys and exclusion are identity-based only — never a score — so resumability
adds no selection pressure the firewall would object to.

**Execution model (no LLM API).** The generator does **not** call any OpenAI / Anthropic /
other LLM API — there are no LLM API keys. Deterministic stages (coverage plan, harvest +
ISRC resolution, bin/select, map, validate/repair, freeze, certify, ledger) are
**standalone Python CLIs** doing only non-LLM work (Soundcharts/MusicBrainz/Deezer HTTP —
data-source APIs, not LLM — plus binning, validation, file I/O). LLM stages (web-research,
song search/naming, narrowing, profile composition, blind judging) are performed by an
**interactive LLM in the Claude Code terminal**, via a **file handoff** (input-context file
→ prompt → schema-checked structured-output file). A Claude Code skill drives end-to-end;
the deterministic CLIs also run in a bare terminal with no agent present. Full detail: P2
design §14.

**Reproducibility.** The live harvest is cached and the LLM outputs are frozen files, so the
deterministic transform (accumulated raw cache → catalog) is byte-identical and
re-runnable across however many loops built the cache — with no LLM or agent in the loop.
The committed frozen dataset — not a rerun of the harvest — is the replay boundary, and no
live network or LLM call occurs during a transparent simulation run.

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

The exclusion above is *AICA/LLM-inferred* genre. It is separate from Spotify's own artist-level `genres` field (from the Artist object, `GET /artists`), which the content algorithm identifies as the sole real-provider path for its **`genre‡` features** — route, destination, child, hobbies, and per-genre usage (that document's §5.7). Artist genre is deliberately **not** in the Spotify-only V1 Track/Audio-Features contract; it is supplied by the opt-in, namespaced **`genre_affinity_v1`** data-contract extension (§21.1), enabled per run. With the extension off, those features are `context_only` and V1 ranking is unchanged.

### 2.3 Separate world and history data

Driver state, road conditions, passengers, U-Pro settings, exact oshi artist identifiers, playback history, operations, acceptance, and recovery remain in the synthetic world fixture. They are not song metadata.

This separation prevents a synthetic song generator from pre-encoding the recommendation outcome.

---

## 3. Dataset envelope

A frozen dataset uses this envelope:

```yaml
dataset_manifest:
  dataset_id: soundcharts-grounded-v1-seed-1042
  dataset_kind: soundcharts_grounded_spotify_compatible
  schema_version: 1.0.0
  spotify_track_reference_version: pinned-2026-07-14
  spotify_audio_features_reference_version: pinned-2026-07-14
  generator_version: 1.0.0
  prompt_template_version: 1.0.0
  validation_rules_version: 1.0.0
  random_seed: 1042
  generated_at: 2026-07-14T00:00:00Z
  synthetic_only: false
  provenance_note: "Names and audio harvested from Soundcharts; IDs and URLs synthetic."

songs: []
worlds: []
```

The manifest label is mandatory. A record must never be mistaken for a *live* Spotify response: `dataset_kind` is `soundcharts_grounded_spotify_compatible`, `synthetic_only` is `false`, and the provenance note records that names and audio are real while IDs and URLs are synthetic.

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
  dataset_kind: soundcharts_grounded_spotify_compatible
  synthetic_only: false
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
coverage controls + Soundcharts harvest of real songs
  -> Spotify-compatible Track object (real names, synthetic IDs/URLs)
  -> Spotify-compatible Audio Features object (real values, verbatim)
  -> deterministic validation
  -> frozen dataset
```

At recommendation time, the transparent selector derives documented proxies from the stored Audio Features. It does not persist those proxies as provider facts.

Future enrichment is an extension boundary. Any future source must have its own namespace, provenance, availability policy, applicability review, and customer approval before it can affect scoring.

---

## 9. LLM synthetic-generation algorithm

**Execution (no API).** The "LLM" here is an **interactive agent in the Claude Code
terminal**, not a programmatic API call (§0, P2 design §14). Each LLM step reads a
schema-checked input-context file and writes a schema-checked structured-output file; a
Claude Code skill drives the deterministic CLIs and these LLM steps in turn. Malformed
LLM output is repaired by **re-running the prompt** interactively, not by an API retry.

### 9.1 Inputs

The LLM receives:

- the V1 JSON Schema;
- Spotify-documented field definitions and ranges;
- the catalog coverage matrix in Section 10 (including the language/era axes and the
  still-unfilled/enrichment targets computed against the carry-over ledger);
- under `soundcharts_search`: Soundcharts search results and real song metadata for the
  songs under consideration; under `isrc_resolved`: the coverage cells to name real songs
  for (web-grounded), plus the carry-over ledger's exclusion list;
- fixed entity IDs allocated before generation;
- the random seed and generation pass ID; and
- explicit instructions that all IDs and URLs are synthetic (`synthetic-` / `.invalid`), while real names, audio, release data, and ISRC are retained from the Soundcharts source.

For search-strategy, candidate narrowing/naming, and blind test-case label judging the LLM does receive real Soundcharts (and, under `isrc_resolved`, web-grounding) metadata, but never to enrich stored song fields and never to select catalog songs by score. It does not receive recommendation results. Under `isrc_resolved` the LLM **never emits an ISRC or an audio-feature value** — ISRCs come only from the deterministic MusicBrainz/Deezer resolver.

### 9.2 Pass 1: Track objects

The generator creates the artist, album, and track identities first.

Requirements:

1. allocate stable synthetic artist, album, and track IDs;
2. keep the real song/artist names and release data from the Soundcharts source;
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
| speech forward | `speechiness >= 0.33`, low-to-medium instrumentalness |
| instrumental leaning | `instrumentalness >= 0.65` |

These are generation controls, not stored labels used by the recommendation algorithm.

> **P2 Soundcharts-grounded amendment (speech-forward threshold).** The original guidance
> used `speechiness >= 0.40`. The T062 live harvest established that Soundcharts-grounded
> `speechiness` is compressed — it tops out around **0.38** even for the most rap-heavy
> tracks — so `0.40` left the entire `speech forward` column unfillable
> (`cell_unfillable_from_source`). The threshold is therefore **`0.33`**, Spotify's own
> documented boundary for "music **and** speech" (values `0.33–0.66` are tracks that may
> contain both, i.e. rap). This is a binning/coverage control only; it changes no Song
> field, no algorithm, and no `dataset_hash` (the hash is over Song records, not cells).

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

Because the content selector also scores `humming_ease` and `full_karaoke_ease`
(§5.2), generation must additionally spread these across the 36 cells — both
easy-to-hum and hard-to-hum, and both easy and hard full-karaoke songs — plus genre,
**language, and era**. `language` (from the real `languageCode`) is targeted with a
**Japanese-primary priority** (English fallback, other languages edge-only); `era` is
derived from `releaseDate`. These are required secondary spreads, contrast pairs, and
reported dimensions layered onto the 36-cell grid, not extra multiplicative cell axes (a
full `36 × ease × genre × language × era` cross-product is infeasible on limited
Soundcharts quota).

Under the loopable generation model (§0), a cell may hold **more than one song**: each
loop fills still-empty cells first, then may add further songs to already-covered cells
to enrich the catalog. Every admission is by coverage pigeonhole, never by score, and the
carry-over ledger prevents any song from being processed twice across loops.

### 10.3 Identity and releases

The default catalog has:

- 12 fictional Spotify artist identities;
- three tracks per primary artist;
- at least 12 fictional albums;
- releases covering at least three eras for age-affinity tests; and
- stable artist and track IDs for exact oshi and history fixtures.

No singer-versus-artist distinction or detailed contributor graph is generated.

When the `genre_affinity_v1` extension (§21.1) is active, its `artist_genres`
lookup assigns each of the 12 artists **one to three** genres from the controlled
vocabulary, spread so that every vocabulary genre is carried by at least one
artist and both child-friendly (`anime`, `vocaloid`, `children's music`) and
route/hobby-relevant genres appear. Assignment is part of catalog generation, is
frozen with the catalog, and never encodes a target recommendation rank (§17.6).

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

`route_tags` and `destination_tags` are context-only in Spotify-only V1 (songs have no matching fields). When the `genre_affinity_v1` extension (§21.1) is enabled, they — together with `child_present`, `hobby_interest_tags`, and the current scene — drive the six `genre‡` features via the artist-genre lookup, and the world additionally carries **Tier-2 per-genre history fixtures**:

```yaml
  # present only when extensions.genre_affinity_v1 is active
  usage_by_genre:            # overall content-tag usage, per vocabulary genre
    city pop: high
    j-pop: med
    enka: never
  scene_genre_usage:         # scene × genre usage; current scene selects the row
    active_driving_content:
      city pop: high
      j-rock: low
```

Each level is one of `{never, low, med, high}` over the §21.1 controlled vocabulary; genres absent from a map are treated as `never`. History references exact synthetic Track IDs; apart from these opt-in Tier-2 genre fixtures, no tag-level song histories are generated for V1.

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

A characteristic route/destination world may be retained to demonstrate the honest Spotify-only V1 limitation: with `genre_affinity_v1` **off**, changing route semantics alone does not change music rank because no Spotify song field supports that relation. With the extension **on**, the same world instead demonstrates the genre-mediated route effect (§21.1).

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
- route tag A versus route tag B, with an expected **no-change** assertion when `genre_affinity_v1` is **off**; and
- the same route tag A versus B with `genre_affinity_v1` **on**, expecting the genre-mediated ordering to shift (§21.1).

The first route pair is a transparency test, not a recommendation-quality target; the second proves the extension is the only thing that makes route semantics bite.

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

The ID and URL rules below are strictly enforced. Real names and the real ISRC are kept for realism and lineage; only IDs and URLs are synthetic.

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

### 17.7 `genre_affinity_v1` extension (validated only when present)

- every string in `artist_genres[*]`, `usage_by_genre`, and `scene_genre_usage[*]` is a member of the §21.1 controlled vocabulary;
- every `artist_genres` key resolves to a generated Artist ID; each artist carries one to three genres, and every vocabulary genre is carried by at least one artist (§10.3);
- every Tier-2 usage level is one of `{never, low, med, high}`;
- the extension adds no key inside `spotify_track`, `spotify_audio_features`, or `simulation_flags` (§21 no-overwrite rule); and
- with the extension absent, scoring of the six `genre‡` features is `context_only`, reproducing the no-extension ranking exactly (fallback assertion).

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

Because generation is loopable (§0), the reproducibility target is the deterministic transform over the **accumulated** raw-response cache (the union of all loops' cached responses) plus the carry-over ledger: the same accumulated cache reproduces the same catalog regardless of how many loops built it. Freezing after a later loop supersedes the prior snapshot; the ledger and raw cache persist across freezes as the resumable state.

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
  genre_affinity_v1: {}
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

### 21.1 `genre_affinity_v1` (defined)

This extension supplies artist-level **genre** so the content selector can score
its six `genre‡` features (route, destination, child, hobbies, content-tag usage,
scene/genre usage). It is the sole real-provider path for slide 69's genre-scored
intent. Genre is **not** on the Spotify Track object; on the platform it comes from
the full Artist object (`GET /artists`). The extension therefore adds a
**namespaced artist-genre lookup** — it does *not* mutate the Spotify-compatible
inline `spotify_track.artists[]` (which is the simplified artist object and carries
no `genres`):

```yaml
extensions:
  genre_affinity_v1:
    artist_genres:
      synthetic-artist-0001: [city pop, j-pop]
      synthetic-artist-0002: [anime, vocaloid]
```

A song's genre set is `G_song = ⋃` `artist_genres[id]` over `spotify_track.artists[*].id`.

**Controlled vocabulary** (the only permitted genre strings; lowercase, coarse,
artist-level):

```text
j-pop · j-rock · city pop · anime · vocaloid · enka ·
children's music · classical · jazz · ambient · electronic · japanese folk
```

**Tier-2 world/history fixtures** (present only when this extension is active; see
§13): `usage_by_genre[genre]` and `scene_genre_usage[scene][genre]`, each a level
in `{never, low, med, high}` over the same vocabulary.

Required declarations for this extension:

| Declaration | Value |
|---|---|
| authoritative source | platform Artist object `genres` (`GET /artists`); synthetic fixtures model it |
| field-level provenance | `artist_genres` = synthetic per-artist assignment from the fixed vocabulary; Tier-2 usage = synthetic history fixture |
| legal/policy basis | no live provider data; synthetic identities only (§17.3); genre is not derived from lyrics or audio |
| missing-data behavior | absent `artist_genres[id]` → that artist contributes no genres; empty `G_song` → every `genre‡` feature scores `a_i = 0` (`missing_neutral`, no weight redistribution) |
| validation schema | §17.7 |
| applicable services/factors | all three content services; the six `genre‡` features only (content algo §5.7) |
| scoring formulas/weights | content algo §5.7 (best-match `a_i`); tree shares unchanged, masks flip `0→1` (content algo §6.1) |
| explanation text | per feature: "context wants `<genre>`; this song is `<matched genre>` → `a_i`" |
| fallback when unavailable | all six `genre‡` features revert to `context_only` (mask `0`); Spotify-only V1 ranking is bit-identical to no extension |

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
| `invalid_genre_extension` | `genre_affinity_v1` uses an out-of-vocabulary genre, an unresolved artist ID, a bad usage level, or overwrites a Spotify-compatible field (§17.7) |
| `soundcharts_harvest_failed` | Soundcharts search/metadata/`by-isrc` call failed or quota exhausted |
| `cell_unfillable_from_source` | no real song found to fill a required coverage cell after re-harvest / *N* fill rounds |
| `genre_unmappable_to_vocabulary` | a real Soundcharts genre has no controlled-vocabulary mapping (→ `missing_neutral`) |
| `lineage_integrity_failed` | a synthetic ID lacks a resolvable lineage entry to its Soundcharts source |
| `song_not_found_in_sources` | (`isrc_resolved`) MusicBrainz + Deezer returned no ISRC for the named song — per-candidate miss, drives the fill loop |
| `isrc_not_in_soundcharts` | (`isrc_resolved`) all candidate ISRCs 404 on `by-isrc` — per-candidate miss |
| `audio_unavailable` | (`isrc_resolved`) the Soundcharts record for the ISRC has a null/partial `audio` block — per-candidate miss |
| `language_mismatch` | (`isrc_resolved`) the real `languageCode` disagrees with the cell's target language — song discarded, never relabeled |
| `isrc_probe_gate_failed` | (`isrc_resolved`) the step-zero audio-coverage probe did not meet the minimum populated-audio threshold; the strategy halts before the run |

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

- the deterministic transform (cached harvest + frozen LLM plans → catalog) yields byte-identical frozen output;
- IDs and URLs are synthetic; real names, audio, and ISRC are kept from Soundcharts;
- all URLs use `.invalid`;
- no real provider payload enriches a stored song field, and the LLM never selects catalog songs by score;
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
- route-only contrast produces no content-rank change with `genre_affinity_v1` off.

### 23.6 Repair and replay

- each repair rule is deterministic and logged;
- repair exhaustion produces a typed error;
- edited data gets a new hash; and
- frozen replay is independent of LLM availability.

### 23.7 `genre_affinity_v1` extension

- `artist_genres`, `usage_by_genre`, and `scene_genre_usage` accept only vocabulary genres and resolvable artist IDs; out-of-vocabulary or unresolved entries raise `invalid_genre_extension` (§17.7);
- Tier-2 usage levels accept only `{never, low, med, high}`;
- the extension adds no key inside the Spotify-compatible or flag objects;
- with the extension **off**, ranking is byte-identical to a catalog with no extension (fallback); and
- with the extension **on**, the route tag A/B contrast reorders candidates through the genre-mediated path (§21.1), and an empty-`G_song` song scores `a_i = 0` on every `genre‡` feature.

---

## 24. Acceptance criteria

This specification is satisfied when:

- every song contains only the two Spotify-compatible objects and the separate simulator flag object;
- all Spotify Audio Features fields listed in the selected reference are represented with exact names;
- Track title, performing artists, album, release, IDs, playback policy, and duration are provider-compatible fields;
- no AICA/LLM-enriched song traits participate in V1;
- all generated songs default both karaoke availability flags to `1`;
- records are unmistakably labeled real-grounded (synthetic IDs, `.invalid` links) and never use live Spotify links;
- the LLM receives schema, coverage controls, and real Soundcharts metadata (for search, narrowing, and blind label judging), never to enrich stored song fields;
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
