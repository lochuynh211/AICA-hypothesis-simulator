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

  it('keeps the animated subtree a SIBLING of the proposal subtree', () => {
    // Structural guarantee: a playback tick must not re-render the proposal
    // cards, or an expanded contribution chain collapses mid-run.
    mount()
    const playback = screen.getByTestId('merged-playback-subtree')
    const proposals = screen.getByTestId('merged-proposal-panel')
    expect(playback.contains(proposals)).toBe(false)
    expect(proposals.contains(playback)).toBe(false)
  })

  it('renders the Japanese-default case picker label and the empty checkpoint rail entirely in Japanese', () => {
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
    // No case/run exists yet, so the checkpoint rail is empty — its message
    // must be pure Japanese, with no stray English word (e.g. "min") mixed in.
    const emptyRail = screen.getByTestId('checkpoint-rail-empty')
    expect(emptyRail.textContent).toBe(
      'この実行ではレビュー可能な決定ポイントが生成されませんでした。',
    )
    expect(emptyRail.textContent).not.toMatch(/[a-zA-Z]/)
  })
})
