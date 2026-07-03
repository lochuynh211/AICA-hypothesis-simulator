# Contract — Tiered Adapter Context

The dict passed to `evaluate(context)` (Constitution V, unchanged entry point). The re-design changes
the **contents**, not the contract shape: signals are grouped by tier and the removed signals are gone.

## Shape

```jsonc
{
  "signals": {
    "fixed":     { "isNight": false, "familiarRoute": true, "childPassenger": true, "weatherRiskLevel": 0.0 },
    "dynamic":   { "segmentType": "highway", "motionState": "MOVING", "continuousDrivingMin": 29.0,
                   "speedKph": 100.0, "routeFraction": 0.24, "nextRestSpotMin": 30.0,
                   "isTrafficJam": false, "recoveryPhase": null },
    "simulated": { "drowsiness": 62.0, "fatigue": 40.0, "anomaly_rate": 2 }
  },
  "feature_groups": { "ordinal": { ... }, "normalized": { ... } },   // route boundary-binning preserved (Principle IV)
  "hyperparameters": { ... },        // manifest defaults ⊕ overrides, fully resolved (no algo-side fallback)
  "package_runtime_state": { ... },  // algorithm's own carried state (smoothed features, jam/hw/mono_min, counters)
  "proposal_history": { ... },       // fire-control (unchanged)
  "simulation_time_sec": 1740.0,
  "recovery_active": false
}
```

## Rules

- **All tiers always present**; an algorithm reads whichever signals it needs (FR-002). NRI ignores
  `anomaly_rate`; the Hybrid uses it.
- **Removed keys MUST be absent**: `attentionLevel`, `steeringInstabilityLevel`, `pedalAbnormalityLevel`,
  `laneDepartureCount`, `adasWarningCount`, `*RemainingMin`, `restSpotDensityNext30Min`.
- `hyperparameters` is **fully resolved** by the adapter from the manifest defaults + overrides; algorithms
  MUST NOT apply their own hardcoded fallback defaults (FR-009).
- Back-compat convenience flattening (if any) MUST NOT reintroduce removed signals.
- The **ephemeral** and **persisted** paths build the *same* context; only persistence differs.

## Tests (required)

1. Context for a tick contains exactly the three tier groups with the expected keys; none of the removed
   keys appear.
2. `hyperparameters` equals manifest-default ⊕ overrides for both packages; an algorithm run with no
   overrides uses pure manifest defaults.
3. An algorithm that reads a key with no manifest default fails a package-validation test (guards FR-009).
