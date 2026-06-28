"""Run lifecycle router — /api/runs.

M5 additions:
  - GET  /api/runs/{id}/feedback-schema  — effective schema for the run's package.
  - POST /api/runs/{id}/feedback         — append a FeedbackEvent (schema-validated).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
from aica_api.models.log import RunLog
from aica_api.models.run import RunStatus
from aica_api.services.feedback import (
    SchemaCollisionError,
    append_feedback,
    effective_schema,
    validate,
)
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_manager import (
    ActionNotAllowedError,
    RunNotFoundError,
    action,
    create_run,
    get_active_run_log,
    get_run,
    tick,
)

router = APIRouter()


# ── Run-ID generation (only place timestamps/randomness are allowed) ──────────


def _make_run_id() -> str:
    """Generate a unique run_id: run_<YYYYMMDD-HHMMSS>_<6-hex>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"run_{ts}_{rand}"


# ── Request body models ───────────────────────────────────────────────────────


class CreateRunBody(BaseModel):
    plan_id: str


class ActionBody(BaseModel):
    action: str


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


@router.post("/api/runs/{run_id}/tick")
def tick_endpoint(run_id: str):
    """Advance one simulation tick; 404 for unknown run."""
    try:
        outcome = tick(run_id)
    except RunNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")

    if outcome.algorithm_error is not None:
        return {
            "run_state": outcome.run_state,
            "error": outcome.algorithm_error,
            "paused": outcome.paused,
            "tick_index": outcome.evaluated_tick_index,
        }
    return {
        "run_state": outcome.run_state,
        "decision": outcome.decision,
        "paused": outcome.paused,
        "completed": outcome.completed,
        "tick_index": outcome.evaluated_tick_index,
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
        updated = action(run_id, body.action)
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
