# Quickstart — P6 Transparent Content-Selector

## Run the tests

Canonical (when Docker/uv are reachable):

```bash
docker compose exec api uv run pytest tests/proposal/ -k content_selector
```

Local fallback (this authoring shell — Anaconda 3.12):

```bash
cd app/api
/c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest tests/proposal/ -k content_selector -q
```

Full proposal + regression gate:

```bash
cd app/api && /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest -q
```

## Exercise the selector directly (illustrative)

The package is pure; assemble a context and call `evaluate` (the harness/loader reads the one
JSON song-DB fixture and injects it as `feature_snapshot["catalog"]` — the package never opens
files):

```python
import json, importlib.util
from pathlib import Path

# 1. load package
spec = importlib.util.spec_from_file_location(
    "content_selector",
    "packages/aica_transparent_content_selector_v1/algorithm.py",
)
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

# 2. load manifest hyperparameter defaults + the one JSON song DB (harness does the I/O)
manifest = json.loads(Path("packages/aica_transparent_content_selector_v1/package.json").read_text())
hp = {h["key"]: h["default"] for h in manifest["hyperparameters"]}
catalog = json.loads(Path("proposal_contracts/fixtures/catalog/smoke-catalog.json").read_text())

# 3. assemble context (numeric evidence) and evaluate
context = {
    "contract_version": "1.0.0",
    "selected_service_id": "humming_karaoke",
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "before_rest_until_stop",
    "allowed_service_ids": ["humming_karaoke"],
    "enabled_feature_extensions": [],
    "feature_snapshot": {"catalog": catalog, "situation": {"drowsiness_level": 80, "fatigue_level": 70,
        "monotony_level": 90, "traffic_state": "congested", "road_type": "highway",
        "night_state": "night", "motion_state": "driving"}, "preference": {...}, "history": {...}},
    "eligible_candidates": [{"candidate_id": tid} for tid in catalog],
    "excluded_candidates": [], "parameters": {}, "hyperparameters": hp,
    "package_runtime_state": {}, "catalog_version": "smoke-1", "run_seed": "seed-1",
    "opportunity_id": "op-1", "simulation_time": "2026-07-14T22:10:00Z",
    "feature_provenance": {},
}
plan = mod.evaluate(context)
assert plan["decision_type"] == "complete_plan"
assert len(plan["ordered_items"]) == hp["plan_item_count"]
assert "plan_score" not in plan and "aggregate_score" not in plan
```

## Validate output against the frozen contract

```python
from aica_api.models.proposal.content_output import CompletePlan
CompletePlan.model_validate(plan)   # frozen P0.5 shape
```

## Milestone-exit demonstration

1. `test_content_selector_*` suite green (traits, response/weights, eligibility, plan, genre,
   contrasts, determinism, contract).
2. Full existing backend suite green (regression gate; no trigger change).
3. The six driver/environment contrasts reverse; route-only contrast unchanged; genre off ==
   Spotify-only ordering; §10 worked block == +0.187 (`1e-12`).
4. Output validates against `content_output.schema.json` + `CompletePlan`; no aggregate score.
