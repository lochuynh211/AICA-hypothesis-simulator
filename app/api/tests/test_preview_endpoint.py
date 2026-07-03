"""Contract tests for POST /api/runs/preview (feature 009, US1).

Ephemeral instant-result preview endpoint — see
specs/009-signal-tier-redesign/contracts/ephemeral-evaluate.md for the full
contract. This file covers exactly the six required tests listed there:

1. Returns an InstantResult; runs/ file count is unchanged before/after (no
   persistence).
2. Same RunConfig (incl. run_seed) twice -> byte-identical InstantResult.
3. /preview fire tick == the fire tick of a persisted POST /runs with the
   same config (faithfulness).
4. Overrides list contains exactly the changed-from-default keys with
   correct default/value pairs.
5. A package that raises in evaluate() -> error populated, fired not
   fabricated.
6. Old-shape scenario -> rejected with a clear error (no partial preview).

Also covers a whole-branch-review fix: POST /api/run-plans now accepts an
explicit run_seed and threads it into the persisted run (previously it was
silently dropped in favor of scenario.run_seed_default) — see
test_create_run_plan_explicit_run_seed_threads_into_persisted_run below.
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_HYBRID_PKG_ID = "aica_transparent_hybrid_trigger_v1"
_NRI_PKG_ID = "nri_fatigue_score_v1"


@pytest.fixture(autouse=True)
def reset_registries():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def _preview_body(package_id=_HYBRID_PKG_ID, scenario_id=_SCENARIO_ID, run_seed=42, overrides=None, rest_option_id=None):
    return {
        "package_id": package_id,
        "scenario_id": scenario_id,
        "hyperparameter_overrides": overrides or {},
        "run_seed": run_seed,
        "rest_option_id": rest_option_id,
    }


# ---------------------------------------------------------------------------
# 1 — Returns an InstantResult; runs/ untouched.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("package_id", [_HYBRID_PKG_ID, _NRI_PKG_ID])
def test_preview_returns_instant_result_and_does_not_persist(package_id, monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    before = sorted(p.name for p in tmp_path.glob("*.json"))

    resp = client.post("/api/runs/preview", json=_preview_body(package_id=package_id))

    assert resp.status_code == 200, resp.text
    body = resp.json()

    # InstantResult shape (data-model.md §7).
    for key in (
        "fired", "fire", "peak_score", "threshold", "score_series", "segments",
        "rest_spot", "rest_option", "completed_min", "seed", "overrides", "error",
    ):
        assert key in body, f"InstantResult missing key {key!r}"

    assert body["fired"] is True
    assert body["fire"] is not None
    assert body["fire"]["category"] == "rest_required"
    assert isinstance(body["score_series"], list) and len(body["score_series"]) > 0
    assert body["seed"] == 42
    assert body["error"] is None
    assert body["completed_min"] is not None

    after = sorted(p.name for p in tmp_path.glob("*.json"))
    assert before == after == [], "runs/ must be unchanged (empty) after a /preview call"


# ---------------------------------------------------------------------------
# 2 — Determinism: identical RunConfig twice -> byte-identical InstantResult.
# ---------------------------------------------------------------------------


def test_preview_is_deterministic_for_same_run_config(monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    body = _preview_body(overrides={"w_drowsiness": 0.45})

    resp1 = client.post("/api/runs/preview", json=body)
    assert resp1.status_code == 200, resp1.text
    resp2 = client.post("/api/runs/preview", json=body)
    assert resp2.status_code == 200, resp2.text

    assert resp1.content == resp2.content, "same RunConfig must produce a byte-identical response"


# ---------------------------------------------------------------------------
# 3 — Faithfulness: preview fire tick == persisted run fire tick (same config).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("package_id", [_HYBRID_PKG_ID, _NRI_PKG_ID])
def test_preview_fire_tick_matches_persisted_run(package_id, monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # ── Persisted run: create plan -> run -> tick to the first pause ────────
    plan_resp = client.post(
        "/api/run-plans", json={"package_id": package_id, "scenario_id": _SCENARIO_ID}
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, run_resp.text
    run_id = run_resp.json()["run_id"]

    persisted_fire_tick = None
    for _ in range(400):
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200, tick_resp.text
        tbody = tick_resp.json()
        if tbody.get("paused"):
            persisted_fire_tick = tbody["tick_index"]
            break
        if tbody.get("completed"):
            break

    assert persisted_fire_tick is not None, "expected the persisted run to pause on a fired proposal"

    # ── Preview with the SAME config (scenario.run_seed_default == 42) ─────
    clear_registry()
    clear_draft_registry()
    preview_resp = client.post("/api/runs/preview", json=_preview_body(package_id=package_id))
    assert preview_resp.status_code == 200, preview_resp.text
    preview_body = preview_resp.json()

    assert preview_body["fired"] is True
    assert preview_body["fire"]["tick"] == persisted_fire_tick, (
        f"{package_id}: preview fire tick {preview_body['fire']['tick']} != "
        f"persisted run fire tick {persisted_fire_tick}"
    )


# ---------------------------------------------------------------------------
# 3b — Fix (whole-branch review): explicit run_seed threads through
#      POST /api/run-plans into the PERSISTED run, matching a /preview with
#      the same seed, and differing from the default-seed run. Before the
#      fix, CreateRunPlanBody had no run_seed field at all, so a re-rolled
#      seed silently persisted under scenario.run_seed_default (42) instead.
# ---------------------------------------------------------------------------


def test_create_run_plan_explicit_run_seed_threads_into_persisted_run(monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)
    package_id = _HYBRID_PKG_ID
    explicit_seed = 999  # non-default; scenario.run_seed_default == 42

    def _run_to_first_pause_or_completion(run_id: str) -> dict:
        for _ in range(400):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200, tick_resp.text
            tbody = tick_resp.json()
            if tbody.get("paused") or tbody.get("completed"):
                return tbody
        raise AssertionError("run did not pause or complete within 400 ticks")

    # ── Persisted run created with an EXPLICIT non-default run_seed ────────
    plan_resp = client.post(
        "/api/run-plans",
        json={"package_id": package_id, "scenario_id": _SCENARIO_ID, "run_seed": explicit_seed},
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, run_resp.text
    run_id = run_resp.json()["run_id"]

    explicit_seed_tick = _run_to_first_pause_or_completion(run_id)
    assert explicit_seed_tick.get("paused"), "expected the explicit-seed run to pause on a fired proposal"
    explicit_seed_fire_tick = explicit_seed_tick["tick_index"]

    # ── Persisted run created with NO run_seed (falls back to the default) ──
    clear_registry()
    clear_draft_registry()
    default_plan_resp = client.post(
        "/api/run-plans", json={"package_id": package_id, "scenario_id": _SCENARIO_ID}
    )
    assert default_plan_resp.status_code == 201, default_plan_resp.text
    default_plan_id = default_plan_resp.json()["plan_id"]

    default_run_resp = client.post("/api/runs", json={"plan_id": default_plan_id})
    assert default_run_resp.status_code == 201, default_run_resp.text
    default_run_id = default_run_resp.json()["run_id"]

    default_seed_tick = _run_to_first_pause_or_completion(default_run_id)
    assert default_seed_tick.get("paused"), "expected the default-seed run to pause on a fired proposal"
    default_seed_fire_tick = default_seed_tick["tick_index"]

    # The two seeds must actually drive DIFFERENT anomaly sequences — otherwise
    # this test wouldn't discriminate the bug (the anomaly generator is seeded
    # per (run_seed, tick, "anomaly"); 999 != 42 must change the fire tick).
    assert explicit_seed_fire_tick != default_seed_fire_tick, (
        "explicit run_seed=999 and default run_seed=42 produced the SAME fire "
        "tick — this test fixture can't discriminate the seed-threading bug"
    )

    # ── /preview with the SAME explicit seed must match the persisted run ──
    clear_registry()
    clear_draft_registry()
    preview_resp = client.post(
        "/api/runs/preview", json=_preview_body(package_id=package_id, run_seed=explicit_seed)
    )
    assert preview_resp.status_code == 200, preview_resp.text
    preview_body = preview_resp.json()

    assert preview_body["fired"] is True
    assert preview_body["fire"]["tick"] == explicit_seed_fire_tick, (
        f"/preview(run_seed={explicit_seed}) fire tick {preview_body['fire']['tick']} != "
        f"persisted run (run_seed={explicit_seed}) fire tick {explicit_seed_fire_tick} — "
        "run_seed did not thread through POST /api/run-plans into the persisted run"
    )

    # ── And /preview with the explicit seed must differ from the default-seed run ──
    assert preview_body["fire"]["tick"] != default_seed_fire_tick


# ---------------------------------------------------------------------------
# 4 — Overrides diff: exactly the changed-from-default keys.
# ---------------------------------------------------------------------------


def test_preview_overrides_diff_is_exact(monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    pkg_path = _REPO_ROOT / "packages" / _HYBRID_PKG_ID / "package.json"
    manifest = json.loads(pkg_path.read_text(encoding="utf-8"))
    defaults = {hp["key"]: hp["default"] for hp in manifest["hyperparameters"]}
    changed_key = "w_drowsiness"
    unchanged_key = "w_fatigue"
    assert changed_key in defaults and unchanged_key in defaults

    overrides = {
        changed_key: defaults[changed_key] + 0.05,
        # Same value as default — must NOT appear in the diff (defensive filter).
        unchanged_key: defaults[unchanged_key],
    }

    resp = client.post("/api/runs/preview", json=_preview_body(overrides=overrides))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["overrides"] == [
        {"key": changed_key, "default": defaults[changed_key], "value": defaults[changed_key] + 0.05}
    ]


# ---------------------------------------------------------------------------
# 5 — Algorithm exception -> error populated, fired never fabricated.
# ---------------------------------------------------------------------------


def _make_raising_package(pkg_id: str) -> dict:
    """A minimal python_module PackageManifest dict whose evaluate() always raises."""
    return {
        "id": pkg_id,
        "version": "0.1.0",
        "label": {"ja": "エラーテスト", "en": "Error Test"},
        "compatible_scenario_types": ["uc01_fatigue"],
        "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
        "parameters": [],
        "features": [{"key": "drowsiness_score", "band_values": []}],
        "hyperparameters": [
            {"key": "w_test", "label": {"ja": "", "en": ""}, "kind": "numeric", "default": 0.5}
        ],
        "trigger_categories": [{"id": "rest_required", "priority": 1}],
        "rules": [],
        "fire_control": {"threshold_source": "threshold_suggest", "actionability_guard": "rest_spot_reachable"},
        "proposals": [
            {"id": "rest_guidance", "message": {"ja": "休憩", "en": "Rest"}, "options": ["accept_rest", "postpone"]}
        ],
    }


def test_preview_algorithm_error_populates_error_never_fakes_fired(monkeypatch, tmp_path):
    pkg_id = "err_preview_pkg"
    pkg_dir = tmp_path / pkg_id
    pkg_dir.mkdir()
    (pkg_dir / "package.json").write_text(
        json.dumps(_make_raising_package(pkg_id)), encoding="utf-8"
    )
    (pkg_dir / "algorithm.py").write_text(
        "def evaluate(ctx):\n    raise RuntimeError('injected crash')\n", encoding="utf-8"
    )
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))

    from aica_api.algorithms import python_module as _pm
    _pm._MODULE_CACHE.clear()

    client = TestClient(app)
    resp = client.post("/api/runs/preview", json=_preview_body(package_id=pkg_id))

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["error"] is not None
    assert body["error"]["error_type"] == "algorithm_exception"
    assert body["fired"] is False
    assert body["fire"] is None

    _pm._MODULE_CACHE.clear()


# ---------------------------------------------------------------------------
# 6 — Old-shape scenario -> rejected, no partial preview.
# ---------------------------------------------------------------------------


def test_preview_rejects_old_shape_scenario(monkeypatch, tmp_path):
    scenario_id = "old_shape_preview_test"
    (tmp_path / f"{scenario_id}.json").write_text(
        json.dumps({"id": scenario_id, "driver_profile": {}}), encoding="utf-8"
    )
    monkeypatch.setenv("AICA_SCENARIOS_DIR", str(tmp_path))

    client = TestClient(app)
    resp = client.post(
        "/api/runs/preview", json=_preview_body(package_id=_NRI_PKG_ID, scenario_id=scenario_id)
    )

    assert resp.status_code == 400, resp.text
    assert "not found or invalid" in resp.json()["detail"]
