# `worked-example.json` — golden values (P5 Unit B, T005)

Source: `docs/master/aica_transparent_service_proposal_algorithm.md` §10.
Opportunity: `inattentive_driving_prevention_recovery` (purpose ②) /
`active_driving_content`. Candidate under study: `humming_karaoke`.

## Per-feature table (candidate = `humming_karaoke`, purpose = inattentive②)

Reproduced by `aica_transparent_service_selector_v1.algorithm.evaluate()`
against this fixture (`test_p5_service_math.py::test_worked_example`).
`e`/`a`/`r`/`w`/`k` columns below are the doc's own §10 published (6-decimal)
figures — the package's full float64 output matches every one of them to
that published precision.

| Feature | e | a | r | w | k = w·r |
|---|---:|---:|---:|---:|---:|
| drowsiness_level | .80 | +1.0 | .80 | .254551 | +.203641 |
| fatigue_level | .60 | +1.0 | .60 | .208269 | +.124961 |
| traffic_state (congested) | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| road_type (highway) | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| night_state | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| monotony_level | .75 | +1.0 | .75 | .120950 | +.090713 |
| route_tags | 1.00 | +1.0 | 1.00 | .019091 | +.019091 |
| destination_tags | .50 | +1.0 | .50 | .015620 | +.007810 |
| child_present | 1.00 | +1.0 | 1.00 | .025571 | +.025571 |
| multiple_passengers | 1.00 | +1.0 | 1.00 | .013769 | +.013769 |
| oshi_registered | 1.00 | +0.5 | .50 | .006479 | +.003240 |
| oshi_mode | +1.00 | +0.5 | .50 | .012033 | +.006017 |
| service_recency_state | .50 | +1.0 | .50 | .007405 | +.003703 |
| service_usage_level | 1.00 | +1.0 | 1.00 | .020827 | +.020827 |
| scene_service_usage_level | 1.00 | +1.0 | 1.00 | .040728 | +.040728 |
| service_proposal_acceptance_rate | .50 | +1.0 | .50 | .015427 | +.007714 |
| service_recovery_rate | .40 | +1.0 | .40 | .057853 | +.023141 |

**`humming_karaoke.score`**: doc states **+0.772349**. This package's full
float64 (unrounded-intermediate) computation yields **+0.7723503548...**
(rounds to +0.772350). Independently re-derived with exact rational
arithmetic (`fractions.Fraction`, no floating-point rounding anywhere in the
hierarchy-weight or scoring computation) from the doc's own exact input
ratios (§6.1 shares, §6.2 multipliers, §10 e/a values) — the exact value is
`40051/51856 = 0.77235035482875658...`, confirming the package has **no
transcription or normalization bug**: every individual `w_i` and `k_i` above
matches the doc's own published 6-decimal figures exactly (max per-row
diff ≤ 5e-7, i.e. the doc's own 6-decimal rounding noise). The ~1.4e-6 gap
between the mathematically exact total and the doc's stated headline figure
(+0.772349) is the doc's own worked-example rounding artifact: summing the
doc's *own displayed* (6-decimal-rounded) `k` column gives +0.772351 — i.e.
the doc's stated total does not even reproduce from its own displayed rows
to 1e-12, only to ~2e-6. See Unit B's report for detail.

Test tolerance used (`test_p5_service_math.py::test_worked_example`):
per-feature `w_i`/`k_i` compared to the doc's 6-decimal table at `abs=6e-7`;
the aggregate `score` compared to the doc's stated `+0.772349` at
`abs=2e-6` (documented, not `1e-12`, for the reason above); `humming_karaoke`
ranked strictly above `music_playlist` is asserted exactly (unambiguous,
doc-independent of the rounding question).

## `music_playlist` (same snapshot)

The doc states "≈ +0.132" from route/destination + mild oshi + direct
usage/history contributions, without pinning `music_playlist`'s own
recency/usage/scene/acceptance/recovery raw values (only `humming_karaoke`'s
full row is specified in §10). This fixture authors plausible values for
`music_playlist` (recency=recent, usage=high, scene=high for the same 9
scene ids, acceptance=50, recovery=75) reproducing a score in the same
neighborhood (computed ≈ **+0.1266**) — the fixture/test do **not** assert
this figure at tight tolerance; only `humming_karaoke.score > music_playlist.score`
is a firm, doc-derived assertion.
