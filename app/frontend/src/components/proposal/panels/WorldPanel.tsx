/**
 * WorldPanel (P1 T026, rebuilt P3 T026 as a REAL editor over the typed
 * `World`; reworked again per owner feedback 2026-07-17; the Situation and
 * Preference/History field blocks were extracted into shared section components
 * for feature 020 — see `./sections/`).
 *
 * Section order (top-to-bottom):
 *   0. Preset      — (feature 018) dropdown over committed preset test-case
 *                     worlds; selecting one ATOMICALLY replaces the whole
 *                     world (situation + driver_profile + control_inputs
 *                     together) and supersedes any Seed/Profile selection
 *                     below, plus shows a bilingual brief blurb.
 *   1. Explanation source (feature 019)
 *   2. Trigger signal — the 4 `trigger_purpose` options (control input, not scored)
 *   3. Car state   — `lifecycle_stage` + a READ-ONLY `motion_state` readout
 *                     DERIVED from the lifecycle stage.
 *   4. World · situation — `SituationFieldRows` (ONLY the fields actually SCORED).
 *   5. Preference & history — `PreferenceHistorySection` (scored DriverProfile
 *                     fields + the opt-in genre extension).
 *   6. Dataset (read-only) — DatasetProvenanceBanner + CatalogView.
 *
 * Writes directly to `proposalStore`. Does not read/write `runStore`
 * (proposal/trigger isolation invariant).
 */
import { useEffect, useState } from 'react'
import { t } from '../../../i18n/t'
import { useProposalStore } from '../../../state/proposalStore'
import type {
  TriggerPurposeValue,
  LifecycleStageValue,
  MotionStateValue,
} from '../../../state/proposalStore'
import {
  getCatalog,
  validateWorld,
  type DatasetProvenance,
} from '../../../api/proposalClient'
import PresetPicker from '../PresetPicker'
import DatasetProvenanceBanner from '../DatasetProvenanceBanner'
import CatalogView from '../CatalogView'
import SituationFieldRows from './sections/SituationFieldRows'
import PreferenceHistorySection from './sections/PreferenceHistorySection'
import { SITUATION_FIELDS } from './sections/worldFields'

// Debounce delay (ms) between a `world` edit and the inline
// `POST /worlds/validate` call (MF1 / US1 AC#3, SC-002).
const WORLD_VALIDATE_DEBOUNCE_MS = 300

/** motion_state is DERIVED from lifecycle_stage (during_rest_stopped /
 * after_rest_before_restart imply stopped; every other stage is driving). */
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

/** Which car states each trigger signal may pair with — mirrors the frozen
 * `purpose_stage_matrix.v1.json` so the UI can never form a pair the backend
 * would 422 on (e.g. route_music × before_rest_until_stop). `during_rest_stopped`
 * is deliberately omitted everywhere: it is the nap, which proposes nothing —
 * the Combined screen still transitions through it, but it is not a
 * user-selectable proposal state here. */
const STAGES_FOR_PURPOSE: Record<TriggerPurposeValue, LifecycleStageValue[]> = {
  rest_recommended: ['before_rest_until_stop', 'after_rest_before_restart'],
  inattentive_driving_prevention_recovery: ['active_driving_content'],
  route_music: ['active_driving_content'],
  child_passenger_experience: ['active_driving_content'],
}

// ── Small shared UI atoms ───────────────────────────────────────────────────

const LABELS = {
  preset: { ja: 'プリセット（テストケース）', en: 'Preset (test-case)' },
  triggerSignal: { ja: '発火シグナル（4つ）', en: 'Trigger signal (4)' },
  carState: { ja: '車両状態（現在状況）', en: 'Car state (current status)' },
  worldSituation: { ja: '世界・状況（初期値・編集可）', en: 'World · situation (init values, editable)' },
  preferenceHistory: { ja: '好み・履歴', en: 'Preference & history' },
  motion: { ja: '走行/停車（自動）', en: 'Motion (derived)' },
  // feature 019 — explanation-source flag (narration layer over the decision)
  explanationSource: { ja: '説明の生成元', en: 'Explanation source' },
  explOff: { ja: 'オフ（既定テンプレート）', en: 'Off (template)' },
  explBackend: { ja: 'バックエンドLLM（Ollama）', en: 'Backend LLM (Ollama)' },
  explBrowser: { ja: 'ブラウザ（Gemini Nano）', en: 'Browser (Gemini Nano)' },
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

// ── WorldPanel ───────────────────────────────────────────────────────────────

export default function WorldPanel() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang, triggerPurpose, lifecycleStage, motionState, world } = state

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
  // `world` edit — best-effort; a failed validate call leaves prior issues as-is.
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

  function handleLifecycleStage(stage: LifecycleStageValue) {
    dispatch({ type: 'SET_LIFECYCLE_STAGE', stage })
    dispatch({ type: 'SET_MOTION_STATE', motionState: deriveMotion(stage) })
  }

  /** Selecting a trigger signal constrains the valid car states. If the current
   * stage is no longer compatible (e.g. switching route_music while sitting on a
   * rest stage), snap to the first allowed stage and re-derive motion — so an
   * invalid signal×state pair can never be formed in the UI. */
  function handleTriggerPurpose(purpose: TriggerPurposeValue) {
    dispatch({ type: 'SET_TRIGGER_PURPOSE', purpose })
    const allowed = STAGES_FOR_PURPOSE[purpose]
    if (!allowed.includes(lifecycleStage)) {
      handleLifecycleStage(allowed[0])
    }
  }

  const allowedStages = STAGES_FOR_PURPOSE[triggerPurpose]
  const visibleStages = LIFECYCLE_STAGES.filter((opt) => allowedStages.includes(opt.value))

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
        {/* Inline world validation (MF1 / US1 AC#3, SC-002). */}
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

        {/* 0. Preset — committed test-case worlds (feature 018). */}
        <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: '#6b7280', margin: '0 0 6px' }}>
          {t(LABELS.preset, lang)}
        </div>
        <PresetPicker />

        {/* 1. Explanation source (feature 019). */}
        <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, color: '#6b7280', margin: '8px 0 6px' }}>
          {t(LABELS.explanationSource, lang)}
        </div>
        <select
          data-testid="explanation-provider-select"
          value={state.explanationProvider}
          onChange={(e) =>
            dispatch({
              type: 'SET_EXPLANATION_PROVIDER',
              provider: e.target.value as 'off' | 'backend' | 'browser',
            })
          }
          style={{ width: '100%', fontSize: '0.82em', margin: '0 0 8px', padding: '3px' }}
        >
          <option value="off">{t(LABELS.explOff, lang)}</option>
          <option value="backend">{t(LABELS.explBackend, lang)}</option>
          <option value="browser">{t(LABELS.explBrowser, lang)}</option>
        </select>

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
                onClick={() => handleTriggerPurpose(opt.value)}
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
          {visibleStages.map((opt) => {
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
        <SituationFieldRows fields={SITUATION_FIELDS} />

        {/* 5. Preference & history — scored fields + genre extension. */}
        <SectionLabel>{t(LABELS.preferenceHistory, lang)}</SectionLabel>
        <PreferenceHistorySection />

        {/* 6. Dataset (read-only) — no selector; comes from the loaded preset. */}
        <DatasetProvenanceBanner provenance={datasetProvenance} lang={lang} />
        <CatalogView songs={state.catalog} total={state.catalogTotal} lang={lang} />
      </div>
    </section>
  )
}
