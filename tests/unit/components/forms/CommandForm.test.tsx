// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    const onChange = props.onChange as ((v: string) => void) | undefined
    return React.createElement('textarea', {
      'data-testid': 'code-editor',
      value: props.value as string,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    })
  },
  loader: { config: vi.fn() }
}))
vi.mock('monaco-editor', () => ({}))

import { CommandForm } from '../../../../src/renderer/components/DetailPanel/forms/CommandForm'

describe('CommandForm', () => {
  it('renders name/description/argumentHint fields and editor in create mode', () => {
    render(<CommandForm mode={{ type: 'create' }} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/argument hint/i)).toBeInTheDocument()
    expect(screen.getByTestId('code-editor')).toBeInTheDocument()
  })

  it('populates fields in edit mode', () => {
    const data = { name: 'deploy', description: 'Deploy', argumentHint: '<env>', body: '# Body' }
    render(<CommandForm mode={{ type: 'edit', initialData: data }} saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/name/i)).toHaveValue('deploy')
    expect(screen.getByLabelText(/name/i)).toBeDisabled()
  })

  it('validates name on save', () => {
    const onSave = vi.fn()
    render(<CommandForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('rejects invalid name characters', () => {
    const onSave = vi.fn()
    render(<CommandForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '../bad' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with valid data', () => {
    const onSave = vi.fn()
    render(<CommandForm mode={{ type: 'create' }} saving={false} onSave={onSave} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'deploy' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deploy' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'deploy', description: 'Deploy' }))
  })

  it('shows saving state', () => {
    render(<CommandForm mode={{ type: 'create' }} saving={true} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })
})
