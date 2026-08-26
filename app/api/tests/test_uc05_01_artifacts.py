import json, pathlib
import pytest
from aica_api.models.scenario import ScenarioDef

REPO = pathlib.Path(__file__).resolve().parents[3]

def test_scenario_loads_and_keeps_uc01_type():
    data = json.loads((REPO / "scenarios" / "uc05_01_forecast_jam_v0_1.json").read_text(encoding="utf-8"))
    scn = ScenarioDef(**data)
    assert scn.id == "uc05_01_forecast_jam_v0_1"
    # Keep the uc01_fatigue type so nri_fatigue_score_v1 stays compatible.
    assert scn.type == "uc01_fatigue"
    # A single position-native jam is present (calibrated later in Task 6).
    # NOTE: ScenarioDef.presets is `dict[str, Any]` (see models/scenario.py),
    # not a submodel with a `.traffic_events` attribute — matches dict-access
    # convention used elsewhere (event_plan.py, merged_runs.py).
    assert len(scn.presets["traffic_events"]) == 1

def test_driver_profile_is_ms_c_20s_female():
    data = json.loads((REPO / "proposal_contracts" / "presets" / "preset-uc05-01-forecast-c.json").read_text(encoding="utf-8"))
    assert data["preset_id"] == "preset-uc05-01-forecast-c"
    assert data["world"]["driver_profile"]["age_band"] == "20s"
    assert data["world"]["driver_profile"]["gender"] == "female"

def test_route_preset_is_baked_maps_route_with_places():
    p = REPO / "routes" / "presets" / "uc05_01_minatomirai_gotemba.json"
    raw = p.read_text(encoding="utf-8")
    assert "AIza" not in raw and "key=" not in raw  # BYO-key: no key leaked
    data = json.loads(raw)
    assert data["id"] == "uc05_01_minatomirai_gotemba"
    assert data["route_source"] == "maps"
    # Real SA/PA places exist with distances (rest spots the algorithm can use).
    assert any("distance_along_route_m" in pl for pl in data["places"])

def test_master_preset_bundles_the_three_refs_and_nri_trigger():
    data = json.loads((REPO / "combined_contracts" / "test_cases" / "case-uc05-01-forecast-jam-c.json").read_text(encoding="utf-8"))
    assert data["case_id"] == "case-uc05-01-forecast-jam-c"
    assert data["journey"]["scenario_ref"] == "uc05_01_forecast_jam_v0_1"
    assert data["journey"]["route_preset_ref"] == "uc05_01_minatomirai_gotemba"
    assert data["persona"]["profile_ref"] == "preset-uc05-01-forecast-c"
    assert data["algorithm_defaults"]["trigger"] == "nri_fatigue_score_v1"
