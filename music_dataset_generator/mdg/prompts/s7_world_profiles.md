# S7 — World profile composition (interactive-agent stage, post-freeze)

**Input:** `handoff/s7_input.json` — the frozen catalog's `track_ids` + `artist_ids`.

**Task:** Compose **coherent** driver histories and oshi profiles for the base worlds,
grounding every reference to a real catalog ID. A city-pop fan's `direct_item_history`
should hold real city-pop tracks from the catalog; an oshi artist should be an artist that
actually appears in the catalog. Pure driver physiology and traffic fixtures stay as the
deterministic template provides — only the histories/oshi/`usage_by_genre` are composed
here.

**Hard rules:**
- Every `direct_item_history` key and every `oshi_id` **must** be a catalog ID from the
  input (the CLI raises `world_reference_failed` otherwise).
- Do not introduce a `recommended`/target field; worlds carry no algorithm labels.
- Deterministic driver/environment/night fields are not yours to invent — keep them.

**Output:** write `handoff/s7_output.json` with the composed per-world history/oshi blocks
keyed by `world_id`. The CLI merges them into the deterministic base worlds and validates
all references before writing `worlds.json`.
