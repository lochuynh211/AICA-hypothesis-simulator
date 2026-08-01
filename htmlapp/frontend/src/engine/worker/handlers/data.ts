/**
 * data.install — seed the generated data payload into THIS scope's registry.
 *
 * The worker is a separate global scope, so index.html's
 * <script src="./aica-data.js"> never reaches it. WorkerTransport posts this op
 * before any other call. In-process (file://) it is a harmless re-install:
 * boot already installed the same payload on the main thread.
 */
import { installRegistry, DataRegistryError } from '../../../data/registry'

export async function installData(params: { payload: unknown }): Promise<{ installed: true }> {
  try {
    installRegistry(params.payload)
  } catch (e) {
    if (e instanceof DataRegistryError) throw e
    throw new DataRegistryError([String(e)])
  }
  return { installed: true }
}
