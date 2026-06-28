/**
 * ProfileEditor (T009) — setup-time editor for every driver/vehicle/speed
 * profile field.
 *
 * Prefilled from the selected scenario's profiles (driver_profile,
 * vehicle_profile, speed_profile).  Computes a sparse override diff
 * (only changed fields) and dispatches it via SET_PROFILE_OVERRIDES so
 * PlanPreview can include it in the run-plan body.
 *
 * When nothing has changed the override is null, so no "profiles" key reaches
 * the backend (byte-identical back-compat with pre-T009 runs).
 *
 * data-testid="profile-editor" on the container.
 * Each field uses data-testid="profile-field-{section}-{subsection?}-{field}".
 */

import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { ScenarioDef, ProfileOverrides } from '../../api/types'

// ── Local edit-state types ─────────────────────────────────────────────────────

type DrowsinessEdits = {
  base_growth_per_min: number
  night_add_per_min: number
  monotony_add_per_min: number
  traffic_jam_add_per_min: number
}

type FatigueEdits = {
  base_growth_per_min: number
  continuous_driving_add_per_min_after_60_min: number
  mountain_road_add_per_min: number
  traffic_jam_add_per_min: number
}

type AttentionEdits = {
  base_recovery_per_min: number
  monotony_drop_per_min: number
  drowsiness_drop_factor: number
  active_content_recovery_per_min: number
}

type RecoveryEdits = {
  short_rest_drowsiness_recovery: number
  short_rest_fatigue_recovery: number
  long_rest_drowsiness_recovery: number
  long_rest_fatigue_recovery: number
}

type DriverEdits = {
  drowsiness_model: DrowsinessEdits
  fatigue_model: FatigueEdits
  attention_model: AttentionEdits
  recovery_model: RecoveryEdits
}

type SteeringEdits = {
  base_level: number
  drowsiness_factor: number
  fatigue_factor: number
  mountain_road_add: number
  traffic_jam_reduce: number
}

type LaneDepartureEdits = {
  enabled_on: string[] // stored as array; displayed as comma-joined
  drowsiness_threshold: number
  fatigue_threshold: number
  count_when_threshold_exceeded: number
}

type PedalEdits = {
  base_level: number
  fatigue_factor: number
  traffic_jam_add: number
  mountain_road_add: number
}

type AdasEdits = {
  lane_departure_warning_threshold: number
  steering_instability_warning_threshold: number
}

type VehicleEdits = {
  rolling_window_seconds: number
  steering_instability: SteeringEdits
  lane_departure: LaneDepartureEdits
  pedal_abnormality: PedalEdits
  adas_warning: AdasEdits
}

type SpeedEdits = {
  normal_road_kph: number
  highway_kph: number
  mountain_road_kph: number
  sightseeing_road_kph: number
  traffic_jam_kph: number
}

// ── Extraction helpers ─────────────────────────────────────────────────────────

function extractDriverEdits(dp: Record<string, unknown>): DriverEdits {
  const dm = (dp.drowsiness_model ?? {}) as Record<string, number>
  const fm = (dp.fatigue_model ?? {}) as Record<string, number>
  const am = (dp.attention_model ?? {}) as Record<string, number>
  const rm = (dp.recovery_model ?? {}) as Record<string, number>
  return {
    drowsiness_model: {
      base_growth_per_min: dm.base_growth_per_min ?? 0,
      night_add_per_min: dm.night_add_per_min ?? 0,
      monotony_add_per_min: dm.monotony_add_per_min ?? 0,
      traffic_jam_add_per_min: dm.traffic_jam_add_per_min ?? 0,
    },
    fatigue_model: {
      base_growth_per_min: fm.base_growth_per_min ?? 0,
      continuous_driving_add_per_min_after_60_min: fm.continuous_driving_add_per_min_after_60_min ?? 0,
      mountain_road_add_per_min: fm.mountain_road_add_per_min ?? 0,
      traffic_jam_add_per_min: fm.traffic_jam_add_per_min ?? 0,
    },
    attention_model: {
      base_recovery_per_min: am.base_recovery_per_min ?? 0,
      monotony_drop_per_min: am.monotony_drop_per_min ?? 0,
      drowsiness_drop_factor: am.drowsiness_drop_factor ?? 0,
      active_content_recovery_per_min: am.active_content_recovery_per_min ?? 0,
    },
    recovery_model: {
      short_rest_drowsiness_recovery: rm.short_rest_drowsiness_recovery ?? 0,
      short_rest_fatigue_recovery: rm.short_rest_fatigue_recovery ?? 0,
      long_rest_drowsiness_recovery: rm.long_rest_drowsiness_recovery ?? 0,
      long_rest_fatigue_recovery: rm.long_rest_fatigue_recovery ?? 0,
    },
  }
}

function extractVehicleEdits(vp: Record<string, unknown>): VehicleEdits {
  const si = (vp.steering_instability ?? {}) as Record<string, number>
  const ld = (vp.lane_departure ?? {}) as Record<string, unknown>
  const pa = (vp.pedal_abnormality ?? {}) as Record<string, number>
  const aw = (vp.adas_warning ?? {}) as Record<string, number>
  return {
    rolling_window_seconds: (vp.rolling_window_seconds as number) ?? 300,
    steering_instability: {
      base_level: si.base_level ?? 0,
      drowsiness_factor: si.drowsiness_factor ?? 0,
      fatigue_factor: si.fatigue_factor ?? 0,
      mountain_road_add: si.mountain_road_add ?? 0,
      traffic_jam_reduce: si.traffic_jam_reduce ?? 0,
    },
    lane_departure: {
      enabled_on: Array.isArray(ld.enabled_on) ? (ld.enabled_on as string[]) : [],
      drowsiness_threshold: (ld.drowsiness_threshold as number) ?? 0,
      fatigue_threshold: (ld.fatigue_threshold as number) ?? 0,
      count_when_threshold_exceeded: (ld.count_when_threshold_exceeded as number) ?? 0,
    },
    pedal_abnormality: {
      base_level: pa.base_level ?? 0,
      fatigue_factor: pa.fatigue_factor ?? 0,
      traffic_jam_add: pa.traffic_jam_add ?? 0,
      mountain_road_add: pa.mountain_road_add ?? 0,
    },
    adas_warning: {
      lane_departure_warning_threshold: aw.lane_departure_warning_threshold ?? 0,
      steering_instability_warning_threshold: aw.steering_instability_warning_threshold ?? 0,
    },
  }
}

function extractSpeedEdits(sp: Record<string, unknown>): SpeedEdits {
  return {
    normal_road_kph: (sp.normal_road_kph as number) ?? 0,
    highway_kph: (sp.highway_kph as number) ?? 0,
    mountain_road_kph: (sp.mountain_road_kph as number) ?? 0,
    sightseeing_road_kph: (sp.sightseeing_road_kph as number) ?? 0,
    traffic_jam_kph: (sp.traffic_jam_kph as number) ?? 0,
  }
}

// ── Sparse override computation ────────────────────────────────────────────────

function computeSparseOverride(
  driverEdits: DriverEdits | null,
  vehicleEdits: VehicleEdits | null,
  speedEdits: SpeedEdits | null,
  scenarioDef: ScenarioDef,
): ProfileOverrides | null {
  const overrides: ProfileOverrides = {}

  // ─── Driver ───────────────────────────────────────────────────────────────
  const dp = scenarioDef.driver_profile as Record<string, Record<string, number>> | null | undefined
  if (dp && driverEdits) {
    const driverOverride: Record<string, Record<string, number>> = {}
    const submodels: Array<keyof DriverEdits> = [
      'drowsiness_model',
      'fatigue_model',
      'attention_model',
      'recovery_model',
    ]
    for (const sub of submodels) {
      const defaults = (dp[sub] ?? {}) as Record<string, number>
      const current = driverEdits[sub] as Record<string, number>
      const subDiff: Record<string, number> = {}
      for (const [field, val] of Object.entries(current)) {
        if (val !== defaults[field]) subDiff[field] = val
      }
      if (Object.keys(subDiff).length > 0) driverOverride[sub] = subDiff
    }
    if (Object.keys(driverOverride).length > 0) overrides.driver = driverOverride
  }

  // ─── Vehicle ──────────────────────────────────────────────────────────────
  const vp = scenarioDef.vehicle_profile as Record<string, unknown> | null | undefined
  if (vp && vehicleEdits) {
    const vehicleOverride: Record<string, unknown> = {}

    // rolling_window_seconds (top-level scalar)
    if (vehicleEdits.rolling_window_seconds !== (vp.rolling_window_seconds as number)) {
      vehicleOverride.rolling_window_seconds = vehicleEdits.rolling_window_seconds
    }

    // steering_instability (pure numeric sub-model)
    {
      const defaults = (vp.steering_instability ?? {}) as Record<string, number>
      const current = vehicleEdits.steering_instability as Record<string, number>
      const subDiff: Record<string, number> = {}
      for (const [field, val] of Object.entries(current)) {
        if (val !== defaults[field]) subDiff[field] = val
      }
      if (Object.keys(subDiff).length > 0) vehicleOverride.steering_instability = subDiff
    }

    // lane_departure (mixed: enabled_on is string[], others numeric)
    {
      const defaults = (vp.lane_departure ?? {}) as Record<string, unknown>
      const current = vehicleEdits.lane_departure
      const subDiff: Record<string, unknown> = {}
      const _sortedCurrent = [...current.enabled_on].sort()
      const _sortedDefault = [...((defaults.enabled_on as string[]) ?? [])].sort()
      if (JSON.stringify(_sortedCurrent) !== JSON.stringify(_sortedDefault)) {
        subDiff.enabled_on = current.enabled_on
      }
      if (current.drowsiness_threshold !== (defaults.drowsiness_threshold as number)) {
        subDiff.drowsiness_threshold = current.drowsiness_threshold
      }
      if (current.fatigue_threshold !== (defaults.fatigue_threshold as number)) {
        subDiff.fatigue_threshold = current.fatigue_threshold
      }
      if (current.count_when_threshold_exceeded !== (defaults.count_when_threshold_exceeded as number)) {
        subDiff.count_when_threshold_exceeded = current.count_when_threshold_exceeded
      }
      if (Object.keys(subDiff).length > 0) vehicleOverride.lane_departure = subDiff
    }

    // pedal_abnormality (pure numeric sub-model)
    {
      const defaults = (vp.pedal_abnormality ?? {}) as Record<string, number>
      const current = vehicleEdits.pedal_abnormality as Record<string, number>
      const subDiff: Record<string, number> = {}
      for (const [field, val] of Object.entries(current)) {
        if (val !== defaults[field]) subDiff[field] = val
      }
      if (Object.keys(subDiff).length > 0) vehicleOverride.pedal_abnormality = subDiff
    }

    // adas_warning (pure numeric sub-model)
    {
      const defaults = (vp.adas_warning ?? {}) as Record<string, number>
      const current = vehicleEdits.adas_warning as Record<string, number>
      const subDiff: Record<string, number> = {}
      for (const [field, val] of Object.entries(current)) {
        if (val !== defaults[field]) subDiff[field] = val
      }
      if (Object.keys(subDiff).length > 0) vehicleOverride.adas_warning = subDiff
    }

    if (Object.keys(vehicleOverride).length > 0) overrides.vehicle = vehicleOverride
  }

  // ─── Speed ────────────────────────────────────────────────────────────────
  const sp = scenarioDef.speed_profile as Record<string, number> | null | undefined
  if (sp && speedEdits) {
    const speedDiff: Record<string, number> = {}
    for (const [field, val] of Object.entries(speedEdits)) {
      if (val !== sp[field]) speedDiff[field] = val
    }
    if (Object.keys(speedDiff).length > 0) overrides.speed = speedDiff
  }

  return Object.keys(overrides).length > 0 ? overrides : null
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  section: { marginBottom: '8px' },
  legend: { fontSize: '0.72em', fontWeight: 700, color: '#555', padding: '0 2px' },
  fieldset: { border: '1px solid #e5e7eb', borderRadius: '4px', padding: '6px 8px', marginBottom: '6px' },
  row: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' },
  label: { fontSize: '0.72em', color: '#555', minWidth: '240px', flexShrink: 0 },
  input: { width: '90px', fontSize: '0.8em' },
  textInput: { width: '160px', fontSize: '0.8em' },
  resetBtn: { fontSize: '0.75em', padding: '3px 8px', marginBottom: '10px', cursor: 'pointer' },
}

// ── Numeric field row ─────────────────────────────────────────────────────────

function NumericField({
  testid,
  label,
  value,
  onChange,
  step = 'any',
}: {
  testid: string
  label: string
  value: number
  onChange: (v: number) => void
  step?: string | number
}) {
  const [display, setDisplay] = useState(String(value))

  // Sync when parent resets or changes the value externally
  useEffect(() => {
    setDisplay(String(value))
  }, [value])

  return (
    <div style={S.row}>
      <label htmlFor={testid} style={S.label}>
        {label}
      </label>
      <input
        id={testid}
        data-testid={testid}
        type="number"
        value={display}
        min={0}
        step={step}
        onChange={(e) => {
          setDisplay(e.target.value)
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onChange(n)
        }}
        onBlur={() => {
          const n = parseFloat(display)
          if (isNaN(n)) setDisplay(String(value))
        }}
        style={S.input}
      />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfileEditor() {
  const { state, dispatch } = useRunStore()
  const { selectedScenarioId } = state

  const [localDef, setLocalDef] = useState<ScenarioDef | null>(null)
  const [driverEdits, setDriverEdits] = useState<DriverEdits | null>(null)
  const [vehicleEdits, setVehicleEdits] = useState<VehicleEdits | null>(null)
  const [speedEdits, setSpeedEdits] = useState<SpeedEdits | null>(null)

  // Fetch scenario def and initialize local state when scenario changes
  useEffect(() => {
    if (!selectedScenarioId) {
      setLocalDef(null)
      setDriverEdits(null)
      setVehicleEdits(null)
      setSpeedEdits(null)
      dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: null })
      return
    }

    let cancelled = false
    getScenario(selectedScenarioId)
      .then((def) => {
        if (cancelled) return
        setLocalDef(def)
        if (def.driver_profile) setDriverEdits(extractDriverEdits(def.driver_profile))
        if (def.vehicle_profile) setVehicleEdits(extractVehicleEdits(def.vehicle_profile))
        if (def.speed_profile) setSpeedEdits(extractSpeedEdits(def.speed_profile))
        dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: null })
      })
      .catch(() => {
        // Scenario def unavailable — ProfileEditor stays hidden
        if (!cancelled) setLocalDef(null)
      })

    return () => {
      cancelled = true
    }
  }, [selectedScenarioId, dispatch])

  // ── Helpers to update a field and recompute the sparse override ────────────

  function updateDriver(
    sub: keyof DriverEdits,
    field: string,
    value: number,
    currentVehicle: VehicleEdits | null,
    currentSpeed: SpeedEdits | null,
  ) {
    const nextEdits: DriverEdits = {
      ...driverEdits!,
      [sub]: { ...(driverEdits![sub] as Record<string, number>), [field]: value },
    }
    setDriverEdits(nextEdits)
    if (localDef) {
      dispatch({
        type: 'SET_PROFILE_OVERRIDES',
        overrides: computeSparseOverride(nextEdits, currentVehicle, currentSpeed, localDef),
      })
    }
  }

  function updateVehicle(
    nextVehicle: VehicleEdits,
    currentDriver: DriverEdits | null,
    currentSpeed: SpeedEdits | null,
  ) {
    setVehicleEdits(nextVehicle)
    if (localDef) {
      dispatch({
        type: 'SET_PROFILE_OVERRIDES',
        overrides: computeSparseOverride(currentDriver, nextVehicle, currentSpeed, localDef),
      })
    }
  }

  function updateSpeed(field: keyof SpeedEdits, value: number, currentDriver: DriverEdits | null, currentVehicle: VehicleEdits | null) {
    const nextSpeed: SpeedEdits = { ...speedEdits!, [field]: value }
    setSpeedEdits(nextSpeed)
    if (localDef) {
      dispatch({
        type: 'SET_PROFILE_OVERRIDES',
        overrides: computeSparseOverride(currentDriver, currentVehicle, nextSpeed, localDef),
      })
    }
  }

  function handleReset() {
    if (!localDef) return
    if (localDef.driver_profile) setDriverEdits(extractDriverEdits(localDef.driver_profile))
    if (localDef.vehicle_profile) setVehicleEdits(extractVehicleEdits(localDef.vehicle_profile))
    if (localDef.speed_profile) setSpeedEdits(extractSpeedEdits(localDef.speed_profile))
    dispatch({ type: 'SET_PROFILE_OVERRIDES', overrides: null })
  }

  // No scenario selected yet or def not loaded — hide entirely
  if (!selectedScenarioId || !localDef) return null
  // At least one profile section needed to render
  if (!driverEdits && !vehicleEdits && !speedEdits) return null

  const P = 'profile-field'

  return (
    <div data-testid="profile-editor" style={S.section}>
      <button
        onClick={handleReset}
        style={S.resetBtn}
        title="Restore all fields to the scenario's default values"
      >
        Reset to defaults
      </button>

      {/* ── Driver Model ─────────────────────────────────────────────────── */}
      {driverEdits && <details open>
        <summary style={{ fontSize: '0.75em', fontWeight: 600, color: '#444', cursor: 'pointer', marginBottom: '6px' }}>
          Driver Model
        </summary>

        {/* drowsiness_model */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Drowsiness Model</legend>
          <NumericField testid={`${P}-driver-drowsiness_model-base_growth_per_min`} label="base_growth_per_min" value={driverEdits.drowsiness_model.base_growth_per_min} onChange={(v) => updateDriver('drowsiness_model', 'base_growth_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-drowsiness_model-night_add_per_min`} label="night_add_per_min" value={driverEdits.drowsiness_model.night_add_per_min} onChange={(v) => updateDriver('drowsiness_model', 'night_add_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-drowsiness_model-monotony_add_per_min`} label="monotony_add_per_min" value={driverEdits.drowsiness_model.monotony_add_per_min} onChange={(v) => updateDriver('drowsiness_model', 'monotony_add_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-drowsiness_model-traffic_jam_add_per_min`} label="traffic_jam_add_per_min" value={driverEdits.drowsiness_model.traffic_jam_add_per_min} onChange={(v) => updateDriver('drowsiness_model', 'traffic_jam_add_per_min', v, vehicleEdits, speedEdits)} />
        </fieldset>

        {/* fatigue_model */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Fatigue Model</legend>
          <NumericField testid={`${P}-driver-fatigue_model-base_growth_per_min`} label="base_growth_per_min" value={driverEdits.fatigue_model.base_growth_per_min} onChange={(v) => updateDriver('fatigue_model', 'base_growth_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-fatigue_model-continuous_driving_add_per_min_after_60_min`} label="continuous_driving_add_per_min_after_60_min" value={driverEdits.fatigue_model.continuous_driving_add_per_min_after_60_min} onChange={(v) => updateDriver('fatigue_model', 'continuous_driving_add_per_min_after_60_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-fatigue_model-mountain_road_add_per_min`} label="mountain_road_add_per_min" value={driverEdits.fatigue_model.mountain_road_add_per_min} onChange={(v) => updateDriver('fatigue_model', 'mountain_road_add_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-fatigue_model-traffic_jam_add_per_min`} label="traffic_jam_add_per_min" value={driverEdits.fatigue_model.traffic_jam_add_per_min} onChange={(v) => updateDriver('fatigue_model', 'traffic_jam_add_per_min', v, vehicleEdits, speedEdits)} />
        </fieldset>

        {/* attention_model */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Attention Model</legend>
          <NumericField testid={`${P}-driver-attention_model-base_recovery_per_min`} label="base_recovery_per_min" value={driverEdits.attention_model.base_recovery_per_min} onChange={(v) => updateDriver('attention_model', 'base_recovery_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-attention_model-monotony_drop_per_min`} label="monotony_drop_per_min" value={driverEdits.attention_model.monotony_drop_per_min} onChange={(v) => updateDriver('attention_model', 'monotony_drop_per_min', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-attention_model-drowsiness_drop_factor`} label="drowsiness_drop_factor" value={driverEdits.attention_model.drowsiness_drop_factor} onChange={(v) => updateDriver('attention_model', 'drowsiness_drop_factor', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-attention_model-active_content_recovery_per_min`} label="active_content_recovery_per_min" value={driverEdits.attention_model.active_content_recovery_per_min} onChange={(v) => updateDriver('attention_model', 'active_content_recovery_per_min', v, vehicleEdits, speedEdits)} />
        </fieldset>

        {/* recovery_model */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Recovery Model</legend>
          <NumericField testid={`${P}-driver-recovery_model-short_rest_drowsiness_recovery`} label="short_rest_drowsiness_recovery" value={driverEdits.recovery_model.short_rest_drowsiness_recovery} onChange={(v) => updateDriver('recovery_model', 'short_rest_drowsiness_recovery', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-recovery_model-short_rest_fatigue_recovery`} label="short_rest_fatigue_recovery" value={driverEdits.recovery_model.short_rest_fatigue_recovery} onChange={(v) => updateDriver('recovery_model', 'short_rest_fatigue_recovery', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-recovery_model-long_rest_drowsiness_recovery`} label="long_rest_drowsiness_recovery" value={driverEdits.recovery_model.long_rest_drowsiness_recovery} onChange={(v) => updateDriver('recovery_model', 'long_rest_drowsiness_recovery', v, vehicleEdits, speedEdits)} />
          <NumericField testid={`${P}-driver-recovery_model-long_rest_fatigue_recovery`} label="long_rest_fatigue_recovery" value={driverEdits.recovery_model.long_rest_fatigue_recovery} onChange={(v) => updateDriver('recovery_model', 'long_rest_fatigue_recovery', v, vehicleEdits, speedEdits)} />
        </fieldset>
      </details>}

      {/* ── Vehicle Behavior ─────────────────────────────────────────────── */}
      {vehicleEdits && <details open>
        <summary style={{ fontSize: '0.75em', fontWeight: 600, color: '#444', cursor: 'pointer', marginBottom: '6px' }}>
          Vehicle Behavior
        </summary>

        {/* rolling_window_seconds — top-level */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Rolling Window</legend>
          <NumericField testid={`${P}-vehicle-rolling_window_seconds`} label="rolling_window_seconds" value={vehicleEdits.rolling_window_seconds} step={1} onChange={(v) => updateVehicle({ ...vehicleEdits, rolling_window_seconds: Math.round(v) }, driverEdits, speedEdits)} />
        </fieldset>

        {/* steering_instability */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Steering Instability</legend>
          <NumericField testid={`${P}-vehicle-steering_instability-base_level`} label="base_level" value={vehicleEdits.steering_instability.base_level} onChange={(v) => updateVehicle({ ...vehicleEdits, steering_instability: { ...vehicleEdits.steering_instability, base_level: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-steering_instability-drowsiness_factor`} label="drowsiness_factor" value={vehicleEdits.steering_instability.drowsiness_factor} onChange={(v) => updateVehicle({ ...vehicleEdits, steering_instability: { ...vehicleEdits.steering_instability, drowsiness_factor: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-steering_instability-fatigue_factor`} label="fatigue_factor" value={vehicleEdits.steering_instability.fatigue_factor} onChange={(v) => updateVehicle({ ...vehicleEdits, steering_instability: { ...vehicleEdits.steering_instability, fatigue_factor: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-steering_instability-mountain_road_add`} label="mountain_road_add" value={vehicleEdits.steering_instability.mountain_road_add} onChange={(v) => updateVehicle({ ...vehicleEdits, steering_instability: { ...vehicleEdits.steering_instability, mountain_road_add: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-steering_instability-traffic_jam_reduce`} label="traffic_jam_reduce" value={vehicleEdits.steering_instability.traffic_jam_reduce} onChange={(v) => updateVehicle({ ...vehicleEdits, steering_instability: { ...vehicleEdits.steering_instability, traffic_jam_reduce: v } }, driverEdits, speedEdits)} />
        </fieldset>

        {/* lane_departure */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Lane Departure</legend>
          <div style={S.row}>
            <label
              htmlFor={`${P}-vehicle-lane_departure-enabled_on`}
              style={S.label}
            >
              enabled_on (comma-separated)
            </label>
            <input
              id={`${P}-vehicle-lane_departure-enabled_on`}
              data-testid={`${P}-vehicle-lane_departure-enabled_on`}
              type="text"
              value={vehicleEdits.lane_departure.enabled_on.join(',')}
              onChange={(e) => {
                const arr = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                updateVehicle(
                  { ...vehicleEdits, lane_departure: { ...vehicleEdits.lane_departure, enabled_on: arr } },
                  driverEdits,
                  speedEdits,
                )
              }}
              style={S.textInput}
            />
          </div>
          <NumericField testid={`${P}-vehicle-lane_departure-drowsiness_threshold`} label="drowsiness_threshold" value={vehicleEdits.lane_departure.drowsiness_threshold} onChange={(v) => updateVehicle({ ...vehicleEdits, lane_departure: { ...vehicleEdits.lane_departure, drowsiness_threshold: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-lane_departure-fatigue_threshold`} label="fatigue_threshold" value={vehicleEdits.lane_departure.fatigue_threshold} onChange={(v) => updateVehicle({ ...vehicleEdits, lane_departure: { ...vehicleEdits.lane_departure, fatigue_threshold: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-lane_departure-count_when_threshold_exceeded`} label="count_when_threshold_exceeded" value={vehicleEdits.lane_departure.count_when_threshold_exceeded} step={1} onChange={(v) => updateVehicle({ ...vehicleEdits, lane_departure: { ...vehicleEdits.lane_departure, count_when_threshold_exceeded: Math.round(v) } }, driverEdits, speedEdits)} />
        </fieldset>

        {/* pedal_abnormality */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Pedal Abnormality</legend>
          <NumericField testid={`${P}-vehicle-pedal_abnormality-base_level`} label="base_level" value={vehicleEdits.pedal_abnormality.base_level} onChange={(v) => updateVehicle({ ...vehicleEdits, pedal_abnormality: { ...vehicleEdits.pedal_abnormality, base_level: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-pedal_abnormality-fatigue_factor`} label="fatigue_factor" value={vehicleEdits.pedal_abnormality.fatigue_factor} onChange={(v) => updateVehicle({ ...vehicleEdits, pedal_abnormality: { ...vehicleEdits.pedal_abnormality, fatigue_factor: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-pedal_abnormality-traffic_jam_add`} label="traffic_jam_add" value={vehicleEdits.pedal_abnormality.traffic_jam_add} onChange={(v) => updateVehicle({ ...vehicleEdits, pedal_abnormality: { ...vehicleEdits.pedal_abnormality, traffic_jam_add: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-pedal_abnormality-mountain_road_add`} label="mountain_road_add" value={vehicleEdits.pedal_abnormality.mountain_road_add} onChange={(v) => updateVehicle({ ...vehicleEdits, pedal_abnormality: { ...vehicleEdits.pedal_abnormality, mountain_road_add: v } }, driverEdits, speedEdits)} />
        </fieldset>

        {/* adas_warning */}
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>ADAS Warning</legend>
          <NumericField testid={`${P}-vehicle-adas_warning-lane_departure_warning_threshold`} label="lane_departure_warning_threshold" value={vehicleEdits.adas_warning.lane_departure_warning_threshold} onChange={(v) => updateVehicle({ ...vehicleEdits, adas_warning: { ...vehicleEdits.adas_warning, lane_departure_warning_threshold: v } }, driverEdits, speedEdits)} />
          <NumericField testid={`${P}-vehicle-adas_warning-steering_instability_warning_threshold`} label="steering_instability_warning_threshold" value={vehicleEdits.adas_warning.steering_instability_warning_threshold} onChange={(v) => updateVehicle({ ...vehicleEdits, adas_warning: { ...vehicleEdits.adas_warning, steering_instability_warning_threshold: v } }, driverEdits, speedEdits)} />
        </fieldset>
      </details>}

      {/* ── Speed Profile ────────────────────────────────────────────────── */}
      {speedEdits && <details open>
        <summary style={{ fontSize: '0.75em', fontWeight: 600, color: '#444', cursor: 'pointer', marginBottom: '6px' }}>
          Speed Profile
        </summary>
        <fieldset style={S.fieldset}>
          <legend style={S.legend}>Expected Speeds (kph)</legend>
          <NumericField testid={`${P}-speed-normal_road_kph`} label="normal_road_kph" value={speedEdits.normal_road_kph} step={1} onChange={(v) => updateSpeed('normal_road_kph', Math.round(v), driverEdits, vehicleEdits)} />
          <NumericField testid={`${P}-speed-highway_kph`} label="highway_kph" value={speedEdits.highway_kph} step={1} onChange={(v) => updateSpeed('highway_kph', Math.round(v), driverEdits, vehicleEdits)} />
          <NumericField testid={`${P}-speed-mountain_road_kph`} label="mountain_road_kph" value={speedEdits.mountain_road_kph} step={1} onChange={(v) => updateSpeed('mountain_road_kph', Math.round(v), driverEdits, vehicleEdits)} />
          <NumericField testid={`${P}-speed-sightseeing_road_kph`} label="sightseeing_road_kph" value={speedEdits.sightseeing_road_kph} step={1} onChange={(v) => updateSpeed('sightseeing_road_kph', Math.round(v), driverEdits, vehicleEdits)} />
          <NumericField testid={`${P}-speed-traffic_jam_kph`} label="traffic_jam_kph" value={speedEdits.traffic_jam_kph} step={1} onChange={(v) => updateSpeed('traffic_jam_kph', Math.round(v), driverEdits, vehicleEdits)} />
        </fieldset>
      </details>}
    </div>
  )
}
