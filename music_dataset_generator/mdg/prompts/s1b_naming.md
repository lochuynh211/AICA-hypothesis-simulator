# S1b — Cell → song naming (web-search-grounded, interactive-agent stage)

**Input:** `handoff/s1b_input.json` — the remaining coverage cells, the JA-primary
language targets, and the ledger's already-named list to exclude.

**Task:** For each remaining cell, propose **real songs** that plausibly fill it, verified
to exist via web search. Prefer Japanese-language songs (English fallback; other languages
edge-only). Surface niche/old/regional titles beyond parametric memory when a cell calls
for them (e.g. 1960s Japanese). Per candidate emit:
`{title, artist, release_year, expected_language, target_cell_id, why_fits_cell,
web_evidence[]}`.

**Hard rules (firewall, FR-005):**
- **Never emit an ISRC or any audio-feature number.** Real audio decides the cell (S3);
  your `target_cell_id` is only a seed guess. A wrong guess simply lands where its real
  audio bins.
- `expected_language` is advisory — the real `languageCode` decides (a mismatch discards
  the song, never relabels it).
- Do **not** re-propose any name in the ledger's excluded list.
- `why_fits_cell`/`web_evidence` are seed rationale and provenance only; they live in
  lineage and never enter a frozen `Song`.

**Output:** write `handoff/s1b_output.json` validating against
`schemas/s1b_naming_output.json` (array of `CandidateName`). The next CLI rejects any item
carrying an `isrc` or audio key and prompts you to re-run.
