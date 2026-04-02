// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ProjectScopeProvider } from '../../../src/renderer/contexts/ProjectScopeContext'
import { ContextFilesProvider } from '../../../src/renderer/contexts/ContextFilesContext'
import { useContextFiles } from '../../../src/renderer/contexts/ContextFilesContext'
import { ContextFileDropZone } from '../../../src/renderer/components/DetailPanel/ContextFileDropZone'
import { ChatHeroInput } from '../../../src/renderer/components/ChatView/ChatHeroInput'

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof globalThis.ResizeObserver
}

beforeEach(() => {
  ;(window as any).opencow = {
    'capability:snapshot': vi.fn().mockResolvedValue({
      skills: [],
      agents: [],
      commands: [],
      rules: [],
      hooks: [],
      mcpServers: [],
      diagnostics: [],
      version: 1,
      timestamp: Date.now(),
    }),
    'on:opencow:event': vi.fn(() => () => {}),
    'list-project-files': vi.fn().mockResolvedValue([]),
    'search-project-files': vi.fn().mockResolvedValue([]),
  }
})

describe('ContextFileDropZone + ChatHeroInput integration', () => {
  it('drops x-opencow-file payload and sends context-files block', async () => {
    const onSend = vi.fn().mockResolvedValue(true)

    function TestDropZone({ children }: { children: React.ReactNode }): React.JSX.Element {
      const { addFiles } = useContextFiles()
      return (
        <ContextFileDropZone onFilesDrop={({ files }) => addFiles(files)}>
          {children}
        </ContextFileDropZone>
      )
    }

    const { container } = render(
      <ProjectScopeProvider projectPath="/tmp/project" projectId="proj-1">
        <ContextFilesProvider>
          <TestDropZone>
            <ChatHeroInput onSend={onSend} />
          </TestDropZone>
        </ContextFilesProvider>
      </ProjectScopeProvider>,
    )

    const root = container.querySelector('[data-context-file-dropzone]') as HTMLElement
    expect(root).toBeTruthy()

    const payload = JSON.stringify({
      path: 'src/components/Button.tsx',
      name: 'Button.tsx',
      isDirectory: false,
    })

    const dropDataTransfer = {
      types: ['application/x-opencow-file'],
      getData: vi.fn((mime: string) => (mime === 'application/x-opencow-file' ? payload : '')),
      dropEffect: '',
    }

    fireEvent.dragEnter(root, { dataTransfer: dropDataTransfer })
    fireEvent.dragOver(root, { dataTransfer: dropDataTransfer })
    fireEvent.drop(root, { dataTransfer: dropDataTransfer })

    await screen.findByRole('textbox')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled()
    })

    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1)
    })

    const sent = onSend.mock.calls[0][0]
    const text = typeof sent === 'string'
      ? sent
      : (Array.isArray(sent) ? sent.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '')

    expect(text).toContain('<context-files>')
    expect(text).toContain('- [file] src/components/Button.tsx')
    expect(text).toContain('</context-files>')
  })
})
