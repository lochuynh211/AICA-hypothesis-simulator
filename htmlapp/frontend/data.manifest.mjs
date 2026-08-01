/**
 * The data contract for the offline build.
 *
 * This file declares WHICH repo directories are data. Adding a preset, a
 * combined test case, a driver profile or a route preset is a change to those
 * directories only — never to this file and never to htmlapp source. Adding a
 * whole new KIND of data is the one change that belongs here.
 *
 * `from` paths are relative to the repo root. Consumed by
 * scripts/lib/collect-data.mjs (pure) and scripts/build-data.mjs (writes).
 */

export const SCHEMA_VERSION = 1

/**
 * shape:
 *   'byId'     — many files, keyed by `idField` into an object (keys sorted)
 *   'single'   — exactly one file, stored as-is
 *   'datasets' — one directory per dataset; see collectDatasets()
 */
export const SOURCES = [
  { key: 'combinedCases',       from: 'combined_contracts/test_cases',           glob: 'case-*.json',    shape: 'byId', idField: 'case_id' },
  { key: 'presets',             from: 'proposal_contracts/presets',              glob: 'preset-*.json',  shape: 'byId', idField: 'preset_id' },
  { key: 'profiles',            from: 'proposal_contracts/profiles',             glob: 'profile-*.json', shape: 'byId', idField: 'profile_id' },
  { key: 'seeds',               from: 'proposal_contracts/seeds',                glob: 'seed-*.json',    shape: 'byId', idField: 'seed_id' },
  { key: 'scenarios',           from: 'scenarios',                               glob: '*.json',         shape: 'byId', idField: 'id' },
  { key: 'routePresets',        from: 'routes/presets',                          glob: '*.json',         shape: 'byId', idField: 'id' },
  { key: 'packageManifests',    from: 'packages',                                glob: '*/package.json', shape: 'byId', idField: 'id' },
  { key: 'matrix',              from: 'proposal_contracts/matrix',               glob: '*.json',         shape: 'single' },
  { key: 'dispositions',        from: 'proposal_contracts/dispositions',         glob: '*.json',         shape: 'single' },
  { key: 'serviceCapabilities', from: 'proposal_contracts/service_capabilities', glob: '*.json',         shape: 'single' },
  { key: 'datasets',            from: 'proposal_contracts/dataset',                                      shape: 'datasets' },
]
