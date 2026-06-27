# rest_python_v0_1

A reference Python port of the built-in `weighted_score` algorithm, proving the
`python_module` adapter mechanism end-to-end.

## What it is

`rest_python_v0_1` implements the identical scoring logic as `rest_weighted_score_v0_1`
(drowsiness/fatigue/attention weighting, gated rest bonus, monotony prevention, priority
selection), but as a local trusted Python file loaded via the `python_module` adapter.
The decision output is bit-for-bit identical to the built-in weighted_score on the same
inputs — parity is enforced by automated tests.

## How to select it

In the UI, choose this package in the package selector. It is compatible with
`uc01_fatigue` scenarios. Hyperparameters (weights, thresholds) are identical to
`rest_weighted_score_v0_1` and are tunable at setup time.

## Stateless

This package is **stateless** — `next_package_runtime_state` is always returned as `{}`.
There is no memory of prior ticks, no smoothing, and no hybrid signal accumulation.
The stateful hybrid algorithm is `aica_transparent_hybrid_trigger_v1` (U5).

## This package does not declare tick_seconds

`rest_python_v0_1` inherits the simulation tick cadence from the selected scenario.
The hybrid package in U5 will declare its own `tick_seconds` to match its stateful
decision cadence.
