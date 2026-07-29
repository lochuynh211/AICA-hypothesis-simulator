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
        "fired", "fire", "peak_score", "threshold", "score_series", "spikes", "segments",
        "rest_spot", "rest_option", "completed_min", "seed", "overrides", "error",
    ):
        assert key in body, f"InstantResult missing key {key!r}"

    assert body["fired"] is True
    assert body["fire"] is not None
    # NRI bands its single score, so its FIRST fire is the lower (monotony)
    # band; the hybrid's first fire on this scenario is the rest one.
    expected_category = "monotony_prevention" if package_id == _NRI_PKG_ID else "rest_required"
    assert body["fire"]["category"] == expected_category
    assert isinstance(body["score_series"], list) and len(body["score_series"]) > 0
    assert body["seed"] == 42
    assert body["error"] is None
    assert body["completed_min"] is not None

    after = sorted(p.name for p in tmp_path.glob("*.json"))
    assert before == after == [], "runs/ must be unchanged (empty) after a /preview call"


# ---------------------------------------------------------------------------
# 1b — Second (monotony) curve: populated for the hybrid, empty for NRI.
# ---------------------------------------------------------------------------


def test_preview_monotony_series_present_for_hybrid_absent_for_nri(monkeypatch, tmp_path):
    """The two packages populate the second curve differently, and the preview
    must carry each faithfully.

    The hybrid SCORES monotony separately → a second `monotony_series` plus its
    `monotony_threshold`. NRI bands ONE score with two thresholds → a monotony
    THRESHOLD but no second series, because a second curve would be an exact
    duplicate of the first drawn on top of itself. The threshold therefore has to
    be carried independently of the series (it used to be read only inside the
    `if mono_score is not None` branch, which dropped NRI's rule entirely and
    left its monotony fires with nothing to fire against)."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    hybrid = client.post("/api/runs/preview", json=_preview_body(package_id=_HYBRID_PKG_ID)).json()
    assert isinstance(hybrid["monotony_series"], list) and len(hybrid["monotony_series"]) > 0
    # Same length as the rest curve — one sample per evaluated tick.
    assert len(hybrid["monotony_series"]) == len(hybrid["score_series"])
    assert hybrid["monotony_threshold"] is not None

    nri = client.post("/api/runs/preview", json=_preview_body(package_id=_NRI_PKG_ID)).json()
    assert nri["monotony_series"] == [], "NRI has one score — no second curve"
    assert nri["monotony_threshold"] is not None, (
        "NRI's lower monotony threshold must still reach the strip"
    )
    # And it is the LOWER of the two rules, on the same 0-1 axis as the curve.
    assert 0.0 < nri["monotony_threshold"] < nri["threshold"] <= 1.0


# ---------------------------------------------------------------------------
# 1b' — Anomaly spikes are emitted and marked on the timeline (aligned to ticks).
# ---------------------------------------------------------------------------


def test_preview_emits_anomaly_spikes_aligned_to_score_ticks(monkeypatch, tmp_path):
    """The seeded-Poisson generator fires spikes over the run; the preview marks
    each one so the setup strip can point at it. Every spike's tick index lines up
    with a score_series sample (same x-axis), and its time_min is non-negative.
    Deterministic given the run_seed."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    body = client.post("/api/runs/preview", json=_preview_body(package_id=_HYBRID_PKG_ID)).json()

    spikes = body["spikes"]
    assert isinstance(spikes, list) and len(spikes) > 0, "uc01 drives drowsiness high enough to spike"
    score_ticks = {p["t"] for p in body["score_series"]}
    for s in spikes:
        assert set(s) >= {"t", "time_min"}
        assert s["t"] in score_ticks, "spike must align with a score-curve point"
        assert s["time_min"] >= 0.0

    # Deterministic: same run_seed → identical spike ticks.
    body2 = client.post("/api/runs/preview", json=_preview_body(package_id=_HYBRID_PKG_ID)).json()
    assert [s["t"] for s in body2["spikes"]] == [s["t"] for s in spikes]


# ---------------------------------------------------------------------------
# 1c — A selected Maps/preset route is honored by the preview (not the scenario
#      default local route).
# ---------------------------------------------------------------------------


def test_preview_honors_selected_maps_route(monkeypatch, tmp_path):
    """Selecting a preset route in setup must change the preview: passing the
    preset's route_facts with route_source='maps' runs the preview against that
    route (its distance/duration), so the result differs from the local default."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Local (scenario-default) preview.
    local = client.post("/api/runs/preview", json=_preview_body(package_id=_HYBRID_PKG_ID)).json()

    # Load a long preset route (Tokyo–Osaka) and feed its facts into the preview.
    preset = client.post("/api/routes/presets/long_tokyo_osaka/load")
    assert preset.status_code == 200, preset.text
    alt = preset.json()["alternatives"][0]

    body = _preview_body(package_id=_HYBRID_PKG_ID)
    body["route_source"] = "maps"
    body["route_id"] = alt["route_id"]
    body["route_facts"] = alt["route_facts"]
    body["display_route"] = alt["display"]
    maps = client.post("/api/runs/preview", json=body)
    assert maps.status_code == 200, maps.text
    maps_body = maps.json()

    # The long preset route takes far longer than the scenario default → the
    # preview's completed/last segment time must differ (route was honored).
    def _span(r):
        segs = r.get("segments") or []
        return segs[-1]["to_min"] if segs else (r.get("completed_min") or 0.0)

    assert _span(maps_body) != _span(local), (
        f"maps-route preview span {_span(maps_body)} must differ from local {_span(local)}"
    )

    # A long route surfaces MULTIPLE triggers across the drive (like the Review
    # timeline), not just the first — and its first entry equals `fire`.
    assert len(maps_body["fires"]) > 1, f"expected multiple triggers, got {maps_body['fires']}"
    assert maps_body["fires"][0] == maps_body["fire"]
    # It exercises real road classes (highway / normal_road) — colored to match the map.
    seg_types = {s["type"] for s in maps_body["segments"]}
    assert "highway" in seg_types or "normal_road" in seg_types


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
    # non-default; scenario.run_seed_default == 42. Must be a seed whose anomaly
    # sequence lets the hybrid trigger's rest_required_score clear
    # rest_persistence_ticks=6 consecutive over-threshold ticks before the
    # route completes (~35 ticks total under tick_seconds=180) — some seeds'
    # stochastic anomaly_rate dips the score below threshold_suggest just
    # before persistence completes, so the run finishes without ever firing.
    # Verified: seed=100 fires (paused) at tick 26, well within the ~35-tick
    # route budget.
    explicit_seed = 100

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
    # per (run_seed, tick, "anomaly"); explicit_seed != 42 must change the fire tick).
    assert explicit_seed_fire_tick != default_seed_fire_tick, (
        f"explicit run_seed={explicit_seed} and default run_seed=42 produced the SAME "
        "fire tick — this test fixture can't discriminate the seed-threading bug"
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


# ---------------------------------------------------------------------------
# UX-BE — preview reflects driver_signal_params / anomaly_signal_params /
# weather_risk overrides (previously ignored: preview only applied
# hyperparameter_overrides + run_seed). Faithfulness: a preview with the same
# profiles/context_overrides as a persisted POST /run-plans + POST /runs must
# match it (same computed result), not just "look plausible".
# ---------------------------------------------------------------------------


def _run_to_first_pause_or_completion(client: TestClient, run_id: str) -> dict:
    for _ in range(400):
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200, tick_resp.text
        tbody = tick_resp.json()
        if tbody.get("paused") or tbody.get("completed"):
            return tbody
    raise AssertionError("run did not pause or complete within 400 ticks")


def test_preview_driver_signal_params_override_faithful_and_differs(monkeypatch, tmp_path):
    """A driver_signal_params override (profiles.driver, higher drowsiness AND
    fatigue base_growth) must (a) change the preview's fire tick vs. the
    default, and (b) match a persisted run created with the SAME
    profiles.driver override.

    Note: under the current tuning (tick_seconds=180, threshold_suggest=0.7)
    a drowsiness-ONLY override saturates the drowsiness feature (band-clamped
    to 1.0) within a handful of ticks — well before the persistence-gated
    threshold crossing — so the fire tick becomes fatigue-paced and a
    drowsiness-only override no longer discriminates from the default.
    Overriding both signals (a faithful "driver is a lot more fatigue-prone"
    profile edit) is required to produce a measurable difference.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)
    package_id = _HYBRID_PKG_ID
    driver_override = {
        "drowsiness_model": {"base_growth_per_min": 5.0},
        "fatigue_model": {"base_growth_per_min": 3.0},
    }

    # ── Persisted run WITH the override ────────────────────────────────────
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": package_id,
            "scenario_id": _SCENARIO_ID,
            "profiles": {"driver": driver_override},
        },
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, run_resp.text
    run_id = run_resp.json()["run_id"]

    overridden = _run_to_first_pause_or_completion(client, run_id)
    assert overridden.get("paused"), "expected the overridden run to pause on a fired proposal"
    overridden_fire_tick = overridden["tick_index"]

    # ── Default preview (no override) — the discriminating baseline ────────
    clear_registry()
    clear_draft_registry()
    default_resp = client.post("/api/runs/preview", json=_preview_body(package_id=package_id))
    assert default_resp.status_code == 200, default_resp.text
    default_fire_tick = default_resp.json()["fire"]["tick"]

    # ── Preview WITH the SAME override ──────────────────────────────────────
    clear_registry()
    clear_draft_registry()
    body = _preview_body(package_id=package_id)
    body["profiles"] = {"driver": driver_override}
    preview_resp = client.post("/api/runs/preview", json=body)
    assert preview_resp.status_code == 200, preview_resp.text
    preview_body = preview_resp.json()

    assert preview_body["fired"] is True
    assert preview_body["fire"]["tick"] == overridden_fire_tick, (
        "preview with profiles.driver override must match the persisted run "
        "created with the same override"
    )
    assert preview_body["fire"]["tick"] != default_fire_tick, (
        "preview with profiles.driver override must differ from the default "
        "(unoverridden) preview — otherwise the override was silently ignored"
    )


def test_preview_anomaly_signal_params_override_faithful_and_differs(monkeypatch, tmp_path):
    """An anomaly_signal_params override (profiles.anomaly, much higher lambda_base)
    must (a) change the preview's fire tick vs. the default, and (b) match a
    persisted run created with the SAME profiles.anomaly override."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)
    package_id = _HYBRID_PKG_ID
    anomaly_override = {"lambda_base": 50.0}

    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": package_id,
            "scenario_id": _SCENARIO_ID,
            "profiles": {"anomaly": anomaly_override},
        },
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, run_resp.text
    run_id = run_resp.json()["run_id"]

    overridden = _run_to_first_pause_or_completion(client, run_id)
    assert overridden.get("paused"), "expected the overridden run to pause on a fired proposal"
    overridden_fire_tick = overridden["tick_index"]

    clear_registry()
    clear_draft_registry()
    default_resp = client.post("/api/runs/preview", json=_preview_body(package_id=package_id))
    assert default_resp.status_code == 200, default_resp.text
    default_fire_tick = default_resp.json()["fire"]["tick"]

    clear_registry()
    clear_draft_registry()
    body = _preview_body(package_id=package_id)
    body["profiles"] = {"anomaly": anomaly_override}
    preview_resp = client.post("/api/runs/preview", json=body)
    assert preview_resp.status_code == 200, preview_resp.text
    preview_body = preview_resp.json()

    assert preview_body["fired"] is True
    assert preview_body["fire"]["tick"] == overridden_fire_tick, (
        "preview with profiles.anomaly override must match the persisted run "
        "created with the same override"
    )
    assert preview_body["fire"]["tick"] != default_fire_tick, (
        "preview with profiles.anomaly override must differ from the default "
        "(unoverridden) preview — otherwise the override was silently ignored"
    )


def test_preview_weather_risk_context_override_faithful_and_differs(monkeypatch, tmp_path):
    """A weather_risk context override must (a) measurably change the preview's
    computed score vs. the default (the fixed-tier signal feeds the algorithm
    from tick 0, unlike accumulator-based env signals), and (b) match a
    persisted run created with the SAME context_overrides."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)
    package_id = _HYBRID_PKG_ID
    context_overrides = {"weather_risk": 100.0}

    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": package_id,
            "scenario_id": _SCENARIO_ID,
            "context_overrides": context_overrides,
        },
    )
    assert plan_resp.status_code == 201, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, run_resp.text
    run_id = run_resp.json()["run_id"]

    overridden = _run_to_first_pause_or_completion(client, run_id)
    assert overridden.get("paused"), "expected the overridden run to pause on a fired proposal"
    overridden_fire_tick = overridden["tick_index"]

    clear_registry()
    clear_draft_registry()
    default_resp = client.post("/api/runs/preview", json=_preview_body(package_id=package_id))
    assert default_resp.status_code == 200, default_resp.text
    default_body = default_resp.json()

    clear_registry()
    clear_draft_registry()
    body = _preview_body(package_id=package_id)
    body["context_overrides"] = context_overrides
    preview_resp = client.post("/api/runs/preview", json=body)
    assert preview_resp.status_code == 200, preview_resp.text
    preview_body = preview_resp.json()

    assert preview_body["fired"] is True
    assert preview_body["fire"]["tick"] == overridden_fire_tick, (
        "preview with context_overrides.weather_risk must match the persisted "
        "run created with the same override"
    )
    # The weather_risk override feeds the algorithm's env_load term from tick 0
    # (no accumulator ramp-up needed) — the very first score sample must differ
    # from the unoverridden default, proving the override actually reached the
    # adapter context rather than being silently dropped.
    assert preview_body["score_series"][0]["score"] != default_body["score_series"][0]["score"]


def test_preview_invalid_context_override_returns_400(monkeypatch, tmp_path):
    """An out-of-range weather_risk in /runs/preview's context_overrides -> 400,
    mirroring POST /api/run-plans' validation (same shared validator)."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    body = _preview_body(package_id=_HYBRID_PKG_ID)
    body["context_overrides"] = {"weather_risk": 500.0}
    resp = client.post("/api/runs/preview", json=body)
    assert resp.status_code == 400, resp.text
    assert "weather_risk" in resp.json()["detail"]


def test_preview_invalid_profile_override_returns_400(monkeypatch, tmp_path):
    """An invalid profiles.anomaly override (unknown field) in /runs/preview ->
    400, via the same _apply_profile_overrides validation a real run uses."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    body = _preview_body(package_id=_HYBRID_PKG_ID)
    body["profiles"] = {"anomaly": {"not_a_real_field": 1.0}}
    resp = client.post("/api/runs/preview", json=body)
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# 3c — Faithfulness of the WHOLE fire sequence, not just the first fire.
# ---------------------------------------------------------------------------
#
# Test 3 above compares only `fire.tick`, so a divergence in the SECOND fire
# went unnoticed: the projection and the run disagreed about whether the driver
# had responded to a monotony proposal, and a response is what lets the Hybrid
# rebaseline its monotony accumulator. The projection showed ONE monotony fire
# where the run showed TWO.
#
# The two must model the SAME driver. Both now record the response: the
# projection acknowledges a monotony proposal, and the merged run records the
# same acknowledge when the reviewer picks a service for one.
#
# `uc02_monotony_v0_1` is the right scenario for this comparison: it fires
# monotony repeatedly and never fires rest, so the projection's rest auto-accept
# (which legitimately changes the future, and is the point of the auto-drive)
# does not enter into it.


def test_preview_fire_sequence_matches_a_run_that_answers_the_same_way(monkeypatch, tmp_path):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)
    seed = 1042
    scenario_id = "uc02_monotony_v0_1"

    plan_id = client.post(
        "/api/run-plans",
        json={"package_id": _HYBRID_PKG_ID, "scenario_id": scenario_id, "run_seed": seed},
    ).json()["plan_id"]
    run_id = client.post("/api/runs", json={"plan_id": plan_id}).json()["run_id"]

    # Answer each monotony proposal the way a reviewer does by taking it up —
    # the same response the projection assumes.
    persisted: list[tuple[int, str]] = []
    for _ in range(400):
        body = client.post(f"/api/runs/{run_id}/tick").json()
        decision = body.get("decision")
        if decision and decision["fire_control"]["fired"] and decision.get("proposal"):
            persisted.append((body["tick_index"], decision["selected_category"]))
            if decision["selected_category"] == "monotony_prevention":
                acted = client.post(f"/api/runs/{run_id}/actions", json={"action": "acknowledge"})
                assert acted.status_code == 200, acted.text
        if body.get("completed"):
            break

    clear_registry()
    clear_draft_registry()
    preview = client.post(
        "/api/runs/preview",
        json=_preview_body(package_id=_HYBRID_PKG_ID, scenario_id=scenario_id, run_seed=seed),
    ).json()
    projected = [(f["tick"], f["category"]) for f in preview["fires"]]

    assert persisted, "setup: this scenario must fire at least once"
    assert projected == persisted, (
        "the projection and the run must agree on WHICH triggers fire and WHEN "
        f"— projection {projected} vs run {persisted}"
    )


def test_monotony_score_falls_after_the_proposal_is_taken_up(monkeypatch, tmp_path):
    """Taking up a monotony proposal must RELIEVE monotony.

    The score used to climb monotonically for a whole run — nothing the driver
    did changed it, so a monotony proposal was a nudge with no modelled effect
    and the curve only ever went up until a rest. Rest has always had a recovery
    (stop → accumulators rebaselined); this is monotony's.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    body = client.post(
        "/api/runs/preview",
        json=_preview_body(package_id=_HYBRID_PKG_ID, scenario_id="uc02_monotony_v0_1", run_seed=1042),
    ).json()

    series = body["monotony_series"]
    fire_ticks = [f["tick"] for f in body["fires"] if f["category"] == "monotony_prevention"]
    assert fire_ticks, "setup: this scenario must fire monotony at least once"

    by_tick = {p["t"]: p["score"] for p in series}
    first = fire_ticks[0]
    after = [t for t in sorted(by_tick) if t > first][:4]
    assert after, "setup: the run must continue past the first monotony fire"
    assert min(by_tick[t] for t in after) < by_tick[first], (
        f"monotony must fall after the proposal is taken up at tick {first}: "
        f"{by_tick[first]:.3f} -> {[round(by_tick[t], 3) for t in after]}"
    )
