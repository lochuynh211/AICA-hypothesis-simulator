/**
 * Scenario registry — in-memory index built from IndexedDB scenario records.
 *
 * Ported from `app/api/aica_api/services/scenario_registry.py` (behavior-of-record).
 * The Python registry scans a `scenarios_dir` for `*.json` files at
 * construction time. The htmlapp offline build has no filesystem: scenario
 * definitions are bundled JSON (`src/data/scenarios/`) and seeded into
 * IndexedDB by `storage/db.ts#seedDefaults()` on first launch. This registry
 * reads the already-seeded `ScenarioRecord` rows via `scenarios_store`
 * instead of scanning a directory.
 *
 * Because bundled scenarios are validated at build time, `listSummaries()`
 * always returns an empty `errors` array for now (mirrors `list_errors()`
 * shape; a later slice that adds user-supplied scenario import will
 * populate it).
 *
 * Public API mirrors the Python registry:
 *   scenarioRegistry.listSummaries() -> Promise<{ scenarios, errors }>
 *   scenarioRegistry.get(id)         -> Promise<ScenarioDef>
 *   scenarioRegistry.isCompatible(scenario, package) -> boolean
 */
import { scenariosStore } from '../../storage/scenarios_store'
import type { PackageManifest, RegistryError, ScenarioDef, ScenarioSummary } from '../../api/types'

function personaLabel(persona: Record<string, unknown>): string {
  const name = (persona as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

export const scenarioRegistry = {
  /** Return lightweight summaries for all seeded scenarios, plus any load errors. */
  async listSummaries(): Promise<{ scenarios: ScenarioSummary[]; errors: RegistryError[] }> {
    const records = await scenariosStore.list()
    const scenarios: ScenarioSummary[] = records.map((rec) => ({
      id: rec.def.id,
      version: rec.def.version,
      type: rec.def.type,
      persona_label: personaLabel(rec.def.persona),
      review_focus: rec.def.review_focus,
    }))
    return { scenarios, errors: [] }
  },

  /** Return the full ScenarioDef for a scenario_id. Throws if not found. */
  async get(id: string): Promise<ScenarioDef> {
    const rec = await scenariosStore.get(id)
    if (!rec) {
      throw new Error(`Scenario '${id}' not found or invalid`)
    }
    return rec.def
  },

  /** Return true if the scenario type is in the package's compat list. */
  isCompatible(scenario: ScenarioDef, pkg: PackageManifest): boolean {
    return pkg.compatible_scenario_types.includes(scenario.type)
  },
}
