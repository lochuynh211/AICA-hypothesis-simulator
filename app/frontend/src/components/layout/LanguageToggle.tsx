/**
 * LanguageToggle (M6 T004) — JA / EN buttons in the persistent header nav.
 *
 * Dispatches SET_LANGUAGE to runStore; components downstream read
 * state.uiLanguage and resolve bilingual labels through t().
 *
 * Session-only: switching language does NOT persist across page loads.
 */

import { useRunStore } from '../../state/runStore'

export default function LanguageToggle() {
  const { state, dispatch } = useRunStore()
  const { uiLanguage } = state

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
    <div style={{ display: 'flex', gap: '2px', marginLeft: '8px' }}>
      <button
        data-testid="lang-toggle-ja"
        aria-pressed={uiLanguage === 'ja'}
        onClick={() => dispatch({ type: 'SET_LANGUAGE', lang: 'ja' })}
        style={btnStyle(uiLanguage === 'ja')}
      >
        JA
      </button>
      <button
        data-testid="lang-toggle-en"
        aria-pressed={uiLanguage === 'en'}
        onClick={() => dispatch({ type: 'SET_LANGUAGE', lang: 'en' })}
        style={btnStyle(uiLanguage === 'en')}
      >
        EN
      </button>
    </div>
  )
}
