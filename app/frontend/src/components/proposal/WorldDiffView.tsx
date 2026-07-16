/**
 * WorldDiffView (P3 T031) — renders the deterministic field-level diff of
 * the most recently created/loaded `WorldClone` (`state.activeClone`):
 * EXACTLY the overridden path(s), each with its before/after value — never
 * anything unchanged (data-model.md §WorldClone).
 *
 * Renders nothing when there is no active clone (e.g. before any clone has
 * been made, or after `CLEAR_ACTIVE_CLONE`).
 */
import { t, type UiLanguage } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'

const LABELS = {
  title: { ja: '対比クローンの差分', en: 'Contrast clone diff' },
  path: { ja: 'パス', en: 'Path' },
  before: { ja: '変更前', en: 'Before' },
  after: { ja: '変更後', en: 'After' },
  dismiss: { ja: '閉じる', en: 'Dismiss' },
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export default function WorldDiffView() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, activeClone } = state

  if (!activeClone) return null

  return (
    <div
      data-testid="world-diff-view"
      style={{
        border: '1px solid #bfdbfe',
        background: '#eff6ff',
        borderRadius: '8px',
        padding: '8px 10px',
        margin: '8px 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <strong style={{ fontSize: '0.78em', color: '#1d4ed8' }}>
          {t(LABELS.title, lang)} <code style={{ fontWeight: 400 }}>{activeClone.clone_id}</code>
        </strong>
        <button type="button" data-testid="world-diff-dismiss" onClick={() => dispatch({ type: 'CLEAR_ACTIVE_CLONE' })}>
          {t(LABELS.dismiss, lang)}
        </button>
      </div>
      <table data-testid="world-diff-table" style={{ width: '100%', fontSize: '0.78em', marginTop: '6px', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <ThLabel label={LABELS.path} lang={lang} />
            <ThLabel label={LABELS.before} lang={lang} />
            <ThLabel label={LABELS.after} lang={lang} />
          </tr>
        </thead>
        <tbody>
          {activeClone.diff.map((entry) => (
            <tr key={entry.path} data-testid={`world-diff-row-${entry.path}`}>
              <td style={{ padding: '3px 6px', fontFamily: 'monospace' }}>{entry.path}</td>
              <td data-testid={`world-diff-before-${entry.path}`} style={{ padding: '3px 6px', color: '#991b1b' }}>
                {formatValue(entry.before)}
              </td>
              <td data-testid={`world-diff-after-${entry.path}`} style={{ padding: '3px 6px', color: '#166534' }}>
                {formatValue(entry.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ThLabel({ label, lang }: { label: { ja: string; en: string }; lang: UiLanguage }) {
  return <th style={{ textAlign: 'left', padding: '3px 6px', color: '#6b7280', fontWeight: 700 }}>{t(label, lang)}</th>
}
