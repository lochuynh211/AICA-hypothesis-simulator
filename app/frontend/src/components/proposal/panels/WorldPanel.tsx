/**
 * WorldPanel (P1 T026) — panel ① Input · World.
 *
 * Section order (per ui-mockup.html / design doc §7):
 *   1. Trigger signal   — the 4 `trigger_purpose` options (control input, not scored)
 *   2. Car state        — `lifecycle_stage` (rest-journey position) + `motion_state`
 *   3. World · situation — editable init values for the non-preference/history
 *                          world features, each with a ProvenanceBadge
 *   4. Preference & history — badged "from profile"; auto-loaded, still editable
 *   5. Driver profile    — selector, LAST; loads the block above
 *
 * Writes directly to `proposalStore` (SET_TRIGGER_PURPOSE / SET_LIFECYCLE_STAGE /
 * SET_MOTION_STATE / SET_FEATURE_FIELD / SET_PROFILE). Does not read/write
 * `runStore` (proposal/trigger isolation invariant).
 */
import { t, type UiLanguage } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import type {
  TriggerPurposeValue,
  LifecycleStageValue,
  MotionStateValue,
} from '../../../state/proposalStore'
import ProvenanceBadge, { type ProvenanceKind } from '../ProvenanceBadge'

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

type FieldKind = 'number' | 'select' | 'text' | 'boolean'

type WorldFieldDef = {
  key: string
  label: { ja: string; en: string }
  kind: FieldKind
  options?: string[]
  provenance: ProvenanceKind
}

const WORLD_SITUATION_FIELDS: WorldFieldDef[] = [
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
  { key: 'route_tags', label: { ja: 'ルート特徴', en: 'Route' }, kind: 'text', provenance: 'cdc_su_baseline' },
  {
    key: 'destination_tags',
    label: { ja: '目的地', en: 'Destination' },
    kind: 'text',
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
]

const PREFERENCE_FIELDS: WorldFieldDef[] = [
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
    options: ['unspecified', 'female', 'male'],
    provenance: 'cdc_su_baseline',
  },
]

// ── Driver profiles — local mock data (P1 has no profile endpoint) ─────────

const DRIVER_PROFILES: {
  id: string
  label: { ja: string; en: string }
  fields: Record<string, unknown>
}[] = [
  {
    id: 'p_30s_oshi',
    label: { ja: '30代・推しあり', en: '30s · oshi' },
    fields: {
      age_band: '30s',
      gender: 'unspecified',
      oshi_registered: true,
      oshi_mode: 'on',
      service_usage_level: { music_playlist: 'high', quiz: 'low' },
      service_proposal_acceptance_rate: { music_playlist: 72, humming_karaoke: 55 },
      service_recovery_rate: { music_playlist: 64, radio_style: 48 },
    },
  },
  {
    id: 'p_60s_enka',
    label: { ja: '60代・演歌', en: '60s · enka' },
    fields: {
      age_band: '60plus',
      gender: 'male',
      oshi_registered: false,
      oshi_mode: 'off',
      service_usage_level: { music_playlist: 'med', radio_style: 'high' },
      service_proposal_acceptance_rate: { music_playlist: 58, radio_style: 80 },
      service_recovery_rate: { music_playlist: 50, radio_style: 70 },
    },
  },
  {
    id: 'p_20s_anime',
    label: { ja: '20代・アニメ好き', en: '20s · anime' },
    fields: {
      age_band: '20s',
      gender: 'unspecified',
      oshi_registered: true,
      oshi_mode: 'on',
      service_usage_level: { music_playlist: 'high', humming_karaoke: 'high' },
      service_proposal_acceptance_rate: { music_playlist: 80, humming_karaoke: 75 },
      service_recovery_rate: { music_playlist: 70, humming_karaoke: 65 },
    },
  },
  {
    id: 'p_40s_family',
    label: { ja: '40代・家族', en: '40s · family' },
    fields: {
      age_band: '40s',
      gender: 'female',
      oshi_registered: false,
      oshi_mode: 'off',
      service_usage_level: { music_playlist: 'med', quiz: 'med' },
      service_proposal_acceptance_rate: { music_playlist: 60, quiz: 55 },
      service_recovery_rate: { music_playlist: 55, quiz: 50 },
    },
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
  profile: { ja: 'プロファイル', en: 'Profile' },
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

function Field({
  def,
  value,
  onChange,
  lang,
}: {
  def: WorldFieldDef
  value: unknown
  onChange: (value: unknown) => void
  lang: UiLanguage
}) {
  const testId = `feature-field-${def.key}`
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
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
      {def.kind === 'number' && (
        <input
          data-testid={testId}
          type="number"
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      {def.kind === 'select' && (
        <select data-testid={testId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {def.kind === 'text' && (
        <input
          data-testid={testId}
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {def.kind === 'boolean' && (
        <select
          data-testid={testId}
          value={String(Boolean(value))}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      )}
    </div>
  )
}

// ── WorldPanel ───────────────────────────────────────────────────────────────

export default function WorldPanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, triggerPurpose, lifecycleStage, motionState, featureSnapshot, selectedProfileId } = state

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

        {/* 3. World · situation */}
        <SectionLabel>{t(LABELS.worldSituation, lang)}</SectionLabel>
        {WORLD_SITUATION_FIELDS.map((def) => (
          <Field
            key={def.key}
            def={def}
            value={featureSnapshot[def.key]}
            onChange={(value) => dispatch({ type: 'SET_FEATURE_FIELD', key: def.key, value })}
            lang={lang}
          />
        ))}

        {/* 4. Preference & history */}
        <SectionLabel badge={<ProvenanceBadge provenance="from_profile" lang={lang} />}>
          {t(LABELS.preferenceHistory, lang)}
        </SectionLabel>
        {PREFERENCE_FIELDS.map((def) => (
          <Field
            key={def.key}
            def={def}
            value={featureSnapshot[def.key]}
            onChange={(value) => dispatch({ type: 'SET_FEATURE_FIELD', key: def.key, value })}
            lang={lang}
          />
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', padding: '6px 0' }}>
          <span style={{ fontSize: '0.82em', color: '#4b5563' }}>
            <code>oshi_registered</code>
          </span>
          <select
            value={String(Boolean(featureSnapshot.oshi_registered))}
            onChange={(e) =>
              dispatch({ type: 'SET_FEATURE_FIELD', key: 'oshi_registered', value: e.target.value === 'true' })
            }
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', padding: '6px 0' }}>
          <span style={{ fontSize: '0.82em', color: '#4b5563' }}>
            <code>oshi_mode</code>
          </span>
          <select
            value={String(featureSnapshot.oshi_mode ?? 'off')}
            onChange={(e) => dispatch({ type: 'SET_FEATURE_FIELD', key: 'oshi_mode', value: e.target.value })}
          >
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </div>
        <div style={{ fontSize: '0.78em', color: '#6b7280', padding: '4px 0' }}>
          <code>service_usage_level[·]</code>: {JSON.stringify(featureSnapshot.service_usage_level ?? {})}
        </div>
        <div style={{ fontSize: '0.78em', color: '#6b7280', padding: '4px 0' }}>
          <code>service_proposal_acceptance_rate[·]</code>:{' '}
          {JSON.stringify(featureSnapshot.service_proposal_acceptance_rate ?? {})}
        </div>
        <div style={{ fontSize: '0.78em', color: '#6b7280', padding: '4px 0' }}>
          <code>service_recovery_rate[·]</code>: {JSON.stringify(featureSnapshot.service_recovery_rate ?? {})}
        </div>

        {/* 5. Driver profile — LAST */}
        <SectionLabel>{t(LABELS.driverProfile, lang)}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', padding: '6px 0' }}>
          <span style={{ fontSize: '0.82em', color: '#4b5563' }}>{t(LABELS.profile, lang)}</span>
          <select
            data-testid="driver-profile-select"
            value={selectedProfileId ?? ''}
            onChange={(e) => {
              const profile = DRIVER_PROFILES.find((p) => p.id === e.target.value)
              if (profile) {
                dispatch({ type: 'SET_PROFILE', profileId: profile.id, fields: profile.fields })
              }
            }}
          >
            <option value="" disabled>
              —
            </option>
            {DRIVER_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.label, lang)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
