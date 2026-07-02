/**
 * Ordinal-band → bar visualization helper.
 *
 * Driver/feature signals reach the UI as qualitative band strings (the
 * boundary-binned discipline — no raw numbers drive triggers). This maps a band
 * token to a display-only fill width + colour so drowsiness/fatigue can render
 * as a coloured bar without inventing a numeric value.
 *
 * Unknown tokens fall back to a neutral mid bar, so a new band vocabulary never
 * renders as empty or crashes.
 */
export type BandViz = { pct: number; color: string }

const GREEN = '#10b981'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const GRAY = '#9ca3af'

export function bandViz(band: string | null | undefined): BandViz {
  if (band == null || band === '') return { pct: 0, color: GRAY }
  switch (band.toLowerCase()) {
    case 'none':
      return { pct: 8, color: GREEN }
    case 'low':
    case 'weak':
    case 'mild':
      return { pct: 25, color: GREEN }
    case 'medium':
    case 'moderate':
      return { pct: 50, color: AMBER }
    case 'high':
    case 'strong':
      return { pct: 75, color: RED }
    case 'severe':
    case 'critical':
      return { pct: 95, color: RED }
    default:
      return { pct: 45, color: GRAY }
  }
}
