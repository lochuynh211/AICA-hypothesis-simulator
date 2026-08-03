import { describe, it, expect } from 'vitest'
import { DIRS, FILES, PROTECTED, EXCLUDE, RESTORE_FROM_GIT, findDirtyRestorePaths } from '../scripts/sync-from-app.mjs'

describe('sync configuration', () => {
  it('syncs lib/ — five Trigger components import from it', () => {
    expect(DIRS).toContain('lib')
  })

  it('excludes surfaces whose clients do not exist in htmlapp yet', () => {
    for (const p of [
      'components/proposal',
      'components/merged',
      'components/review',
      'state/appMode.tsx',
      'state/proposalStore.ts',
      'state/mergedCoordinator.tsx',
      'state/reviewStore.tsx',
      'state/languageBridges.tsx',
      'replay/mergedReplaySource.ts',
      'lib/review/chains.ts',
      'lib/review/checkpoints.ts',
    ]) {
      expect(EXCLUDE, `${p} must be excluded until its client is ported`).toContain(p)
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
