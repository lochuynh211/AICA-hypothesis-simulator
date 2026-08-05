/**
 * Format a duration in minutes as localized hours+minutes.
 *   320 → "5h 20m" / "5時間20分"; 300 → "5h" / "5時間"; 20 → "20m" / "20分";
 *   0 → "0m" / "0分". Rounds to whole minutes. null/undefined/NaN/negative → "—".
 *
 * Display-only (no bearing on any decision) — the Combined screen shows this
 * for the projected route duration and per-event arrive-in times.
 */
export function formatDuration(min: number | null | undefined, lang: 'ja' | 'en'): string {
  if (min == null || Number.isNaN(min) || min < 0) return '—'
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = total % 60
  const hUnit = lang === 'ja' ? '時間' : 'h'
  const mUnit = lang === 'ja' ? '分' : 'm'
  const sep = lang === 'ja' ? '' : ' '
  if (h === 0) return `${m}${mUnit}`
  if (m === 0) return `${h}${hUnit}`
  return `${h}${hUnit}${sep}${m}${mUnit}`
}
