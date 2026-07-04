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
})
