/**
 * useSmoothFraction — display-only easing of a 0–1 route fraction.
 *
 * The backend advances the car in discrete tick jumps; this hook eases a
 * *displayed* fraction toward the latest target every animation frame so the
 * car glides instead of teleporting. It is purely visual: it only sets local
 * React state and NEVER writes to the run store (FR-016 display-only animation).
 *
 * - Initializes at the first target (no opening sweep from 0).
 * - On each target change, animates from the current displayed value.
 * - Cleans up its rAF on unmount / target change.
 */
import { useEffect, useRef, useState } from 'react'

export function useSmoothFraction(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Cancel any in-flight animation toward the previous target.
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)

    const from = shownRef.current
    const to = target
    if (Math.abs(to - from) < 0.0005) {
      shownRef.current = to
      setShown(to)
      return
    }

    // Ease toward the target at a fixed fraction per frame (no time dependency,
    // so it stays deterministic under fake timers in tests).
    const step = () => {
      const cur = shownRef.current
      const next = cur + (to - cur) * 0.18
      if (Math.abs(to - next) < 0.0005) {
        shownRef.current = to
        setShown(to)
        rafRef.current = null
        return
      }
      shownRef.current = next
      setShown(next)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target])

  return shown
}
