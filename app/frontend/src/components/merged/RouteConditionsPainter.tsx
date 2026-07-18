/**
 * RouteConditionsPainter — two dual-handle ("2-dot") range sliders over the
 * route's 0..total-km axis: Mountain `[start, end]` and Traffic-jam
 * `[start, end]` (feature 020, Slice-2b Task 4).
 *
 * A dual-handle slider is two overlaid `<input type="range">` elements (one
 * per handle) with min-gap clamping so `start` can never cross past `end`
 * (and vice versa) — there is no native two-thumb range input, so this is
 * the standard DOM workaround rather than a bespoke pointer-drag widget.
 * Each slider shows a position readout (`data-testid="*-readout"`) and a
 * distinct color band spanning the painted extent, purely for visual
 * feedback — the actual paint is applied server-side by
 * `POST /api/merged-runs/plan` (`buildMergedPlan`, Task 2/this task's
 * wiring in `MergedSetupPanel`), never computed here.
 *
 * `null` means "no range painted" (the field is left out of the
 * `buildMergedPlan` call entirely); the sliders still render so the
 * reviewer can start painting, defaulting their displayed span to `[0, 0]`
 * until moved.
 */
export type KmRange = [number, number]

const MIN_GAP_KM = 1

/** Clamps a `[start, end]` pair to `[0, totalKm]`, keeping at least
 * `MIN_GAP_KM` between the two handles. `changedIndex` identifies which
 * handle the user just dragged (0 = start, 1 = end); if closing the gap
 * would cross the OTHER handle, that other handle is pushed along by the
 * gap rather than clamping the one just moved — the usual dual-thumb-slider
 * behavior (dragging the lower thumb past the upper one carries the upper
 * thumb along, and vice versa) so a handle never "sticks" at its neighbor. */
function clampRange(range: KmRange, changedIndex: 0 | 1, totalKm: number): KmRange {
  const cap = totalKm > 0 ? totalKm : 0
  let [start, end] = range
  start = Math.min(Math.max(start, 0), cap)
  end = Math.min(Math.max(end, 0), cap)
  if (changedIndex === 0 && start > end - MIN_GAP_KM) {
    end = Math.min(cap, start + MIN_GAP_KM)
  }
  if (changedIndex === 1 && end < start + MIN_GAP_KM) {
    start = Math.max(0, end - MIN_GAP_KM)
  }
  return [start, end]
}

const trackStyle: React.CSSProperties = { position: 'relative', height: '22px', marginTop: '4px' }

const handleInputStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  margin: 0,
  background: 'transparent',
  pointerEvents: 'none',
}

function DualRangeSlider({
  label,
  testIdPrefix,
  totalKm,
  value,
  color,
  onChange,
}: {
  label: string
  testIdPrefix: string
  totalKm: number
  value: KmRange
  color: string
  onChange: (range: KmRange) => void
}) {
  const [start, end] = value
  const cap = totalKm > 0 ? totalKm : 0
  const pctStart = cap > 0 ? (start / cap) * 100 : 0
  const pctEnd = cap > 0 ? (end / cap) * 100 : 0

  return (
    <div style={{ marginTop: '10px' }} data-testid={`${testIdPrefix}-painter`}>
      <label style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        {label}
      </label>
      <p
        data-testid={`${testIdPrefix}-readout`}
        style={{ fontSize: '0.82em', margin: '2px 0', fontFamily: 'monospace' }}
      >
        {start.toFixed(1)}–{end.toFixed(1)} km
      </p>
      <div style={trackStyle}>
        <div
          data-testid={`${testIdPrefix}-band`}
          style={{
            position: 'absolute',
            top: '9px',
            left: `${pctStart}%`,
            width: `${Math.max(pctEnd - pctStart, 0)}%`,
            height: '4px',
            background: color,
            borderRadius: '2px',
            pointerEvents: 'none',
          }}
        />
        <input
          type="range"
          data-testid={`${testIdPrefix}-start`}
          aria-label={`${label} start`}
          min={0}
          max={cap}
          step={0.5}
          value={start}
          onChange={(e) => onChange(clampRange([Number(e.target.value), end], 0, cap))}
          style={{ ...handleInputStyle, pointerEvents: 'auto' }}
        />
        <input
          type="range"
          data-testid={`${testIdPrefix}-end`}
          aria-label={`${label} end`}
          min={0}
          max={cap}
          step={0.5}
          value={end}
          onChange={(e) => onChange(clampRange([start, Number(e.target.value)], 1, cap))}
          style={{ ...handleInputStyle, pointerEvents: 'auto' }}
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
  return (
    <div data-testid="route-conditions-painter">
      <DualRangeSlider
        label="Mountain range"
        testIdPrefix="mountain-range"
        totalKm={totalKm}
        value={mountainRange ?? [0, 0]}
        color="#a0785a"
        onChange={onMountainRangeChange}
      />
      <DualRangeSlider
        label="Traffic-jam range"
        testIdPrefix="jam-range"
        totalKm={totalKm}
        value={jamRange ?? [0, 0]}
        color="#d97706"
        onChange={onJamRangeChange}
      />
    </div>
  )
}
