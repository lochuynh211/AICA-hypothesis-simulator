/**
 * Shared cross-link highlight styling for the setup screen.
 *
 * Hovering a signal row (left panel, SignalsPanel) or a feature/formula name
 * (right panel, AlgorithmFormulationPanel) sets `highlightedSignalKey` in the
 * run store; every render site that matches that key paints this background so
 * the source signal and the features that reference it light up together.
 *
 * Yellow (rather than the old pale indigo) so the connection is easy to spot at
 * a glance. Kept in one place so both panels can never drift apart.
 */
export const HIGHLIGHT_BG = '#fde047' // tailwind yellow-300

/** Dark text that stays readable on {@link HIGHLIGHT_BG}. */
export const HIGHLIGHT_FG = '#1e3a8a' // tailwind blue-900
