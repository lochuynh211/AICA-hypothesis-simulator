import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { buildFeatureGroups, binContext, binDrowsinessLevel, binFatigueLevel } from '../src/engine/binning'

describe('binning parity', () => {
  const { input, output } = loadFixture('binning')

  it('build_feature_groups matches Python (tiered — ordinal only, normalized empty)', () => {
    input.feature_groups.forEach((c: any, i: number) => {
      expectParity(buildFeatureGroups(c), output.feature_groups[i], `feature_groups[${i}]`)
    })
  })

  it('bin_drowsiness_level / bin_fatigue_level (legacy display bands)', () => {
    input.drowsiness_levels.forEach((v: number, i: number) => {
      expectParity(binDrowsinessLevel(v), output.drowsiness_bands[i], `drowsiness[${i}]`)
    })
    input.fatigue_levels.forEach((v: number, i: number) => {
      expectParity(binFatigueLevel(v), output.fatigue_bands[i], `fatigue[${i}]`)
    })
  })

  it('bin_context matches Python output', () => {
    input.bin_context.forEach((c: any, i: number) => {
      expectParity(binContext(c), output.bin_context[i], `bin_context[${i}]`)
    })
  })
})
