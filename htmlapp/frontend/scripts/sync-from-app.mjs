// Refresh the copied presentation layer from app/frontend/src.
// NEVER overwrites the offline-specific seam: api/client.ts, api/types.ts,
// engine/, data/, storage/, config.ts, App.tsx, or any RESTORE_FROM_GIT
// path. Run before cutting a bundle to pick up UX fixes.
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
const RESTORE_FROM_GIT = [
  'src/components/playback/timelineData.ts',
  // htmlapp-only: owns the data-registry boot-guard UI; no counterpart in
  // app/frontend, so a sync of components/ deletes it outright.
  'src/components/layout/DataErrorScreen.tsx',
]

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
  'api/proposalClient.ts',
  'api/mergedClient.ts',
  'replay/mergedReplaySource.ts',
]

// Only run the copy/exclude/restore/tsc body when this file is executed
// directly (`node scripts/sync-from-app.mjs` / `npm run sync`), not when it
// is imported — e.g. by tests asserting on DIRS/FILES/PROTECTED/EXCLUDE.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
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
  const repoRoot = resolve(here, '..', '..', '..')
  for (const rel of RESTORE_FROM_GIT) {
    const gitPath = `htmlapp/frontend/${rel}`
    execSync(`git checkout HEAD -- "${gitPath}"`, { cwd: repoRoot, stdio: 'inherit', shell: true })
    console.log(`restored    ${rel}  (from git HEAD)`)
  }

  console.log('\nrunning tsc --noEmit --project tsconfig.authored.json to verify the synced tree compiles...')
  // Use shell:true so npx resolves correctly on all platforms (Windows/Linux/macOS).
  execSync('npx tsc --noEmit --project tsconfig.authored.json', {
    cwd: resolve(here, '..'),
    stdio: 'inherit',
    shell: true,
  })
  console.log('✓ synced tree typechecks')
}
