# rest_rule_based_v0_1 — Rule-Based Rest Proposal Package

**Version**: 0.1.0  
**Algorithm type**: `declarative_rule`  
**Compatible scenario types**: `uc01_fatigue`

## Purpose

This package implements AICA's UC-01 (fatigue / drowsiness) trigger using a
first-match declarative rule set (R1–R5). It blends ordinal danger signals
into a single damped risk reading and classifies it against qualitative
cut-points set by the hyperparameters.

## Input features

| Feature | Bands (low → high) |
|---|---|
| `drowsiness_level` | none · weak · moderate · strong · severe |
| `fatigue_level` | low · medium · high |
| `signal_duration` | transient · brief · sustained · persistent |
| `continuous_driving_time` | short · moderate · long |
| `rest_spot_eta` | none · near · far |

## Decision logic (R1–R5, first match)

The algorithm computes an **ordinal blend score** from the banded inputs,
damps it by the `persistence_requirement` hyperparameter, then classifies:

| Rule | Result type | Condition |
|---|---|---|
| R1 | `SEVERE_INTERVENTION` | Drowsiness is `severe`, OR damped blend ≥ severeCut |
| R2 | `NO_PRACTICAL_ACTION_FALLBACK` | damped ≥ proposalCut AND rest NOT reachable |
| R3 | `REST_PROPOSAL` | damped ≥ proposalCut AND rest reachable |
| R4 | `SOFT_WARNING` | damped ≥ reactionPoint |
| R5 | `NO_TRIGGER` | catch-all |

**Cut-points** (tunable via hyperparameters):
- `reactionPoint = 1.8 − ord(trigger_sensitivity) × 0.4`  (low=1.8 · med=1.4 · high=1.0)
- `proposalCut   = 2.0 + ord(proposal_threshold)  × 1.0`  (low=2.0 · med=3.0 · high=4.0)
- `severeCut     = 3.0 + ord(severe_threshold)    × 1.0`  (low=3.0 · med=4.0 · high=5.0)

**Blend formula** (ordinal arithmetic):
```
blend = drowsiness × (0.5 + 0.25 × wD) + fatigue × (0.2 × wF) + drive × 0.4
damped = max(0, blend − shortfall + persistenceLift)
  where shortfall      = max(0, (persistence_req + 1) − signal_dur)
        persistenceLift = max(0, signal_dur − 1) × 0.6
```
`wD` and `wF` default to ordinal 1 (medium) when not explicitly set.

**Actionability guard** (`require_actionable=true`, default):
A rest spot is reachable unless `rest_spot_eta=none`, or `rest_spot_eta=far`
with `rest_spot_sensitivity=low`. Unreachable → R2 suppresses R3.

## Hyperparameters

| Key | Bands | Default | Effect |
|---|---|---|---|
| `trigger_sensitivity` | low · medium · high | medium | Lowers/raises reactionPoint |
| `proposal_threshold` | low · medium · high | medium | Lowers/raises proposalCut |
| `severe_threshold` | low · medium · high | medium | Lowers/raises severeCut |
| `persistence_requirement` | low · medium · high | medium | How long a sign must persist |
| `require_actionable` | bool | true | Enforce actionability guard |
| `rest_spot_sensitivity` | low · medium · high | medium | Far-spot reachability tolerance |

## Proposal

When R3 fires, the `rest_guidance` proposal is surfaced with options
`accept_rest` and `postpone`.
