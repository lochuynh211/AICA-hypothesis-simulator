"""Run lifecycle router — /api/runs.

M5 additions:
  - GET  /api/runs/{id}/feedback-schema  — effective schema for the run's package.
  - POST /api/runs/{id}/feedback         — append a FeedbackEvent (schema-validated).
  - GET  /api/runs/{id}/evidence         — derive the §14.2 evidence report (T011).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
from aica_api.models.log import RunLog
from aica_api.models.profile import ProfileOverrides
from aica_api.models.run import InstantResult, RestSpot, RunStatus
from aica_api.services.evidence import build_evidence_report
from aica_api.services.evidence_markdown import render_evidence_markdown
from aica_api.services.feedback import (
    SchemaCollisionError,
    append_feedback,
    effective_schema,
    validate,
)
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.preview import PreviewValidationError, evaluate_preview
from aica_api.services.run_manager import (
    ActionNotAllowedError,
    RunNotFoundError,
    action,
    create_run,
    get_active_run_log,
    get_prior_tick_state,
    get_run,
    get_scenario,
    tick,
)

router = APIRouter()


# ── Run-ID generation (only place timestamps/randomness are allowed) ──────────


def _make_run_id() -> str:
    """Generate a unique run_id: run_<YYYYMMDD-HHMMSS>_<6-hex>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"run_{ts}_{rand}"


def _make_report_id() -> str:
    """Generate a unique report_id: report_<YYYYMMDD-HHMMSS>_<6-hex>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"report_{ts}_{rand}"


# ── Request body models ───────────────────────────────────────────────────────


class CreateRunBody(BaseModel):
    plan_id: str


class PreviewRunBody(BaseModel):
    """RunConfig for POST /runs/preview (contracts/ephemeral-evaluate.md).

    UX-BE (feature 009 UX iteration): ``profiles`` and ``context_overrides``
    are the SAME shape accepted by ``CreateRunPlanBody`` (routers/run_plans.py)
    — a preview computed with the same overrides as a subsequent "Open full
    run" (``POST /api/run-plans`` with matching ``profiles``/
    ``context_overrides``) is faithful to it:

      profiles.driver / profiles.anomaly — partial DriverSignalParams /
        AnomalySignalParams overrides, deep-merged onto the scenario's values
        (same as a real run's profile override).
      context_overrides — {"child_passenger": bool, "familiar_route": bool,
        "weather_risk": float in [0, 100]}.

    Both are optional and default to no override (unchanged preview behavior
    when omitted).
    """

    package_id: str
    scenario_id: str
    hyperparameter_overrides: dict[str, Any] = {}
    run_seed: int
    rest_option_id: str | None = None
    profiles: ProfileOverrides | None = None
    context_overrides: dict[str, Any] | None = None
    # UX fix: the selected Maps/preset route (same optional fields as
    # CreateRunPlanBody). When route_source=="maps" the preview runs against the
    # chosen route (distance/duration/segments/rest spots) instead of re-deriving
    # the scenario's default local route. Omitted/local → unchanged behavior.
    route_id: str | None = None
    route_source: str = "local"
    route_facts: Any = None
    display_route: Any = None


class ActionBody(BaseModel):
    action: str
    recovery_option_id: str | None = None
    rest_spot: RestSpot | None = None


class FeedbackBody(BaseModel):
    """POST body for /api/runs/{id}/feedback."""

    target: FeedbackTarget
    labels: dict[str, Any] = {}
    comment: str | None = None


# ── Private helpers ───────────────────────────────────────────────────────────


def _resolve_run_log(run_id: str) -> RunLog:
    """Return the RunLog for run_id (active → recorder; inactive → disk).

    Resolution order:
    1. Active run in the in-memory registry → recorder's run_log.
    2. On-disk run (runs/{run_id}.json) → parsed RunLog.
    3. Neither → raise 404 HTTPException.
    """
    # Try active first (no disk I/O)
    log = get_active_run_log(run_id)
    if log is not None:
        return log
    # Try disk
    log_path = settings.runs_dir / f"{run_id}.json"
    if log_path.exists():
        data = json.loads(log_path.read_text(encoding="utf-8"))
        return RunLog(**data)
    raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")


def _resolve_event_ref(target: FeedbackTarget, run_log: RunLog) -> FeedbackTarget:
    """Resolve event_ref when the frontend submits a human anchor without it.

    If event_ref is already set, return target unchanged.
    Otherwise, search run_log.events for the matching event by scope rules:
      - scope="run"      → no event_ref needed; return unchanged.
      - scope="decision" → find TickEvent whose tick_index matches target.tick_index.
      - scope="proposal" → same as decision but the tick must have fire_control.fired=True
                           and proposal is not None.
      - scope="action"   → find ActionEvent matching target.tick_index + target.action.

    Raises HTTPException(400) when not found or ambiguous.
    """
    scope = target.scope

    if scope == "run":
        return target  # no event_ref required

    if target.event_ref is not None:
        return target  # already provided — use as-is

    tick_index = target.tick_index
    action_str = target.action

    events = run_log.events

    if scope in ("decision", "proposal"):
        if tick_index is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"target.tick_index is required for scope={scope!r} "
                    "when event_ref is not provided."
                ),
            )
        # Find TickEvents matching the tick_index
        matches = [
            i for i, e in enumerate(events)
            if e.kind == "tick" and e.tick_index == tick_index
        ]
        if scope == "proposal":
            # Additionally filter to ticks that fired a proposal
            matches = [
                i for i in matches
                if (
                    events[i].trace.decision_result.fire_control.fired
                    and events[i].trace.decision_result.proposal is not None
                )
            ]
        if len(matches) == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No {scope} event found for tick_index={tick_index} in the run log."
                ),
            )
        if len(matches) > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ambiguous: {len(matches)} {scope} events found "
                    f"for tick_index={tick_index}."
                ),
            )
        return target.model_copy(update={"event_ref": matches[0]})

    elif scope == "action":
        if tick_index is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "target.tick_index is required for scope='action' "
                    "when event_ref is not provided."
                ),
            )
        if action_str is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "target.action is required for scope='action' "
                    "when event_ref is not provided."
                ),
            )
        matches = [
            i for i, e in enumerate(events)
            if (
                e.kind == "action"
                and e.tick_index == tick_index
                and e.action == action_str
            )
        ]
        if len(matches) == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No action event found for tick_index={tick_index}"
                    + (f", action={action_str!r}" if action_str else "")
                    + " in the run log."
                ),
            )
        if len(matches) > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ambiguous: {len(matches)} action events found "
                    f"for tick_index={tick_index}."
                ),
            )
        return target.model_copy(update={"event_ref": matches[0]})

    # Unknown scope — let validate() catch it
    return target


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/api/runs", status_code=201)
def create_run_endpoint(body: CreateRunBody):
    """Freeze draft plan, create run, return 201 RunState. 400 for unknown plan_id."""
    from aica_api.services.run_plan import get_draft_entry
    if get_draft_entry(body.plan_id) is None:
        raise HTTPException(
            status_code=400,
            detail=f"Run plan {body.plan_id!r} not found or expired",
        )

    run_id = _make_run_id()
    try:
        run_state = create_run(body.plan_id, run_id, settings.runs_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return run_state


@router.post("/api/runs/preview", response_model=InstantResult)
def preview_run_endpoint(body: PreviewRunBody):
    """Ephemeral, non-persisting instant-result preview (feature 009, US1).

    Runs the full tick loop for the given RunConfig through the SAME tick
    engine + algorithm adapter as a persisted run (see services/preview.py),
    but writes NOTHING to runs/ — the EvidenceRecorder is never invoked.

    400 for an unknown/incompatible package or scenario, an old-shape
    scenario (FR-017), invalid hyperparameter overrides, invalid profile
    overrides, or invalid context overrides.
    """
    # Convert typed ProfileOverrides to a plain dict for the service layer
    # (exclude_none so absent sub-objects are not passed as None entries) —
    # identical conversion to routers/run_plans.py's CreateRunPlanBody.profiles.
    profiles_dict: dict[str, Any] | None = (
        body.profiles.model_dump(exclude_none=True) if body.profiles else None
    )
    try:
        result = evaluate_preview(
            package_id=body.package_id,
            scenario_id=body.scenario_id,
            hyperparameter_overrides=body.hyperparameter_overrides,
            run_seed=body.run_seed,
            rest_option_id=body.rest_option_id,
            packages_dir=settings.packages_dir,
            scenarios_dir=settings.scenarios_dir,
            profiles=profiles_dict,
            context_overrides=body.context_overrides,
            route_source=body.route_source,
            route_facts=body.route_facts,
            display_route=body.display_route,
        )
    except PreviewValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.post("/api/runs/{run_id}/tick")
def tick_endpoint(run_id: str):
    """Advance one simulation tick; 404 for unknown run."""
    try:
        outcome = tick(run_id)
    except RunNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")

    # Authoritative display position from the evaluated TickState (speed-integrated
    # route_fraction + current speed), so the UI never re-derives position.
    ts = outcome.tick_state
    route_fraction = ts.route_fraction if ts is not None else None
    distance_km = ts.distance_km if ts is not None else None
    # Collapse tiered signals once — guards both the None-ts and missing-key cases.
    # Feature 009: raw_state was replaced by tiered signals {fixed, dynamic, simulated};
    # the per-tick display fields below live in the "dynamic" tier.
    signals = (ts.signals or {}) if ts is not None else {}
    dynamic = signals.get("dynamic", {})
    speed_kph = dynamic.get("speedKph")
    motion_state = dynamic.get("motionState")
    recovery_phase = dynamic.get("recoveryPhase")
    active_content = dynamic.get("activeContent")
    is_traffic_jam = dynamic.get("isTrafficJam")
    segment_type = dynamic.get("segmentType")

    if outcome.algorithm_error is not None:
        return {
            "run_state": outcome.run_state,
            "error": outcome.algorithm_error,
            "paused": outcome.paused,
            "tick_index": outcome.evaluated_tick_index,
            "route_fraction": route_fraction,
            "distance_km": distance_km,
            "speed_kph": speed_kph,
            "motion_state": motion_state,
            "recovery_phase": recovery_phase,
            "active_content": active_content,
            "is_traffic_jam": is_traffic_jam,
            "segment_type": segment_type,
        }
    return {
        "run_state": outcome.run_state,
        "decision": outcome.decision,
        "paused": outcome.paused,
        "completed": outcome.completed,
        "tick_index": outcome.evaluated_tick_index,
        "route_fraction": route_fraction,
        "distance_km": distance_km,
        "speed_kph": speed_kph,
        "motion_state": motion_state,
        "recovery_phase": recovery_phase,
        "active_content": active_content,
        "is_traffic_jam": is_traffic_jam,
        "segment_type": segment_type,
    }


@router.post("/api/runs/{run_id}/actions")
def action_endpoint(run_id: str, body: ActionBody):
    """Apply a driver action; 409 if no proposal pending, 400 if disallowed, 404 if unknown."""
    run_state = get_run(run_id)
    if run_state is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")

    if run_state.status != RunStatus.paused or run_state.pending_proposal is None:
        raise HTTPException(status_code=409, detail="No pending proposal")

    try:
        updated = action(run_id, body.action,
                         recovery_option_id=body.recovery_option_id,
                         rest_spot=body.rest_spot)
    except RunNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    except ActionNotAllowedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return updated


@router.get("/api/runs")
def list_runs_endpoint():
    """List all runs from the runs directory (combines disk + in-memory status)."""
    runs_dir = settings.runs_dir
    items = []
    if not runs_dir.exists():
        return {"runs": items}

    for path in sorted(runs_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        run_id = data.get("run_id", path.stem)

        # Prefer in-memory status for currently active runs
        rs = get_run(run_id)
        if rs is not None:
            status = rs.status.value
        else:
            # Derive status from the persisted event log
            events = data.get("events", [])
            action_events = [e for e in events if e.get("kind") == "action"]
            if action_events:
                status = action_events[-1].get("resulting_status", "playing")
            elif events:
                status = "playing"
            else:
                status = "created"

        items.append(
            {
                "run_id": run_id,
                "created_at": data.get("created_at", ""),
                "package_id": data.get("snapshot", {}).get("package", {}).get("id", ""),
                "scenario_id": data.get("snapshot", {}).get("scenario", {}).get("id", ""),
                "status": status,
            }
        )

    return {"runs": items}


@router.get("/api/runs/{run_id}")
def get_run_endpoint(run_id: str):
    """Return current RunState; 404 for unknown run."""
    rs = get_run(run_id)
    if rs is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    return rs


_REST_SPOTS_MAX = 5
_REST_SPOTS_DEFAULT_MIN_DISTANCE_KM = 20.0


@router.get("/api/runs/{run_id}/rest-spots")
def rest_spots_endpoint(
    run_id: str,
    maps_key: str | None = None,
    drowsiness_ceiling: float | None = None,
    min_distance_km: float | None = None,
):
    """Return candidate rest stops for a run, enriched with distance/ETA/reachability.

    Candidate selection (M8):
      1. Source: named_rest_spots when non-empty (real facility names from Places
         or local scenario); else rest_spot_positions with generic labels.
      2. Filter: only spots strictly AHEAD of the current driving position.
      3. Sort: ascending by position_km.
      4. Space: greedy walk — take a spot, then skip any within min_distance_km
         of the last taken spot.  Default spacing = 20 km.
      5. Cap: at most 5 spots returned.

    Enrichment per spot:
      distance_km — from current position (rounded to 1 dp).
      eta_min     — minutes to reach at current speed; None when speed ≤ 0.
      reachable   — False when projected drowsiness on arrival exceeds the
                    effective ceiling.  Projection = current_drowsiness +
                    base_growth_per_min × eta_min (linear approximation;
                    omits night/monotony/traffic multipliers by design).

    Query params:
      drowsiness_ceiling — overrides scenario.rest_drowsiness_ceiling.
      min_distance_km    — minimum spacing between returned spots (default 20).
      maps_key           — not yet wired; key stays in-memory only and is never
                           persisted or logged (maps-key-never-persisted constraint).

    404 if run_id is unknown.
    """
    rs = get_run(run_id)
    if rs is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")

    total_km = rs.route_facts.total_route_distance_km or 120.0

    # ── Current driving state from prior tick (zero-defaults if no tick yet) ─
    prior_tick = get_prior_tick_state(run_id)
    if prior_tick is not None:
        current_distance_km = prior_tick.distance_km or 0.0
        signals = prior_tick.signals or {}
        current_drowsiness = float(signals.get("simulated", {}).get("drowsiness", 0.0))
        current_speed_kph = float(signals.get("dynamic", {}).get("speedKph", 0.0))
    else:
        current_distance_km = 0.0
        current_drowsiness = 0.0
        current_speed_kph = 0.0

    # ── Drowsiness growth rate and safety ceiling from scenario ───────────────
    # Growth projection uses base_growth_per_min only — a simple linear model
    # that omits night/monotony/traffic multipliers (agreed approximation for
    # reachability estimates).  See scenario.rest_drowsiness_ceiling for ceiling.
    #
    # REST-SPOT reachability ceiling — independent of the algorithm's trigger
    # threshold.  A ceiling above 100 lets the driver "overload" (reach a distant
    # spot even with high drowsiness).  The query param drowsiness_ceiling
    # (if provided) overrides the scenario default.
    scenario = get_scenario(run_id)
    if scenario is not None and scenario.driver_signal_params is not None:
        base_growth_per_min = scenario.driver_signal_params.drowsiness_model.base_growth_per_min
        ceiling = drowsiness_ceiling if drowsiness_ceiling is not None else scenario.rest_drowsiness_ceiling
    else:
        base_growth_per_min = 0.0
        ceiling = drowsiness_ceiling if drowsiness_ceiling is not None else 100.0

    # ── Minimum spacing between returned spots ────────────────────────────────
    effective_min_distance_km = (
        min_distance_km if min_distance_km is not None else _REST_SPOTS_DEFAULT_MIN_DISTANCE_KM
    )

    # ── Build candidate list (named when available, else generic) ─────────────
    # Each candidate: (position_km, name)
    # Synthetic spots (fabricated by _scale_scenario_rest_positions) are excluded
    # from the picker — they are internal route-analysis artefacts, not real facilities.
    named = rs.route_facts.named_rest_spots
    if named:
        real_named = [s for s in named if not s.synthetic]
        if real_named:
            candidates = [(s.position_km, s.name) for s in real_named]
        else:
            candidates = []
    else:
        candidates = [
            (pos_km, f"Rest stop {i + 1}")
            for i, pos_km in enumerate(rs.route_facts.rest_spot_positions)
        ]

    # ── Filter to spots strictly ahead of the current position ───────────────
    ahead = [(pos_km, name) for pos_km, name in candidates if pos_km > current_distance_km]

    # ── Sort ascending by position_km ─────────────────────────────────────────
    ahead.sort(key=lambda t: t[0])

    # ── Greedy spacing filter ─────────────────────────────────────────────────
    spaced: list[tuple[float, str]] = []
    last_taken_km: float | None = None
    for pos_km, name in ahead:
        if last_taken_km is None or (pos_km - last_taken_km) >= effective_min_distance_km:
            spaced.append((pos_km, name))
            last_taken_km = pos_km
            if len(spaced) >= _REST_SPOTS_MAX:
                break

    # ── Enrich each selected candidate ───────────────────────────────────────
    spots = []
    for i, (pos_km, name) in enumerate(spaced):
        route_fraction = min(1.0, pos_km / total_km)
        spot_distance_km = round(max(0.0, pos_km - current_distance_km), 1)

        if current_speed_kph <= 0:
            # Guard divide-by-zero: speed unknown → ETA unknown, unreachable
            eta_min: float | None = None
            reachable = False
        else:
            raw_eta = (spot_distance_km / current_speed_kph) * 60.0
            eta_min = round(raw_eta, 1)
            projected_drowsiness = current_drowsiness + base_growth_per_min * raw_eta
            reachable = projected_drowsiness <= ceiling

        spots.append({
            "id": f"rest_{i}",
            "label": {"ja": name, "en": name},
            "route_fraction": route_fraction,
            "distance_km": spot_distance_km,
            "eta_min": eta_min,
            "reachable": reachable,
        })

    # ── Never strand the driver ───────────────────────────────────────────────
    # The ceiling exists to rule out spots the driver cannot safely REACH. Once
    # current drowsiness is already at or above it, every projection fails (even
    # a zero-minute ETA), so the whole list comes back unreachable and the driver
    # can only decline — the outcome the ceiling was meant to prevent. When
    # nothing qualifies, keep the CLOSEST spot selectable: it is strictly the
    # best available choice, and stopping slightly past the ceiling beats not
    # stopping at all. `spots` is ordered ascending by position, so [0] is nearest.
    if spots and not any(s["reachable"] for s in spots):
        spots[0]["reachable"] = True
        spots[0]["reachable_fallback"] = True

    # (When maps_key is present, replace `spots` with Places results via the
    #  routes.py Places helper; key stays in-memory, never persisted or logged.)
    notice = "no_rest_stops_found" if not spots else None
    return {"rest_spots": spots, "notice": notice}


@router.get("/api/runs/{run_id}/log")
def get_run_log(run_id: str):
    """Return the persisted RunLog JSON exactly as stored on disk; 404 if not found."""
    log_path = settings.runs_dir / f"{run_id}.json"
    if not log_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Run log for {run_id!r} not found"
        )
    return json.loads(log_path.read_text(encoding="utf-8"))


# ── M5 Feedback endpoints ──────────────────────────────────────────────────────


@router.get("/api/runs/{run_id}/feedback-schema")
def get_feedback_schema(run_id: str):
    """Return the effective feedback schema for the run's package.

    Works for active (in-memory) and completed (on-disk) runs.
    The schema is V1_FEEDBACK_SCHEMA ∪ the package's extra feedback_schema fields.

    404: run not found.
    422: package not found in registry or malformed feedback_schema (collision).
    """
    run_log = _resolve_run_log(run_id)
    package_id = run_log.snapshot.package.id

    pkg = PackageRegistry(settings.packages_dir).get(package_id)
    if pkg is None:
        raise HTTPException(
            status_code=422,
            detail=f"Package {package_id!r} for run {run_id!r} not found in registry.",
        )

    try:
        schema = effective_schema(pkg)
    except SchemaCollisionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {"fields": [f.model_dump() for f in schema]}


@router.post("/api/runs/{run_id}/feedback", status_code=201)
def post_feedback(run_id: str, body: FeedbackBody):
    """Append a reviewer FeedbackEvent to the run log.

    1. Resolve the run log (active → recorder; inactive → disk; 404 if neither).
    2. Resolve event_ref from the human anchor (tick_index / action) if not provided.
    3. Get effective schema from the run's package.
    4. Validate labels + target.  400 with validation_errors on failure; nothing appended.
    5. Build and append FeedbackEvent.  Return 201 with the appended event.

    The FeedbackEvent is evidence-only — it NEVER alters any prior event, decision,
    or algorithm result.
    """
    # ── 1. Resolve run log ─────────────────────────────────────────────────────
    run_log = _resolve_run_log(run_id)

    # ── 2. Resolve event_ref from human anchor ────────────────────────────────
    resolved_target = _resolve_event_ref(body.target, run_log)

    # ── 3. Effective schema ───────────────────────────────────────────────────
    package_id = run_log.snapshot.package.id
    pkg = PackageRegistry(settings.packages_dir).get(package_id)
    if pkg is None:
        raise HTTPException(
            status_code=422,
            detail=f"Package {package_id!r} for run {run_id!r} not found in registry.",
        )
    try:
        schema = effective_schema(pkg)
    except SchemaCollisionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── 4. Build event + validate ─────────────────────────────────────────────
    event = FeedbackEvent(
        kind="feedback",
        target=resolved_target,
        labels=body.labels,
        comment=body.comment,
    )
    errors = validate(event, schema, run_log)
    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "validation_errors": [
                    {"field": e.field, "message": e.message} for e in errors
                ]
            },
        )

    # ── 5. Append ─────────────────────────────────────────────────────────────
    try:
        append_feedback(run_id, event, settings.runs_dir)
    except RunNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")

    return event.model_dump()


# ── M5 Evidence export endpoint ────────────────────────────────────────────────


@router.get("/api/runs/{run_id}/evidence")
def get_evidence(
    run_id: str,
    ui_language: str = Query(default="bilingual", alias="ui_language"),
):
    """Derive and return the §14.2 evidence report for a run (active or on-disk).

    The report is a derived view — it is NOT persisted.  report_id and timestamp
    are generated at this router boundary (the project's timestamp/uuid discipline).

    Separation invariant: FeedbackEvents appear ONLY under human_review;
    simulator_facts NEVER contains a feedback value.

    Query params:
        ui_language: The reviewer's selected UI language at export time (e.g.
                     ``"ja"``, ``"en"``).  Defaults to ``"bilingual"`` when
                     absent (back-compat with pre-M6 callers).

    404: run not found (active or on-disk).
    """
    run_log = _resolve_run_log(run_id)

    # Generate report_id + timestamp at the router boundary (not inside the pure fn)
    report_id = _make_report_id()
    timestamp = datetime.now(timezone.utc).isoformat()

    return build_evidence_report(
        run_log,
        report_id=report_id,
        timestamp=timestamp,
        ui_language=ui_language,
    )


# ── S8 Markdown evidence export (T012) ────────────────────────────────────────


@router.get("/api/runs/{run_id}/evidence.md")
def get_evidence_markdown(
    run_id: str,
    ui_language: str = Query(default="bilingual", alias="ui_language"),
):
    """Derive the §14.2 evidence report and return it as human-readable Markdown.

    Calls build_evidence_report (same facts as the JSON evidence endpoint) then
    render_evidence_markdown — no divergent computation.

    Separation invariant preserved: FeedbackEvents appear ONLY under
    ## Human Review; ## Simulator Facts NEVER contains feedback values.
    NEVER a verdict: the Markdown presents objective facts and, separately,
    the human's recorded feedback.

    Query params:
        ui_language: The reviewer's selected UI language at export time
                     (e.g. ``"ja"``, ``"en"``).  Defaults to ``"bilingual"``.

    Returns:
        text/markdown response containing the rendered Markdown document.

    404: run not found (active or on-disk).
    """
    run_log = _resolve_run_log(run_id)

    # Generate report_id + timestamp at the router boundary (pure-function discipline)
    report_id = _make_report_id()
    timestamp = datetime.now(timezone.utc).isoformat()

    report = build_evidence_report(
        run_log,
        report_id=report_id,
        timestamp=timestamp,
        ui_language=ui_language,
    )
    md_text = render_evidence_markdown(report)
    return Response(content=md_text, media_type="text/markdown; charset=utf-8")
