/**
 * AlgorithmFormulationPanel (feature 009, FE1 stub — implemented by FE3).
 *
 * Right editor panel of the new setup screen (others/aica_setup_screen_uiux.md):
 * the selected package's algorithm rendered as its own formulation — feature
 * definitions (cross-linking to SignalsPanel signals), inline editable
 * hyperparameter coefficients inside the formulas, scores reading down to
 * their fire thresholds.
 *
 * Contract (no props — store-driven, matching every other setup/* editor):
 *   Reads:
 *     - state.selectedPackageId — which package's manifest/formulation to render.
 *     - state.editedHyperparameters — current override values (pre-filled
 *       from the package manifest's hyperparameter defaults; see
 *       HyperparameterEditor for the existing band/bool/numeric pattern).
 *     - state.highlightedSignalKey — cross-link highlight; a feature name
 *       referencing this signal key should render highlighted.
 *   Dispatches:
 *     - SET_HYPERPARAMETER — editing an inline coefficient (reuses the
 *       existing action; same shape HyperparameterEditor already dispatches).
 *     - SET_HIGHLIGHTED_SIGNAL — on hover/click of a feature name, so
 *       SignalsPanel can highlight the referenced signal row.
 *   Fetches (own effect):
 *     - getPackage(selectedPackageId) for the manifest (features[],
 *       hyperparameters[], fire_control, trigger_categories) — same call
 *       HyperparameterEditor already makes.
 *
 * NOTE: hyperparameter_overrides sent to POST /runs/preview (see
 * useRunPreview in state/runStore.ts) is read directly from
 * editedHyperparameters — FE3 should only dispatch SET_HYPERPARAMETER for
 * values that actually differ from the manifest default (use
 * selectOverridesDiff from state/runStore.ts to compute the diff for display
 * and to decide what to dispatch).
 */
export default function AlgorithmFormulationPanel() {
  return (
    <div data-testid="algorithm-formulation-panel" style={{ fontSize: '0.85em', color: '#6b7280' }}>
      Algorithm formulation — implemented in FE3.
    </div>
  )
}
