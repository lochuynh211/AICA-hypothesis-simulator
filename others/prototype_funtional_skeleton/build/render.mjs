// render.mjs — deterministic tier-9 render for this use case (TP-001 v5).
//
// Inputs : the shared course-sim template + this directory's build_data.json +
//          the tested pure-logic modules (evaluate_trigger, compose_timeline,
//          firePosition, surface_binning).
// Output : ../index.html  (one artifact for this use case; self-contained EXCEPT
//          for the one declared networked map surface — REQ-INT-013 / DIFF-014).
//
// The render replaces exactly two delimited regions in the template:
//   * <!-- BUILD-DATA:START --> .. <!-- BUILD-DATA:END --> with the per-use-case
//     v5 payload (the single data region the artifact reads at runtime — including
//     the v4 per-beat motion_state / flow_skeletons / fragment_library carried
//     forward, plus the v5 networked_surface block and each case's map_info /
//     route_snapshot); and
//   * <!-- MODULES:START --> .. <!-- MODULES:END --> with the module sources
//     inlined byte-for-byte, their `export ` keyword stripped, bridged onto
//     window.__AICA_MODULES__ (evaluateTrigger, composeTimeline, firePosition,
//     motionStateFor, regenerateTimeline, beatLayout, restStopIdsFor, plus the v5
//     boundaryBin + structuralSignature used by the networked map surface).
// Everything outside those two regions equals the shared template byte-for-byte.
//
// Determinism (G1 waived for the live map surface only — REQ-INT-013): no
// timestamps, locale, env paths, randomness, or tool versions enter the output;
// rendering the same inputs twice yields a byte-identical artifact. The live map's
// pixels are not byte-deterministic; a captured route snapshot (cases[].route_snapshot)
// gives the deterministic snapshot-for-review path.
//
// BYO-key (HARD RULE): the render embeds NO Google Maps key — none shown,
// defaulted, persisted, or committed. The template references an optional,
// git-ignored `key.local.js` placeholder (a dev convenience that is never present
// in the repo); the map surface stays inert until the reviewer enters their own
// key at runtime.
//
// This path layout is identical to v4: from `<repo>/domain_prototype/tym_aica/
// target_prototypes/TP-001/v5/ucNN/build/`, seven `..` reach the repo root.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const templatePath = join(
  repoRoot,
  'domain_prototype', 'tym_aica', 'target_prototypes', 'templates',
  'aica_course_sim_template.html'
);
const buildDataPath = join(here, 'build_data.json');
const outPath = join(here, '..', 'index.html');

const BD_START = '<!-- BUILD-DATA:START -->';
const BD_END = '<!-- BUILD-DATA:END -->';
const MOD_START = '<!-- MODULES:START -->';
const MOD_END = '<!-- MODULES:END -->';

function replaceRegion(html, startMark, endMark, replacement) {
  const i = html.indexOf(startMark);
  const j = html.indexOf(endMark);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`render: region ${startMark}..${endMark} not found in template`);
  }
  const before = html.slice(0, i + startMark.length);
  const after = html.slice(j);
  return before + '\n' + replacement + '\n' + after;
}

// Inline a module source byte-for-byte, stripping only the leading `export ` from
// its top-level `export function` declarations so the names are local; the
// function bodies remain a contiguous substring of the artifact (tested-equals-
// shipped). The exported names are bridged onto window.__AICA_MODULES__ below.
function inlineModule(src) {
  return src.replace(/^export\s+function /gm, 'function ');
}

function buildModulesRegion(sources) {
  const bodies = sources.map(inlineModule).join('\n');
  const bridge =
    'window.__AICA_MODULES__ = { evaluateTrigger, composeTimeline, firePosition, motionStateFor, regenerateTimeline, beatLayout, restStopIdsFor, boundaryBin, structuralSignature, binDriveTime, binDestEta, binRestEta };';
  return '<script type="module">\n' + bodies + '\n' + bridge + '\n</' + 'script>';
}

function main() {
  const template = readFileSync(templatePath, 'utf8');
  // Validate the payload parses (and is the only data source) before embedding.
  const buildDataRaw = readFileSync(buildDataPath, 'utf8');
  const buildData = JSON.parse(buildDataRaw);
  const payload =
    '<script id="build-data" type="application/json">\n' +
    JSON.stringify(buildData, null, 2) +
    '\n</' + 'script>';

  const trig = readFileSync(join(here, 'evaluate_trigger.mjs'), 'utf8');
  const comp = readFileSync(join(here, 'compose_timeline.mjs'), 'utf8');
  const fire = readFileSync(join(here, 'firePosition.mjs'), 'utf8');
  const bin = readFileSync(join(here, 'surface_binning.mjs'), 'utf8');
  const modules = buildModulesRegion([trig, comp, fire, bin]);

  let html = template;
  html = replaceRegion(html, BD_START, BD_END, payload);
  html = replaceRegion(html, MOD_START, MOD_END, modules);

  writeFileSync(outPath, html);
  process.stdout.write(`rendered ${outPath}\n`);
}

main();
