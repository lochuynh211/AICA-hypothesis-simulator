"""Capture a golden RPC op-transcript from the Python backend via FastAPI TestClient.

Run from repo root:
  PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_transcript.py
No docker required; uses the in-process ASGI app.
"""
import json
import pathlib

from fastapi.testclient import TestClient

from aica_api.main import app  # adjust if the app object lives elsewhere

OUT = (
    pathlib.Path(__file__).resolve().parents[2]
    / "src/engine/__fixtures__/transcripts/trigger_nri_session.json"
)
PKG = "nri_fatigue_score_v1"
SCN = "uc01_fatigue_recovery_v0_1"


def main() -> None:
    c = TestClient(app)
    steps = []

    def rec(op, params, resp):
        steps.append({"op": op, "params": params, "response": resp.json()})

    # create-plan (Python API returns 201 Created)
    plan = c.post("/api/run-plans", json={"package_id": PKG, "scenario_id": SCN})
    assert plan.status_code in (200, 201), f"run-plans failed: {plan.status_code} {plan.text}"
    rec("runPlans.create", {"package_id": PKG, "scenario_id": SCN}, plan)
    plan_id = plan.json()["plan_id"]

    # create-run
    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code} {run.text}"
    rec("runs.create", {"plan_id": plan_id}, run)
    run_id = run.json()["run_id"]

    # tick loop
    accepted = False
    for _ in range(400):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code} {t.text}"
        rec("runs.tick", {"run_id": run_id}, t)
        body = t.json()
        if body.get("completed"):
            break
        if body.get("paused") and not accepted:
            act_body = {
                "action": "accept_rest",
                "recovery_option_id": "nap_karaoke",
                "rest_spot": {
                    "id": "p1",
                    "label": {"ja": "SA", "en": "SA"},
                    "lat": None,
                    "lng": None,
                    "route_fraction": 0.5,
                },
            }
            a = c.post(f"/api/runs/{run_id}/actions", json=act_body)
            assert a.status_code == 200, f"accept_rest failed: {a.status_code} {a.text}"
            # Include full body params so the replay test can pass them through
            rec("runs.act", {"run_id": run_id, **act_body}, a)
            accepted = True
        elif body.get("paused"):
            act_body = {"action": "decline"}
            a = c.post(f"/api/runs/{run_id}/actions", json=act_body)
            assert a.status_code == 200, f"decline failed: {a.status_code} {a.text}"
            rec("runs.act", {"run_id": run_id, **act_body}, a)

    assert accepted, "No accept_rest action was recorded — run did not produce a REST_PROPOSAL"
    assert steps[-1]["op"] == "runs.tick" and steps[-1]["response"].get("completed"), (
        "Last step is not a completed tick — run did not finish"
    )

    # log
    log = c.get(f"/api/runs/{run_id}/log")
    assert log.status_code == 200, f"log failed: {log.status_code} {log.text}"
    rec("runs.log", {"run_id": run_id}, log)

    # evidence
    ev = c.get(f"/api/runs/{run_id}/evidence")
    assert ev.status_code == 200, f"evidence failed: {ev.status_code} {ev.text}"
    rec("evidence.get", {"run_id": run_id}, ev)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"meta": {"package": PKG, "scenario": SCN}, "steps": steps}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    tick_steps = [s for s in steps if s["op"] == "runs.tick"]
    act_steps = [s for s in steps if s["op"] == "runs.act"]
    print(f"wrote {OUT}")
    print(f"  {len(steps)} total steps: {len(tick_steps)} ticks, {len(act_steps)} actions")
    print(f"  last tick completed: {steps[-3]['response'].get('completed')}")


if __name__ == "__main__":
    main()
