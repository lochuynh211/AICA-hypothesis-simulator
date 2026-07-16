# Quickstart: P2 Music Dataset Generator (`mdg`)

Offline tooling that produces the frozen, Soundcharts-grounded, Spotify-compatible music dataset. The **committed frozen dataset is the replay boundary** — no simulation run ever calls the network or an LLM.

## Prerequisites

- Python 3.12 + `uv`.
- The generator is a separate repo-root package with a build-time path dependency on `aica-api` (for the frozen `Song` schema).
- Live harvest only: `export SOUNDCHARTS_APP_ID=… SOUNDCHARTS_API_KEY=…` (env-only; never committed/logged). MusicBrainz + Deezer need no credentials.

## Deterministic transform (no network, no agent) — the reproducibility path

```bash
cd music_dataset_generator
uv run python -m mdg transform --seed 42 \
  --workspace ../generation_workspace --dataset-dir ../proposal_contracts/dataset
```
Runs S3→S6 over the accumulated raw-response cache + committed frozen LLM outputs and writes the frozen catalog + `dataset_manifest` + `dataset_hash`. Running it twice yields **byte-identical** output (SC-001).

## Full generation loop (with the interactive agent driving)

The agent follows `RUNBOOK.md`; each LLM stage is a file handoff (see `contracts/llm-handoff.md`):
```bash
uv run python -m mdg plan --tier demonstration            # S0
uv run python -m mdg name --write-input                   # → handoff/s1b_input.json
#   (agent runs mdg/prompts/s1b_naming.md → writes handoff/s1b_output.json)
uv run python -m mdg name --read-output                   # validate CandidateNames
uv run python -m mdg resolve                              # S2b (MusicBrainz + Deezer, live)
uv run python -m mdg probe --isrcs fixtures/probe_isrcs.json   # S2c pre-flight (≥60% gate)
uv run python -m mdg harvest --candidate-source isrc_resolved  # S2c (live Soundcharts, min calls)
uv run python -m mdg transform --seed 42                  # S3–S6 freeze
uv run python -m mdg worlds --write-input && … --read-output   # S7 (post-freeze)
uv run python -m mdg judge  --write-input && … --read-output   # S8 (blind labels)
uv run python -m mdg certify                              # S9 (P6 reversal assertions)
uv run python -m mdg report                               # committed build report
```
Inspect the output, then run another **loop** (`plan` re-reads the ledger and targets only remaining/enrichment cells — no rework).

## Tests

```bash
cd music_dataset_generator
uv run pytest                 # deterministic suite (recorded fixtures; no network/agent)
uv run pytest -m live         # live probe + demo harvest (needs Soundcharts key)
```

## Milestone exit checks

1. `mdg transform` twice → identical catalog + hash.
2. `mdg certify` → all 12 contrast reversals hold.
3. `genre_affinity_v1` off reproduces the no-extension P6 ranking.
4. `cd app/api && uv run pytest tests/proposal` → P0.5/P6 suites still green (regression).
5. A live run recorded in `proposal_contracts/build_reports/`, real 36-song catalog frozen under `proposal_contracts/dataset/`.
