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

import { HookForm } from '../../../../src/renderer/components/DetailPanel/forms/HookForm'

describe('HookForm', () => {
  it('renders event name select and rule fields', () => {
    render(<HookForm mode={{ type: 'create' }} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/event name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/rule 1 command/i)).toBeInTheDocument()
  })

  it('disables event name in edit mode', () => {
    const data = { eventName: 'SessionStart', rules: [{ type: 'command', command: 'test.sh' }] }
    render(<HookForm mode={{ type: 'edit', initialData: data }} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/event name/i)).toBeDisabled()
  })

  it('validates event name on save', () => {
    const onSave = vi.fn()
    render(<HookForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('calls onSave with valid data', () => {
    const onSave = vi.fn()
    render(<HookForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/event name/i), { target: { value: 'SessionStart' } })
    fireEvent.change(screen.getByLabelText(/rule 1 command/i), { target: { value: '/path/to/script.sh' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith({
      eventName: 'SessionStart',
      rules: [{ type: 'command', command: '/path/to/script.sh' }]
    })
  })
})
