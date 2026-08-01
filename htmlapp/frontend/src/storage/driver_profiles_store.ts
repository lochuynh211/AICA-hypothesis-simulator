import { getDb, type DriverProfileRecord } from './db'

/**
 * User-saved driver profiles (IndexedDB `driver_profiles` store).
 *
 * Built-in profiles are never written here — they come from the C0 data
 * registry (`../data/registry.ts#getProfiles/getProfile`). See
 * `../engine/proposal/stores.ts#driverProfileStore`, which is the only
 * caller and owns the builtin/user merge + validation.
 */
export const driverProfilesStore = {
  async list(): Promise<DriverProfileRecord[]> { return (await getDb()).getAll('driver_profiles') },
  async get(id: string): Promise<DriverProfileRecord | undefined> { return (await getDb()).get('driver_profiles', id) },
  async put(rec: DriverProfileRecord): Promise<void> { await (await getDb()).put('driver_profiles', rec) },
  async delete(id: string): Promise<void> { await (await getDb()).delete('driver_profiles', id) },
}
