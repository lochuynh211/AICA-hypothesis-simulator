/**
 * Append-only evidence recorder — IndexedDB port of
 * `app/api/aica_api/storage/evidence_recorder.py`.
 *
 * Behavior-of-record (Python): a `RunLog` is persisted to
 * `runs/<run_id>.json` on construction, and the WHOLE log is rewritten to
 * disk after every `append()` — giving durability after every meaningful
 * event while never rewriting prior events' content (FR-012).
 *
 * Substrate change for the offline htmlapp: there is no filesystem.
 * `runs_store.appendEvent` (built in S1-S3, see ../../storage/runs_store.ts)
 * already gives us the equivalent guarantee natively — each event is written
 * as its own row in the `run_events` IndexedDB store inside a transaction,
 * and rows are never updated/deleted (except via `deleteRun`, the one
 * sanctioned exception documented on that store). So instead of Python's
 * "rewrite the whole file every append", each `append()` here is a single
 * one-row IndexedDB write — durability comes from the transaction commit,
 * not from re-serializing history.
 *
 * Constructor shape differs from Python on purpose: Python's constructor
 * takes a fully-formed initial `RunLog` (snapshot/route_facts/event_plan
 * already assembled by the caller) and persists it immediately. Here the
 * recorder is constructed with just a `runId` — run-header assembly
 * (snapshot, route_facts, event_plan, ...) is the run manager's job
 * (task S4.2, `runsStore.putHeader`), not the recorder's. `runLog()`
 * reads back whatever header exists (if any) and layers the ordered events
 * on top; when no header has been written yet it still returns a valid
 * (default-filled) RunLog so the recorder is usable standalone, matching
 * this task's test.
 *
 * seq / resume: Python doesn't need an explicit `seq` field — event order
 * in the in-memory list *is* the sequence, because the whole RunLog object
 * lives in memory for the run's lifetime. Here a recorder instance may be
 * (re)constructed at any point (e.g. after a page reload) for a run that
 * already has persisted events, so `seq` must be derived from persisted
 * state rather than an in-memory counter that resets to 0 on construction.
 * The first `append()` call reads the current persisted event count for
 * `runId` via `runsStore.getEvents` and starts assigning `seq` from there;
 * subsequent appends on the same instance chain off that without re-reading
 * the store. Appends on one instance are serialized (chained on a promise)
 * so concurrent `append()` calls on the same instance can't race to the
 * same `seq`.
 *
 * No `Date.now()` / `Math.random()` is used anywhere in this file — seq
 * assignment is purely a function of persisted event count, and no
 * timestamp is fabricated for events that don't already carry one.
 */
import { runsStore } from '../../storage/runs_store'
import type { EvidenceEvent } from '../../storage/db'
import type { RunLog, RunLogEvent, Snapshot } from '../../api/types'

const EMPTY_SNAPSHOT: Snapshot = {
  package: { id: '', version: '', hash: '' },
  scenario: { id: '', version: '', hash: '' },
}

/**
 * Event shape accepted by `append()`. The storage layer (`EvidenceEvent`,
 * from ../../storage/db) keys events on a generic `type` field; the domain
 * model (`RunLogEvent`, from ../../api/types, ported from
 * `aica_api.models.log.Event`) discriminates on `kind`. Both are accepted
 * here — the recorder is a thin pass-through and does not care which
 * discriminator field the caller uses, it only assigns `seq` and persists.
 */
export type RecordableEvent = RunLogEvent | Omit<EvidenceEvent, 'seq'>

export class EvidenceRecorder {
  private readonly runId: string
  /** Chains appends so seq assignment is serialized even under concurrent calls. */
  private chain: Promise<number> | null = null

  constructor(runId: string) {
    this.runId = runId
  }

  /** Append one event, assigning the next monotonic seq, and persist immediately. */
  async append(event: RecordableEvent): Promise<void> {
    const prior = this.chain ?? this.initialSeq()
    const next = prior.then(async (seq) => {
      const row = { ...(event as Record<string, unknown>), seq } as EvidenceEvent
      await runsStore.appendEvent(this.runId, seq, row)
      return seq + 1
    })
    this.chain = next
    await next
  }

  /** Assemble the RunLog: header fields (if any) + ordered persisted events. */
  async runLog(): Promise<RunLog> {
    const [header, events] = await Promise.all([
      runsStore.getHeader(this.runId),
      runsStore.getEvents(this.runId),
    ])
    const h = (header ?? {}) as Record<string, unknown>
    return {
      run_id: this.runId,
      created_at: (h.created_at as string | undefined) ?? '',
      simulator_version: (h.simulator_version as string | undefined) ?? '',
      snapshot: (h.snapshot as Snapshot | undefined) ?? EMPTY_SNAPSHOT,
      route_facts: h.route_facts ?? {},
      event_plan: h.event_plan ?? {},
      run_mode: (h.run_mode as string | undefined) ?? 'standard',
      evidence_status: (h.evidence_status as string | undefined) ?? 'standard',
      events: events as unknown as RunLogEvent[],
    }
  }

  /** Derive the next seq from persisted event count (resume-safe). */
  private async initialSeq(): Promise<number> {
    const existing = await runsStore.getEvents(this.runId)
    return existing.length
  }
}
