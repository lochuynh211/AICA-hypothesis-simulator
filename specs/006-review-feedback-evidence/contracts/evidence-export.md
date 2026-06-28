# Contract: evidence export

## GET /api/runs/{run_id}/evidence
Returns the derived master §14.2 evidence report for any persisted run (active or on-disk),
separating machine facts from human review:
```
{ report_id, run_id, timestamp, ui_language: "bilingual", simulator_version,
  package: {id, version}, scenario: {id, version},
  simulator_facts: { route_snapshot, route_facts, event_plan, run_mode, evidence_status,
    initial_parameters, final_parameters?, initial_hyperparameters, final_hyperparameters?,
    driver_profile, vehicle_profile, timeline_events, decision_trace, proposal_events, actions,
    expert_override_events?, algorithm_errors, run_comparison_reference? },
  human_review: { feedback_labels: [...], free_text_comments: [...] } }
```
- Derived from the persisted `RunLog`. `decision_trace` / `timeline_events` / `proposal_events` from
  the TickEvents (proposal_events = ticks whose decision fired a proposal); `actions` from
  ActionEvents; `algorithm_errors` from AlgorithmErrors; `human_review` from FeedbackEvents (labels
  vs comments split).
- **Separation invariant:** feedback appears ONLY under `human_review`; `simulator_facts` NEVER
  contains a feedback value.
- **Conditional sections** (`final_*`, `expert_override_events`, `run_comparison_reference`) appear
  only when present (none in V1 except `final_*` when setup changed — which V1 doesn't do mid-run).
- **Reproducibility (§14.3):** the report carries simulator_version, package/scenario id+version,
  route_snapshot + route_facts, event_plan, parameter + hyperparameter values, driver/vehicle
  profiles, timeline events, and actions.
- The report MUST NOT claim the simulator independently judged the algorithm.

## Frontend
Copy-to-clipboard + download of this JSON. (Markdown deferred to M6.)

## Contract tests
- evidence report carries the full §14.2 contents; reproducibility fields all present.
- feedback ONLY under `human_review` (labels vs free_text_comments split); facts never include feedback.
- conditional sections present only when applicable (empty/omitted otherwise).
- a run with no feedback → `human_review` empty; facts complete.
- works for an active run and an on-disk run.
