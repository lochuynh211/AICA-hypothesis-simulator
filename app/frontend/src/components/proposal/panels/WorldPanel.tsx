/**
 * WorldPanel (P1 T026, rebuilt P3 T026 as a REAL editor over the typed
 * `World`).
 *
 * Section order (per ui-mockup.html / design doc §7 — UNCHANGED from P1):
 *   1. Trigger signal   — the 4 `trigger_purpose` options (control input, not scored)
 *   2. Car state        — `lifecycle_stage` (rest-journey position) + `motion_state`
 *                          + the dataset/catalog selector + read-only provenance banner
 *   3. World · situation — every `Situation` field, each with a ProvenanceBadge
 *   4. Preference & history — every `DriverProfile` field as a REAL editable
 *                          control (no more read-only JSON dumps), plus the
 *                          opt-in `genre_affinity_v1` toggle
 *   5. Driver profile    — DriverProfilePicker (load/save/delete), LAST
 *
 * A SeedPicker sits above section 1 — loading a seed replaces the WHOLE
 * world (control_inputs + situation + driver_profile + catalog_ref) in one
 * shot, which is why it isn't scoped to any single section below.
 *
 * Writes directly to `proposalStore` (SET_TRIGGER_PURPOSE / SET_LIFECYCLE_STAGE /
 * SET_MOTION_STATE / SET_SITUATION_FIELD / SET_DRIVER_PROFILE_FIELD / ...).
 * Does not read/write `runStore` (proposal/trigger isolation invariant).
 *
 * Catalog is READ-ONLY here: the dataset selector only ever POINTS the world
 * at a different frozen dataset — there is no edit/import control for the
 * catalog itself anywhere in this panel (see `DatasetProvenanceBanner`).
 */
import { useEffect, useState } from 'react'
import { t, type UiLanguage } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import type {
  TriggerPurposeValue,
  LifecycleStageValue,
  MotionStateValue,
} from '../../../state/proposalStore'
import {
  getDatasets,
  getCatalog,
  validateWorld,
  GENRE_VOCABULARY,
  SERVICE_ID_OPTIONS,
  type DatasetProvenance,
  type Situation,
  type DriverProfile,
  type GenreLiteralValue,
  type UsageLevelValue,
  type WorldValidationIssue,
} from '../../../api/proposalClient'
import ProvenanceBadge, { type ProvenanceKind } from '../ProvenanceBadge'
import SeedPicker from '../SeedPicker'
import DriverProfilePicker from '../DriverProfilePicker'
import DatasetProvenanceBanner from '../DatasetProvenanceBanner'
import CatalogView from '../CatalogView'
import WorldClonePicker from '../WorldClonePicker'
import WorldDiffView from '../WorldDiffView'
import {
  TextListEditor,
  RecordEditor,
  NestedRecordEditor,
  ItemListEditor,
  GenreUsageTable,
} from '../fieldEditors'

// Debounce delay (ms) between a `world` edit and the inline
// `POST /worlds/validate` call (MF1 / US1 AC#3, SC-002) — short enough to
// feel live, long enough not to fire once per keystroke.
const WORLD_VALIDATE_DEBOUNCE_MS = 300

function issuesForPath(issues: WorldValidationIssue[], path: string): WorldValidationIssue[] {
  return issues.filter((issue) => issue.path === path)
}

// ── Static option/field metadata (bilingual) ────────────────────────────────

const TRIGGER_PURPOSES: { value: TriggerPurposeValue; label: { ja: string; en: string } }[] = [
  { value: 'rest_recommended', label: { ja: '休憩推奨', en: 'rest_recommended' } },
  {
    value: 'inattentive_driving_prevention_recovery',
    label: { ja: '注意力低下防止・回復', en: 'inattentive_driving_prevention_recovery' },
  },
  { value: 'route_music', label: { ja: 'ルート音楽', en: 'route_music' } },
  { value: 'child_passenger_experience', label: { ja: '子ども同乗体験', en: 'child_passenger_experience' } },
]

const LIFECYCLE_STAGES: { value: LifecycleStageValue; label: { ja: string; en: string } }[] = [
  { value: 'before_rest_until_stop', label: { ja: 'スポットへ向かう', en: 'heading to spot' } },
  { value: 'during_rest_stopped', label: { ja: 'スポットで停車', en: 'stopped at spot' } },
  { value: 'after_rest_before_restart', label: { ja: '休憩後・再開前', en: 'after spot' } },
  { value: 'active_driving_content', label: { ja: '走行中', en: 'driving' } },
]

const MOTION_STATES: { value: MotionStateValue; label: string }[] = [
  { value: 'stopped', label: 'stopped' },
  { value: 'driving', label: 'driving' },
]

const USAGE_LEVEL_OPTIONS = ['never', 'low', 'med', 'high']
const RECENCY_OPTIONS = ['never', 'long_unused', 'recent']

type FieldKind =
  | 'number'
  | 'select'
  | 'text'
  | 'boolean'
  | 'nullable_number'
  | 'nullable_text'
  | 'nullable_select'
  | 'string_list'
  | 'record_enum'
  | 'record_number'
  | 'nested_record_enum'
  | 'item_list'

type WorldFieldDef = {
  key: string
  label: { ja: string; en: string }
  kind: FieldKind
  options?: string[]
  keyOptions?: string[]
  idField?: string
  tsField?: string
  idPlaceholder?: string
  provenance: ProvenanceKind
}

// ── Section 3: World · situation (every Situation field) ───────────────────

const SITUATION_FIELDS: WorldFieldDef[] = [
  { key: 'drowsiness_level', label: { ja: '眠気', en: 'Drowsiness' }, kind: 'number', provenance: 'cdc_su_baseline' },
  { key: 'fatigue_level', label: { ja: '疲労', en: 'Fatigue' }, kind: 'number', provenance: 'cdc_su_baseline' },
  { key: 'monotony_level', label: { ja: '単調さ', en: 'Monotony' }, kind: 'number', provenance: 'cdc_su_baseline' },
  {
    key: 'traffic_state',
    label: { ja: '交通', en: 'Traffic' },
    kind: 'select',
    options: ['normal', 'congested'],
    provenance: 'cdc_su_baseline',
  },
  {
    key: 'road_type',
    label: { ja: '道路', en: 'Road' },
    kind: 'select',
    options: ['highway', 'local', 'mountain', 'parking'],
    provenance: 'normalized_cdc_su_concept',
  },
  {
    key: 'night_state',
    label: { ja: '昼夜', en: 'Day/Night' },
    kind: 'select',
    options: ['night', 'day'],
    provenance: 'cdc_su_baseline',
  },
  { key: 'route_tags', label: { ja: 'ルート特徴', en: 'Route' }, kind: 'string_list', provenance: 'cdc_su_baseline' },
  {
    key: 'destination_tags',
    label: { ja: '目的地', en: 'Destination' },
    kind: 'string_list',
    provenance: 'cdc_su_baseline',
  },
  {
    key: 'child_present',
    label: { ja: '子ども同乗', en: 'Child present' },
    kind: 'boolean',
    provenance: 'cdc_su_baseline',
  },
  {
    key: 'multiple_passengers',
    label: { ja: '複数同乗', en: 'Multiple' },
    kind: 'boolean',
    provenance: 'cdc_su_baseline',
  },
  {
    key: 'estimated_min_until_rest_spot',
    label: { ja: '休憩地点までの推定分数', en: 'Min. until rest spot' },
    kind: 'nullable_number',
    provenance: 'proposed_addition',
  },
  {
    key: 'rest_spot_type',
    label: { ja: '休憩地点の種類', en: 'Rest spot type' },
    kind: 'select',
    options: ['sa_pa', 'convenience_store', 'parking', 'oshi_spot', 'other', 'unknown'],
    provenance: 'proposed_addition',
  },
  {
    key: 'active_service',
    label: { ja: '現在のサービス', en: 'Active service' },
    kind: 'nullable_select',
    options: SERVICE_ID_OPTIONS,
    provenance: 'proposed_addition',
  },
  {
    key: 'recent_service_rejections',
    label: { ja: '直近のサービス拒否', en: 'Recent service rejections' },
    kind: 'item_list',
    idField: 'service_id',
    tsField: 'rejected_at',
    idPlaceholder: 'service_id',
    provenance: 'proposed_addition',
  },
]

// ── Section 4: Preference & history (every DriverProfile field) ────────────

type ProfileGroup = { label: { ja: string; en: string }; fields: WorldFieldDef[] }

const PROFILE_GROUPS: ProfileGroup[] = [
  {
    label: { ja: '推し情報', en: 'Oshi information' },
    fields: [
      { key: 'oshi_registered', label: { ja: '推し登録', en: 'Oshi registered' }, kind: 'boolean', provenance: 'cdc_su_baseline' },
      { key: 'oshi_mode', label: { ja: '推しモード', en: 'Oshi mode' }, kind: 'select', options: ['on', 'off'], provenance: 'cdc_su_baseline' },
      { key: 'oshi_id', label: { ja: '推しID', en: 'Oshi ID' }, kind: 'nullable_text', provenance: 'normalized_cdc_su_concept' },
      {
        key: 'oshi_type',
        label: { ja: '推し種別', en: 'Oshi type' },
        kind: 'nullable_select',
        options: ['artist', 'artist_member', 'group', 'character', 'voice_actor', 'franchise', 'creator', 'other'],
        provenance: 'normalized_cdc_su_concept',
      },
      { key: 'oshi_tags', label: { ja: '推しタグ', en: 'Oshi tags' }, kind: 'string_list', provenance: 'normalized_cdc_su_concept' },
    ],
  },
  {
    label: { ja: 'UPro情報', en: 'UPro information' },
    fields: [
      {
        key: 'age_band',
        label: { ja: '年代', en: 'Age' },
        kind: 'select',
        options: ['teens', '20s', '30s', '40s', '50s', '60plus'],
        provenance: 'cdc_su_baseline',
      },
      {
        key: 'gender',
        label: { ja: '性別', en: 'Gender' },
        kind: 'select',
        options: ['unspecified', 'female', 'male', 'non_binary'],
        provenance: 'cdc_su_baseline',
      },
      { key: 'hobby_interest_tags', label: { ja: '趣味・関心', en: 'Hobbies/interests' }, kind: 'string_list', provenance: 'cdc_su_baseline' },
    ],
  },
  {
    label: { ja: '利用頻度・シーン傾向', en: 'Usage / scene tendency' },
    fields: [
      { key: 'service_usage_level', label: { ja: 'サービス利用頻度', en: 'Service usage level' }, kind: 'record_enum', keyOptions: SERVICE_ID_OPTIONS, options: USAGE_LEVEL_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'service_recency_state', label: { ja: 'サービス最終利用', en: 'Service recency' }, kind: 'record_enum', keyOptions: SERVICE_ID_OPTIONS, options: RECENCY_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'scene_service_usage_level', label: { ja: 'シーン別サービス利用', en: 'Scene/service usage' }, kind: 'nested_record_enum', keyOptions: SERVICE_ID_OPTIONS, options: USAGE_LEVEL_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'catalog_item_usage_level', label: { ja: '楽曲利用頻度', en: 'Catalog item usage' }, kind: 'record_enum', options: USAGE_LEVEL_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'catalog_item_recency_state', label: { ja: '楽曲最終利用', en: 'Catalog item recency' }, kind: 'record_enum', options: RECENCY_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'content_tag_usage_level', label: { ja: 'コンテンツタグ利用頻度', en: 'Content-tag usage' }, kind: 'record_enum', options: USAGE_LEVEL_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'content_tag_recency_state', label: { ja: 'コンテンツタグ最終利用', en: 'Content-tag recency' }, kind: 'record_enum', options: RECENCY_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'scene_content_tag_usage_level', label: { ja: 'シーン別タグ利用', en: 'Scene/tag usage' }, kind: 'nested_record_enum', options: USAGE_LEVEL_OPTIONS, provenance: 'cdc_su_baseline' },
    ],
  },
  {
    label: { ja: '再生・操作履歴', en: 'Playback & operations' },
    fields: [
      { key: 'played_items', label: { ja: '再生済み', en: 'Played items' }, kind: 'item_list', idField: 'track_id', tsField: 'last_played_at', provenance: 'cdc_su_baseline' },
      { key: 'skipped_items', label: { ja: 'スキップ済み', en: 'Skipped items' }, kind: 'item_list', idField: 'track_id', tsField: 'skipped_at', provenance: 'cdc_su_baseline' },
      { key: 'changed_from_items', label: { ja: '変更元', en: 'Changed-from items' }, kind: 'item_list', idField: 'track_id', tsField: 'changed_at', provenance: 'cdc_su_baseline' },
      { key: 'cancelled_content_plans', label: { ja: 'キャンセル済みプラン', en: 'Cancelled plans' }, kind: 'item_list', idField: 'plan_id', tsField: 'cancelled_at', idPlaceholder: 'plan_id', provenance: 'cdc_su_baseline' },
      { key: 'completed_items', label: { ja: '完了済み', en: 'Completed items' }, kind: 'item_list', idField: 'track_id', tsField: 'completed_at', provenance: 'proposed_addition' },
      { key: 'manually_selected_items', label: { ja: '手動選択済み', en: 'Manually selected' }, kind: 'item_list', idField: 'track_id', tsField: 'selected_at', provenance: 'proposed_addition' },
      { key: 'repeated_items', label: { ja: 'リピート済み', en: 'Repeated items' }, kind: 'item_list', idField: 'track_id', tsField: 'repeated_at', provenance: 'proposed_addition' },
    ],
  },
  {
    label: { ja: '提案・回復結果（履歴）', en: 'Proposal / recovery results (history)' },
    fields: [
      { key: 'service_proposal_acceptance_rate', label: { ja: 'サービス提案受諾率', en: 'Service acceptance rate' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'service_recovery_rate', label: { ja: 'サービス回復率', en: 'Service recovery rate' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, provenance: 'cdc_su_baseline' },
      { key: 'content_proposal_acceptance_rate', label: { ja: 'コンテンツ提案受諾率', en: 'Content acceptance rate' }, kind: 'record_number', provenance: 'cdc_su_baseline' },
      { key: 'content_recovery_rate', label: { ja: 'コンテンツ回復率', en: 'Content recovery rate' }, kind: 'record_number', provenance: 'cdc_su_baseline' },
      { key: 'service_proposal_acceptance_confidence', label: { ja: 'サービス提案信頼度', en: 'Service acceptance confidence' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, provenance: 'proposed_addition' },
      { key: 'service_recovery_confidence', label: { ja: 'サービス回復信頼度', en: 'Service recovery confidence' }, kind: 'record_number', keyOptions: SERVICE_ID_OPTIONS, provenance: 'proposed_addition' },
      { key: 'content_proposal_acceptance_confidence', label: { ja: 'コンテンツ提案信頼度', en: 'Content acceptance confidence' }, kind: 'record_number', provenance: 'proposed_addition' },
      { key: 'content_recovery_confidence', label: { ja: 'コンテンツ回復信頼度', en: 'Content recovery confidence' }, kind: 'record_number', provenance: 'proposed_addition' },
    ],
  },
  {
    label: { ja: '予定イベント', en: 'Scheduled event' },
    fields: [
      {
        key: 'scheduled_event_type',
        label: { ja: '予定種別', en: 'Event type' },
        kind: 'nullable_select',
        options: ['none', 'live_show', 'radio_program', 'concert', 'oshi_event', 'other'],
        provenance: 'cdc_su_baseline',
      },
      {
        key: 'scheduled_event_timing',
        label: { ja: '予定時期', en: 'Event timing' },
        kind: 'nullable_select',
        options: ['now', 'soon', 'later', 'unknown'],
        provenance: 'cdc_su_baseline',
      },
      { key: 'scheduled_event_tags', label: { ja: '予定タグ', en: 'Event tags' }, kind: 'string_list', provenance: 'cdc_su_baseline' },
    ],
  },
]

// ── Small shared UI atoms ───────────────────────────────────────────────────

const LABELS = {
  triggerSignal: { ja: '発火シグナル（4つ）', en: 'Trigger signal (4)' },
  carState: { ja: '車両状態（現在状況）', en: 'Car state (current status)' },
  worldSituation: { ja: '世界・状況（初期値・編集可）', en: 'World · situation (init values, editable)' },
  preferenceHistory: { ja: '好み・履歴', en: 'Preference & history' },
  driverProfile: { ja: 'ドライバープロファイル', en: 'Driver profile' },
  motion: { ja: '走行/停車', en: 'Motion' },
  dataset: { ja: 'データセット', en: 'Dataset' },
  seed: { ja: 'シード（一括読み込み）', en: 'Seed (bulk load)' },
  clone: { ja: '対比クローン（1変数変更）', en: 'Contrast clone (change one variable)' },
  genreExtension: { ja: 'ジャンル選好（genre_affinity_v1）', en: 'Genre affinity (genre_affinity_v1)' },
  scenes: { ja: 'シーン別ジャンル利用', en: 'Scene genre usage' },
}

function SectionLabel({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div
      data-testid="world-section-label"
      style={{
        fontSize: '0.68em',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 800,
        color: '#6b7280',
        margin: '16px 0 6px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {children}
      {badge}
    </div>
  )
}

function renderFieldControl(
  def: WorldFieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  testId: string,
) {
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
    case 'select':
      return (
        <select data-testid={testId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )
    case 'text':
      return (
        <input
          data-testid={testId}
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'boolean':
      return (
        <select
          data-testid={testId}
          value={String(Boolean(value))}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      )
    case 'nullable_number':
      return (
        <input
          data-testid={testId}
          type="number"
          value={value === null || value === undefined ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )
    case 'nullable_text':
      return (
        <input
          data-testid={testId}
          type="text"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
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
              {opt}
            </option>
          ))}
        </select>
      )
    case 'string_list':
      return <TextListEditor testId={testId} value={(value as string[]) ?? []} onChange={onChange} />
    case 'record_enum':
      return (
        <RecordEditor
          testId={testId}
          value={(value as Record<string, string>) ?? {}}
          onChange={onChange}
          keyOptions={def.keyOptions}
          valueKind="enum"
          valueOptions={def.options}
        />
      )
    case 'record_number':
      return (
        <RecordEditor
          testId={testId}
          value={(value as Record<string, number>) ?? {}}
          onChange={onChange}
          keyOptions={def.keyOptions}
          valueKind="number"
        />
      )
    case 'nested_record_enum':
      return (
        <NestedRecordEditor
          testId={testId}
          value={(value as Record<string, Record<string, string>>) ?? {}}
          onChange={onChange}
          innerKeyOptions={def.keyOptions}
          innerValueOptions={def.options ?? []}
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
        />
      )
    default:
      return null
  }
}

function FieldRow({
  def,
  value,
  onChange,
  lang,
  issues,
}: {
  def: WorldFieldDef
  value: unknown
  onChange: (value: unknown) => void
  lang: UiLanguage
  issues?: WorldValidationIssue[]
}) {
  const testId = `feature-field-${def.key}`
  const isCompact = ['number', 'select', 'text', 'boolean', 'nullable_number', 'nullable_text', 'nullable_select'].includes(
    def.kind,
  )
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
        <code style={{ fontSize: '0.9em', color: '#6b7280' }}>{def.key}</code>
        {t(def.label, lang)}
        <ProvenanceBadge provenance={def.provenance} lang={lang} />
      </span>
      {renderFieldControl(def, value, onChange, testId)}
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

// ── WorldPanel ───────────────────────────────────────────────────────────────

export default function WorldPanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, triggerPurpose, lifecycleStage, motionState, world } = state
  const { situation, driver_profile: driverProfile } = world

  const [datasetProvenance, setDatasetProvenance] = useState<DatasetProvenance | null>(null)

  useEffect(() => {
    let cancelled = false
    getDatasets()
      .then((resp) => {
        if (!cancelled) dispatch({ type: 'SET_DATASETS', datasets: resp.datasets })
      })
      .catch(() => {
        /* dataset listing is best-effort for the selector; the world already
         * carries a valid dataset_id/catalog_ref from its default/seed. */
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    const datasetId = world.control_inputs.dataset_id
    if (!datasetId) return
    getCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        dispatch({ type: 'SET_CATALOG', catalog: resp.songs, total: resp.total })
        setDatasetProvenance(resp.provenance)
      })
      .catch(() => {
        if (!cancelled) setDatasetProvenance(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.control_inputs.dataset_id])

  // MF1 (US1 AC#3 / SC-002): inline world validation. Debounced on every
  // `world` edit — `Promise.resolve().then(...)` defers the call itself into
  // the chain so a non-Promise-returning/undefined mock (or a real fetch
  // rejection in a test environment with no network) never throws
  // synchronously; it is simply swallowed by `.catch()` below, which is the
  // correct "best-effort" behavior for a live inline check that must never
  // crash the editor.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      Promise.resolve()
        .then(() => validateWorld(world))
        .then((result) => {
          if (!cancelled && result) {
            dispatch({ type: 'SET_WORLD_VALIDATION_ISSUES', issues: result.issues })
          }
        })
        .catch(() => {
          /* best-effort — a failed validate call leaves prior issues as-is */
        })
    }, WORLD_VALIDATE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world])

  function setSituationField(key: keyof Situation, value: unknown) {
    dispatch({ type: 'SET_SITUATION_FIELD', key, value })
  }

  function setProfileField(key: keyof DriverProfile, value: unknown) {
    dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key, value })
  }

  return (
    <section
      data-testid="world-panel"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}
    >
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f8fafc',
          borderBottom: '1px solid #e5e7eb',
          color: '#1d4ed8',
        }}
      >
        {'①'} <span>{t({ ja: '入力・世界', en: 'Input · World' }, lang)}</span>
      </h3>
      <div style={{ padding: '12px 14px' }}>
        {/* Inline world validation (MF1 / US1 AC#3, SC-002) — a general,
            always-accurate summary of every {path, code, message} issue
            returned by POST /worlds/validate, in addition to the per-field
            inline messages rendered next to each offending field below. */}
        {state.worldValidationIssues.length > 0 && (
          <div
            data-testid="world-validation-issues"
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '8px 10px',
              margin: '0 0 10px',
            }}
          >
            <div style={{ fontSize: '0.78em', fontWeight: 700, color: '#991b1b' }}>
              {t({ ja: '検証エラー', en: 'Validation issues' }, lang)}
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
              {state.worldValidationIssues.map((issue) => (
                <li
                  key={`${issue.path}-${issue.code}`}
                  data-testid={`world-validation-issue-${issue.path}`}
                  style={{ fontSize: '0.78em', color: '#b91c1c' }}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Quick full-world load — above section 1, since it replaces every
            group at once (control_inputs + situation + driver_profile). */}
        <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: '#6b7280', margin: '0 0 6px' }}>
          {t(LABELS.seed, lang)}
        </div>
        <SeedPicker />

        {/* Contrast clone — clone the base seed above and change ONE
            variable (data-model.md §WorldClone); the diff renders below. */}
        <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: '#6b7280', margin: '12px 0 6px' }}>
          {t(LABELS.clone, lang)}
        </div>
        <WorldClonePicker />
        <WorldDiffView />

        {/* 1. Trigger signal */}
        <SectionLabel>{t(LABELS.triggerSignal, lang)}</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '3px 0 8px' }}>
          {TRIGGER_PURPOSES.map((opt) => {
            const isSelected = opt.value === triggerPurpose
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`trigger-purpose-${opt.value}`}
                aria-pressed={isSelected}
                onClick={() => dispatch({ type: 'SET_TRIGGER_PURPOSE', purpose: opt.value })}
                style={{
                  fontSize: '0.74em',
                  padding: '3px 10px',
                  borderRadius: '7px',
                  border: isSelected ? '1px solid #1d4ed8' : '1px solid #cbd5e1',
                  background: isSelected ? '#1d4ed8' : '#fff',
                  color: isSelected ? '#fff' : '#4b5563',
                  fontWeight: isSelected ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {t(opt.label, lang)}
              </button>
            )
          })}
        </div>

        {/* 2. Car state */}
        <SectionLabel>{t(LABELS.carState, lang)}</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '3px 0 8px' }}>
          {LIFECYCLE_STAGES.map((opt) => {
            const isSelected = opt.value === lifecycleStage
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`lifecycle-stage-${opt.value}`}
                aria-pressed={isSelected}
                onClick={() => dispatch({ type: 'SET_LIFECYCLE_STAGE', stage: opt.value })}
                style={{
                  fontSize: '0.74em',
                  padding: '3px 10px',
                  borderRadius: '7px',
                  border: isSelected ? '1px solid #1d4ed8' : '1px solid #cbd5e1',
                  background: isSelected ? '#1d4ed8' : '#fff',
                  color: isSelected ? '#fff' : '#4b5563',
                  fontWeight: isSelected ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {t(opt.label, lang)} <small style={{ opacity: 0.7 }}>{opt.value}</small>
              </button>
            )
          })}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: '6px 10px',
            padding: '6px 0',
          }}
        >
          <span style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <code>motion_state</code> {t(LABELS.motion, lang)}
            <ProvenanceBadge provenance="proposed_addition" lang={lang} />
          </span>
          <select
            data-testid="motion-state-select"
            value={motionState}
            onChange={(e) => dispatch({ type: 'SET_MOTION_STATE', motionState: e.target.value as MotionStateValue })}
          >
            {MOTION_STATES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '6px 10px', padding: '6px 0' }}>
          <span style={{ fontSize: '0.82em', color: '#4b5563' }}>
            <code>dataset_id</code> {t(LABELS.dataset, lang)}
          </span>
          <select
            data-testid="dataset-select"
            value={world.control_inputs.dataset_id}
            onChange={(e) => {
              const chosen = state.datasets.find((d) => d.dataset_id === e.target.value)
              if (chosen) dispatch({ type: 'SET_DATASET', dataset: chosen })
            }}
          >
            {state.datasets.length === 0 && <option value={world.control_inputs.dataset_id}>{world.control_inputs.dataset_id}</option>}
            {state.datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.dataset_id} ({d.song_count})
              </option>
            ))}
          </select>
        </div>
        <DatasetProvenanceBanner provenance={datasetProvenance} lang={lang} />
        <CatalogView songs={state.catalog} total={state.catalogTotal} lang={lang} />

        {/* 3. World · situation */}
        <SectionLabel>{t(LABELS.worldSituation, lang)}</SectionLabel>
        {SITUATION_FIELDS.map((def) => (
          <FieldRow
            key={def.key}
            def={def}
            value={(situation as unknown as Record<string, unknown>)[def.key]}
            onChange={(value) => setSituationField(def.key as keyof Situation, value)}
            lang={lang}
            issues={issuesForPath(state.worldValidationIssues, `situation.${def.key}`)}
          />
        ))}

        {/* 4. Preference & history — REAL editable controls (P3) */}
        <SectionLabel badge={<ProvenanceBadge provenance="from_profile" lang={lang} />}>
          {t(LABELS.preferenceHistory, lang)}
        </SectionLabel>
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
            <code>genre_affinity_v1_enabled</code>
          </span>
          <select
            data-testid="genre-affinity-toggle"
            value={String(driverProfile.genre_affinity_v1_enabled)}
            onChange={(e) => dispatch({ type: 'SET_GENRE_EXTENSION_ENABLED', enabled: e.target.value === 'true' })}
          >
            <option value="false">off</option>
            <option value="true">on</option>
          </select>
        </div>
        {driverProfile.genre_affinity_v1_enabled && (
          <div data-testid="genre-fields">
            <div style={{ fontSize: '0.78em', color: '#6b7280', margin: '4px 0 2px' }}>
              <code>usage_by_genre</code>
            </div>
            <GenreUsageTable
              testId="genre-usage-by-genre"
              genres={GENRE_VOCABULARY}
              value={driverProfile.usage_by_genre ?? {}}
              onChange={(genre, level) =>
                dispatch({
                  type: 'SET_USAGE_BY_GENRE',
                  genre: genre as GenreLiteralValue,
                  level: level as UsageLevelValue,
                })
              }
            />
            <div style={{ fontSize: '0.78em', color: '#6b7280', margin: '8px 0 2px' }}>
              <code>scene_genre_usage</code> — {t(LABELS.scenes, lang)}
            </div>
            <NestedRecordEditor
              testId="genre-scene-usage"
              value={(driverProfile.scene_genre_usage ?? {}) as Record<string, Record<string, string>>}
              onChange={(next) =>
                dispatch({
                  type: 'SET_DRIVER_PROFILE_FIELD',
                  key: 'scene_genre_usage',
                  value: next,
                })
              }
              innerKeyOptions={GENRE_VOCABULARY}
              innerValueOptions={USAGE_LEVEL_OPTIONS}
            />
          </div>
        )}

        {/* 5. Driver profile — picker, LAST */}
        <SectionLabel>{t(LABELS.driverProfile, lang)}</SectionLabel>
        <DriverProfilePicker />
      </div>
    </section>
  )
}
