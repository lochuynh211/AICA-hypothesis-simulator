# aica-api

Backend service for the AICA Hypothesis Simulator.

## Setup

```bash
uv sync --extra dev
uv run uvicorn aica_api.main:app --host 0.0.0.0 --port 8137 --reload
```
