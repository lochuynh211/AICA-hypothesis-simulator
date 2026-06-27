# Phase 1 Data Model: M1 First Runnable Vertical Slice

Pydantic v2 models (backend) mirrored by TypeScript types (frontend `api/types.ts`).
Bands are string enums; route uses `at` fractions. Only fields M1 uses are listed;
the `DecisionResult` carries the full §11 shape but rule-only runs leave
hybrid-only fields empty.

## Package domain (`models/package.py`)

### PackageManifest
| Field | Type | Notes |
|---|---|---|
| `id` | str | e.g. `rest_rule_based_v0_1` |
| `version` | str | semver |
| `label` | dict[str,str] | `{ja,en}` |
| `compatible_scenario_types` | list[str] | e.g. `["uc01_fatigue"]` |
| `algorithm` | `{type: "declarative_rule", entrypoint: str}` | type enum (M1: declarative_rule only) |
| `parameters` | list[ParameterDef] | setup-time values |
| `features` | list[FeatureDef] | inputs consumed |
| `hyperparameters` | list[HyperparameterDef] | tuning bands |
| `trigger_categories` | list[TriggerCategoryDef] | M1: `rest_required` (priority 1) |
| `rules` | list[dict] | declarative R1–R5 spec |
| `fire_control` | FireControlRule | threshold + actionability guard |
| `proposals` | list[ProposalDef] | `rest_guidance` |
| `feedback_schema` | list[dict] | placeholder (M5) |
| `evidence_metrics` | list[str] | minimal |

- **ParameterDef / HyperparameterDef**: `key`, `label{ja,en}`, `kind` (`band`|`bool`),
  `band_values` (ordered) or bool default, `default`.
- **FeatureDef**: `key`, `band_values` (ordered ordinal vocabulary).
- **TriggerCategoryDef**: `id`, `priority`.
- **ProposalDef**: `id`, `message{ja,en}`, `options` (`["accept_rest","postpone"]`).
- **FireControlRule**: `threshold_source`, `actionability_guard` descriptor.

**Validation**: unknown algorithm type → invalid; band defaults must be members of
their `band_values`; `compatible_scenario_types` non-empty. Invalid manifest is
reported (FR-002), never partially loaded.

## Scenario domain (`models/scenario.py`)

### ScenarioDef
| Field | Type | Notes |
|---|---|---|
| `id` | str | `uc01_fatigue_friend_drive_v0_1` |
| `version` | str | |
| `type` | str | `uc01_fatigue` (matched against package compat) |
| `persona` | Persona | |
| `route_intent` | RouteIntent | |
| `initial_state` | dict | `{drowsiness_level, fatigue_level}` bands |
| `event_presets` | EventPreset | deterministic schedules |
| `driver_profile` / `vehicle_profile` | profile | default |
| `total_duration_seconds` | int | bounds the run |
| `tick_seconds` | int | fixed sim-time step |
| `allowed_actions` | list[str] | `["accept_rest","postpone"]` |
| `review_focus` | str | |

- **RouteSegment**: `id`, `name{ja,en}`, `type` (start|urban|highway|national|residential|rest|end),
  `at` (float 0..1), `speed_band`, `length_band`, `is_rest_facility` (bool).
- **RouteIntent**: `rest_facility{label}`, `segments: list[RouteSegment]`.
- **EventPreset**: `drowsiness_schedule: [{at, band}]`, `signal_duration_at_trigger`,
  `rest_spot_eta_schedule` (or `rest_spot_eta_near_before` segment id).

**Validation**: segment `at` monotonic increasing in [0,1]; exactly one
`is_rest_facility`; `type` compatible with at least one available package.

## Run domain (`models/run.py`)

- **EventPlan** (frozen at run start): resolved per-tick schedule derived from
  `event_presets` — for each tick index, the active drowsiness band, signal
  duration, rest_spot_eta, and route position. Deterministic; persisted in the log.
- **TickState**: `tick_index`, `elapsed_seconds`, `route_fraction`,
  `active_segment_id`, derived bands (`drowsiness_level`, `fatigue_level`,
  `signal_duration`, `continuous_driving_time`, `rest_spot_eta`), `completed` flag.
- **RouteFacts**: bounded/snapshot route evidence (segments + bands), no raw geometry.
- **Snapshot**: `package` (id, version, hash), `scenario` (id, version, hash).
- **RunState**: `run_id`, `status` (`created|playing|paused|completed`),
  `current_tick`, `pending_proposal` (proposal id | null), `package_runtime_state`
  (empty for rule), plus the frozen `snapshot`, `event_plan`, `route_facts`.

**State transitions**: `created → playing` (first tick) → `paused` (proposal fired)
→ `playing` (action resolves) → `completed` (route end). Actions only valid while
`paused` with a `pending_proposal`.

## Decision domain (`models/decision.py`) — full §11

### DecisionResult
`result_type` (NO_TRIGGER|SOFT_WARNING|REST_PROPOSAL|SEVERE_INTERVENTION|NO_PRACTICAL_ACTION_FALLBACK),
`trigger_candidate` (bool), `selected_category` (str|null), `score` (float|null —
ordinal blend for M1 rule), `features` (dict), `scores` (dict), `states` (dict),
`criteria` (dict — cut-points), `candidates` (list[Candidate]), `fire_control`
(FireControl), `proposal` (Proposal|null), `reason_inputs` (list[str]),
`explanation` (str), `next_package_runtime_state` (dict — empty for rule).

- **Candidate**: `category`, `exists` (bool), `score` (float), `state` (str|null),
  `strength` (str|null), `fire_control` (FireControl). **Suppressed candidates stay
  in the list with `fire_control.suppressed = true`** (FR-008).
- **FireControl**: `fired` (bool), `suppressed` (bool), `override` (bool),
  `reason` (str|null).
- **Proposal**: `id`, `message{ja,en}`, `options`.

**Normalization invariant** (adapter): every algorithm output is coerced to this
shape; missing optional fields default to empty; an invalid/raising algorithm
produces an `AlgorithmError`, never a `DecisionResult` (FR-011).

## Log domain (`models/log.py`) — append-only evidence

### RunLog (`runs/<run_id>.json`)
`run_id`, `created_at`, `simulator_version`, `snapshot` (package+scenario),
`route_facts`, `event_plan`, `run_mode` (`standard`), `evidence_status`
(`standard`), `events` (ordered append-only list).

- **events[]** entries (discriminated by `kind`):
  - `TickEvent`: `tick_index`, `tick_state`, `trace` (TraceEntry)
  - `ActionEvent`: `tick_index`, `action`, `resulting_status`
  - `AlgorithmError`: `tick_index`, `error_type`, `message`
- **TraceEntry**: the `DecisionResult` for that tick (full shape, incl. suppressed
  candidates), plus `tick_index`.

**Persistence rule** (evidence_recorder): after every appended event the full log is
written to disk; existing events are never rewritten (FR-012). Simulator facts
(tick/decision/action/error) are kept distinct from any future human comments.
