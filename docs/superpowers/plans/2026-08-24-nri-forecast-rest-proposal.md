# NRI Forecast-Based Early Rest Proposal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a committed-state continuation forecast to the rest-proposal path so AICA can propose an *early* rest (while `80 < S_total < 100`) when the forecast shows no rest facility will be actionable at the moment fatigue actually crosses the fire threshold — and, at the same time, fix the shared rest-actionability rule so the `9999.0` "no rest spot ahead" sentinel can never fire a rest, and unify the 30-minute spot-actionability gate across the algorithm, the rest picker, and the forecast.

**Architecture:** A new pure `services/nri_forecast.py` runs a *non-persisting* projection: it deep-copies the post-current-tick state, continues already-accepted interventions (recovery, content relief), accepts **no** projected-future proposal, and steps the deterministic tick/adapter loop to the destination — reporting the first future fire point and whether a rest spot is actionable *there*. The orchestration layer (`run_manager.tick` and `preview.iter_preview_ticks`) evaluates NRI twice: once normally to get `S_now`, then — only when the cheap eligibility gates pass — it computes the forecast, attaches an `nri_forecast` block to the adapter context, and re-evaluates. The NRI algorithm reads that block to decide the early-rest fire; a single shared spot-actionability helper in `tick_engine.py` (built on the existing `_eta_min_to_km` ETA engine) feeds the picker, the forecast, and the ordinary rest path so there is exactly one 30-minute rule.

**Tech Stack:** Python 3.12 / FastAPI backend (`app/api/`), pytest. Frontend React/TS only touched where display copy/labels surface the new state (later phase). The offline `htmlapp/` TS mirror is **explicitly out of scope for this plan** — it is a separate follow-up after the user reviews the `app/` implementation.

**Spec:** `docs/superpowers/specs/2026-08-22-nri-forecast-rest-proposal-design.md` (authoritative; the plan argues from it — executors read both).

## Global Constraints

- **Backend is the source of truth.** The frontend never computes decisions/evidence; the forecast lives entirely in the backend. (CLAUDE.md invariant.)
- **Append-only evidence / deterministic tick engine.** The forecast MUST NOT mutate the live run: it operates on deep copies of `package_runtime_state`, `recovery`, and `content_relief`, and iterates its own local `TickState` chain. It never touches `_registry[run_id]`, never appends events, never advances `current_tick`. (CLAUDE.md invariant.)
- **Qualitative / boundary-binned trigger discipline.** No concrete numeric drives a trigger; the forecast decision is expressed through the existing banded thresholds (`threshold_monotony=60`, `threshold_forecast_rest=80`, `threshold_fire=100`) and the boolean actionability gate. (CLAUDE.md invariant.)
- **One shared actionability rule.** A rest spot is *actionable* iff: a spot exists ahead AND its ETA-from-now is finite AND ETA-from-now ≤ `rest_spot_eta_filter_min` (default now **30.0**, was 60.0) AND the spot's ETA-to-destination ≥ **10.0** min AND the spot is not the `9999.0` `_NO_REST_SENTINEL`. This single rule is used by the rest picker, the forecast service, and the NRI ordinary + early rest paths. No second ETA formula may be introduced — reuse `tick_engine._eta_min_to_km`.
- **Threshold ordering guard.** The forecast/early-rest path is enabled ONLY when `threshold_monotony < threshold_forecast_rest < threshold_fire` (i.e. `60 < 80 < 100` by default). If a user sets values that violate this ordering, the early path is silently disabled and NRI behaves exactly as today (fail-open to ordinary behavior). Copy this ordering check verbatim into the algorithm.
- **Trip-edge guard is reused as-is, never weakened.** The first-20-min / last-10-min-to-destination hard no-trigger zone (`_TRIP_START_EDGE_SEC = 20*60`, `_TRIP_END_EDGE_MIN = 10.0`, commit f9a9aaf) still neutralizes *every* routine rest/monotony fire — including forecast fires — at the orchestration layer, after the algorithm returns. Do not duplicate or bypass it.
- **NRI-only score; shared trigger/action/condition.** The score math and the `threshold_forecast_rest` band belong to NRI. The trigger *action* (REST_PROPOSAL), the *conditions* (trip-edge guard, duplicate-proposal de-dup, current-spot actionability, ETA≤30 gate, picker), and the forecast *mechanism* are shared across rest packages. Hybrid is a **later, separate phase** (same logic, different threshold + if/else when hybrid is active) — NOT in this plan.
- **De-dup constants unchanged.** Leave the proposal de-dup window at its HEAD value; the fixbug-0806 30→20 min shrink was reverted (it broke NRI monotony→rest escalation). Do not touch it.
- **BYO Google Maps key** is never shipped, persisted, logged, or exported. The forecast uses only already-loaded route facts; it makes no Maps calls. (CLAUDE.md invariant.)
- **No commits until explicitly commanded by the user.** The per-task "Commit" steps below define the commit *boundaries and messages* for when the go-ahead is given; do not run `git commit` before the user says so. Bundle all `app/` backend+frontend changes as the single htmlapp-mirror reference commit set. (Memory: fixbug-0806 commit discipline.)

### Test command

Primary (Docker up, per this session): `docker compose exec api uv run pytest <path>`
Fallback (Docker absent / uv proxy-blocked, per memory): run pytest with Anaconda Python 3.12.7 and `PYTHONPATH=app/api` from repo root. Executors use whichever is live; the plan's `Run:` lines show the pytest node id — prefix it with the working runner.

---

## File Structure

**Backend — created**
- `app/api/aica_api/services/nri_forecast.py` — the committed-state continuation forecast service. One public entry `run_forecast(...)` returning a `NriForecast` result (or `None` when unavailable). Pure: takes copies/immutables, returns data, mutates nothing shared. Owns the projection loop only; delegates spot actionability to `tick_engine`.

**Backend — modified**
- `packages/nri_fatigue_score_v1/package.json` — add `threshold_forecast_rest` hyperparameter (default 80.0); change `rest_spot_eta_filter_min` default 60.0→30.0 and raise its `max`; add `forecast_rest_required_proposal`.
- `packages/nri_fatigue_score_v1/algorithm.py` — remove the two `>= 9999.0`-means-fire exceptions; apply the shared current-spot actionability gate to the ordinary rest path; add the forecast early-rest decision path that reads the `nri_forecast` block; emit the new proposal/state/criteria/explanation.
- `app/api/aica_api/services/tick_engine.py` — add the single shared `rest_spot_actionability(...)` helper (built on `_eta_min_to_km`); it returns the current spot's ETA-from-now, ETA-to-destination, an `actionable` bool, and an `unactionable_reason`.
- `app/api/aica_api/services/run_manager.py` — two-pass evaluate in `tick()`: after the first NRI evaluate, when cheap gates pass, build the forecast + `nri_forecast` block and re-evaluate; persist only the second result's `next_package_runtime_state`. Trip-edge guard stays after. Remove `rest_drowsiness_ceiling` references.
- `app/api/aica_api/services/preview.py` — same two-pass forecast invocation inside `iter_preview_ticks`, WITHOUT reusing the auto-accept/auto-acknowledge loop for the projection.
- `app/api/aica_api/routers/runs.py` — rest picker: remove `drowsiness_ceiling` query param + projected-drowsiness filter + `reachable_fallback`; select/disable spots by the shared ETA≤30 actionability rule.
- `app/api/aica_api/models/scenario.py` — remove `rest_drowsiness_ceiling` field.

**Backend — tests (created/modified)**
- `app/api/tests/test_nri_fatigue_score.py` — extend: sentinel-fails-fire, score-100-no-spot suppressed, forecast early-fire gates, monotony superseded, explanation honesty. (§20.1)
- `app/api/tests/test_nri_forecast.py` — **new**: forecast-service unit tests (no mutation, one step/tick, stops at first crossing / at destination, future-spot boundaries, committed content continued, offered-but-unaccepted excluded). (§20.2)
- `app/api/tests/test_tick_engine.py` — extend: `rest_spot_actionability` boundary tests. (§20.3)
- `app/api/tests/test_rest_spots_endpoint.py` (or the existing picker test module) — ETA≤30 select/disable, no-force-enable, no-tick disabled, ceiling-input-ignored. (§20.4)
- `app/api/tests/test_t012_rest_handling.py` — **replace** `TestEndToEndEmptyRestRun::test_empty_rest_run_still_fires_rest_proposal` with an NRI-pointed inverse assertion (empty route completes with NO routine rest fire, no algorithm_error). (§20.7)
- `app/api/tests/test_rest_spot_fallback.py`, `app/api/tests/test_routes_recovery.py` — update for `rest_drowsiness_ceiling` removal. (§20.7)
- Live↔preview parity test for the forecast fire. (§20.6)

---

## Shared contract reference (used by many tasks)

The **`nri_forecast` context block** the orchestration attaches for the second NRI pass (spec §13). Field names are exact; copy verbatim.

```python
# What run_manager / preview build and put on context["nri_forecast"]:
{
  "evaluated": True,                       # False when a cheap gate failed / forecast skipped
  "error": None,                           # str when forecast service raised (fail-open)
  "threshold_order_valid": True,           # T_mono < T_forecast < T_fire
  "forecast_mode": "committed_state_continuation",
  "forecast_start": {
    "content_active": True,
    "service_id": "humming_karaoke",       # None when no committed content
    "content_remaining_min": 11.0,         # 0.0 when none
  },
  "future_fire": {
    "found": True,
    "tick_index": 42,
    "elapsed_min": 126.0,
    "distance_km": 101.5,
    "route_fraction": 0.84,
    "s_total": 100.8,
  },
  "forecast_rest_spot": {                  # first sorted spot strictly > future_fire.distance_km
    "exists": True,
    "position_km": 116.0,
    "eta_from_fire_min": 34.0,             # planned-profile ETA from the fire point
    "eta_to_destination_min": 22.0,        # planned-profile ETA spot→destination
    "actionable": False,
  },
  "forecast_future_rest_unactionable": True,
  "forecast_rest_unactionable_reason": "eta_over_30_min",   # no_spot_ahead | eta_over_30_min | inside_destination_edge | None
  "current_rest_spot": {                   # first sorted spot strictly > current distance
    "exists": True,
    "position_km": 83.0,
    "eta_from_current_min": 18.0,
    "eta_to_destination_min": 31.0,
    "actionable": True,
    "unactionable_reason": None,           # no_spot_ahead | rest_spot_eta_over_limit | inside_destination_edge | None
  },
}
```

**Two distinct reason enums (do not conflate):**
- `current_rest_spot.unactionable_reason` ∈ {`no_spot_ahead`, `rest_spot_eta_over_limit`, `inside_destination_edge`, `None`}
- `forecast_rest_unactionable_reason` ∈ {`no_spot_ahead`, `eta_over_30_min`, `inside_destination_edge`, `None`}

**Early-fire decision (spec §11) — all must hold:** `package_id == "nri_fatigue_score_v1"` AND `T_mono < T_forecast < T_fire` AND `T_forecast < S_now < T_fire` AND recovery inactive AND `future_fire.found` AND `forecast_future_rest_unactionable == True` AND `current_rest_spot.actionable == True`.

**Cheap eligibility gates before running the expensive projection (spec §19):** package is NRI AND threshold order valid AND `T_forecast < S_now < T_fire` AND recovery inactive AND destination distance available AND current tick outside trip-edge zones.

**Nullability rule (spec §13):** never substitute `0` for an unknown ETA and never substitute `9999.0` for a missing destination ETA. `9999.0` keeps its single meaning: no rest spot remains ahead (`nextRestSpotMin` sentinel).

---

## Task 1: NRI package manifest — new threshold, shared ETA default, forecast proposal

**Files:**
- Modify: `packages/nri_fatigue_score_v1/package.json`
- Test: `app/api/tests/test_nri_fatigue_score.py` (extend)

**Interfaces:**
- Consumes: nothing (config-only).
- Produces: resolved hyperparameters `threshold_forecast_rest` (default `80.0`) and `rest_spot_eta_filter_min` (default `30.0`); a `forecast_rest_required_proposal` proposal definition. The `_default_hp()` helper in the test module reads these from the manifest, so downstream tasks can assert defaults through it.

- [ ] **Step 1: Write the failing tests** (spec §20.1 items 1–2)

Add to `app/api/tests/test_nri_fatigue_score.py`:

```python
def test_threshold_forecast_rest_default_is_80():
    assert HP["threshold_forecast_rest"] == 80.0


def test_rest_spot_eta_filter_default_is_30():
    assert HP["rest_spot_eta_filter_min"] == 30.0


def test_forecast_rest_proposal_declared_with_expected_options():
    data = json.loads(_PKG_JSON.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["proposals"]}
    assert "forecast_rest_required_proposal" in by_id
    assert by_id["forecast_rest_required_proposal"]["options"] == [
        "accept_rest", "postpone", "decline",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "forecast_rest or eta_filter_default" -v`
Expected: FAIL — `threshold_forecast_rest` missing (KeyError); `rest_spot_eta_filter_min` is 60.0; proposal id absent.

- [ ] **Step 3: Edit the manifest**

In `packages/nri_fatigue_score_v1/package.json`:

1. Add to `hyperparameters` (after `rest_spot_eta_filter_min`):

```json
{
  "key": "threshold_forecast_rest",
  "label": { "ja": "予測休憩提案閾値 (点)", "en": "Forecast Rest Suggest Threshold (pts)" },
  "kind": "numeric", "default": 80.0, "min": 20.0, "max": 200.0, "step": 5.0
}
```

2. Change `rest_spot_eta_filter_min`: `"default": 60.0` → `"default": 30.0`, and raise its ceiling `"max": 60.0` → `"max": 120.0` (30 must sit comfortably inside the range; the old max equalled the old default). Leave `min` and `step` as-is.

3. Add to `proposals`:

```json
{
  "id": "forecast_rest_required_proposal",
  "message": {
    "ja": "このまま走ると、休憩が必要になる時に近くの休憩場所を使えない見込みです。前方の休憩場所で早めに休むことをおすすめします。",
    "en": "At the current trend, no nearby rest facility is expected to be actionable when a rest becomes necessary. We suggest resting at the available facility ahead before continuing."
  },
  "options": ["accept_rest", "postpone", "decline"]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "forecast_rest or eta_filter_default" -v`
Expected: PASS. Also run the whole NRI file to confirm no `_default_hp()`-driven test regressed on the new key: `pytest app/api/tests/test_nri_fatigue_score.py -v`.

- [ ] **Step 5: Commit** (only once the user authorizes committing)

```bash
git add packages/nri_fatigue_score_v1/package.json app/api/tests/test_nri_fatigue_score.py
git commit -m "feat(nri): declare threshold_forecast_rest + forecast proposal; shared 30-min ETA default"
```

---

## Task 2: Shared rest-spot actionability helper in the tick engine

**Files:**
- Modify: `app/api/aica_api/services/tick_engine.py` (add helper + `SpotActionability` near `_eta_min_to_km`, ~line 762)
- Test: `app/api/tests/test_tick_engine.py` (extend)

**Interfaces:**
- Consumes: existing `_eta_min_to_km(target_km, from_km, from_elapsed_min, route_facts, event_plan, sp)`, `_NO_REST_SENTINEL = 9999.0`, `_ETA_CAP_MIN = 600.0`, `RouteFacts.rest_spot_positions`, `RouteFacts.total_route_distance_km`, and the resolved speed profile object `sp` that `advance_tick` already builds.
- Produces — the ONE shared actionability rule reused by the forecast service (Task 4), the picker (Task 8), and (via the forecast block) the NRI algorithm:

```python
from dataclasses import dataclass

_END_EDGE_MIN = 10.0  # last-10-minutes destination no-trigger edge (matches trip-edge guard)

@dataclass(frozen=True)
class SpotActionability:
    exists: bool
    position_km: float | None
    eta_from_position_min: float          # _NO_REST_SENTINEL when no spot ahead
    eta_to_destination_min: float | None  # None when no spot ahead
    actionable: bool
    unactionable_reason: str | None       # no_spot_ahead | rest_spot_eta_over_limit | inside_destination_edge | None

def rest_spot_actionability(
    *,
    from_km: float,
    from_elapsed_min: float,
    route_facts: RouteFacts,
    event_plan: EventPlan,
    sp,
    eta_filter_min: float,
    end_edge_min: float = _END_EDGE_MIN,
) -> SpotActionability: ...
```

- [ ] **Step 1: Write the failing tests** (spec §20.3 items 1,2,4,5; §10; §9 boundary)

Add to `app/api/tests/test_tick_engine.py` (reuse that module's existing route-facts/event-plan/`sp` builders; the sketch below names them `_make_route_facts`, `_make_event_plan`, `_make_sp` — match whatever the file already provides):

```python
from aica_api.services.tick_engine import rest_spot_actionability, _NO_REST_SENTINEL

def _rf_with_spots(spots, total_km):
    rf = _make_route_facts(total_route_distance_km=total_km)   # existing helper
    rf.rest_spot_positions = list(spots)
    return rf

def test_actionability_spot_within_30_and_outside_end_edge_is_actionable():
    rf = _rf_with_spots([40.0], total_km=200.0)   # spot far from destination
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=_make_event_plan(rf), sp=_make_sp(), eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.eta_from_position_min <= 30.0
    assert r.eta_to_destination_min >= 10.0
    assert r.actionable is True
    assert r.unactionable_reason is None

def test_actionability_spot_over_30_min_is_not_actionable():
    rf = _rf_with_spots([180.0], total_km=400.0)  # far ahead → ETA > 30
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=_make_event_plan(rf), sp=_make_sp(), eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.actionable is False
    assert r.unactionable_reason == "rest_spot_eta_over_limit"

def test_actionability_no_spot_ahead_uses_sentinel_and_no_spot_reason():
    rf = _rf_with_spots([10.0], total_km=200.0)   # only spot is behind us
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=_make_event_plan(rf), sp=_make_sp(), eta_filter_min=30.0,
    )
    assert r.exists is False
    assert r.eta_from_position_min == _NO_REST_SENTINEL
    assert r.eta_to_destination_min is None
    assert r.actionable is False
    assert r.unactionable_reason == "no_spot_ahead"

def test_actionability_spot_inside_destination_edge_is_not_actionable():
    # spot ~2 km before the destination → spot→dest ETA < 10 min
    rf = _rf_with_spots([198.0], total_km=200.0)
    r = rest_spot_actionability(
        from_km=190.0, from_elapsed_min=200.0, route_facts=rf,
        event_plan=_make_event_plan(rf), sp=_make_sp(), eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.eta_to_destination_min < 10.0
    assert r.actionable is False
    assert r.unactionable_reason == "inside_destination_edge"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest app/api/tests/test_tick_engine.py -k actionability -v`
Expected: FAIL with ImportError (`rest_spot_actionability` not defined).

- [ ] **Step 3: Implement the helper** (right after `_eta_min_to_km`)

```python
def rest_spot_actionability(
    *,
    from_km: float,
    from_elapsed_min: float,
    route_facts: RouteFacts,
    event_plan: EventPlan,
    sp,
    eta_filter_min: float,
    end_edge_min: float = _END_EDGE_MIN,
) -> SpotActionability:
    """The ONE shared rest-spot actionability rule (design §7, §9, §10).

    Selects the first sorted rest-spot position strictly > `from_km`, computes
    its planned-profile ETA from here and from there to the destination via
    `_eta_min_to_km` (never `remaining_km / speed`), and applies the shared
    gates. Reason precedence matches spec §10 / §18:
    no_spot_ahead -> rest_spot_eta_over_limit -> inside_destination_edge.
    """
    total_km = float(route_facts.total_route_distance_km)
    next_pos: float | None = None
    for pos_km in sorted(route_facts.rest_spot_positions):
        if pos_km > from_km:
            next_pos = float(pos_km)
            break

    if next_pos is None:
        return SpotActionability(
            exists=False, position_km=None,
            eta_from_position_min=_NO_REST_SENTINEL, eta_to_destination_min=None,
            actionable=False, unactionable_reason="no_spot_ahead",
        )

    eta_from = _eta_min_to_km(
        target_km=next_pos, from_km=from_km, from_elapsed_min=from_elapsed_min,
        route_facts=route_facts, event_plan=event_plan, sp=sp,
    )
    eta_to_dest = _eta_min_to_km(
        target_km=total_km, from_km=next_pos,
        from_elapsed_min=from_elapsed_min + eta_from,
        route_facts=route_facts, event_plan=event_plan, sp=sp,
    )

    finite_and_near = eta_from <= eta_filter_min  # _eta_min_to_km never returns the sentinel
    if not finite_and_near:
        reason = "rest_spot_eta_over_limit"
    elif eta_to_dest < end_edge_min:
        reason = "inside_destination_edge"
    else:
        reason = None

    return SpotActionability(
        exists=True, position_km=next_pos,
        eta_from_position_min=eta_from, eta_to_destination_min=eta_to_dest,
        actionable=(reason is None), unactionable_reason=reason,
    )
```

Add `_END_EDGE_MIN = 10.0` and the `SpotActionability` dataclass above the function; ensure `from dataclasses import dataclass` is imported at the top of the module.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest app/api/tests/test_tick_engine.py -k actionability -v`
Expected: PASS (all four). Then `pytest app/api/tests/test_tick_engine.py -v` to confirm no regression.

- [ ] **Step 5: Commit** (only once the user authorizes committing)

```bash
git add app/api/aica_api/services/tick_engine.py app/api/tests/test_tick_engine.py
git commit -m "feat(tick-engine): shared rest_spot_actionability helper on planned-profile ETA"
```

---

## Task 3: NRI algorithm — kill the 9999.0-fires exception; ordinary rest uses shared actionability

**Files:**
- Modify: `packages/nri_fatigue_score_v1/algorithm.py` (the two sentinel sites: `_build_feature_contributions` gate ~line 284; the fire branch ~line 616; plus a new sentinel constant and the actionability read in `evaluate`)
- Test: `app/api/tests/test_nri_fatigue_score.py` (extend)

**Interfaces:**
- Consumes: `context["nri_forecast"]` when the orchestration provides it (see Shared contract reference); otherwise falls back to native `dynamic.nextRestSpotMin`. Reads existing `hp["rest_spot_eta_filter_min"]`, `hp["threshold_fire"]`.
- Produces: for the ordinary rest path, `spot_actionable: bool` and `spot_reason: str | None`. When the score `>= threshold_fire` and the current spot is not actionable, the existing suppressed→`SUPPRESSED` mapping already yields `result_type="SUPPRESSED"`, `trigger_candidate=False`, `selected_category=None`, `proposal=None` (spec §11.2). No new output keys in this task; Task 5 adds the forecast evidence.

**Note for the implementer:** this task deliberately makes the algorithm depend on the `nri_forecast.current_rest_spot` block *when present*, but must keep working (fail-open, minus the sentinel bug) when it is absent — that absence is the state at every tick until Tasks 6/7 wire the orchestration. Both branches are exercised by the tests below (one passes a block, one does not).

- [ ] **Step 1: Write the failing tests** (spec §20.1 items 6–7; §20.3 items 4, 8)

Add to `app/api/tests/test_nri_fatigue_score.py`. These drive `mod.evaluate(...)` through the existing `_ctx(...)`/`_signals(...)` builders; extend `_ctx` (or pass through `**extra`) so a test can attach an `nri_forecast` block to the context — match the module's actual `_ctx` signature.

```python
def test_sentinel_next_rest_fails_eta_contribution_gate():
    """9999.0 (no spot ahead) must FAIL, not pass, the rest ETA gate."""
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=9999.0))
    result = mod.evaluate(ctx)
    fc = result["feature_contributions"]["rest_required"]
    eta_gate = next(g for g in fc["gates"] if g["gate_id"] in
                    ("rest_spot_eta_filter_min", "forecast_current_rest_spot_eta"))
    assert eta_gate["passed"] is False


def test_score_at_or_above_100_with_no_spot_is_suppressed_not_fired():
    """Score >= threshold_fire but nextRestSpotMin==9999 → SUPPRESSED, no proposal."""
    # Drive the raw score >= 100 with no reachable spot.
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=9999.0),
               sim_time=6000.0)
    result = mod.evaluate(ctx)
    assert result["scores"]["s_total"] >= 100.0
    assert result["result_type"] == "SUPPRESSED"
    assert result["trigger_candidate"] is False
    assert result["selected_category"] is None
    assert result["fire_control"]["fired"] is False
    assert result["proposal"] is None
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["fired"] is False
    assert rest["fire_control"]["reason"] == "no_spot_ahead"


def test_score_100_with_actionable_current_spot_still_fires_ordinary_rest():
    """Regression guard: a real, near spot still fires the ordinary rest path."""
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=12.0),
               sim_time=6000.0)
    result = mod.evaluate(ctx)
    assert result["result_type"] == "REST_PROPOSAL"
    assert result["selected_category"] == "rest_required"


def test_ordinary_path_honors_forecast_current_spot_block_when_present():
    """When orchestration supplies nri_forecast.current_rest_spot, the ordinary
    path uses ITS actionability (incl. destination-edge), not the raw ETA gate."""
    fc_block = {
        "evaluated": True, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "future_fire": {"found": False},
        "current_rest_spot": {
            "exists": True, "position_km": 198.0,
            "eta_from_current_min": 8.0, "eta_to_destination_min": 4.0,
            "actionable": False, "unactionable_reason": "inside_destination_edge",
        },
    }
    # near spot (raw ETA passes) but inside the destination edge → must suppress
    ctx = _ctx(_signals(fatigue=100.0, drowsiness=100.0, next_rest_spot_min=8.0),
               sim_time=6000.0, nri_forecast=fc_block)
    result = mod.evaluate(ctx)
    assert result["result_type"] == "SUPPRESSED"
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["reason"] == "inside_destination_edge"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "sentinel or suppressed or actionable_current_spot or 100_with_actionable" -v`
Expected: FAIL — today `next_rest_min >= 9999.0` *passes* the gate and *fires*, so the SUPPRESSED assertions fail and the forecast-block test errors (`_ctx` has no `nri_forecast` kwarg yet).

- [ ] **Step 3: Implement**

In `packages/nri_fatigue_score_v1/algorithm.py`:

1. Add near the top (module scope): `_NO_REST_SENTINEL = 9999.0`.

2. In `evaluate(...)`, right after `rest_eta_filter = float(hp["rest_spot_eta_filter_min"])` (~line 432), compute the shared ordinary actionability:

```python
    # ── Current rest-spot actionability (shared rule; design §10, §11.2, §18) ──
    # Prefer the orchestration-computed forecast block (it knows the spot's
    # ETA-to-destination); fall back to the native nextRestSpotMin gate when no
    # block is present. The old ">= 9999 means fire" exception is GONE in both.
    _forecast = context.get("nri_forecast") or {}
    _crs = _forecast.get("current_rest_spot") if _forecast.get("evaluated") else None
    if _crs is not None:
        spot_actionable = bool(_crs.get("actionable"))
        spot_reason = _crs.get("unactionable_reason")
    else:
        spot_actionable = (
            next_rest_min != _NO_REST_SENTINEL and next_rest_min <= rest_eta_filter
        )
        spot_reason = None if spot_actionable else (
            "no_spot_ahead" if next_rest_min >= _NO_REST_SENTINEL
            else "rest_spot_eta_over_limit"
        )
```

3. Pass the result into `_build_feature_contributions` (add two params `spot_actionable`, `spot_reason`) and replace the gate at ~line 284:

```python
# BEFORE
    eta_passed = next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0
    gate_eta = {
        "gate_id": "rest_spot_eta_filter_min",
        "evaluated_inputs": {"nextRestSpotMin": next_rest_min},
        "threshold": rest_eta_filter,
        "passed": eta_passed,
        "effect": "allow" if eta_passed else "suppress",
    }
# AFTER
    gate_eta = {
        "gate_id": "rest_spot_eta_filter_min",
        "evaluated_inputs": {"nextRestSpotMin": next_rest_min, "reason": spot_reason},
        "threshold": rest_eta_filter,
        "passed": spot_actionable,
        "effect": "allow" if spot_actionable else "suppress",
    }
```

Update the call site (~line 562) to pass `spot_actionable=spot_actionable, spot_reason=spot_reason` and the `def _build_feature_contributions(...)` signature accordingly. (Leave `next_rest_min`/`rest_eta_filter` params intact — they still populate `evaluated_inputs`.)

4. Replace the fire branch (~line 616):

```python
# BEFORE
    elif next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0:
        fired = True
        reason = "fire_threshold_passed"
    else:
        suppressed = True
        reason = "rest_spot_too_far"
# AFTER
    elif spot_actionable:
        fired = True
        reason = "fire_threshold_passed"
    else:
        suppressed = True
        reason = spot_reason  # no_spot_ahead | rest_spot_eta_over_limit | inside_destination_edge
```

The existing result-type mapping (`suppressed → SUPPRESSED`, `trigger_candidate = fired or mono_fired`, `proposal = None` unless fired) already produces the §11.2 output; do not change it in this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "sentinel or suppressed or actionable_current_spot or 100_with_actionable" -v`
Expected: PASS. Then run the whole file: `pytest app/api/tests/test_nri_fatigue_score.py -v`. Some pre-existing tests that assumed the sentinel *fires* may now need their fixtures updated to supply a reachable spot — update those in-file to reflect the corrected rule (the sentinel firing was the bug). Do NOT weaken the new assertions to accommodate them.

- [ ] **Step 5: Commit** (only once the user authorizes committing)

```bash
git add packages/nri_fatigue_score_v1/algorithm.py app/api/tests/test_nri_fatigue_score.py
git commit -m "fix(nri): 9999.0 no-spot sentinel no longer fires rest; ordinary path uses shared actionability"
```

---

## Task 4: Committed-state continuation forecast service (`nri_forecast.py`)

**Files:**
- Create: `app/api/aica_api/services/nri_forecast.py`
- Test: `app/api/tests/test_nri_forecast.py` (new)

**Interfaces:**
- Consumes: `tick_engine.advance_tick(prior_state, tick_index, event_plan, route_facts, scenario, *, recovery, run_seed, content, content_relief) -> TickState`; `tick_engine.rest_spot_actionability(...)` (Task 2); `tick_engine._eta_min_to_km`, `_NO_REST_SENTINEL`; `RouteFacts`, `EventPlan`, `ScenarioDef`, `TickState`, `ContentContext`, `ContentReliefState`.
- Produces — one public function returning the `nri_forecast` block dict (Shared contract reference):

```python
from typing import Callable
from aica_api.services.tick_engine import TickState

# Injected by orchestration: evaluate NRI for a projected tick given the prior
# package runtime state; returns the full NRI decision dict (must contain
# ["scores"]["s_total"], ["next_package_runtime_state"], and ["result_type"]).
EvaluateFn = Callable[[TickState, dict], dict]

def run_forecast(
    *,
    start_tick_state: TickState,          # CURRENT post-tick state (the projection's tick 0 prior)
    start_tick_index: int,                # current tick index
    current_elapsed_min: float,           # current post-tick elapsed minutes
    current_distance_km: float,           # current post-tick distance
    event_plan,
    route_facts,
    scenario,
    run_seed,
    package_runtime_state: dict,          # NRI state AFTER the current tick (copied)
    committed_content: "ContentContext | None",
    committed_content_remaining_min: float,
    committed_content_relief: "ContentReliefState | None",
    evaluate: EvaluateFn,
    threshold_fire: float,
    threshold_forecast_rest: float,
    threshold_monotony: float,
    eta_filter_min: float,
) -> dict: ...

_MAX_FORECAST_TICKS = 2000   # matches preview's safety ceiling
```

- [ ] **Step 1: Write the failing tests** (spec §20.2 items 1,2,6,10,11,12,13,15,16,17,18,19,20)

Create `app/api/tests/test_nri_forecast.py`. Isolate the projection loop with a **scripted `evaluate`** so scoring is deterministic and independent of NRI math. Reuse the tick-engine test's setup to obtain a real `(scenario, event_plan, route_facts)` and a post-tick `start_tick_state` — factor those builders into an importable helper if they are currently private to `test_tick_engine.py`.

```python
import pytest
from aica_api.services.nri_forecast import run_forecast, _MAX_FORECAST_TICKS
from aica_api.services import tick_engine
from aica_api.services.tick_engine import _NO_REST_SENTINEL

# --- shared setup: build a deterministic run and advance one real tick ---
def _setup(spots, total_km=400.0):
    scenario, event_plan, route_facts = _make_run(total_route_distance_km=total_km)  # reused builder
    route_facts.rest_spot_positions = list(spots)
    t0 = tick_engine.advance_tick(None, 0, event_plan, route_facts, scenario)
    return scenario, event_plan, route_facts, t0

def _scripted(scores):
    """evaluate() that returns s_total from a per-call script, passing state through."""
    seq = iter(scores)
    def _ev(tick_state, prev_state):
        s = next(seq, scores[-1])
        return {"scores": {"s_total": s}, "next_package_runtime_state": dict(prev_state),
                "result_type": "NO_PROPOSAL"}
    return _ev

def _run(scenario, event_plan, route_facts, t0, evaluate, **over):
    kw = dict(
        start_tick_state=t0, start_tick_index=1,
        current_elapsed_min=t0.elapsed_seconds / 60.0,
        current_distance_km=t0.distance_km,
        event_plan=event_plan, route_facts=route_facts, scenario=scenario, run_seed=None,
        package_runtime_state={}, committed_content=None,
        committed_content_remaining_min=0.0, committed_content_relief=None,
        evaluate=evaluate, threshold_fire=100.0, threshold_forecast_rest=80.0,
        threshold_monotony=60.0, eta_filter_min=30.0,
    )
    kw.update(over)
    return run_forecast(**kw)

def test_forecast_does_not_mutate_start_state():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    before = (t0.distance_km, t0.elapsed_seconds, dict(t0.signals))
    _run(scenario, ep, rf, t0, _scripted([85.0, 90.0, 101.0]))
    assert (t0.distance_km, t0.elapsed_seconds, dict(t0.signals)) == before

def test_forecast_stops_at_first_fire_crossing():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5, 130.0]))
    assert fc["future_fire"]["found"] is True
    assert fc["future_fire"]["s_total"] >= 100.0
    assert fc["future_fire"]["s_total"] == 100.5  # first crossing, not later 130

def test_forecast_stops_at_destination_when_no_crossing():
    scenario, ep, rf, t0 = _setup([40.0])
    fc = _run(scenario, ep, rf, t0, _scripted([81.0]))   # never reaches 100
    assert fc["future_fire"]["found"] is False
    assert fc["forecast_future_rest_unactionable"] is False
    assert fc["forecast_rest_unactionable_reason"] is None

def test_future_spot_is_first_position_strictly_ahead_of_crossing():
    # crossing lands past 40 but before 300 → the future spot is 300
    scenario, ep, rf, t0 = _setup([40.0, 300.0], total_km=400.0)
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    if fc["forecast_rest_spot"]["exists"]:
        assert fc["forecast_rest_spot"]["position_km"] > fc["future_fire"]["distance_km"]

def test_no_spot_after_crossing_sets_no_spot_ahead():
    scenario, ep, rf, t0 = _setup([40.0], total_km=400.0)  # only spot behind the crossing
    fc = _run(scenario, ep, rf, t0, _scripted([90.0, 101.0]))
    assert fc["future_fire"]["found"] is True
    assert fc["forecast_future_rest_unactionable"] is True
    assert fc["forecast_rest_unactionable_reason"] == "no_spot_ahead"

def test_forecast_error_returns_unavailable_without_raising():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    def _boom(ts, prev): raise RuntimeError("algorithm_error")
    fc = _run(scenario, ep, rf, t0, _boom)
    assert fc["evaluated"] is False
    assert fc["error"] is not None
    assert fc["future_fire"]["found"] is False

def test_committed_content_ends_at_remaining_boundary(monkeypatch):
    """`content` passed to advance_tick is the committed episode until its
    remaining duration elapses, then None (spec §8.2 step 5, §8.4)."""
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    seen_content = []
    real_advance = tick_engine.advance_tick
    def _spy(prior, idx, *a, **kw):
        seen_content.append(kw.get("content"))
        return real_advance(prior, idx, *a, **kw)
    monkeypatch.setattr("aica_api.services.nri_forecast.advance_tick", _spy)
    fake_content = object()  # stand-in ContentContext; identity is all we check
    _run(scenario, ep, rf, t0, _scripted([85.0] * 50),
         committed_content=fake_content, committed_content_remaining_min=5.0)
    # early projected ticks carry the committed content; later ones carry None
    assert seen_content[0] is fake_content
    assert None in seen_content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest app/api/tests/test_nri_forecast.py -v`
Expected: FAIL — module `nri_forecast` does not exist.

- [ ] **Step 3: Implement `app/api/aica_api/services/nri_forecast.py`**

```python
"""Committed-state continuation forecast for NRI (design §8–§10).

A NON-PERSISTING projection: it copies the post-current-tick state and steps the
deterministic tick/adapter loop forward, CONTINUING the already-committed
intervention but ACCEPTING NO projected-future proposal, to answer one question —
when the score next crosses threshold_fire, will a rest facility be actionable
there? It never touches the live run, never appends events, never advances the
real tick. See the plan's Shared contract reference for the returned block shape.
"""
from __future__ import annotations

from typing import Callable

from aica_api.services.tick_engine import (
    advance_tick,
    rest_spot_actionability,
    _NO_REST_SENTINEL,
)

EvaluateFn = Callable[..., dict]

_MAX_FORECAST_TICKS = 2000


def _unavailable(error: str | None, threshold_order_valid: bool = True) -> dict:
    return {
        "evaluated": False, "error": error,
        "threshold_order_valid": threshold_order_valid,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": {"content_active": False, "service_id": None, "content_remaining_min": 0.0},
        "future_fire": {"found": False, "tick_index": None, "elapsed_min": None,
                        "distance_km": None, "route_fraction": None, "s_total": None},
        "forecast_rest_spot": {"exists": False, "position_km": None, "eta_from_fire_min": None,
                               "eta_to_destination_min": None, "actionable": False},
        "forecast_future_rest_unactionable": False,
        "forecast_rest_unactionable_reason": None,
        "current_rest_spot": {"exists": False, "position_km": None, "eta_from_current_min": None,
                              "eta_to_destination_min": None, "actionable": False,
                              "unactionable_reason": None},
    }


def run_forecast(
    *,
    start_tick_state,
    start_tick_index: int,
    current_elapsed_min: float,
    current_distance_km: float,
    event_plan,
    route_facts,
    scenario,
    run_seed,
    package_runtime_state: dict,
    committed_content=None,
    committed_content_remaining_min: float = 0.0,
    committed_content_relief=None,
    evaluate: EvaluateFn,
    threshold_fire: float,
    threshold_forecast_rest: float,
    threshold_monotony: float,
    eta_filter_min: float,
) -> dict:
    sp = scenario.speed_profile
    tick_seconds = event_plan.tick_seconds

    # Current rest spot (design §10) — always computable from the actual tick.
    current = rest_spot_actionability(
        from_km=current_distance_km, from_elapsed_min=current_elapsed_min,
        route_facts=route_facts, event_plan=event_plan, sp=sp, eta_filter_min=eta_filter_min,
    )
    current_block = {
        "exists": current.exists, "position_km": current.position_km,
        "eta_from_current_min": (None if not current.exists else current.eta_from_position_min),
        "eta_to_destination_min": current.eta_to_destination_min,
        "actionable": current.actionable, "unactionable_reason": current.unactionable_reason,
    }

    start_block = {
        "content_active": committed_content is not None,
        "service_id": getattr(committed_content, "service_id", None),
        "content_remaining_min": float(committed_content_remaining_min or 0.0),
    }

    # ── Project forward, continuing committed state, accepting no proposal ──
    prior = start_tick_state
    state = dict(package_runtime_state)
    fire = None
    try:
        for step in range(1, _MAX_FORECAST_TICKS + 1):
            idx = start_tick_index + step - 1
            projected_elapsed_from_start_min = (step - 1) * tick_seconds / 60.0
            content_playing = (
                committed_content is not None
                and projected_elapsed_from_start_min < committed_content_remaining_min
            )
            content = committed_content if content_playing else None
            relief = committed_content_relief if content_playing else None

            ts = advance_tick(
                prior, idx, event_plan, route_facts, scenario,
                recovery=None,               # §8.2 item 10 — never start recovery
                run_seed=run_seed, content=content, content_relief=relief,
            )
            decision = evaluate(ts, state)   # §8.2 items 6-9 — ignore its proposal/fire
            state = dict(decision["next_package_runtime_state"])
            s_total = float(decision["scores"]["s_total"])

            if s_total >= threshold_fire:
                fire = {
                    "found": True, "tick_index": idx,
                    "elapsed_min": idx * tick_seconds / 60.0,
                    "distance_km": ts.distance_km, "route_fraction": ts.route_fraction,
                    "s_total": s_total,
                }
                break
            if ts.completed:
                break
            prior = ts
    except Exception as exc:                 # §18 — fail open; forecast is advisory
        block = _unavailable(f"forecast_error: {exc!r}")
        block["current_rest_spot"] = current_block
        block["forecast_start"] = start_block
        return block

    # ── No crossing before destination → future rest is not unactionable ──
    if fire is None:
        block = _unavailable(None)
        block["evaluated"] = True
        block["current_rest_spot"] = current_block
        block["forecast_start"] = start_block
        return block

    # ── Future rest spot at the crossing (design §9) ──
    fspot = rest_spot_actionability(
        from_km=fire["distance_km"], from_elapsed_min=fire["elapsed_min"],
        route_facts=route_facts, event_plan=event_plan, sp=sp, eta_filter_min=eta_filter_min,
    )
    # Map the shared reason to the forecast-spot reason vocabulary (§9/§13/§18):
    _reason_map = {"rest_spot_eta_over_limit": "eta_over_30_min"}
    forecast_rest_spot = {
        "exists": fspot.exists, "position_km": fspot.position_km,
        "eta_from_fire_min": (None if not fspot.exists else fspot.eta_from_position_min),
        "eta_to_destination_min": fspot.eta_to_destination_min,
        "actionable": fspot.actionable,
    }
    future_unactionable = not fspot.actionable
    future_reason = (
        _reason_map.get(fspot.unactionable_reason, fspot.unactionable_reason)
        if future_unactionable else None
    )

    return {
        "evaluated": True, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": start_block,
        "future_fire": fire,
        "forecast_rest_spot": forecast_rest_spot,
        "forecast_future_rest_unactionable": future_unactionable,
        "forecast_rest_unactionable_reason": future_reason,
        "current_rest_spot": current_block,
    }
```

Notes for the implementer:
- The `threshold_order_valid` / cheap-eligibility gates live in the **orchestration** (Tasks 6/7); `run_forecast` assumes it is only called when eligible. It still fails open on any internal exception (§18).
- `committed_content` is the live `ContentContext`; `getattr(..., "service_id", None)` tolerates the test's stand-in object. Confirm the real attribute name on `ContentContext` (it may be `service` or `service_id`) and use the real one — the stand-in only checks identity, not attributes.
- Do NOT import or call the maps client, evidence recorder, or `_registry`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest app/api/tests/test_nri_forecast.py -v`
Expected: PASS. Add the remaining §20.2 items (3,4,5,7,8,9,14) as further tests following the same scripted-`evaluate`/`advance_tick`-spy pattern: proposals/monotony/rest inside the projection cause no action events or recovery (assert `advance_tick` always received `recovery=None` and the service never called any action helper); an accepted episode present with correct remaining/relief; both future ETAs use planned-profile integration (assert they equal direct `_eta_min_to_km` calls); a future spot at exactly 30.0 min is actionable and >30 sets `eta_over_30_min`; 9.9 vs 10.0 min to destination toggles `inside_destination_edge`. Use `total_km`/spot placement to hit each boundary.

- [ ] **Step 5: Commit** (only once the user authorizes committing)

```bash
git add app/api/aica_api/services/nri_forecast.py app/api/tests/test_nri_forecast.py
git commit -m "feat(nri-forecast): committed-state continuation forecast service"
```

---

## Task 5: NRI algorithm — forecast early-rest decision path

**Files:**
- Modify: `packages/nri_fatigue_score_v1/algorithm.py` (`evaluate`, `_state_label`, proposal builder, criteria, rest_required gate list, explanation)
- Test: `app/api/tests/test_nri_fatigue_score.py` (extend)

**Interfaces:**
- Consumes: the `nri_forecast` block from `context` (Shared contract reference); `hp["threshold_forecast_rest"]` (Task 1); `spot_actionable`/`spot_reason` (Task 3).
- Produces: when the full early-rest rule passes (spec §11) — `result_type="REST_PROPOSAL"`, `selected_category="rest_required"`, `trigger_candidate=True`, `states.rest="REST_FORECAST_FIRE"`, rest `fire_control.reason="forecast_rest_opportunity_passed"`, `strength="clear"`, `proposal=forecast_rest_required_proposal` (options `accept_rest`/`postpone`/`decline`), monotony suppressed with `superseded_by_forecast_rest`; plus the §14.1 criteria keys and §14.2 rest-candidate gate list. When any gate fails, the ordinary Task 3 behavior is unchanged.

- [ ] **Step 1: Write the failing tests** (spec §20.1 items 3,4,5,8,9,10,12,13,14)

Add to `app/api/tests/test_nri_fatigue_score.py`. Helper to build an eligible forecast block (future problem present, current spot actionable):

```python
def _forecast_block(*, current_actionable=True, future_unactionable=True,
                    future_found=True, order_valid=True):
    return {
        "evaluated": True, "error": None, "threshold_order_valid": order_valid,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": {"content_active": True, "service_id": "humming_karaoke",
                           "content_remaining_min": 11.0},
        "future_fire": {"found": future_found, "tick_index": 42, "elapsed_min": 126.0,
                        "distance_km": 101.5, "route_fraction": 0.84, "s_total": 100.8},
        "forecast_rest_spot": {"exists": True, "position_km": 116.0, "eta_from_fire_min": 34.0,
                               "eta_to_destination_min": 22.0, "actionable": False},
        "forecast_future_rest_unactionable": future_unactionable,
        "forecast_rest_unactionable_reason": "eta_over_30_min" if future_unactionable else None,
        "current_rest_spot": {"exists": True, "position_km": 83.0, "eta_from_current_min": 18.0,
                              "eta_to_destination_min": 31.0, "actionable": current_actionable,
                              "unactionable_reason": None if current_actionable else "rest_spot_eta_over_limit"},
    }

def _score_between_80_100():
    # tune signals so raw s_total lands strictly in (80, 100); pin sim_time so
    # accumulation is deterministic. Assert the precondition inside the test.
    return _signals(fatigue=70.0, drowsiness=55.0, next_rest_spot_min=18.0)

def test_score_exactly_80_does_not_fire_early():
    sig = _signals(next_rest_spot_min=18.0)   # tune so s_total == 80.0 exactly
    ctx = _ctx(sig, nri_forecast=_forecast_block())
    result = mod.evaluate(ctx)
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    assert result["fire_control"].get("reason") != "forecast_rest_opportunity_passed"

def test_score_above_80_fires_early_when_all_gates_pass():
    ctx = _ctx(_score_between_80_100(), nri_forecast=_forecast_block())
    result = mod.evaluate(ctx)
    assert 80.0 < result["scores"]["s_total"] < 100.0
    assert result["result_type"] == "REST_PROPOSAL"
    assert result["selected_category"] == "rest_required"
    assert result["trigger_candidate"] is True
    assert result["states"]["rest"] == "REST_FORECAST_FIRE"
    assert result["fire_control"]["reason"] == "forecast_rest_opportunity_passed"

def test_early_fire_uses_forecast_proposal_with_clear_strength():
    ctx = _ctx(_score_between_80_100(), nri_forecast=_forecast_block())
    result = mod.evaluate(ctx)
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["strength"] == "clear"
    assert result["proposal"]["options"] == ["accept_rest", "postpone", "decline"]
    # copy must NOT claim 100 already crossed (§12.1, §20.1-14)
    text = (result["proposal"]["message"]["en"] + result["explanation"][0]["en"]).lower()
    assert "100" not in text.replace("101", "").replace("100.8", "")
    assert "exceeded the threshold" not in text

def test_early_fire_suppresses_monotony_as_superseded_by_forecast_rest():
    ctx = _ctx(_score_between_80_100(), nri_forecast=_forecast_block())
    result = mod.evaluate(ctx)
    mono = next(c for c in result["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["fired"] is False
    assert mono["fire_control"]["reason"] == "superseded_by_forecast_rest"

def test_blocked_early_path_never_sets_forecast_fire_state():
    # current spot not actionable → no early fire; monotony stays ordinary
    ctx = _ctx(_score_between_80_100(),
               nri_forecast=_forecast_block(current_actionable=False))
    result = mod.evaluate(ctx)
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    rest = next(c for c in result["candidates"] if c["category"] == "rest_required")
    assert rest["fire_control"]["fired"] is False
    mono = next(c for c in result["candidates"] if c["category"] == "monotony_prevention")
    assert mono["fire_control"]["reason"] != "superseded_by_forecast_rest"

def test_invalid_threshold_order_disables_only_forecast_path():
    ctx = _ctx(_score_between_80_100(),
               nri_forecast=_forecast_block(order_valid=False))
    result = mod.evaluate(ctx)
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
    assert result["criteria"]["forecast_threshold_order_valid"] is False

def test_future_unactionable_alone_without_current_spot_does_not_fire():
    ctx = _ctx(_score_between_80_100(),
               nri_forecast=_forecast_block(current_actionable=False,
                                            future_unactionable=True))
    result = mod.evaluate(ctx)
    assert result["result_type"] != "REST_PROPOSAL" or result["selected_category"] != "rest_required"
    assert result["states"]["rest"] != "REST_FORECAST_FIRE"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "early or forecast_fire or forecast_proposal or superseded or threshold_order or future_unactionable" -v`
Expected: FAIL — no forecast path yet; `REST_FORECAST_FIRE`/`forecast_rest_opportunity_passed`/new criteria absent.

- [ ] **Step 3: Implement in `algorithm.py`**

1. Read the early threshold + eligibility, right after the Task-3 actionability block:

```python
    threshold_forecast = float(hp.get("threshold_forecast_rest", 80.0))
    _fc = _forecast  # alias from Task 3
    forecast_evaluated = bool(_fc.get("evaluated"))
    order_valid = threshold_monotony < threshold_forecast < threshold_fire
    future_fire_found = bool((_fc.get("future_fire") or {}).get("found"))
    future_unactionable = bool(_fc.get("forecast_future_rest_unactionable"))

    early_fire = (
        order_valid
        and forecast_evaluated
        and (threshold_forecast < s_total < threshold_fire)   # strict both sides (§7)
        and not recovered
        and future_fire_found
        and future_unactionable
        and spot_actionable                                   # current spot actionable (Task 3)
    )
```

2. `exists` and strength:

```python
    exists = (s_total >= threshold_fire) or early_fire
    if early_fire:
        strength_label = "clear"                              # fixed (§12.3)
    elif s_total >= threshold_fire:
        strength_label = "strong" if s_realtime > 0.0 else "clear"
    else:
        strength_label = None
```

3. Rest fire-control branch — insert `early_fire` ahead of the ordinary checks:

```python
    if recovered:
        suppressed = True
        reason = "recovery_after_accept"
    elif early_fire:
        fired = True
        reason = "forecast_rest_opportunity_passed"
    elif not exists:
        reason = "below_fire_threshold"
    elif spot_actionable:
        fired = True
        reason = "fire_threshold_passed"
    else:
        suppressed = True
        reason = spot_reason
```

4. Monotony branch — supersede on early fire:

```python
    if recovered:
        mono_suppressed = True; mono_reason = "recovery_after_accept"
    elif not mono_exists:
        mono_reason = "below_monotony_threshold"
    elif early_fire:
        mono_suppressed = True; mono_reason = "superseded_by_forecast_rest"
    elif not mono_in_band:
        mono_suppressed = True; mono_reason = "superseded_by_rest_required"
    else:
        mono_fired = True; mono_reason = "monotony_threshold_passed"
```

5. `_state_label` gains an `early_fire` arg (default False) returning `"REST_FORECAST_FIRE"` before the `REST_FIRE` check; update its call site to pass `early_fire=early_fire`.

6. Proposal — early path uses the forecast proposal:

```python
    proposal = None
    if early_fire:
        proposal = _build_forecast_proposal()
    elif fired and strength_label:
        proposal = _build_proposal(strength_label)
    elif mono_fired:
        proposal = _build_monotony_proposal()
```

Add `_build_forecast_proposal()` returning the manifest's `forecast_rest_required_proposal` message/options (mirror `_build_proposal`'s structure; load from the same source it uses). Message copy is the JA/EN from Task 1 — it must not claim threshold 100 was crossed.

7. Criteria — add the §14.1 keys from the forecast block:

```python
    _ff = _fc.get("future_fire") or {}
    _frs = _fc.get("forecast_rest_spot") or {}
    _crs2 = _fc.get("current_rest_spot") or {}
    _fs = _fc.get("forecast_start") or {}
    criteria.update({
        "threshold_forecast_rest": threshold_forecast,
        "forecast_threshold_order_valid": order_valid,
        "forecast_mode": _fc.get("forecast_mode"),
        "forecast_start_content_active": _fs.get("content_active"),
        "forecast_start_service_id": _fs.get("service_id"),
        "forecast_start_content_remaining_min": _fs.get("content_remaining_min"),
        "forecast_fire_found": future_fire_found,
        "forecast_fire_s_total": _ff.get("s_total"),
        "forecast_fire_eta_from_now_min": (
            None if _ff.get("elapsed_min") is None
            else _ff["elapsed_min"] - float(context.get("simulation_time_sec", 0.0)) / 60.0
        ),
        "forecast_fire_distance_km": _ff.get("distance_km"),
        "forecast_rest_spot_exists": _frs.get("exists"),
        "forecast_rest_spot_eta_from_fire_min": _frs.get("eta_from_fire_min"),
        "forecast_rest_spot_eta_to_destination_min": _frs.get("eta_to_destination_min"),
        "forecast_rest_spot_actionable": _frs.get("actionable"),
        "forecast_future_rest_unactionable": future_unactionable,
        "forecast_rest_unactionable_reason": _fc.get("forecast_rest_unactionable_reason"),
        "current_rest_spot_exists": _crs2.get("exists"),
        "current_rest_spot_eta_min": _crs2.get("eta_from_current_min"),
        "current_rest_spot_eta_to_destination_min": _crs2.get("eta_to_destination_min"),
        "current_rest_spot_actionable": _crs2.get("actionable"),
        "current_rest_spot_unactionable_reason": _crs2.get("unactionable_reason"),
    })
```

(where `criteria` is the dict already assembled in the return; build it as a local before the return and `.update(...)` it, or add the keys inline. Keep the existing `threshold_fire`/`threshold_monotony`/`rest_required_threshold`/`monotony_suggest_threshold`/`rest_spot_eta_filter_min` keys.)

8. Rest-candidate gates (§14.2) — when `forecast_evaluated`, REPLACE `feature_contributions["rest_required"]["gates"]` with the 11-gate ordered list; otherwise keep `[gate_recovery, gate_eta]`. Build via a helper `_forecast_rest_gates(...)`:

```python
def _gate(gid, passed, inputs, effect_allow="allow", effect_suppress="suppress"):
    return {"gate_id": gid, "evaluated_inputs": inputs, "passed": passed,
            "effect": effect_allow if passed else effect_suppress}

def _forecast_rest_gates(*, order_valid, s_total, t_forecast, t_fire,
                         ff, frs, crs, fs, recovered, eta_filter):
    return [
        _gate("forecast_threshold_order", order_valid, {"t_forecast": t_forecast}),
        _gate("forecast_current_score", t_forecast < s_total < t_fire, {"s_total": s_total}),
        _gate("forecast_future_fire", bool(ff.get("found")), {"s_total": ff.get("s_total")}),
        _gate("forecast_committed_intervention", True,
              {"content_active": fs.get("content_active"), "service_id": fs.get("service_id")}),
        _gate("forecast_future_rest_spot", bool(frs.get("exists")),
              {"position_km": frs.get("position_km")}),
        _gate("forecast_future_rest_spot_eta",
              frs.get("eta_from_fire_min") is not None and frs.get("eta_from_fire_min") <= eta_filter,
              {"eta_from_fire_min": frs.get("eta_from_fire_min"), "limit": eta_filter}),
        _gate("forecast_destination_edge",
              frs.get("eta_to_destination_min") is not None and frs.get("eta_to_destination_min") >= 10.0,
              {"eta_to_destination_min": frs.get("eta_to_destination_min")}),
        _gate("forecast_current_rest_spot",
              bool(crs.get("exists")) and crs.get("eta_from_current_min") is not None,
              {"nextRestSpotMin": crs.get("eta_from_current_min")}),
        _gate("forecast_current_rest_spot_eta",
              crs.get("eta_from_current_min") is not None and crs.get("eta_from_current_min") <= eta_filter,
              {"eta_from_current_min": crs.get("eta_from_current_min"), "limit": eta_filter}),
        _gate("forecast_current_rest_spot_destination_edge",
              crs.get("eta_to_destination_min") is not None and crs.get("eta_to_destination_min") >= 10.0,
              {"eta_to_destination_min": crs.get("eta_to_destination_min")}),
        _gate("recovery_suppression", not recovered, {}),
    ]
```

Then in `evaluate`, after `feature_contributions` is built:

```python
    if forecast_evaluated:
        feature_contributions["rest_required"]["gates"] = _forecast_rest_gates(
            order_valid=order_valid, s_total=s_total, t_forecast=threshold_forecast,
            t_fire=threshold_fire, ff=_ff, frs=_frs, crs=_crs2, fs=_fs,
            recovered=recovered, eta_filter=rest_eta_filter,
        )
```

This preserves §14.2's ordering and the invariant that `forecast_current_rest_spot` is False when `nextRestSpotMin == 9999.0` (its `eta_from_current_min` is None then). The fire decision uses `early_fire`/`spot_actionable`, so evidence never shows "no current spot" with a fired rest candidate.

9. Explanation (§14.3) — when `early_fire`, prepend an early-specific explanation entry:

```python
    if early_fire:
        reason_word = _fc.get("forecast_rest_unactionable_reason")
        explanation = [{
            "ja": (
                f"総合疲労スコア={s_total:.1f}点 (基礎={s_base:.1f}+環境={s_env:.1f}+実時間={s_realtime:.1f})。"
                f"早期閾値{threshold_forecast:.0f}超・安全閾値{threshold_fire:.0f}未満。"
                f"予測: 約{_ff.get('elapsed_min')}分/{_ff.get('distance_km')}kmで安全閾値に到達見込み、"
                f"その時の休憩地は利用困難({reason_word})。"
                f"現在の休憩地までETA={_crs2.get('eta_from_current_min')}分、"
                f"到着後の目的地までETA={_crs2.get('eta_to_destination_min')}分。前方で早めの休憩を提案。"
            ),
            "en": (
                f"Total fatigue score={s_total:.1f} (base={s_base:.1f}+env={s_env:.1f}+realtime={s_realtime:.1f}). "
                f"Above early threshold {threshold_forecast:.0f}, below safety threshold {threshold_fire:.0f}. "
                f"Forecast: safety threshold reached in ~{_ff.get('elapsed_min')} min / {_ff.get('distance_km')} km, "
                f"where the rest spot would be unusable ({reason_word}). "
                f"Current rest spot ETA={_crs2.get('eta_from_current_min')} min, "
                f"destination ETA after it={_crs2.get('eta_to_destination_min')} min. Proposing an early rest ahead."
            ),
        }]
```

Leave the ordinary explanation branch (the existing `band_ja`/`band_en` block) intact for the non-early paths.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest app/api/tests/test_nri_fatigue_score.py -k "early or forecast_fire or forecast_proposal or superseded or threshold_order or future_unactionable" -v`
Expected: PASS. Then the whole file: `pytest app/api/tests/test_nri_fatigue_score.py -v` (no regressions).

- [ ] **Step 5: Commit** (only once the user authorizes committing)

```bash
git add packages/nri_fatigue_score_v1/algorithm.py app/api/tests/test_nri_fatigue_score.py
git commit -m "feat(nri): forecast-based early REST_PROPOSAL (REST_FORECAST_FIRE) with full evidence"
```

---

## Task 6: run_manager — two-pass forecast seam in `tick()`

**Files:**
- Modify: `app/api/aica_api/services/run_manager.py` (`tick()`, ~lines 1120-1194; add two module helpers)
- Test: `app/api/tests/test_run_manager_forecast.py` (NEW)

**Interfaces:**
- Consumes: `rest_spot_actionability` / `SpotActionability` (Task 2); `run_forecast` (Task 4); existing `_inside_trip_edge` (run_manager.py:~360), `_apply_trip_edge_guard` (run_manager.py:397), `build_adapter_context` (tick_engine), `_adapter.evaluate`.
- Produces: `context["nri_forecast"]` per the Shared contract reference on the pass that reaches the algorithm; the persisted `TickEvent` carries the 2nd-pass `decision_result`. No new public symbol other than the two helpers below.

The live seam is exactly the block at `run_manager.py:1120-1194` (first `_adapter.evaluate` at 1121 → store `next_package_runtime_state` at 1180 → `_apply_trip_edge_guard` at 1188). The trip-edge guard stays where it is, AFTER the two-pass block. The two-pass logic slots between the context build (1091- finish) and the first evaluate.

- [ ] **Step 1: Write the failing tests** (spec §20.3)

Create `app/api/tests/test_run_manager_forecast.py`. Drive the seam with a scripted adapter so the wiring is asserted without hand-tuning a scenario to a precise score:

```python
"""Two-pass forecast seam in run_manager.tick() (spec §15.4, §20.3)."""
from __future__ import annotations

import pathlib
import pytest
from fastapi.testclient import TestClient

import aica_api.services.run_manager as rm
import aica_api.algorithms.adapter as adapter_mod
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from aica_api.models.decision import DecisionResult

NRI_PACKAGE_ID = "nri_fatigue_score_v1"
SCENARIO_ID = "uc01_fatigue_recovery_v0_1"


@pytest.fixture(autouse=True)
def _reset():
    clear_registry(); clear_draft_registry()
    yield
    clear_registry(); clear_draft_registry()


def _make_run(client):
    plan = client.post("/api/run-plans", json={
        "package_id": NRI_PACKAGE_ID, "scenario_id": SCENARIO_ID,
        "parameters": {}, "hyperparameters": {},
    })
    assert plan.status_code == 201
    run = client.post("/api/runs", json={"plan_id": plan.json()["plan_id"]})
    assert run.status_code == 201
    return run.json()["run_id"]


def test_second_pass_runs_only_when_score_in_forecast_band(client, monkeypatch):
    """When pass-1 s_total is in (80,100), tick() attaches an evaluated forecast
    block and re-evaluates; the context the algorithm sees on the *persisted*
    pass has nri_forecast.evaluated True."""
    seen_contexts = []
    real_eval = adapter_mod.evaluate

    def _spy(*, package, context, **kw):
        seen_contexts.append(dict(context.get("nri_forecast") or {}))
        # Force pass-1 score into the forecast band so the seam runs pass 2.
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 88.0})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    run_id = _make_run(client)
    # Tick past the start edge so eligibility isn't blocked by trip-edge.
    for _ in range(30):
        r = client.post(f"/api/runs/{run_id}/tick"); assert r.status_code == 200
        if r.json().get("completed"):
            break
    # At least one tick evaluated twice (pass 1 evaluated False → pass 2 True).
    assert any(b.get("evaluated") for b in seen_contexts), seen_contexts[-3:]


def test_low_score_never_triggers_second_pass(client, monkeypatch):
    """s_total below the forecast threshold → no evaluated forecast block ever."""
    real_eval = adapter_mod.evaluate

    def _spy(*, package, context, **kw):
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 10.0})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    seen = []
    orig_rf = rm.run_forecast
    monkeypatch.setattr(rm, "run_forecast", lambda **kw: seen.append(1) or orig_rf(**kw))
    run_id = _make_run(client)
    for _ in range(20):
        r = client.post(f"/api/runs/{run_id}/tick")
        if r.json().get("completed"):
            break
    assert seen == []  # run_forecast never called below threshold


def test_persisted_event_uses_second_pass_runtime_state(client, monkeypatch):
    """Only the 2nd-pass next_package_runtime_state is persisted (§15.4)."""
    real_eval = adapter_mod.evaluate
    calls = {"n": 0}

    def _spy(*, package, context, **kw):
        calls["n"] += 1
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 88.0})
        # tag runtime state with the pass ordinal so we can tell which was stored
        object.__setattr__(result, "next_package_runtime_state",
                           {**result.next_package_runtime_state, "_pass": calls["n"]})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    run_id = _make_run(client)
    for _ in range(25):
        r = client.post(f"/api/runs/{run_id}/tick")
        body = r.json()
        if body.get("completed"):
            break
    log = client.get(f"/api/runs/{run_id}/log").json()
    ticks = [e for e in log["events"] if e["kind"] == "tick"]
    # a two-pass tick persisted the higher (even) pass ordinal, not the odd one
    passes = [e["package_runtime_state"].get("_pass") for e in ticks
              if "_pass" in e["package_runtime_state"]]
    assert passes and all(p % 2 == 0 for p in passes), passes
```

(Add a `client` fixture identical to `test_t012_rest_handling.py`'s: sets `AICA_RUNS_DIR` to `tmp_path` and returns `TestClient(app)`.)

- [ ] **Step 2: Run to verify failure**

Run: `pytest app/api/tests/test_run_manager_forecast.py -v`
Expected: FAIL — `run_forecast` not imported in run_manager; no second pass; `nri_forecast` never carries `evaluated`.

- [ ] **Step 3: Implement the seam**

1. Add imports at the top of `run_manager.py`:

```python
from aica_api.services.nri_forecast import run_forecast
from aica_api.services.tick_engine import rest_spot_actionability
```

2. Add two module-level helpers (near `_apply_trip_edge_guard`):

```python
def _forecast_scaffold(*, tick_state, route_facts, event_plan, sp, eta_filter_min):
    """Cheap pass-1 nri_forecast: current-spot actionability only, evaluated=False.

    Lets the NRI algorithm read the SHARED actionability rule (Task 3) for the
    ordinary s_total>=100 rest path too, instead of the native nextRestSpotMin
    (which lacks the destination-edge check). The expensive future projection is
    added later only when the score lands in the forecast band."""
    act = rest_spot_actionability(
        from_km=tick_state.distance_km or 0.0,
        from_elapsed_min=float(tick_state.elapsed_seconds) / 60.0,
        route_facts=route_facts, event_plan=event_plan, sp=sp,
        eta_filter_min=eta_filter_min,
    )
    return {
        "evaluated": False, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": None, "future_fire": None, "forecast_rest_spot": None,
        "forecast_future_rest_unactionable": None, "forecast_rest_unactionable_reason": None,
        "current_rest_spot": {
            "exists": act.exists, "position_km": act.position_km,
            "eta_from_current_min": act.eta_min, "eta_to_destination_min": act.eta_to_destination_min,
            "actionable": act.actionable, "unactionable_reason": act.unactionable_reason,
        },
    }


def _forecast_eligible(*, decision_result, hyperparameters, recovery_active, inside_edge):
    """Cheap gate (§19): NRI package, score strictly in (forecast, fire), not in a
    recovery, not inside a trip edge, and the current spot is actionable."""
    if "threshold_forecast_rest" not in hyperparameters:
        return False
    if recovery_active or inside_edge:
        return False
    t_forecast = float(hyperparameters["threshold_forecast_rest"])
    t_fire = float(hyperparameters["threshold_fire"])
    t_mono = float(hyperparameters["threshold_monotony"])
    if not (t_mono < t_forecast < t_fire):
        return False
    s_total = decision_result.scores.get("s_total")
    if s_total is None or not (t_forecast < s_total < t_fire):
        return False
    crs = (decision_result.criteria or {}).get if False else None  # read from scaffold instead
    return True
```

3. In `tick()`, replace the single-evaluate block (1120-1194) with the two-pass structure. Before the first `evaluate`, build and attach the scaffold:

```python
    eta_filter_min = float(hyperparameters.get("rest_spot_eta_filter_min", 30.0))
    nri_forecast = None
    if "threshold_forecast_rest" in hyperparameters:
        nri_forecast = _forecast_scaffold(
            tick_state=tick_state, route_facts=run_state.route_facts,
            event_plan=run_state.event_plan, sp=scenario.speed_profile,
            eta_filter_min=eta_filter_min,
        )
        context["nri_forecast"] = nri_forecast
```

Keep the existing `try/except AlgorithmAdapterError` around the first `_adapter.evaluate` UNCHANGED (1120-1177). After it succeeds, insert the second pass BEFORE storing `next_package_runtime_state`:

```python
    # ── Two-pass forecast (NRI early-rest, spec §15.4) ────────────────────
    if nri_forecast is not None:
        inside_edge = _inside_trip_edge(
            elapsed_seconds=float(tick_state.elapsed_seconds),
            distance_km=tick_state.distance_km,
            route_facts=run_state.route_facts,
            event_plan=run_state.event_plan,
            speed_profile=scenario.speed_profile,
        )
        crs_actionable = bool(nri_forecast["current_rest_spot"]["actionable"])
        if crs_actionable and _forecast_eligible(
            decision_result=decision_result, hyperparameters=hyperparameters,
            recovery_active=context["recovery_active"], inside_edge=inside_edge,
        ):
            def _projected_evaluate(proj_ts, proj_runtime_state):
                proj_ctx = build_adapter_context(proj_ts)
                proj_ctx["simulation_time_sec"] = float(proj_ts.elapsed_seconds)
                proj_ctx["proposal_history"] = []
                proj_ctx["user_action_history"] = []
                proj_ctx["recovery_active"] = False
                # NO nri_forecast key → algorithm uses its native (non-forecast) path,
                # so the projection never recurses and just yields s_total.
                return _adapter.evaluate(
                    package=package, context=proj_ctx,
                    parameters=parameters, hyperparameters=hyperparameters,
                    history=[], package_runtime_state=proj_runtime_state,
                )

            full_block = run_forecast(
                start_tick_state=tick_state,
                start_tick_index=current_tick,
                current_elapsed_min=float(tick_state.elapsed_seconds) / 60.0,
                current_distance_km=tick_state.distance_km or 0.0,
                event_plan=run_state.event_plan,
                route_facts=run_state.route_facts,
                scenario=scenario,
                run_seed=run_state.run_seed,
                package_runtime_state=run_state.package_runtime_state,
                committed_content=run_state.active_content_context,
                committed_content_relief=run_state.content_relief,
                evaluate=_projected_evaluate,
                threshold_fire=float(hyperparameters["threshold_fire"]),
                threshold_forecast_rest=float(hyperparameters["threshold_forecast_rest"]),
                threshold_monotony=float(hyperparameters["threshold_monotony"]),
                eta_filter_min=eta_filter_min,
            )
            # Merge future fields onto the scaffold; keep the cheap current_rest_spot.
            full_block["current_rest_spot"] = nri_forecast["current_rest_spot"]
            context["nri_forecast"] = full_block
            decision_result = _adapter.evaluate(
                package=package, context=context,
                parameters=parameters, hyperparameters=hyperparameters,
                history=[], package_runtime_state=run_state.package_runtime_state,
            )

    # ── Thread package_runtime_state (2nd pass when it ran, else 1st) ──────
    run_state.package_runtime_state = decision_result.next_package_runtime_state
```

Leave lines 1182-1194 (the `_apply_trip_edge_guard` call) and everything after UNCHANGED — the guard runs on the final `decision_result`.

Adjust `_forecast_eligible` to drop the dead `crs` line (the caller checks `crs_actionable` separately) — final body ends at the `s_total` band check returning True.

Note on `run_state` fields: confirm the exact attribute names for the committed content and its relief on `RunState` (the code above assumes `active_content_context` and `content_relief`). If they differ, use the real names — `run_manager.tick()` already reads them when it threads content each tick; match that.

- [ ] **Step 4: Run to verify pass**

Run: `pytest app/api/tests/test_run_manager_forecast.py -v`
Expected: PASS. Then a quick regression: `pytest app/api/tests/test_run_manager_response_suppression.py app/api/tests/test_end_to_end_run.py -q`.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add app/api/aica_api/services/run_manager.py app/api/tests/test_run_manager_forecast.py
git commit -m "feat(nri-forecast): two-pass forecast seam in run_manager.tick()"
```

---

## Task 7: preview — mirror the two-pass seam in `iter_preview_ticks`

**Files:**
- Modify: `app/api/aica_api/services/preview.py` (`iter_preview_ticks`, ~lines 647-705)
- Test: `app/api/tests/test_iter_preview_ticks.py` (extend)

**Interfaces:**
- Consumes: the same `run_forecast`, `rest_spot_actionability`, `_forecast_scaffold`, `_forecast_eligible` from Task 6. Import the two helpers from `run_manager` (do not re-implement — the two loops must stay identical, per the trip-edge-guard-two-loops rule).
- Produces: identical `nri_forecast` wiring in the quickview projection so the preview's fire episodes match the live run's.

The preview loop is a SEPARATE parallel loop (see memory `trip-edge-guard-two-loops`): the guard is already mirrored at `preview.py:687`. The forecast seam must be mirrored the same way, at the same point — between the first `_adapter.evaluate` (preview.py:660) and `_apply_trip_edge_guard` (preview.py:687).

- [ ] **Step 1: Write the failing test**

Add to `app/api/tests/test_iter_preview_ticks.py`. The quickview must produce the SAME early-fire episode the live run does. Simplest faithful check: drive `iter_preview_ticks` for the NRI package on the shared scenario and assert that no exception occurs, that when a `REST_PROPOSAL` fire event is yielded its `decision.states["rest"]` can be `REST_FORECAST_FIRE`, and — the real regression guard — that the projection calls `run_forecast` (spied) exactly when the live seam would:

```python
def test_preview_mirrors_forecast_seam(monkeypatch):
    import aica_api.services.preview as pv
    calls = []
    orig = pv.run_forecast
    monkeypatch.setattr(pv, "run_forecast", lambda **kw: calls.append(kw) or orig(**kw))

    gen = pv.iter_preview_ticks(
        package_id="nri_fatigue_score_v1",
        scenario_id="uc01_fatigue_recovery_v0_1",
        hyperparameter_overrides=None, run_seed=7, rest_option_id=None,
        packages_dir=PACKAGES_DIR, scenarios_dir=SCENARIOS_DIR,
    )
    # Drain the generator; it must not raise, and any forecast call must carry the
    # NRI thresholds (never a non-NRI package).
    for _ in gen:
        pass
    for kw in calls:
        assert kw["threshold_forecast_rest"] == 80.0
        assert kw["threshold_fire"] == 100.0
```

(Reuse this file's existing `PACKAGES_DIR`/`SCENARIOS_DIR` module constants.)

- [ ] **Step 2: Run to verify failure**

Run: `pytest app/api/tests/test_iter_preview_ticks.py -k forecast_seam -v`
Expected: FAIL — `run_forecast` not referenced in `preview.py`.

- [ ] **Step 3: Implement**

1. Add imports to `preview.py`:

```python
from aica_api.services.nri_forecast import run_forecast
from aica_api.services.run_manager import _forecast_scaffold, _forecast_eligible
from aica_api.services.run_manager import _inside_trip_edge  # already used by _apply_trip_edge_guard
from aica_api.services.tick_engine import rest_spot_actionability
```

(If `_inside_trip_edge` is already imported transitively via `_apply_trip_edge_guard`, import it explicitly anyway for the eligibility check.)

2. Just before the first `decision = _adapter.evaluate(...)` at preview.py:660, build/attach the scaffold (mirror of Task 6 step 3, using this loop's local names `route_facts`, `event_plan`, `effective_scenario`, `package_runtime_state`, `recovery`):

```python
        eta_filter_min = float(hyperparameters.get("rest_spot_eta_filter_min", 30.0))
        nri_forecast = None
        if "threshold_forecast_rest" in hyperparameters:
            nri_forecast = _forecast_scaffold(
                tick_state=tick_state, route_facts=route_facts,
                event_plan=event_plan, sp=effective_scenario.speed_profile,
                eta_filter_min=eta_filter_min,
            )
            context["nri_forecast"] = nri_forecast
```

3. After the first evaluate succeeds (after `package_runtime_state = decision.next_package_runtime_state` at preview.py:676), and BEFORE `_apply_trip_edge_guard` at 687, insert the second pass — identical shape to Task 6, with the projected-evaluate closure and `run_forecast(...)` call, using this loop's locals (`recovery` for `committed_content`/`committed_content_relief`: pass the loop's `content_relief`, and the active content context the loop threads — match whatever variable the loop already uses to carry en-route content):

```python
        if nri_forecast is not None:
            inside_edge = _inside_trip_edge(
                elapsed_seconds=float(tick_state.elapsed_seconds),
                distance_km=tick_state.distance_km,
                route_facts=route_facts, event_plan=event_plan,
                speed_profile=effective_scenario.speed_profile,
            )
            crs_actionable = bool(nri_forecast["current_rest_spot"]["actionable"])
            if crs_actionable and _forecast_eligible(
                decision_result=decision, hyperparameters=hyperparameters,
                recovery_active=context["recovery_active"], inside_edge=inside_edge,
            ):
                def _projected_evaluate(proj_ts, proj_runtime_state):
                    proj_ctx = build_adapter_context(proj_ts)
                    proj_ctx["simulation_time_sec"] = float(proj_ts.elapsed_seconds)
                    proj_ctx["proposal_history"] = []
                    proj_ctx["user_action_history"] = []
                    proj_ctx["recovery_active"] = False
                    return _adapter.evaluate(
                        package=package, context=proj_ctx,
                        parameters=parameters, hyperparameters=hyperparameters,
                        history=[], package_runtime_state=proj_runtime_state,
                    )

                full_block = run_forecast(
                    start_tick_state=tick_state, start_tick_index=tick_index,
                    current_elapsed_min=float(tick_state.elapsed_seconds) / 60.0,
                    current_distance_km=tick_state.distance_km or 0.0,
                    event_plan=event_plan, route_facts=route_facts,
                    scenario=effective_scenario, run_seed=run_seed,
                    package_runtime_state=package_runtime_state_before_pass,
                    committed_content_relief=content_relief,
                    evaluate=_projected_evaluate,
                    threshold_fire=float(hyperparameters["threshold_fire"]),
                    threshold_forecast_rest=float(hyperparameters["threshold_forecast_rest"]),
                    threshold_monotony=float(hyperparameters["threshold_monotony"]),
                    eta_filter_min=eta_filter_min,
                )
                full_block["current_rest_spot"] = nri_forecast["current_rest_spot"]
                context["nri_forecast"] = full_block
                decision = _adapter.evaluate(
                    package=package, context=context,
                    parameters=parameters, hyperparameters=hyperparameters,
                    history=[], package_runtime_state=package_runtime_state_before_pass,
                )
                package_runtime_state = decision.next_package_runtime_state
```

Where `package_runtime_state_before_pass` is the value of `package_runtime_state` captured BEFORE line 676's assignment (snapshot it: `package_runtime_state_before_pass = package_runtime_state` right before the first evaluate, so both passes see the same prior state). The 2nd-pass `decision` flows unchanged into the existing `_apply_trip_edge_guard` at 687 and the `events.append(...)` / score-series / actionable-check below — no other edit.

- [ ] **Step 4: Run to verify pass**

Run: `pytest app/api/tests/test_iter_preview_ticks.py -v` then `pytest app/api/tests/test_merged_quickview_recovery_service.py -q` (quickview reuse).
Expected: PASS.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add app/api/aica_api/services/preview.py app/api/tests/test_iter_preview_ticks.py
git commit -m "feat(nri-forecast): mirror two-pass forecast seam in preview.iter_preview_ticks"
```

---

## Task 8: rest-spot picker — shared 30-min ETA, remove drowsiness ceiling (backend)

**Files:**
- Modify: `app/api/aica_api/routers/runs.py` (`rest_spots_endpoint`, lines 468-652)
- Modify: `app/api/aica_api/models/scenario.py` (remove `rest_drowsiness_ceiling`, lines 160-169)
- Test: `app/api/tests/test_rest_spot_fallback.py` (rewrite reachability assertions), `app/api/tests/test_routes_recovery.py` (update)

**Interfaces:**
- Consumes: existing `_eta_min_to_km` (already used in the endpoint at 616).
- Produces: each spot's `reachable` now means "ETA ≤ `rest_spot_eta_filter_min` (default 30.0)" — the SAME rule the trigger uses (spec §79, §82, §195, §982). Over-limit spots stay in the list but `reachable=False` (visible, disabled). `reachable_fallback` is gone. The `drowsiness_ceiling` query param and `scenario.rest_drowsiness_ceiling` are removed.

Spec §81-83: "The former projected-drowsiness reachability rule and its `rest_drowsiness_ceiling` control are removed. Spots over 30 minutes remain visible in the picker for transparency, but are disabled." §434: no separate 60-minute picker default.

- [ ] **Step 1: Write the failing tests**

In `app/api/tests/test_rest_spot_fallback.py`, replace the drowsiness-ceiling / `reachable_fallback` assertions with ETA-rule assertions. Add:

```python
def test_reachable_is_eta_within_30_min(client_with_run):
    """A spot is reachable iff its ETA <= 30 min; over-30 spots are visible+disabled."""
    run_id = client_with_run  # a run ticked a few times so prior_tick exists
    resp = client.get(f"/api/runs/{run_id}/rest-spots")
    assert resp.status_code == 200
    spots = resp.json()["rest_spots"]
    for s in spots:
        if s["eta_min"] is not None:
            assert s["reachable"] == (s["eta_min"] <= 30.0)
        assert "reachable_fallback" not in s   # removed


def test_drowsiness_ceiling_param_removed(client_with_run):
    """The drowsiness_ceiling query param no longer influences reachability."""
    run_id = client_with_run
    base = client.get(f"/api/runs/{run_id}/rest-spots").json()["rest_spots"]
    with_param = client.get(f"/api/runs/{run_id}/rest-spots?drowsiness_ceiling=0").json()["rest_spots"]
    assert [s["reachable"] for s in base] == [s["reachable"] for s in with_param]
```

In `app/api/tests/test_models.py`, add:

```python
def test_scenario_has_no_rest_drowsiness_ceiling():
    from aica_api.models.scenario import ScenarioDef
    assert "rest_drowsiness_ceiling" not in ScenarioDef.model_fields
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest app/api/tests/test_models.py::test_scenario_has_no_rest_drowsiness_ceiling app/api/tests/test_rest_spot_fallback.py -v`
Expected: FAIL — field still present; `reachable` still drowsiness-projected; `reachable_fallback` still emitted.

- [ ] **Step 3: Implement**

1. `models/scenario.py`: delete the `rest_drowsiness_ceiling` field and its comment (lines 160-169).

2. `routers/runs.py::rest_spots_endpoint`:
   - Remove the `drowsiness_ceiling: float | None = None` parameter (line 472) and its docstring bullet.
   - Delete the drowsiness growth/ceiling block (lines 520-535): no `base_growth_per_min`, no `ceiling`.
   - Resolve the shared ETA filter from the run's hyperparameters instead:

```python
    eta_filter_min = 30.0
    if scenario is not None:
        # resolved run hyperparameter wins; fall back to the manifest/30.0 default
        hp = getattr(rs, "current_hyperparameters", None) or {}
        eta_filter_min = float(hp.get("rest_spot_eta_filter_min", 30.0))
```

   - In the enrichment loop (596-635), replace the `projected_drowsiness`/`reachable` computation with the ETA rule:

```python
            eta_min = round(raw_eta, 1)
            reachable = raw_eta <= eta_filter_min   # shared 30-min actionability (spec §79/§982)
```

   - Delete the "Never strand the driver" block entirely (lines 637-647) — no `reachable_fallback`, no force-select. (A fire only occurs when a current spot is already actionable, so the picker always has a ≤30-min option after a fire.)

3. Grep the repo for other readers of `rest_drowsiness_ceiling` (`proposal_journey.py`, `maps_client.py`, `tick_engine.py`) — the earlier grep listed them; open each and remove/replace the reference. Most are comments; any code reader must switch to the ETA rule or be deleted. Do NOT leave a dangling attribute access.

- [ ] **Step 4: Run to verify pass**

Run: `pytest app/api/tests/test_rest_spot_fallback.py app/api/tests/test_routes_recovery.py app/api/tests/test_models.py -v`
Expected: PASS. Then `pytest app/api/tests/test_run_manager.py -q`.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add app/api/aica_api/routers/runs.py app/api/aica_api/models/scenario.py app/api/tests/
git commit -m "refactor(rest-picker): shared 30-min ETA actionability; remove drowsiness ceiling"
```

---

## Task 9: frontend — remove the rest-ceiling control, keep ETA-based greying

**Files:**
- Modify: `app/frontend/src/components/setup/SignalsPanel.tsx` (remove `RestCeilingEditor` import + render, line 9, 161)
- Modify: `app/frontend/src/components/merged/MergedSetupPanel.tsx` (remove `RestCeilingEditor` import + render, line 63, 1303)
- Delete: `app/frontend/src/components/setup/RestCeilingEditor.tsx`
- Modify: `app/frontend/src/api/client.ts` (remove `drowsinessCeiling` param + query, line 303)
- Test: `app/frontend/tests/recovery_picker.test.tsx` (greying now driven by `reachable` = ETA rule, not ceiling)

**Interfaces:**
- Consumes: the endpoint's `reachable` field (now ETA-based, Task 8). The picker's greying of `spot.reachable === false` (`RecoveryPicker.tsx:152`, `MergedCenterPanel.tsx:746`) is UNCHANGED — it now reflects the 30-min rule automatically.
- Produces: no `drowsiness_ceiling` request param anywhere; no ceiling editor in either setup panel.

- [ ] **Step 1: Write/adjust the failing test**

In `app/frontend/tests/recovery_picker.test.tsx`, keep the "unreachable spot is disabled" assertion but drive it from a mocked `reachable: false` spot (ETA > 30), and remove any test that sets a drowsiness ceiling. Add a guard that the ceiling editor is gone:

```tsx
test('setup panel no longer renders the rest-ceiling editor', () => {
  render(<SignalsPanel /* ...existing props... */ />)
  expect(screen.queryByTestId('rest-ceiling-editor')).toBeNull()
})
```

(Use whatever `data-testid` `RestCeilingEditor` currently exposes; if none, assert its label text is absent.)

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec frontend npm test -- recovery_picker`
Expected: FAIL — editor still rendered.

- [ ] **Step 3: Implement**

- Remove the `RestCeilingEditor` import and its `<RestCeilingEditor />` render from `SignalsPanel.tsx` and `MergedSetupPanel.tsx`.
- Delete `app/frontend/src/components/setup/RestCeilingEditor.tsx`.
- In `client.ts`, drop the `drowsinessCeiling` argument and the `params.set('drowsiness_ceiling', ...)` line from the rest-spots client function; update its callers/signature.
- Grep `app/frontend/src` for any remaining `drowsinessCeiling` / `rest_drowsiness_ceiling` / ceiling store field and remove (state in `runStore.ts`, `MergedShell.tsx`, `app.css` `.rest-ceiling*` rules, `formulationTemplates.ts` copy). Leave the `reachable` field and greying intact.

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec frontend npm test`
Expected: PASS (adjust any snapshot/test that referenced the removed editor).

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add app/frontend/
git commit -m "refactor(frontend): remove rest-ceiling control; picker greying now ETA-based"
```

---

## Task 10: invert the empty-rest end-to-end test (NRI)

**Files:**
- Modify: `app/api/tests/test_t012_rest_handling.py` (replace `TestEndToEndEmptyRestRun`, lines 393-511)

**Interfaces:**
- Consumes: the full NRI stack from Tasks 1-9 (the sentinel is no longer actionable; no routine rest fires without a real spot).
- Produces: an inverted regression that an empty-rest route completes cleanly with NO routine `REST_PROPOSAL` and no `algorithm_error`.

Spec §20.7 lists the exact replacement assertions. The old test's premise (NRI treats `9999.0` as fire) is exactly the bug this feature removes, so the test must invert — not be preserved.

- [ ] **Step 1: Rewrite the test**

Replace the entire `TestEndToEndEmptyRestRun` class (lines 393-511) with:

```python
class TestEndToEndEmptyRestRunNRI:
    """Feature nri-forecast-rest: with rest_spot_positions=[], the NRI sentinel
    (9999.0) is NOT actionable, so no routine REST_PROPOSAL ever fires — the run
    completes cleanly. This inverts the pre-feature expectation (spec §20.7)."""

    NRI_PACKAGE_ID = "nri_fatigue_score_v1"

    def test_empty_rest_run_completes_without_routine_rest_fire(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(
            mc, "_urlopen",
            _make_urlopen_seq([dir_data] + [empty_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
        )

        analyze = client.post("/api/routes/analyze", json={
            "scenario_id": VALID_SCENARIO_ID, "maps_key": _SENTINEL_KEY,
            "start": "A", "end": "B",
        })
        assert analyze.status_code == 200
        alt0 = analyze.json()["alternatives"][0]
        assert alt0["route_facts"]["rest_spot_positions"] == []
        assert "no_rest_stops_found" in alt0["notices"]

        route_facts = dict(alt0["route_facts"])
        route_facts["total_route_distance_km"] *= 3
        route_facts["estimated_route_duration_min"] *= 3

        plan = client.post("/api/run-plans", json={
            "package_id": self.NRI_PACKAGE_ID, "scenario_id": VALID_SCENARIO_ID,
            "route_id": alt0["route_id"], "route_source": "maps",
            "route_facts": route_facts, "display_route": alt0["display"],
            "parameters": {}, "hyperparameters": {},
        })
        assert plan.status_code == 201
        run = client.post("/api/runs", json={"plan_id": plan.json()["plan_id"]})
        assert run.status_code == 201
        run_id = run.json()["run_id"]

        result_types = set()
        algorithm_errors = []
        rest_paused = False
        fired_rest = False
        for _ in range(400):
            tick = client.post(f"/api/runs/{run_id}/tick")
            assert tick.status_code == 200
            body = tick.json()
            dr = body.get("decision")
            if dr is not None:
                result_types.add(dr["result_type"])
                if dr["result_type"] == "REST_PROPOSAL":
                    fired_rest = True
                # no rest candidate / overall fire-control fired
                if dr.get("fire_control", {}).get("fired") and dr["result_type"] in (
                    "REST_PROPOSAL",
                ):
                    fired_rest = True
            if body.get("error") is not None:
                algorithm_errors.append(body["error"])
            if body.get("paused"):
                # a rest-caused pause would be a REST_PROPOSAL pause
                if dr is not None and dr["result_type"] == "REST_PROPOSAL":
                    rest_paused = True
                client.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            if body.get("completed"):
                break

        assert algorithm_errors == [], algorithm_errors
        assert "REST_PROPOSAL" not in result_types, result_types
        assert not fired_rest
        assert not rest_paused
        # sentinel-not-actionable is proven by the absence of any rest fire above.
```

(Update the module `VALID_PACKAGE_ID` usage: the other classes in this file exercise the maps/notices behavior with `aica_transparent_hybrid_trigger_v1` and are unaffected — leave them. Only this class re-points to NRI, via its own `NRI_PACKAGE_ID`.)

- [ ] **Step 2: Run to verify it captures the new behavior**

Run: `pytest app/api/tests/test_t012_rest_handling.py::TestEndToEndEmptyRestRunNRI -v`
Expected: PASS once Tasks 1-8 are in (before them, it FAILS because the sentinel still fires).

- [ ] **Step 3: Commit** (only once authorized)

```bash
git add app/api/tests/test_t012_rest_handling.py
git commit -m "test(nri-forecast): invert empty-rest run — sentinel not actionable, no routine rest fire"
```

---

## Task 11: parity + regression sweep, and acceptance-criteria audit

**Files:**
- Test: run the whole backend + frontend suites; add a live↔preview parity test if none covers NRI early-fire.

**Interfaces:**
- Consumes: everything above.
- Produces: green suites (modulo the documented pre-existing failures — memory `backend-test-baseline-fixbug-0804` / `fixbug-0806-guard-test-collateral`) and a checklist mapping spec §21's 24 acceptance criteria to a passing test.

- [ ] **Step 1: Live↔preview parity for NRI early-fire**

Add `app/api/tests/test_forecast_parity.py`: run the NRI package on `uc01_fatigue_recovery_v0_1` (tripled route as in Task 10) through BOTH `run_manager` (live ticks) and `iter_preview_ticks` (quickview) with the same seed, and assert the set of fired-episode tick indices and their `result_type`/`states.rest` match. This is the guard that Task 6 and Task 7 stay identical (memory `trip-edge-guard-two-loops`).

```python
def test_live_and_preview_agree_on_forecast_fires(client, tmp_path, monkeypatch):
    # ... build the live run, tick to completion, collect fired episodes ...
    # ... run iter_preview_ticks with the same package/scenario/seed/route ...
    assert live_fire_ticks == preview_fire_ticks
    assert live_fire_types == preview_fire_types
```

- [ ] **Step 2: Full backend suite**

Run: `docker compose exec api uv run pytest` (fallback: Anaconda + `PYTHONPATH=app/api`).
Expected: the new tests pass; the ONLY failures are the documented pre-existing baseline (cp932/schema-drift/guard-collateral). Compare the failure set against memory `fixbug-0806-guard-test-collateral` — any NEW failure is a regression to fix before handoff.

- [ ] **Step 3: Full frontend suite**

Run: `docker compose exec frontend npm test`.
Expected: green after Task 9's editor removal (fix any snapshot referencing the removed control).

- [ ] **Step 4: Acceptance-criteria audit (spec §21, criteria 1-24)**

Tick each criterion against a specific test (write a one-line mapping in the PR description). Criteria and their owning test:
- 1, 14, 15 → `test_nri_fatigue_score.py` band/ordinary tests (Task 3/5)
- 2, 3, 4 → `test_nri_forecast.py` (Task 4)
- 5, 6, 7 → `test_nri_forecast.py` reason-enum tests (Task 4)
- 8, 9, 10, 11, 13 → early-fire tests (Task 5)
- 12 → destination-edge gate test (Task 2/5)
- 16 → sentinel tests (Task 3) + empty-rest (Task 10)
- 17 → skipped-tick / no-armed-fire (per-tick recompute is structural — assert via two consecutive ticks in `test_run_manager_forecast.py`)
- 18, 19 → picker tests (Task 8)
- 20-24 → error/unavailable table (`_unavailable`, Task 4) + parity (Step 1)

Any criterion with no owning test → add the test before declaring done.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add app/api/tests/test_forecast_parity.py
git commit -m "test(nri-forecast): live↔preview parity + acceptance-criteria coverage"
```

---

## Post-implementation notes (NOT part of the app/ scope)

- **htmlapp mirror** (spec §15.3) is a SEPARATE later phase, after the user reviews `app/`. Do NOT touch `htmlapp/` in this plan. When it happens, mirror `nri_forecast.ts`, the two tick loops, the ETA-only picker, and the NRI builtin — and recapture the merged goldens (memory `fixbug-0806-htmlapp-mirror`).
- **Hybrid extension** (`aica_transparent_hybrid_trigger_v1`) is also a later phase: same trigger/action/condition, only the score calculation and thresholds differ. The shared pieces (Task 2 actionability, Task 4 forecast service, Task 6/7 seams, Task 8 picker) are already package-agnostic; Hybrid adds `threshold_forecast_rest` to its own manifest and its own score→band mapping.
- **Commit discipline** (memory `fixbug-0806-commit-discipline`): do NOT commit until the user commands it; bundle as directed.
