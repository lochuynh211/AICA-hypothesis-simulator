/**
 * Modal (020 Task 6) — the net-new reusable popup primitive for the Combined
 * Simulator (design §7). Portal-rendered to document.body; Escape and
 * backdrop-click both close it; role="dialog" aria-modal="true".
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Modal } from '../src/components/merged/Modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} title="Hidden" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('shows title and children when open, via a portal to document.body', () => {
    render(
      <Modal open title="Select service" onClose={vi.fn()}>
        <p>modal body</p>
      </Modal>,
    )
    expect(screen.getByText('Select service')).toBeInTheDocument()
    expect(screen.getByText('modal body')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Portal check: the dialog is a direct-ish descendant of document.body,
    // not nested inside the test's render container.
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="T" onClose={onClose}>
        <p>body</p>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="T" onClose={onClose}>
        <p>body</p>
      </Modal>,
    )
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the card', () => {
    const onClose = vi.fn()
    render(
      <Modal open title="T" onClose={onClose}>
        <p>body content</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText('body content'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
