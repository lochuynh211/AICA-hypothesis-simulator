import { getDb, type ScenarioRecord } from './db'

export const scenariosStore = {
  async list(): Promise<ScenarioRecord[]> { return (await getDb()).getAll('scenarios') },
  async get(id: string): Promise<ScenarioRecord | undefined> { return (await getDb()).get('scenarios', id) },
  async put(rec: ScenarioRecord): Promise<void> { await (await getDb()).put('scenarios', rec) },
  async delete(id: string): Promise<void> { await (await getDb()).delete('scenarios', id) },
}
