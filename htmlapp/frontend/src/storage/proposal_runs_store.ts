import {
  getDb,
  type ProposalRunHeader,
  type ProposalRunEventRow,
  type ProposalRunEvidenceRow,
  type ProposalRunExplanationRow,
} from './db'

/**
 * IndexedDB persistence for proposal runs — mirrors `runsStore` (../storage/
 * runs_store.ts) for the trigger side, tripled: a ProposalRunLog has THREE
 * independent append-only lists (`events`/`evidence`/`explanations`, see
 * `aica_api.services.proposal_run_manager`), so each gets its own store +
 * its own `appendX` method, following the identical discipline as
 * `runsStore.appendEvent`/`run_events`.
 *
 * Append-only invariant: `proposal_run_events`/`proposal_run_evidence`/
 * `proposal_run_explanations` rows are only ever written via `add` (never
 * `put`) inside `appendEvent`/`appendEvidence`/`appendExplanation` — a
 * duplicate (runId, seq) key throws rather than silently overwriting a prior
 * entry. This module exposes NO generic put/delete for those three stores;
 * `deleteRun` is the only place their rows are removed. `proposal_runs`
 * (the header — every ProposalRunLog field EXCEPT the three lists) is
 * mutable, matching Python's `update_state`, so `putHeader` may be called
 * repeatedly (same as trigger's `putHeader`/`persistHeader`).
 */
export const proposalRunsStore = {
  async listHeaders(): Promise<ProposalRunHeader[]> { return (await getDb()).getAll('proposal_runs') },
  async getHeader(runId: string): Promise<ProposalRunHeader | undefined> { return (await getDb()).get('proposal_runs', runId) },
  async putHeader(h: ProposalRunHeader): Promise<void> { await (await getDb()).put('proposal_runs', h) },

  /** Append one discrete event AND (optionally) update the run header in one transaction.
   * `add` (not `put`) rejects a duplicate (runId, seq) key rather than silently
   * overwriting a prior entry -- the append-only enforcement mechanism. That
   * rejection also aborts the transaction, which independently rejects
   * `tx.done`; the `catch` below observes (no-ops) that second rejection so
   * it never surfaces as an unhandled promise rejection while still
   * propagating the original `add()` error to the caller. */
  async appendEvent(runId: string, seq: number, event: Record<string, unknown>, header?: ProposalRunHeader): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['proposal_run_events', 'proposal_runs'], 'readwrite')
    try {
      await tx.objectStore('proposal_run_events').add({ ...event, runId, seq } as ProposalRunEventRow)
      if (header) await tx.objectStore('proposal_runs').put(header)
      await tx.done
    } catch (err) {
      tx.done.catch(() => {})
      throw err
    }
  },

  /** Append one algorithm-evidence entry AND (optionally) update the run header in one transaction. */
  async appendEvidence(runId: string, seq: number, evidence: Record<string, unknown>, header?: ProposalRunHeader): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['proposal_run_evidence', 'proposal_runs'], 'readwrite')
    try {
      await tx.objectStore('proposal_run_evidence').add({ ...evidence, runId, seq } as ProposalRunEvidenceRow)
      if (header) await tx.objectStore('proposal_runs').put(header)
      await tx.done
    } catch (err) {
      tx.done.catch(() => {})
      throw err
    }
  },

  /** Append one LLM-narration explanation AND (optionally) update the run header in one transaction. */
  async appendExplanation(runId: string, seq: number, explanation: Record<string, unknown>, header?: ProposalRunHeader): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(['proposal_run_explanations', 'proposal_runs'], 'readwrite')
    try {
      await tx.objectStore('proposal_run_explanations').add({ ...explanation, runId, seq } as ProposalRunExplanationRow)
      if (header) await tx.objectStore('proposal_runs').put(header)
      await tx.done
    } catch (err) {
      tx.done.catch(() => {})
      throw err
    }
  },

  async getEvents(runId: string): Promise<ProposalRunEventRow[]> {
    const db = await getDb()
    const rows = await db.getAllFromIndex('proposal_run_events', 'runId', runId)
    return rows.sort((a, b) => a.seq - b.seq)
  },

  async getEvidence(runId: string): Promise<ProposalRunEvidenceRow[]> {
    const db = await getDb()
    const rows = await db.getAllFromIndex('proposal_run_evidence', 'runId', runId)
    return rows.sort((a, b) => a.seq - b.seq)
  },

  async getExplanations(runId: string): Promise<ProposalRunExplanationRow[]> {
    const db = await getDb()
    const rows = await db.getAllFromIndex('proposal_run_explanations', 'runId', runId)
    return rows.sort((a, b) => a.seq - b.seq)
  },

  /** The ONLY place a proposal run's header/events/evidence/explanations may be removed. */
  async deleteRun(runId: string): Promise<void> {
    const db = await getDb()
    const tx = db.transaction(
      ['proposal_runs', 'proposal_run_events', 'proposal_run_evidence', 'proposal_run_explanations'],
      'readwrite',
    )
    await tx.objectStore('proposal_runs').delete(runId)
    for (const store of ['proposal_run_events', 'proposal_run_evidence', 'proposal_run_explanations'] as const) {
      const keys = await tx.objectStore(store).index('runId').getAllKeys(runId)
      for (const k of keys) await tx.objectStore(store).delete(k)
    }
    await tx.done
  },
}
