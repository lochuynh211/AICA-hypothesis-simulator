"""TDD tests for the seeded-Poisson anomaly-event generator (feature 009,
tasks T005+T006).

Contract: specs/009-signal-tier-redesign/contracts/anomaly-generator.md

    Δt_min = tick_seconds / 60
    λ      = lambda_base + lambda_gain · max(0, drowsiness − theta) / 100   (≥ 0)
    p      = clamp(1 − exp(−λ · Δt_min), 0, 1)
    u      = seeded_uniform(run_seed, tick_index, "anomaly")
    spike  = 1 if (is_moving and u < p) else 0
    events' = [t for t in prev.events if tick_index − t < window_ticks]
              + ([tick_index] if spike else [])
    anomaly_rate = len(events')
    window_ticks = round(window_min * 60 / tick_seconds)

`params` is duck-typed (lambda_base, lambda_gain, theta, window_min) — this
module does not import the real Pydantic AnomalySignalParams (a later task
defines it); a tiny local dataclass stands in for it here.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from aica_api.services.behavior.anomaly_signal import (
    AnomalyState,
    AnomalyUpdate,
    advance_anomaly,
)


@dataclass
class _Params:
    lambda_base: float
    lambda_gain: float
    theta: float
    window_min: float


def _empty() -> AnomalyState:
    return AnomalyState(events=[])


# ─── Basic shape ────────────────────────────────────────────────────────────


def test_returns_anomaly_update_with_expected_shape():
    params = _Params(lambda_base=0.1, lambda_gain=2.0, theta=50.0, window_min=5.0)
    result = advance_anomaly(
        params,
        _empty(),
        drowsiness=0.0,
        tick_index=0,
        tick_seconds=60,
        run_seed=42,
        is_moving=True,
    )
    assert isinstance(result, AnomalyUpdate)
    assert result.spike in (0, 1)
    assert isinstance(result.anomaly_rate, int)
    assert isinstance(result.next, AnomalyState)
    assert result.anomaly_rate == len(result.next.events)


# ─── 1. Determinism: identical anomaly_rate series across independent runs ─


def test_identical_run_seed_and_trajectory_gives_identical_rate_series():
    params = _Params(lambda_base=0.2, lambda_gain=3.0, theta=40.0, window_min=5.0)
    run_seed = 7
    tick_seconds = 60
    n_ticks = 500
    # Ramp drowsiness 0 -> 100 across the trajectory.
    trajectory = [100.0 * t / (n_ticks - 1) for t in range(n_ticks)]

    def _run_series() -> list[int]:
        state = _empty()
        rates: list[int] = []
        for tick_index, drowsiness in enumerate(trajectory):
            update = advance_anomaly(
                params,
                state,
                drowsiness=drowsiness,
                tick_index=tick_index,
                tick_seconds=tick_seconds,
                run_seed=run_seed,
                is_moving=True,
            )
            rates.append(update.anomaly_rate)
            state = update.next
        return rates

    series_a = _run_series()
    series_b = _run_series()
    assert series_a == series_b


# ─── 2. Different run_seed -> different (but each reproducible) pattern ────


def test_different_run_seed_changes_spike_pattern_but_stays_reproducible():
    params = _Params(lambda_base=0.1, lambda_gain=2.0, theta=50.0, window_min=5.0)
    tick_seconds = 60
    n_ticks = 300
    drowsiness = 90.0  # well above theta -> moderate spike probability

    def _spike_sequence(run_seed: int) -> list[int]:
        state = _empty()
        spikes: list[int] = []
        for tick_index in range(n_ticks):
            update = advance_anomaly(
                params,
                state,
                drowsiness=drowsiness,
                tick_index=tick_index,
                tick_seconds=tick_seconds,
                run_seed=run_seed,
                is_moving=True,
            )
            spikes.append(update.spike)
            state = update.next
        return spikes

    seq_seed1_a = _spike_sequence(1)
    seq_seed1_b = _spike_sequence(1)
    seq_seed2 = _spike_sequence(2)

    # Reproducible per seed.
    assert seq_seed1_a == seq_seed1_b
    # Different seeds -> different pattern (overwhelmingly likely at this N).
    assert seq_seed1_a != seq_seed2


# ─── 3. drowsiness <= theta -> lambda == lambda_base; monotonic increase ───


def _empirical_spike_rate(params: _Params, drowsiness: float, run_seed: int, n: int) -> float:
    """Average spike frequency over n independent draws (fresh state each
    call so the rolling window never affects individual spike outcomes)."""
    spikes = 0
    for tick_index in range(n):
        update = advance_anomaly(
            params,
            _empty(),
            drowsiness=drowsiness,
            tick_index=tick_index,
            tick_seconds=60,
            run_seed=run_seed,
            is_moving=True,
        )
        spikes += update.spike
    return spikes / n


def test_drowsiness_at_or_below_theta_gives_baseline_lambda_rate():
    import math

    params = _Params(lambda_base=0.1, lambda_gain=2.0, theta=50.0, window_min=5.0)
    expected_p = 1 - math.exp(-params.lambda_base * 1.0)  # dt_min = 1 for 60s tick

    n = 4000
    for drowsiness in (0.0, 25.0, 50.0):  # all <= theta
        observed = _empirical_spike_rate(params, drowsiness, run_seed=123, n=n)
        assert abs(observed - expected_p) < 0.03, (drowsiness, observed, expected_p)


def test_anomaly_rate_increases_monotonically_with_drowsiness_above_theta():
    params = _Params(lambda_base=0.1, lambda_gain=2.0, theta=50.0, window_min=5.0)
    n = 3000
    levels = (50.0, 60.0, 70.0, 90.0)
    observed = [_empirical_spike_rate(params, d, run_seed=99, n=n) for d in levels]

    for earlier, later in zip(observed, observed[1:]):
        assert later > earlier, observed


# ─── 4. is_moving=False -> no spikes; window still prunes ─────────────────


def test_is_moving_false_never_spikes_even_with_high_lambda():
    params = _Params(lambda_base=5.0, lambda_gain=10.0, theta=0.0, window_min=5.0)
    state = _empty()
    for tick_index in range(200):
        update = advance_anomaly(
            params,
            state,
            drowsiness=100.0,  # forces a very high lambda / near-certain p
            tick_index=tick_index,
            tick_seconds=60,
            run_seed=5,
            is_moving=False,
        )
        assert update.spike == 0
        state = update.next
    assert state.events == []


def test_is_moving_false_still_prunes_existing_window_events():
    params = _Params(lambda_base=1.0, lambda_gain=0.0, theta=0.0, window_min=5.0)
    # window_ticks = round(5 * 60 / 60) = 5
    prev = AnomalyState(events=[5, 6, 7])
    update = advance_anomaly(
        params,
        prev,
        drowsiness=0.0,
        tick_index=10,
        tick_seconds=60,
        run_seed=1,
        is_moving=False,
    )
    # 10-5=5 (not < 5, pruned); 10-6=4 (<5, kept); 10-7=3 (<5, kept)
    assert update.spike == 0
    assert update.next.events == [6, 7]
    assert update.anomaly_rate == 2


# ─── 5. Rolling window: a spike leaves anomaly_rate after window_min min ───


def test_spike_leaves_window_after_exactly_window_min_minutes():
    # lambda_base=0 -> p=0 -> no new spikes can fire; only the injected
    # event at tick 10 is present, and it must age out of the window.
    params = _Params(lambda_base=0.0, lambda_gain=0.0, theta=0.0, window_min=5.0)
    tick_seconds = 60  # 1 tick == 1 minute -> window_ticks = 5
    state = AnomalyState(events=[10])

    expected_rate_by_tick = {
        11: 1,  # diff 1 < 5
        12: 1,  # diff 2 < 5
        13: 1,  # diff 3 < 5
        14: 1,  # diff 4 < 5
        15: 0,  # diff 5, not < 5 -> pruned (exactly window_min minutes later)
    }
    for tick_index in range(11, 16):
        update = advance_anomaly(
            params,
            state,
            drowsiness=0.0,
            tick_index=tick_index,
            tick_seconds=tick_seconds,
            run_seed=1,
            is_moving=True,
        )
        assert update.spike == 0
        assert update.anomaly_rate == expected_rate_by_tick[tick_index], tick_index
        state = update.next


# ─── Determinism guard: uses aica_api.services.prng.seeded_uniform ─────────


def test_module_uses_seeded_uniform_not_raw_random():
    import inspect

    import aica_api.services.behavior.anomaly_signal as module

    source = inspect.getsource(module)
    assert "seeded_uniform" in source
    assert "import random" not in source
    assert "random.random(" not in source


@pytest.mark.parametrize("tick_seconds", [30, 60, 120])
def test_window_ticks_scales_with_tick_seconds(tick_seconds):
    # window_min=10 minutes; window_ticks = round(10*60/tick_seconds)
    params = _Params(lambda_base=0.0, lambda_gain=0.0, theta=0.0, window_min=10.0)
    window_ticks = round(10.0 * 60 / tick_seconds)
    state = AnomalyState(events=[0])
    # Just inside the window: should still be counted.
    update_inside = advance_anomaly(
        params,
        state,
        drowsiness=0.0,
        tick_index=window_ticks - 1,
        tick_seconds=tick_seconds,
        run_seed=1,
        is_moving=True,
    )
    assert update_inside.anomaly_rate == 1
    # At the boundary: should be pruned.
    update_outside = advance_anomaly(
        params,
        state,
        drowsiness=0.0,
        tick_index=window_ticks,
        tick_seconds=tick_seconds,
        run_seed=1,
        is_moving=True,
    )
    assert update_outside.anomaly_rate == 0
