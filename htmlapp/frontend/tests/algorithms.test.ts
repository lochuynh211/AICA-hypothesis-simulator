import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { evaluate } from '../src/engine/algorithms/adapter'

for (const name of ['declarative_rule', 'weighted_score']) {
  describe(`${name} parity`, () => {
    const cases = loadFixture(name) as unknown as { input: any; output: any }[]
    cases.forEach((c, i) => {
      it(`case ${i} matches docker output`, () => {
        const result = evaluate({
          manifest: c.input.manifest,
          context: c.input.context,
          parameters: c.input.parameters ?? {},
          hyperparameters: c.input.hyperparameters ?? {},
          history: c.input.history ?? [],
          packageRuntimeState: c.input.package_runtime_state ?? {},
        })
        expectParity(result, c.output)
      })
    })
  })
}
