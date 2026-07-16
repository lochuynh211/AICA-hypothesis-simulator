"""Proposal API router — /api/proposal/* (T018 skeleton).

This is the SKELETON for the Proposal Simulator surface. The real
endpoints (``GET /api/proposal/matrix``, ``GET /api/proposal/packages``,
``POST /api/proposal/runs``, ``POST /api/proposal/runs/{id}/select-service``,
``GET/DELETE /api/proposal/runs...``) are implemented in a later phase
(T020-T023 and beyond — see specs/013-proposal-p1-screen-foundation/
contracts/proposal-api.md). This module exists now so it can be mounted
additively in ``main.py`` without touching any trigger router.

Follows the same convention as the sibling trigger routers
(``routers/packages.py`` et al.): a bare ``APIRouter()`` with full-path
route decorators (no ``prefix=`` kwarg) — every route below lives under
``/api/proposal``.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/proposal/_meta")
def proposal_router_meta() -> dict:
    """Trivial marker route confirming the proposal router is mounted.

    Superseded by the real endpoints in a later phase; kept only as a
    lightweight smoke-test target for T018.
    """
    return {"router": "proposal", "status": "ok"}
