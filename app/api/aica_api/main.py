"""AICA API — FastAPI application entry point."""

from fastapi import FastAPI

from aica_api.routers import packages, run_plans, runs, scenarios
from aica_api.routers import routes as routes_router

app = FastAPI()

VERSION = "0.0.0"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "aica-api", "version": VERSION}


app.include_router(packages.router)
app.include_router(scenarios.router)
app.include_router(routes_router.router)
app.include_router(run_plans.router)
app.include_router(runs.router)
