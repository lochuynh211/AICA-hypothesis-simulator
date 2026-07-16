# mock_service_selector_v1 — Mock Transparent Service Selector (P1)

A **placeholder** service-selector package for milestone P1 (proposal screen &
standalone run foundation). It fills the `service_selector` × `transparent` slot
so the proposal boundaries, screen, and persistence can be exercised **before the
real transparent service selector (P5) exists**.

- **Contract**: `def evaluate(context: dict) -> dict` returning a
  `ServiceSelectorOutput`-shaped dict (see
  `app/api/aica_api/models/proposal/service_output.py`).
- **Behavior**: returns up to **3 ranked candidates** drawn only from
  `context["allowed_service_ids"]`, each with well-formed but **illustrative**
  `feature_contributions` / rationale / supporting-opposing features. An empty
  allowed set yields `decision_type: "no_proposal"`.
- **Results are mock**: the ranking and contribution numbers are fixed
  illustrative data, **not** a real transparent computation. The manifest carries
  a *representative full* parameter/hyperparameter set (response matrix, category
  & hierarchy weights, purpose multipliers, safety dominance, …) so the editable
  setup UI shows realistic density; the algorithm ignores edited values in P1.
- **Family markers**: `family: service_selector`, `kind: service_selector` — the
  trigger `PackageRegistry` skips these; the `ProposalPackageRegistry` owns them.

When P5 lands, its frozen manifest supersedes this mock's representative set and
its `evaluate` performs the real `service_fit` computation behind the same
contract — with no change to the screen or the boundaries.
