/**
 * WorldPanel (P1 T026, rebuilt P3 T026 as a REAL editor over the typed
 * `World`; reworked again per owner feedback 2026-07-17 — see below).
 *
 * Section order (top-to-bottom):
 *   0. Preset      — (feature 018) dropdown over committed preset test-case
 *                     worlds; selecting one ATOMICALLY replaces the whole
 *                     world (situation + driver_profile + control_inputs
 *                     together) and supersedes any Seed/Profile selection
 *                     below, plus shows a bilingual brief blurb.
 *   1. Seed        — dropdown, autoloads a committed base-seed world on
 *                     selection (no separate Load button)
 *   2. Trigger signal — the 4 `trigger_purpose` options (control input, not scored)
 *   3. Car state   — `lifecycle_stage` (rest-journey position) + a READ-ONLY
 *                     `motion_state` readout DERIVED from the lifecycle stage
 *                     (during_rest_stopped / after_rest_before_restart =>
 *                     stopped, else driving) — motion is no longer an
 *                     independently editable field
 *   4. World · situation — ONLY the `Situation` fields actually SCORED by the
 *                     transparent service and/or content algorithm (per
 *                     aica_transparent_service_proposal_algorithm.md /
 *                     aica_transparent_content_proposal_algorithm.md), each
 *                     badged S / C / S·C for which algorithm scores it.
 *                     Numeric fields are 0-100 sliders (step 5); route/
 *                     destination tags are on/off toggle buttons over the
 *                     algorithms' fixed recognized vocabularies.
 *   5. Preference & history — DriverProfilePicker dropdown FIRST (autoloads
 *                     a driver profile, filling every field below), then
 *                     ONLY the scored `DriverProfile` fields, grouped and
 *                     badged the same way. `oshi_id` is an artist-ID
 *                     dropdown sourced from the loaded catalog (implicitly
 *                     `oshi_type='artist'` — no separate oshi_type/oshi_tags
 *                     fields).
 *   6. Genre affinity extension (opt-in, unchanged) — usage_by_genre /
 *                     scene_genre_usage, scored by content only when enabled.
 *   7. Dataset (read-only) — DatasetProvenanceBanner + CatalogView. There is
 *                     no dataset SELECTOR: the world's dataset_id comes from
 *                     the loaded seed/profile and is not reviewer-editable.
 *
 * REMOVED (owner feedback 2026-07-17): the contrast-clone picker/diff view
 * (WorldClonePicker/WorldDiffView — deleted entirely, see [[proposal-live-run-and-ux-defaults]]
 * memory); the dataset selector; the CDC-SU/normalized/proposed_addition
 * provenance badges (replaced by the S/C/S·C "is this scored" badge); every
 * Situation/DriverProfile field that is NOT actually read by either V1
 * transparent package (e.g. gender at weight 0, oshi_type/oshi_tags,
 * scheduled_event_*, the four *_confidence maps, content_tag_usage_level/
 * scene_content_tag_usage_level which the code never reads at all).
 *
 * Writes directly to `proposalStore` (SET_TRIGGER_PURPOSE / SET_LIFECYCLE_STAGE /
 * SET_MOTION_STATE / SET_SITUATION_FIELD / SET_DRIVER_PROFILE_FIELD / ...).
 * Does not read/write `runStore` (proposal/trigger isolation invariant).
 *
 * Catalog is READ-ONLY here: it only ever informs the artist-ID dropdown and
 * the provenance banner — there is no edit/import control for the catalog
 * itself anywhere in this panel.
 */
import { useEffect, useMemo, useState } from 'react'
import { t, type UiLanguage } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import type {
  TriggerPurposeValue,
  LifecycleStageValue,
  MotionStateValue,
} from '../../../state/proposalStore'
import {
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
import PresetPicker from '../PresetPicker'
import DatasetProvenanceBanner from '../DatasetProvenanceBanner'
import CatalogView from '../CatalogView'
import {
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

/** motion_state is no longer an independent reviewer-editable field: it is
 * DERIVED from lifecycle_stage (during_rest_stopped / after_rest_before_restart
 * imply the vehicle already stopped for the rest event; every other stage is
 * driving). Dispatched alongside SET_LIFECYCLE_STAGE so `world.control_inputs
 * .motion_state` / `world.situation.motion_state` never disagree with it. */
function deriveMotion(lifecycle: LifecycleStageValue): MotionStateValue {
  return lifecycle === 'during_rest_stopped' || lifecycle === 'after_rest_before_restart' ? 'stopped' : 'driving'
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

const USAGE_LEVEL_OPTIONS = ['never', 'low', 'med', 'high']
const RECENCY_OPTIONS = ['never', 'long_unused', 'recent']

// Route/destination tag vocabularies — the SERVICE selector's own
// `recognized_route_tags` / `recognized_destination_tags` (its evidence
// saturates on recognized-tag COUNT; unrecognized tags are simply ignored,
// never an error). Content only scores these under the opt-in
// `genre_affinity_v1` extension (a strict subset maps to a genre).
const ROUTE_TAG_OPTIONS = ['highway', 'mountain', 'coastal', 'urban', 'scenic_byway', 'rural']
const DESTINATION_TAG_OPTIONS = ['coast', 'resort', 'nature', 'event', 'oshi_venue', 'event_hall', 'home', 'shopping']

/** Which algorithm(s) actually score this field in the current V1 transparent
 * packages (per aica_transparent_service_proposal_algorithm.md /
 * aica_transparent_content_proposal_algorithm.md, cross-checked against
 * packages/aica_transparent_{service,content}_selector_v1/algorithm.py).
 * Replaces the old CDC-SU/normalized/proposed_addition provenance labels —
 * this panel now shows ONLY scored fields, so the badge answers the one
 * question that matters: does moving this actually change a proposal? */
type UsedBy = 's' | 'c' | 'sc'

type FieldKind =
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

type WorldFieldDef = {
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

const SITUATION_FIELDS: WorldFieldDef[] = [
  { key: 'drowsiness_level', label: { ja: '眠気', en: 'Drowsiness' }, kind: 'slider', used: 'sc' },
  { key: 'fatigue_level', label: { ja: '疲労', en: 'Fatigue' }, kind: 'slider', used: 'sc' },
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

type ProfileGroup = { label: { ja: string; en: string }; fields: WorldFieldDef[] }

const PROFILE_GROUPS: ProfileGroup[] = [
  {
    label: { ja: '推し情報', en: 'Oshi' },
    fields: [
      { key: 'oshi_registered', label: { ja: '推し登録', en: 'Oshi registered' }, kind: 'boolean', used: 's' },
      { key: 'oshi_mode', label: { ja: '推しモード', en: 'Oshi mode' }, kind: 'select', options: ['on', 'off'], used: 's' },
      // Implicitly `oshi_type='artist'` on selection (see WorldPanel's onChange
      // wrapper) — no separate oshi_type/oshi_tags fields; neither is scored.
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

// ── Small shared UI atoms ───────────────────────────────────────────────────

const LABELS = {
  preset: { ja: 'プリセット（テストケース）', en: 'Preset (test-case)' },
  triggerSignal: { ja: '発火シグナル（4つ）', en: 'Trigger signal (4)' },
  carState: { ja: '車両状態（現在状況）', en: 'Car state (current status)' },
  worldSituation: { ja: '世界・状況（初期値・編集可）', en: 'World · situation (init values, editable)' },
  preferenceHistory: { ja: '好み・履歴', en: 'Preference & history' },
  motion: { ja: '走行/停車（自動）', en: 'Motion (derived)' },
  seed: { ja: 'シード', en: 'Seed' },
  genreExtension: { ja: 'ジャンル選好（genre_affinity_v1）', en: 'Genre affinity (genre_affinity_v1)' },
  scenes: { ja: 'シーン別ジャンル利用', en: 'Scene genre usage' },
  usedS: { ja: 'サービス（STEP1）で採点', en: 'Scored by Service (STEP 1)' },
  usedC: { ja: 'コンテンツ（STEP2）で採点', en: 'Scored by Content (STEP 2)' },
}

function SectionLabel({ children }: { children: React.ReactNode }) {
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
    </div>
  )
}

/** Replaces the old CDC-SU/norm./added ProvenanceBadge on every field: shows
 * which algorithm(s) actually score this field so a reviewer never wonders
 * "does moving this slider do anything". */
function UsageBadge({ used, lang }: { used: UsedBy; lang: UiLanguage }) {
  const parts: { text: string; bg: string; fg: string; border: string; title: string }[] = []
  if (used === 's' || used === 'sc') {
    parts.push({ text: 'S', bg: '#eff6ff', fg: '#1d4ed8', border: '#c7d2fe', title: t(LABELS.usedS, lang) })
  }
  if (used === 'c' || used === 'sc') {
    parts.push({ text: 'C', bg: '#f5f3ff', fg: '#7c3aed', border: '#ddd6fe', title: t(LABELS.usedC, lang) })
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

function renderFieldControl(
  def: WorldFieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  testId: string,
  ctx?: { artists?: { id: string; name: string }[] },
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
              {opt}
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
          <option value="false">false</option>
          <option value="true">true</option>
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
              {opt}
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
                {opt}
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
        <code style={{ fontSize: '0.9em', color: '#6b7280' }}>{def.key}</code>
        {t(def.label, lang)}
        <UsageBadge used={def.used} lang={lang} />
      </span>
      {renderFieldControl(def, value, onChange, testId, { artists })}
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

  // Artist dropdown for oshi_id — derived client-side from the already-loaded
  // catalog (no dedicated artist-list endpoint exists; see
  // [[proposal-live-run-and-ux-defaults]]), de-duplicated by artist id.
  const artists = useMemo(() => {
    const byId = new Map<string, string>()
    for (const song of state.catalog) {
      for (const artist of song.spotify_track.artists ?? []) {
        if (!byId.has(artist.id)) byId.set(artist.id, artist.name)
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [state.catalog])

  function setSituationField(key: keyof Situation, value: unknown) {
    dispatch({ type: 'SET_SITUATION_FIELD', key, value })
  }

  function setProfileField(key: keyof DriverProfile, value: unknown) {
    dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key, value })
    // oshi_id is now an artist-ID dropdown; picking (or clearing) an artist
    // implicitly sets/clears oshi_type='artist' — there is no separate
    // oshi_type control in this panel (it isn't scored by either algorithm).
    if (key === 'oshi_id') {
      dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key: 'oshi_type', value: value === null ? null : 'artist' })
    }
  }

  function handleLifecycleStage(stage: LifecycleStageValue) {
    dispatch({ type: 'SET_LIFECYCLE_STAGE', stage })
    dispatch({ type: 'SET_MOTION_STATE', motionState: deriveMotion(stage) })
  }

  return (
    <section
      data-testid="world-panel"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px' }}
    >
      <h3
        style={{
          margin: 0,
          padding: '11px 14px',
          fontSize: '0.9em',
          background: '#f8fafc',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '10px 10px 0 0',
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

        {/* 0. Preset — committed test-case worlds (feature 018): selecting one
            atomically replaces the whole world (situation + driver profile +
            control_inputs together). The preset is the single seeding control
            for this panel; the old separate Seed and Driver-Profile pickers
            were removed in favor of it. */}
        <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: '#6b7280', margin: '0 0 6px' }}>
          {t(LABELS.preset, lang)}
        </div>
        <PresetPicker />

        {/* 2. Trigger signal */}
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

        {/* 3. Car state — lifecycle + motion (read-only, derived) */}
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
                onClick={() => handleLifecycleStage(opt.value)}
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
          <span style={{ fontSize: '0.82em', color: '#4b5563' }}>
            <code>motion_state</code> {t(LABELS.motion, lang)}
          </span>
          <span
            data-testid="motion-state-readonly"
            style={{
              fontSize: '0.82em',
              fontFamily: 'monospace',
              color: '#4b5563',
              background: '#f1f5f9',
              padding: '2px 9px',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
            }}
          >
            {motionState}
          </span>
        </div>

        {/* 4. World · situation — scored fields only */}
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

        {/* 5. Preference & history — scored fields (the preset sets these;
            the standalone Driver-Profile picker was removed in favor of it). */}
        <SectionLabel>{t(LABELS.preferenceHistory, lang)}</SectionLabel>
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
                artists={def.key === 'oshi_id' ? artists : undefined}
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

        {/* 6. Dataset (read-only) — no selector; the dataset comes from the
            loaded seed/profile and is not reviewer-editable here. */}
        <DatasetProvenanceBanner provenance={datasetProvenance} lang={lang} />
        <CatalogView songs={state.catalog} total={state.catalogTotal} lang={lang} />
      </div>
    </section>
  )
}
