import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { buildFeatureGroups, binContext } from '../src/engine/binning'

describe('binning parity', () => {
  const fx = loadFixture('binning')
  it('build_feature_groups matches docker output', () => {
    expectParity(buildFeatureGroups(fx.input.raw_state), fx.output.build_feature_groups)
  })
  it('bin_context matches docker output', () => {
    expectParity(binContext(fx.input.ctx), fx.output.bin_context)
  })
})
