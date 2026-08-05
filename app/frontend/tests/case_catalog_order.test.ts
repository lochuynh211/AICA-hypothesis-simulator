// app/frontend/tests/case_catalog_order.test.ts
/**
 * Picker visibility + ordering — `listCases()` offers EXACTLY the four UC demo
 * cases, in the fixed sequence UC-01-01 -> UC-01-02 -> UC-03-01 -> UC-04-01.
 * The C-01…C-06 algorithm-probe cases are hidden from the picker (they stay
 * committed and resolvable by id — see `getCase` — but are not coherent
 * end-to-end demos, so they are not listed). Visibility and order both live in
 * the caseCatalog comparator, not in the case JSON (the schema is strict), so
 * this guards the comparator directly.
 */
import { describe, it, expect } from 'vitest'
import { listCases, getCase } from '../src/lib/review/caseCatalog'

describe('listCases visibility + ordering', () => {
  const UC_ORDER = [
    'case-uc01-01-oshikatsu-c',
    'case-uc01-02-commuter-b',
    'case-uc03-01-monotony-a',
    'case-uc04-01-longhaul-d',
  ]

  it('lists EXACTLY the four UC demo cases, in the fixed sequence', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toEqual(UC_ORDER)
  })

  it('hides every C-case from the picker', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids.some((id) => id.startsWith('case-c0'))).toBe(false)
  })

  it('still resolves a hidden C-case by id, so a stale selection or replay is never null', () => {
    // Hidden from the list, but NOT gone: getCase must still map it to its real
    // case so a run-log replay or feedback filed against it keeps its title.
    const hidden = getCase('case-c01-alert-daytime-control')
    expect(hidden).not.toBeNull()
    expect(hidden!.case_id).toBe('case-c01-alert-daytime-control')
  })
})
