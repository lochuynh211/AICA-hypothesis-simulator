# P2 — Soundcharts-Grounded Synthetic Music Data Generation — Design

**Date:** 2026-07-16
**Milestone:** P2 (from `docs/master/aica_proposal_simulator_milestones.md` §4)
**Status:** Approved design (brainstorming complete); precedes SpecKit `speckit-specify`.
**Revision (2026-07-16, ISRC-first pivot):** The Soundcharts `/api/v2/top/songs`
search-by-metric endpoint is **unavailable on the current subscription**. The
song-detail endpoint `/api/v2.25/song/by-isrc/{isrc}` *is* available and returns the
full `audio` block inline (verified). This revision adds a **second, selectable
candidate-acquisition strategy** (`isrc_resolved`) alongside the original
(`soundcharts_search`), chosen by a setup-time flag. Both converge on the same
deterministic backbone (bin → select → map → validate → freeze → judge → certify), so
the firewall and coverage contract are unchanged. See D9–D12 and §4.
**Source docs amended by this design:** `docs/master/aica_synthetic_music_data_and_generation_specification.md` (data spec), `docs/master/aica_proposal_simulator_milestones.md` (§4)
**Depends on:** P0.5 song schema (`app/api/aica_api/models/proposal/song_schema.py`), P6 content selector (used as post-freeze contrast certifier), and (for `isrc_resolved`) two free external metadata sources — **MusicBrainz** and the **Deezer public API** — used only for ISRC resolution at generation time.

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

**`by-isrc` endpoint verification (2026-07-16).** A live call to
`/api/v2.25/song/by-isrc/{isrc}` (input `USAT22003425`) confirmed the response carries
the **complete `audio` block inline** — all twelve P6-scored fields
(`acousticness`, `danceability`, `energy`, `instrumentalness`, `key`, `liveness`,
`loudness`, `mode`, `speechiness`, `tempo`, `timeSignature`, `valence`) — with **no
separate audio/UUID call required**. The response also carries `name`, `isrc`
(`{value, countryCode, countryName}`), `iswcs[]`, `artists[]`/`mainArtists[]`,
`releaseDate`, `duration` (**seconds** — confirms the §12 unit question), `explicit`,
structured `genres` (`{root, sub[]}`), `labels[]`, `composers[]`, `producers[]`,
`credits[]`, and — new, not previously noted — **`languageCode`** (e.g. `"en"`).
`languageCode` is load-bearing for this revision: it lets the language coverage axis be
**confirmed deterministically from the real response** rather than trusting any LLM
claim. `popularity` remains a separate endpoint (unchanged).

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
| D5 | **Reproducibility is re-scoped.** "Same seed → byte-identical regeneration" (§23.4) cannot hold with a live API + LLM. Instead: **harvest incrementally across loops (each identity fetched once, never re-fetched — §4.13), cache raw responses + freeze the LLM plans**, and the *transform* (accumulated raw cache → synthetic catalog) is fully deterministic and re-runnable. | Amends data spec §19, §23.4. The committed dataset stays the replay boundary; the live harvest is not reproducible but is fully captured by the accumulated raw cache + lineage + carry-over ledger. |
| D6 | **Real ISRC is kept** as-is (realism + lineage). | Amends data spec §17.3's synthetic-ISRC caution; the real ISRC is a real identifier, not a faked-synthetic one. |
| D7 | **Genre uses two representations.** Soundcharts genre text (`{root, sub[]}`) is used for **search + display + lineage**; a deterministic **sub-first** `real→controlled-12-vocab` map feeds **only** the `genre_affinity_v1` scoring extension. The controlled vocabulary is **not** expanded — it **stays frozen at the 12 terms** of `genre_affinity_v1` (enums/schema/algorithm/P0.5/P6 untouched). | No algorithm or contract change; adds only the mapping table (§13) + `genre_unmappable_to_vocabulary` handling (unmapped → `missing_neutral`). Confirmed 2026-07-16 against the real Soundcharts taxonomy (34 roots): six vocab terms live as *subs* under generic/surprising roots (`city pop`/`j-rock`/`enka` under `j-pop`; `anime` under `soundtrack`; `vocaloid` under `electro`; `japanese folk` under `traditional`), so the map **must be sub-aware, not root-only**. |
| D8 | **The LLM is elevated to an independent test-case judge** (blind-first labeling), in addition to being a search strategist. | Adds a new labeled-test-case artifact with LLM-judge provenance, distinct from algorithm score. The **song catalog itself stays label-free** (§11 unchanged: no `recommended`/`best_for_world`/`target_rank`). |
| D9 | **Two selectable candidate-acquisition strategies** behind a setup-time flag `candidate_source ∈ {soundcharts_search, isrc_resolved}`. Both terminate at the same raw-response cache + lineage boundary; S3+ is strategy-agnostic. | Amends §4. Original search strategy is retained as-is and as a fallback. The flag is recorded in the build report and `dataset_manifest` provenance. A future `both_merged` mode is out of scope (YAGNI). |
| D10 | **`isrc_resolved` strategy:** a **web-search-grounded LLM** names real songs per coverage cell (existence-verified, with web-evidence, **never emitting an ISRC or audio number**); a deterministic resolver turns each `(title, artist, year)` into an **ordered candidate-ISRC list via MusicBrainz + Deezer, reconciled**; the harvester fetches `by-isrc` down that list until one returns a populated `audio` block. | Adds resolver + `by-isrc` harvest stages and a bounded fill loop. The LLM proposes; **real audio still arbitrates the cell** (firewall intact). |
| D11 | **Language coverage priority: Japanese primary, English fallback, other languages edge-only.** Enforced by weighted S0 quotas + LLM naming order, and **confirmed deterministically** against the real `languageCode`. | Amends §4.1 and the coverage plan. Reflects the JA-market product focus (UC-01). A song whose real `languageCode` disagrees with its cell target is discarded, never relabeled. |
| D12 | **`language` and `era` are promoted to first-class coverage axes** the plan explicitly targets and reports (language now cheap/deterministic via `languageCode`; era from `releaseDate`). | Layered onto the 36-cell grid as required spreads + reported dimensions, **not** additional multiplicative axes (same infeasibility argument as §4.1). |
| D14 | **Execution model: no LLM API — Claude Code orchestrates, deterministic stages are standalone CLIs.** LLM stages (S0.5, S1/S1b, S1.5, S7 profile composition, S8) are performed by an **interactive LLM in the Claude Code terminal** (the operator's session / agent, with its own web tools), **never** via an OpenAI / Anthropic / other LLM API — no API keys anywhere. Deterministic stages (S0, harvest, S2b resolver, S3–S6, S9, ledger) are **standalone Python CLIs** doing only non-LLM work (Soundcharts/MusicBrainz/Deezer HTTP, binning, validation, file I/O). A Claude Code skill **drives end-to-end**: it runs the CLIs via the terminal, does the LLM stages in-session, and manages file handoffs + the loop. | Adds §14 + a **file-handoff contract** per LLM stage (input schema → prompt template → output schema). The CLIs remain runnable in a bare terminal with no LLM/Claude Code (keeps the D5 reproducibility-transform test honest). Resolves the §12 "which generator LLM" question. |
| D13 | **Generation is loopable / resumable and purely additive.** A run is one loop; the operator inspects the output, then launches another loop that **continues without redoing prior work**. A persistent **carry-over ledger** (generation-side, gitignored) records every song identity ever touched (accepted or missed) so no name is re-proposed and no ISRC/UUID is re-resolved or re-fetched. Loops **never remove**; they fill still-empty cells **and may add further songs to already-covered cells to enrich them**. | Adds the carry-over ledger (§4.13) + ledger-relative coverage in S0 (§4.1). **Relaxes** the S3 selector's "one-per-cell, discard-when-full" rule to allow **multiple songs per cell**, still admitted purely by real-audio pigeonhole (firewall intact; no score, no label). Per-cell depth is a soft priority (empty → shallow → enrich); no hard cap. |

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
   blind.** Whichever candidate strategy runs, the LLM only *proposes* — where to search
   (Strategy A: S0.5/S1/S1.5) or which real songs to name (Strategy B: S1b) — but the
   real audio + deterministic binning decide the cell, and the real `languageCode`
   decides language. At labeling time (S8) the LLM assigns its label **before** the P6
   score is revealed, so the two evaluators stay independent and their disagreement
   remains a real signal.

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

A shared coverage plan feeds **one of two selectable candidate-acquisition strategies**
(D9), whose only job is to populate a **raw-response cache + lineage**. From that shared
boundary onward the pipeline is identical and fully deterministic: bin → select → map →
validate → freeze, then worlds, blind judge, and post-freeze contrast certification.
**The firewall lives at S3 (real audio + deterministic binning decides the cell); no
strategy touches it** — each strategy only *proposes* candidates.

```
S0    Coverage plan (deterministic)          — cells/spreads/pairs/quotas + language & era axes (JA-priority)
      │
      ├─ candidate_source = soundcharts_search  (Strategy A — original, retained) ───────────┐
      │   S0.5  LLM web-research (LLM)              — high-precision query/candidate seeds     │
      │   S1a   LLM search-strategist + Soundcharts SEARCH — broad candidate list (cheap)      │
      │   S1.5  LLM narrowing (LLM)                 — quota-bounded shortlist to fetch          │
      │   S2a   Harvester by UUID (deterministic)   — full metadata + audio; cache + lineage    │
      │                                                                                        │
      └─ candidate_source = isrc_resolved         (Strategy B — new, ISRC-first) ─────────────┤
          S1b   LLM cell→song naming (web-grounded) — real songs per cell; NO isrc/audio; evidence
          S2b   ISRC resolver (deterministic)       — (title,artist,year) → ordered candidate ISRCs
                                                       via MusicBrainz + Deezer, reconciled
          S2c   Harvester by-ISRC (deterministic)   — try candidates until populated audio;
                                                       languageCode/audio gates; cache + lineage
                                                                                               │
      ┌──────────────── shared boundary: raw-response cache + lineage ──────────────────────◄─┘
S3    Binner + Selector (deterministic)      — bin real audio to cells; pick coverage set + pairs
S4    Mapper (deterministic)                 — real record → synthetic Song
S5    Validator + Repair (deterministic)     — song_schema + §17 rules; 2-strike stop
S6    Freeze (deterministic)                 — manifest + dataset_hash; catalog immutable
S7    Worlds + real-grounded profiles (det. + LLM) — driver/traffic fixtures + coherent histories
S8    LLM judge (LLM, blind) → cross-check    — expected labels + agreement record
S9    P6 contrast certifier (deterministic)  — assert reversals; re-harvest failing cell
```

Strategy A stages are documented in §4.2–4.5; Strategy B stages in §4.5b. Both feed the
unchanged S3 (§4.6) onward. The whole pipeline runs as one **loop**; it is **resumable
and additive** across loops via a carry-over ledger so later loops never redo prior work
and can deepen coverage — see §4.13. Execution is **Claude Code-orchestrated with no LLM
API**: deterministic stages are standalone Python CLIs and the LLM stages are done by the
interactive agent in-session, file-mediated — see §14. (In the stage list below, "LLM"
means an interactive-agent stage, "deterministic" means a CLI.)

### 4.1 S0 — Coverage plan

Deterministic. **Ledger-relative (D13):** at the start of each loop, S0 loads the
carry-over ledger (§4.13), subtracts what is already accepted, and emits **remaining**
targets plus an **enrichment** priority for shallow/covered cells. Loop 1 sees an empty
ledger (everything is "remaining"); later loops target the gaps first, then deepen.
It emits the required targets:

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
- **Language axis (D11, JA-priority):** the plan targets **Japanese as the primary
  language**, English as fallback, other languages edge-only. Concretely: a weighted
  quota (majority of catalog songs `languageCode: ja`, a smaller EN cohort for
  cross-language contrast, ≤ a small cap of other languages). Language is **confirmed
  deterministically** against the real `languageCode` at harvest (S2a/S2c), never from
  an LLM claim.
- **Era axis (D12):** ≥3 eras (already a quota) promoted to an explicitly targeted and
  reported dimension, derived deterministically from `releaseDate`.

A full cross-product (`36 × ease × genre × language × era`) would be many thousands of
cells and is infeasible on limited quota, so karaoke-ease, genre, **language, and era**
are **required spreads + contrast pairs + reported dimensions layered onto the 36-cell
grid**, not additional multiplicative axes.

> **§4.2–4.5 below are Strategy A (`soundcharts_search`)** — the original approach,
> retained unchanged and available as a fallback. They run only when
> `candidate_source = soundcharts_search`. Strategy B is §4.5b.

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

### 4.5b Strategy B (`isrc_resolved`) — LLM naming → ISRC resolution → by-ISRC harvest

Runs only when `candidate_source = isrc_resolved`. Replaces S0.5/S1a/S1.5/S2a with three
stages that populate the **same** raw-response cache + lineage the binner (S3) consumes.
Soundcharts is never asked to *search* — only to return a song by a known ISRC.

**S1b — Cell → song naming (web-search-grounded LLM).** For each audio-band cell the
coverage plan still needs (JA-priority, D11), a **web-grounded LLM** proposes real songs.
Per candidate it emits `(title, artist, release_year, expected_language, why_fits_cell,
web_evidence[])`. Grounding does two jobs: **existence-verification** (kills hallucinated
songs before they cost a resolver/Soundcharts call) and **knowledge extension** (surfaces
niche/old/regional titles beyond the model's parametric memory — the point for
1960s-Japanese-type cells). The LLM **never emits an ISRC or an audio number**;
`why_fits_cell` is a *seed rationale*, not a decision, and lives only in lineage.

**S2b — ISRC resolver (deterministic, MusicBrainz + Deezer reconciled, D10).** Takes the
web-verified identity and queries **both** MusicBrainz (multi-ISRC-per-recording + release
dates) and the Deezer public API (one ISRC per track), merging into a **deduped, ordered
candidate-ISRC list** — original studio release first by date, remaster/regional after.
The richer S1b identity (exact artist + year) is what disambiguates re-releases. All
candidate ISRCs are written to lineage. No ISRC found by either source →
`song_not_found_in_sources`; try the LLM's next name.

**S2c — Harvester by-ISRC (deterministic).** Walk the candidate list, calling
`/api/v2.25/song/by-isrc/{isrc}` until one returns a **populated `audio` block**; cache
that raw response. Deterministic gates, in order:
- `audio` complete? else try next candidate ISRC.
- real `languageCode` matches the cell's target language (D11)? else **discard** (never
  relabel).
- none of the candidates hit → the named song is a **miss**; return to S1b for the next
  name for that cell.

**Fill loop & stop conditions.** The S0 coverage plan drives round-by-round: run
S1b→S2c for still-empty cells, telling the LLM which cells remain unfilled each round.
Bounded by a **Soundcharts + resolver quota budget** in the build report (MusicBrainz
~1 req/s; Deezer generous; Soundcharts against the metered quota). A cell still empty
after *N* rounds raises `cell_unfillable_from_source` (§9) — logged, never faked.

**Miss taxonomy (all logged; none individually fatal):**

| Miss | Cause | Handling |
|---|---|---|
| `song_not_found_in_sources` | MusicBrainz + Deezer return no ISRC | next LLM name |
| `isrc_not_in_soundcharts` | all candidate ISRCs 404 on `by-isrc` | next LLM name |
| `audio_unavailable` | Soundcharts record has null/partial audio | try next candidate ISRC, else next name |
| `language_mismatch` | real `languageCode` ≠ cell target (D11) | discard song |
| `wrong_cell` | real audio bins into a different cell | discard *for this cell*; S3 may still keep it for its actual cell if empty |

The last row is the firewall working: the LLM's guess never assigns the cell — the real
audio does. A "wrong" guess simply lands where its audio belongs, or is discarded if that
cell is full.

**Step-zero audio-coverage probe (hard gate for Strategy B).** Before running
`isrc_resolved` for real, execute one throwaway probe and record it in the build report:

- Hand-pick ~15 ISRCs spanning (old ↔ new) × (JA ↔ EN) × (mainstream ↔ niche).
- Fetch each via `by-isrc`; count how many return a **complete, non-null `audio` block**
  and a usable `languageCode`.
- **Decision rule:** the probe defines the achievable **era/region ceiling**. If, e.g.,
  1960s-JA tracks come back audio-null, the coverage plan **constrains those cells up
  front** (or accepts `cell_unfillable_from_source`) rather than discovering the gap
  mid-run. The probe also validates the full resolver chain (name → ISRC → audio) on a
  known set.

This is cheap insurance: the `isrc_resolved` strategy leans hardest exactly where audio
coverage is thinnest (old/regional catalog), so the ceiling must be measured before the
coverage plan commits to those cells.

**Firewall parity with Strategy A.** Neither the search terms (A) nor the web-grounded
names + `why_fits_cell` rationale (B) assign a cell. `languageCode` and audio bands are
read from the **real** response, not the LLM claim; `why_fits_cell`/`web_evidence` stay in
generation-side lineage and never enter the frozen `Song` record (catalog stays label-free,
§11). Blind-first judge ordering (S8) is untouched.

### 4.6 S3 — Binner + Selector (deterministic)

**Binner:** computes each real song's coverage coordinates by arithmetic on the real
audio — energy band, tempo band, profile family, `valence`/`mode`/`acousticness`,
**`humming_ease` and `full_karaoke_ease` bands** (from `danceability`↑,
`instrumentalness`↓, `speechiness`↓, `tempo`, `duration` — the same proxy math the P6
algorithm uses; this is audio arithmetic for *coverage*, **not** an `item_fit` score,
so the firewall holds), and genre tag.

**Selector:** keeps a scorecard and admits songs to satisfy coverage cells, secondary
spreads, quotas, and contrast pairs. **Cells may hold multiple songs (D13):** a song is
admitted if its cell is empty *or* is being enriched, and only skipped if it is a
ledger-known identity (dup) — never discarded merely because its cell already has one.
**Selection is by pigeonhole, never by score**, and the ledger exclusion is by identity,
never by score. (Pre-D13 single-pass behavior was "one per empty cell, discard when
full"; loops relax the discard so coverage deepens across passes.)

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
  writes the `genre_affinity_v1.artist_genres` using the **sub-first `real→12-vocab` map**
  (D7; full table in §13). The 12-term vocabulary itself is unchanged.

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
**re-harvest of that cell** — loop back to the active strategy's candidate step (A: S1
search; B: S1b naming) for a different real song — **never** number-tuning toward a
target score.

### 4.13 Loop model — carry-over ledger + resumable, additive generation (D13)

Generation runs as a **sequence of loops**. One loop is a full pass through the active
strategy (S0 → candidate stages → S3 → …). Between loops the operator inspects the
output and decides whether it is "enough"; if not, they launch another loop. Loops are
**purely additive** (no rejection, no removal) and **never redo prior work**.

**Carry-over ledger** — a persistent, generation-side, **gitignored** file (companion to
the raw-response cache) that survives across loop runs. One entry per song identity ever
touched, holding:

```yaml
- keys:                          # any that are known — used for dedup at different stages
    isrc: "JPXX01900123"         # primary key once resolved
    soundcharts_uuid: "7f3a9c…"  # once fetched
    normalized_name: "real band|night runner"   # title+artist, normalized — known at naming time
  outcome: accepted              # accepted | miss
  miss_reason: null              # e.g. audio_unavailable | isrc_not_in_soundcharts | language_mismatch (if miss)
  cell: HI                       # cell it filled/targeted (accepted only)
  loop: 1                        # which loop produced this entry
```

**How a loop uses the ledger:**

1. **S0 (ledger-relative coverage)** — subtract accepted entries to compute remaining +
   enrichment targets (§4.1).
2. **Exclusion at three stages** (prevents duplicate *search* and *processing*):
   - **S1b naming** — the LLM is given the ledger's names and instructed **not to
     re-propose** them (also applies to Strategy A's S1.5 shortlist).
   - **S2b resolver** — skip any `(title, artist)` already resolved; reuse the cached
     candidate ISRCs rather than re-querying MusicBrainz/Deezer.
   - **S2c harvest** — skip any ISRC/UUID already fetched; a known **miss** (e.g.
     `audio_unavailable`, `language_mismatch`, `isrc_not_in_soundcharts`) is **never
     retried**.
3. **Append** — every new result (accepted **and** miss, with reason) is written back to
   the ledger, so the next loop inherits the full history.

**Multiple songs per cell (D13).** Because loops enrich, the S3 selector admits more than
one song per cell (§4.6) — all by real-audio pigeonhole, none by score. Per-cell depth is
a **soft priority** (empty → shallow → enrich), with **no hard cap**; the operator ends
the sequence simply by not launching another loop.

**Freeze across loops.** S6 (freeze) produces a snapshot of the accumulated accepted
catalog at the moment it runs. Re-running freeze after a later loop supersedes the prior
snapshot; the **ledger + raw cache persist across freezes** and remain the resumable
state. The committed frozen snapshot is still the replay boundary for downstream
milestones (§5 unchanged).

**Firewall note.** The ledger keys and exclusion are **identity-based only** (ISRC, UUID,
normalized name) — never a score or an algorithm output — so resumability adds no
selection pressure the firewall would object to.

---

## 5. Reproducibility model

- **Non-reproducible (once):** the live Soundcharts harvest (Strategy A: S2a; Strategy
  B: S2c), the live ISRC resolver (Strategy B: S2b, MusicBrainz/Deezer), and the LLM
  stages (Strategy A: S0.5/S1/S1.5; Strategy B: S1b; plus S8). Fully captured by the
  **raw-response cache** + **frozen LLM plans/outputs** + **lineage file** (which for
  Strategy B also records all candidate ISRCs).
- **Deterministic + re-runnable:** the transform S3→S6 over the cached raw responses
  yields a **byte-identical catalog**. This is the reproducibility test target (D5). Under
  the loop model (§4.13) the transform is deterministic over the **accumulated** raw cache
  — i.e. the union of all loops' cached responses — so re-running the transform on the
  same accumulated cache reproduces the same catalog regardless of how many loops built it.
- The committed frozen dataset — not a rerun of the harvest — is the replay boundary
  for all downstream milestones.
- **No LLM API / no agent in the deterministic core (§14).** The transform CLIs run in a
  bare terminal with no LLM and no Claude Code present; the LLM stages' contribution is
  entirely captured in the frozen output files. So the reproducibility test replays the
  deterministic transform over cached data + frozen LLM outputs — no interactive agent
  required.

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

- **Raw-response cache** (Soundcharts payloads, keyed by UUID; Strategy B entries also
  carry the resolving ISRC).
- **Lineage file** (`synthetic-id → Soundcharts UUID + real name + real genre text`;
  Strategy B also records the resolved ISRC + all candidate ISRCs from MusicBrainz/Deezer).
- **Frozen LLM plans/outputs** (Strategy A: S0.5/S1/S1.5; Strategy B: S1b naming; plus S8)
  for auditability — these are the structured-output files of the §14 handoff.
- **Prompt templates + input/output JSON schemas** for each interactive-LLM stage (§14.2),
  committed so the LLM steps are reproducible and reviewable.
- **Carry-over ledger** (§4.13) — persistent across loop runs; every touched song identity
  (ISRC / UUID / normalized name) with outcome, miss reason, cell, and loop number. This is
  the resumable state that makes loop N+1 skip loop 1..N's work.
- **Build report** (repairs, quota usage, coverage checklist, agreement stats,
  `candidate_source` used, loop number, per-loop new-vs-skipped counts, and — Strategy B —
  the step-zero probe result + miss counts).

---

## 7. Worked example — one song, end to end

**Goal of the run:** fill the "strong song for a tired highway driver" test case,
plus its calm contrast partner (mountain-chill reversal test).

*This walkthrough shows **Strategy A** (`soundcharts_search`). Under **Strategy B**
(`isrc_resolved`) only S0.5–S2 differ: the LLM names "Night Runner" (web-grounded, no
ISRC), MusicBrainz+Deezer resolve its candidate ISRC(s), and `by-isrc` returns the same
raw record — after which S3 onward is byte-for-byte identical.*

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
# genre_affinity_v1: synthetic-artist-0003 → ["j-rock"]   (sub "j-rock" under root j-pop → j-rock; §13)
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
   S0–S9 pipeline as the P2 realization, **including the two selectable candidate-source
   strategies (`soundcharts_search` / `isrc_resolved`) and the ISRC-first pivot** (D9–D10).
8. **Data spec coverage (§10)** — add the **language coverage axis with Japanese-primary
   priority** (D11) and **era as a first-class reported dimension** (D12), both confirmed
   deterministically from the real `by-isrc` response (`languageCode`, `releaseDate`).
9. **Data spec provenance** — note the two external ISRC-resolution sources (MusicBrainz,
   Deezer public API) as generation-time-only dependencies of the `isrc_resolved`
   strategy; neither is persisted into the frozen catalog beyond the real ISRC (D6).

---

## 9. Error / status taxonomy

Additions to the data spec §22 codes:

| Code | Meaning |
|---|---|
| `soundcharts_harvest_failed` | search/metadata call failed or quota exhausted |
| `cell_unfillable_from_source` | no real song found to fill a required cell after re-harvest / *N* fill rounds |
| `genre_unmappable_to_vocabulary` | real genre has no controlled-vocab mapping (→ `missing_neutral`) |
| `lineage_integrity_failed` | a synthetic ID lacks a resolvable lineage entry |

Additions for the `isrc_resolved` strategy (§4.5b) — the first four are **per-candidate
miss signals** (logged, drive the fill loop, not run-fatal); `isrc_probe_gate_failed` is
a **pre-flight gate**:

| Code | Meaning |
|---|---|
| `song_not_found_in_sources` | MusicBrainz + Deezer returned no ISRC for the named song |
| `isrc_not_in_soundcharts` | all candidate ISRCs 404 on `by-isrc` |
| `audio_unavailable` | Soundcharts record for the ISRC has null/partial `audio` |
| `language_mismatch` | real `languageCode` ≠ the cell's target language (D11) |
| `isrc_probe_gate_failed` | step-zero audio-coverage probe (§4.5c) did not meet the minimum populated-audio threshold; Strategy B halts before the run |

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
  catalog song; no `item_fit` score consumed anywhere in S0–S6. **For both strategies**:
  `why_fits_cell`/`web_evidence`/search-terms never appear in a frozen `Song`; cell
  assignment derives only from real binned audio (§4.5b `wrong_cell` case).
- **Strategy-parity test:** a fixed raw-response cache produces a byte-identical catalog
  regardless of which `candidate_source` populated it (S3+ is strategy-agnostic).
- **Execution-model tests (D14 / §14):** each LLM stage's structured-output file validates
  against its schema before a downstream CLI consumes it; a malformed output is rejected
  (prompting an interactive re-run, not an API retry); the deterministic transform CLIs run
  to a byte-identical catalog over cached data + frozen LLM outputs **with no LLM/agent
  present**; no LLM API client or key appears anywhere in the generator code.
- **Loop / carry-over tests (D13):** loop 2 with a populated ledger re-proposes no
  ledger name, re-resolves no ledger `(title,artist)`, and re-fetches no ledger ISRC/UUID
  (dup prevention); a known miss is not retried; loop 2 fills remaining cells and may add
  to already-covered cells; the ledger is append-only across loops; transform over the
  accumulated cache stays byte-identical (§5).
- **ISRC resolver tests (Strategy B):** MusicBrainz+Deezer reconciliation dedupes by ISRC
  and orders original-release-first; candidate fallback advances on
  `isrc_not_in_soundcharts`/`audio_unavailable`; `song_not_found_in_sources` advances to
  the next LLM name. LLM output carrying an ISRC or audio number is rejected (D10).
- **Language-priority tests (D11):** JA-weighted quota met; `language_mismatch` discards
  (never relabels); language taken from real `languageCode`, not the LLM's `expected_language`.
- **Probe-gate test (§4.5c):** a probe below the populated-audio threshold raises
  `isrc_probe_gate_failed` and Strategy B does not proceed.
- **Blind-first enforcement test:** the LLM label is committed before the P6 score is revealed
  (label timestamp/order precedes score).
- **Two-evaluator stats:** agreement rate reported; disagreements routed to neutral fixtures or
  flagged findings.
- **Genre mapping tests (§13):** the `real→12-vocab` map is **total** (every `{root, sub}`
  resolves to one of the 12 terms or `missing_neutral`); **sub-overrides win over root-fallback**
  (e.g. `{root:j-pop, sub:city pop}` → `city pop`, not `j-pop`; `{root:soundtrack, sub:anime}`
  → `anime`); the 12-term vocabulary and `genre_affinity_v1` schema/enum are **unchanged**;
  `genre_affinity_v1` off reproduces the no-extension ranking exactly.
- **Lineage integrity test:** every synthetic ID resolves to a lineage entry.
- **Repair tests:** each §18 rule deterministic and logged; 2-strike stop raises
  `catalog_generation_failed`.

---

## 11. Build staging

One design doc; the implementation plan will likely stage the work:

- **P2a** — harvest → bin → map → validate → freeze catalog (S0–S6) + lineage/cache/manifest.
  Includes both candidate-source strategies behind the `candidate_source` flag (§4.2–4.5b),
  the step-zero probe gate (§4.5c), and the MusicBrainz/Deezer ISRC resolver (S2b).
- **P2b** — worlds + real-grounded profiles (S7) + the 15 base worlds and 12 contrast pairs.
- **P2c** — LLM judge + cross-check (S8) + P6 contrast certification (S9) + labeled test-case set.

---

## 12. Open questions deferred to the implementation plan

- Soundcharts auth, exact endpoints (song metadata, artist metadata,
  popularity/streaming, album), and response pagination. **`by-isrc` confirmed**
  (§1.1); search-by-metric is unavailable on the current subscription (drives D9).
- Quota budget size and per-run call ceiling; behavior on quota exhaustion (applies to
  both strategies; Strategy B additionally has MusicBrainz/Deezer rate limits).
- ~~The generator LLM: which model + web-search tool~~ — **RESOLVED: §14 / D14.** No LLM
  API; the LLM stages (incl. S1b grounded naming) are done by the **interactive agent in
  the Claude Code terminal** (its own web tools), driven by a Claude Code skill. No model
  pinned in code; the frozen output files are the reproducible record.
- Album / `available_markets` / `popularity` sourcing (real endpoint vs synthesized).
- ~~`duration` unit confirmation~~ — **RESOLVED: seconds** (§1.1 `by-isrc` probe).
- Audio-feature **coverage**: formalized as the **step-zero probe gate (§4.5c)** — must
  run and pass before Strategy B commits to old/regional cells (Spotify deprecated audio
  features Nov 2024; `languageCode` confirmed present in `by-isrc`).
- **Strategy B resolver specifics:** MusicBrainz vs Deezer query/matching heuristic
  (fuzzy title+artist+year), candidate-ISRC **ordering** rule (original-release-first),
  cross-source **reconciliation** (dedupe by ISRC; conflict handling), and per-source
  rate-limit/backoff.
- **Flag default:** which `candidate_source` is the run default, and whether a run may
  fall back A↔B per-cell when the primary strategy underfills.
- `isrc_resolved` fill-loop bound *N* (rounds *within* a single loop before
  `cell_unfillable_from_source`; distinct from the outer operator-driven loops of §4.13).
- **Loop model (§4.13):** the soft per-cell enrichment target/heuristic that prioritizes
  shallow cells; the normalized-name key format for ledger dedup; and freeze cadence
  across loops (freeze every loop vs. only on the final "enough" loop).
- Number of labeled test cases beyond the 12 required contrast pairs.
- ~~The `real genre → 12-vocab` mapping table contents.~~ — **RESOLVED: §13** (sub-first
  map over the 34 Soundcharts roots; vocabulary kept frozen at 12).

---

## 13. Genre mapping — real Soundcharts genres → `genre_affinity_v1` vocabulary

**Contract unchanged.** This map is a **P2 generation artifact only**. The
`genre_affinity_v1` vocabulary stays frozen at its 12 terms
(`j-pop · j-rock · city pop · anime · vocaloid · enka · children's music · classical ·
jazz · ambient · electronic · japanese folk`); no enum, JSON schema, algorithm (§5.7),
or P0.5/P6 spec changes. The map only decides, per real Soundcharts `{root, sub[]}`,
which frozen term (if any) an artist's genre resolves to when writing
`artist_genres` (§4.7).

**Resolution rule (total by construction):**
1. **Sub-override** — if any `sub` matches the sub-override table, use that term. Applied
   first because six vocab terms live as *subs* under generic/surprising roots.
2. **Root-fallback** — else map by `root` per the root table.
3. **Unmapped** — else `genre_unmappable_to_vocabulary` → the artist contributes no genre
   for that entry (`missing_neutral`, no weight redistribution — data spec §21.1).

A song's `G_song` is the union over its artists' resolved terms (unchanged).

### 13.1 Sub-overrides (win over root-fallback)

| Soundcharts `sub` (representative; case-insensitive) | → vocab term |
|---|---|
| `city pop` | `city pop` |
| `j-rock`, `anime rock`, `visual kei` | `j-rock` |
| `enka`, `kayokyoku` | `enka` |
| `anime`, `anime piano`, `otacore`, `precure`, `kamen rider`, `mecha`, `super sentai` | `anime` |
| `vocaloid`, `vocaloid metal`, `touhou`, `doujin` | `vocaloid` |
| `japanese folk`, `taiko`, `koto`, `shakuhachi`, `min'yō`, `japanese traditional` | `japanese folk` |

(`idol`, `shibuya-kei`, `japanese pop`, `japan`, `maidcore`, `honeyworks` carry no
sub-override and fall through to the `j-pop` root-fallback.)

### 13.2 Root-fallback (all 34 roots)

| Soundcharts `root` | → vocab term |
|---|---|
| `j-pop` | `j-pop` |
| `classical` | `classical` |
| `jazz` | `jazz` |
| `ambient` | `ambient` |
| `electro`, `edm`, `disco` | `electronic` |
| `kids` | `children's music` |
| `alternative`, `blues`, `c-pop`, `country`, `experimental`, `folk`, `funk`, `hip hop`, `holiday`, `indian pop`, `k-pop`, `latin`, `metal`, `others`, `pop`, `punk`, `r&b`, `reggae`, `religious`, `rock`, `ska`, `soul`, `soundtrack`, `spoken`, `sports`, `traditional` | `missing_neutral` |

### 13.3 Consequences (by design, not a gap)

- Only six roots (`j-pop`, `classical`, `jazz`, `ambient`, `electro`/`edm`/`disco`,
  `kids`) plus the sub-overrides resolve to a vocab term. Because the catalog is
  **JA-primary** (D11), most songs root as `j-pop` and resolve well; `classical`/`jazz`/
  `ambient`/`electronic`/`children's` cover common universal cases.
- **Western/other mainstream** (`pop`, `rock`, `hip hop`, `r&b`, `latin`, `k-pop`, …)
  resolves to `missing_neutral` — genre-affinity is a *Japanese-context* signal by design;
  those songs still compete fully on audio traits and the non-genre features. A broader
  vocabulary (universal buckets, `k-pop`, `idol`) was considered and **deferred** to avoid
  changing the frozen `genre_affinity_v1` contract; it would be a future `genre_affinity_v2`.
- The coverage plan (§4.1) still requires ≥1 artist per vocab term, which the JA-primary
  catalog satisfies (incl. `anime`, `vocaloid`, `enka`, `japanese folk`, `children's music`).

---

## 14. Execution model — Claude Code-orchestrated, no LLM API (D14)

The generator is deliberately **not** a program that calls an LLM API. It has two kinds of
stage with a **file handoff** between them, and **no OpenAI / Anthropic / other LLM API —
no API keys anywhere.**

### 14.1 Two stage types

- **Deterministic CLIs** (S0, S2a/S2b/S2c harvest + resolve, S3–S6, S9, ledger) —
  **standalone Python commands** the operator (or Claude Code via the terminal) runs.
  Non-LLM work only: Soundcharts/MusicBrainz/Deezer **HTTP** (these are *data-source* APIs,
  not LLM APIs — allowed), arithmetic binning, schema validation, freeze, file I/O. They
  run with **no LLM and no Claude Code present** — which is exactly what makes the D5
  reproducibility-transform test valid (re-run the transform over the cached data, no agent
  in the loop).
- **Interactive-LLM stages** (S0.5 web-research, S1/S1b naming, S1.5 narrowing, S7 profile
  composition, S8 blind judge) — performed by the **interactive LLM in the Claude Code
  terminal** (the operator's session / agent, which has its own web tools). No programmatic
  call; the "LLM" is the agent itself.

### 14.2 File-handoff contract (per LLM stage)

Each LLM stage is a triple:

```
input-context file (JSON, schema-checked)  →  prompt template  →  structured-output file (JSON, schema-checked)
```

- A deterministic CLI writes the **input-context file** (e.g. the unfilled cells + ledger
  exclusion list for S1b) and names the prompt to run.
- The Claude Code agent runs the prompt against that file and writes the **structured-output
  file** (e.g. `{title, artist, year, expected_language, why_fits_cell, web_evidence[]}[]`).
- The next CLI **validates** the output against its schema and consumes it. Malformed output
  → the agent simply **re-runs the prompt** (interactive repair) — there is no API retry
  loop. The LLM **never emits** ISRCs or audio values (D10).

These output files **are** the "frozen LLM plans/outputs" of §6.3 — capturing them is
automatic, and they are what make the LLM steps auditable and the run resumable.

### 14.3 Orchestration

A **Claude Code skill drives end-to-end**: it runs the deterministic CLIs via the terminal,
performs the interactive-LLM stages in-session, manages the file handoffs, and loops per the
carry-over-ledger model (§4.13). Because the CLIs are standalone, any of them can also be run
directly in a bare terminal for inspection, re-runs, or the reproducibility test — Claude
Code is one driver, not a hard dependency of the deterministic core.

**Committed artifacts (add to §6.3):** the **prompt templates** and the **input/output JSON
schemas** for each LLM stage, alongside the frozen output instances.
