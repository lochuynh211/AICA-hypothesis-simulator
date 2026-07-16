# RUNBOOK — `mdg` Soundcharts-grounded music dataset generation

Offline, loopable generation of the frozen Spotify-compatible catalog. Deterministic
stages are standalone CLIs; **LLM stages are performed by the interactive agent in the
Claude Code terminal** via file handoffs (design §14) — no LLM API, no keys.

The **committed frozen dataset is the replay boundary**: no simulation run ever calls the
network or an LLM. The deterministic transform runs with no agent present.

## Prerequisites

- Python 3.12 + `uv`. From `music_dataset_generator/`.
- Live harvest only: `export SOUNDCHARTS_APP_ID=… SOUNDCHARTS_API_KEY=…` (env-only, never
  committed/logged). MusicBrainz + Deezer need no credentials.
- Default `candidate_source` is `isrc_resolved` (the `soundcharts_search` search-by-metric
  endpoint is unavailable on the current subscription → `strategy_unavailable`).

## One generation loop (Strategy B, `isrc_resolved`)

Deterministic CLI steps are marked `[CLI]`; interactive-agent handoffs `[AGENT]`.

```bash
uv run python -m mdg plan --tier demonstration            # [CLI] S0 → coverage_plan.json (ledger-relative)
uv run python -m mdg name --tier demonstration --write-input   # [CLI] → handoff/s1b_input.json
#   [AGENT] run mdg/prompts/s1b_naming.md over s1b_input.json → write handoff/s1b_output.json
uv run python -m mdg name --tier demonstration --read-output   # [CLI] validate → candidate_names.json (FR-005 firewall)
uv run python -m mdg resolve                              # [CLI] S2b MusicBrainz+Deezer → resolved_candidates.json
uv run python -m mdg probe --isrcs <isrcs.json>          # [CLI] S2c pre-flight (≥60% populated-audio gate)
uv run python -m mdg harvest --candidate-source isrc_resolved  # [CLI] S2c → cache/ + lineage.json + ledger.json
uv run python -m mdg transform --seed 42 --tier demonstration  # [CLI] S3–S6 → frozen catalog + manifest + hash
uv run python -m mdg worlds --write-input                # [CLI] S7 → handoff/s7_input.json (frozen catalog IDs)
#   [AGENT] compose coherent histories/oshi grounded to those IDs → handoff/s7_output.json
uv run python -m mdg worlds --read-output                # [CLI] build + validate worlds.json + contrast_pairs.json
uv run python -m mdg judge --write-input                 # [CLI] S8 → handoff/s8_input.json
#   [AGENT] assign positive/negative/neutral BLIND (no score) → handoff/s8_output.json
uv run python -m mdg judge --read-output                 # [CLI] reveal P6 score, record agreement → test_cases.json
uv run python -m mdg certify                             # [CLI] S9 load P6 evaluate; assert 12 reversals
uv run python -m mdg report --tier demonstration         # [CLI] → proposal_contracts/build_reports/build_report.json
```

Inspect the output, then run **another loop**: `plan` re-reads the ledger and targets only
remaining/enrichment cells; harvest skips ledger-known identities and misses (no rework,
no wasted quota). Loops are additive; freezing a later loop supersedes the prior snapshot.

## The reproducibility path (no network, no agent)

```bash
uv run python -m mdg transform --seed 42 \
  --workspace ../generation_workspace --dataset-dir ../proposal_contracts/dataset \
  --generated-at 2026-07-16T00:00:00Z
```
Runs S3→S6 over the accumulated raw cache; running it twice yields a **byte-identical**
catalog + `dataset_manifest` + `dataset_hash` (SC-001). `--generated-at` is operator-supplied
so the deterministic core never reads the wall clock.

## Firewall (never violate)

- No score/rank/label/target enters S3–S6; the cell is decided by binned **real audio**,
  never an LLM guess. `why_fits_cell`/`web_evidence` stay in lineage, never in a `Song`.
- The frozen catalog is label-free (no `recommended`/`best_for_world`/`target_rank`).
- LLM outputs never carry an ISRC or audio number (S1b) or a score (S8, blind-first).
- Soundcharts credentials are read from the environment only and never written to any
  committed artifact.

## Tests

```bash
uv run pytest              # deterministic suite (recorded fixtures; no network/agent)
uv run pytest --run-live   # live probe + harvest smoke (needs Soundcharts key)
```
