# P2 — Synthetic Music Dataset Generation & Validation — Implementation Design

**Date:** 2026-07-16
**Milestone:** P2 (from `docs/master/aica_proposal_simulator_milestones.md` §4)
**Status:** Approved (brainstorming complete) — precedes SpecKit `speckit-specify`.
**Authoritative design source (the *what*):** `docs/master/p2-soundcharts-grounded-data-generation-design.md` (S0–S9 pipeline, D1–D14) and data spec §0.
**This document (the *how*):** the implementation realization for *this* codebase — module layout, contracts, execution, and test strategy. It does not re-decide the pipeline; it maps the approved pipeline onto concrete files, run commands, and tasks.
**Depends on (present & merged on `develop`):** P0.5 frozen `Song` schema (`app/api/aica_api/models/proposal/song_schema.py`, merged `415a99b`), P6 content selector package (`packages/aica_transparent_content_selector_v1/`, `evaluate(context)->dict`, merged `5151ed4`).

---

## 1. Goal & customer-visible outcome

Deliver the **offline tooling** that produces the shared, Spotify-compatible music dataset every later proposal milestone consumes — grounded in **real song data harvested from the Soundcharts API** and mapped into the frozen synthetic `Song` schema. Reviewers get a catalog they trust: **real song/artist names + verbatim real audio-feature values**, while every ID is `synthetic-…` and every URL is on `.invalid`. Alongside the label-free catalog, P2 emits a **labeled test-case set** (`(world, candidate, expected label)` triples) where an interactive LLM judges the label **blind** and the P6 score is a **cross-check**.

The **committed, frozen dataset — not a rerun of the harvest — is the replay boundary.** No transparent simulation run ever calls Soundcharts, the web, or an LLM.

## 2. Scope decisions taken in brainstorming

| # | Decision |
|---|---|
| B1 | **Full tooling + fixture-driven E2E.** Build all S0–S9 deterministic CLIs + schemas/validators/repair/freeze/ledger/genre-map/worlds/judge/certify. The deterministic transform and every gate are proven on **committed recorded raw-response fixtures** so they run with no network/agent — this is the D5 reproducibility boundary. |
| B2 | **Live run in this milestone:** the step-zero audio-coverage probe **plus the full 36-song `demonstration` harvest**, run live with the operator-supplied Soundcharts key. MusicBrainz + Deezer run live (auth-free). **Minimize live Soundcharts calls** (limited quota). |
| B3 | **Both `candidate_source` strategies fully implemented.** `isrc_resolved` is the default and is exercised live. `soundcharts_search` is fully coded but its search-by-metric endpoint is off-subscription, so it is tested only against recorded/mocked search fixtures and raises `strategy_unavailable` on a live search call. |
| B4 | **Separate repo-root package `music_dataset_generator/` (import root `mdg`)** — NOT under `app/api/aica_api/`. The generator is offline tooling, not runtime API scope. |
| B5 | **One-way build-time dependency generator → aica-api**, solely to import the frozen `Song` schema (no schema duplication — the constitution requires one contract). The API never imports the generator. The P6 certifier loads `algorithm.py::evaluate` **by file path** (the backend `python_module` mechanism), so no import coupling there. |
| B6 | **Packaged orchestration skill deferred (YAGNI).** A committed `RUNBOOK.md` documents the exact CLI + LLM-handoff sequence; the CLIs are standalone (required by D5 anyway). A Claude Code skill that automates the loop is a later convenience, not a V1 exit criterion. |
| B7 | **No Soundcharts SDK dependency.** Use `httpx` (already an aica-api dep) for the Soundcharts client — avoids a network-blocked install and keeps the deterministic core dependency-light. |

## 3. Module layout

```
music_dataset_generator/                (repo root — separate package)
  pyproject.toml                         deps: pydantic, httpx; [tool.uv.sources] aica-api = {path="../app/api", editable=true}
  README.md
  RUNBOOK.md                             exact CLI + LLM-handoff order (B6)
  mdg/
    __init__.py                          GENERATOR_VERSION, PROMPT_TEMPLATE_VERSION, VALIDATION_RULES_VERSION
    cli.py                               argparse dispatcher: `python -m mdg <stage> …`
    models.py                            Pydantic: DatasetManifest, LineageEntry, LedgerEntry, TestCase, BuildReport, CoveragePlan, CoverageCell
    errors.py                            typed generation error codes (design §9 + data spec §22)
    coverage/plan.py                     S0 — ledger-relative coverage plan (cells/spreads/pairs/quotas + language & era axes, JA-priority)
    sources/
      soundcharts.py                     by-isrc + by-uuid + search HTTP client (httpx; key from env; quota counter)
      musicbrainz.py                     ISRC lookup (auth-free; ≤1 req/s; descriptive User-Agent)
      deezer.py                          ISRC lookup (auth-free)
      resolver.py                        S2b — MusicBrainz+Deezer reconcile → ordered candidate-ISRC list
    harvest/
      by_isrc.py                         S2c — walk candidate ISRCs → populated audio; language/audio gates
      by_uuid.py                         S2a — Strategy A harvest
      search.py                          S1a — Strategy A search (raises strategy_unavailable on live call)
      cache.py                           raw-response cache + lineage read/write
    binner.py                            S3 — real audio → coverage coords (energy/tempo/profile/valence/mode/acoustic/humming_ease/full_karaoke_ease/genre)
    selector.py                          S3 — pigeonhole admission (multi-per-cell, ledger dedup, no score)
    mapper.py                            S4 — real record → Song (imports frozen aica_api Song schema)
    genre_map.py                         §13 sub-first real→12-vocab map (seeded from others/soundchart_song_genres.json)
    validator.py                         S5 — Song schema + data-spec §17 rules
    repair.py                            S5 — §18 deterministic repairs, 2-strike stop
    freeze.py                            S6 — dataset_manifest + dataset_hash; immutable snapshot
    worlds.py                            S7 — 15 base worlds + 12 contrast pairs + real-grounded profiles
    judge.py                             S8 — blind-label ingestion + P6 cross-check (label committed before score)
    certify.py                           S9 — run P6 evaluate() over contrasts, assert reversals; re-harvest on failure
    ledger.py                            carry-over ledger (identity-keyed: isrc / uuid / normalized name)
    handoff.py                           file-handoff: write input-context JSON, validate LLM structured-output vs schema
    prompts/                             COMMITTED prompt templates + input/output JSON schemas per LLM stage
  tests/                                 generation suite; deterministic (recorded fixtures) + @pytest.mark.live
    fixtures/                            committed small real by-isrc payloads + coverage/ledger fixtures
```

### 3.1 Artifact placement

- **Committed — replay boundary + audit:**
  - Frozen catalog + `dataset_manifest` → `proposal_contracts/dataset/<dataset_id>/`.
  - Labeled test-case set → `proposal_contracts/test_cases/`.
  - Prompt templates + input/output JSON schemas + **frozen LLM output instances** + build report → committed (reproducibility & audit; design §6.3 / §14.3).
  - Small recorded raw-response fixtures used by deterministic tests → `music_dataset_generator/tests/fixtures/`.
- **Gitignored — generation-side, bulky/real payloads (new `.gitignore` entry `generation_workspace/`):**
  - Full raw-response cache, lineage file, carry-over ledger. These are the resumable state; the committed transform reproduces the catalog from them.
- **Config:** add `AICA_GENERATION_WORKSPACE_DIR` (default repo-root `generation_workspace/`) and `AICA_PROPOSAL_DATASET_DIR` (default `proposal_contracts/dataset/`) to `app/api/aica_api/config.py`, following the existing `AICA_*_DIR` pattern (so the app can later locate the frozen dataset in P3). The generator reads its workspace path from the same env var or a CLI flag.
- **Credentials:** Soundcharts key via env only (`SOUNDCHARTS_APP_ID` / `SOUNDCHARTS_API_KEY`). **Never committed, logged, echoed, or placed in any artifact, manifest, lineage, or build report** (constitution BYO-key rule). MusicBrainz/Deezer need none.

## 4. Data flow & firewall

```
S0 coverage plan (ledger-relative) ─► LLM S1b names songs (in-session; web-grounded; NO isrc/audio)
   handoff: {unfilled cells + ledger exclusions} JSON ─► {title,artist,year,expected_language,why_fits_cell,web_evidence[]} JSON
S2b resolver (MusicBrainz + Deezer, live, auth-free) ─► ordered candidate ISRCs (+ all written to lineage)
S2c by-isrc harvest (live Soundcharts, min calls) ─► raw cache + lineage
   gates in order: audio complete? → languageCode == cell target? → else next candidate / next name
        └────────── shared boundary: raw-response cache + lineage ──────────┘   (Strategy A S0.5/S1a/S1.5/S2a terminate here too)
S3 bin + select  (deterministic; REAL AUDIO decides the cell — FIREWALL; multi-per-cell; ledger dedup)
S4 map → Song    (real names + verbatim audio kept; synthetic IDs/URLs; timeSignature→time_signature; duration→ms)
S5 validate + repair  (frozen Song schema + §17 rules; §18 repairs; 2-strike → catalog_generation_failed)
S6 freeze  (dataset_manifest + dataset_hash; catalog immutable)
S7 worlds + real-grounded profiles  (15 base worlds + 12 contrast pairs)
S8 LLM blind judge (label committed) ─► reveal P6 score ─► record agreement
S9 P6 certifier  (run evaluate() over contrasts; assert required reversals; re-harvest failing cell — never number-tune)
```

**Firewall invariants (enforced in code + tests):** no score / rank / label / target enters S0–S6; cell assignment derives only from binned real audio (`wrong_cell` guesses land where their audio belongs or are discarded); `why_fits_cell` / `web_evidence` / search terms never reach a frozen `Song`; catalog carries no `recommended` / `best_for_world` / `target_rank`; the S8 LLM label is committed **before** the P6 score is revealed (ordering test); catalog freeze (S6) precedes any world judgment (S8).

## 5. LLM-stage execution (this session)

The interactive-LLM stages (S0.5 web-research, S1b naming, S1.5 narrowing, S7 profile composition, S8 blind judge) are performed **by the interactive agent in-session** using its web tools — **no LLM API, no keys** (D14). Each stage is the committed **file-handoff triple**: a deterministic CLI writes a schema-checked *input-context* JSON → the agent runs the committed *prompt template* → the agent writes a schema-checked *structured-output* JSON → the next CLI validates and consumes it. Malformed output ⇒ the agent re-runs the prompt (interactive repair; no API retry). The output files are the frozen, committed LLM artifacts and make the run resumable/auditable. The agent **never emits** an ISRC or an audio number (D10).

## 6. Deferred §12 defaults (locked here)

- `candidate_source` **default = `isrc_resolved`**; both strategies built (B3).
- **Resolver:** dedupe by ISRC; order **original-release-first** by MusicBrainz release date; match on NFKC-normalized `title|primary_artist` + release year ±1; MusicBrainz ≤1 req/s + descriptive User-Agent; Deezer best-effort.
- **Fill-loop bound N = 3** rounds per cell within a loop before `cell_unfillable_from_source`.
- **Ledger key:** `nfkc(lower(strip(title)))|nfkc(lower(strip(primary_artist)))`, plus ISRC and Soundcharts UUID once known.
- **Freeze cadence:** explicit `freeze` CLI step; each freeze supersedes the prior committed snapshot; ledger + raw cache persist across freezes.
- **Album / markets / popularity:** synthesized deterministically — `album` from `releaseDate`; `available_markets` fabricated (`[JP]` for standard, restricted variants for negative fixtures); **`popularity` synthesized** (no extra Soundcharts call, to conserve quota).
- **Test-case count:** the 12 required contrast pairs + whatever converge/neutral cases the 36-song catalog naturally yields (no fixed extra quota).
- **A↔B per-cell fallback:** out of scope (YAGNI).

## 7. Build staging (drives SpecKit tasks in Step 3)

- **P2a — catalog (S0–S6):** coverage plan; both candidate strategies; resolver; harvest; cache/lineage/ledger; binner/selector; mapper; genre-map; validator/repair; freeze; manifest/hash; error taxonomy. Live: step-zero probe + full 36-song `demonstration` harvest. Also: `smoke` (5 valid + negatives) and `stress` (configurable) tiers.
- **P2b — worlds (S7):** 15 base worlds + 12 one-variable contrast pairs + real-grounded histories/oshi/usage_by_genre profiles.
- **P2c — judge & certify (S8–S9):** blind LLM judge + cross-check + labeled test-case set; P6 contrast certification (reversal assertions via `evaluate()`); blind-first ordering; agreement stats.

## 8. Master-doc reconciliation

The master docs **already describe the P2 Soundcharts-grounded approach** (data spec §0, milestone §4, the authoritative P2 design doc). This implementation design adds only *code-location* and *execution* detail that does not change any algorithm/spec contract, so **no master-doc edit is required at design-approval time.**

The substantive amendments enumerated in the P2 design **§8** (relax "all names fictional"; new `dataset_kind: soundcharts_grounded_spotify_compatible` + `synthetic_only: false`; relax §17.3 for names/ISRC; re-scope §19/§23.4 determinism; add the genre map + `genre_unmappable_to_vocabulary`; add the labeled test-case artifact; language/era coverage axes; MusicBrainz/Deezer generation-time provenance) are applied **at freeze during implementation (Steps 4–5)**, so the master docs and the actual frozen manifest/validator move together and stay honest.

## 9. Test strategy & milestone exit

TDD throughout (Step 4). New suite under `music_dataset_generator/tests/`. Deterministic tests consume **committed recorded raw-response fixtures** (no network, no agent). Live tests are `@pytest.mark.live`, skipped by default.

Gate coverage (design §10 + milestone §4 verification focus): reproducible-transform (byte-identical); coverage/quota (36 cells, secondary spreads, artist/era/explicit/negative quotas); schema/identity (`synthetic-` IDs, `.invalid` URLs, cross-object identity, real names/ISRC accepted); firewall-structural (no label/score fields; cell from real audio only); strategy-parity (fixed cache → identical catalog regardless of `candidate_source`); loop/carry-over (no re-propose/re-resolve/re-fetch; misses not retried; additive); resolver (dedupe + original-release-first; candidate fallback); language-priority (JA quota; `language_mismatch` discards, never relabels; language from real `languageCode`); probe-gate (`isrc_probe_gate_failed` below threshold); genre-map (total; sub-overrides beat root-fallback; off reproduces no-extension ranking); repair (each rule deterministic; 2-strike stop); blind-first ordering; contrast reversals via P6.

**Exit demonstration:**
1. `cd music_dataset_generator && uv run pytest` — full deterministic suite green.
2. `python -m mdg transform --cache <generation_workspace/cache>` → **byte-identical** frozen 36-song catalog + manifest + `dataset_hash`.
3. P6 `evaluate()` certifies all **12 contrast reversals** (S9).
4. `genre_affinity_v1` off reproduces the no-extension ranking exactly.
5. A **live run** (probe + demo harvest) recorded in the committed build report, with the real 36-song catalog frozen into `proposal_contracts/dataset/`.
6. Existing `app/api/tests/proposal` P0.5/P6 suites still green (regression gate); trigger simulator untouched.
7. P2 design §8 master-doc amendments applied at freeze.

## 10. Risks & mitigations

- **Live Soundcharts quota** — mitigate via the step-zero probe (measures era/region audio ceiling before committing cells), LLM narrowing/naming precision, popularity synthesized (no extra call), and the carry-over ledger (never re-fetch). Full 36-song harvest budget tracked in the build report.
- **Old/regional (e.g. 1960s-JA) audio gaps** — the probe constrains those cells up front; an unfillable cell raises `cell_unfillable_from_source` (logged, never faked).
- **`soundcharts_search` unexercisable live** — coded + fixture-tested; live search raises `strategy_unavailable`. Documented as fallback.
- **Determinism vs. live APIs** — only the transform (cache → catalog) is guaranteed byte-identical; the live harvest is captured (cache + frozen LLM outputs + lineage + ledger) but not itself reproducible (D5). The committed dataset is the replay boundary.
