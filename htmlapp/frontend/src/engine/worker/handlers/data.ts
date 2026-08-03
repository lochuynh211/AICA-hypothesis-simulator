/**
 * data.install — seed the generated data payload into THIS scope's registry.
 *
 * The worker is a separate global scope, so index.html's
 * <script src="./aica-data.js"> never reaches it. WorkerTransport posts this op
 * before any other call — it is the only production caller. InProcessTransport
 * never dispatches data.install at all: it runs on the main thread, which
 * `createTransport()` already installed via `ensureRegistry()` before either
 * transport was constructed, so there is nothing for this op to do there.
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
