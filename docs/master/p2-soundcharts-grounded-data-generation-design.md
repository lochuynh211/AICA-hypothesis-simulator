# P2 — Soundcharts-Grounded Synthetic Music Data Generation — Design

**Date:** 2026-07-16
**Milestone:** P2 (from `docs/master/aica_proposal_simulator_milestones.md` §4)
**Status:** Approved design (brainstorming complete); precedes SpecKit `speckit-specify`.
**Source docs amended by this design:** `docs/master/aica_synthetic_music_data_and_generation_specification.md` (data spec), `docs/master/aica_proposal_simulator_milestones.md` (§4)
**Depends on:** P0.5 song schema (`app/api/aica_api/models/proposal/song_schema.py`), P6 content selector (used as post-freeze contrast certifier)

---

## 1. Goal & customer-visible outcome

Produce the shared, Spotify-compatible music dataset that every later proposal
milestone consumes — but instead of inventing audio numbers with an LLM alone,
**ground the catalog in real song data harvested from the Soundcharts API**, then
map it into the frozen synthetic schema. The intent is data that reviewers *trust*:
real song/artist names, real audio-feature values, coherent genre/era relationships —
rather than free-floating synthetic numbers whose internal relationships may look
"dizzy" (e.g. a song whose genre does not match its audio profile).

Alongside the catalog, P2 produces a **labeled test-case set**: `(world, candidate
song, expected label ∈ {positive, negative, neutral})` triples, where an **LLM acts
as an independent multi-fold judge** of the expected label and the P6 algorithm score
is recorded as a *cross-check*, not the authority.

The outcome is offline tooling (a repository command producing committed, versioned
JSON), not a runtime feature. No transparent simulation run ever calls Soundcharts,
the web, or an LLM; the frozen dataset is the replay boundary.

### 1.1 Why Soundcharts (context)

The customer has no Spotify API access. Soundcharts is the chosen alternate source.
API verification (2026-07-16) confirmed the Soundcharts song-metadata response
(`SongResponse3`) carries every audio-feature field the P6 two-axis trait model scores
(`acousticness`, `danceability`, `energy`, `instrumentalness`, `key`, `liveness`,
`loudness`, `mode`, `speechiness`, `tempo`, `timeSignature`, `valence`) plus `name`,
`isrc`, `duration`, `explicit`, `releaseDate`, structured `genres` (`{root, sub[]}`),
and `artists[]`. The artist response (`ArtistResponse2`) carries flat `genres[]`.
Missing vs. the Spotify Track object: `album` object, `disc_number`, `track_number`,
`popularity` (separate endpoint), `available_markets`, and the playback fields
(`is_playable`, `is_local`, `restrictions`, `preview_url`, `linked_from`). Those are
synthesized in the mapper (S4) — and most of them are exactly the eligibility
negative-fixtures the data spec already tells us to fabricate.

---

## 2. Key decisions (and the freeze amendments they require)

The approved data spec is deliberately **synthetic-only** (fictional names, `.invalid`
URLs, `synthetic-` IDs, `synthetic_only: true`, a firewall against real provider data
entering the pipeline). This design consciously **relaxes the "fictional names" rule**
to gain reviewer-facing realism, while keeping the parts of the firewall that protect
algorithm-verification integrity. Every relaxation is recorded here so the freeze stays
honest.

| # | Decision | Consequence / amendment |
|---|---|---|
| D1 | **Real song + artist names are kept** in the frozen catalog. | Amends data spec §9.2, §23.4, §24 ("all names and identities are fictional"). IDs and all URLs stay synthetic (`synthetic-…` / `.invalid`). |
| D2 | **Audio-feature values are kept verbatim** from Soundcharts (`timeSignature`→`time_signature`; wrapped with synthetic identity fields). | The frozen catalog stores real, Spotify-derived measurements. Acceptable for a local internal review tool; provenance/licensing noted in the manifest. |
| D3 | **Manifest kind changes** from `synthetic_spotify_compatible` / `synthetic_only: true` to `soundcharts_grounded_spotify_compatible` / `synthetic_only: false`, plus a provenance + licensing note. | Amends data spec §3, §7.1. A record must never be *mistaken for a live Spotify response*, but it is honestly labeled as real-grounded. |
| D4 | **`synthetic-` ID / `.invalid` URL rules stay enforced** (existing `song_schema.py`). The §17.3 "must not resemble live provider data" intent is relaxed **for names only**. | Amends data spec §17.3 wording; the code validator is unchanged (it never checked names). |
| D5 | **Reproducibility is re-scoped.** "Same seed → byte-identical regeneration" (§23.4) cannot hold with a live API + LLM. Instead: **harvest once, cache raw responses + freeze the LLM plans**, and the *transform* (raw cache → synthetic catalog) is fully deterministic and re-runnable. | Amends data spec §19, §23.4. The committed dataset stays the replay boundary; the one-time live harvest is not reproducible but is fully captured by the raw cache + lineage file. |
| D6 | **Real ISRC is kept** as-is (realism + lineage). | Amends data spec §17.3's synthetic-ISRC caution; the real ISRC is a real identifier, not a faked-synthetic one. |
| D7 | **Genre uses two representations.** Soundcharts genre text is used for **search + display + lineage**; a deterministic `real→controlled-12-vocab` map feeds **only** the `genre_affinity_v1` scoring extension. The controlled vocabulary is **not** expanded (kept frozen). | No algorithm change; adds a mapping table + `genre_unmappable_to_vocabulary` handling (unmapped → `missing_neutral`). |
| D8 | **The LLM is elevated to an independent test-case judge** (blind-first labeling), in addition to being a search strategist. | Adds a new labeled-test-case artifact with LLM-judge provenance, distinct from algorithm score. The **song catalog itself stays label-free** (§11 unchanged: no `recommended`/`best_for_world`/`target_rank`). |

---

## 3. Integrity model — what the firewall still protects

The whole reason P2 exists is to *test* the algorithm, so the data must not be
engineered to pre-determine the algorithm's output. Two invariants are preserved
exactly:

1. **Catalog selection is coverage-driven, never score-driven.** A song enters the
   catalog because its *real audio* bins into a needed coverage cell (S3) — never
   because of any `item_fit` score or rank. The frozen catalog carries no label or
   target field (data spec §11 / §17.6 hold unchanged).
2. **The LLM never selects catalog songs by score, and judges test-case labels
   blind.** The LLM proposes *where to search* (S0.5, S1) and *which cheap candidates
   to fetch* (S1.5), but the real audio + deterministic binning decide the cell. At
   labeling time (S8) the LLM assigns its label **before** the P6 score is revealed,
   so the two evaluators stay independent and their disagreement remains a real signal.

**Ordering guarantees**
- Catalog is frozen (S6) **before** any world is judged (S8) — data spec §17.6.
- The LLM label (S8, blind) is committed **before** the P6 score is revealed.

**Two-evaluator payoff.** Because LLM-judgment and algorithm-score are independent:
- agree → a confident positive/negative test case ("converge");
- deliberately opposed context → the contrast pairs ("contrast");
- disagree → either a genuinely **neutral/ambiguous** fixture, or a **flag that the
  algorithm may be mis-scoring** — exactly the finding P2 exists to surface.

---

## 4. Pipeline architecture

Three cost tiers of LLM narrowing (cheap→expensive), then deterministic mapping,
freeze, and post-freeze certification.

```
S0    Coverage plan (deterministic)          — what cells/spreads/pairs are needed
S0.5  LLM web-research (LLM)                  — high-precision query/candidate seeds
S1    LLM search-strategist + Soundcharts SEARCH — broad candidate list (cheap)
S1.5  LLM narrowing (LLM)                     — quota-bounded shortlist to fetch
S2    Harvester (deterministic)              — full metadata + audio for shortlist; cache + lineage
S3    Binner + Selector (deterministic)      — bin real audio to cells; pick coverage set + pairs
S4    Mapper (deterministic)                 — real record → synthetic Song
S5    Validator + Repair (deterministic)     — song_schema + §17 rules; 2-strike stop
S6    Freeze (deterministic)                 — manifest + dataset_hash; catalog immutable
S7    Worlds + real-grounded profiles (det. + LLM) — driver/traffic fixtures + coherent histories
S8    LLM judge (LLM, blind) → cross-check    — expected labels + agreement record
S9    P6 contrast certifier (deterministic)  — assert reversals; re-harvest failing cell
```

### 4.1 S0 — Coverage plan

Deterministic. Emits the required targets:

- **Primary grid (36 cells):** `energy(3) × tempo(3) × profile(4)` (data spec §10.1–10.2).
- **Secondary spreads** that must be covered and contrast-paired across the 36:
  `valence`, `mode`, `acousticness` (§10.2) **plus `humming_ease` (low/high),
  `full_karaoke_ease` (low/high), and genre** (this design's Delta 1).
- **Quotas:** 12 artists × 3 tracks, ≥12 albums, ≥3 eras, ≥6 `explicit:true`,
  ≥4 negative fixtures outside the 36, duration/time-signature spread, ≥1 `key:-1`.
- **Required contrast pairs** (§11) including the karaoke-ease pairs:
  easy-to-hum vs hard-to-hum at matched arousal; short-moderate vs long-high-energy
  for full karaoke; calm/active; bright/dark; acoustic/electric; etc.
- Under `genre_affinity_v1`: every controlled-vocab genre carried by ≥1 artist,
  including child-friendly and route/hobby genres (§10.3).

A full cross-product (`36 × ease × genre`) would be thousands of cells and is
infeasible on limited quota, so karaoke-ease and genre are **required spreads +
contrast pairs layered onto the 36-cell grid**, not additional multiplicative axes.

### 4.2 S0.5 — LLM web-research (quota saver #1)

The LLM researches the open web to turn each cell into **high-precision query seeds** —
ideally naming likely real songs (enabled by D1). Purpose: every eventual Soundcharts
query is high-yield rather than a broad scrape. Output is queries/candidate seeds only —
no audio numbers, no scores.

### 4.3 S1 — LLM search-strategist + Soundcharts search

The LLM converts seeds into concrete Soundcharts **search queries** (using Soundcharts'
own genre taxonomy — D7). Executing the search is cheap and returns a **broad candidate
list** (basic fields: name, artist, uuid, release date, possibly popularity). This list
may be large (e.g. ~1000).

### 4.4 S1.5 — LLM narrowing (quota saver #2)

The expensive step is the per-song full-metadata/audio fetch. Before spending that
quota, the LLM **prunes the broad list to a quota-bounded shortlist** most likely to
fill *needed* cells, using cheap fields + web knowledge of the real songs. This is a
*prediction to save quota*, not a decision — S3 still arbitrates by real audio.

### 4.5 S2 — Harvester

Deterministic. Fetches **full metadata + audio** (and artist metadata / popularity as
needed) for the shortlist only. Writes:
- a **raw-response cache** (gitignored) keyed by Soundcharts UUID, and
- a **lineage file** mapping `synthetic-id → Soundcharts UUID` + real name + real genre.

Tracks Soundcharts calls against a quota budget in the build report.

### 4.6 S3 — Binner + Selector (deterministic)

**Binner:** computes each real song's coverage coordinates by arithmetic on the real
audio — energy band, tempo band, profile family, `valence`/`mode`/`acousticness`,
**`humming_ease` and `full_karaoke_ease` bands** (from `danceability`↑,
`instrumentalness`↓, `speechiness`↓, `tempo`, `duration` — the same proxy math the P6
algorithm uses; this is audio arithmetic for *coverage*, **not** an `item_fit` score,
so the firewall holds), and genre tag.

**Selector:** keeps a scorecard and admits songs to satisfy coverage cells, secondary
spreads, quotas, and contrast pairs. One song per empty cell; over-fetched songs that
land in a full cell are discarded. **Selection is by pigeonhole, never by score.**

### 4.7 S4 — Mapper (deterministic)

Transforms each selected real record into the frozen `Song` schema:
- IDs → `synthetic-track-NNNN` / `synthetic-artist-NNNN` / `synthetic-album-NNNN`
  (deterministically allocated); URLs → `*.invalid`.
- **Names kept real** (D1); **audio kept verbatim** (D2), `timeSignature`→`time_signature`,
  wrapped with synthetic `id`/`uri`/`type: audio_features`/`analysis_url`/`track_href`
  and `duration_ms` (unit-normalized to ms).
- **Real ISRC kept** (D6).
- Synthesizes fields Soundcharts lacks: `album` wrapper (using `releaseDate`),
  `disc_number`, `track_number`, `popularity` (fetched or synthesized), `available_markets`,
  `is_playable`/`is_local` (and negative-fixture `restrictions`/`is_playable:false` where the
  coverage plan calls for them).
- Genre: keeps real Soundcharts genre text as provenance (lineage + display-only), and
  writes the `genre_affinity_v1.artist_genres` using the **`real→12-vocab` map** (D7).

### 4.8 S5 — Validator + Repair (deterministic)

Feeds the mapped dict through the existing `song_schema.py` (Pydantic) + data-spec §17
rules. On failure, applies the §18 deterministic repair rules (copy canonical duration,
rebuild `.invalid` URL from ID, set default flags, reallocate duplicate ID, etc.),
re-validates, and **halts the run with `catalog_generation_failed` after 2 failed
repairs** — no silent hand-edits; every repair is logged in the build report.

### 4.9 S6 — Freeze

Writes the `dataset_manifest` (new `dataset_kind`, versions, `random_seed`,
`generated_at` supplied externally, provenance/licensing note) + `dataset_hash`. The
catalog is now immutable and is the replay boundary.

### 4.10 S7 — Worlds + real-grounded profiles

Deterministic driver/traffic/night fixtures (data spec §14–15 — pure driver physiology
and traffic cannot be grounded and stay hand-authored contrast fixtures), with
histories/oshi/`usage_by_genre` **grounded to real catalog IDs** and the LLM composing
**coherent** profiles (e.g. a city-pop fan's history holds real city-pop tracks). All
15 base worlds and the 12 one-variable contrast pairs are produced with their stated
expected directions.

### 4.11 S8 — LLM judge (blind) → cross-check

For each `(world, candidate song)`: the LLM assigns `positive/negative/neutral`
**blind** (using context→music-need reasoning + mood/genre/era/cultural fit +
web knowledge of the real song). Then the P6 score is revealed and `agreement`
recorded. Produces the labeled test-case artifact (§6).

### 4.12 S9 — P6 contrast certifier

Runs the P6 content selector over the contrast worlds and asserts the required
**reversals** (data spec §15, §23.5). A pair that fails to reverse triggers a
**re-harvest of that cell** (loop back to S1 for a different real song), **never**
number-tuning toward a target score.

---

## 5. Reproducibility model

- **Non-reproducible (once):** the live Soundcharts harvest (S2) and LLM stages
  (S0.5/S1/S1.5/S8). Fully captured by the **raw-response cache** + **frozen LLM
  plans/outputs** + **lineage file**.
- **Deterministic + re-runnable:** the transform S3→S6 over the cached raw responses
  yields a **byte-identical catalog**. This is the reproducibility test target (D5).
- The committed frozen dataset — not a rerun of the harvest — is the replay boundary
  for all downstream milestones.

---

## 6. Artifacts

### 6.1 A — Frozen song catalog (unchanged `Song` schema, label-free)

`spotify_track` + `spotify_audio_features` + `simulation_flags`, exactly as
`song_schema.py` enforces. Real names now permitted (D1); no label/target field.

### 6.2 B — Labeled test-case set (new)

Separate file(s), e.g. `test_cases/*.json`:

```yaml
test_case_id: tc-highway-tired-strong-01
world_ref: world-night-highway-01
candidate_song_ref: synthetic-track-0007        # real name in catalog + lineage
expected_label: positive                         # LLM, assigned BLIND
judge_folds:                                     # LLM multi-fold rationale
  context_need: "drowsy + monotonous highway → high arousal"
  mood_genre_fit: "..."
  era_cultural_fit: "..."
  coherence: "..."
  web_evidence: "..."
algorithm_score: 0.62                            # P6 cross-check, revealed AFTER label
agreement: agree                                 # agree | disagree
contrast_partner: tc-mountain-chill-mood-01      # for one-variable pairs
expected_direction: reversal                     # §15 expectation
```

### 6.3 C — Generation-side, non-frozen (gitignored)

- **Raw-response cache** (Soundcharts payloads, keyed by UUID).
- **Lineage file** (`synthetic-id → Soundcharts UUID + real name + real genre text`).
- **Frozen LLM plans/outputs** (S0.5/S1/S1.5/S8) for auditability.
- **Build report** (repairs, quota usage, coverage checklist, agreement stats).

---

## 7. Worked example — one song, end to end

**Goal of the run:** fill the "strong song for a tired highway driver" test case,
plus its calm contrast partner (mountain-chill reversal test).

**S0 — coverage plan says what's missing**
```
NEED cell HI = {energy: high(0.70–0.95), tempo: high(131–180), profile: balanced-vocal,
                humming_ease: high}
NEED cell LO = {energy: low(0.10–0.35), tempo: low(60–95),   profile: balanced-vocal}
PAIR (HI, LO): "calm/active ordering must reverse between night-highway-tired and
                mountain-chill worlds"
```

**S0.5 — LLM web-research** seeds high-precision queries and likely real candidates:
```
cell HI: uptempo j-rock / city-pop driving anthems, 2010s–2020s; candidate seeds: [..names..]
```

**S1 — search-strategist runs Soundcharts SEARCH** (Soundcharts genre words) → ~1000
basic candidates (name, artist, uuid, date).

**S1.5 — LLM narrows** the ~1000 → shortlist of ~20 most likely to be genuinely
high-arousal and coherent (uses names + web knowledge). Only these cost audio-fetch quota.

**S2 — harvest full metadata + audio** for the shortlist. One raw record:
```yaml
uuid: 7f3a9c...            # real
name: "Night Runner"        # real
artists: [{ uuid: 4b1..., name: "Real Band" }]
isrc: { value: "JPXX01900123" }
duration: 218               # seconds
explicit: false
releaseDate: "2019-06-01"
genres: [{ root: "rock", sub: ["j-rock"] }]
audio: { energy: 0.86, tempo: 148, valence: 0.55, mode: 1, danceability: 0.62,
         acousticness: 0.03, instrumentalness: 0.0, speechiness: 0.05,
         loudness: -4.2, key: 7, liveness: 0.11, timeSignature: 4 }
```
Lineage: `synthetic-track-0007 → 7f3a9c... ("Night Runner", j-rock)`.

**S3 — bin, then select.** Binning is arithmetic on the real audio:

| Field | Real | Rule | Band |
|---|---|---|---|
| energy | 0.86 | 0.70–0.95 | high ✓ |
| tempo | 148 | 131–180 | high ✓ |
| instrumentalness | 0.0 | ≤0.20 | balanced-vocal ✓ |
| humming_ease (dance↑, instr↓, speech↓) | high | — | high ✓ |
| valence / mode / acousticness | 0.55 / 1 / 0.03 | — | mid / major / electric |

→ lands in **cell HI**. Selector: cell HI empty → claim `synthetic-track-0007`;
artist quota 1/3 OK; era 2019 = 2010s OK → **ACCEPT**. (Had HI been full, discard.)

**S4 — map to synthetic Song** (abridged):
```yaml
spotify_track:
  id: synthetic-track-0007
  uri: spotify:track:synthetic-track-0007
  href: https://api.synthetic.invalid/tracks/synthetic-track-0007
  name: "Night Runner"                         # real kept
  artists: [{ id: synthetic-artist-0003, name: "Real Band", ... }]
  album: { id: synthetic-album-0005, name: "...", release_date: "2019-06-01", ... }  # synthesized
  external_ids: { isrc: "JPXX01900123" }       # real kept (D6)
  duration_ms: 218000                          # 218 s × 1000
  explicit: false
  is_playable: true; is_local: false; popularity: 57; available_markets: [JP]
  track_number: 3; disc_number: 1
spotify_audio_features:
  id/uri: synthetic-track-0007; duration_ms: 218000
  energy: 0.86; tempo: 148; valence: 0.55; mode: 1; danceability: 0.62
  acousticness: 0.03; instrumentalness: 0.0; speechiness: 0.05
  loudness: -4.2; key: 7; liveness: 0.11
  time_signature: 4                            # was timeSignature
  analysis_url/track_href: https://api.synthetic.invalid/...
  type: audio_features
simulation_flags: { humming_karaoke_available: 1, full_karaoke_available: 1 }
# genre_affinity_v1: synthetic-artist-0003 → ["j-rock"]   (rock/j-rock → 12-vocab)
```

**S5 — validate + repair.**
```
Attempt 1: ✗ cross-object identity: track.duration_ms=218000 != audio.duration_ms=218
           → repair "duration mismatch → copy canonical Track duration" → audio.duration_ms=218000
Attempt 2: ✗ image.url host 'realcdn.com' not '.invalid'
           → repair "non-.invalid URL → rebuild from synthetic id" → img.synthetic.invalid/...
Attempt 3: ✅ PASS   (2 repairs used; a 3rd failure would halt with catalog_generation_failed)
```

**S6 — freeze** into the dataset (+ manifest + hash).

**S8 — judge (blind) then cross-check.**
```
World night-highway: drowsiness 80, monotony 90  → need = HIGH arousal
LLM (blind, web knowledge of real "Night Runner"): "energetic driving anthem → wakes a
    drowsy driver"  → expected_label = POSITIVE
Reveal P6 score: +0.62 (positive) → agreement = AGREE → confident POSITIVE test case
Cross case (same song vs mountain-chill soothe world): LLM = NEGATIVE; if P6 also low → agree,
    if P6 stays high → DISAGREEMENT flagged = an algorithm finding
```

**S9 — certify** that the (HI, LO) pair reverses across the two worlds; if not,
re-harvest cell HI (or LO) — never tune the numbers.

**One line each:**
- **S3** = "sort each real song into its audio pigeonhole; keep one per empty pigeonhole."
- **S5** = "check the mapped song against the schema; auto-fix known breakages; abort loudly after 2 tries."

---

## 8. Master-doc amendments this design authorizes

To be applied when P2 freezes (tracked so the freeze stays honest):

1. **Data spec §9.2 / §23.4 / §24** — allow real names; drop "all names fictional".
2. **Data spec §3 / §7.1** — new `dataset_kind: soundcharts_grounded_spotify_compatible`,
   `synthetic_only: false`, provenance + licensing note; still "never mistaken for a
   live Spotify response".
3. **Data spec §17.3** — `synthetic-` ID / `.invalid` URL rules retained; "must not
   resemble live provider data" relaxed for names and real ISRC (D6) only.
4. **Data spec §19 / §23.4** — re-scope determinism to "frozen dataset is the replay
   boundary; transform reproducible from cache; live harvest is not".
5. **Data spec §21.1 / §17.7** — add the `real→controlled-vocab` genre mapping and
   `genre_unmappable_to_vocabulary` (unmapped → `missing_neutral`); vocab stays frozen.
6. **New artifact** — labeled test-case set with LLM-judge provenance, distinct from
   algorithm score; song catalog stays label-free (§11 unchanged).
7. **Milestones §4** — record the Soundcharts-grounded generation approach and the
   S0–S9 pipeline as the P2 realization.

---

## 9. Error / status taxonomy

Additions to the data spec §22 codes:

| Code | Meaning |
|---|---|
| `soundcharts_harvest_failed` | search/metadata call failed or quota exhausted |
| `cell_unfillable_from_source` | no real song found to fill a required cell after re-harvest |
| `genre_unmappable_to_vocabulary` | real genre has no controlled-vocab mapping (→ `missing_neutral`) |
| `lineage_integrity_failed` | a synthetic ID lacks a resolvable lineage entry |

`judge_disagreement` is **recorded data, not an error** — it is a signal (neutral
fixture or algorithm finding).

Existing codes still apply: `catalog_generation_failed`, `cross_object_identity_mismatch`,
`synthetic_identity_violation` (IDs/URLs), `coverage_contract_failed`,
`world_reference_failed`, `invalid_genre_extension`, `invalid_*_fixture`.

---

## 10. Verification / testing plan

- **Reproducible-transform test:** same raw cache + frozen plans → byte-identical catalog (D5).
- **Coverage/quota tests:** all 36 cells present; secondary spreads (valence/mode/acousticness/
  humming_ease/full_karaoke_ease/genre) covered; artist/era/explicit/negative quotas.
- **Contrast reversal tests via P6 (S9):** calm/active, bright/dark, acoustic/electric,
  and karaoke-ease pairs reverse under their declared contrasts (data spec §23.5).
- **Schema/identity tests:** `synthetic-` IDs and `.invalid` URLs enforced; real names/ISRC
  accepted; cross-object identity holds.
- **Firewall structural tests:** no `recommended`/`best_for_world`/`target_rank` in any
  catalog song; no `item_fit` score consumed anywhere in S0–S6.
- **Blind-first enforcement test:** the LLM label is committed before the P6 score is revealed
  (label timestamp/order precedes score).
- **Two-evaluator stats:** agreement rate reported; disagreements routed to neutral fixtures or
  flagged findings.
- **Genre mapping tests:** `real→12-vocab` map is total or raises `genre_unmappable_to_vocabulary`;
  `genre_affinity_v1` off reproduces the no-extension ranking exactly.
- **Lineage integrity test:** every synthetic ID resolves to a lineage entry.
- **Repair tests:** each §18 rule deterministic and logged; 2-strike stop raises
  `catalog_generation_failed`.

---

## 11. Build staging

One design doc; the implementation plan will likely stage the work:

- **P2a** — harvest → bin → map → validate → freeze catalog (S0–S6) + lineage/cache/manifest.
- **P2b** — worlds + real-grounded profiles (S7) + the 15 base worlds and 12 contrast pairs.
- **P2c** — LLM judge + cross-check (S8) + P6 contrast certification (S9) + labeled test-case set.

---

## 12. Open questions deferred to the implementation plan

- Soundcharts auth, exact endpoints (song search, song metadata, artist metadata,
  popularity/streaming, album), and response pagination.
- Quota budget size and per-run call ceiling; behavior on quota exhaustion.
- The generator LLM: which model, and whether it has a live web-search tool (needed by
  S0.5/S1.5/S8).
- Album / `available_markets` / `popularity` sourcing (real endpoint vs synthesized).
- `duration` unit confirmation (seconds vs ms) via an empirical probe.
- Audio-feature **coverage** empirical probe (Spotify deprecated audio features Nov 2024;
  confirm how populated Soundcharts `audio` actually is before committing to cell targets).
- Number of labeled test cases beyond the 12 required contrast pairs.
- The `real genre → 12-vocab` mapping table contents.
