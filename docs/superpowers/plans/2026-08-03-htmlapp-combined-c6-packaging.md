# HTMLApp Combined Export — C6: Packaging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the build that is named for the customer actually produce the customer's deliverable, enforce the size budget on it, and add the served-mode launcher as an optional extra.

**Architecture:** Changes are confined to `htmlapp/frontend/scripts/*.mjs`, `package.json` scripts, and one new launcher file. No application code.

**Tech Stack:** Node ESM build scripts, Vite, `vite-plugin-singlefile`. No new dependencies.

## The finding this slice exists to fix

The owner decided mid-program that **the single-file build is the customer deliverable** and the served multi-file build is an optional extra. The packaging scripts were written before that decision and still encode the opposite:

```
$ grep -n '"build:customer"\|"build"' package.json
"build":          "npm run typecheck && vite build && node scripts/check-size.mjs && node scripts/zip-dist.mjs"
"build:customer": "node scripts/check-customer-config.mjs && npm run build"
```

So `npm run build:customer` produces the **multi-file** build — the one that is known to blank-page when opened from `file://`, because Vite emits a CORS-fetched `<script type="module">` and the `file://` origin is `null`. Anyone cutting a customer bundle today ships a blank page. `zip-dist.mjs`'s header still states "dist/ itself is what ships", which reinforces the stale premise.

Two smaller consequences of the same drift:

- **The size gate does not gate the deliverable.** `check-size.mjs` applies its `APP_MAX` (1.5 MB) / `DATA_MAX` (2 MB) split only on the multi-file path; `--single` checks one aggregate 3 MB number. The split's own stated rationale — "a dataset change silently eats the app's headroom and the next app change fails a check it did not cause" — applies to the deliverable at least as much.
- `APP_MAX + DATA_MAX = 3.5 MB` exceeds `MAX = 3 MB`, so both sub-budgets can pass while the hard cap fails. The multi-file path catches that with a separate total check; the single-file path has no split to catch.

## A third finding, measured 2026-08-03 — the single-file build is not a single file

```
$ ls -la htmlapp/frontend/dist/
      298587  backend.worker-DxJ9Pyy1.js
     1872516  index.html
$ grep -o "backend\.worker[-A-Za-z0-9]*\.js" dist/index.html | sort -u
backend.worker-DxJ9Pyy1.js
```

`build:singlefile` emits **two** files, and `index.html` references the sibling worker
by name. Two consequences:

- **The deliverable is not what it claims to be.** A customer given "one HTML file"
  who copies only `index.html` carries a dangling reference. It happens to still work,
  because at `file://` the `Worker` constructor throws `SecurityError` and the app
  falls back to running the engine in-process — verified directly. So the worker is
  dead weight at `file://`, yet it ships.
- **The size gate does not measure the deliverable.** `check-size.mjs --single` stats
  `index.html` alone, so 298,587 B — 14% of the real payload — is unmeasured. The true
  emitted total is 2,171,103 B, not the 1,872,516 B reported.

Task 1 owns the decision (inline it, drop it, or redefine the deliverable as `dist/`);
Task 2 owns making the gate measure whatever Task 1 decides. Decide with evidence and
state the reasoning — note that a served copy over http WOULD use the worker, so
"delete it" is not automatically right.

## Global Constraints

- **No new runtime or dev dependencies.**
- **Never edit `packages/`, `app/api/`, or `app/frontend/`.**
- No changes to application code — this slice touches build scripts and `package.json` only. If you find yourself editing `src/`, stop and report.
- Run npm from `htmlapp/frontend/`.
- **Every count or measurement in a report must be followed by the command that produced it and that command's raw output, verbatim.** Label commands accurately — `grep -c` counts lines, `grep -o | wc -l` counts occurrences.
- The single-file build is the deliverable, against a hard 3 MB cap.

---

### Task 1: Point the customer build at the customer's artifact

**Files:**
- Modify: `package.json` (scripts), `htmlapp/frontend/scripts/zip-dist.mjs`
- Test: `htmlapp/frontend/tests/packaging_scripts.test.ts`

- [ ] **Step 1** — report the current state before changing it: what `build`, `build:customer`, and `build:singlefile` each produce, and what `zip-dist.mjs` archives. Paste the raw `package.json` scripts block.
- [ ] **Step 2** — make `build:customer` produce the single-file deliverable. Keep `check-customer-config.mjs`'s map-key gate in front of it — that gate is still correct and must not be lost.
- [ ] **Step 3** — decide what `zip-dist` should archive now and fix its stale header comment. A single-file deliverable is one HTML file; whether it still deserves a zip is a judgement call — make it, and say why in the report. **Do not silently keep archiving a `dist/` whose contents are no longer what ships.**
- [ ] **Step 4** — keep the multi-file `build` working. It is the optional served-mode extra (Task 3) and the only path that reports the app/data split. Do not delete it.
- [ ] **Step 5** — test the script wiring itself, not just its output: assert that `build:customer` invokes the single-file path. A comment claiming it does is not a test.
- [ ] **Step 6** — verify, report both sizes, commit.

---

### Task 2: Enforce the app/data split on the deliverable

**Files:**
- Modify: `htmlapp/frontend/scripts/check-size.mjs`
- Test: `htmlapp/frontend/tests/check_size.test.ts`

- [ ] **Step 1** — report the current budgets and the current single-file behaviour, with raw output. Confirm the `APP_MAX + DATA_MAX > MAX` arithmetic yourself rather than taking this plan's word for it.
- [ ] **Step 2** — make the `--single` path report **and** enforce the app/data split. The data payload's size is known independently — `dist/aica-data.js` before inlining, or the generated payload — so the app figure is derivable rather than guessed. State in the report how you derived it; **if it can only be estimated, say so plainly rather than presenting an estimate as a measurement.**
- [ ] **Step 3** — resolve the budget arithmetic. Either the sub-budgets should sum to at most the hard cap, or the hard cap should be checked independently of them (as the multi-file path already does). Pick one, implement it, and explain the choice — an inconsistency that can pass two checks and fail the third is a gate nobody can reason about.
- [ ] **Step 4** — test that each budget actually fails when exceeded. A size gate that has never been observed to fail is not known to work: assert the failure path with a fixture, not only the passing path.
- [ ] **Step 5** — verify, report all three numbers (single-file total, app, data), commit.

---

### Task 3: The served-mode launcher (the optional extra)

The owner chose "A plus B for extra": the single-file build is the deliverable, and a served multi-file mode is a convenience alongside it.

**Files:**
- Create: a launcher at `htmlapp/` root (a small Node script is preferable to a shell script — Node is already required to build, and one file works on Linux, macOS and Windows; if you choose otherwise, justify it)
- Modify: `package.json` (a script entry), `htmlapp/README.md` if one exists
- Test: `htmlapp/frontend/tests/launcher.test.ts`

- [ ] **Step 1** — report what exists today. There is currently no launcher at `htmlapp/` root.
- [ ] **Step 2** — implement: serve `dist/` over `http://localhost` and open a browser. **Use only Node's standard library** — the no-new-dependencies constraint binds here, and `node:http` plus `node:fs` is sufficient.
- [ ] **Step 3** — this exists because the multi-file build **cannot** be opened from `file://`. Make the launcher's own output say that, so a user who reaches for it understands what problem it solves and does not conclude the single-file build is broken.
- [ ] **Step 4** — serve correct MIME types for `.html`, `.js`, `.css`, `.json`, `.woff2`. A wrong `Content-Type` on the module script reproduces the very failure this launcher exists to avoid.
- [ ] **Step 5** — test that it serves `index.html` and a JS asset with the right content types. Do not test by opening a browser; bind to a port, request, assert, close.
- [ ] **Step 6** — verify, commit.

---

### Task 4: Whole-program acceptance

This is the last task of the last slice. It is the first and only point where the entire deliverable is verified end to end, so treat a failure here as a real finding rather than something to work around.

- [ ] **Step 1** — clean-state, from scratch: `rm -rf node_modules/.vite data public/aica-data.js dist dist-htmlapp.zip`, then `npm ci` if lockfile-clean, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:customer`. Report every number with its command.
- [ ] **Step 2** — **open the actual deliverable in a real browser from `file://`.** Not a served copy, not a preview — double-click semantics. Drive one complete Combined session: pick a preset, run to a trigger fire, inspect the proposal, accept a rest, run through recovery, open the explanation, submit review feedback. Report what you did and any console output. **Every other check in this entire program is a proxy for this one.**
- [ ] **Step 3** — zero-network proof on the built output: grep the built `index.html` for `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `localhost`, `127.0.0.1`, `11434`, and any `http://`/`https://` origin. Report raw results and classify each hit as live call path, string constant, or comment.
- [ ] **Step 4** — confirm the launcher works for the served extra, and that the multi-file build it serves actually loads.
- [ ] **Step 5** — port boundary, one last time: `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` must be empty across the whole program.
- [ ] **Step 6** — report the final deliverable size against the 3 MB cap, with the app/data split.
- [ ] **Step 7** — tick the checkboxes and commit, only if every check passed. If step 2 fails, the program is not done — say so plainly rather than reporting the other six steps as success.

---

## Self-Review

**Spec coverage.** Against the ADR's C6 row plus the owner's Decision 1 ("A plus B for extra"): the deliverable is cut by the customer-named script (T1), the size budget actually gates it (T2), the served mode exists as an extra with a launcher (T3), and the whole thing is verified by opening it (T4). Covered.

**Why T1 leads.** Everything else in this slice is refinement; T1 is a correctness bug in the shipping path. A customer bundle cut today is a blank page.

**Why T4's step 2 is written as the point of the program.** Every check across C0–C5 compares an artifact against another artifact — TypeScript against a golden, a golden against Python, a bundle against a byte budget. None of them opens the file. The one failure mode that would survive all of them is the one already observed once in this program: the multi-file build passes every check and blank-pages on double-click.

**No new dependencies, deliberately.** The launcher is the one place a dependency would be tempting (`serve`, `http-server`). `node:http` is enough, and this program has an explicit no-new-deps constraint plus a documented supply-chain incident in its history.
