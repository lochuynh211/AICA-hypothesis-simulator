"""T015+T016 — coverage plan: test-first (TDD).

Tests for mdg/coverage/plan.py: build_coverage_plan(tier, ledger=None).

Key invariants:
- 36 primary cells = energy{low,medium,high} x tempo{low,medium,high} x profile{4 families}
- Band ranges: energy low 0.10-0.35 / med 0.40-0.65 / high 0.70-0.95
              tempo low 60-95 / med 96-130 / high 131-180
- language_targets for 'demonstration' tier: {ja: 30, en: 6, other: 0}
- >=12 contrast pairs, each with variable + expected_direction
- Deterministic: two calls return equal plans
- Firewall: NO score/rank/label/target field in the plan
"""
import pytest
from mdg.coverage.plan import build_coverage_plan
from mdg.models import CoveragePlan, CoverageCell, ContrastPairSpec


# ---------------------------------------------------------------------------
# T015 — 36 cells with correct band ranges
# ---------------------------------------------------------------------------

class TestCoveragePlanCells:
    """T015: 36 primary cells exist with correct energy/tempo band ranges."""

    def test_returns_coverage_plan_instance(self):
        plan = build_coverage_plan("demonstration")
        assert isinstance(plan, CoveragePlan)

    def test_exactly_36_cells(self):
        plan = build_coverage_plan("demonstration")
        assert len(plan.cells) == 36

    def test_all_cells_are_coverage_cell_instances(self):
        plan = build_coverage_plan("demonstration")
        for cell in plan.cells:
            assert isinstance(cell, CoverageCell)

    def test_36_unique_cell_ids(self):
        plan = build_coverage_plan("demonstration")
        ids = [c.cell_id for c in plan.cells]
        assert len(ids) == len(set(ids)), "cell_ids must be unique"

    def test_cells_sorted_by_cell_id(self):
        plan = build_coverage_plan("demonstration")
        ids = [c.cell_id for c in plan.cells]
        assert ids == sorted(ids), "cells must be in stable sorted order"

    def test_energy_bands_present(self):
        plan = build_coverage_plan("demonstration")
        energy_bands = {c.energy_band for c in plan.cells}
        assert energy_bands == {"low", "medium", "high"}

    def test_tempo_bands_present(self):
        plan = build_coverage_plan("demonstration")
        tempo_bands = {c.tempo_band for c in plan.cells}
        assert tempo_bands == {"low", "medium", "high"}

    def test_all_four_profiles_present(self):
        plan = build_coverage_plan("demonstration")
        profiles = {c.profile_family for c in plan.cells}
        assert profiles == {
            "balanced_vocal", "danceable_vocal", "speech_forward", "instrumental_leaning"
        }

    def test_energy_x_tempo_x_profile_cross_product(self):
        """Each energy x tempo x profile combination appears exactly once."""
        plan = build_coverage_plan("demonstration")
        combos = {
            (c.energy_band, c.tempo_band, c.profile_family)
            for c in plan.cells
        }
        expected = {
            (e, t, p)
            for e in ("low", "medium", "high")
            for t in ("low", "medium", "high")
            for p in ("balanced_vocal", "danceable_vocal", "speech_forward", "instrumental_leaning")
        }
        assert combos == expected

    def test_cell_ids_encode_band_ranges(self):
        """cell_id metadata must encode the band (energy/tempo/profile) in the plan's band_ranges."""
        plan = build_coverage_plan("demonstration")
        assert hasattr(plan, "secondary_spreads"), "plan must have secondary_spreads"
        # band_ranges in secondary_spreads
        spreads = plan.secondary_spreads
        assert "band_ranges" in spreads, "secondary_spreads must contain 'band_ranges'"
        br = spreads["band_ranges"]
        # energy ranges
        assert br["energy"]["low"] == [0.10, 0.35]
        assert br["energy"]["medium"] == [0.40, 0.65]
        assert br["energy"]["high"] == [0.70, 0.95]
        # tempo ranges
        assert br["tempo"]["low"] == [60, 95]
        assert br["tempo"]["medium"] == [96, 130]
        assert br["tempo"]["high"] == [131, 180]


# ---------------------------------------------------------------------------
# T015 — quotas present
# ---------------------------------------------------------------------------

class TestCoveragePlanQuotas:
    """T015: quotas field has the required quota keys."""

    def test_quotas_field_present(self):
        plan = build_coverage_plan("demonstration")
        assert plan.quotas

    def test_artists_tracks_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("artists_count") == 12
        assert q.get("tracks_per_artist") == 3

    def test_albums_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("min_albums") >= 12

    def test_explicit_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("min_explicit") >= 6

    def test_negatives_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("min_negatives_outside_36") >= 4

    def test_key_minus_one_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("min_key_minus_one") >= 1

    def test_eras_quota(self):
        plan = build_coverage_plan("demonstration")
        q = plan.quotas
        assert q.get("min_eras") >= 3


# ---------------------------------------------------------------------------
# T015 — language_targets for demonstration tier
# ---------------------------------------------------------------------------

class TestCoveragePlanLanguageTargets:
    """T015: language_targets for demonstration tier = {ja:30, en:6, other:0}."""

    def test_language_targets_present(self):
        plan = build_coverage_plan("demonstration")
        assert plan.language_targets

    def test_demonstration_language_targets(self):
        plan = build_coverage_plan("demonstration")
        lt = plan.language_targets
        assert lt.get("ja") == 30
        assert lt.get("en") == 6
        assert lt.get("other") == 0

    def test_language_targets_sum_to_36(self):
        plan = build_coverage_plan("demonstration")
        lt = plan.language_targets
        total = sum(lt.values())
        assert total == 36, f"language_targets sum must be 36, got {total}"

    def test_era_targets_present(self):
        plan = build_coverage_plan("demonstration")
        assert plan.era_targets, "era_targets must be non-empty"
        # at least 3 eras
        assert len(plan.era_targets) >= 3


# ---------------------------------------------------------------------------
# T016 — contrast pairs (>=12, one-variable, expected_direction)
# ---------------------------------------------------------------------------

class TestCoveragePlanContrastPairs:
    """T016: >=12 contrast pairs, each with variable + expected_direction."""

    def test_at_least_12_contrast_pairs(self):
        plan = build_coverage_plan("demonstration")
        assert len(plan.contrast_pairs) >= 12

    def test_all_pairs_are_contrast_pair_spec(self):
        plan = build_coverage_plan("demonstration")
        for pair in plan.contrast_pairs:
            assert isinstance(pair, ContrastPairSpec)

    def test_all_pairs_have_variable(self):
        plan = build_coverage_plan("demonstration")
        for pair in plan.contrast_pairs:
            assert pair.variable, f"pair {pair.pair_id} missing variable"

    def test_all_pairs_have_expected_direction(self):
        plan = build_coverage_plan("demonstration")
        for pair in plan.contrast_pairs:
            assert pair.expected_direction, f"pair {pair.pair_id} missing expected_direction"

    def test_unique_pair_ids(self):
        plan = build_coverage_plan("demonstration")
        ids = [p.pair_id for p in plan.contrast_pairs]
        assert len(ids) == len(set(ids)), "pair_ids must be unique"

    def test_required_variables_covered(self):
        """The brief specifies: calm/active, bright/dark, acoustic/electric,
        easy-hum/hard-hum, short-mod/long-high-energy, plus driver-context reversals."""
        plan = build_coverage_plan("demonstration")
        variables = {p.variable for p in plan.contrast_pairs}

        required_variables = {
            "drowsiness_level",
            "fatigue_level",
            "traffic_state",
            "road_type",
            "motion_state",
            "valence_mode",
            "acousticness",
            "humming_ease",
            "full_karaoke_ease_duration",
            "child_present",
            "oshi_mode",
            "recent_play",
        }
        missing = required_variables - variables
        assert not missing, f"Missing required pair variables: {sorted(missing)}"

    def test_pairs_differ_in_one_variable(self):
        """Each pair's variable field must be a single well-defined variable name."""
        plan = build_coverage_plan("demonstration")
        for pair in plan.contrast_pairs:
            # variable must be a non-empty string with no commas (single variable)
            assert "," not in pair.variable, (
                f"pair {pair.pair_id}: variable must be single, got '{pair.variable}'"
            )


# ---------------------------------------------------------------------------
# T016 — firewall: no score/rank/label/target in plan
# ---------------------------------------------------------------------------

class TestCoveragePlanFirewall:
    """T016: coverage plan carries NO score/rank/label/target field."""

    def test_no_score_field_in_plan_dict(self):
        plan = build_coverage_plan("demonstration")
        plan_dict = plan.model_dump()
        forbidden_keys = {"score", "rank", "label", "target", "item_fit", "recommended",
                          "best_for_world", "target_rank"}
        self._check_no_forbidden(plan_dict, forbidden_keys, path="CoveragePlan")

    def _check_no_forbidden(self, obj, forbidden, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                assert k not in forbidden, (
                    f"Firewall violation: found forbidden key '{k}' at {path}"
                )
                self._check_no_forbidden(v, forbidden, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                self._check_no_forbidden(item, forbidden, f"{path}[{i}]")


# ---------------------------------------------------------------------------
# T016 — determinism: two calls produce equal plans
# ---------------------------------------------------------------------------

class TestCoveragePlanDeterminism:
    """T016: build_coverage_plan must be deterministic."""

    def test_two_calls_equal(self):
        plan_a = build_coverage_plan("demonstration")
        plan_b = build_coverage_plan("demonstration")
        assert plan_a == plan_b, "Two calls to build_coverage_plan must return equal plans"

    def test_cell_ids_are_stable(self):
        """Same cell_ids in same order on repeated calls."""
        plan_a = build_coverage_plan("demonstration")
        plan_b = build_coverage_plan("demonstration")
        assert [c.cell_id for c in plan_a.cells] == [c.cell_id for c in plan_b.cells]

    def test_ledger_none_means_all_remaining(self):
        """With ledger=None, everything is remaining (loop-1 behavior)."""
        plan = build_coverage_plan("demonstration", ledger=None)
        # All 36 cells should appear in remaining
        remaining_cells = plan.remaining.get("cells", [])
        assert len(remaining_cells) == 36, (
            f"With no ledger, all 36 cells must be in remaining, got {len(remaining_cells)}"
        )

    def test_enrichment_priority_empty_with_no_ledger(self):
        """With ledger=None, enrichment_priority should be empty (nothing is 'shallow')."""
        plan = build_coverage_plan("demonstration", ledger=None)
        assert plan.enrichment_priority == []


# ---------------------------------------------------------------------------
# T015 — secondary_spreads has required keys
# ---------------------------------------------------------------------------

class TestCoveragePlanSecondarySpread:
    """T015: secondary_spreads covers valence/mode/acousticness/humming_ease/full_karaoke_ease/genre."""

    def test_secondary_spreads_present(self):
        plan = build_coverage_plan("demonstration")
        assert plan.secondary_spreads

    def test_required_spread_keys(self):
        plan = build_coverage_plan("demonstration")
        spreads = plan.secondary_spreads
        required = {"valence", "mode", "acousticness", "humming_ease", "full_karaoke_ease", "genre"}
        missing = required - spreads.keys()
        assert not missing, f"Missing secondary_spread keys: {sorted(missing)}"
