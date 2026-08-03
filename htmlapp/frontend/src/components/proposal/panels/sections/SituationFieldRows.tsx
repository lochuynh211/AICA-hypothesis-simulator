/**
 * SituationFieldRows — renders a set of World·situation FieldRows bound to
 * `proposalStore.world.situation`, dispatching `SET_SITUATION_FIELD`. Extracted
 * from `WorldPanel` (feature 020 extract-and-share) so both the Proposal
 * screen's WorldPanel (full `SITUATION_FIELDS`) and the Combined Simulator's
 * Situation editor (a setup-time subset — route/destination tags + passenger
 * flags; the live-computed drowsiness/fatigue/etc. are omitted there) render
 * the identical controls.
 */
import { useProposalStore } from '../../../../state/proposalStore'
import type { Situation } from '../../../../api/proposalClient'
import { FieldRow, issuesForPath, type WorldFieldDef } from './worldFields'

export default function SituationFieldRows({ fields }: { fields: WorldFieldDef[] }) {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, world } = state
  const { situation } = world

  return (
    <>
      {fields.map((def) => (
        <FieldRow
          key={def.key}
          def={def}
          value={(situation as unknown as Record<string, unknown>)[def.key]}
          onChange={(value) => dispatch({ type: 'SET_SITUATION_FIELD', key: def.key as keyof Situation, value })}
          lang={lang}
          issues={issuesForPath(state.worldValidationIssues, `situation.${def.key}`)}
        />
      ))}
    </>
  )
}
