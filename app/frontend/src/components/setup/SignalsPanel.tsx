/**
 * SignalsPanel (feature 009, FE1 stub — implemented by FE2).
 *
 * Left editor panel of the new setup screen (others/aica_setup_screen_uiux.md):
 * Location → Preset → Scenario, then the scenario's signals grouped by tier
 * (fixed / dynamic / simulated), with tier-3 (simulated) signals carrying an
 * ⓘ explainer popover (FE2's InfoPopover) and editable signals carrying a ✎
 * affordance.
 *
 * Contract (no props — store-driven, matching every other setup/* editor):
 *   Reads:
 *     - state.selectedPackageId / selectedScenarioId — via PackageSelector /
 *       ScenarioSelector (reused as-is; see brief).
 *     - state.highlightedSignalKey — cross-link highlight driven by hovering
 *       a feature name in AlgorithmFormulationPanel.
 *   Dispatches:
 *     - SET_HIGHLIGHTED_SIGNAL — on hover/click of a signal row, so
 *       AlgorithmFormulationPanel can mirror the highlight on feature names
 *       that reference that signal.
 *     - Editable-signal edits should update state via whatever action FE2
 *       introduces for signal overrides (e.g. extending SET_PARAMETER /
 *       SET_PROFILE_OVERRIDES, or a new action) — not yet wired in FE1.
 *   Fetches (own effects, like the retired ProfileEditor/TickSecondsEditor):
 *     - getScenario(selectedScenarioId) to read driver_signal_params /
 *       anomaly_signal_params / run_seed_default, fixed scenario fields
 *       (is_night, familiar_route, child_passenger), etc.
 */
export default function SignalsPanel() {
  return (
    <div data-testid="signals-panel" style={{ fontSize: '0.85em', color: '#6b7280' }}>
      Scenario &amp; Signals — implemented in FE2.
    </div>
  )
}
