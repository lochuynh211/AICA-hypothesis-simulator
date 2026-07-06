# Contract — Anomaly Signal Generator

Module: `app/api/aica_api/services/behavior/anomaly_signal.py` (new). Pure & deterministic given inputs.

## Interface

```python
@dataclass
class AnomalyState:
    events: list[int]          # tick indices of spikes within the rolling window (pruned each tick)

@dataclass
class AnomalyUpdate:
    spike: int                 # 0 or 1 — did an event fire this tick
    anomaly_rate: int          # count of spikes within the last window_min minutes
    next: AnomalyState

def advance_anomaly(
    params: AnomalySignalParams,   # lambda_base, lambda_gain, theta, window_min
    prev: AnomalyState,
    *,
    drowsiness: float,             # current tier-3a drowsiness [0,100]
    tick_index: int,
    tick_seconds: int,
    run_seed: int,
    is_moving: bool,               # no anomalies while STOPPED (rest)
) -> AnomalyUpdate: ...
```

## Semantics

```
Δt_min = tick_seconds / 60
λ      = lambda_base + lambda_gain · max(0, drowsiness − theta) / 100        # events/min, ≥ 0
p      = 1 − exp(−λ · Δt_min)                                                # clamp to [0,1]
u      = seeded_uniform(run_seed, tick_index, "anomaly")                     # deterministic (0,1)
spike  = 1 if (is_moving and u < p) else 0
events'        = prune(prev.events, keep tick within last window_min) + ([tick_index] if spike else [])
anomaly_rate   = len(events')
```

## Determinism contract (Principle III)

- `seeded_uniform(run_seed, tick_index, channel)` MUST be a pure function of its arguments and **stable
  across processes** — implemented via `prng.py` using a stable hash (not builtin salted `hash()` of
  strings). Same `(run_seed, tick_index, channel)` → same value in every process/run.
- No wall clock, no global RNG, no ordering dependence.
- Given identical `(params, run_seed, drowsiness-trajectory)`, the full `anomaly_rate` series is identical.

## Tests (required — contract surface)

1. Same `(run_seed, drowsiness series)` → identical `anomaly_rate` series across two independent runs and
   two separate processes.
2. Different `run_seed` → different spike pattern (with high probability) but each individually reproducible.
3. `drowsiness ≤ theta` → `λ = lambda_base` (baseline low rate); rate increases monotonically with drowsiness.
4. `is_moving = False` → no spikes; window still prunes.
5. Rolling window: a spike leaves `anomaly_rate` after exactly `window_min` minutes.
