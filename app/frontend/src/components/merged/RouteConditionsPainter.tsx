/**
 * RouteConditionsPainter — two dual-handle ("2-dot") range sliders over the
 * route's 0..total-km axis: Mountain `[start, end]` and Traffic-jam
 * `[start, end]` (feature 020, Slice-2b Task 4).
 *
 * A dual-handle slider is two overlaid `<input type="range">` elements (one
 * per handle) with min-gap clamping so `start` can never cross past `end`
 * (and vice versa) — there is no native two-thumb range input, so this is
 * the standard DOM workaround rather than a bespoke pointer-drag widget.
 * Each slider snaps to 5 km steps (`STEP_KM`), shows a position readout
 * (`data-testid="*-readout"`) and a distinct color band + matching thumbs, so
 * the reviewer can tell the two ranges apart at a glance. The actual paint is
 * applied server-side by `POST /api/merged-runs/plan` — never computed here.
 *
 * `null` means "no range painted" (the field is left out of the
 * `buildMergedPlan` call entirely); the sliders still render defaulting their
 * displayed span to `[0, 0]` until moved.
 */
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'

const LABELS = {
  mountain: { ja: '山道', en: 'Mountain road' },
  jam: { ja: '渋滞', en: 'Traffic jam' },
  rangeStart: { ja: '開始', en: 'start' },
  rangeEnd: { ja: '終了', en: 'end' },
}

export type KmRange = [number, number]

/** Coarse, easy-to-grab granularity — a 5 km step (owner request); the min gap
 * matches it so the two handles never sit closer than one step. */
const STEP_KM = 5
const MIN_GAP_KM = STEP_KM

/** Snap a raw slider value to the nearest STEP_KM, clamped to [0, cap]. */
function snap(value: number, cap: number): number {
  return Math.min(Math.max(Math.round(value / STEP_KM) * STEP_KM, 0), cap)
}

/** Clamps a `[start, end]` pair to `[0, totalKm]` (snapped to STEP_KM), keeping
 * at least `MIN_GAP_KM` between the handles; dragging one handle past the other
 * carries the other along, the usual dual-thumb behavior. */
function clampRange(range: KmRange, changedIndex: 0 | 1, totalKm: number): KmRange {
  const cap = totalKm > 0 ? totalKm : 0
  let start = snap(range[0], cap)
  let end = snap(range[1], cap)
  if (changedIndex === 0 && start > end - MIN_GAP_KM) {
    end = Math.min(cap, start + MIN_GAP_KM)
  }
  if (changedIndex === 1 && end < start + MIN_GAP_KM) {
    start = Math.max(0, end - MIN_GAP_KM)
  }
  return [start, end]
}

function DualRangeSlider({
  label,
  testIdPrefix,
  variant,
  totalKm,
  value,
  color,
  onChange,
  lang,
}: {
  label: string
  testIdPrefix: string
  /** Drives the per-range thumb color class (see `.dual-range--*` in app.css). */
  variant: 'mountain' | 'jam'
  totalKm: number
  value: KmRange
  color: string
  onChange: (range: KmRange) => void
  lang: 'ja' | 'en'
}) {
  const [start, end] = value
  const cap = totalKm > 0 ? totalKm : 0
  const pctStart = cap > 0 ? (start / cap) * 100 : 0
  const pctEnd = cap > 0 ? (end / cap) * 100 : 0

  return (
    <div style={{ marginTop: '12px' }} data-testid={`${testIdPrefix}-painter`}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <label style={{ fontSize: '0.8em', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: color }} />
          {label}
        </label>
        <span
          data-testid={`${testIdPrefix}-readout`}
          style={{ fontSize: '0.8em', fontFamily: 'monospace', color: '#334155' }}
        >
          {Math.round(start)}–{Math.round(end)} km
        </span>
      </div>
      <div className={`dual-range dual-range--${variant}`}>
        <div
          data-testid={`${testIdPrefix}-band`}
          className="dual-range-fill"
          style={{ left: `${pctStart}%`, width: `${Math.max(pctEnd - pctStart, 0)}%`, background: color }}
        />
        {/* Two overlaid range inputs; pointer-events live only on the thumbs
            (see .dual-range in app.css) so BOTH handles are independently
            draggable. */}
        <input
          className="range-start"
          type="range"
          data-testid={`${testIdPrefix}-start`}
          aria-label={`${label} ${t(LABELS.rangeStart, lang)}`}
          min={0}
          max={cap}
          step={STEP_KM}
          value={start}
          onChange={(e) => onChange(clampRange([Number(e.target.value), end], 0, cap))}
        />
        <input
          className="range-end"
          type="range"
          data-testid={`${testIdPrefix}-end`}
          aria-label={`${label} ${t(LABELS.rangeEnd, lang)}`}
          min={0}
          max={cap}
          step={STEP_KM}
          value={end}
          onChange={(e) => onChange(clampRange([start, Number(e.target.value)], 1, cap))}
        />
      </div>
    </div>
  )
}

export default function RouteConditionsPainter({
  totalKm,
  mountainRange,
  onMountainRangeChange,
  jamRange,
  onJamRangeChange,
}: {
  /** Route's total distance in km — the 0..totalKm axis both sliders span. */
  totalKm: number
  mountainRange: KmRange | null
  onMountainRangeChange: (range: KmRange) => void
  jamRange: KmRange | null
  onJamRangeChange: (range: KmRange) => void
}) {
  const { lang } = useLanguage()
  return (
    <div data-testid="route-conditions-painter">
      <DualRangeSlider
        label={t(LABELS.mountain, lang)}
        testIdPrefix="mountain-range"
        variant="mountain"
        totalKm={totalKm}
        value={mountainRange ?? [0, 0]}
        color="#16a34a"
        onChange={onMountainRangeChange}
        lang={lang}
      />
      <DualRangeSlider
        label={t(LABELS.jam, lang)}
        testIdPrefix="jam-range"
        variant="jam"
        totalKm={totalKm}
        value={jamRange ?? [0, 0]}
        color="#dc2626"
        onChange={onJamRangeChange}
        lang={lang}
      />
    </div>
  )
}
