// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => React.createElement('svg', { ...props, 'data-testid': 'plus-icon' }),
  Trash2: (props: Record<string, unknown>) => React.createElement('svg', { ...props, 'data-testid': 'trash-icon' }),
}))

import { MCPServerForm } from '../../../../src/renderer/components/DetailPanel/forms/MCPServerForm'

describe('MCPServerForm', () => {
  it('renders name, type, command fields in create mode', () => {
    render(<MCPServerForm mode={{ type: 'create' }} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^command$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument()
  })

  it('validates name on save', () => {
    const onSave = vi.fn()
    render(<MCPServerForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('validates command on save', () => {
    const onSave = vi.fn()
    render(<MCPServerForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'srv' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with valid data', () => {
    const onSave = vi.fn()
    render(<MCPServerForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'srv' } })
    fireEvent.change(screen.getByLabelText(/^command$/i), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'srv', command: 'npx', type: 'stdio' }))
  })
})
