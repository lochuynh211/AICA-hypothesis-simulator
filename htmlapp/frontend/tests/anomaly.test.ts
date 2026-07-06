import { describe, it } from 'vitest'
import { advanceAnomaly, type AnomalyState, type AnomalySignalParams } from '../src/engine/behavior/anomaly_signal'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

describe('anomaly_signal parity', () => {
  it('reproduces Python advance_anomaly sequences byte-for-byte', () => {
    const { input, output } = loadFixture('anomaly')
    const inSeqs = input.sequences as Array<{
      params: AnomalySignalParams
      run_seed: number
      tick_seconds: number
      steps: Array<{ tick_index: number; drowsiness: number; is_moving: boolean }>
    }>
    const outSeqs = output.sequences as Array<{ steps: Array<{ spike: number; anomaly_rate: number; events: number[] }> }>

    inSeqs.forEach((seq, s) => {
      let state: AnomalyState = { events: [] }
      seq.steps.forEach((step, i) => {
        const upd = advanceAnomaly(seq.params, state, {
          drowsiness: step.drowsiness,
          tickIndex: step.tick_index,
          tickSeconds: seq.tick_seconds,
          runSeed: seq.run_seed,
          isMoving: step.is_moving,
        })
        expectParity(
          { spike: upd.spike, anomaly_rate: upd.anomaly_rate, events: upd.next.events },
          { spike: outSeqs[s].steps[i].spike, anomaly_rate: outSeqs[s].steps[i].anomaly_rate, events: outSeqs[s].steps[i].events },
          `seq[${s}].step[${i}]`,
        )
        state = upd.next
      })
    })
  })
})
