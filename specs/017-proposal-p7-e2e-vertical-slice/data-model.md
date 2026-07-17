# Phase 1 Data Model: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

All changes are **additive** to existing proposal models (`app/api/aica_api/models/proposal/`). No field is removed or retyped; every new field has a default so pre-P7 persisted runs load unchanged.

## Modified: `ProposalRunLog` (`models/proposal/proposal_run.py`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `world` | `World \| None` | `None` | The run's **base typed World** (typed-world path only). Enables recompute to apply overrides + re-validate. `None` for legacy `world_snapshot`-only runs → recompute 422 (FR-006). |
| `opportunity_history` | `list[ProposalOpportunity]` | `[]` | Append-only prior opportunities, **excluding** the current head (`opportunity`). Oldest→newest. |
| `setup_snapshot_history` | `list[SetupSnapshot]` | `[]` | Append-only prior frozen setup snapshots, **excluding** the current head (`setup_snapshot`). Index-aligned with `opportunity_history`. |
| `mode` | `ProposalRunMode` (str enum) | `interactive` | Frozen per-run: `interactive` or `quick_check`. |

Existing top-level `opportunity` and `setup_snapshot` remain the **current head** (the most recent recompute). Every existing reader keeps working.

**Invariants**:
- `len(opportunity_history) == len(setup_snapshot_history)` (each recompute pushes both).
- The full ordered sequence of decision points is `[*opportunity_history, opportunity]` (same for snapshots).
- History lists are never mutated in place after a push; a recompute only appends.

## Modified: `ProposalRun` summary (`models/proposal/proposal_run.py`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `ProposalRunMode` | `interactive` | Surfaced in `GET /api/proposal/runs` listings so a reviewer can tell quick-check runs apart. |

## New enum: `ProposalRunMode` (`models/proposal/enums.py`)

```python
class ProposalRunMode(str, Enum):
    interactive = "interactive"
    quick_check = "quick_check"
```

`CreateProposalRunBody.mode` is retyped from `str = "interactive"` to `ProposalRunMode = ProposalRunMode.interactive` (back-compat: the two legal string values are unchanged).

## Modified enum: `DiscreteEventType` (`models/proposal/enums.py`)

Two new members (append only; no existing value changed):

| Member | Value | Emitted when |
|---|---|---|
| `RECOMPUTED` | `"RECOMPUTED"` | A recompute produces a new decision point (service re-dispatched for the current stage). |
| `CONTEXT_EDITED` | `"CONTEXT_EDITED"` | A recompute carried a non-empty override list (payload: the applied field diffs). |

## New model: `RecomputeRequest` (`models/proposal/recompute.py`)

```python
class RecomputeRequest(BaseModel):
    overrides: list[FieldOverride] = []          # reuse P3 FieldOverride; empty allowed
    parameters: dict[str, Any] = {}              # optional service param overrides (fallback: current head's)
    hyperparameters: dict[str, Any] = {}         # optional service hyperparam overrides
    content_parameters: dict[str, Any] = {}      # used only in quick_check content dispatch (fallback: content pkg defaults)
    content_hyperparameters: dict[str, Any] = {}
```

`FieldOverride` is the existing `{path: str, value: Any}` model (`models/proposal/world.py`), the same shape `POST /worlds/clone` already accepts.

## Decision point (conceptual entity)

One recompute (or the initial create) produces one **decision point** = `(ProposalOpportunity, SetupSnapshot, service AlgorithmEvidence[, content AlgorithmEvidence])`. Frozen and replayable. The run log stores decision points as: current head (`opportunity`/`setup_snapshot`) + append-only history + the flat `evidence` list (each `AlgorithmEvidence` already carries its own frozen `input_snapshot` and `step`).

## State transitions (recompute effect on `JourneyState`)

On a successful recompute (per clarification 2026-07-17):

| Field | New value |
|---|---|
| `lifecycle_stage` | unchanged (already advanced by the preceding journey action) |
| `motion_state` | unchanged |
| `active_service_id` | reset: rank-1 (quick_check) or `None` (interactive) |
| `rejected_service_ids` | reset to `[]` for the new opportunity |
| `playback_state` | unchanged — **precondition**: must be `idle`/`stopped`/`completed`/`paused`; `active`/`backgrounded` → 422 (FR-006a) |
| `previous_content` | preserved (restorable content reference survives the recompute) |

## Run status after recompute

| Situation | `ProposalRunStatus` |
|---|---|
| interactive, ≥1 ranked candidate | `service_selected` |
| quick_check, rank-1 exists, content ok | `content_selected` |
| any mode, zero eligible / no ranked candidate | `service_selected` (with `NO_ELIGIBLE_CANDIDATE` event) |
| selector `ALGORITHM_ERROR` | `error` |

## Run-manager surface (`services/proposal_run_manager.py`)

- `create_run(...)` gains `world: World | None = None` and `mode: ProposalRunMode = interactive` params (deep-copied/stored).
- `update_state(...)` gains `opportunity`, `world_snapshot`, `opportunity_history`, `setup_snapshot_history` kwargs (all `None`-default = unchanged; lists replaced wholesale with the caller-assembled append-only list, deep-copied).

No new persistence format: the log is still one `proposal_runs/<run_id>.json`, now with the additional fields.
