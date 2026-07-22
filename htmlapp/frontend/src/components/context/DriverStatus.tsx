/**
 * DriverStatus — right-panel "current driver status".
 *
 * Renders the driver-state bands the backend reports on the latest decision
 * (drowsiness, fatigue) as coloured ordinal bars. Bands only — no raw numbers
 * (preserves the qualitative-trigger discipline). Shown above the streaming log.
 */
import { useRunStore } from '../../state/runStore'
import { bandViz } from '../common/bands'
import { t } from '../../i18n/t'

const LABELS = {
  driverStatus: { ja: 'ドライバー状態', en: 'DRIVER STATUS' },
  drowsiness: { ja: '眠気', en: 'Drowsiness' },
  fatigue: { ja: '疲労', en: 'Fatigue' },
}

function BandRow({ label, testKey, band }: { label: string; testKey: string; band: string | null | undefined }) {
  const viz = bandViz(band)
  const shown = band && band !== '' ? band : '—'
  return (
    <div style={{ marginBottom: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.78em',
          color: '#bbb',
          marginBottom: '4px',
        }}
      >
        <span>{label}</span>
        <span data-testid={`driver-${testKey}-band`} style={{ color: viz.color, fontWeight: 700 }}>
          {shown}
        </span>
      </div>
      <div style={{ height: '8px', background: '#2a2a2a', borderRadius: '4px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${viz.pct}%`,
            background: viz.color,
            transition: 'width 0.5s ease, background 0.5s ease',
          }}
        />
      </div>
    </div>
  )
}

export default function DriverStatus() {
  const { state } = useRunStore()
  const lang = state.uiLanguage
  const features = state.latestDecision?.features ?? {}

  return (
    <div data-testid="driver-status" style={{ padding: '10px 12px' }}>
      <div
        style={{
          fontSize: '0.8em',
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: '#aaa',
          marginBottom: '10px',
        }}
      >
        {t(LABELS.driverStatus, lang)}
      </div>
      <BandRow label={t(LABELS.drowsiness, lang)} testKey="drowsiness" band={features.drowsiness_level} />
      <BandRow label={t(LABELS.fatigue, lang)} testKey="fatigue" band={features.fatigue_level} />
    </div>
  )
}
