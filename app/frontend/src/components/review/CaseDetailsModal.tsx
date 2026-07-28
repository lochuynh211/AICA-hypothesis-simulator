// app/frontend/src/components/review/CaseDetailsModal.tsx
/**
 * The case-details popup: persona narrative, goals, preferences, constraints,
 * assumptions, and the conditions the case fixes.
 *
 * Every list is optional in the contract, so each section renders only when it
 * has content — an empty box says nothing and costs space.
 */
import { Modal } from '../merged/Modal'
import type { BilingualLabel, CombinedTestCase } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  title: { ja: 'ケースの詳細', en: 'Case details' },
  goals: { ja: '目的', en: 'Goals' },
  preferences: { ja: '嗜好', en: 'Preferences' },
  constraints: { ja: '制約', en: 'Constraints' },
  assumptions: { ja: '前提', en: 'Assumptions' },
  fixed: { ja: 'このケースが固定する条件', en: 'Conditions this case fixes' },
  fixesNothing: { ja: 'このケースは固定条件を設定していません。', en: 'This case pins no conditions.' },
}

const sectionStyle: React.CSSProperties = {
  fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: '#94a3b8', margin: '10px 0 3px',
}

export default function CaseDetailsModal({
  open,
  testCase,
  onClose,
}: {
  open: boolean
  testCase: CombinedTestCase | null
  onClose: () => void
}): JSX.Element | null {
  const { lang } = useLanguage()
  if (!open || !testCase) return null

  const section = (label: BilingualLabel, items?: BilingualLabel[]) =>
    items && items.length > 0 ? (
      <>
        <p style={sectionStyle}>{t(label, lang)}</p>
        <ul style={{ fontSize: '0.8em', color: '#334155', margin: 0, paddingLeft: '1.05em' }}>
          {items.map((item, i) => <li key={i}>{t(item, lang)}</li>)}
        </ul>
      </>
    ) : null

  const fixed = testCase.journey.fixed_overrides ?? {}
  const fixedEntries = Object.entries(fixed)

  return (
    <Modal open title={t(LABELS.title, lang)} onClose={onClose}>
      <div data-testid="case-details-modal">
        <p style={{ fontSize: '0.83em', lineHeight: 1.6, color: '#475569', margin: 0 }}>
          {t(testCase.persona.narrative, lang)}
        </p>

        {section(LABELS.goals, testCase.persona.goals)}
        {section(LABELS.preferences, testCase.persona.preferences)}
        {section(LABELS.constraints, testCase.persona.constraints)}
        {section(LABELS.assumptions, testCase.persona.assumptions)}

        <p style={sectionStyle}>{t(LABELS.fixed, lang)}</p>
        <div data-testid="case-fixed-conditions" style={{ fontSize: '0.78em', color: '#334155' }}>
          {fixedEntries.length === 0 ? (
            // Saying so beats an empty box (07-27 §9.1).
            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{t(LABELS.fixesNothing, lang)}</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.05em' }}>
              {fixedEntries.map(([key, value]) => (
                <li key={key}>
                  <code style={{ color: '#64748b' }}>{key}</code>: {String(value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
