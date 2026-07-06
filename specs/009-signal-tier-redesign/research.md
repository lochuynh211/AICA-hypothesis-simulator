# Phase 0 — Research: Signal-Tier Re-design

All major decisions were settled during brainstorming and captured in
`others/aica_trigger_algorithms_math_comparison.md` (Part 2) and `others/aica_setup_screen_uiux.md`.
This file records the technical decisions that most affect implementation.

## D1 — Seeded PRNG mechanism (determinism)

**Decision**: Draw all randomness from the Python stdlib `random.Random`, seeded **per channel** by
hashing `(run_seed, tick_index, channel)` into a sub-seed. No global `random`, no wall-clock seed.

```python
def rng(run_seed: int, tick: int, channel: str) -> random.Random:
    sub = hash((run_seed, tick, channel)) & 0xFFFFFFFF   # or hashlib for stability across processes
    return random.Random(sub)
```

**Rationale**: Constitution III demands byte-identical replay. Per-(seed, tick, channel) derivation
makes each draw a pure function of frozen inputs, so re-running or replaying any tick reproduces it
exactly, independent of evaluation order. Stdlib only (Principle VI — no numpy).

**Note on hash stability**: Python's builtin `hash()` of tuples is process-salted for strings.
Use a stable hash (e.g. `hashlib.sha256` of a canonical byte string, or integer mixing of ints) so the
sub-seed is identical across processes/runs. This is a contract requirement (see anomaly-generator.md).

**Alternatives rejected**: global `random.seed()` (order-dependent, not replay-safe); numpy Generator
(new dependency); frontend-side RNG (violates Principle I — decisions must originate in the backend).

## D2 — Anomaly signal as an inhomogeneous Poisson point process

**Decision**: Model `anomaly` as discrete events whose per-tick probability rises with drowsiness;
expose `anomaly_rate` as a rolling count over a window `W`.

```
λ[t]   = λ_base + λ_gain · max(0, drowsiness[t] − θ) / 100      # events per minute
p[t]   = 1 − exp(−λ[t] · Δt_min)                               # P(≥1 event this tick)
spike  = 1 if rng(run_seed, t, "anomaly").random() < p[t] else 0
anomaly_rate[t] = count of spikes over the last W minutes
```

**Rationale**: Behavioral anomalies (lane departure / steering jerk) are sporadic events, not a smooth
level. A Poisson process is the correct generative model; the earlier deterministic
`steering = base + k·drowsiness` carried no independent information (a perfect invertible function of
the latent). The rolling-window count gives the algorithm a distinct, noisy modality that rewards its
smoothing/persistence machinery.

**Alternatives rejected**: deterministic threshold event (fires every tick above a level — not sporadic,
fake); a Gaussian-noised drowsiness *level* sensor (dropped in design review as a redundant duplicate of
the latent).

## D3 — Ephemeral (non-persisting) instant-result evaluation

**Decision**: Add a backend evaluation path that runs the full tick loop + adapter for a given
`RunConfig` (scenario + algorithm + overrides + seed + a deterministic auto-chosen rest option) and
returns a computed `InstantResult`, **without** invoking the evidence recorder — nothing is written to
`runs/`.

**Rationale**: FR-014a + Constitution II. Persisting a run on every keystroke would flood the
append-only evidence store and misrepresent "a run." Reusing the same tick engine + adapter keeps the
preview faithful to a real run (Principle I: same backend authority); only the persistence side-effect is
omitted. "Open full run" uses the existing persisting run path.

**Alternatives rejected**: persist-then-delete scratch runs (Principle II/VI); a second, frontend-side
simulation (Principle I).

## D4 — Scenario rewrite, not migration (clarification Q2)

**Decision**: Rewrite the ~2 shipped scenario files in place to the new tiered / renamed-param structure;
the loader rejects an old-shape scenario with a clear "incompatible — re-author" error.

**Rationale**: Constitution VI (YAGNI) — a migration engine for a single-user tool with a couple of
scenarios is over-engineering. A clean rewrite plus a validating loader is sufficient and honest
(Principle II — no silent mis-read).

## D5 — Manifest as the single source of hyperparameter/feature defaults (FR-009)

**Decision**: Defaults live only in each package's `package.json`. The adapter merges manifest defaults
with user overrides and injects the resolved `hyperparameters` into `context`; `algorithm.py` reads
`context["hyperparameters"][key]` with **no** `hp.get(key, <hardcoded default>)` fallback.

**Rationale**: Today defaults are duplicated (manifest + hardcoded fallback) and can drift. Centralizing
removes the drift and makes the overrides-diff (changed-from-default) well-defined for the setup UI.

**Migration detail**: The Hybrid manifest gains the lifted curve params for drowsiness/fatigue plus `K`
and `anomaly_signal_params` references; NRI's params are already declared. A test asserts every key an
algorithm reads has a manifest default (no un-defaulted `context` access).

## D6 — Principle IV: route-binning preserved

**Decision**: Simulator-internal values (`drowsiness`, `fatigue`, `anomaly_rate`, accumulated
`jam_min`/`hw_min`/`mono_min`, `continuousDrivingMin`) are not external-service route numerics and are
consumed directly, as the existing algorithms already do. Any value sourced from an external route
service (e.g. `nextRestSpotMin` under the M4 Maps surface) MUST continue to pass through the existing
boundary-binning before reaching the algorithm; the compact Hybrid's `rest_window` uses the banded form,
and `rest_scarcity`'s transform operates on the already-bounded value.

**Rationale**: Principle IV targets external-service raw numerics; keeping the M4 two-layer boundary intact
means the re-design introduces no new coupling of decisions to volatile external numbers.

## D7 — Removal impact (attention + vehicle sensors)

**Decision**: Deleting `attention` and the four vehicle sensors affects **only** the Hybrid
`driving_anomaly` feature (now `clamp(anomaly_rate/K)`) and its `monotony_prevention` weighting
(attention_drop removed; weight redistributed). NRI never used them. `vehicle_model.py` is deleted; the
`driver_signals` simulator no longer computes attention.

**Rationale**: Confirmed by the raw-state usage analysis (Part 1 §1.3 of the comparison doc): steering
was the Hybrid's only live vehicle input; pedal/lane/ADAS were computed but unused.
