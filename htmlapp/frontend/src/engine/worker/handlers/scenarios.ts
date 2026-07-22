import type { ScenarioSummary, ScenarioDef } from '../../../api/types'
import { scenarioRegistry } from '../../services/scenario_registry'

export async function scenariosList(): Promise<{ scenarios: ScenarioSummary[]; errors: { source: string; message: string }[] }> {
  return scenarioRegistry.listSummaries()
}

export async function scenariosGet(params: { id: string }): Promise<ScenarioDef> {
  return scenarioRegistry.get(params.id)
}
