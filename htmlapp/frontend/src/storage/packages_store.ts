import { getDb } from './db'
import type { PackageRecord } from '../data/packages'

export const packagesStore = {
  async list(): Promise<PackageRecord[]> { return (await getDb()).getAll('packages') },
  async get(id: string): Promise<PackageRecord | undefined> { return (await getDb()).get('packages', id) },
  async put(rec: PackageRecord): Promise<void> { await (await getDb()).put('packages', rec) },
  async delete(id: string): Promise<void> { await (await getDb()).delete('packages', id) },
}
