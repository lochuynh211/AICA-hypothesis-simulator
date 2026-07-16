/**
 * WorldClonePicker (P3 T031) — "clone a base seed and change ONE variable"
 * contrast control (data-model.md §WorldClone, research.md §R5, milestone
 * §5 one-variable contrast changes). Offers:
 *   - a base-seed selector (defaults to the currently-loaded seed, if any),
 *   - the milestone §5 one-variable presets as ready-made variant buttons,
 *   - an arbitrary single-field override (path + value) for anything else.
 *
 * On a successful clone, dispatches `CLONE_CREATED` — this replaces the
 * whole editable world with the clone's world and sets `activeClone` so
 * `WorldDiffView` can render the before/after.
 */
import { useEffect, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { cloneWorld, getSeeds, type FieldOverride } from '../../api/proposalClient'

const LABELS = {
  baseSeed: { ja: 'ベースシード', en: 'Base seed' },
  presets: { ja: 'プリセット（1変数対比）', en: 'Presets (one-variable contrast)' },
  applyPreset: { ja: 'プリセットで複製', en: 'Clone with preset' },
  custom: { ja: 'カスタム変更', en: 'Custom change' },
  path: { ja: 'パス', en: 'Path' },
  value: { ja: '値', en: 'Value' },
  applyCustom: { ja: 'カスタム変更で複製', en: 'Clone with custom change' },
}

/** One selectable clone-and-change-one-variable preset variant. Each pair in
 * milestone §5 ("motion driving↔stopped" etc.) is offered as two separate
 * variants here (one per side), so choosing either one is a single click. */
const PRESET_VARIANTS: { key: string; label: { ja: string; en: string }; override: FieldOverride }[] = [
  { key: 'motion-driving', label: { ja: '走行中', en: 'Motion → driving' }, override: { path: 'situation.motion_state', value: 'driving' } },
  { key: 'motion-stopped', label: { ja: '停車中', en: 'Motion → stopped' }, override: { path: 'situation.motion_state', value: 'stopped' } },
  { key: 'drowsiness-high', label: { ja: '眠気：高', en: 'Drowsiness → high' }, override: { path: 'situation.drowsiness_level', value: 90 } },
  { key: 'drowsiness-low', label: { ja: '眠気：低', en: 'Drowsiness → low' }, override: { path: 'situation.drowsiness_level', value: 10 } },
  { key: 'fatigue-high', label: { ja: '疲労：高', en: 'Fatigue → high' }, override: { path: 'situation.fatigue_level', value: 90 } },
  { key: 'fatigue-low', label: { ja: '疲労：低', en: 'Fatigue → low' }, override: { path: 'situation.fatigue_level', value: 10 } },
  {
    key: 'rest-8',
    label: { ja: '休憩地点まで8分', en: 'Min. until rest → 8' },
    override: { path: 'situation.estimated_min_until_rest_spot', value: 8 },
  },
  {
    key: 'rest-45',
    label: { ja: '休憩地点まで45分', en: 'Min. until rest → 45' },
    override: { path: 'situation.estimated_min_until_rest_spot', value: 45 },
  },
  { key: 'oshi-on', label: { ja: '推しモード：ON', en: 'Oshi mode → on' }, override: { path: 'driver_profile.oshi_mode', value: 'on' } },
  { key: 'oshi-off', label: { ja: '推しモード：OFF', en: 'Oshi mode → off' }, override: { path: 'driver_profile.oshi_mode', value: 'off' } },
  {
    key: 'event-upcoming',
    label: { ja: '予定イベントあり', en: 'Upcoming event → present' },
    override: { path: 'driver_profile.scheduled_event_type', value: 'live_show' },
  },
  {
    key: 'event-none',
    label: { ja: '予定イベントなし', en: 'Upcoming event → none' },
    override: { path: 'driver_profile.scheduled_event_type', value: 'none' },
  },
  {
    key: 'rejection-present',
    label: { ja: '直近の拒否あり', en: 'Recent rejection → present' },
    override: {
      path: 'situation.recent_service_rejections',
      value: [{ service_id: 'music_playlist', rejected_at: '2026-07-16T09:00:00Z' }],
    },
  },
  {
    key: 'rejection-none',
    label: { ja: '直近の拒否なし', en: 'Recent rejection → none' },
    override: { path: 'situation.recent_service_rejections', value: [] },
  },
  {
    key: 'confidence-high',
    label: { ja: '受諾信頼度：高', en: 'Acceptance confidence → high' },
    override: { path: 'driver_profile.content_proposal_acceptance_confidence', value: { 'synthetic-track-0001': 0.9 } },
  },
  {
    key: 'confidence-low',
    label: { ja: '受諾信頼度：低', en: 'Acceptance confidence → low' },
    override: { path: 'driver_profile.content_proposal_acceptance_confidence', value: { 'synthetic-track-0001': 0.1 } },
  },
  {
    key: 'genre-on',
    label: { ja: 'ジャンル選好：ON', en: 'genre_affinity_v1 → on' },
    override: { path: 'driver_profile.genre_affinity_v1_enabled', value: true },
  },
  {
    key: 'genre-off',
    label: { ja: 'ジャンル選好：OFF', en: 'genre_affinity_v1 → off' },
    override: { path: 'driver_profile.genre_affinity_v1_enabled', value: false },
  },
]

/** Best-effort coercion of a free-typed custom value: JSON first (so
 * booleans/numbers/objects/arrays work), falling back to the raw string. */
function coerceCustomValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export default function WorldClonePicker() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  const [baseSeedId, setBaseSeedId] = useState('')
  const [presetKey, setPresetKey] = useState(PRESET_VARIANTS[0].key)
  const [customPath, setCustomPath] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSeeds()
      .then((resp) => {
        if (cancelled) return
        dispatch({ type: 'SET_SEEDS', seeds: resp.seeds })
        setBaseSeedId((prev) => prev || state.selectedSeedId || resp.seeds[0]?.seed_id || '')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state.selectedSeedId) setBaseSeedId(state.selectedSeedId)
  }, [state.selectedSeedId])

  async function applyOverrides(overrides: FieldOverride[]) {
    if (!baseSeedId) {
      setError('A base seed must be selected before cloning.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const clone = await cloneWorld(baseSeedId, overrides)
      dispatch({ type: 'CLONE_CREATED', clone })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleApplyPreset() {
    const variant = PRESET_VARIANTS.find((v) => v.key === presetKey)
    if (!variant) return
    void applyOverrides([variant.override])
  }

  function handleApplyCustom() {
    if (!customPath) return
    void applyOverrides([{ path: customPath, value: coerceCustomValue(customValue) }])
  }

  return (
    <div data-testid="world-clone-picker" style={{ display: 'grid', gap: '8px' }}>
      <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {t(LABELS.baseSeed, lang)}
        <select data-testid="clone-base-seed-select" value={baseSeedId} onChange={(e) => setBaseSeedId(e.target.value)}>
          {state.seeds.map((seed) => (
            <option key={seed.seed_id} value={seed.seed_id}>
              {t(seed.label, lang)}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 8px', alignItems: 'center' }}>
        <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {t(LABELS.presets, lang)}
          <select data-testid="clone-preset-select" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
            {PRESET_VARIANTS.map((variant) => (
              <option key={variant.key} value={variant.key}>
                {t(variant.label, lang)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="clone-preset-apply" disabled={loading || !baseSeedId} onClick={handleApplyPreset}>
          {loading ? '…' : t(LABELS.applyPreset, lang)}
        </button>
      </div>

      <div style={{ fontSize: '0.72em', fontWeight: 700, color: '#9ca3af', margin: '4px 0 0' }}>
        {t(LABELS.custom, lang)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px 8px', alignItems: 'center' }}>
        <input
          data-testid="clone-custom-path"
          type="text"
          placeholder={t(LABELS.path, lang)}
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
        />
        <input
          data-testid="clone-custom-value"
          type="text"
          placeholder={t(LABELS.value, lang)}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
        />
        <button
          type="button"
          data-testid="clone-custom-apply"
          disabled={loading || !baseSeedId || !customPath}
          onClick={handleApplyCustom}
        >
          {loading ? '…' : t(LABELS.applyCustom, lang)}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: '0.76em', color: '#dc2626', margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  )
}
