# Semantic combined experience cases

This directory contains the 36 generated, selectable combined-experience test
cases (`TC-R01` through `TC-I06`). The six groups cover rest, monotony,
environment/evidence, service-history mechanics, content-personalization
mechanics, and integrated journeys.

The human-reviewed source of truth is
`scripts/semantic_combined_catalog.json`. Each `case-tc-*.json` file is a
deterministic generated artifact; do not edit generated cases directly.
Regenerate the case, scenario, and reusable-profile artifacts together with:

```bash
PYTHONPATH=app/api:. app/api/.venv/bin/python -m scripts.semantic_catalog.generator \
  --catalog scripts/semantic_combined_catalog.json \
  --repo-root .
```

Every case carries bilingual real-world context, an explicit expectation
contract, and either CDC-SU grounding or an exploratory-simulator label.
Controlled service/content pairs declare one exact profile-leaf change.
Real-world rest/monotony pairs declare every differing journey input.

Expectations are authored before execution. Frozen-algorithm execution, result
adjudication, and report rendering must not be used to tune this catalog: a
mismatch is a reported finding, never a reason to weaken a hypothesis.

## Journeys run on the local route

`journey.route_preset_ref` is `null` for every case. The run therefore follows
the deterministic local route derived from the authored scenario, so
`route_distance_km` is what actually decides how long the journey lasts. Setting
a preset would paint a pre-extracted Google route and silently override the
authored length — which is what previously made every case run 2-8x longer than
its own story described.

## Producing the results and the customer report

```bash
PYTHONWARNINGS=ignore PYTHONPATH=app/api:. \
  app/api/.venv/bin/python scripts/build_semantic_combined_report.py \
  --catalog scripts/semantic_combined_catalog.json \
  --repo-root . \
  --results combined_contracts/results/semantic-combined-results.v1.json \
  --html docs/semantic-combined-test-case-report.html
```

The command compiles the artifacts, runs all 36 cases through
`POST /api/merged-runs/quickview`, adjudicates them, and writes both outputs. It
exits nonzero only on an execution error — semantic mismatches are findings.
