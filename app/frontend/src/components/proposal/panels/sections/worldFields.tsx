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
import { t, type UiLanguage } from '../../../../i18n/t'
import {
  SERVICE_ID_OPTIONS,
  type WorldValidationIssue,
} from '../../../../api/proposalClient'
import {
  RecordEditor,
  NestedRecordEditor,
  ItemListEditor,
} from '../../fieldEditors'
import { optionLabel, serviceLabel } from '../../../../lib/review/reviewVocabulary'

export function issuesForPath(issues: WorldValidationIssue[], path: string): WorldValidationIssue[] {
  return issues.filter((issue) => issue.path === path)
}

export const USAGE_LEVEL_OPTIONS = ['never', 'low', 'med', 'high']
export const RECENCY_OPTIONS = ['never', 'long_unused', 'recent']

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
  | 'artist_select'
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
      // Implicitly `oshi_type='artist'` on selection (see setProfileField's
      // onChange wrapper) — no separate oshi_type/oshi_tags fields; neither is scored.
      { key: 'oshi_id', label: { ja: '推しアーティスト', en: 'Oshi artist' }, kind: 'artist_select', used: 'c' },
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

export function renderFieldControl(
  def: WorldFieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  testId: string,
  lang: UiLanguage,
  ctx?: { artists?: { id: string; name: string }[] },
) {
  // Service ids are the only `keyOptions` vocabulary these World fields use;
  // any other keyOptions list (e.g. genre ids in PreferenceHistorySection's
  // own scene_genre_usage editor) supplies its own key/value label resolvers
  // directly instead of going through this shared renderer.
  const keyLabel = def.keyOptions === SERVICE_ID_OPTIONS ? serviceLabel : undefined
  const valueLabel = (opt: string) => optionLabel(def.key, opt)
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
    case 'artist_select':
      return (
        <select
          data-testid={testId}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">—</option>
          {(ctx?.artists ?? []).map((artist) => (
            <option key={artist.id} value={artist.id}>
              {artist.name}
            </option>
          ))}
        </select>
      )
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
          keyOptions={def.keyOptions}
          valueKind="enum"
          valueOptions={def.options}
          keyLabel={keyLabel}
          valueLabel={valueLabel}
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
}: {
  def: WorldFieldDef
  value: unknown
  onChange: (value: unknown) => void
  lang: UiLanguage
  issues?: WorldValidationIssue[]
  artists?: { id: string; name: string }[]
}) {
  const testId = `feature-field-${def.key}`
  const isCompact = ['number', 'select', 'boolean', 'nullable_select', 'slider', 'artist_select'].includes(def.kind)
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
      {renderFieldControl(def, value, onChange, testId, lang, { artists })}
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
