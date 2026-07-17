/**
 * SeedPicker (P3 T026; reworked per owner feedback 2026-07-17 — no separate
 * Load button, selecting a seed AUTOLOADS it immediately) — lists committed
 * base-seed worlds (`GET /api/proposal/seeds`) and loads one
 * (`GET /api/proposal/seeds/{id}`) into the whole editable world, replacing
 * every group at once.
 */
import { useEffect, useRef, useState } from 'react'
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
  // Tracks the `selectedSeedId` THIS component most recently pushed into the
  // store (or `null` if it never has). Lets the reflect-effect below tell
  // "the store changed because I just dispatched it" (already mirrored via
  // `setSelected` above — a no-op here) apart from "the store changed
  // because something ELSE loaded a world" (e.g. the app's auto-init effect,
  // or a preset's atomic LOAD_PRESET, which clears this to `null`) — the
  // latter must always be reflected, even after the user already picked a
  // seed here (feature 018 — PresetPicker must be able to override).
  const lastDispatchedSeedId = useRef<string | null>(null)

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

  // Reflect a seed selection loaded from OUTSIDE this component (auto-init,
  // or a preset's atomic LOAD_PRESET clearing it to null) — always, not only
  // into an empty selection, so a later external load correctly overrides an
  // earlier direct choice too.
  useEffect(() => {
    if (state.selectedSeedId !== lastDispatchedSeedId.current) {
      setSelected(state.selectedSeedId ?? '')
      lastDispatchedSeedId.current = state.selectedSeedId
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSeedId])

  async function handleSelect(seedId: string) {
    if (!seedId) return
    setSelected(seedId)
    setLoading(true)
    setError(null)
    try {
      const seed = await getSeed(seedId)
      lastDispatchedSeedId.current = seed.seed_id
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
