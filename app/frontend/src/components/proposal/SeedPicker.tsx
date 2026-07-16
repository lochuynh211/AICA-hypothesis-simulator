/**
 * SeedPicker (P3 T026) — lists committed base-seed worlds
 * (`GET /api/proposal/seeds`) and loads one (`GET /api/proposal/seeds/{id}`)
 * into the whole editable world, replacing every group at once.
 */
import { useEffect, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { getSeeds, getSeed } from '../../api/proposalClient'

const LABELS = {
  seed: { ja: 'シード', en: 'Seed' },
  load: { ja: '読み込む', en: 'Load' },
}

export default function SeedPicker() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSeeds()
      .then((resp) => {
        if (cancelled) return
        dispatch({ type: 'SET_SEEDS', seeds: resp.seeds })
        if (resp.seeds.length > 0) setSelected((prev) => prev || resp.seeds[0].seed_id)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLoad() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const seed = await getSeed(selected)
      dispatch({ type: 'LOAD_SEED', seedId: seed.seed_id, world: seed.world })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 8px', alignItems: 'center' }}>
      <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {t(LABELS.seed, lang)}
        <select
          data-testid="seed-picker-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {state.seeds.map((seed) => (
            <option key={seed.seed_id} value={seed.seed_id}>
              {t(seed.label, lang)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" data-testid="seed-picker-load" disabled={loading || !selected} onClick={handleLoad}>
        {loading ? '…' : t(LABELS.load, lang)}
      </button>
      {error && (
        <p role="alert" style={{ gridColumn: '1 / -1', fontSize: '0.76em', color: '#dc2626', margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  )
}
