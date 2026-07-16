# Base-seed worlds (P3)

Committed, app-readable **base seeds** — complete `SeedWorld` documents (control_inputs + situation +
driver_profile + catalog_ref) in which every approved A.1/A.2 feature field is initialized. The app's
`WorldSeedStore` (`app/api/aica_api/services/world_seed_store.py`) reads only this directory; the generator
workspace (`generation_workspace/`) is a build area and is **not** read at runtime.

**Generated, not hand-edited.** These files are produced by `scripts/promote_seeds.py`, which maps the
committed generator worlds (`generation_workspace/worlds.json`) into the canonical `SeedWorld` shape and
completes every field from the `World` model defaults. To change a seed, edit the promotion script and
re-run it (a golden test pins the committed JSON to the script's output byte-for-byte).

The five representative seeds (milestones §5):

1. `seed-night-highway-oshi` — Night highway, rest nearby, oshi on.
2. `seed-daytime-ordinary` — Ordinary daytime route, low risk.
3. `seed-characteristic-route-event` — Characteristic route and event destination.
4. `seed-multiple-passengers-child` — Multiple passengers with child present.
5. `seed-upcoming-oshi-live-event` — Upcoming synthetic live/oshi event.

Every catalog id a seed references (`oshi_id`, `direct_item_history` keys) resolves to a `synthetic-…`
id in the frozen P2 dataset.
