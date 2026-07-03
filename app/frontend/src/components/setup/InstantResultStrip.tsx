/**
 * InstantResultStrip (feature 009, FE1 stub — implemented by FE4).
 *
 * Full-width bottom strip of the new setup screen (others/aica_setup_screen_uiux.md):
 * renders the headless-run outcome from the latest InstantResult (score
 * curve + threshold line, segment bands, fire/rest/completion markers, the
 * "Fired: …" / "No trigger — …" result line, the seed+overrides config chip,
 * and the "Open full run" button that freezes the current setup into a real
 * run-plan + run (superseding the retired PlanPreview's Preview/Start flow).
 *
 * Contract (no props — store-driven, matching every other setup/* editor):
 *   Reads:
 *     - state.instantResult — the latest InstantResult from POST
 *       /runs/preview (see useRunPreview in state/runStore.ts), or null
 *       before the first preview resolves.
 *     - state.previewLoading — true while a debounced preview is in flight.
 *     - state.previewError — message from the most recent failed preview.
 *     - state.runSeed — the seed chip (e.g. "seed 42 🎲").
 *     - state.editedHyperparameters (+ the package manifest defaults, via
 *       selectOverridesDiff) — the "N overrides" chip count.
 *   Dispatches:
 *     - REROLL_SEED — the 🎲 re-roll affordance (draws a fresh run_seed;
 *       useRunPreview picks up the change and re-fires the preview).
 *     - "Open full run" should reuse the createRunPlan → createRun flow
 *       (see PlanPreview.tsx) with the current setup, then let RUN_CREATED's
 *       existing auto-transition (viewMode → 'review') open the full review
 *       screen — no new transition mechanism needed.
 *
 * useRunPreview() (called once from SetupScreen) is what actually populates
 * instantResult/previewLoading/previewError — this component only renders
 * that state; it does not call the preview endpoint itself.
 */
export default function InstantResultStrip() {
  return (
    <div data-testid="instant-result-strip" style={{ fontSize: '0.85em', color: '#6b7280' }}>
      Instant result — implemented in FE4.
    </div>
  )
}
