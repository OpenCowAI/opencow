// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '@openai/codex-sdk'
import { CodexTurnProjector } from '../../../electron/conversation/runtime/codex/codexTurnProjector'

describe('CodexTurnProjector', () => {
  it('maps successful command_execution into tool_use only (no raw result echo)', () => {
    const projector = new CodexTurnProjector()

    const started = projector.upsert({
      id: 'cmd-1',
      type: 'command_execution',
      command: 'echo hi',
      aggregated_output: 'hi\n',
      status: 'in_progress',
    }, 'updated')

    expect(started.changed).toBe(true)
    expect(started.blocks.some((b) => b.type === 'tool_use' && b.id === 'cmd-1')).toBe(true)
    expect(started.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'cmd-1')).toBe(false)

    const completed = projector.upsert({
      id: 'cmd-1',
      type: 'command_execution',
      command: 'echo hi',
      aggregated_output: 'hi\n',
      status: 'completed',
      exit_code: 0,
    }, 'completed')

    expect(completed.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'cmd-1')).toBe(false)
  })

  it('maps failed command_execution into tool_use only and keeps stderr in progress', () => {
    const projector = new CodexTurnProjector()

    const completed = projector.upsert({
      id: 'cmd-fail',
      type: 'command_execution',
      command: 'rg --files',
      aggregated_output: 'zsh:1: command not found: rg\n',
      status: 'failed',
      exit_code: 127,
    }, 'completed')

    const result = completed.blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === 'cmd-fail')
    expect(result).toBeFalsy()

    const toolUse = completed.blocks.find((b) => b.type === 'tool_use' && b.id === 'cmd-fail')
    expect(toolUse).toBeTruthy()
    expect(toolUse?.type).toBe('tool_use')
    if (toolUse?.type === 'tool_use') {
      expect(toolUse.progress).toContain('command not found')
    }
  })

  it('emits web_search tool_result only at completed stage', () => {
    const projector = new CodexTurnProjector()
    const item: ThreadItem = {
      id: 'ws-1',
      type: 'web_search',
      query: 'openai codex sdk',
    }

    const started = projector.upsert(item, 'started')
    expect(started.blocks.some((b) => b.type === 'tool_use' && b.name === 'WebSearch')).toBe(true)
    expect(started.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'ws-1')).toBe(false)

    const completed = projector.upsert(item, 'completed')
    expect(completed.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'ws-1')).toBe(true)
  })

  it('emits file_change tool_result only at completed stage', () => {
    const projector = new CodexTurnProjector()
    const item: ThreadItem = {
      id: 'fc-1',
      type: 'file_change',
      changes: [{ path: 'src/a.ts', kind: 'update' }],
      status: 'completed',
    }

    const started = projector.upsert(item, 'started')
    const startedToolUse = started.blocks.find((b) => b.type === 'tool_use' && b.id === 'fc-1:0')
    expect(startedToolUse).toBeTruthy()
    expect(startedToolUse?.name).toBe('Edit')
    expect((startedToolUse?.input as { file_path?: string } | undefined)?.file_path).toBe('src/a.ts')
    expect(started.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'fc-1:0')).toBe(false)

    const completed = projector.upsert(item, 'completed')
    expect(completed.blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'fc-1:0')).toBe(true)
  })

  it('maps add-only file_change into Write tool_use', () => {
    const projector = new CodexTurnProjector()
    const item: ThreadItem = {
      id: 'fc-add-1',
      type: 'file_change',
      changes: [{ path: 'src/new.ts', kind: 'add' }],
      status: 'completed',
    }

    const projection = projector.upsert(item, 'completed')
    const toolUse = projection.blocks.find((b) => b.type === 'tool_use' && b.id === 'fc-add-1:0')
    expect(toolUse?.name).toBe('Write')
    expect((toolUse?.input as { file_path?: string } | undefined)?.file_path).toBe('src/new.ts')
  })

  it('splits multi-file file_change into per-file tool_use blocks', () => {
    const projector = new CodexTurnProjector()
    const item: ThreadItem = {
      id: 'fc-multi-1',
      type: 'file_change',
      changes: [
        { path: 'src/new.ts', kind: 'add' },
        { path: 'src/existing.ts', kind: 'update' },
      ],
      status: 'completed',
    }

    const projection = projector.upsert(item, 'completed')
    const toolUses = projection.blocks.filter((b) => b.type === 'tool_use')
    const toolResults = projection.blocks.filter((b) => b.type === 'tool_result')

    expect(toolUses).toHaveLength(2)
    expect(toolResults).toHaveLength(2)

    const first = toolUses.find((b) => b.id === 'fc-multi-1:0')
    const second = toolUses.find((b) => b.id === 'fc-multi-1:1')
    expect(first?.name).toBe('Write')
    expect((first?.input as { file_path?: string } | undefined)?.file_path).toBe('src/new.ts')
    expect(second?.name).toBe('Edit')
    expect((second?.input as { file_path?: string } | undefined)?.file_path).toBe('src/existing.ts')
  })

  it('maps todo_list to TodoWrite-compatible todo status payload', () => {
    const projector = new CodexTurnProjector()
    const projection = projector.upsert({
      id: 'todo-1',
      type: 'todo_list',
      items: [
        { text: 'A', completed: false },
        { text: 'B', completed: false },
        { text: 'C', completed: true },
      ],
    }, 'completed')

    const todoToolUse = projection.blocks.find((b) => b.type === 'tool_use' && b.id === 'todo-1')
    expect(todoToolUse?.name).toBe('TodoWrite')
    const todos = (todoToolUse?.input as { todos?: Array<{ status: string }> } | undefined)?.todos ?? []
    expect(todos.map((t) => t.status)).toEqual(['pending', 'pending', 'completed'])
  })

  it('normalizes mcp tool name and renders result text', () => {
    const projector = new CodexTurnProjector()
    const projection = projector.upsert({
      id: 'mcp-1',
      type: 'mcp_tool_call',
      server: 'Open Cow',
      tool: 'issue.list',
      arguments: { status: 'todo' },
      status: 'completed',
      result: {
        content: [{ type: 'text', text: '2 issues found' }],
        structured_content: { count: 2 },
      },
    }, 'completed')

    const toolUse = projection.blocks.find((b) => b.type === 'tool_use' && b.id === 'mcp-1')
    expect(toolUse?.name).toBe('mcp__open_cow__issue_list')

    const result = projection.blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === 'mcp-1')
    expect(result?.content).toContain('2 issues found')
    expect(result?.content).toContain('"count": 2')
  })

  it('dedupes adjacent identical thinking blocks from repeated reasoning items', () => {
    const projector = new CodexTurnProjector()

    projector.upsert({
      id: 'reason-1',
      type: 'reasoning',
      text: '**Acknowledging analysis request**',
    }, 'completed')

    const projection = projector.upsert({
      id: 'reason-2',
      type: 'reasoning',
      text: '**Acknowledging analysis request**',
    }, 'completed')

    const thinkingBlocks = projection.blocks.filter((b) => b.type === 'thinking')
    expect(thinkingBlocks).toHaveLength(1)
    expect(thinkingBlocks[0]?.thinking).toBe('**Acknowledging analysis request**')
  })

  it('filters non-fatal lag warning error items from projected blocks', () => {
    const projector = new CodexTurnProjector()
    const projection = projector.upsert({
      id: 'err-lag-1',
      type: 'error',
      message: 'in-process app-server event stream lagged; dropped 35 events',
    }, 'completed')

    expect(projection.blocks.some((b) => b.type === 'text' && String(b.text).includes('lagged; dropped'))).toBe(false)
  })

  it('filters non-fatal long-thread compaction advisory error items from projected blocks', () => {
    const projector = new CodexTurnProjector()
    const projection = projector.upsert({
      id: 'err-compaction-1',
      type: 'error',
      message: 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
    }, 'completed')

    expect(projection.blocks.some((b) => b.type === 'text' && String(b.text).includes('Long threads and multiple compactions'))).toBe(false)
  })
})
