# mock_content_selector_v1 — Mock Transparent Content Selector (P1)

A **placeholder** content-selector package for milestone P1. It fills the
`content_selector` × `transparent` slot so the STEP 2 (concrete content) boundary
and the ④ Content panel can be exercised with **fixed, illustrative** plans. The
*real* transparent music content selector already exists as
`aica_transparent_content_selector_v1` (P6) but is intentionally **not run** in the
P1 flow — P1 proves the boundaries with mocks.

- **Contract**: `def evaluate(context: dict) -> dict` returning a
  `CompletePlan`-shaped dict (see
  `app/api/aica_api/models/proposal/content_output.py`). **No `plan_score` /
  aggregate** — one ordered plan only.
- **Behavior**: for a `context["selected_service_id"]` in
  `supported_services` (`music_playlist`, `humming_karaoke`, `full_karaoke`),
  returns one ordered plan whose `ordered_items` reference **real track IDs from
  the frozen P2 demonstration catalog** (real song names surfaced in each item's
  rationale), each with a per-item `item_fit` + illustrative
  `feature_contributions`. A service outside `supported_services` yields
  `decision_type: "unsupported_service"` (this selector is **music-only** in P1;
  non-music services legitimately have no plan).
- **Results are mock**: item fits are fixed illustrative data. The manifest
  mirrors the real P6 hyperparameter set (trait/context matrices, weights, genre
  affinity, …) so the editable setup UI shows realistic density; edited values do
  not change the fixed result in P1.
- **Family markers**: `family: content_selector`, `kind: content_selector` — the
  trigger `PackageRegistry` skips these; the `ProposalPackageRegistry` owns them.
