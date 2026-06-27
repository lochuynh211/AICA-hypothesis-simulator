# Contract: python_module adapter

Same one adapter contract as built-ins:
`evaluate(package, context, parameters, hyperparameters, history,
package_runtime_state) → DecisionResult`. For `algorithm.type == "python_module"` the
adapter loads the package's `entrypoint` and calls its
`def evaluate(context: dict) -> dict`.

## Loading
- `importlib.util.spec_from_file_location("aica_pkg_<id>", <pkg>/<entrypoint>)` →
  `module_from_spec` → `exec_module`; cached per package id (path-keyed). In-process,
  no sandboxing (local trusted code).

## Context (plain dict passed to the package)
`{simulation_time_sec, raw_state, feature_groups, parameters, hyperparameters,
proposal_history, user_action_history, package_runtime_state}` (see data-model).
Required core fields validated; optional enhancement fields may be absent.

## Returned dict → normalized §11 DecisionResult
- Validated/coerced into `DecisionResult`; localized `explanation` accepted;
  **`result_type` recorded verbatim** (no alias map; accepts REST_PROPOSAL /
  MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL / M1-M2 / package-defined).
- Suppressed candidates retained; `next_package_runtime_state` stored for the next tick.

## Error matrix (the M3 acceptance — FR-006 / SC-005)
| Failure | Detection | Result |
|---|---|---|
| Missing `evaluate` | module loaded, no `evaluate` attr | `algorithm_error` `error_type:"missing_evaluate"` |
| Raises during eval | exception from `evaluate(context)` | `algorithm_error` `error_type:"algorithm_exception"` + message |
| Invalid return | not a dict, or fails `DecisionResult` validation | `algorithm_error` `error_type:"invalid_result_shape"` |
| Missing required context field | context builder | clear context/algorithm error (not a silent 0) |

In all cases: **no fabricated decision**; the error is persisted + shown; and the run
**pauses by default** (`error_mode: blocking`) — `continues` only if the package
declares `error_mode: non_blocking`.

## Contract tests
- Successful Python eval → normalized §11; verbatim result_type.
- Each of the 4 failure rows → the right `error_type`, no decision, pause-by-default
  (and continue when non_blocking).
- `next_package_runtime_state` returned non-empty is threaded into the next tick.
- A package declaring `tick_seconds` overrides the scenario cadence.
