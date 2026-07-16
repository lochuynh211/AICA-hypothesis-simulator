# Contracts — P3 Proposal API (additive to P1's `/api/proposal`)

All routes are additive on the existing isolated `routers/proposal.py`. Responses are bilingual where
user-facing. No route touches the trigger simulator. Validation failures return **422** with a
field-level `detail` (which field, why).

## Datasets & catalog (read-only)

### `GET /api/proposal/datasets`
List loadable datasets (the frozen P2 dataset; any that fail `Song` validation appear in `errors`, never
partially used).
```
200 → { datasets: [{ dataset_id, dataset_version, dataset_hash, tier, synthetic_only, song_count }], errors: [{ dataset_id, message }] }
```

### `GET /api/proposal/datasets/{dataset_id}/catalog?offset&limit`
Read-only catalog songs + provenance. **No edit/import route exists.**
```
200 → { provenance: {dataset_id, dataset_version, dataset_hash, tier, provenance_note}, total, songs: [Song...] }
404 → unknown dataset_id
```

## Base seeds

### `GET /api/proposal/seeds`
```
200 → { seeds: [{ seed_id, label{ja,en}, description{ja,en} }] }
```
### `GET /api/proposal/seeds/{seed_id}`
```
200 → { seed_id, label, description, world: World }   # complete world, round-trip stable
404 → unknown seed_id
```

## Driver-profile store

### `GET /api/proposal/profiles`
```
200 → { profiles: [{ profile_id, label{ja,en}, builtin }] }
```
### `GET /api/proposal/profiles/{profile_id}` → `{ profile_id, label, builtin, profile: DriverProfile }`
### `POST /api/proposal/profiles` — save a (user) profile
```
body → { label{ja,en}, profile: DriverProfile }
201 → { profile_id, label, builtin:false, profile }
422 → invalid profile (field-level message)
```
### `DELETE /api/proposal/profiles/{profile_id}` — 204 (built-in profiles are not deletable → 409)

## Worlds: clone & validate

### `POST /api/proposal/worlds/clone`
```
body → { base_seed_id, overrides: [{ path, value }] }   # typically one override
201 → { clone_id, base_seed_id, world: World, diff: [{ path, before, after }] }   # diff = exactly the overrides
422 → invalid override path/value or reference
```
`GET /api/proposal/worlds/clones` · `GET /api/proposal/worlds/clones/{clone_id}` ·
`DELETE /api/proposal/worlds/clones/{clone_id}` (204).

### `POST /api/proposal/worlds/validate`
```
body → { world: World }
200 → { valid: bool, issues: [{ path, code, message }] }   # enum/range/purpose-stage/reference
```

## Run creation & STEP 2 (typed world + real content selector)

### `POST /api/proposal/runs` (STEP 1, updated)
`world_snapshot: dict` → **typed `World`** (validated + projected). Freezes a `SetupSnapshot`.
```
body → { world: World, service_package_id, mode?, service_parameters?, service_hyperparameters?, run_seed, simulation_time }
201 → { run: ProposalRunLog(with setup_snapshot), service_output: ServiceSelectorOutput }   # service selector = mock
422 → invalid world (field-level) | unknown/mis-slotted service package
```

### `POST /api/proposal/runs/{run_id}/select-service` (STEP 2, updated)
Invokes the **real** transparent content selector over the world's projected `feature_snapshot` with the
frozen catalog as candidates.
```
body → { selected_service_id, content_parameters?, content_hyperparameters? }
200 → { plan: CompletePlan }                       # real content proposal (deterministic)
200 → { algorithm_error: {category, message} }     # selector raised/invalid → recorded, not faked
422 → service not in content package supported_services (unsupported-service message)
```

## Content-selector wiring contract (internal)

- The real package `aica_transparent_content_selector_v1` gains `family: content_selector`,
  `approach: transparent` in its manifest so the registry loads it into the transparent content slot.
- Its `evaluate(context)` receives `context.feature_snapshot = World.project()` output **plus**
  `catalog` (frozen dataset songs, harness map shape) and `_service_id` (chosen service).
- Return validated into `CompletePlan` by `dispatch_selector`; any raise/invalid-shape/`no_proposal`
  path yields an `algorithm_error` evidence event or explicit no-proposal — never a fabricated plan.
- Candidate set = full frozen catalog; **no** eligibility narrowing (deferred to P4).

## Invariants asserted by contract tests

- Frozen dataset files are byte-unchanged after any P3 operation (read-only).
- `World.project()` output is accepted by the real content selector and is deterministic (golden).
- Identical world + catalog ⇒ identical `CompletePlan`; two worlds differing in a scored profile dimension
  ⇒ different `CompletePlan`.
- Reopening a run renders stored world/setup snapshot/plan with no recompute.
- No route imports trigger models; no network/LLM at runtime.
