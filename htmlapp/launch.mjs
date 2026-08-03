#!/usr/bin/env node
/**
 * launch — serve dist/ (the multi-file build) over http://localhost and
 * open it in a browser.
 *
 * WHY THIS EXISTS: `npm run build` (multi-file) emits an ES-module entry
 * script — `<script type="module" crossorigin src="./assets/index-*.js">`
 * — and browsers enforce same-origin rules on module scripts. Opened
 * directly via `file://.../dist/index.html`, the document's origin is
 * `null`, the module fetch is refused, and the result is a blank page.
 *
 * That is NOT a defect in the offline deliverable. `npm run build:customer`
 * (== `build:singlefile`) produces a self-contained `dist/index.html` (plus
 * an inert-at-file:// sibling `backend.worker-*.js` chunk — see
 * check-size.mjs / zip-dist.mjs for why it ships alongside) that opens
 * correctly by double-click, no server involved. If that is what you built,
 * you do not need this script at all.
 *
 * This launcher exists solely to make the *other* build — the multi-file
 * one, which cannot be opened from file:// — openable anyway, by giving it
 * a real http origin.
 *
 * Usage (from htmlapp/frontend/):
 *   npm run build            # produces the multi-file dist/ this serves
 *   npm run launch           # serves it and opens a browser
 *   PORT=9000 npm run launch # pick a specific port (default 8080)
 *
 * Node standard library only (node:http, node:fs, node:child_process) —
 * no new dependency, per the project's no-new-dependencies constraint. A
 * plain Node script rather than a shell script because Node is already a
 * hard requirement to build this project at all, and one file runs
 * unmodified on Linux, macOS and Windows, where an .sh launcher would not.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import nodePath, { extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))

// The multi-file build's output — vite's plain `npm run build`, not
// `build:singlefile`/`build:customer`. Both write to the same `dist/`
// directory, so this launcher happily serves whichever was built last; its
// reason for existing is specifically the multi-file case (see header).
export const DIST_DIR = resolve(here, 'frontend', 'dist')
export const DEFAULT_PORT = 8080

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}

/**
 * Content-Type for a file path, keyed by extension. A wrong Content-Type on
 * the module script (`.js`) is exactly the failure this launcher exists to
 * avoid, so this table is the load-bearing part of the whole file — see
 * launcher.test.ts for a test that mutates it and asserts the gate notices.
 * Unknown extensions fall back to a generic binary type rather than
 * guessing text/plain (which would break binary assets like fonts/images).
 */
export function mimeType(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Build a plain `(req, res) => void` request listener that serves static
 * files out of `rootDir`. Factored out and exported so tests can point it
 * at a throwaway fixture directory instead of a real dist/ build, and so
 * request/response behavior can be asserted directly (bind, request,
 * assert, close) without spawning a browser.
 */
/**
 * Resolve a request pathname inside `root`, or return null if it escapes.
 *
 * Exported and parameterised by the path module SO THE GUARD ITSELF CAN BE
 * TESTED UNDER win32 SEMANTICS FROM A POSIX RUNNER. An earlier revision kept
 * this inline; the win32 test that "covered" it asserted against path.win32
 * directly rather than against this code, so swapping the operand order left
 * the test green — a test that proved a property of node:path, not of the
 * launcher.
 *
 * THE ORDER IS THE GUARD: normalize(pathname) THEN join. `pathname` always
 * starts with '/' (URL parsing), so normalizing it first collapses every '..'
 * against that leading root and cannot climb above it; `join` (not `resolve`)
 * then attaches the result to root, and join never lets a leading-slash
 * segment override the base. join-then-normalize escapes on both platforms.
 */
export function resolveWithinRoot(root, pathname, P = nodePath) {
  const base = P.resolve(root)
  const filePath = P.resolve(P.join(base, P.normalize(pathname)))
  if (filePath !== base && !filePath.startsWith(base + P.sep)) return null
  return filePath
}

export function createRequestListener(rootDir) {
  const root = resolve(rootDir)
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        let pathname = decodeURIComponent(url.pathname)
        if (pathname.endsWith('/')) pathname += 'index.html'

        // `pathname` always starts with '/' (from URL parsing above), so
        // normalizing it FIRST collapses any '..' against that leading root
        // and can never climb above it; `join` (not `resolve`) then attaches
        // the result to rootDir, and join never lets a leading-slash segment
        // override the base the way resolve would. THE ORDER IS THE GUARD:
        // normalize(pathname) then join — join-then-normalize would escape.
        //
        // Vectors checked against this exact expression on BOTH platforms'
        // semantics (path.posix and path.win32), all contained:
        //   /../../etc/passwd        -> <root>/etc/passwd
        //   /..%2f..%2fetc/passwd    -> <root>/etc/passwd
        //   /..%5c..%5cwindows       -> <root>/windows      (win32)
        //   /%2e%2e%5cboot.ini       -> <root>/boot.ini     (win32)
        // The percent-encoded BACKSLASH cases matter specifically because
        // decodeURIComponent turns %5c into a separator that win32 honours
        // and POSIX does not — an earlier revision of this comment claimed
        // both platforms were verified while only drive-letter injection had
        // been tried, so those two vectors are now pinned by tests rather
        // than by assertion.
        //
        // The startsWith check below is therefore unreachable through this
        // parsing path today — mutation-tested by deleting it, which changed
        // no test outcome. It stays as a structural guard against a future
        // refactor of how `pathname` is built (e.g. a codepath that stops
        // routing through `new URL()`), not as a currently-exercised gate.
        const filePath = resolveWithinRoot(root, pathname)
        if (filePath === null) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden')
          return
        }

        const st = await stat(filePath).catch(() => null)
        if (!st || !st.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end(`Not found: ${pathname}`)
          return
        }

        const body = await readFile(filePath)
        res.writeHead(200, { 'Content-Type': mimeType(filePath) })
        res.end(body)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }
}

/**
 * Cross-platform "open the user's default browser" by spawning the OS's own
 * opener command, instead of a package (`open`/`opn`) — the
 * no-new-dependencies constraint binds here too. Exported with an injectable
 * `spawnFn` so tests can assert the platform → command mapping without
 * actually spawning a process or opening a real browser. Failure to open
 * (headless environment, missing opener) is reported, never fatal — the
 * server keeps running and prints the URL either way.
 */
export function openBrowser(url, spawnFn = spawn) {
  const platform = process.platform
  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  try {
    const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {
      console.warn(`Could not auto-open a browser — open ${url} manually.`)
    })
    child.unref()
  } catch {
    console.warn(`Could not auto-open a browser — open ${url} manually.`)
  }
}

const BANNER = `${'─'.repeat(72)}
htmlapp launcher — served (multi-file) mode

The multi-file build (\`npm run build\`) loads its app code via an ES-module
<script> tag, which browsers refuse from file:// (the document's origin is
null there) — that shows up as a blank page. That is NOT a problem with the
offline deliverable: \`npm run build:customer\` produces a self-contained
dist/index.html that opens correctly by plain double-click, no server
needed. This launcher exists only to give the multi-file build a real http
origin so it can be opened too.
${'─'.repeat(72)}`

function main() {
  if (!existsSync(DIST_DIR)) {
    console.error(
      `✗ ${DIST_DIR} does not exist.\n` +
        '  Run `npm run build` from htmlapp/frontend/ first — this launcher serves\n' +
        '  the multi-file build. For the offline single-file deliverable, run\n' +
        '  `npm run build:customer` instead and open dist/index.html directly —\n' +
        '  no launcher, no server needed.',
    )
    process.exit(1)
  }

  console.log(BANNER)

  const server = createServer(createRequestListener(DIST_DIR))
  const port = Number(process.env.PORT) || DEFAULT_PORT
  server.on('error', (err) => {
    console.error(`✗ failed to start server on port ${port}: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`
    console.log(`✓ serving ${DIST_DIR}\n  at ${url}\n`)
    openBrowser(url)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
