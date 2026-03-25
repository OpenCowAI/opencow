// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': 'alert-icon', ...props }),
}))

import { ConfirmDialog } from '../../../src/renderer/components/ui/confirm-dialog'

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    title: 'Delete Command',
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders title and message', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByText('Delete Command')).toBeInTheDocument()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
  })

  it('returns null when open=false', () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onConfirm on confirm button click', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} confirmLabel="Delete" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel on cancel button click', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders detail text when provided', () => {
    render(<ConfirmDialog {...baseProps} detail="~/.claude/.trash/" />)
    expect(screen.getByText(/\.trash/)).toBeInTheDocument()
  })

  it('has role=alertdialog with aria-label', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-label', 'Delete Command')
  })

  it('uses destructive styling by default', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByRole('button', { name: /confirm/i }).className).toContain('red')
  })
})
