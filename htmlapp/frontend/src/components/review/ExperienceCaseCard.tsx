// app/frontend/src/components/review/ExperienceCaseCard.tsx
/**
 * The case card: everything a customer needs to understand the case, read
 * straight off the screen.
 *
 * The persona narrative, goals, preferences, constraints, assumptions and the
 * conditions the case fixes used to sit behind a "Case details" button in a
 * popup. They are inline now (owner review): a customer being walked through
 * the simulator should not have to click into a dialog to find out who is
 * driving and what the case holds fixed, and detail behind a button is detail
 * nobody reads.
 *
 * STILL DELIBERATELY ABSENT (07-27 §6.1): expected outcome, expected causal
 * path, event list, automatic path, resolved artifact references. An "expected
 * outcome" would contradict the whole premise — the expectation is what review
 * PRODUCES, never an input.
 *
 * Every list is optional in the contract, so each section renders only when it
 * has content: an empty heading says nothing and costs space.
 */
import type { BilingualLabel, CombinedTestCase } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { UiLanguage } from '../../i18n/t'
import { fieldName, optionLabel, booleanLabel } from '../../lib/review/reviewVocabulary'

const LABELS = {
  watch: { ja: '注目点', en: 'What to watch' },
  driver: { ja: 'ドライバー', en: 'Driver' },
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

const listStyle: React.CSSProperties = {
  fontSize: '0.8em', lineHeight: 1.55, color: '#334155', margin: 0, paddingLeft: '1.05em',
}

/**
 * A `journey.fixed_overrides` value, in words — never the raw JSON value.
 * Booleans read as あり/なし (via `booleanLabel`), tag arrays read as each
 * tag's own name (via `optionLabel`, joined with the language's own list
 * separator — never an ASCII comma sitting inside Japanese prose), and a
 * `[min, max]` km pair (mountain_range_km / jam_range_km) reads as a range.
 * A bare numeric override (initial_drowsiness / initial_fatigue) is the only
 * case with nothing further to translate: the number itself IS the pinned
 * value.
 */
function fixedValueText(key: string, value: unknown, lang: UiLanguage): string {
  if (typeof value === 'boolean') return t(booleanLabel(value), lang)
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === 'number')) {
      return `${value[0]}〜${value[1]} km`
    }
    return value.map((v) => t(optionLabel(key, String(v)), lang)).join(lang === 'ja' ? '・' : ', ')
  }
  return String(value)
}

export default function ExperienceCaseCard({ testCase }: { testCase: CombinedTestCase }): JSX.Element {
  const { lang } = useLanguage()

  const section = (label: BilingualLabel, items: BilingualLabel[] | undefined, testid: string) =>
    items && items.length > 0 ? (
      <>
        <p style={sectionStyle}>{t(label, lang)}</p>
        <ul data-testid={testid} style={listStyle}>
          {items.map((item, i) => <li key={i}>{t(item, lang)}</li>)}
        </ul>
      </>
    ) : null

  const fixedEntries = Object.entries(testCase.journey.fixed_overrides ?? {})

  return (
    <div data-testid="experience-case-card" className="review-card">
      <p data-testid="case-brief" style={{ fontSize: '0.82em', lineHeight: 1.6, margin: 0 }}>
        {t(testCase.brief, lang)}
      </p>

      {testCase.what_to_watch.length > 0 && (
        <>
          <p style={sectionStyle}>{t(LABELS.watch, lang)}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {testCase.what_to_watch.map((chip, i) => (
              <span
                key={i}
                data-testid="case-watch-chip"
                style={{
                  fontSize: '0.72em', padding: '1px 7px', borderRadius: '5px',
                  color: '#1d4ed8', background: '#eff4ff', border: '1px solid #bfdbfe',
                }}
              >
                {t(chip, lang)}
              </span>
            ))}
          </div>
        </>
      )}

      <p style={sectionStyle}>{t(LABELS.driver, lang)}</p>
      <p data-testid="case-persona-line" style={{ fontSize: '0.8em', fontWeight: 700, color: '#1e293b', margin: 0 }}>
        {t(testCase.persona.name, lang)}
      </p>
      <p
        data-testid="case-persona-narrative"
        style={{ fontSize: '0.8em', lineHeight: 1.55, color: '#475569', margin: '2px 0 0' }}
      >
        {t(testCase.persona.narrative, lang)}
      </p>

      {section(LABELS.goals, testCase.persona.goals, 'case-goals')}
      {section(LABELS.preferences, testCase.persona.preferences, 'case-preferences')}
      {section(LABELS.constraints, testCase.persona.constraints, 'case-constraints')}
      {section(LABELS.assumptions, testCase.persona.assumptions, 'case-assumptions')}

      <p style={sectionStyle}>{t(LABELS.fixed, lang)}</p>
      <div data-testid="case-fixed-conditions" style={{ fontSize: '0.78em', color: '#334155' }}>
        {fixedEntries.length === 0 ? (
          // Saying so beats an empty box (07-27 §9.1).
          <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{t(LABELS.fixesNothing, lang)}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.05em' }}>
            {fixedEntries.map(([key, value]) => (
              <li key={key} data-testid={`case-fixed-${key}`}>
                {t(fieldName(key), lang)}: {fixedValueText(key, value, lang)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
