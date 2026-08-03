import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyOverrides, InvalidOverrideError, type WorldDoc } from '../src/engine/proposal/world_overrides'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * These tests verify the TS PORT'S OWN error-handling logic — NOT parity
 * (see `proposal_world_port.test.ts` for parity, byte-for-byte replay of
 * `apply_overrides`' captured success + raise cases against the real
 * Python function).
 *
 * `applyOverrides` raises `InvalidOverrideError` for several distinct
 * conditions (mirroring `_split_path` / `_get_at_path` / `_set_at_path` /
 * the structural re-validate / the catalog-reference checks in
 * `services/world_clone_store.py`). This file directly asserts every one —
 * see `world_overrides.ts`'s module doc and the task report for which of
 * these are ALSO golden-captured (parity-verified message content) versus
 * TS-logic only (the empty-path case, which has NO real Python call path at
 * all — see below — and the two `_set_at_path`-own-message branches, which
 * are reachable only via a rare same-call multi-override interaction that
 * Python's own test suite (`test_p7_apply_overrides.py`) does not construct
 * either).
 */

const worldValidationFixture = loadFixture('world_validation')
const BASE_WORLD: WorldDoc = worldValidationFixture.input.cases.find(
  (c: any) => c.name === 'valid_world_no_issues',
).world

const REAL_CATALOG = (() => {
  const datasetId = worldValidationFixture.input.dataset_id as string
  const path = resolve(__dirname, '..', '..', '..', 'proposal_contracts', 'dataset', datasetId, 'catalog.json')
  return JSON.parse(readFileSync(path, 'utf8'))
})()

function expectInvalidOverride(fn: () => unknown, code: string, messagePattern: RegExp): void {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, 'expected applyOverrides() to throw').toBeInstanceOf(InvalidOverrideError)
  const err = thrown as InvalidOverrideError
  expect(err.issues.length).toBeGreaterThan(0)
  expect(err.issues[0].code).toBe(code)
  expect(err.issues[0].message).toMatch(messagePattern)
}

describe('applyOverrides — InvalidOverrideError raise conditions (TS-port logic, not parity)', () => {
  it('rejects an empty path (code: empty_path) — NO real Python call path reaches this: FieldOverride\'s own path_non_empty field validator intercepts an empty path before _split_path ever runs, for both a raw dict input and a directly-constructed instance (verified: FieldOverride(path="") raises at construction). This port has no equivalent pre-validation layer upstream, so its OWN splitPath guard is the sole, deliberate gate.', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: '', value: 1 }]),
      'empty_path',
      /Override path must not be empty\./,
    )
  })

  it('rejects a malformed path segment (code: malformed_path)', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'situation.drowsiness_level[bad]', value: 10 }]),
      'malformed_path',
      /Malformed override path segment: 'drowsiness_level\[bad\]'\./,
    )
  })

  it('rejects a malformed path with an empty segment (double dot)', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'situation..drowsiness_level', value: 10 }]),
      'malformed_path',
      /Malformed override path segment: ''\./,
    )
  })

  it('rejects an unknown top-level path (code: unknown_override_path, "before" read)', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'situation.no_such_field', value: 1 }]),
      'unknown_override_path',
      /no such field 'no_such_field'/,
    )
  })

  it('rejects an unknown nested path through an existing dict', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'driver_profile.oshi_artists[0].no_such_field', value: 1 }]),
      'unknown_override_path',
      /no such field 'no_such_field'/,
    )
  })

  it('rejects a list index out of range on the "before" read (generic message, int token reprs bare)', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'driver_profile.oshi_artists[99].artist_id', value: 'x' }]),
      'unknown_override_path',
      /no such field 99/,
    )
  })

  it('rejects a value that fails structural re-validation (code: the pydantic-mirrored error type, e.g. less_than_equal)', () => {
    expectInvalidOverride(
      () => applyOverrides(BASE_WORLD, [{ path: 'situation.drowsiness_level', value: 999 }]),
      'less_than_equal',
      /Input should be less than or equal to 100/,
    )
  })

  it('rejects a dangling catalog reference when a catalog IS supplied', () => {
    expectInvalidOverride(
      () =>
        applyOverrides(
          BASE_WORLD,
          [{ path: 'driver_profile.oshi_artists[0].artist_id', value: 'synthetic-artist-DOES-NOT-EXIST' }],
          { catalog: REAL_CATALOG },
        ),
      'unknown_catalog_reference',
      /isn't in this dataset's catalog/,
    )
  })

  it('rejects a dangling catalog reference (unresolvable_catalog) when NO catalog is supplied but the world has references', () => {
    expectInvalidOverride(
      () =>
        applyOverrides(BASE_WORLD, [
          { path: 'driver_profile.oshi_artists[0].artist_id', value: 'synthetic-artist-DOES-NOT-EXIST' },
        ]),
      'unresolvable_catalog',
      /no catalog was supplied/,
    )
  })

  it('_setAtPath\'s own "not an object" branch: a PRIOR override in the same call replaces a dict-typed container with a string, and a LATER override in the same call targets a dict-key path through it', () => {
    // Python allows indexing a str by int (`"hello"[0]` == "h"), so the
    // second override's PARENT traversal (tokens[:-1]) still "succeeds" even
    // though the container is no longer a dict — `_set_at_path`'s own check
    // (isinstance(node, dict)) is what actually catches it, not the parent
    // traversal. This is a genuinely rare multi-override interaction —
    // Python's own test_p7_apply_overrides.py never constructs it either.
    expectInvalidOverride(
      () =>
        applyOverrides(BASE_WORLD, [
          { path: 'driver_profile.oshi_artists[0]', value: 'not-a-dict-anymore' },
          { path: 'driver_profile.oshi_artists[0].artist_id', value: 'x' },
        ]),
      'unknown_override_path',
      /not an object at 'artist_id'/,
    )
  })

  it('_setAtPath\'s own "list index out of range" branch: a PRIOR override replaces a list-typed container with a string, and a LATER override in the same call targets an index into it', () => {
    const worldWith4OshiArtists: WorldDoc = JSON.parse(JSON.stringify(BASE_WORLD))
    const profile = worldWith4OshiArtists.driver_profile as Record<string, unknown>
    const originalArtist = (profile.oshi_artists as unknown[])[0]
    // Four entries so index 3 is valid in the ORIGINAL (unmutated) structure
    // — the "before" read (always against the untouched base) must succeed
    // for _set_at_path's own distinct check to be the thing that fires.
    profile.oshi_artists = [originalArtist, originalArtist, originalArtist, originalArtist]

    expectInvalidOverride(
      () =>
        applyOverrides(worldWith4OshiArtists, [
          { path: 'driver_profile.oshi_artists', value: 'hello' },
          { path: 'driver_profile.oshi_artists[3]', value: { artist_id: 'x' } },
        ]),
      'unknown_override_path',
      /list index 3 out of range/,
    )
  })
})
