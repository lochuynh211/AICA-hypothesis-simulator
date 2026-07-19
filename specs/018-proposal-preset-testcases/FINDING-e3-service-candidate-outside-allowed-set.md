# FINDING — `preset-journey-e-3-rest-stop-stretch` service decision errors

> **RESOLVED 2026-07-19.** Root cause was NOT the algorithm (as originally hypothesised below) but the
> **safety-net check** in `services/proposal_selector.py::dispatch_selector`. The service algorithm
> correctly PASSES THROUGH the platform-excluded `oshi_reexperience` in its output
> `excluded_candidates` (the transparent "unavailable: no oshi registered" report — this is desired,
> NOT a defect). The safety net then wrongly validated `excluded_candidates` against the *eligible*
> `allowed_service_ids` (which excludes them by design) and rejected the whole run. Fix: the
> excluded-candidate guard now permits candidates that were handed IN via
> `context['excluded_candidates']` (platform exclusions); only RANKED candidates must be within the
> eligible set. Regression test: `test_us3_failure_visibility.py::test_platform_excluded_candidate_passthrough_is_not_flagged_outside_allowed_set`.
> After-rest + oshi-off runs now return `service_selected` with `oshi_reexperience` shown as excluded.
> (The original "fix the algorithm to drop oshi_reexperience" suggestion below would have been WRONG —
> it would hide a legitimate transparent exclusion.)

**Severity:** medium (one preset produces `status=error` instead of a service proposal)
**Owner area:** 018 presets / service-selector matrix + `aica_transparent_service_selector_v1` algorithm
**Found by:** feature-019 (LLM rationale) full-preset accuracy sweep, 2026-07-18 — NOT a 019 issue; the
explanation layer correctly had nothing to explain because the decision itself errored.

## Symptom

Creating a run from `preset-journey-e-3-rest-stop-stretch` yields a **service `AlgorithmEvidence.error`**
(no `ranked_candidates`), so the run ends `status=error`:

```
category: candidate_outside_allowed_set
message:  evaluate() returned candidate_id(s) ['oshi_reexperience'] not in the opportunity's
          frozen allowed_service_ids ['call_response_stopped', 'full_karaoke', 'live_viewing', 'stretch_video'].
```

## Root cause

At this opportunity — `trigger_purpose=rest_recommended`, `lifecycle_stage=after_rest_before_restart`,
`motion_state=stopped`, and the driver has **oshi off** (`oshi_registered=false`, `oshi_mode=off`):

- The **matrix** `allowed_service_ids` is correct: `[live_viewing, stretch_video, full_karaoke, call_response_stopped]` (no `oshi_reexperience`).
- **Eligibility** is correct: it explicitly **excludes** `oshi_reexperience` with
  `platform_reason="missing_required_entity"` (no oshi registered).
- **But the service algorithm (`packages/aica_transparent_service_selector_v1/algorithm.py`) still
  RETURNS `oshi_reexperience`** from `evaluate()`. The adapter safety-net
  (`services/proposal_selector.py` → `candidate_outside_allowed_set`) then correctly rejects the whole
  result. So the safety net is working; the algorithm is the defect.

The algorithm is scoring/returning a candidate that is both **excluded** and **outside the frozen
allowed set**, instead of restricting its output to `eligible_candidates` / `allowed_service_ids`.

## Why only this preset

It is the only preset that combines `after_rest_before_restart` + `stopped` + **oshi off**. Other
rest/stopped stages either have oshi on (so `oshi_reexperience` is legitimately eligible, no conflict)
or a different lifecycle stage. So the algorithm's stopped/rest branch appears to include
`oshi_reexperience` unconditionally without re-checking eligibility.

## Repro

```python
# from app/api, with the real transparent packages
world = json.load(open("proposal_contracts/presets/preset-journey-e-3-rest-stop-stretch.json"))["world"]
# POST /api/proposal/runs with this world + aica_transparent_service_selector_v1
# → service evidence has error.category == "candidate_outside_allowed_set"
```

## Suggested fix (service-selector algorithm)

`evaluate()` must only ever return candidates present in `context["eligible_candidates"]` /
`allowed_service_ids`. Filter the candidate universe (or the final ranked list) against the eligible
set before returning — in particular drop `oshi_reexperience` when it was excluded
(`missing_required_entity`). No change to the matrix or eligibility is needed; both are already correct.

## Note

Independent of feature 019. Surfaced purely as a side effect of running every preset through the
pipeline to grade LLM-generated reasons.
