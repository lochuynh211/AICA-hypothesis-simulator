#!/usr/bin/env node
/**
 * inline-data — fold dist/aica-data.js into dist/index.html.
 *
 * Only for the single-file target. public/ assets are copied verbatim and are
 * never bundled, so vite-plugin-singlefile leaves the external <script src>
 * alone; without this step `build:singlefile` quietly emits two files.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = /<script src="\.\/aica-data\.js"><\/script>/

export function inlineDataScript(html, js) {
  if (!TAG.test(html)) {
    throw new Error('index.html has no <script src="./aica-data.js"> tag to inline')
  }
  // The payload is already </script>-escaped by build-data.mjs.
  return html.replace(TAG, `<script>${js}</script>`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const htmlPath = join(dist, 'index.html')
  const jsPath = join(dist, 'aica-data.js')
  if (!existsSync(jsPath)) {
    console.error(`✗ ${jsPath} not found — run build:data before the vite build`)
    process.exit(1)
  }
  writeFileSync(htmlPath, inlineDataScript(readFileSync(htmlPath, 'utf8'), readFileSync(jsPath, 'utf8')), 'utf8')
  rmSync(jsPath)
  console.log('✓ inlined aica-data.js into dist/index.html')
}
