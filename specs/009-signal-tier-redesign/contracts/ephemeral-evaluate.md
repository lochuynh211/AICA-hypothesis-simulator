# Contract — Ephemeral Instant-Result Evaluation

The backend capability behind the setup screen's Instant-Result strip. Computes a full headless run and
returns an `InstantResult` **without persisting anything** (FR-014a, Constitution II).

## Endpoint

```
POST /runs/preview
```

**Request** (`RunConfig`):
```jsonc
{ "package_id": "...", "scenario_id": "...", "hyperparameter_overrides": { ... },
  "run_seed": 42, "rest_option_id": null }   // null → deterministic auto-pick (first recovery option)
```

**Response**: the `InstantResult` shape (see `data-model.md` §7).

## Behavior

1. Resolve scenario + package; validate (old-shape scenario → 4xx with clear error, FR-017).
2. Freeze an event plan **including `run_seed`** exactly as a real run would.
3. Run the tick loop through the **same** tick engine + algorithm adapter as a persisted run, driving
   user actions from a **deterministic auto-chosen rest option** so the run resolves end-to-end
   (accept the proposal when it first fires; follow the chosen recovery to completion).
4. Collect the per-tick `rest_required_score`, the fire point, rest spot, recovery window, completion.
5. Return `InstantResult`. **Write nothing to `runs/`.**

## Invariants

- **No persistence**: the evidence recorder is never invoked; `runs/` is unchanged after a `/preview` call
  (asserted by test).
- **Faithful to a real run**: for the same `RunConfig`, the `/preview` decision sequence matches what
  "Open full run" (`POST /runs`) would persist — the only difference is the side-effect of recording.
- **Deterministic**: same `RunConfig` (incl. `run_seed`) → identical `InstantResult` every call (Principle III).
- **Errors surfaced, never faked**: an algorithm exception during preview yields `error: {…}` (an
  `algorithm_error` descriptor), never a fabricated `fired`/decision (Principle II, FR-010).
- **Setup-time only**: `/preview` reflects the *current unstarted* setup; it does not create or mutate a run.

## "Open full run"

The setup screen's "Open full run" calls the existing persisting run creation (`POST /runs`) with the
identical `RunConfig` (including the same `run_seed`), producing a run whose trace matches the preview.

## Tests (required — contract surface)

1. `/preview` returns an `InstantResult`; `runs/` file count is unchanged before/after (no persistence).
2. Same `RunConfig` twice → byte-identical `InstantResult`.
3. `/preview` fire tick == the fire tick of a persisted `POST /runs` with the same config (faithfulness).
4. Overrides list contains exactly the changed keys with correct default/value pairs.
5. A package raising in `evaluate` → `error` populated, `fired` not fabricated.
6. Old-shape scenario → rejected with a clear error (no partial preview).
