/**
 * PresetPicker (feature 018 — proposal preset test-cases, US1) — lists
 * committed preset test-cases (`GET /api/proposal/presets`) and loads one
 * (`GET /api/proposal/presets/{id}`) ATOMICALLY into the whole editable
 * world via `LOAD_PRESET`, mirroring `SeedPicker`'s fetch-on-mount +
 * autoload-on-select shape (no separate Load button).
 *
 * On selection, renders a bilingual BRIEF blurb — the preset's `brief` +
 * `hypothesis` (both already present on the cached `PresetSummary`, so no
 * second fetch is needed just to show them) — in a bordered info box styled
 * like `DatasetProvenanceBanner`, so the reviewer immediately sees what the
 * preset demonstrates and why.
 *
 * Selecting a preset supersedes any seed/profile selection (a preset is its
 * own self-contained world, not "the seed" or "the profile") — `LOAD_PRESET`
 * clears `selectedSeedId`/`selectedProfileId` to null, and `SeedPicker`/
 * `DriverProfilePicker` reflect that reset via their own fixed reflect-guard.
 *
 * GROUPING (feature 018 follow-up — `category`/`journey` on `PresetSummary`):
 * with ~27 presets a flat list is unscannable, so the `<select>` is organized
 * into `<optgroup>`s: journeys first (one group per distinct `journey.id`,
 * ordered by the minimum `preset_id` in the group, steps ascending within),
 * then standalone presets (`journey == null`) grouped by `category` in a
 * fixed order (situation → preference → history → baseline). See
 * `buildPresetGroups` below.
 */
import { useEffect, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { getPresets, getPreset } from '../../api/proposalClient'
import type { BilingualLabel, PresetCategory, PresetSummary } from '../../api/proposalClient'

const LABELS = {
  preset: { ja: 'プリセット（テストケース）', en: 'Preset (test-case)' },
  hypothesis: { ja: '仮説', en: 'Hypothesis' },
}

/** Fixed display order + bilingual label for each standalone (non-journey)
 * preset category. */
const CATEGORY_ORDER: PresetCategory[] = ['situation', 'preference', 'history', 'baseline']

const CATEGORY_LABELS: Record<PresetCategory, BilingualLabel> = {
  situation: { en: 'Situation — the drive decides', ja: '状況 — 走行が決める' },
  preference: { en: 'Preference — the driver’s taste', ja: '嗜好 — ドライバーの好み' },
  history: { en: 'History — past behavior', ja: '履歴 — 過去の行動' },
  baseline: { en: 'Baseline', ja: '基準' },
}

/** One rendered `<optgroup>` — either a journey timeline or a standalone
 * category — reduced to the same shape so the `<select>` render is uniform. */
type PresetGroup = { key: string; label: BilingualLabel; options: PresetSummary[] }

/**
 * Partition + order presets into the `<optgroup>` structure described above.
 *
 * Journeys are grouped by `journey.id`; the group's sort key is the MINIMUM
 * `preset_id` across its members (not just first-seen order), so the result
 * is correct even if `presets` isn't already sorted by `preset_id`. Options
 * within a journey group are ordered by `journey.step` ascending.
 *
 * Standalone presets (`journey == null`) are grouped by `category` in the
 * fixed `CATEGORY_ORDER`, keeping `preset_id` order within each category.
 * Empty category groups are omitted.
 */
function buildPresetGroups(presets: PresetSummary[]): PresetGroup[] {
  const journeyOptions = new Map<string, PresetSummary[]>()
  const journeyLabel = new Map<string, BilingualLabel>()
  const journeyMinId = new Map<string, string>()
  const standalone: PresetSummary[] = []

  for (const preset of presets) {
    const journey = preset.journey
    if (!journey) {
      standalone.push(preset)
      continue
    }
    const options = journeyOptions.get(journey.id)
    if (!options) {
      journeyOptions.set(journey.id, [preset])
      journeyLabel.set(journey.id, journey.label)
      journeyMinId.set(journey.id, preset.preset_id)
    } else {
      options.push(preset)
      if (preset.preset_id < (journeyMinId.get(journey.id) as string)) {
        journeyMinId.set(journey.id, preset.preset_id)
      }
    }
  }

  const journeyGroups: PresetGroup[] = Array.from(journeyOptions.keys())
    .sort((idA, idB) => {
      const a = journeyMinId.get(idA) as string
      const b = journeyMinId.get(idB) as string
      return a < b ? -1 : a > b ? 1 : 0
    })
    .map((journeyId) => ({
      key: `journey:${journeyId}`,
      label: journeyLabel.get(journeyId) as BilingualLabel,
      options: [...(journeyOptions.get(journeyId) as PresetSummary[])].sort(
        (a, b) => (a.journey?.step ?? 0) - (b.journey?.step ?? 0),
      ),
    }))

  const categoryGroups: PresetGroup[] = CATEGORY_ORDER.map((category) => ({
    key: `category:${category}`,
    label: CATEGORY_LABELS[category],
    options: standalone
      .filter((preset) => preset.category === category)
      .sort((a, b) => (a.preset_id < b.preset_id ? -1 : a.preset_id > b.preset_id ? 1 : 0)),
  })).filter((group) => group.options.length > 0)

  return [...journeyGroups, ...categoryGroups]
}

export default function PresetPicker() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  // LOCAL selection state (not bound directly to `state.selectedPresetId`) —
  // same rationale as SeedPicker: the dropdown must reflect exactly what the
  // user picked, immediately, independent of any response-shape assumption.
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPresets()
      .then((resp) => {
        if (!cancelled) dispatch({ type: 'SET_PRESETS', presets: resp.presets })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect a preset loaded by someone else — only to fill the INITIAL empty
  // selection (this component is itself the sole source of LOAD_PRESET
  // today; mirrors SeedPicker's original guard for the same reason).
  useEffect(() => {
    if (!selected && state.selectedPresetId) setSelected(state.selectedPresetId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedPresetId])

  async function handleSelect(presetId: string) {
    if (!presetId) return
    setSelected(presetId)
    setLoading(true)
    setError(null)
    try {
      const preset = await getPreset(presetId)
      dispatch({
        type: 'LOAD_PRESET',
        presetId: preset.preset_id,
        world: preset.world,
        overrides: preset.algorithm_config_overrides,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const selectedSummary = state.presets.find((p) => p.preset_id === selected)
  const presetGroups = buildPresetGroups(state.presets)

  return (
    <div>
      <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {t(LABELS.preset, lang)}
        <select
          data-testid="preset-picker-select"
          value={selected}
          disabled={loading}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="" disabled>
            {loading ? '…' : '—'}
          </option>
          {presetGroups.map((group) => (
            <optgroup key={group.key} label={t(group.label, lang)}>
              {group.options.map((preset) => (
                <option key={preset.preset_id} value={preset.preset_id}>
                  {t(preset.label, lang)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" style={{ fontSize: '0.76em', color: '#dc2626', margin: '2px 0 0' }}>
          {error}
        </p>
      )}
      {selectedSummary && (
        <div
          data-testid="preset-brief"
          style={{
            fontSize: '0.76em',
            color: '#4b5563',
            background: '#f8fafc',
            border: '1px solid #e5e7eb',
            borderRadius: '7px',
            padding: '6px 9px',
            margin: '6px 0 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <div style={{ fontWeight: 700, color: '#6b7280' }}>{t(LABELS.preset, lang)}</div>
          <div data-testid="preset-brief-text">{t(selectedSummary.brief, lang)}</div>
          <div data-testid="preset-brief-hypothesis" style={{ color: '#9ca3af' }}>
            <b>{t(LABELS.hypothesis, lang)}:</b> {selectedSummary.hypothesis}
          </div>
        </div>
      )}
    </div>
  )
}
