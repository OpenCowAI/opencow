// SPDX-License-Identifier: Apache-2.0

import type {
  ThreadItem,
  CommandExecutionItem,
  FileChangeItem,
  McpToolCallItem,
  TodoListItem,
  WebSearchItem,
} from '@openai/codex-sdk'
import type { SDKContentBlock } from '../../../command/contentBlocks'
import { classifyCodexErrorMessage } from './codexEventFilters'

interface CodexProjection {
  blocks: SDKContentBlock[]
  changed: boolean
}

export type CodexThreadItemStage = 'started' | 'updated' | 'completed'

interface CodexTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export class CodexTurnProjector {
  private readonly itemOrder: string[] = []
  private readonly items = new Map<string, { item: ThreadItem; stage: CodexThreadItemStage }>()
  private lastSnapshotKey: string | null = null

  upsert(item: ThreadItem, stage: CodexThreadItemStage): CodexProjection {
    if (!this.items.has(item.id)) this.itemOrder.push(item.id)
    this.items.set(item.id, { item, stage })
    return this.project()
  }

  snapshot(): SDKContentBlock[] {
    return this.buildBlocks()
  }

  private project(): CodexProjection {
    const blocks = this.buildBlocks()
    const key = JSON.stringify(blocks)
    const changed = key !== this.lastSnapshotKey
    if (changed) this.lastSnapshotKey = key
    return { blocks, changed }
  }

  private buildBlocks(): SDKContentBlock[] {
    const blocks: SDKContentBlock[] = []
    for (const id of this.itemOrder) {
      const entry = this.items.get(id)
      if (!entry) continue
      blocks.push(...mapThreadItemToBlocks(entry.item, entry.stage))
    }
    return dedupeAdjacentThinkingBlocks(blocks)
  }
}

function dedupeAdjacentThinkingBlocks(blocks: SDKContentBlock[]): SDKContentBlock[] {
  const deduped: SDKContentBlock[] = []
  for (const block of blocks) {
    const prev = deduped[deduped.length - 1]
    if (
      prev?.type === 'thinking' &&
      block.type === 'thinking' &&
      normalizeThinkingText(prev.thinking) === normalizeThinkingText(block.thinking)
    ) {
      continue
    }
    deduped.push(block)
  }
  return deduped
}

function normalizeThinkingText(text: unknown): string {
  return typeof text === 'string' ? text.trim() : ''
}

function mapThreadItemToBlocks(item: ThreadItem, stage: CodexThreadItemStage): SDKContentBlock[] {
  switch (item.type) {
    case 'agent_message':
      return item.text ? [{ type: 'text', text: item.text }] : []
    case 'reasoning':
      return item.text ? [{ type: 'thinking', thinking: item.text }] : []
    case 'command_execution':
      return mapCommandExecutionItem(item, stage)
    case 'mcp_tool_call':
      return mapMcpToolCallItem(item)
    case 'web_search':
      return mapWebSearchItem(item, stage)
    case 'file_change':
      return mapFileChangeItem(item, stage)
    case 'todo_list':
      return mapTodoListItem(item)
    case 'error':
      if (classifyCodexErrorMessage(item.message)?.terminal === false) return []
      return item.message ? [{ type: 'text', text: `Error: ${item.message}` }] : []
  }
}

const MAX_COMMAND_OUTPUT_CHARS = 4000

function mapCommandExecutionItem(item: CommandExecutionItem, stage: CodexThreadItemStage): SDKContentBlock[] {
  const exitCode = item.exit_code
  const isError = item.status === 'failed' || (exitCode != null && exitCode !== 0)
  const shouldShowProgress = (item.status === 'in_progress' && stage !== 'completed') || isError
  const progress = shouldShowProgress ? clipCommandOutput(item.aggregated_output ?? '') : ''

  const toolUse: SDKContentBlock = {
    type: 'tool_use',
    id: item.id,
    name: 'Bash',
    input: { command: item.command },
    ...(progress ? { progress } : {}),
  }

  return [toolUse]
}

function clipCommandOutput(output: string): string {
  if (output.length <= MAX_COMMAND_OUTPUT_CHARS) return output
  const tail = output.slice(-MAX_COMMAND_OUTPUT_CHARS)
  return `${tail}\n\n[output truncated: showing last ${MAX_COMMAND_OUTPUT_CHARS} chars]`
}

function mapMcpToolCallItem(item: McpToolCallItem): SDKContentBlock[] {
  const toolName = toMcpToolName(item.server, item.tool)
  const input =
    item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
      ? (item.arguments as Record<string, unknown>)
      : { arguments: item.arguments }

  const toolUse: SDKContentBlock = {
    type: 'tool_use',
    id: item.id,
    name: toolName,
    input,
  }

  if (item.status === 'in_progress') return [toolUse]

  return [
    toolUse,
    {
      type: 'tool_result',
      tool_use_id: item.id,
      content: renderMcpToolResult(item),
      is_error: item.status === 'failed',
    },
  ]
}

function mapWebSearchItem(item: WebSearchItem, stage: CodexThreadItemStage): SDKContentBlock[] {
  const toolUse: SDKContentBlock = {
    type: 'tool_use',
    id: item.id,
    name: 'WebSearch',
    input: { query: item.query },
  }

  if (stage !== 'completed' || item.query.trim().length === 0) return [toolUse]

  return [
    toolUse,
    {
      type: 'tool_result',
      tool_use_id: item.id,
      content: `Search query: ${item.query}`,
      is_error: false,
    },
  ]
}

function mapFileChangeItem(item: FileChangeItem, stage: CodexThreadItemStage): SDKContentBlock[] {
  if (item.changes.length === 0) {
    const fallbackToolUse: SDKContentBlock = {
      type: 'tool_use',
      id: item.id,
      name: 'Edit',
      input: { changes: [] },
    }
    if (stage !== 'completed') return [fallbackToolUse]
    return [
      fallbackToolUse,
      {
        type: 'tool_result',
        tool_use_id: item.id,
        content: item.status === 'failed' ? 'Patch apply failed.' : 'Patch applied.',
        is_error: item.status === 'failed',
      },
    ]
  }

  const blocks: SDKContentBlock[] = []
  const header = item.status === 'failed' ? 'Patch apply failed.' : 'Patch applied.'

  for (let i = 0; i < item.changes.length; i++) {
    const change = item.changes[i]
    const toolUseId = `${item.id}:${i}`
    const toolUse: SDKContentBlock = {
      type: 'tool_use',
      id: toolUseId,
      name: change.kind === 'add' ? 'Write' : 'Edit',
      input: {
        file_path: change.path,
        changes: [change],
      },
    }
    blocks.push(toolUse)

    if (stage === 'completed') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `${header}\n${change.kind}: ${change.path}`,
        is_error: item.status === 'failed',
      })
    }
  }

  return blocks
}

function mapTodoListItem(item: TodoListItem): SDKContentBlock[] {
  const todos: CodexTodoItem[] = item.items.map((todo, idx) => {
    if (todo.completed) {
      return { content: todo.text, status: 'completed' }
    }
    // Codex todo_list only reports a boolean completed flag. It does NOT expose
    // a canonical "active item" marker, so inferring one as in_progress creates
    // misleading progress stats (e.g. ◉1 when there is no active task signal).
    // Keep all open items as pending and let the UI reflect uncertainty honestly.
    return {
      content: todo.text,
      status: 'pending',
    }
  })

  return [
    {
      type: 'tool_use',
      id: item.id,
      name: 'TodoWrite',
      input: { todos },
    },
  ]
}

function toMcpToolName(server: string, tool: string): string {
  const normalize = (value: string, fallback: string): string => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_+|_+$/g, '')
    return normalized || fallback
  }

  const normalizedServer = normalize(server, 'unknown_server')
  const normalizedTool = normalize(tool, 'unknown_tool')
  return `mcp__${normalizedServer}__${normalizedTool}`
}

function renderMcpToolResult(item: McpToolCallItem): string {
  if (item.status === 'failed') {
    return item.error?.message ?? 'MCP tool call failed.'
  }

  const parts: string[] = []

  const resultContent = item.result?.content
  if (Array.isArray(resultContent)) {
    for (const block of resultContent) {
      const raw = block as { type?: string; text?: string }
      if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim().length > 0) {
        parts.push(raw.text)
      } else {
        const serialized = safeStringify(block)
        if (serialized) parts.push(serialized)
      }
    }
  }

  const structured = safeStringify(item.result?.structured_content)
  if (structured && structured !== 'null') {
    parts.push(structured)
  }

  return parts.join('\n\n') || 'MCP tool call completed.'
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}
