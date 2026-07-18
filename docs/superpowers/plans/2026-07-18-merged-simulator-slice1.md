# Merged "Combined Simulator" — Slice 1 Implementation Plan (feature 020)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A selectable third "Combined" screen where the trigger tick engine drives a drive and, on the first `REST_PROPOSAL` fire, the existing proposal service+content selectors produce the rest proposal — shown in a 20:60:20 layout with a merged trigger+proposal log.

**Architecture:** A new backend `merged_runs` router coordinates the *existing* trigger (`run_manager`) and proposal (`create_proposal_run` handler) pipelines — reimplementing neither — via a pure `TriggerTickAdapter` and a `merged_runs/<id>.json` correlation record. The frontend adds an `appMode='merged'` screen mounting both stores under a coordinator context; UI reuses existing playback + proposal-explainability components.

**Tech Stack:** Backend Python 3.12 / FastAPI / Pydantic v2 / pytest. Frontend React 18 / TypeScript / Vite / Vitest / Testing-Library.

## Global Constraints

- **Do not change existing trigger or proposal API behavior.** All existing 2270+ backend / 610+ frontend tests must stay green. New code is additive.
- The merged coordination module is the **only** module allowed to import both `run_manager`/`tick_engine` and the proposal router/`proposal_run_manager`. Existing isolation tests (`routers/proposal.py` never imports `aica_api.algorithms`; `proposalStore` never imports `runStore`) must pass unmodified.
- **Eligibility-before-ranking** is preserved by only ever calling `create_proposal_run` / `apply_journey_action` / `select_service` (which run `resolve_eligibility` internally) — never `dispatch_selector` directly.
- **MotionState 2-field sync:** whenever motion is set on a `World`, write **both** `control_inputs.motion_state` and `situation.motion_state`.
- Slice 1 scope: **one trigger fire → one proposal run, `rest_recommended` only, `lifecycle_stage=before_rest_until_stop`.** No rest journey chain, no recompute, no enriched recovery, no monotony, no quickview projection (trigger-only preview reuse is fine). Those are Slices 2–3.
- TDD, DRY, YAGNI, frequent commits. Branch: create `020-merged-simulator` off `develop` before Task 1.
- Verbatim enums: trigger `result_type ∈ {REST_PROPOSAL, MONOTONY_PROPOSAL, SUPPRESSED, NO_PROPOSAL}`; `TriggerPurpose` values `rest_recommended | inattentive_driving_prevention_recovery | route_music | child_passenger_experience`; `LifecycleStage` values `before_rest_until_stop | during_rest_stopped | after_rest_before_restart | active_driving_content`; `MotionState` values `driving | stopped`.

---

## File Structure

**Backend (new):**
- `app/api/aica_api/models/merged_run.py` — `MergedRunHandle`, `CreateMergedRunBody`, `MergedTickResponse`, `MergedProposalActionBody`, `CorrelationEntry`.
- `app/api/aica_api/services/merged_adapter.py` — pure `TriggerTickAdapter`: `map_trigger_purpose`, `map_lifecycle_stage`, `map_road_type`, `build_world_from_tick`.
- `app/api/aica_api/services/merged_run_coordinator.py` — handle registry + `merged_runs/<id>.json` persistence.
- `app/api/aica_api/routers/merged_runs.py` — the 3 endpoints.
- Modify: `app/api/aica_api/main.py` (register router, ~2 lines), `app/api/aica_api/config.py` (add `merged_runs_dir`).

**Frontend (new):**
- `app/frontend/src/state/appMode.tsx` — widen `AppMode` union (modify).
- `app/frontend/src/App.tsx` — add `merged` arm + toggle button (modify).
- `app/frontend/src/styles/app.css` — add `.merged-shell` grid + `.modal-*` classes (modify).
- `app/frontend/src/api/mergedClient.ts` — `createMergedRun`, `tickMergedRun`, `mergedProposalAction`.
- `app/frontend/src/state/mergedCoordinator.tsx` — `MergedCoordinatorProvider` + `useMergedCoordinator` (owns merged run id, tick loop, exposes trigger tick state + proposal `runLog`).
- `app/frontend/src/components/merged/MergedShell.tsx` — 3-panel scaffold.
- `app/frontend/src/components/merged/MergedSetupPanel.tsx` — left setup (slice-1 minimal + Modal).
- `app/frontend/src/components/merged/Modal.tsx` — reusable portal/focus-trap popup (net-new primitive).
- `app/frontend/src/components/merged/MergedCenterPanel.tsx` — quickview + animation + proposal overlay dock.
- `app/frontend/src/components/merged/ServiceResultOverlay.tsx` / `ContentResultOverlay.tsx` — extracted result views.
- `app/frontend/src/components/merged/MergedLogPanel.tsx` — merged trigger+proposal log.

---

## Task 1: Merged run models

**Files:**
- Create: `app/api/aica_api/models/merged_run.py`
- Test: `app/api/tests/test_merged_run_models.py`

**Interfaces:**
- Produces:
```python
class CorrelationEntry(BaseModel):
    trigger_tick_index: int
    proposal_run_id: str
    proposal_event_ids: list[str] = []          # DiscreteEvent has no id; use f"{event_type}@{at}" keys

class MergedRunHandle(BaseModel):               # persisted to merged_runs/<merged_run_id>.json
    merged_run_id: str
    trigger_run_id: str
    world_template: dict                        # World.model_dump() — INLINE proposal fields; GENERATED overwritten per fire
    service_package_id: str
    content_package_id: str
    proposal_mode: str = "interactive"          # interactive | quick_check
    run_seed: str
    proposal_run_ids: list[str] = []
    current_proposal_run_id: str | None = None
    correlation_log: list[CorrelationEntry] = []

class CreateMergedRunBody(BaseModel):
    trigger_plan_id: str                        # a draft already built via existing POST /api/run-plans
    world: World                                # base World template (typed)
    service_package_id: str
    content_package_id: str
    proposal_mode: str = "interactive"
    run_seed: str

class MergedProposalActionBody(BaseModel):
    kind: Literal["select_service", "journey_action"]
    selected_service_id: str | None = None      # kind=select_service
    action_type: str | None = None              # kind=journey_action
    payload: dict = Field(default_factory=dict)

class MergedTickResponse(BaseModel):
    trigger: dict                               # same shape routers/runs.py tick returns
    proposal: dict | None = None                # ProposalRunLog.model_dump() when a fire created/updated one
    correlation: CorrelationEntry | None = None
```

- [ ] **Step 1: Write failing test** — `test_merged_run_models.py`:
```python
from aica_api.models.merged_run import MergedRunHandle, CreateMergedRunBody, MergedTickResponse, CorrelationEntry

def test_handle_roundtrips_and_defaults():
    h = MergedRunHandle(merged_run_id="m1", trigger_run_id="r1", world_template={}, service_package_id="svc", content_package_id="cnt", run_seed="7")
    assert h.proposal_run_ids == [] and h.current_proposal_run_id is None
    assert MergedRunHandle.model_validate(h.model_dump()) == h

def test_correlation_entry_shape():
    c = CorrelationEntry(trigger_tick_index=12, proposal_run_id="prun_x")
    assert c.proposal_event_ids == []
```
- [ ] **Step 2: Run** `cd app/api && .venv/bin/pytest tests/test_merged_run_models.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement** `models/merged_run.py` with the classes above (import `World` from `aica_api.models.proposal.world`).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 run models`.

**Acceptance:** models import and round-trip; no existing test touched.

---

## Task 2: TriggerTickAdapter (pure mapping) — the core seam

**Files:**
- Create: `app/api/aica_api/services/merged_adapter.py`
- Test: `app/api/tests/test_merged_adapter.py`

**Interfaces:**
- Consumes: `run_manager.TickOutcome` (`.decision`, `.tick_state`, `.evaluated_tick_index`); `tick_state.signals` = `{fixed, dynamic, simulated}`.
- Produces:
```python
def map_trigger_purpose(result_type: str) -> str | None:
    """REST_PROPOSAL->rest_recommended; MONOTONY_PROPOSAL->inattentive_driving_prevention_recovery; else None."""

def map_lifecycle_stage(*, fired: bool, result_type: str, recovery_phase: str | None) -> str:
    """Slice-1: recovery_phase set -> during_rest_stopped; REST fired -> before_rest_until_stop; else active_driving_content."""

def map_road_type(segment_type: str | None) -> str:
    """highway->highway; normal_road->local; mountain_road->mountain; rest/None->parking; sightseeing_road->local."""

def build_world_from_tick(world_template: World, tick_state, *, trigger_purpose: str, lifecycle_stage: str) -> World:
    """Overwrite GENERATED situation/control fields from tick_state onto the INLINE template. Writes motion_state to BOTH locations."""
```

- [ ] **Step 1: Write failing tests** — `test_merged_adapter.py`:
```python
import pytest
from aica_api.services.merged_adapter import (map_trigger_purpose, map_lifecycle_stage, map_road_type, build_world_from_tick)
from aica_api.models.proposal.world import World

@pytest.mark.parametrize("rt,exp", [("REST_PROPOSAL","rest_recommended"),
    ("MONOTONY_PROPOSAL","inattentive_driving_prevention_recovery"),("SUPPRESSED",None),("NO_PROPOSAL",None)])
def test_purpose_mapping(rt, exp): assert map_trigger_purpose(rt) == exp

def test_stage_mapping():
    assert map_lifecycle_stage(fired=True, result_type="REST_PROPOSAL", recovery_phase=None) == "before_rest_until_stop"
    assert map_lifecycle_stage(fired=False, result_type="NO_PROPOSAL", recovery_phase=None) == "active_driving_content"
    assert map_lifecycle_stage(fired=True, result_type="REST_PROPOSAL", recovery_phase="nap") == "during_rest_stopped"

def test_road_mapping():
    assert map_road_type("mountain_road") == "mountain"
    assert map_road_type("highway") == "highway"
    assert map_road_type(None) == "parking"

def test_build_world_overwrites_generated_and_syncs_motion(base_world_template, fake_tick_state):
    # fake_tick_state.signals = {"fixed":{"isNight":True}, "dynamic":{"motionState":"STOPPED","isTrafficJam":True,"segmentType":"mountain_road","nextRestSpotMin":3}, "simulated":{"drowsiness":72.4,"fatigue":55.1}}
    w = build_world_from_tick(base_world_template, fake_tick_state, trigger_purpose="rest_recommended", lifecycle_stage="before_rest_until_stop")
    assert w.situation.drowsiness_level == 72 and w.situation.fatigue_level == 55
    assert w.situation.traffic_state == "congested" and w.situation.road_type == "mountain" and w.situation.night_state == "night"
    assert w.situation.motion_state == "stopped" and w.control_inputs.motion_state == "stopped"   # BOTH synced
    assert w.control_inputs.trigger_purpose == "rest_recommended" and w.control_inputs.lifecycle_stage == "before_rest_until_stop"
    # INLINE fields preserved from template:
    assert w.driver_profile == base_world_template.driver_profile
    assert w.situation.destination_tags == base_world_template.situation.destination_tags
```
Add fixtures `base_world_template` (a minimal valid `World` — build via the proposal test factory in `app/api/tests/proposal/` conftest if present, else construct inline) and `fake_tick_state` (a `SimpleNamespace` with `.signals`, `.route_fraction`, `.distance_km`).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_merged_adapter.py -q` → FAIL.
- [ ] **Step 3: Implement** `merged_adapter.py`. `build_world_from_tick` reads `signals["simulated"]/["dynamic"]/["fixed"]`, rounds drowsiness/fatigue to int, maps traffic/road/night/motion, sets `monotony_level=0` (slice-1 default), `estimated_min_until_rest_spot=round(nextRestSpotMin)` if present else None, `rest_spot_type` unchanged from template, then:
```python
motion = "stopped" if dynamic.get("motionState") == "STOPPED" else "driving"
new_situation = world_template.situation.model_copy(update={... , "motion_state": motion})
new_ci = world_template.control_inputs.model_copy(update={"trigger_purpose": trigger_purpose, "lifecycle_stage": lifecycle_stage, "motion_state": motion})
return world_template.model_copy(update={"situation": new_situation, "control_inputs": new_ci})
```
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 TriggerTickAdapter mapping`.

**Acceptance:** all adapter unit tests pass; function is pure (no IO). This is the design's core seam (§4).

---

## Task 3: Merged run coordinator (registry + persistence)

**Files:**
- Create: `app/api/aica_api/services/merged_run_coordinator.py`
- Modify: `app/api/aica_api/config.py` (add `merged_runs_dir: pathlib.Path` default `<data>/merged_runs`, mirror existing `runs_dir`)
- Test: `app/api/tests/test_merged_run_coordinator.py`

**Interfaces:**
- Produces:
```python
def create_handle(*, merged_run_id: str, trigger_run_id: str, world_template: dict, service_package_id: str,
                  content_package_id: str, proposal_mode: str, run_seed: str, merged_dir: pathlib.Path) -> MergedRunHandle
def get_handle(merged_run_id: str, merged_dir: pathlib.Path) -> MergedRunHandle | None
def save_handle(handle: MergedRunHandle, merged_dir: pathlib.Path) -> None      # atomic write, mirrors proposal_run_manager._persist
def make_merged_run_id() -> str                                                  # "mrun_<YYYYMMDD-HHMMSS>_<6hex>"
```
Persist with the existing `storage.file_store.write_json_atomic` helper.

- [ ] **Step 1: Write failing test** — create handle, save, get back equal; unknown id → None.
```python
def test_create_save_get(tmp_path):
    from aica_api.services import merged_run_coordinator as mc
    h = mc.create_handle(merged_run_id="m1", trigger_run_id="r1", world_template={}, service_package_id="s", content_package_id="c", proposal_mode="interactive", run_seed="7", merged_dir=tmp_path)
    mc.save_handle(h, tmp_path)
    assert mc.get_handle("m1", tmp_path) == h
    assert mc.get_handle("nope", tmp_path) is None
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the module + config field.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 coordinator persistence`.

**Acceptance:** handle round-trips through `merged_runs/<id>.json`; determinism-free (id minted once).

---

## Task 4: Merged runs router — create + tick + proposal-action

**Files:**
- Create: `app/api/aica_api/routers/merged_runs.py`
- Modify: `app/api/aica_api/main.py` (`from .routers import merged_runs` + `app.include_router(merged_runs.router)`)
- Test: `app/api/tests/test_merged_runs_router.py`

**Interfaces:**
- Consumes: `run_manager.create_run`, `run_manager.tick`; `routers.proposal.create_proposal_run` + `CreateProposalRunBody`, `routers.proposal.select_service` + `SelectServiceBody`, `routers.proposal.apply_journey_action` + `models.proposal.journey_action.JourneyAction`; `merged_adapter.*`; `merged_run_coordinator.*`; `config.get_settings()`.
- Endpoints:
  - `POST /api/merged-runs` (`CreateMergedRunBody`) → creates trigger run via `create_run(trigger_plan_id, run_id, settings.runs_dir)`, builds + saves handle, returns `{merged_run_id, trigger_run_id}` (201).
  - `POST /api/merged-runs/{merged_run_id}/tick` → `MergedTickResponse` (see logic below).
  - `POST /api/merged-runs/{merged_run_id}/proposal-action` (`MergedProposalActionBody`) → returns updated `ProposalRunLog.model_dump()`.

**Tick logic (the integration seam):**
```python
handle = get_handle(id) or 404
outcome = run_manager.tick(handle.trigger_run_id)
trigger_dict = _serialize_trigger_tick(outcome)          # replicate routers/runs.py:330-343 shape (helper in this module)
resp = MergedTickResponse(trigger=trigger_dict)
d = outcome.decision
fired = bool(d and d.fire_control.fired and d.proposal is not None)
purpose = map_trigger_purpose(d.result_type) if d else None
if fired and purpose is not None and handle.current_proposal_run_id is None:   # slice-1: first fire only
    stage = map_lifecycle_stage(fired=True, result_type=d.result_type, recovery_phase=None)
    world = build_world_from_tick(World.model_validate(handle.world_template), outcome.tick_state, trigger_purpose=purpose, lifecycle_stage=stage)
    body = CreateProposalRunBody(world=world, trigger_purpose=purpose, lifecycle_stage=stage,
        motion_state=world.control_inputs.motion_state, service_package_id=handle.service_package_id,
        content_package_id=handle.content_package_id, mode=handle.proposal_mode, run_seed=handle.run_seed,
        simulation_time=outcome.evaluated_tick_index or 0)
    try:
        plog = create_proposal_run(body)                 # existing handler; runs resolve_eligibility internally
    except HTTPException as e:
        resp.trigger["proposal_error"] = str(e.detail);  return resp
    handle.proposal_run_ids.append(plog.run_id); handle.current_proposal_run_id = plog.run_id
    corr = CorrelationEntry(trigger_tick_index=outcome.evaluated_tick_index or 0, proposal_run_id=plog.run_id,
        proposal_event_ids=[f"{e.event_type}@{e.at}" for e in plog.events])
    handle.correlation_log.append(corr); save_handle(handle)
    resp.proposal = plog.model_dump(mode="json"); resp.correlation = corr
return resp
```
`proposal-action` resolves `handle.current_proposal_run_id` (404 if none) and dispatches to `select_service(run_id, SelectServiceBody(selected_service_id=...))` or `apply_journey_action(run_id, JourneyAction(action_type=..., payload=...))`, returning the resulting `ProposalRunLog.model_dump()`; then refreshes correlation event ids + `save_handle`.

- [ ] **Step 1: Write failing integration test** — `test_merged_runs_router.py` using FastAPI `TestClient`: build a trigger draft via existing `POST /api/run-plans` (mirror an existing trigger router test's setup — copy the fixture that yields a fire-producing rest scenario), a minimal valid `world` (reuse a proposal test factory), then:
```python
def test_create_then_tick_until_rest_fire_creates_proposal(client, rest_plan_id, base_world_dict, pkg_ids):
    r = client.post("/api/merged-runs", json={"trigger_plan_id": rest_plan_id, "world": base_world_dict,
        "service_package_id": pkg_ids.service, "content_package_id": pkg_ids.content, "run_seed": "7"})
    assert r.status_code == 201
    mid = r.json()["merged_run_id"]
    proposal = None
    for _ in range(400):
        tr = client.post(f"/api/merged-runs/{mid}/tick"); assert tr.status_code == 200
        body = tr.json()
        if body["proposal"]:
            proposal = body["proposal"]; assert body["correlation"]["trigger_tick_index"] >= 0; break
        if body["trigger"].get("completed"): break
    assert proposal is not None
    assert proposal["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert proposal["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"
    assert len(proposal["evidence"]) >= 1               # a service evaluate() ran => eligibility+ranking happened
```
Add a `test_proposal_action_select_service` that, after a fire, posts `{"kind":"select_service","selected_service_id": <first ranked>}` and asserts the returned log has a `CONTENT_SELECTED` event or `content` evidence.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_merged_runs_router.py -q` → FAIL (router missing).
- [ ] **Step 3: Implement** `routers/merged_runs.py` + register in `main.py`. Add the `_serialize_trigger_tick(outcome)` helper (copy the field extraction from `routers/runs.py` tick endpoint).
- [ ] **Step 4: Run** the new tests → PASS. Then run the whole backend suite `.venv/bin/pytest -q` → all green (no existing test broken).
- [ ] **Step 5: Commit** `feat(merged): slice1 merged-runs router (create/tick/proposal-action)`.

**Acceptance:** a merged run ticks the trigger to a REST fire, auto-creates a `rest_recommended` proposal run with real eligibility+ranking evidence, persists correlation; select-service advances to content; existing suite untouched.

---

## Task 5: appMode `merged` + App wiring

**Files:**
- Modify: `app/frontend/src/state/appMode.tsx`, `app/frontend/src/App.tsx`
- Test: `app/frontend/tests/merged_appmode.test.tsx`

**Interfaces:** `AppMode = 'trigger' | 'proposal' | 'merged'`. `App.tsx` `AppBody` renders `<MergedCoordinatorProvider><MergedShell/></MergedCoordinatorProvider>` when `appMode==='merged'`; `AppModeToggle` gets a third button + `APP_MODE_LABELS.merged = { ja: '統合', en: 'Combined' }`.

- [ ] **Step 1: Write failing test** — render `<App/>`, click the "Combined"/統合 button, assert a `data-testid="merged-shell"` appears.
- [ ] **Step 2: Run** `cd app/frontend && npx vitest run merged_appmode` → FAIL.
- [ ] **Step 3: Implement** — widen union; convert `AppBody` ternary to `if/else if` chain adding the merged arm (wrap in the coordinator provider from Task 7 — for this task, temporarily render a stub `<div data-testid="merged-shell"/>`; real shell lands Task 6). Add toggle button + label.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 appMode + toggle`.

**Acceptance:** the third mode is selectable and renders its shell node; trigger/proposal modes unchanged.

---

## Task 6: `.merged-shell` layout + `MergedShell` scaffold + Modal primitive

**Files:**
- Modify: `app/frontend/src/styles/app.css` (add `.merged-shell { display:grid; grid-template-columns: 1fr 3fr 1fr; grid-template-rows:1fr; height:100%; width:100%; overflow:hidden }` reusing `.left-panel/.center-panel/.right-panel` grid-column rules — add merged-scoped copies if the existing ones are `.app-shell`-nested; and `.modal-backdrop`/`.modal-card`/`.modal-close` classes).
- Create: `app/frontend/src/components/merged/MergedShell.tsx`, `app/frontend/src/components/merged/Modal.tsx`
- Test: `app/frontend/tests/merged_modal.test.tsx`

**Interfaces:**
```tsx
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }): JSX.Element | null
// renders via createPortal to document.body; Escape + backdrop click call onClose; focus-trap the card; role="dialog" aria-modal
export default function MergedShell(): JSX.Element   // <div className="merged-shell" data-testid="merged-shell"> 3 panels </div>
```
`MergedShell` renders `<MergedSetupPanel/>` (left), `<MergedCenterPanel/>` (center), `<MergedLogPanel/>` (right) — stubs allowed until their tasks; each panel wrapped in the existing `.left-panel/.center-panel/.right-panel` divs.

- [ ] **Step 1: Write failing test** — `Modal` closed → renders nothing; open → shows title + children; Escape calls `onClose`; backdrop click calls `onClose`.
- [ ] **Step 2: Run** `npx vitest run merged_modal` → FAIL.
- [ ] **Step 3: Implement** `Modal.tsx` (portal, `useEffect` Escape listener, focus-trap first focusable), `MergedShell.tsx`, CSS.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 shell layout + Modal primitive`.

**Acceptance:** 20:60:20 grid renders; reusable Modal works (the net-new popup primitive design §7 called out).

---

## Task 7: Merged client + coordinator context (tick loop)

**Files:**
- Create: `app/frontend/src/api/mergedClient.ts`, `app/frontend/src/state/mergedCoordinator.tsx`
- Test: `app/frontend/tests/merged_coordinator.test.tsx`

**Interfaces:**
```ts
// mergedClient.ts — mirror client.ts apiFetch (bare /api/, throw on non-ok)
export async function createMergedRun(body: CreateMergedRunReq): Promise<{ merged_run_id: string; trigger_run_id: string }>
export async function tickMergedRun(mergedRunId: string): Promise<MergedTickResponse>
export async function mergedProposalAction(mergedRunId: string, body: MergedProposalActionReq): Promise<ProposalRunLog>

// mergedCoordinator.tsx
export type MergedCoordinatorState = {
  mergedRunId: string | null
  triggerTrace: TraceEntry[]          // accumulated from each tick's trigger payload
  latestTrigger: MergedTickResponse['trigger'] | null
  proposalLog: ProposalRunLog | null  // set when a fire creates/updates it
  correlation: CorrelationEntry[]
  paused: boolean; completed: boolean; running: boolean
  error: string | null
}
export function MergedCoordinatorProvider({ children }): JSX.Element
export function useMergedCoordinator(): {
  state: MergedCoordinatorState
  create(req: CreateMergedRunReq): Promise<void>
  play(): void          // starts an interval/async loop calling tickMergedRun until paused/completed
  pause(): void
  step(): Promise<void> // one tick
  selectService(serviceId: string): Promise<void>
}
```
The coordinator owns the tick loop (not runStore) so it can fold both trigger + proposal responses. Each `tickMergedRun` result: append `trigger` to `triggerTrace` (build a `TraceEntry` the same way `runStore.TICK_APPENDED` does), set `proposalLog`/`correlation` when present, set `paused`/`completed`.

- [ ] **Step 1: Write failing test** — mock `mergedClient` (vi.mock); `create()` then `step()` a couple times where the 2nd mock tick returns a `proposal`; assert `state.proposalLog` is set and `state.triggerTrace.length===2`.
- [ ] **Step 2: Run** `npx vitest run merged_coordinator` → FAIL.
- [ ] **Step 3: Implement** the client + a `useReducer`-based provider mirroring `runStore`'s pattern.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 merged client + coordinator tick loop`.

**Acceptance:** coordinator drives ticks and captures proposal on fire; isolated from runStore/proposalStore reducers.

---

## Task 8: Left setup panel (slice-1 minimal, popup-based)

**Files:**
- Create: `app/frontend/src/components/merged/MergedSetupPanel.tsx`
- Test: `app/frontend/tests/merged_setup.test.tsx`

**Interfaces:** consumes `useMergedCoordinator().create`. Slice-1 minimal: six collapsed summary buttons, but only **Route/Scenario/Packages** need to be functional; each opens a `Modal`. On "Start run" it (a) builds a trigger run-plan via existing `POST /api/run-plans` using selected preset route + scenario + trigger package + seed (reuse `client.ts` fns), then (b) calls `coordinator.create({ trigger_plan_id, world, service_package_id, content_package_id, run_seed })` with a default `world` fetched from a proposal preset/profile (reuse `proposalClient` `getPreset`/`getProfile`; use feature-018 `preset-journey-a-1` default). Driver-profile/situation popups may show read-only summaries in slice 1.

- [ ] **Step 1: Write failing test** — render inside providers with mocked clients; open the Route modal (assert preset options), pick preset+scenario+packages, click Start; assert `coordinator.create` called with the expected `trigger_plan_id` and package ids.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** using `Modal` + existing selectors (`PackageSelector`, `ScenarioSelector`, route-preset dropdown) where they drop in cleanly, else simple `<select>`s following the `select`-tag CSS convention.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 left setup (popup groups)`.

**Acceptance:** a run can be fully configured and started from the left panel via popups.

---

## Task 9: Center panel — animation + proposal overlay dock

**Files:**
- Create: `app/frontend/src/components/merged/MergedCenterPanel.tsx`
- Test: `app/frontend/tests/merged_center.test.tsx`

**Interfaces:** consumes `useMergedCoordinator()`. Renders: a Play/Pause bar (calls `play`/`pause`/`step`); a route/score timeline (reuse `ScoreTimeline` fed by a `TimelineData` built from `state.triggerTrace` — reuse `useLiveTimelineData`'s builder logic or feed a minimal `TimelineData`); and a `position:relative` dock that renders `<ServiceResultOverlay/>` when `state.proposalLog` has service evidence and no service chosen, else `<ContentResultOverlay/>` when a service is chosen (mirror the `CenterPlaybackPanel` dock at lines 87-114). Quickview strip in slice-1 = a trigger-only `InstantResult` preview (reuse existing `instantResultToTimeline`) or simply the live timeline before Play.

- [ ] **Step 1: Write failing test** — with a coordinator state containing a `proposalLog` (service evidence, no chosen service), assert `data-testid="service-result-overlay"` renders; after selecting a service (state has content evidence), assert `data-testid="content-result-overlay"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; Play button drives `coordinator.play()`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 center panel + overlay dock`.

**Acceptance:** Play advances the drive; on fire the service overlay auto-docks; choosing a service swaps to content.

---

## Task 10: Service + Content result overlays (extracted)

**Files:**
- Create: `app/frontend/src/components/merged/ServiceResultOverlay.tsx`, `ContentResultOverlay.tsx`
- Test: `app/frontend/tests/merged_overlays.test.tsx`

**Interfaces:** extract the RESULT regions of `ServiceProposalPanel` (lines 527-673) and `ContentProposalPanel` (384-461) into presentational components driven by props (no store coupling), per the extraction contract:
```tsx
export function ServiceResultOverlay(props: {
  output?: { decision_type: string; ranked_candidates: RankedCandidate[] }
  eligibleCandidates: { candidate_id: string }[]; excludedCandidates: ExcludedCandidate[]
  activeServiceId: string | null; choosingId: string | null
  onChoose: (candidateId: string) => void
  runId?: string; explanationProvider: ExplanationProvider; lang: 'ja' | 'en'
}): JSX.Element
export function ContentResultOverlay(props: {
  plan?: CompletePlan; error?: EvidenceError; songNames: Record<string, string>
  runId?: string; explanationProvider: ExplanationProvider; lang: 'ja' | 'en'
}): JSX.Element
```
Reuse `ReasonBreakdown`, `ServiceExplainability`/`ContentExplainability`, `useExplanation`, and the `ServiceReason`/`ContentReason` sub-components (move verbatim). The merged center panel derives these props from `coordinator.state.proposalLog.evidence` (filter `step==='service'|'content'`, `.slice(-1)[0]`) exactly as the panels do off the store. `onChoose` calls `coordinator.selectService`.

- [ ] **Step 1: Write failing test** — feed a fake `output` with 2 ranked candidates; assert both render with score + a "Choose" button; click → `onChoose` called with candidate_id. Feed a fake `plan` with 3 ordered items; assert 3 rows with song names.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** by extracting/adapting the existing JSX into prop-driven components (do NOT modify the original panels — copy the render logic; the panels keep working for the proposal screen).
- [ ] **Step 4: Run** → PASS; also run the existing proposal-panel tests to confirm they're untouched.
- [ ] **Step 5: Commit** `feat(merged): slice1 extracted service/content result overlays`.

**Acceptance:** overlays render ranked services + ordered content plan with explainability, prop-driven, reused in the center dock.

---

## Task 11: Right merged log panel

**Files:**
- Create: `app/frontend/src/components/merged/MergedLogPanel.tsx`
- Test: `app/frontend/tests/merged_log.test.tsx`

**Interfaces:** consumes `useMergedCoordinator()`. Builds a `MergedEntry`-style union across (a) `state.triggerTrace` (kind `trace`, tickIndex = `tick_index`) and (b) `state.proposalLog.events` (kind `proposal`, tickIndex = the correlation entry's `trigger_tick_index` for that run; ties broken by event order), sorted by tickIndex. Trigger rows reuse the visual style of `TraceEntryRow` (import/[re]use or a slim inline row); proposal rows are a new `ProposalEventRow` using the proposal accent color `#7c3aed` showing `event_type` + a one-line payload summary (`SERVICE_SELECTED`→service id, `CONTENT_SELECTED`→N items, etc.).

- [ ] **Step 1: Write failing test** — coordinator state with 2 trigger trace entries (tick 0,1) and a proposalLog whose events include `OPPORTUNITY_OPENED`+`SERVICE_SELECTED`, correlation tick_index=1; assert the log renders trigger rows and purple proposal rows, and that a `SERVICE_SELECTED` row appears after the tick-1 trigger row.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the union + `ProposalEventRow`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(merged): slice1 merged log panel`.

**Acceptance:** one chronological log interleaves trigger ticks and proposal events by correlation tick index, color-coded by subsystem.

---

## Task 12: End-to-end verification + docs

**Files:** Modify: `docs/superpowers/plans/2026-07-18-merged-simulator-slice1.md` (check boxes); optional `app/frontend/tests/merged_e2e.test.tsx`.

- [ ] **Step 1:** Run full backend suite `cd app/api && .venv/bin/pytest -q` → all green.
- [ ] **Step 2:** Run full frontend suite `cd app/frontend && npx vitest run` → all green; `npx tsc --noEmit` clean; `npx vite build` clean.
- [ ] **Step 3:** Drive the real app (per the `verify`/`run` skill): `docker compose up` (or dev servers), open Combined mode, configure a rest scenario, Play → confirm a rest service→content proposal appears and the merged log shows both streams. Capture a screenshot.
- [ ] **Step 4:** Update the design doc §12 marking Slice 1 done; note any deviations.
- [ ] **Step 5: Commit** `chore(merged): slice1 e2e verification`.

**Acceptance:** the happy-path drive works end-to-end in the real app; both test suites + typecheck + build are green.

---

## Self-Review

**Spec coverage (design §):** §2 architecture → T1,T3,T4; §4 adapter seam → T2; §3 inline/gen (rest subset) → T2,T4; §7 center + overlay → T9,T10; §9 left popups (minimal) → T6,T8; §10 merged log → T11; §11 API (new endpoints) → T4. Deferred to Slices 2–3 by design: §5 route painter, §6 monotony proxy, §7.1 quickview projection, §8 enriched recovery, full rest journey, recompute — explicitly out of Slice-1 scope (Global Constraints).

**Placeholder scan:** none — every task has concrete files, real signatures (from signature extraction), and test assertions.

**Type consistency:** `MergedRunHandle`/`CorrelationEntry`/`MergedTickResponse` defined in T1 and reused verbatim in T3,T4,T7,T11; `build_world_from_tick`/`map_*` defined T2 used T4; `useMergedCoordinator` shape defined T7 consumed T8,T9,T10,T11; overlay prop types defined T10 consumed T9. `create_proposal_run`/`CreateProposalRunBody`/`select_service`/`apply_journey_action` names match the extracted router signatures.
