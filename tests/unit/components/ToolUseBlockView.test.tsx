// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import path from 'node:path'
import { ToolUseBlockView } from '../../../src/renderer/components/DetailPanel/SessionPanel/ToolUseBlockView'
import { ContentViewerProvider } from '../../../src/renderer/components/DetailPanel/SessionPanel/ContentViewerContext'
import { NativeCapabilityTools } from '../../../src/shared/nativeCapabilityToolNames'
import type { ToolUseBlock } from '../../../src/shared/types'

// Mock window.opencow — ToolUseBlockView uses getAppAPI() for file viewer and download
beforeEach(() => {
  ;(window as any).opencow = {
    'view-tool-file-content': vi.fn().mockResolvedValue({
      ok: true,
      data: { content: '', language: 'plaintext', size: 0 },
    }),
    'download-file': vi.fn().mockResolvedValue(undefined),
  }
})

function makeBlock(overrides: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu-1',
    name: 'Bash',
    input: { command: 'echo hello' },
    ...overrides
  }
}

describe('ToolUseBlockView', () => {
  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders tool name', () => {
    render(<ToolUseBlockView block={makeBlock()} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('extracts Bash target from command', () => {
    render(<ToolUseBlockView block={makeBlock({ input: { command: 'npm test --verbose' } })} />)
    expect(screen.getByText('npm test --verbose')).toBeInTheDocument()
  })

  it('extracts Read target as basename', () => {
    render(
      <ToolUseBlockView
        block={makeBlock({ name: 'Read', input: { file_path: '/Users/test/workspace/src/app.ts' } })}
      />
    )
    expect(screen.getByText('app.ts')).toBeInTheDocument()
  })

  it('extracts Grep target as pattern', () => {
    render(<ToolUseBlockView block={makeBlock({ name: 'Grep', input: { pattern: 'TODO' } })} />)
    expect(screen.getByText('TODO')).toBeInTheDocument()
  })

  it('shows spinner when executing', () => {
    render(<ToolUseBlockView block={makeBlock()} isExecuting />)
    expect(screen.getByLabelText('Tool executing')).toBeInTheDocument()
  })

  it('does not show spinner when not executing', () => {
    render(<ToolUseBlockView block={makeBlock()} isExecuting={false} />)
    expect(screen.queryByLabelText('Tool executing')).not.toBeInTheDocument()
  })

  it('shows progress content when available', () => {
    render(
      <ToolUseBlockView block={makeBlock({ progress: 'PASS src/test.ts\n3 tests passed' })} />
    )
    expect(screen.getByText(/PASS src\/test\.ts/)).toBeInTheDocument()
  })

  it('uses fallback icon for unknown tools', () => {
    render(<ToolUseBlockView block={makeBlock({ name: 'CustomTool' })} />)
    expect(screen.getByText('CustomTool')).toBeInTheDocument()
  })

  // ── Expand / collapse ──────────────────────────────────────────────────

  describe('expand/collapse', () => {
    it('does not render chevron when input is empty', () => {
      render(<ToolUseBlockView block={makeBlock({ name: 'EnterPlanMode', input: {} })} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders as a button when input has fields', () => {
      render(<ToolUseBlockView block={makeBlock()} />)
      expect(screen.getByRole('button', { name: /tool details/i })).toBeInTheDocument()
    })

    it('toggles details on click', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Read',
            input: { file_path: '/Users/test/workspace/src/app.ts' }
          })}
        />
      )

      // Collapsed: full path not visible
      expect(screen.queryByText('/Users/test/workspace/src/app.ts')).not.toBeInTheDocument()

      // Click to expand
      await user.click(screen.getByRole('button', { name: /tool details/i }))
      expect(screen.getByText('/Users/test/workspace/src/app.ts')).toBeInTheDocument()

      // Click to collapse
      await user.click(screen.getByRole('button', { name: /tool details/i }))
      expect(screen.queryByText('/Users/test/workspace/src/app.ts')).not.toBeInTheDocument()
    })

    it('sets aria-expanded correctly', async () => {
      const user = userEvent.setup()
      render(<ToolUseBlockView block={makeBlock()} />)

      const button = screen.getByRole('button', { name: /tool details/i })
      expect(button).toHaveAttribute('aria-expanded', 'false')

      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })
  })

  // ── Tool-specific detail rendering ────────────────────────────────────

  describe('ToolInputDetails', () => {
    it('shows full file_path for Read tool', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Read',
            input: { file_path: '/Users/test/workspace/src/shared/types.ts', offset: 100, limit: 50 }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('/Users/test/workspace/src/shared/types.ts')).toBeInTheDocument()
      expect(screen.getByText('file_path')).toBeInTheDocument()
      expect(screen.getByText('offset')).toBeInTheDocument()
      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('limit')).toBeInTheDocument()
      expect(screen.getByText('50')).toBeInTheDocument()
    })

    it('shows actual file content for Write tool (not just char count)', async () => {
      const user = userEvent.setup()
      const content = 'export function hello() {\n  return "world"\n}'
      render(
        <ToolUseBlockView
          block={makeBlock({ name: 'Write', input: { file_path: '/src/output.ts', content } })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Should show actual content, not just a char count
      expect(screen.getByText(/export function hello/)).toBeInTheDocument()
    })

    it('shows command in code block for Bash tool', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Bash',
            input: {
              command: 'npm install && npm run build',
              description: 'Install and build',
              timeout: 120000
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Command appears both as target summary and in code block
      expect(screen.getAllByText('npm install && npm run build').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('description')).toBeInTheDocument()
      expect(screen.getByText('Install and build')).toBeInTheDocument()
      expect(screen.getByText('timeout')).toBeInTheDocument()
      expect(screen.getByText('120000ms')).toBeInTheDocument()
    })

    it('shows inline diff view for Edit tool with colored removed/added lines', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: {
              file_path: '/src/app.ts',
              old_string: 'const a = 1',
              new_string: 'const a = 2'
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Diff view: should show file path and both old/new content (as diff lines)
      expect(screen.getByText('/src/app.ts')).toBeInTheDocument()
      expect(screen.getByText('const a = 1')).toBeInTheDocument()
      expect(screen.getByText('const a = 2')).toBeInTheDocument()
      // Should have the diff aria label
      expect(screen.getByRole('img', { name: /code diff/i })).toBeInTheDocument()
    })

    it('shows diff stats for Edit tool (removed/added counts)', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: {
              file_path: '/src/app.ts',
              old_string: 'line1\nline2\nline3',
              new_string: 'line1\nmodified\nline3\nnewline'
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Should show removed and added counts
      expect(screen.getByText(/−\d/)).toBeInTheDocument()
      expect(screen.getByText(/\+\d/)).toBeInTheDocument()
    })

    it('shows replace_all indicator for Edit with replace_all=true', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: {
              file_path: '/src/app.ts',
              old_string: 'foo',
              new_string: 'bar',
              replace_all: true
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))
      expect(screen.getByText('all')).toBeInTheDocument()
    })

    it('shows query for WebSearch tool', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({ name: 'WebSearch', input: { query: 'React 19 release date' } })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('query')).toBeInTheDocument()
      // Query appears both as target summary and in detail field
      expect(screen.getAllByText('React 19 release date').length).toBeGreaterThanOrEqual(1)
    })

    it('shows Grep details with multiple optional fields', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Grep',
            input: { pattern: 'TODO', path: '/src', glob: '*.ts', output_mode: 'content' }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('pattern')).toBeInTheDocument()
      expect(screen.getByText('path')).toBeInTheDocument()
      expect(screen.getByText('/src')).toBeInTheDocument()
      expect(screen.getByText('glob')).toBeInTheDocument()
      expect(screen.getByText('*.ts')).toBeInTheDocument()
      expect(screen.getByText('output_mode')).toBeInTheDocument()
      // 'content' appears as both output_mode value and possibly in other contexts
      expect(screen.getByText('content')).toBeInTheDocument()
    })

    it('handles unknown tool with generic display', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({ name: 'CustomMCPTool', input: { foo: 'bar', count: 42 } })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('foo')).toBeInTheDocument()
      expect(screen.getByText('bar')).toBeInTheDocument()
      expect(screen.getByText('count')).toBeInTheDocument()
      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('redacts file paths in browser upload details', async () => {
      const user = userEvent.setup()
      const unixAbsPath = path.resolve('workspace', 'secret', 'bank-statement.pdf')
      const unixAbsPathDisplay = path.basename(unixAbsPath)
      const windowsAbsPath = ['X:', 'Users', 'alice', 'Desktop', 'resume.pdf'].join('/')
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: NativeCapabilityTools.BROWSER_UPLOAD,
            input: {
              target: { kind: 'css', selector: 'input[type=file]' },
              files: [
                unixAbsPath,
                'src/assets/logo.png',
                '../private/token.txt',
                windowsAbsPath,
              ],
              strict: true,
            },
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      const filesBlock = screen.getByText((content, node) => {
        return node?.tagName === 'PRE' && content.includes(unixAbsPathDisplay)
      })
      expect(filesBlock).toHaveTextContent(unixAbsPathDisplay)
      expect(filesBlock).toHaveTextContent('.../assets/logo.png')
      expect(filesBlock).toHaveTextContent('private/token.txt')
      expect(filesBlock).toHaveTextContent('resume.pdf')

      expect(screen.queryByText(unixAbsPath)).not.toBeInTheDocument()
      expect(screen.queryByText(windowsAbsPath)).not.toBeInTheDocument()
    })
  })

  // ── Structured tools (TodoWrite, ExitPlanMode, AskUserQuestion) ───────

  describe('structured tools', () => {
    it('renders TodoWrite fallback details when routed to ToolUseBlockView', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Add feature A', status: 'completed', activeForm: 'Adding feature A' },
                { content: 'Fix bug B', status: 'in_progress', activeForm: 'Fixing bug B' },
                { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' }
              ]
            }
          })}
        />
      )

      // Target summary should show item count
      expect(screen.getByText('3 items')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // ToolUseBlockView is a fallback renderer for widget tools:
      // keep validating the generic field contract (not widget-specific UI icons).
      expect(screen.getByText('todos')).toBeInTheDocument()
      expect(screen.getByText(/Add feature A/)).toBeInTheDocument()
      expect(screen.getByText(/Fix bug B/)).toBeInTheDocument()
      expect(screen.getByText(/Write tests/)).toBeInTheDocument()
    })

    it('renders ExitPlanMode fallback details when routed to ToolUseBlockView', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'ExitPlanMode',
            input: {
              allowedPrompts: [
                { tool: 'Bash', prompt: 'run tests' },
                { tool: 'Bash', prompt: 'install dependencies' }
              ]
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('allowedPrompts')).toBeInTheDocument()
      expect(screen.getByText(/run tests/)).toBeInTheDocument()
      expect(screen.getByText(/install dependencies/)).toBeInTheDocument()
    })

    it('renders AskUserQuestion fallback details when routed to ToolUseBlockView', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: 'Which approach do you prefer?',
                  header: 'Approach',
                  options: [
                    { label: 'Option A', description: 'Fast but complex' },
                    { label: 'Option B', description: 'Simple but slow' }
                  ],
                  multiSelect: false
                }
              ]
            }
          })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Question appears both as target summary and in the fallback code block.
      expect(screen.getAllByText(/Which approach do you prefer/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('questions')).toBeInTheDocument()
      expect(screen.getByText(/Option A/)).toBeInTheDocument()
      expect(screen.getByText(/Fast but complex/)).toBeInTheDocument()
      expect(screen.getByText(/Option B/)).toBeInTheDocument()
      expect(screen.getByText(/Simple but slow/)).toBeInTheDocument()
    })

    // Note: Task tool_use blocks are now routed to TaskExecutionView by
    // ContentBlockRenderer and never reach ToolUseBlockView. Task-specific
    // tests live in TaskExecutionView.test.tsx.

    it('renders NotebookEdit with cell source', async () => {
      const user = userEvent.setup()
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'NotebookEdit',
            input: {
              notebook_path: '/Users/test/analysis.ipynb',
              edit_mode: 'replace',
              cell_type: 'code',
              new_source: 'import pandas as pd\ndf = pd.read_csv("data.csv")'
            }
          })}
        />
      )

      // Target should show notebook basename
      expect(screen.getByText('analysis.ipynb')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText('edit_mode')).toBeInTheDocument()
      expect(screen.getByText('replace')).toBeInTheDocument()
      expect(screen.getByText('cell_type')).toBeInTheDocument()
      expect(screen.getByText(/import pandas as pd/)).toBeInTheDocument()
    })
  })

  // ── Truncation ────────────────────────────────────────────────────────

  describe('truncation', () => {
    it('truncates long code values and shows "Show full" button', async () => {
      const user = userEvent.setup()
      const longCommand = 'x'.repeat(500)
      render(<ToolUseBlockView block={makeBlock({ name: 'Bash', input: { command: longCommand } })} />)

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      expect(screen.getByText(/Show full/)).toBeInTheDocument()
      expect(screen.queryByText(longCommand)).not.toBeInTheDocument()
    })

    it('clicking "Show full" reveals full content without collapsing details', async () => {
      const user = userEvent.setup()
      const longCommand = 'a'.repeat(500)
      render(<ToolUseBlockView block={makeBlock({ name: 'Bash', input: { command: longCommand } })} />)

      await user.click(screen.getByRole('button', { name: /tool details/i }))
      await user.click(screen.getByText(/Show full/))

      expect(screen.getByText(longCommand)).toBeInTheDocument()
      // Details panel should still be expanded
      expect(screen.getByText('command')).toBeInTheDocument()
    })

    it('shows Write file content with truncation (not just char count)', async () => {
      const user = userEvent.setup()
      const longContent = 'line\n'.repeat(200)
      render(
        <ToolUseBlockView
          block={makeBlock({ name: 'Write', input: { file_path: '/src/big.ts', content: longContent } })}
        />
      )

      await user.click(screen.getByRole('button', { name: /tool details/i }))

      // Should show "Show full" with char count, meaning actual content is displayed (truncated)
      expect(screen.getByText(/Show full/)).toBeInTheDocument()
      // And partial content should be visible
      expect(screen.getByText(/line/)).toBeInTheDocument()
    })
  })

  // ── Content Viewer button ──────────────────────────────────────────

  describe('content viewer', () => {
    it('shows row-level "View" button for Write tool', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/src/app.tsx', content: 'export default function App() {}' }
          })}
        />
      )

      // View button should be on the row (no need to expand first)
      expect(screen.getByRole('button', { name: /view.*app\.tsx/i })).toBeInTheDocument()
    })

    it('shows row-level "View" button for Write without inline content', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/src/from-codex.ts' }
          })}
        />
      )

      // Codex file_change mapping may only provide file_path
      expect(screen.getByRole('button', { name: /view.*from-codex\.ts/i })).toBeInTheDocument()
    })

    it('shows row-level "Diff" button for Edit tool', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: { file_path: '/src/app.tsx', old_string: 'const a = 1', new_string: 'const a = 2' }
          })}
        />
      )

      // Edit should have a row-level Diff button (no need to expand)
      expect(screen.getByRole('button', { name: /diff.*app\.tsx/i })).toBeInTheDocument()
      // Edit should NOT have a row-level View button
      expect(screen.queryByRole('button', { name: /view.*app\.tsx/i })).not.toBeInTheDocument()
    })

    it('does NOT show "Diff" button for Edit without old_string/new_string', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: { file_path: '/src/app.tsx' }
          })}
        />
      )

      expect(screen.queryByRole('button', { name: /diff/i })).not.toBeInTheDocument()
    })

    it('shows row-level "View" button for Edit without old_string/new_string', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Edit',
            input: { file_path: '/src/app.tsx' }
          })}
        />
      )

      expect(screen.getByRole('button', { name: /view.*app\.tsx/i })).toBeInTheDocument()
    })

    it('loads file content when clicking fallback View button', async () => {
      const user = userEvent.setup()
      const viewFileContent = vi.fn().mockResolvedValue({
        ok: true,
        data: { content: 'const fromDisk = true', language: 'typescript', size: 20 },
      })
      ;(window as any).opencow['view-tool-file-content'] = viewFileContent

      render(
        <ContentViewerProvider>
          <ToolUseBlockView
            sessionId="session-1"
            block={makeBlock({
              name: 'Write',
              input: { file_path: '/src/from-codex.ts' }
            })}
          />
        </ContentViewerProvider>
      )

      await user.click(screen.getByRole('button', { name: /view.*from-codex\.ts/i }))
      await waitFor(() => {
        expect(viewFileContent).toHaveBeenCalledWith({
          sessionId: 'session-1',
          filePath: '/src/from-codex.ts',
        })
      })
    })

    it('does NOT show "View" button for Bash command', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({ name: 'Bash', input: { command: 'echo hello' } })}
        />
      )

      expect(screen.queryByRole('button', { name: /view/i })).not.toBeInTheDocument()
    })
  })

  // ── Target summaries for new tools ────────────────────────────────────

  describe('tool target summaries', () => {
    it('shows hostname for WebFetch', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'WebFetch',
            input: { url: 'https://example.com/path', prompt: 'Extract data' }
          })}
        />
      )
      expect(screen.getByText('example.com')).toBeInTheDocument()
    })

    it('shows skill name for Skill tool', () => {
      render(
        <ToolUseBlockView block={makeBlock({ name: 'Skill', input: { skill: 'commit' } })} />
      )
      expect(screen.getByText('commit')).toBeInTheDocument()
    })

    it('shows first question for AskUserQuestion', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Which database?' }] }
          })}
        />
      )
      // Text appears both in the tool row target and in the AskUserQuestionCard
      expect(screen.getAllByText('Which database?').length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Markdown Write preview ──────────────────────────────────────────

  describe('markdown write preview', () => {
    const mdContent = '# Hello World\n\nThis is **bold** text.\n\n- Item 1\n- Item 2'

    it('shows Markdown preview card for Write .md file', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/docs/README.md', content: mdContent }
          })}
        />
      )

      // Card should show file name via aria-label
      expect(screen.getByRole('button', { name: /preview.*readme\.md/i })).toBeInTheDocument()
      // MarkdownContent renders synchronously — rendered content should appear
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })

    it('does NOT show Markdown preview card for Write .ts file', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/src/app.ts', content: 'export const a = 1' }
          })}
        />
      )

      // No card with markdown preview aria-label
      expect(screen.queryByLabelText(/markdown preview/i)).not.toBeInTheDocument()
    })

    it('renders markdown content inside the preview card', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/docs/GUIDE.md', content: mdContent }
          })}
        />
      )

      // MarkdownContent renders synchronously — check rendered elements
      expect(screen.getByText('Hello World')).toBeInTheDocument()
      // Card header renders file name (may appear multiple times — at least one)
      expect(screen.getAllByText('GUIDE.md').length).toBeGreaterThanOrEqual(1)
    })

    it('shows line count in the preview card header', () => {
      render(
        <ToolUseBlockView
          block={makeBlock({
            name: 'Write',
            input: { file_path: '/docs/README.md', content: mdContent }
          })}
        />
      )

      // mdContent has 7 lines — the header counts newlines + 1
      const lineCount = mdContent.split('\n').length
      expect(screen.getByText(`${lineCount} lines`)).toBeInTheDocument()
    })
  })
})
