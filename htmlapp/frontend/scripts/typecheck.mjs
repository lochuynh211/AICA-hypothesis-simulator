// Thin wrapper around `tsc --noEmit --project tsconfig.authored.json`.
//
// WHY THIS EXISTS (why `package.json`'s `typecheck` script doesn't just run
// `tsc` directly):
//
// Four files carry UPSTREAM type errors that are out of scope for htmlapp to
// fix: each reproduces byte-for-byte against app/frontend's own strict
// `tsc --noEmit --project tsconfig.json` (upstream has no typecheck script
// at all, so nothing has ever gated them there either). htmlapp must not
// edit synced files — that diverges htmlapp from upstream and the next
// `npm run sync` reverts it — and must not fork them via `RESTORE_FROM_GIT`
// either, which would permanently fork htmlapp from upstream's own eventual
// fix and silently drop every future upstream change to the file on sync,
// exactly the drift this project exists to keep in check.
//
// The obvious fix — list the four in `tsconfig.authored.json`'s `exclude` —
// does NOT work: TypeScript's `exclude` only prunes which files the
// `include` globs pick up as ROOT files. A file is still fully type-checked
// if another included file imports it, and all four are (LeftContextPanel.tsx
// imports ScenarioBeats.tsx, CenterPlaybackPanel.tsx imports MapSurface.tsx,
// RunsScreen.tsx imports RunLogViewer.tsx, ReplayViewer.tsx/
// RightReviewPanel.tsx import DecisionTracePanel.tsx). Confirmed empirically:
// adding the four to `exclude` changed nothing — same errors, same count.
//
// So this script runs the real, unmodified compiler, then removes
// diagnostics whose file is one of the four below from the report before
// deciding pass/fail. Remove an entry the moment upstream fixes the error it
// names — that is the whole point of naming it instead of a bare path.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * file path (relative, POSIX, as tsc reports it from `root`) -> the ONE
 * specific upstream error it is known to carry. Filtering itself is by path
 * only (matching what `tsconfig.exclude` would mean if it worked here) —
 * the message text is documentation, not part of the match, so it does not
 * go stale if tsc's wording shifts.
 */
export const KNOWN_UPSTREAM_ONLY_ERRORS = {
  'src/components/context/ScenarioBeats.tsx':
    'local motionRoadLabel(..., lang: string) is passed into t(label, lang: UiLanguage) — TS2345, string is not assignable to UiLanguage.',
  'src/components/map/MapSurface.tsx':
    '`window as Record<string, unknown>` in the gm_authfailure handler — TS2352, Window has no string index signature to satisfy the cast.',
  'src/components/runs/RunLogViewer.tsx':
    '`{v.note && (...)}` in JSX, where v.note is typed unknown — TS2322, unknown is not assignable to ReactNode.',
  'src/components/trace/DecisionTracePanel.tsx':
    'RestChoiceRow/AlgorithmErrorRow declare lang: string and pass it into t(label, lang: UiLanguage) — TS2345, the same pattern as ScenarioBeats.tsx.',
}

// A diagnostic block starts with `<path>(<line>,<col>): error TS<code>: <msg>`;
// any following line that is not itself a new diagnostic start is a
// continuation of the previous one (e.g. tsc's "Index signature for type..."
// detail lines).
const DIAG_START = /^(\S.*?)\((\d+),(\d+)\): error TS\d+:/

function parseDiagnosticBlocks(output) {
  const blocks = []
  for (const line of output.split('\n')) {
    const m = line.match(DIAG_START)
    if (m) {
      blocks.push({ file: m[1].replace(/\\/g, '/'), lines: [line] })
    } else if (blocks.length > 0 && line.trim() !== '') {
      blocks[blocks.length - 1].lines.push(line)
    }
  }
  return blocks
}

export function filterKnownUpstreamErrors(output, known = KNOWN_UPSTREAM_ONLY_ERRORS) {
  const blocks = parseDiagnosticBlocks(output)
  const knownPaths = new Set(Object.keys(known))
  const kept = blocks.filter((b) => !knownPaths.has(b.file))
  const suppressed = blocks.filter((b) => knownPaths.has(b.file))
  return { blocks, kept, suppressed }
}

function run() {
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--project', 'tsconfig.authored.json', '--pretty', 'false'],
    { cwd: root, encoding: 'utf8', shell: true },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const { blocks, kept, suppressed } = filterKnownUpstreamErrors(output)

  for (const b of kept) process.stdout.write(`${b.lines.join('\n')}\n`)

  if (suppressed.length > 0) {
    console.log(
      `\n(${suppressed.length} pre-existing upstream-only diagnostic(s) suppressed — see scripts/typecheck.mjs KNOWN_UPSTREAM_ONLY_ERRORS)`,
    )
  }

  if (kept.length > 0) {
    process.exit(1)
  }
  if (blocks.length === 0 && result.status !== 0) {
    // tsc failed without producing a parseable diagnostic (config error,
    // crash, etc.) — surface it verbatim rather than reporting a false pass.
    process.stderr.write(output)
    process.exit(result.status ?? 1)
  }
  process.exit(0)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run()
}
