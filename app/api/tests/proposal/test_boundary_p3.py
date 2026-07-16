"""TDD: T038 (P3 POLISH unit) — FR-021 boundary guard.

P3 (feature 014, "Editable World, Driver Profiles & Contrast") wires exactly
ONE real (non-mock) selector into STEP 2 — the transparent CONTENT selector
(``aica_transparent_content_selector_v1``, see MF2/T033-T036). FR-021
requires that P3 adds:

  - NO real SERVICE ranking — STEP 1 (``POST /api/proposal/runs``) only ever
    dispatches the MOCK service selector in this feature's scope;
  - NO motion/catalog/schedule eligibility-narrowing endpoint (a real service
    selector reasoning about vehicle motion state, catalog freshness, or
    scheduled events to narrow candidates does not exist anywhere in P3);
  - NO journey-progression endpoint (advancing ``lifecycle_stage``/
    ``motion_state`` automatically, as opposed to the reviewer editing them
    by hand in the World panel).

This is a regression guard, not new functionality: if a future unit
introduces a real service selector or any of the above endpoint families,
this test must be updated deliberately — it is not meant to silently pass
once that happens.

UPDATE (P4, feature 015 "Eligibility And Discrete Journey Engine"): P4
deliberately introduces a journey-progression endpoint
(``POST /api/proposal/runs/{run_id}/journey/action``, T012) — the very thing
this guard forbade for P3's scope. Per this module's own instruction above,
the guard below has been updated deliberately (not silently) to allow that
specific, now-in-scope endpoint family while continuing to forbid the
others (motion/catalog/schedule eligibility-narrowing endpoints, which still
do not exist as dedicated routes — eligibility narrowing rides the existing
STEP-1 ``POST /api/proposal/runs`` response per contracts/journey-api.md).

UPDATE (P4, US5, T029-T030): a second journey endpoint is deliberately
added — ``GET /api/proposal/runs/{run_id}/journey/preview`` (the read-only,
non-binding rolling-horizon preview; spec.md FR-017/SC-007). Allow-listed
below alongside ``journey/action`` for the same reason.

UPDATE (P5 Unit A, feature 016 "Transparent Service-Selector Package"): P5
deliberately introduces a REAL ``service_selector`` package
(``aica_transparent_service_selector_v1``) — the very thing FR-021 forbade
for P3's scope. Per this module's own instruction above, the guard below has
been updated deliberately (not silently): the two "no real service
selector" tests are renamed/relaxed to a closed allow-list (mocks + the two
now-known real packages) so they still catch any *unexpected* third package,
while no longer failing on the specific, intentional P5 addition. The
eligibility/journey-endpoint guard below is untouched — P5 Unit A adds no
new route surface.
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.proposal_package_registry import ProposalPackageRegistry

client = TestClient(app)

_KNOWN_MOCK_PACKAGE_IDS = {"mock_service_selector_v1", "mock_content_selector_v1"}
# P5 Unit A (feature 016): a real service_selector package now deliberately
# exists alongside the real content_selector package (P3c).
_KNOWN_REAL_PACKAGE_IDS = {"aica_transparent_content_selector_v1", "aica_transparent_service_selector_v1"}


# ---------------------------------------------------------------------------
# Only known packages are registered — no UNEXPECTED real package appears.
# ---------------------------------------------------------------------------


def test_only_known_service_selector_packages_are_registered():
    """Closed allow-list: every registered ``service_selector`` package is
    either a known mock or the known real P5 package — never a surprise
    third one (FR-021's original intent, relaxed for the deliberate P5
    addition; see module docstring UPDATE)."""
    registry = ProposalPackageRegistry(settings.packages_dir)
    service_packages = [p for p in registry.list_summaries() if p["family"] == "service_selector"]
    assert service_packages, "expected at least the mock service selector to be registered"
    known = _KNOWN_MOCK_PACKAGE_IDS | _KNOWN_REAL_PACKAGE_IDS
    for pkg in service_packages:
        assert pkg["id"] in known, (
            f"Unexpected service_selector package is registered: {pkg['id']!r}"
        )


def test_the_only_real_proposal_packages_anywhere_are_the_known_p3_and_p5_selectors():
    """Sanity: the only REAL (non-mock) proposal packages anywhere are the
    known content selector (P3c) and service selector (P5 Unit A) — never
    an unexpected third real package."""
    registry = ProposalPackageRegistry(settings.packages_dir)
    all_ids = {p["id"] for p in registry.list_summaries()}
    real_ids = all_ids - _KNOWN_MOCK_PACKAGE_IDS
    assert real_ids == _KNOWN_REAL_PACKAGE_IDS, (
        f"Unexpected real (non-mock) proposal package(s): {sorted(real_ids - _KNOWN_REAL_PACKAGE_IDS)}. "
        "Only the known content selector (P3c) and service selector (P5 Unit A) may be real."
    )


def test_step1_create_run_dispatches_the_mock_service_selector(tmp_path, monkeypatch):
    """STEP 1 (``create_proposal_run``) actually uses the mock service
    package — not a real one that shouldn't exist in P3's scope."""
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    seed_path = settings.proposal_contracts_dir / "seeds" / "seed-night-highway-oshi.json"
    world = json.loads(seed_path.read_text(encoding="utf-8"))["world"]

    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world,
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": "aica_transparent_content_selector_v1",
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-16T10:00:00Z",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["service_package_id"] == "mock_service_selector_v1"
    service_evidence = body["evidence"][0]
    assert service_evidence["step"] == "service"
    assert service_evidence["package_id"] == "mock_service_selector_v1"


# ---------------------------------------------------------------------------
# No eligibility-narrowing / journey-progression endpoints anywhere in P3.
# ---------------------------------------------------------------------------


def test_no_eligibility_narrowing_or_journey_progression_endpoints_exist():
    """FR-021: no motion/catalog/schedule eligibility-narrowing endpoint
    exists anywhere under ``/api/proposal``. Journey-progression endpoints ARE
    now permitted (P4, T012) — but ONLY the specific, known ones; any other
    "journey"/"progress"/"advance"-named route is still an unexpected
    scope-violating surface."""
    proposal_paths = sorted(
        {route.path for route in app.routes if getattr(route, "path", "").startswith("/api/proposal")}
    )

    # P4 (feature 015) deliberately-added journey endpoints (allow-listed).
    _known_journey_paths = {
        "/api/proposal/runs/{run_id}/journey/action",
        "/api/proposal/runs/{run_id}/journey/preview",
    }

    forbidden_substrings = (
        "eligibility",
        "narrow",
        "motion-state",  # a dedicated motion-eligibility endpoint, distinct from a World-panel edit
        "schedule",
        "journey",
        "progress",
        "advance",
    )
    offenders = [
        path
        for path in proposal_paths
        if path not in _known_journey_paths
        and any(term in path.replace("_", "-").lower() for term in forbidden_substrings)
    ]
    assert not offenders, f"Unexpected P3-scope-violating endpoint(s): {offenders}"

    # Sanity: the known, in-scope route surface is present (guards against a
    # vacuously-passing test from an empty/broken route list).
    assert "/api/proposal/runs" in proposal_paths
    assert "/api/proposal/runs/{run_id}/select-service" in proposal_paths
    assert "/api/proposal/worlds/validate" in proposal_paths
    assert "/api/proposal/runs/{run_id}/journey/action" in proposal_paths
    assert len(proposal_paths) >= 10
