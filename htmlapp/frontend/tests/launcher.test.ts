import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, get, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { mimeType, createRequestListener, openBrowser, resolveWithinRoot } from '../../launch.mjs'

/**
 * These tests exercise the launcher the way the brief requires: bind a
 * port, request, assert, close — never a real browser. `createRequestListener`
 * is the same function `launch.mjs`'s own server uses (imported straight
 * from the script, not reimplemented here), so this is the actual request
 * path, not a stand-in for it.
 */

function get_(port: number, path: string): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolvePromise, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolvePromise({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    }).on('error', reject)
  })
}

describe('mimeType', () => {
  it('maps every extension the launcher exists to serve correctly', () => {
    // A wrong Content-Type on the module script reproduces the exact
    // file:// failure this launcher exists to work around — asserted as
    // exact strings, not just "is defined", so a regression to e.g.
    // text/plain fails loudly here rather than in a browser.
    expect(mimeType('index.html')).toBe('text/html; charset=utf-8')
    expect(mimeType('assets/App-abc123.js')).toBe('text/javascript; charset=utf-8')
    expect(mimeType('assets/index-abc123.css')).toBe('text/css; charset=utf-8')
    expect(mimeType('data/some.json')).toBe('application/json; charset=utf-8')
    expect(mimeType('fonts/some.woff2')).toBe('font/woff2')
  })

  it('is case-insensitive on extension', () => {
    expect(mimeType('INDEX.HTML')).toBe('text/html; charset=utf-8')
  })

  it('falls back to a binary type for an unknown extension, not text/plain', () => {
    expect(mimeType('data.bin')).toBe('application/octet-stream')
  })
})

describe('createRequestListener — serving a fixture dist/', () => {
  let dir: string
  let server: Server
  let port: number

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'launcher-test-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>fixture</title>')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'app.js'), 'export const x = 1;')
    writeFileSync(join(dir, 'assets', 'style.css'), 'body { color: red; }')
    // A secret file OUTSIDE the served root, used by the traversal test below.
    writeFileSync(join(dir, '..', `${dir.split('/').pop()}-secret.txt`), 'top secret')

    server = createServer(createRequestListener(dir))
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(dir, '..', `${dir.split('/').pop()}-secret.txt`), { force: true })
  })

  it('serves index.html at / with the correct content type and body', async () => {
    const res = await get_(port, '/')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.body).toContain('fixture')
  })

  it('serves index.html by exact path too', async () => {
    const res = await get_(port, '/index.html')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('serves a JS asset with a JS content type — the failure this launcher exists to avoid', async () => {
    const res = await get_(port, '/assets/app.js')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(res.body).toBe('export const x = 1;')
  })

  it('serves a CSS asset with a CSS content type', async () => {
    const res = await get_(port, '/assets/style.css')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8')
  })

  it('404s a missing file instead of throwing', async () => {
    const res = await get_(port, '/does-not-exist.js')
    expect(res.statusCode).toBe(404)
  })

  it('refuses to serve a file outside the root via a path-traversal request', async () => {
    const secretName = `${dir.split('/').pop()}-secret.txt`
    const res = await get_(port, `/../${secretName}`)
    expect(res.body).not.toBe('top secret')
    expect([403, 404]).toContain(res.statusCode)
  })
})

describe('openBrowser', () => {
  // These exercise the LAUNCHER'S OWN guard (resolveWithinRoot), injected with
  // path.win32 so a POSIX runner can test win32 semantics. An earlier version of
  // this block asserted against path.win32 directly and therefore proved a property
  // of node:path rather than of launch.mjs — swapping the guard's operand order
  // left it green. These fail when that order is swapped.
  it('resolveWithinRoot contains percent-encoded backslash traversal under win32', async () => {
    const { win32 } = await import('node:path')
    const root = 'C:\\srv\\dist'
    for (const raw of ['/..%5c..%5cwindows', '/%2e%2e%5cboot.ini', '/..%2f..%2fetc/passwd']) {
      const resolved = resolveWithinRoot(root, decodeURIComponent(raw), win32)
      expect(resolved, `${raw} escaped`).not.toBeNull()
      expect(resolved!.startsWith(win32.resolve(root) + win32.sep)).toBe(true)
    }
  })

  it('resolveWithinRoot contains traversal under posix too', async () => {
    const { posix } = await import('node:path')
    const root = '/srv/dist'
    for (const raw of ['/../../etc/passwd', '/..%2f..%2fetc/passwd']) {
      const resolved = resolveWithinRoot(root, decodeURIComponent(raw), posix)
      expect(resolved, `${raw} escaped`).not.toBeNull()
      expect(resolved!.startsWith('/srv/dist/')).toBe(true)
    }
  })

  it('picks the platform opener command without throwing, and never lets a spawn failure escape', () => {
    const calls: Array<{ cmd: string; args: string[] }> = []
    const fakeSpawn = (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      return { on: () => {}, unref: () => {} } as unknown as ReturnType<typeof import('node:child_process').spawn>
    }
    expect(() => openBrowser('http://localhost:8080/', fakeSpawn as never)).not.toThrow()
    expect(calls).toHaveLength(1)
    expect(calls[0].args.at(-1)).toBe('http://localhost:8080/')
  })
})
