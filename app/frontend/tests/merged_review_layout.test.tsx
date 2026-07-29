import { render, screen, fireEvent, within } from '@testing-library/react'
import MergedShell from '../src/components/merged/MergedShell'
import { LanguageProvider } from '../src/state/language'

const mount = () => render(<LanguageProvider><MergedShell /></LanguageProvider>)

describe('Combined review layout', () => {
  it('keeps the three-panel shell', () => {
    mount()
    expect(screen.getByTestId('merged-shell')).toBeTruthy()
  })

  it('puts the case picker and the setup panel in the left column', () => {
    mount()
    const left = screen.getByTestId('merged-shell').querySelector('.left-panel')!
    expect(within(left as HTMLElement).getByTestId('experience-case-picker')).toBeTruthy()
    expect(within(left as HTMLElement).getByTestId('merged-setup-panel')).toBeTruthy()
  })

  it('moves the proposal output into the centre column', () => {
    mount()
    const centre = screen.getByTestId('merged-shell').querySelector('.center-panel')!
    expect(within(centre as HTMLElement).getByTestId('merged-proposal-panel')).toBeTruthy()
  })

  it('puts the review column on the right', () => {
    mount()
    const right = screen.getByTestId('merged-shell').querySelector('.right-panel')!
    expect(within(right as HTMLElement).getByTestId('review-column')).toBeTruthy()
  })

  it('drops the log panel from the review layout', () => {
    mount()
    expect(screen.queryByTestId('merged-log-panel')).toBeNull()
  })

  it('still renders the Runs screen when the view toggle switches to it', () => {
    // NOT a guarantee that the log is reachable there — MergedLogPanel is no
    // longer imported by MergedRunsScreen or MergedReplayViewer (the log is
    // genuinely unreachable from the UI now); this only asserts the Runs
    // screen itself still mounts.
    mount()
    fireEvent.click(screen.getByTestId('merged-view-runs'))
    expect(screen.getByTestId('merged-runs-screen')).toBeTruthy()
  })

  it('gives the middle column exactly ONE scroll container', () => {
    // The grid cell `.center-panel` owns the scrolling. The inner panel used
    // to set `height: 100%` + `overflow-y: auto` as well, so the column had
    // two nested scrollers and the map read as sitting on top of the
    // proposals rather than above them.
    mount()
    const inner = screen.getByTestId('merged-center-panel')
    expect(inner.style.overflowY).not.toBe('auto')
    expect(inner.style.overflowY).not.toBe('scroll')
    expect(inner.style.height).not.toBe('100%')
  })

  it('keeps the map a fixed band so it cannot overflow onto the proposals', () => {
    mount()
    const mapBox = screen.getByTestId('merged-map-surface')
    // `flex: 1 1 auto` let the map grow and its 52vh child overflow the box.
    expect(mapBox.style.flex).toBe('0 0 auto')
    expect(mapBox.style.overflow).toBe('hidden')
  })

  it('keeps the animated subtree a SIBLING of the proposal subtree', () => {
    // Structural guarantee: a playback tick must not re-render the proposal
    // cards, or an expanded contribution chain collapses mid-run.
    mount()
    const playback = screen.getByTestId('merged-playback-subtree')
    const proposals = screen.getByTestId('merged-proposal-panel')
    expect(playback.contains(proposals)).toBe(false)
    expect(proposals.contains(playback)).toBe(false)
  })

  it('renders the Japanese-default case picker label and the idle status line entirely in Japanese', () => {
    // Regression for the earlier bug where English text leaked inside a
    // Japanese sentence — every other test here runs in the LanguageProvider's
    // JA default too, but this one asserts it explicitly with
    // initialLanguage="ja" and checks actual JA strings, not just presence.
    render(
      <LanguageProvider initialLanguage="ja">
        <MergedShell />
      </LanguageProvider>,
    )
    expect(screen.getByText('体験テストケース')).toBeTruthy()
    // No case/run exists yet, so the status line shows its idle message — pure
    // Japanese, with no stray English word (e.g. "min") mixed in.
    const status = screen.getByTestId('playback-status-text')
    expect(status.textContent).toBe(
      '実行またはクイックビューを開始すると、ここに状況が表示されます。',
    )
    expect(status.textContent).not.toMatch(/[a-zA-Z]/)
  })

  it('puts a READ-ONLY status line between the map and the proposals', () => {
    // It replaced the checkpoint rail + decision band: one line, no controls.
    mount()
    expect(screen.getByTestId('playback-status-line')).toBeTruthy()
    expect(screen.queryByTestId('checkpoint-rail')).toBeNull()
    expect(screen.queryByTestId('decision-band')).toBeNull()

    const line = screen.getByTestId('playback-status-line')
    expect(line.querySelectorAll('button, a, input, select')).toHaveLength(0)
  })
})
