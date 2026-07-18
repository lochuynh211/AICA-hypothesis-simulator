/**
 * MergedShell — Combined Simulator shell (020 Task 6).
 *
 * 20:60:20 three-panel layout (`.merged-shell`, styled in app.css) reusing
 * the existing `.left-panel`/`.center-panel`/`.right-panel` classes from the
 * Trigger Simulator's `.app-shell`. Panels are currently stubs —
 * `MergedSetupPanel` / `MergedCenterPanel` / `MergedLogPanel` — the real
 * panels land in later 020 tasks once `MergedCoordinatorProvider` (Task 7)
 * mounts both stores' concerns.
 */
import MergedSetupPanel from './MergedSetupPanel'
import MergedCenterPanel from './MergedCenterPanel'
import MergedLogPanel from './MergedLogPanel'

export default function MergedShell(): JSX.Element {
  return (
    <div className="merged-shell" data-testid="merged-shell">
      <div className="left-panel">
        <MergedSetupPanel />
      </div>
      <div className="center-panel">
        <MergedCenterPanel />
      </div>
      <div className="right-panel">
        <MergedLogPanel />
      </div>
    </div>
  )
}
