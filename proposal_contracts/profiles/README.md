# Built-in driver profiles (P3)

Committed, app-readable **built-in driver profiles** — `DriverProfileRecord` documents (`builtin: true`)
loaded read-only by `DriverProfileStore` (`app/api/aica_api/services/driver_profile_store.py`). User-saved
profiles (`builtin: false`) persist separately under `settings.proposal_profiles_dir`
(`AICA_PROPOSAL_PROFILES_DIR`, git-ignored) and are never written here.

**Hand-curated, not generated.** Unlike `proposal_contracts/seeds/` (produced by a promotion script from
`generation_workspace/worlds.json`), these four files are hand-authored so their preferences are
deliberately small in count and DISTINCT/contrasting — the point is to make "load a different profile
into the same world → get a different content proposal" an obvious, legible demo. Edit them directly if a
preference needs to change; there is no promotion script for this directory.

The four built-in profiles:

1. `profile-anime-fan` — oshi on (anime artist), genre affinity favors anime/vocaloid/j-pop.
2. `profile-wellness-calm` — no oshi, genre affinity favors ambient/jazz/classical.
3. `profile-jrock-fitness` — oshi on (j-rock artist), genre affinity favors j-rock/electronic.
4. `profile-neutral-default` — no oshi, no genre-affinity extension, all-default preferences.

Missing `DriverProfile` fields are filled by the model's own defaults on load (empty maps/lists, `None`)
— these files only need to spell out the fields that make each profile distinctive, not every A.1/A.2
field (unlike `seeds/`, where `World` completeness is a first-class requirement).

Any catalog id referenced here (currently `oshi_id`) resolves against the frozen dataset
`proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-demonstration-seed-1042/catalog.json`
(`synthetic-artist-0068`/`synthetic-artist-0079` are real artist ids in that catalog). Genre-affinity keys
are the `GenreLiteral` controlled vocabulary, not catalog references, so they are not required to appear
in that dataset's `genre_affinity_v1.json` artist-genre map.
