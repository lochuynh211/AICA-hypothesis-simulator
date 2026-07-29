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
    // The legend names each series by the PURPOSE the specification assigns
    // its proposal class (CDC-SU_specplan Slide 35), not by the internal
    // score name.
    expect(legend).toHaveTextContent('危険運転防止スコア')
    expect(legend).toHaveTextContent('漫然運転予防スコア')
    expect(legend).toHaveTextContent('発火しきい値')
    expect(legend).toHaveTextContent('高速道路') // highway road band
    expect(legend).toHaveTextContent('選択した休憩場所')
    // No English leaked into the JA legend.
    expect(legend).not.toHaveTextContent('Dangerous-driving-prevention score')
    expect(legend).not.toHaveTextContent('highway')
  })

  it('renders English legend labels when lang=en (default behavior preserved)', () => {
    render(<ScoreTimeline data={data} showLegend lang="en" testIds={{ legend: 'lg-en' }} />)
    const legend = screen.getByTestId('lg-en')
    expect(legend).toHaveTextContent('Dangerous-driving-prevention score')
    expect(legend).toHaveTextContent('highway')
  })
})
