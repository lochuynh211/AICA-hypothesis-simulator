import { useRunStore } from '../../state/runStore'
import { bandViz } from '../common/bands'
import { t } from '../../i18n/t'

const cardStyle: React.CSSProperties = {
  flex: 1,
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#fff',
  padding: '10px 12px',
  minWidth: 0,
}
const cardTitle: React.CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6b7280',
  marginBottom: '8px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.82em',
  marginBottom: '6px',
  gap: '8px',
}
const keyStyle: React.CSSProperties = { color: '#6b7280' }
const valStyle: React.CSSProperties = { color: '#111', fontWeight: 600 }

function BandBar({ label, band }: { label: string; band: string | null | undefined }) {
  const viz = bandViz(band)
  return (
    <>
      <div style={rowStyle}>
        <span style={keyStyle}>{label}</span>
        <span style={{ ...valStyle, color: viz.color }}>{band ?? '—'}</span>
      </div>
      <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <div
          style={{
            height: '100%',
            width: `${viz.pct}%`,
            background: viz.color,
            transition: 'width 0.5s ease, background 0.5s ease',
          }}
        />
      </div>
    </>
  )
}

export default function StateCards() {
  const { state } = useRunStore()
  const { latestDecision, uiLanguage } = state

  const features = latestDecision?.features ?? {}

  const labels = {
    inCar:       t({ ja: '🚗 車内状態',       en: '🚗 In-car status' },        uiLanguage),
    driver:      t({ ja: 'ドライバー',         en: 'Driver' },                  uiLanguage),
    drowsiness:  t({ ja: '眠気レベル',         en: 'Drowsiness' },              uiLanguage),
    fatigue:     t({ ja: '疲労レベル',         en: 'Fatigue' },                 uiLanguage),
    drivingEnv:  t({ ja: '🛣️ 走行環境',       en: '🛣️ Driving environment' },  uiLanguage),
  }

  return (
    <div data-testid="state-cards" style={{ display: 'flex', gap: '12px', margin: '12px 0' }}>
      <div style={cardStyle}>
        <div style={cardTitle}>{labels.inCar}</div>
        <div style={{ ...cardTitle, fontSize: '0.68em', color: '#9ca3af', marginBottom: '6px', marginTop: '4px' }}>{labels.driver}</div>
        <BandBar label={labels.drowsiness} band={features.drowsiness_level} />
        <BandBar label={labels.fatigue} band={features.fatigue_level} />
      </div>

      <div style={cardStyle}>
        <div style={cardTitle}>{labels.drivingEnv}</div>
      </div>
    </div>
  )
}
