import { describe, it, expect } from 'vitest'
import { DIRS, PROTECTED, EXCLUDE } from '../scripts/sync-from-app.mjs'

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
      'api/proposalClient.ts',
      'api/mergedClient.ts',
      'replay/mergedReplaySource.ts',
    ]) {
      expect(EXCLUDE, `${p} must be excluded until its client is ported`).toContain(p)
    }
  })

  it('never overwrites the offline seam', () => {
    for (const p of ['api/client.ts', 'api/types.ts', 'engine', 'data', 'storage', 'config.ts', 'App.tsx']) {
      expect(PROTECTED).toContain(p)
    }
  })
})
