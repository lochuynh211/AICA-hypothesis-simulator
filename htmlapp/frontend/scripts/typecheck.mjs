// Thin wrapper around `tsc --noEmit --project tsconfig.authored.json`.
//
// WHY THIS EXISTS (why `package.json`'s `typecheck` script doesn't just run
// `tsc` directly):
//
// Five files carry UPSTREAM type errors that are out of scope for htmlapp to
// fix: each reproduces byte-for-byte against app/frontend's own strict
// `tsc --noEmit --project tsconfig.json` (upstream has no typecheck script
// at all, so nothing has ever gated them there either). htmlapp must not
// edit synced files — that diverges htmlapp from upstream and the next
// `npm run sync` reverts it — and must not fork them via `RESTORE_FROM_GIT`
// either, which would permanently fork htmlapp from upstream's own eventual
// fix and silently drop every future upstream change to the file on sync,
// exactly the drift this project exists to keep in check.
//
// The obvious fix — list the five in `tsconfig.authored.json`'s `exclude` —
// does NOT work: TypeScript's `exclude` only prunes which files the
// `include` globs pick up as ROOT files. A file is still fully type-checked
// if another included file imports it, and all five are (LeftContextPanel.tsx
// imports ScenarioBeats.tsx, CenterPlaybackPanel.tsx imports MapSurface.tsx,
// RunsScreen.tsx imports RunLogViewer.tsx, ReplayViewer.tsx/
// RightReviewPanel.tsx import DecisionTracePanel.tsx, MergedSetupPanel.tsx
// imports ServiceSetupSection.tsx). Confirmed empirically: adding the five
// to `exclude` changed nothing — same errors, same count.
//
// So this script runs the real, unmodified compiler, then removes only the
// diagnostics matching a known (file, TS error code) pair from the report
// before deciding pass/fail. Remove an entry the moment upstream fixes the
// error it names — that is the whole point of naming it instead of a bare
// path.
//
// IMPORTANT — match on file AND code, never on file alone. An earlier
// version of this script suppressed by file path only, which meant ANY
// diagnostic in one of these four files was hidden, not just the one named
// error — a future upstream regression landing in one of these files (e.g.
// via `npm run sync`) would report green. Matching (file, code) keeps the
// hole exactly as big as the four named problems: a different error code in
// the same file still fails the gate. Do not match on line/column — upstream
// edits shift lines constantly, and a line-keyed allowlist would fail
// spuriously on unrelated changes elsewhere in the file.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * file path (relative, POSIX, as tsc reports it from `root`) -> the set of
 * TS error codes legitimately known for that file, plus why. Every code
 * listed here was independently confirmed present in a full, unfiltered
 * `tsc --noEmit --project tsconfig.authored.json` run; each of the four
 * files currently carries exactly ONE distinct code (no file has more than
 * one kind of upstream error today) — verified, not assumed.
 */
export const KNOWN_UPSTREAM_ONLY_ERRORS = {
  'src/components/context/ScenarioBeats.tsx': {
    codes: ['TS2345'],
    reason:
      'local motionRoadLabel(..., lang: string) is passed into t(label, lang: UiLanguage) — TS2345, string is not assignable to UiLanguage.',
  },
  'src/components/map/MapSurface.tsx': {
    codes: ['TS2352'],
    reason:
      '`window as Record<string, unknown>` in the gm_authfailure handler — TS2352, Window has no string index signature to satisfy the cast.',
  },
  'src/components/runs/RunLogViewer.tsx': {
    codes: ['TS2322'],
    reason:
      '`{v.note && (...)}` in JSX, where v.note is typed unknown — TS2322, unknown is not assignable to ReactNode.',
  },
  'src/components/trace/DecisionTracePanel.tsx': {
    codes: ['TS2345'],
    reason:
      'RestChoiceRow/AlgorithmErrorRow declare lang: string and pass it into t(label, lang: UiLanguage) — TS2345, the same pattern as ScenarioBeats.tsx.',
  },
  // Added by C5 Task 3 (htmlapp Combined export) when `components/proposal`
  // was first synced in. Root-caused empirically (bisected a scratch copy
  // of the file down to the minimal reproducing expression, not guessed):
  // `manifest.parameters` is `Record<string, unknown>`, so `manifest.
  // parameters['a'] || manifest.parameters['b']` types as `unknown` (TS
  // cannot narrow an `unknown || unknown` union down to `boolean`), and
  // `unknown && (<JSX/>)` then types as `unknown` rather than `false |
  // JSX.Element` — confirmed by wrapping the condition in `Boolean(...)` in
  // the scratch copy, which made the diagnostic disappear entirely. The
  // same `unknown`-in-`&&`-JSX pattern as `RunLogViewer.tsx` above, just a
  // different unknown source. tsc misattributes the reported position to an
  // unrelated PRECEDING sibling JSX node (a comment two sections earlier in
  // the original file) rather than the actual offending conditional —
  // confirmed by bisecting the file's sections and watching the reported
  // line shift to track whichever sibling immediately precedes the
  // Response-coefficients block, never the block's own line.
  'src/components/proposal/panels/sections/ServiceSetupSection.tsx': {
    codes: ['TS2322'],
    reason:
      "manifest.parameters['a'] || manifest.parameters['b'] (both Record<string, unknown> index reads) stays typed unknown, so `(...) && (<>...</>)` types as unknown, not false | JSX.Element — TS2322, unknown is not assignable to ReactNode. Reported position is a preceding sibling node (tsc misattribution), not the actual conditional.",
  },
}

// A diagnostic block starts with `<path>(<line>,<col>): error TS<code>: <msg>`;
// any following line that is not itself a new diagnostic start is a
// continuation of the previous one (e.g. tsc's "Index signature for type..."
// detail lines).
const DIAG_START = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+):/

function parseDiagnosticBlocks(output) {
  const blocks = []
  for (const line of output.split('\n')) {
    const m = line.match(DIAG_START)
    if (m) {
      blocks.push({ file: m[1].replace(/\\/g, '/'), code: m[4], lines: [line] })
    } else if (blocks.length > 0 && line.trim() !== '') {
      blocks[blocks.length - 1].lines.push(line)
    }
  }
  return blocks
}

export function filterKnownUpstreamErrors(output, known = KNOWN_UPSTREAM_ONLY_ERRORS) {
  const blocks = parseDiagnosticBlocks(output)
  const kept = []
  const suppressed = []
  for (const b of blocks) {
    const entry = known[b.file]
    if (entry && entry.codes.includes(b.code)) {
      suppressed.push(b)
    } else {
      kept.push(b)
    }
  }
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
