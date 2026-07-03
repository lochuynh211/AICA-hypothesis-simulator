import { useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'

/**
 * SignalInfoPopover (feature 009, FE2) — the ⓘ explainer for a Tier-3
 * (simulated) signal on SignalsPanel: drowsiness, fatigue, anomaly_rate.
 *
 * v1 — no backend call: a static, localized explanation map (per
 * others/aica_setup_screen_uiux.md "Tier-3 explainers"). Toggling the button
 * opens/closes an inline popover with the plain-language explanation.
 */
export type SignalInfoKey = 'drowsiness' | 'fatigue' | 'anomaly_rate'

const EXPLANATIONS: Record<SignalInfoKey, BilingualLabel> = {
  drowsiness: {
    en: 'Accumulates over driving time; faster at night, on monotonous roads, and in traffic jams. Deterministic.',
    ja: '運転時間とともに蓄積します。夜間・単調な道・渋滞ではより速く蓄積します。決定論的な値です。',
  },
  fatigue: {
    en: 'Accumulates over driving time; rises faster after 60 min, on mountain roads, and in jams.',
    ja: '運転時間とともに蓄積します。60分経過後・山道・渋滞ではより速く上昇します。',
  },
  anomaly_rate: {
    en: 'Rare anomaly events (e.g. lane departure) that fire more often as drowsiness rises. One seeded random stream — fully replayable from the run seed.',
    ja: '車線逸脱などの稀な異常イベントで、眠気が高まるほど発生頻度が上がります。シード付き乱数ストリームを1本使用しており、run seedから完全に再現可能です。',
  },
}

type Props = {
  /** Which simulated signal this popover explains. */
  signalKey: SignalInfoKey
  /** The already-localized signal label, used for the button's aria-label. */
  label: string
}

export default function SignalInfoPopover({ signalKey, label }: Props) {
  const { state } = useRunStore()
  const { uiLanguage } = state
  const [open, setOpen] = useState(false)

  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px' }}>
      <button
        type="button"
        data-testid={`signal-info-btn-${signalKey}`}
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: '#6b7280',
          fontSize: '0.9em',
          lineHeight: 1,
          padding: 0,
        }}
      >
        ⓘ
      </button>
      {open && (
        <div
          role="tooltip"
          data-testid={`signal-info-${signalKey}`}
          style={{
            position: 'absolute',
            zIndex: 10,
            top: '100%',
            right: 0,
            marginTop: '4px',
            width: '220px',
            padding: '8px 10px',
            background: '#111827',
            color: '#f9fafb',
            fontSize: '0.75em',
            lineHeight: 1.4,
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {t(EXPLANATIONS[signalKey], uiLanguage)}
        </div>
      )}
    </span>
  )
}
