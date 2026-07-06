/**
 * signalUsage (feature 009 UX) — decides which SignalsPanel rows a given package
 * actually consumes, so the left panel can dim the signals a package ignores.
 *
 * "Used by a package" is the union of two sources, because a formulation template
 * may reference a *computed feature* (e.g. `driving_anomaly`) without exposing its
 * raw source signal (`anomaly_rate`):
 *
 *   1. Direct links — raw signals the package's formulation template names
 *      outright (via {@link templateLinkKeys}); e.g. Hybrid links `childPassenger`.
 *   2. Feature-fed — raw signals that feed a computed feature the package declares
 *      in its manifest `features[]`, via {@link SIGNAL_FEATURE_MAP} below.
 *
 * Concretely: the Compact Hybrid consumes all 11 signals (dims nothing); NRI has
 * no `env_load` feature and never links `weatherRisk`, so `weatherRisk` dims.
 */

import type { FeatureDef } from '../../api/types'
import { getFormulationTemplate, templateLinkKeys } from './formulationTemplates'

/** The `signal-row-*` keys rendered by SignalsPanel, in no particular order. */
export const SIGNAL_ROW_KEYS = [
  'isNight',
  'familiarRoute',
  'childPassenger',
  'weatherRisk',
  'continuousDrivingMin',
  'segmentType',
  'isTrafficJam',
  'nextRestSpotMin',
  'drowsiness',
  'fatigue',
  'anomaly_rate',
] as const

export type SignalRowKey = (typeof SIGNAL_ROW_KEYS)[number]

/**
 * Raw signal → the computed feature key(s) it contributes to. Derived from the
 * Compact Hybrid's formula (the complete derivation; see formulationTemplates
 * HYBRID_TEMPLATE) plus NRI's feature-specific inputs (traffic_jam, long_highway,
 * attention_drop). A signal with no entry (e.g. `childPassenger`, which acts via
 * a hyperparameter bonus rather than a declared feature) is covered by the
 * direct-link source instead.
 */
export const SIGNAL_FEATURE_MAP: Record<SignalRowKey, string[]> = {
  isNight: ['env_load', 'monotony'],
  weatherRisk: ['env_load'],
  familiarRoute: ['familiar_route'],
  childPassenger: [],
  continuousDrivingMin: ['driving_time'],
  segmentType: ['monotony', 'long_highway'],
  isTrafficJam: ['env_load', 'traffic_jam'],
  nextRestSpotMin: ['rest_window', 'rest_scarcity'],
  drowsiness: ['drowsiness'],
  fatigue: ['fatigue'],
  anomaly_rate: ['driving_anomaly', 'attention_drop'],
}

/**
 * The set of signal-row keys the given package consumes.
 *
 * @param packageId  selected package id, or null when none is chosen yet.
 * @param features   the package manifest's `features[]` (empty when unknown).
 *
 * Returns ALL signals when no package is selected (nothing to dim) — the caller
 * treats a full set as "dim nothing".
 */
export function usedSignalKeys(
  packageId: string | null,
  features: FeatureDef[] | undefined,
): Set<SignalRowKey> {
  if (!packageId) return new Set(SIGNAL_ROW_KEYS)

  const featureKeys = new Set((features ?? []).map((f) => f.key))
  const template = getFormulationTemplate(packageId)
  const linked = template ? templateLinkKeys(template) : new Set<string>()

  const used = new Set<SignalRowKey>()
  for (const key of SIGNAL_ROW_KEYS) {
    if (linked.has(key)) {
      used.add(key)
      continue
    }
    const feeds = SIGNAL_FEATURE_MAP[key] ?? []
    if (feeds.some((f) => featureKeys.has(f))) used.add(key)
  }
  return used
}
