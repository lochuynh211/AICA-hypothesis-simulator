import { getDb } from './db'

export const settingsStore = {
  async get(key: string): Promise<any> { return (await getDb()).get('settings', key) },
  async set(key: string, value: unknown): Promise<void> { await (await getDb()).put('settings', value, key) },
  async delete(key: string): Promise<void> { await (await getDb()).delete('settings', key) },
}
