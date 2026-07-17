# Quickstart — P5 Transparent Service-Selector

## Run the tests (TDD anchor first)

```bash
cd app/api
# The whole P5 backend suite:
uv run python -m pytest tests/proposal/test_p5_*.py -q
# The single golden that pins the math (build this first):
uv run python -m pytest tests/proposal/test_p5_service_math.py -k worked_example -q
# Full proposal regression (must stay green — 838 at baseline):
uv run python -m pytest tests/proposal/ -q
```

Frontend:

```bash
cd app/frontend
npm test -- ServiceProposalPanel
```

## Exercise the real package by hand (pure function)

```bash
cd /path/to/repo
uv run python - <<'PY'
import json, importlib.util, pathlib
p = pathlib.Path("packages/aica_transparent_service_selector_v1/algorithm.py")
spec = importlib.util.spec_from_file_location("svc", p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ctx = json.load(open("proposal_contracts/fixtures/service/worked-example.json"))
out = m.evaluate(ctx)
top = out["ranked_candidates"][0]
print(top["candidate_id"], round(top["score"], 6))   # expect humming_karaoke +0.772349
PY
```

## Exercise end-to-end (real user flow)

```bash
docker compose up            # backend + frontend
# open the proposal screen, pick "Transparent Service Selector v1" in the
# service slot, load a seed (e.g. seed-night-highway-oshi or the worked-example
# world), run STEP 2 (service). Panel ③ shows the real ranking + trace.
```

Verify in Panel ③:
- Up to 3 services ranked by `service_fit`, all from the eligible set.
- Expand a candidate → all 17 feature rows (value → e·a = r × w = k) + provenance.
- Situation/Preference/History subtotals reconcile to the score.
- Dominance readout shows `preserved` + safety share (~79%).
- Edit the route-context weight, start a new run → route-preferred services move.
- Toggle `confidence_shrinkage_v1` on → sparse-history candidates' acceptance
  contribution shrinks; off → identical to baseline.

## Acceptance-criterion spot checks

| Criterion | Where to see it |
|---|---|
| SC-001 worked example +0.772349 | `test_p5_service_math.py::worked_example`; hand-run above |
| SC-002 only eligible candidates | `test_p5_eligibility_ranking.py` |
| SC-003 Σw=1 + dominance holds | `test_p5_service_math.py` (weights + dominance property) |
| SC-004 17 rows + subtotals reconcile | `test_p5_service_math.py`, `test_p5_response_matrix.py` |
| SC-005 every contract row marked | `test_p5_features.py` (feature-gate completeness) |
| SC-006 determinism/replay | `test_p5_determinism.py` |
| SC-007 editable → changed explanation | `test_p5_service_math.py` (purpose/weight variants), Panel ③ |
| SC-008 confidence off==baseline / on shrinks | `test_p5_confidence_shrinkage.py` |
| SC-009 838 + trigger green, no trigger import | full suite + isolation guard test |
| SC-010 13 contrasts | `test_p5_contrast_golden.py` |
