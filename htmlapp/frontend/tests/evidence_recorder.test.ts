import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { EvidenceRecorder } from '../src/engine/services/evidence_recorder'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('EvidenceRecorder', () => {
  it('appends events in order and reads them back', async () => {
    const rec = new EvidenceRecorder('run-1')
    await rec.append({ type: 'run_created' } as any)
    await rec.append({ type: 'tick', tick_index: 0 } as any)
    const log = await rec.runLog()
    expect(log.events.map((e: any) => e.type)).toEqual(['run_created', 'tick'])
    expect(log.events.map((e: any) => e.seq)).toEqual([0, 1])
  })

  it('never mutates prior events on subsequent appends', async () => {
    const rec = new EvidenceRecorder('run-immutable')
    await rec.append({ type: 'run_created' } as any)
    const logBefore = await rec.runLog()
    const first = { ...(logBefore.events[0] as any) }

    await rec.append({ type: 'tick', tick_index: 0 } as any)
    const logAfter = await rec.runLog()

    expect(logAfter.events[0]).toEqual(first)
    expect(logAfter.events.length).toBe(2)
  })

  it('resumes seq assignment across recorder re-construction for the same run', async () => {
    const runId = 'run-resume'
    const rec1 = new EvidenceRecorder(runId)
    await rec1.append({ type: 'run_created' } as any)
    await rec1.append({ type: 'tick', tick_index: 0 } as any)

    // A brand-new recorder instance for the same runId must pick up where the
    // last one left off — seq is derived from persisted state, not in-memory.
    const rec2 = new EvidenceRecorder(runId)
    await rec2.append({ type: 'tick', tick_index: 1 } as any)

    const log = await rec2.runLog()
    expect(log.events.map((e: any) => e.type)).toEqual(['run_created', 'tick', 'tick'])
    expect(log.events.map((e: any) => e.seq)).toEqual([0, 1, 2])
    // Earlier events remain intact.
    expect((log.events[0] as any).type).toBe('run_created')
    expect((log.events[1] as any).tick_index).toBe(0)
  })

  it('runLog() returns the run_id even when no header has been written', async () => {
    const rec = new EvidenceRecorder('run-no-header')
    await rec.append({ type: 'run_created' } as any)
    const log = await rec.runLog()
    expect(log.run_id).toBe('run-no-header')
    expect(Array.isArray(log.events)).toBe(true)
  })
})
