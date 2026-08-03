import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * These tests assert the *wiring* in package.json's scripts block, not just
 * what a build happens to emit. A comment claiming `build:customer` invokes
 * the single-file path is not evidence; the literal script string is. The
 * regressions this guards against are both real: `build:customer` used to
 * alias straight to the multi-file `build` (a blank page at file://), and a
 * naive fix could re-widen the `npm run build` match to swallow
 * `build:singlefile`/`build:customer` too.
 */

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'))
const scripts: Record<string, string> = pkg.scripts

// Matches "npm run build" only when NOT followed by ":" — so it flags a bare
// `npm run build` invocation without also matching `npm run build:singlefile`
// or `npm run build:customer`.
const INVOKES_BARE_BUILD = /npm run build(?!:)/

describe('build:customer wiring', () => {
  it('gates on check-customer-config.mjs before doing anything else', () => {
    expect(scripts['build:customer']).toMatch(/^node scripts\/check-customer-config\.mjs\b/)
  })

  it('invokes the single-file build, not the multi-file one', () => {
    expect(scripts['build:customer']).toMatch(/npm run build:singlefile\b/)
    // The old wiring aliased to the multi-file build and blank-paged at
    // file://. If this ever regresses back to a bare `npm run build`, this
    // assertion — not a passing build, not a comment — must catch it.
    expect(scripts['build:customer']).not.toMatch(INVOKES_BARE_BUILD)
  })

  it('runs the customer-config gate before the single-file build, not after', () => {
    const s = scripts['build:customer']
    const gateIdx = s.indexOf('check-customer-config.mjs')
    const buildIdx = s.indexOf('build:singlefile')
    expect(gateIdx).toBeGreaterThanOrEqual(0)
    expect(buildIdx).toBeGreaterThan(gateIdx)
  })

  it('packages the single-file output with zip-dist.mjs, after the build', () => {
    const s = scripts['build:customer']
    const buildIdx = s.indexOf('build:singlefile')
    const zipIdx = s.indexOf('zip-dist.mjs')
    expect(zipIdx).toBeGreaterThan(buildIdx)
  })
})

describe('build (multi-file) stays intact as the served-mode extra', () => {
  it('still runs a plain vite build, not the singlefile flag', () => {
    expect(scripts['build']).toMatch(/vite build/)
    expect(scripts['build']).not.toMatch(/HTMLAPP_SINGLEFILE/)
  })

  it('still checks size without --single (the app/data split path)', () => {
    expect(scripts['build']).toMatch(/check-size\.mjs(?!\s+--single)/)
  })

  it('is not aliased away by build:customer — build:customer never calls plain "npm run build"', () => {
    expect(scripts['build:customer']).not.toMatch(INVOKES_BARE_BUILD)
  })
})

describe('build:singlefile is unchanged by the customer wiring', () => {
  it('still sets the singlefile flag and checks size with --single', () => {
    expect(scripts['build:singlefile']).toMatch(/HTMLAPP_SINGLEFILE=1/)
    expect(scripts['build:singlefile']).toMatch(/check-size\.mjs --single/)
  })
})
