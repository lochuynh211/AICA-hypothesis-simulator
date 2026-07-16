"""TDD: MF2 (P3 POLISH unit) — redact the frozen catalog from PERSISTED
evidence.

Real STEP-2 (``aica_transparent_content_selector_v1``) embeds the FULL frozen
300-song catalog inside the content-selector's ``feature_snapshot["catalog"]``
— necessary at runtime for ``evaluate()`` to score every candidate, but
~1.5 MB of near-duplicate data to persist verbatim inside every run's
``AlgorithmEvidence.input_snapshot``, when the catalog is already identified
by ``dataset_id``/``dataset_hash`` in the run's frozen ``SetupSnapshot``.

Covers:
  (a) the persisted run JSON's content evidence does NOT contain the full
      song list, but DOES contain a compact ``{dataset_id, song_count}``
      reference marker;
  (b) the returned ``CompletePlan`` (what the reviewer sees) is completely
      UNCHANGED by the redaction — ``evaluate()`` still receives the full,
      un-redacted catalog;
  (c) reopening the run (``GET /runs/{id}``) still renders successfully,
      with the same redacted evidence;
  (d) determinism is unaffected: identical world -> identical plan AND
      identical redacted-catalog marker;
  (e) an ``algorithm_error`` is still recorded normally (never suppressed by
      the redaction step) — and its ``input_snapshot`` is redacted too.
"""
from __future__ import annotations

import copy
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _create_run(world: dict, *, content_package_id: str = _REAL_CONTENT_PACKAGE_ID) -> dict:
    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world,
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": content_package_id,
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-16T10:00:00Z",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _select_service(run_id: str, selected_service_id: str):
    return client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": selected_service_id},
    )


def _persisted_run_path(run_id: str, tmp_path) -> "object":
    return tmp_path / f"{run_id}.json"


# ---------------------------------------------------------------------------
# (a) persisted evidence redacted, plan unchanged
# ---------------------------------------------------------------------------


def test_persisted_evidence_redacts_catalog_but_keeps_dataset_reference(tmp_path):
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    content_ev = body["evidence"][-1]
    assert content_ev["step"] == "content"
    assert content_ev["error"] is None

    catalog_in_response = content_ev["input_snapshot"]["feature_snapshot"]["catalog"]
    assert "_redacted_catalog" in catalog_in_response
    marker = catalog_in_response["_redacted_catalog"]
    assert marker["dataset_id"] == _DATASET_ID
    assert isinstance(marker["song_count"], int)
    assert marker["song_count"] > 0

    # No raw per-song entries survive (a real catalog entry has a
    # "spotify_track" key; the redacted marker must not).
    assert "spotify_track" not in json.dumps(catalog_in_response)

    # Read the persisted file directly off disk too — the API response and
    # the on-disk record must agree (both are redacted, not just one).
    persisted_path = _persisted_run_path(run["run_id"], tmp_path)
    on_disk = json.loads(persisted_path.read_text(encoding="utf-8"))
    on_disk_catalog = on_disk["evidence"][-1]["input_snapshot"]["feature_snapshot"]["catalog"]
    assert on_disk_catalog == catalog_in_response

    # The returned CompletePlan is unaffected — same shape/content as the
    # unredacted-context test (test_step2_real_content.py) expects.
    output = content_ev["output"]
    assert output["decision_type"] == "complete_plan"
    assert output["ordered_items"]
    for item in output["ordered_items"]:
        assert item["item_id"].startswith("synthetic-track-")


def test_evidence_size_shrinks_dramatically_after_redaction(tmp_path):
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200

    persisted_path = _persisted_run_path(run["run_id"], tmp_path)
    persisted_bytes = persisted_path.read_bytes()
    # The full frozen catalog is ~300 songs; persisting it in full would push
    # a single run well past a few hundred KB. Redacted, the whole run log
    # (world snapshot + both evidence entries + plan) should stay small.
    assert len(persisted_bytes) < 200_000, (
        f"persisted run is {len(persisted_bytes)} bytes — catalog redaction appears not to be applied"
    )


# ---------------------------------------------------------------------------
# (c) reopen renders without recompute
# ---------------------------------------------------------------------------


def test_reopened_run_still_renders_with_redacted_evidence():
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    reopened = client.get(f"/api/proposal/runs/{run_id}")
    assert reopened.status_code == 200
    body = reopened.json()
    content_ev = body["evidence"][-1]
    assert content_ev["output"]["decision_type"] == "complete_plan"
    assert "_redacted_catalog" in content_ev["input_snapshot"]["feature_snapshot"]["catalog"]


# ---------------------------------------------------------------------------
# (d) determinism unaffected by redaction
# ---------------------------------------------------------------------------


def test_identical_world_yields_identical_plan_and_identical_redaction_marker():
    world = _load_seed_world_dict()
    run1 = _create_run(copy.deepcopy(world))
    run2 = _create_run(copy.deepcopy(world))

    resp1 = _select_service(run1["run_id"], "music_playlist")
    resp2 = _select_service(run2["run_id"], "music_playlist")
    assert resp1.status_code == 200
    assert resp2.status_code == 200

    ev1 = resp1.json()["evidence"][-1]
    ev2 = resp2.json()["evidence"][-1]
    assert ev1["output"] == ev2["output"]
    assert (
        ev1["input_snapshot"]["feature_snapshot"]["catalog"]
        == ev2["input_snapshot"]["feature_snapshot"]["catalog"]
    )


# ---------------------------------------------------------------------------
# (e) algorithm_error still recorded normally, with redacted input_snapshot
# ---------------------------------------------------------------------------


def test_raising_real_content_package_still_surfaces_algorithm_error_with_redacted_snapshot(
    tmp_path, monkeypatch
):
    pkgs_dir = tmp_path / "pkgs"
    pkgs_dir.mkdir()
    shutil.copytree(settings.packages_dir / "mock_service_selector_v1", pkgs_dir / "mock_service_selector_v1")

    broken_dir = pkgs_dir / _REAL_CONTENT_PACKAGE_ID
    broken_dir.mkdir()
    (broken_dir / "package.json").write_text(
        json.dumps(
            {
                "id": _REAL_CONTENT_PACKAGE_ID,
                "version": "1.0.0",
                "label": {"ja": "x", "en": "x"},
                "kind": "content_selector",
                "family": "content_selector",
                "approach": "transparent",
                "contract_version": "1.0.0",
                "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
                "supported_services": ["music_playlist", "humming_karaoke", "full_karaoke"],
                "parameters": {},
                "hyperparameters": [],
            }
        ),
        encoding="utf-8",
    )
    (broken_dir / "algorithm.py").write_text(
        "def evaluate(context):\n    raise RuntimeError('boom')\n", encoding="utf-8"
    )

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkgs_dir))

    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "error"
    content_ev = body["evidence"][-1]
    assert content_ev["error"] is not None
    assert content_ev["error"]["category"] == "algorithm_exception"
    assert content_ev["output"] is None
    # Even the error path's persisted input_snapshot is redacted.
    assert "_redacted_catalog" in content_ev["input_snapshot"]["feature_snapshot"]["catalog"]
