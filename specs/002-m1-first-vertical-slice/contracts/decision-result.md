# Contract: DecisionResult (the §11 normalized shape)

Every algorithm output — for M1, `declarative_rule` — is normalized by the adapter
to exactly this shape. Rule-only runs leave hybrid-only fields empty.

```jsonc
{
  "result_type": "REST_PROPOSAL",          // NO_TRIGGER|SOFT_WARNING|REST_PROPOSAL|
                                            // SEVERE_INTERVENTION|NO_PRACTICAL_ACTION_FALLBACK
  "trigger_candidate": true,
  "selected_category": "rest_required",     // or null
  "score": 3.2,                             // ordinal blend (M1 rule); may be null
  "features": { "drowsiness_level": "moderate", "fatigue_level": "medium",
                "signal_duration": "sustained", "rest_spot_eta": "near" },
  "scores": {},                             // hybrid-only; empty for rule
  "states": {},                             // hybrid-only; empty for rule
  "criteria": { "reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0 },
  "candidates": [
    { "category": "rest_required", "exists": true, "score": 3.2, "state": null,
      "strength": "clear",
      "fire_control": { "fired": true, "suppressed": false, "override": false,
                        "reason": "proposal_cut_passed_rest_reachable" } }
  ],
  "fire_control": { "suppressed": false, "override": false, "reason": null },
  "proposal": { "id": "rest_guidance", "message": { "ja": "...", "en": "..." },
                "options": ["accept_rest", "postpone"] },
  "reason_inputs": ["drowsiness_level", "signal_duration", "rest_spot_eta"],
  "explanation": "Damped fatigue/drowsiness blend passed the proposal threshold and a rest spot is reachable.",
  "next_package_runtime_state": {}          // empty for rule
}
```

## Invariants (adapter normalization)
- `result_type` is always one of the five enum values (totality).
- A **suppressed** candidate stays in `candidates` with `fire_control.suppressed =
  true` and no proposal — it is never dropped (FR-008). The top-level `result_type`
  remains one of the five enum values (e.g. `NO_PRACTICAL_ACTION_FALLBACK` when the
  rest candidate is suppressed by the actionability guard, or `SOFT_WARNING`/
  `NO_TRIGGER`); there is no separate `"SUPPRESSED"` result_type.
- When no proposal fires, `proposal` is `null`.
- An algorithm exception or a return that fails validation yields an
  `AlgorithmError` event, **not** a `DecisionResult` (FR-011).
- Same inputs → same `DecisionResult` (determinism; ids/timestamps are not part of
  it).

## Contract tests
- Each of R1–R5 produces the expected `result_type`; totality + determinism.
- The firing R3 result carries a non-null `score`, the `rest_required` candidate,
  fire-control `fired: true`, and the `rest_guidance` proposal.
- A suppressed candidate (R2 actionability guard) remains in `candidates` marked
  suppressed.
- Normalization fills empty hybrid-only fields; invalid algorithm return → error.
