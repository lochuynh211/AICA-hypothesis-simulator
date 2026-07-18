"""Tests for the merged-run coordinator (feature 020, Task 3: registry + persistence).

Covers ``create_handle``/``save_handle``/``get_handle`` round-tripping through
``merged_runs/<merged_run_id>.json`` and ``make_merged_run_id``'s id format.
"""

import re


def test_create_save_get(tmp_path):
    from aica_api.services import merged_run_coordinator as mc

    h = mc.create_handle(
        merged_run_id="m1",
        trigger_run_id="r1",
        world_template={},
        service_package_id="s",
        content_package_id="c",
        proposal_mode="interactive",
        run_seed="7",
        merged_dir=tmp_path,
    )
    mc.save_handle(h, tmp_path)
    assert mc.get_handle("m1", tmp_path) == h
    assert mc.get_handle("nope", tmp_path) is None


def test_create_handle_does_not_persist():
    """create_handle only builds the model; save_handle is the persistence step."""
    from aica_api.services import merged_run_coordinator as mc

    import pathlib
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        merged_dir = pathlib.Path(tmp)
        mc.create_handle(
            merged_run_id="m2",
            trigger_run_id="r2",
            world_template={},
            service_package_id="s",
            content_package_id="c",
            proposal_mode="interactive",
            run_seed="7",
            merged_dir=merged_dir,
        )
        assert not (merged_dir / "m2.json").exists()


def test_make_merged_run_id_format():
    from aica_api.services import merged_run_coordinator as mc

    run_id = mc.make_merged_run_id()
    assert re.fullmatch(r"mrun_\d{8}-\d{6}_[0-9a-f]{6}", run_id)
    assert run_id != mc.make_merged_run_id()
