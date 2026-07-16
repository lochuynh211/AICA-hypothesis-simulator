# CLI Command Contract — `python -m mdg <stage>`

The generator exposes one CLI with per-stage subcommands. Deterministic stages run with **no network/LLM/agent** unless they call a data-source API (harvest/resolve). Every command takes `--workspace <dir>` (default `AICA_GENERATION_WORKSPACE_DIR` / `generation_workspace/`) and writes/reads within it; freeze/test-case commands also take `--dataset-dir` (default `proposal_contracts/dataset`). Exit code `0` = success; non-zero = a typed error from the taxonomy (printed as `{"error": "<code>", "detail": …}`).

| Subcommand | Stage | Network? | Inputs | Outputs |
|---|---|---|---|---|
| `plan --tier <smoke\|demonstration\|stress> [--stress-size N]` | S0 | no | ledger, tier | `coverage_plan.json` (remaining + enrichment) |
| `name --write-input` | S1b prep | no | coverage_plan, ledger | `handoff/s1b_input.json` (unfilled cells + exclusions) |
| `name --read-output` | S1b ingest | no | `handoff/s1b_output.json` (agent-written) | validated `candidate_names.json` (rejects any isrc/audio — FR-005) |
| `resolve` | S2b | MB+Deezer | candidate_names, ledger | lineage candidate_isrcs; misses logged |
| `probe --isrcs <file>` | S2c pre | Soundcharts | ~15 hand-picked ISRCs | `probe_result.json`; `isrc_probe_gate_failed` if <60% (FR-008) |
| `harvest --candidate-source <isrc_resolved\|soundcharts_search>` | S2a/S2c | Soundcharts (+MB/Deezer for B) | lineage, ledger | raw-response cache + lineage; ledger appended |
| `transform [--seed N]` | S3–S6 | **no** | accumulated cache + frozen LLM outputs | frozen catalog + `dataset_manifest` + `dataset_hash` |
| `worlds --write-input` / `--read-output` | S7 | no | frozen catalog | `worlds.json` + `contrast_pairs.json` (post-freeze; refs validated) |
| `judge --write-input` / `--read-output` | S8 | no | worlds, catalog | test cases with **blind** labels (before score) |
| `certify` | S9 | no (loads P6 by file path) | test cases, worlds, catalog | reversal assertions; re-harvest signal on failure |
| `report` | — | no | run state | committed `build_report.json` |

**Contract guarantees**
- `transform` is **idempotent & byte-identical** for a fixed (cache + frozen LLM outputs + seed), independent of loop count and `candidate_source` (FR-029, SC-001/008).
- `harvest` never re-fetches a ledgered ISRC/UUID; `resolve` never re-queries a ledgered `(title,artist)`; `name --read-output` excludes ledgered names (FR-024).
- No command writes a Soundcharts key into any output (FR-011).
- `harvest --candidate-source soundcharts_search` performing a live search raises `strategy_unavailable` (FR-009).
- `transform` refuses to run if any staged record carries a score/label/target field or an unresolved lineage id (`lineage_integrity_failed`).
