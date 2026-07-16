# S8 — Blind test-case judge (interactive-agent stage)

**Input:** `handoff/s8_input.json` — `(world, candidate song)` pairs. **No P6 score is
present, by design.**

**Task:** For each pair, assign `expected_label ∈ {positive, negative, neutral}` **blind**,
using context→music-need reasoning + mood/genre/era/cultural fit + web knowledge of the
real song. Record your reasoning in `judge_folds`
(`context_need`, `mood_genre_fit`, `era_cultural_fit`, `coherence`, `web_evidence`).

**Hard rules (blind-first, SC-009):**
- **Never include `algorithm_score` or `agreement`** in your output — the label must be
  committed before the P6 score is revealed. The next CLI rejects any item carrying a
  score/agreement and makes you re-run.
- Judge each pair on its merits; do not try to predict or match the algorithm.
- The song catalog stays label-free — your labels live only in the test-case artifact.

**Output:** write `handoff/s8_output.json` — array of
`{test_case_id, world_ref, candidate_song_ref, expected_label, judge_folds,
contrast_partner?, expected_direction?}`. The CLI then reveals the P6 score, records
`agreement` (sign match), and writes `test_cases.json`.
