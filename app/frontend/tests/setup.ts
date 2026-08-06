import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'

// jsdom (this project's test environment) does not implement the Web
// Storage API — `typeof localStorage === 'undefined'` and
// `window.localStorage` is undefined too. Several tests (e.g.
// key_safety.test.tsx, map.test.tsx) rely on a REAL, working
// localStorage/sessionStorage to assert the app never leaks a maps key into
// web storage: they call `.clear()` in `beforeEach`, then later read back
// via `getItem`/`length`/`key(i)` to prove nothing was written. A no-op stub
// would make those assertions pass vacuously, defeating the point of the
// test — so this is a genuine in-memory Storage implementation, not a stub.
class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  get length(): number {
    return this.store.size
  }
}

function installStorage(propertyName: 'localStorage' | 'sessionStorage') {
  if (typeof (globalThis as Record<string, unknown>)[propertyName] !== 'undefined') {
    return
  }
  const instance = new MemoryStorage()
  Object.defineProperty(globalThis, propertyName, {
    value: instance,
    configurable: true,
    writable: true,
  })
  if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>)[propertyName] === 'undefined') {
    Object.defineProperty(window, propertyName, {
      value: instance,
      configurable: true,
      writable: true,
    })
  }
}

installStorage('localStorage')
installStorage('sessionStorage')

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
