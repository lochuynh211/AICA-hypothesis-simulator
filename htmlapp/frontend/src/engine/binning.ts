/**
 * Boundary-binning service — surface → qualitative ordinal bands.
 *
 * Ported from `app/api/aica_api/services/binning.py` (behavior-of-record).
 * This is the single seam between any raw numeric measurements and the
 * decision-making engine. The engine consumes ONLY ordinal bands; no raw
 * number ever crosses this boundary.
 *
 * Only the two exported function identifiers are camelCased
 * (`buildFeatureGroups`, `binContext`). All output object keys and every
 * ordinal/band string value are preserved byte-for-byte from the Python
 * (snake_case keys, exact band strings) because they cross the parity
 * boundary.
 *
 * Design contract (mirrors the Python docstring):
 * - Pure function of its input (no I/O, no side effects).
 * - `binContext` output contains ONLY string values (ordinal band labels).
 * - Raw keys are never forwarded to the output of `binContext`.
 */

// ---------------------------------------------------------------------------
// Internal binning helpers (mirroring surface_binning.mjs / binning.py)
// ---------------------------------------------------------------------------

const RAW_KEYS = new Set(['travel_time_sec', 'remaining_to_destination_sec', 'rest_spot_metres'])

/** Map elapsed driving seconds to a continuous_driving_time band. */
function binDriveTime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) {
    return 'short'
  }
  if (sec < 1800) {
    return 'short'
  }
  if (sec < 5400) {
    return 'moderate'
  }
  return 'long'
}

/** Map rest-spot distance (metres) to a rest_spot_eta band. */
function binRestEta(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) {
    return 'none'
  }
  if (metres <= 20000) {
    return 'near'
  }
  return 'far'
}

// ---------------------------------------------------------------------------
// build_feature_groups(raw_state) -> {normalized, ordinal}
// ---------------------------------------------------------------------------
//
// raw_state keys (camelCase, simulator-internal numerics):
//   drowsinessLevel, fatigueLevel, attentionLevel, speedKph,
//   steeringInstabilityLevel, pedalAbnormalityLevel, laneDepartureCount,
//   adasWarningCount, nextRestSpotMin (9999 = no rest ahead), routeFraction,
//   continuousDrivingMin, isNight, weatherRiskLevel, segmentType,
//   drowsinessAboveWeakTicks (consecutive ticks with drowsiness >= 20)
//
// Ordinal thresholds:
//   drowsiness_level: none<20, weak 20-40, moderate 40-60, strong 60-80, severe>=80
//   fatigue_level:    low<30, medium 30-60, high>=60
//   signal_duration:  transient=0, brief=1, sustained 2-9, persistent>=10 (AboveWeakTicks)
//   rest_spot_eta:    none=nextRestSpotMin>=9999, near<=20min, far>20min
//   continuous_driving_time: short<30min, moderate 30-90min, long>=90min

function binDrowsiness(level: number): string {
  if (level < 20.0) {
    return 'none'
  }
  if (level < 40.0) {
    return 'weak'
  }
  if (level < 60.0) {
    return 'moderate'
  }
  if (level < 80.0) {
    return 'strong'
  }
  return 'severe'
}

function binFatigue(level: number): string {
  if (level < 30.0) {
    return 'low'
  }
  if (level < 60.0) {
    return 'medium'
  }
  return 'high'
}

function binSignalDuration(aboveWeakTicks: number): string {
  if (aboveWeakTicks <= 0) {
    return 'transient'
  }
  if (aboveWeakTicks === 1) {
    return 'brief'
  }
  if (aboveWeakTicks < 10) {
    return 'sustained'
  }
  return 'persistent'
}

function binRestSpotEta(nextRestMin: number): string {
  if (nextRestMin >= 9999.0) {
    return 'none'
  }
  if (nextRestMin <= 20.0) {
    return 'near'
  }
  return 'far'
}

function binContinuousDriving(minutes: number): string {
  if (minutes < 30.0) {
    return 'short'
  }
  if (minutes < 90.0) {
    return 'moderate'
  }
  return 'long'
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback
  }
  return Number(value)
}

/**
 * Derive {normalized, ordinal} feature groups from a tick raw_state dict.
 *
 * This is the single seam between simulator-internal numeric state and the
 * decision layer. Algorithms consume feature_groups; raw_state is available
 * for the evidence trace and weighted_score formula.
 */
export function buildFeatureGroups(rawState: Record<string, unknown>): Record<string, unknown> {
  const drowsiness = toNumber(rawState['drowsinessLevel'], 0.0)
  const fatigue = toNumber(rawState['fatigueLevel'], 0.0)
  const attention = toNumber(rawState['attentionLevel'], 100.0)
  const steering = toNumber(rawState['steeringInstabilityLevel'], 0.0)
  const pedal = toNumber(rawState['pedalAbnormalityLevel'], 0.0)
  const continuousMin = toNumber(rawState['continuousDrivingMin'], 0.0)
  const nextRestMin = toNumber(rawState['nextRestSpotMin'], 9999.0)
  const aboveWeak = Math.trunc(toNumber(rawState['drowsinessAboveWeakTicks'], 0))

  const ordinal = {
    drowsiness_level: binDrowsiness(drowsiness),
    fatigue_level: binFatigue(fatigue),
    signal_duration: binSignalDuration(aboveWeak),
    rest_spot_eta: binRestSpotEta(nextRestMin),
    continuous_driving_time: binContinuousDriving(continuousMin),
  }

  const normalized = {
    drowsiness_score: Math.min(1.0, Math.max(0.0, drowsiness / 100.0)),
    fatigue_score: Math.min(1.0, Math.max(0.0, fatigue / 100.0)),
    attention_score: Math.min(1.0, Math.max(0.0, attention / 100.0)),
    driving_anomaly_score: Math.min(1.0, Math.max(0.0, steering / 100.0)),
    pedal_anomaly_score: Math.min(1.0, Math.max(0.0, pedal / 100.0)),
  }

  return { normalized, ordinal }
}

/**
 * Convert a context dict to a fully-banded context.
 *
 * Band fields (strings) pass through unchanged. Raw measurement fields are
 * converted to ordinal bands and removed from the output. The returned
 * object contains only string values.
 */
export function binContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Pass through all non-raw (already-banded) fields.
  for (const [key, value] of Object.entries(ctx)) {
    if (!RAW_KEYS.has(key)) {
      result[key] = value
    }
  }

  // Convert raw fields when present.
  if ('travel_time_sec' in ctx) {
    result['continuous_driving_time'] = binDriveTime(ctx['travel_time_sec'] as number | null)
  }

  // remaining_to_destination_sec -> destination_eta (forward-compat; not
  // part of M1 decision context - drop after binning if caller wants).
  if ('remaining_to_destination_sec' in ctx) {
    const sec = ctx['remaining_to_destination_sec'] as number | null
    if (sec === null || sec === undefined) {
      result['destination_eta'] = 'medium'
    } else if (sec < 1200) {
      result['destination_eta'] = 'close'
    } else if (sec < 3600) {
      result['destination_eta'] = 'medium'
    } else {
      result['destination_eta'] = 'far'
    }
  }

  // rest_spot_metres -> rest_spot_eta; also handle absent key as "none".
  const metres = Object.prototype.hasOwnProperty.call(ctx, 'rest_spot_metres')
    ? (ctx['rest_spot_metres'] as number | null)
    : null
  if (Object.prototype.hasOwnProperty.call(ctx, 'rest_spot_metres') || !('rest_spot_eta' in result)) {
    // Only add rest_spot_eta from raw if a band wasn't already present.
    if (
      Object.prototype.hasOwnProperty.call(ctx, 'rest_spot_metres') &&
      !Object.prototype.hasOwnProperty.call(ctx, 'rest_spot_eta')
    ) {
      result['rest_spot_eta'] = binRestEta(metres)
    } else if (
      !Object.prototype.hasOwnProperty.call(ctx, 'rest_spot_metres') &&
      !('rest_spot_eta' in result)
    ) {
      // Neither raw nor banded rest_spot_eta given; default to "none".
      result['rest_spot_eta'] = 'none'
    }
  }

  return result
}
