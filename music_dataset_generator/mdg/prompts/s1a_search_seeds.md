# S0.5/S1a — Strategy A search seeds (interactive-agent stage)

> Strategy A (`soundcharts_search`) is retained as a documented fallback. The Soundcharts
> search-by-metric endpoint is **unavailable on the current subscription**, so the
> deterministic executor raises `strategy_unavailable`. This prompt still produces the
> seed file for auditability and for a future subscription that restores search.

**Input:** `handoff/s1a_input.json` — the remaining coverage cells + language targets
(Japanese-primary) from the S0 plan, plus the ledger's already-named list to exclude.

**Task:** For each remaining cell, propose high-precision Soundcharts search **queries**
(using Soundcharts' own genre taxonomy) and optional real candidate seed names likely to
fill that cell. Prefer Japanese-language songs (English fallback).

**Hard rules (firewall):**
- Never emit an ISRC or any audio-feature number. Real audio decides the cell (S3).
- Do not re-propose any name already in the ledger's excluded list.
- `why_fits_cell` is a seed rationale only; it never enters a frozen Song.

**Output:** write `handoff/s1a_output.json` validating against
`schemas/s1a_search_seeds_output.json` (array of `{target_cell_id, queries[],
candidate_seed_names?, why_fits_cell?}`).
