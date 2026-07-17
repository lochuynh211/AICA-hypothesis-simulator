/**
 * SeedPicker (P3 T026; reworked per owner feedback 2026-07-17 — no separate
 * Load button, selecting a seed AUTOLOADS it immediately) — lists committed
 * base-seed worlds (`GET /api/proposal/seeds`) and loads one
 * (`GET /api/proposal/seeds/{id}`) into the whole editable world, replacing
 * every group at once.
 */
import { useEffect, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { getSeeds, getSeed } from '../../api/proposalClient'

const LABELS = {
  seed: { ja: 'シード', en: 'Seed' },
}

export default function SeedPicker() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  // LOCAL selection state (not bound directly to `state.selectedSeedId`):
  // the dropdown must reflect exactly what the user picked, immediately —
  // binding it straight to the store would snap it back if `getSeed`'s
  // response ever names a different seed_id than requested (it always
  // matches in practice, but the previous store-bound version depended on
  // that never being violated even in a race).
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSeeds()
      .then((resp) => {
        if (!cancelled) dispatch({ type: 'SET_SEEDS', seeds: resp.seeds })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect a seed loaded by someone else (e.g. the app's auto-init effect,
  // which calls getSeed + dispatches LOAD_SEED directly on first mount,
  // bypassing this picker) — but only to fill the INITIAL empty selection,
  // never to override a choice the user already made here.
  useEffect(() => {
    if (!selected && state.selectedSeedId) setSelected(state.selectedSeedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSeedId])

  async function handleSelect(seedId: string) {
    if (!seedId) return
    setSelected(seedId)
    setLoading(true)
    setError(null)
    try {
      const seed = await getSeed(seedId)
      dispatch({ type: 'LOAD_SEED', seedId: seed.seed_id, world: seed.world })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {t(LABELS.seed, lang)}
      <select
        data-testid="seed-picker-select"
        value={selected}
        disabled={loading}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="" disabled>
          {loading ? '…' : '—'}
        </option>
        {state.seeds.map((seed) => (
          <option key={seed.seed_id} value={seed.seed_id}>
            {t(seed.label, lang)}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" style={{ fontSize: '0.76em', color: '#dc2626', margin: '2px 0 0' }}>
          {error}
        </p>
      )}
    </label>
  )
}
