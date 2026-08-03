// app/frontend/src/components/review/ExperienceCasePicker.tsx
/**
 * The experience test-case picker.
 *
 * A flat <select>: there are no case groups in V1 because contrast pairs were
 * removed, so optgroups would carry no information.
 *
 * There is no "no test case" entry: a case is always selected (the shell
 * applies C-01 on first mount). The empty option existed only while a null
 * selection was reachable — with one, the browser displayed the first real
 * case while the state said null, so the setup on screen belonged to no case
 * and re-picking that case fired no change event.
 *
 * The flag chip counts ONLY the three criticisms. "Not sure" is deliberately
 * excluded — it is a request for explanation, not a complaint, and must not
 * inflate a number that means "these need attention".
 */
import { listCases } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  testCase: { ja: '体験テストケース', en: 'Experience test case' },
  flagged: { ja: '要確認の入力', en: 'flagged inputs' },
}

export default function ExperienceCasePicker({
  selectedCaseId,
  flagCounts,
  onSelect,
}: {
  selectedCaseId: string | null
  flagCounts: Record<string, number>
  onSelect: (caseId: string) => void
}): JSX.Element {
  const { lang } = useLanguage()
  const flags = selectedCaseId ? (flagCounts[selectedCaseId] ?? 0) : 0

  return (
    <div data-testid="experience-case-picker" style={{ marginBottom: '8px' }}>
      <label style={{ display: 'block', fontSize: '0.78em', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
        {t(LABELS.testCase, lang)}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <select
          data-testid="experience-case-select"
          value={selectedCaseId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ flex: 1, fontSize: '0.84em', padding: '5px' }}
        >
          {listCases().map((c) => (
            <option key={c.case_id} value={c.case_id}>
              {t(c.title, lang)}
            </option>
          ))}
        </select>
        {flags > 0 && (
          <span
            data-testid="case-flag-chip"
            title={t(LABELS.flagged, lang)}
            style={{
              fontSize: '0.72em', fontWeight: 800, padding: '1px 7px', borderRadius: '999px',
              color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d',
            }}
          >
            {flags}
          </span>
        )}
      </div>
    </div>
  )
}
