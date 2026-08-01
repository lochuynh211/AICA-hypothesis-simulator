import { describe, it, expect } from 'vitest'
import { inlineDataScript } from '../scripts/inline-data.mjs'

const HTML = `<!doctype html><html><body><div id="root"></div><script src="./aica-data.js"></script><script type="module">1</script></body></html>`

describe('inlineDataScript', () => {
  it('replaces the external tag with an inline one', () => {
    const out = inlineDataScript(HTML, 'window.__AICA_DATA__ = Object.freeze({})\n')
    expect(out).not.toContain('src="./aica-data.js"')
    expect(out).toContain('window.__AICA_DATA__')
  })

  it('keeps the data script before the app module', () => {
    const out = inlineDataScript(HTML, 'window.__AICA_DATA__ = 1')
    expect(out.indexOf('__AICA_DATA__')).toBeLessThan(out.indexOf('type="module"'))
  })

  it('throws when the tag is absent, rather than silently shipping a broken build', () => {
    expect(() => inlineDataScript('<html><body></body></html>', 'x')).toThrow(/aica-data\.js/)
  })
})
