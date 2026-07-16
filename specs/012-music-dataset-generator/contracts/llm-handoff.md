# LLM File-Handoff Contract (per interactive-LLM stage)

Each LLM stage is a triple: a deterministic CLI writes a **schema-checked input-context** JSON → the interactive agent runs the committed **prompt template** → the agent writes a **schema-checked structured-output** JSON → the next CLI validates and consumes it. Malformed output ⇒ the agent re-runs the prompt (no API retry). The agent **never emits an ISRC or an audio-feature number**. All templates + I/O JSON schemas + output instances are **committed** (`mdg/prompts/`, `generation_workspace/handoff/`).

## S1b — Cell → song naming (web-grounded)

**Input** `s1b_input.json`:
```json
{ "unfilled_cells": [{"cell_id": "E-hi_T-hi_P-balanced-vocal", "energy_band":"high","tempo_band":"high","profile_family":"balanced_vocal","target_language":"ja"}],
  "language_targets": {"ja": 30, "en": 6, "other": 0},
  "exclude_names": ["real band|night runner"],   // ledger normalized names
  "per_cell_target": 3 }
```
**Output** `s1b_output.json` (array of CandidateName):
```json
[{ "title":"…","artist":"…","release_year":2019,"expected_language":"ja",
   "target_cell_id":"E-hi_T-hi_P-balanced-vocal","why_fits_cell":"…","web_evidence":["https://…"] }]
```
**Reject** if any item contains an `isrc` or an audio key (`energy`,`tempo`,`valence`,…), or an excluded name (FR-005/024).

## S0.5 / S1a / S1.5 — Strategy A (search seeds / queries / narrowing)

Same triple shape; outputs are query seeds / Soundcharts search queries / a quota-bounded shortlist of `CandidateName`. No ISRC/audio. Used only when `candidate_source=soundcharts_search`.

## S7 — Profile composition

**Input**: frozen catalog summary (artist IDs + real names + genres + eras) + the base-world/contrast skeletons.
**Output**: coherent per-world history/oshi/`usage_by_genre` referencing **catalog IDs only** (validated → `world_reference_failed` on a bad ref). No new songs invented.

## S8 — Blind judge

**Input** `s8_input.json` (per `(world, candidate)`): world context + candidate song's real name/genre/era — **no P6 score**.
**Output** `s8_output.json`: `{ expected_label, judge_folds{context_need,mood_genre_fit,era_cultural_fit,coherence,web_evidence} }`.
**Ordering guarantee (SC-009)**: the output file (label) is committed **before** the `certify`/score-reveal step reads it; the judge input carries no score.

## Reproducibility note

These committed output files ARE the frozen LLM plans/outputs of the design §6.3. The `transform`/`certify` CLIs consume them with no agent present, which keeps the deterministic-transform reproducibility test valid.
