from aica_api.models.scenario import RecoveryOption
from aica_api.models.run import RestSpot
from aica_api.services.recovery import start_recovery, advance_recovery

OPT = RecoveryOption(
    id="nap_karaoke", label={"ja": "x", "en": "x"},
    stages=[
        {"phase": "wakefulness", "content": "audio_karaoke", "motion": "MOVING"},
        {"phase": "nap", "content": "sleep", "motion": "STOPPED", "ticks": 2},
        {"phase": "content", "content": "video_karaoke", "motion": "STOPPED", "ticks": 1},
    ],
)
SPOT = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.6)

def test_start_recovery_begins_at_wakefulness():
    s = start_recovery(OPT, SPOT)
    assert s.active and s.phase == "wakefulness" and s.stage_index == 0

def test_wakefulness_holds_until_at_rest_spot():
    s = start_recovery(OPT, SPOT)
    s = advance_recovery(s, OPT, at_rest_spot=False)
    assert s.phase == "wakefulness"          # still en route
    s = advance_recovery(s, OPT, at_rest_spot=True)
    assert s.phase == "nap" and s.stage_ticks_remaining == 2

def test_stopped_stages_count_down_then_resume():
    s = start_recovery(OPT, SPOT)
    s = advance_recovery(s, OPT, at_rest_spot=True)   # -> nap, 2
    s = advance_recovery(s, OPT, at_rest_spot=True)   # nap tick -> 1
    assert s.phase == "nap" and s.stage_ticks_remaining == 1
    s = advance_recovery(s, OPT, at_rest_spot=True)   # nap tick -> 0 -> content,1
    assert s.phase == "content" and s.stage_ticks_remaining == 1
    s = advance_recovery(s, OPT, at_rest_spot=True)   # content tick -> 0 -> resuming
    assert s.phase == "resuming"
    s = advance_recovery(s, OPT, at_rest_spot=True)   # resuming -> done
    assert s.active is False and s.phase is None
