import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { analyzeRoute } from '../src/engine/services/route_analysis'

describe('route analysis parity (local)', () => {
  it('matches docker RouteFacts', () => {
    const fx = loadFixture('route_analysis')
    expectParity(analyzeRoute(fx.input.scenario), fx.output)
  })
})
