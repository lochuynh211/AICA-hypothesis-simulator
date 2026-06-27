"""AICA API — FastAPI application entry point."""

from fastapi import FastAPI

from aica_api.routers import packages, runs, scenarios

app = FastAPI()

VERSION = "0.0.0"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "aica-api", "version": VERSION}


app.include_router(packages.router)
app.include_router(scenarios.router)
app.include_router(runs.router)
