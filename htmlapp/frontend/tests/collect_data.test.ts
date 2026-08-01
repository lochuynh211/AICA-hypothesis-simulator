import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { collectData, listMatching } from '../scripts/lib/collect-data.mjs'
import { SOURCES } from '../data.manifest.mjs'

// htmlapp/frontend -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

describe('listMatching', () => {
  it('matches a flat glob', () => {
    const files = listMatching(resolve(REPO_ROOT, 'routes/presets'), '*.json')
    expect(files.length).toBe(3)
    expect(files.every((f) => f.endsWith('.json'))).toBe(true)
  })

  it('matches a one-level nested glob', () => {
    const files = listMatching(resolve(REPO_ROOT, 'packages'), '*/package.json')
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it('returns [] for a missing directory instead of throwing', () => {
    expect(listMatching(resolve(REPO_ROOT, 'does/not/exist'), '*.json')).toEqual([])
  })

  it('returns results sorted so the payload is deterministic', () => {
    const files = listMatching(resolve(REPO_ROOT, 'routes/presets'), '*.json')
    expect(files).toEqual([...files].sort())
  })
})

describe('collectData', () => {
  const { payload, problems } = collectData(REPO_ROOT)

  it('reports no problems against the committed repo data', () => {
    expect(problems).toEqual([])
  })

  it('produces every manifest key', () => {
    for (const src of SOURCES) expect(payload).toHaveProperty(src.key)
  })

  it('keys byId collections by their declared id field', () => {
    for (const [id, doc] of Object.entries(payload.presets)) {
      expect((doc as any).preset_id).toBe(id)
    }
    for (const [id, doc] of Object.entries(payload.combinedCases)) {
      expect((doc as any).case_id).toBe(id)
    }
    for (const [id, doc] of Object.entries(payload.packageManifests)) {
      expect((doc as any).id).toBe(id)
    }
  })

  // Non-empty rather than exact counts: data churns by design, and a count
  // assertion would make retuning a preset a code change. Specific ids are
  // asserted only where other code hardcodes them.
  it('collects non-empty collections', () => {
    expect(Object.keys(payload.presets).length).toBeGreaterThan(0)
    expect(Object.keys(payload.combinedCases).length).toBeGreaterThan(0)
    expect(Object.keys(payload.profiles).length).toBeGreaterThan(0)
    expect(Object.keys(payload.seeds).length).toBeGreaterThan(0)
    expect(Object.keys(payload.scenarios).length).toBeGreaterThan(0)
    expect(Object.keys(payload.routePresets).length).toBeGreaterThan(0)
    expect(Object.keys(payload.packageManifests).length).toBeGreaterThan(0)
  })

  it('includes the case the Combined screen opens on', () => {
    expect(payload.combinedCases).toHaveProperty('case-c01-alert-daytime-control')
  })

  it('excludes README.md from id-keyed collections', () => {
    expect(Object.keys(payload.presets).some((k) => k.toLowerCase().includes('readme'))).toBe(false)
  })

  it('reads single-document sources as objects, not maps', () => {
    expect(payload.matrix).toHaveProperty('matrix_version')
    expect(payload.dispositions).toHaveProperty('registry_version')
    expect(payload.serviceCapabilities).toHaveProperty('capabilities_version')
  })

  it('collects each dataset with its manifest and catalog', () => {
    const ids = Object.keys(payload.datasets)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(payload.datasets[id].manifest.dataset_id).toBe(id)
      expect(payload.datasets[id].catalog).toBeTruthy()
    }
  })

  it('stamps the schema version', () => {
    expect(payload.schema_version).toBe(1)
  })
})
