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

Task 6 authors expectations before execution. Frozen-algorithm execution,
result adjudication, and report rendering belong to Task 7 and must not be used
to tune this catalog.
