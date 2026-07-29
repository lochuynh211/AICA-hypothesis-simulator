// app/frontend/tests/score_timeline.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import ScoreTimeline from '../src/components/playback/ScoreTimeline'
import type { TimelineData } from '../src/components/playback/timelineData'

const data: TimelineData = {
  segments: [
    { fromX: 0, toX: 0.5, type: 'highway' },
    { fromX: 0.5, toX: 1, type: 'mountain_road' },
  ],
  restScore: [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.9 },
  ],
  monotonyScore: [],
  restThreshold: 0.6,
  monotonyThreshold: null,
  spikes: [0.5],
  fires: [{ x: 0.5, kind: 'rest' }],
  restDots: [0.75],
  recoveryWindows: [],
  completionX: 1,
}

const TID = {
  root: 'route-timeline',
  playhead: 'car-marker',
  fire: 'fire-marker',
  restDot: 'progress-rest-spot-marker',
  curve: 'ttl-curve',
  segment: (i: number) => `ttl-seg-${i}`,
}

describe('ScoreTimeline', () => {
  it('renders the container + curve + segments', () => {
    render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.getByTestId('route-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-curve')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-seg-0')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-seg-1')).toBeInTheDocument()
  })

  it('shows a playhead with the exact aria-label only when showPlayhead', () => {
    const { rerender } = render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.queryByTestId('car-marker')).not.toBeInTheDocument()
    rerender(
      <ScoreTimeline data={data} testIds={TID} showPlayhead revealFraction={0.3} playheadAriaLabel="Route position: 30%" />,
    )
    expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 30%')
  })

  it('applies a reveal clip whose width tracks revealFraction', () => {
    const { container } = render(<ScoreTimeline data={data} testIds={TID} revealFraction={0.5} />)
    const clipRect = container.querySelector('clipPath rect') as SVGRectElement | null
    expect(clipRect).not.toBeNull()
    // width attr is revealFraction * viewBox width (fallback width 760 → 380)
    expect(Number(clipRect!.getAttribute('width'))).toBeCloseTo(380, 0)
  })

  it('renders fire lines and rest dots from the data', () => {
    render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.getByTestId('fire-marker')).toBeInTheDocument()
    expect(screen.getByTestId('progress-rest-spot-marker')).toBeInTheDocument()
  })

  it('renders a threshold value label inside the threshold testid element when thresholdLabel is given', () => {
    render(
      <ScoreTimeline
        data={data}
        testIds={{ ...TID, threshold: 'ttl-threshold' }}
        thresholdLabel="threshold 0.6"
      />,
    )
    const thresholdEl = screen.getByTestId('ttl-threshold')
    expect(thresholdEl.textContent).toContain('threshold 0.6')
    expect(thresholdEl.querySelector('line')).not.toBeNull()
  })

  it('threshold testid element has empty textContent when no thresholdLabel is passed (Review timeline case)', () => {
    render(<ScoreTimeline data={data} testIds={{ ...TID, threshold: 'ttl-threshold' }} />)
    const thresholdEl = screen.getByTestId('ttl-threshold')
    expect(thresholdEl.textContent).toBe('')
    expect(thresholdEl.querySelector('line')).not.toBeNull()
  })

  it('renders a monotony threshold label when monotonyThresholdLabel is given', () => {
    const withMonotony: TimelineData = { ...data, monotonyThreshold: 0.5 }
    render(
      <ScoreTimeline
        data={withMonotony}
        testIds={{ ...TID, monotonyThreshold: 'ttl-mono-threshold' }}
        monotonyThresholdLabel="monotony 0.5"
      />,
    )
    expect(screen.getByTestId('ttl-mono-threshold').textContent).toContain('monotony 0.5')
  })

  it('renders one thin line per restDots entry inside restOptionGroup when testIds.restOptionGroup is set', () => {
    render(<ScoreTimeline data={data} testIds={{ ...TID, restOptionGroup: 'ttl-rest-option-group' }} />)
    const group = screen.getByTestId('ttl-rest-option-group')
    expect(group).toBeInTheDocument()
    expect(group.querySelectorAll('line')).toHaveLength(data.restDots.length)
  })

  it('does NOT render a rest-option group when testIds.restOptionGroup is unset (Review timeline unaffected)', () => {
    render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.queryByTestId('ttl-rest-option-group')).not.toBeInTheDocument()
  })

  it('applies restDotAriaLabel to each rest-dot when provided, and none when omitted', () => {
    const { rerender } = render(
      <ScoreTimeline data={data} testIds={TID} restDotAriaLabel="Chosen rest spot" />,
    )
    expect(screen.getByTestId('progress-rest-spot-marker')).toHaveAttribute('aria-label', 'Chosen rest spot')

    rerender(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.getByTestId('progress-rest-spot-marker')).not.toHaveAttribute('aria-label')
  })

  it('gives each mounted instance a unique clipPath id', () => {
    const { container } = render(
      <>
        <ScoreTimeline data={data} testIds={TID} />
        <ScoreTimeline data={data} testIds={TID} />
      </>,
    )
    const clipPaths = container.querySelectorAll('clipPath')
    expect(clipPaths.length).toBe(2)
    const [id1, id2] = Array.from(clipPaths).map((el) => el.getAttribute('id'))
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })

  it('draws the threshold and rest dots FORWARD (outside the reveal-clipped group), while the curve stays inside it', () => {
    const { container } = render(
      <ScoreTimeline data={data} testIds={{ ...TID, threshold: 'ttl-threshold' }} revealFraction={0.5} />,
    )
    // With ghostAhead off there is exactly one reveal-clipped group: the decisions group.
    const clipGroup = container.querySelector('g[clip-path]') as SVGGElement | null
    expect(clipGroup).not.toBeNull()
    // The progressive curve is clipped (reveals over time)…
    expect(clipGroup!.querySelector('[data-testid="ttl-curve"]')).not.toBeNull()
    // …but the threshold and the chosen-rest dot are NOT clipped (drawn forward/immediately).
    expect(clipGroup!.querySelector('[data-testid="ttl-threshold"]')).toBeNull()
    expect(clipGroup!.querySelector('[data-testid="progress-rest-spot-marker"]')).toBeNull()
    // They still exist in the tree.
    expect(screen.getByTestId('ttl-threshold')).toBeInTheDocument()
    expect(screen.getByTestId('progress-rest-spot-marker')).toBeInTheDocument()
  })

  it('ghostAhead renders a blurred base road layer plus a crisp reveal-clipped layer', () => {
    const { container } = render(
      <ScoreTimeline data={data} testIds={TID} ghostAhead revealFraction={0.5} />,
    )
    // A blur filter is defined and applied to the "ahead" base layer.
    expect(container.querySelector('filter feGaussianBlur')).not.toBeNull()
    const blurLayer = container.querySelector('g[filter]') as SVGGElement | null
    expect(blurLayer).not.toBeNull()
    expect(blurLayer!.querySelectorAll('rect').length).toBe(data.segments.length)
    // The crisp segment rects (with testids) render exactly once — no duplicate testids.
    expect(screen.getAllByTestId('ttl-seg-0')).toHaveLength(1)
  })

  it('colors urban green and highway cyan (matching the map), and draws no band or legend entry for start/end', () => {
    const roads: TimelineData = {
      ...data,
      segments: [
        { fromX: 0, toX: 0.1, type: 'start' },
        { fromX: 0.1, toX: 0.5, type: 'urban' },
        { fromX: 0.5, toX: 0.9, type: 'highway' },
        { fromX: 0.9, toX: 1, type: 'end' },
      ],
    }
    const { container } = render(
      <ScoreTimeline data={roads} testIds={{ ...TID, legend: 'ttl-legend' }} showLegend />,
    )
    const fills = Array.from(container.querySelectorAll('rect'))
      .map((r) => r.getAttribute('fill'))
    // urban green + highway cyan present; the pale-blue urban (#dbeafe) is gone.
    expect(fills).toContain('#22c55e') // urban → green
    expect(fills).toContain('#06b6d4') // highway → cyan
    expect(fills).not.toContain('#dbeafe')
    // start/end draw no distinct grey band (#e5e7eb).
    expect(fills).not.toContain('#e5e7eb')
    // Legend names the roads present but not the start/end endpoints.
    const legend = screen.getByTestId('ttl-legend').textContent ?? ''
    expect(legend).toContain('urban')
    expect(legend).toContain('highway')
    expect(legend).not.toContain('start')
    expect(legend).not.toContain('end')
  })

  it('renders a legend explaining the score/road colors only when showLegend is set', () => {
    const withMonotony: TimelineData = {
      ...data,
      monotonyScore: [{ x: 0, y: 0.2 }, { x: 1, y: 0.4 }],
    }
    const { rerender } = render(
      <ScoreTimeline data={withMonotony} testIds={{ ...TID, legend: 'ttl-legend' }} showLegend />,
    )
    const legend = screen.getByTestId('ttl-legend')
    expect(legend.textContent).toContain('Dangerous-driving-prevention score')
    expect(legend.textContent).toContain('Inattentive-driving-prevention score')
    expect(legend.textContent).toContain('Firing threshold')
    expect(legend.textContent).toContain('highway')
    expect(legend.textContent).toContain('chosen rest location')

    // Off by default (Setup strip owns its own legend, so ScoreTimeline must not add one).
    rerender(<ScoreTimeline data={withMonotony} testIds={{ ...TID, legend: 'ttl-legend' }} />)
    expect(screen.queryByTestId('ttl-legend')).not.toBeInTheDocument()
  })

  it('draws a thin traffic-jam sub-bar + legend entry only when trafficJams are present (feature 020)', () => {
    const withJam: TimelineData = {
      ...data,
      trafficJams: [{ fromX: 0.1, toX: 0.3 }],
    }
    const { rerender } = render(
      <ScoreTimeline data={withJam} testIds={{ ...TID, jamGroup: 'ttl-jams', legend: 'ttl-legend' }} showLegend />,
    )
    const jams = screen.getByTestId('ttl-jams')
    expect(jams.querySelectorAll('rect')).toHaveLength(1)
    expect(screen.getByTestId('ttl-legend').textContent).toContain('traffic jam')

    // No jam painted → no sub-bar group and no legend entry.
    const noJam: TimelineData = { ...data, trafficJams: [] }
    rerender(<ScoreTimeline data={noJam} testIds={{ ...TID, jamGroup: 'ttl-jams', legend: 'ttl-legend' }} showLegend />)
    expect(screen.queryByTestId('ttl-jams')).not.toBeInTheDocument()
    expect(screen.getByTestId('ttl-legend').textContent).not.toContain('traffic jam')
  })
})
