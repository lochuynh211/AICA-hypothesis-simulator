import { describe, it, expect } from 'vitest'
import { DIRS, FILES, PROTECTED, EXCLUDE, RESTORE_FROM_GIT, findDirtyRestorePaths } from '../scripts/sync-from-app.mjs'

describe('sync configuration', () => {
  it('syncs lib/ — five Trigger components import from it', () => {
    expect(DIRS).toContain('lib')
  })

  it('brought the Combined UI in — feature 026 slice C5 Task 3 removed these from EXCLUDE (all 88 files on the import-closure walk from MergedShell.tsx + mergedCoordinator.tsx)', () => {
    for (const p of [
      'components/proposal',
      'components/merged',
      'components/review',
      'state/proposalStore.ts',
      'state/mergedCoordinator.tsx',
      'state/reviewStore.tsx',
      'state/languageBridges.tsx',
      'replay/mergedReplaySource.ts',
      'lib/review/chains.ts',
      'lib/review/checkpoints.ts',
    ]) {
      expect(EXCLUDE, `${p} is on the Combined closure and must no longer be excluded`).not.toContain(p)
    }
  })

  it('still excludes state/appMode.tsx — the closure never reaches it (its only real importer, App.tsx, is PROTECTED and never synced)', () => {
    expect(EXCLUDE).toContain('state/appMode.tsx')
  })

  it('still excludes the 15 standalone-Proposal-screen files under components/proposal the closure does not reach — cpSync copies the whole directory once its own EXCLUDE entry is gone, so these have to be pruned individually', () => {
    for (const p of [
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
    ]) {
      expect(EXCLUDE, `${p} is not on the Combined closure and must stay excluded`).toContain(p)
    }
  })

  it('never overwrites the offline seam', () => {
    for (const p of ['api/client.ts', 'api/types.ts', 'engine', 'data', 'storage', 'config.ts', 'App.tsx']) {
      expect(PROTECTED).toContain(p)
    }
  })

  it('protects api/mergedClient.ts — feature 026 slice C5 Task 1 re-implements it over the RPC seam, it is not a sync of the app copy', () => {
    expect(PROTECTED).toContain('api/mergedClient.ts')
    expect(EXCLUDE).not.toContain('api/mergedClient.ts')
  })

  it('protects api/proposalClient.ts — feature 026 slice C5 Task 2 re-implements it over the RPC seam, it is not a sync of the app copy', () => {
    expect(PROTECTED).toContain('api/proposalClient.ts')
    expect(EXCLUDE).not.toContain('api/proposalClient.ts')
  })

  it('protects main.tsx — it owns the htmlapp-specific data-registry boot guard', () => {
    expect(PROTECTED).toContain('main.tsx')
  })

  it('does not also list main.tsx in FILES — PROTECTED and FILES must not contradict', () => {
    expect(FILES).not.toContain('main.tsx')
  })

  it('restores DataErrorScreen.tsx from git — it has no counterpart in app/frontend, so a bulk sync of components/ would silently delete it', () => {
    expect(RESTORE_FROM_GIT).toContain('src/components/layout/DataErrorScreen.tsx')
  })
})

describe('findDirtyRestorePaths', () => {
  it('returns only the paths the predicate reports as dirty', () => {
    const dirty = findDirtyRestorePaths(['a', 'b', 'c'], (p) => p === 'b')
    expect(dirty).toEqual(['b'])
  })

  it('returns nothing when every path is clean', () => {
    const dirty = findDirtyRestorePaths(['a', 'b'], () => false)
    expect(dirty).toEqual([])
  })

  it('returns every path when all are dirty', () => {
    const dirty = findDirtyRestorePaths(['a', 'b'], () => true)
    expect(dirty).toEqual(['a', 'b'])
  })
})
