/**
 * mergedReplaySource — pure correlation-replay projector for one persisted
 * merged run (feature 020, Slice-2c, Task 6).
 *
 * Composes the existing trigger-only `createReplaySource` VERBATIM (no
 * changes to that module) with a proposal-event index built from the
 * `CorrelationEntry` log. A single proposal run can span MULTIPLE
 * correlation entries — the backend's rest-journey auto-drive
 * (`routers/merged_runs.py`) appends a NEW `CorrelationEntry` with the SAME
 * `proposal_run_id` at each stage (fire, during_rest_stopped, after-rest
 * recompute) — so events are split across ALL of a run's entries instead of
 * collapsing onto the earliest one (the simplification
 * `MergedLogPanel.buildMergedEntries` uses for the LIVE coordinator state,
 * where only one entry can exist at a time; not safe once the full,
 * multi-entry persisted history is in view).
 *
 * `CorrelationEntry.proposal_event_ids` is a CUMULATIVE snapshot of event ids
 * (`f"{event_type}@{at}"`, see `models/merged_run.py`) as of that entry's
 * tick. Sorting a run's entries ascending by `trigger_tick_index` and
 * diffing consecutive id sets attributes each event to the FIRST entry that
 * lists it — i.e. the tick that actually produced it. Any event id never
 * covered by an entry's list (should not happen with real backend data, but
 * guards against partial/legacy fixtures) falls back to the run's LAST
 * entry, which also degrades correctly to the single-entry case (bucket
 * everything at that one tick) that earlier tests/fixtures exercise.
 *
 * NO engine, NO API call, NO side effects — a pure projector, exactly like
 * `replaySource.ts`.
 */
import { createReplaySource, type ReplaySource, type ReplayTick } from './replaySource'
import type { RunLog } from '../api/types'
import type { DiscreteEvent, ProposalRunLog } from '../api/proposalClient'
import type { CorrelationEntry } from '../api/mergedClient'

export type MergedReplayTick = {
  trigger: ReplayTick | null
  proposalEvents: DiscreteEvent[]
}

export type MergedReplaySource = {
  tickCount: number
  minIndex: number
  maxIndex: number
  getAt(tickIndex: number): MergedReplayTick
}

/** Mirrors `createReplaySource`'s own empty-log shape (tickCount=0,
 * min/maxIndex=0, getAt always null) for when `trigger_log` is absent. */
const EMPTY_TRIGGER_SOURCE: ReplaySource = {
  tickCount: 0,
  minIndex: 0,
  maxIndex: 0,
  getAt: () => null,
}

export function createMergedReplaySource({
  trigger_log,
  proposal_logs,
  correlation,
}: {
  trigger_log: RunLog | null
  proposal_logs: ProposalRunLog[]
  correlation: CorrelationEntry[]
}): MergedReplaySource {
  const triggerSource = trigger_log ? createReplaySource(trigger_log) : EMPTY_TRIGGER_SOURCE

  // Group correlation entries by proposal_run_id (one run can have several,
  // recorded chronologically by the backend but sorted here defensively) so
  // each run's events can be diffed across ITS OWN entries only.
  const entriesByRunId = new Map<string, CorrelationEntry[]>()
  for (const entry of correlation) {
    const bucket = entriesByRunId.get(entry.proposal_run_id)
    if (bucket) {
      bucket.push(entry)
    } else {
      entriesByRunId.set(entry.proposal_run_id, [entry])
    }
  }
  for (const entries of entriesByRunId.values()) {
    entries.sort((a, b) => a.trigger_tick_index - b.trigger_tick_index)
  }

  const eventsByTick = new Map<number, DiscreteEvent[]>()
  const addEvent = (tickIndex: number, event: DiscreteEvent) => {
    const bucket = eventsByTick.get(tickIndex)
    if (bucket) {
      bucket.push(event)
    } else {
      eventsByTick.set(tickIndex, [event])
    }
  }

  for (const log of proposal_logs) {
    const entries = entriesByRunId.get(log.run_id) ?? []
    if (entries.length === 0) {
      // No correlation entry at all for this run — mirrors the previous
      // fallback of bucketing everything at tick 0.
      for (const event of log.events) addEvent(0, event)
      continue
    }

    const eventById = new Map(log.events.map((event) => [`${event.event_type}@${event.at}`, event]))
    const attributedIds = new Set<string>()
    for (const entry of entries) {
      for (const id of entry.proposal_event_ids) {
        if (attributedIds.has(id)) continue
        attributedIds.add(id)
        const event = eventById.get(id)
        if (event) addEvent(entry.trigger_tick_index, event)
      }
    }
    // Events not covered by any entry's id list (empty/partial ids — the
    // single-entry fixtures predating this fix, or a real gap) all land on
    // the run's LAST entry; for a single entry this is that same entry, so
    // the original "bucket everything at this tick" behavior is preserved.
    const lastTickIndex = entries[entries.length - 1].trigger_tick_index
    for (const event of log.events) {
      const id = `${event.event_type}@${event.at}`
      if (!attributedIds.has(id)) addEvent(lastTickIndex, event)
    }
  }

  return {
    tickCount: triggerSource.tickCount,
    minIndex: triggerSource.minIndex,
    maxIndex: triggerSource.maxIndex,
    getAt(tickIndex: number): MergedReplayTick {
      return {
        trigger: triggerSource.getAt(tickIndex),
        proposalEvents: eventsByTick.get(tickIndex) ?? [],
      }
    },
  }
}
