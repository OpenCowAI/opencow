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
  it('extracts HTML artifact from legacy html alias', () => {
    const artifacts = extractAllArtifacts([
      assistantToolUseMessage('tool-1', 1000, {
        title: 'Legacy Alias',
        html: '<!doctype html><html><body>hello</body></html>',
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.title).toBe('Legacy Alias.html')
    expect(artifacts[0]?.mimeType).toBe('text/html')
    expect(artifacts[0]?.content).toBe('<!doctype html><html><body>hello</body></html>')
  })

  it('prefers content over html alias when both exist', () => {
    const artifacts = extractAllArtifacts([
      assistantToolUseMessage('tool-2', 1000, {
        title: 'Preferred Content',
        content: '<html><body>from-content</body></html>',
        html: '<html><body>from-alias</body></html>',
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.content).toBe('<html><body>from-content</body></html>')
  })
})
