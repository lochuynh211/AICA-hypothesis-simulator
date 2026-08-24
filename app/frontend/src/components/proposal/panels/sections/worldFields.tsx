/**
 * worldFields — the World-editor field metadata + row renderers, extracted
 * VERBATIM from `WorldPanel` so its Situation and Preference/History blocks can
 * be reused as standalone sections (feature 020 extract-and-share) by both the
 * Proposal screen's WorldPanel and the Combined Simulator's editor popups.
 *
 * Pure/presentational — no store access here; the section components
 * (`SituationFieldRows` / `PreferenceHistorySection`) own the proposalStore
 * reads/dispatches and render `FieldRow`s from these defs.
 */
import { type CSSProperties } from 'react'
import { t, type UiLanguage } from '../../../../i18n/t'
import {
  SERVICE_ID_OPTIONS,
  type OshiArtist,
  type WorldValidationIssue,
} from '../../../../api/proposalClient'
import {
  RecordEditor,
  NestedRecordEditor,
  ItemListEditor,
} from '../../fieldEditors'
import { optionLabel, serviceLabel, type BilingualLabel } from '../../../../lib/review/reviewVocabulary'

/**
 * Matches an exact-path issue (`driver_profile.oshi_mode`) OR an indexed
 * sub-path issue rooted at `path` (`driver_profile.oshi_artists[0].artist_id`
 * matches base path `driver_profile.oshi_artists`) — the `oshi_artists`
 * field is a LIST (feature 025 slice S4), so the backend reports per-row
 * issues at `driver_profile.oshi_artists[{idx}].artist_id`, not at the bare
 * field path. The `[` boundary check keeps this from accidentally matching
 * an unrelated field that merely shares `path` as a prefix (e.g. a
 * hypothetical `driver_profile.oshi_artists_extra`).
 */
export function issuesForPath(issues: WorldValidationIssue[], path: string): WorldValidationIssue[] {
  return issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}[`))
}

export const USAGE_LEVEL_OPTIONS = ['never', 'low', 'med', 'high']
export const RECENCY_OPTIONS = ['never', 'long_unused', 'recent']

/**
 * The usage-level → point curve the content algorithm applies. Both scored
 * paths that read a never/low/med/high usage level now share these SAME values:
 *   • exact-song usage — `hyperparameters.history_curves.item_usage`
 *   • genre usage (usage_by_genre / scene_genre_usage) — `genre_affinity_maps.usage_curve`
 * in `packages/aica_transparent_content_selector_v1/package.json` (and the mock
 * selector) — those manifests are the SOURCE OF TRUTH; keep this in sync.
 * Shown beside each level in the usage dropdowns so a reviewer sees the number
 * the algorithm derives from "low"/"med"/"high", not a bare ordinal word.
 */
export const ITEM_USAGE_POINTS: Record<string, number> = { never: 0, low: 0.25, med: 0.5, high: 1.0 }

/** A signed point for the dropdown annotation: "+0.25" for a bonus, "0" for neutral. */
function formatUsagePoint(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

/**
 * A localized usage-level name with its point appended — e.g. 「高い (+1)」/
 * "High (+1)". `fieldKey` selects the base wording (catalog_item_usage_level /
 * usage_by_genre / scene_genre_usage all resolve to the never/low/med/high
 * labels); the point comes from the shared curve above. Used for the two
 * scored usage paths only — service usage is scored differently, so its levels
 * carry no point.
 */
export function usageLevelValueLabel(fieldKey: string, opt: string): BilingualLabel {
  const base = optionLabel(fieldKey, opt)
  const pt = ITEM_USAGE_POINTS[opt]
  if (pt === undefined) return base
  const suffix = ` (${formatUsagePoint(pt)})`
  return { ja: `${base.ja}${suffix}`, en: `${base.en}${suffix}` }
}

const itemUsageValueLabel = (opt: string): BilingualLabel =>
  usageLevelValueLabel('catalog_item_usage_level', opt)

/**
 * Compact width for a usage-LEVEL <select> carrying a point suffix (song
 * usage AND genre usage): the "(+0.25)" text widens the box, so cap it (with
 * ellipsis on the closed value) to keep every usage dropdown the same short
 * length — and, for the song rows, to hand the horizontal room back to the
 * long "name — artist(s)" key. Full options stay readable once open. NOT
 * applied to service usage/recency (no point suffix, so no widening).
 */
export const USAGE_LEVEL_SELECT_STYLE: CSSProperties = {
  maxWidth: '8em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

// Route/destination tag vocabularies — the SERVICE selector's own
// `recognized_route_tags` / `recognized_destination_tags` (its evidence
// saturates on recognized-tag COUNT; unrecognized tags are simply ignored,
// never an error). Content only scores these under the opt-in
// `genre_affinity_v1` extension (a strict subset maps to a genre).
export const ROUTE_TAG_OPTIONS = ['highway', 'mountain', 'coastal', 'urban', 'scenic_byway', 'rural']
export const DESTINATION_TAG_OPTIONS = ['coast', 'resort', 'nature', 'event', 'oshi_venue', 'event_hall', 'home', 'shopping']

/** Which algorithm(s) actually score this field in the current V1 transparent
 * packages. Replaces the old CDC-SU/normalized/proposed_addition provenance
 * labels — this panel now shows ONLY scored fields, so the badge answers the
 * one question that matters: does moving this actually change a proposal? */
export type UsedBy = 's' | 'c' | 'sc'

export type FieldKind =
  | 'number'
  | 'select'
  | 'boolean'
  | 'nullable_select'
  | 'slider'
  | 'tag_toggle'
  | 'oshi_artists'
  | 'record_enum'
  | 'record_number'
  | 'nested_record_enum'
  | 'item_list'

export type WorldFieldDef = {
  key: string
  label: { ja: string; en: string }
  kind: FieldKind
  options?: string[]
  keyOptions?: string[]
  idField?: string
  tsField?: string
  idPlaceholder?: string
  used: UsedBy
}

// ── World · situation — ONLY the fields actually scored by an algorithm ─────

export const SITUATION_FIELDS: WorldFieldDef[] = [
  { key: 'drowsiness_level', label: { ja: '眠気', en: 'Drowsiness' }, kind: 'slider', used: 'sc' },
  { key: 'fatigue_level', label: { ja: '疲労度', en: 'Fatigue level' }, kind: 'slider', used: 'sc' },
  { key: 'monotony_level', label: { ja: '単調さ', en: 'Monotony' }, kind: 'slider', used: 'sc' },
  {
    key: 'traffic_state',
    label: { ja: '交通', en: 'Traffic' },
    kind: 'select',
    options: ['normal', 'congested'],
    used: 'sc',
  },
  {
    key: 'road_type',
    label: { ja: '道路', en: 'Road' },
    kind: 'select',
    options: ['highway', 'local', 'mountain', 'parking'],
    used: 'sc',
  },
  {
    key: 'night_state',
    label: { ja: '昼夜', en: 'Day/Night' },
    kind: 'select',
    options: ['night', 'day'],
    used: 'sc',
  },
  {
    key: 'route_tags',
    label: { ja: 'ルート特徴', en: 'Route' },
    kind: 'tag_toggle',
    options: ROUTE_TAG_OPTIONS,
    used: 's',
  },
  {
    key: 'destination_tags',
    label: { ja: '目的地', en: 'Destination' },
    kind: 'tag_toggle',
    options: DESTINATION_TAG_OPTIONS,
    used: 's',
  },
  { key: 'child_present', label: { ja: '子ども同乗', en: 'Child present' }, kind: 'boolean', used: 's' },
  { key: 'multiple_passengers', label: { ja: '複数同乗', en: 'Multiple' }, kind: 'boolean', used: 's' },
]

// ── Preference & history — ONLY the fields actually scored by an algorithm ──

export type ProfileGroup = { label: { ja: string; en: string }; fields: WorldFieldDef[] }

export const PROFILE_GROUPS: ProfileGroup[] = [
  {
    label: { ja: '推し情報', en: 'Oshi' },
    fields: [
      { key: 'oshi_registered', label: { ja: '推し登録', en: 'Oshi registered' }, kind: 'boolean', used: 's' },
      { key: 'oshi_mode', label: { ja: '推しモード', en: 'Oshi mode' }, kind: 'select', options: ['on', 'off'], used: 's' },
      // A repeatable list — replaces the old single oshi_id/oshi_type pair
      // (feature 025 slice S4): a driver may register several oshi artists,
      // each with its own 熱狂度 (enthusiasm). Each row is implicitly
      // `oshi_type='artist'` (set at add-time; not user-editable — no
      // separate oshi_type control) — oshi_tags stays its own field, unscored.
      { key: 'oshi_artists', label: { ja: '推しアーティスト', en: 'Oshi artists' }, kind: 'oshi_artists', used: 'c' },
    ],
  },
  {
    label: { ja: 'ドライバー', en: 'Driver' },
    fields: [
      {
        key: 'age_band',
        label: { ja: '年代', en: 'Age' },
        kind: 'select',
        options: ['teens', '20s', '30s', '40s', '50s', '60plus'],
        used: 'c',
      },
    ],
  },
  {
    label: { ja: '利用頻度', en: 'Usage & recency' },
    fields: [
      { key: 'service_usage_level', label: { ja: 'サービス利用頻度', en: 'Service usage level' }, kind: 'record_enum', keyOptions: SERVICE_ID_OPTIONS, options: USAGE_LEVEL_OPTIONS, used: 's' },
      { key: 'service_recency_state', label: { ja: 'サービス最終利用', en: 'Service recency' }, kind: 'record_enum', keyOptions: SERVICE_ID_OPTIONS, options: RECENCY_OPTIONS, used: 's' },
      { key: 'scene_service_usage_level', label: { ja: 'シーン別サービス利用', en: 'Scene/service usage' }, kind: 'nested_record_enum', keyOptions: SERVICE_ID_OPTIONS, options: USAGE_LEVEL_OPTIONS, used: 's' },
      { key: 'catalog_item_usage_level', label: { ja: '楽曲利用頻度', en: 'Catalog item usage' }, kind: 'record_enum', options: USAGE_LEVEL_OPTIONS, used: 'c' },
    ],
  },
  {
    label: { ja: '再生履歴', en: 'Playback history' },
    fields: [
      { key: 'played_items', label: { ja: '再生済み', en: 'Played items' }, kind: 'item_list', idField: 'track_id', tsField: 'last_played_at', used: 'c' },
      { key: 'skipped_items', label: { ja: 'スキップ済み', en: 'Skipped items' }, kind: 'item_list', idField: 'track_id', tsField: 'skipped_at', used: 'c' },
      { key: 'changed_from_items', label: { ja: '変更元', en: 'Changed-from items' }, kind: 'item_list', idField: 'track_id', tsField: 'changed_at', used: 'c' },
    ],
  },
  {
    label: { ja: '提案・回復結果', en: 'Proposal / recovery results' },
    fields: [
      { key: 'service_proposal_acceptance_rate', label: { ja: 'サービス提案受諾率', en: 'Service acceptance rate' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, used: 's' },
      { key: 'service_recovery_rate', label: { ja: 'サービス回復率', en: 'Service recovery rate' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, used: 's' },
      { key: 'content_proposal_acceptance_rate', label: { ja: 'コンテンツ提案受諾率', en: 'Content acceptance rate' }, kind: 'record_number', used: 'c' },
      { key: 'content_recovery_rate', label: { ja: 'コンテンツ回復率', en: 'Content recovery rate' }, kind: 'record_number', used: 'c' },
    ],
  },
]

const BADGE_LABELS = {
  usedS: { ja: 'サービス（ステップ1）で採点', en: 'Scored by Service (STEP 1)' },
  usedC: { ja: 'コンテンツ（ステップ2）で採点', en: 'Scored by Content (STEP 2)' },
}

/** Which algorithm(s) actually score this field — a reviewer never wonders
 * "does moving this slider do anything". */
export function UsageBadge({ used, lang }: { used: UsedBy; lang: UiLanguage }) {
  const parts: { text: string; bg: string; fg: string; border: string; title: string }[] = []
  if (used === 's' || used === 'sc') {
    parts.push({ text: 'S', bg: '#eff6ff', fg: '#1d4ed8', border: '#c7d2fe', title: t(BADGE_LABELS.usedS, lang) })
  }
  if (used === 'c' || used === 'sc') {
    parts.push({ text: 'C', bg: '#f5f3ff', fg: '#7c3aed', border: '#ddd6fe', title: t(BADGE_LABELS.usedC, lang) })
  }
  return (
    <span data-testid="usage-badge" style={{ display: 'inline-flex', gap: '2px' }}>
      {parts.map((p) => (
        <span
          key={p.text}
          title={p.title}
          style={{
            display: 'inline-block',
            fontSize: '0.65em',
            fontWeight: 800,
            padding: '1px 6px',
            borderRadius: '999px',
            letterSpacing: '0.02em',
            background: p.bg,
            color: p.fg,
            border: `1px solid ${p.border}`,
          }}
        >
          {p.text}
        </span>
      ))}
    </span>
  )
}

const OSHI_ARTIST_LABELS = {
  notSelected: { ja: '未選択', en: 'Not selected' },
  addArtist: { ja: 'アーティストを追加', en: 'Add artist' },
  remove: { ja: '削除', en: 'Remove' },
  // Shown (as the disabled button's title AND a visible hint) whenever a row
  // still has no artist chosen — slice S9: without this gate, clicking
  // "add artist" twice before picking anything produced two rows both
  // carrying artist_id: '', which the backend's DriverProfile validator
  // rejects as a duplicate oshi_artists id, surfacing a raw stringified
  // pydantic error to the user. Blocking the button (with a stated reason,
  // not just a silently-disabled control) keeps the UI from ever
  // constructing that state.
  addBlockedReason: {
    ja: '追加する前に、現在の行でアーティストを選択してください',
    en: 'Choose an artist for the current row before adding another',
  },
}

/**
 * Rounds a raw 熱狂度 (enthusiasm) slider value to the backend's 0.1 grid
 * and clamps to [0, 1] — defends against any off-grid value reaching the
 * store. The backend (`OshiArtist.enthusiasm`,
 * `app/api/aica_api/models/proposal/world.py`) rejects anything off the
 * 0.0/0.1/.../1.0 grid outright, so this must round BEFORE the value is
 * committed via `onChange`, not merely rely on the `<input step>` attribute
 * (which JSDOM/a raw `fireEvent.change` can bypass).
 */
function roundEnthusiasmToGrid(raw: number): number {
  if (Number.isNaN(raw)) return 0
  const clamped = Math.min(1, Math.max(0, raw))
  return Number(clamped.toFixed(1))
}

export function renderFieldControl(
  def: WorldFieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  testId: string,
  lang: UiLanguage,
  ctx?: { artists?: { id: string; name: string }[]; songs?: { id: string; label: string }[] },
) {
  // Service ids are the only `keyOptions` vocabulary these World fields use;
  // any other keyOptions list (e.g. genre ids in PreferenceHistorySection's
  // own scene_genre_usage editor) supplies its own key/value label resolvers
  // directly instead of going through this shared renderer.
  //
  // `catalog_item_usage_level` is the exception: its keys are catalog track ids
  // a customer cannot recognise, so — WHEN the loaded catalog is available — the
  // key is chosen from / shown as the song's name + artist(s) instead of the raw
  // id, and each usage level shows its item_usage point (see itemUsageValueLabel).
  const isSongUsage = def.key === 'catalog_item_usage_level'
  const songs = ctx?.songs ?? []
  const songLabelById = new Map(songs.map((s) => [s.id, s.label]))
  const songKeyLabel = (id: string): BilingualLabel => {
    // No catalog match (e.g. an id from a preset built on another dataset) →
    // the id itself, kept honest rather than mislabelled as another song.
    const label = songLabelById.get(id) ?? id
    return { ja: label, en: label }
  }
  const keyLabel =
    def.keyOptions === SERVICE_ID_OPTIONS
      ? serviceLabel
      : isSongUsage && songs.length > 0
        ? songKeyLabel
        : undefined
  const resolvedKeyOptions = isSongUsage && songs.length > 0 ? songs.map((s) => s.id) : def.keyOptions
  const valueLabel = isSongUsage ? itemUsageValueLabel : (opt: string) => optionLabel(def.key, opt)
  switch (def.kind) {
    case 'number':
      return (
        <input
          data-testid={testId}
          type="number"
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )
    case 'slider':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            data-testid={testId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, minWidth: '80px' }}
          />
          <span
            data-testid={`${testId}-value`}
            style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '26px', textAlign: 'right', color: '#4b5563' }}
          >
            {Number(value ?? 0)}
          </span>
        </div>
      )
    case 'select':
      return (
        <select data-testid={testId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {t(valueLabel(opt), lang)}
            </option>
          ))}
        </select>
      )
    case 'boolean':
      return (
        <select
          data-testid={testId}
          value={String(Boolean(value))}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="false">{t(valueLabel('false'), lang)}</option>
          <option value="true">{t(valueLabel('true'), lang)}</option>
        </select>
      )
    case 'nullable_select':
      return (
        <select
          data-testid={testId}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">—</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {t(valueLabel(opt), lang)}
            </option>
          ))}
        </select>
      )
    case 'oshi_artists': {
      const rows = (value as OshiArtist[]) ?? []
      const catalogArtists = ctx?.artists ?? []
      // Ids already claimed by SOME row — a row's OWN current id is excluded
      // below (per-row, via `a.id === row.artist_id`) so its own <option>
      // stays selectable; every OTHER row's id is excluded so the backend's
      // "no duplicate artist_id" rule can never be violated from the UI.
      const claimedIds = new Set(rows.map((r) => r.artist_id).filter(Boolean))
      // A row with no artist chosen yet — while one exists, adding another
      // row would let two rows both sit at artist_id: '', which collides on
      // the backend's no-duplicate-artist_id rule (slice S9).
      const hasUnassignedRow = rows.some((r) => !r.artist_id)

      function updateRow(idx: number, patch: Partial<OshiArtist>) {
        onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
      }

      return (
        <div data-testid={testId}>
          {rows.map((row, idx) => {
            const options = catalogArtists.filter((a) => a.id === row.artist_id || !claimedIds.has(a.id))
            return (
              <div
                key={idx}
                data-testid={`oshi-artist-row-${idx}`}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' }}
              >
                <select
                  data-testid={`oshi-artist-select-${idx}`}
                  value={row.artist_id}
                  onChange={(e) => updateRow(idx, { artist_id: e.target.value })}
                  style={{ flex: 1 }}
                >
                  <option value="">{t(OSHI_ARTIST_LABELS.notSelected, lang)}</option>
                  {options.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name}
                    </option>
                  ))}
                </select>
                <input
                  data-testid={`oshi-artist-enthusiasm-${idx}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={row.enthusiasm}
                  onChange={(e) => updateRow(idx, { enthusiasm: roundEnthusiasmToGrid(Number(e.target.value)) })}
                  style={{ minWidth: '80px' }}
                />
                <span
                  data-testid={`oshi-artist-enthusiasm-${idx}-value`}
                  style={{ fontFamily: 'monospace', fontSize: '0.85em', minWidth: '26px', textAlign: 'right', color: '#4b5563' }}
                >
                  {row.enthusiasm.toFixed(1)}
                </span>
                <button
                  type="button"
                  data-testid={`oshi-artist-remove-${idx}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontWeight: 700, padding: '0 4px' }}
                >
                  {t(OSHI_ARTIST_LABELS.remove, lang)}
                </button>
              </div>
            )
          })}
          <button
            type="button"
            data-testid="oshi-artist-add"
            disabled={hasUnassignedRow}
            title={hasUnassignedRow ? t(OSHI_ARTIST_LABELS.addBlockedReason, lang) : undefined}
            aria-describedby={hasUnassignedRow ? `${testId}-add-blocked-hint` : undefined}
            onClick={() => {
              // Guard mirrors the `disabled` attribute — belt-and-braces in
              // case a test or assistive tech dispatches a click past a
              // disabled control.
              if (hasUnassignedRow) return
              onChange([...rows, { artist_id: '', oshi_type: 'artist', enthusiasm: 1.0 }])
            }}
            style={{ fontSize: '0.8em', marginTop: '2px', cursor: hasUnassignedRow ? 'not-allowed' : 'pointer' }}
          >
            + {t(OSHI_ARTIST_LABELS.addArtist, lang)}
          </button>
          {hasUnassignedRow && (
            <p
              id={`${testId}-add-blocked-hint`}
              data-testid="oshi-artist-add-blocked-hint"
              style={{ fontSize: '0.72em', color: '#6b7280', margin: '2px 0 0' }}
            >
              {t(OSHI_ARTIST_LABELS.addBlockedReason, lang)}
            </p>
          )}
        </div>
      )
    }
    case 'tag_toggle': {
      const selected = new Set(((value as string[]) ?? []).filter(Boolean))
      return (
        <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {(def.options ?? []).map((opt) => {
            const isOn = selected.has(opt)
            return (
              <button
                key={opt}
                type="button"
                data-testid={`${testId}-${opt}`}
                aria-pressed={isOn}
                onClick={() => {
                  const next = new Set(selected)
                  if (isOn) next.delete(opt)
                  else next.add(opt)
                  onChange(Array.from(next))
                }}
                style={{
                  fontSize: '0.74em',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  border: isOn ? '1px solid #1d4ed8' : '1px solid #cbd5e1',
                  background: isOn ? '#1d4ed8' : '#fff',
                  color: isOn ? '#fff' : '#4b5563',
                  fontWeight: isOn ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {t(valueLabel(opt), lang)}
              </button>
            )
          })}
        </div>
      )
    }
    case 'record_enum':
      return (
        <RecordEditor
          testId={testId}
          value={(value as Record<string, string>) ?? {}}
          onChange={onChange}
          lang={lang}
          keyOptions={resolvedKeyOptions}
          valueKind="enum"
          valueOptions={def.options}
          keyLabel={keyLabel}
          valueLabel={valueLabel}
          valueStyle={isSongUsage ? USAGE_LEVEL_SELECT_STYLE : undefined}
        />
      )
    case 'record_number':
      return (
        <RecordEditor
          testId={testId}
          value={(value as Record<string, number>) ?? {}}
          onChange={onChange}
          lang={lang}
          keyOptions={def.keyOptions}
          valueKind="number"
          keyLabel={keyLabel}
        />
      )
    case 'nested_record_enum':
      return (
        <NestedRecordEditor
          testId={testId}
          value={(value as Record<string, Record<string, string>>) ?? {}}
          onChange={onChange}
          lang={lang}
          innerKeyOptions={def.keyOptions}
          innerValueOptions={def.options ?? []}
          keyLabel={keyLabel}
          valueLabel={valueLabel}
        />
      )
    case 'item_list':
      return (
        <ItemListEditor
          testId={testId}
          value={(value as Record<string, string>[]) ?? []}
          onChange={onChange}
          idField={def.idField ?? 'track_id'}
          tsField={def.tsField ?? 'at'}
          idPlaceholder={def.idPlaceholder}
          lang={lang}
        />
      )
    default:
      return null
  }
}

export function FieldRow({
  def,
  value,
  onChange,
  lang,
  issues,
  artists,
  songs,
}: {
  def: WorldFieldDef
  value: unknown
  onChange: (value: unknown) => void
  lang: UiLanguage
  issues?: WorldValidationIssue[]
  artists?: { id: string; name: string }[]
  songs?: { id: string; label: string }[]
}) {
  const testId = `feature-field-${def.key}`
  const isCompact = ['number', 'select', 'boolean', 'nullable_select', 'slider'].includes(def.kind)
  const fieldIssues = issues ?? []
  return (
    <div
      data-world-field={def.key}
      style={{
        display: isCompact ? 'grid' : 'block',
        gridTemplateColumns: isCompact ? '1fr auto' : undefined,
        alignItems: 'center',
        gap: '6px 10px',
        padding: '6px 0',
        borderBottom: '1px dashed #e5e7eb',
      }}
    >
      <span style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {t(def.label, lang)}
        <UsageBadge used={def.used} lang={lang} />
      </span>
      {renderFieldControl(def, value, onChange, testId, lang, { artists, songs })}
      {fieldIssues.length > 0 && (
        <p
          role="alert"
          data-testid={`${testId}-issue`}
          style={{ gridColumn: isCompact ? '1 / -1' : undefined, margin: '2px 0 0', color: '#dc2626', fontSize: '0.75em' }}
        >
          {fieldIssues.map((issue) => issue.message).join(' ')}
        </p>
      )}
    </div>
  )
}
