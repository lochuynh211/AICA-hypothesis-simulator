/**
 * PreferenceHistorySection — the "Preference & history" block (PROFILE_GROUPS +
 * the opt-in genre-affinity extension) bound to `proposalStore.world.driver_profile`,
 * dispatching `SET_DRIVER_PROFILE_FIELD` / genre actions. Extracted VERBATIM from
 * `WorldPanel` (feature 020 extract-and-share) so both the Proposal screen and
 * the Combined Simulator's Driver-profile popup render the identical editable
 * preference + history fields.
 *
 * `oshi_artists` is a repeatable list of artist-ID + 熱狂度 (enthusiasm) rows
 * sourced from the loaded catalog (feature 025 slice S4 — replaces the old
 * single `oshi_id`/`oshi_type` pair). Store-driven, no props.
 */
import { useMemo } from 'react'
import { t } from '../../../../i18n/t'
import { useProposalStore } from '../../../../state/proposalStore'
import {
  GENRE_VOCABULARY,
  type DriverProfile,
  type GenreLiteralValue,
  type UsageLevelValue,
} from '../../../../api/proposalClient'
import { GenreUsageTable, NestedRecordEditor } from '../../fieldEditors'
import { FieldRow, issuesForPath, PROFILE_GROUPS, USAGE_LEVEL_OPTIONS } from './worldFields'
import { genreLabel, optionLabel } from '../../../../lib/review/reviewVocabulary'

const LABELS = {
  genreExtension: { ja: 'ジャンル選好', en: 'Genre affinity' },
  scenes: { ja: 'シーン別ジャンル利用', en: 'Scene genre usage' },
  genreAffinityEnabled: { ja: 'ジャンル選好を有効化', en: 'Enable genre affinity' },
  usageByGenre: { ja: 'ジャンル別利用状況', en: 'Usage by genre' },
  off: { ja: 'オフ', en: 'Off' },
  on: { ja: 'オン', en: 'On' },
}

export default function PreferenceHistorySection() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, world } = state
  const driverProfile = world.driver_profile

  // Artist options for oshi_artists rows — derived client-side from the
  // already-loaded catalog, de-duplicated by artist id (same as WorldPanel).
  const artists = useMemo(() => {
    const byId = new Map<string, string>()
    for (const song of state.catalog) {
      for (const artist of song.spotify_track.artists ?? []) {
        if (!byId.has(artist.id)) byId.set(artist.id, artist.name)
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [state.catalog])

  function setProfileField(key: keyof DriverProfile, value: unknown) {
    dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key, value })
  }

  return (
    <div data-testid="preference-history-section">
      {PROFILE_GROUPS.map((group) => (
        <div key={t(group.label, 'en')}>
          <div style={{ fontSize: '0.72em', fontWeight: 700, color: '#9ca3af', margin: '10px 0 2px' }}>
            {t(group.label, lang)}
          </div>
          {group.fields.map((def) => (
            <FieldRow
              key={def.key}
              def={def}
              value={(driverProfile as unknown as Record<string, unknown>)[def.key]}
              onChange={(value) => setProfileField(def.key as keyof DriverProfile, value)}
              lang={lang}
              issues={issuesForPath(state.worldValidationIssues, `driver_profile.${def.key}`)}
              artists={def.key === 'oshi_artists' ? artists : undefined}
            />
          ))}
        </div>
      ))}

      {/* Genre extension — opt-in toggle; values are preserved when hidden. */}
      <div style={{ fontSize: '0.72em', fontWeight: 700, color: '#9ca3af', margin: '10px 0 2px' }}>
        {t(LABELS.genreExtension, lang)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '6px 10px', padding: '6px 0' }}>
        <span style={{ fontSize: '0.82em', color: '#4b5563' }}>
          {t(LABELS.genreAffinityEnabled, lang)}
        </span>
        <select
          data-testid="genre-affinity-toggle"
          value={String(driverProfile.genre_affinity_v1_enabled)}
          onChange={(e) => dispatch({ type: 'SET_GENRE_EXTENSION_ENABLED', enabled: e.target.value === 'true' })}
        >
          <option value="false">{t(LABELS.off, lang)}</option>
          <option value="true">{t(LABELS.on, lang)}</option>
        </select>
      </div>
      {driverProfile.genre_affinity_v1_enabled && (
        <div data-testid="genre-fields">
          <div style={{ fontSize: '0.78em', color: '#6b7280', margin: '4px 0 2px' }}>
            {t(LABELS.usageByGenre, lang)}
          </div>
          <GenreUsageTable
            testId="genre-usage-by-genre"
            genres={GENRE_VOCABULARY}
            value={driverProfile.usage_by_genre ?? {}}
            lang={lang}
            onChange={(genre, level) =>
              dispatch({
                type: 'SET_USAGE_BY_GENRE',
                genre: genre as GenreLiteralValue,
                level: level as UsageLevelValue,
              })
            }
          />
          <div style={{ fontSize: '0.78em', color: '#6b7280', margin: '8px 0 2px' }}>
            {t(LABELS.scenes, lang)}
          </div>
          <NestedRecordEditor
            testId="genre-scene-usage"
            value={(driverProfile.scene_genre_usage ?? {}) as Record<string, Record<string, string>>}
            lang={lang}
            onChange={(next) =>
              dispatch({
                type: 'SET_DRIVER_PROFILE_FIELD',
                key: 'scene_genre_usage',
                value: next,
              })
            }
            innerKeyOptions={GENRE_VOCABULARY}
            innerValueOptions={USAGE_LEVEL_OPTIONS}
            keyLabel={genreLabel}
            valueLabel={(v) => optionLabel('scene_genre_usage', v)}
          />
        </div>
      )}
    </div>
  )
}
