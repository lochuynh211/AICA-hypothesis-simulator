/**
 * ErrorNotice — T014 unit tests (RED phase — must fail until component exists).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import ErrorNotice from '../src/components/common/ErrorNotice'

describe('ErrorNotice — T014', () => {
  it('renders with role="alert"', () => {
    render(<ErrorNotice testid="test-error" message="Something went wrong" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders the message prop', () => {
    render(<ErrorNotice testid="test-error" message="Test error message" />)
    expect(screen.getByText('Test error message')).toBeInTheDocument()
  })

  it('shows dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn()
    render(<ErrorNotice testid="test-error" message="Dismissable error" onDismiss={onDismiss} />)
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  it('calling dismiss button calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(<ErrorNotice testid="test-error" message="Dismissable error" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
