"""AICA API — FastAPI application entry point."""

from fastapi import FastAPI

app = FastAPI()

VERSION = "0.0.0"


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "aica-api", "version": VERSION}
