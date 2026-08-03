/** Builtin scenarios, derived from the generated data payload. */
import { getScenarioDefs } from '../registry'
import type { ScenarioDef } from '../../api/types'

export function builtinScenarios(): ScenarioDef[] {
  return getScenarioDefs()
}
