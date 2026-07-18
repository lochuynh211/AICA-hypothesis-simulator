/**
 * mergedReplaySource — pure correlation-replay projector for one persisted
 * merged run (feature 020, Slice-2c, Task 6).
 *
 * Composes the existing trigger-only `createReplaySource` VERBATIM (no
 * changes to that module) with a proposal-event index built by LIFTING the
 * join `MergedLogPanel.buildMergedEntries` already does for the LIVE
 * coordinator state: look up each proposal run's `CorrelationEntry` (matched
 * by `proposal_run_id`) to find the trigger tick that produced it, then
 * bucket every one of that run's `DiscreteEvent`s under that tick index —
 * the SAME "one proposal run == one tick" simplification `buildMergedEntries`
 * uses, generalized across every persisted proposal run in the reassembled
 * history instead of just the single currently-active one.
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

  const eventsByTick = new Map<number, DiscreteEvent[]>()
  for (const log of proposal_logs) {
    const correlationEntry = correlation.find((c) => c.proposal_run_id === log.run_id)
    const tickIndex = correlationEntry ? correlationEntry.trigger_tick_index : 0
    const bucket = eventsByTick.get(tickIndex)
    if (bucket) {
      bucket.push(...log.events)
    } else {
      eventsByTick.set(tickIndex, [...log.events])
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
