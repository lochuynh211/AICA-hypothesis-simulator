// app/frontend/src/components/review/ExperienceCaseCard.tsx
/**
 * The compact case card: brief, what-to-watch chips, one-line persona.
 *
 * DELIBERATELY ABSENT (07-27 §6.1): expected outcome, expected causal path,
 * journey narrative, event list, automatic path, resolved artifact references.
 * The customer does not read them, and an "expected outcome" would contradict
 * the whole premise — the expectation is what review PRODUCES.
 */
import type { CombinedTestCase } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  watch: { ja: '注目点', en: 'What to watch' },
  details: { ja: 'ケースの詳細', en: 'Case details' },
}

export default function ExperienceCaseCard({
  testCase,
  onOpenDetails,
}: {
  testCase: CombinedTestCase
  onOpenDetails: () => void
}): JSX.Element {
  const { lang } = useLanguage()

  return (
    <div
      data-testid="experience-case-card"
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 11px', marginBottom: '9px' }}
    >
      <p data-testid="case-brief" style={{ fontSize: '0.82em', lineHeight: 1.6, margin: 0 }}>
        {t(testCase.brief, lang)}
      </p>

      <p style={{ fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '9px 0 3px' }}>
        {t(LABELS.watch, lang)}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {testCase.what_to_watch.map((chip, i) => (
          <span
            key={i}
            data-testid="case-watch-chip"
            style={{ fontSize: '0.72em', padding: '1px 7px', borderRadius: '5px', color: '#1d4ed8', background: '#eff4ff', border: '1px solid #bfdbfe' }}
          >
            {t(chip, lang)}
          </span>
        ))}
      </div>

      <p data-testid="case-persona-line" style={{ fontSize: '0.76em', color: '#475569', margin: '9px 0 0' }}>
        {t(testCase.persona.name, lang)}
      </p>

      <button
        type="button"
        data-testid="case-details-button"
        onClick={onOpenDetails}
        style={{ marginTop: '7px', fontSize: '0.76em', padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569' }}
      >
        {t(LABELS.details, lang)}
      </button>
    </div>
  )
}
