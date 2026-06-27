"""Run lifecycle router — /api/runs."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.models.run import RunStatus
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_manager import (
    ActionNotAllowedError,
    RunNotFoundError,
    action,
    create_run,
    get_run,
    tick,
)
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


# ── Run-ID generation (only place timestamps/randomness are allowed) ──────────


def _make_run_id() -> str:
    """Generate a unique run_id: run_<YYYYMMDD-HHMMSS>_<6-hex>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"run_{ts}_{rand}"


# ── Request body models ───────────────────────────────────────────────────────


class CreateRunBody(BaseModel):
    package_id: str
    scenario_id: str


class ActionBody(BaseModel):
    action: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/api/runs", status_code=201)
def create_run_endpoint(body: CreateRunBody):
    """Validate compatibility, generate run_id, initialise the run, return 201 RunState."""
    pkg_reg = PackageRegistry(settings.packages_dir)
    sc_reg = ScenarioRegistry(settings.scenarios_dir)

    package = pkg_reg.get(body.package_id)
    if package is None:
        raise HTTPException(
            status_code=400,
            detail=f"Package {body.package_id!r} not found or invalid",
        )

    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )

    if not pkg_reg.is_compatible(package, scenario):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Package {body.package_id!r} is not compatible with "
                f"scenario {body.scenario_id!r} (type={scenario.type!r})"
            ),
        )

    run_id = _make_run_id()
    run_state = create_run(package, scenario, run_id, settings.runs_dir)
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
            "paused": False,
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
