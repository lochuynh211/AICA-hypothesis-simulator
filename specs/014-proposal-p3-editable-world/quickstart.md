# Quickstart — P3 Editable World, Driver Profiles & Contrast

## Run the app

```bash
docker compose up          # or: cd app/api && uv run uvicorn aica_api.main:app --reload
                           #     cd app/frontend && npm run dev
```

## Demonstration flow (the P3 payoff)

1. Open the app → switch to the **Proposal** app (JA default) → 3-panel screen.
2. **① World** → pick base seed **"Night highway, rest nearby, oshi on"** → the world fills in: control
   inputs, situation, and driver profile. The catalog banner shows the frozen dataset id / version / hash
   (read-only — no edit/import).
3. Pick a **driver profile** with hobby "anime-fan"; run **STEP 1** (mock service) → choose
   `music_playlist` → **STEP 2** runs the **real** content selector → note the ordered songs + per-item
   reasoning.
4. **Clone-and-change** the seed: switch the driver profile to hobby "wellness" (or toggle
   `genre_affinity_v1`) → the **field-level diff** shows exactly that change.
5. Run STEP 2 again → **the content proposal is different**, and the reasoning cites the differing feature —
   the visible demonstration of algorithmic effectiveness through profile contrast.
6. Save the edited profile as a named profile → reuse it on another seed.
7. Enter an out-of-range value (e.g. `drowsiness_level = 150`) → rejected with a field-level message.
8. Open **Proposal Runs** → reopen a run → it renders the stored world, setup snapshot, and recorded plan
   with no recomputation.

## Verify

```bash
cd app/api && uv run pytest tests/proposal          # P3 backend (world, profiles, seeds, clones, wiring)
cd app/api && uv run pytest                          # full backend incl. trigger regression
cd app/frontend && npm test                          # Vitest (world panel, profile store, clone diff, real STEP 2)
cd app/frontend && npm run build
docker compose config
```

## Determinism / safety checks

- Run the same world twice → identical `CompletePlan`.
- Confirm the frozen dataset files are byte-unchanged after a session (read-only).
- Force a content-selector error → surfaced as an algorithm-error, not a normal proposal.
- Confirm no proposal edit changes trigger state; trigger suites stay green.
