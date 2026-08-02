import { getDb, type RunHeader, type EvidenceEvent } from './db'

export const runsStore = {
  async listHeaders(): Promise<RunHeader[]> { return (await getDb()).getAll('runs') },
  async getHeader(id: string): Promise<RunHeader | undefined> { return (await getDb()).get('runs', id) },
  async putHeader(h: RunHeader): Promise<void> { await (await getDb()).put('runs', h) },

  /** Append an evidence event AND update the run header in one transaction.
   * `add` (not `put`) rejects a duplicate (runId, seq) key rather than silently
   * overwriting a prior entry -- the append-only enforcement mechanism. That
   * rejection also aborts the transaction, which independently rejects
   * `tx.done`; the `catch` below observes (no-ops) that second rejection so
   * it never surfaces as an unhandled promise rejection while still
   * propagating the original `add()` error to the caller. */
  async appendEvent(runId: string, seq: number, event: EvidenceEvent, header?: RunHeader): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['run_events', 'runs'], 'readwrite')
    try {
      await tx.objectStore('run_events').add({ ...event, runId, seq } as any)
      if (header) await tx.objectStore('runs').put(header)
      await tx.done
    } catch (err) {
      tx.done.catch(() => {})
      throw err
    }
  },

  async getEvents(runId: string): Promise<EvidenceEvent[]> {
    const db = await getDb()
    const events = await db.getAllFromIndex('run_events', 'runId', runId)
    return events.sort((a, b) => a.seq - b.seq)
  },

  /** The ONLY place run_events may be removed. */
  async deleteRun(id: string): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['runs', 'run_events', 'feedback'], 'readwrite')
    await tx.objectStore('runs').delete(id)
    for (const store of ['run_events', 'feedback'] as const) {
      const keys = await tx.objectStore(store).index('runId').getAllKeys(id)
      for (const k of keys) await tx.objectStore(store).delete(k)
    }
    await tx.done
  },
}
