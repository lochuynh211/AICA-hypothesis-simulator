/**
 * GlobalLanguageToggle — the single JA / EN toggle in the top app bar.
 *
 * Reads/writes the top-level `LanguageProvider` (the one source of truth).
 * Replaces the former per-screen toggles (trigger `LanguageToggle`, proposal
 * `ProposalLanguageToggle`) — switching here follows you across every shell.
 */
import { useLanguage } from '../../state/language'

export default function GlobalLanguageToggle() {
  const { lang, setLang } = useLanguage()

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    fontSize: '0.8em',
    fontWeight: active ? 700 : 400,
    background: active ? '#2563eb' : 'transparent',
    color: active ? '#fff' : '#94a3b8',
    border: active ? '1px solid #1d4ed8' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}>
      <button
        data-testid="lang-toggle-ja"
        aria-pressed={lang === 'ja'}
        onClick={() => setLang('ja')}
        style={btnStyle(lang === 'ja')}
      >
        JA
      </button>
      <button
        data-testid="lang-toggle-en"
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
        style={btnStyle(lang === 'en')}
      >
        EN
      </button>
    </div>
  )
}
