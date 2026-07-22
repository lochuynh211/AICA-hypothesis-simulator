/**
 * signalPrimitives — presentational atoms shared between the Trigger setup
 * screen's `SignalsPanel` and the Combined Simulator's Situation editor
 * (feature 020, extract-and-share refactor). These were previously private to
 * `SignalsPanel.tsx`; they are extracted VERBATIM here so both screens render
 * byte-identical signal rows/groups. `SignalsPanel` now imports them, so its
 * behavior/testids are unchanged.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { ScenarioDef } from '../../../api/types'
import SignalFormulationEditor, { type FormulationSignalKey } from '../SignalFormulationEditor'
import { HIGHLIGHT_BG } from '../highlight'
import { t } from '../../../i18n/t'
import { useLanguage } from '../../../state/language'

/** Faded opacity for a signal row the selected package doesn't consume. */
export const DIMMED_OPACITY = 0.35
export const UNUSED_SIGNAL_TITLE = { en: 'Not used by the selected algorithm', ja: '選択中のアルゴリズムでは使用されません' }

/**
 * Auto-scroll a cross-link source row into view when it becomes highlighted.
 * The highlight is usually triggered from the *right* panel (hovering a feature
 * name in AlgorithmFormulationPanel), and the source signal it points at may be
 * scrolled out of view in this left panel — so bring it back. `block: 'nearest'`
 * makes it a no-op when the row is already visible (e.g. when the hover
 * originates on the row itself), so it never jumps for no reason.
 */
export function useHighlightScroll(highlighted: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Guarded: jsdom (test env) leaves scrollIntoView unimplemented.
    if (highlighted && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlighted])
  return ref
}

export function SignalGroup({
  title,
  testid,
  caption,
  children,
  hideTitle = false,
}: {
  title: string
  testid: string
  caption?: string
  children: ReactNode
  /** Hide the group's own title `<h3>` — used by the Combined Simulator's
   * Situation editor, which supplies its own single A/B/C group header and
   * would otherwise show a duplicate title line. Defaults to false so the
   * Trigger screen is unchanged. */
  hideTitle?: boolean
}) {
  return (
    <div data-testid={testid} style={{ marginTop: '12px' }}>
      {!hideTitle && (
        <h3
          style={{
            fontSize: '0.72em',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#9ca3af',
            margin: '0 0 4px',
          }}
        >
          {title}
        </h3>
      )}
      {caption && (
        <p style={{ fontSize: '0.7em', color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.4 }}>{caption}</p>
      )}
      {children}
    </div>
  )
}

export function SignalRow({
  signalKey,
  label,
  value,
  muted = false,
  editControl,
  highlighted = false,
  dimmed = false,
  onHover,
  onLeave,
}: {
  signalKey: string
  label: string
  value: string
  /** Read-only rows (Dynamic) render muted. */
  muted?: boolean
  /** Present only for editable Fixed signals (isNight/familiarRoute/childPassenger/weatherRisk). */
  editControl?: ReactNode
  highlighted?: boolean
  /** The selected package doesn't consume this signal — render faded (see signalUsage.ts). */
  dimmed?: boolean
  onHover?: () => void
  onLeave?: () => void
}) {
  const rowRef = useHighlightScroll(highlighted)
  const { lang } = useLanguage()
  return (
    <div
      ref={rowRef}
      data-testid={`signal-row-${signalKey}`}
      data-dimmed={dimmed ? 'true' : 'false'}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={dimmed ? t(UNUSED_SIGNAL_TITLE, lang) : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        padding: '3px 4px',
        marginBottom: '2px',
        borderRadius: '4px',
        opacity: dimmed ? DIMMED_OPACITY : 1,
        background: highlighted ? HIGHLIGHT_BG : 'transparent',
        fontSize: '0.8em',
      }}
    >
      <span style={{ color: muted ? '#9ca3af' : '#374151' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ color: muted ? '#9ca3af' : '#374151', fontStyle: muted ? 'italic' : 'normal' }}>
          {value}
        </span>
        {editControl}
      </span>
    </div>
  )
}

/**
 * A Simulated (tier-3) signal: its name (a cross-link, same hover-highlight as
 * SignalRow) stacked above its inline formulation — the formula shown in place
 * with editable `[param]` fields, mirroring the right panel's formula-as-UI
 * (AlgorithmFormulationPanel). The old ⓘ-popover-only presentation is gone; the
 * ⓘ (inside SignalFormulationEditor) now carries just a brief word-explanation.
 */
export function SimulatedSignal({
  signalKey,
  label,
  scenario,
  highlighted,
  dimmed = false,
  onHover,
  onLeave,
  initialControl,
}: {
  signalKey: FormulationSignalKey
  label: string
  scenario: ScenarioDef
  highlighted: boolean
  /** The selected package doesn't consume this signal — render faded (see signalUsage.ts). */
  dimmed?: boolean
  onHover: () => void
  onLeave: () => void
  /** Optional setup-time "starting value" control (drowsiness/fatigue), rendered
      below the formula so the initial value lives inside this signal's section. */
  initialControl?: ReactNode
}) {
  const rowRef = useHighlightScroll(highlighted)
  const { lang } = useLanguage()
  return (
    <div
      ref={rowRef}
      data-testid={`signal-row-${signalKey}`}
      data-dimmed={dimmed ? 'true' : 'false'}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={dimmed ? t(UNUSED_SIGNAL_TITLE, lang) : undefined}
      style={{
        padding: '4px',
        marginBottom: '4px',
        borderRadius: '4px',
        opacity: dimmed ? DIMMED_OPACITY : 1,
        background: highlighted ? HIGHLIGHT_BG : 'transparent',
      }}
    >
      <span style={{ fontSize: '0.8em', fontWeight: 600, color: '#374151' }}>{label}</span>
      <SignalFormulationEditor signalKey={signalKey} label={label} scenario={scenario} />
      {initialControl}
    </div>
  )
}
