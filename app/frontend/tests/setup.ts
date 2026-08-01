import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'

// Safety net (feature 025, slice S11): `RankOneSummary`'s trigger tab now
// fetches even when the reviewer's explanation provider is 'off' (via
// `useExplanation`'s 'template' path — see that module's docstring), so any
// test that renders `ReviewColumn`/`MergedShell` with a fire, without
// explicitly mocking `explainTrigger` or `global.fetch` itself, would
// otherwise reach this default and attempt a REAL `fetch()` — jsdom doesn't
// implement `fetch`, so depending on the Node runtime that could throw OR
// actually reach out to a live (possibly nonexistent) server. Reject instead,
// so any unmocked call resolves the same way it always did pre-slice: the
// caller's own `.catch()` settles to an 'error' status and nothing renders.
// A test that DOES care about the fetched content already assigns its own
// `global.fetch = vi.fn(...)` (or mocks `explainTrigger` directly), which
// simply overrides this per-test — see e.g. `client.test.tsx`,
// `proposalClient.test.tsx`, `review_rank_one_summary.test.tsx`.
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.reject(new Error('unmocked fetch() call in test'))) as unknown as typeof fetch
})
