// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { extractAllArtifacts } from '../../../src/shared/artifactExtraction'
import { NativeCapabilityTools } from '../../../src/shared/nativeCapabilityToolNames'
import type { ManagedSessionMessage } from '../../../src/shared/types'

function assistantToolUseMessage(
  toolId: string,
  timestamp: number,
  input: Record<string, unknown>,
): ManagedSessionMessage {
  return {
    id: `msg-${toolId}`,
    role: 'assistant',
    timestamp,
    content: [
      {
        type: 'tool_use',
        id: toolId,
        name: NativeCapabilityTools.GEN_HTML,
        input,
      },
    ],
  }
}

describe('gen_html artifact extraction', () => {
  it('extracts HTML artifact from the canonical `html` field', () => {
    const artifacts = extractAllArtifacts([
      assistantToolUseMessage('tool-1', 1000, {
        title: 'Hello Page',
        html: '<!doctype html><html><body>hello</body></html>',
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.title).toBe('Hello Page.html')
    expect(artifacts[0]?.mimeType).toBe('text/html')
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>hello</body></html>')
  })

  it('ignores any stray `content` field on a tool_use input — only `html` is read', () => {
    // Repro: GPT-5.4 historically emitted both fields; `content` carried a
    // textual page summary while `html` carried the real markup. The
    // canonical extraction must always pick `html`, never the description.
    const artifacts = extractAllArtifacts([
      assistantToolUseMessage('tool-2', 1000, {
        title: 'AI Agent 简介',
        content: '一个简单的 AI Agent 介绍页面，概述定义、能力、典型场景与注意事项。',
        html: '<!doctype html><html><body><h1>AI Agent</h1></body></html>',
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.content).toBe(
      '<!doctype html><html><body><h1>AI Agent</h1></body></html>',
    )
  })

  it('skips tool_use blocks where the html field is missing', () => {
    // Only the dropped legacy field present — should not produce an artifact.
    const artifacts = extractAllArtifacts([
      assistantToolUseMessage('tool-3', 1000, {
        title: 'No HTML',
        content: 'just a description',
      }),
    ])
    expect(artifacts).toHaveLength(0)
  })
})
