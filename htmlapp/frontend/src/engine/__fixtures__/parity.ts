import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

export function loadFixture(name: string): { input: any; output: any } {
  const path = resolve(here, 'parity', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

const TOL = 1e-9

/** Deep parity check: numbers within 1e-9, everything else exact. */
export function expectParity(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(Math.abs(actual - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(TOL)
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected array`).toBe(true)
    const a = actual as unknown[]
    expect(a.length, `${path}: array length`).toBe(expected.length)
    expected.forEach((v, i) => expectParity(a[i], v, `${path}[${i}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    expect(actual && typeof actual === 'object', `${path}: expected object`).toBeTruthy()
    const a = actual as Record<string, unknown>
    const e = expected as Record<string, unknown>
    expect(Object.keys(a).sort(), `${path}: keys`).toEqual(Object.keys(e).sort())
    for (const k of Object.keys(e)) expectParity(a[k], e[k], `${path}.${k}`)
    return
  }
  expect(actual, path).toBe(expected)
}
