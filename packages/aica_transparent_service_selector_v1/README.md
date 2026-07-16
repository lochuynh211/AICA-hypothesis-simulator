# aica_transparent_service_selector_v1 — Transparent Service Selector (P5)

The real, inspectable replacement for `mock_service_selector_v1`'s fixed
illustrative ranking. Scoring math is authoritative in
**`docs/master/aica_transparent_service_proposal_algorithm.md`**; the P5
milestone's own spec/plan/tasks live under
`specs/016-proposal-p5-transparent-service-selector/`.

Unit A (`specs/016-proposal-p5-transparent-service-selector/tasks.md` T001)
ships only the package skeleton — a manifest that registers into the
`service_selector`/`transparent` slot and a stub `evaluate()` that raises
`NotImplementedError`. The real scoring math (feature normalization, weight
resolution, response-coefficient lookup, candidate scoring, ranking,
explainability trace) lands in later P5 units per `tasks.md`.
