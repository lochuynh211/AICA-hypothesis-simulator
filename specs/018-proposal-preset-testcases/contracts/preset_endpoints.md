# API Contracts: Preset endpoints

New read-only endpoints on the existing proposal router (`app/api/aica_api/routers/proposal.py`), mirroring the seed/profile endpoints. No auth (local single-user). No mutation endpoints (presets are committed, read-only — FR-018).

---

## GET `/api/proposal/presets`

List all committed presets (summary projection).

**Response 200** — `application/json`
```jsonc
{
  "presets": [
    {
      "preset_id": "preset-monotone-highway-energize",
      "label": { "ja": "…", "en": "Monotone highway — energize" },
      "brief": { "ja": "…", "en": "Boredom without fatigue → an energizing oshi track should top content." },
      "family": "mood_coherence",
      "contrast_with": "preset-late-night-winddown",
      "hypothesis": "coherent high-arousal signals + oshi + genre highway→j-rock lift an upbeat track to the top"
    }
    // … ~18
  ]
}
```
- Order: stable (sorted by `preset_id`), deterministic.
- Empty list allowed only if the directory is empty (not an error).

---

## GET `/api/proposal/presets/{preset_id}`

Fetch one full preset (including `world`, `algorithm_config_overrides`, and full `expectation`).

**Path param**: `preset_id` — `^preset-[a-z0-9-]+$`

**Response 200** — the full `Preset` object (see `p1_preset.schema.json`).

**Response 404** — unknown `preset_id`:
```json
{ "detail": "preset not found: preset-does-not-exist" }
```

**Response 422 / 500** — a committed preset that fails validation is a load-time integrity error surfaced visibly (never a silently degraded proposal). The store validates on scan; an invalid preset directory fails loudly at startup/first-access consistent with the existing seed/dataset registries.

---

## Selection → run wiring (no new endpoint)

Selecting a preset in the UI dispatches the existing run/setup path with the preset's `world` and stashes `algorithm_config_overrides`. The existing service/content selection + run-plan endpoints consume them unchanged, except:
- the merged (resolved) algorithm config is recorded in the run's resolved-config evidence, and
- `SetupSnapshot.origin.origin_preset_id` is set on the persisted run log.

No preset-specific compute endpoint is added — presets ride the existing `dispatch_selector` path (Constitution Principle V).

---

## Config

`AICA_PROPOSAL_PRESETS_DIR` (default `proposal_contracts/presets`) added to `app/api/aica_api/config.py` as `settings.proposal_presets_dir`, following the existing `proposal_seeds_dir` pattern.
