/**
 * SimulatedSignalsSection — the "Simulated driver state" signal group
 * (drowsiness / fatigue / anomaly_rate), extracted VERBATIM from `SignalsPanel`
 * so the Trigger setup screen and the Combined Simulator's Situation editor
 * render the identical tier-3 formulation editors (feature 020 extract-and-share).
 *
 * Store-driven (useRunStore): the SignalFormulationEditor / InitialSignalValue
 * children read/write `profileOverrides` + `initialDrowsiness/Fatigue`; the
 * anomaly-rate label shows the current `runSeed`. Highlight/dim are OPTIONAL —
 * the Trigger screen passes its cross-link wiring so it stays byte-identical;
 * the Combined screen omits them (rows never dim).
 */
import { useRunStore } from '../../../state/runStore'
import type { ScenarioDef } from '../../../api/types'
import { t } from '../../../i18n/t'
import { SIGNAL_LABELS } from '../signalLabels'
import InitialSignalValue from '../InitialSignalValue'
import { SignalGroup, SimulatedSignal } from './signalPrimitives'

const NOOP = () => {}
const NEVER_DIMMED = () => false

export default function SimulatedSignalsSection({
  scenario,
  isDimmed = NEVER_DIMMED,
  highlightedSignalKey = null,
  onHighlight = NOOP,
  onUnhighlight = NOOP,
  hideTitle = false,
}: {
  scenario: ScenarioDef
  isDimmed?: (signalKey: string) => boolean
  highlightedSignalKey?: string | null
  onHighlight?: (key: string) => void
  onUnhighlight?: () => void
  hideTitle?: boolean
}) {
  const { state } = useRunStore()
  const { uiLanguage, runSeed } = state

  return (
    <SignalGroup
      title={t({ en: 'Current Driver State (Simulated)', ja: '現在のドライバー状態（シミュレート値）' }, uiLanguage)}
      testid="signal-group-simulated"
      hideTitle={hideTitle}
      caption={t(
        {
          en: 'Generated tick-by-tick by the driver model as the drive plays out — drowsiness, fatigue, and driving anomalies.',
          ja: 'ドライバーモデルが走行中にティックごとに生成する値 — 眠気・疲労・運転異常。',
        },
        uiLanguage,
      )}
    >
      <SimulatedSignal
        signalKey="drowsiness"
        label={t(SIGNAL_LABELS.drowsiness, uiLanguage)}
        scenario={scenario}
        highlighted={highlightedSignalKey === 'drowsiness'}
        dimmed={isDimmed('drowsiness')}
        onHover={() => onHighlight('drowsiness')}
        onLeave={onUnhighlight}
        initialControl={<InitialSignalValue signalKey="drowsiness" scenario={scenario} />}
      />
      <SimulatedSignal
        signalKey="fatigue"
        label={t(SIGNAL_LABELS.fatigue, uiLanguage)}
        scenario={scenario}
        highlighted={highlightedSignalKey === 'fatigue'}
        dimmed={isDimmed('fatigue')}
        onHover={() => onHighlight('fatigue')}
        onLeave={onUnhighlight}
        initialControl={<InitialSignalValue signalKey="fatigue" scenario={scenario} />}
      />
      <SimulatedSignal
        signalKey="anomaly_rate"
        label={`${t(SIGNAL_LABELS.anomaly_rate, uiLanguage)} · ${t({ en: 'seed', ja: 'シード' }, uiLanguage)} ${runSeed}`}
        scenario={scenario}
        highlighted={highlightedSignalKey === 'anomaly_rate'}
        dimmed={isDimmed('anomaly_rate')}
        onHover={() => onHighlight('anomaly_rate')}
        onLeave={onUnhighlight}
      />
    </SignalGroup>
  )
}
