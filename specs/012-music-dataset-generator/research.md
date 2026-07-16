# Phase 0 Research: P2 — Synthetic Music Dataset Generation

All Technical Context unknowns are resolved below. Sources: `docs/master/p2-soundcharts-grounded-data-generation-design.md` (D1–D14, §1.1 API verification, §13 genre map), data spec §0/§10/§17, and the Step-2/Step-3 clarifications.

## R1 — Soundcharts access & endpoints

- **Decision**: Use the **`/api/v2.25/song/by-isrc/{isrc}`** endpoint (verified 2026-07-16) as the primary harvest call; it returns the complete `audio` block inline (all 12 P6-scored fields), `name`, `isrc`, `artists[]`, `releaseDate`, `duration` (**seconds**), `explicit`, structured `genres` `{root, sub[]}`, and **`languageCode`** — no separate audio/UUID call needed. Auth via env-only `SOUNDCHARTS_APP_ID` / `SOUNDCHARTS_API_KEY` headers. `popularity` is a separate endpoint → **synthesized** (R6) to save quota.
- **Rationale**: `by-isrc` is available on the current subscription and single-call; search-by-metric is not (drives the two-strategy design).
- **Alternatives**: search-by-metric (`/api/v2/top/songs`) — unavailable on subscription; used only by `soundcharts_search` which raises `strategy_unavailable` live.
- **Client**: `httpx` (already an `aica-api` dep) with retry/backoff and a quota counter; **no Soundcharts SDK** (avoids a network-blocked install; keeps the deterministic core dependency-light).

## R2 — ISRC resolution (MusicBrainz + Deezer)

- **Decision**: For each web-verified `(title, artist, year)`, query **MusicBrainz** (recording search → ISRCs + release dates; auth-free, ≤1 req/s, descriptive `User-Agent`) and the **Deezer public API** (track search → one ISRC; auth-free, generous), then **reconcile** into a deduped candidate-ISRC list **ordered original-release-first** by MusicBrainz release date. Match on NFKC-normalized `title|primary_artist` + release year ±1. All candidate ISRCs written to lineage. No ISRC from either → `song_not_found_in_sources`.
- **Rationale**: two independent free sources maximize recall; original-release-first ordering biases toward the canonical studio recording; year ±1 disambiguates re-releases.
- **Alternatives**: single-source (lower recall / no cross-check); AcoustID/fingerprint (needs audio we don't have) — rejected.

## R3 — Firewall / coverage-driven selection

- **Decision**: The **real audio + deterministic binning decide the cell**; the real `languageCode` decides language. LLM output is a *proposal* only; `why_fits_cell`/`web_evidence`/search terms live in gitignored lineage and never enter a frozen `Song`. No score/rank/label/target enters S0–S6. The catalog carries no `recommended`/`best_for_world`/`target_rank`. Blind-first: the S8 LLM label is committed before the P6 score is revealed; freeze (S6) precedes any world judgment (S8).
- **Rationale**: P2 exists to *test* the algorithm, so data must not be engineered toward its output (data spec §11/§17.6).
- **Alternatives**: LLM-picks-by-fit — rejected (destroys recommendation-independence).

## R4 — Genre mapping (sub-first, frozen 12-vocab)

- **Decision**: Deterministic **total** map: (1) sub-override table wins (e.g. `{j-pop, city pop}`→`city pop`, `{soundtrack, anime}`→`anime`); (2) else root-fallback (34 roots) — only `j-pop`/`classical`/`jazz`/`ambient`/`electro|edm|disco`→`electronic`/`kids`→`children's music` resolve; (3) else `genre_unmappable_to_vocabulary` → `missing_neutral` (no weight redistribution). Song `G_song` = union over artists' resolved terms. Seeded/validated against `others/soundchart_song_genres.json` (34 roots). The 12-term vocabulary and `genre_affinity_v1` schema are **unchanged** (generation artifact only).
- **Rationale**: six vocab terms live as subs under generic roots → the map must be sub-aware; keeping the vocab frozen avoids any contract change.
- **Alternatives**: root-only map (misses city pop/anime/vocaloid/enka/japanese folk); expanding the vocab (would be `genre_affinity_v2`, deferred).

## R5 — Execution model (no LLM API)

- **Decision**: Deterministic stages are standalone `python -m mdg <stage>` CLIs doing only non-LLM work (data-source HTTP, binning, validation, freeze, file I/O), runnable with **no LLM and no agent present**. LLM stages (S0.5, S1/S1b, S1.5, S7 profile composition, S8) are done by the **interactive agent** via a committed **file-handoff triple** (schema-checked input-context JSON → committed prompt template → schema-checked structured-output JSON). Malformed output → agent re-runs the prompt (interactive repair; no API retry). The LLM never emits an ISRC or audio number.
- **Rationale**: keeps the D5 reproducibility-transform test valid (no agent in the deterministic loop) and avoids any LLM API key.
- **Alternatives**: programmatic LLM API — rejected (D14: no keys; breaks the offline determinism guarantee).

## R6 — Synthesized fields (album / markets / popularity)

- **Decision**: Synthesize deterministically what Soundcharts lacks — `album` wrapper from `releaseDate`; `disc_number`/`track_number`; `available_markets` (`[JP]` standard; restricted variants for negative fixtures); `is_playable`/`is_local` (+ negative-fixture `restrictions`/`is_playable:false`); **`popularity` synthesized** (deterministic from stable inputs, seeded), not fetched.
- **Rationale**: conserve Soundcharts quota; these are exactly the eligibility negative-fixtures the data spec already tells us to fabricate.
- **Alternatives**: fetch popularity/markets live — rejected (extra quota, no verification value).

## R7 — Reproducibility & `random_seed` scope

- **Decision**: Only the **transform** (accumulated raw cache + frozen LLM outputs → catalog) is guaranteed byte-identical, independent of loop count and `candidate_source`. The live harvest is captured (raw cache + lineage + ledger + frozen LLM outputs) but not itself reproducible (D5). **`random_seed` pins** synthetic-ID allocation order, selection tie-breaks among equally-eligible songs, and negative-fixture placement (clarification).
- **Rationale**: makes "same cache + same seed → byte-identical" a hard, testable guarantee while accepting live-API non-determinism.
- **Alternatives**: seed-only-ID or seed-unused — rejected (weaker guarantee / sensitive to cache ordering).

## R8 — Packaging & dependency direction

- **Decision**: Separate repo-root package `music_dataset_generator` (import root `mdg`) with its own `pyproject.toml`; a **one-way** build-time path dependency **generator → aica-api** to import the frozen `Song` schema (no duplication); P6 loaded by file path. The runtime API never imports the generator.
- **Rationale**: generator is offline tooling, not runtime scope (FR-030); reusing the one frozen contract satisfies the constitution's single-contract rule.
- **Alternatives**: inside `aica_api` (rejected — user directive, scope leak); fully standalone with a copied schema (rejected — duplicate contract).

## R9 — Coverage, language split & probe gate

- **Decision**: 36 cells = energy(3)×tempo(3)×profile(4); secondary spreads (valence/mode/acousticness/humming_ease/full_karaoke_ease/genre) + language + era as reported dimensions layered on the 36 (not multiplicative). **Language split ~30 JA / ~6 EN / 0 other** across the 36 standard songs (clarification). Step-zero probe (~15 ISRCs) must have **≥60% (≥9/15)** return complete audio + usable `languageCode`, else `isrc_probe_gate_failed` (clarification). Fill-loop bound **N=3** per cell before `cell_unfillable_from_source`.
- **Rationale**: quota-feasible; JA-market focus with cross-language contrast; measures the era/region audio ceiling before committing to thin cells.
- **Alternatives**: full cross-product (infeasible on quota); other JA/EN splits and probe thresholds (considered in clarification).

## R10 — Loop / carry-over ledger

- **Decision**: Persistent gitignored ledger keyed by ISRC / Soundcharts UUID / NFKC `title|primary_artist`, one entry per touched identity (accepted|miss + reason, cell, loop). Loops are additive, ledger-relative in S0, exclude ledgered names/ISRCs/UUIDs at naming/resolve/harvest, never retry known misses. Multiple songs per cell allowed by pigeonhole (soft depth priority empty→shallow→enrich, no hard cap). Freeze is an explicit CLI step superseding the prior snapshot; ledger+cache persist.
- **Rationale**: incremental harvest against limited quota without redoing work; identity-only keys add no selection pressure the firewall objects to.
- **Alternatives**: single-shot generation (wastes quota / no resume); score-aware dedup (rejected — firewall).

## Open items deferred to implementation detail (non-blocking)

- Exact `stress`-tier default size (caller-specified; default documented in RUNBOOK).
- Number of labeled test cases beyond the 12 required pairs (natural yield from the 36-song catalog).
- Per-source rate-limit/backoff constants (MusicBrainz ≤1 req/s fixed; others tuned in the client).
