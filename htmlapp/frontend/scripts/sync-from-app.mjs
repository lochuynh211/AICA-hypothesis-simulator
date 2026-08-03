// Refresh the copied presentation layer from app/frontend/src.
// NEVER overwrites the offline-specific seam: api/client.ts, api/types.ts,
// engine/, data/, storage/, config.ts, App.tsx, or any RESTORE_FROM_GIT
// path. Run before cutting a bundle to pick up UX fixes.
// Aborts before touching anything if a RESTORE_FROM_GIT path has
// uncommitted changes — see findDirtyRestorePaths below.
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const APP = resolve(here, '..', '..', '..', 'app', 'frontend', 'src')
const OUT = resolve(here, '..', 'src')

// Whole directories copied verbatim.
// `lib` is required: components/setup/situation/FixedConditionsSection.tsx,
// components/setup/formulationTemplates.ts, components/map/MapSurface.tsx,
// components/map/FallbackRouteMap.tsx and components/playback/ScoreTimeline.tsx
// all import from lib/ — without it the tsc gate below fails on a clean sync.
export const DIRS = ['components', 'state', 'i18n', 'styles', 'replay', 'lib']
// Individual files copied verbatim.
export const FILES = ['vite-env.d.ts']
// Guard: these must never be overwritten by the sync.
// api/types.ts is htmlapp-specific (superset of upstream; adds fields used by
// engine/recovery.ts that are not yet in app/frontend/src/api/types.ts).
// main.tsx is htmlapp-specific — it owns the data-registry boot guard.
export const PROTECTED = [
  'api/client.ts',
  'api/types.ts',
  // Re-implemented over the worker RPC seam (feature 026, htmlapp Combined
  // export, slice C5 Task 1) — NOT a sync of the app's copy. See
  // src/api/mergedClient.ts's own module doc.
  'api/mergedClient.ts',
  // Re-implemented over the worker RPC seam (feature 026, htmlapp Combined
  // export, slice C5 Task 2) — NOT a sync of the app's copy. See
  // src/api/proposalClient.ts's own module doc.
  'api/proposalClient.ts',
  'engine',
  'data',
  'storage',
  'config.ts',
  'App.tsx',
  'main.tsx',
]

// Files inside synced directories that are htmlapp-maintained overrides
// (upstream added imports the htmlapp cannot use yet, or the file has no
// counterpart upstream at all).  After the bulk copy these are restored from
// git HEAD so the htmlapp version is used instead of whatever the sync left
// behind (a stale copy, or nothing at all if upstream has no such file).
export const RESTORE_FROM_GIT = [
  'src/components/playback/timelineData.ts',
  // htmlapp-only: owns the data-registry boot-guard UI; no counterpart in
  // app/frontend, so a sync of components/ deletes it outright.
  'src/components/layout/DataErrorScreen.tsx',
  // Re-implemented over the generated data registry (feature 026, htmlapp
  // Combined export, slice C5 Task 3b) — NOT a sync of the app's copy. The
  // reference reads cases via `import.meta.glob('@contracts/...')`, an alias
  // htmlapp does not define (and must not: see the file's own module doc).
  // `lib` is a whole-directory DIRS entry, so — unlike api/mergedClient.ts and
  // api/proposalClient.ts, which live outside every DIRS entry and are kept
  // out of the sync by PROTECTED alone — listing this path in PROTECTED
  // would do nothing: PROTECTED is only consulted by the FILES loop below,
  // never by the DIRS bulk-copy. RESTORE_FROM_GIT is the mechanism that
  // actually survives a directory-level sync, so this file's protection
  // lives here instead.
  'src/lib/review/caseCatalog.ts',
]

// Pure decision function: given the RESTORE_FROM_GIT paths and a predicate
// that reports whether a path has uncommitted changes, returns the subset
// that must block the sync. `git checkout HEAD -- <path>` (used to restore
// these paths after the bulk copy) overwrites unconditionally, so any
// uncommitted edit to one of these files would be silently and
// unrecoverably destroyed unless the sync aborts before the copy even
// starts. Kept pure/exported so it is testable without shelling out to git.
export function findDirtyRestorePaths(paths, isDirty) {
  return paths.filter((p) => isDirty(p))
}

// Not-yet-ported surfaces: copied by cpSync below, removed here so tsc
// cannot break on clients that don't exist in htmlapp yet.
//
// C5 Task 3 (htmlapp Combined export) brought the Combined UI in: an
// import-closure walk from `components/merged/MergedShell.tsx` +
// `state/mergedCoordinator.tsx` (the Combined screen's two entry points)
// visited 88 files, and every entry removed below is on that closure.
// `state/appMode.tsx` was the one prior entry the closure did not reach, and
// stayed excluded through Task 3/3b — its only real importer anywhere in
// app/frontend/src is `App.tsx` (`grep -rn "from '.*appMode'"`), which is
// itself PROTECTED (htmlapp owns its own App.tsx) and was not synced at the
// time (a plain text match on the string "appMode" also hits an unrelated
// doc-comment mention in `components/proposal/ProposalShell.tsx` — not an
// import). C5 Task 4 is the task that mounts MergedShell for real and wires
// the owner's "keep the tab structure, but only show Combined" requirement
// through the SAME `AppMode`/`AppModeProvider`/`useAppMode` machinery the
// docker app uses (rather than a bespoke htmlapp-only mode flag), so
// `state/appMode.tsx` is now a genuine dependency of the (still-PROTECTED,
// hand-authored) htmlapp `App.tsx` and is synced verbatim like every other
// file under `state/`. It is REMOVED from EXCLUDE below, not added to
// PROTECTED: `state/appMode.tsx` has no htmlapp-specific divergence from the
// app's copy, so letting the ordinary DIRS bulk-copy carry it (like every
// other unmodified `state/` file) is correct — PROTECTED is reserved for
// files htmlapp re-implements or hand-maintains differently from upstream.
//
// KNOWN, DELIBERATELY-INHERITED BUG in `replay/mergedReplaySource.ts`:
// its per-tick event lookup can never match (`merged_runs.py` builds
// `proposal_event_ids` as `f"{e.event_type}@{e.at}"`, which stringifies a
// `(str, Enum)` mixin with no `__str__` to `"DiscreteEventType.MEMBER@..."`
// under Python 3.11+, while this file's own `eventById` key is built from
// the serialized log's bare `.value` — verified on the live 3.12
// interpreter), so every event falls through to the fallback that buckets
// them all at the run's LAST entry's tick; per-tick replay attribution
// silently does not work. This is synced VERBATIM, bug included: the file
// is not PROTECTED, "the docker app is the behaviour of record" for this
// whole export, and shadowing it with a diverging PROTECTED copy would
// fork htmlapp's replay behavior from upstream's forever (the exact
// permanent-drift risk `RESTORE_FROM_GIT`'s own comment above warns
// against) instead of a real fix landing in `app/frontend` where every
// other consumer of this data would also benefit. Not fixed here.
export const EXCLUDE = [
  // The 15 files below are the STANDALONE Proposal screen's own surfaces
  // (`components/proposal`'s directory-level EXCLUDE was removed above
  // because 19 of its 34 files ARE on the closure — the sections/matrix/
  // explainability components Combined's `panels/sections/*` reuses — but
  // `cpSync` copies the whole directory, so these 15 unreached siblings
  // arrive too, confirmed absent from the closure walk by name). 8 of the
  // 15 directly break `tsconfig.authored.json`'s whole-directory root-file
  // globbing by importing `api/proposalClient.ts` members Task 2
  // deliberately did not port (confirmed unused by every one of the
  // closure's 88 files). The other 7 (CatalogView.tsx,
  // DatasetProvenanceBanner.tsx, EventTimeline.tsx, ModeToggle.tsx,
  // PresetPicker.tsx, ProposalScreen.tsx, ProposalShell.tsx) typecheck fine
  // in isolation but were tried as "leave as dead weight" first and
  // rejected: ProposalScreen.tsx imports the 3 `panels/*` ones below and
  // ProposalShell.tsx imports ProposalRunsScreen.tsx, so excluding only the
  // 8 that error leaves these 7 as dangling root files with unresolvable
  // imports — the cascade is the standalone screen's OWN internal wiring,
  // not something Combined ever touches either way, so the whole 15-file
  // group is excluded together rather than chased one broken import at a
  // time. All 15 are the standalone Proposal screen and its PRE-refactor
  // panels (`panels/sections/*` replaced the 3 `panels/*` ones below,
  // feature 020 extract-and-share) — Combined never reaches any of them.
  'components/proposal/CatalogView.tsx',
  'components/proposal/DatasetProvenanceBanner.tsx',
  'components/proposal/DriverProfilePicker.tsx',
  'components/proposal/EventTimeline.tsx',
  'components/proposal/JourneyActionBar.tsx',
  'components/proposal/ModeToggle.tsx',
  'components/proposal/PresetPicker.tsx',
  'components/proposal/ProposalRunsScreen.tsx',
  'components/proposal/ProposalScreen.tsx',
  'components/proposal/ProposalShell.tsx',
  'components/proposal/RecomputePanel.tsx',
  'components/proposal/SeedPicker.tsx',
  'components/proposal/panels/ContentProposalPanel.tsx',
  'components/proposal/panels/ServiceProposalPanel.tsx',
  'components/proposal/panels/WorldPanel.tsx',
]

// Only run the copy/exclude/restore/tsc body when this file is executed
// directly (`node scripts/sync-from-app.mjs` / `npm run sync`), not when it
// is imported — e.g. by tests asserting on DIRS/FILES/PROTECTED/EXCLUDE.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const repoRoot = resolve(here, '..', '..', '..')

  // Guard, before anything is touched: RESTORE_FROM_GIT paths get force-
  // overwritten by `git checkout HEAD --` later in this run. If a developer
  // has uncommitted edits to one of them right now, that checkout would
  // destroy those edits with no way to get them back. Detect that up front
  // and abort — by the time the copy below has run, the file has already
  // been deleted/replaced, so a check at restore time can no longer tell
  // "wiped by this sync" apart from "the developer had edits".
  const isPathDirty = (rel) => {
    const gitPath = `htmlapp/frontend/${rel}`
    try {
      execSync(`git diff --quiet HEAD -- "${gitPath}"`, { cwd: repoRoot, stdio: 'ignore', shell: true })
      return false
    } catch {
      return true
    }
  }
  const dirty = findDirtyRestorePaths(RESTORE_FROM_GIT, isPathDirty)
  if (dirty.length > 0) {
    console.error('✗ sync aborted: uncommitted changes would be lost in htmlapp-protected files:')
    for (const rel of dirty) console.error(`  - htmlapp/frontend/${rel}`)
    console.error('\nCommit or stash these changes before running npm run sync.')
    process.exit(1)
  }

  for (const d of DIRS) {
    const src = resolve(APP, d)
    const dst = resolve(OUT, d)
    if (!existsSync(src)) continue
    rmSync(dst, { recursive: true, force: true })
    cpSync(src, dst, { recursive: true })
    console.log(`synced dir  ${d}/`)
  }
  for (const f of FILES) {
    const src = resolve(APP, f)
    const dst = resolve(OUT, f)
    if (!existsSync(src)) continue
    if (PROTECTED.some((p) => f === p || f.startsWith(p + '/'))) {
      console.log(`protected   ${f}  (skipped)`)
      continue
    }
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst)
    console.log(`synced file ${f}`)
  }
  console.log(`\nProtected (never synced): ${PROTECTED.join(', ')}`)

  console.log()
  for (const p of EXCLUDE) {
    rmSync(resolve(OUT, p), { recursive: true, force: true })
    console.log(`excluded    ${p}`)
  }

  // Restore htmlapp-maintained overrides from git HEAD.
  console.log()
  for (const rel of RESTORE_FROM_GIT) {
    const gitPath = `htmlapp/frontend/${rel}`
    execSync(`git checkout HEAD -- "${gitPath}"`, { cwd: repoRoot, stdio: 'inherit', shell: true })
    console.log(`restored    ${rel}  (from git HEAD)`)
  }

  console.log('\nrunning npm run typecheck to verify the synced tree compiles...')
  // Goes through scripts/typecheck.mjs, not raw tsc: it filters out a fixed
  // set of known upstream-only errors (see that file's header) that `tsc`
  // itself would otherwise fail this check on — errors htmlapp cannot fix
  // without editing or forking a synced file. Use shell:true so npx/node
  // resolves correctly on all platforms (Windows/Linux/macOS).
  execSync('node scripts/typecheck.mjs', {
    cwd: resolve(here, '..'),
    stdio: 'inherit',
    shell: true,
  })
  console.log('✓ synced tree typechecks')
}
