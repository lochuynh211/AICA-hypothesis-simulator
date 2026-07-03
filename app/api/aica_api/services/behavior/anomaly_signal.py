"""Seeded-Poisson anomaly-event generator (feature 009, T005+T006).

The ONLY source of randomness in the whole simulation. Pure and
deterministic given its inputs — see the contract at
specs/009-signal-tier-redesign/contracts/anomaly-generator.md.

Rate model:
    Δt_min = tick_seconds / 60
    λ      = lambda_base + lambda_gain · max(0, drowsiness − theta) / 100   (≥ 0)
    p      = clamp(1 − exp(−λ · Δt_min), 0, 1)
    u      = seeded_uniform(run_seed, tick_index, "anomaly")
    spike  = 1 if (is_moving and u < p) else 0
    events'      = [t for t in prev.events if tick_index − t < window_ticks]
                   + ([tick_index] if spike else [])
    anomaly_rate = len(events')

where window_ticks = round(window_min * 60 / tick_seconds).

`params` is duck-typed: only `.lambda_base`, `.lambda_gain`, `.theta`, and
`.window_min` are read. The random draw MUST go through
`aica_api.services.prng.seeded_uniform` — never a raw/global `random` call
or the wall clock — so evidence replay is byte-identical across processes
(constitution III — determinism).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from aica_api.services.prng import seeded_uniform


@dataclass
class AnomalyState:
    """Rolling-window state carried tick to tick."""

    events: list[int]  # tick indices of spikes within the rolling window


@dataclass
class AnomalyUpdate:
    """Result of one tick: whether it spiked, the current rate, and next state."""

    spike: int  # 0 or 1 — did an event fire this tick
    anomaly_rate: int  # count of spikes within the last window_min minutes
    next: AnomalyState


def advance_anomaly(
    params,
    prev: AnomalyState,
    *,
    drowsiness: float,
    tick_index: int,
    tick_seconds: int,
    run_seed: int,
    is_moving: bool,
) -> AnomalyUpdate:
    """Advance the anomaly signal by one tick.

    Args:
        params:      Duck-typed object exposing lambda_base, lambda_gain,
                     theta, window_min.
        prev:        AnomalyState at the START of this tick.
        drowsiness:  Current tier-3a drowsiness value, [0, 100].
        tick_index:  Index of the current tick.
        tick_seconds: Duration of one tick, in seconds.
        run_seed:    Deterministic run seed for the PRNG draw.
        is_moving:   True unless the vehicle is STOPPED (e.g. resting) —
                     no anomalies fire while stopped.

    Returns:
        AnomalyUpdate with this tick's spike flag, resulting anomaly_rate,
        and next AnomalyState.
    """
    dt_min = tick_seconds / 60.0

    lam = params.lambda_base + params.lambda_gain * max(0.0, drowsiness - params.theta) / 100.0
    lam = max(0.0, lam)

    p = 1.0 - math.exp(-lam * dt_min)
    p = min(1.0, max(0.0, p))

    u = seeded_uniform(run_seed, tick_index, "anomaly")
    spike = 1 if (is_moving and u < p) else 0

    window_ticks = round(params.window_min * 60 / tick_seconds)
    events = [t for t in prev.events if tick_index - t < window_ticks]
    if spike:
        events.append(tick_index)

    return AnomalyUpdate(
        spike=spike,
        anomaly_rate=len(events),
        next=AnomalyState(events=events),
    )
