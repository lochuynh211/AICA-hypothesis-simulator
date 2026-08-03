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

// Not-yet-ported surfaces (P2 proposal, P3 merged): copied by cpSync below,
// removed here so tsc cannot break on clients that don't exist in htmlapp yet.
export const EXCLUDE = [
  'components/proposal',
  'components/merged',
  // Added by feature 023 after the P1 exclusion list was written; imports
  // mergedClient and lib/review, so it cannot compile until C5 lands.
  'components/review',
  'state/appMode.tsx',
  'state/proposalStore.ts',
  'state/mergedCoordinator.tsx',
  'state/reviewStore.tsx',
  'state/languageBridges.tsx',
  'replay/mergedReplaySource.ts',
  // Added when `lib` was first synced in (C1b sync-drift absorption): these
  // two import mergedClient/proposalClient directly and exist upstream only
  // to serve components/review and components/merged (both already
  // excluded above) — nothing else in htmlapp imports them. Without this,
  // `npm run sync`'s own tsc check breaks on a clean sync.
  'lib/review/chains.ts',
  'lib/review/checkpoints.ts',
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
