// app/frontend/tests/case_catalog_order.test.ts
/**
 * Picker ordering — the four UC demo cases must lead, in the fixed sequence
 * UC-01-01 -> UC-01-02 -> UC-03-01 -> UC-04-01, with every other case
 * (C-01…C-06) below in case_id order. Ordering lives in the caseCatalog
 * comparator, not in the case JSON (the schema is strict), so this guards the
 * comparator directly.
 */
import { describe, it, expect } from 'vitest'
import { listCases } from '../src/lib/review/caseCatalog'

describe('listCases ordering', () => {
  const UC_ORDER = [
    'case-uc01-01-oshikatsu-c',
    'case-uc01-02-commuter-b',
    'case-uc03-01-monotony-a',
    'case-uc04-01-longhaul-d',
  ]

  it('lists the four UC demo cases first in the fixed sequence', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids.slice(0, UC_ORDER.length)).toEqual(UC_ORDER)
  })

  it('orders every remaining case after the UC block, by case_id', () => {
    const ids = listCases().map((c) => c.case_id)
    const rest = ids.slice(UC_ORDER.length)
    expect(rest.every((id) => !UC_ORDER.includes(id))).toBe(true)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })
})
