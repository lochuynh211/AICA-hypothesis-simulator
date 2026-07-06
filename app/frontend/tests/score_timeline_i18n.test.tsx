/**
 * i18n regression: the shared ScoreTimeline legend (used by BOTH the setup
 * preview strip and the review progress bar) must localize to Japanese, not
 * render English-only. Guards the fix for the "preview + progress bar show
 * English only" bug.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ScoreTimeline from '../src/components/playback/ScoreTimeline'
import type { TimelineData } from '../src/components/playback/timelineData'

const data: TimelineData = {
  segments: [{ fromX: 0, toX: 1, type: 'highway' }],
  restScore: [{ x: 0, y: 0.2 }, { x: 1, y: 0.6 }],
  monotonyScore: [{ x: 0, y: 0.1 }, { x: 1, y: 0.3 }],
  restThreshold: 0.5,
  monotonyThreshold: 0.6,
  spikes: [],
  fires: [],
  restDots: [0.5],
  recoveryWindows: [],
  completionX: null,
}

describe('ScoreTimeline legend i18n', () => {
  it('renders Japanese legend labels when lang=ja', () => {
    render(<ScoreTimeline data={data} showLegend lang="ja" testIds={{ legend: 'lg-ja' }} />)
    const legend = screen.getByTestId('lg-ja')
    expect(legend).toHaveTextContent('休憩提案スコア') // rest-propose score
    expect(legend).toHaveTextContent('単調性スコア') // monotony score
    expect(legend).toHaveTextContent('しきい値') // threshold
    expect(legend).toHaveTextContent('高速道路') // highway road band
    expect(legend).toHaveTextContent('選択した休憩地点') // chosen rest spot
    // No English leaked into the JA legend.
    expect(legend).not.toHaveTextContent('rest-propose score')
    expect(legend).not.toHaveTextContent('highway')
  })

  it('renders English legend labels when lang=en (default behavior preserved)', () => {
    render(<ScoreTimeline data={data} showLegend lang="en" testIds={{ legend: 'lg-en' }} />)
    const legend = screen.getByTestId('lg-en')
    expect(legend).toHaveTextContent('rest-propose score')
    expect(legend).toHaveTextContent('highway')
  })
})
