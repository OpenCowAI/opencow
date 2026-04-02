// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SettingOptionCardGroup } from '../../../src/renderer/components/ui/SettingOptionCards'

function TestPreview({ label }: { label: string }): React.JSX.Element {
  return <div aria-hidden="true">preview-{label}</div>
}

describe('SettingOptionCardGroup', () => {
  it('renders as radiogroup and updates via click', async () => {
    const onChange = vi.fn()

    render(
      <SettingOptionCardGroup
        ariaLabel="Default Top Tab"
        value="issues"
        onChange={onChange}
        columns={3}
        options={[
          { value: 'issues', label: 'Issues', preview: <TestPreview label="issues" /> },
          { value: 'chat', label: 'Chat', preview: <TestPreview label="chat" /> },
          { value: 'schedule', label: 'Schedule', preview: <TestPreview label="schedule" /> },
        ]}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: 'Default Top Tab' })
    expect(group).toBeInTheDocument()

    const chat = screen.getByRole('radio', { name: 'Chat' })
    await userEvent.click(chat)
    expect(onChange).toHaveBeenCalledWith('chat')
  })

  it('supports keyboard arrow navigation', async () => {
    const onChange = vi.fn()

    render(
      <SettingOptionCardGroup
        ariaLabel="Chat Layout"
        value="default"
        onChange={onChange}
        columns={2}
        options={[
          { value: 'default', label: 'Minimal', preview: <TestPreview label="minimal" /> },
          { value: 'files', label: 'Files', preview: <TestPreview label="files" /> },
        ]}
      />,
    )

    const minimal = screen.getByRole('radio', { name: 'Minimal' })
    minimal.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('files')
  })
})
