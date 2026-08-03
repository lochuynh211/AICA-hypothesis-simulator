/**
 * Modal — reusable popup primitive for the Combined Simulator (020 Task 6,
 * design §7). Net-new: no modal/dialog/portal existed in this codebase
 * before this component.
 *
 * Renders via `ReactDOM.createPortal` to `document.body` so it always
 * escapes the 20:60:20 `.merged-shell` grid's `overflow:hidden` panels.
 * Closed (`open === false`) renders `null` — nothing is mounted, matching
 * the interface `Modal(...): JSX.Element | null`.
 *
 * Closing:
 *  - Escape key (global `keydown` listener while open)
 *  - Click on the backdrop (the dimmed area outside `.modal-card`)
 *  - Clicks inside the card do NOT close (stopPropagation on the card)
 *
 * Accessibility: `role="dialog"` + `aria-modal="true"` on the card, labelled
 * by the title; a simple focus trap keeps Tab/Shift+Tab cycling within the
 * card's focusable elements while open, and focus moves to the card (or its
 * first focusable descendant) on open.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const LABELS = {
  close: { ja: '閉じる', en: 'Close' },
}

export function Modal({
  open,
  title,
  onClose,
  children,
  size = 'default',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  /** 'wide' widens the card for editor popups that mount a full setup panel
   * (Combined Simulator reuses the Trigger/Proposal setup editors verbatim,
   * which need far more than the default 520px). Defaults to 'default'. */
  size?: 'default' | 'wide'
}): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const { lang } = useLanguage()

  useEffect(() => {
    if (!open) return

    // Focus the first focusable element in the card (falling back to the
    // card itself) as soon as it mounts, so keyboard users land inside it.
    const card = cardRef.current
    const focusables = card ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : []
    ;(focusables[0] ?? card)?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const current = cardRef.current
      if (!current) return
      const items = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="modal-backdrop"
      data-testid="modal-backdrop"
      onClick={onClose}
    >
      <div
        className={size === 'wide' ? 'modal-card modal-card--wide' : 'modal-card'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close"
            aria-label={t(LABELS.close, lang)}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export default Modal
